// Земля нового вида числами: высота, свет, цвет и вода — без холста (docs/map_tw.md, раздел 4).
//
// Высоты в данных нет: атлас везёт класс клетки и биты реки и хребта. Высота **выводится**, как и у
// прежней карты (`relief.ts`), но глубже: массив гор растёт к середине хребтовой страны, река
// прорезает долину, между серединами клеток идёт гладкий сплайн по **искривлённым** координатам —
// граница класса гуляет, и сетка клеток не видна нигде. На расчёты игры эта величина не влияет ничем.
//
// Свет один — слева-сверху, как у диорамы, у прежней карты и у теней фигур. Тень от гор ложится на
// долину проходом к солнцу по решётке.
//
// Модуль чистый: землю он читает через переданные функции, холста нет, и всё проверяется тестом под
// 'node'. Одинаковый вход — одинаковый выход: на этом держатся и «шва между тайлами нет», и право
// печь тайл один раз.
import type { Terrain } from '@/world/types';
import { lonLatOf } from '@/world/atlas/project';
import { WORLD_ORIGIN } from '@/world/data/tuning';
import { hash } from '../scatter';
import type { Flag, Sample } from '../scatter';
import { C, type RGB } from './palette';
import { at, gradOctave, octave, perlin, type Octave } from './noise';

/** Что выпечка знает о земле: класс клетки и линии. Игра даёт их из кэша мира, стенд — из атласа. */
export interface Land {
  sample: Sample;
  river: Flag;
  ridge: Flag;
}

// ---------- Классы ----------

const W = 0;
const P = 1;
const F = 2;
const H = 3;
const S = 4;
const D = 5;
const M = 6;

/** Клетки нет (за краем мира) — море: мир кончается берегом, а не пустотой. */
function codeOf(t: Terrain | null): number {
  switch (t) {
    case 'plain':
      return P;
    case 'forest':
      return F;
    case 'hills':
      return H;
    case 'steppe':
      return S;
    case 'desert':
      return D;
    case 'mountains':
      return M;
    default:
      return W;
  }
}

// ---------- Числа ----------

/**
 * Насколько далеко тянется тень от гребня, в клетках. Гора в данных поднимается не выше полутора
 * «клеток высоты», солнце стоит на `SUN_ELEVATION`, и длиннее тень не бывает; запас решётки к
 * солнцу берётся ровно под неё (`shadowMargin`).
 */
export const SHADOW_REACH = 2.5;
/** Вертикальный масштаб: клеток длины на единицу высоты. Больше — круче склоны и резче свет. */
export const RELIEF_V = 2.9;
/** Солнце: слева-сверху, над горизонтом на 36°. */
const SUN_ELEVATION = (36 * Math.PI) / 180;
const SUN_XY = Math.cos(SUN_ELEVATION) / Math.SQRT2;
const LX = -SUN_XY;
const LY = -SUN_XY;
const LZ = Math.sin(SUN_ELEVATION);
/** Подъём луча к солнцу на шаг решётки по диагонали, в единицах высоты на клетку длины. */
const RISE_PER_CELL = Math.tan(SUN_ELEVATION) / RELIEF_V;
/** Рассеянный и прямой свет. Ровная земля выходит ровно единицей (`FLAT`). */
const AMBIENT = 0.56;
const DIFFUSE = 0.7;
const FLAT = AMBIENT + DIFFUSE * LZ;

/** Искривление координат: насколько граница класса гуляет от сетки, в клетках. */
const WARP = [
  { period: 2.7, amp: 0.36, salt: 12011 },
  { period: 1.15, amp: 0.13, salt: 12037 },
] as const;
/** Самый дальний сдвиг выборки — запас области клеток под искривление. */
export const WARP_REACH = WARP.reduce((a, o) => a + o.amp, 0);

/**
 * Складки: период в клетках, вес и поворот октавы. Гребневой градиентный шум (`1 − |n|`): складка
 * там, где шум переходит ноль, и сумма октав даёт хребты с отрогами, а не поле кочек. Поворот у каждой
 * октавы свой — иначе складки трёх октав ложились бы вдоль одних осей.
 */
