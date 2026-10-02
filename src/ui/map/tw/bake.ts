// Выпечка нового вида (docs/map_tw.md, раздел 4): тайл ближнего масштаба и кусок обзора.
//
// Сетка тайлов, кэш, запас и правило «стоя не печётся» — прежние (`ground.ts`, `grid.ts`,
// `tilecache.ts`): этот модуль подменяет только то, **что** печётся в тайл, и печёт его так же —
// один раз за жизнь тайла в кэше. Перевыпечки нет: двор поселения рисует его спрайт, а не тайл.
//
// Землю модуль берёт из кэша мира — тем же путём, что и прежняя выпечка: стенд кладёт туда куски
// карты сам (`stand.ts`), игра — через `worldApi`.
import type { Rect } from '@/world/types';
import { type CachedChunk, cachedChunk, chunkKeysIn, featuresAt as cachedFeatures, loadedIn, terrainAt as cachedTerrain } from '@/world/cache';
import { FEATURE } from '@/world/geography';
import { WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import type { Quality } from '@/render/quality';
import { GLADE_BELOW, TILE_BAKE, TILE_BLEED, TILE_CELLS, TILE_PX, TREE_FREE_R } from '../const';
import { tileOrigin } from '../grid';
import { makeCanvas } from '../paint';
import { type Clearing, type Flag, groveAt, hash } from '../scatter';
import {
  type Cells,
  CELL_PAD,
  type Land,
  WARP_REACH,
  cellsFor,
  heightGrid,
  landAt,
  shade,
  shadowMargin,
  warpFor,
  warpX,
  warpY,
  type Warp,
} from './field';
import { TW } from './palette';
import { GROVE_CELLS, GROVE_MAX, GROVE_VARIANTS, RIPPLE_PX, grove, ripplePattern } from './sprites';
import { TW_SPEC, type TwSpec, twQuality } from './spec';

// ---------- Что печётся ----------

/** Вид выпечки: уровень и сезон. Сменился — испечённое устарело целиком (`setTwLook`). */
interface TwLook {
  quality: Quality;
  /** 0 летом, 1 в разгар зимы. */
  season: number;
}

let look: TwLook = { quality: twQuality(), season: 0 };

/** Новый уровень или сезон. Вернёт true, если вид сменился, — тогда кэши тайлов и обзора сбрасывают. */
export function setTwLook(next: Partial<TwLook>): boolean {
  const merged = { ...look, ...next };
  if (merged.quality === look.quality && merged.season === look.season) return false;
  look = merged;
  return true;
}

export const twLook = (): Readonly<TwLook> => look;
const spec = (): TwSpec => TW_SPEC[look.quality];

// ---------- Земля из кэша ----------

const sample = (x: number, y: number) => cachedTerrain(x, y);
const has = (bits: number): Flag => (x, y) => (cachedFeatures(x, y) & bits) !== 0;
const LAND: Land = { sample, river: has(FEATURE.river), ridge: has(FEATURE.ridge) };
const isRiver = has(FEATURE.river);
const isRoad = has(FEATURE.road | FEATURE.track);
const isFord = has(FEATURE.ford);
const isBridge = has(FEATURE.bridge);

/** Все ли куски карты под областью приехали: печь по неполным данным — шов на границе знания. */
function ready(rect: Rect): boolean {
  for (const { key } of chunkKeysIn(rect)) if (!cachedChunk(key)) return false;
  return true;
}

function clearingsIn(rect: Rect): Clearing[] {
  const out: Clearing[] = [];
  for (const chunk of loadedIn(rect)) {
    for (const s of chunk.settlements) {
      if (s.x >= rect.x && s.y >= rect.y && s.x < rect.x + rect.w && s.y < rect.y + rect.h) out.push({ x: s.x, y: s.y, r: TREE_FREE_R });
    }
  }
  return out;
}

const inClearing = (px: number, py: number, list: Clearing[]): boolean =>
  list.some((c) => {
    const dx = px - (c.x + 0.5);
    const dy = py - (c.y + 0.5);
    return dx * dx + dy * dy < c.r * c.r;
  });

// ---------- Холсты ----------

function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Карта: 2D-контекст недоступен.');
  return ctx;
}

