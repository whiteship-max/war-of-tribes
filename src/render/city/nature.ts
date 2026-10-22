// Лес и деревья вида «город» (docs/city.md, раздел 4): лиственные кроны комьями, ели ярусами, плодовые
// во дворах, липа на площади. Ближние деревья — моделями с тенью, дальние — дешёвой моделью без тени,
// а сплошной дальний лес — полог в цвете листвы на земле (карта земель, `landMap`). Чистый модуль без
// three: модели — построители, расстановка — массивы.
import { CITY } from './palette';
import { Builder, tint, type V3 } from './geom';
import { distPoly, heightAt, hillsAt, insidePoly, riverX, RIVER_HALF, yardTreeHeight, type CityPlan, type P } from './layout';
import { fieldAt, openLand } from './ground';
import { L, TILE_M } from './tex';
import { fbm, hash3, rnd, sstep, vnoise } from './noise';
import { roadU, ROAD_U_MAX } from './roads';

/** Гласис: луг под стеной, на котором лес не растёт, — метры от стены. */
export const GLACIS = 26;

/** Сколько леса в точке, 0..1: вне стены и гласиса, не на полях, не в реке, не на дорогах. */
export function forestAt(x: number, z: number, plan: CityPlan): number {
  const p = { x, z };
  if (insidePoly(p, plan.wall) || insidePoly(p, plan.castleWall)) return 0;
  const dw = Math.min(distPoly(p, plan.wall, true), distPoly(p, plan.castleWall, true));
  // Гласис: луг под стеной — обстрел, его не засаживали.
  if (dw < GLACIS) return 0;
  const glacis = sstep(GLACIS, GLACIS + 20, dw + (vnoise(x / 30, z / 30, 1e6, 41) - 0.5) * 16);
  if (glacis <= 0) return 0;
  if (fieldAt(x, z, plan) > 0) return 0;
  const rd = Math.abs(x - riverX(z));
  if (rd < RIVER_HALF + 5) return 0;
  // Луг вдоль реки; дороги, дворы и предместье — без леса (поляна с рваным краем — шум ниже).
  const bank = sstep(RIVER_HALF + 5, RIVER_HALF + 26, rd);
  if (!openLand(x, z, plan, 3 + vnoise(x / 9, z / 9, 1e6, 53) * 6)) return 0;
  const big = fbm(x / 260 + 7, z / 260 + 7, 1e6, 3, 43);
  const mid = fbm(x / 70 + 3, z / 70 + 3, 1e6, 3, 47);
  // Склон к реке и север за замком — сплошной лес; восток и юг — перелески. Вокруг города, где прежде лежала пашня (склон
  // под восточной стеной, юг у дороги в долину), — луг с рощами, а не сплошной лес (docs/city_v3.md, Р-2): лес смыкается
  // дальше, за кольцом в 240–340 м от стены.
  const west = sstep(-60, -110, x);
  const north = sstep(-200, -260, z);
  const near = 1 - sstep(240, 340, dw);
  const groves = sstep(0.57, 0.7, fbm(x / 100 + 11, z / 100 + 11, 1e6, 3, 61)) * 0.95;
  const base = Math.max(west * 0.95, north * 0.95, sstep(0.48, 0.62, big) * (1 - near) + groves * near);
  const clear = sstep(0.3, 0.42, mid);
  // Гряда Шахты (ЗД-2): холмы — луг и камень, лес — у подножий: под пологом леса гряды сверху не видно.
  const bare = 1 - sstep(0.8, 3, hillsAt(x, z));
  return Math.min(1, Math.max(base * clear, copseAt(x, z)) * glacis * bank) * bare;
}

/**
 * Где до ЗД-1 стояли рудник и каменоломня — на восточном склоне мыса под замком (docs/city_v3.md, ЗД-2): дворы ушли в Шахту,
 * их поляны заросли перелеском (у стены замка, на гласисе, — луг), камней склона там нет (`banks.slopeRocks`). Середина и
 * радиус, м.
 */
export const OLD_YARDS: readonly { x: number; z: number; r: number }[] = [
  { x: 106, z: -116, r: 26 },
  { x: 68, z: -172, r: 30 },
];

