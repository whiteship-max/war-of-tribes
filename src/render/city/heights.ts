// Поле высот верха города (docs/polish.md, П-3): где кончается капля и где ложатся брызги — кровли, земля, вода.
// Чистый модуль без three: треугольники мира (зданий, земли, воды) растеризуются сверху в квадратную сетку, в клетке —
// высота самой верхней поверхности над её серединой. Считает процессор, кусками по кадрам (`step`): у сборки свои
// миллисекунды, у кадра — свои. Читает поле шейдер осадков (`precip.ts`, текстурой), тест — `heightAt` и `splashSpot`.
//
// Почему не снимок глубины видеокартой: чтение кадра обратно — остановка конвейера на телефоне, и потерянный контекст
// унёс бы снимок с собой; поле на процессоре переживает и то, и другое, и его можно проверить тестом.

/** Нет поверхности: клетка за краем поля или ни один треугольник её не накрыл. */
export const NO_HEIGHT = -1e4;

/**
 * Перегиб, дальше которого клетка — край (стена под карнизом, конёк, обрыв): вторая разность высоты по соседям, м.
 * Скат кровли ровный — вторая разность у него около нуля при любом уклоне; у края дома она — высота стены.
 */
export const SPLASH_KINK = 0.9;

export interface HeightField {
  /** Угол поля в мире (наименьшие x и z), м. */
  x0: number;
  z0: number;
  /** Сторона поля, м. */
  span: number;
  /** Клеток по стороне. */
  n: number;
  /** Высоты строками по z: `h[j * n + i]`. */
  h: Float32Array;
}

/** Треугольники одного меша: вершины в мировых координатах (x, y, z подряд) и тройки индексов (нет — подряд). */
export interface Surface {
  positions: ArrayLike<number>;
  index: ArrayLike<number> | null;
}

export function emptyField(x0: number, z0: number, span: number, n: number): HeightField {
  return { x0, z0, span, n, h: new Float32Array(n * n).fill(NO_HEIGHT) };
}

/** Высота клетки, в которую падает точка; за краем — `NO_HEIGHT`. */
export function heightAt(f: HeightField, x: number, z: number): number {
  const i = Math.floor(((x - f.x0) / f.span) * f.n);
  const j = Math.floor(((z - f.z0) / f.span) * f.n);
  if (i < 0 || j < 0 || i >= f.n || j >= f.n) return NO_HEIGHT;
  return f.h[j * f.n + i];
}

/**
 * Место брызг у точки — как его считает шейдер (`precip.ts`, `SPLASH_GLSL`): середина клетки, высота её поверхности;
 * край (перегиб больше `SPLASH_KINK`) и пустая клетка — брызг нет (`null`). Брызги на карнизе висели бы в воздухе.
 */
export function splashSpot(f: HeightField, x: number, z: number): { x: number; y: number; z: number } | null {
  const i = Math.floor(((x - f.x0) / f.span) * f.n);
  const j = Math.floor(((z - f.z0) / f.span) * f.n);
  if (i < 1 || j < 1 || i >= f.n - 1 || j >= f.n - 1) return null;
  const at = (a: number, b: number): number => f.h[b * f.n + a];
  const c = at(i, j);
  const l = at(i - 1, j);
  const r = at(i + 1, j);
  const d = at(i, j - 1);
  const u = at(i, j + 1);
  if (Math.min(c, l, r, d, u) <= NO_HEIGHT) return null;
  if (Math.max(Math.abs(l + r - 2 * c), Math.abs(d + u - 2 * c)) > SPLASH_KINK) return null;
  const cell = f.span / f.n;
  return { x: f.x0 + (i + 0.5) * cell, y: c, z: f.z0 + (j + 0.5) * cell };
}

/**
 * Растеризация кусками: поверхности ставятся в очередь (`add`), `step` проходит треугольники, пока не выйдет бюджет
 * времени, и отвечает, всё ли пройдено. Клетка берёт высоту треугольника над своей серединой — наибольшую из всех:
 * кровля над землёй, вода над дном. Стена сверху — отрезок без площади, она в поле не попадает.
 */
export class HeightRaster {
  readonly field: HeightField;
  private queue: Surface[] = [];
  private tri = 0;

  constructor(x0: number, z0: number, span: number, n: number) {
    this.field = emptyField(x0, z0, span, n);
  }

  add(s: Surface): void {
    this.queue.push(s);
  }

  /** Всё ли растеризовано. */
  get done(): boolean {
    return this.queue.length === 0;
  }

  /** Пройти треугольники, пока `now() - start < budgetMs`; вернёт `done`. Без часов — всё сразу. */
  step(budgetMs = Infinity, now: () => number = () => 0): boolean {
    const start = now();
    let k = 0;
    while (this.queue.length > 0) {
      const s = this.queue[0];
      const tris = (s.index ? s.index.length : s.positions.length / 3) / 3;
      if (this.tri >= tris) {
        this.queue.shift();
        this.tri = 0;
        continue;
      }
      this.triangle(s, this.tri++);
      // Часы — раз в сотню треугольников: их чтение дороже самого треугольника.
      if (++k % 128 === 0 && now() - start >= budgetMs) break;
    }
    return this.done;
  }

  private triangle(s: Surface, t: number): void {
    const p = s.positions;
    const ia = s.index ? s.index[t * 3] : t * 3;
    const ib = s.index ? s.index[t * 3 + 1] : t * 3 + 1;
    const ic = s.index ? s.index[t * 3 + 2] : t * 3 + 2;
    const ax = p[ia * 3], ay = p[ia * 3 + 1], az = p[ia * 3 + 2];
    const bx = p[ib * 3], by = p[ib * 3 + 1], bz = p[ib * 3 + 2];
    const cx = p[ic * 3], cy = p[ic * 3 + 1], cz = p[ic * 3 + 2];
    const det = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    // Стена и ребро — без площади сверху: в поле их нет.
    if (Math.abs(det) < 1e-6) return;
    const f = this.field;
    const k = f.n / f.span;
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - f.x0) * k - 0.5));
    const i1 = Math.min(f.n - 1, Math.floor((Math.max(ax, bx, cx) - f.x0) * k - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - f.z0) * k - 0.5));
    const j1 = Math.min(f.n - 1, Math.floor((Math.max(az, bz, cz) - f.z0) * k - 0.5));
    if (i0 > i1 || j0 > j1) return;
    const inv = 1 / det;
    const eps = -1e-6;
    for (let j = j0; j <= j1; j++) {
      const z = f.z0 + (j + 0.5) / k;
      for (let i = i0; i <= i1; i++) {
        const x = f.x0 + (i + 0.5) / k;
        // Барицентрические доли середины клетки.
        const wb = ((x - ax) * (cz - az) - (cx - ax) * (z - az)) * inv;
        const wc = ((bx - ax) * (z - az) - (x - ax) * (bz - az)) * inv;
        const wa = 1 - wb - wc;
        if (wa < eps || wb < eps || wc < eps) continue;
        const y = wa * ay + wb * by + wc * cy;
        const o = j * f.n + i;
        if (y > f.h[o]) f.h[o] = y;
      }
    }
  }
}
