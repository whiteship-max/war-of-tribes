/**
 * Книга стройки и жителей (docs/pvp.md, раздел 7): какие уровни построек и сколько жителей сервер может подтвердить у
 * игрока. Рядом с книгой войска (`book.ts`) и тем же приёмом — «не больше объяснимого правилами за серверное время»:
 *
 *  · **уровни** растут не быстрее труда стройки — потолок скорости (`build.buildCeil`: подтверждённые жители и уровни) за
 *    прошедшее серверное время с запасом `TOWN_SLACK`, плюс последние пять минут каждого уровня даром
 *    (`gemrules.rushFreeWork`), плюс труд, который кладут вести (`EVENT_WORK_MAX` на весть), плюс уровни, ускоренные за
 *    алмазы, — их сервер списал сам (книга алмазов, `paid`). Одна стройка за раз: работа общая на все постройки;
 *  · **жители** растут не быстрее прироста (`build.popGrowthCeil`, и не выше жилья подтверждённых уровней), толпы вестей
 *    (`build.crowdMax` на весть, не больше вестей, чем приходит почтой), людей, ушедших из войска домой (роспуск, уход за
 *    неуплату, выкупленные пленные), учеников, вернувшихся из очереди, и уведённых лазутчиком у соседа;
 *  · **«не меньше»** для защиты слабого (`floorAt`): жители и мощь не ниже наибольшего подтверждённого за вычетом того,
 *    что сервер объясняет сам (бой войны, падение), и допуска `FLOOR_FALL` за игровой день на то, чего он не видит
 *    (голод, холод, мор, уход, поход на логово).
 *
 * Убывает книга всем, что показала опись: подтверждённое — не больше заявленного. Из книги сервер выводит слепок обороны
 * (`war.liveSheet`): уровни, ополчение, башню, склад, тайник и жителей — не больше, чем дают подтверждённые; и цену
 * ускорения за алмазы — сам знает, сколько стройки могло быть сделано (`rushFloor`).
 *
 * Пишет книгу одна дверь — запись партии (`routes/save.ts` → `watch.booked`); читают — война (`routes/war.ts`) и алмазы
 * (`routes/gems.ts`). Лежит в записи наблюдения игрока (`WatchRecord.town`). Чистая: без хранилища и без часов.
 */
import { BUILDING_BY_ID } from '../../src/game/data/buildings.js';
import { has } from '../../src/game/guard.js';
import type { BuildingTypeId } from '../../src/game/types.js';
import { BUILD_QUEUE_MAX, MAX_BUILDING_LEVEL, START_POP } from '../../src/game/constants.js';
import { gameDaysOfMs, gameDaysPerHour, gameSecondsOfMs } from '../../src/game/pace.js';
import { upgradeWork } from '../../src/game/labour.js';
import { rushFreeWork } from '../../src/game/gemrules.js';
import { foldTown, hasGone, keptType } from '../../src/game/yardmerge.js';
import {
  EVENT_WORK_MAX,
  POP_RATE_MAX,
  STEADFAST_MAX,
  buildCeil,
  crowdMax,
  defenseOf,
  eatFloorPerDay,
  housingOf,
  keenAt,
  levelIn,
  militiaOf,
  popGrowthCeil,
  stashAt,
  storageOf,
  towerArchersAt,
  towerSeatsAt,
} from '../../src/game/build.js';
import { ENGINES } from '../../src/game/data/engines.js';
import { MAX_AGENT_LEVEL } from '../../src/game/data/agents.js';
import { TRAITS } from '../../src/game/data/traits.js';
import { stealthAt } from '../../src/game/sim/agents.js';
import { veilAt } from '../../src/world/peril.js';
import { LETTER_PAUSE_MIN, LETTER_SLOTS } from '../../src/world/data/tuning.js';
import { readCounts, type Counts, type SpyWatch, type WarSheet, type WarTowerGun } from './contract.js';
import type { WarFile } from './war.js';

/** Стройка, идущая сейчас: тип, до какого уровня и сколько работы на ней сервер подтверждает. */
export interface TownSite {
  type: string;
  level: number;
  done: number;
}

