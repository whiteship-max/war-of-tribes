// Рынок (РН-1, docs/city_v3.md, «Решения РН-1»): единственная дверь сделок и цен рынка (докачкой — с окном рынка; шаг и чтение
// сохранения — `sim/caravan`) — купить и продать любой товар — и караван,
// который везёт купленное.
//
// Покупка не мгновенная. Золото списывается сразу, а груза на складе нет, пока телега не вернётся из ворот: `s.caravans` —
// единственное место, где он в это время числится. **Отмены нет:** заказ уже сбил цену, и отмена с возвратом золота дала бы
// продать своё по сбитой вверх цене даром (купить — продать — отменить). Продажа мгновенная: золото ложится сразу.
//
// Цена — правилами `marketrules` (одними с сервером): штука за штукой, поэтому дробление партии ничего не даёт — ни цены,
// ни запаса. Каждая сделка ложится в счёт привоза, в нажим и в опись сделок (`MarketState.deals`) — по ней книга рынка
// сервера выводит ту же цену и сверяет (правило «market»). Время — настоящая минута `now` (часы партии).
import type { Caravan, GameState, GoodId, MarketState } from '../types';
import { SIEGE_NO_TRADE } from '../constants';
import { stabClamp } from '../stabrules';
import { BONDED_GOOD, GOODS, GOOD_BY_ID, offerFor, type GoodDef } from '../data/market';
import { ORDER_TEXT } from '../data/order';
import {
  BOOST_MAX,
  DEALS_KEPT,
  buyUnit,
  depthOf,
  fromPurse,
  lotOf,
  pressAt,
  purseOf,
  sellUnit,
  specGood,
  shiftOf,
  supplyOf,
  type Lot,
} from '../marketrules';
import { bondedTotal, caravanSeconds, marketLevel, merchantsMult, storageCap, treasurerMult, underSiege } from '../derived';
import { loseBonded } from './population';
import { rollShift } from './caravan';
import { log } from './log';
import { outlay } from './pay';
import { rulerTraitNumbers } from '../rulernow';
import type { RoamState } from '../types';

// ---------- Ключ рынка (ПН-6, ГДД 3.7.1) ----------
//
// Дверь одна, рынков два рода: свой город лорда (`home` — прилавок `s.market`, склад и казна города) и вольный город НПС, у которого
// стоит отряд бродяги (`town:x:y` — номер точки; прилавок `RoamState.markets[ключ]`, обоз и кошель отряда). Правила — те же
// (`marketrules`: привоз, нажим, доля продажи, кошель купцов); уровень вольного города — по его ступени (`townrules.townMarketLevel`),
// стабильности и прибавок выручки у бродяги нет, невольничьего ряда — тоже. Ключ по умолчанию — `home`: у лорда всё как было.

/** Ключ рынка: свой город лорда или вольный город НПС (`town:x:y`; город игрока-хозяина — ПН-14). */
export type MarketKey = 'home' | `town:${string}`;

/**
 * Что рынок знает о вольном городе и обозе отряда — отдаёт кусок пути при загрузке (`sim/roamtown`): уровень рынка по ступени города
 * (`townrules.townMarketLevel` от `world/roampoints.townAt`), вместимость обоза (`cargocap`) и сколько рынков партия помнит. Рынок
 * лорда — в первой загрузке (`sim/actions`), и правила вольных городов в неё не едут; пути нет — у вольных городов рынка нет.
 */
export interface TownSide {
  level(key: MarketKey): number;
  /** Множитель основы товара у вольного города — его специализация (ПН-Э1, `world/townspec.specMult`). */
  spec(key: MarketKey, good: GoodId): number;
  cap(r: RoamState): number;
  keep: number;
}
let townSide: TownSide | null = null;
export const provideTownSide = (t: TownSide): void => {
  townSide = t;
};

/** Уровень рынка по ключу: свой город — уровень здания, вольный — ступень. */
const levelOf = (s: GameState, key: MarketKey): number => (key === 'home' ? marketLevel(s) : (townSide?.level(key) ?? 0));

