// Невольники, порядок в городе и мятеж.
//
// Тесты держат обещания механики, а не то, что код «что-то делает»:
//
//  1. невольники встают в общую систему работ — те же места, та же таблица
//     профессий, тот же множитель, тот же расход еды по головам;
//  2. порядок — чистая функция при чтении, и без невольников он полный всегда;
//  3. мятеж не наступает раньше, чем игрок мог что-то сделать: срок ропота идёт
//     только при игроке, тревога видна с первой секунды, окно ждёт ответа;
//  4. исход объявлен заранее и совпадает с объявленным;
//  5. рынок — та же лавка: ряд стоит всегда, караван тот же, продать дешевле;
//  6. новые поля версию сохранения не поднимают — это проверено разбором;
//  7. тексты буднично-нейтральны: ни похвалы сделке, ни шутки, ни людей штуками.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BuildingTypeId, GameState } from '../types';
import { createInitialState, SAVE_VERSION } from '../state';
import { deserialize, serialize } from '../save';
import {
  BONDED_OUTPUT,
  BUILDER_RATE,
  DAY_LENGTH,
  MAX_BUILDING_LEVEL,
  MUTINY_CARRY,
  MUTINY_FUSE,
  MUTINY_SUPPRESS_FLEE,
  MUTINY_SUPPRESS_MORALE,
  MUTINY_TOWN_LEAVE,
  ORDER_UNREST,
  ORDER_WARN,
  RESOURCE_IDS,
  VILLAGER_DEFENSE,
} from '../constants';
import { BUILDING_BY_ID } from '../data/buildings';
import { BONDED_JOBS, JOBS, JOB_BY_ID } from '../data/jobs';
import { BONDED_GOOD, BONDED_PAYBACK_DAYS, BONDED_SALE, GOODS, GOOD_BY_ID, offerFor } from '../data/market';
import { MUTINY_EVENT, ORDER_TEXT } from '../data/order';
import { EVENT_BY_ID, eventCost } from '../data/events';
import {
  alerts,
  bondedCount,
  bondedIdle,
  buildRate,
  buildingOfType,
  buildingProduction,
  buildingSlots,
  dayOf,
  defense,
  foodConsumptionPerDay,
  handsCount,
  hiddenStash,
  housingCapacity,
  marketOffer,
  moraleBreakdown,
  mutinyForecast,
  orderBreakdown,
  orderState,
  orderValue,
  population,
  productionPerDay,
  rationOf,
  seasonMods,
  selfCost,
  storageCap,
  taxIncomePerDay,
  townFoodPerDay,
  townHallBuildMult,
  unrestLeft,
  workerMultiplier,
} from '../derived';
import { absence, awayGameSeconds, catchUp, tick } from './tick';
import { resolveEvent } from './actions';
import { EVENT_TTL, SILENCE_PREFIX, eventLeft, mailStep } from './mail';

const T0 = 1_900_000_000_000;
import {
  assignBonded,
  assignWorker,
  normalizeAssignments,
  unassignBonded,
} from './workers';
import { addBonded, loseBonded } from './population';
import { buyGoods, cancelCaravan, marketCheck, saleCheck, sellBonded } from './market';
import { mutinyFalls, mutinyRelease, mutinySuppress, releaseBonded, unrestTick } from './mutiny';
import { applyExpedition } from './expedition';
import { seeded, setRandom } from './random';
import { plunder } from '@/world/spoils';

beforeEach(() => setRandom(seeded(11)));

/** Посёлок заданного уровня: склад полон, казна полна, никто не стоит на местах. */
function town(level = 5, pop = 300): GameState {
  const s = createInitialState();
  s.tutorialDone = true;
  for (const b of s.buildings) b.level = Math.min(BUILDING_BY_ID[b.type].maxLevel ?? MAX_BUILDING_LEVEL, level);
  for (const r of RESOURCE_IDS) s.resources[r] = 5000;
  s.gold = 100_000;
  s.pop = pop;
  s.morale = 70;
  s.workers = {};
  s.freeJobs = {};
  s.bondedWork = {};
  s.bonded = 0;
  s.nextEventAt = 1e9;
  return s;
}

const at = (s: GameState, type: BuildingTypeId): number => buildingOfType(s, type)!.id;

// ------------------------------------------------------------------ работы ---