/** Черновики выпечки: печётся по тайлу за кадр, и один набор на все тайлы. */
let small: { land: HTMLCanvasElement; water: HTMLCanvasElement; n: number; landImg: ImageData; waterImg: ImageData } | null = null;
let full: { canvas: HTMLCanvasElement; img: ImageData; band: ImageData; water: HTMLCanvasElement } | null = null;

function smallOf(n: number): NonNullable<typeof small> {
  if (small && small.n === n) return small;
  const land = makeCanvas(n, n);
  const water = makeCanvas(n, n);
  small = { land, water, n, landImg: ctxOf(land).createImageData(n, n), waterImg: ctxOf(water).createImageData(n, n) };
  return small;
}

function fullOf(): NonNullable<typeof full> {
  if (full) return full;
  const canvas = makeCanvas(TILE_PX, TILE_PX);
  const water = makeCanvas(TILE_PX, TILE_PX);
  const ctx = ctxOf(canvas);
  full = { canvas, water, img: ctx.createImageData(TILE_PX, TILE_PX), band: ctx.createImageData(TILE_PX, TILE_PX) };
  return full;
}

// ---------- Область выпечки ----------

/**
 * Поле клеток, искривление и решётка над окном `win` в клетках: `x`, `y` — левый верхний угол окна,
 * `cells` — сторона, `nodes` — узлов на клетку. Узел окна (i, j) стоит в середине своего пикселя.
 */
interface Area {
  cells: Cells;
  warp: Warp;
  grid: ReturnType<typeof heightGrid>;
  n: number;
  ml: number;
}

function areaFor(seed: number, x: number, y: number, side: number, nodes: number, castShadow: boolean): Area {
  const stepC = 1 / nodes;
  const n = Math.round(side * nodes);
  const ml = (castShadow ? shadowMargin(nodes) : 0) + 1;
  const nx = n + ml + 1;
  const gx0 = x + 0.5 * stepC - ml * stepC;
  const gy0 = y + 0.5 * stepC - ml * stepC;
  const cx0 = Math.floor(gx0) - CELL_PAD;
  const cy0 = Math.floor(gy0) - CELL_PAD;
  const cw = Math.ceil(gx0 + nx * stepC) + CELL_PAD - cx0;
  const ch = Math.ceil(gy0 + nx * stepC) + CELL_PAD - cy0;
  const cells = cellsFor(seed, LAND, cx0, cy0, cw, ch, look.season);
  const warp = warpFor(seed, cx0, cy0, cw, ch);
  const grid = heightGrid(seed, cells, warp, gx0, gy0, nx, nx, stepC);
  return { cells, warp, grid, n, ml };
}

/** Область данных, нужных выпечке окна: решётка, тень, сплайн, искривление и размытия. */
function needFor(x: number, y: number, side: number, nodes: number): Rect {
  const reach = (shadowMargin(nodes) + 2) / nodes + CELL_PAD + WARP_REACH;
  return { x: Math.floor(x - reach), y: Math.floor(y - reach), w: Math.ceil(side + reach * 2) + 1, h: Math.ceil(side + reach * 2) + 1 };
}

// ---------- Линии: реки и дороги ----------

/**
 * Лента через середины клеток линии — гладкой кривой, а не ломаной: у каждой клетки свой кусок, от
 * середины связи с одной соседкой до середины связи с другой, изогнутый через саму клетку. Кусок
 * зависит только от клетки и её соседок, поэтому у двух тайлов он один и тот же — шва нет, и ступенек
 * растровой линии нет тоже. Середина клетки сдвинута обратным искривлением: река лежит в своей
 * долине, а не поперёк складок. Диагональ берётся, только если её не замыкают две прямые соседки —
 * иначе на повороте вышел бы треугольник.
 */
