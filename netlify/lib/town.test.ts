import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUILT_FLAG_MS,
  FLOOR_FALL,
  PEOPLE_SLACK,
  builtForged,
  buildStep,
  floorAt,
  peopleStep,
  readTown,
  rushFloor,
  seedTown,
  townSheet,
  type ArmyMove,
  type TownBook,
  type TownClaim,
} from './town.js';
import { applyGemOrder, openLedger } from './gems.js';
import { emptyWars, liveSheet, shielded, type SheetAt } from './war.js';
import type { Counts, WarSheet } from './contract.js';
import type { BuildingTypeId, GameState } from '../../src/game/types.js';
import { createInitialState } from '../../src/game/state.js';
import { tick, absence } from '../../src/game/sim/tick.js';
import { startUpgrade } from '../../src/game/sim/actions.js';
import { addPop } from '../../src/game/sim/population.js';
import { rushFree, rushPrice } from '../../src/game/sim/gems.js';
import {
  bondedTotal,
  buildRate,
  buildingOfType,
  buildingSlots,
  currentSite,
  housingCapacity,
  levelsOf,
  maxLevelFor,
  recruitsQueued,
  storageCap,
  upgradeInfo,
} from '../../src/game/derived.js';
import { BUILDING_BY_ID } from '../../src/game/data/buildings.js';
import { RESOURCE_IDS, START_POP } from '../../src/game/constants.js';
import { gameDaysPerHour, gameSeconds, gameSecondsOfMs } from '../../src/game/pace.js';
import { upgradeWork } from '../../src/game/labour.js';
import { fullWork, rushFreeWork, rushPriceOfWork } from '../../src/game/gemrules.js';
import { BUILD_MOD_MAX, CRAFTER_MULT_MAX, CROWD_MAX, EVENT_WORK_MAX, buildCeil, crowdMax, headsFoodPerDay, housingOf, keenAt, soldierFoodPerDay, storageOf, towerSeatsAt } from '../../src/game/build.js';
import { ENGINES } from '../../src/game/data/engines.js';
import { MAX_AGENT_LEVEL } from '../../src/game/data/agents.js';
import { stealthAt } from '../../src/game/sim/agents.js';
import { veilAt } from '../../src/world/peril.js';
import { EVENT_WORK } from '../../src/game/data/events.js';
import { LETTER_PAUSE_MIN, LETTER_SLOTS } from '../../src/world/data/tuning.js';
import { weakCity } from '../../src/world/lairs.js';

/**
 * Книга стройки и жителей (docs/pvp.md, раздел 7): сервер подтверждает уровни построек и жителей не больше, чем
 * объясняют правила игры за серверное время. Тесты — на подделку (уровни, работа стройки, жители, слепок обороны,
 * защита слабого, цена ускорения) и на честного игрока: настоящая партия игры (`sim/tick`) строится без передышки —
 * записи раз в минуту и восемь часов офлайн — и книга подтверждает её целиком, без флага (правило 11: точки внутри
 * области — стройка идёт каждую минуту, уровни растут).
 */
const T0 = 1_900_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const A = 'tg-2001';
const NO_ARMY: ArmyMove = { before: 0, after: 0, dead: 0, power: 0, deadPower: 0 };

/** Опись партии — то же, что шлёт игра (`net/snapshot.watchOf`): уровни, жители, невольники, очередь, идущая стройка. */
function claimOf(s: GameState): TownClaim {
  const site = currentSite(s);
  return {
    buildings: levelsOf(s) as Counts,
    pop: s.pop,
    bonded: bondedTotal(s),
    queued: recruitsQueued(s),
    ...(site ? { site: { type: site.type, level: site.level + 1, done: site.work } } : {}),
  };
}

/** Обе ступени книги разом, как `watch.booked`. */
function step(book: TownBook, at: number, claim: TownClaim, army: ArmyMove = NO_ARMY) {
  const built = buildStep(book, at, claim);
  const people = peopleStep(built.book, book.at, claim, army, null, A);
  return { built, people, book: people.book };
}

/**
 * Честный посёлок, который строится без передышки: на складе всегда хватает, Мастерская полна ремесленников, мораль
 * полная — стройка на пределе того, что даёт игра. Следующая стройка — самая дешёвая из недостроенных.
 */