describe('невольники встают в общую систему работ, а не рядом с ней', () => {
  it('ставят их туда, где труд тяжёлый, и никуда больше', () => {
    // Поле, лес, камень, руда, скот и сбор — да; оружие, служба и мастерство — нет.
    expect([...BONDED_JOBS].sort()).toEqual(['farmer', 'gatherer', 'herder', 'miner', 'stonecutter', 'woodcutter'].sort());
    for (const id of ['hunter', 'smith', 'priest', 'crafter'] as const) expect(JOB_BY_ID[id].bonded).toBeFalsy();
    const s = town();
    s.bonded = 50;
    for (const type of ['hunter_hut', 'smithy', 'church', 'workshop'] as BuildingTypeId[]) {
      expect(assignBonded(s, at(s, type), 1), type).not.toBeNull();
    }
    expect(assignBonded(s, at(s, 'quarry'), 1)).toBeNull();
  });

  it('места у здания общие: занятое одним не достаётся другому', () => {
    const s = town(1, 100);
    s.bonded = 100;
    const farm = at(s, 'farm');
    const slots = buildingSlots(buildingOfType(s, 'farm')!);
    expect(assignBonded(s, farm, 8)).toBeNull();
    // Вольных встанет ровно столько, сколько осталось мест, — ни одним больше.
    expect(assignWorker(s, farm, 100)).toBeNull();
    expect(handsCount(s, farm)).toBe(slots);
    expect(assignWorker(s, farm, 1)).not.toBeNull();
    expect(assignBonded(s, farm, 1)).not.toBeNull();
    // Сняли невольника — место снова свободно для вольного.
    expect(unassignBonded(s, farm, 3)).toBeNull();
    expect(assignWorker(s, farm, 3)).toBeNull();
    expect(handsCount(s, farm)).toBe(slots);
  });

  it('выработка — та же строка той же профессии, на объявленную долю', () => {
    const s = town();
    s.bonded = 40;
    const farm = buildingOfType(s, 'farm')!;
    const before = productionPerDay(s).food;
    expect(assignBonded(s, farm.id, 20)).toBeNull();
    const gained = productionPerDay(s).food - before;
    // Не своя формула: таблица профессии, множитель места и доля невольника.
    const expected = 20 * (JOB_BY_ID.farmer.yield.food ?? 0) * workerMultiplier(s, 'farmer', farm) * BONDED_OUTPUT;
    expect(gained).toBeCloseTo(expected, 6);
    // Панель здания считает то же самое тем же кодом.
    expect(buildingProduction(s, farm).food).toBeCloseTo(expected, 6);
  });

  it('едят по головам через общий расход — и в осаду тоже', () => {
    const s = town();
    const mods = seasonMods(s);
    const eat = foodConsumptionPerDay(s);
    const town0 = townFoodPerDay(s);
    s.bonded = 120;
    // Ровно по голове на невольника, тем же пайком и тем же сезоном.
    const perHead = mods.food * rationOf(s).food;
    expect(foodConsumptionPerDay(s) - eat).toBeCloseTo(120 * perHead, 6);
    // Под осадой невольники заперты в городе: мир получает их в расходе города.
    expect(townFoodPerDay(s) - town0).toBeCloseTo(120 * perHead, 6);
    // И этот тормоз не обходится ничем: на рационе он множится, как у всех.
    s.ration = 'rich';
    const rich = foodConsumptionPerDay(s);
    s.bonded = 0;
    expect(rich - foodConsumptionPerDay(s)).toBeCloseTo(120 * mods.food * rationOf(s).food, 6);
  });

  it('без места — на стройке, тем же трудом и на ту же долю', () => {
    const s = town();
    expect(assignWorker(s, at(s, 'farm'), 60)).toBeNull();
    const base = buildRate(s);
    s.bonded = 50;
    const mods = seasonMods(s);
    expect(buildRate(s) - base).toBeCloseTo(50 * BONDED_OUTPUT * BUILDER_RATE * mods.build * townHallBuildMult(s), 6);
    // Поставили на места — со стройки ушли ровно они.
    expect(assignBonded(s, at(s, 'quarry'), 20)).toBeNull();
    expect(buildRate(s) - base).toBeCloseTo(30 * BONDED_OUTPUT * BUILDER_RATE * mods.build * townHallBuildMult(s), 6);
  });

  it('второй формулы выработки под невольников нет — это видно по исходнику', () => {
    const src = readFileSync(join(process.cwd(), 'src/game/derived.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    // Долю невольника читает одна дверь (`bondedShare`: пока мятеж ждёт ответа, она ноль), а
    // множится она ровно в двух местах: на месте в здании и на стройке.
    expect((src.match(/\bBONDED_OUTPUT\b/g) ?? []).length - 1, 'сама доля — только в двери').toBe(1);
    expect((src.match(/\bbondedShare\(/g) ?? []).length, 'дверь зовут поле и стройка').toBe(2);
    // И обе выработки — всего посёлка и одного здания — идут через одну функцию.
    expect(src).toMatch(/export function productionPerDay[\s\S]{0,300}?yardYield\(/);
    expect(src).toMatch(/export function buildingProduction[\s\S]{0,300}?yardYield\(/);
  });

  it('невольники не жители: налог, жильё, прирост и оборона их не считают', () => {
    const s = town();
    s.resources.food = storageCap(s);
    const tax = (() => {
      s.tax = 'high';
      return taxIncomePerDay(s);
    })();
    const pop = population(s);
    const room = housingCapacity(s);
    const def = defense(s);
    s.bonded = 200;
    expect(population(s)).toBe(pop);
    expect(taxIncomePerDay(s)).toBe(tax);
    expect(housingCapacity(s)).toBe(room);
    expect(defense(s)).toBe(def);
  });

  it('убыль снимает сперва тех, кто без места, потом с самого многолюдного двора', () => {
    const s = town();
    addBonded(s, 30);
    expect(assignBonded(s, at(s, 'farm'), 12)).toBeNull();
    expect(assignBonded(s, at(s, 'quarry'), 8)).toBeNull();
    expect(bondedIdle(s)).toBe(10);
    expect(loseBonded(s, 14)).toBe(14);
    expect(bondedIdle(s)).toBe(0);
    // Четверо сверх тех, кто без места, ушли с поля — оно было многолюднее.
    expect(bondedCount(s, at(s, 'farm'))).toBe(8);
    expect(bondedCount(s, at(s, 'quarry'))).toBe(8);
    expect(s.bonded).toBe(16);
  });

  it('упал уровень — первыми с мест сходят невольники; убыль невольников снимает их с мест', () => {
    const s = town(2);
    s.pop = 100;
    s.bonded = 30;
    const farm = buildingOfType(s, 'farm')!;
    expect(assignWorker(s, farm.id, 14)).toBeNull();
    expect(assignBonded(s, farm.id, 10)).toBeNull();
    farm.level = 1;
    normalizeAssignments(s);
    expect(handsCount(s, farm.id)).toBe(buildingSlots(farm));
    expect(s.workers[farm.id]).toBe(12);
    expect(bondedCount(s, farm.id)).toBe(0);
    // Невольников стало меньше, чем стоит по местам, — места пустеют сами.
    expect(assignBonded(s, at(s, 'quarry'), 12)).toBeNull();
    s.bonded = 5;
    normalizeAssignments(s);
    expect(bondedCount(s, at(s, 'quarry'))).toBe(5);
    expect(bondedIdle(s)).toBe(0);
  });
});

// ---------------------------------------------------------------- порядок ---

describe('порядок — чистая функция при чтении', () => {
  it('одинаковый вход даёт одинаковый выход, и второй раз подряд — тот же', () => {
    const a = town();
    const b = town();
    a.bonded = b.bonded = 180;
    a.army.spearman = b.army.spearman = 30;
    expect(orderBreakdown(a)).toEqual(orderBreakdown(b));
    expect(orderBreakdown(a)).toEqual(orderBreakdown(a));
  });

  it('тика у него нет: время само по себе порядок не двигает', () => {
    const s = town();
    s.bonded = 150;
    const v = orderValue(s);
    s.time += 400 * DAY_LENGTH;
    expect(orderValue(s)).toBe(v);
    // И в исходнике нет ни часов, ни кости.
    const read = (rel: string): string =>
      readFileSync(join(process.cwd(), rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const derived = read('src/game/derived.ts');
    const order = derived.slice(derived.indexOf('export function orderBreakdown'), derived.indexOf('// ---------- Тревоги'));
    for (const src of [order, read('src/game/sim/mutiny.ts'), read('src/game/data/order.ts')]) {
      expect(src).not.toMatch(/Math\.random|rnd\(|chance\(/);
      expect(src).not.toMatch(/Date\.now|new Date\(|performance\.now/);
    }
  });

  it('без невольников порядок полный — при любом гарнизоне и любой морали', () => {
    const s = town();
    for (const morale of [0, 20, 45, 70, 100]) {
      for (const guards of [0, 10, 300]) {
        s.morale = morale;
        s.army.spearman = guards;
        expect(orderValue(s)).toBe(100);
        expect(orderState(s)).toBe('none');
        // И ропот не копится: мятежа без невольников не бывает.
        s.unrest = 0;
        for (let i = 0; i < 400; i++) expect(unrestTick(s, 0.5)).toBeNull();
        expect(s.unrest).toBe(0);
      }
    }
  });

  it('растёт от войска дома; падает от малого гарнизона, множества невольников и недовольных горожан', () => {
    const s = town();
    s.bonded = 120;
    s.army.spearman = 20;
    const base = orderValue(s);

    s.army.spearman = 60;
    expect(orderValue(s), 'войско дома').toBeGreaterThan(base);
    s.army.spearman = 5;
    expect(orderValue(s), 'малый гарнизон').toBeLessThan(base);
    s.army.spearman = 20;

    // Ушедшие в поход не держат: гарнизон — это те, кто дома.
    s.away = { spearman: 15 };
    expect(orderValue(s), 'дружина в поле').toBeLessThan(base);
    s.away = {};

    s.bonded = 200;
    expect(orderValue(s), 'больше невольников').toBeLessThan(base);
    s.bonded = 120;

    s.morale = 30;
    expect(orderValue(s), 'недовольные горожане').toBeLessThan(base);
  });

  it('надзор равен числу невольников — порядок пятьдесят: пороги читаются по одной мерке', () => {
    const s = town();
    s.army.spearman = 40;
    const hold = orderBreakdown(s).hold;
    s.bonded = Math.round(hold);
    expect(orderValue(s)).toBeCloseTo(50, 0);
    expect(ORDER_WARN).toBe(50);
    expect(ORDER_UNREST).toBeLessThan(ORDER_WARN);
  });

  it('это не вторая мораль: мораль порядок не читает, а порядок читает мораль одним слагаемым', () => {
    const s = town();
    s.resources.food = storageCap(s);
    s.army.spearman = 30;
    const morale = moraleBreakdown(s);
    s.bonded = 250;
    s.resources.food = storageCap(s);
    // Мораль не заметила ни невольников, ни упавшего порядка.
    expect(moraleBreakdown(s).target).toBe(morale.target);
    const src = readFileSync(join(process.cwd(), 'src/game/derived.ts'), 'utf8');
    const moraleSrc = src.slice(src.indexOf('export function moraleBreakdown'), src.indexOf('export const moraleTarget'));
    expect(moraleSrc).not.toMatch(/order|bonded/i);
    // А слагаемое морали в порядке одно — «спокойные горожане».
    const lines = orderBreakdown(s).lines;
    expect(lines.map((l) => l.id)).toEqual(['household', 'guards', 'town']);
  });
});

// ------------------------------------------------------ срок и присутствие ---

/** Город, где порядок заведомо ниже порога ропота, а стража не удержит. */
function restless(): GameState {
  const s = town();
  s.resources.food = storageCap(s);
  s.bonded = 200;
  return s;
}

describe('мятеж не наступает раньше, чем игрок мог что-то сделать', () => {
  // Область правила: порядок ниже порога ропота всю отлучку (иначе ропот тает, а не зреет) и отлучка
  // длиннее срока ропота. Обе точки утверждаются в тесте.
  // Область правила: порядок ниже порога ропота всю отлучку, отлучка длиннее и срока ропота, и срока
  // донесения — иначе «не решился» зелёное даром: решиться было бы нечему.
  it('ропот зреет по времени, а не по присутствию: в отлучке мятеж ложится на стол, но без игрока не решается', () => {
    const s = restless();
    expect(orderState(s), 'точка внутри области: порядок ниже порога').toBe('unrest');
    const since = T0 - 3 * EVENT_TTL;
    expect(awayGameSeconds(since, T0), 'точка внутри области: догон длиннее срока ропота').toBeGreaterThan(MUTINY_FUSE);
    expect(T0 - since, 'точка внутри области: отлучка длиннее срока донесения').toBeGreaterThan(EVENT_TTL);
    absence(s, since, T0);
    const open = s.inbox.find((e) => e.defId === MUTINY_EVENT);
    expect(open, 'мятеж созрел без игрока').toBeTruthy();
    // Срок ответа ждёт хозяина: отлучка его не поставила, и молчанием мятеж не решился.
    expect(open!.until, 'срок ответа ещё не идёт').toBeUndefined();
    expect(s.bonded).toBe(200);
    // Игрок вошёл: первый шаг почты при нём ставит срок — сутки с этой минуты, а не с минуты мятежа.
    expect(mailStep(s, T0), 'вход ничего не разрешает').toBe(false);
    expect(open!.until).toBe(T0 + EVENT_TTL);
    expect(s.bonded).toBe(200);
  });

  it('тревога с ценой видна с первой секунды, а мятеж — ровно через срок ропота при игроке', () => {
    const s = restless();
    tick(s, 0.5);
    const alert = alerts(s).find((a) => a.id === 'unrest');
    expect(alert, 'ропот обязан быть виден сразу').toBeTruthy();
    expect(alert!.sub, 'и цена — рядом со сроком').toBeTruthy();
    expect(alert!.open).toBe('order');
    const steps = MUTINY_FUSE / 0.5;
    for (let i = 1; i < steps - 1; i++) {
      tick(s, 0.5);
      expect(s.inbox, `шаг ${i}`).toEqual([]);
    }
    expect(unrestLeft(s)).toBeCloseTo(0.5, 6);
    tick(s, 0.5);
    expect(s.inbox[0]?.defId).toBe(MUTINY_EVENT);
  });

  it('срок ропота один: половина при игроке и половина в отлучке складываются', () => {
    const s = restless();
    for (let i = 0; i < (MUTINY_FUSE / 2) / 0.5; i++) tick(s, 0.5);
    expect(s.unrest, 'точка внутри области: полсрока набрано, мятежа ещё нет').toBe(MUTINY_FUSE / 2);
    expect(s.inbox).toEqual([]);
    // В отлучке — чуть меньше второй половины: мятежа ещё нет, срок вырос ровно на прошедшее.
    catchUp(s, MUTINY_FUSE / 2 - 2, 2);
    expect(s.unrest).toBe(MUTINY_FUSE - 2);
    expect(s.inbox).toEqual([]);
    // И ещё шаг отлучки — созрел.
    catchUp(s, 2, 2);
    expect(s.inbox.map((e) => e.defId)).toContain(MUTINY_EVENT);
  });

  it('мятеж ждёт ответа сутки, как любое донесение; без ответа стража выходит сама', () => {
    const s = restless();
    for (let i = 0; i < MUTINY_FUSE / 0.5; i++) tick(s, 0.5);
    const open = s.inbox[0];
    expect(open?.defId).toBe(MUTINY_EVENT);
    expect(mailStep(s, T0), 'первый взгляд только ставит срок').toBe(false);
    expect(eventLeft(open, T0), 'срок донесения — один на всю почту').toBe(EVENT_TTL / 1000);
    // Шаг симуляции срока не двигает и мятежа не разрешает — ни при игроке, ни в догоне.
    for (let i = 0; i < 600; i++) tick(s, 0.5);
    catchUp(s, 3600, 2);
    expect(s.inbox[0]?.defId).toBe(MUTINY_EVENT);
    expect(s.unrest, 'ропот стоит, пока мятеж на столе').toBe(MUTINY_FUSE);
    // Миг до срока — ждёт; в срок — разрешился молчанием мятежа.
    expect(mailStep(s, T0 + EVENT_TTL - 1)).toBe(false);
    expect(s.inbox[0]?.defId).toBe(MUTINY_EVENT);
    expect(mailStep(s, T0 + EVENT_TTL), 'срок вышел').toBe(true);
    expect(s.log[0].text).toContain(SILENCE_PREFIX);
    expect(s.log[0].text).toContain(ORDER_TEXT.mutiny.suppress);
    expect(s.inbox).toEqual([]);
    expect(s.unrest).toBe(0);
  });

  // Окно, которое можно держать открытым сутки, не должно держать невольников за работой.
  // Область правила: невольники стоят на местах и до мятежа дают выработку — иначе ноль даром.
  it('пока мятеж ждёт ответа, невольники стоят — в поле и на стройке; ответили — работают', () => {
    const s = restless();
    const yard = s.buildings.find((b) => b.type === 'farm')!;
    s.bondedWork = { [yard.id]: 20 };
    s.workers = { [yard.id]: 10 };
    const free = structuredClone(s);
    free.bonded = 0;
    free.bondedWork = {};
    const food = (g: GameState): number => productionPerDay(g).food;
    expect(food(s), 'точка внутри области: невольники в поле дают хлеб').toBeGreaterThan(food(free));
    expect(buildRate(s), 'точка внутри области: невольники без места строят').toBeGreaterThan(buildRate(free));
    for (let i = 0; i < MUTINY_FUSE / 0.5 && s.inbox.length === 0; i++) tick(s, 0.5);
    expect(s.inbox[0]?.defId, 'точка внутри области: мятеж на столе').toBe(MUTINY_EVENT);
    free.time = s.time;
    free.morale = s.morale;
    free.pop = s.pop;
    expect(food(s), 'в поле — только вольные').toBeCloseTo(food(free), 9);
    expect(buildRate(s), 'на стройке — только вольные').toBeCloseTo(buildRate(free), 9);
    // Ответ «раздать хлеб и золото» невольников не уводит — и они снова за работой.
    expect(resolveEvent(s, 2).error).toBeNull();
    expect(s.bonded).toBe(200);
    expect(food(s), 'ответили — работают').toBeGreaterThan(food(free));
  });

  it('порядок поднялся — ропот тает вдвое быстрее, чем копился', () => {
    const s = restless();
    for (let i = 0; i < 100; i++) tick(s, 0.5);
    expect(s.unrest).toBe(50);
    s.bonded = 0;
    for (let i = 0; i < 50; i++) tick(s, 0.5);
    expect(s.unrest).toBe(0);
  });

  it('пока идёт ропот, случайное окно его не заслоняет', () => {
    const s = restless();
    s.nextEventAt = 0;
    for (let i = 0; i < 200; i++) {
      tick(s, 0.5);
      expect(s.inbox).toEqual([]);
    }
  });
});

// ------------------------------------------------------------------ исходы ---

describe('исход мятежа объявлен заранее и совпадает с объявленным', () => {
  it('стража удержит: сбегает объявленная доля невольников, мораль проседает, остальное цело', () => {
    const s = restless();
    s.army.spearman = 100;
    const f = mutinyForecast(s);
    expect(f.crush).toBe(Math.floor((100 * 4) / VILLAGER_DEFENSE));
    expect(f.holds).toBe(true);
    expect(f.flee).toBe(Math.round(200 * MUTINY_SUPPRESS_FLEE));
    const pop = s.pop;
    const res = { ...s.resources };
    const morale = s.morale;
    mutinySuppress(s);
    expect(s.bonded).toBe(200 - f.flee);
    expect(s.morale).toBe(morale - MUTINY_SUPPRESS_MORALE);
    expect(s.pop).toBe(pop);
    expect(s.resources).toEqual(res);
    expect(s.unrest).toBe(0);
  });

  it('стража не удержит: уходит объявленная доля горожан, склад делит общее правило, уходят все невольники', () => {
    const s = restless();
    const f = mutinyForecast(s);
    expect(f.holds).toBe(false);
    expect(f.leave).toBe(Math.round(300 * MUTINY_TOWN_LEAVE));
    const stock: Record<string, number> = {};
    for (const r of RESOURCE_IDS) stock[r] = Math.floor(s.resources[r]);
    const expected = plunder(stock, hiddenStash(s), (f.leave + 200) * MUTINY_CARRY);
    const before = RESOURCE_IDS.reduce((n, r) => n + s.resources[r], 0);
    const text = mutinyFalls(s);
    expect(s.pop).toBe(300 - f.leave);
    expect(s.bonded).toBe(0);
    const after = RESOURCE_IDS.reduce((n, r) => n + s.resources[r], 0);
    // Четвёртого правила дележа нет: унесено ровно то, что дала бы `plunder`.
    expect(Math.round(before - after)).toBe(expected.takenTotal);
    expect(text).toContain(String(expected.takenTotal));
    // Здания, дружина и казна остаются: мятеж уносит людей и добро.
    expect(s.gold).toBe(100_000);
  });

  it('последний горожанин не уходит никогда', () => {
    const s = restless();
    s.pop = 1;
    mutinyFalls(s);
    expect(s.pop).toBe(1);
  });

  it('отпустить — уходят все невольники, горожане и склад на месте', () => {
    const s = restless();
    const res = { ...s.resources };
    mutinyRelease(s);
    expect(s.bonded).toBe(0);
    expect(s.pop).toBe(300);
    expect(s.resources).toEqual(res);
  });

  it('раздача снимает объявленную плату и гасит ропот, но надзор прежний — и ропот вернётся', () => {
    const s = restless();
    for (let i = 0; i < MUTINY_FUSE / 0.5; i++) tick(s, 0.5);
    expect(s.inbox[0]?.defId).toBe(MUTINY_EVENT);
    const def = EVENT_BY_ID[MUTINY_EVENT];
    const pay = def.options.findIndex((o) => o.label === ORDER_TEXT.mutiny.pay);
    const cost = eventCost(def.options[pay], s);
    const gold = s.gold;
    const r = resolveEvent(s, pay);
    expect(r.error).toBeNull();
    expect(gold - s.gold).toBe(cost.gold);
    expect(s.unrest).toBe(0);
    expect(orderState(s)).toBe('unrest');
    // Ничего не поменяли — через тот же срок мятеж снова на столе.
    for (let i = 0; i < MUTINY_FUSE / 0.5; i++) tick(s, 0.5);
    expect(s.inbox[0]?.defId).toBe(MUTINY_EVENT);
  });

  it('у окна мятежа есть бесплатный выход, и первый вариант — тот, что случится без ответа', () => {
    const def = EVENT_BY_ID[MUTINY_EVENT];
    expect(def.weight(restless()), 'случаем мятеж не выпадает').toBe(0);
    expect(def.options[0].label).toBe(ORDER_TEXT.mutiny.suppress);
    expect(def.options.some((o) => !o.cost)).toBe(true);
    expect(def.waits, 'срок подписан тем, что случится без ответа').toBe(ORDER_TEXT.mutiny.silence);
  });

  it('падение города приводит невольников в племя и уводит их из него одним полем', () => {
    const s = town();
    const base = { warriorsLost: 0, scoutsLost: 0, resources: {}, gold: 0, prestige: 0, morale: 0, battle: null, text: 'итог', kind: 'info' as const };
    applyExpedition(s, { ...base, bonded: 12 });
    expect(s.bonded).toBe(12);
    applyExpedition(s, { ...base, bonded: -5 });
    expect(s.bonded).toBe(7);
    applyExpedition(s, { ...base, bonded: -50 });
    expect(s.bonded).toBe(0);
  });
});

// ------------------------------------------------------------------ рынок ---

describe('невольничий ряд — та же лавка, а не вторая', () => {
  it('ряд стоит всегда и места в круговороте товаров не занимает', () => {
    const s = town();
    expect(GOODS.some((g) => g.id === 'bonded'), 'в тасуемом списке ряда нет').toBe(false);
    for (let day = 1; day <= 40; day++) {
      for (const level of [1, 4, 10]) {
        s.time = (day - 1) * DAY_LENGTH;
        buildingOfType(s, 'market')!.level = level;
        // Прилавок дня тот же, что был бы без невольников, и ряд — последней строкой.
        expect(marketOffer(s).map((g) => g.id)).toEqual([...offerFor(dayOf(s.time), level, GOODS).map((g) => g.id), 'bonded']);
        expect(marketCheck(s, 'bonded', 1).blocked).toBeNull();
      }
    }
  });

  it('покупка — тем же караваном: золото сразу, люди по приходу, отмена возвращает золото', () => {
    const s = town();
    const gold = s.gold;
    const check = marketCheck(s, 'bonded', 3);
    expect(buyGoods(s, 'bonded', 3)).toBeNull();
    expect(gold - s.gold).toBe(check.cost);
    expect(s.bonded).toBe(0);
    catchUp(s, s.caravans[0].arriveAt - s.time + 1, 1);
    expect(s.bonded).toBe(3);

    expect(buyGoods(s, 'bonded', 2)).toBeNull();
    const back = s.gold;
    expect(cancelCaravan(s, s.caravans[0].id)).toBeNull();
    expect(s.gold).toBeGreaterThan(back);
    expect(s.bonded).toBe(3);
  });

  it('цена растёт за день, и дневной запас не обходится дроблением', () => {
    const s = town();
    const first = marketCheck(s, 'bonded', 1).cost;
    expect(first).toBeGreaterThanOrEqual(BONDED_GOOD.price);
    const stock = BONDED_GOOD.stock + BONDED_GOOD.stockPerLevel * 4;
    for (let i = 0; i < stock; i++) expect(buyGoods(s, 'bonded', 1)).toBeNull();
    expect(buyGoods(s, 'bonded', 1)).not.toBeNull();
    expect(marketCheck(s, 'bonded', 1).blocked).not.toBeNull();
  });

  it('продать можно дешевле, чем купить, и не больше дневного запаса ряда', () => {
    const s = town();
    s.bonded = 100;
    const price = Math.floor(BONDED_GOOD.price * BONDED_SALE);
    expect(price).toBeLessThan(BONDED_GOOD.price);
    const gold = s.gold;
    expect(sellBonded(s, 4)).toBeNull();
    expect(s.gold - gold).toBe(4 * price);
    expect(s.bonded).toBe(96);
    const left = saleCheck(s, 1).left;
    expect(sellBonded(s, left + 1)).not.toBeNull();
    expect(sellBonded(s, left)).toBeNull();
    expect(sellBonded(s, 1)).not.toBeNull();
    // Новый день — торговцы берут снова.
    catchUp(s, DAY_LENGTH, 1);
    expect(sellBonded(s, 1)).toBeNull();
  });

  it('невольник не окупается быстрее объявленного срока ни в каком положении', () => {
    // Самое выгодное, что бывает: десятый уровень, мораль сто, строгий указ и
    // любой сезон. Мерка — та же, которой рынок меряет всё остальное: добро по
    // цене своего труда, минус порция еды.
    const s = town(MAX_BUILDING_LEVEL);
    s.morale = 100;
    s.decree = 'order';
    let fastest = Infinity;
    for (let season = 0; season < 4; season++) {
      s.time = season * 5 * DAY_LENGTH + 1;
      for (const job of BONDED_JOBS) {
        const place = s.buildings.find((b) => BUILDING_BY_ID[b.type].job === job)!;
        const mult = workerMultiplier(s, job, place) * BONDED_OUTPUT;
        let gold = -selfCost(GOOD_BY_ID.food);
        for (const r of RESOURCE_IDS) gold += (JOB_BY_ID[job].yield[r] ?? 0) * mult * selfCost(GOOD_BY_ID[r]);
        if (gold > 0) fastest = Math.min(fastest, BONDED_GOOD.price / gold);
      }
    }
    expect(fastest, 'самая быстрая окупаемость в днях').toBeGreaterThanOrEqual(BONDED_PAYBACK_DAYS);
    expect(Number.isFinite(fastest)).toBe(true);
  });

  it('купить и тут же продать — отдать разницу торговцам, а не нажиться', () => {
    const s = town();
    // Пока караван идёт, в казну капает налог; мерка здесь — торговля, а не сбор.
    s.tax = 'none';
    const gold = s.gold;
    expect(buyGoods(s, 'bonded', 5)).toBeNull();
    catchUp(s, s.caravans[0].arriveAt - s.time + 1, 1);
    expect(sellBonded(s, 5)).toBeNull();
    expect(s.gold).toBeLessThan(gold);
  });

  it('отпустить — уходят своей дорогой и жителями не становятся', () => {
    const s = town();
    s.bonded = 30;
    expect(releaseBonded(s, 12)).toBeNull();
    expect(s.bonded).toBe(18);
    expect(s.pop).toBe(300);
    expect(releaseBonded(s, 19)).not.toBeNull();
  });
});

// ------------------------------------------------------------- сохранение ---

describe('сохранение: новые поля версию не поднимают', () => {
  it('партия, записанная до невольников, читается с умолчаниями и той же версией', () => {
    const raw = JSON.parse(serialize(createInitialState())) as Record<string, unknown> & { market: Record<string, unknown> };
    delete raw.bonded;
    delete raw.bondedWork;
    delete raw.unrest;
    delete raw.market.sold;
    const s = deserialize(JSON.stringify(raw));
    expect(s).not.toBeNull();
    // Невольники версию не подняли: 14 — жалованье, 15 — стол событий почты (не их поля).
    expect(SAVE_VERSION).toBe(15);
    expect(s!.version).toBe(SAVE_VERSION);
    expect(s!.bonded).toBe(0);
    expect(s!.bondedWork).toEqual({});
    expect(s!.unrest).toBe(0);
    expect(s!.market.sold).toEqual({});
  });

  it('невольники, их места, ропот и проданное за день переживают запись и чтение', () => {
    const s = town();
    s.bonded = 40;
    expect(assignBonded(s, at(s, 'mine'), 9)).toBeNull();
    s.unrest = 33;
    s.market.day = dayOf(s.time);
    s.market.sold = { bonded: 2 };
    const back = deserialize(serialize(s))!;
    expect(back.bonded).toBe(40);
    expect(back.bondedWork).toEqual(s.bondedWork);
    expect(back.unrest).toBe(33);
    expect(back.market.sold).toEqual({ bonded: 2 });
  });
});

// --------------------------------------------------------------------- тон ---

describe('тон: буднично, без одобрения и без глумления', () => {
  /** Все слова модуля слов — строки и то, что отдают функции на пробных числах. */
  function words(): string[] {
    const out: string[] = [];
    const probe: unknown[][] = [
      [5, 3, 70],
      [1, 1, 1],
      [{ holds: true, bonded: 12, flee: 2, leave: 30, morale: 8, left: 30, taken: 900, hidden: 40 }],
      [{ holds: false, bonded: 12, flee: 2, leave: 30, morale: 8, left: 30, taken: 900, hidden: 0 }],
      [false],
    ];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') out.push(v);
      else if (typeof v === 'function') {
        for (const args of probe) {
          try {
            const r = (v as (...a: unknown[]) => unknown)(...args);
            if (typeof r === 'string') out.push(r);
          } catch {
            /* не та подпись — пробуем другую */
          }
        }
      } else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
    };
    walk(ORDER_TEXT);
    return out;
  }

  /** Строки исходника без комментариев: слова разметки и летописи. */
  const code = (rel: string, from?: string, to?: string): string => {
    let src = readFileSync(join(process.cwd(), rel), 'utf8');
    if (from) src = src.slice(src.indexOf(from), to ? src.indexOf(to, src.indexOf(from) + from.length) : undefined);
    return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');
  };

  const texts = (): string[] => [
    ...words(),
    code('src/ui/panels/OrderPanel.tsx'),
    code('src/ui/panels/PeoplePanel.tsx', 'function Bonded', 'export function PeoplePanel'),
    code('src/ui/parts/Market.tsx', 'function BondedRow', 'function GoodRow'),
    code('src/ui/panels/BuildingPanel.tsx', 'function WorkerSlots', 'function BuildingData'),
    code('src/game/sim/mutiny.ts'),
    // Лестница участи говорит об уведённых и разошедшихся — тем же тоном.
    code('src/world/data/fates.ts'),
    code('src/ui/parts/FatePick.tsx'),
    code('src/ui/panels/SiegePanel.tsx'),
    code('src/game/sim/expedition.ts', 'export function applyExpedition'),
  ];

  it('ни похвалы сделке, ни шутки, ни подробностей насилия', () => {
    // Проверка грубая и нарочно такая: она ловит не тонкость, а прямое слово,
    // которое однажды напишут не думая. Тот же приём, что у слов о вере.
    const bad =
      /(выгодн|удачн|повезл|отличн|прекрасн|замечательн|славн|здоров[оа]|ура[!\s.]|дёшев|дешев|по дешёвке|задёшево|весел|шутк|шуточ|смешн|забавн|потех|ха-ха|послушн|покорн|благодарн|счастлив|кров[ьиа]|казн(ь|ил|ят)|плет[ьи]|истяза|пытк|повесил|вешали|добыч[аиу] люд|улов|урожай)/i;
    for (const t of texts()) expect(t, t.slice(0, 120)).not.toMatch(bad);
  });

  it('людей не считают штуками, головами и скотом', () => {
    const cattle = /(штук|\d+\s*голов|поголовь|скот|скотин|двуног|живой товар|товар на ногах)/i;
    for (const t of texts()) expect(t, t.slice(0, 120)).not.toMatch(cattle);
  });

  it('на рынке невольника продают «за человека», а не «за штуку»', () => {
    expect(ORDER_TEXT.market.unit).toBe('за человека');
    const row = code('src/ui/parts/Market.tsx', 'function BondedRow', 'function GoodRow');
    expect(row).toContain('ORDER_TEXT.market.unit');
    expect(row).not.toContain('за штуку');
  });

  it('все профессии невольников названы теми же словами, что у вольных', () => {
    // Отдельных «рабских» профессий нет: невольник на поле — фермер на поле.
    for (const job of BONDED_JOBS) expect(JOBS.find((j) => j.id === job)?.name).toBeTruthy();
  });
});