export interface TownBook {
  /** Когда сервер впервые встретил игрока и минута последней записи книги. */
  since: number;
  at: number;
  /** Подтверждённые уровни по типам. */
  levels: Counts;
  site: TownSite | null;
  /** Работа стройки, которую посёлок мог сделать, а книга ещё не потратила; не больше `CREDIT_HOLD_MS` потолка. */
  credit: number;
  /** Подтверждённые жители. */
  pop: number;
  /** Прирост, который мог набежать, а книга ещё не потратила: голова приходит целиком, когда наберётся (`GROW_HOLD`). */
  grow: number;
  /** Учеников в очереди казарм — сколько из них сервер признаёт взятыми из жителей. */
  queued: number;
  /** Сколько тел ушло из войска не на войне (роспуск, уход, плен): они могут вернуться жителями. */
  freed: number;
  /** Вестей в запасе (почтой приходит не больше `LETTER_SLOTS` разом и одна за `LETTER_PAUSE_MIN`). */
  letters: number;
  /** Номер последней записи книги алмазов, которую книга учла. */
  gem: number;
  /** Уровни, ускоренные за алмазы и ещё не подтверждённые: `тип:уровень`. */
  paid: string[];
  /**
   * Очередь стройки последней описи, которую книга признала (СТ-1): `тип:уровень` по порядку, первое — строящееся. Места,
   * нарушившие правила очереди (`queueFaults`), сюда не ложатся. По ней ускорение за алмазы отказывает ждущему
   * (`rushFloor`). Пусто — очереди нет или опись до очереди.
   */
  queue: string[];
  /** Наибольшие подтверждённые жители и мощь войска — к минуте `at`, для «не меньше» (`floorAt`). */
  peak: { pop: number; power: number };
}

/** Во сколько раз подтверждённая стройка и прирост могут обогнать потолок правил — как у книги войска (`BOOK_SLACK`). */
export const TOWN_SLACK = 2;

/** Сколько потолка стройки копилка держит про запас: смена стройки между записями, дробь. Моё число. */
export const CREDIT_HOLD_MS = 10 * 60_000;

/** Отставание стройки, после которого заявленное — флаг: столько работы потолка за это время. Моё число. */
export const BUILT_FLAG_MS = 30 * 60_000;

/** Сколько жителей сверх подтверждённого — ещё не флаг: дробь прироста, доля вести. */
export const PEOPLE_SLACK = 3;

/**
 * Какую долю «наибольшего» жителей и мощи книга отпускает за игровой день без объяснения — голод, холод, мор, уход,
 * поход на логово, которых сервер не видит. Моё число: голод и мор берут по 3–5 % за удар, уход при худшей морали —
 * 3.5 % в день; 15 % — с запасом, и за сутки настоящего времени «наибольшее» сходит на нет.
 */
export const FLOOR_FALL = 0.15;

/** Сколько голов прироста копилка держит про запас: прирост копит дробь и выдаёт голову целиком (`sim/population`). */
export const GROW_HOLD = 2;

/** Сколько уровней-«оплачено» книга помнит: больше построек в игре нет, и каждая ускоряется по уровню за раз. */
const PAID_MAX = 200;

const TYPES = Object.keys(BUILDING_BY_ID) as BuildingTypeId[];
const top = (type: BuildingTypeId): number => Math.min(BUILDING_BY_ID[type].maxLevel ?? MAX_BUILDING_LEVEL, MAX_BUILDING_LEVEL);

/** Новая книга: посёлок новой партии — всё первого уровня, `START_POP` жителей (`createInitialState`). */
export const seedTown = (at: number): TownBook => ({
  since: at,
  at,
  levels: Object.fromEntries(TYPES.map((t) => [t, 1])),
  site: null,
  credit: 0,
  pop: START_POP,
  grow: 0,
  queued: 0,
  freed: 0,
  letters: LETTER_SLOTS,
  gem: 0,
  paid: [],
  queue: [],
  peak: { pop: START_POP, power: 0 },
});

