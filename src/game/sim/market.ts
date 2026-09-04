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
import {
  caravanSeconds,
  dayOf,
  marketBought,
  marketCost,
  marketLeft,
  marketOffer,
  storageCap,
} from '../derived';
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
  else if (left <= 0) blocked = 'На сегодня всё разобрали — приходи завтра.';
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
  log(s, `Рынок: заказано ${def.name.toLowerCase()} — ${check.count}. Телега вышла за ворота.`);
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
  log(s, `Рынок: караван с ${(def?.name ?? 'товаром').toLowerCase()} отозван, ${c.gold} золота вернулось в казну.`);
  return null;
}

/** Кладёт привезённое на склад. Ресурсы упираются во вместимость, снаряжение — нет. */
function unload(s: GameState, c: Caravan): void {
  const def = GOOD_BY_ID[c.good];
  if (!def) return;
  if (def.resource) {
    const cap = storageCap(s);
    const before = s.resources[def.resource];
    s.resources[def.resource] = Math.min(cap, before + c.count);
    const fit = Math.round(s.resources[def.resource] - before);
    log(
      s,
      fit < c.count
        ? `Караван привёз ${def.name.toLowerCase()} — ${c.count}, но склад полон: влезло ${fit}.`
        : `Караван вернулся: ${def.name.toLowerCase()} — ${c.count}.`,
      fit < c.count ? 'bad' : 'good',
    );
    return;
  }
  if (def.equipment) {
    s.equipment[def.equipment] = (s.equipment[def.equipment] ?? 0) + c.count;
    log(s, `Караван вернулся: ${def.name.toLowerCase()} — ${c.count}.`, 'good');
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

  if (income > 0) s.gold += (income * dt) / DAY_LENGTH;

  if (s.caravans.length === 0) return;
  const arrived = s.caravans.filter((c) => s.time >= c.arriveAt);
  if (arrived.length === 0) return;
  s.caravans = s.caravans.filter((c) => s.time < c.arriveAt);
  for (const c of arrived) unload(s, c);
}