/** Прилавок рынка по ключу; у вольного города, где не торговали, — нет. */
const stateOf = (s: GameState, key: MarketKey): MarketState | undefined => (key === 'home' ? s.market : s.roam?.markets?.[key]);

/** Кошель покупателя: казна города или кошель отряда. */
const goldOf = (s: GameState, key: MarketKey): number => (key === 'home' ? s.gold : (s.roam?.purse ?? 0));

// ---------- Чтения ----------
//
// Всё, что зависит от привоза, берёт настоящую минуту `now` (часы партии, `net/clock.partyNow`) и считается правилами
// `marketrules`, одними с сервером. Хранится только сделанное игроком (`MarketState`), и счёт другого привоза не считается.
// Чтения живут здесь, а не в `derived`: их читает только окно рынка, и первая загрузка за них не платит.

/**
 * Уровень рынка привоза в минуту `now` (РН-1б): закреплённый на начало привоза (`MarketState.lv`, `sim/caravan.rollShift`), а
 * пока привоз не начат в партии — нынешний. Событие, отнявшее уровень посреди привоза, меняет глубину со следующего.
 */
export function shiftLevel(s: GameState, now: number, key: MarketKey = 'home'): number {
  const m = stateOf(s, key);
  return m && m.w === shiftOf(now) && (m.lv ?? 0) > 0 ? (m.lv as number) : levelOf(s, key);
}

export function marketOf(
  s: GameState,
  now: number,
  key: MarketKey = 'home',
): { w: number; bought: Partial<Record<GoodId, number>>; sold: Partial<Record<GoodId, number>>; got: number } {
  const w = shiftOf(now);
  const m = stateOf(s, key);
  if (!m || m.w !== w) return { w, bought: {}, sold: {}, got: 0 };
  return { w, bought: m.bought ?? {}, sold: m.sold ?? {}, got: Math.max(0, m.got ?? 0) };
}

/**
 * Что привезли в нынешний привоз: товары по месту на прилавке и невольничий ряд — он стоит всегда: продать невольников —
 * рычаг против мятежа, а рычаг, который есть через привоз, рычагом не является. Пусто, пока нет рынка.
 */
export const marketOffer = (s: GameState, now: number, key: MarketKey = 'home'): GoodDef[] => {
  if (levelOf(s, key) <= 0) return [];
  const goods = offerFor(shiftOf(now), shiftLevel(s, now, key), GOODS);
  return key === 'home' ? [...goods, BONDED_GOOD] : goods;
};

/** Привезли ли товар в нынешний привоз. */
export const marketHas = (s: GameState, def: GoodDef, now: number, key: MarketKey = 'home'): boolean =>
  marketOffer(s, now, key).some((g) => g.id === def.id);

/** Глубина рынка товара (`marketrules.depthOf`): на столько штук нажима цена уходит вдвое. Одна во все привозы. */
export const marketDepth = (s: GameState, def: GoodDef, now: number, key: MarketKey = 'home'): number => depthOf(def, shiftLevel(s, now, key));

/** Запас нынешнего привоза (`marketrules.supplyOf`): уровень рынка, ночь, стабильность (у вольного города — ровная), привоз. */
export const marketSupply = (s: GameState, def: GoodDef, now: number, key: MarketKey = 'home'): number =>
  supplyOf(def, shiftLevel(s, now, key), shiftOf(now), key === 'home' ? stabClamp(s.stab?.level ?? 0) : 0);

/** Сколько серебра купцов осталось в этот привоз (`marketrules.purseOf`) — им платят за всё, кроме невольников. */
export const marketPurse = (s: GameState, now: number, key: MarketKey = 'home'): number =>
  Math.max(0, purseOf(shiftLevel(s, now, key)) - marketOf(s, now, key).got);

/** Сколько куплено и продано этого товара в нынешний привоз. */
export const marketBought = (s: GameState, id: GoodId, now: number, key: MarketKey = 'home'): number =>
  Math.max(0, marketOf(s, now, key).bought[id] ?? 0);