function honestTown(seed = 7): GameState {
  const s = createInitialState(seed);
  s.morale = 100;
  return s;
}

function keepBusy(s: GameState): void {
  const cap = storageCap(s);
  for (const r of RESOURCE_IDS) s.resources[r] = cap;
  s.morale = 100;
  const shop = buildingOfType(s, 'workshop');
  if (shop) s.workers[shop.id] = Math.min(buildingSlots(shop), Math.max(0, s.pop - 2));
  const now = currentSite(s);
  // Последние пять минут честный игрок ускоряет даром (`sim/gems.rushFree`) — без сервера.
  if (now && rushPrice(now) === 0) rushFree(s, now.id);
  if (currentSite(s)) return;
  const next = s.buildings
    .filter((b) => b.level < maxLevelFor(b.type) && !upgradeInfo(s, b).blocked)
    .sort((a, b) => upgradeInfo(s, a).work - upgradeInfo(s, b).work)[0];
  if (next) startUpgrade(s, next.id);
}

describe('общие правила: потолки не ниже игры', () => {
  it('потолок стройки не ниже настоящей скорости стройки в лучшей партии', () => {
    const s = honestTown();
    for (const b of s.buildings) b.level = maxLevelFor(b.type);
    s.pop = housingCapacity(s);
    keepBusy(s);
    s.decree = 'order';
    s.boons = [{ id: 'mercs', until: s.time + 1e6 }, { id: 'fair', until: s.time + 1e6 }] as GameState['boons'];
    const real = buildRate(s);
    expect(real, 'точка внутри области: стройка идёт').toBeGreaterThan(0);
    expect(buildCeil(levelsOf(s), s.pop + bondedTotal(s))).toBeGreaterThanOrEqual(real);
    expect(BUILD_MOD_MAX).toBeGreaterThanOrEqual(1);
    expect(CRAFTER_MULT_MAX).toBeGreaterThan(1);
  });

  it('жильё и склад — та же формула, что у игры', () => {
    const s = honestTown();
    for (const b of s.buildings) b.level = Math.min(4, maxLevelFor(b.type));
    expect(housingOf(levelsOf(s))).toBe(housingCapacity(s));
    expect(storageOf(levelsOf(s))).toBe(storageCap(s));
  });

  it('толпа и труд вестей в данных не больше потолков книги', () => {
    const src = ['events.ts', 'tidings.ts'].map((f) => readFileSync(join(__dirname, '../../src/game/data', f), 'utf8')).join('\n');
    const calls = [...src.matchAll(/crowd\(s, ([\d.]+), (\d+)\)/g)];
    expect(calls.length, 'вести с толпой есть — точка внутри области').toBeGreaterThan(5);
    for (const [, share, min] of calls) {
      expect(Number(share)).toBeLessThanOrEqual(CROWD_MAX.share);
      expect(Number(min)).toBeLessThanOrEqual(CROWD_MAX.min);
    }
    expect(Math.max(EVENT_WORK.settle, EVENT_WORK.day)).toBeLessThanOrEqual(EVENT_WORK_MAX);
  });
});

