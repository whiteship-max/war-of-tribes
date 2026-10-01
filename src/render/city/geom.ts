// Построитель геометрии вида «город»: грани с UV в метрах плитки слоя, номер слоя, тон и затенение
// в вершинах. Чистый модуль без three: копит массивы, а сцена (`index.ts`) заворачивает их в буферы.
// Один построитель — один меш: все дома, стена и башни города ложатся в один-два вызова отрисовки.
//
// Вершина несёт: положение, нормаль, UV (в плитках слоя — повтор делает выборка), тон (линейный
// RGB × затенение), `cfg` = (слой, свет окна ночью 0..255, грязь у земли 0..255, постройка игры —
// номер в `sites.CITY_OWNERS` + 1, 0 — убранство без постройки: по нему подсвечивается выбранное).
import { L, TILE_M, type LayerName } from './tex';
import { linear } from './palette';

export type V3 = [number, number, number];

export class Builder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  cfg: number[] = [];
  idx: number[] = [];
  /** Чья постройка пишется сейчас: четвёртый байт `cfg` (0 — ничья). */
  owner = 0;
  private n = 0;

  get vertexCount(): number {
    return this.n;
  }
  get triangleCount(): number {
    return this.idx.length / 3;
  }

  /**
   * Четырёхугольник a-b-c-d против часовой, если смотреть снаружи. `uv` — по углам, в плитках.
   * `tint` — линейный цвет; `ao` — затенение углов (1 — открыто); `glow` — свет окон ночью (0..1);
   * `grime` — грязь у земли по углам (0..1).
   */
  quad(
    a: V3,
    b: V3,
    c: V3,
    d: V3,
    uv: readonly [number, number, number, number, number, number, number, number],
    layer: number,
    tint: V3,
    ao: readonly [number, number, number, number] = [1, 1, 1, 1],
    glow = 0,
    grime: readonly [number, number, number, number] = [0, 0, 0, 0],
  ): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = d[0] - a[0];
    const vy = d[1] - a[1];
    const vz = d[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const base = this.n;
    const ps = [a, b, c, d];
    for (let k = 0; k < 4; k++) {
      const p = ps[k];
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.uv.push(uv[k * 2], uv[k * 2 + 1]);
      this.col.push(tint[0] * ao[k], tint[1] * ao[k], tint[2] * ao[k]);
      this.cfg.push(layer, Math.round(glow * 255), Math.round(grime[k] * 255), this.owner);
    }
    this.n += 4;
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Треугольник a-b-c против часовой снаружи. */
  tri(a: V3, b: V3, c: V3, uv: readonly [number, number, number, number, number, number], layer: number, tint: V3, ao: readonly [number, number, number] = [1, 1, 1], glow = 0): void {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const base = this.n;
    const ps = [a, b, c];
    for (let k = 0; k < 3; k++) {
      const p = ps[k];
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.uv.push(uv[k * 2], uv[k * 2 + 1]);
      this.col.push(tint[0] * ao[k], tint[1] * ao[k], tint[2] * ao[k]);
      this.cfg.push(layer, Math.round(glow * 255), 0, this.owner);
    }
    this.n += 3;
    this.idx.push(base, base + 1, base + 2);
  }

  /** Сколько вершин и треугольников уже есть — для счёта по частям. */
  mark(): { v: number; t: number } {
    return { v: this.n, t: this.idx.length / 3 };
  }

  /**
   * Охват вершин с номера `from` в рамке плана: середина (cx, cz), «вперёд» (fx, fz). Отдаёт пределы
   * вперёд (`f0..f1`), вправо (`r0..r1`) и по высоте — коробку касания, снятую с самой модели.
   */
  extent(from: number, cx: number, cz: number, fx: number, fz: number): Extent {
    const e: Extent = { f0: Infinity, f1: -Infinity, r0: Infinity, r1: -Infinity, y0: Infinity, y1: -Infinity };
    for (let k = from; k < this.n; k++) {
      const dx = this.pos[k * 3] - cx;
      const y = this.pos[k * 3 + 1];
      const dz = this.pos[k * 3 + 2] - cz;
      // «Вправо» — как у `kit.Frame`: (fz, −fx).
      const f = dx * fx + dz * fz;
      const r = dx * fz - dz * fx;
      if (f < e.f0) e.f0 = f;
      if (f > e.f1) e.f1 = f;
      if (r < e.r0) e.r0 = r;
      if (r > e.r1) e.r1 = r;
      if (y < e.y0) e.y0 = y;
      if (y > e.y1) e.y1 = y;
    }
    return e;
  }
}

/** Пределы вершин в рамке плана — `Builder.extent`. */
export interface Extent {
  f0: number;
  f1: number;
  r0: number;
  r1: number;
  y0: number;
  y1: number;
}