/** Перелесок на месте ушедшего двора, 0..1: густо в середине, край — рваный. */
function copseAt(x: number, z: number): number {
  let c = 0;
  for (const o of OLD_YARDS) {
    const d = Math.hypot(x - o.x, z - o.z);
    if (d > o.r + 8) continue;
    c = Math.max(c, 0.92 * (1 - sstep(o.r * 0.45, o.r, d + (vnoise(x / 11, z / 11, 1e6, 59) - 0.5) * 14)));
  }
  return c;
}

/**
 * Карта земель для дальнего плана: r — полог леса, g — пашня вне ближней карты, b — дороги: расстояние до ближайшей в её
 * полуширинах со знаком стороны (`roads.roadU`, 0,5 — на оси, края — `ROAD_U_MAX`). Дорога за краем ближней карты держится
 * этим каналом до края мира (docs/city_v3.md, Г-3).
 */
export const LAND_AT = { x0: -1100, z0: -1200, size: 2200 } as const;

export function landMap(plan: CityPlan, size: number): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  const m = LAND_AT.size / size;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = LAND_AT.x0 + (i + 0.5) * m;
      const z = LAND_AT.z0 + (j + 0.5) * m;
      const k = (j * size + i) * 4;
      out[k] = Math.round(forestAt(x, z, plan) * 255);
      out[k + 1] = Math.round(fieldAt(x, z, plan) * 255);
      out[k + 2] = Math.round((roadU(x, z, plan) / ROAD_U_MAX) * 127.5 + 127.5);
      out[k + 3] = 255;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Модели: дерево стоит в начале координат, рост — около 1 (масштаб экземпляра — высота в метрах).

/** Типичная высота дерева: UV моделей — в её метрах, листва не раздувается масштабом экземпляра. */
const UV_SCALE = 6;

/** Ком листвы: сфера-«шар» с неровным краем, UV листвы по окружности, затенение снизу. */
function blob(b: Builder, cx: number, cy: number, cz: number, r: number, seg: number, rings: number, seed: number, t: V3, deciduous: boolean, shade = 1): void {
  // UV — в метрах типичного дерева (модель высотой 1, экземпляр растягивает до ~14 м).
  const [tw, th] = [TILE_M.foliage[0] / UV_SCALE, TILE_M.foliage[1] / UV_SCALE];
  const pts: V3[][] = [];
  for (let j = 0; j <= rings; j++) {
    const phi = (j / rings) * Math.PI;
    const row: V3[] = [];
    for (let i = 0; i <= seg; i++) {
      const th2 = (i / seg) * Math.PI * 2;
      const dx = Math.sin(phi) * Math.cos(th2);
      const dy = Math.cos(phi);
      const dz = Math.sin(phi) * Math.sin(th2);
      // Шов кольца — та же точка, что и начало: иначе ком расходится щелью по меридиану.
      const n = rnd((i % seg) + 31 * j, seed, 5) - 0.5;
      const k = r * (1 + n * 0.28) * (dy < 0 ? 0.82 : 1);
      row.push([cx + dx * k, cy + dy * k * 0.92, cz + dz * k]);
    }
    pts.push(row);
  }
  const circ = (2 * Math.PI * r) / tw;
  const ao = (y: number): number => shade * (0.5 + 0.55 * Math.max(0, Math.min(1, (y - (cy - r)) / (2 * r))));
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = pts[j + 1][i];
      const bb = pts[j + 1][i + 1];
      const c = pts[j][i + 1];
      const d = pts[j][i];
      const u0 = (i / seg) * circ;
      const u1 = ((i + 1) / seg) * circ;
      const v0 = ((rings - j - 1) / rings) * ((Math.PI * r) / th);
      const v1 = ((rings - j) / rings) * ((Math.PI * r) / th);
      // Обход снаружи: по убыванию угла по нижнему кольцу, затем вверх.
      b.quad(bb, a, d, c, [u1, v0, u0, v0, u0, v1, u1, v1], L.foliage, t, [ao(bb[1]), ao(a[1]), ao(d[1]), ao(c[1])], 0, deciduous ? [1, 1, 1, 1] : [0, 0, 0, 0]);
      roundNormals(b, cx, cy, cz);
    }
  }
}

