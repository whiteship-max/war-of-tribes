/**
 * Допуск разовых дел (AC-1 аудита; решение владельца — docs/audit/OWNER-DECISIONS.md, п. 2). Прежде любое разовое дело
 * между двумя описями выключало сверку роста склада и войска и нижнюю границу книги запасов: счётчик `deeds` присылает
 * клиент, и прибавка единицы на каждой записи давала любой склад без флага и прятала склад от налётчика. Теперь сверки
 * идут всегда, а дело прибавляет к допуску столько, сколько оно может дать или снять по данным игры, — таблицей наград
 * (`src/game/data/deedgain.ts`, выведена из данных с запасом ×1.2, тест сверяет её с данными).
 *
 *  · Дела делятся по счётчикам описи: бои (победы, логова, набеги — груз отряда и трофеи у ворот), поражения, промыслы
 *    (доля дневной выработки), указы (по книге указов, если она дана, иначе потолок указа), дела лавки (лот), добро без дела
 *    (`windfalls`, АУ-8 п. 8: продажа — книгой рынка, дань войны и кража у соседа — записью войн; прочее — склад до вместимости,
 *    казна — грузом бойцов и выплатой договора по таблице) и «прочее»
 *    (вести и вести державы, задания, ежедневка, охота, покупка, разведка) — таблицей.
 *  · Опись без счётчика добра без дела (старый клиент) — прочее без потолка: как было до AC-1, ложных флагов нет.
 *  · Счёт дел быстрее `DEEDS_PER_MIN_MAX` в минуту — флаг «дела» (`deedsFlag`), и в допуск идёт не больше этого счёта.
 *
 * Чистый: без хранилища и без часов. Зовут `watch.flagsBetween` (рост) и `goods.goodsStep` (убыль).
 */
import { RESOURCE_IDS, START_POP } from '../../src/game/constants.js';
import { storageOf } from '../../src/game/build.js';
import { DEED_TABLE, type Row } from '../../src/game/data/deedgain.js';
import { BONDED_GOOD } from '../../src/game/data/market.js';
import { GRANT_MAX, STOCK_KEYS, type AdminGrant, type Counts, type WatchCard } from './contract.js';

/** Сколько разовых дел в минуту может набрать честная партия, прежде чем это флаг (решение владельца, п. 2). */
export const DEEDS_PER_MIN_MAX = 30;

const RESOURCES = new Set<string>(RESOURCE_IDS);

/** Что сервер знает о делах промежутка сам: указы админа из книги указов, добро без дела по записи войн, книга невольников. */
export interface DeedKnown {
  grants?: readonly (Pick<AdminGrant, 'n' | 'troops'> & { stock?: AdminGrant['stock'] })[];
  /**
   * Добро без дела, которое сервер знает по записи войн (АУ-8, п. 8; `watch.windfallKnown`): дань войны и кража лазутчика у
   * соседа, принятые клиентом между описями, — точно, по разу. Нет — их в промежутке нет.
   */
  windfall?: WindfallKnown;
  /** Невольники книги невольников до записи (АУ-8, п. 2): выручка продажи невольников — не больше их. Нет — без потолка. */
  bonded?: number;
}

/** Добро без дела из записи войн: склад, казна и сколько это дел. */
export interface WindfallKnown {
  stock: Counts;
  gold: number;
  items: number;
}

/**
 * Выручка продаж промежутка — книгой рынка (АУ-8, п. 8): золото новых сделок описи с `n < 0` (цену каждой сверяет правило
 * «market»). Невольники — не больше книги невольников и купленных за промежуток: продажу сверх книги сервер не принимает
 * (п. 2), и её золото не подтверждается.
 */
function salesOf(a: WatchCard, b: WatchCard, bonded: number | undefined): { gold: number; deals: number } {
  const from = a.market?.seq ?? 0;
  let gold = 0;
  let deals = 0;
  let bondedSold = 0;
  let bondedGold = 0;
  let bondedBought = 0;
  for (const d of b.market?.deals ?? []) {
    if (d.seq <= from) continue;
    if (d.good === BONDED_GOOD.id && d.n > 0) bondedBought += d.n;
    if (d.n >= 0) continue;
    deals++;
    if (d.good === BONDED_GOOD.id) {
      bondedSold += -d.n;
      bondedGold += Math.max(0, d.gold);
    } else gold += Math.max(0, d.gold);
  }
  if (bondedSold > 0) {
    const ok = bonded === undefined ? bondedSold : Math.min(bondedSold, Math.max(0, bonded) + bondedBought + 1);
    gold += (bondedGold * ok) / bondedSold;
  }
  return { gold, deals };
}

