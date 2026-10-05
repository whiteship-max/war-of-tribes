import { beforeEach, describe, expect, it } from 'vitest';
import type { Building, BuildingTypeId, GameState, JobId, Season } from '../types';
import { createInitialState } from '../state';
import { catchUp, liveStep, tick } from './tick';
import { AWAY_STEP, awayArrival } from './mail';
import { startUpgrade, resolveEvent, setTax } from './actions';
import { applyExpedition, sackOutskirts } from './expedition';
import { throwFeast } from './actions';
import { assignWorker, changeFreeJob, normalizeAssignments, unassignWorker } from './workers';
import { popGrowth } from './population';
import { plunder } from '@/world/spoils';
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
  cavalryTrain,
  feastInfo,
  feastMorale,
  healShare,
  infirmaryBeds,
  hiddenStash,
  idleCount,
  intelKeen,
  stalls,
  recruitRate,
  warningSeconds,
  idleCount as _idleCount,
  isOutsideWall,
  moraleTarget,
  storageCap,
  winterForecast,
  workerCount,
  yearOf,
} from '../derived';
import {
  DAY_LENGTH,
  INFIRMARY_HEAL_CAP,
  MAX_BUILDING_LEVEL,
  MORALE_GROWTH_ZERO,
  RESOURCE_IDS,
  SLOTS_PER_LEVEL,
} from '../constants';
import { playerProfile } from '@/world/bridge';
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
import { startForge } from './smithy';
import { startRecruit } from './army';
import { study } from './tech';

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
  s.workers = {};
  s.freeJobs = {};
}

describe('сохранение и набор зданий', () => {
  it('здание, добавленное после записи сохранения, появляется в посёлке само', () => {
    const s = createInitialState();
    // Сохранение, записанное до того, как в игру добавили трактир и статую.
    const older = { ...s, buildings: s.buildings.filter((b) => b.type !== 'tavern' && b.type !== 'statue') };
    const back = deserialize(JSON.stringify(older))!;
    expect(back).not.toBeNull();
    expect(back.buildings.map((b) => b.type).sort()).toEqual(BUILDINGS.map((d) => d.id).sort());
    expect(buildingOfType(back, 'tavern')!.level).toBe(1);
    // Уровни уже стоявших зданий не сбрасываются.
    const grown = { ...s, buildings: s.buildings.map((b) => ({ ...b, level: 4 })).filter((b) => b.type !== 'watch') };
    const kept = deserialize(JSON.stringify(grown))!;
    expect(buildingOfType(kept, 'houses')!.level).toBe(4);
    expect(buildingOfType(kept, 'watch')!.level).toBe(1);
  });
});