function linePath(ctx: CanvasRenderingContext2D, rect: Rect, on: Flag, wp: Warp, toPx: (x: number, y: number) => [number, number], mouth?: Flag): number {
  ctx.beginPath();
  let pieces = 0;
  const raw = (x: number, y: number): [number, number] => {
    const cx = x + 0.5;
    const cy = y + 0.5;
    return [cx - warpX(wp, cx, cy) * 0.85, cy - warpY(wp, cx, cy) * 0.85];
  };
  const links = (x: number, y: number): [number, number][] => {
    const out: [number, number][] = [];
    for (const [dx, dy] of ORTHO) if (on(x + dx, y + dy)) out.push([x + dx, y + dy]);
    for (const [dx, dy] of DIAG) if (on(x + dx, y + dy) && !on(x + dx, y) && !on(x, y + dy)) out.push([x + dx, y + dy]);
    return out;
  };
  // Сглаживание вдоль линии: середина клетки — среднее с соседками по линии на два шага в обе стороны
  // (веса 3-2-1). Концы и развилки стоят на месте, поэтому куски соседних клеток сходятся. Всё по-прежнему
  // местное: клетке нужны только клетки линии в двух шагах, и у двух тайлов ответ один.
  const memo = new Map<number, [number, number]>();
  const smooth = (x: number, y: number): [number, number] => {
    const key = x * 4096 + y;
    const have = memo.get(key);
    if (have) return have;
    const own = raw(x, y);
    const nb = links(x, y);
    let out = own;
    if (nb.length === 2) {
      let sx = own[0] * 3;
      let sy = own[1] * 3;
      let sw = 3;
      for (const first of nb) {
        let prev: [number, number] = [x, y];
        let cur = first;
        for (const w of [2, 1]) {
          const p = raw(cur[0], cur[1]);
          sx += p[0] * w;
          sy += p[1] * w;
          sw += w;
          const next = links(cur[0], cur[1]);
          if (next.length !== 2) break;
          const go = next[0][0] === prev[0] && next[0][1] === prev[1] ? next[1] : next[0];
          prev = cur;
          cur = go;
        }
      }
      out = [sx / sw, sy / sw];
    }
    memo.set(key, out);
    return out;
  };
  for (let y = rect.y - 1; y <= rect.y + rect.h; y++) {
    for (let x = rect.x - 1; x <= rect.x + rect.w; x++) {
      if (!on(x, y)) continue;
      const near = links(x, y).map(([bx, by]) => smooth(bx, by));
      // Устье: река, упёршаяся в воду, дотягивается до неё, а не обрывается посреди луга.
      if (mouth && near.length < 2) {
        for (const [dx, dy] of ORTHO) {
          if (mouth(x + dx, y + dy)) {
            near.push(raw(x + dx, y + dy));
            break;
          }
        }
      }
      const a = toPx(...smooth(x, y));
      const mids = near.map((b): [number, number] => {
        const pb = toPx(b[0], b[1]);
        return [(a[0] + pb[0]) / 2, (a[1] + pb[1]) / 2];
      });
      if (mids.length === 2) {
        ctx.moveTo(mids[0][0], mids[0][1]);
        ctx.quadraticCurveTo(a[0], a[1], mids[1][0], mids[1][1]);
      } else if (mids.length === 0) {
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(a[0] + 0.01, a[1]);
      } else {
        for (const m of mids) {
          ctx.moveTo(a[0], a[1]);
          ctx.lineTo(m[0], m[1]);
        }
      }
      pieces++;
    }
  }
  return pieces;
}

