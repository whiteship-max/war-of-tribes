import { beforeEach, describe, expect, it } from 'vitest';
import type { Building, BuildingTypeId, GameState, JobId, Season } from '../types';
import { createInitialState } from '../state';
import { catchUp, tick } from './tick';
import { startUpgrade, resolveEvent } from './actions';
import { assignWorker, autoAssign, changeFreeJob, normalizeAssignments, unassignWorker } from './workers';
import { addVillager } from './population';
import { seeded, setRandom } from './random';
import {
  buildingOfType,
  buildingSlots,
  foodConsumptionPerDay,
  heatingWoodPerDay,
  housingCapacity,
  isSite,
  jobCounts,
  jobMultiplier,
  levelOutputMult,
  maxLevelFor,
  armySize,
  forgeInfo,
  productionPerDay,
  seasonDayOf,
  seasonOf,
  storageCap,
  winterForecast,
  workerCount,
  workersIn,
  yearOf,
} from '../derived';
import { DAY_LENGTH, MAX_BUILDING_LEVEL, RESOURCE_IDS } from '../constants';
import { BUILDINGS, BUILDING_BY_ID } from '../data/buildings';
import { SEASONS, SEASON_DAYS, SEASON_SECONDS, YEAR_DAYS } from '../data/seasons';
import { QUESTS } from '../data/quests';
import {
  TUTORIAL,
  advanceTutorial,
  currentStep,
  finishTutorial,
  stepText,
  tapTutorial,
  tutorialActive,
  type TutorialUi,
} from '../data/tutorial';
import { deserialize, serialize } from '../save';
import { SAVE_VERSION } from '../state';
import { setForging } from './smithy';
import { startRecruit } from './army';

beforeEach(() => setRandom(seeded(42)));

/** Ставит зданию нужный уровень — короче, чем прогонять улучшения. Тип в посёлке один. */
function place(s: GameState, type: BuildingTypeId, level = 1): Building {
  const b = s.buildings.find((x) => x.type === type)!;
  b.level = level;
  b.work = 0;
  b.workRequired = 0;
  return b;
}

/** Отправляет всех по домам: чистая доска для расчётов выработки. */
function idleAll(s: GameState): void {
  for (const v of s.villagers) {
    v.job = 'idle';
    v.workplace = null;
    v.talent = null;
  }
}

describe('симуляция', () => {
  it('новая партия: весь посёлок со стеной стоит с первой секунды, всё первого уровня', () => {
    const s = createInitialState();
    const types = s.buildings.map((b) => b.type).sort();
    expect(types).toEqual(BUILDINGS.map((d) => d.id).sort());
    expect(s.buildings.every((b) => b.level === 1 && !isSite(b))).toBe(true);
    expect(buildingOfType(s, 'palisade')).not.toBeNull();
    // Людей столько, сколько жилья, и у костра есть свободные руки.
    expect(s.villagers.length).toBeLessThanOrEqual(housingCapacity(s));
    expect(jobCounts(s).idle).toBeGreaterThanOrEqual(3);
  });

  it('наём, кузница, рынок и золото доступны сразу', () => {
    const s = createInitialState();
    expect(s.gold).toBeGreaterThan(0);
    expect(setForging(s, 'armor')).toBeNull();
    expect(forgeInfo(s).blocked).toMatch(/никто не работает/);
    // Копьё на складе — и первый копейщик нанимается без единого условия.
    s.equipment.spear = 1;
    expect(startRecruit(s, 'spearman', 1)).toBeNull();
  });

  it('работники производят ресурсы, жители едят', () => {
    const s = createInitialState();
    const wood0 = s.resources.wood;
    catchUp(s, DAY_LENGTH, 0.5);
    // Один лесоруб на лесопилке первого уровня: 9 в день с поправкой на мораль.
    expect(s.resources.wood - wood0).toBeGreaterThan(6);
    expect(s.resources.wood - wood0).toBeLessThan(11);
  });

  it('голод убивает жителя', () => {
    const s = createInitialState();
    const pop0 = s.villagers.length;
    s.resources.food = 0;
    for (const v of s.villagers) {
      v.job = 'woodcutter';
      v.workplace = null;
    }
    catchUp(s, DAY_LENGTH * 5, 1);
    expect(s.villagers.length).toBeLessThan(pop0);
  });

  it('население растёт при наличии жилья и еды', () => {
    const s = createInitialState();
    const pop0 = s.villagers.length;
    s.resources.food = 100;
    place(s, 'hut', 3);
    catchUp(s, 200, 1);
    expect(s.villagers.length).toBeGreaterThan(pop0);
  });

  it('офлайн-догон не запускает события', () => {
    const s = createInitialState();
    catchUp(s, 600, 2);
    expect(s.activeEvent).toBeNull();
  });

  it('обучение придерживает события, пока идёт', () => {
    const s = createInitialState();
    for (let i = 0; i < 200; i++) tick(s, 0.5);
    expect(s.activeEvent).toBeNull();
  });

  it('онлайн событие появляется и разрешается', () => {
    const s = createInitialState();
    finishTutorial(s);
    for (let i = 0; i < 200; i++) tick(s, 0.5);
    expect(s.activeEvent).not.toBeNull();
    const r = resolveEvent(s, 0);
    expect(r.error).toBeNull();
    expect(s.activeEvent).toBeNull();
    expect(s.nextEventAt).toBeGreaterThan(s.time);
  });

  it('задание выполняется и даёт награду', () => {
    const s = createInitialState();
    tick(s, 0.5);
    expect(s.completedQuests).toContain('assign_workers');
  });
});

