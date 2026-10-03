// Граница державы линией (docs/map_tw.md, раздел 4): цвет владения ложится заливкой, как и сейчас
// (`zones.ts`), а по краю идёт черта — как на карте кампании. Черта — изолиния поля владения
// (квадраты по сетке клеток, середина — 0.5), а не обвод клеток: край идёт плавно, а не ступенькой.
//
// Модуль чистый: поле приходит массивом, на выходе отрезки в мировых клетках. Печётся раз при
// пересборке владений (раз в секунду, как растр `zones.ts`), в кадре — копирование.

/** Отрезок изолинии: (x1, y1) → (x2, y2) в клетках мира. */
export type Segment = [number, number, number, number];

/**
 * Изолиния поля `f` (w × h, построчно) на уровне `level`. Узел (i, j) поля — середина клетки
 * (x0 + i + 0.5, y0 + j + 0.5). Седло решается по среднему четырёх углов — без дыр в черте.
 */
export function contour(f: Float32Array, w: number, h: number, x0: number, y0: number, level = 0.5): Segment[] {
  const out: Segment[] = [];
  const at = (i: number, j: number): number => f[j * w + i];
  const lerp = (a: number, b: number): number => (level - a) / (b - a);
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      const code = (a >= level ? 8 : 0) | (b >= level ? 4 : 0) | (c >= level ? 2 : 0) | (d >= level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const cx = x0 + i + 0.5;
      const cy = y0 + j + 0.5;
      const top: [number, number] = [cx + lerp(a, b), cy];
      const right: [number, number] = [cx + 1, cy + lerp(b, c)];
      const bottom: [number, number] = [cx + lerp(d, c), cy + 1];
      const left: [number, number] = [cx, cy + lerp(a, d)];
      const seg = (p: [number, number], q: [number, number]): void => void out.push([p[0], p[1], q[0], q[1]]);
      const mid = (a + b + c + d) / 4 >= level;
      switch (code) {
        case 1:
        case 14:
          seg(left, bottom);
          break;
        case 2:
        case 13:
          seg(bottom, right);
          break;
        case 3:
        case 12:
          seg(left, right);
          break;
        case 4:
        case 11:
          seg(top, right);
          break;
        case 6:
        case 9:
          seg(top, bottom);
          break;
        case 7:
        case 8:
          seg(left, top);
          break;
        case 5:
          if (mid) {
            seg(left, top);
            seg(bottom, right);
          } else {
            seg(left, bottom);
            seg(top, right);
          }
          break;
        case 10:
          if (mid) {
            seg(top, right);
            seg(left, bottom);
          } else {
            seg(left, top);
            seg(bottom, right);
          }
          break;
      }
    }
  }
  return out;
}

/** Размытие владения 1-2-1: край изолинии скругляется, и черта не повторяет ступени клеток. */
export function soften(f: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const l = f[j * w + Math.max(0, i - 1)];
      const r = f[j * w + Math.min(w - 1, i + 1)];
      tmp[j * w + i] = (l + 2 * f[j * w + i] + r) / 4;
    }
  }
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const u = tmp[Math.max(0, j - 1) * w + i];
      const d = tmp[Math.min(h - 1, j + 1) * w + i];
      out[j * w + i] = (u + 2 * tmp[j * w + i] + d) / 4;
    }
  }
  return out;
}
