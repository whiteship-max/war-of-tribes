// Земля вида «город»: сетка высот до горизонта (густая в городе, редкая к краю) и карта покрытий —
// брусчатка, земля, пашня и затенение у подножий (docs/city.md, раздел 4). Чистый модуль без three:
// сетка и карта — массивы, сцена заворачивает их в буферы и текстуру.
import { clamp01, fbm, sstep, vnoise } from './noise';
import { CLOSE, distSeg, heightAt, insidePoly, RACE, RACE_HALF, riverX, RIVER_HALF, smoothPath, type CityPlan, type P, type YardKind } from './layout';

/** Где лежит карта покрытий: квадрат в метрах. */
export const MAP_AT = { x0: -256, z0: -300, size: 512 } as const;

/** Карта покрытий RGBA8: r — брусчатка, g — земля, b — пашня, a — открытость (затенение у стен). */
export function groundMap(plan: CityPlan, size: number): Uint8Array {
  const n = size * size;
  const c = new Float32Array(n);
  const d = new Float32Array(n);
  const f = new Float32Array(n);
  const ao = new Float32Array(n).fill(1);
  const m = MAP_AT.size / size;
  const toI = (x: number): number => (x - MAP_AT.x0) / m;
  const toJ = (z: number): number => (z - MAP_AT.z0) / m;
  const X = (i: number): number => MAP_AT.x0 + (i + 0.5) * m;
  const Z = (j: number): number => MAP_AT.z0 + (j + 0.5) * m;
  /** Обход клеток вокруг прямоугольника плана. */
  const each = (x0: number, z0: number, x1: number, z1: number, fn: (x: number, z: number, k: number) => void): void => {
    const i0 = Math.max(0, Math.floor(toI(x0)));
    const i1 = Math.min(size - 1, Math.ceil(toI(x1)));
    const j0 = Math.max(0, Math.floor(toJ(z0)));
    const j1 = Math.min(size - 1, Math.ceil(toJ(z1)));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(X(i), Z(j), j * size + i);
  };
  const stampLine = (pts: readonly P[], half: number, into: Float32Array, soft = 0.6): void => {
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      const pad = half + soft + 1;
      each(Math.min(a.x, b.x) - pad, Math.min(a.z, b.z) - pad, Math.max(a.x, b.x) + pad, Math.max(a.z, b.z) + pad, (x, z, i) => {
        const dd = distSeg({ x, z }, a, b).d;
        const ragged = (vnoise(x * 0.9, z * 0.9, 1e6, 3) - 0.5) * 0.7;
        const w = 1 - sstep(half - soft, half + soft, dd + ragged);
        if (w > into[i]) into[i] = w;
      });
    }
  };
  // Улицы: мостовая и земля.
  for (const s of plan.streets) stampLine(s.pts, s.half, s.surface === 'cobble' ? c : d);
  // Площадь — брусчатка целиком.
  const sq = plan.square;
  const xs = sq.map((p) => p.x);
  const zs = sq.map((p) => p.z);
  each(Math.min(...xs) - 2, Math.min(...zs) - 2, Math.max(...xs) + 2, Math.max(...zs) + 2, (x, z, i) => {
    if (insidePoly({ x, z }, sq)) c[i] = 1;
  });
  // Мостовая не одним серым полем: грязь пятнами в швах и вдоль краёв, вытоптанное посередине.
  for (let k = 0; k < n; k++) {
    if (c[k] < 0.5) continue;
    const x = X(k % size);
    const z = Z(Math.floor(k / size));
    const g = sstep(0.5, 0.78, fbm(x / 14 + 3, z / 14 + 3, 1e6, 4, 33)) * 0.55;
    if (g > d[k]) d[k] = g;
  }
  // Берег реки красит не карта, а сырость по высоте над водой (`banks.groundWet` в вершинах земли): ил у кромки,
  // сырая земля, влажная трава. Прежняя полоса земли вдоль реки вместе с тёмной лентой воды читалась дорогой
  // (docs/city.md, 12.3). Канава мельничного ручья — работа людей: её берега — земля.
  stampLine(smoothPath(RACE, 2), RACE_HALF + 1.6, d, 1.4);
  // Дороги и тропы за стеной — земля; дворы — вытоптанная поляна пятнами.
  for (const r of plan.roads) stampLine(r.pts, r.half, d, 1.2);
  for (const y of plan.yards) {
    // Вытоптано по ремеслу: у забоя и пилорамы — вся поляна, у загона и хутора — пятнами, выгон — луг.
    const [reach, k0] = YARD_TRAMPLE[y.kind];
    each(y.x - y.r, y.z - y.r, y.x + y.r, y.z + y.r, (x, z, i) => {
      const k = Math.hypot(x - y.x, z - y.z) / (y.r * reach);
      const w = (1 - sstep(0.35, 0.95, k + (vnoise(x / 5, z / 5, 1e6, 31) - 0.5) * 0.45)) * k0;
      if (w > d[i]) d[i] = w;
    });
  }
  // Внутри стены, вне улиц: дворы — трава с вытоптанными пятнами земли.
  const wall = plan.wall;
  const wx = wall.map((p) => p.x);
  const wz = wall.map((p) => p.z);
  each(Math.min(...wx), Math.min(...wz), Math.max(...wx), Math.max(...wz), (x, z, i) => {
    if (!insidePoly({ x, z }, wall)) return;
    const n = fbm(x / 70 + 10, z / 70 + 10, 1e6, 3, 21);
    const w = 0.28 + sstep(0.45, 0.8, n) * 0.35;
    if (w > d[i]) d[i] = w;
    // Огороды во дворах: грядки (фактура пашни) пятнами за домами.
    const g = sstep(0.56, 0.64, fbm(x / 26 + 5, z / 26 + 5, 1e6, 3, 25)) * 0.9;
    if (g > f[i]) f[i] = g;
  });
  // Двор храма — ухоженная трава кладбища и сада, без огородов и вытоптанных пятен; у коновязи и поилки за оградой —
  // земля, вытоптанная копытами (docs/city_v3.md).
  each(CLOSE.x0, CLOSE.z1, CLOSE.x1, CLOSE.z0, (x, z, i) => {
    d[i] = Math.min(d[i], 0.1);
    f[i] = 0;
  });
  each(CLOSE.x1 + 0.5, CLOSE.z0 - 26, CLOSE.x1 + 8, CLOSE.z0 - 1, (x, z, i) => {
    const edge = Math.min(x - CLOSE.x1 - 0.5, CLOSE.x1 + 8 - x, z - (CLOSE.z0 - 26), CLOSE.z0 - 1 - z);
    const w = sstep(0, 2.5, edge + (vnoise(x / 3, z / 3, 1e6, 37) - 0.5) * 1.6) * 0.8;
    if (w > d[i]) d[i] = w;
  });
  // Двор замка — утоптанная земля.
  const cw = plan.castleWall;
  each(Math.min(...cw.map((p) => p.x)), Math.min(...cw.map((p) => p.z)), Math.max(...cw.map((p) => p.x)), Math.max(...cw.map((p) => p.z)), (x, z, i) => {
    if (insidePoly({ x, z }, cw)) d[i] = Math.max(d[i], 0.75 + (vnoise(x / 6, z / 6, 1e6, 29) - 0.5) * 0.4);
  });
  // Под домами и большими зданиями — земля; вокруг подножий — тень (затенение).
  const shadeBox = (cx: number, cz: number, ux: number, uz: number, hu: number, hv: number, reach: number, k: number): void => {
    const vx = -uz;
    const vz = ux;
    const r = Math.hypot(hu, hv) + reach;
    each(cx - r, cz - r, cx + r, cz + r, (x, z, i) => {
      const lx = (x - cx) * ux + (z - cz) * uz;
      const lz = (x - cx) * vx + (z - cz) * vz;
      const ox = Math.max(0, Math.abs(lx) - hu);
      const oz = Math.max(0, Math.abs(lz) - hv);
      const out = Math.hypot(ox, oz);
      if (out <= 0) {
        d[i] = 1;
        return;
      }
      const s = 1 - k * (1 - sstep(0, reach, out));
      if (s < ao[i]) ao[i] = s;
    });
  };
  for (const h of [...plan.houses, ...plan.suburb]) shadeBox(h.x, h.z, -h.fz, h.fx, h.w / 2 + 0.1, h.d / 2 + 0.1, 1.6, 0.42);
  for (const cv of plan.civic) shadeBox(cv.x, cv.z, -Math.sin(cv.rot), Math.cos(cv.rot), cv.w / 2, cv.d / 2, 2.2, 0.45);
  for (const t of plan.towers) shadeBox(t.x, t.z, 1, 0, t.size / 2, t.size / 2, 2.5, 0.5);
  // Подножие стены: тень с обеих сторон и полоса земли.
  for (const wl of [plan.wall, plan.castleWall]) {
    const pts = [...wl, wl[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      each(Math.min(a.x, b.x) - 5, Math.min(a.z, b.z) - 5, Math.max(a.x, b.x) + 5, Math.max(a.z, b.z) + 5, (x, z, i) => {
        const dd = distSeg({ x, z }, a, b).d;
        const s = 1 - 0.5 * (1 - sstep(1.2, 4.5, dd));
        if (s < ao[i]) ao[i] = s;
        const w = 1 - sstep(1.5, 3.5, dd + (vnoise(x, z, 1e6, 5) - 0.5));
        if (w > d[i]) d[i] = w;
      });
    }
  }
  // Пашня: полосы на восточном склоне и у шеи мыса — вне стены, вне леса.
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = X(i);
      const z = Z(j);
      const k = j * size + i;
      const fw = fieldAt(x, z, plan);
      if (fw > f[k]) f[k] = fw;
    }
  }
  const out = new Uint8Array(n * 4);
  for (let k = 0; k < n; k++) {
    const cc = clamp01(c[k]);
    const dd = clamp01(d[k]) * (1 - cc * 0.55);
    const ff = clamp01(f[k]) * (1 - cc) * (1 - dd);
    out[k * 4] = Math.round(cc * 255);
    out[k * 4 + 1] = Math.round(dd * 255);
    out[k * 4 + 2] = Math.round(ff * 255);
    out[k * 4 + 3] = Math.round(clamp01(ao[k]) * 255);
  }
  return out;
}

