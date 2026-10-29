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
import type { Caravan, GameState, GoodId } from '../types';
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
  shiftOf,
  supplyOf,
  type Lot,
} from '../marketrules';
import { bondedTotal, caravanSeconds, marketLevel, merchantsMult, storageCap, treasurerMult, underSiege } from '../derived';
import { loseBonded } from './population';
import { rollShift } from './caravan';
import { log } from './log';
import { outlay } from './pay';
import { rulerTraitNumbers } from '../rulertraits';

// ---------- Чтения ----------
//
// Всё, что зависит от привоза, берёт настоящую минуту `now` (часы партии, `net/clock.partyNow`) и считается правилами
// `marketrules`, одними с сервером. Хранится только сделанное игроком (`MarketState`), и счёт другого привоза не считается.
// Чтения живут здесь, а не в `derived`: их читает только окно рынка, и первая загрузка за них не платит.

/**
 * Уровень рынка привоза в минуту `now` (РН-1б): закреплённый на начало привоза (`MarketState.lv`, `sim/caravan.rollShift`), а
 * пока привоз не начат в партии — нынешний. Событие, отнявшее уровень посреди привоза, меняет глубину со следующего.
 */
export function shiftLevel(s: GameState, now: number): number {
  const m = s.market;
  return m && m.w === shiftOf(now) && (m.lv ?? 0) > 0 ? (m.lv as number) : marketLevel(s);
}

export function marketOf(s: GameState, now: number): { w: number; bought: Partial<Record<GoodId, number>>; sold: Partial<Record<GoodId, number>>; got: number } {
  const w = shiftOf(now);
  const m = s.market;
  if (!m || m.w !== w) return { w, bought: {}, sold: {}, got: 0 };
  return { w, bought: m.bought ?? {}, sold: m.sold ?? {}, got: Math.max(0, m.got ?? 0) };
}

/**
 * Что привезли в нынешний привоз: товары по месту на прилавке и невольничий ряд — он стоит всегда: продать невольников —
 * рычаг против мятежа, а рычаг, который есть через привоз, рычагом не является. Пусто, пока нет рынка.
 */
export const marketOffer = (s: GameState, now: number): GoodDef[] => {
  if (marketLevel(s) <= 0) return [];
  return [...offerFor(shiftOf(now), shiftLevel(s, now), GOODS), BONDED_GOOD];
};

/** Привезли ли товар в нынешний привоз. */
export const marketHas = (s: GameState, def: GoodDef, now: number): boolean => marketOffer(s, now).some((g) => g.id === def.id);

/** Глубина рынка товара (`marketrules.depthOf`): на столько штук нажима цена уходит вдвое. Одна во все привозы. */
export const marketDepth = (s: GameState, def: GoodDef, now: number): number => depthOf(def, shiftLevel(s, now));

/** Запас нынешнего привоза (`marketrules.supplyOf`): уровень рынка, ночь, стабильность, привоз. */
export const marketSupply = (s: GameState, def: GoodDef, now: number): number =>
  supplyOf(def, shiftLevel(s, now), shiftOf(now), stabClamp(s.stab?.level ?? 0));

/** Сколько серебра купцов осталось в этот привоз (`marketrules.purseOf`) — им платят за всё, кроме невольников. */
export const marketPurse = (s: GameState, now: number): number => Math.max(0, purseOf(shiftLevel(s, now)) - marketOf(s, now).got);

/** Сколько куплено и продано этого товара в нынешний привоз. */
export const marketBought = (s: GameState, id: GoodId, now: number): number => Math.max(0, marketOf(s, now).bought[id] ?? 0);
export const marketSold = (s: GameState, id: GoodId, now: number): number => Math.max(0, marketOf(s, now).sold[id] ?? 0);