describe('службы посёлка', () => {
  /** Ставит одно здание нужного уровня, остальное оставляет как в новой партии. */
  const withLevel = (type: BuildingTypeId, level: number): GameState => {
    const s = createInitialState();
    place(s, type, level);
    return s;
  };

  it('лазарет кладёт часть павших ранеными, но война не дешевеет до нуля', () => {
    for (const level of [1, 5, 10]) {
      const s = withLevel('infirmary', level);
      // Потолок обязателен: без него победа с непомерными потерями перестала бы
      // быть непомерной, а отказ от боя — иметь смысл.
      expect(healShare(s)).toBeLessThanOrEqual(INFIRMARY_HEAL_CAP);
      expect(healShare(s)).toBeGreaterThan(0);
    }
    expect(healShare(withLevel('infirmary', 10))).toBeGreaterThan(healShare(withLevel('infirmary', 1)));

    const s = withLevel('infirmary', 10);
    s.army.clubman = 100;
    const pop = s.pop;
    applyExpedition(s, {
      warriorsLost: 100,
      scoutsLost: 0,
      resources: {},
      gold: 0,
      prestige: 0,
      morale: 0,
      battle: 'lost',
      text: 'Отряд разбит.',
      kind: 'bad',
    });
    // Раненые лежат в лазарете и встанут бойцами (`sim/infirmary`), а не жителями: посёлок не растёт.
    expect(s.pop).toBe(pop);
    expect(s.army.clubman).toBe(0);
    const laid = s.wounded.reduce((n, g) => n + (g.troops.clubman ?? 0), 0);
    expect(laid).toBe(Math.min(Math.round(100 * healShare(s)), infirmaryBeds(s)));
    expect(laid).toBeGreaterThan(0);
    expect(s.stats.died).toBe(100 - laid);
  });

  it('без лазарета из боя не возвращается никто', () => {
    const s = createInitialState();
    s.buildings = s.buildings.filter((b) => b.type !== 'infirmary');
    s.army.clubman = 40;
    const pop = s.pop;
    applyExpedition(s, {
      warriorsLost: 40, scoutsLost: 0, resources: {}, gold: 0, prestige: 0, morale: 0,
      battle: 'lost', text: '', kind: 'bad',
    });
    expect(s.pop).toBe(pop);
    expect(s.stats.died).toBe(40);
  });

  it('дозор растит и стойкость разведданных, и запас времени до набега', () => {
    expect(intelKeen(withLevel('watch', 1))).toBeLessThan(intelKeen(withLevel('watch', 10)));
    expect(warningSeconds(withLevel('watch', 1))).toBeLessThan(warningSeconds(withLevel('watch', 10)));
    // Правило, которое нельзя нарушать: предупреждение длиннее потолка сбора дружины.
    // Дозор время только прибавляет — база уже больше потолка сбора (см. worldscale.test).
    expect(warningSeconds(withLevel('watch', 1))).toBeGreaterThan(0);
  });

  it('конюшня учит конницу, открывает тяжёлую с четвёртого уровня и держит стойла', () => {
    const s = withLevel('stable', 10);
    place(s, 'barracks', 10);
    // Формула одна, уровень свой: при равных уровнях конница учится на множитель конюшни быстрее.
    expect(recruitRate(s, 'rider')).toBeCloseTo(recruitRate(s, 'clubman') * cavalryTrain(s), 6);
    // Пеший вид от конюшни не ускоряется ни на волос: его учат казармы.
    const plain = withLevel('stable', 1);
    place(plain, 'barracks', 10);
    expect(recruitRate(s, 'clubman')).toBe(recruitRate(plain, 'clubman'));
    expect(cavalryTrain(s)).toBeGreaterThan(1);
    // А конница от уровня казарм — ни на волос: её учит конюшня.
    expect(recruitRate(plain, 'rider')).toBeLessThan(recruitRate(s, 'rider'));

    // Стойла — работа уровня. Открытия тяжёлой конницы у конюшни больше нет: её открывает
    // доспех в военной ветви, и второй двери к одному открытию быть не может (решение
    // владельца 3); держит это `sim/tech.test.ts`, «одна дверь к тяжёлой коннице».
    expect(stalls(withLevel('stable', 10))).toBeGreaterThan(stalls(withLevel('stable', 1)));
  });

  it('тайник едет в мир числом, а вычитает его общее правило дележа', () => {
    const s = withLevel('cache', 10);
    for (const r of RESOURCE_IDS) s.resources[r] = 10_000;
    const stash = hiddenStash(s);
    expect(stash).toBeGreaterThan(0);
    const profile = playerProfile(s);
    // В слепок едет весь склад и вместимость тайника рядом. Заранее вычитать
    // одно из другого нельзя: делит добычу одна функция на обе стороны, и она
    // должна получить те же два числа и у игрока, и у бота.
    expect(profile.stash).toBe(stash);
    for (const r of RESOURCE_IDS) expect(profile.stock[r]).toBe(10_000);
    // Унести можно всё, кроме спрятанного, — при неограниченном обозе ровно это.
    const spoils = plunder(profile.stock, profile.stash, Infinity);
    for (const r of RESOURCE_IDS) expect(spoils.taken[r]).toBe(10_000 - stash);
    // Запас меньше тайника унести нельзя вовсе.
    const small = plunder({ iron: stash - 10 }, stash, Infinity);
    expect(small.takenTotal).toBe(0);
    expect(small.hiddenTotal).toBe(stash - 10);
    expect(hiddenStash(withLevel('cache', 1))).toBeLessThan(stash);
  });

  it('платят из всего склада, включая тайник: `stock` — то же число, что в полоске ресурсов', () => {
    const s = withLevel('cache', 10);
    for (const r of RESOURCE_IDS) s.resources[r] = 10_000;
    const profile = playerProfile(s);
    // Тайник прячет добро от чужаков, а не от вождя: дань и выкуп платят из
    // всего склада. И это же число стоит в полоске ресурсов наверху экрана,
    // поэтому «нужно / из» и гаснущая кнопка обязаны считать по нему.
    for (const r of RESOURCE_IDS) {
      expect(profile.stock?.[r]).toBe(Math.floor(s.resources[r]));
      expect(profile.stash).toBeGreaterThan(0);
    }
  });

  it('пир поднимает мораль, стоит золота по числу ртов и упирается в откат', () => {
    const s = withLevel('tavern', 1);
    s.gold = 10_000;
    const before = feastInfo(s);
    expect(before.blocked).toBeNull();
    expect(before.cost).toBeGreaterThan(0);

    expect(throwFeast(s)).toBeNull();
    expect(s.gold).toBe(10_000 - before.cost);
    expect(feastMorale(s)).toBe(before.bonus);
    // Второй раз подряд — нельзя, и панель об этом говорит.
    expect(throwFeast(s)).not.toBeNull();

    // Цена растёт с посёлком: пир на семьсот ртов дороже пира на тридцать.
    const big = withLevel('tavern', 1);
    big.pop = 700;
    expect(feastInfo(big).cost).toBeGreaterThan(before.cost * 10);

    // Уровень делает пир крепче, а откат короче.
    const top = withLevel('tavern', 10);
    top.gold = 10_000;
    expect(feastInfo(top).bonus).toBeGreaterThan(before.bonus);
    throwFeast(top);
    const cheap = withLevel('tavern', 1);
    cheap.gold = 10_000;
    throwFeast(cheap);
    // Через шесть дней трактир десятого уровня уже наливает, а первого — ещё нет.
    cheap.time = top.time = 6 * DAY_LENGTH;
    expect(feastInfo(top).cooldown).toBeLessThan(feastInfo(cheap).cooldown);
    expect(feastInfo(top).cooldown).toBe(0);
  });

  it('пир не переполняет шкалу морали: он ложится после приведения к сотне', () => {
    const s = withLevel('tavern', 10);
    // Довольное племя на потолке шкалы: пир не должен дать ни одного очка сверх.
    // Без налога: умеренный новой партии снял бы с цели восемь очков, и точка
    // оказалась бы ниже потолка — вне области правила.
    s.tax = 'none';
    for (const b of s.buildings) b.level = 10;
    s.resources.food = 100_000;
    s.gold = 10_000;
    const full = moraleTarget(s);
    throwFeast(s);
    expect(moraleTarget(s)).toBe(full);
    expect(moraleTarget(s)).toBeLessThanOrEqual(100);

    // А просевшую мораль пир отыгрывает — ради этого он и есть.
    const taxed = withLevel('tavern', 10);
    for (const b of taxed.buildings) b.level = 10;
    taxed.resources.food = 100_000;
    taxed.gold = 10_000;
    setTax(taxed, 'high');
    const low = moraleTarget(taxed);
    throwFeast(taxed);
    expect(moraleTarget(taxed)).toBeGreaterThan(low);
  });
});

