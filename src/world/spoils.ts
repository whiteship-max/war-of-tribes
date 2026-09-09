// Что уносит победитель. Одна чистая функция на обе стороны — и это главное в
// модуле: правило «забираем всё, кроме спрятанного, но не больше, чем унесём»
// не должно быть написано дважды. Одностороннее правило игрок раскусит за день,
// а две копии одного правила расходятся молча при первой же правке.
//
// Никакого состояния, часов и `Math.random`: тот же склад, тот же тайник и та
// же грузоподъёмность дают тот же дележ, и сервер потом получит его же.
import type { ResourceId } from '@/game/types';
import type { Loot } from './types';

export interface Spoils {
  /** Что унесли, положительными числами. Пусто — не досталось ничего. */
  taken: Loot;
  /** Сколько всего унесли. */
  takenTotal: number;
  /** Сколько осталось у хозяина в тайнике. */
  hiddenTotal: number;
  /**
   * Сколько осталось сверх тайника — то, что победитель физически не поднял.
   * Не то же, что спрятанное: это добро лежало на виду, просто рук не хватило.
   */
  spilledTotal: number;
}

/**
 * Дележ склада после проигранного боя.
 *
 * Правило одно и без исключений: **что помещается в тайник — остаётся у
 * хозяина, всё остальное забирает победитель, сколько унесёт.** Тайник считается
 * по каждому припасу отдельно (`stash` — сколько прячется каждого), потому что
 * прячут не «долю добра», а зерно в подполе и железо в яме.
 *
 * Отсюда следует то, ради чего всё и сделано: копить на складе рискованно, а
 * тратить — выгодно; у тайника появляется настоящая цена; и склад после набега
 * пуст **по факту**, а не по коэффициенту.
 *
 * Грузоподъёмность — верхний предел и ничего больше. Если унести можно меньше,
 * чем лежит на виду, остаток остаётся хозяину и никуда не девается: он и есть
 * `spilledTotal`, и путать его со спрятанным нельзя — второй раз этот двор
 * возьмут тем же отрядом, а тайник не возьмут никогда.
 *
 * Делится взятое пропорционально тому, чего сколько лежало, с раздачей остатка
 * по наибольшей дробной части: иначе на семи припасах и целочисленном делении
 * пропадали бы единицы, и «взято = склад − тайник» переставало сходиться.
 */
export function plunder(stock: Loot, stash: number, carry: number): Spoils {
  const floorStash = Math.max(0, stash);
  const open: [ResourceId, number][] = [];
  let openTotal = 0;
  let hiddenTotal = 0;
  for (const [key, value] of Object.entries(stock) as [ResourceId, number | undefined][]) {
    const have = Math.max(0, Math.floor(value ?? 0));
    if (have <= 0) continue;
    hiddenTotal += Math.min(have, floorStash);
    const free = have - Math.min(have, floorStash);
    if (free <= 0) continue;
    open.push([key, free]);
    openTotal += free;
  }
  const take = Math.min(openTotal, Math.max(0, Math.floor(carry)));
  const taken: Loot = {};
  if (take > 0) {
    // Целые доли, потом остаток — тем, у кого дробная часть больше. Порядок при
    // равенстве задаёт сам склад, а он перебирается всегда одинаково.
    const parts = open.map(([r, n]) => {
      const exact = (n / openTotal) * take;
      const whole = Math.floor(exact);
      return { r, n, whole, frac: exact - whole };
    });
    let rest = take - parts.reduce((sum, p) => sum + p.whole, 0);
    for (const p of [...parts].sort((a, b) => b.frac - a.frac)) {
      if (rest <= 0) break;
      if (p.whole >= p.n) continue;
      p.whole += 1;
      rest -= 1;
    }
    for (const p of parts) if (p.whole > 0) taken[p.r] = p.whole;
  }
  return {
    taken,
    takenTotal: Object.values(taken).reduce((n, v) => n + (v ?? 0), 0),
    hiddenTotal,
    spilledTotal: openTotal - take,
  };
}

/** То же взятое, но со знаком минус: так добыча приезжает в племя, у которого её отняли. */
export function asLoss(taken: Loot): Loot {
  const out: Loot = {};
  for (const [key, value] of Object.entries(taken) as [ResourceId, number | undefined][]) {
    if ((value ?? 0) > 0) out[key] = -(value as number);
  }
  return out;
}
