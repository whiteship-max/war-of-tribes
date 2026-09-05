// Земля ближнего масштаба: выпечка тайлов и их кэш.
//
// Весь смысл файла в одном правиле: тайл собирается ровно один раз, а в кадре
// его только копируют. Поэтому здесь нет ничего, что зависело бы от камеры, —
// тайл привязан к абсолютной сетке мира и переживает и перетаскивание, и зум, и
// пульс мира.
//
// Перевыпечки нет вовсе, и это следствие одного решения: расчищенную землю под
// поселением рисует не тайл, а спрайт поселения (`village.ts`). Стадия соседа
// растёт со временем, и если бы пятно жило в тайле, каждый такой рост заставлял
// бы перепекать землю. Тайл знает о поселениях только одно — где они стоят,
// чтобы не сажать ёлки внутрь двора, а координаты не меняются никогда.
import type { Rect, SettlementView } from '@/world/types';
import { cachedChunk, chunkKeysIn, loadedIn, featuresAt as cachedFeatures, terrainAt as cachedTerrain } from '@/world/cache';
import { FEATURE } from '@/world/geography';
import {
  NODE_R,
  PALETTE,
  RIDGE_R,
  RIVER_R,
  TRACK_R,
  VERGE_R,
  TILE_BAKE,
  TILE_BAKES_PER_FRAME,
  TILE_BLEED,
  TILE_CACHE,
  TILE_CELLS,
  TILE_MARGIN,
  TILE_PX,
  TREE_FREE_R,
} from './const';
import { type TileId, tileOrigin } from './grid';
import { type Clearing, type Flag, type Sample, type Stamp, hash, lineStamps, stampsFor, treesIn } from './scatter';
import { grassPatch, makeCanvas, softDisc, treeShadow, treeSize, treeSprite } from './paint';

interface Tile {
  canvas: HTMLCanvasElement;
  /** Номер кадра, в котором тайл последний раз рисовали, — по нему вытесняем. */
  usedFrame: number;
}

const tiles = new Map<string, Tile>();
/** Отселённые холсты переиспользуются: иначе при броске карты дёргается аллокатор. */
const pool: HTMLCanvasElement[] = [];
let scratch: HTMLCanvasElement | null = null;

const key = (tx: number, ty: number): string => `${tx}:${ty}`;

const sample: Sample = (x, y) => cachedTerrain(x, y);

/** Признак клетки — из того же куска карты, что и ландшафт. */
const has = (bits: number): Flag => (x, y) => (cachedFeatures(x, y) & bits) !== 0;
const hasOnly = (bits: number, without: number): Flag => (x, y) => {
  const f = cachedFeatures(x, y);
  return (f & bits) !== 0 && (f & without) === 0;
};

// ---------- Данные тайла ----------

/** Область, из которой берутся штампы и деревья: тайл плюс запас на вылет клякс. */
function paddedRect(tx: number, ty: number): Rect {
  const o = tileOrigin(tx, ty);
  return {
    x: o.x - TILE_MARGIN,
    y: o.y - TILE_MARGIN,
    w: TILE_CELLS + TILE_MARGIN * 2,
    h: TILE_CELLS + TILE_MARGIN * 2,
  };
}

/** Поселения, чьи расчистки могут задеть тайл. */
function settlementsAround(rect: Rect): SettlementView[] {
  const out: SettlementView[] = [];
  for (const chunk of loadedIn(rect)) {
    for (const s of chunk.settlements) {
      if (s.x >= rect.x && s.y >= rect.y && s.x < rect.x + rect.w && s.y < rect.y + rect.h) out.push(s);
    }
  }
  return out;
}

const clearingsOf = (list: SettlementView[]): Clearing[] =>
  list.map((s) => ({ x: s.x, y: s.y, r: TREE_FREE_R }));

/**
 * Все ли куски карты под областью уже приехали. Печь по неполным данным нельзя:
 * на границе знания встанет шов, а когда сосед догрузится, картинка дёрнется.
 * Лучше полсекунды показать пиксельный обзор — его игрок и так видел издали.
 */
function ready(rect: Rect): boolean {
  for (const { key: k } of chunkKeysIn(rect)) {
    if (!cachedChunk(k)) return false;
  }
  return true;
}

// ---------- Холсты ----------

function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Карта: 2D-контекст недоступен.');
  return ctx;
}

function takeCanvas(): HTMLCanvasElement {
  const reused = pool.pop();
  if (reused) {
    reused.width = TILE_PX;
    reused.height = TILE_PX;
    return reused;
  }
  return makeCanvas(TILE_PX, TILE_PX);
}

function scratchCanvas(): HTMLCanvasElement {
  if (!scratch) scratch = makeCanvas(TILE_PX, TILE_PX);
  return scratch;
}

// ---------- Слой мягких клякс ----------

/** Мировые координаты тайла в пиксели его холста. */
interface ToPx {
  (wx: number, wy: number): [number, number];
}