/** Тон из sRGB hex — линейный, как ждёт материал. */
export const tint = (hex: number, k = 1): V3 => {
  const c = linear(hex);
  return [c[0] * k, c[1] * k, c[2] * k];
};

export const WHITE: V3 = [0.92, 0.92, 0.92];

// ---------------------------------------------------------------------------------------------
// Стены: вертикальная грань по отрезку плана, UV в плитках слоя.

export interface WallFace {
  /** Начало и конец по низу (x, z), слева направо, если смотреть снаружи. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Низ и верх грани. */
  y0: number;
  y1: number;
  layer: LayerName;
  tint: V3;
  /** Сдвиг и растяжение UV: u от `u0` на `uSpan` плиток по ширине; v — метры от `vBase`. */
  u0?: number;
  uSpan?: number;
  vBase?: number;
  /** Высота плитки по v, метры (по умолчанию — из слоя). */
  vTile?: number;
  aoBottom?: number;
  aoTop?: number;
  glow?: number;
  /** Грязь у низа: 1 у самого низа грани. */
  grimeBottom?: number;
  grimeTop?: number;
}

export function wall(b: Builder, f: WallFace): void {
  const [tw, th] = TILE_M[f.layer];
  const len = Math.hypot(f.bx - f.ax, f.bz - f.az);
  const u0 = f.u0 ?? 0;
  const u1 = u0 + (f.uSpan ?? len / tw);
  const vt = f.vTile ?? th;
  const vb = f.vBase ?? f.y0;
  const v0 = (f.y0 - vb) / vt;
  const v1 = (f.y1 - vb) / vt;
  const ab = f.aoBottom ?? 1;
  const at = f.aoTop ?? 1;
  const gb = f.grimeBottom ?? 0;
  const gt = f.grimeTop ?? 0;
  b.quad(
    [f.ax, f.y0, f.az],
    [f.bx, f.y0, f.bz],
    [f.bx, f.y1, f.bz],
    [f.ax, f.y1, f.az],
    [u0, v0, u1, v0, u1, v1, u0, v1],
    L[f.layer],
    f.tint,
    [ab, ab, at, at],
    f.glow ?? 0,
    [gb, gb, gt, gt],
  );
}

/** Горизонтальная грань (вверх или вниз) по четырём точкам плана на высоте `y`, UV — мировые метры. */
export function flat(b: Builder, pts: readonly [number, number][], y: number, layer: LayerName, t: V3, up = true, ao = 1): void {
  const [tw, th] = TILE_M[layer];
  const P = pts.map(([x, z]) => [x, y, z] as V3);
  const uv = pts.flatMap(([x, z]) => [x / tw, z / th]) as unknown as [number, number, number, number, number, number, number, number];
  if (up) b.quad(P[0], P[1], P[2], P[3], uv, L[layer], t, [ao, ao, ao, ao]);
  else b.quad(P[3], P[2], P[1], P[0], [uv[6], uv[7], uv[4], uv[5], uv[2], uv[3], uv[0], uv[1]], L[layer], t, [ao, ao, ao, ao]);
}

/**
 * Коробка по плану: середина, направление «вперёд» (fx, fz), ширина вдоль фасада и глубина,
 * от `y0` до `y1`. Грани — по `face(i)` (0 — перед, 1 — право, 2 — зад, 3 — лево), крышка — по `top`.
 */
export function box(
  b: Builder,
  cx: number,
  cz: number,
  fx: number,
  fz: number,
  w: number,
  d: number,
  y0: number,
  y1: number,
  layer: LayerName,
  t: V3,
  top: LayerName | null = layer,
  opt: Partial<WallFace> = {},
): void {
  // «Право», если смотреть на фасад снаружи: обход углов c0→c1→c2→c3 даёт нормали наружу.
  const rx = fz;
  const rz = -fx;
  const hw = w / 2;
  const hd = d / 2;
  // Углы против часовой сверху: перед-лево, перед-право, зад-право, зад-лево.
  const c = [
    [cx + fx * hd - rx * hw, cz + fz * hd - rz * hw],
    [cx + fx * hd + rx * hw, cz + fz * hd + rz * hw],
    [cx - fx * hd + rx * hw, cz - fz * hd + rz * hw],
    [cx - fx * hd - rx * hw, cz - fz * hd - rz * hw],
  ] as [number, number][];
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const e = c[(i + 1) % 4];
    wall(b, { ax: a[0], az: a[1], bx: e[0], bz: e[1], y0, y1, layer, tint: t, ...opt });
  }
  if (top) flat(b, c, y1, top, t, true);
}