// ---------- Здания: уровни, слоты, вольный сбор ----------

describe('здания', () => {
  it('выработка масштабируется от уровня здания и числа рабочих', () => {
    const s = createInitialState();
    idleAll(s);
    const mill = place(s, 'sawmill', 1);
    expect(assignWorker(s, mill.id)).toBeNull();
    const one = productionPerDay(s).wood;
    expect(one).toBeGreaterThan(0);

    mill.level = 2;
    expect(assignWorker(s, mill.id)).toBeNull();
    const two = productionPerDay(s).wood;
    // Двое рабочих на втором уровне: вдвое больше рук и +10% каждому.
    expect(two).toBeCloseTo(one * 2 * 1.1, 5);
  });

  it('слоты не переполняются: мест столько же, сколько уровней', () => {
    const s = createInitialState();
    idleAll(s);
    const mill = place(s, 'sawmill', 1);
    expect(buildingSlots(mill)).toBe(1);
    expect(assignWorker(s, mill.id)).toBeNull();
    expect(assignWorker(s, mill.id)).toMatch(/места заняты/);
    expect(workerCount(s, mill.id)).toBe(1);

    // Даже если лишнего вписали в обход действий, нормализация выставит его со слота.
    s.villagers[3].job = 'woodcutter';
    s.villagers[3].workplace = mill.id;
    expect(workerCount(s, mill.id)).toBe(2);
    normalizeAssignments(s);
    expect(workerCount(s, mill.id)).toBe(1);
    // Профессия у него остаётся: без места это просто вольный сбор.
    expect(s.villagers[3].workplace).toBeNull();
  });

  it('вольный сбор без здания работает вполсилы', () => {
    const free = createInitialState();
    idleAll(free);
    expect(changeFreeJob(free, 'woodcutter', 1)).toBeNull();
    const wild = productionPerDay(free).wood;

    const housed = createInitialState();
    idleAll(housed);
    const mill = place(housed, 'sawmill', 1);
    expect(assignWorker(housed, mill.id)).toBeNull();
    const inside = productionPerDay(housed).wood;

    expect(wild).toBeGreaterThan(0);
    expect(wild).toBeCloseTo(inside * 0.5, 6);
  });

  it('профессия без профильного здания недоступна вольным сбором', () => {
    const s = createInitialState();
    idleAll(s);
    expect(changeFreeJob(s, 'farmer', 1)).toMatch(/только в здании/);
    const farm = place(s, 'farm');
    expect(assignWorker(s, farm.id)).toBeNull();
    expect(jobCounts(s).farmer).toBe(1);
  });

  it('снятый рабочий возвращается в свободные', () => {
    const s = createInitialState();
    idleAll(s);
    const mill = place(s, 'sawmill');
    assignWorker(s, mill.id);
    expect(unassignWorker(s, mill.id)).toBeNull();
    expect(workerCount(s, mill.id)).toBe(0);
    expect(jobCounts(s).idle).toBe(s.villagers.length);
  });

  it('улучшение идёт как стройка и добавляет место', () => {
    const s = createInitialState();
    idleAll(s);
    s.resources.wood = 200;
    const mill = place(s, 'sawmill', 1);
    assignWorker(s, mill.id);
    expect(startUpgrade(s, mill.id)).toBeNull();
    expect(isSite(mill)).toBe(true);
    // Здание не разбирают: рабочий на месте и продолжает работать.
    expect(workerCount(s, mill.id)).toBe(1);
    expect(productionPerDay(s).wood).toBeGreaterThan(0);

    catchUp(s, 60, 1);
    expect(mill.level).toBe(2);
    expect(isSite(mill)).toBe(false);
    expect(buildingSlots(mill)).toBe(2);
    expect(assignWorker(s, mill.id)).toBeNull();
  });

  it('каждого типа ровно одно здание, и развитие идёт только уровнями', () => {
    const s = createInitialState();
    const seen = new Set<BuildingTypeId>();
    for (const b of s.buildings) {
      expect(seen.has(b.type), `${b.type} стоит дважды`).toBe(false);
      seen.add(b.type);
    }
    s.resources.wood = 500;
    s.resources.stone = 500;
    const mill = buildingOfType(s, 'sawmill')!;
    expect(startUpgrade(s, mill.id)).toBeNull();
    expect(startUpgrade(s, mill.id)).toMatch(/уже идёт/);
    catchUp(s, 60, 1);
    expect(mill.level).toBe(2);
    expect(s.buildings.filter((b) => b.type === 'sawmill')).toHaveLength(1);
  });

  it('улучшение не отключает здание: рабочие на местах, выработка не падает', () => {
    const s = createInitialState();
    idleAll(s);
    s.resources.wood = 500;
    s.morale = 60;
    const mill = place(s, 'sawmill', 2);
    expect(assignWorker(s, mill.id)).toBeNull();
    expect(assignWorker(s, mill.id)).toBeNull();
    const before = productionPerDay(s).wood;
    const crew = workersIn(s, mill.id).map((v) => v.id).sort();

    expect(startUpgrade(s, mill.id)).toBeNull();
    expect(isSite(mill)).toBe(true);
    // Слоты не сбросились, люди не слетели, выработка та же самая.
    expect(buildingSlots(mill)).toBe(2);
    expect(workersIn(s, mill.id).map((v) => v.id).sort()).toEqual(crew);
    expect(productionPerDay(s).wood).toBeCloseTo(before, 6);

    // И нормализация назначений на тике их тоже не трогает.
    tick(s, 1);
    expect(workersIn(s, mill.id).map((v) => v.id).sort()).toEqual(crew);

    catchUp(s, 300, 1);
    s.morale = 60;
    expect(mill.level).toBe(3);
    expect(isSite(mill)).toBe(false);
    // Новый слот добавился к старым, а не вместо них.
    expect(buildingSlots(mill)).toBe(3);
    expect(workersIn(s, mill.id).map((v) => v.id).sort()).toEqual(crew);
    expect(productionPerDay(s).wood).toBeGreaterThan(before);
  });

  it('после улучшения эффекты вырастают ровно на шаг уровня', () => {
    const s = createInitialState();
    s.resources.wood = 4000;
    s.resources.stone = 4000;
    const hut = place(s, 'hut', 1);
    const housing0 = housingCapacity(s);
    expect(startUpgrade(s, hut.id)).toBeNull();
    catchUp(s, 200, 1);
    expect(hut.level).toBe(2);
    expect(housingCapacity(s) - housing0).toBe(BUILDING_BY_ID.hut.perLevel?.housing);

    const store = buildingOfType(s, 'storage')!;
    const cap0 = storageCap(s);
    expect(startUpgrade(s, store.id)).toBeNull();
    catchUp(s, 200, 1);
    expect(store.level).toBe(2);
    expect(storageCap(s) - cap0).toBe(BUILDING_BY_ID.storage.perLevel?.storage);

    // Выработка рабочего растёт на один шаг LEVEL_OUTPUT_STEP.
    const mill = place(s, 'sawmill', 1);
    expect(levelOutputMult(mill.level + 1) - levelOutputMult(mill.level)).toBeCloseTo(0.1, 6);
  });

  it('на потолке уровней мест работы примерно столько же, сколько людей', () => {
    const s = createInitialState();
    for (const def of BUILDINGS) place(s, def.id, def.maxLevel ?? MAX_BUILDING_LEVEL);
    // На потолке: 40+ человек под крышей одной хижины и одного укрытия.
    const housing = housingCapacity(s);
    expect(housing).toBeGreaterThanOrEqual(40);
    expect(maxLevelFor('hut')).toBe(MAX_BUILDING_LEVEL);

    // Пять зданий добычи можно укомплектовать целиком — это и есть рабочее ядро посёлка.
    const core: BuildingTypeId[] = ['gathering', 'sawmill', 'quarry', 'hunter_hut', 'farm'];
    const coreSlots = core.reduce((n, t) => n + buildingSlots(buildingOfType(s, t)!), 0);
    expect(coreSlots).toBeLessThanOrEqual(housing);
    // Всех мест разом больше, чем людей — но не в разы: выбор есть, абсурда нет.
    const allSlots = s.buildings.reduce((n, b) => n + buildingSlots(b), 0);
    expect(allSlots).toBeGreaterThan(housing);
    expect(allSlots).toBeLessThanOrEqual(housing * 2.5);
  });

  it('исчезнувшее здание не оставляет висячих рабочих', () => {
    const s = createInitialState();
    idleAll(s);
    const mill = place(s, 'sawmill');
    const farm = place(s, 'farm');
    assignWorker(s, mill.id);
    assignWorker(s, farm.id);
    s.buildings.splice(s.buildings.indexOf(mill), 1);
    s.buildings.splice(s.buildings.indexOf(farm), 1);
    tick(s, 0.5);
    // Лесоруб уходит на вольный сбор — руки без сарая работают вполсилы, но работают.
    expect(jobCounts(s).woodcutter).toBe(1);
    expect(s.villagers.every((v) => v.workplace === null)).toBe(true);
    // Фермеру без поля делать нечего: он возвращается к костру.
    expect(jobCounts(s).farmer).toBe(0);
    expect(jobCounts(s).idle).toBe(s.villagers.length - 1);
  });
});