describe('честный игрок: книга подтверждает настоящую партию целиком', () => {
  it('записи раз в минуту три часа подряд, потом восемь часов офлайн — ни одного урезанного уровня и ни одного флага', () => {
    const s = honestTown();
    let book = seedTown(T0);
    let at = T0;
    let flags = 0;
    let grown = 0;
    for (let m = 1; m <= 180; m++) {
      keepBusy(s);
      tick(s, gameSeconds(60));
      at += MIN;
      const st = step(book, at, claimOf(s));
      book = st.book;
      if (builtForged(st.built) || st.people.forged > 0) flags++;
      expect(book.levels, `минута ${m}`).toEqual(claimOf(s).buildings);
      expect(book.pop, `минута ${m}`).toBe(s.pop);
    }
    grown = Object.values(book.levels).reduce((t, l) => t + l - 1, 0);
    expect(grown, 'за три часа построено много уровней — точка внутри области').toBeGreaterThanOrEqual(8);
    // Восемь часов офлайн: догон отлучки строит и растит племя без записей.
    keepBusy(s);
    absence(s, at, at + 8 * HOUR);
    at += 8 * HOUR;
    const before = book.levels;
    const st = step(book, at, claimOf(s));
    expect(Object.values(st.book.levels).reduce((t, l) => t + l, 0), 'офлайн достроены уровни').toBeGreaterThan(Object.values(before).reduce((t, l) => t + l, 0));
    expect(st.book.levels).toEqual(claimOf(s).buildings);
    expect(st.book.pop).toBe(s.pop);
    expect(builtForged(st.built) || st.people.forged > 0).toBe(false);
    expect(flags).toBe(0);
  });

  it('плохая сеть: записи с пропусками по полчаса — то же самое', () => {
    const s = honestTown(11);
    let book = seedTown(T0);
    let at = T0;
    for (let m = 1; m <= 240; m++) {
      keepBusy(s);
      tick(s, gameSeconds(60));
      at += MIN;
      if (m % 30 !== 0) continue;
      const st = step(book, at, claimOf(s));
      book = st.book;
      expect(builtForged(st.built)).toBe(false);
      expect(st.people.forged).toBe(0);
      expect(book.levels).toEqual(claimOf(s).buildings);
    }
  });

  it('беженцы из вести и распущенное войско — не флаг', () => {
    const s = honestTown();
    let book = seedTown(T0);
    const at = T0 + MIN;
    addPop(s, crowdMax(s.pop));
    const st = step(book, at, claimOf(s));
    expect(st.people.forged).toBe(0);
    expect(st.book.pop).toBe(s.pop);
    book = st.book;
    // Роспуск: сорок бойцов вернулись домой жителями — их книга войска отдала.
    s.pop += 40;
    const back = step(book, at + MIN, claimOf(s), { before: 100, after: 60, dead: 0, power: 0, deadPower: 0 });
    expect(back.people.forged).toBe(0);
    expect(back.book.pop).toBe(s.pop);
  });

  it('уровень, ускоренный за алмазы, подтверждается без работы — только поверх подтверждённых ниже', () => {
    const book = seedTown(T0);
    const claim: TownClaim = { buildings: { ...book.levels, barracks: 3 }, pop: START_POP };
    // Точка внутри области: второй уровень казарм дороже даровых пяти минут — без оплаты его не подтвердить.
    expect(upgradeWork(BUILDING_BY_ID.barracks, 2)).toBeGreaterThan(rushFreeWork());
    const one = buildStep({ ...book, letters: 0 }, T0 + 1000, claim, [{ n: 5, building: 'barracks', level: 3 }]);
    expect(one.book.levels.barracks, 'третий оплачен, а второй не построен — подтверждён первый').toBe(1);
    expect(one.book.paid).toContain('barracks:3');
    const two = buildStep({ ...book, letters: 0 }, T0 + 1000, claim, [
      { n: 5, building: 'barracks', level: 2 },
      { n: 6, building: 'barracks', level: 3 },
    ]);
    expect(two.book.levels.barracks).toBe(3);
    expect(two.book.paid).not.toContain('barracks:3');
    expect(two.book.gem).toBe(6);
    // Та же запись книги алмазов второй раз уровня не даёт.
    const again = buildStep({ ...two.book, letters: 0, levels: { ...two.book.levels, barracks: 1 } }, T0 + 2000, claim, [{ n: 6, building: 'barracks', level: 3 }]);
    expect(again.book.levels.barracks).toBe(1);
  });
});