const FOLDS = [
  { period: 4.4, weight: 1.25, salt: 13007, angle: 0.91 },
  { period: 2.1, weight: 1, salt: 13001, angle: 0.37 },
  { period: 0.93, weight: 0.42, salt: 13037, angle: 1.21 },
  { period: 0.41, weight: 0.22, salt: 13063, angle: 2.03 },
  { period: 0.19, weight: 0.1, salt: 13093, angle: 2.71 },
] as const;
const FOLD_SUM = FOLDS.reduce((a, o) => a + o.weight, 0);
/** Сила складок на шероховатости 1. */
const FOLD_AMP = 0.85;

/** Пятнистость тона: земля у художника не заливка. */
const MOTTLE = { period: 3.4, salt: 14009 } as const;

/**
 * Сколько клеток вокруг нужно данных, чтобы точка внутри области посчиталась верно: сплайн (две
 * клетки), искривление и размытия массива и глубины (четыре). Читают это выпечка (область клеток) и
 * игра (чего ждать, прежде чем печь).
 */
export const CELL_PAD = 2 + Math.ceil(WARP_REACH) + 4;

// ---------- Клетки ----------

/** Поля клеток области: всё, что дальше интерполируется сплайном. Индекс — (y - y0) * w + (x - x0). */
export interface Cells {
  x0: number;
  y0: number;
  w: number;
  h: number;
  code: Uint8Array;
  /** Высота клетки. */
  height: Float32Array;
  /** Шероховатость: насколько играют складки. */
  rough: Float32Array;
  /** Цвет земли до света. */
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  /** Доля леса — под подлесок. */
  forest: Float32Array;
  /** Горность — под камень. */
  rock: Float32Array;
  /** Линия снега: выше неё (с поправкой на уклон) лежит снег. */
  snow: Float32Array;
  /** Суша, 1 или 0 — под берег (сплайном Катмулла — Рома: озеро в клетку не пропадает). */
  land: Float32Array;
  /** Суша вокруг, размытая на четыре клетки, — глубина моря. */
  shore: Float32Array;
  /** «Север», 0..1 (`northOf`): порода леса и линия снега. */
  north: Float32Array;
}