/** Сколько дел каждого вида между двумя описями. `windfalls` — `null`, если опись старая и счётчика не везёт. */
export interface DeedSplit {
  fights: number;
  lost: number;
  games: number;
  grants: number;
  shop: number;
  windfalls: number | null;
  other: number;
  /** Сколько караванов могло прийти: в пути на первой описи и купленные между ними (покупка — прочее дело). */
  arrived: number;
}

const up = (a: number | undefined, b: number | undefined): number => Math.max(0, (b ?? 0) - (a ?? 0));

/** Сколько дел засчитывается в допуск: не больше `DEEDS_PER_MIN_MAX` в минуту настоящего времени, но не меньше минуты. */
export const deedsAllowed = (realMs: number): number => DEEDS_PER_MIN_MAX * Math.max(1, realMs / 60_000);

/** Дела промежутка по видам. Указы и дела лавки сервер знает сам — в счёт скорости они не идут. */
export function deedSplit(a: WatchCard, b: WatchCard, realMs: number): DeedSplit {
  const all = up(a.deeds, b.deeds);
  const fights = up(a.won, b.won) + up(a.lairs, b.lairs) + up(a.raids, b.raids);
  const lost = up(a.lost, b.lost);
  const games = up(a.games, b.games);
  const grants = up(a.seen, b.seen);
  const shop = up(a.gemSeen, b.gemSeen);
  const windfalls = a.windfalls === undefined || b.windfalls === undefined ? null : up(a.windfalls, b.windfalls);
  const other = Math.max(0, all - fights - lost - games - grants - shop - (windfalls ?? 0));
  // Сверх скорости — в допуск не больше разрешённого: доля каждого вида, который присылает клиент, урезается поровну.
  const counted = all - grants - shop;
  const k = counted > 0 ? Math.min(1, deedsAllowed(realMs) / counted) : 1;
  const cut = (n: number): number => Math.ceil(n * k);
  return {
    fights: cut(fights),
    lost: cut(lost),
    games: cut(games),
    grants,
    shop,
    windfalls: windfalls === null ? null : cut(windfalls),
    other: cut(other),
    arrived: Math.max(0, a.caravans) + cut(other),
  };
}

/** Флаг «дела»: счёт дел (без указов и лавки — их сервер знает сам) обогнал `DEEDS_PER_MIN_MAX` в минуту. Нет — `null`. */
export function deedsFlag(a: WatchCard, b: WatchCard, realMs: number): { counted: number; allowed: number } | null {
  const counted = up(a.deeds, b.deeds) - up(a.seen, b.seen) - up(a.gemSeen, b.gemSeen);
  const allowed = Math.floor(deedsAllowed(realMs));
  return counted > allowed ? { counted, allowed } : null;
}

/** Размер посёлка описи — как его считают вести (`eventKit.scale`: жители, войско и новобранцы на стартовые). */
const scaleOf = (c: WatchCard): number => Math.max(1, (c.pop + Object.values(c.troops).reduce((t, n) => t + n, 0) + c.queued) / START_POP);

const rowAt = (r: Row, k: string, scale: number): number => (r.flat[k] ?? 0) + (r.scale[k] ?? 0) * scale;

/** Указы промежутка из книги указов: прибавка и убавка по видам и бойцы. Книги нет — `null`. */
function grantsIn(a: WatchCard, b: WatchCard, known: DeedKnown | undefined): { plus: Counts; minus: Counts; troops: number } | null {
  if (!known?.grants) return null;
  const plus: Counts = {};
  const minus: Counts = {};
  let troops = 0;
  for (const g of known.grants) {
    if (g.n <= (a.seen ?? 0) || g.n > (b.seen ?? 0)) continue;
    for (const [k, v] of Object.entries(g.stock ?? {})) {
      if (!v) continue;
      if (v > 0) plus[k] = (plus[k] ?? 0) + v;
      else minus[k] = (minus[k] ?? 0) - v;
    }
    for (const v of Object.values(g.troops)) if (v && v > 0) troops += v;
  }
  return { plus, minus, troops };
}

/**
 * Сколько дела промежутка могли положить на склад и в казну сверх выработки — по видам `STOCK_KEYS`. `prod` — выработка
 * описи за игровой день (не выше потолка мест, правило «prod»). `Infinity` — дело без потолка (добро без дела в казну,
 * прочее старой описи): сверка вида в этом промежутке не спрашивается.
 */