// ---------- Первые пять минут ----------

describe('старт партии', () => {
  it('за пять минут племя куёт копьё, нанимает бойца и не встаёт в тупик', () => {
    const s = createInitialState();
    const food0 = s.resources.food;
    // Игрок делает очевидное: кузнеца к горну, наряд на копьё, бойца в казармы.
    const smithy = buildingOfType(s, 'smithy')!;
    expect(assignWorker(s, smithy.id)).toBeNull();
    expect(setForging(s, 'spear')).toBeNull();
    let recruited = false;
    for (let i = 0; i < 10 && !recruited; i++) {
      catchUp(s, 30, 0.5);
      recruited = startRecruit(s, 'spearman', 1) === null;
    }
    expect(recruited).toBe(true);
    catchUp(s, 5 * DAY_LENGTH - s.time, 0.5);

    expect(armySize(s)).toBe(1);
    expect(s.villagers.length).toBeGreaterThanOrEqual(9);
    expect(s.resources.food).toBeGreaterThan(food0 * 0.5);
    expect(s.resources.wood).toBeGreaterThan(0);
  });
});

// ---------- Сезоны ----------

/** Ставит партию в начало нужного сезона указанного года. */
function atSeason(s: GameState, season: Season, year: number): void {
  s.time = (SEASONS.indexOf(season) + (year - 1) * SEASONS.length) * SEASON_SECONDS;
}