export const marketSold = (s: GameState, id: GoodId, now: number, key: MarketKey = 'home'): number =>
  Math.max(0, marketOf(s, now, key).sold[id] ?? 0);

/** Запас рынка: привезённое и проданное торговцам за вычетом купленного; товар, которого не привезли, — только проданное. */
export const marketLeft = (s: GameState, def: GoodDef, now: number, key: MarketKey = 'home'): number =>
  Math.max(
    0,
    (marketHas(s, def, now, key) ? marketSupply(s, def, now, key) : 0) + marketSold(s, def.id, now, key) - marketBought(s, def.id, now, key),
  );

/** Нажим на цену товара в минуту `now` (`marketrules.pressAt`): отходит к нулю сам. */
export function marketPress(s: GameState, id: GoodId, now: number, key: MarketKey = 'home'): number {
  const p = stateOf(s, key)?.press?.[id];
  return p ? pressAt(p[0], p[1], now) : 0;
}

/**
 * Прибавка к выручке рынка: Казначей (РТ-1, `treasurerMult`) и купечество (РТ-2, `merchantsMult`) — те же двери, что у налога;
 * «Торгаш» (черта правителя, ПН-2) — своей долей; потолок — `marketrules.BOOST_MAX`, выше него выручку не поднимает ничто.
 */
export const marketBoost = (s: GameState, key: MarketKey = 'home'): number =>
  key === 'home' ? Math.min(BOOST_MAX, treasurerMult(s) * merchantsMult(s) * (1 + rulerTraitNumbers(s).trade)) : 1;

/** Товар с основой рынка по ключу: свой город — как есть; вольный — по его специализации (ПН-Э1, `marketrules.specGood`). */
const priced = (def: GoodDef, key: MarketKey): GoodDef => (key === 'home' ? def : specGood(def, townSide?.spec(key, def.id) ?? 1));

/** Цена следующей купленной штуки. */
export const marketPrice = (s: GameState, def: GoodDef, now: number, key: MarketKey = 'home'): number =>
  buyUnit(priced(def, key), shiftOf(now), marketDepth(s, def, now, key), marketPress(s, def.id, now, key));

/** Выручка за следующую проданную штуку. */
export const marketSellPrice = (s: GameState, def: GoodDef, now: number, key: MarketKey = 'home'): number =>
  sellUnit(priced(def, key), shiftOf(now), marketDepth(s, def, now, key), marketPress(s, def.id, now, key), marketBoost(s, key));

/** Партия из `n` штук: `n > 0` — покупка, `n < 0` — продажа; поштучно (`marketrules.lotOf`). */
export const marketLot = (s: GameState, def: GoodDef, n: number, now: number, key: MarketKey = 'home'): Lot =>
  lotOf(priced(def, key), shiftOf(now), marketDepth(s, def, now, key), marketPress(s, def.id, now, key), n, marketBoost(s, key));

/** Во что обойдётся партия из `count` штук. */
export const marketCost = (s: GameState, def: GoodDef, count: number, now: number, key: MarketKey = 'home'): number =>
  marketLot(s, def, Math.max(0, count), now, key).gold;

/**
 * Сколько невольников торговцы уведут в этот привоз: не больше, чем приводят, — уводят столько, сколько могут прокормить в
 * дороге. Особое правило ряда; прочий товар берут без счёта, и держит его только цена.
 */
export const bondedSaleLeft = (s: GameState, now: number): number =>
  marketLevel(s) <= 0 ? 0 : Math.max(0, marketSupply(s, BONDED_GOOD, now) - marketSold(s, 'bonded', now));

/** Почём торговцы возьмут следующего невольника — той же дверью, что любой товар. */
export const bondedSalePrice = (s: GameState, now: number): number => marketSellPrice(s, BONDED_GOOD, now);