/**
 * Нормали последних четырёх вершин — к центру кома на три четверти (у полюсов — целиком): ком освещён
 * круглым, а грани едва видны (комок листвы, а не многогранник). Край кроны на высоком рвётся по этим
 * нормалям ровно по силуэту (`material.foliageMaterial`, `ragged`).
 */
function roundNormals(b: Builder, cx: number, cy: number, cz: number): void {
  for (let k = b.nor.length - 12; k < b.nor.length; k += 3) {
    const rx = b.pos[k] - cx;
    const ry = (b.pos[k + 1] - cy) / 0.92;
    const rz = b.pos[k + 2] - cz;
    const rl = Math.hypot(rx, ry, rz) || 1;
    // У полюса грани сходятся веером и плоские нормали расходятся вкруговую — там нормаль чисто к центру.
    const f = 0.25 * (Math.hypot(rx, rz) / rl);
    const x = b.nor[k] * f + (rx / rl) * (1 - f);
    const y = b.nor[k + 1] * f + (ry / rl) * (1 - f);
    const z = b.nor[k + 2] * f + (rz / rl) * (1 - f);
    const l = Math.hypot(x, y, z) || 1;
    b.nor[k] = x / l;
    b.nor[k + 1] = y / l;
    b.nor[k + 2] = z / l;
  }
}

/** Ствол: шестигранник с сужением. */
function trunk(b: Builder, h: number, r0: number, r1: number, t: V3, seg = 6): void {
  const [tw, th] = [TILE_M.wood[0] / UV_SCALE, TILE_M.wood[1] / UV_SCALE];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const p0: V3 = [Math.cos(a1) * r0, -0.3, Math.sin(a1) * r0];
    const p1: V3 = [Math.cos(a0) * r0, -0.3, Math.sin(a0) * r0];
    const p2: V3 = [Math.cos(a0) * r1, h, Math.sin(a0) * r1];
    const p3: V3 = [Math.cos(a1) * r1, h, Math.sin(a1) * r1];
    const w = (2 * Math.PI * r0) / seg / tw;
    b.quad(p0, p1, p2, p3, [i * w, 0, (i + 1) * w, 0, (i + 1) * w, h / th, i * w, h / th], L.wood, t, [0.55, 0.55, 0.8, 0.8]);
  }
}

/** Ярус ели: конус без дна, юбка чуть вниз. */
function tier(b: Builder, y0: number, y1: number, r: number, seg: number, t: V3, seed: number): void {
  const [tw, th] = [TILE_M.foliage[0] / UV_SCALE, TILE_M.foliage[1] / UV_SCALE];
  const slant = Math.hypot(r, y1 - y0) / th;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const k0 = 1 + (rnd(i, seed, 3) - 0.5) * 0.25;
    const k1 = 1 + (rnd((i + 1) % seg, seed, 3) - 0.5) * 0.25;
    const A: V3 = [Math.cos(a1) * r * k1, y0 - 0.15 * r, Math.sin(a1) * r * k1];
    const B: V3 = [Math.cos(a0) * r * k0, y0 - 0.15 * r, Math.sin(a0) * r * k0];
    const C: V3 = [0, y1, 0];
    const w = (2 * Math.PI * r) / seg / tw;
    b.tri(A, B, C, [i * w, 0, (i + 1) * w, 0, (i + 0.5) * w, slant], L.foliage, t, [0.45, 0.45, 1]);
  }
}

export type Species = 'broad' | 'broadFar' | 'spruce' | 'spruceFar' | 'fruit';

/** Модель вида дерева, высота — 1 (экземпляр растягивает до своей высоты). */
/**
 * Модель дерева вокруг начала координат, рост — около 1. `low` — смотрят снизу (ролик осады и боя у города, docs/polish.md,
 * П-6): у дальнего кома есть ствол, иначе ком висит над землёй.
 */