/**
 * Племя середины игры: поля, навесы, мастерская, крыша над головой и дружина.
 * Ставка на земледелие — то самое состояние, ради которого зима и вводится: летом
 * и осенью такое племя кормит себя с запасом, а зимой поля встают. Дружина ест из
 * того же котла: она и делает зиму дырой, которую надо закрывать заранее.
 */
function tribe(pop: number, food: number, wood: number): GameState {
  const s = createInitialState();
  s.army.spearman = 12;
  while (s.villagers.length < pop) addVillager(s, { age: 24, talent: null });
  idleAll(s);
  // Каждого типа по одному: жильё и склад набирают своё уровнями, а не числом срубов.
  place(s, 'hut', Math.max(1, Math.ceil((pop - 9) / 4) + 1));
  place(s, 'storage', 2);
  place(s, 'farm', 2);
  place(s, 'gathering', 2);
  autoAssign(s);
  // Лесоруба нарочно нет: дрова у такого племени только со склада, и зима
  // спрашивает за них так же, как за еду.
  for (const v of s.villagers) if (v.job === 'woodcutter') unassignWorker(s, v.workplace!, v.id);
  // Награды за задания посыпались бы в первый же тик и подменили бы собой запас,
  // а проверяем мы именно запас — поэтому задания считаем уже закрытыми.
  s.completedQuests = QUESTS.map((q) => q.id);
  s.resources.food = food;
  s.resources.wood = wood;
  s.morale = 60;
  return s;
}

