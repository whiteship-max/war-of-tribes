// Рынок (РН-1, docs/city_v3.md, «Решения РН-1»): числа и чистые формулы торга — одни на игру (`sim/market`, `derived`, окно
// `ui/next/MarketNew`) и на сервер (`netlify/lib/watch.ts`, правило «market»). Две копии разошлись бы молча: сервер счёл бы
// подделкой честную сделку или пропустил бы продажу дороже правила. Без `@/`-импортов: модуль читает серверная часть.
//
// Устройство (docs/city_v3.md, «Решения РН-1»):
//  · **Привоз** — смена по настоящим часам: ровно каждые 3 часа по UTC (00, 03 … 21), восемь в сутки, одна минута у всех
//    игроков (`shiftOf`; решение владельца, РН-1б). В каждый привоз у товара своя цена основы (`priceFactor`), свой запас
//    (`supplyOf`: богатый привоз дешевле) и свой набор (`data/market.offerFor` от номера привоза); продать торговцам можно
//    любой товар в любой привоз. Уровень рынка закрепляется на привоз (`MarketState.lv`, `sim/caravan.pinMarket`): событие,
//    отнявшее уровень, меняет глубину со следующего привоза.
//  · **Сбитие** — одно число на товар, `q` (нажим): купленная штука поднимает его на единицу, проданная — опускает.
//    Покупка идёт по `buyUnit(q)`, продажа — по доле `SALE_SHARE` от той же кривой на шаг ниже (`sellUnit(q)`): штука, купленная
//    и проданная обратно, всегда отдаёт торговцам разницу. Нажим отходит к нулю сам — вдвое за `PRESS_HALF` (`pressAt`).
//  · **Числа детерминированы на всех движках**: только сложение, умножение и деление (IEEE округляет их одинаково везде) и
//    целочисленный хеш привоза. Ни `exp`, ни `pow`: Safari и V8 вправе расходиться в последнем бите, и сервер назвал бы
//    подделкой честную цену.
import type { GoodId } from './types';
import { gameDaysOfMs, realTime } from './pace';
import { BONDED_GOOD, GOODS, GOOD_BY_ID, goodStock, offerFor, type GoodDef } from './data/market';
import { giftCeil } from './councilrules';
import { plusCeil } from './estaterules';
import { stabOutputMult } from './stabrules';

// ---------- Привоз: сетка настоящих часов ----------

// Сетка привоза — своим маленьким модулем (`game/shift.ts`): её читает живой шаг в первой загрузке, а правила торга едут
// докачкой. Дверь одна — здесь же она и отдаётся.
export { SHIFT, shiftOf, shiftStart } from './shift';
import { SHIFT } from './shift';

/**
 * Игровых дней в привозе: запас дня (`data/market.goodStock`) за столько дней — столько же добра за сутки игрока, сколько
 * давал прежний дневной прилавок. Функция шкалы, а не число: тесты, снятые при дне в минуту, меряют свои привозы.
 */
export const shiftDays = (): number => gameDaysOfMs(SHIFT);

// ---------- Цена привоза ----------

/**
 * Насколько привоз может быть дороже основы — доля. Основа (`GoodDef.price`) — самая дешёвая цена любого привоза: правило
 * «купить дешевле своего труда нельзя» (`MIN_MARKUP`) держится без поправок. Решение РН-1: пятая часть — разница, ради
 * которой стоит заглянуть в другой привоз, и не та, на которой строят расчёт.
 */
export const PRICE_SWING = 0.2;