/** Цилиндр (башня): `seg` граней, UV по окружности в плитках слоя. */
export function cylinder(b: Builder, cx: number, cz: number, r: number, y0: number, y1: number, seg: number, layer: LayerName, t: V3, opt: Partial<WallFace> = {}): void {
  const [tw] = TILE_M[layer];
  const circ = 2 * Math.PI * r;
  const per = Math.max(1, Math.round(circ / tw));
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2;
    const a1 = ((k + 1) / seg) * Math.PI * 2;
    wall(b, {
      ax: cx + Math.cos(a1) * r,
      az: cz + Math.sin(a1) * r,
      bx: cx + Math.cos(a0) * r,
      bz: cz + Math.sin(a0) * r,
      y0,
      y1,
      layer,
      tint: t,
      u0: ((seg - k - 1) / seg) * per,
      uSpan: per / seg,
      ...opt,
    });
  }
}

/** Конус (кровля круглой башни, шпиль): вершина на `apex`, низ — окружность `r` на `y0`. */
export function cone(b: Builder, cx: number, cz: number, r: number, y0: number, apex: number, seg: number, layer: LayerName, t: V3, aoBase = 0.8): void {
  const [tw, th] = TILE_M[layer];
  const slant = Math.hypot(r, apex - y0);
  const circ = 2 * Math.PI * r;
  const per = Math.max(1, Math.round(circ / tw));
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2;
    const a1 = ((k + 1) / seg) * Math.PI * 2;
    const u0 = ((seg - k - 1) / seg) * per;
    const u1 = ((seg - k) / seg) * per;
    b.tri(
      [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r],
      [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r],
      [cx, apex, cz],
      [u0, 0, u1, 0, (u0 + u1) / 2, slant / th],
      L[layer],
      t,
      [aoBase, aoBase, 1],
    );
  }
}

/** Пирамида по многоугольнику плана (шатёр башни, шпиль): вершина над серединой. */
export function pyramid(b: Builder, pts: readonly [number, number][], y0: number, apex: V3, layer: LayerName, t: V3, aoBase = 0.8): void {
  const [tw, th] = TILE_M[layer];
  const n = pts.length;
  for (let k = 0; k < n; k++) {
    const p = pts[k];
    const q = pts[(k + 1) % n];
    const w = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const mx = (p[0] + q[0]) / 2;
    const mz = (p[1] + q[1]) / 2;
    const slant = Math.hypot(Math.hypot(apex[0] - mx, apex[2] - mz), apex[1] - y0);
    b.tri([p[0], y0, p[1]], [q[0], y0, q[1]], apex, [0, 0, w / tw, 0, w / tw / 2, slant / th], L[layer], t, [aoBase, aoBase, 1]);
  }
}

/** Наклонная грань кровли: низ a→b (карниз), верх d←c (конёк); UV — вдоль карниза и вверх по скату. */
export function slope(b: Builder, a: V3, bb: V3, c: V3, d: V3, layer: LayerName, t: V3, u0 = 0, aoEave = 0.92, aoRidge = 1): void {
  const [tw, th] = TILE_M[layer];
  const w = Math.hypot(bb[0] - a[0], bb[2] - a[2]);
  const s = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
  b.quad(a, bb, c, d, [u0, 0, u0 + w / tw, 0, u0 + w / tw, s / th, u0, s / th], L[layer], t, [aoEave, aoEave, aoRidge, aoRidge]);
}

/**
 * Четырёхугольник, развёрнутый лицом к направлению `want`: если обход a-b-c-d смотрит не туда,
 * грань пишется зеркально (b-a-d-c) вместе с UV, затенением и грязью.
 */
export function quadToward(
  b: Builder,
  a: V3,
  bb: V3,
  c: V3,
  d: V3,
  uv: readonly [number, number, number, number, number, number, number, number],
  layer: number,
  t: V3,
  want: V3,
  ao: readonly [number, number, number, number] = [1, 1, 1, 1],
  glow = 0,
  grime: readonly [number, number, number, number] = [0, 0, 0, 0],
): void {
  const ux = bb[0] - a[0];
  const uy = bb[1] - a[1];
  const uz = bb[2] - a[2];
  const vx = d[0] - a[0];
  const vy = d[1] - a[1];
  const vz = d[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (nx * want[0] + ny * want[1] + nz * want[2] >= 0) b.quad(a, bb, c, d, uv, layer, t, ao, glow, grime);
  else b.quad(bb, a, d, c, [uv[2], uv[3], uv[0], uv[1], uv[6], uv[7], uv[4], uv[5]], layer, t, [ao[1], ao[0], ao[3], ao[2]], glow, [grime[1], grime[0], grime[3], grime[2]]);
}
