// Земля вида «город»: сетка высот до горизонта (густая в городе, редкая к краю) и карта покрытий —
// брусчатка, земля, пашня и затенение у подножий (docs/city.md, раздел 4). Чистый модуль без three:
// сетка и карта — массивы, сцена заворачивает их в буферы и текстуру.
import { clamp01, fbm, sstep, vnoise } from './noise';
import { CLOSE, distPoly, distSeg, heightAt, insidePoly, RACE, RACE_HALF, riverX, RIVER_HALF, smoothPath, type CityPlan, type P, type YardKind } from './layout';
import { deadEnds, mudAt, nearRoad } from './roads';

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
  // `ruts` — дорога за стеной: две колеи темнее (затенением карты, альфа) и травяной горб между ними.
  const stampLine = (pts: readonly P[], half: number, into: Float32Array, soft = 0.6, ruts = false): void => {
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k];
      const b = pts[k + 1];
      const pad = half + soft + 1;
      each(Math.min(a.x, b.x) - pad, Math.min(a.z, b.z) - pad, Math.max(a.x, b.x) + pad, Math.max(a.z, b.z) + pad, (x, z, i) => {
        const dd = distSeg({ x, z }, a, b).d;
        const ragged = (vnoise(x * 0.9, z * 0.9, 1e6, 3) - 0.5) * 0.7;
        let w = 1 - sstep(half - soft, half + soft, dd + ragged);
        if (ruts && w > 0) {
          const u = dd / half;
          w *= 1 - 0.4 * (1 - sstep(0.08, 0.26, u + ragged * 0.1));
          const rut = (1 - sstep(0.07, 0.17, Math.abs(u - 0.45))) * w;
          const s = 1 - 0.22 * rut;
          if (s < ao[i]) ao[i] = s;
        }
        if (w > into[i]) into[i] = w;
      });
    }
  };
  // Улицы: мостовая и земля. Грунт переулка у мостовой кончается: переулок, доведённый до середины Главной, ложился поперёк
  // мостовой бурой полосой (docs/city_v3.md, Г-3, «Косяки») — земля улиц собирается отдельно и гаснет там, где мостовая.
  const ds = new Float32Array(n);
  for (const s of plan.streets) stampLine(s.pts, s.half, s.surface === 'cobble' ? c : ds);
  // Площадь — брусчатка целиком.
  const sq = plan.square;
  const xs = sq.map((p) => p.x);
  const zs = sq.map((p) => p.z);
  // Мостовая площади выходит за её край на полтора метра, к фасадам: у южной кромки, где кончается Главная, оставался клин
  // травы, и прохожие с Главной на площадь шли по нему (Г-3, «Косяки»).
  each(Math.min(...xs) - 3, Math.min(...zs) - 3, Math.max(...xs) + 3, Math.max(...zs) + 3, (x, z, i) => {
    const p = { x, z };
    if (insidePoly(p, sq)) c[i] = 1;
    else {
      const w = 1 - sstep(0.4, 2.2, distPoly(p, sq, true) + (vnoise(x * 0.9, z * 0.9, 1e6, 3) - 0.5) * 0.7);
      if (w > c[i]) c[i] = w;
    }
  });
  // Полоса между оградой двора храма и Верхней улицей — мостовая до ограды: там коновязь, поилка и сено. Прежде — вытоптанный
  // прямоугольник 7 × 25 м, и с камеры игры он читался короткой тёмной дорожкой справа от храма (Г-3, «Косяки»).
  each(CLOSE.x1, CLOSE.z0 - 30, CLOSE.x1 + 10, CLOSE.z0 + 11, (x, z, i) => {
    const edge = Math.min(x - CLOSE.x1 - 0.3, z - (CLOSE.z0 - 28));
    const w = sstep(-0.4, 1.2, edge + (vnoise(x * 0.9, z * 0.9, 1e6, 3) - 0.5) * 0.7);
    if (w > c[i]) c[i] = w;
  });
  // Тупик переулка — утоптанный дворик у задних стен домов, а не полоса, оборванная в траве.
  for (const e of deadEnds(plan)) {
    const cx = e.x + e.tx * 2.5;
    const cz = e.z + e.tz * 2.5;
    const r = e.half + 3.2;
    each(cx - r - 2, cz - r - 2, cx + r + 2, cz + r + 2, (x, z, i) => {
      const k = Math.hypot(x - cx, z - cz) / r;
      const w = 1 - sstep(0.55, 1.05, k + (vnoise(x / 2.2, z / 2.2, 1e6, 71) - 0.5) * 0.4);
      if (w > ds[i]) ds[i] = w;
    });
  }
  for (let k = 0; k < n; k++) {
    const w = ds[k] * (1 - c[k]);
    if (w > d[k]) d[k] = w;
  }
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
  for (const r of plan.roads) stampLine(r.pts, r.half, d, 1.2, r.half >= 2.5);
  for (const y of plan.yards) {
    // Вытоптано по ремеслу: у забоя и пилорамы — вся поляна, у загона и хутора — пятнами, выгон — луг.
    const [reach, k0] = YARD_TRAMPLE[y.kind];
    each(y.x - y.r, y.z - y.r, y.x + y.r, y.z + y.r, (x, z, i) => {
      const k = Math.hypot(x - y.x, z - y.z) / (y.r * reach);
      const w = (1 - sstep(0.35, 0.95, k + (vnoise(x / 5, z / 5, 1e6, 31) - 0.5) * 0.45)) * k0;
      if (w > d[i]) d[i] = w;
    });
  }
  // Внутри стены, вне улиц: дворы — трава; вытоптано пятнами и тропками, ровной бурой подстилки нет (Г-3: прежде весь город
  // между улицами лежал на трети земли, и переулки в нём не читались).
  const wall = plan.wall;
  const wx = wall.map((p) => p.x);
  const wz = wall.map((p) => p.z);
  each(Math.min(...wx), Math.min(...wz), Math.max(...wx), Math.max(...wz), (x, z, i) => {
    if (!insidePoly({ x, z }, wall)) return;
    const n = fbm(x / 40 + 10, z / 40 + 10, 1e6, 3, 21);
    const w = 0.06 + sstep(0.55, 0.82, n) * 0.4 + sstep(0.6, 0.75, vnoise(x / 6, z / 6, 1e6, 23)) * 0.12;
    if (w > d[i]) d[i] = w;
    // Огороды во дворах: грядки (фактура пашни) пятнами за домами.
    const g = sstep(0.56, 0.64, fbm(x / 26 + 5, z / 26 + 5, 1e6, 3, 25)) * 0.9;
    if (g > f[i]) f[i] = g;
  });
  // Двор храма — ухоженная трава кладбища и сада, без огородов и вытоптанных пятен; у коновязи и поилки за оградой —
  // мостовая (выше) и грязь пятнами (`roads.mudAt`).
  each(CLOSE.x0, CLOSE.z1, CLOSE.x1, CLOSE.z0, (x, z, i) => {
    d[i] = Math.min(d[i], 0.1);
    f[i] = 0;
  });
  // Грязь у ворот, конюшни, кузницы, загона (`roads.mudAt`) лежит на земле: темнит и мочит её шейдер по вершинам.
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i;
      const w = mudAt(X(i), Z(j), plan) * 0.95;
      if (w > d[k]) d[k] = w;
    }
  }
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
      // Вокруг стен трава вытоптана тропкой: к двери, к поленнице, под капелью с кровли.
      const t = (1 - sstep(0.3, 1.6, out + (vnoise(x / 1.7, z / 1.7, 1e6, 27) - 0.5) * 0.9)) * 0.55;
      if (t > d[i]) d[i] = t;
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
  return !nearRoad(x, z, plan, 2 + pad);
}

