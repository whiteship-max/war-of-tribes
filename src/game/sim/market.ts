// Рынок: покупка за золото и караван, который везёт купленное.
//
// Покупка не мгновенная. Золото списывается сразу, а груза на складе нет, пока
// телега не вернётся из ворот: `s.caravans` — единственное место, где он в это
// время числится. Отмена в пути возвращает золото целиком и не возвращает груз,
// которого и не было.
//
// Дневной лимит считается по счётчику `s.market.bought`, который сбрасывается со
// сменой игрового дня. Счётчик растёт в момент заказа, а не в момент прибытия,
// поэтому дробление покупок ничего не даёт: ни лимита не обходит, ни цены —
// цена каждой следующей единицы считается отдельно (см. data/market.ts).
import type { Caravan, GameState, GoodId } from '../types';
import { DAY_LENGTH } from '../constants';
import { GOOD_BY_ID, type GoodDef } from '../data/market';
import { ORDER_TEXT } from '../data/order';
import {
  bondedSaleLeft,
  bondedSalePrice,
  bondedTotal,
  caravanSeconds,
  dayOf,
  marketBought,
  marketCost,
  marketLeft,
  marketLevel,
  marketOffer,
  marketSold,
  storageCap,
} from '../derived';
import { addBonded, loseBonded } from './population';
import { log } from './log';

/**
 * Переводит прилавок на текущий день, если день сменился. Вызывается и шагом
 * симуляции, и покупкой: между тиками игрок успевает нажать кнопку, и счётчик
 * купленного не должен при этом остаться вчерашним.
 */
export function rollMarketDay(s: GameState): void {
  const day = dayOf(s.time);
  if (s.market.day === day) return;
  s.market.day = day;
  s.market.bought = {};
  s.market.sold = {};
}

export interface MarketCheck {
  def: GoodDef | null;
  count: number;
  /** Сколько золота уйдёт на всю партию. */
  cost: number;
  /** Сколько ещё можно взять сегодня. */
  left: number;
  /** Почему нельзя; null — можно покупать. */
  blocked: string | null;
}

/** Всё, что нужно знать до покупки: цена партии, остаток дня и причина отказа. */
export function marketCheck(s: GameState, good: GoodId, count: number): MarketCheck {
  const def = GOOD_BY_ID[good] ?? null;
  const n = Math.max(1, Math.floor(count));
  if (!def) return { def: null, count: n, cost: 0, left: 0, blocked: 'Такого товара нет.' };
  const left = marketLeft(s, def);
  const cost = marketCost(s, def, n);

  let blocked: string | null = null;
  if (!marketOffer(s).some((g) => g.id === def.id)) blocked = 'Сегодня этого на прилавке нет.';
  else if (left <= 0) blocked = 'Сегодня всё разобрали.';
  else if (n > left) blocked = `Сегодня осталось только ${left}.`;
  else if (s.gold < cost) blocked = 'Не хватает золота.';

  return { def, count: n, cost, left, blocked };
}

/**
 * Заказывает товар: списывает золото, занимает дневной запас и выпускает караван.
 * Груз приедет через `caravanSeconds` игрового времени.
 */
export function buyGoods(s: GameState, good: GoodId, count = 1): string | null {
  rollMarketDay(s);
  const check = marketCheck(s, good, count);
  if (check.blocked) return check.blocked;
  const def = check.def as GoodDef;

  s.gold -= check.cost;
  s.market.bought[def.id] = marketBought(s, def.id) + check.count;
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
  log(s, text, 'info', `market:order:${def.id}`);
  return null;
}

export interface SaleCheck {
  count: number;
  /** Сколько золота ляжет в казну. */
  gold: number;
  /** Сколько ещё возьмут торговцы сегодня. */
  left: number;
  /** Почему нельзя; null — можно. */
  blocked: string | null;
}

/**
 * Продажа невольников торговцам. Единственное, что на рынке продают: прилавок
 * работает на ввоз, а люди — тот товар, который можно и вывести, и выводят его
 * как рычаг против мятежа.
 *
 * Цена ниже покупной и не растёт за день, а берут торговцы не больше дневного
 * запаса ряда (`bondedSaleLeft`): купить и перепродать — это отдать разницу.
 */
export function saleCheck(s: GameState, count: number): SaleCheck {
  const n = Math.max(1, Math.floor(count));
  const left = bondedSaleLeft(s);
  const gold = bondedSalePrice() * n;
  let blocked: string | null = null;
  if (marketLevel(s) <= 0) blocked = ORDER_TEXT.market.noMarket;
  else if (bondedTotal(s) < n) blocked = ORDER_TEXT.market.noBonded;
  else if (left <= 0) blocked = ORDER_TEXT.market.soldOut;
  else if (n > left) blocked = ORDER_TEXT.market.onlyLeft(left);
  return { count: n, gold, left, blocked };
}