/** Сколько земли вытоптано у двора: доля поляны и сила. */
const YARD_TRAMPLE: Record<YardKind, [number, number]> = {
  gathering: [0.75, 0.7],
  sawmill: [0.85, 0.8],
  quarry: [0.95, 0.85],
  hunter_hut: [0.6, 0.6],
  mine: [0.85, 0.8],
  farm: [0.55, 0.55],
  pen: [0.3, 0.45],
};

/** Свободна ли земля за стеной от дворов, предместья и дорог (пашня и лес туда не заходят). */
export function openLand(x: number, z: number, plan: CityPlan, pad = 0): boolean {
  for (const y of plan.yards) if (Math.hypot(x - y.x, z - y.z) < y.r + pad) return false;
  for (const h of plan.suburb) if (Math.hypot(x - h.x, z - h.z) < Math.max(h.w, h.d) + 4 + pad) return false;
  for (const r of plan.roads) {
    const pts = r.pts;
    for (let k = 0; k < pts.length - 1; k++) if (distSeg({ x, z }, pts[k], pts[k + 1]).d < r.half + 2 + pad) return false;
  }
  return true;
}

/** Вне стены и гласиса: восточный склон и шея мыса — поля полосами. */
export function fieldAt(x: number, z: number, plan: CityPlan): number {
  if (insidePoly({ x, z }, plan.wall) || insidePoly({ x, z }, plan.castleWall)) return 0;
  const east = x > 125 && x < 330 && z > -170 && z < 190;
  const south = z > 175 && z < 330 && Math.abs(x) < 220;
  if (!east && !south) return 0;
  if (!openLand(x, z, plan, 2)) return 0;
  // Поля — клетки 40×90 м со своим направлением полос; межи — трава.
  const cx = Math.floor((x + 1000) / 46);
  const cz = Math.floor((z + 1000) / 88);
  const r = vnoise(cx * 7.3, cz * 3.1, 1e6, 11);
  if (r < 0.28) return 0;
  const fx = (x + 1000) / 46 - cx;
  const fz = (z + 1000) / 88 - cz;
  const edge = Math.min(fx, 1 - fx) * 46 > 1.6 && Math.min(fz, 1 - fz) * 88 > 1.6;
  return edge ? 1 : 0;
}

