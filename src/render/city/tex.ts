// Слои текстур вида «город» (docs/city.md, раздел 3): процедурные, от зерна, без сети и без чужих
// лицензий. Чистый модуль — без three и без DOM: его зовут поток генерации в браузере
// (`tex.worker.ts`), тесты и выгрузка слоёв в PNG для самопроверки (`scripts/city-shots.ts`, TEX=1).
//
// Как устроен слой. Художник пишет на поверхность три вещи: высоту (метры рельефа — шов глубже
// камня, балка выступает над штукатуркой), цвет (sRGB) и маску (альфа: стекло у фасадов — ночью
// светится, высота у земли — по ней смешиваются покрытия). Потом `bake` запекает рельеф в цвет:
// свет сверху-слева по наклону высоты и затенение впадин против размытой высоты. Слой тайлится по
// обеим осям: решётки шума и раскладки камней берутся по модулю плитки.
//
// Строки «вверх»: ряд 0 — низ плитки (v = 0), как у `DataTexture` без переворота. У стен v растёт
// вверх, у кровель — вверх по скату.
import { cells, clamp01, fbm, hash3, rnd, sstep, stream, vnoise, type Cell } from './noise';
import { CITY, srgb } from './palette';

export const LAYERS = [
  'ashlar',
  'rubble',
  'plaster',
  'timberA',
  'timberB',
  'timberC',
  'stoneWin',
  'groundDoor',
  'roofTile',
  'roofSlate',
  'wood',
  'cobble',
  'dirt',
  'grass',
  'foliage',
  'rock',
  'churchWin',
  'field',
  'towerSlit',
  'gateArch',
  'arcade',
  'cloth',
  'cut',
] as const;
export type LayerName = (typeof LAYERS)[number];

/** Номер слоя по имени — атрибут вершины `layer`. */
export const L = Object.fromEntries(LAYERS.map((n, i) => [n, i])) as Record<LayerName, number>;

/**
 * Сколько метров мира покрывает плитка слоя: ширина и высота. Фасадные слои — этаж (3 м) или
 * первый этаж (3.4 м) в высоту и модуль в 4 м шириной; окна храма — 8 м.
 */
export const TILE_M: Record<LayerName, readonly [number, number]> = {
  ashlar: [4, 4],
  rubble: [4, 4],
  plaster: [4, 4],
  timberA: [4, 3],
  timberB: [4, 3],
  timberC: [4, 3],
  stoneWin: [4, 3],
  groundDoor: [4, 3.4],
  roofTile: [4, 4],
  roofSlate: [4, 4],
  wood: [2, 2],
  cobble: [3, 3],
  dirt: [4, 4],
  grass: [4, 4],
  foliage: [2, 2],
  rock: [6, 6],
  churchWin: [4, 12],
  field: [8, 8],
  towerSlit: [6, 7],
  gateArch: [6, 8],
  arcade: [4, 4.4],
  cloth: [2, 2],
  cut: [4, 4],
};

type RGB = [number, number, number];
const C = (hex: number): RGB => srgb(hex);

/** Поверхность художника: высота в метрах, цвет sRGB, маска. */
class Surf {
  readonly h: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  readonly a: Float32Array;
  constructor(readonly S: number, readonly W: number, readonly H: number) {
    const n = S * S;
    this.h = new Float32Array(n);
    this.r = new Float32Array(n);
    this.g = new Float32Array(n);
    this.b = new Float32Array(n);
    this.a = new Float32Array(n);
  }
  /** Обход пикселей: метры (x — вправо, y — вверх) и доли плитки. */
  each(fn: (xm: number, ym: number, u: number, v: number, i: number) => void): void {
    const { S, W, H } = this;
    for (let y = 0; y < S; y++) {
      const v = (y + 0.5) / S;
      for (let x = 0; x < S; x++) {
        const u = (x + 0.5) / S;
        fn(u * W, v * H, u, v, y * S + x);
      }
    }
  }
  set(i: number, c: RGB, k = 1): void {
    this.r[i] = c[0] * k;
    this.g[i] = c[1] * k;
    this.b[i] = c[2] * k;
  }
}

/** Размытие высоты коробкой с переносом через край — для затенения впадин. */
function blurWrap(src: Float32Array, S: number, rad: number): Float32Array {
  const tmp = new Float32Array(S * S);
  const out = new Float32Array(S * S);
  const w = 2 * rad + 1;
  for (let y = 0; y < S; y++) {
    let acc = 0;
    for (let k = -rad; k <= rad; k++) acc += src[y * S + ((k + S) % S)];
    for (let x = 0; x < S; x++) {
      tmp[y * S + x] = acc / w;
      acc += src[y * S + ((x + rad + 1) % S)] - src[y * S + ((x - rad + S) % S)];
    }
  }
  for (let x = 0; x < S; x++) {
    let acc = 0;
    for (let k = -rad; k <= rad; k++) acc += tmp[((k + S) % S) * S + x];
    for (let y = 0; y < S; y++) {
      out[y * S + x] = acc / w;
      acc += tmp[((y + rad + 1) % S) * S + x] - tmp[((y - rad + S) % S) * S + x];
    }
  }
  return out;
}

interface Bake {
  /** Сила света по наклону (0 — плоско). */
  relief: number;
  /** Сила затенения впадин. */
  cavity: number;
  /** Радиус размытия для впадин, метры. */
  cavityM: number;
  /** Альфа — нормированная высота (земля) вместо маски. */
  heightAlpha?: boolean;
}

/** Запекание: свет сверху-слева по наклону, впадины темнее; выход — RGBA8 sRGB. */
function bake(s: Surf, o: Bake): Uint8Array {
  const { S, W, H, h } = s;
  const out = new Uint8Array(S * S * 4);
  const mx = W / S;
  const my = H / S;
  const rad = Math.max(1, Math.round(o.cavityM / mx));
  const blur = blurWrap(h, S, rad);
  // Свет: сверху (по v) и чуть слева, наклон сорок градусов от нормали.
  const lx = -0.45;
  const ly = 0.55;
  const lz = 0.7;
  let hmin = Infinity;
  let hmax = -Infinity;
  if (o.heightAlpha) {
    for (let i = 0; i < h.length; i++) {
      if (h[i] < hmin) hmin = h[i];
      if (h[i] > hmax) hmax = h[i];
    }
  }
  for (let y = 0; y < S; y++) {
    const yu = ((y + 1) % S) * S;
    const yd = ((y - 1 + S) % S) * S;
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const gx = (h[y * S + ((x + 1) % S)] - h[y * S + ((x - 1 + S) % S)]) / (2 * mx);
      const gy = (h[yu + x] - h[yd + x]) / (2 * my);
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const ndl = (-gx * lx - gy * ly + lz) * inv;
      const lit = 1 + o.relief * (ndl / lz - 1);
      const cav = 1 - o.cavity * clamp01((blur[i] - h[i]) * 40);
      const k = Math.max(0.25, lit) * cav;
      out[i * 4] = Math.round(clamp01(s.r[i] * k) * 255);
      out[i * 4 + 1] = Math.round(clamp01(s.g[i] * k) * 255);
      out[i * 4 + 2] = Math.round(clamp01(s.b[i] * k) * 255);
      const a = o.heightAlpha ? (h[i] - hmin) / Math.max(1e-6, hmax - hmin) : s.a[i];
      out[i * 4 + 3] = Math.round(clamp01(a) * 255);
    }
  }
  return out;
}

const mixc = (a: RGB, b: RGB, t: number, out: RGB): RGB => {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
};

// ---------------------------------------------------------------------------------------------
// Кладка рядами: ряды и камни раскладываются один раз на плитку, пиксель ищет свой камень.

interface Courses {
  ys: number[];
  rows: { xs: number[]; off: number; ids: number[] }[];
}

function layCourses(W: number, H: number, seed: number, cMin: number, cMax: number, bMin: number, bMax: number): Courses {
  const r = stream(seed);
  const hs: number[] = [];
  let sum = 0;
  while (sum < H - (cMin + cMax) / 2) {
    const v = cMin + r() * (cMax - cMin);
    hs.push(v);
    sum += v;
  }
  const ys: number[] = [0];
  for (const v of hs) ys.push(ys[ys.length - 1] + (v * H) / sum);
  const rows = hs.map(() => {
    const ls: number[] = [];
    let s = 0;
    while (s < W - (bMin + bMax) / 2) {
      const v = bMin + r() * (bMax - bMin);
      ls.push(v);
      s += v;
    }
    const xs: number[] = [0];
    for (const v of ls) xs.push(xs[xs.length - 1] + (v * W) / s);
    return { xs, off: r() * W, ids: ls.map(() => Math.floor(r() * 1e9)) };
  });
  return { ys, rows };
}