/** Сколько этого товара у игрока: запас склада, вещь кузни или невольники в городе; у отряда — обоз и снаряжение в обозе. */
export function ownOf(s: GameState, def: GoodDef, key: MarketKey = 'home'): number {
  if (key !== 'home') {
    const r = s.roam;
    if (!r || def.id === BONDED_GOOD.id) return 0;
    return def.resource ? Math.floor(r.cargo[def.resource] ?? 0) : (r.gear[def.equipment!] ?? 0);
  }
  if (def.id === BONDED_GOOD.id) return bondedTotal(s);
  return def.resource ? Math.floor(s.resources[def.resource]) : (s.equipment[def.equipment!] ?? 0);
}

/** Сколько этого товара везут телеги. */
export const inTransit = (s: GameState, id: GoodId): number => s.caravans.reduce((n, c) => n + (c.good === id ? c.count : 0), 0);

/** Сколько ещё влезет на склад с тем, что уже везут; снаряжению и людям склад не нужен. У отряда — место в обозе. */
export function roomFor(s: GameState, def: GoodDef, key: MarketKey = 'home'): number {
  if (!def.resource) return Infinity;
  if (key !== 'home') {
    const r = s.roam;
    if (!r) return 0;
    const load = Object.values(r.cargo).reduce((t: number, n) => t + Math.max(0, n ?? 0), 0);
    return Math.max(0, Math.floor((townSide?.cap(r) ?? 0) - load));
  }
  return Math.max(0, Math.floor(storageCap(s) - s.resources[def.resource]) - inTransit(s, def.id));
}

export interface MarketCheck {
  def: GoodDef | null;
  count: number;
  /** Сколько золота уйдёт на всю партию. */
  cost: number;
  /** Цена первой и последней штуки партии. */
  lot: Lot;
  /** Запас рынка в этот привоз. */
  left: number;
  /** Сколько влезет на склад (с тем, что уже везут). */
  room: number;
  /** Почему нельзя; null — можно покупать. */
  blocked: string | null;
}

const NO_LOT: Lot = { gold: 0, q: 0, first: 0, last: 0 };

/** Всё, что нужно знать до покупки: цена партии, запас привоза, место на складе и причина отказа. */
export function marketCheck(s: GameState, good: GoodId, count: number, now: number, key: MarketKey = 'home'): MarketCheck {
  const def = GOOD_BY_ID[good] ?? null;
  const n = Math.max(1, Math.floor(count));
  if (!def) return { def: null, count: n, cost: 0, lot: NO_LOT, left: 0, room: 0, blocked: 'Такого товара нет.' };
  const left = marketLeft(s, def, now, key);
  const lot = marketLot(s, def, n, now, key);
  const room = roomFor(s, def, key);
  const home = key === 'home';

  let blocked: string | null = null;
  if (home && underSiege(s)) blocked = SIEGE_NO_TRADE;
  else if (levelOf(s, key) <= 0) blocked = ORDER_TEXT.market.noMarket;
  else if (left <= 0) blocked = marketHas(s, def, now, key) ? 'Рынок пуст: всё разобрали до нового привоза.' : 'Рынок пуст: этого не привезли.';
  else if (n > left) blocked = `На рынке только ${left}.`;
  else if (room <= 0) blocked = home ? 'Склад полон.' : 'Обоз полон.';
  else if (n > room) blocked = home ? `На склад влезет только ${room}.` : `В обоз влезет только ${room}.`;
  else if (goldOf(s, key) < lot.gold) blocked = 'Не хватает золота.';

  return { def, count: n, cost: lot.gold, lot, left, room, blocked };
}

export interface SaleCheck {
  def: GoodDef | null;
  count: number;
  /** Сколько золота ляжет в казну. */
  gold: number;
  lot: Lot;
  /** Сколько этого у игрока. */
  have: number;
  /** Сколько торговцы ещё возьмут в этот привоз: невольников — не больше привоза, прочее — без счёта. */
  left: number;
  /** Серебро купцов, что осталось в этот привоз (невольники — мимо него: бесконечность). */
  purse: number;
  /** Почему нельзя; null — можно. */
  blocked: string | null;
}