/** Запас рынка: привезённое и проданное торговцам за вычетом купленного; товар, которого не привезли, — только проданное. */
export const marketLeft = (s: GameState, def: GoodDef, now: number): number =>
  Math.max(0, (marketHas(s, def, now) ? marketSupply(s, def, now) : 0) + marketSold(s, def.id, now) - marketBought(s, def.id, now));

/** Нажим на цену товара в минуту `now` (`marketrules.pressAt`): отходит к нулю сам. */
export function marketPress(s: GameState, id: GoodId, now: number): number {
  const p = s.market?.press?.[id];
  return p ? pressAt(p[0], p[1], now) : 0;
}

/**
 * Прибавка к выручке рынка: Казначей (РТ-1, `treasurerMult`) и купечество (РТ-2, `merchantsMult`) — те же двери, что у налога;
 * «Торгаш» (черта правителя, ПН-2) — своей долей; потолок — `marketrules.BOOST_MAX`, выше него выручку не поднимает ничто.
 */
export const marketBoost = (s: GameState): number => Math.min(BOOST_MAX, treasurerMult(s) * merchantsMult(s) * (1 + rulerTraitNumbers(s).trade));

/** Цена следующей купленной штуки. */
export const marketPrice = (s: GameState, def: GoodDef, now: number): number =>
  buyUnit(def, shiftOf(now), marketDepth(s, def, now), marketPress(s, def.id, now));

/** Выручка за следующую проданную штуку. */
export const marketSellPrice = (s: GameState, def: GoodDef, now: number): number =>
  sellUnit(def, shiftOf(now), marketDepth(s, def, now), marketPress(s, def.id, now), marketBoost(s));

/** Партия из `n` штук: `n > 0` — покупка, `n < 0` — продажа; поштучно (`marketrules.lotOf`). */
export const marketLot = (s: GameState, def: GoodDef, n: number, now: number): Lot =>
  lotOf(def, shiftOf(now), marketDepth(s, def, now), marketPress(s, def.id, now), n, marketBoost(s));

/** Во что обойдётся партия из `count` штук. */
export const marketCost = (s: GameState, def: GoodDef, count: number, now: number): number => marketLot(s, def, Math.max(0, count), now).gold;

/**
 * Сколько невольников торговцы уведут в этот привоз: не больше, чем приводят, — уводят столько, сколько могут прокормить в
 * дороге. Особое правило ряда; прочий товар берут без счёта, и держит его только цена.
 */
export const bondedSaleLeft = (s: GameState, now: number): number =>
  marketLevel(s) <= 0 ? 0 : Math.max(0, marketSupply(s, BONDED_GOOD, now) - marketSold(s, 'bonded', now));

/** Почём торговцы возьмут следующего невольника — той же дверью, что любой товар. */
export const bondedSalePrice = (s: GameState, now: number): number => marketSellPrice(s, BONDED_GOOD, now);

/** Сколько этого товара у игрока: запас склада, вещь кузни или невольники в городе. */
export function ownOf(s: GameState, def: GoodDef): number {
  if (def.id === BONDED_GOOD.id) return bondedTotal(s);
  return def.resource ? Math.floor(s.resources[def.resource]) : (s.equipment[def.equipment!] ?? 0);
}

/** Сколько этого товара везут телеги. */
export const inTransit = (s: GameState, id: GoodId): number => s.caravans.reduce((n, c) => n + (c.good === id ? c.count : 0), 0);