interface Stone {
  /** Расстояние до края камня, м (меньше шва — шов). */
  edge: number;
  /** Положение в камне: доли от середины, −1…1. */
  cx: number;
  cy: number;
  id: number;
}

function stoneAt(c: Courses, W: number, xm: number, ym: number, out: Stone): Stone {
  const { ys, rows } = c;
  let k = 0;
  while (k < rows.length - 1 && ym >= ys[k + 1]) k++;
  const row = rows[k];
  let x = (xm + row.off) % W;
  if (x < 0) x += W;
  let j = 0;
  while (j < row.ids.length - 1 && x >= row.xs[j + 1]) j++;
  const x0 = row.xs[j];
  const x1 = row.xs[j + 1];
  const y0 = ys[k];
  const y1 = ys[k + 1];
  out.edge = Math.min(x - x0, x1 - x, ym - y0, y1 - ym);
  out.cx = ((x - x0) / (x1 - x0)) * 2 - 1;
  out.cy = ((ym - y0) / (y1 - y0)) * 2 - 1;
  out.id = row.ids[j];
  return out;
}

/** Тёсаный камень в точку: высота и цвет. Общий для стены, каменных этажей и храма. */
function makeAshlar(W: number, H: number, seed: number, cMin = 0.32, cMax = 0.52, bMin = 0.5, bMax = 1.3) {
  const courses = layCourses(W, H, seed, cMin, cMax, bMin, bMax);
  const st: Stone = { edge: 0, cx: 0, cy: 0, id: 0 };
  const stones: RGB[] = [C(CITY.limestone), C(CITY.limestoneGrey), C(CITY.limestoneWarm), C(CITY.limestone)];
  const mortar = C(CITY.mortar);
  const grime = C(CITY.rubbleDark);
  const tmp: RGB = [0, 0, 0];
  return (xm: number, ym: number, u: number, v: number, col: RGB): number => {
    stoneAt(courses, W, xm, ym, st);
    const ragged = (fbm(u, v, 24, 3, seed + 3) - 0.5) * 0.035;
    const e = st.edge + ragged;
    const joint = 0.014;
    if (e < joint) {
      const n = fbm(u, v, 64, 2, seed + 5);
      mixc(mortar, grime, 0.25 + n * 0.35, col);
      return -0.012 + n * 0.004;
    }
    const id = st.id;
    mixc(stones[0], stones[id % 4], ((id >>> 6) % 100) / 260, tmp);
    const bright = 0.92 + ((id >>> 12) % 100) / 900;
    const mott = 0.9 + fbm(u, v, 16, 4, seed + 11) * 0.2;
    const stain = Math.max(sstep(0.55, 0.8, fbm(u, v, 3, 3, seed + 13)), sstep(0.5, 0.85, vnoise(u * 10, v * 1.2, 10, seed + 15)) * 0.7);
    const grain = (vnoise(u * 256, v * 256, 256, seed + 17) - 0.5) * 0.06;
    const k = bright * mott * (1 - stain * 0.16) + grain;
    col[0] = tmp[0] * k;
    col[1] = tmp[1] * k;
    col[2] = tmp[2] * k * (1 - stain * 0.05);
    const bevel = sstep(joint, joint + 0.035, e);
    const bulge = 1 - 0.5 * (st.cx * st.cx * 0.3 + st.cy * st.cy * 0.5);
    const chip = sstep(0.7, 0.85, fbm(u, v, 40, 2, seed + 19)) * (1 - sstep(0.02, 0.06, st.edge));
    return 0.02 * bevel * bulge - chip * 0.012 + grain * 0.02;
  };
}

/** Бут: камни ячейками, шире, чем выше, раствор толще; кое-где остатки штукатурки. */
function makeRubble(W: number, H: number, seed: number, plasterPatch = 0.66) {
  const px = Math.round(W / 0.36);
  const py = Math.round(H / 0.24);
  const cell: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const stones: RGB[] = [C(CITY.rubbleGrey), C(CITY.rubbleBrown), C(CITY.limestoneGrey), C(CITY.rubbleDark), C(CITY.sandstone)];
  const mortar = C(CITY.mortar);
  const plaster = C(CITY.plasterShade);
  const tmp: RGB = [0, 0, 0];
  return (_xm: number, _ym: number, u: number, v: number, col: RGB): number => {
    const warp = (fbm(u, v, 8, 2, seed + 1) - 0.5) * 0.6;
    cells(u * px + warp, v * py + warp * 0.5, px, py, 0.95, seed, cell);
    const edge = cell.f2 - cell.f1;
    const plast = sstep(plasterPatch, plasterPatch + 0.06, fbm(u, v, 3, 4, seed + 23));
    if (plast > 0.5) {
      const n = fbm(u, v, 24, 3, seed + 29);
      mixc(plaster, mortar, n * 0.6, col);
      return 0.012 + n * 0.004;
    }
    if (edge < 0.16) {
      const n = fbm(u, v, 48, 2, seed + 31);
      mixc(mortar, C(CITY.grime), 0.15 + n * 0.4, col);
      return -0.01 + n * 0.003;
    }
    const id = cell.id;
    mixc(stones[id % 5], stones[(id >>> 4) % 5], ((id >>> 8) % 100) / 250, tmp);
    const k = (0.8 + ((id >>> 14) % 100) / 400) * (0.9 + fbm(u, v, 32, 3, seed + 37) * 0.2);
    col[0] = tmp[0] * k;
    col[1] = tmp[1] * k;
    col[2] = tmp[2] * k;
    const round = Math.max(0, 1 - cell.f1 * cell.f1 * 1.4);
    return 0.03 * sstep(0.16, 0.34, edge) * (0.5 + 0.5 * round);
  };
}

/** Штукатурка: известь пятнами, потёки, волосяные трещины, кое-где выпавший кусок до бута. */
function makePlaster(W: number, H: number, seed: number, light = 1, holes = 0.74) {
  const rubble = makeRubble(W, H, seed + 50, 2);
  const crack: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const base = C(CITY.plaster);
  const shade = C(CITY.plasterShade);
  const tmp: RGB = [0, 0, 0];
  return (xm: number, ym: number, u: number, v: number, col: RGB): number => {
    const hole = sstep(holes, holes + 0.03, fbm(u, v, 2, 4, seed + 41));
    if (hole > 0.5) {
      const hh = rubble(xm, ym, u, v, col);
      col[0] *= 0.9;
      col[1] *= 0.9;
      col[2] *= 0.9;
      return hh - 0.02;
    }
    const m = fbm(u, v, 3, 5, seed + 43);
    mixc(base, shade, sstep(0.35, 0.75, m), tmp);
    const streak = vnoise(u * 14, v * 2, 14, seed + 47) * vnoise(u * 28, v * 3, 28, seed + 53);
    const grain = (vnoise(u * 200, v * 150, 200, seed + 59) - 0.5) * 0.05;
    cells(u * 5, v * 4, 5, 4, 1, seed + 61, crack);
    const cr = (1 - sstep(0.003, 0.012, crack.f2 - crack.f1)) * sstep(0.62, 0.74, fbm(u, v, 6, 2, seed + 67)) * 0.7;
    const k = light * (1 - streak * 0.12 - cr * 0.35) + grain;
    col[0] = tmp[0] * k;
    col[1] = tmp[1] * k;
    col[2] = tmp[2] * k;
    // Край выпавшего куска чуть приподнят и светлее.
    return 0.012 + grain * 0.02 - cr * 0.004 + (hole > 0.02 ? 0.003 : 0);
  };
}

// ---------------------------------------------------------------------------------------------
// Фахверк: балки — отрезки с шириной, окна, ставни, штукатурка между.

