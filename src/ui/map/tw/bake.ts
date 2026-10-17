// Выпечка нового вида (docs/map_tw.md, разделы 4 и 13.4): тайл ближнего масштаба, кусок обзора и тайл
// среднего масштаба.
//
// Выпечка — **шагами** (`Steps`, генераторы): рабочий поток прогоняет шаги подряд (`drain`), а страница без потока
// — по нескольку за кадр, пока камера стоит (`prebake.ts`), и ни один шаг не длиннее полосы в дюжину строк
// решётки. Картинка от этого не меняется: шаги — те же циклы, разрезанные по строкам, а узел решётки зависит
// только от своей точки.
//
// Земля — из `land.ts` (кэш мира у стенда, снимок региона массивами у игры и потока), холсты — из `canvas.ts`
// (`<canvas>` в странице, `OffscreenCanvas` в потоке). Мира, кэша и документа модуль не знает: он едет в поток.
import type { Rect } from '@/world/types';
import { WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import type { Quality } from '@/render/quality';
import { GLADE_BELOW, TILE_BAKE, TILE_BLEED, TILE_CELLS, TILE_PX, TREE_FREE_R } from '../const';
import { tileOrigin } from '../grid';
import { type Clearing, type Flag, groveAt, hash } from '../scatter';
import {
  type Cells,
  CELL_PAD,
  type Grid,
  type Land,
  WARP_REACH,
  cellsFor,
  emptyGrid,
  foldsFor,
  heightRows,
  landAt,
  shade,
  shadowMargin,
  warpFor,
  warpX,
  warpY,
  type Warp,
} from './field';
import { type Canvas, type Ctx, ctxOf, makeCanvas } from './canvas';
import { land } from './land';
import { TW } from './palette';
import { GROVE_CELLS, GROVE_MAX, GROVE_VARIANTS, grove, paintRippleArcs } from './sprites';
import { TW_SPEC, type TwSpec } from './spec';

// ---------- Шаги ----------

/** Выпечка шагами: между шагами её можно отложить до следующего кадра. */
export type Steps<T> = Generator<void, T, void>;

/** Пройти шаги подряд — так печёт рабочий поток и стенд. */
export function drain<T>(steps: Steps<T>): T {
  for (;;) {
    const r = steps.next();
    if (r.done) return r.value;
  }
}

/** Строк решётки на шаг: полоса в дюжину строк — около миллисекунды на ПК и нескольких на телефоне. */
const ROWS = 12;
/** Куп на шаг рисования леса. */
const GROVE_BATCH = 64;

// ---------- Что печётся ----------

/** Вид выпечки: уровень и сезон. Сменился — испечённое устарело целиком (`setTwLook`). */
export interface TwLook {
  quality: Quality;
  /** 0 летом, 1 в разгар зимы. */
  season: number;
}

let look: TwLook = { quality: 'medium', season: 0 };

/** Новый уровень или сезон. Вернёт true, если вид сменился, — тогда испечённое под прежний сбрасывают. */
export function setTwLook(next: Partial<TwLook>): boolean {
  const merged = { ...look, ...next };
  if (merged.quality === look.quality && merged.season === look.season) return false;
  look = merged;
  return true;
}

export const twLook = (): Readonly<TwLook> => look;
const spec = (): TwSpec => TW_SPEC[look.quality];

// ---------- Земля ----------

const LAND: Land = {
  sample: (x, y) => land().sample(x, y),
  river: (x, y) => land().river(x, y),
  ridge: (x, y) => land().ridge(x, y),
};
const isRiver: Flag = (x, y) => land().river(x, y);
const isRoad: Flag = (x, y) => land().road(x, y);
const water: Flag = (x, y) => {
  const t = land().sample(x, y);
  return t === null || t === 'water';
};

const clearingsIn = (rect: Rect): Clearing[] => land().homes(rect).map((h) => ({ x: h.x, y: h.y, r: TREE_FREE_R }));

const inClearing = (px: number, py: number, list: Clearing[]): boolean =>
  list.some((c) => {
    const dx = px - (c.x + 0.5);
    const dy = py - (c.y + 0.5);
    return dx * dx + dy * dy < c.r * c.r;
  });

// ---------- Черновики ----------

/** Черновики выпечки тайла: один набор на все тайлы — и в странице, и в потоке. */
let small: { land: Canvas; water: Canvas; n: number; landImg: ImageData; waterImg: ImageData } | null = null;
let full: { canvas: Canvas; img: ImageData; band: ImageData; water: Canvas } | null = null;

function smallOf(n: number): NonNullable<typeof small> {
  if (small && small.n === n) return small;
  const landC = makeCanvas(n, n);
  const waterC = makeCanvas(n, n);
  small = { land: landC, water: waterC, n, landImg: ctxOf(landC).createImageData(n, n), waterImg: ctxOf(waterC).createImageData(n, n) };
  return small;
}

function fullOf(): NonNullable<typeof full> {
  if (full) return full;
  const canvas = makeCanvas(TILE_PX, TILE_PX);
  const waterC = makeCanvas(TILE_PX, TILE_PX);
  const ctx = ctxOf(canvas);
  full = { canvas, water: waterC, img: ctx.createImageData(TILE_PX, TILE_PX), band: ctx.createImageData(TILE_PX, TILE_PX) };
  return full;
}

// ---------- Область выпечки ----------

/**
 * Поле клеток, искривление и решётка над окном в клетках: `x`, `y` — левый верхний угол окна, `side` — сторона,
 * `nodes` — узлов на клетку. Узел окна (i, j) стоит в середине своего пикселя.
 */
interface Area {
  cells: Cells;
  warp: Warp;
  grid: Grid;
  n: number;
  ml: number;
}

function* areaSteps(seed: number, x: number, y: number, side: number, nodes: number, castShadow: boolean): Steps<Area> {
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
  yield;
  const warp = warpFor(seed, cx0, cy0, cw, ch);
  const grid = emptyGrid(gx0, gy0, nx, nx, stepC);
  const folds = foldsFor(seed, gx0, gy0, nx * stepC);
  yield;
  for (let j = 0; j < nx; j += ROWS) {
    heightRows(cells, warp, folds, grid, j, Math.min(nx, j + ROWS));
    yield;
  }
  return { cells, warp, grid, n, ml };
}

/** Свет и цвет окна решётки — полосами строк в два RGBA (суша и вода). */
function* shadeSteps(seed: number, area: Area, landOut: Uint8ClampedArray, waterOut: Uint8ClampedArray): Steps<void> {
  const { cells, grid, n, ml } = area;
  const sl = { season: look.season, castShadow: spec().castShadow };
  for (let j = 0; j < n; j += ROWS) {
    const h = Math.min(ROWS, n - j);
    shade(seed, cells, grid, { i0: ml, j0: ml + j, w: n, h }, sl, landOut.subarray(j * n * 4), waterOut.subarray(j * n * 4));
    yield;
  }
}

/** Область данных, нужных выпечке окна: решётка, тень, сплайн, искривление и размытия. */
function needFor(x: number, y: number, side: number, nodes: number): Rect {
  const reach = (shadowMargin(nodes) + 2) / nodes + CELL_PAD + WARP_REACH;
  return { x: Math.floor(x - reach), y: Math.floor(y - reach), w: Math.ceil(side + reach * 2) + 1, h: Math.ceil(side + reach * 2) + 1 };
}

/** Окно данных по миру: за краем мира — открытое море, и данных там не ждут. */
function inWorld(need: Rect): Rect {
  return {
    x: Math.max(WORLD_ORIGIN.x, need.x),
    y: Math.max(WORLD_ORIGIN.y, need.y),
    w: Math.min(WORLD_ORIGIN.x + WORLD_SIZE, need.x + need.w) - Math.max(WORLD_ORIGIN.x, need.x),
    h: Math.min(WORLD_ORIGIN.y + WORLD_SIZE, need.y + need.h) - Math.max(WORLD_ORIGIN.y, need.y),
  };
}

/** Самый дальний запас данных вокруг окна выпечки, в клетках (у самой густой решётки): так широко снимает землю регион. */
export const BAKE_REACH = Math.ceil((shadowMargin(16) + 2) / 16 + CELL_PAD + WARP_REACH) + 2;

// ---------- Линии: реки и дороги ----------

/**
 * Лента через середины клеток линии — гладкой кривой, а не ломаной: у каждой клетки свой кусок, от
 * середины связи с одной соседкой до середины связи с другой, изогнутый через саму клетку. Кусок
 * зависит только от клетки и её соседок, поэтому у двух тайлов он один и тот же — шва нет, и ступенек
 * растровой линии нет тоже. Середина клетки сдвинута обратным искривлением: река лежит в своей
 * долине, а не поперёк складок. Диагональ берётся, только если её не замыкают две прямые соседки —
 * иначе на повороте вышел бы треугольник.
 */
function linePath(ctx: Ctx, rect: Rect, on: Flag, wp: Warp, toPx: (x: number, y: number) => [number, number], mouth?: Flag): number {
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

function strokeRiver(ctx: Ctx, px: number): void {
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

function strokeRoad(ctx: Ctx, px: number): void {
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
function drawCrossings(ctx: Ctx, rect: Rect, wp: Warp, toPx: (x: number, y: number) => [number, number], px: number): void {
  const L = land();
  for (let y = rect.y - 1; y <= rect.y + rect.h; y++) {
    for (let x = rect.x - 1; x <= rect.x + rect.w; x++) {
      const ford = L.ford(x, y);
      const bridge = L.bridge(x, y);
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

/** Купы леса над прямоугольником: сначала где и какие (счёт), потом — копирование спрайтов частями. */
function* groveSteps(
  ctx: Ctx,
  seed: number,
  area: Area,
  rect: Rect,
  toPx: (x: number, y: number) => [number, number],
  px: number,
  clearings: Clearing[],
  per = spec().groves,
): Steps<number> {
  const { cells, warp } = area;
  const items: { x: number; y: number; c: Canvas }[] = [];
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
  yield;
  const w = GROVE_CELLS * px;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const [sx, sy] = toPx(it.x, it.y);
    ctx.drawImage(it.c, sx - w / 2, sy - w / 2, w, w);
    if (i % GROVE_BATCH === GROVE_BATCH - 1) yield;
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
function* shoreSteps(area: Area, img: ImageData, band: ImageData, homes: Clearing[]): Steps<{ water: boolean; land: boolean }> {
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
    if (j % ROWS === ROWS - 1) yield;
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
    if (j % ROWS === ROWS - 1) yield;
  }
  return { water: true, land: anyL };
}

// ---------- Тайл ----------

/** Весь ли тайл с запасом данных — открытое море: тогда печётся заливкой и рябью. */
function openSea(rect: Rect): boolean {
  const L = land();
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const t = L.sample(x, y);
      if (t !== null && t !== 'water') return false;
    }
  }
  return true;
}

function paintRipples(ctx: Ctx, ox: number, oy: number, alpha: number): void {
  if (!spec().ripples) return;
  // Рябь привязана к миру клетками (`sprites.rippleArcs`): у соседей она продолжается, нигде не повторяется.
  ctx.globalAlpha = alpha;
  paintRippleArcs(ctx, ox * TILE_BAKE, oy * TILE_BAKE, TILE_PX);
  ctx.globalAlpha = 1;
}

/** Последняя выпечка по частям — стенду (`?showcase=map-tw`): что сколько стоит. */
export const bakeStats = { cells: 0, light: 0, shore: 0, lines: 0, trees: 0, groves: 0 };

/** Окно данных тайла ближнего масштаба. */
export function tileNeed(tx: number, ty: number): Rect {
  const o = tileOrigin(tx, ty);
  return needFor(o.x - TILE_BLEED, o.y - TILE_BLEED, TILE_CELLS + TILE_BLEED * 2, spec().nodes);
}

/**
 * Тайл нового вида шагами; null — земли под ним нет. `take` даёт холст тайла, и зовут его только тогда, когда
 * печь уже точно будут.
 */
export function* tileSteps(seed: number, tx: number, ty: number, take: () => Canvas): Steps<Canvas | null> {
  const o = tileOrigin(tx, ty);
  const sp = spec();
  const side = TILE_CELLS + TILE_BLEED * 2;
  const x = o.x - TILE_BLEED;
  const y = o.y - TILE_BLEED;
  const need = needFor(x, y, side, sp.nodes);
  if (!land().ready(need)) return null;

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
  if (openSea(need)) {
    ctx.fillStyle = TW.deep;
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
    paintRipples(ctx, x, y, 0.45);
    return canvas;
  }

  let t = performance.now();
  const lap = (): number => {
    const now = performance.now();
    const d = now - t;
    t = now;
    return d;
  };
  const area = yield* areaSteps(seed, x, y, side, sp.nodes, sp.castShadow);
  bakeStats.cells = lap();
  const sm = smallOf(area.n);
  yield* shadeSteps(seed, area, sm.landImg.data, sm.waterImg.data);
  ctxOf(sm.land).putImageData(sm.landImg, 0, 0);
  ctx.drawImage(sm.land, 0, 0, TILE_PX, TILE_PX);
  bakeStats.light = lap();
  yield;

  // Реки и дороги лежат на земле и уходят под море.
  const tileRect: Rect = { x: Math.floor(x), y: Math.floor(y), w: Math.ceil(side) + 1, h: Math.ceil(side) + 1 };
  if (linePath(ctx, tileRect, isRiver, area.warp, toPx, water) > 0) strokeRiver(ctx, TILE_BAKE);
  if (linePath(ctx, tileRect, isRoad, area.warp, toPx) > 0) strokeRoad(ctx, TILE_BAKE);
  bakeStats.lines = lap();
  yield;

  // Море: цвет по глубине растянут на тайл и вырезан маской берега; поверх — рябь и полосы у уреза.
  const fu = fullOf();
  const homes = clearingsIn({ x: Math.floor(x) - 1, y: Math.floor(y) - 1, w: Math.ceil(side) + 3, h: Math.ceil(side) + 3 });
  const shore = yield* shoreSteps(area, fu.img, fu.band, homes);
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
  bakeStats.shore = lap();
  yield;

  // Лес: купы с запасом в клетку — крона соседа заходит внутрь, и по кромке не идёт срез.
  const treeRect: Rect = { x: o.x - 1, y: o.y - 1, w: TILE_CELLS + 2, h: TILE_CELLS + 2 };
  const groves = shore.land ? yield* groveSteps(ctx, seed, area, treeRect, toPx, TILE_BAKE, clearingsIn(treeRect)) : 0;
  bakeStats.trees = lap();
  bakeStats.groves = groves;
  return canvas;
}

/** Тайл целиком, разом: стенд и проверки. */
export const bakeTile = (seed: number, tx: number, ty: number, take: () => Canvas): Canvas | null => drain(tileSteps(seed, tx, ty, take));

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
 * Кадр рисует кусок без вылета.
 */
export const OVERVIEW_BLEED = 2;

/** Какие клетки нужны куску обзора: он сам и округа под свет, тень, сплайн и размытия. */
export function chunkNeed(rect: Rect): Rect {
  const bleed = OVERVIEW_BLEED / OVERVIEW_PX;
  return inWorld(needFor(rect.x - bleed, rect.y - bleed, rect.w + bleed * 2, OVERVIEW_PX));
}

/**
 * Кусок обзора шагами: тот же свет, цвет, снег и берег, что у тайла, но решёткой в узел на пиксель и без крон —
 * лес читается тёмной массой с крапом. Null — земли под округой куска нет: испеки его без неё, и по краю куска
 * встанет шов, когда она приедет.
 */
export function* chunkSteps(seed: number, rect: Rect): Steps<Canvas | null> {
  if (!land().ready(chunkNeed(rect))) return null;
  const bleed = OVERVIEW_BLEED / OVERVIEW_PX;
  return yield* pictureSteps(seed, rect.x - bleed, rect.y - bleed, rect.w + bleed * 2, OVERVIEW_PX, rect, false);
}

/** Кусок обзора целиком, разом: стенд. */
export const bakeChunk = (seed: number, chunk: { rect: Rect }): Canvas | null => drain(chunkSteps(seed, chunk.rect));

/**
 * Картина участка решёткой в узел на пиксель: тот же свет, цвет, снег и берег, что у тайла, лес — тёмной
 * массой с крапом, реки — линией поверх. Кусок обзора и тайл среднего масштаба печётся ею обоими; `x`, `y`,
 * `side` — окно с вылетом, `rivers` — клетки, чьи реки рисовать, `ribbon` — река лентой с берегом (средний
 * масштаб) или одной линией (обзор).
 */
function* pictureSteps(seed: number, x: number, y: number, side: number, nodes: number, rivers: Rect, ribbon: boolean): Steps<Canvas> {
  const sp = spec();
  const c0 = performance.now();
  const area = yield* areaSteps(seed, x, y, side, nodes, sp.castShadow);
  const c1 = performance.now();
  const n = area.n;
  const landPx = new Uint8ClampedArray(n * n * 4);
  const waterPx = new Uint8ClampedArray(n * n * 4);
  yield* shadeSteps(seed, area, landPx, waterPx);
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
      const speck = fw > 0.2 ? 0.86 + 0.24 * hash(seed, Math.round(x * nodes) + i, Math.round(y * nodes) + j, 16001) * fw : 1;
      const wa = l < 0.42 ? 1 : l > 0.58 ? 0 : (0.58 - l) / 0.16;
      const beach = l >= 0.5 && l < 0.62 ? (1 - (l - 0.5) / 0.12) * 0.5 : 0;
      for (let c = 0; c < 3; c++) {
        let v = landPx[p + c] * speck;
        v = v + (SAND[c] - v) * beach;
        out[p + c] = v + (waterPx[p + c] - v) * wa;
      }
      out[p + 3] = 255;
    }
    if (j % ROWS === ROWS - 1) yield;
  }
  ctx.putImageData(img, 0, 0);
  const c3 = performance.now();
  chunkStats.area = c1 - c0;
  chunkStats.light = c2 - c1;
  chunkStats.mix = c3 - c2;
  yield;
  if (!ribbon) {
    const toPx = (wx: number, wy: number): [number, number] => [(wx - x) * nodes, (wy - y) * nodes];
    if (linePath(ctx, rivers, isRiver, area.warp, toPx, water) > 0) {
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = TW.river;
      ctx.lineWidth = 0.32 * nodes;
      ctx.stroke();
    }
    return canvas;
  }
  // Средний масштаб: свет и цвет — решёткой узлов, растянутой вдвое со сглаживанием (дорого — счёт, а не
  // пиксели); купы, река и броды — уже в полном разрешении: купа в 6 px читалась квадратным крапом.
  const up = makeCanvas(n * MID_UP, n * MID_UP);
  const uctx = ctxOf(up);
  uctx.imageSmoothingEnabled = true;
  uctx.drawImage(canvas, 0, 0, n * MID_UP, n * MID_UP);
  canvas.width = 0;
  const px = nodes * MID_UP;
  const toPx = (wx: number, wy: number): [number, number] => [(wx - x) * px, (wy - y) * px];
  // Купы — с запасом в клетку, как у тайла: крона соседа заходит внутрь, и по стыку тайлов не идёт срез.
  const around: Rect = { x: rivers.x - 1, y: rivers.y - 1, w: rivers.w + 2, h: rivers.h + 2 };
  yield* groveSteps(uctx, seed, area, around, toPx, px, clearingsIn(around), MID_GROVES);
  if (linePath(uctx, rivers, isRiver, area.warp, toPx, water) > 0) strokeRiver(uctx, px);
  drawCrossings(uctx, rivers, area.warp, toPx, px);
  return up;
}

// ---------- Средний масштаб ----------

/** Куп на клетку сплошного леса у среднего масштаба: реже, чем вблизи, — купа там в 12 px, и гуще — каша. */
const MID_GROVES = 4;
/** Во сколько раз картина среднего масштаба крупнее своей решётки: решётка — 8 узлов, холст — 16 px на клетку. */
const MID_UP = 2;

/** Тайл среднего масштаба: клеток на сторону и пикселей на клетку (docs/map_tw.md, раздел 5). */
export const MID_CELLS = 8;
/** Узлов решётки света на клетку среднего масштаба; пикселей холста на клетку — `MID_PX`. */
export const MID_NODES = 8;
export const MID_PX = MID_NODES * 2;
/** Вылет тайла среднего масштаба за свой край, в пикселях холста: тот же приём, что у куска обзора. */
export const MID_BLEED = 4;

/** Окно данных тайла среднего масштаба (`tx`, `ty` — индекс тайла от начала мира). */
export function midNeed(tx: number, ty: number): Rect {
  const bleed = MID_BLEED / MID_PX;
  const x0 = WORLD_ORIGIN.x + tx * MID_CELLS;
  const y0 = WORLD_ORIGIN.y + ty * MID_CELLS;
  return inWorld(needFor(x0 - bleed, y0 - bleed, MID_CELLS + bleed * 2, MID_NODES));
}

/** Последняя выпечка тайла среднего масштаба — стенду и бюджету. */
export const midStats = { ms: 0 };

/**
 * Тайл среднего масштаба шагами: свет решёткой 8 узлов на клетку (вдвое чаще куска обзора), холст 16 px на
 * клетку с купами леса, рекой лентой и бродами. Null — данных под округой нет. Кадр рисует тайл без вылета.
 */
export function* midSteps(seed: number, tx: number, ty: number): Steps<Canvas | null> {
  if (!land().ready(midNeed(tx, ty))) return null;
  const t0 = performance.now();
  const bleed = MID_BLEED / MID_PX;
  const x0 = WORLD_ORIGIN.x + tx * MID_CELLS;
  const y0 = WORLD_ORIGIN.y + ty * MID_CELLS;
  const rect: Rect = { x: x0, y: y0, w: MID_CELLS, h: MID_CELLS };
  const canvas = yield* pictureSteps(seed, x0 - bleed, y0 - bleed, MID_CELLS + bleed * 2, MID_NODES, rect, true);
  midStats.ms = performance.now() - t0;
  return canvas;
}

/** Тайл среднего масштаба целиком, разом: стенд. */
export const bakeMid = (seed: number, tx: number, ty: number): Canvas | null => drain(midSteps(seed, tx, ty));