/** Биномиальное размытие 1-4-6-4-1 по обеим осям, край держится крайней клеткой. */
function blur5(src: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const cx = (x: number): number => (x < 0 ? 0 : x >= w ? w - 1 : x);
  const cy = (y: number): number => (y < 0 ? 0 : y >= h ? h - 1 : y);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      tmp[row + x] =
        (src[row + cx(x - 2)] + 4 * src[row + cx(x - 1)] + 6 * src[row + x] + 4 * src[row + cx(x + 1)] + src[row + cx(x + 2)]) / 16;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] =
        (tmp[cy(y - 2) * w + x] + 4 * tmp[cy(y - 1) * w + x] + 6 * tmp[y * w + x] + 4 * tmp[cy(y + 1) * w + x] + tmp[cy(y + 2) * w + x]) / 16;
    }
  }
  return out;
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const step = (e0: number, e1: number, v: number): number => {
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/**
 * «Север»: 0 у Средиземного моря, 1 у Балтики. Широта настоящая — по проекции атласа, а не по `y`:
 * север свежее и холоднее, юг суше, и снег на севере лежит ниже.
 */
function northOf(x: number, y: number): number {
  const { lat } = lonLatOf(x - WORLD_ORIGIN.x, y - WORLD_ORIGIN.y);
  return clamp01((lat - 40) / 20);
}

/**
 * Поля клеток над областью. Область берёт вызывающий — с запасом `CELL_PAD` вокруг того, что
 * рисуется: крайние клетки размытий считаются по обрезанной округе, и выборка туда не доходит.
 *
 * `season` — 0 летом, 1 в разгар зимы: линия снега опускается, на севере ложится иней.
 */
export function cellsFor(seed: number, land: Land, x0: number, y0: number, w: number, h: number, season: number): Cells {
  const n = w * h;
  const code = new Uint8Array(n);
  const isM = new Float32Array(n);
  const isHM = new Float32Array(n);
  const isLand = new Float32Array(n);
  const riv = new Uint8Array(n);
  const rid = new Uint8Array(n);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const x = x0 + i;
      const y = y0 + j;
      const c = codeOf(land.sample(x, y));
      code[k] = c;
      isM[k] = c === M ? 1 : 0;
      isHM[k] = c === M || c === H ? 1 : 0;
      isLand[k] = c === W ? 0 : 1;
      if (c !== W) {
        if (land.river(x, y)) riv[k] = 1;
        if (land.ridge(x, y)) rid[k] = 1;
      }
    }
  }
  const massif = blur5(isM, w, h);
  const upland = blur5(isHM, w, h);
  const shore = blur5(blur5(isLand, w, h), w, h);

  const height = new Float32Array(n);
  const rough = new Float32Array(n);
  const r = new Float32Array(n);
  const g = new Float32Array(n);
  const b = new Float32Array(n);
  const forest = new Float32Array(n);
  const rock = new Float32Array(n);
  const snow = new Float32Array(n);
  const norths = new Float32Array(n);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      const x = x0 + i;
      const y = y0 + j;
      const c = code[k];
      const north = northOf(x, y);
      norths[k] = north;
      let hh: number;
      let ro: number;
      let col: RGB;
      let tone = 1;
      switch (c) {
        case P:
          hh = 0.04 + 0.1 * upland[k];
          ro = 0.1;
          col = lerp3(C.plainSouth, C.plainNorth, north);
          break;
        case F:
          hh = 0.06 + 0.1 * upland[k];
          ro = 0.12;
          col = lerp3(C.forestSouth, C.forestNorth, north);
          break;
        case S:
          hh = 0.03 + 0.06 * upland[k];
          ro = 0.08;
          col = C.steppe;
          break;
        case D:
          hh = 0.06 + 0.08 * upland[k];
          ro = 0.14;
          col = C.desert;
          break;
        case H:
          hh = 0.26 + 0.2 * upland[k] + 0.15 * massif[k];
          ro = 0.42;
          col = lerp3(C.hills, C.hillsNorth, north);
          break;
        case M:
          hh = 0.42 + 0.95 * massif[k];
          ro = 0.55 + 0.45 * massif[k];
          col = lerp3(C.hills, C.hillsNorth, north);
          break;
        default:
          // Дно: у берега мелко, в открытом море глубоко. Своего дна в данных нет — только «далеко ли
          // до земли», как и у прежней карты (`waterShare`).
          hh = -0.18 - 0.55 * (1 - shore[k]);
          ro = 0;
          col = C.sea;
      }
      if (c !== W) {
        if (rid[k]) hh += 0.32;
        if (riv[k]) hh -= 0.07;
        // Клетка в клетку не красится: тон гуляет от клетки к клетке на несколько процентов.
        tone = 0.95 + 0.1 * hash(seed, x, y, 14051);
      }
      height[k] = hh;
      rough[k] = ro;
      r[k] = col[0] * tone;
      g[k] = col[1] * tone;
      b[k] = col[2] * tone;
      forest[k] = c === F ? 1 : 0;
      rock[k] = c === M ? 1 : c === H ? 0.22 : 0;
      // Линия снега: летом снег лежит только на высоких гребнях юга (1.7 у Средиземного моря) и опускается
      // к северу (0.8 у Балтики); зима опускает её ещё на 0.8 — белеют горы и холмы севера.
      snow[k] = 1.7 - 0.9 * north - 0.8 * season;
    }
  }
  return {
    x0,
    y0,
    w,
    h,
    code,
    height,
    rough,
    r: blur5(r, w, h),
    g: blur5(g, w, h),
    b: blur5(b, w, h),
    forest: blur5(forest, w, h),
    rock: blur5(rock, w, h),
    snow,
    land: isLand,
    shore,
    north: norths,
  };
}