const n0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Книга из записи наблюдения; нет или испорчена — `null`. */
export function readTown(v: unknown): TownBook | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const since = n0(r.since);
  const at = n0(r.at);
  if (since <= 0 || at <= 0) return null;
  const s = (r.site && typeof r.site === 'object' ? r.site : null) as Record<string, unknown> | null;
  const site =
    s && typeof s.type === 'string' && (has(BUILDING_BY_ID, s.type) || hasGone([s.type])) && Number.isInteger(s.level)
      ? { type: s.type, level: Math.floor(n0(s.level)), done: n0(s.done) }
      : null;
  const peak = (r.peak && typeof r.peak === 'object' ? r.peak : {}) as Record<string, unknown>;
  return foldBook({
    since,
    at,
    levels: readCounts(r.levels),
    site,
    credit: n0(r.credit),
    pop: Math.floor(n0(r.pop)),
    grow: Math.min(GROW_HOLD, n0(r.grow)),
    queued: Math.floor(n0(r.queued)),
    freed: Math.floor(n0(r.freed)),
    letters: Math.min(LETTER_SLOTS, n0(r.letters)),
    gem: Math.floor(n0(r.gem)),
    paid: Array.isArray(r.paid) ? r.paid.filter((x): x is string => typeof x === 'string' && x.length <= 48).slice(-PAID_MAX) : [],
    queue: Array.isArray(r.queue) ? r.queue.filter((x): x is string => typeof x === 'string' && x.length <= 48).slice(0, BUILD_QUEUE_MAX) : [],
    peak: { pop: n0(peak.pop), power: n0(peak.power) },
  });
}

/**
 * Книга после перехода ЗД-1 — тем же правилом, что опись и партия (`yardmerge.foldTown`): уровень двора — больший из двух
 * подтверждённых, очередь и идущая стройка — без ушедших построек, стройка обеих частей на один уровень — одной стройкой
 * двора. Уровни, ускоренные за алмазы и ещё не подтверждённые, переходят на двор: «Загон 4» — это «Ферма 4». Книга без
 * ушедших построек проходит тем же объектом.
 */
export function foldBook(book: TownBook): TownBook {
  const queue = book.queue.map((k) => {
    const i = k.lastIndexOf(':');
    return { type: k.slice(0, i), level: Number(k.slice(i + 1)) };
  });
  const t = foldTown({ levels: book.levels, queue, site: book.site });
  const paid = book.paid.map((k) => {
    const i = k.lastIndexOf(':');
    return hasGone([k.slice(0, i)]) ? keyOf(keptType(k.slice(0, i))!, Number(k.slice(i + 1))) : k;
  });
  if (t.levels === book.levels && paid.every((k, i) => k === book.paid[i])) return book;
  return {
    ...book,
    levels: t.levels as Counts,
    site: t.site ? { type: t.site.type, level: t.site.level, done: t.site.done } : null,
    queue: (t.queue ?? []).map((e) => keyOf(e.type, e.level)),
    paid: [...new Set(paid)],
  };
}

// ------------------------------------------------ стройка ---

/** Что заявила опись о стройке: уровни, жители, невольники, очередь казарм и идущая стройка. */
export interface TownClaim {
  buildings: Counts;
  pop: number;
  bonded?: number;
  queued?: number;
  site?: TownSite;
  queue?: { type: string; level: number }[];
  /**
   * Множитель Старосты подтверждённого совета (РТ-1, `watch.councilMult`): стройка под его рукой быстрее, и потолок стройки
   * растёт той же долей. Нет — единица.
   */
  steward?: number;
  /**
   * Множитель прироста от сословий (РТ-2, `watch.estateCeilOf`: крестьянство в силе по подтверждённым уровням и привилегиям,
   * лояльность сверху): потолок жителей растёт той же долей. Нет — единица.
   */
  growth?: number;
}

/** Уровень, ускоренный за алмазы: из записи книги алмазов. */
export interface PaidLevel {
  n: number;
  building: string;
  level: number;
}

/** Руки стройки: подтверждённые жители и невольники, но невольников — не больше жителей. */
const handsOf = (pop: number, bonded: number): number => Math.max(0, pop) + Math.min(Math.max(0, bonded), Math.max(0, pop));