/** Хеш привоза и товара в 0…1: целочисленный, одинаковый на всех движках. */
export function shiftDraw(w: number, good: GoodId): number {
  let h = (Math.imul(w | 0, 0x9e3779b1) ^ 0x2545f491) >>> 0;
  for (let i = 0; i < good.length; i++) h = Math.imul(h ^ good.charCodeAt(i), 0x01000193) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Множитель цены привоза к основе: 1…1 + `PRICE_SWING`. */
export const priceFactor = (w: number, good: GoodId): number => 1 + PRICE_SWING * shiftDraw(w, good);

/** Множитель запаса привоза: дешёвый привоз — богатый, дорогой — скудный; в среднем — единица. */
export const supplyFactor = (w: number, good: GoodId): number => 1 + PRICE_SWING * (0.5 - shiftDraw(w, good));

/**
 * Глубина рынка товара — штук: на столько штук нажима цена вдвое уходит от основы (покупка — вдвое выше, продажа — вдвое
 * ниже). Запас дня на этом уровне рынка за игровые дни привоза — и только: **глубина одна во все привозы**. Будь она своей у
 * привоза (тогда — ночной, вдвое мельче), нажим, накопленный в одном привозе, в другом стоил бы вдвое больше — и перепродажа
 * ушла бы в плюс (замер `npm run market:report`, Ц1, первый прогон РН-1: худший круг ×1,47). Уровень — закреплённый на привоз
 * (`MarketState.lv`): глубина не меняется посреди привоза ни от стройки, ни от события.
 */
export function depthOf(def: GoodDef, level: number): number {
  if (level <= 0) return 0;
  return Math.max(1, Math.floor(goodStock(def, level) * shiftDays()));
}

/**
 * Запас привоза — сколько штук привезли, если товар в привозе: глубина, стабильность — той же долей,
 * что работа города (`stabrules.stabOutputMult`: в смуту купцы обходят город), привоз — `supplyFactor` (дешёвый — богатый).
 * На цену не влияет: её держит глубина.
 */
export function supplyOf(def: GoodDef, level: number, w: number, stab: number): number {
  if (level <= 0) return 0;
  return Math.max(1, Math.floor(depthOf(def, level) * stabOutputMult(stab) * supplyFactor(w, def.id)));
}

/** Что привезли в привоз `w`: товары по месту на прилавке (`offerFor`) и невольничий ряд — он стоит всегда. */
export function shiftOffer(w: number, level: number): GoodId[] {
  if (level <= 0) return [];
  return [...offerFor(w, level, GOODS).map((g) => g.id), BONDED_GOOD.id];
}

// ---------- Нажим и его отход ----------

/** За сколько настоящих мс нажим уходит вдвое: четыре полураспада за привоз — к новому привозу остаётся 1/16 (45 мин). */
export const PRESS_HALF = realTime(SHIFT / 4);

/**
 * Нажим в минуту `now`, если в минуту `at` он был `q`. Вдвое за каждый полный `PRESS_HALF`, между ними — по прямой (половина
 * ступени за полный шаг): только деление и умножение, одинаково на всех движках. Часы назад — нажим как был.
 */
export function pressAt(q: number, at: number, now: number): number {
  if (!q || now <= at) return q || 0;
  const t = (now - at) / PRESS_HALF;
  const n = Math.floor(t);
  if (n >= 40) return 0;
  let half = 1;
  for (let i = 0; i < n; i++) half /= 2;
  return q * half * (1 - (t - n) / 2);
}

/** Кривая нажима: выше нуля — по прямой (вдвое на глубине), ниже — по гиперболе (вдвое на минус глубине); в нуле — единица. */
export const pressMult = (q: number, depth: number): number => (q >= 0 ? 1 + q / depth : depth / (depth - q));

// ---------- Покупка и продажа ----------

/**
 * Доля цены, которую торговцы платят, забирая товар, — при самой щедрой прибавке (`BOOST_MAX`) и самом дорогом привозе против
 * самого дешёвого продажа не дороже покупки: купить и продать в плюс нельзя ни в один привоз, ни через привоз.
 * **Выведена** `npm run market:report -- --derive` (Ц1, docs/city_v3.md, «Решения РН-1»): `1 / ((1 + PRICE_SWING) · BOOST_MAX)`,
 * вниз до тысячных. Руками не правят.
 */
export const SALE_SHARE = 0.478;

/**
 * Самая большая прибавка к выручке рынка: Казначей третьего уровня с усердием (`councilrules.giftCeil`) и купечество в полной
 * силе с указом и лояльностью сто (`estaterules.plusCeil`). Выше неё выручку не поднимает ничто — и потолок сервера тот же.
 */
// Пометки чистоты — сборщику (ПН-2): вызовы на верхнем уровне модуля он без них считает побочным действием и держит правила
// рынка в главном куске первой загрузки, хотя игра на старте их не зовёт (они едут докачкой с окном рынка).
export const BOOST_MAX = (1 + /* @__PURE__ */ giftCeil('treasurer')) * (1 + /* @__PURE__ */ plusCeil('merchants', 100, true));

/** Цена покупки одной штуки при нажиме `q`. Ниже основы привоза покупка не дешевеет: продажи сбивают выручку, а не ввоз. */
export const buyUnit = (def: GoodDef, w: number, depth: number, q: number): number =>
  Math.ceil(def.price * priceFactor(w, def.id) * pressMult(Math.max(0, q), depth));

/**
 * Выручка за одну штуку при нажиме `q`: та же кривая шагом ниже — штука, купленная и проданная обратно, отдаёт разницу. `share` — доля
 * продажи; в игре одна, `SALE_SHARE`: другой довод — только «что если» прибора (`roam:report`, варианты владельцу ПН-Э2в).
 */
export const sellUnit = (def: GoodDef, w: number, depth: number, q: number, boost: number, share: number = SALE_SHARE): number =>
  Math.floor(share * Math.min(BOOST_MAX, Math.max(1, boost)) * def.price * priceFactor(w, def.id) * pressMult(q - 1, depth));

/**
 * Вывод доли продажи (Ц1, `market:report -- --derive`) при наибольшей прибавке `boost`: продажа в самый дорогой привоз не дороже
 * покупки в самый дешёвый, вниз до тысячных. `SALE_SHARE` — она же при `BOOST_MAX` (тест); при прибавке 1 — доля рынка без Казначея и
 * купечества (вольный город — вариант владельцу ПН-Э2в, в игру не идёт).
 */
export const shareFor = (boost: number): number => Math.floor(1000 / ((1 + PRICE_SWING) * boost)) / 1000;

// ---------- Кошель купцов ----------

/**
 * Серебро купцов на привоз — сколько золота торговцы готовы отдать за купленное у города, по уровню рынка (индекс — уровень).
 * Цель Ц2 владельца — продажа излишка даёт заметное, но не ломающее золото: кошель — `PURSE_SHARE` налога привоза мерочного
 * посёлка этого уровня (`autopilot.townAt`) — за сутки восемь кошелей, треть суточного налога. **Выведен**
 * `npm run market:report -- --derive`. Руками не правят. Невольников уводят работорговцы своим серебром — мимо кошеля, их
 * особое правило (`bondedSaleLeft`).
 */
export const PURSE: readonly number[] = [0, 126, 230, 333, 437, 540, 694, 836, 977, 1119, 1260];

/** Доля налога привоза, которую кошель купцов отдаёт за излишек: треть (решение РН-1, Ц2). */
export const PURSE_SHARE = 1 / 3;

/** Кошель купцов в привоз при уровне рынка `level` — у всех восьми привозов суток один. */
export const purseOf = (level: number): number => (level <= 0 ? 0 : PURSE[Math.min(PURSE.length - 1, level)]);

/** Идёт ли продажа товара из кошеля купцов: всё, кроме невольников. */
export const fromPurse = (good: string): boolean => good !== BONDED_GOOD.id;

export interface Lot {
  /** Золото партии: покупка — сколько уйдёт, продажа — сколько ляжет. */
  gold: number;
  /** Нажим после партии. */
  q: number;
  /** Цена первой и последней штуки партии. */
  first: number;
  last: number;
}

/**
 * Партия из `n` штук поштучно: покупка (`n > 0`) — каждая следующая дороже, продажа (`n < 0`) — каждая следующая дешевле.
 * Партию, разбитую на штуки, считают так же: сумма та же до монеты.
 */
export function lotOf(def: GoodDef, w: number, depth: number, q0: number, n: number, boost = 1): Lot {
  let q = q0;
  let gold = 0;
  let first = 0;
  let last = 0;
  const k = Math.abs(Math.floor(n));
  for (let i = 0; i < k; i++) {
    const p = n > 0 ? buyUnit(def, w, depth, q) : sellUnit(def, w, depth, q, boost);
    if (i === 0) first = p;
    last = p;
    gold += p;
    q += n > 0 ? 1 : -1;
  }
  return { gold, q, first, last };
}

/**
 * Товар с основой, умноженной на `mult`, — специализация вольного города (ПН-Э1, `world/townspec.specMult`): одна дверь для покупки,
 * продажи и партии. Множитель один на обе стороны сделки в одном городе, поэтому «перепродажа не в плюс» внутри города держится тем
 * же `SALE_SHARE`. Единица — тот же товар (у лорда множителя нет вовсе).
 */
export const specGood = (def: GoodDef, mult: number): GoodDef => (mult === 1 ? def : { ...def, price: def.price * mult });

// ---------- Караванный кошель вольного города (ПН-Э2в) ----------
//
// Купцы вольного города берут у отряда бродяги привезённое своим серебром — **караванным кошелём**, отдельным от кошеля купцов привоза
// (`PURSE`). Кошель купцов — правило рынка лорда: он выведен из налога мерочного посёлка (Ц2) и держит рынок лорда от перепродажи; его
// не читает ни вольный город, ни торговля бродяги. Караванный кошель читает только рынок вольного города (ключ `town:x:y`, дверь
// `sim/market`) и книга торга сервера (`netlify/lib/roambook.ts`); у лорда его нет вовсе (тест).
//
// Устройство (docs/gdd/path_of_sword.md, 3.7.1, 23.10):
//  · **Размер** — от города: серебро, которое его купцы отдали бы за одну глубину рынка (`depthOf` уровня города) каждого товара,
//    который городу нужен (`wants` специализации, `world/townspec`), по доле продажи от основы с размахом, × `size` (заглушка
//    `caravanSize`). Больше город — глубже рынок и толще кошель; ремесло нуждается в пяти товарах — его кошель толще, чем у житницы.
//  · **Пополнение** — по прямой до полного за `refillMs` (заглушка `caravanRefill`): запись — недостача и минута `[owe, at]`, как нажим.
//    Круг «туда — обратно» держит пополнение: сколько ни возить, город отдаёт не больше кошеля за срок пополнения.
//  · **Цена** — та же кривая продажи (`sellUnit`, нажим `pressAt`): каждая проданная штука одного товара в одном городе дешевле
//    предыдущей, нажим отходит сам. Кошель цену не меняет — он кончается.
//  · Числа детерминированы на всех движках: только сложение, умножение и деление (как нажим).

/** Запись караванного кошеля: недостача до полного и настоящая минута, когда она была такой. */
export type CaravanMark = readonly [number, number];

/** Единица караванного кошеля: выручка одной глубины рынка уровня `level` каждого нужного товара по основе с размахом `swing`. */
export function caravanUnit(level: number, wants: readonly string[], swing: number): number {
  if (level <= 0) return 0;
  let gold = 0;
  for (const id of wants) {
    const def = GOOD_BY_ID[id];
    if (def) gold += depthOf(def, level) * def.price * (1 + swing) * SALE_SHARE;
  }
  return Math.floor(gold);
}

/** Недостача кошеля в минуту `now`: отходит по прямой — полный кошель за `refillMs`. Нет записи — полон. Часы назад — как была. */
export function caravanOwe(cap: number, refillMs: number, mark: CaravanMark | undefined, now: number): number {
  if (!mark || !(mark[0] > 0)) return 0;
  if (!(refillMs > 0)) return 0;
  const back = now > mark[1] ? (cap * (now - mark[1])) / refillMs : 0;
  return Math.max(0, mark[0] - back);
}

/** Серебро караванного кошеля в минуту `now`: полный за вычетом недостачи. */
export const caravanLeft = (cap: number, refillMs: number, mark: CaravanMark | undefined, now: number): number =>
  Math.max(0, cap - caravanOwe(cap, refillMs, mark, now));

/** Запись кошеля после выплаты `gold` в минуту `now`. */
export const caravanPaid = (cap: number, refillMs: number, mark: CaravanMark | undefined, now: number, gold: number): [number, number] => [
  caravanOwe(cap, refillMs, mark, now) + Math.max(0, gold),
  now,
];

/** Товар по ключу — для сервера, который не держит своей таблицы. */
export const goodOf = (id: string): GoodDef | null => GOOD_BY_ID[id] ?? null;

/** Сколько сделок держит опись (`WatchCard.market.deals`): сервер сверяет каждую новую; между записями их не больше. */
export const DEALS_KEPT = 64;