/**
 * Продажа торговцам: любой товар, в любой привоз. Цена ниже покупной (`marketrules.SALE_SHARE`) и падает с каждой штукой
 * (нажим вниз): купить и перепродать — это отдать разницу. Невольников торговцы уводят не больше, чем приводят
 * (`bondedSaleLeft`) — их особое правило.
 */
export function saleCheck(s: GameState, good: GoodId, count: number, now: number, key: MarketKey = 'home'): SaleCheck {
  const def = GOOD_BY_ID[good] ?? null;
  const n = Math.max(1, Math.floor(count));
  if (!def) return { def: null, count: n, gold: 0, lot: NO_LOT, have: 0, left: 0, purse: 0, blocked: 'Такого товара нет.' };
  const bonded = def.id === BONDED_GOOD.id;
  const have = ownOf(s, def, key);
  const left = bonded ? bondedSaleLeft(s, now) : Infinity;
  const lot = marketLot(s, def, -n, now, key);
  const purse = fromPurse(def.id) ? marketPurse(s, now, key) : Infinity;
  let blocked: string | null = null;
  if (key === 'home' && underSiege(s)) blocked = SIEGE_NO_TRADE;
  else if (levelOf(s, key) <= 0) blocked = ORDER_TEXT.market.noMarket;
  else if (have <= 0) blocked = bonded ? ORDER_TEXT.market.noBonded : 'Продавать нечего.';
  else if (n > have) blocked = bonded ? ORDER_TEXT.market.noBonded : `У тебя только ${have}.`;
  else if (left <= 0) blocked = ORDER_TEXT.market.soldOut;
  else if (n > left) blocked = ORDER_TEXT.market.onlyLeft(left);
  else if (lot.last <= 0) blocked = 'Торговцы не дадут за последнюю и монеты: цена сбита.';
  else if (purse <= 0) blocked = 'У купцов кончилось серебро до нового привоза.';
  else if (lot.gold > purse) blocked = `У купцов осталось ${Math.floor(purse)} серебра — столько не купят.`;
  return { def, count: n, gold: lot.gold, lot, have, left, purse, blocked };
}

/** Наибольшее `n` в 0…`hi`, при котором `ok(n)` (монотонно: подходит `n` — подходит и меньше). */
function most(hi: number, ok: (n: number) => boolean): number {
  let lo = 0;
  let top = Math.max(0, Math.floor(hi));
  while (lo < top) {
    const mid = Math.ceil((lo + top) / 2);
    if (ok(mid)) lo = mid;
    else top = mid - 1;
  }
  return lo;
}

/**
 * «Всё» окна рынка — сколько штук сделка возьмёт разом: покупка — не больше запаса привоза, места на складе и золота; продажа —
 * не больше того, что есть, ряда невольников, кошеля купцов и пока последняя штука стоит хоть монету. Ноль — нельзя ни одной.
 */
export function marketMax(s: GameState, good: GoodId, side: 'buy' | 'sell', now: number, key: MarketKey = 'home'): number {
  const def = GOOD_BY_ID[good];
  if (!def || levelOf(s, key) <= 0 || (key === 'home' && underSiege(s))) return 0;
  if (side === 'buy') {
    const cap = Math.min(marketLeft(s, def, now, key), roomFor(s, def, key));
    return most(cap, (n) => marketLot(s, def, n, now, key).gold <= goldOf(s, key));
  }
  const bonded = def.id === BONDED_GOOD.id;
  const cap = Math.min(ownOf(s, def, key), bonded ? bondedSaleLeft(s, now) : Infinity);
  const purse = fromPurse(def.id) ? marketPurse(s, now, key) : Infinity;
  return most(cap, (n) => {
    const lot = marketLot(s, def, -n, now, key);
    return lot.last > 0 && lot.gold <= purse;
  });
}