/**
 * Кляксы одного вида. Диски складываются режимом `lighter`, поэтому альфа
 * насыщается ровно там, где сумма поля переходит порог, — берег на картинке
 * совпадает с берегом, по которому отбраковываются ёлки, а не идёт рядом.
 * `shrink` меньше единицы отодвигает край внутрь: так из одной кляксы получаются
 * отмель по краю и тёмная вода в середине.
 */
function paintStamps(
  target: CanvasRenderingContext2D,
  stamps: Stamp[],
  color: string,
  toPx: ToPx,
  shrink: number,
  alpha: number,
): void {
  if (stamps.length === 0) return;

  const mask = scratchCanvas();
  const mc = ctxOf(mask);
  mc.setTransform(1, 0, 0, 1, 0, 0);
  mc.globalAlpha = 1;
  mc.globalCompositeOperation = 'source-over';
  mc.clearRect(0, 0, TILE_PX, TILE_PX);
  mc.imageSmoothingEnabled = true;
  mc.globalCompositeOperation = 'lighter';

  const disc = softDisc();
  for (const s of stamps) {
    const r = s.r * shrink * TILE_BAKE;
    if (r <= 0) continue;
    const [sx, sy] = toPx(s.x, s.y);
    mc.drawImage(disc, sx - r, sy - r, r * 2, r * 2);
  }

  // Красим накопленную маску на месте: второй холст под это не нужен.
  mc.globalCompositeOperation = 'source-in';
  mc.fillStyle = color;
  mc.fillRect(0, 0, TILE_PX, TILE_PX);
  mc.globalCompositeOperation = 'source-over';

  target.globalAlpha = alpha;
  target.drawImage(mask, 0, 0);
  target.globalAlpha = 1;
}

// ---------- Выпечка ----------

function bake(seed: number, tx: number, ty: number): Tile | null {
  const pad = paddedRect(tx, ty);
  if (!ready(pad)) return null;

  const o = tileOrigin(tx, ty);
  // Мировая координата → пиксель холста тайла. Вылет сдвигает начало отсчёта,
  // поэтому кляксы соседа заходят внутрь и на стыке нет пустой каймы.
  const toPx: ToPx = (wx, wy) => [(wx - o.x + TILE_BLEED) * TILE_BAKE, (wy - o.y + TILE_BLEED) * TILE_BAKE];

  const canvas = takeCanvas();
  const ctx = ctxOf(canvas);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, TILE_PX, TILE_PX);
  ctx.imageSmoothingEnabled = true;

  const lo = -Math.ceil(TILE_BLEED) - 1;
  const hi = TILE_CELLS + Math.ceil(TILE_BLEED) + 1;

  // 1. Сплошная трава — но только там, где клетки мира есть. Иначе зелень
  // вылезла бы за край сетки, и мир кончался бы не там, где кончается.
  ctx.fillStyle = PALETTE.grass;
  for (let y = lo; y < hi; y++) {
    for (let x = lo; x < hi; x++) {
      if (sample(o.x + x, o.y + y) === null) continue;
      const [sx, sy] = toPx(o.x + x, o.y + y);
      ctx.fillRect(Math.floor(sx), Math.floor(sy), TILE_BAKE + 1, TILE_BAKE + 1);
    }
  }

  // 2. Крап: сплошная заливка читается пластиком, а не травой.
  for (let y = lo; y < hi; y++) {
    for (let x = lo; x < hi; x++) {
      const wx = o.x + x;
      const wy = o.y + y;
      if (sample(wx, wy) === null) continue;
      const n = 1 + Math.floor(hash(seed, wx, wy, 7717) * 2);
      for (let i = 0; i < n; i++) {
        const salt = 7727 + i * 5;
        const gx = wx + hash(seed, wx, wy, salt);
        const gy = wy + hash(seed, wx, wy, salt + 1);
        const gr = TILE_BAKE * (0.45 + hash(seed, wx, wy, salt + 2) * 0.5);
        const [sx, sy] = toPx(gx, gy);
        ctx.globalAlpha = 0.16 + hash(seed, wx, wy, salt + 3) * 0.14;
        ctx.drawImage(grassPatch(Math.floor(hash(seed, wx, wy, salt + 4) * 3)), sx - gr, sy - gr, gr * 2, gr * 2);
      }
    }
  }
  ctx.globalAlpha = 1;

  // 3. Холмы раньше воды: там, где песок сходится с берегом, вода должна лечь
  // сверху, иначе на стыке получается грязь.
  const hills = stampsFor(seed, pad, 'hills', sample);
  paintStamps(ctx, hills, PALETTE.hills, toPx, 1, 0.7);
  paintStamps(ctx, hills, PALETTE.hillsLight, toPx, 0.62, 0.45);

  // 4. Вода: широкая отмель и тёмное тело внутри неё.
  const water = stampsFor(seed, pad, 'water', sample);
  paintStamps(ctx, water, PALETTE.shallow, toPx, 1, 0.95);
  paintStamps(ctx, water, PALETTE.water, toPx, 0.74, 1);

  // 5. Местность поверх ландшафта. Порядок здесь — это правила словами: хребет
  // лежит на холмах, река режет всё, переправа ложится поверх реки (мост и виден
  // как то, что реку перекрывает), тракт идёт последним и проходит по мосту.
  paintStamps(ctx, lineStamps(pad, hasOnly(FEATURE.ridge, FEATURE.pass), RIDGE_R), PALETTE.ridge, toPx, 1, 0.85);
  paintStamps(ctx, lineStamps(pad, hasOnly(FEATURE.ridge, FEATURE.pass), RIDGE_R), PALETTE.ridgeLight, toPx, 0.55, 0.6);
  paintStamps(ctx, lineStamps(pad, has(FEATURE.pass), NODE_R), PALETTE.pass, toPx, 1, 0.7);

  const river = lineStamps(pad, has(FEATURE.river), RIVER_R);
  paintStamps(ctx, river, PALETTE.river, toPx, 1.35, 0.9);
  paintStamps(ctx, river, PALETTE.riverDeep, toPx, 0.85, 1);
  paintStamps(ctx, lineStamps(pad, has(FEATURE.ford), NODE_R), PALETTE.ford, toPx, 1, 0.9);
  paintStamps(ctx, lineStamps(pad, has(FEATURE.bridge), NODE_R), PALETTE.bridge, toPx, 1, 0.95);

  // Обочина — широкая расчищенная кайма, колея — узкая полоса посреди неё.
  paintStamps(ctx, lineStamps(pad, has(FEATURE.road), VERGE_R), PALETTE.verge, toPx, 1, 0.3);
  paintStamps(ctx, lineStamps(pad, has(FEATURE.track), TRACK_R), PALETTE.road, toPx, 1, 0.9);

  // 6. Ёлки. Двор поселения красит его собственный спрайт, а тайлу от поселения
  // нужно только место, чтобы не сажать туда лес. Берутся с запасом в две
  // клетки: дерево за краем тайла заходит внутрь кроной, и без запаса по границе
  // шла бы линия срезанных верхушек.
  const clearings = clearingsOf(settlementsAround(pad));
  const treeRect: Rect = { x: o.x - 2, y: o.y - 2, w: TILE_CELLS + 4, h: TILE_CELLS + 4 };
  const shadow = treeShadow();
  const { w: tw, h: th } = treeSize();
  const noTrees = has(FEATURE.river | FEATURE.ridge | FEATURE.road);
  for (const t of treesIn(seed, treeRect, sample, clearings, noTrees)) {
    const [sx, sy] = toPx(t.x, t.y);
    const w = tw * t.size;
    const h = th * t.size;
    ctx.drawImage(shadow, sx - w * 0.5, sy - w * 0.14, w, w * 0.3);
    ctx.drawImage(treeSprite(t.kind), sx - w / 2, sy - h * 0.88, w, h);
  }

  return { canvas, usedFrame: 0 };
}

