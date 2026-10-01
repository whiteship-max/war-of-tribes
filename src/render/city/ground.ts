// Земля вида «город»: сетка высот до горизонта (густая в городе, редкая к краю) и карта покрытий —
// брусчатка, земля, пашня и затенение у подножий (docs/city.md, раздел 4). Чистый модуль без three:
// сетка и карта — массивы, сцена заворачивает их в буферы и текстуру.
import { clamp01, fbm, sstep, vnoise } from './noise';
import { distSeg, heightAt, insidePoly, riverX, RIVER_HALF, type CityPlan, type P } from './layout';

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
  // Двор храма и дворы больших зданий — утоптанная земля пятнами; дорога из ворот вниз — земля.
  const gate = plan.gates[0];
  stampLine(
    [
      { x: gate.x, z: gate.z },
      { x: gate.x + 2, z: gate.z + 40 },
      { x: gate.x - 8, z: gate.z + 110 },
      { x: gate.x - 4, z: gate.z + 200 },
    ],
    3.2,
    d,
    1.2,
  );
  const east = plan.gates[1];
  stampLine(
    [
      { x: east.x, z: east.z },
      { x: east.x + 40, z: east.z + 6 },
      { x: east.x + 110, z: east.z - 20 },
      { x: east.x + 200, z: east.z - 10 },
    ],
    2.6,
    d,
    1.2,
  );
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
  for (const h of plan.houses) shadeBox(h.x, h.z, -h.fz, h.fx, h.w / 2 + 0.1, h.d / 2 + 0.1, 1.6, 0.42);
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

/** Вне стены и гласиса: восточный склон и шея мыса — поля полосами. */
export function fieldAt(x: number, z: number, plan: CityPlan): number {
  if (insidePoly({ x, z }, plan.wall) || insidePoly({ x, z }, plan.castleWall)) return 0;
  const east = x > 125 && x < 330 && z > -170 && z < 190;
  const south = z > 175 && z < 330 && Math.abs(x) < 220;
  if (!east && !south) return 0;
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