describe('подделка: уровни и жители — не больше объяснимого', () => {
  it('все постройки десятого уровня с первой минуты — подтверждён посёлок новой партии, флаг', () => {
    const book = seedTown(T0);
    const all = Object.fromEntries(Object.keys(BUILDING_BY_ID).map((t) => [t, maxLevelFor(t as BuildingTypeId)]));
    const st = buildStep(book, T0 + MIN, { buildings: all, pop: START_POP });
    // Минута потолка стройки, даровые пять минут на уровень и пять вестей — два-три уровня на весь посёлок.
    expect(Object.values(st.book.levels).reduce((t, l) => t + l - 1, 0)).toBeLessThanOrEqual(3);
    expect(builtForged(st)).toBe(true);
  });

  it('уровни растут не быстрее потолка стройки за время с запасом', () => {
    const book = seedTown(T0);
    const at = T0 + HOUR;
    const st = buildStep(book, at, { buildings: { ...book.levels, palisade: 10 }, pop: START_POP });
    const rate = buildCeil(book.levels, START_POP);
    let spent = 0;
    let l = 1;
    while (l < (st.book.levels.palisade ?? 0)) spent += upgradeWork(BUILDING_BY_ID.palisade, ++l);
    expect(st.book.levels.palisade ?? 0, 'точка внутри области: за час кое-что построено').toBeGreaterThan(1);
    expect(st.book.levels.palisade ?? 0).toBeLessThan(10);
    // Потолок за час с запасом и вести — больше подтверждённого не построить.
    expect(spent).toBeLessThanOrEqual(rate * gameSecondsOfMs(HOUR) * 2 + LETTER_SLOTS * EVENT_WORK_MAX * upgradeWork(BUILDING_BY_ID.palisade, l + 1) + 10 * fullWork('palisade', 2));
  });

  it('работа идущей стройки — не больше, чем посёлок мог сделать', () => {
    const book = seedTown(T0);
    const st = buildStep(book, T0 + MIN, { buildings: book.levels, pop: START_POP, site: { type: 'palisade', level: 2, done: 1e9 } });
    expect(st.book.site?.done ?? 0).toBeLessThan(upgradeWork(BUILDING_BY_ID.palisade, 2));
    expect(st.book.site?.done ?? 0).toBeLessThanOrEqual(buildCeil(book.levels, START_POP) * gameSecondsOfMs(MIN) * 2 + 1e-6);
  });

  it('жители: прыжок — урезан и флаг; толпы вестей кончаются; прирост не выше жилья', () => {
    let book = seedTown(T0);
    const at = T0 + MIN;
    const st = step(book, at, { buildings: book.levels, pop: 5000 });
    expect(st.book.pop).toBeLessThan(START_POP + LETTER_SLOTS * crowdMax(START_POP) + PEOPLE_SLACK);
    expect(st.people.forged).toBeGreaterThan(4000);
    // Вести кончаются: каждую минуту по толпе — после `LETTER_SLOTS` уже флаг.
    let flagged = 0;
    for (let m = 1; m <= LETTER_SLOTS + 3; m++) {
      const want = book.pop + crowdMax(book.pop);
      const next = step(book, T0 + m * MIN, { buildings: book.levels, pop: want });
      book = next.book;
      if (next.people.forged > 0) flagged++;
    }
    expect(flagged).toBeGreaterThan(0);
    // Прирост за сутки упирается в жильё подтверждённых уровней.
    const day = step({ ...seedTown(T0), letters: 0 }, T0 + 24 * HOUR, { buildings: seedTown(T0).levels, pop: 100_000 });
    // Сверх крыш — только толпы вестей, пришедших за сутки (по одной за `LETTER_PAUSE_MIN`).
    const letters = Math.floor((24 * HOUR) / LETTER_PAUSE_MIN);
    expect(letters, 'точка внутри области: вести за сутки пришли').toBeGreaterThan(0);
    expect(day.book.pop).toBeLessThanOrEqual(housingOf(seedTown(T0).levels) + 1 + letters * crowdMax(START_POP));
    expect(day.book.pop).toBeGreaterThan(housingOf(seedTown(T0).levels) - 5);
  });

  it('книга из испорченной записи не читается, лишнее отсеивается', () => {
    expect(readTown(null)).toBeNull();
    expect(readTown({ since: 0, at: 5 })).toBeNull();
    const t = readTown({ ...seedTown(T0), letters: 999, site: { type: 'nope', level: 2, done: 5 }, paid: [1, 'a:2'] });
    expect(t?.letters).toBe(LETTER_SLOTS);
    expect(t?.site).toBeNull();
    expect(t?.paid).toEqual(['a:2']);
  });
});

/** Слепок обороны с высокими заявлениями. */
function bigSheet(over: Partial<WarSheet> = {}): WarSheet {
  return {
    army: {},
    home: {},
    militia: 5000,
    archers: 3000,
    resolve: 0,
    pips: {},
    rest: 1,
    food: 1e6,
    townPerHour: 10,
    perManPerHour: 1,
    stock: { wood: 1e6, stone: 50 },
    stash: 1e6,
    gold: 100,
    pop: 9000,
    bonded: 0,
    levels: { palisade: 10, tower: 10, cache: 10, town_hall: 10 },
    power: 0,
    locks: {},
    seen: [],
    ...over,
  };
}

