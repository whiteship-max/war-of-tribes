// Живая карта (docs/map_tw.md, раздел 15): линии прибоя — изолинии того же поля суши, что берег выпечки.
import { describe, expect, it } from 'vitest';
import { SURF_LEVELS, isoSegments } from './alive';

/** Билинейно, как порог берега выпечки (`bake.shoreSteps`). */
function bilinear(L: Float32Array, nx: number, x0: number, y0: number, step: number, x: number, y: number): number {
  const u = (x - x0) / step;
  const v = (y - y0) / step;
  const i = Math.min(nx - 2, Math.floor(u));
  const j = Math.min(nx - 2, Math.floor(v));
  const tx = u - i;
  const ty = v - j;
  const k = j * nx + i;
  const a = L[k] + (L[k + 1] - L[k]) * tx;
  const b = L[k + nx] + (L[k + nx + 1] - L[k + nx]) * tx;
  return a + (b - a) * ty;
}

describe('прибой: линии берега', () => {
  // Остров: суша 1 в середине, к морю спадает до нуля — как сплайн суши у берега.
  const nx = 61;
  const step = 1 / 3;
  const x0 = -10;
  const L = new Float32Array(nx * nx);
  for (let j = 0; j < nx; j++)
    for (let i = 0; i < nx; i++) {
      const d = Math.hypot(x0 + i * step, x0 + j * step);
      L[j * nx + i] = Math.max(0, Math.min(1, 1 - (d - 4) / 3));
    }

  it('точки отрезков лежат на своём уровне; гребни — дальше от берега, чем пена', () => {
    let prev = 0;
    for (const lv of SURF_LEVELS) {
      const seg = isoSegments(L, nx, nx, x0, x0, step, lv);
      // Точка внутри области: у острова линия есть.
      expect(seg.length, `уровень ${lv}`).toBeGreaterThan(40);
      let r = 0;
      for (let k = 0; k < seg.length; k += 2) {
        expect(Math.abs(bilinear(L, nx, x0, x0, step, seg[k], seg[k + 1]) - lv)).toBeLessThan(0.02);
        r += Math.hypot(seg[k], seg[k + 1]);
      }
      r /= seg.length / 2;
      // Суша спадает наружу: чем ниже уровень, тем дальше в море линия.
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });

  it('берег острова замкнут: у каждого конца отрезка есть сосед', () => {
    const seg = isoSegments(L, nx, nx, x0, x0, step, SURF_LEVELS[0]);
    const key = (x: number, y: number): string => `${x.toFixed(4)}:${y.toFixed(4)}`;
    const ends = new Map<string, number>();
    for (let k = 0; k < seg.length; k += 2) ends.set(key(seg[k], seg[k + 1]), (ends.get(key(seg[k], seg[k + 1])) ?? 0) + 1);
    for (const n of ends.values()) expect(n).toBe(2);
  });

  it('целиком суша или целиком море — линий нет', () => {
    expect(isoSegments(new Float32Array(16).fill(1), 4, 4, 0, 0, 1, 0.46)).toHaveLength(0);
    expect(isoSegments(new Float32Array(16).fill(0), 4, 4, 0, 0, 1, 0.46)).toHaveLength(0);
  });
});