/** Снимает одного жителя с работы, откуда бы он ни работал. */
function release(s: GameState, job: JobId): void {
  const v = [...s.villagers].reverse().find((x) => x.job === job);
  if (!v) return;
  if (v.workplace !== null) unassignWorker(s, v.workplace, v.id);
  else changeFreeJob(s, job, -1);
}

/** Ставит человека на работу: место в здании вдвое выгоднее вольного сбора. */
function hire(s: GameState, job: JobId): boolean {
  const b = s.buildings.find(
    (x) => BUILDING_BY_ID[x.type].job === job && x.level > 0 && workerCount(s, x.id) < buildingSlots(x),
  );
  return (b ? assignWorker(s, b.id) : changeFreeJob(s, job, 1)) === null;
}

/** Кого и сколько держать на работах при нынешнем размере племени. */
function wanted(s: GameState): [JobId, number][] {
  const n = s.villagers.length;
  return [
    ['gatherer', Math.max(2, Math.round(n * 0.2))],
    ['woodcutter', Math.max(1, Math.round(n * 0.2))],
    ['hunter', Math.max(1, Math.round(n * 0.15))],
    ['stonecutter', n >= 8 ? Math.max(1, Math.round(n * 0.12)) : 0],
    ['farmer', Math.round(n * 0.15)],
    ['miner', 2],
    ['crafter', 1],
    ['smith', 1],
  ];
}

/**
 * Что улучшать дальше. Всё уже стоит, поэтому очередь всегда занята улучшением:
 * сначала жильё и склад, когда они узкое место, потом самое отстающее здание.
 */
function nextSite(s: GameState): void {
  if (s.buildings.some(isSite)) return;
  // Жильё — узкое место: пока селить некуда, племя не растёт.
  if (s.villagers.length >= housingCapacity(s) - 1) {
    const hut = buildingOfType(s, 'hut')!;
    if (startUpgrade(s, hut.id) === null) return;
  }
  // Что-то упёрлось в потолок склада — поднимаем вместимость.
  const cap = storageCap(s);
  if (RESOURCE_IDS.some((r) => s.resources[r] >= cap - 1)) {
    const st = buildingOfType(s, 'storage')!;
    if (startUpgrade(s, st.id) === null) return;
  }
  // Тянем вверх самое отстающее здание. Не только рабочее: стена и Дом вождя
  // рабочих мест не дают, но без них посёлок не растёт.
  const behind = [...s.buildings].sort((a, b) => a.level - b.level);
  for (const b of behind) if (startUpgrade(s, b.id) === null) return;
}

/** Разумная игра без участия человека: работы, стройка и улучшения. */
function autopilot(s: GameState): void {
  const wants = wanted(s);
  for (const [job, want] of wants) {
    while (jobCounts(s)[job] > want) release(s, job);
  }
  for (const [job, want] of wants) {
    // Двоих всегда держим свободными: стройка идёт их руками.
    while (jobCounts(s)[job] < want && jobCounts(s).idle > 2) {
      if (!hire(s, job)) break;
    }
  }
  nextSite(s);
}