describe('слепок обороны и защита слабого — из книги', () => {
  it('ополчение, башня, склад, тайник, жители и уровни — не больше подтверждённого', () => {
    const book = seedTown(T0);
    const out = townSheet(bigSheet(), book, 0);
    expect(out.levels).toEqual({ palisade: 1, tower: 1, cache: 1, town_hall: 1 });
    expect(out.pop).toBe(START_POP);
    expect(out.stock.wood).toBe(storageOf(book.levels));
    expect(out.stock.stone).toBe(50);
    expect(out.food).toBe(storageOf(book.levels));
    expect(out.militia).toBeLessThan(100);
    expect(out.militia).toBeGreaterThan(0);
    expect(out.archers).toBeLessThanOrEqual(out.militia);
    expect(out.stash).toBeLessThan(1e6);
    // Через liveSheet — так слепок идёт в бой.
    const s: SheetAt = { sheet: bigSheet(), at: T0, town: book };
    expect(liveSheet(emptyWars(), A, s, T0).militia).toBe(out.militia);
    // Честный слепок книга не трогает.
    // Расход хлеба честного — формулой игры при обычном пайке (`world/bridge.playerProfile`): не ниже пола (ЗЩ-2).
    const eat = { townPerHour: headsFoodPerDay(20, 1, 1) * gameDaysPerHour(), perManPerHour: soldierFoodPerDay(1, 1) * gameDaysPerHour() };
    const honest = bigSheet({ militia: 3, archers: 0, stock: { wood: 100 }, food: 100, stash: 0, pop: 20, levels: { palisade: 1 }, ...eat });
    expect(townSheet(honest, book, 0)).toEqual(honest);
  });

  it('«не меньше»: город, заявивший себя меньше, чем был, защиты слабого не получает; допуск сходит со временем', () => {
    const book: TownBook = { ...seedTown(T0), pop: 400, peak: { pop: 400, power: 0 } };
    const small = bigSheet({ pop: 5, power: 0 });
    expect(weakCity(5, 0), 'точка внутри области: заявленный город слаб').toBe(true);
    expect(weakCity(400, 0), 'а подтверждённый — нет').toBe(false);
    expect(shielded(emptyWars(), A, { sheet: small, at: T0, town: book }, T0 + MIN)).toBe(false);
    expect(shielded(emptyWars(), A, { sheet: small, at: T0 }, T0 + MIN), 'без книги — со слов').toBe(true);
    // Сутки настоящего времени — допуск `FLOOR_FALL` за игровой день спускает «наибольшее».
    expect(floorAt(book, T0 + 24 * HOUR).pop).toBeLessThan(5);
    expect(FLOOR_FALL).toBeGreaterThan(0);
    // Падение города (бой войны) сервер вычитает сам.
    const fallFile = emptyWars();
    fallFile.wars.push({ def: A, fall: { at: T0 + 30_000, popLost: 300 } } as never);
    const p = peopleStep({ ...book, at: T0 + MIN }, T0, { buildings: book.levels, pop: 100 }, NO_ARMY, fallFile, A);
    expect(p.book.peak.pop).toBeLessThanOrEqual(400 - 300 + 1);
  });
});