/** Поле: клетка 46 × 88 м со своим направлением полос; межи — трава. Клетку и её семя читает и шейдер земли (`material.ts`). */
export const FIELD_CELL = { x: 46, z: 88, off: 1000 } as const;

/**
 * Деревни на дорогах вдали (docs/city_v3.md, Г-3): у каждой — поля кругом. Дома не строятся — до них 600–900 м, и в дымке
 * деревню читает пашня у дороги; точка — на длине `s` метров по дороге от ворот.
 */
const HAMLETS: readonly { road: string; s: number; r: number }[] = [
  { road: 'Дорога в долину', s: 620, r: 230 },
  { road: 'Восточная дорога', s: 720, r: 250 },
  { road: 'Лесная дорога', s: 560, r: 170 },
];

const hamletsOf = new WeakMap<CityPlan, (P & { r: number })[]>();
export function hamlets(plan: CityPlan): (P & { r: number })[] {
  const had = hamletsOf.get(plan);
  if (had) return had;
  const out: (P & { r: number })[] = [];
  for (const h of HAMLETS) {
    const r = plan.roads.find((x) => x.name === h.road);
    if (!r) continue;
    let s = h.s;
    for (let k = 0; k < r.pts.length - 1; k++) {
      const l = Math.hypot(r.pts[k + 1].x - r.pts[k].x, r.pts[k + 1].z - r.pts[k].z);
      if (s <= l) {
        out.push({ x: r.pts[k].x + ((r.pts[k + 1].x - r.pts[k].x) * s) / l, z: r.pts[k].z + ((r.pts[k + 1].z - r.pts[k].z) * s) / l, r: h.r });
        break;
      }
      s -= l;
    }
  }
  hamletsOf.set(plan, out);
  return out;
}