describe('герой', () => {
  const withLevel = (type: BuildingTypeId, level: number): GameState => {
    const s = createInitialState();
    place(s, type, level);
    return s;
  };

  it('герой — это полководец: имя у него одно, и людей в бой он не приводит', () => {
    const s = createInitialState();
    // Имя даёт вера, а её называет мир первым пульсом: до него имени нет и взять его неоткуда.
    expect(s.agents.general.name).toBeNull();
    s.faith.id = 'orthodox';
    tick(s, 1);
    expect(s.agents.general.name?.length ?? 0).toBeGreaterThan(3);
    expect('hero' in s, 'второго героя рядом с полководцем нет').toBe(false);
    // Прибавки героя больше нет (поставка 1 боя, docs/battle_eu4.md, 14.19.6): у Статуи одно число —
    // терпение войска, — и людей из ниоткуда она в бой не приводит.
    expect(Object.keys(BUILDING_BY_ID.statue.perLevel ?? {})).toEqual(['loyalty']);
    // Статуя не источник морали: их в посёлке и так четыре.
    expect(BUILDING_BY_ID.statue.morale ?? 0).toBe(0);
    expect(BUILDING_BY_ID.statue.perLevel?.morale ?? 0).toBe(0);
  });

  it('проигранный бой своего срока «ранен» герою не ставит: жив ли он, решает мир — он и есть полководец', () => {
    const s = withLevel('statue', 3);
    s.army.clubman = 10;
    applyExpedition(s, {
      warriorsLost: 10, scoutsLost: 0, resources: {}, gold: 0, prestige: 0, morale: -5,
      battle: 'lost', text: 'Отряд разбит.', kind: 'bad',
    });
    expect(s.agents.general.vacant, 'без вести о гибели он в строю').toBe(false);
    // Весть о гибели — одна дверь на полководца и героя.
    applyExpedition(s, {
      warriorsLost: 0, scoutsLost: 0, resources: {}, gold: 0, prestige: 0, morale: -4,
      battle: null, text: '', kind: 'bad',
      fell: { agent: 'general', person: 0, peril: 0.25, where: 'под Логовом', why: [] },
    });
    expect(s.agents.general.vacant).toBe(true);
  });

  it('победа героя не калечит', () => {
    const s = withLevel('statue', 3);
    s.army.clubman = 10;
    applyExpedition(s, {
      warriorsLost: 2, scoutsLost: 0, resources: { wood: 40 }, gold: 0, prestige: 3, morale: 2,
      battle: 'won', text: 'Победа.', kind: 'good',
    });
    expect(s.agents.general.vacant).toBe(false);
  });
});

describe('стена и хозяйство за ней', () => {
  it('снаружи стоит ровно производство, и план поселения говорит то же самое', () => {
    expect(BUILDINGS.map((d) => d.id).filter(isOutsideWall).sort()).toEqual(
      ['farm', 'gathering', 'hunter_hut', 'mine', 'pen', 'quarry', 'sawmill'].sort(),
    );
    // Внутри — жильё, власть, склад, ремесло и оборона: до них набег не доходит.
    for (const type of ['houses', 'town_hall', 'storage', 'smithy', 'workshop', 'barracks', 'market', 'church', 'palisade', 'tower'] as BuildingTypeId[]) {
      expect(isOutsideWall(type), `${type} не должен стоять за стеной`).toBe(false);
    }
  });

  it('набег разоряет дворы за стеной и не трогает ничего внутри', () => {
    const s = createInitialState();
    idleAll(s);
    for (const b of s.buildings) {
      b.level = 5;
      s.workers[b.id] = 4;
    }
    s.pop = 200;
    const before = new Map(s.buildings.map((b) => [b.id, { level: b.level, men: workerCount(s, b.id) }]));

    const names = sackOutskirts(s, 1);
    expect(names.length, 'разор должен быть назван поимённо').toBeGreaterThan(0);

    let touched = 0;
    let burned = 0;
    for (const b of s.buildings) {
      const was = before.get(b.id)!;
      if (isOutsideWall(b.type)) {
        if (workerCount(s, b.id) !== was.men) touched++;
        if (b.level !== was.level) burned++;
        expect(b.level, `${b.type} нельзя снести набегом`).toBeGreaterThanOrEqual(1);
      } else {
        expect(workerCount(s, b.id), `${b.type} за стеной, его трогать нельзя`).toBe(was.men);
        expect(b.level, `${b.type} за стеной, уровень терять не должен`).toBe(was.level);
      }
    }
    // Три двора встали. Уровня набег здесь не снимает: у падения уровней один
    // источник — участь взятого города (`fallBuildings`), и он же знает, какие
    // постройки и насколько. Прежде самый людный двор терял уровень и здесь.
    expect(touched).toBe(3);
    expect(burned, 'уровни снимает участь города, а не разор за стеной').toBe(0);
    // Люди не погибли, а разбежались: население то же, руки свободны.
    expect(s.pop).toBe(200);
    expect(idleCount(s)).toBeGreaterThan(0);
  });

  it('лёгкий набег останавливает работу, но уровня не снимает', () => {
    const s = createInitialState();
    for (const b of s.buildings) b.level = 4;
    const levels = s.buildings.map((b) => b.level);
    sackOutskirts(s, 0.35);
    expect(s.buildings.map((b) => b.level)).toEqual(levels);
  });

  it('отбитый набег хозяйства не трогает', () => {
    const s = createInitialState();
    for (const b of s.buildings) b.level = 4;
    const men = new Map(s.buildings.map((b) => [b.id, workerCount(s, b.id)]));
    applyExpedition(s, {
      warriorsLost: 0,
      scoutsLost: 0,
      resources: {},
      gold: 0,
      prestige: 3,
      morale: 5,
      battle: 'won',
      sacked: 0,
      text: 'Набег отбит.',
      kind: 'good',
    });
    for (const b of s.buildings) {
      expect(b.level).toBe(4);
      expect(workerCount(s, b.id)).toBe(men.get(b.id));
    }
  });
});