/**
 * Потолок скорости стройки на промежуток: уровни ратуши и Мастерской — подтверждённые, но на уровень выше, если опись их
 * подняла (уровень мог достроиться посреди промежутка); руки — подтверждённые жители.
 */
function rateOf(levels: Counts, claim: Counts, hands: number, steward = 1): number {
  const at: Counts = { ...levels };
  for (const t of ['town_hall', 'workshop'] as const) at[t] = Math.min(levelIn(claim, t), levelIn(levels, t) + 1, top(t));
  for (const t of ['town_hall', 'workshop'] as const) at[t] = Math.max(at[t], levelIn(levels, t));
  return buildCeil(at, hands, steward);
}

export const keyOf = (type: string, level: number): string => `${type}:${level}`;

// ------------------------------------------------ очередь стройки ---

/** Нарушение правил очереди стройки в описи (СТ-1): какое место и почему. */
export interface QueueFault {
  key: string;
  why: string;
}

/**
 * Правила очереди стройки одной описи (СТ-1, docs/ui_v2.md) — те же, что держит игра (`derived.upgradeInfo`,
 * `sim/actions.moveBlock`): не длиннее `BUILD_QUEUE_MAX`; одна стройка на постройку; место — следующий уровень постройки
 * описи и не выше её потолка; первое место — идущая стройка описи. `prev` — прежняя опись: её строящееся с работой
 * (`site.done > 0`), если оно ещё не достроено и не отменено, обязано остаться первым — начатое не сдвигается.
 */
export function queueFaults(claim: TownClaim, prev?: { site?: TownSite | null }): QueueFault[] {
  const q = claim.queue ?? [];
  const out: QueueFault[] = [];
  const seen = new Set<string>();
  q.forEach((e, i) => {
    const key = keyOf(e.type, e.level);
    if (i >= BUILD_QUEUE_MAX) out.push({ key, why: `${i + 1}-е место при очереди в ${BUILD_QUEUE_MAX}` });
    else if (!has(BUILDING_BY_ID, e.type)) out.push({ key, why: 'такой постройки нет' });
    else if (seen.has(e.type)) out.push({ key, why: 'вторая стройка той же постройки' });
    else if (e.level !== levelIn(claim.buildings, e.type as BuildingTypeId) + 1 || e.level > top(e.type as BuildingTypeId)) {
      out.push({ key, why: `уровень не следующий: постройка ур. ${levelIn(claim.buildings, e.type as BuildingTypeId)}` });
    }
    seen.add(e.type);
  });
  const s = claim.site;
  if (s && q.length > 0 && keyOf(q[0].type, q[0].level) !== keyOf(s.type, s.level)) out.push({ key: keyOf(s.type, s.level), why: 'идущая стройка не первая в очереди' });
  const was = prev?.site;
  if (was && was.done > 0 && q.length > 0) {
    const key = keyOf(was.type, was.level);
    const at = q.findIndex((e) => keyOf(e.type, e.level) === key);
    if (at > 0) out.push({ key, why: `начатая стройка сдвинута на ${at + 1}-е место` });
  }
  return out;
}

/** Очередь, которую книга признаёт: места описи без нарушивших правила, порядком описи. */
export function queueOf(claim: TownClaim, faults: readonly QueueFault[]): string[] {
  const bad = new Set(faults.map((f) => f.key));
  return (claim.queue ?? [])
    .map((e) => keyOf(e.type, e.level))
    .filter((k) => !bad.has(k))
    .slice(0, BUILD_QUEUE_MAX);
}

export interface BuildStep {
  book: TownBook;
  /** Работа, которой не хватило на заявленные уровни: больше `BUILT_FLAG_MS` потолка — флаг. */
  short: number;
  /** Потолок скорости стройки на промежутке — для слов флага. */
  rate: number;
  /** Нарушения правил очереди стройки в описи (`queueFaults`): такие места книга не признаёт, сервер пишет флаг. */
  faults: QueueFault[];
}