export function deedGain(a: WatchCard, b: WatchCard, realMs: number, prod: Counts, known?: DeedKnown): Counts {
  const d = deedSplit(a, b, realMs);
  const scale = Math.max(scaleOf(a), scaleOf(b));
  const cap = Math.max(storageOf(a.buildings), storageOf(b.buildings));
  const soldiers = Math.max(...[a, b].map((c) => Object.values(c.troops).reduce((t, n) => t + n, 0) + c.wounded));
  const grants = grantsIn(a, b, known);
  const T = DEED_TABLE;
  // Добро без дела по книгам (АУ-8, п. 8): продажи — книгой рынка, дань войны и кража у соседа — записью войн; что осталось
  // от счётчика — добро мира, которого сервер не видит: склад — до вместимости, казна — грузом бойцов (с ушедшими) и выплатой
  // договора из таблицы. Прежде казна добра без дела была без потолка.
  const sales = d.windfalls ? salesOf(a, b, known?.bonded) : { gold: 0, deals: 0 };
  const wk = known?.windfall ?? { stock: {}, gold: 0, items: 0 };
  const rest = Math.max(0, (d.windfalls ?? 0) - sales.deals - wk.items);
  const carriers = Math.max(...[a, b].map((c) => Object.values(c.troops).reduce((t, n) => t + n, 0) + c.wounded + c.away));
  const out: Counts = {};
  for (const k of STOCK_KEYS) {
    const res = RESOURCES.has(k);
    let n =
      d.other * rowAt(T.gain, k, scale) +
      d.fights * (T.fight.carry * soldiers + (T.fight.scale[k] ?? 0) * scale) +
      d.games * (T.game[k] ?? 0) * Math.max(0, prod[k] ?? 0) +
      (res ? d.shop * T.shop : 0) +
      (grants ? (grants.plus[k] ?? 0) : d.grants * GRANT_MAX) +
      d.arrived * (T.caravan[k] ?? 0);
    if (d.windfalls === null && d.other > 0) n = Infinity;
    else if (d.windfalls)
      n += res ? (wk.stock[k] ?? 0) + rest * cap : sales.gold + wk.gold + rest * (T.windfall.carry * carriers + T.windfall.gold);
    out[k] = n;
  }
  return out;
}

/**
 * Сколько дела промежутка могли снять со склада и казны сверх расхода — по видам. `Infinity` — дело, убыль которого
 * таблица не держит: поражение и бой (набег уносит, сколько унесёт), добро без дела (продажа), старая опись с делами.
 */
export function deedLoss(a: WatchCard, b: WatchCard, realMs: number, known?: DeedKnown): Counts {
  const d = deedSplit(a, b, realMs);
  const scale = Math.max(scaleOf(a), scaleOf(b));
  const grants = grantsIn(a, b, known);
  const T = DEED_TABLE;
  const open = d.lost > 0 || d.fights > 0 || (d.windfalls ?? 0) > 0 || (d.windfalls === null && d.other > 0);
  const out: Counts = {};
  for (const k of STOCK_KEYS) {
    out[k] = open
      ? Infinity
      : d.other * rowAt(T.loss, k, scale) + (grants ? (grants.minus[k] ?? 0) : d.grants * GRANT_MAX);
  }
  return out;
}

/** Сколько бойцов дела промежутка могли привести сверх обучения: вести и указы. */
export function deedTroops(a: WatchCard, b: WatchCard, realMs: number, known?: DeedKnown): number {
  const d = deedSplit(a, b, realMs);
  const scale = Math.max(scaleOf(a), scaleOf(b));
  const grants = grantsIn(a, b, known);
  if (d.windfalls === null && d.other > 0) return Infinity;
  return d.other * (DEED_TABLE.troops.flat + DEED_TABLE.troops.scale * scale) + (grants ? grants.troops : d.grants * GRANT_MAX);
}

/**
 * Сколько невольников бои мира промежутка могли привести (АУ-8, п. 2; книга невольников `goods.bondedStep`): уводимые на
 * бойца (`DEED_TABLE.fight.led` — конвой бойца `world/data/units`, запас ×1.2) на бойцов описи (с ушедшими) за каждое дело боя и добро
 * без дела (падение логова голодом — без боя, но с уведёнными). Мир живёт у клиента, и сервер знает о его боях только
 * счётчики; пленные войны и купленные на рынке — книги сервера, не таблица. Опись без счётчика добра без дела с делами —
 * без потолка (`Infinity`), как у бойцов (`deedTroops`).
 */
export function deedBonded(a: WatchCard, b: WatchCard, realMs: number): number {
  const d = deedSplit(a, b, realMs);
  if (d.windfalls === null && d.other > 0) return Infinity;
  // Бойцы в поле (`away`) — тоже конвой: уводит дружина полководца, а не гарнизон.
  const soldiers = Math.max(...[a, b].map((c) => Object.values(c.troops).reduce((t, n) => t + n, 0) + c.wounded + c.away));
  return (d.fights + (d.windfalls ?? 0)) * DEED_TABLE.fight.led * soldiers;
}
