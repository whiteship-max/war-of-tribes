import { beforeEach, describe, expect, it } from 'vitest';
import type { Building, BuildingTypeId, GameState, JobId, Season, TechId } from '../types';
import { createInitialState } from '../state';
import { catchUp, tick } from './tick';
import { startBuilding, startResearch, startUpgrade, resolveEvent } from './actions';
import { assignWorker, autoAssign, changeFreeJob, normalizeAssignments, unassignWorker } from './workers';
import { addVillager } from './population';
import { seeded, setRandom } from './random';
import {
  buildingOfType,
  buildingSlots,
  builtOfType,
  canAfford,
  countAll,
  countBuilt,
  era,
  ERA_MAX_LEVEL,
  foodConsumptionPerDay,
  hasTech,
  heatingWoodPerDay,
  housingCapacity,
  isSite,
  jobCounts,
  jobMultiplier,
  levelOutputMult,
  maxLevelFor,
  productionPerDay,
  researchRate,
  seasonDayOf,
  seasonOf,
  storageCap,
  upgradeInfo,
  winterForecast,
  workerCount,
  workersIn,
  yearOf,
} from '../derived';
import { BASE_STORAGE_CAP, DAY_LENGTH, MAX_BUILDING_LEVEL, RESOURCE_IDS } from '../constants';
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

beforeEach(() => setRandom(seeded(42)));

/**
 * Ставит готовое здание нужного уровня — короче, чем прогонять стройку.
 * Тип в посёлке один, поэтому повторный вызов не плодит копии, а задаёт уровень.
 */