/**
 * Стройка после записи партии в минуту `at`: какие уровни сервер подтверждает. Порядок:
 *  1. уровни, заявленные ниже подтверждённых, — за описью вниз (событие, падение отняли уровень);
 *  2. уровни, ускоренные за алмазы (`gems` новее `book.gem`), подтверждаются без работы;
 *  3. остальные — работой: копилка плюс потолок за прошедшее время с запасом, плюс вести (`EVENT_WORK_MAX` труда
 *     уровня на весть); каждому уровню последние пять минут — даром;
 *  4. идущая стройка — её работа не больше оставшегося.
 * `hands` — руки стройки (жители и невольники, `handsOf`). `before` — идущая стройка прежней описи: по ней очередь знает,
 * какое строящееся уже начато (`queueFaults`).
 */
export function buildStep(prev: TownBook, at: number, claim: TownClaim, gems: readonly PaidLevel[] = [], before?: TownSite): BuildStep {
  const dt = Math.max(0, at - prev.at);
  let letters = Math.min(LETTER_SLOTS, prev.letters + dt / LETTER_PAUSE_MIN);
  let gem = prev.gem;
  const paid = new Set(prev.paid);
  for (const g of gems) {
    if (g.n <= prev.gem) continue;
    gem = Math.max(gem, g.n);
    paid.add(keyOf(g.building, g.level));
  }
  const rate = rateOf(prev.levels, claim.buildings, handsOf(prev.pop, claim.bonded ?? 0), claim.steward);
  let work = prev.credit + rate * gameSecondsOfMs(dt) * TOWN_SLACK;
  const free = rushFreeWork();
  const levels: Counts = {};
  let site = prev.site;
  let short = 0;
  for (const type of TYPES) {
    const want = Math.min(levelIn(claim.buildings, type), top(type));
    let lv = Math.min(levelIn(prev.levels, type), want);
    while (lv < want) {
      const l = lv + 1;
      const k = keyOf(type, l);
      const mine = site && site.type === type && site.level === l ? site : null;
      if (paid.has(k)) {
        paid.delete(k);
      } else {
        const full = upgradeWork(BUILDING_BY_ID[type], l);
        let need = Math.max(0, full - free - (mine?.done ?? 0));
        if (need > work && letters >= 1) {
          const k2 = Math.min(Math.floor(letters), Math.ceil((need - work) / (EVENT_WORK_MAX * full)));
          letters -= k2;
          need = Math.max(0, need - k2 * EVENT_WORK_MAX * full);
        }
        if (need > work) {
          // Остальное не подтверждается: сколько не хватило до заявленного — для флага.
          short += need - work;
          for (let m = l + 1; m <= want; m++) short += Math.max(0, upgradeWork(BUILDING_BY_ID[type], m) - free);
          break;
        }
        work -= need;
      }
      if (mine) site = null;
      lv = l;
    }
    if (lv > 0) levels[type] = lv;
    if (site && site.type === type && site.level !== lv + 1) site = null;
  }
  const s = claim.site;
  if (s && s.type in BUILDING_BY_ID && s.level === levelIn(levels, s.type as BuildingTypeId) + 1 && s.level <= top(s.type as BuildingTypeId)) {
    const was = site && site.type === s.type && site.level === s.level ? site.done : 0;
    const done = Math.max(0, Math.min(s.done, was + work, upgradeWork(BUILDING_BY_ID[s.type as BuildingTypeId], s.level)));
    work -= Math.max(0, done - was);
    site = { type: s.type, level: s.level, done };
  } else {
    site = null;
  }
  const credit = Math.min(Math.max(0, work), rate * gameSecondsOfMs(CREDIT_HOLD_MS));
  // Очередь (СТ-1): опись без неё (до очереди) — книга помнит одну идущую стройку, как раньше.
  // Начатое — по прежней описи (`before`): её строящееся с работой; нет её — по книге.
  const faults = claim.queue ? queueFaults(claim, { site: before ?? prev.site }) : [];
  const queue = claim.queue ? queueOf(claim, faults) : site ? [keyOf(site.type, site.level)] : [];
  return {
    book: { ...prev, at, levels, site, credit, letters, gem, paid: [...paid].slice(-PAID_MAX), queue },
    short,
    rate,
    faults,
  };
}