/** Кладёт сделку в счёт привоза, нажим и опись — одна запись на обе стороны торга. */
function note(s: GameState, def: GoodDef, n: number, gold: number, now: number, key: MarketKey = 'home'): void {
  const q = marketPress(s, def.id, now, key);
  const m = key === 'home' ? (rollShift(s, now), s.market) : townShift(s, key, now);
  if (n > 0) m.bought = { ...m.bought, [def.id]: marketBought(s, def.id, now, key) + n };
  else m.sold = { ...m.sold, [def.id]: marketSold(s, def.id, now, key) - n };
  if (n < 0 && fromPurse(def.id)) m.got = (m.got ?? 0) + gold;
  m.press = { ...(m.press ?? {}), [def.id]: [q + n, now] };
  m.seq = (m.seq ?? 0) + 1;
  m.deals = [...(m.deals ?? []), { seq: m.seq, at: now, good: def.id, n, gold, q }].slice(-DEALS_KEPT);
}

/**
 * Прилавок вольного города на привоз `now` (ПН-6): новый привоз — счёт купленного, проданного и серебра заново (как `rollShift` у
 * своего города; уровень у вольного не меняется — ступень). Нет прилавка — заводится; городов партия помнит не больше `MARKETS_MAX`.
 */
function townShift(s: GameState, key: MarketKey, now: number): MarketState {
  const r = s.roam!;
  const w = shiftOf(now);
  const was = r.markets?.[key];
  const m: MarketState = was && was.w === w ? was : { ...(was ?? {}), w, bought: {}, sold: {}, got: 0 };
  const rest = Object.entries(r.markets ?? {}).filter(([k]) => k !== key);
  r.markets = Object.fromEntries([...rest.slice(-((townSide?.keep ?? 1) - 1)), [key, m]]);
  return m;
}

/**
 * Купить у вольного города и сразу положить в обоз (ПН-6): отряд стоит в городе, телеги нет. Золото — из кошеля отряда. Отказ — словами.
 */
function buyTown(s: GameState, check: MarketCheck, now: number, key: MarketKey): string | null {
  const r = s.roam!;
  const def = check.def as GoodDef;
  r.purse -= check.cost;
  note(s, def, check.count, check.cost, now, key);
  if (def.resource) r.cargo[def.resource] = (r.cargo[def.resource] ?? 0) + check.count;
  else if (def.equipment) r.gear[def.equipment] = (r.gear[def.equipment] ?? 0) + check.count;
  log(s, `Куплено в городе: ${def.name.toLowerCase()}, ${check.count}, за ${check.cost} золота.`, 'info', `market:town:${def.id}`, 'trade');
  return null;
}

/**
 * Купить у вольного города и сразу потратить — на найм (ПН-6, ГДД 3.4.3: недостающее докупается на рынке города той же кнопкой по
 * цене рынка): золото из кошеля, нажим вверх, в обоз ничего не ложится. Отказ — словами.
 */
export function marketSpend(s: GameState, good: GoodId, count: number, now: number, key: MarketKey): string | null {
  if (key === 'home' || !s.roam) return 'Так покупают только у вольного города.';
  const def = GOOD_BY_ID[good];
  const n = Math.max(0, Math.floor(count));
  if (!def || n <= 0) return null;
  const left = marketLeft(s, def, now, key);
  if (n > left) return `На рынке города ${def.name.toLowerCase()} — только ${left}.`;
  const gold = marketLot(s, def, n, now, key).gold;
  if (s.roam.purse < gold) return 'Не хватает золота.';
  s.roam.purse -= gold;
  note(s, def, n, gold, now, key);
  return null;
}

/**
 * Заказывает товар: списывает золото, сбивает цену вверх и выпускает караван. Груз приедет через `caravanSeconds` игрового
 * времени. У вольного города (ПН-6) — сразу в обоз отряда.
 */