function place(s: GameState, type: BuildingTypeId, level = 1): Building {
  const exist = s.buildings.find((b) => b.type === type);
  if (exist) {
    exist.level = level;
    exist.work = 0;
    exist.workRequired = 0;
    return exist;
  }
  const b: Building = { id: s.nextId++, type, slot: s.nextId, level, work: 0, workRequired: 0 };
  s.buildings.push(b);
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
  it('стартовое состояние: 5 жителей, костёр, укрытия и склад', () => {
    const s = createInitialState();
    expect(s.villagers).toHaveLength(5);
    expect(s.buildings.map((b) => b.type)).toEqual(['campfire', 'shelter', 'storage']);
    expect(s.buildings.every((b) => b.level === 1)).toBe(true);
    expect(housingCapacity(s)).toBe(5);
  });

  it('стартовых ресурсов хватает на лесопилку — третий шаг обучения выполним', () => {
    const s = createInitialState();
    expect(canAfford(s, BUILDING_BY_ID.sawmill.cost)).toBe(true);
    expect(startBuilding(s, 'sawmill')).toBeNull();
  });

  it('работники производят ресурсы, жители едят', () => {
    const s = createInitialState();
    const wood0 = s.resources.wood;
    catchUp(s, DAY_LENGTH, 0.5);
    expect(s.resources.wood).toBeGreaterThan(wood0);
    // Один лесоруб вольным сбором: 6 в день вполсилы, ещё и с поправкой на мораль.
    expect(s.resources.wood - wood0).toBeGreaterThan(1.5);
    expect(s.resources.wood - wood0).toBeLessThan(4.5);
  });

  it('свободные жители строят лесопилку', () => {
    const s = createInitialState();
    expect(startBuilding(s, 'sawmill')).toBeNull();
    expect(s.resources.wood).toBe(14);
    catchUp(s, 14, 0.5); // 2 свободных × 14 сек = 28 > 25
    expect(countBuilt(s, 'sawmill')).toBe(1);
  });

  it('нельзя построить без ресурсов', () => {
    const s = createInitialState();
    s.resources.wood = 0;
    expect(startBuilding(s, 'hut')).toMatch(/Не хватает/);
  });

  it('исследование завершается', () => {
    const s = createInitialState();
    expect(startResearch(s, 'stone_tools')).toBeNull();
    catchUp(s, 120, 0.5);
    expect(hasTech(s, 'stone_tools')).toBe(true);
    expect(startResearch(s, 'bows')).toMatch(/Сначала/);
  });

  it('голод убивает жителя', () => {
    const s = createInitialState();
    s.resources.food = 0;
    for (const v of s.villagers) {
      v.job = 'woodcutter';
      v.workplace = null;
    }
    catchUp(s, DAY_LENGTH * 5, 1);
    expect(s.villagers.length).toBeLessThan(5);
  });

  it('население растёт при наличии жилья и еды', () => {
    const s = createInitialState();
    s.resources.food = 100;
    place(s, 'hut');
    catchUp(s, 200, 1);
    expect(s.villagers.length).toBeGreaterThan(5);
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
    s.techs.push('farming');
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
    expect(jobCounts(s).idle).toBe(5);
  });

  it('улучшение выше предела эпохи запрещено', () => {
    const s = createInitialState();
    s.resources.wood = 500;
    s.resources.stone = 500;
    const mill = place(s, 'sawmill', 2);
    expect(era(s)).toBe('camp');
    expect(upgradeInfo(s, mill).maxLevel).toBe(2);
    expect(startUpgrade(s, mill.id)).toMatch(/Эпоха/);

    // Каменный век поднимает потолок до третьего уровня.
    s.techs.push('stone_tools');
    expect(era(s)).toBe('stone');
    expect(startUpgrade(s, mill.id)).toBeNull();
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

  it('хранилище знаний ускоряет исследования вдвое против костра', () => {
    const s = createInitialState();
    const atFire = researchRate(s);
    place(s, 'knowledge');
    const atHouse = researchRate(s);
    expect(atFire).toBeGreaterThan(0);
    expect(atHouse).toBeCloseTo(atFire * 2, 6);
  });

  it('второго здания того же типа не бывает', () => {
    const s = createInitialState();
    s.resources.wood = 500;
    s.resources.stone = 500;
    expect(startBuilding(s, 'sawmill')).toBeNull();
    // Второй раз — ни пока строится, ни когда достроена.
    expect(startBuilding(s, 'sawmill')).toMatch(/уже есть/);
    catchUp(s, 60, 1);
    expect(countBuilt(s, 'sawmill')).toBe(1);
    expect(startBuilding(s, 'sawmill')).toMatch(/уже есть/);
    expect(countAll(s, 'sawmill')).toBe(1);
    // Склад стоит с первого дня — второго тоже не будет.
    expect(startBuilding(s, 'storage')).toMatch(/уже есть/);
    expect(startBuilding(s, 'campfire')).toMatch(/нельзя построить/);
  });

  it('улучшение не отключает здание: рабочие на местах, выработка не падает', () => {
    const s = createInitialState();
    idleAll(s);
    s.techs.push('stone_tools');
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
    s.techs.push('stone_tools');
    s.resources.wood = 4000;
    s.resources.stone = 4000;
    const hut = place(s, 'hut', 1);
    const housing0 = housingCapacity(s);
    expect(startUpgrade(s, hut.id)).toBeNull();
    catchUp(s, 200, 1);
    expect(hut.level).toBe(2);
    expect(housingCapacity(s) - housing0).toBe(BUILDING_BY_ID.hut.perLevel?.housing);

    const store = builtOfType(s, 'storage')!;
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
    s.techs.push('housing');
    for (const def of BUILDINGS) place(s, def.id, def.maxLevel ?? MAX_BUILDING_LEVEL);
    // Раннее государство: 40+ человек под крышей одной хижины и одного укрытия.
    const housing = housingCapacity(s);
    expect(housing).toBeGreaterThanOrEqual(40);
    expect(ERA_MAX_LEVEL.state).toBe(MAX_BUILDING_LEVEL);

    // Пять зданий добычи можно укомплектовать целиком — это и есть рабочее ядро посёлка.
    const core: BuildingTypeId[] = ['gathering', 'sawmill', 'quarry', 'hunter_hut', 'farm'];
    const coreSlots = core.reduce((n, t) => n + buildingSlots(builtOfType(s, t)!), 0);
    expect(coreSlots).toBeLessThanOrEqual(housing);
    // Всех мест разом больше, чем людей — но не в разы: выбор есть, абсурда нет.
    const allSlots = s.buildings.reduce((n, b) => n + buildingSlots(b), 0);
    expect(allSlots).toBeGreaterThan(housing);
    expect(allSlots).toBeLessThanOrEqual(housing * 2.5);
  });

  it('исчезнувшее здание не оставляет висячих рабочих', () => {
    const s = createInitialState();
    idleAll(s);
    s.techs.push('farming');
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
    expect(jobCounts(s).idle).toBe(4);
  });
});

// ---------- Первые пять минут ----------

describe('старт партии', () => {
  it('за пять минут племя ставит лесопилку и хранилище знаний и не встаёт в тупик', () => {
    const s = createInitialState();
    const food0 = s.resources.food;
    // Игрок делает очевидное: сначала лесопилка, потом хранилище знаний.
    expect(startBuilding(s, 'sawmill')).toBeNull();
    catchUp(s, 30, 0.5);
    const mill = s.buildings.find((b) => b.type === 'sawmill')!;
    expect(mill.level).toBe(1);
    // Лесоруб переезжает с вольного сбора на лесопилку.
    changeFreeJob(s, 'woodcutter', -1);
    expect(assignWorker(s, mill.id)).toBeNull();

    // Копим на хранилище знаний и ставим его.
    let placed = false;
    for (let i = 0; i < 5 && !placed; i++) {
      catchUp(s, 30, 0.5);
      placed = startBuilding(s, 'knowledge') === null;
    }
    expect(placed).toBe(true);
    catchUp(s, 5 * DAY_LENGTH - s.time, 0.5);

    expect(countBuilt(s, 'sawmill')).toBe(1);
    expect(countBuilt(s, 'knowledge')).toBe(1);
    expect(s.villagers.length).toBeGreaterThanOrEqual(5);
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
 * Племя середины игры: поля, навесы, мастерская, крыша над головой. Ставка на земледелие —
 * то самое состояние, ради которого зима и вводится: летом и осенью такое племя
 * кормит себя с запасом, а зимой поля встают.
 */
function tribe(pop: number, food: number, wood: number): GameState {
  const s = createInitialState();
  s.techs.push('farming');
  while (s.villagers.length < pop) addVillager(s, { age: 24, talent: null });
  idleAll(s);
  // Каждого типа по одному: жильё и склад набирают своё уровнями, а не числом срубов.
  place(s, 'hut', Math.max(1, Math.ceil((pop - 9) / 4) + 1));
  place(s, 'storage', 2);
  place(s, 'farm', 2);
  place(s, 'gathering', 2);
  place(s, 'hunter_hut', 1);
  place(s, 'sawmill', 1);
  place(s, 'workshop', 1);
  autoAssign(s);
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

/** Порядок исследований — как их брал бы игрок, ведущий племя к государству. */
const TECH_ORDER: TechId[] = [
  'stone_tools',
  'chiefdom',
  'woodworking',
  'bone_tools',
  'housing',
  'farming',
  'spears',
  'bows',
  'shields',
  'metallurgy',
  'totem',
  'shamanism',
  'leatherworking',
  'bronze_weapons',
  'iron_working',
  'traditions',
  // Эпоха теперь двигается только знаниями: без «Установлений» государства не будет.
  'statehood',
  'palisade',
];

/** Порядок построек. Каждая ставится ровно один раз, дальше растёт уровнями. */
const BUILD_ORDER: BuildingTypeId[] = [
  'sawmill',
  'gathering',
  'hut',
  'hunter_hut',
  'quarry',
  'knowledge',
  'chief_house',
  'workshop',
  'farm',
  'mine',
  'smithy',
  'totem',
  'palisade',
];

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
    ['farmer', hasTech(s, 'farming') ? Math.round(n * 0.15) : 0],
    ['miner', countBuilt(s, 'mine') > 0 ? 2 : 0],
    ['scholar', countBuilt(s, 'knowledge') > 0 ? 1 : 0],
    ['crafter', countBuilt(s, 'workshop') > 0 ? 1 : 0],
    ['smith', countBuilt(s, 'smithy') > 0 ? 1 : 0],
  ];
}

/**
 * Что строить дальше. Развитие идёт уровнями, поэтому «построить нечего» больше не
 * значит «делать нечего»: очередь всегда занята либо новым типом, либо улучшением.
 */
function nextSite(s: GameState): void {
  if (s.buildings.some(isSite)) return;
  // Жильё — узкое место: пока селить некуда, племя не растёт.
  if (s.villagers.length >= housingCapacity(s) - 1) {
    const hut = buildingOfType(s, 'hut');
    if (!hut ? startBuilding(s, 'hut') === null : startUpgrade(s, hut.id) === null) return;
  }
  // Что-то упёрлось в потолок склада — поднимаем вместимость.
  const cap = storageCap(s);
  if (RESOURCE_IDS.some((r) => s.resources[r] >= cap - 1)) {
    const st = buildingOfType(s, 'storage');
    if (st && startUpgrade(s, st.id) === null) return;
  }
  for (const type of BUILD_ORDER) {
    if (countAll(s, type) === 0 && startBuilding(s, type) === null) return;
  }
  // Всё поставлено — тянем вверх самое отстающее рабочее здание.
  const behind = s.buildings
    .filter((b) => b.level > 0 && BUILDING_BY_ID[b.type].job)
    .sort((a, b) => a.level - b.level);
  for (const b of behind) if (startUpgrade(s, b.id) === null) return;
  const storage = buildingOfType(s, 'storage');
  if (storage) startUpgrade(s, storage.id);
}

/** Разумная игра без участия человека: исследования, работы, стройка и улучшения. */
function autopilot(s: GameState): void {
  if (!s.research) {
    for (const id of TECH_ORDER) if (!hasTech(s, id) && startResearch(s, id) === null) break;
  }
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

  it('зима останавливает поля и режет добычу, но ускоряет исследования', () => {
    const s = createInitialState();
    s.techs.push('farming');
    idleAll(s);
    const farm = place(s, 'farm');
    assignWorker(s, farm.id);
    atSeason(s, 'summer', 2);
    const summer = { food: productionPerDay(s).food, research: researchRate(s) };
    atSeason(s, 'winter', 2);
    const winter = { food: productionPerDay(s).food, research: researchRate(s) };
    expect(jobMultiplier(s, 'farmer')).toBe(0);
    expect(winter.food).toBeLessThan(summer.food * 0.6);
    expect(winter.research).toBeGreaterThan(summer.research);
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
    expect(s.morale).toBeLessThan(morale0 - 20);
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
    play(s, YEAR_DAYS);
    expect(yearOf(s.time)).toBe(2);
    expect(s.villagers.length).toBeGreaterThan(5);
  });

  it('за три года при разумной игре племя развивается, а не топчется на месте', () => {
    const s = createInitialState();
    play(s, YEAR_DAYS * 3);
    expect(s.villagers.length).toBeGreaterThanOrEqual(12);
    // Развитие идёт уровнями: хижина одна, но выросшая.
    expect(builtOfType(s, 'hut')?.level ?? 0).toBeGreaterThanOrEqual(3);
    expect(countBuilt(s, 'sawmill')).toBe(1);
    expect(countAll(s, 'sawmill')).toBe(1);
    expect(s.stats.born).toBeGreaterThan(s.stats.died);
  });

  it('разумная партия доходит до последней эпохи и упирается в потолок жилья', () => {
    const s = createInitialState();
    finishTutorial(s);
    // Автопилот доходит до государства к третьему году; шесть лет — с запасом.
    play(s, YEAR_DAYS * 6);
    expect(era(s)).toBe('state');
    expect(s.villagers.length).toBeGreaterThanOrEqual(40);
    expect(housingCapacity(s)).toBeGreaterThanOrEqual(40);
    // Каждого типа по одному: развитие всю партию шло уровнями.
    for (const b of s.buildings) expect(countAll(s, b.type)).toBe(1);
    expect(builtOfType(s, 'hut')!.level).toBeGreaterThanOrEqual(8);
    expect(maxLevelFor(s, 'hut')).toBe(MAX_BUILDING_LEVEL);
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
    const withMill = createInitialState();
    place(withMill, 'sawmill');
    for (const step of TUTORIAL) {
      expect(stepText(step, s).length).toBeLessThanOrEqual(60);
      expect(stepText(step, withMill).length).toBeLessThanOrEqual(60);
    }
  });

  it('тапом закрывается только шаг без условия', () => {
    const s = createInitialState();
    expect(tapTutorial(s, UI_NONE)).toBe(true);
    expect(at(s)).toBe('campfire');
    // Шаг с условием ждёт настоящего действия — тап по экрану его не проматывает.
    expect(tapTutorial(s, UI_NONE)).toBe(false);
    expect(at(s)).toBe('campfire');
  });

  it('шаг закрывается по факту: лесопилку поставили до просьбы', () => {
    const s = createInitialState();
    const campfire = s.buildings.find((b) => b.type === 'campfire')!;
    tapTutorial(s, UI_NONE);
    advanceTutorial(s, { building: campfire.id, tab: null });
    expect(at(s)).toBe('open_build');
    // Игрок сам нашёл стройку и поставил лесопилку — оба шага про неё снимаются разом.
    expect(startBuilding(s, 'sawmill')).toBeNull();
    advanceTutorial(s, UI_NONE);
    expect(at(s)).toBe('open_sawmill');
  });

  it('весь путь проходится действиями игрока и заканчивается сам', () => {
    const s = createInitialState();
    const campfire = s.buildings.find((b) => b.type === 'campfire')!;
    const storage = s.buildings.find((b) => b.type === 'storage')!;

    expect(at(s)).toBe('intro');
    tapTutorial(s, UI_NONE);
    expect(at(s)).toBe('campfire');

    advanceTutorial(s, { building: campfire.id, tab: null });
    expect(at(s)).toBe('open_build');

    advanceTutorial(s, { building: null, tab: 'build' });
    expect(at(s)).toBe('build_sawmill');

    expect(startBuilding(s, 'sawmill')).toBeNull();
    advanceTutorial(s, { building: null, tab: 'build' });
    expect(at(s)).toBe('open_sawmill');

    const mill = s.buildings.find((b) => b.type === 'sawmill')!;
    advanceTutorial(s, { building: mill.id, tab: null });
    expect(at(s)).toBe('assign');

    // Лесопилка достраивается свободными жителями — слот появляется сам.
    catchUp(s, 30, 0.5);
    expect(mill.level).toBe(1);
    expect(assignWorker(s, mill.id)).toBeNull();
    advanceTutorial(s, { building: mill.id, tab: null });
    expect(at(s)).toBe('storage');

    advanceTutorial(s, { building: storage.id, tab: null });
    expect(at(s)).toBe('winter');

    tapTutorial(s, UI_NONE);
    expect(s.tutorialDone).toBe(true);
    expect(currentStep(s)).toBeNull();
    expect(tutorialActive(s)).toBe(false);
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

  it('старое сохранение не начинает обучение заново', () => {
    const s = createInitialState();
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    delete raw.tutorialStep;
    delete raw.tutorialDone;
    const back = deserialize(JSON.stringify(raw))!;
    expect(back).not.toBeNull();
    expect(back.tutorialDone).toBe(true);
    expect(tutorialActive(back)).toBe(false);
  });
});

// ---------- Миграция сохранений ----------

describe('миграция сохранений', () => {
  /** Сохранение старого формата: типов было по нескольку штук. */
  const oldSave = (buildings: Partial<Building>[], version = 2): string => {
    const s = createInitialState();
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    raw.version = version;
    raw.buildings = buildings.map((b, i) => ({
      id: i + 1,
      slot: -1,
      level: 1,
      work: 0,
      workRequired: 0,
      ...b,
    }));
    return JSON.stringify(raw);
  };

  it('три хижины сводятся в одну и вместимость не теряется', () => {
    const back = deserialize(
      oldSave([
        { type: 'campfire' },
        { type: 'shelter' },
        { type: 'shelter' },
        { type: 'storage' },
        { type: 'hut' },
        { type: 'hut' },
        { type: 'hut' },
      ]),
    );
    expect(back).not.toBeNull();
    const s = back!;
    for (const b of s.buildings) expect(countAll(s, b.type)).toBe(1);
    // Уровень — сумма уровней слитых построек.
    expect(builtOfType(s, 'hut')!.level).toBe(3);
    // Старый формат давал 3 хижины по 3 места, 2 укрытия по 2 и базовое место — 14.
    expect(housingCapacity(s)).toBeGreaterThanOrEqual(14);
    // И игрок об этом узнаёт: прогресс не исчезает молча.
    expect(s.log.some((e) => e.text.includes('свели в одну'))).toBe(true);
  });

  it('уровни складов складываются, а потолок типа не превышается', () => {
    const back = deserialize(
      oldSave([
        { type: 'campfire' },
        { type: 'shelter', level: 1 },
        { type: 'shelter', level: 1 },
        { type: 'storage', level: 5 },
        { type: 'storage', level: 4 },
        { type: 'storage', level: 4 },
      ]),
    );
    const s = back!;
    // 5 + 4 + 4 = 13, но выше десятого уровня склад не поднимается.
    expect(builtOfType(s, 'storage')!.level).toBe(MAX_BUILDING_LEVEL);
    // Укрытие не улучшается вовсе — два укрытия дают одно первого уровня.
    expect(builtOfType(s, 'shelter')!.level).toBe(1);
    expect(storageCap(s)).toBeGreaterThan(BASE_STORAGE_CAP);
  });

  it('недостроенные копии сливаются в одну стройку', () => {
    const back = deserialize(
      oldSave([
        { type: 'campfire' },
        { type: 'storage' },
        { type: 'hut', level: 0, work: 5, workRequired: 30 },
        { type: 'hut', level: 0, work: 21, workRequired: 30 },
      ]),
    );
    const s = back!;
    const hut = buildingOfType(s, 'hut')!;
    expect(countAll(s, 'hut')).toBe(1);
    expect(hut.level).toBe(0);
    // Берём ту стройку, что продвинулась дальше.
    expect(hut.work).toBe(21);
  });

  it('сохранение первой версии доходит до текущего формата', () => {
    const back = deserialize(
      oldSave([{ type: 'campfire' }, { type: 'shelter' }, { type: 'storage' }, { type: 'hut' }, { type: 'hut' }], 1),
    );
    const s = back!;
    expect(s.version).toBe(SAVE_VERSION);
    expect(countAll(s, 'hut')).toBe(1);
    expect(builtOfType(s, 'hut')!.level).toBe(2);
    // Жители не остались привязанными к исчезнувшим зданиям.
    for (const v of s.villagers) {
      if (v.workplace !== null) expect(s.buildings.some((b) => b.id === v.workplace)).toBe(true);
    }
  });
});