export function treeModel(sp: Species, detail: number, low = false): Builder {
  const b = new Builder();
  const bark = tint(CITY.timberGrey, 1.0);
  const leaf = tint(0xe8ecd8);
  const fir = tint(0x9aa898);
  if (sp === 'broad' || sp === 'fruit') {
    const H = 1;
    trunk(b, 0.45 * H, 0.035, 0.022, bark);
    const seg = detail > 1 ? 8 : 6;
    const rings = detail > 1 ? 5 : 4;
    blob(b, 0, 0.62, 0, 0.3, seg, rings, 11, leaf, true);
    blob(b, 0.19, 0.5, 0.08, 0.21, seg, rings, 13, leaf, true, 0.9);
    blob(b, -0.15, 0.52, -0.12, 0.22, seg, rings, 17, leaf, true, 0.9);
    if (detail > 1) blob(b, -0.04, 0.76, 0.14, 0.18, seg, rings, 19, leaf, true, 1.05);
  } else if (sp === 'broadFar') {
    // Дальнее: ком без ствола — ствол под кроной с высоты камеры не виден; снизу (ролик) — со стволом.
    if (low) trunk(b, 0.34, 0.035, 0.022, bark, 4);
    blob(b, 0, 0.6, 0, 0.34, 5, 3, 23, leaf, true);
  } else if (sp === 'spruce') {
    trunk(b, 0.25, 0.03, 0.02, bark);
    const seg = detail > 0 ? 8 : 6;
    tier(b, 0.12, 0.6, 0.24, seg, fir, 3);
    tier(b, 0.36, 0.82, 0.18, seg, fir, 5);
    tier(b, 0.6, 1.0, 0.11, seg, fir, 7);
  } else {
    tier(b, 0.05, 1.0, 0.24, 5, fir, 9);
  }
  return b;
}

export interface TreeInst {
  x: number;
  y: number;
  z: number;
  h: number;
  rot: number;
  /** Тон экземпляра (линейный). */
  t: V3;
}

/** Расстановка: решётка с разбросом, густота — `forestAt`; ближние — модели, дальние — дешёвые. */
export function placeTrees(plan: CityPlan, near: number, nearStep: number, farStep: number, reach: number): Record<Species, TreeInst[]> {
  const out: Record<Species, TreeInst[]> = { broad: [], broadFar: [], spruce: [], spruceFar: [], fruit: [] };
  const center: P = { x: 0, z: -20 };
  const leafTones = [0xd8e0c4, 0xc8d4b0, 0xe4e4c0, 0xbcc8a8, 0xd0d8b8];
  const firTones = [0xb8c4b8, 0xa8b4ac, 0xc4ccc0];
  const pass = (step: number, lo: number, hi: number, far: boolean): void => {
    const n = Math.ceil(hi / step);
    for (let j = -n; j <= n; j++) {
      for (let i = -n; i <= n; i++) {
        const h0 = hash3(i, j, far ? 77 : 71);
        const x = center.x + (i + (h0 & 0xff) / 255 - 0.5) * step;
        const z = center.z + (j + ((h0 >>> 8) & 0xff) / 255 - 0.5) * step;
        const dc = Math.hypot(x - center.x, z - center.z);
        if (dc < lo || dc > hi) continue;
        const f = forestAt(x, z, plan);
        if (f <= 0.08 || ((h0 >>> 16) & 0xff) / 255 > Math.min(1, f * 1.5)) continue;
        const y = heightAt(x, z);
        // Ели — по северному и западному склонам и в глубине, лиственные — у опушек и на юге.
        const coniferous = rnd(i, j, 91) < 0.25 + 0.5 * sstep(-120, -320, z) + 0.2 * sstep(-80, -200, x);
        const hgt = (coniferous ? 17 : 14) * (0.75 + rnd(i, j, 93) * 0.5) * (0.85 + 0.15 * f);
        const tone = coniferous ? firTones[h0 % firTones.length] : leafTones[h0 % leafTones.length];
        const inst: TreeInst = { x, y, z, h: hgt, rot: rnd(i, j, 95) * Math.PI * 2, t: tint(tone) };
        if (coniferous) (far ? out.spruceFar : out.spruce).push(inst);
        else (far ? out.broadFar : out.broad).push(inst);
      }
    }
  };
  pass(nearStep, 0, near, false);
  pass(farStep, near, reach, true);
  // Дворы: плодовые, ниже и светлее.
  for (const t of plan.yardTrees) {
    out.fruit.push({ x: t.x, y: heightAt(t.x, t.z), z: t.z, h: yardTreeHeight(t.r), rot: rnd(t.seed, 1, 3) * 6.28, t: tint(0xe0e4c0) });
  }
  return out;
}