describe('симуляция', () => {
  it('новая партия: весь посёлок со стеной стоит с первой секунды, всё первого уровня', () => {
    const s = createInitialState();
    const types = s.buildings.map((b) => b.type).sort();
    expect(types).toEqual(BUILDINGS.map((d) => d.id).sort());
    expect(s.buildings.every((b) => b.level === 1 && !isSite(b))).toBe(true);
    expect(buildingOfType(s, 'palisade')).not.toBeNull();
    // Людей меньше, чем жилья, и у костра есть свободные руки.
    expect(s.pop).toBeLessThanOrEqual(housingCapacity(s));
    expect(jobCounts(s).idle).toBeGreaterThanOrEqual(3);
  });

  /**
   * Золото, рынок и сами здания стоят с первой секунды — эпох и стадий поселения в игре
   * нет. Закрывает ковку и найм не постройка, а военная ветвь, и первая её ступень
   * покупается в ту же секунду: начального котла очков хватает ровно на неё.
   */
  it('золото и рынок доступны сразу, а кузница и казармы — с первой ступени ветви', () => {
    const s = createInitialState();
    expect(s.gold).toBeGreaterThan(0);
    expect(startForge(s, 'spear', 1), 'до ступени кузница копья не берёт').toMatch(/Не изучено/);
    expect(study(s, 'war'), 'а ступень покупается сразу: очков ровно на неё').toBeNull();
    expect(startForge(s, 'spear', 1)).toBeNull();
    expect(forgeInfo(s).blocked).toMatch(/никто не работает/);
    // Копьё на складе — и первый копейщик нанимается без единого условия.
    s.equipment.spear = 1;
    expect(startRecruit(s, 'spearman', 1)).toBeNull();
  });

  it('работники производят ресурсы, жители едят', () => {
    const s = createInitialState();
    const wood0 = s.resources.wood;
    const mill = buildingOfType(s, 'sawmill')!;
    const crew = workerCount(s, mill.id);
    expect(crew).toBeGreaterThan(0);
    catchUp(s, DAY_LENGTH, 0.5);
    // Лесорубы на лесопилке первого уровня: по 9 в день с поправкой на мораль.
    expect(s.resources.wood - wood0).toBeGreaterThan(crew * 6);
    expect(s.resources.wood - wood0).toBeLessThan(crew * 11);
  });

  it('голод забирает не одного человека, а долю посёлка', () => {
    const s = createInitialState();
    const pop0 = s.pop;
    s.resources.food = 0;
    // Все на лес: еду никто не добывает.
    idleAll(s);
    changeFreeJob(s, 'woodcutter', pop0);
    catchUp(s, DAY_LENGTH * 5, 1);
    expect(s.pop).toBeLessThan(pop0);
    // Убыль считается долей населения — на тридцати душах это уже не один человек.
    expect(s.stats.died).toBeGreaterThan(1);
  });

  it('население растёт при наличии жилья, еды и морали', () => {
    const s = createInitialState();
    const pop0 = s.pop;
    s.resources.food = 3000;
    s.morale = 90;
    place(s, 'houses', 3);
    catchUp(s, 4 * DAY_LENGTH, 1);
    expect(s.pop).toBeGreaterThan(pop0);
  });

  it('при низкой морали племя не растёт, а разбегается', () => {
    const s = createInitialState();
    s.resources.food = 3000;
    place(s, 'houses', 3);
    s.morale = 10;
    // Мораль держим низкой нарочно: проверяем именно её вклад в прирост.
    const pop0 = s.pop;
    for (let i = 0; i < 4 * DAY_LENGTH; i++) {
      s.morale = 10;
      tick(s, 1, { offline: true });
    }
    expect(s.pop).toBeLessThan(pop0);
  });

  it('офлайн-догон не запускает события', () => {
    const s = createInitialState();
    catchUp(s, 600, 2);
    expect(s.inbox).toEqual([]);
  });

  it('обучение придерживает события, пока идёт', () => {
    const s = createInitialState();
    for (let i = 0; i < 200; i++) tick(s, 0.5);
    expect(s.inbox).toEqual([]);
  });

  it('при игроке весть приходит живым шагом — по настоящим часам — и разрешается', () => {
    const s = createInitialState(7);
    finishTutorial(s);
    const at = awayArrival(s.seed, Math.floor(1_700_000_000_000 / AWAY_STEP) + 1);
    // Три настоящие секунды до прихода и три после — живыми шагами по полсекунды.
    for (let i = 1; i <= 5; i++) liveStep(s, 0.5, at - 3000 + i * 500);
    expect(s.inbox, 'точка внутри области: до минуты прихода стол пуст').toEqual([]);
    for (let i = 6; i <= 12; i++) liveStep(s, 0.5, at - 3000 + i * 500);
    expect(s.inbox.length, 'весть пришла в свою минуту').toBe(1);
    const r = resolveEvent(s, 0);
    expect(r.error).toBeNull();
    expect(s.inbox).toEqual([]);
  });

  it('задание выполняется и даёт награду', () => {
    const s = createInitialState();
    const stone0 = s.resources.stone;
    expect(assignWorker(s, buildingOfType(s, 'smithy')!.id)).toBeNull();
    tick(s, 0.5);
    expect(s.completedQuests).toContain('smith_at_work');
    expect(s.resources.stone).toBeGreaterThan(stone0 + 100);
  });

  it('задания — про армию, снаряжение, разведку и походы, а не про стройку', () => {
    const s = createInitialState();
    // Ни одно задание не закрыто самим фактом готового посёлка.
    tick(s, 0.5);
    expect(s.completedQuests).toEqual([]);
    for (const q of QUESTS) expect(q.description).not.toMatch(/[Пп]острой|[Ии]зучи/);
    // Счётчики походов закрывают свои задания.
    s.stats.scouted = 1;
    s.stats.raids = 1;
    tick(s, 0.5);
    expect(s.completedQuests).toContain('first_scout');
    expect(s.completedQuests).toContain('first_raid');
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

  it('слоты не переполняются: мест столько, сколько даёт уровень', () => {
    const s = createInitialState();
    idleAll(s);
    const mill = place(s, 'sawmill', 1);
    expect(buildingSlots(mill)).toBe(SLOTS_PER_LEVEL);
    expect(assignWorker(s, mill.id, 99)).toBeNull();
    expect(workerCount(s, mill.id)).toBe(SLOTS_PER_LEVEL);
    expect(assignWorker(s, mill.id)).toMatch(/места заняты/);

    // Даже если лишних вписали в обход действий, нормализация их выставит.
    s.workers[mill.id] = SLOTS_PER_LEVEL + 5;
    normalizeAssignments(s);
    expect(workerCount(s, mill.id)).toBe(SLOTS_PER_LEVEL);
  });

  it('больше, чем есть людей, назначить нельзя ни разом, ни в обход', () => {
    const s = createInitialState();
    idleAll(s);
    const mill = place(s, 'sawmill', 10);
    expect(assignWorker(s, mill.id, 999)).toBeNull();
    expect(workerCount(s, mill.id)).toBe(s.pop);
    expect(idleCount(s)).toBe(0);

    // Убыль населения не оставляет посёлок с рабочими, которых нет.
    s.pop = 5;
    normalizeAssignments(s);
    expect(workerCount(s, mill.id)).toBe(5);
    expect(idleCount(s)).toBe(0);
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
    expect(jobCounts(s).idle).toBe(s.pop);
  });

  it('улучшение идёт как стройка и добавляет место', () => {
    const s = createInitialState();
    idleAll(s);
    s.resources.wood = 2000;
    const mill = place(s, 'sawmill', 1);
    assignWorker(s, mill.id);
    expect(startUpgrade(s, mill.id)).toBeNull();
    expect(isSite(mill)).toBe(true);
    // Здание не разбирают: рабочий на месте и продолжает работать.
    expect(workerCount(s, mill.id)).toBe(1);
    expect(productionPerDay(s).wood).toBeGreaterThan(0);

    catchUp(s, 300, 1);
    expect(mill.level).toBe(2);
    expect(isSite(mill)).toBe(false);
    expect(buildingSlots(mill)).toBe(2 * SLOTS_PER_LEVEL);
    expect(assignWorker(s, mill.id)).toBeNull();
  });

  it('каждого типа ровно одно здание, и развитие идёт только уровнями', () => {
    const s = createInitialState();
    const seen = new Set<BuildingTypeId>();
    for (const b of s.buildings) {
      expect(seen.has(b.type), `${b.type} стоит дважды`).toBe(false);
      seen.add(b.type);
    }
    s.resources.wood = 5000;
    s.resources.stone = 5000;
    const mill = buildingOfType(s, 'sawmill')!;
    expect(startUpgrade(s, mill.id)).toBeNull();
    expect(startUpgrade(s, mill.id)).toMatch(/уже идёт/);
    catchUp(s, 300, 1);
    expect(mill.level).toBe(2);
    expect(s.buildings.filter((b) => b.type === 'sawmill')).toHaveLength(1);
  });

  it('улучшение не отключает здание: рабочие на местах, выработка не падает', () => {
    const s = createInitialState();
    idleAll(s);
    s.resources.wood = 5000;
    s.morale = 60;
    const mill = place(s, 'sawmill', 2);
    expect(assignWorker(s, mill.id, 2)).toBeNull();
    const before = productionPerDay(s).wood;
    const crew = workerCount(s, mill.id);
    expect(crew).toBe(2);

    expect(startUpgrade(s, mill.id)).toBeNull();
    expect(isSite(mill)).toBe(true);
    // Слоты не сбросились, люди не слетели, выработка та же самая.
    expect(buildingSlots(mill)).toBe(2 * SLOTS_PER_LEVEL);
    expect(workerCount(s, mill.id)).toBe(crew);
    expect(productionPerDay(s).wood).toBeCloseTo(before, 6);

    // И нормализация назначений на тике их тоже не трогает.
    tick(s, 1);
    expect(workerCount(s, mill.id)).toBe(crew);

    catchUp(s, 600, 1);
    s.morale = 60;
    expect(mill.level).toBe(3);
    expect(isSite(mill)).toBe(false);
    // Новые слоты добавились к старым, а не вместо них.
    expect(buildingSlots(mill)).toBe(3 * SLOTS_PER_LEVEL);
    expect(workerCount(s, mill.id)).toBe(crew);
    expect(productionPerDay(s).wood).toBeGreaterThan(before);
  });

  it('после улучшения эффекты вырастают ровно на шаг уровня', () => {
    const s = createInitialState();
    s.resources.wood = 40000;
    s.resources.stone = 40000;
    const houses = place(s, 'houses', 1);
    const housing0 = housingCapacity(s);
    expect(startUpgrade(s, houses.id)).toBeNull();
    catchUp(s, 1200, 1);
    expect(houses.level).toBe(2);
    expect(housingCapacity(s) - housing0).toBe(BUILDING_BY_ID.houses.perLevel?.housing);

    const store = buildingOfType(s, 'storage')!;
    const cap0 = storageCap(s);
    expect(startUpgrade(s, store.id)).toBeNull();
    catchUp(s, 1200, 1);
    expect(store.level).toBe(2);
    expect(storageCap(s) - cap0).toBe(BUILDING_BY_ID.storage.perLevel?.storage);

    // Выработка рабочего растёт на один шаг LEVEL_OUTPUT_STEP.
    const mill = place(s, 'sawmill', 1);
    expect(levelOutputMult(mill.level + 1) - levelOutputMult(mill.level)).toBeCloseTo(0.1, 6);
  });

  it('на потолке уровней посёлок держит сотни людей, а мест работы примерно столько же', () => {
    const s = createInitialState();
    for (const def of BUILDINGS) place(s, def.id, def.maxLevel ?? MAX_BUILDING_LEVEL);
    // Игра идёт к боям в сотни бойцов: посёлок на потолке — это 600–1000 человек.
    const housing = housingCapacity(s);
    expect(housing).toBeGreaterThanOrEqual(600);
    expect(housing).toBeLessThanOrEqual(1000);
    expect(maxLevelFor('houses')).toBe(MAX_BUILDING_LEVEL);

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
    assignWorker(s, mill.id, 3);
    assignWorker(s, farm.id, 2);
    s.buildings.splice(s.buildings.indexOf(mill), 1);
    s.buildings.splice(s.buildings.indexOf(farm), 1);
    tick(s, 0.5);
    // Записи о снесённых зданиях не остаются: все руки вернулись к костру.
    expect(s.workers[mill.id]).toBeUndefined();
    expect(s.workers[farm.id]).toBeUndefined();
    expect(jobCounts(s).woodcutter).toBe(0);
    expect(jobCounts(s).farmer).toBe(0);
    expect(jobCounts(s).idle).toBe(s.pop);
  });
});

// ---------- Прирост населения ----------
//
// Рождений поимённо, старения и смерти от старости нет. Вместо них прирост:
// свободное жильё, запас еды и мораль. Мораль — единственный множитель, умеющий
// уйти в минус, и это цена налога и скудного пайка.

describe('прирост населения', () => {
  /** Посёлок, которому ничто не мешает расти, кроме заданной морали. */
  const growing = (morale: number): GameState => {
    const s = createInitialState();
    s.tutorialDone = true;
    place(s, 'houses', 6);
    s.resources.food = 20000;
    s.morale = morale;
    return s;
  };

  it('мораль двигает прирост так же заметно, как выработку', () => {
    const low = popGrowth(growing(55)).perDay;
    const high = popGrowth(growing(95)).perDay;
    expect(low).toBeGreaterThan(0);
    // Между «еле держимся» и «племя довольно» разница в разы, а не в проценты.
    expect(high).toBeGreaterThan(low * 3);
  });

  it('ниже порога прирост уходит в минус: недовольное племя разбегается', () => {
    expect(popGrowth(growing(MORALE_GROWTH_ZERO)).perDay).toBeCloseTo(0, 6);
    const leaving = popGrowth(growing(20));
    expect(leaving.perDay).toBeLessThan(0);
    expect(leaving.blocked).toMatch(/уходят/);
  });

  it('люди уходят даже при полном жилье и полных закромах', () => {
    // Мораль не про крышу и не про кашу: её не выкупить запасами.
    const s = growing(20);
    expect(popGrowth(s).housing).toBe(1);
    expect(popGrowth(s).food).toBe(1);
    expect(popGrowth(s).perDay).toBeLessThan(0);
  });

  it('без свободного жилья и без запаса еды прироста нет', () => {
    const full = growing(95);
    full.pop = housingCapacity(full);
    expect(popGrowth(full).perDay).toBe(0);
    expect(popGrowth(full).blocked).toMatch(/жиль/);

    const hungry = growing(95);
    hungry.resources.food = 0;
    expect(popGrowth(hungry).perDay).toBe(0);
    expect(popGrowth(hungry).blocked).toMatch(/еды/);
  });

  it('налог виден дважды: и в казне, и в том, что племя перестаёт расти', () => {
    const s = growing(80);
    // Точка «до» — без налога: новая партия начинается с высокого, и сравнивать его с собой нечего.
    setTax(s, 'none');
    // Мораль приводим к цели, как это сделал бы тик.
    s.morale = moraleTarget(s);
    const before = popGrowth(s).perDay;
    setTax(s, 'high');
    s.morale = moraleTarget(s);
    expect(popGrowth(s).perDay).toBeLessThan(before);
  });

  it('прирост не перепрыгивает вместимость жилья', () => {
    const s = growing(100);
    catchUp(s, 40 * DAY_LENGTH, 1);
    expect(s.pop).toBeGreaterThan(30);
    expect(s.pop).toBeLessThanOrEqual(housingCapacity(s));
  });
});

// ---------- Первые пять минут ----------

describe('старт партии', () => {
  it('за пять минут племя куёт копьё, нанимает бойца и не встаёт в тупик', () => {
    const s = createInitialState();
    const food0 = s.resources.food;
    // Игрок делает очевидное: кузнеца к горну, заказ на копья, бойца в казармы.
    const smithy = buildingOfType(s, 'smithy')!;
    expect(assignWorker(s, smithy.id)).toBeNull();
    // Первая ступень военной ветви — тоже очевидное: очков на неё ровно столько, сколько надо.
    expect(study(s, 'war')).toBeNull();
    expect(startForge(s, 'spear', 4)).toBeNull();
    let recruited = false;
    for (let i = 0; i < 10 && !recruited; i++) {
      catchUp(s, 30, 0.5);
      recruited = startRecruit(s, 'spearman', 1) === null;
    }
    expect(recruited).toBe(true);
    catchUp(s, 5 * DAY_LENGTH - s.time, 0.5);

    expect(armySize(s)).toBe(1);
    expect(s.pop).toBeGreaterThanOrEqual(25);
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
  s.army.spearman = 40;
  s.pop = pop;
  idleAll(s);
  // Каждого типа по одному: жильё и склад набирают своё уровнями, а не числом срубов.
  place(s, 'houses', Math.max(1, Math.ceil((pop - 55) / 60) + 1));
  place(s, 'storage', 2);
  place(s, 'farm', 4);
  place(s, 'gathering', 1);
  // Ставка на земледелие: большинство в поле, немного на сборе. Лесорубов нет
  // нарочно — дрова у такого племени только со склада, и зима спрашивает за них
  // так же, как за еду.
  assignWorker(s, buildingOfType(s, 'farm')!.id, Math.round(pop * 0.6));
  assignWorker(s, buildingOfType(s, 'gathering')!.id, Math.round(pop * 0.1));
  // Награды за задания посыпались бы в первый же тик и подменили бы собой запас,
  // а проверяем мы именно запас — поэтому задания считаем уже закрытыми.
  s.completedQuests = QUESTS.map((q) => q.id);
  s.resources.food = food;
  s.resources.wood = wood;
  s.morale = 60;
  return s;
}

/** Снимает `n` человек с работы этой профессии, откуда бы они ни работали. */
function release(s: GameState, job: JobId, n = 1): void {
  const b = s.buildings.find((x) => BUILDING_BY_ID[x.type].job === job && workerCount(s, x.id) > 0);
  if (b) unassignWorker(s, b.id, n);
  else changeFreeJob(s, job, -n);
}

/** Ставит `n` человек на работу: место в здании вдвое выгоднее вольного сбора. */
function hire(s: GameState, job: JobId, n = 1): boolean {
  const b = s.buildings.find(
    (x) => BUILDING_BY_ID[x.type].job === job && x.level > 0 && workerCount(s, x.id) < buildingSlots(x),
  );
  return (b ? assignWorker(s, b.id, n) : changeFreeJob(s, job, n)) === null;
}

/** Кого и сколько держать на работах при нынешнем размере племени. */
function wanted(s: GameState): [JobId, number][] {
  const n = s.pop;
  return [
    ['gatherer', Math.max(2, Math.round(n * 0.2))],
    ['woodcutter', Math.max(1, Math.round(n * 0.2))],
    ['hunter', Math.max(1, Math.round(n * 0.15))],
    ['stonecutter', n >= 8 ? Math.max(1, Math.round(n * 0.12)) : 0],
    ['farmer', Math.round(n * 0.15)],
    ['miner', Math.max(2, Math.round(n * 0.05))],
    ['crafter', Math.max(1, Math.round(n * 0.04))],
    ['smith', Math.max(1, Math.round(n * 0.02))],
  ];
}

/**
 * Что улучшать дальше. Всё уже стоит, поэтому очередь всегда занята улучшением:
 * сначала жильё и склад, когда они узкое место, потом самое отстающее здание.
 */
function nextSite(s: GameState): void {
  if (s.buildings.some(isSite)) return;
  // Жильё — узкое место: пока селить некуда, племя не растёт.
  if (s.pop >= housingCapacity(s) - 1) {
    const houses = buildingOfType(s, 'houses')!;
    if (startUpgrade(s, houses.id) === null) return;
  }
  // Что-то упёрлось в потолок склада — поднимаем вместимость.
  const cap = storageCap(s);
  if (RESOURCE_IDS.some((r) => s.resources[r] >= cap - 1)) {
    const st = buildingOfType(s, 'storage')!;
    if (startUpgrade(s, st.id) === null) return;
  }
  // Тянем вверх самое отстающее здание. Не только рабочее: стена и ратуша
  // рабочих мест не дают, но без них посёлок не растёт.
  const behind = [...s.buildings].sort((a, b) => a.level - b.level);
  for (const b of behind) if (startUpgrade(s, b.id) === null) return;
}

/** Разумная игра без участия человека: работы, стройка и улучшения. */
function autopilot(s: GameState): void {
  const wants = wanted(s);
  for (const [job, want] of wants) {
    const over = jobCounts(s)[job] - want;
    if (over > 0) release(s, job, over);
  }
  for (const [job, want] of wants) {
    // Десятую часть всегда держим свободной: стройка идёт их руками.
    const spare = Math.max(2, Math.round(s.pop * 0.1));
    const need = Math.min(want - jobCounts(s)[job], idleCount(s) - spare);
    if (need > 0) hire(s, job, need);
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
    const s = tribe(60, 4000, 2000);
    atSeason(s, 'winter', 2);
    const pop = s.pop;
    catchUp(s, SEASON_SECONDS, 1);
    expect(s.pop).toBeGreaterThanOrEqual(pop);
    expect(s.stats.died).toBe(0);
    expect(s.freezing).toBe(0);
    expect(s.morale).toBeGreaterThan(35);
  });

  it('племя без запаса теряет мораль и людей — зима реально опасна', () => {
    const s = tribe(60, 0, 0);
    atSeason(s, 'winter', 2);
    const morale0 = s.morale;
    catchUp(s, SEASON_SECONDS, 1);
    expect(s.pop).toBeLessThan(60);
    expect(s.stats.died).toBeGreaterThan(0);
    // Мораль проседает, но не до нуля: с потерями ртов становится меньше, и племя
    // к концу зимы уже кое-как кормит себя само.
    expect(s.morale).toBeLessThan(morale0 - 5);
    expect(s.log.some((e) => e.text.includes('холод'))).toBe(true);
  });

  it('первая зима мягче последующих', () => {
    const first = tribe(60, 125, 30);
    atSeason(first, 'winter', 1);
    const later = tribe(60, 125, 30);
    atSeason(later, 'winter', 2);
    expect(heatingWoodPerDay(first)).toBeLessThan(heatingWoodPerDay(later));
    expect(foodConsumptionPerDay(first)).toBeLessThan(foodConsumptionPerDay(later));
    catchUp(first, SEASON_SECONDS, 1);
    setRandom(seeded(42));
    catchUp(later, SEASON_SECONDS, 1);
    expect(first.pop).toBeGreaterThanOrEqual(later.pop);
    expect(first.stats.died).toBeLessThanOrEqual(later.stats.died);
    expect(first.morale).toBeGreaterThan(later.morale);
  });

  it('за игровой год население растёт, а не вымирает', () => {
    const s = createInitialState();
    const pop0 = s.pop;
    play(s, YEAR_DAYS);
    expect(yearOf(s.time)).toBe(2);
    expect(s.pop).toBeGreaterThan(pop0);
  });

  it('за три года при разумной игре племя развивается, а не топчется на месте', () => {
    const s = createInitialState();
    play(s, YEAR_DAYS * 3);
    expect(s.pop).toBeGreaterThanOrEqual(60);
    // Развитие идёт уровнями: хижина одна, но выросшая.
    expect(buildingOfType(s, 'houses')!.level).toBeGreaterThanOrEqual(2);
    expect(s.buildings.filter((b) => b.type === 'sawmill')).toHaveLength(1);
    expect(s.stats.born).toBeGreaterThan(s.stats.died);
  });

  it('предупреждение о зиме поднимается за день до неё и считает запасы', () => {
    const s = tribe(60, 125, 30);
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

// ---------- События ----------
//
// Люди приходят и уходят толпой: поимённых жителей нет, а посёлок доходит до
// сотен. Событие «пришёл один чужак» на таком масштабе не событие.

/** Ставит событие активным и разрешает выбранный вариант. */
function fireEvent(s: GameState, id: string, option: number): string {
  s.inbox = [{ defId: id, at: s.time }];
  const r = resolveEvent(s, option);
  expect(r.error).toBeNull();
  return r.result ?? '';
}

/** Посёлок нужного размера с запасом и свободным жильём. */
function village(pop: number): GameState {
  const s = createInitialState();
  s.tutorialDone = true;
  place(s, 'houses', MAX_BUILDING_LEVEL);
  place(s, 'storage', MAX_BUILDING_LEVEL);
  s.pop = pop;
  for (const r of RESOURCE_IDS) s.resources[r] = 5000;
  s.morale = 70;
  return s;
}

describe('события идут толпой, а не по человеку', () => {
  it('беженцы приходят группой, и группа растёт вместе с посёлком', () => {
    const small = village(30);
    const before = small.pop;
    fireEvent(small, 'refugees', 0);
    const camePetite = small.pop - before;
    expect(camePetite).toBeGreaterThanOrEqual(8);

    const big = village(600);
    const before2 = big.pop;
    fireEvent(big, 'refugees', 0);
    const cameBig = big.pop - before2;
    // Толпа — доля посёлка: в большом племени она заметно больше.
    expect(cameBig).toBeGreaterThan(camePetite * 3);
    // Но и не ломает баланс: разом посёлок не удваивается.
    expect(cameBig).toBeLessThan(before2 * 0.15);
  });

  it('«сколько поместится» не селит людей под открытым небом', () => {
    const s = village(30);
    s.pop = housingCapacity(s) - 3;
    const before = s.pop;
    fireEvent(s, 'refugees', 1);
    expect(s.pop).toBe(before + 3);
    expect(s.pop).toBe(housingCapacity(s));
  });

  it('принять всех можно и сверх крыш — но за тесноту платит мораль', () => {
    const s = village(30);
    s.pop = housingCapacity(s);
    const target = moraleTarget(s);
    fireEvent(s, 'refugees', 0);
    expect(s.pop).toBeGreaterThan(housingCapacity(s));
    expect(moraleTarget(s)).toBeLessThan(target);
    // Теснота считается долей, а не головами: полтора десятка лишних не обнуляют мораль.
    expect(moraleTarget(s)).toBeGreaterThan(20);
  });

  it('отказ стоит морали: это были люди', () => {
    const s = village(200);
    const morale0 = s.morale;
    fireEvent(s, 'refugees', 2);
    expect(s.pop).toBe(200);
    expect(s.morale).toBeLessThan(morale0);
  });

  it('бродячая артель приводит людей и двигает стройку', () => {
    const s = village(200);
    const mill = buildingOfType(s, 'sawmill')!;
    expect(startUpgrade(s, mill.id)).toBeNull();
    const work0 = mill.work;
    const pop0 = s.pop;
    fireEvent(s, 'wanderers', 0);
    expect(s.pop).toBeGreaterThan(pop0);
    expect(mill.work).toBeGreaterThan(work0);
  });

  it('мор забирает долю посёлка, а не одного человека', () => {
    const s = village(400);
    // Шамана нет, значит обряд может не помочь; сид подобран на неудачу.
    setRandom(seeded(3));
    let died = 0;
    for (let i = 0; i < 12 && died === 0; i++) {
      const t = village(400);
      setRandom(seeded(i + 1));
      fireEvent(t, 'sickness', 2);
      died = t.stats.died;
    }
    expect(died, 'мор хоть раз из дюжины должен ударить').toBeGreaterThan(1);
    expect(s.pop).toBe(400);
  });

  it('награды и цены событий считаются от размера посёлка', () => {
    const small = village(30);
    const big = village(600);
    const f0 = small.resources.food;
    const f1 = big.resources.food;
    fireEvent(small, 'berries', 0);
    fireEvent(big, 'berries', 0);
    expect(big.resources.food - f1).toBeGreaterThan((small.resources.food - f0) * 5);
  });

});

// ---------- Обучение ----------

/** Ничего не открыто: обучение смотрит и на интерфейс тоже. */
const UI_NONE: TutorialUi = { building: null, tab: null, mapOpen: false, worldTile: false };
const ui = (over: Partial<TutorialUi>): TutorialUi => ({ ...UI_NONE, ...over });

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
    expect(at(s)).toBe('smithy');
    // Шаг с условием ждёт настоящего действия — тап по экрану его не проматывает.
    expect(tapTutorial(s, UI_NONE)).toBe(false);
    expect(at(s)).toBe('smithy');
  });

  it('шаг закрывается по факту: бойца наняли до просьбы', () => {
    const s = createInitialState();
    tapTutorial(s, UI_NONE);
    const smithy = buildingOfType(s, 'smithy')!;
    expect(assignWorker(s, smithy.id)).toBeNull();
    expect(study(s, 'war')).toBeNull();
    expect(startForge(s, 'spear', 1)).toBeNull();
    advanceTutorial(s, UI_NONE);
    expect(at(s)).toBe('open_town');
    // Игрок сам нашёл казармы и нанял дубинщика — все шаги про наём снимаются разом.
    expect(startRecruit(s, 'clubman', 1)).toBeNull();
    advanceTutorial(s, UI_NONE);
    expect(at(s)).toBe('map');
  });

  it('весь путь проходится действиями игрока и заканчивается сам', () => {
    const s = createInitialState();
    const smithy = buildingOfType(s, 'smithy')!;
    const barracks = buildingOfType(s, 'barracks')!;

    expect(at(s)).toBe('intro');
    tapTutorial(s, UI_NONE);
    expect(at(s)).toBe('smithy');

    advanceTutorial(s, ui({ building: smithy.id }));
    expect(at(s)).toBe('smith');

    expect(assignWorker(s, smithy.id)).toBeNull();
    advanceTutorial(s, ui({ building: smithy.id }));
    expect(at(s)).toBe('tech');

    // Копьё — вторая ступень военной ветви, и обучение ведёт её купить: начального котла
    // очков хватает ровно на неё, ждать игроку не приходится.
    expect(startForge(s, 'spear', 1), 'до ступени кузница копья не берёт').toMatch(/Не изучено/);
    expect(study(s, 'war')).toBeNull();
    advanceTutorial(s, ui({ building: smithy.id }));
    expect(at(s)).toBe('forge');

    expect(startForge(s, 'spear', 1)).toBeNull();
    advanceTutorial(s, ui({ building: smithy.id }));
    expect(at(s)).toBe('open_town');

    const hall = buildingOfType(s, 'town_hall')!;
    advanceTutorial(s, ui({ building: hall.id }));
    expect(at(s)).toBe('open_barracks');

    advanceTutorial(s, ui({ building: barracks.id }));
    expect(at(s)).toBe('recruit');
    // Копьё ещё куётся — строка объясняет ожидание, а не молчит.
    expect(stepText(currentStep(s)!, s)).toMatch(/куёт/);
    catchUp(s, 60, 0.5);
    expect(s.equipment.spear).toBeGreaterThan(0);
    expect(stepText(currentStep(s)!, s)).toBe('Найми копейщика.');
    expect(startRecruit(s, 'spearman', 1)).toBeNull();
    advanceTutorial(s, ui({ building: barracks.id }));
    expect(at(s)).toBe('map');

    advanceTutorial(s, ui({ mapOpen: true }));
    expect(at(s)).toBe('pick');

    advanceTutorial(s, ui({ mapOpen: true, worldTile: true }));
    expect(at(s)).toBe('scout');

    // Разведка ушла: мир проставляет число ушедших на пульсе.
    s.scoutsAway = 2;
    advanceTutorial(s, ui({ mapOpen: true, worldTile: true }));
    expect(at(s)).toBe('outro');

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

  it('версия сохранения выросла над обеими ветками, которые её поднимали', () => {
    // Ловушка слияния: перестройка посёлка и ратуша поднимали версию каждая, обе
    // до семёрки. Слитые вместе они дают формат, несовместимый с обеими, и версия
    // обязана вырасти дальше — иначе сохранение седьмой версии прочиталось бы как
    // своё и приехало бы с постройками, которых в игре нет.
    expect(SAVE_VERSION).toBeGreaterThan(7);
    for (const old of [6, 7]) {
      const s = createInitialState();
      const json = JSON.parse(serialize(s));
      json.version = old;
      expect(deserialize(JSON.stringify(json)), `версия ${old} должна отбрасываться`).toBeNull();
    }
  });

  it('сохранение старого формата не приводится, а отбрасывается', () => {
    // Партия от костра через эпохи и технологии: к новому старту её не перевести.
    const s = createInitialState();
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    raw.version = 5;
    raw.villagers = [{ id: 1, name: 'Ток', sex: 'm', age: 24, job: 'idle', workplace: null, talent: null }];
    expect(deserialize(JSON.stringify(raw))).toBeNull();
    // Вообще без версии — тоже.
    delete raw.version;
    expect(deserialize(JSON.stringify(raw))).toBeNull();
  });
});
