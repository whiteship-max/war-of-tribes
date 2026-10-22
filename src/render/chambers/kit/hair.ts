// Волосы набора персонажа без «шапки» (ЛЦ-5, docs/characters.md): оценщики ЛЦ-3 видели у гонца шапку — ровный срез по
// краю, ступень над лбом, обрубленный висок. Здесь — два приёма, которыми пользуется советник (прежние фигуры их не берут, и
// их вид не меняется):
//
//   · рваный край — нижний ряд шапки идёт зубцами разной высоты (сеяная кость), а не ровной линией: в силуэте у затылка и
//     над ушами — кончики прядей;
//   · пряди за краем — короткие ленты, отходящие от нижнего ряда наружу и вниз и сходящиеся к кончику: объём у затылка и
//     ворота, который не лежит на черепе.
import type { V3 } from '../../city/geom';
import { rng } from './paint';
import type { SkinMesh, Weights } from './skin';

/** Зубцы края: по одному числу на точку ряда, от −1 до 1, соседние — в разные стороны; концы ряда (у лица) — ноль. */
export function raggedEdge(n: number, seed: number): number[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    if (i === 0 || i === n - 1) return 0;
    const sign = i % 2 ? 1 : -1;
    return sign * (0.45 + 0.55 * r());
  });
}

/** Прядь за краем: корень (на нижнем ряду шапки), направление вниз-наружу, поперёк (ширина), длина. */
export interface Lock {
  at: V3;
  dir: V3;
  side: V3;
  len: number;
  width: number;
}

/**
 * Пряди лентами: у корня — ширина `width`, посередине — чуть шире и наружу, к кончику — в точку. Три ряда, по две грани
 * на прядь и одна у кончика. UV — полоса листа волос (`uv(t, s)`: t — от корня к кончику, s — поперёк, 0…1).
 */
export function hairLocks(m: SkinMesh, locks: readonly Lock[], uv: (i: number, t: number, s: number) => [number, number], w: (t: number) => Weights, inside: (p: V3) => V3): number {
  const from = m.triangles;
  locks.forEach((l, i) => {
    // Прядь провисает: к кончику — ниже на `bow`.
    const pt = (t: number, s: number, bow: number): V3 => {
      const half = l.width * (1 - 0.85 * t * t) * (1 + 0.25 * Math.sin(Math.PI * t));
      return [l.at[0] + l.dir[0] * l.len * t + l.side[0] * half * s, l.at[1] + l.dir[1] * l.len * t + l.side[1] * half * s - bow, l.at[2] + l.dir[2] * l.len * t + l.side[2] * half * s];
    };
    const rows = [0, 0.55].map((t) => [-1, 1].map((s) => m.v(pt(t, s, 0.006 * t), uv(i, t, (s + 1) / 2), 0, w(t))));
    m.strip(rows, false, inside);
    const tip = m.v(pt(1, 0, 0.004), uv(i, 1, 0.5), 0, w(1));
    m.quad(rows[1][0], rows[1][1], tip, tip, inside(l.at));
  });
  return m.triangles - from;
}