/**
 * Продаёт невольников торговцам. Золото ложится сразу, люди уходят сразу — ждать
 * им нечего. Уходят первыми те, кто без места, потом с самого многолюдного двора.
 */
export function sellBonded(s: GameState, count = 1): string | null {
  rollMarketDay(s);
  const check = saleCheck(s, count);
  if (check.blocked) return check.blocked;
  const gone = loseBonded(s, check.count);
  const gold = bondedSalePrice() * gone;
  s.gold += gold;
  s.market.sold = { ...(s.market.sold ?? {}), bonded: marketSold(s, 'bonded') + gone };
  log(s, ORDER_TEXT.market.sold(gone, gold), 'info', 'market:sold:bonded');
  return null;
}

/**
 * Отзывает караван. Золото возвращается целиком — товар ещё не наш, и платить
 * за пустую дорогу племя не должно. Дневной запас тоже возвращается на прилавок:
 * заказ отменён, значит с него ничего не взяли.
 */
export function cancelCaravan(s: GameState, id: number): string | null {
  const idx = s.caravans.findIndex((c) => c.id === id);
  if (idx < 0) return 'Такого каравана нет.';
  const c = s.caravans[idx];
  const def = GOOD_BY_ID[c.good];
  s.gold += c.gold;
  s.market.bought[c.good] = Math.max(0, marketBought(s, c.good) - c.count);
  s.caravans.splice(idx, 1);
  log(
    s,
    def?.kind === 'bonded'
      ? ORDER_TEXT.market.cancelled(c.gold)
      : `Заказ отменён: ${(def?.name ?? 'товар').toLowerCase()}, ${c.gold} золота вернулось.`,
  );
  return null;
}

/**
 * Кладёт привезённое на склад. Ресурсы упираются во вместимость, снаряжение — нет.
 *
 * **Приход каравана в летопись не пишется.** Он не событие: игрок сам его
 * заказал минуту назад, телега едет у него на глазах по главной улице, а
 * привезённое лежит на складе. Строка про него — тот же вывод отладки, что
 * «Кузница: готов копьё» на каждый предмет, и вытесняла она то, ради чего
 * летопись читают.
 *
 * Событие тут ровно одно: склад полон и часть груза пропала. Это игрок узнать
 * обязан — заплачено золотом, а на склад легло не всё, — поэтому пишется только
 * оно, и склеивается по товару за сутки, как и заказ.
 */
function unload(s: GameState, c: Caravan): void {
  const def = GOOD_BY_ID[c.good];
  if (!def) return;
  if (def.kind === 'bonded') {
    // Приведённых вместимость склада не касается; без места они встают на
    // стройку, а на работы их ставят в панели двора. Строки о приходе нет по
    // той же причине, что у телеги с добром: заказ сделан на глазах у игрока.
    addBonded(s, c.count);
    return;
  }
  if (def.resource) {
    const cap = storageCap(s);
    const before = s.resources[def.resource];
    s.resources[def.resource] = Math.min(cap, before + c.count);
    const fit = Math.round(s.resources[def.resource] - before);
    if (fit < c.count) {
      log(
        s,
        `Караван привёз ${def.name.toLowerCase()}, ${c.count}, но склад полон: влезло ${fit}.`,
        'bad',
        `market:full:${def.id}`,
      );
    }
    return;
  }
  if (def.equipment) {
    // Снаряжение вместимости не знает вовсе, пропасть ему негде — событию
    // взяться неоткуда, и строки тут нет ни одной.
    s.equipment[def.equipment] = (s.equipment[def.equipment] ?? 0) + c.count;
  }
}

/**
 * Шаг рынка: сброс дневного счётчика на смене дня, сбор налога в казну и
 * разгрузка вернувшихся караванов. Всё три — про золото, поэтому и живут вместе.
 */
export function marketTick(s: GameState, dt: number, income: number): void {
  // Новый день — новый прилавок: ассортимент выводится из номера дня, а счётчик
  // купленного обнуляется здесь.
  rollMarketDay(s);

  // Сбор за игровой день умеет быть отрицательным: закят раздаёт из казны
  // столько же, сколько десятина в неё собирает (`derived.taxIncomePerDay`).
  // Ниже нуля казна при этом не уходит — раздать нечего.
  if (income !== 0) s.gold = Math.max(0, s.gold + (income * dt) / DAY_LENGTH);

  if (s.caravans.length === 0) return;
  const arrived = s.caravans.filter((c) => s.time >= c.arriveAt);
  if (arrived.length === 0) return;
  s.caravans = s.caravans.filter((c) => s.time < c.arriveAt);
  for (const c of arrived) unload(s, c);
}
