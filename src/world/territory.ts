// Зоны влияния племён: чья это земля.
//
// Границ никто не рисует. Влияние считается от поселений с затуханием по
// расстоянию и складывается: земля принадлежит не одному двору, а тому, чьих
// дворов вокруг больше. Поэтому кучка хуторов даёт пятно, а одинокий — почти
// ничего, и стан со временем расползается сам, без единой линии в данных.
//
// Здесь только арифметика. Кому это показывать — решает мир: в неразведанную
// клетку цвет племени не попадает никогда, иначе игрок узнавал бы о чужих
// владениях, не заглядывая туда.
import type { WorldGen } from './gen';
import { INFLUENCE_CAPITAL, INFLUENCE_MIN, INFLUENCE_RADIUS } from './data/tuning';

export interface Claim {
  x: number;
  y: number;
  /** Номер племени в `WorldGen.tribes`. */
  tribe: number;
  /** Докуда дотягивается это поселение, клеток. */
  radius: number;
}

/** Докуда вообще может дотянуться хоть одно поселение. */
export const CLAIM_REACH = Math.max(INFLUENCE_RADIUS, INFLUENCE_CAPITAL);

/**
 * Притязания поселений мира. Варварские лагеря сюда не попадают: у них нет
 * племени, а значит и земли — они на ней стоят, а не владеют ею.
 */
export function claimsOf(gen: WorldGen): Claim[] {
  const index = new Map(gen.tribes.map((t, i) => [t.id, i]));
  const out: Claim[] = [];
  for (const s of gen.settlements) {
    if (!s.tribeId) continue;
    const tribe = index.get(s.tribeId);
    if (tribe === undefined) continue;
    out.push({ x: s.x, y: s.y, tribe, radius: s.capital || s.castle ? INFLUENCE_CAPITAL : INFLUENCE_RADIUS });
  }
  return out;
}

/** Притязания, способные дотянуться до области. Их и перебирают по клеткам куска. */
export const claimsNear = (claims: Claim[], x0: number, y0: number, x1: number, y1: number): Claim[] =>
  claims.filter((c) => c.x >= x0 - CLAIM_REACH && c.x <= x1 + CLAIM_REACH && c.y >= y0 - CLAIM_REACH && c.y <= y1 + CLAIM_REACH);

/**
 * Чья клетка: 0 — ничья, иначе номер племени плюс единица (ноль занят под
 * «ничья», и в кусок карты это едет одним байтом на клетку).
 */
export function ownerAt(claims: Claim[], x: number, y: number): number {
  let best = 0;
  let bestWeight = INFLUENCE_MIN;
  const sums: number[] = [];
  for (const c of claims) {
    const dx = c.x - x;
    const dy = c.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= c.radius * c.radius) continue;
    // Спад с ограниченным носителем: за радиусом ровно ноль, иначе далёкие
    // поселения давали бы ровный фон и граница уползала бы в никуда.
    const t = 1 - Math.sqrt(d2) / c.radius;
    sums[c.tribe] = (sums[c.tribe] ?? 0) + t * t;
  }
  for (let i = 0; i < sums.length; i++) {
    const w = sums[i] ?? 0;
    if (w > bestWeight) {
      bestWeight = w;
      best = i + 1;
    }
  }
  return best;
}