/** Флаг стройки: не хватило больше, чем потолок сделал бы за `BUILT_FLAG_MS`. */
export const builtForged = (step: BuildStep): boolean => step.short > step.rate * gameSecondsOfMs(BUILT_FLAG_MS);

// ------------------------------------------------ жители ---

/** Что войско сделало за ту же запись (книга войска): тел было и стало, сколько пало на войне и их мощь. */
export interface ArmyMove {
  before: number;
  after: number;
  dead: number;
  power: number;
  deadPower: number;
}

export interface PeopleStep {
  book: TownBook;
  /** Жителей заявлено сверх подтверждённого (за вычетом `PEOPLE_SLACK`). */
  forged: number;
}

/**
 * Жители после записи партии (после `buildStep` — жильё уже подтверждённых уровней). `prevAt` — минута прежней записи
 * книги; `file` — запись войн: уведённые лазутчиком у соседа и падения своего города за промежуток.
 */
export function peopleStep(prev: TownBook, prevAt: number, claim: TownClaim, army: ArmyMove, file: WarFile | null, key: string): PeopleStep {
  const at = prev.at;
  const days = gameDaysOfMs(Math.max(0, at - prevAt));
  const want = Math.max(0, Math.floor(claim.pop));
  const natural = Math.min(
    prev.grow + popGrowthCeil(prev.pop, days, POP_RATE_MAX * TOWN_SLACK * Math.max(1, claim.growth ?? 1)),
    Math.max(0, housingOf(prev.levels) - prev.pop) + 1,
  );
  const back = Math.max(0, prev.queued - Math.max(0, claim.queued ?? 0));
  let lured = 0;
  let fell = 0;
  for (const sp of file?.spies ?? []) if (sp.atk === key && sp.out && sp.out.at > prevAt && sp.out.at <= at) lured += sp.out.lured ?? 0;
  for (const w of file?.wars ?? []) if (w.def === key && w.fall && w.fall.at > prevAt && w.fall.at <= at) fell += w.fall.popLost;
  let freed = prev.freed + Math.max(0, army.before - army.after - army.dead);
  let letters = prev.letters;
  let pop = Math.min(want, Math.floor(prev.pop + natural + back + lured));
  const grow = Math.min(GROW_HOLD, Math.max(0, natural - Math.max(0, pop - prev.pop - back - lured)));
  if (want > pop && freed > 0) {
    const take = Math.min(freed, want - pop);
    freed -= take;
    pop += take;
  }
  if (want > pop && letters >= 1) {
    const each = crowdMax(prev.pop + army.after);
    const k = Math.min(Math.floor(letters), Math.ceil((want - pop) / each));
    letters -= k;
    pop = Math.min(want, pop + k * each);
  }
  // Ученики — из жителей: сервер признаёт в очереди не больше, чем жителей убыло.
  const queued = Math.min(Math.max(0, claim.queued ?? 0), prev.queued + Math.max(0, prev.pop - pop));
  const fall = Math.pow(1 - FLOOR_FALL, days);
  const peak = {
    pop: Math.max(pop, prev.peak.pop * fall - fell),
    power: Math.max(army.power, prev.peak.power * fall - army.deadPower),
  };
  const forged = Math.max(0, want - pop - Math.max(PEOPLE_SLACK, Math.ceil(pop * 0.02)));
  return { book: { ...prev, pop, grow, queued, freed: Math.min(freed, 1e6), letters, peak }, forged };
}

// ------------------------------------------------ что читает война ---

/** «Не меньше» в минуту `at`: наибольшее, спущенное допуском за прошедшее с записи книги. */
export function floorAt(book: TownBook, at: number): { pop: number; power: number } {
  const fall = Math.pow(1 - FLOOR_FALL, gameDaysOfMs(Math.max(0, at - book.at)));
  return { pop: Math.floor(book.peak.pop * fall), power: book.peak.power * fall };
}