const ORTHO: readonly [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const DIAG: readonly [number, number][] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

function strokeRiver(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = TW.riverBank;
  ctx.lineWidth = 0.4 * px;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = TW.river;
  ctx.lineWidth = 0.19 * px;
  ctx.stroke();
  ctx.strokeStyle = TW.riverDeep;
  ctx.lineWidth = 0.08 * px;
  ctx.stroke();
}

function strokeRoad(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = TW.roadEdge;
  ctx.lineWidth = 0.22 * px;
  ctx.stroke();
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = TW.road;
  ctx.lineWidth = 0.14 * px;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Брод — светлые камни поперёк, мост — настил. Метки в середине клетки, как и у прежней карты. */
function drawCrossings(ctx: CanvasRenderingContext2D, rect: Rect, wp: Warp, toPx: (x: number, y: number) => [number, number], px: number): void {
  for (let y = rect.y - 1; y <= rect.y + rect.h; y++) {
    for (let x = rect.x - 1; x <= rect.x + rect.w; x++) {
      const ford = isFord(x, y);
      const bridge = isBridge(x, y);
      if (!ford && !bridge) continue;
      const cx = x + 0.5;
      const cy = y + 0.5;
      const [sx, sy] = toPx(cx - warpX(wp, cx, cy) * 0.85, cy - warpY(wp, cx, cy) * 0.85);
      if (bridge) {
        ctx.fillStyle = TW.roadEdge;
        ctx.fillRect(sx - 0.2 * px, sy - 0.1 * px, 0.4 * px, 0.2 * px);
        ctx.fillStyle = TW.bridge;
        ctx.fillRect(sx - 0.18 * px, sy - 0.07 * px, 0.36 * px, 0.14 * px);
        continue;
      }
      ctx.fillStyle = TW.ford;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.arc(sx + i * 0.07 * px, sy + (i % 2) * 0.03 * px, 0.035 * px, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// ---------- Лес ----------

function drawGroves(
  ctx: CanvasRenderingContext2D,
  seed: number,
  area: Area,
  rect: Rect,
  toPx: (x: number, y: number) => [number, number],
  px: number,
  clearings: Clearing[],
): number {
  const { cells, warp } = area;
  const per = spec().groves;
  const items: { x: number; y: number; c: HTMLCanvasElement }[] = [];
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      for (let i = 0; i < per; i++) {
        const salt = 15013 + i * 17;
        const gx = x + hash(seed, x, y, salt);
        const gy = y + hash(seed, x, y, salt + 1);
        const qx = gx + warpX(warp, gx, gy);
        const qy = gy + warpY(warp, gx, gy);
        const ci = Math.floor(qx) - cells.x0;
        const cj = Math.floor(qy) - cells.y0;
        if (ci < 0 || cj < 0 || ci >= cells.w || cj >= cells.h) continue;
        const k = cj * cells.w + ci;
        const code = cells.code[k];
        // Плотность: лес — из размытой доли леса, вне леса — редкие деревья по классу.
        const sparse = code === 1 ? 0.06 : code === 3 ? 0.14 : code === 6 ? 0.06 : code === 4 ? 0.02 : 0;
        const dens = Math.max(cells.forest[k], sparse);
        if (dens <= 0.01) continue;
        const g = groveAt(seed, gx, gy);
        if (dens > 0.3 && g < GLADE_BELOW) continue;
        const thick = dens * (0.42 + 1.15 * g);
        if (hash(seed, x, y, salt + 2) >= thick) continue;
        // Не в воде, не у самого уреза, не в русле, не во дворе и не выше линии леса.
        if (landAt(cells, qx, qy) < 0.62) continue;
        if (isRiver(Math.floor(gx), Math.floor(gy)) || isRoad(Math.floor(gx), Math.floor(gy))) continue;
        if (inClearing(gx, gy, clearings)) continue;
        if (cells.height[k] > cells.snow[k] - 0.1) continue;
        // Порода — свойство места: север и горы хвойные, юг лиственный, между ними пояс.
        const conifer = hash(seed, x, y, salt + 3) < Math.min(1, Math.max(0, cells.north[k] * 1.3 - 0.3 + cells.rock[k] * 0.9));
        const count = dens > 0.55 ? 3 + Math.floor(hash(seed, x, y, salt + 4) * (GROVE_MAX - 2)) : 1 + Math.floor(hash(seed, x, y, salt + 4) * 2);
        const variant = Math.floor(hash(seed, x, y, salt + 5) * GROVE_VARIANTS);
        items.push({ x: gx, y: gy, c: grove(Math.min(GROVE_MAX, count), variant, conifer) });
      }
    }
  }
  items.sort((a, b) => a.y - b.y);
  const w = GROVE_CELLS * px;
  for (const it of items) {
    const [sx, sy] = toPx(it.x, it.y);
    ctx.drawImage(it.c, sx - w / 2, sy - w / 2, w, w);
  }
  return items.length;
}

// ---------- Берег: маска воды и полосы прибоя ----------

/** Радиус суши под поселением, в клетках: двор с запасом, но не дальше своей клетки и соседей. */
const HOME_LAND = 0.85;

/**
 * Маска воды и полосы у уреза по пикселю выпечки — только там, где решётка видит берег: внутри
 * клетки решётки целиком на суше или целиком в воде считать нечего.
 *
 * Суша — `landAt` по искривлённым координатам узлов (одна мерка на тайл, обзор и деревья). Между
 * узлами — билинейно, порог — половина. Полосы: светлый песок на суше у самого уреза, пена по воде.
 */
function shoreMasks(area: Area, img: ImageData, band: ImageData, homes: Clearing[]): { water: boolean; land: boolean } {
  const { grid, n, ml } = area;
  const L = new Float32Array(n * n);
  let anyW = false;
  let anyL = false;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (ml + j) * grid.nx + (ml + i);
      let v = landAt(area.cells, grid.qx[k], grid.qy[k]);
      // Под поселением всегда суша: клетка двора — суша в данных, а искривлённый берег мог бы зайти в
      // неё на полклетки, и город встал бы на воду. Поселения не переезжают — перевыпечки от этого нет.
      if (v < 0.75 && homes.length) {
        const wx = grid.x0 + (ml + i) * grid.step;
        const wy = grid.y0 + (ml + j) * grid.step;
        for (const h of homes) {
          const d = Math.hypot(wx - (h.x + 0.5), wy - (h.y + 0.5));
          if (d < HOME_LAND * 0.6) v = Math.max(v, 0.75);
          else if (d < HOME_LAND) v = Math.max(v, 0.5 + 0.25 * (1 - (d - HOME_LAND * 0.6) / (HOME_LAND * 0.4)));
        }
      }
      L[j * n + i] = v;
      if (v < 0.5) anyW = true;
      else anyL = true;
    }
  }
  if (!anyW) return { water: false, land: true };
  const m = img.data;
  const bd = band.data;
  const m32 = new Uint32Array(m.buffer, m.byteOffset, TILE_PX * TILE_PX);
  const b32 = new Uint32Array(bd.buffer, bd.byteOffset, TILE_PX * TILE_PX);
  b32.fill(0);
  // Вода маски — непрозрачный чёрный: важна только альфа (`destination-in`).
  const WATER = new Uint32Array(new Uint8ClampedArray([0, 0, 0, 255]).buffer)[0];
  const s = TILE_PX / n;
  const from = (j: number): number => (j === 0 ? 0 : Math.ceil((j + 0.5) * s - 0.5));
  const to = (j: number): number => (j === n - 2 ? TILE_PX : Math.ceil((j + 1.5) * s - 0.5));
  const [fr, fg, fb] = [216, 226, 214];
  const [sr, sg, sb] = [200, 184, 140];
  // Клетка решётки целиком на суше или целиком в воде — заливка строк; берег — по пикселю.
  for (let j = 0; j < n - 1; j++) {
    const y0 = from(j);
    const y1 = to(j);
    for (let i = 0; i < n - 1; i++) {
      const x0 = from(i);
      const x1 = to(i);
      const k = j * n + i;
      const a = L[k];
      const b = L[k + 1];
      const c = L[k + n];
      const d = L[k + n + 1];
      const lo = Math.min(a, b, c, d);
      const hi = Math.max(a, b, c, d);
      if (lo > 0.64 || hi < 0.3) {
        const v = lo > 0.64 ? 0 : WATER;
        for (let py = y0; py < y1; py++) m32.fill(v, py * TILE_PX + x0, py * TILE_PX + x1);
        continue;
      }
      for (let py = y0; py < y1; py++) {
        const ty = Math.min(1, Math.max(0, (py + 0.5) / s - 0.5 - j));
        const l0 = a + (c - a) * ty;
        const l1 = b + (d - b) * ty;
        for (let px = x0; px < x1; px++) {
          const tx = Math.min(1, Math.max(0, (px + 0.5) / s - 0.5 - i));
          const l = l0 + (l1 - l0) * tx;
          const p = (py * TILE_PX + px) * 4;
          // Вода: резкий край в полтора пикселя.
          m[p + 3] = l < 0.47 ? 255 : l > 0.53 ? 0 : ((0.53 - l) / 0.06) * 255;
          // Песок по суше у уреза и пена по воде — обе полосы сходят на нет от линии.
          if (l >= 0.5) {
            const t = 1 - (l - 0.5) / 0.12;
            if (t > 0) {
              bd[p] = sr;
              bd[p + 1] = sg;
              bd[p + 2] = sb;
              bd[p + 3] = t * t * 150;
            }
          } else {
            const t = 1 - (0.5 - l) / 0.17;
            if (t > 0) {
              bd[p] = fr;
              bd[p + 1] = fg;
              bd[p + 2] = fb;
              bd[p + 3] = t * t * 190;
            }
          }
        }
      }
    }
  }
  return { water: true, land: anyL };
}

// ---------- Тайл ----------

/** Весь ли тайл с запасом данных — открытое море: тогда печётся заливкой и рябью. */
function openSea(rect: Rect): boolean {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const t = sample(x, y);
      if (t !== null && t !== 'water') return false;
    }
  }
  return true;
}

