// Рынок в первой загрузке (РН-1, docs/city_v3.md, «Решения РН-1»): шаг — налог в казну и разгрузка караванов — и чтение
// рынка из сохранения. Сделки и цены — дверь `sim/market`, она едет докачкой вместе с окном рынка: первая загрузка за торг
// не платит.
import type { Caravan, GameState, GoodId, MarketDeal, MarketState } from '../types';
import { DAY_LENGTH } from '../constants';
import { GOOD_BY_ID } from '../data/market';
import { DEALS_KEPT } from '../marketrules';
import { shiftOf } from '../shift';
import { marketLevel, storageCap } from '../derived';
import { addBonded } from './population';
import { log } from './log';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function counts(v: unknown): Partial<Record<GoodId, number>> {
  const out: Partial<Record<GoodId, number>> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [k, x] of Object.entries(v)) if (GOOD_BY_ID[k] && (num(x) ?? -1) >= 0) out[k as GoodId] = Math.floor(x as number);
  return out;
}

/**
 * Рынок из сохранения — одна дверь чтения. Запись до РН-1 (счёт дня `day`, без `w`) — пустой привоз: прежний счёт дня к
 * привозу не относится. Нажим и сделки — только целыми записями известных товаров.
 */
export function mergeMarket(v: unknown): MarketState {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const press: NonNullable<MarketState['press']> = {};
  if (r.press && typeof r.press === 'object') {
    for (const [k, p] of Object.entries(r.press as Record<string, unknown>)) {
      if (GOOD_BY_ID[k] && Array.isArray(p) && num(p[0]) !== null && num(p[1]) !== null) press[k as GoodId] = [p[0], p[1]];
    }
  }
  const deals: MarketDeal[] = [];
  if (Array.isArray(r.deals)) {
    for (const d of r.deals as Record<string, unknown>[]) {
      if (!d || typeof d !== 'object' || !GOOD_BY_ID[d.good as string]) continue;
      const seq = num(d.seq), at = num(d.at), n = num(d.n), gold = num(d.gold), q = num(d.q);
      if (seq === null || at === null || n === null || gold === null || q === null) continue;
      deals.push({ seq, at, good: d.good as GoodId, n, gold, q });
    }
  }
  return {
    w: num(r.w) ?? -1,
    bought: counts(r.bought),
    sold: counts(r.sold),
    press,
    ...(num(r.lv) !== null && (r.lv as number) > 0 ? { lv: Math.floor(r.lv as number) } : {}),
    got: Math.max(0, num(r.got) ?? 0),
    seq: Math.max(0, Math.floor(num(r.seq) ?? 0)),
    deals: deals.slice(-DEALS_KEPT),
  };
}

/**
 * Новый привоз (РН-1б): счёт купленного, проданного и серебра начинается заново, а уровень рынка закрепляется на привоз —
 * глубина, запас, набор и кошель не меняются посреди привоза. Зовут живой шаг (`sim/tick.liveStep`, минута начала привоза при
 * игроке) и каждая сделка (`sim/market`); в отлучку — первая минута, когда город снова видит рынок.
 */
export function rollShift(s: GameState, now: number): void {
  const w = shiftOf(now);
  const m = s.market;
  if (m.w === w) return;
  m.w = w;
  m.bought = {};
  m.sold = {};
  m.got = 0;
  m.lv = marketLevel(s);
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
        'trade',
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
 * Шаг рынка: сбор налога в казну и разгрузка вернувшихся караванов — оба про золото и добро у ворот. Привоз шагом не
 * меняется: он — функция настоящих часов, а счёт сделок сбрасывает сама сделка нового привоза.
 */
export function marketTick(s: GameState, dt: number, income: number): void {
  // Сбор за игровой день умеет быть отрицательным: закят раздаёт из казны
  // столько же, сколько десятина в неё собирает (`derived.taxIncomePerDay`).
  // Ниже нуля казна при этом не уходит — раздать нечего.
  if (income !== 0) s.gold = Math.max(0, s.gold + (income * dt) / DAY_LENGTH);

  if (s.caravans.length === 0) return;
  // Кольцо блокады (Р-5): караван ждёт у кольца — в ворота войдёт, когда его разомкнут.
  if (s.siege?.blockade) return;
  const arrived = s.caravans.filter((c) => s.time >= c.arriveAt);
  if (arrived.length === 0) return;
  s.caravans = s.caravans.filter((c) => s.time < c.arriveAt);
  for (const c of arrived) unload(s, c);
}