describe('ускорение за алмазы: остаток стройки знает сервер', () => {
  it('честный остаток не меньше остатка книги — цена по нему не выше показанной', () => {
    const s = honestTown(3);
    let book = seedTown(T0);
    let at = T0;
    let checked = 0;
    for (let m = 1; m <= 120; m++) {
      keepBusy(s);
      // Посреди минуты, до следующей записи: стройка шла полминуты после записи книги.
      tick(s, gameSeconds(30));
      const site = currentSite(s);
      if (site) {
        const left = site.workRequired - site.work;
        const floor = rushFloor(book, claimOf(s).buildings, bondedTotal(s), site.type, site.level + 1, at + 30_000);
        expect(floor).not.toBeNull();
        expect(left, `минута ${m}`).toBeGreaterThanOrEqual((floor ?? 0) - 1e-6);
        checked++;
      }
      keepBusy(s);
      tick(s, gameSeconds(30));
      at += MIN;
      book = step(book, at, claimOf(s)).book;
    }
    expect(checked, 'точка внутри области: стройка шла').toBeGreaterThan(60);
  });

  it('подделка, назвавшая остаток меньше, платит по остатку книги', () => {
    const book = seedTown(T0);
    const level = 6;
    const left = rushFloor(book, { palisade: 6 }, 0, 'palisade', level, T0 + MIN);
    expect(left).not.toBeNull();
    expect(left ?? 0, 'точка внутри области: почти весь труд впереди').toBeGreaterThan(fullWork('palisade', level) / 2);
    const honestPrice = rushPriceOfWork(left ?? 0);
    const cheat = applyGemOrder(openLedger(T0), { op: 'rush', key: 'cheat-1', building: 'palisade', level, work: 1, price: 1 }, T0 + MIN, left);
    expect(cheat.error).toMatch(/стоит/);
    const paid = applyGemOrder(openLedger(T0), { op: 'rush', key: 'cheat-2', building: 'palisade', level, work: 1, price: honestPrice }, T0 + MIN, left);
    expect(paid.error).toBeUndefined();
    expect(paid.entry?.delta).toBe(-honestPrice);
    // Уровень уже подтверждён — такой стройки нет.
    expect(rushFloor(book, {}, 0, 'palisade', 1, T0)).toBeNull();
    expect(applyGemOrder(openLedger(T0), { op: 'rush', key: 'cheat-3', building: 'palisade', level: 2, work: 100, price: 100 }, T0, null).error).toBe('Такой стройки нет.');
  });

  it('флаг стройки — только за отставание больше получаса потолка', () => {
    expect(BUILT_FLAG_MS).toBeGreaterThanOrEqual(10 * MIN);
  });
});


/**
 * Тайная служба и орудие башни слепка (docs/security.md, ЗЩ-2): клиент называл их сам, и сервер брал любое число в пределах
 * разбора — Дозор до ста, бессмертного лазутчика, орудие любой силы. Теперь — не лучше, чем дают подтверждённые уровни,
 * высший уровень агента и таблица орудий игры.
 */
describe('тайная служба и орудие башни — в пределах правил', () => {
  it('Дозор выше уровня, бессмертный и незаметный лазутчик, короткий плен — к пределам правил; честная служба не меняется', () => {
    const book = seedTown(T0);
    const watchLevel = book.levels.watch ?? 0;
    const forged = townSheet(bigSheet({ watch: { keen: 100, veil: 0, stealth: 1, held: 0.1, home: true } }), book, 0).watch!;
    expect(forged.keen).toBe(keenAt(watchLevel));
    expect(forged.veil).toBe(veilAt(MAX_AGENT_LEVEL));
    expect(forged.stealth).toBe(stealthAt(MAX_AGENT_LEVEL));
    expect(forged.held).toBe(1);
    // Точки внутри области: пределы правил строже подделки.
    expect(keenAt(watchLevel)).toBeLessThan(100);
    expect(veilAt(MAX_AGENT_LEVEL)).toBeGreaterThan(0);
    expect(stealthAt(MAX_AGENT_LEVEL)).toBeLessThan(1);
    const honest = { keen: keenAt(watchLevel), veil: veilAt(3), stealth: stealthAt(3), held: 1.5, home: false };
    expect(townSheet(bigSheet({ watch: honest }), book, 0).watch).toEqual(honest);
  });

  it('орудие не из таблицы игры — нет орудия; из таблицы при подтверждённой башне — то же, мест не больше башни', () => {
    const def = ENGINES[0];
    const book = { ...seedTown(T0), levels: { ...seedTown(T0).levels, tower: def.level } };
    const fake = { slow: 1, thin: 1, crew: 1, seats: 10 };
    expect(townSheet(bigSheet({ tower: fake }), book, 0).tower).toBeUndefined();
    const real = { slow: def.slow, thin: def.thin, crew: def.crew, seats: 99 };
    expect(townSheet(bigSheet({ tower: real }), book, 0).tower).toEqual({ ...real, seats: towerSeatsAt(def.level) });
    // Башня ниже уровня орудия — орудия нет.
    expect(townSheet(bigSheet({ tower: real }), seedTown(T0), 0).tower).toBeUndefined();
    expect(def.level, 'точка внутри области: орудию нужна башня выше первой').toBeGreaterThan(1);
  });
});