interface Beam {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  w: number;
}
interface Opening {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
interface Frame {
  beams: Beam[];
  windows: Opening[];
  shutters: Opening[];
  timber: number;
  shutter: number;
  /** Окна в свинцовых ромбах (true) или в мелкую клетку. */
  diamond: boolean;
}

const post = (x: number, y0: number, y1: number, w: number): Beam => ({ ax: x, ay: y0, bx: x, by: y1, w });
const rail = (x0: number, x1: number, y: number, w: number): Beam => ({ ax: x0, ay: y, bx: x1, by: y, w });
const brace = (ax: number, ay: number, bx: number, by: number, w: number): Beam => ({ ax, ay, bx, by, w });

function frameA(): Frame {
  const beams: Beam[] = [rail(-0.2, 4.2, 0.1, 0.2), rail(-0.2, 4.2, 2.9, 0.2)];
  const windows: Opening[] = [];
  const shutters: Opening[] = [];
  for (let b = 0; b < 2; b++) {
    const x = b * 2;
    beams.push(post(x, 0, 3, 0.2));
    if (b === 0) beams.push(post(4, 0, 3, 0.2));
    beams.push(rail(x, x + 2, 0.9, 0.12), rail(x, x + 2, 2.05, 0.12));
    beams.push(post(x + 0.56, 0.9, 2.05, 0.12), post(x + 1.44, 0.9, 2.05, 0.12));
    beams.push(brace(x + 0.1, 0.2, x + 0.56, 0.84, 0.13), brace(x + 1.9, 0.2, x + 1.44, 0.84, 0.13));
    beams.push(brace(x + 0.1, 2.15, x + 0.5, 2.8, 0.12), brace(x + 1.9, 2.15, x + 1.5, 2.8, 0.12));
    windows.push({ x0: x + 0.62, y0: 0.98, x1: x + 1.38, y1: 1.98 });
    shutters.push({ x0: x + 0.24, y0: 0.98, x1: x + 0.62, y1: 1.98 }, { x0: x + 1.38, y0: 0.98, x1: x + 1.76, y1: 1.98 });
  }
  return { beams, windows, shutters, timber: CITY.oak, shutter: CITY.shutterGreen, diamond: false };
}

function frameB(): Frame {
  const beams: Beam[] = [rail(-0.2, 4.2, 0.09, 0.18), rail(-0.2, 4.2, 2.91, 0.18), rail(-0.2, 4.2, 0.95, 0.11), rail(-0.2, 4.2, 1.95, 0.11)];
  const windows: Opening[] = [];
  const bay = 4 / 3;
  for (let b = 0; b < 3; b++) {
    const x = b * bay;
    const wx0 = x + bay / 2 - 0.27;
    const wx1 = x + bay / 2 + 0.27;
    windows.push({ x0: wx0, y0: 1.02, x1: wx1, y1: 1.88 });
    for (let s = 0; s <= 4; s++) {
      const sx = x + (s * bay) / 4;
      beams.push(post(sx, 0.18, 0.95, 0.1), post(sx, 1.95, 2.82, 0.1));
      if (sx < wx0 - 0.05 || sx > wx1 + 0.05) beams.push(post(sx, 0.95, 1.95, 0.1));
    }
    beams.push(post(wx0 - 0.04, 0.95, 1.95, 0.08), post(wx1 + 0.04, 0.95, 1.95, 0.08));
    // Косой крест под окном.
    beams.push(brace(x + bay / 4, 0.18, x + (3 * bay) / 4, 0.92, 0.1), brace(x + (3 * bay) / 4, 0.18, x + bay / 4, 0.92, 0.1));
  }
  return { beams, windows, shutters: [], timber: CITY.shutterRed, shutter: CITY.shutterRed, diamond: true };
}

function frameC(): Frame {
  const beams: Beam[] = [rail(-0.2, 4.2, 0.1, 0.22), rail(-0.2, 4.2, 2.89, 0.22)];
  const windows: Opening[] = [];
  const shutters: Opening[] = [];
  for (let b = 0; b < 2; b++) {
    const x = b * 2;
    beams.push(post(x, 0, 3, 0.22));
    if (b === 0) beams.push(post(4, 0, 3, 0.22));
    beams.push(rail(x, x + 2, 0.92, 0.12), rail(x, x + 2, 1.98, 0.12));
    beams.push(post(x + 0.48, 0.92, 1.98, 0.11), post(x + 1.0, 0.92, 1.98, 0.1), post(x + 1.52, 0.92, 1.98, 0.11));
    // «Человек»: длинные раскосы от подножия стойки к ригелю и от ригеля к обвязке.
    for (let t = 0; t < 6; t++) {
      const f = t / 6;
      const g = (t + 1) / 6;
      const cx = (k: number) => x + 0.11 + 0.36 * Math.sin(k * Math.PI * 0.5);
      beams.push(brace(cx(f), 0.21 + 0.68 * f, cx(g), 0.21 + 0.68 * g, 0.12));
      const dx = (k: number) => x + 1.89 - 0.36 * Math.sin(k * Math.PI * 0.5);
      beams.push(brace(dx(f), 0.21 + 0.68 * f, dx(g), 0.21 + 0.68 * g, 0.12));
    }
    beams.push(brace(x + 0.11, 2.1, x + 0.48, 2.78, 0.12), brace(x + 1.89, 2.1, x + 1.52, 2.78, 0.12));
    windows.push({ x0: x + 0.53, y0: 1.04, x1: x + 0.95, y1: 1.92 }, { x0: x + 1.05, y0: 1.04, x1: x + 1.47, y1: 1.92 });
    shutters.push({ x0: x + 0.2, y0: 1.04, x1: x + 0.48, y1: 1.92 }, { x0: x + 1.52, y0: 1.04, x1: x + 1.8, y1: 1.92 });
  }
  return { beams, windows, shutters, timber: CITY.timberGrey, shutter: CITY.shutterBrown, diamond: false };
}

/** Расстояние от точки до отрезка с переносом по ширине плитки. */
function segDist(px: number, py: number, s: Beam, W: number, cut = 0.1): number {
  let best = Infinity;
  const pad = s.w / 2 + cut;
  if (py < Math.min(s.ay, s.by) - pad || py > Math.max(s.ay, s.by) + pad) return best;
  const lo = Math.min(s.ax, s.bx) - pad;
  const hi = Math.max(s.ax, s.bx) + pad;
  for (let k = -1; k <= 1; k++) {
    const x = px + k * W;
    if (x < lo || x > hi) continue;
    const dx = s.bx - s.ax;
    const dy = s.by - s.ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    const t = clamp01(((x - s.ax) * dx + (py - s.ay) * dy) / len2);
    const ex = s.ax + dx * t - x;
    const ey = s.ay + dy * t - py;
    const d = Math.sqrt(ex * ex + ey * ey) - s.w / 2;
    if (d < best) best = d;
  }
  return best;
}

const inside = (o: Opening, x: number, y: number, pad = 0): boolean =>
  x >= o.x0 - pad && x <= o.x1 + pad && y >= o.y0 - pad && y <= o.y1 + pad;

/** Окно: рама, стекло в переплёте, глубина проёма — сверху и слева темнее. Возвращает высоту. */
function paintWindow(o: Opening, xm: number, ym: number, u: number, v: number, seed: number, diamond: boolean, col: RGB, a: { v: number }): number {
  const fw = 0.045;
  const inX = Math.min(xm - o.x0, o.x1 - xm);
  const inY = Math.min(ym - o.y0, o.y1 - ym);
  if (inX < fw || inY < fw) {
    mixc(C(CITY.oakLight), C(CITY.oak), fbm(u, v, 64, 2, seed) * 0.6, col);
    return 0.005;
  }
  const gx = xm - o.x0 - fw;
  const gy = ym - o.y0 - fw;
  let lead: number;
  if (diamond) {
    const p = 0.11;
    const d1 = Math.abs((((gx + gy) / p) % 1) - 0.5);
    const d2 = Math.abs((((gx - gy + 10) / p) % 1) - 0.5);
    lead = Math.max(1 - sstep(0.0, 0.08, 0.5 - d1), 1 - sstep(0.0, 0.08, 0.5 - d2));
  } else {
    const cw = (o.x1 - o.x0 - 2 * fw) / 2;
    const ch = (o.y1 - o.y0 - 2 * fw) / 3;
    const fx = Math.abs(((gx / cw) % 1) - 0.5);
    const fy = Math.abs(((gy / ch) % 1) - 0.5);
    lead = Math.max(1 - sstep(0, 0.05, 0.5 - fx), 1 - sstep(0, 0.05, 0.5 - fy));
  }
  const sky = (ym - o.y0) / (o.y1 - o.y0);
  mixc(C(CITY.glass), C(CITY.glassLit), sky * 0.6 + (vnoise(u * 90, v * 90, 90, seed + 3) - 0.5) * 0.3, col);
  // Тень откоса: сверху и слева.
  const reveal = Math.min(1, (o.y1 - ym) / 0.12) * Math.min(1, (xm - o.x0) / 0.1);
  const k = 0.55 + 0.45 * reveal;
  if (lead > 0.5) {
    mixc(col, C(CITY.lead), 0.85, col);
  }
  col[0] *= k;
  col[1] *= k;
  col[2] *= k;
  a.v = lead > 0.5 ? 0.35 : 1;
  return -0.05;
}

/** Ставня: доски вертикально, косая планка, свой цвет. */
function paintShutter(o: Opening, xm: number, ym: number, u: number, v: number, seed: number, hex: number, col: RGB): number {
  const bw = 0.095;
  const lx = xm - o.x0;
  const ly = ym - o.y0;
  const gap = Math.abs((lx / bw) % 1 - 0.5) > 0.46;
  const wx = o.x1 - o.x0;
  const wy = o.y1 - o.y0;
  const diag = Math.abs(ly - 0.12 - (lx / wx) * (wy - 0.24)) < 0.04;
  const bar = Math.abs(ly - 0.12) < 0.035 || Math.abs(ly - (wy - 0.12)) < 0.035;
  const grain = fbm(u * 0.4, v * 3, 24, 3, seed + 5);
  mixc(C(hex), C(CITY.timberGrey), 0.15 + grain * 0.35, col);
  let k = 0.95;
  if (gap) k = 0.6;
  if (diag || bar) k = 1.08;
  col[0] *= k;
  col[1] *= k;
  col[2] *= k;
  return 0.03 + (diag || bar ? 0.012 : 0) - (gap ? 0.01 : 0);
}

/**
 * Потёк под кромкой (x0..x1 на высоте y): сила 0..1. Струи — по столбцам своей длины (0.3–1.3 м), гуще
 * у кромки. Шум — по доле плитки `u` с целым периодом: плитка тайлится.
 */
function streakUnder(x0: number, x1: number, y: number, xm: number, ym: number, u: number, seed: number): number {
  if (xm < x0 + 0.03 || xm > x1 - 0.03 || ym > y || ym < y - 1.4) return 0;
  const col = vnoise(u * 48, 0.5, 48, seed);
  const len = 0.3 + col * 1.0;
  const down = (y - ym) / len;
  if (down > 1) return 0;
  return (1 - down) * (1 - down) * (0.35 + 0.65 * sstep(0.35, 0.75, col));
}

function makeTimber(fr: Frame, W: number, H: number, seed: number) {
  const plaster = makePlaster(W, H, seed + 100, 1.04, 0.8);
  const wood = C(fr.timber);
  const woodHi = C(CITY.oakLight);
  const tmp: RGB = [0, 0, 0];
  const glass = { v: 0 };
  return (xm: number, ym: number, u: number, v: number, col: RGB, alpha: { v: number }): number => {
    alpha.v = 0;
    for (const o of fr.shutters) if (inside(o, xm, ym)) return paintShutter(o, xm, ym, u, v, seed + 7, fr.shutter, col);
    for (const o of fr.windows) {
      if (inside(o, xm, ym)) {
        const hh = paintWindow(o, xm, ym, u, v, seed + 11, fr.diamond, col, glass);
        alpha.v = glass.v;
        return hh;
      }
    }
    // Подоконная доска.
    for (const o of fr.windows) {
      if (xm > o.x0 - 0.06 && xm < o.x1 + 0.06 && ym > o.y0 - 0.07 && ym < o.y0) {
        mixc(woodHi, wood, 0.3, col);
        return 0.05;
      }
    }
    let best = Infinity;
    let along = 0;
    for (const b of fr.beams) {
      const d = segDist(xm, ym, b, W);
      if (d < best) {
        best = d;
        along = Math.abs(b.bx - b.ax) > Math.abs(b.by - b.ay) ? xm : ym;
      }
    }
    const ragged = (fbm(u, v, 40, 2, seed + 13) - 0.5) * 0.02;
    if (best + ragged < 0) {
      // Балка: волокна вдоль, края скруглены, тон доски чуть свой.
      const grainU = along === xm ? u : v * (H / W);
      const g = fbm(grainU * 0.15 + v * 0.02, (along === xm ? v : u) * 4, 32, 3, seed + 17);
      const crack = sstep(0.62, 0.7, vnoise(grainU * 6, (along === xm ? v : u) * 60, 6, seed + 19));
      mixc(wood, woodHi, g * 0.45, tmp);
      const k = 0.85 + g * 0.25 - crack * 0.3;
      col[0] = tmp[0] * k;
      col[1] = tmp[1] * k;
      col[2] = tmp[2] * k;
      return 0.04 * sstep(0, 0.02, -best - ragged) + g * 0.004;
    }
    const hh = plaster(xm, ym, u, v, col);
    // Штукатурка у балки чуть темнее — затекшая грязь и тень.
    const near = 1 - sstep(0, 0.06, best);
    // Потёки под подоконником: дождь с доски — тёмные струи, гуще у доски, гаснут книзу.
    let streak = 0;
    for (const o of fr.windows) streak = Math.max(streak, streakUnder(o.x0, o.x1, o.y0 - 0.07, xm, ym, u, seed + 23));
    col[0] *= (1 - near * 0.18) * (1 - streak * 0.24);
    col[1] *= (1 - near * 0.18) * (1 - streak * 0.25);
    col[2] *= (1 - near * 0.2) * (1 - streak * 0.27);
    return hh;
  };
}

// ---------------------------------------------------------------------------------------------
// Слои.

type Painter = (s: Surf, seed: number) => Bake;

const ashlarLayer: Painter = (s, seed) => {
  const st = makeAshlar(s.W, s.H, seed);
  const col: RGB = [0, 0, 0];
  s.each((xm, ym, u, v, i) => {
    s.h[i] = st(xm, ym, u, v, col);
    s.set(i, col);
  });
  return { relief: 0.9, cavity: 0.35, cavityM: 0.05 };
};

const rubbleLayer: Painter = (s, seed) => {
  const st = makeRubble(s.W, s.H, seed);
  const col: RGB = [0, 0, 0];
  s.each((xm, ym, u, v, i) => {
    s.h[i] = st(xm, ym, u, v, col);
    s.set(i, col);
  });
  return { relief: 1, cavity: 0.4, cavityM: 0.05 };
};

const plasterLayer: Painter = (s, seed) => {
  const st = makePlaster(s.W, s.H, seed);
  const col: RGB = [0, 0, 0];
  s.each((xm, ym, u, v, i) => {
    s.h[i] = st(xm, ym, u, v, col);
    s.set(i, col);
  });
  return { relief: 0.7, cavity: 0.3, cavityM: 0.04 };
};

const timberLayer = (fr: () => Frame): Painter => (s, seed) => {
  const st = makeTimber(fr(), s.W, s.H, seed);
  const col: RGB = [0, 0, 0];
  const a = { v: 0 };
  s.each((xm, ym, u, v, i) => {
    s.h[i] = st(xm, ym, u, v, col, a);
    s.a[i] = a.v;
    s.set(i, col);
  });
  return { relief: 0.8, cavity: 0.45, cavityM: 0.05 };
};

/** Каменный этаж: мелкая тёсаная кладка, парные романские окна в обрамлении. */
const stoneWinLayer: Painter = (s, seed) => {
  const wall = makeAshlar(s.W, s.H, seed, 0.2, 0.32, 0.35, 0.8);
  const col: RGB = [0, 0, 0];
  const glass = { v: 0 };
  const dressed = C(CITY.limestoneWarm);
  s.each((xm, ym, u, v, i) => {
    const bx = xm % 2;
    // Пара проёмов: прямоугольник с полукруглым верхом.
    const opening = (cx: number): number => {
      const hw = 0.19;
      const yb = 1.0;
      const yt = 1.75;
      const dx = bx - cx;
      if (Math.abs(dx) > hw) return Infinity;
      if (ym >= yb && ym <= yt) return Math.min(hw - Math.abs(dx), ym - yb);
      if (ym > yt) {
        const r = hw - Math.sqrt(dx * dx + (ym - yt) * (ym - yt));
        return r >= 0 ? r : Infinity;
      }
      return Infinity;
    };
    const d = Math.min(opening(0.76), opening(1.24));
    s.a[i] = 0;
    if (d !== Infinity) {
      const depth = clamp01(d / 0.07);
      mixc(C(CITY.glass), C(CITY.glassLit), (ym - 1) * 0.5, col);
      const k = 0.5 + 0.5 * depth;
      s.set(i, col, k);
      s.a[i] = 0.9 * depth;
      s.h[i] = -0.08;
      return;
    }
    // Обрамление: тёсаный камень вокруг пары, разгрузочная арка над ней.
    const fx = Math.abs(bx - 1);
    const inFrame = fx < 0.55 && ym > 0.88 && ym < 1.75 + 0.1 + Math.sqrt(Math.max(0, 0.3 - fx * fx)) * 0.8;
    const arch = Math.abs(Math.sqrt((bx - 1) * (bx - 1) * 0.6 + (ym - 1.75) * (ym - 1.75) * 1.3) - 0.62) < 0.07 && ym > 1.75;
    const sill = ym > 0.88 && ym < 1.0 && fx < 0.62;
    if (inFrame || arch || sill) {
      const n = fbm(u, v, 32, 3, seed + 3);
      s.set(i, dressed, 0.95 + n * 0.12);
      s.h[i] = 0.025 + (sill ? 0.02 : 0) + (arch ? 0.01 : 0);
      void glass;
      return;
    }
    s.h[i] = wall(xm, ym, u, v, col);
    // Потёки под подоконником пары — по камню слабее, чем по штукатурке.
    const base = xm - bx;
    const st = streakUnder(base + 0.38, base + 1.62, 0.88, xm, ym, u, seed + 23);
    s.set(i, col, 1 - st * 0.2);
  });
  return { relief: 0.9, cavity: 0.4, cavityM: 0.05 };
};

/** Первый этаж с дверью и лавкой: цоколь, арочная дверь в каменном обрамлении, лавка с прилавком. */
const groundDoorLayer: Painter = (s, seed) => {
  const plaster = makePlaster(s.W, s.H, seed + 3, 0.98);
  const plinth = makeRubble(s.W, s.H, seed + 5, 2);
  const voussoir = makeAshlar(s.W, s.H, seed + 9, 0.2, 0.3, 0.25, 0.4);
  const col: RGB = [0, 0, 0];
  s.each((xm, ym, u, v, i) => {
    s.a[i] = 0;
    // Дверь: x 0.55–1.65, низ 0, арка от 2.0 радиусом 0.55.
    const dcx = 1.1;
    const dr = 0.55;
    const ddx = xm - dcx;
    const inDoor = Math.abs(ddx) < dr && (ym < 2.0 || ddx * ddx + (ym - 2.0) * (ym - 2.0) < dr * dr);
    const ring = Math.abs(ddx) < dr + 0.2 && (ym < 2.0 ? Math.abs(ddx) > dr : Math.sqrt(ddx * ddx + (ym - 2.0) * (ym - 2.0)) < dr + 0.2);
    if (inDoor) {
      const plank = Math.abs(((xm - 0.55) / 0.137) % 1 - 0.5) > 0.45;
      const strap = Math.abs(ym - 0.45) < 0.035 || Math.abs(ym - 1.55) < 0.035;
      const stud = strap && Math.abs(((xm - 0.55) / 0.137) % 1 - 0.5) < 0.12;
      const g = fbm(u * 0.3, v * 3, 24, 3, seed + 7);
      mixc(C(CITY.door), C(CITY.oak), g * 0.5, col);
      let k = plank ? 0.62 : 0.95;
      if (strap) {
        mixc(col, C(CITY.iron), 0.8, col);
        k = stud ? 1.25 : 1;
      }
      const reveal = Math.min(1, (xm - 0.55) / 0.12) * Math.min(1, (2.55 - ym) / 0.15);
      s.set(i, col, k * (0.6 + 0.4 * reveal));
      s.a[i] = plank ? 0.25 : 0;
      s.h[i] = -0.12 + (strap ? 0.01 : 0) - (plank ? 0.01 : 0);
      return;
    }
    if (ring && ym > 0.0) {
      s.h[i] = voussoir(xm * 3, ym, u, v, col) + 0.02;
      s.set(i, col, 1.04);
      return;
    }
    // Лавка: x 2.25–3.65, y 0.78–1.95; прилавок 0.64–0.78; ставня наверх открыта 1.95–2.12.
    if (xm > 2.25 && xm < 3.65 && ym > 0.78 && ym < 1.95) {
      const sh = vnoise(u * 30, v * 10, 30, seed + 11);
      mixc(C(CITY.glass), C(CITY.door), 0.35 + sh * 0.3, col);
      const goods = ym < 1.1 && Math.abs(((xm - 2.25) / 0.23) % 1 - 0.5) < 0.32;
      if (goods) mixc(col, C(CITY.rubbleBrown), 0.6, col);
      const reveal = Math.min(1, (1.95 - ym) / 0.25);
      s.set(i, col, 0.55 + 0.35 * reveal);
      s.a[i] = 0.8;
      s.h[i] = -0.15;
      return;
    }
    if (xm > 2.15 && xm < 3.75 && ((ym > 0.64 && ym <= 0.78) || (ym >= 1.95 && ym < 2.12))) {
      const g = fbm(u * 0.2, v * 4, 24, 3, seed + 13);
      mixc(C(CITY.oakLight), C(CITY.door), g * 0.6, col);
      s.set(i, col, ym < 1 ? 1.08 : 0.9);
      s.h[i] = 0.06;
      return;
    }
    if (ym < 0.48) {
      s.h[i] = plinth(xm, ym, u, v, col) + 0.03;
      s.set(i, col, 0.92);
      return;
    }
    s.h[i] = plaster(xm, ym, u, v, col);
    s.set(i, col);
  });
  return { relief: 0.85, cavity: 0.4, cavityM: 0.05 };
};

/** Черепица «бобровый хвост»: ряды со сдвигом, скруглённый низ, тень нахлёста, лишайник и мох. */
const roofTileLayer: Painter = (s, seed) => {
  const rows = 24;
  const per = 22;
  const rh = s.H / rows;
  const tw = s.W / per;
  const d = rh * 0.42;
  const tiles: RGB[] = [C(CITY.tile), C(CITY.tileLight), C(CITY.tileDark), C(CITY.tile)];
  const lichen = C(CITY.lichen);
  const moss = C(CITY.moss);
  const tmp: RGB = [0, 0, 0];
  const lc: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  // Низ ряда k у точки x: где кончается черепица ряда k (скруглённый хвост).
  const bottom = (k: number, xm: number): { y: number; cx: number; col: number } => {
    const off = (k & 1) * 0.5;
    const t = xm / tw - off;
    const col = Math.floor(t);
    const fx = t - col - 0.5;
    const round = Math.sqrt(Math.max(0, 1 - fx * fx * 4));
    const wob = (vnoise(xm * 2, k * 1.3, 8, seed) - 0.5) * 0.012;
    return { y: k * rh - d * round + wob, cx: fx, col };
  };
  s.each((xm, ym, u, v, i) => {
    let k = Math.floor((ym + d) / rh);
    let b = bottom(k, xm);
    if (ym < b.y) {
      k -= 1;
      b = bottom(k, xm);
    }
    const above = bottom(k + 1, xm);
    const kk = ((k % rows) + rows) % rows;
    const cc = (((b.col % per) + per) % per) + 1000 * (k & 1);
    const id = hash3(cc, kk, seed);
    const t = clamp01((ym - b.y) / rh);
    mixc(tiles[id % 4], tiles[(id >>> 4) % 4], ((id >>> 8) % 100) / 200, tmp);
    let k1 = 0.84 + ((id >>> 16) % 100) / 380;
    // Шов между соседними черепицами ряда.
    if (Math.abs(b.cx) > 0.47) k1 *= 0.6;
    // Тень от ряда выше и свет на кромке хвоста.
    const under = above.y - ym;
    k1 *= 0.5 + 0.5 * sstep(0, 0.045, under);
    k1 *= 1 + (1 - sstep(0, 0.02, ym - b.y)) * 0.18;
    // Лишайник пятнами и мох у хвостов.
    cells(u * 60, v * 60, 60, 60, 1, seed + 3, lc);
    const spot = (1 - sstep(0.1, 0.18, lc.f1)) * sstep(0.5, 0.65, fbm(u, v, 6, 3, seed + 5));
    const mossy = sstep(0.66, 0.8, fbm(u, v, 5, 4, seed + 7)) * (1 - t * 0.7);
    mixc(tmp, lichen, spot * 0.45, tmp);
    mixc(tmp, moss, mossy * 0.45, tmp);
    const streak = vnoise(u * 20, v * 2, 20, seed + 9);
    k1 *= 1 - streak * 0.12;
    s.set(i, tmp, k1);
    s.h[i] = 0.02 * (1 - t) + 0.006 * (1 - 4 * b.cx * b.cx) - (Math.abs(b.cx) > 0.47 ? 0.006 : 0);
  });
  return { relief: 0.6, cavity: 0.25, cavityM: 0.03 };
};

/** Сланец (и дранка под тоном вершины): узкие ряды прямоугольных плиток со сколотыми углами. */
const roofSlateLayer: Painter = (s, seed) => {
  const rows = 34;
  const rh = s.H / rows;
  const slate = C(CITY.slate);
  const light = C(CITY.slateLight);
  const lichen = C(CITY.lichen);
  const tmp: RGB = [0, 0, 0];
  const per = 20;
  const tw = s.W / per;
  s.each((xm, ym, u, v, i) => {
    const k = Math.floor(ym / rh);
    const off = (k & 1) * 0.5 + (rnd(k, 0, seed) - 0.5) * 0.3;
    const t = xm / tw - off;
    const c = Math.floor(t);
    const fx = t - c - 0.5;
    const fy = ym / rh - k;
    const id = hash3(((c % per) + per) % per, ((k % rows) + rows) % rows, seed);
    const corner = Math.abs(fx) > 0.38 && fy < 0.3 && Math.abs(fx) - 0.38 > fy * 0.4;
    mixc(slate, light, ((id >>> 4) % 100) / 160, tmp);
    let kk = 0.85 + ((id >>> 12) % 100) / 400;
    if (Math.abs(fx) > 0.475 || corner) kk *= 0.5;
    kk *= 0.55 + 0.45 * sstep(0, 0.25, 1 - fy);
    kk *= 1 + (1 - sstep(0, 0.08, fy)) * 0.15;
    const spot = sstep(0.7, 0.82, fbm(u, v, 8, 4, seed + 3));
    mixc(tmp, lichen, spot * 0.25, tmp);
    s.set(i, tmp, kk);
    s.h[i] = 0.012 * (1 - fy) - (Math.abs(fx) > 0.475 || corner ? 0.006 : 0);
  });
  return { relief: 0.6, cavity: 0.25, cavityM: 0.03 };
};

/** Доски: вертикально, разной ширины, волокна, сучки, щели. */
const woodLayer: Painter = (s, seed) => {
  const r = stream(seed);
  const xs: number[] = [0];
  while (xs[xs.length - 1] < s.W - 0.2) xs.push(xs[xs.length - 1] + 0.16 + r() * 0.12);
  const scale = s.W / xs[xs.length - 1];
  for (let j = 0; j < xs.length; j++) xs[j] *= scale;
  const wood = C(CITY.door);
  const grey = C(CITY.timberGrey);
  const tmp: RGB = [0, 0, 0];
  s.each((xm, _ym, u, v, i) => {
    let j = 0;
    while (j < xs.length - 2 && xm >= xs[j + 1]) j++;
    const x0 = xs[j];
    const x1 = xs[j + 1];
    const e = Math.min(xm - x0, x1 - xm);
    const id = hash3(j, 0, seed);
    const g = fbm(u * 0.2 + j * 0.37, v * 2, 16, 4, seed + j);
    const grain = vnoise(u * 160 + g * 8, v * 6, 160, seed + 3);
    mixc(wood, grey, 0.3 + ((id >>> 4) % 100) / 200 + g * 0.2, tmp);
    let k = 0.82 + grain * 0.22 + ((id >>> 12) % 100) / 600;
    if (e < 0.006) k *= 0.35;
    s.set(i, tmp, k);
    s.h[i] = 0.01 * sstep(0.004, 0.03, e) + grain * 0.002;
  });
  return { relief: 0.8, cavity: 0.3, cavityM: 0.03 };
};

/** Брусчатка: окатанные камни ячейками, грязь в швах, верх отполирован ногами. */
const cobbleLayer: Painter = (s, seed) => {
  const p = 22;
  const cell: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const stones: RGB[] = [C(CITY.cobble), C(CITY.cobbleWarm), C(CITY.cobbleDark), C(CITY.limestoneGrey), C(CITY.cobble)];
  const grime = C(CITY.grime);
  const dirt = C(CITY.dirtDark);
  const tmp: RGB = [0, 0, 0];
  s.each((_xm, _ym, u, v, i) => {
    const w = (fbm(u, v, 6, 2, seed + 1) - 0.5) * 0.5;
    cells(u * p + w, v * p - w, p, p, 0.85, seed, cell);
    const edge = cell.f2 - cell.f1;
    if (edge < 0.1) {
      mixc(grime, dirt, fbm(u, v, 48, 2, seed + 3), tmp);
      s.set(i, tmp, 0.8);
      s.h[i] = -0.01;
      return;
    }
    const id = cell.id;
    mixc(stones[0], stones[id % 5], ((id >>> 9) % 100) / 260, tmp);
    const dome = Math.sqrt(Math.max(0, 1 - cell.f1 * cell.f1 * 1.6));
    const polish = sstep(0.6, 1, dome) * 0.12;
    const k = 0.84 + ((id >>> 15) % 100) / 700 + polish * 0.7 + (fbm(u, v, 64, 2, seed + 5) - 0.5) * 0.08;
    s.set(i, tmp, k);
    s.h[i] = 0.035 * dome * sstep(0.1, 0.22, edge);
  });
  return { relief: 1, cavity: 0.35, cavityM: 0.04, heightAlpha: true };
};

/** Земля улиц и дворов: утоптанная, камешки, сырые пятна. */
const dirtLayer: Painter = (s, seed) => {
  const cell: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const tmp: RGB = [0, 0, 0];
  const dirt = C(CITY.dirt);
  const dark = C(CITY.dirtDark);
  const light = C(CITY.dirtLight);
  const pebble = C(CITY.rubbleGrey);
  s.each((_xm, _ym, u, v, i) => {
    const m = fbm(u, v, 6, 5, seed);
    mixc(dark, dirt, 0.3 + 0.7 * sstep(0.2, 0.65, m), tmp);
    mixc(tmp, light, sstep(0.6, 0.85, fbm(u, v, 8, 3, seed + 3)) * 0.6, tmp);
    cells(u * 44, v * 44, 44, 44, 1, seed + 5, cell);
    const peb = cell.f1 < 0.12 + (cell.id % 7) * 0.025 && cell.id % 3 === 0;
    let hh = m * 0.02 + vnoise(u * 180, v * 180, 180, seed + 7) * 0.004;
    if (peb) {
      mixc(pebble, light, (cell.id >>> 8) % 2 ? 0.4 : 0, tmp);
      hh += 0.01 * (1 - cell.f1 * 4);
    }
    const wet = 1 - sstep(0.16, 0.3, fbm(u, v, 5, 3, seed + 9));
    s.set(i, tmp, (0.92 + vnoise(u * 120, v * 120, 120, seed + 11) * 0.12) * (1 - wet * 0.12));
    s.h[i] = hh - wet * 0.01;
  });
  return { relief: 0.9, cavity: 0.3, cavityM: 0.04, heightAlpha: true };
};

/** Луг: зелень пятнами, сухое, клевер, редкие цветы. */
const grassLayer: Painter = (s, seed) => {
  const cell: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const tmp: RGB = [0, 0, 0];
  const grass = C(CITY.grass);
  const dry = C(CITY.grassDry);
  const dark = C(CITY.grassDark);
  const clover = C(CITY.clover);
  s.each((_xm, _ym, u, v, i) => {
    const m = fbm(u, v, 4, 5, seed);
    mixc(dark, grass, 0.35 + 0.65 * sstep(0.2, 0.7, m), tmp);
    mixc(tmp, dry, sstep(0.55, 0.85, fbm(u, v, 6, 4, seed + 3)) * 0.45, tmp);
    mixc(tmp, clover, sstep(0.62, 0.72, fbm(u, v, 12, 3, seed + 5)) * 0.35, tmp);
    const blade = vnoise(u * 220, v * 220, 220, seed + 7) * 0.6 + vnoise(u * 90, v * 300, 90, seed + 9) * 0.4;
    let k = 0.72 + blade * 0.42;
    let hh = blade * 0.03 + m * 0.02;
    cells(u * 52, v * 52, 52, 52, 1, seed + 11, cell);
    if (cell.f1 < 0.11 && cell.id % 9 === 0) {
      mixc(tmp, (cell.id >>> 5) % 3 === 0 ? C(CITY.flowerYellow) : C(CITY.flowerWhite), 0.85, tmp);
      k = 1;
      hh += 0.02;
    }
    s.set(i, tmp, k);
    s.h[i] = hh;
  });
  return { relief: 0.7, cavity: 0.35, cavityM: 0.03, heightAlpha: true };
};

/** Листва крон: листья ячейками, просветы тёмные, купы светлее сверху. */
const foliageLayer: Painter = (s, seed) => {
  const cell: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const tmp: RGB = [0, 0, 0];
  const dark = C(CITY.leafDark);
  const mid = C(CITY.leaf);
  const light = C(CITY.leafLight);
  s.each((_xm, _ym, u, v, i) => {
    const clump = fbm(u, v, 4, 3, seed);
    cells(u * 30, v * 30, 30, 30, 1, seed + 3, cell);
    const size = 0.42 + ((cell.id >>> 3) % 100) / 500;
    if (cell.f1 > size) {
      mixc(dark, mid, clump * 0.3, tmp);
      s.set(i, tmp, 0.45);
      s.h[i] = -0.02;
      return;
    }
    const top = clamp01(0.5 - cell.dy * 1.2);
    mixc(dark, mid, 0.4 + clump * 0.6, tmp);
    mixc(tmp, light, top * 0.5 * clump + ((cell.id >>> 9) % 100) / 500, tmp);
    s.set(i, tmp, 0.8 + top * 0.3);
    s.h[i] = 0.02 * (1 - cell.f1 / size) + clump * 0.03;
  });
  return { relief: 0.7, cavity: 0.5, cavityM: 0.06, heightAlpha: true };
};

/** Скала: пласты известняка уступами — каждый пласт выступает по-своему, редкие вертикальные трещины. */
const rockLayer: Painter = (s, seed) => {
  const tmp: RGB = [0, 0, 0];
  const rock = C(CITY.rock);
  const dark = C(CITY.rockDark);
  const warm = C(CITY.limestoneWarm);
  const n = 11;
  s.each((xm, ym, u, v, i) => {
    const warp = (fbm(u, v, 2, 3, seed) - 0.5) * 1.4 + (vnoise(u * 6, v * 6, 6, seed + 1) - 0.5) * 0.5;
    const band = (ym / s.H) * n + warp;
    const k = Math.floor(band);
    const f = band - k;
    const kk = ((k % n) + n) % n;
    const id = hash3(kk, 0, seed);
    // Вертикальные трещины пласта: свой шаг и сдвиг у каждого пласта.
    // Шаг трещин делит плитку целым числом — без шва по краю.
    const nJ = Math.round(s.W / (0.9 + ((id >>> 5) % 100) / 60));
    const jx = ((xm + rnd(kk, 1, seed) * s.W) / s.W) * nJ;
    const jf = jx - Math.floor(jx) + (vnoise(u * 20, v * 20, 20, seed + 3) - 0.5) * 0.2;
    const crack = (1 - sstep(0.0, 0.035, Math.abs(jf - 0.5) - 0.465)) * (rnd(Math.floor(jx) % nJ, kk, seed + 5) < 0.5 ? 1 : 0);
    mixc(rock, warm, ((id >>> 3) % 100) / 200 + fbm(u, v, 12, 3, seed + 7) * 0.25, tmp);
    const ledge = sstep(0.0, 0.1, f) * (1 - sstep(0.85, 1, f) * 0.4);
    mixc(tmp, dark, (1 - sstep(0.0, 0.12, f)) * 0.7, tmp);
    const lich = sstep(0.64, 0.74, fbm(u, v, 8, 3, seed + 9));
    mixc(tmp, C(CITY.lichen), lich * 0.35, tmp);
    s.set(i, tmp, (0.82 + fbm(u, v, 32, 3, seed + 11) * 0.3) * (1 - crack * 0.45));
    s.h[i] = 0.1 * ledge + ((id >>> 9) % 10) * 0.012 - crack * 0.03 + fbm(u, v, 24, 2, seed + 13) * 0.03;
  });
  return { relief: 1, cavity: 0.4, cavityM: 0.08 };
};

/**
 * Свежий срез известняка в каменоломне: светлый, тёплый, пластами по метру с небольшим, по плоскости —
 * косые следы кирки, по швам пластов — ряды клиновых гнёзд, сверху — потемнее, выветренное.
 */
const cutLayer: Painter = (s, seed) => {
  const tmp: RGB = [0, 0, 0];
  const pale = C(0xd9ccb0);
  const lime = C(CITY.limestone);
  const weather = C(CITY.limestoneGrey);
  const n = 3;
  s.each((xm, ym, u, v, i) => {
    const warp = (fbm(u, v, 2, 3, seed) - 0.5) * 0.5;
    const band = v * n + warp;
    const k = Math.floor(band);
    const f = band - k;
    const kk = ((k % n) + n) % n;
    mixc(pale, lime, fbm(u, v, 6, 3, seed + 1) * 0.7 + rnd(kk, 3, seed) * 0.2, tmp);
    // Шов пласта — тонкая тень над уступчиком.
    const seam = 1 - sstep(0.0, 0.05, f);
    mixc(tmp, weather, seam * 0.55, tmp);
    // Следы кирки: косые борозды, у каждого пласта — свой наклон.
    const slope = rnd(kk, 7, seed) < 0.5 ? 1 : -1;
    const tool = Math.sin((u * 40 + slope * v * 24 + fbm(u, v, 16, 2, seed + 3) * 0.6) * Math.PI * 2) * 0.5 + 0.5;
    // Клиновые гнёзда по шву: короткие тёмные щели шагом в четверть метра.
    const wedgeRow = f > 0.06 && f < 0.16 && rnd(kk, 9, seed) < 0.6;
    const wx = (u * 16) % 1;
    const wedge = wedgeRow && wx > 0.42 && wx < 0.52 ? 1 : 0;
    // Выветренный верх плитки и пятна.
    const stain = sstep(0.6, 0.8, fbm(u, v, 4, 3, seed + 5)) * 0.35;
    mixc(tmp, weather, stain, tmp);
    s.set(i, tmp, (0.97 + tool * 0.06) * (1 - wedge * 0.55));
    s.h[i] = sstep(0.0, 0.06, f) * 0.04 + tool * 0.006 - wedge * 0.03 + fbm(u, v, 20, 2, seed + 7) * 0.01;
    void xm;
    void ym;
  });
  return { relief: 0.9, cavity: 0.3, cavityM: 0.05 };
};

/** Стена храма: крупная кладка, стрельчатое окно с витражом, карниз-пояс. */
const churchWinLayer: Painter = (s, seed) => {
  const wall = makeAshlar(s.W, s.H, seed, 0.36, 0.5, 0.6, 1.2);
  const col: RGB = [0, 0, 0];
  const cell: Cell = { f1: 0, f2: 0, id: 0, dx: 0, dy: 0 };
  const stains: RGB[] = [C(CITY.stainBlue), C(CITY.stainRed), C(CITY.stainGold), C(CITY.stainBlue)];
  const dressed = C(CITY.limestoneWarm);
  s.each((xm, ym, u, v, i) => {
    s.a[i] = 0;
    const cx = 2;
    const hw = 0.55;
    const yb = 4.6;
    const ys = 9.4;
    const dx = xm - cx;
    // Стрельчатая арка: две дуги радиусом 2·hw из точек cx ± hw.
    const inArch = (w: number): boolean => {
      if (Math.abs(dx) > w) return false;
      if (ym >= yb && ym <= ys) return true;
      if (ym < ys) return false;
      const r = 2 * w;
      const l = Math.hypot(xm - (cx + w), ym - ys) <= r;
      const rr = Math.hypot(xm - (cx - w), ym - ys) <= r;
      return l && rr && ym - ys < Math.sqrt(3) * w;
    };
    if (inArch(hw)) {
      cells(u * 24, v * 48, 24, 48, 0.6, seed + 3, cell);
      const lead = cell.f2 - cell.f1 < 0.08 || Math.abs(dx) < 0.025 || Math.abs(ym - 7.0) < 0.03;
      const g = stains[cell.id % 4];
      if (lead) {
        s.set(i, C(CITY.lead), 0.9);
        s.a[i] = 0.2;
      } else {
        s.set(i, g, 0.75 + ((cell.id >>> 5) % 100) / 300);
        s.a[i] = 1;
      }
      s.h[i] = -0.15;
      return;
    }
    if (inArch(hw + 0.2)) {
      // Откос: светлый тёсаный камень, к стеклу темнее.
      const n = fbm(u, v, 32, 3, seed + 5);
      s.set(i, dressed, 0.82 + n * 0.12);
      s.h[i] = -0.06;
      return;
    }
    if (Math.abs(ym - 4.3) < 0.1) {
      s.set(i, dressed, ym > 4.3 ? 1.08 : 0.8);
      s.h[i] = 0.06;
      return;
    }
    s.h[i] = wall(xm, ym, u, v, col);
    s.set(i, col);
  });
  return { relief: 0.9, cavity: 0.4, cavityM: 0.06 };
};

/** Поле: борозды поперёк, всходы по гребням. */
const fieldLayer: Painter = (s, seed) => {
  const tmp: RGB = [0, 0, 0];
  const furrow = C(CITY.furrow);
  const crop = C(CITY.crop);
  s.each((_xm, ym, u, v, i) => {
    const w = (fbm(u, v, 4, 2, seed) - 0.5) * 0.15;
    const f = (ym / 0.5 + w) % 1;
    const ridge = Math.sin(f * Math.PI * 2) * 0.5 + 0.5;
    const plant = sstep(0.55, 0.9, ridge) * sstep(0.35, 0.7, vnoise(u * 160, v * 30, 160, seed + 3));
    mixc(furrow, crop, plant * 0.9, tmp);
    s.set(i, tmp, 0.75 + ridge * 0.3 + (fbm(u, v, 32, 2, seed + 5) - 0.5) * 0.15);
    s.h[i] = ridge * 0.06 + plant * 0.02;
  });
  return { relief: 0.9, cavity: 0.3, cavityM: 0.05, heightAlpha: true };
};

/** Башня: тёсаная кладка, бойница с раструбом в обрамлении. */
const towerSlitLayer: Painter = (s, seed) => {
  const wall = makeAshlar(s.W, s.H, seed, 0.34, 0.5, 0.55, 1.2);
  const col: RGB = [0, 0, 0];
  const dressed = C(CITY.limestoneWarm);
  // Две бойницы на плитку, в разных рядах — сеткой не читаются.
  const slits: [number, number][] = [
    [1.6, 1.4],
    [4.4, 4.6],
  ];
  s.each((xm, ym, u, v, i) => {
    for (const [sx, sy] of slits) {
      const dx = Math.abs(xm - sx);
      const dy = ym - sy;
      const inSlit = dx < 0.06 && dy > 0 && dy < 1.4;
      const cross = Math.abs(dy - 0.7) < 0.05 && dx < 0.2;
      if (inSlit || cross) {
        s.set(i, C(CITY.glass), 0.35);
        s.h[i] = -0.2;
        s.a[i] = 0.15;
        return;
      }
      if (dx < 0.3 && dy > -0.2 && dy < 1.6) {
        const n = fbm(u, v, 32, 3, seed + 3);
        s.set(i, dressed, 0.9 + n * 0.12 - (0.3 - dx) * 0.6);
        s.h[i] = 0.01;
        s.a[i] = 0;
        return;
      }
      // Потёк под бойницей.
      if (dx < 0.25 && dy < 0 && dy > -1.6) {
        s.h[i] = wall(xm, ym, u, v, col);
        s.set(i, col, 0.9 + (dy / 1.6) * 0.1 + (1 - dx / 0.25) * -0.06);
        s.a[i] = 0;
        return;
      }
    }
    s.h[i] = wall(xm, ym, u, v, col);
    s.set(i, col);
    s.a[i] = 0;
  });
  return { relief: 0.9, cavity: 0.4, cavityM: 0.05 };
};

/** Проезд ворот: большая арка в клинчатом обрамлении, тёмный ход и поднятая решётка. */
const gateArchLayer: Painter = (s, seed) => {
  const wall = makeAshlar(s.W, s.H, seed, 0.36, 0.5, 0.6, 1.2);
  const ring = makeAshlar(s.W, s.H, seed + 3, 0.3, 0.3, 0.32, 0.4);
  const col: RGB = [0, 0, 0];
  s.each((xm, ym, u, v, i) => {
    const cx = 3;
    const r = 2;
    const yS = 3.6;
    const dx = xm - cx;
    const dist = ym > yS ? Math.hypot(dx, ym - yS) : Math.abs(dx);
    s.a[i] = 0;
    if (dist < r) {
      // Ход: темнее вглубь, решётка поднята — видны зубья внизу.
      const depth = 0.25 + 0.2 * clamp01(1 - ym / 6);
      mixc(C(CITY.grime), C(CITY.rubbleDark), 0.4, col);
      let k = depth;
      const gx = Math.abs(((xm - cx + 10) / 0.36) % 1 - 0.5) < 0.1;
      const gy = Math.abs(((ym + 10) / 0.45) % 1 - 0.5) < 0.08;
      if (ym > 4.1 && (gx || gy)) {
        mixc(col, C(CITY.iron), 0.9, col);
        k = 0.55;
      }
      if (ym > 3.7 && ym < 4.1 && gx) {
        mixc(col, C(CITY.iron), 0.9, col);
        k = 0.6;
      }
      s.set(i, col, k);
      s.h[i] = -0.4;
      s.a[i] = 0.3;
      return;
    }
    if (dist < r + 0.5 && ym > 0) {
      // Клинчатые камни: шов по радиусу.
      const ang = Math.atan2(ym - yS, dx);
      const seg = ym > yS ? Math.abs(((ang / Math.PI) * 15) % 1 - 0.5) > 0.44 : Math.abs(((ym / 0.45) % 1) - 0.5) > 0.44;
      const n = fbm(u, v, 24, 3, seed + 5);
      s.h[i] = seg ? -0.01 : 0.03;
      ring(xm, ym, u, v, col);
      s.set(i, col, seg ? 0.7 : 1.05 + n * 0.05);
      return;
    }
    s.h[i] = wall(xm, ym, u, v, col);
    s.set(i, col);
  });
  return { relief: 0.9, cavity: 0.4, cavityM: 0.06 };
};

/** Аркада ратуши: столб и полуциркульная арка, в глубине — тень и двери лавок. */
const arcadeLayer: Painter = (s, seed) => {
  const wall = makeAshlar(s.W, s.H, seed, 0.3, 0.42, 0.5, 1.0);
  const col: RGB = [0, 0, 0];
  s.each((xm, ym, u, v, i) => {
    const cx = 2;
    const r = 1.55;
    const yS = 2.6;
    const dx = xm - cx;
    const dist = ym > yS ? Math.hypot(dx, ym - yS) : Math.abs(dx);
    s.a[i] = 0;
    if (dist < r) {
      const back = ym < 2.3 && Math.abs(dx) < 0.6;
      mixc(C(CITY.grime), back ? C(CITY.door) : C(CITY.rubbleDark), 0.5, col);
      const k = back ? 0.45 : 0.3 + 0.15 * clamp01(ym / 3);
      s.set(i, col, k);
      s.h[i] = -0.5;
      s.a[i] = back ? 0.6 : 0.2;
      return;
    }
    if (dist < r + 0.32 && ym > yS) {
      const ang = Math.atan2(ym - yS, dx);
      const seg = Math.abs(((ang / Math.PI) * 11) % 1 - 0.5) > 0.44;
      s.set(i, C(CITY.limestoneWarm), seg ? 0.7 : 1.02);
      s.h[i] = seg ? 0 : 0.03;
      return;
    }
    // Импост — светлый пояс на уровне пяты арки.
    if (Math.abs(ym - yS) < 0.08) {
      s.set(i, C(CITY.limestoneWarm), ym > yS ? 1.06 : 0.82);
      s.h[i] = 0.05;
      return;
    }
    s.h[i] = wall(xm, ym, u, v, col);
    s.set(i, col);
  });
  return { relief: 0.9, cavity: 0.4, cavityM: 0.05 };
};

/** Полотно навесов: полосы, складки, переплетение; цвет даёт тон вершины. */
const clothLayer: Painter = (s, seed) => {
  s.each((xm, ym, u, v, i) => {
    // Край полосы — не на краю плитки: сдвиг на полполосы.
    const stripe = Math.floor((xm + 0.125) / 0.25) % 2 === 0;
    const fold = Math.sin((xm / 0.5) * Math.PI * 2 + vnoise(u * 4, v * 4, 4, seed) * 2) * 0.5 + 0.5;
    const weave = vnoise(u * 300, v * 300, 300, seed + 3);
    const k = (stripe ? 0.95 : 0.7) * (0.9 + fold * 0.12) * (0.94 + weave * 0.08) * (0.9 + fbm(u, v, 4, 3, seed + 5) * 0.15);
    s.set(i, C(CITY.plaster), k);
    s.h[i] = fold * 0.02;
  });
  return { relief: 0.6, cavity: 0.2, cavityM: 0.04 };
};

const PAINTERS: Record<LayerName, Painter> = {
  ashlar: ashlarLayer,
  rubble: rubbleLayer,
  plaster: plasterLayer,
  timberA: timberLayer(frameA),
  timberB: timberLayer(frameB),
  timberC: timberLayer(frameC),
  stoneWin: stoneWinLayer,
  groundDoor: groundDoorLayer,
  roofTile: roofTileLayer,
  roofSlate: roofSlateLayer,
  wood: woodLayer,
  cobble: cobbleLayer,
  dirt: dirtLayer,
  grass: grassLayer,
  foliage: foliageLayer,
  rock: rockLayer,
  churchWin: churchWinLayer,
  field: fieldLayer,
  towerSlit: towerSlitLayer,
  gateArch: gateArchLayer,
  arcade: arcadeLayer,
  cloth: clothLayer,
  cut: cutLayer,
};

/** Зерно текстур города — одно; слой берёт своё смещение. */
export const TEX_SEED = 1200;

/** Слой RGBA8 sRGB размером `size`² — строки снизу вверх. */
export function paintLayer(name: LayerName, size: number, seed = TEX_SEED): Uint8Array {
  const [W, H] = TILE_M[name];
  const s = new Surf(size, W, H);
  const o = PAINTERS[name](s, seed + L[name] * 1009);
  return bake(s, o);
}

/** Все слои подряд — один буфер `size`² × 4 × число слоёв (порядок `LAYERS`). */
export function paintAll(size: number, seed = TEX_SEED): Uint8Array {
  const one = size * size * 4;
  const out = new Uint8Array(one * LAYERS.length);
  LAYERS.forEach((n, k) => out.set(paintLayer(n, size, seed), k * one));
  return out;
}