/**
 * Слепок обороны, приведённый к книге стройки (`war.liveSheet`): уровни — не выше подтверждённых; жители — не больше
 * подтверждённых; склад и хлеб — не больше склада, тайник — не больше тайника подтверждённых уровней; ополчение — не
 * больше обороны подтверждённых построек и жителей при наибольшей стойкости веры (`build.defenseOf`), башня — не больше
 * мест подтверждённой башни; расход хлеба — не меньше пола игры (`eatFloorOf`). `homePower` — мощь подтверждённого
 * войска дома.
 */
export function townSheet(sheet: WarSheet, book: TownBook, homePower: number): WarSheet {
  const levels: Counts = {};
  for (const [k, v] of Object.entries(sheet.levels)) {
    const n = has(BUILDING_BY_ID, k) ? Math.min(v, levelIn(book.levels, k as BuildingTypeId)) : 0;
    if (n > 0) levels[k] = n;
  }
  const cap = storageOf(book.levels);
  const stock: Counts = {};
  for (const [k, v] of Object.entries(sheet.stock)) if (v > 0) stock[k] = Math.min(v, cap);
  const pop = Math.min(sheet.pop, book.pop);
  const ceil = militiaOf(defenseOf(book.levels, book.pop, homePower, STEADFAST_MAX), homePower);
  const militia = Math.min(sheet.militia, ceil);
  const eat = eatFloorOf(pop, sheet.bonded);
  const tower = ruleTower(sheet.tower, levelIn(book.levels, 'tower'));
  const { tower: _claimed, ...rest } = sheet;
  return {
    ...rest,
    ...(tower ? { tower } : {}),
    ...(sheet.watch ? { watch: ruleWatch(sheet.watch, levelIn(book.levels, 'watch')) } : {}),
    townPerHour: Math.max(sheet.townPerHour, eat.townPerHour),
    perManPerHour: Math.max(sheet.perManPerHour, eat.perManPerHour),
    levels,
    stock,
    food: Math.min(sheet.food, cap),
    stash: Math.min(sheet.stash, stashAt(levelIn(book.levels, 'cache'))),
    pop,
    militia,
    archers: Math.min(sheet.archers, militia, towerArchersAt(levelIn(book.levels, 'tower'))),
  };
}

/**
 * Пол расхода хлеба в осаде, в час мира (docs/security.md, ЗЩ-2): жители и невольники слепка и один боец при наименьшем
 * пайке игры (`build.eatFloorPerDay`), тем же переводом в час, что у моста (`world/bridge`: `gameDaysPerHour`). Расход
 * слепка ниже — невозможное: слепок обороны берёт пол (`townSheet`), запись партии — флаг «расход хлеба ниже правил».
 */
export function eatFloorOf(pop: number, bonded: number): { townPerHour: number; perManPerHour: number } {
  const day = eatFloorPerDay(Math.max(0, pop) + Math.max(0, bonded));
  const hour = gameDaysPerHour();
  return { townPerHour: day.town * hour, perManPerHour: day.man * hour };
}

/** Самая скрытная гибель, самая незаметная неудача и самый короткий плен лазутчика, какие дают навыки и черты игры. */
const VEIL_MIN = veilAt(MAX_AGENT_LEVEL);
const STEALTH_MAX = stealthAt(MAX_AGENT_LEVEL);
const HELD_MIN = TRAITS.reduce((m, t) => (t.effect.held !== undefined && t.effect.held < 1 ? m * t.effect.held : m), 1);

/**
 * Тайная служба слепка в пределах правил (docs/security.md, ЗЩ-2): Дозор — не выше подтверждённого уровня (`build.keenAt`),
 * скрытность, незаметность и плен своего лазутчика — не лучше, чем дают высший уровень агента и черты (`world/peril.veilAt`,
 * `sim/agents.stealthAt`, черта «сколько держат»). Честная служба не меняется: её числа — те же двери.
 */
export function ruleWatch(w: SpyWatch, watchLevel: number): SpyWatch {
  return {
    ...w,
    keen: Math.min(w.keen, keenAt(watchLevel)),
    veil: Math.max(w.veil, VEIL_MIN),
    stealth: Math.min(w.stealth, STEALTH_MAX),
    held: Math.max(w.held, HELD_MIN),
  };
}