function paintRipples(ctx: CanvasRenderingContext2D, ox: number, oy: number, alpha: number): void {
  if (!spec().ripples) return;
  const pat = ctx.createPattern(ripplePattern(), 'repeat');
  if (!pat) return;
  // Узор привязан к миру, а не к тайлу: у соседей он продолжается, а не начинается заново.
  const shift = (v: number): number => -(((v * TILE_BAKE) % RIPPLE_PX) + RIPPLE_PX) % RIPPLE_PX;
  pat.setTransform(new DOMMatrix([1, 0, 0, 1, shift(ox), shift(oy)]));
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, TILE_PX, TILE_PX);
  ctx.globalAlpha = 1;
}

/** Последняя выпечка по частям — стенду (`?showcase=map-tw`): что сколько стоит. */
export const bakeStats = { cells: 0, light: 0, shore: 0, lines: 0, trees: 0, groves: 0 };

/**
 * Тайл нового вида или null, если кусков карты под ним ещё нет. `take` даёт холст тайла (из пула
 * прежней выпечки), и зовут его только тогда, когда печь уже точно будут.
 */
export function bakeTile(seed: number, tx: number, ty: number, take: () => HTMLCanvasElement): HTMLCanvasElement | null {
  const o = tileOrigin(tx, ty);
  const sp = spec();
  const side = TILE_CELLS + TILE_BLEED * 2;
  const x = o.x - TILE_BLEED;
  const y = o.y - TILE_BLEED;
  const need = needFor(x, y, side, sp.nodes);
  if (!ready(need)) return null;

  const canvas = take();
  const ctx = ctxOf(canvas);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.imageSmoothingEnabled = true;
  const toPx = (wx: number, wy: number): [number, number] => [(wx - x) * TILE_BAKE, (wy - y) * TILE_BAKE];

  // Открытое море: до земли дальше, чем дотягивается любое поле, — тон глубины и рябь, ничего больше.
  // Шва с прибрежным соседом нет: у того на этой кромке глубина та же (`shade`, «пятнистость гаснет в
  // глубине»).
  const inner: Rect = { x: Math.floor(need.x), y: Math.floor(need.y), w: need.w, h: need.h };
  if (openSea(inner)) {
    ctx.fillStyle = TW.deep;
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
    paintRipples(ctx, x, y, 0.45);
    return canvas;
  }

  const t0 = performance.now();
  const area = areaFor(seed, x, y, side, sp.nodes, sp.castShadow);
  const t1 = performance.now();
  const sm = smallOf(area.n);
  shade(seed, area.cells, area.grid, { i0: area.ml, j0: area.ml, w: area.n, h: area.n }, { season: look.season, castShadow: sp.castShadow }, sm.landImg.data, sm.waterImg.data);
  ctxOf(sm.land).putImageData(sm.landImg, 0, 0);
  ctx.drawImage(sm.land, 0, 0, TILE_PX, TILE_PX);
  const t2 = performance.now();

  // Реки и дороги лежат на земле и уходят под море.
  const tileRect: Rect = { x: Math.floor(x), y: Math.floor(y), w: Math.ceil(side) + 1, h: Math.ceil(side) + 1 };
  const water: Flag = (cx, cy) => {
    const t = sample(cx, cy);
    return t === null || t === 'water';
  };
  if (linePath(ctx, tileRect, isRiver, area.warp, toPx, water) > 0) strokeRiver(ctx, TILE_BAKE);
  if (linePath(ctx, tileRect, isRoad, area.warp, toPx) > 0) strokeRoad(ctx, TILE_BAKE);
  const t3 = performance.now();

  // Море: цвет по глубине растянут на тайл и вырезан маской берега; поверх — рябь и полосы у уреза.
  const fu = fullOf();
  const homes = clearingsIn({ x: Math.floor(x) - 1, y: Math.floor(y) - 1, w: Math.ceil(side) + 3, h: Math.ceil(side) + 3 });
  const shore = shoreMasks(area, fu.img, fu.band, homes);
  if (shore.water) {
    ctxOf(sm.water).putImageData(sm.waterImg, 0, 0);
    const wc = ctxOf(fu.water);
    wc.globalCompositeOperation = 'source-over';
    wc.clearRect(0, 0, TILE_PX, TILE_PX);
    wc.imageSmoothingEnabled = true;
    wc.drawImage(sm.water, 0, 0, TILE_PX, TILE_PX);
    paintRipples(wc, x, y, 0.45);
    ctxOf(fu.canvas).putImageData(fu.img, 0, 0);
    wc.globalCompositeOperation = 'destination-in';
    wc.drawImage(fu.canvas, 0, 0);
    wc.globalCompositeOperation = 'source-over';
    ctx.drawImage(fu.water, 0, 0);
    ctxOf(fu.canvas).putImageData(fu.band, 0, 0);
    ctx.drawImage(fu.canvas, 0, 0);
  }
  drawCrossings(ctx, tileRect, area.warp, toPx, TILE_BAKE);
  const t4 = performance.now();

  // Лес: купы с запасом в клетку — крона соседа заходит внутрь, и по кромке не идёт срез.
  const treeRect: Rect = { x: o.x - 1, y: o.y - 1, w: TILE_CELLS + 2, h: TILE_CELLS + 2 };
  const groves = shore.land ? drawGroves(ctx, seed, area, treeRect, toPx, TILE_BAKE, clearingsIn(treeRect)) : 0;
  const t5 = performance.now();
  bakeStats.cells = t1 - t0;
  bakeStats.light = t2 - t1;
  bakeStats.lines = t3 - t2;
  bakeStats.shore = t4 - t3;
  bakeStats.trees = t5 - t4;
  bakeStats.groves = groves;
  return canvas;
}