/** Вода: река в западной долине. */
export const inRiver = (x: number, z: number): boolean => Math.abs(x - riverX(z)) < RIVER_HALF;

/** Сетка земли: квадрат, густая в середине и редкая к краю (нечётная степень по каждой оси). */
export interface GroundGrid {
  positions: Float32Array;
  normals: Float32Array;
  index: Uint32Array;
  nx: number;
  nz: number;
}

/** x(t) = A·t + B·t⁵ на t ∈ [−1, 1]: середина — шаг `cell`, край — `reach`. */
const warp = (t: number, cell: number, cells: number, reach: number): number => {
  const A = (cell * cells) / 2;
  return A * t + (reach - A) * t * t * t * t * t;
};

export function groundGrid(cells: number, cell: number, center: P, reach: number): GroundGrid {
  const nx = cells + 1;
  const nz = cells + 1;
  const positions = new Float32Array(nx * nz * 3);
  const normals = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) {
    const z = center.z + warp((j / cells) * 2 - 1, cell, cells, reach);
    for (let i = 0; i < nx; i++) {
      const x = center.x + warp((i / cells) * 2 - 1, cell, cells, reach);
      const k = (j * nx + i) * 3;
      const y = heightAt(x, z);
      positions[k] = x;
      positions[k + 1] = y;
      positions[k + 2] = z;
      const e = 0.8;
      const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
      const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      const l = Math.hypot(gx, 1, gz);
      normals[k] = -gx / l;
      normals[k + 1] = 1 / l;
      normals[k + 2] = -gz / l;
    }
  }
  const index = new Uint32Array(cells * cells * 6);
  let o = 0;
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      index[o++] = a;
      index[o++] = c;
      index[o++] = b;
      index[o++] = b;
      index[o++] = c;
      index[o++] = d;
    }
  }
  return { positions, normals, index, nx, nz };
}