/**
 * Где пашня: восточный склон и шея мыса у города, кругом деревень вдали. Решает клетка целиком — по своей середине и своему
 * зерну: край пашни идёт межами клеток, ступенями, а не прямой через весь склон (прежде южный край — прямая z 175 через
 * 440 м, с ролика у ворот — полоса поперёк, Г-3, «Косяки»).
 */
function fieldCell(cx: number, cz: number, plan: CityPlan): boolean {
  const x = (cx + 0.5) * FIELD_CELL.x - FIELD_CELL.off;
  const z = (cz + 0.5) * FIELD_CELL.z - FIELD_CELL.off;
  const r = vnoise(cx * 7.3, cz * 3.1, 1e6, 11);
  if (r < 0.28) return false;
  // Запас клетки: край угодий — не линейка.
  const j = (vnoise(cx * 3.7 + 0.5, cz * 5.3 + 0.5, 1e6, 15) - 0.5) * 70;
  if (x > 125 + j && x < 330 + j && z > -170 && z < 190 + j) return true;
  if (z > 175 + j && z < 330 + j && Math.abs(x) < 220 + j) return true;
  for (const h of hamlets(plan)) if (Math.hypot(x - h.x, z - h.z) < h.r + j - (r - 0.28) * 90) return true;
  return false;
}

/** Вне стены и гласиса: восточный склон и шея мыса, поля у деревень — полосами. */
export function fieldAt(x: number, z: number, plan: CityPlan): number {
  const fx = (x + FIELD_CELL.off) / FIELD_CELL.x;
  const fz = (z + FIELD_CELL.off) / FIELD_CELL.z;
  const cx = Math.floor(fx);
  const cz = Math.floor(fz);
  const ux = fx - cx;
  const uz = fz - cz;
  // Межа — трава между клетками.
  if (Math.min(ux, 1 - ux) * FIELD_CELL.x <= 1.6 || Math.min(uz, 1 - uz) * FIELD_CELL.z <= 1.6) return 0;
  if (!fieldCell(cx, cz, plan)) return 0;
  if (insidePoly({ x, z }, plan.wall) || insidePoly({ x, z }, plan.castleWall)) return 0;
  if (Math.abs(x - riverX(z)) < RIVER_HALF + 14) return 0;
  return openLand(x, z, plan, 2) ? 1 : 0;
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