/** Автопилот принимает решения четыре раза в день — иначе очередь стройки простаивает. */
function play(s: GameState, days: number): void {
  const step = DAY_LENGTH / 4;
  for (let i = 0; i < days * 4; i++) {
    autopilot(s);
    catchUp(s, step, 1);
  }
}

describe('сезоны', () => {
  it('год делится на четыре сезона и считается от номера дня', () => {
    const s = createInitialState();
    expect(seasonOf(s.time)).toBe('spring');
    expect(yearOf(s.time)).toBe(1);
    s.time = SEASON_SECONDS * 3;
    expect(seasonOf(s.time)).toBe('winter');
    expect(yearOf(s.time)).toBe(1);
    s.time = SEASON_SECONDS * 4;
    expect(seasonOf(s.time)).toBe('spring');
    expect(yearOf(s.time)).toBe(2);
  });

  it('зима останавливает поля и режет добычу', () => {
    const s = createInitialState();
    idleAll(s);
    const farm = place(s, 'farm');
    assignWorker(s, farm.id);
    atSeason(s, 'summer', 2);
    const summer = productionPerDay(s).food;
    atSeason(s, 'winter', 2);
    const winter = productionPerDay(s).food;
    expect(jobMultiplier(s, 'farmer')).toBe(0);
    expect(winter).toBeLessThan(summer * 0.6);
  });

  it('племя с запасом еды и дров переживает зиму без потерь', () => {
    const s = tribe(12, 400, 200);
    atSeason(s, 'winter', 2);
    const pop = s.villagers.length;
    catchUp(s, SEASON_SECONDS, 1);
    expect(s.villagers.length).toBeGreaterThanOrEqual(pop);
    expect(s.stats.died).toBe(0);
    expect(s.freezing).toBe(0);
    expect(s.morale).toBeGreaterThan(35);
  });

  it('племя без запаса теряет мораль и людей — зима реально опасна', () => {
    const s = tribe(12, 0, 0);
    atSeason(s, 'winter', 2);
    const morale0 = s.morale;
    catchUp(s, SEASON_SECONDS, 1);
    expect(s.villagers.length).toBeLessThan(12);
    expect(s.stats.died).toBeGreaterThan(0);
    // Мораль проседает, но не до нуля: с потерями ртов становится меньше, и племя
    // к концу зимы уже кое-как кормит себя само.
    expect(s.morale).toBeLessThan(morale0 - 5);
    expect(s.log.some((e) => e.text.includes('холод'))).toBe(true);
  });

  it('первая зима мягче последующих', () => {
    const first = tribe(12, 25, 6);
    atSeason(first, 'winter', 1);
    const later = tribe(12, 25, 6);
    atSeason(later, 'winter', 2);
    expect(heatingWoodPerDay(first)).toBeLessThan(heatingWoodPerDay(later));
    expect(foodConsumptionPerDay(first)).toBeLessThan(foodConsumptionPerDay(later));
    catchUp(first, SEASON_SECONDS, 1);
    setRandom(seeded(42));
    catchUp(later, SEASON_SECONDS, 1);
    expect(first.villagers.length).toBeGreaterThanOrEqual(later.villagers.length);
    expect(first.stats.died).toBeLessThanOrEqual(later.stats.died);
    expect(first.morale).toBeGreaterThan(later.morale);
  });

  it('за игровой год население растёт, а не вымирает', () => {
    const s = createInitialState();
    const pop0 = s.villagers.length;
    play(s, YEAR_DAYS);
    expect(yearOf(s.time)).toBe(2);
    expect(s.villagers.length).toBeGreaterThan(pop0);
  });

  it('за три года при разумной игре племя развивается, а не топчется на месте', () => {
    const s = createInitialState();
    play(s, YEAR_DAYS * 3);
    expect(s.villagers.length).toBeGreaterThanOrEqual(18);
    // Развитие идёт уровнями: хижина одна, но выросшая.
    expect(buildingOfType(s, 'hut')!.level).toBeGreaterThanOrEqual(3);
    expect(s.buildings.filter((b) => b.type === 'sawmill')).toHaveLength(1);
    expect(s.stats.born).toBeGreaterThan(s.stats.died);
  });

  it('предупреждение о зиме поднимается за день до неё и считает запасы', () => {
    const s = tribe(12, 25, 6);
    // Конец предпоследнего дня осени второго года.
    s.time = SEASON_SECONDS * 6 + (SEASON_DAYS - 1) * DAY_LENGTH - 1;
    expect(seasonOf(s.time)).toBe('autumn');
    tick(s, 2, { offline: true });
    expect(seasonDayOf(s.time)).toBe(SEASON_DAYS);
    expect(s.winterWarning).toBe(true);

    // Запасов заведомо мало: расчёт должен честно показать, на сколько дней их хватит.
    const f = winterForecast(s);
    expect(f.winterDays).toBe(SEASON_DAYS);
    expect(f.food.drainPerDay).toBeGreaterThan(0);
    expect(f.food.days).toBeCloseTo(f.food.have / f.food.drainPerDay, 5);
    expect(f.food.days).toBeLessThan(SEASON_DAYS);
    expect(f.food.ok).toBe(false);
    expect(f.wood.drainPerDay).toBeGreaterThan(0);
    expect(f.wood.days).toBeLessThan(SEASON_DAYS);

    // Зима началась — устаревшее предупреждение снимается.
    catchUp(s, DAY_LENGTH * 2, 1);
    expect(seasonOf(s.time)).toBe('winter');
    expect(s.winterWarning).toBe(false);
  });
});