/**
 * Высота нарисованной земли в точке — по треугольникам сетки, а не по `heightAt`: между узлами сетка идёт
 * прямой, и на редкой сетке вдали она выше или ниже рельефа. По ней тест посадки (`seat.test.ts`) судит,
 * не утонула ли постройка и не висит ли. Сетка разделима: x узла зависит только от столбца, z — от строки.
 */
export function gridHeight(g: GroundGrid, x: number, z: number): number {
  const p = g.positions;
  const find = (v: number, n: number, at: (k: number) => number): number => {
    let lo = 0;
    let hi = n - 1;
    if (v <= at(0)) return 0;
    if (v >= at(n - 1)) return n - 2;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (at(m) <= v) lo = m;
      else hi = m;
    }
    return lo;
  };
  const i = find(x, g.nx, (k) => p[k * 3]);
  const j = find(z, g.nz, (k) => p[k * g.nx * 3 + 2]);
  const h = (ii: number, jj: number): number => p[(jj * g.nx + ii) * 3 + 1];
  const x0 = p[i * 3];
  const x1 = p[(i + 1) * 3];
  const z0 = p[j * g.nx * 3 + 2];
  const z1 = p[(j + 1) * g.nx * 3 + 2];
  const u = Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));
  const v = Math.min(1, Math.max(0, (z - z0) / (z1 - z0)));
  // Треугольники (a, c, b) и (b, c, d); диагональ — от (i+1, j) к (i, j+1).
  const ha = h(i, j);
  const hb = h(i + 1, j);
  const hc = h(i, j + 1);
  const hd = h(i + 1, j + 1);
  if (u + v <= 1) return ha + u * (hb - ha) + v * (hc - ha);
  return hd + (1 - u) * (hc - hd) + (1 - v) * (hb - hd);
}