/**
 * Орудие башни в пределах правил (docs/security.md, ЗЩ-2): только орудие из таблицы игры (`data/engines`), которому хватает
 * подтверждённого уровня башни, с его силой и расчётом; мест — не больше, чем у башни этого уровня (`build.towerSeatsAt`).
 * Не из таблицы — орудия нет: башня бьёт по лагерю только тем, что игра могла поставить.
 */
export function ruleTower(gun: WarTowerGun | undefined, towerLevel: number): WarTowerGun | undefined {
  if (!gun) return undefined;
  const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
  const def = ENGINES.find((e) => e.level <= towerLevel && same(e.slow, gun.slow) && same(e.thin, gun.thin) && e.crew === gun.crew);
  if (!def) return undefined;
  return { ...gun, seats: Math.min(gun.seats, towerSeatsAt(towerLevel)) };
}

// ------------------------------------------------ ускорение за алмазы ---

/**
 * Сколько работы стройки `type` до уровня `level` наверняка осталось в минуту `at` — по книге: полный труд уровня минус
 * всё, что посёлок мог сделать (подтверждённая работа этой стройки, копилка и потолок за время с записи книги с запасом,
 * за вычетом труда недостроенных уровней ниже). Честный остаток не меньше — цена ускорения по нему не выше показанной.
 * `null` — такой стройки быть не может: уровень уже подтверждён или выше потолка постройки. Уровень через несколько
 * выше подтверждённого не отказ (опись могла не успеть показать достроенное): труд недостроенных ниже вычитается из
 * того, что посёлок мог сделать, а ускоренный уровень книга подтверждает только поверх подтверждённых ниже.
 */
export function rushFloor(book: TownBook, claimed: Counts, bonded: number, type: BuildingTypeId, level: number, at: number, steward = 1): number | null {
  const conf = levelIn(book.levels, type);
  if (!Number.isInteger(level) || level <= conf || level > top(type)) return null;
  const free = rushFreeWork();
  const rate = rateOf(book.levels, claimed, handsOf(book.pop, bonded), steward);
  let work = book.credit + rate * gameSecondsOfMs(Math.max(0, at - book.at)) * TOWN_SLACK;
  // Ускоряется только строящееся (СТ-1): места очереди книги впереди этого должны были успеть достроиться — их труд
  // вычитается из того, что посёлок мог сделать стройкой за время с записи; не успели бы — это ждущее, и ускорению отказ.
  // Запас вестей сюда не идёт: весть кладёт труд в строящееся, а запись партии после ответа уходит сразу (`SAVE_HURRY_MS`),
  // и книга узнаёт о достроенном за минуту. Места нет в очереди книги — его заложили после записи: оно в хвосте.
  const ahead = book.queue.indexOf(keyOf(type, level));
  for (const k of ahead < 0 ? book.queue : book.queue.slice(0, ahead)) {
    const [t, l] = k.split(':');
    const lv = Number(l);
    if (!has(BUILDING_BY_ID, t) || !Number.isInteger(lv) || lv <= levelIn(book.levels, t as BuildingTypeId)) continue;
    const done = book.site && book.site.type === t && book.site.level === lv ? book.site.done : 0;
    work -= Math.max(0, upgradeWork(BUILDING_BY_ID[t as BuildingTypeId], lv) - free - done);
    if (work < 0) return null;
  }
  work += book.letters * EVENT_WORK_MAX * upgradeWork(BUILDING_BY_ID[type], level);
  const paid = new Set(book.paid);
  for (let l = conf + 1; l < level; l++) {
    if (paid.has(keyOf(type, l))) continue;
    const done = book.site && book.site.type === type && book.site.level === l ? book.site.done : 0;
    work -= Math.max(0, upgradeWork(BUILDING_BY_ID[type], l) - free - done);
  }
  const done = (book.site && book.site.type === type && book.site.level === level ? book.site.done : 0) + Math.max(0, work);
  return Math.max(0, upgradeWork(BUILDING_BY_ID[type], level) - done);
}
