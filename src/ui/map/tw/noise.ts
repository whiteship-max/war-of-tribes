// Решётчатый шум нового вида: тот же приём, что у рельефа прежней карты (`relief.ts`), — узлы октавы
// считаются заранее по её собственному шагу, ключ хеша — абсолютный узел. Два соседних тайла считают в
// общей точке одно и то же число, и шва нет по построению.
import { hash, smooth } from '../scatter';

export interface Octave {
  period: number;
  i0: number;
  j0: number;
  w: number;
  g: Float32Array;
}

/** Узлы октавы над областью в клетках, с запасом в узел с каждой стороны. */
export function octave(seed: number, x: number, y: number, w: number, h: number, period: number, salt: number): Octave {
  const i0 = Math.floor(x / period) - 1;
  const j0 = Math.floor(y / period) - 1;
  const gw = Math.ceil(w / period) + 4;
  const gh = Math.ceil(h / period) + 4;
  const g = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) g[j * gw + i] = hash(seed, i0 + i, j0 + j, salt);
  }
  return { period, i0, j0, w: gw, g };
}

/** Значение октавы в мировой точке, 0..1, плавной ступенью между узлами. */
export function at(o: Octave, wx: number, wy: number): number {
  const fx = wx / o.period - o.i0;
  const fy = wy / o.period - o.j0;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smooth(fx - ix);
  const ty = smooth(fy - iy);
  const k = iy * o.w + ix;
  const a = o.g[k];
  const b = o.g[k + 1];
  const c = o.g[k + o.w];
  const d = o.g[k + o.w + 1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** Гребневой шум: складка там, где значение переходит середину (`relief.ts`, «складки, а не бугры»). */
export const ridged = (n: number): number => 1 - Math.abs(2 * n - 1);

// ---------- Градиентный шум ----------

/**
 * Октава градиентного шума (Перлин) с поворотом. Решётчатый шум значений даёт складки вдоль осей —
 * горы выходили «кирпичами» на первом же круге снимков (docs/map_tw.md, раздел 10). Градиенты по
 * узлам и свой поворот у каждой октавы снимают и то, и другое. Градиенты считаются заранее по узлам
 * октавы над областью, ключ хеша — абсолютный узел повёрнутой решётки: шва между тайлами нет.
 */
export interface Grad {
  period: number;
  cos: number;
  sin: number;
  i0: number;
  j0: number;
  w: number;
  gx: Float32Array;
  gy: Float32Array;
}

export function gradOctave(seed: number, x: number, y: number, w: number, h: number, period: number, salt: number, angle: number): Grad {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Рамка области в повёрнутых координатах.
  let u0 = Infinity;
  let v0 = Infinity;
  let u1 = -Infinity;
  let v1 = -Infinity;
  for (const [px, py] of [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ]) {
    const u = (px * cos - py * sin) / period;
    const v = (px * sin + py * cos) / period;
    u0 = Math.min(u0, u);
    v0 = Math.min(v0, v);
    u1 = Math.max(u1, u);
    v1 = Math.max(v1, v);
  }
  const i0 = Math.floor(u0) - 1;
  const j0 = Math.floor(v0) - 1;
  const gw = Math.ceil(u1) - i0 + 3;
  const gh = Math.ceil(v1) - j0 + 3;
  const gx = new Float32Array(gw * gh);
  const gy = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const a = hash(seed, i0 + i, j0 + j, salt) * Math.PI * 2;
      gx[j * gw + i] = Math.cos(a);
      gy[j * gw + i] = Math.sin(a);
    }
  }
  return { period, cos, sin, i0, j0, w: gw, gx, gy };
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Градиентный шум в мировой точке, примерно −1…1. */
export function perlin(o: Grad, wx: number, wy: number): number {
  const u = (wx * o.cos - wy * o.sin) / o.period - o.i0;
  const v = (wx * o.sin + wy * o.cos) / o.period - o.j0;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  const fu = u - iu;
  const fv = v - iv;
  const k = iv * o.w + iu;
  const n00 = o.gx[k] * fu + o.gy[k] * fv;
  const n10 = o.gx[k + 1] * (fu - 1) + o.gy[k + 1] * fv;
  const n01 = o.gx[k + o.w] * fu + o.gy[k + o.w] * (fv - 1);
  const n11 = o.gx[k + o.w + 1] * (fu - 1) + o.gy[k + o.w + 1] * (fv - 1);
  const a = fade(fu);
  const b = fade(fv);
  const x0 = n00 + (n10 - n00) * a;
  const x1 = n01 + (n11 - n01) * a;
  return (x0 + (x1 - x0) * b) * 1.41;
}