// ---------- Кэш ----------

function release(t: Tile): void {
  if (pool.length < 4) pool.push(t.canvas);
  // Без обнуления размера Safari держит подложку до сборки мусора.
  else t.canvas.width = 0;
}

function evict(frame: number): void {
  while (tiles.size > TILE_CACHE) {
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [k, t] of tiles) {
      // Нарисованное в этом кадре не выбрасываем: иначе тайл выкинут и тут же
      // испекут заново, и так каждый кадр.
      if (t.usedFrame === frame) continue;
      if (t.usedFrame < oldest) {
        oldest = t.usedFrame;
        oldestKey = k;
      }
    }
    if (!oldestKey) return;
    const gone = tiles.get(oldestKey);
    tiles.delete(oldestKey);
    if (gone) release(gone);
  }
}

/** Готовый тайл или null, если его ещё не испекли. Отметка кадра нужна вытеснению. */
export function tileAt(tx: number, ty: number, frame: number): HTMLCanvasElement | null {
  const t = tiles.get(key(tx, ty));
  if (!t) return null;
  t.usedFrame = frame;
  return t.canvas;
}

/**
 * Печёт недостающие тайлы — не больше `TILE_BAKES_PER_FRAME` за кадр. Бюджет
 * жёсткий: одна выпечка это несколько миллисекунд, две подряд уже видны рывком
 * при броске карты.
 */
export function prepareTiles(seed: number, want: TileId[], frame: number): void {
  let budget = TILE_BAKES_PER_FRAME;
  for (const { tx, ty } of want) {
    if (tiles.has(key(tx, ty))) continue;
    if (budget <= 0) break;
    const baked = bake(seed, tx, ty);
    if (!baked) continue;
    baked.usedFrame = frame;
    tiles.set(key(tx, ty), baked);
    budget--;
  }
  evict(frame);
}

/** Новый мир или долгий уход в обзор: держать два десятка холстов незачем. */
export function dropTiles(): void {
  for (const t of tiles.values()) t.canvas.width = 0;
  tiles.clear();
  for (const c of pool) c.width = 0;
  pool.length = 0;
  if (scratch) {
    scratch.width = 0;
    scratch = null;
  }
}

/** Кусок холста тайла без вылета — именно он ложится на экран. */
export const TILE_SRC = {
  x: TILE_BLEED * TILE_BAKE,
  y: TILE_BLEED * TILE_BAKE,
  size: TILE_CELLS * TILE_BAKE,
};