// ---------- Обзор ----------

/** Песок у уреза на обзоре. */
const SAND = [200, 184, 140] as const;

/** Последняя выпечка куска обзора по частям — стенду. */
export const chunkStats = { area: 0, light: 0, mix: 0 };

/** Пикселей на клетку куска обзора. */
export const OVERVIEW_PX = 4;
/**
 * Вылет куска обзора за свой край, в пикселях: растянутый со сглаживанием холст берёт у края пиксель
 * соседа, и без вылета по стыкам кусков шли бы нитки (видно на первом же снимке дальнего вида).
 * Кадр рисует кусок без вылета — `tiles.overviewSrc`.
 */
export const OVERVIEW_BLEED = 2;

/**
 * Кусок обзора: тот же свет, цвет, снег и берег, что у тайла, но решёткой в узел на пиксель и без
 * крон — лес читается тёмной массой с крапом. Null — соседи куска ещё не приехали: испеки его без
 * них, и по краю куска встанет шов, когда они приедут.
 */
/** Какие клетки нужны куску обзора: он сам и округа под свет, тень, сплайн и размытия. */
export function chunkNeed(chunk: CachedChunk): Rect {
  const bleed = OVERVIEW_BLEED / OVERVIEW_PX;
  const need = needFor(chunk.rect.x - bleed, chunk.rect.y - bleed, chunk.rect.w + bleed * 2, OVERVIEW_PX);
  return {
    x: Math.max(WORLD_ORIGIN.x, need.x),
    y: Math.max(WORLD_ORIGIN.y, need.y),
    w: Math.min(WORLD_ORIGIN.x + WORLD_SIZE, need.x + need.w) - Math.max(WORLD_ORIGIN.x, need.x),
    h: Math.min(WORLD_ORIGIN.y + WORLD_SIZE, need.y + need.h) - Math.max(WORLD_ORIGIN.y, need.y),
  };
}