function lerp3(a: RGB, b: RGB, t: number): RGB {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

// ---------- Сплайны ----------

/**
 * Выборка поля клеток в мировой точке. Середина клетки (x + 0.5, y + 0.5) — её значение.
 * Кубический B-сплайн: гладкий без плоских пятен в серединах клеток (у плавной ступени по
 * билинейной выборке свет ложился бы подушками по сетке) и без переколебаний.
 */
const bw = new Float32Array(8);
let bBase = 0;

function bspline(cells: Cells, wx: number, wy: number): void {
  const u = wx - 0.5 - cells.x0;
  const v = wy - 0.5 - cells.y0;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  splineW(u - iu, bw, 0);
  splineW(v - iv, bw, 4);
  const ix = Math.min(cells.w - 3, Math.max(1, iu));
  const iy = Math.min(cells.h - 3, Math.max(1, iv));
  bBase = (iy - 1) * cells.w + (ix - 1);
}

function splineW(t: number, out: Float32Array, o: number): void {
  const t2 = t * t;
  const t3 = t2 * t;
  const s = 1 - t;
  out[o] = (s * s * s) / 6;
  out[o + 1] = (3 * t3 - 6 * t2 + 4) / 6;
  out[o + 2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
  out[o + 3] = t3 / 6;
}

function dot(cells: Cells, f: Float32Array): number {
  const w = cells.w;
  let s = 0;
  let k = bBase;
  for (let j = 0; j < 4; j++) {
    const wj = bw[4 + j];
    s += wj * (bw[0] * f[k] + bw[1] * f[k + 1] + bw[2] * f[k + 2] + bw[3] * f[k + 3]);
    k += w;
  }
  return s;
}

/** Катмулл — Ром для суши: проходит через значения клеток, и озеро в одну клетку не пропадает. */
function crWeights(t: number, out: Float32Array, o: number): void {
  const t2 = t * t;
  const t3 = t2 * t;
  out[o] = 0.5 * (-t3 + 2 * t2 - t);
  out[o + 1] = 0.5 * (3 * t3 - 5 * t2 + 2);
  out[o + 2] = 0.5 * (-3 * t3 + 4 * t2 + t);
  out[o + 3] = 0.5 * (t3 - t2);
}

const cw = new Float32Array(8);
const bw2 = new Float32Array(8);

/** Суша в мировой точке, 0..1: больше половины — суша. Одна мерка на берег, обзор и деревья. */
export function landAt(cells: Cells, wx: number, wy: number): number {
  const u = wx - 0.5 - cells.x0;
  const v = wy - 0.5 - cells.y0;
  const iu = Math.floor(u);
  const iv = Math.floor(v);
  crWeights(u - iu, cw, 0);
  crWeights(v - iv, cw, 4);
  const ix = Math.min(cells.w - 3, Math.max(1, iu));
  const iy = Math.min(cells.h - 3, Math.max(1, iv));
  const w = cells.w;
  let k = (iy - 1) * w + (ix - 1);
  let s = 0;
  let sb = 0;
  const f = cells.land;
  splineW(u - iu, bw2, 0);
  splineW(v - iv, bw2, 4);
  for (let j = 0; j < 4; j++) {
    s += cw[4 + j] * (cw[0] * f[k] + cw[1] * f[k + 1] + cw[2] * f[k + 2] + cw[3] * f[k + 3]);
    sb += bw2[4 + j] * (bw2[0] * f[k] + bw2[1] * f[k + 1] + bw2[2] * f[k + 2] + bw2[3] * f[k + 3]);
    k += w;
  }
  // Половина Катмулла — Рома держит озеро в клетку, половина B-сплайна скругляет ступени растра: берег
  // атласа — клетки по шесть километров, и на дальнем масштабе их лесенка видна.
  return clamp01(0.5 * s + 0.5 * sb);
}

// ---------- Искривление ----------

/** Октавы искривления над областью: считаются один раз на выпечку. */
export interface Warp {
  ox: Octave[];
  oy: Octave[];
}

export function warpFor(seed: number, x: number, y: number, w: number, h: number): Warp {
  return {
    ox: WARP.map((o) => octave(seed, x, y, w, h, o.period, o.salt)),
    oy: WARP.map((o) => octave(seed, x, y, w, h, o.period, o.salt + 7)),
  };
}

/** Сдвиг выборки в точке: куда смотреть в поле клеток, чтобы граница не шла по сетке. */
export function warpX(wp: Warp, x: number, y: number): number {
  return (at(wp.ox[0], x, y) - 0.5) * 2 * WARP[0].amp + (at(wp.ox[1], x, y) - 0.5) * 2 * WARP[1].amp;
}
export function warpY(wp: Warp, x: number, y: number): number {
  return (at(wp.oy[0], x, y) - 0.5) * 2 * WARP[0].amp + (at(wp.oy[1], x, y) - 0.5) * 2 * WARP[1].amp;
}

// ---------- Решётка ----------

/** Узлы решётки: высота и искривлённая точка выборки. Узел (i, j) стоит в (x0 + i·step, y0 + j·step). */
export interface Grid {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  step: number;
  h: Float32Array;
  qx: Float32Array;
  qy: Float32Array;
  /** Высшая точка решётки: выше неё луч к солнцу уже ничего не встретит. */
  top: number;
}

/** Запас решётки к солнцу (влево и вверх), в узлах: под самую длинную тень. */
export const shadowMargin = (nodesPerCell: number): number => Math.ceil((SHADOW_REACH * nodesPerCell) / Math.SQRT2);

/** Октавы складок над областью: считаются один раз на выпечку. */
export type Folds = ReturnType<typeof gradOctave>[];

export function foldsFor(seed: number, x: number, y: number, side: number): Folds {
  return FOLDS.map((o) => gradOctave(seed, x - 1, y - 1, side + 2, side + 2, o.period, o.salt, o.angle));
}

/**
 * Высота в мировой точке: сплайн поля клеток по искривлённым координатам и складки по шероховатости.
 * Одна функция на решётку и на отдельные точки — две копии разошлись бы на первой же правке.
 */
export function heightAt(cells: Cells, wp: Warp, folds: Folds, px: number, py: number): number {
  return heightWarped(cells, folds, px + warpX(wp, px, py), py + warpY(wp, px, py));
}

/** Высота по уже искривлённой точке выборки: решётка искривляет узел один раз и берёт его же под цвет. */
function heightWarped(cells: Cells, folds: Folds, sx: number, sy: number): number {
  bspline(cells, sx, sy);
  let hh = dot(cells, cells.height);
  const ro = dot(cells, cells.rough);
  if (ro > 0.01) {
    let sum = 0;
    for (let o = 0; o < FOLDS.length; o++) {
      const v = perlin(folds[o], sx, sy);
      sum += FOLDS[o].weight * (1 - (v < 0 ? -v : v));
    }
    hh += ro * FOLD_AMP * (sum / FOLD_SUM - 0.62);
  }
  // Уровень моря: свет считается по суше, а дно под водой плоское. Иначе сплайн тянул бы берег в
  // море склоном, и вдоль каждого берега, отвёрнутого от солнца, шла бы грязная тёмная полоса.
  return hh < 0 ? 0 : hh;
}

export function heightGrid(seed: number, cells: Cells, wp: Warp, x0: number, y0: number, nx: number, ny: number, stepCells: number): Grid {
  const folds = foldsFor(seed, x0, y0, Math.max(nx, ny) * stepCells);
  const h = new Float32Array(nx * ny);
  const qx = new Float32Array(nx * ny);
  const qy = new Float32Array(nx * ny);
  let top = -Infinity;
  for (let j = 0; j < ny; j++) {
    const py = y0 + j * stepCells;
    for (let i = 0; i < nx; i++) {
      const px = x0 + i * stepCells;
      const k = j * nx + i;
      const sx = px + warpX(wp, px, py);
      const sy = py + warpY(wp, px, py);
      qx[k] = sx;
      qy[k] = sy;
      const hh = heightWarped(cells, folds, sx, sy);
      h[k] = hh;
      if (hh > top) top = hh;
    }
  }
  return { nx, ny, x0, y0, step: stepCells, h, qx, qy, top };
}

// ---------- Свет и цвет ----------

export interface ShadeLook {
  /** 0 летом, 1 зимой. */
  season: number;
  castShadow: boolean;
}

/**
 * Окно решётки, которое красится: узлы [i0, i0 + w) × [j0, j0 + h), по пикселю на узел. Вокруг
 * окна решётка обязана иметь узел запаса (уклон — разность соседей), а влево-вверх — `shadowMargin`.
 */
export interface Window {
  i0: number;
  j0: number;
  w: number;
  h: number;
}

/**
 * Свет, цвет и вода по решётке: два RGBA одного размера — суша и вода. Сушу и воду делит не эта
 * функция, а маска берега (`landAt`): здесь у каждого узла есть и тот, и другой цвет.
 */
export function shade(seed: number, cells: Cells, grid: Grid, win: Window, look: ShadeLook, landOut: Uint8ClampedArray, waterOut: Uint8ClampedArray): void {
  const { nx, h: hgt, step: st } = grid;
  const span = Math.max(win.w, win.h) * st;
  const mottle = octave(seed, grid.x0 + win.i0 * st - 1, grid.y0 + win.j0 * st - 1, span + 2, span + 2, MOTTLE.period, MOTTLE.salt);
  const mottle2 = octave(seed, grid.x0 + win.i0 * st - 1, grid.y0 + win.j0 * st - 1, span + 2, span + 2, MOTTLE.period * 0.37, MOTTLE.salt + 3);
  const inv2 = 1 / (2 * st);
  const rise = RISE_PER_CELL * st * Math.SQRT2;
  const maxSteps = shadowMargin(1 / st);
  const [lr, lg, lb] = C.light;
  const [sr, sg, sb] = C.shade;
  for (let j = 0; j < win.h; j++) {
    const gj = win.j0 + j;
    for (let i = 0; i < win.w; i++) {
      const gi = win.i0 + i;
      const k = gj * nx + gi;
      const h0 = hgt[k];
      const dx = (hgt[k + 1] - hgt[k - 1]) * inv2;
      const dy = (hgt[k + nx] - hgt[k - nx]) * inv2;
      const nxv = -dx * RELIEF_V;
      const nyv = -dy * RELIEF_V;
      const len = Math.sqrt(nxv * nxv + nyv * nyv + 1);
      const ndl = (nxv * LX + nyv * LY + LZ) / len;
      const slope = Math.sqrt(dx * dx + dy * dy) * RELIEF_V;

      // Тень от гор: проход к солнцу по диагонали решётки, выход — когда луч поднялся выше любой горы.
      let lit = 1;
      if (look.castShadow && h0 < grid.top) {
        let kk = k;
        let ray = h0;
        for (let s = 1; s <= maxSteps; s++) {
          kk -= nx + 1;
          ray += rise;
          if (ray >= grid.top) break;
          const over = hgt[kk] - ray;
          if (over > 0) {
            const d = 1 - over * 9;
            if (d < lit) lit = d < 0 ? 0 : d;
            if (lit === 0) break;
          }
        }
      }
      const direct = ndl > 0 ? ndl : 0;
      const f = (AMBIENT + DIFFUSE * direct * lit) / FLAT;

      bspline(cells, grid.qx[k], grid.qy[k]);
      let r = dot(cells, cells.r);
      let g = dot(cells, cells.g);
      let b = dot(cells, cells.b);
      const wx = grid.x0 + gi * st;
      const wy = grid.y0 + gj * st;
      const m1 = at(mottle, wx, wy);
      const m2 = at(mottle2, wx, wy);

      // Пятнистость: тон и тепло гуляют крупными мазками.
      const tone = 0.93 + 0.14 * m1;
      r *= tone * (1 + (m2 - 0.5) * 0.06);
      g *= tone;
      b *= tone * (1 - (m2 - 0.5) * 0.06);

      // Подлесок: лес — тёмная масса ещё до крон.
      const fw = dot(cells, cells.forest);
      if (fw > 0.02) {
        const t = fw * 0.78;
        r = mix(r, C.understory[0], t);
        g = mix(g, C.understory[1], t);
        b = mix(b, C.understory[2], t);
      }

      // Камень: в горах выше середины склона и на крутом. Ниже — луг и лес склонов, как у гор на карте
      // кампании: зелёные подолы и серые вершины, а не серый массив целиком.
      const rw = dot(cells, cells.rock);
      if (rw > 0.02) {
        const t = clamp01(rw * (step(0.85, 1.4, h0) * 0.9 + step(1.0, 2.0, slope) * 0.3));
        const kr = mix(C.scree[0], C.rock[0], m2);
        const kg = mix(C.scree[1], C.rock[1], m2);
        const kb = mix(C.scree[2], C.rock[2], m2);
        r = mix(r, kr, t);
        g = mix(g, kg, t);
        b = mix(b, kb, t);
      }

      // Снег: выше линии, на крутом не держится; зимой на севере — иней и на равнине.
      const line = dot(cells, cells.snow);
      const st2 = step(line, line + 0.2, h0 + 0.16 * (m1 - 0.5)) * (1 - step(1.3, 2.6, slope));
      let snowy = st2;
      if (look.season > 0 && h0 > 0) snowy = Math.max(snowy, look.season * step(0.55, 0.95, -line + 0.9) * 0.85);
      if (snowy > 0.01) {
        r = mix(r, C.snow[0], snowy);
        g = mix(g, C.snow[1], snowy);
        b = mix(b, C.snow[2], snowy);
      }

      // Свет: тёплый на склоне к солнцу, холодный синеватый в тени.
      if (f >= 1) {
        const t = (f - 1) * 0.4;
        r = r * f + (lr - r) * t * 0.3;
        g = g * f + (lg - g) * t * 0.3;
        b = b * f + (lb - b) * t * 0.22;
      } else {
        const t = 1 - f;
        r = r * f * (1 - 0.12 * t) + sr * t * 0.32;
        g = g * f * (1 - 0.12 * t) + sg * t * 0.34;
        b = b * f * (1 - 0.06 * t) + sb * t * 0.48;
      }
      const p = (j * win.w + i) * 4;
      landOut[p] = r;
      landOut[p + 1] = g;
      landOut[p + 2] = b;
      landOut[p + 3] = 255;

      // Вода по глубине: бирюза у берега, тёмная синь в открытом море. Тень гор ложится и на неё.
      const sh = dot(cells, cells.shore);
      let wr = mix(C.deep[0], C.sea[0], step(0.0, 0.2, sh));
      let wg = mix(C.deep[1], C.sea[1], step(0.0, 0.2, sh));
      let wb = mix(C.deep[2], C.sea[2], step(0.0, 0.2, sh));
      const t2 = step(0.2, 0.55, sh);
      wr = mix(wr, C.shallow[0], t2);
      wg = mix(wg, C.shallow[1], t2);
      wb = mix(wb, C.shallow[2], t2);
      // Пятнистость гаснет в открытом море: там тайл печётся заливкой (`bake.openSea`), и тон на стыке
      // обязан совпасть с ней.
      const wt = (1 + (0.08 * m1 - 0.04) * step(0.02, 0.25, sh)) * (lit < 1 ? 0.82 + 0.18 * lit : 1);
      waterOut[p] = wr * wt;
      waterOut[p + 1] = wg * wt;
      waterOut[p + 2] = wb * wt;
      waterOut[p + 3] = 255;
    }
  }
}