// ---------- Обучение ----------

/** Ничего не открыто: обучение смотрит и на интерфейс тоже. */
const UI_NONE: TutorialUi = { building: null, tab: null };

const at = (s: GameState): string => currentStep(s)?.id ?? 'done';

describe('обучение', () => {
  it('новая партия начинается с первого шага', () => {
    const s = createInitialState();
    expect(tutorialActive(s)).toBe(true);
    expect(at(s)).toBe('intro');
  });

  it('каждый шаг — одна короткая строка', () => {
    const s = createInitialState();
    for (const step of TUTORIAL) expect(stepText(step, s).length).toBeLessThanOrEqual(60);
  });

  it('тапом закрывается только шаг без условия', () => {
    const s = createInitialState();
    expect(tapTutorial(s, UI_NONE)).toBe(true);
    expect(at(s)).toBe('campfire');
    // Шаг с условием ждёт настоящего действия — тап по экрану его не проматывает.
    expect(tapTutorial(s, UI_NONE)).toBe(false);
    expect(at(s)).toBe('campfire');
  });

  it('пропуск закрывает обучение с любого шага', () => {
    const s = createInitialState();
    tapTutorial(s, UI_NONE);
    finishTutorial(s);
    expect(tutorialActive(s)).toBe(false);
    expect(currentStep(s)).toBeNull();
    // Повторный досчёт ничего не воскрешает.
    expect(advanceTutorial(s, UI_NONE)).toBe(false);
  });
});

// ---------- Сохранения ----------

describe('сохранения', () => {
  it('сохранение текущего формата читается обратно целиком', () => {
    const s = createInitialState();
    s.gold = 77;
    s.army.legionary = 2;
    const back = deserialize(serialize(s))!;
    expect(back).not.toBeNull();
    expect(back.version).toBe(SAVE_VERSION);
    expect(back.gold).toBe(77);
    expect(back.army.legionary).toBe(2);
    expect(back.buildings.map((b) => b.type).sort()).toEqual(s.buildings.map((b) => b.type).sort());
  });

  it('сохранение старого формата не приводится, а отбрасывается', () => {
    // Партия от костра через эпохи и технологии: к новому старту её не перевести.
    const s = createInitialState();
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    raw.version = 4;
    raw.techs = ['stone_tools'];
    expect(deserialize(JSON.stringify(raw))).toBeNull();
    // Вообще без версии — тоже.
    delete raw.version;
    expect(deserialize(JSON.stringify(raw))).toBeNull();
  });
});