export const chunkReady = (chunk: CachedChunk): boolean => ready(chunkNeed(chunk));

export function bakeChunk(seed: number, chunk: CachedChunk): HTMLCanvasElement | null {
  const nodes = OVERVIEW_PX;
  const sp = spec();
  const bleed = OVERVIEW_BLEED / nodes;
  const x = chunk.rect.x - bleed;
  const y = chunk.rect.y - bleed;
  const w = chunk.rect.w + bleed * 2;
  if (!chunkReady(chunk)) return null;
  const c0 = performance.now();
  const area = areaFor(seed, x, y, w, nodes, sp.castShadow);
  const c1 = performance.now();
  const n = area.n;
  const landPx = new Uint8ClampedArray(n * n * 4);
  const waterPx = new Uint8ClampedArray(n * n * 4);
  shade(seed, area.cells, area.grid, { i0: area.ml, j0: area.ml, w: n, h: n }, { season: look.season, castShadow: sp.castShadow }, landPx, waterPx);
  const c2 = performance.now();
  const canvas = makeCanvas(n, n);
  const ctx = ctxOf(canvas);
  const img = ctx.createImageData(n, n);
  const out = img.data;
  const { grid, ml, cells } = area;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = (ml + j) * grid.nx + (ml + i);
      const l = landAt(cells, grid.qx[k], grid.qy[k]);
      const p = (j * n + i) * 4;
      // Лес издали — масса с крапом: крона в пиксель уже не видна, а пятнистость видна.
      const ci = Math.floor(grid.qx[k]) - cells.x0;
      const cj = Math.floor(grid.qy[k]) - cells.y0;
      const fw = cells.forest[cj * cells.w + ci] ?? 0;
      const speck = fw > 0.2 ? 0.86 + 0.24 * hash(seed, x * nodes + i, y * nodes + j, 16001) * fw : 1;
      const wa = l < 0.42 ? 1 : l > 0.58 ? 0 : (0.58 - l) / 0.16;
      const beach = l >= 0.5 && l < 0.62 ? (1 - (l - 0.5) / 0.12) * 0.5 : 0;
      for (let c = 0; c < 3; c++) {
        let v = landPx[p + c] * speck;
        v = v + (SAND[c] - v) * beach;
        out[p + c] = v + (waterPx[p + c] - v) * wa;
      }
      out[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const c3 = performance.now();
  chunkStats.area = c1 - c0;
  chunkStats.light = c2 - c1;
  chunkStats.mix = c3 - c2;
  const toPx = (wx: number, wy: number): [number, number] => [(wx - x) * nodes, (wy - y) * nodes];
  const water: Flag = (cx, cy) => {
    const t = sample(cx, cy);
    return t === null || t === 'water';
  };
  if (linePath(ctx, chunk.rect, isRiver, area.warp, toPx, water) > 0) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = TW.river;
    ctx.lineWidth = 0.32 * nodes;
    ctx.stroke();
  }
  return canvas;
}