/** Сколько ещё влезет на склад с тем, что уже везут; снаряжению и людям склад не нужен. */
export function roomFor(s: GameState, def: GoodDef): number {
  if (!def.resource) return Infinity;
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
export function marketCheck(s: GameState, good: GoodId, count: number, now: number): MarketCheck {
  const def = GOOD_BY_ID[good] ?? null;
  const n = Math.max(1, Math.floor(count));
  if (!def) return { def: null, count: n, cost: 0, lot: NO_LOT, left: 0, room: 0, blocked: 'Такого товара нет.' };
  const left = marketLeft(s, def, now);
  const lot = marketLot(s, def, n, now);
  const room = roomFor(s, def);

  let blocked: string | null = null;
  if (underSiege(s)) blocked = SIEGE_NO_TRADE;
  else if (marketLevel(s) <= 0) blocked = ORDER_TEXT.market.noMarket;
  else if (left <= 0) blocked = marketHas(s, def, now) ? 'Рынок пуст: всё разобрали до нового привоза.' : 'Рынок пуст: этого не привезли.';
  else if (n > left) blocked = `На рынке только ${left}.`;
  else if (room <= 0) blocked = 'Склад полон.';
  else if (n > room) blocked = `На склад влезет только ${room}.`;
  else if (s.gold < lot.gold) blocked = 'Не хватает золота.';

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
export function saleCheck(s: GameState, good: GoodId, count: number, now: number): SaleCheck {
  const def = GOOD_BY_ID[good] ?? null;
  const n = Math.max(1, Math.floor(count));
  if (!def) return { def: null, count: n, gold: 0, lot: NO_LOT, have: 0, left: 0, purse: 0, blocked: 'Такого товара нет.' };
  const bonded = def.id === BONDED_GOOD.id;
  const have = ownOf(s, def);
  const left = bonded ? bondedSaleLeft(s, now) : Infinity;
  const lot = marketLot(s, def, -n, now);
  const purse = fromPurse(def.id) ? marketPurse(s, now) : Infinity;
  let blocked: string | null = null;
  if (underSiege(s)) blocked = SIEGE_NO_TRADE;
  else if (marketLevel(s) <= 0) blocked = ORDER_TEXT.market.noMarket;
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
export function marketMax(s: GameState, good: GoodId, side: 'buy' | 'sell', now: number): number {
  const def = GOOD_BY_ID[good];
  if (!def || marketLevel(s) <= 0 || underSiege(s)) return 0;
  if (side === 'buy') {
    const cap = Math.min(marketLeft(s, def, now), roomFor(s, def));
    return most(cap, (n) => marketLot(s, def, n, now).gold <= s.gold);
  }
  const bonded = def.id === BONDED_GOOD.id;
  const cap = Math.min(ownOf(s, def), bonded ? bondedSaleLeft(s, now) : Infinity);
  const purse = fromPurse(def.id) ? marketPurse(s, now) : Infinity;
  return most(cap, (n) => {
    const lot = marketLot(s, def, -n, now);
    return lot.last > 0 && lot.gold <= purse;
  });
}

/** Кладёт сделку в счёт привоза, нажим и опись — одна запись на обе стороны торга. */
function note(s: GameState, def: GoodDef, n: number, gold: number, now: number): void {
  const q = marketPress(s, def.id, now);
  rollShift(s, now);
  const m = s.market;
  if (n > 0) m.bought = { ...m.bought, [def.id]: marketBought(s, def.id, now) + n };
  else m.sold = { ...m.sold, [def.id]: marketSold(s, def.id, now) - n };
  if (n < 0 && fromPurse(def.id)) m.got = (m.got ?? 0) + gold;
  m.press = { ...(m.press ?? {}), [def.id]: [q + n, now] };
  m.seq = (m.seq ?? 0) + 1;
  m.deals = [...(m.deals ?? []), { seq: m.seq, at: now, good: def.id, n, gold, q }].slice(-DEALS_KEPT);
}

/**
 * Заказывает товар: списывает золото, сбивает цену вверх и выпускает караван. Груз приедет через `caravanSeconds` игрового
 * времени.
 */
export function buyGoods(s: GameState, good: GoodId, count: number, now: number): string | null {
  const check = marketCheck(s, good, count, now);
  if (check.blocked) return check.blocked;
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
export function sellGoods(s: GameState, good: GoodId, count: number, now: number): string | null {
  const check = saleCheck(s, good, count, now);
  if (check.blocked) return check.blocked;
  const def = check.def as GoodDef;
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