export function buyGoods(s: GameState, good: GoodId, count: number, now: number, key: MarketKey = 'home'): string | null {
  const check = marketCheck(s, good, count, now, key);
  if (check.blocked) return check.blocked;
  if (key !== 'home') return buyTown(s, check, now, key);
  const def = check.def as GoodDef;

  s.gold -= check.cost;
  if (check.cost > 0) outlay(s);
  note(s, def, check.count, check.cost, now);
  const travel = caravanSeconds(s);
  const caravan: Caravan = {
    id: s.nextId++,
    good: def.id,
    count: check.count,
    gold: check.cost,
    departAt: s.time,
    arriveAt: s.time + travel,
  };
  s.caravans.push(caravan);
  s.stats.purchases = (s.stats.purchases ?? 0) + 1;
  // Ключ склейки — по той же причине, по какой он есть у ковки и найма: рынок
  // пишет по строке на заказ, а кнопка покупки берёт по единице за раз. Игрок,
  // заходящий на прилавок каждый день, набирал двадцать строк в сутки, летопись
  // упиралась в запасной предел `LOG_MAX` за неделю, и ступень «за месяц»
  // показывала пять дней вместо месяца — молча, потому что обещание месяца
  // нигде не проверялось. Замерено `npm run log:report`, раздел «торговый день».
  // Про людей «телега вышла за ворота» не пишут: их приводят, а не привозят.
  const text =
    def.kind === 'bonded'
      ? ORDER_TEXT.market.ordered(check.count)
      : `Заказано: ${def.name.toLowerCase()}, ${check.count}. Телега вышла за ворота.`;
  log(s, text, 'info', `market:order:${def.id}`, 'trade');
  return null;
}

/**
 * Продаёт торговцам: золото ложится сразу, товар уходит сразу. Невольники уходят первыми те, кто без места, потом с самого
 * многолюдного двора (`loseBonded`).
 */
export function sellGoods(s: GameState, good: GoodId, count: number, now: number, key: MarketKey = 'home'): string | null {
  const check = saleCheck(s, good, count, now, key);
  if (check.blocked) return check.blocked;
  const def = check.def as GoodDef;
  if (key !== 'home') {
    // Вольный город (ПН-6): из обоза отряда, золото — в кошель.
    const r = s.roam!;
    const rest = (n: number): number | undefined => (n > 0 ? n : undefined);
    if (def.resource) r.cargo[def.resource] = rest((r.cargo[def.resource] ?? 0) - check.count);
    else if (def.equipment) r.gear[def.equipment] = rest((r.gear[def.equipment] ?? 0) - check.count);
    if (def.resource && r.cargo[def.resource] === undefined) delete r.cargo[def.resource];
    if (def.equipment && r.gear[def.equipment] === undefined) delete r.gear[def.equipment];
    r.purse += check.gold;
    note(s, def, -check.count, check.gold, now, key);
    log(s, `Продано в городе: ${def.name.toLowerCase()}, ${check.count}, выручка ${check.gold} золота.`, 'info', `market:town:sold:${def.id}`, 'trade');
    return null;
  }
  let gone = check.count;
  if (def.id === BONDED_GOOD.id) gone = loseBonded(s, check.count);
  else if (def.resource) s.resources[def.resource] -= gone;
  else if (def.equipment) s.equipment[def.equipment] = (s.equipment[def.equipment] ?? 0) - gone;
  if (gone <= 0) return ORDER_TEXT.market.noBonded;
  const gold = gone === check.count ? check.gold : marketLot(s, def, -gone, now).gold;
  s.gold += gold;
  // Выручка — разовое дело описи: золото легло разом, мимо налога (`stats.windfalls`, docs/security.md, раздел 8).
  if (gold > 0) s.stats.windfalls = (s.stats.windfalls ?? 0) + 1;
  note(s, def, -gone, gold, now);
  const text = def.id === BONDED_GOOD.id ? ORDER_TEXT.market.sold(gone, gold) : `Продано торговцам: ${def.name.toLowerCase()}, ${gone}, выручка ${gold} золота.`;
  log(s, text, 'info', `market:sold:${def.id}`, 'trade');
  return null;
}

