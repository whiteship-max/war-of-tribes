// Земля ближнего масштаба: выпечка тайлов и их кэш.
//
// Весь смысл файла в одном правиле: тайл собирается ровно один раз, а в кадре
// его только копируют. Поэтому здесь нет ничего, что зависело бы от камеры, —
// тайл привязан к абсолютной сетке мира и переживает и перетаскивание, и зум, и
// пульс мира. Перевыпечка бывает по двум причинам: сменился мир или у поселения
// в округе выросла стадия, а значит выросло и расчищенное пятно под ним.
import type { Rect, SettlementView, Stage } from '@/world/types';
import { cachedChunk, chunkKeysIn, loadedIn, terrainAt as cachedTerrain } from '@/world/cache';
import {
  PALETTE,
  TILE_BAKE,
  TILE_BAKES_PER_FRAME,
  TILE_BLEED,
  TILE_CACHE,
  TILE_CELLS,
  TILE_MARGIN,
  TILE_PX,
} from './const';
import { type TileId, tileOrigin } from './grid';
import { type Clearing, type Sample, type Stamp, hash, stampsFor, treesIn } from './scatter';
import { grassPatch, makeCanvas, softDisc, treeShadow, treeSize, treeSprite } from './paint';

interface Tile {
  canvas: HTMLCanvasElement;
  /** Номер кадра, в котором тайл последний раз рисовали, — по нему вытесняем. */
  usedFrame: number;
  /** Слепок поселений округи: сменился — расчистка другая, надо перепечь. */
  sig: string;
  /** Версия кэша кусков на момент сверки слепка. */
  chunksVersion: number;
}

const tiles = new Map<string, Tile>();
/** Отселённые холсты переиспользуются: иначе при броске карты дёргается аллокатор. */
const pool: HTMLCanvasElement[] = [];
let scratch: HTMLCanvasElement | null = null;

const key = (tx: number, ty: number): string => `${tx}:${ty}`;

/** Радиус расчищенной земли под поселением, в клетках. Растёт со стадией. */
const CLEAR_R: Record<Stage, number> = {
  camp: 0.85,
  village: 1.15,
  stronghold: 1.5,
  town: 1.9,
};

const sample: Sample = (x, y) => cachedTerrain(x, y);

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

/**
 * Слепок округи. В него входит стадия: она задаёт размер расчистки, и когда
 * сосед дорастает до города, пятно под ним обязано вырасти вместе с ним.
 */
const signatureOf = (list: SettlementView[]): string =>
  list
    .map((s) => `${s.x},${s.y},${s.stage}`)
    .sort()
    .join(';');

const clearingsOf = (list: SettlementView[]): Clearing[] =>
  list.map((s) => ({ x: s.x, y: s.y, r: CLEAR_R[s.stage] ?? CLEAR_R.camp }));

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

const clearingStamps = (clearings: Clearing[]): Stamp[] =>
  clearings.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5, r: c.r }));

// ---------- Выпечка ----------

function bake(seed: number, tx: number, ty: number, chunksVersion: number): Tile | null {
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

  // 5. Расчищенная земля под поселениями — тем же механизмом, что и кляксы.
  const around = settlementsAround(pad);
  const clearings = clearingsOf(around);
  paintStamps(ctx, clearingStamps(clearings), PALETTE.cleared, toPx, 1, 0.95);

  // 6. Ёлки. Берутся с запасом в две клетки: дерево за краем тайла заходит
  // внутрь кроной, и без запаса по границе шла бы линия срезанных верхушек.
  const treeRect: Rect = { x: o.x - 2, y: o.y - 2, w: TILE_CELLS + 4, h: TILE_CELLS + 4 };
  const shadow = treeShadow();
  const { w: tw, h: th } = treeSize();
  for (const t of treesIn(seed, treeRect, sample, clearings)) {
    const [sx, sy] = toPx(t.x, t.y);
    const w = tw * t.size;
    const h = th * t.size;
    ctx.drawImage(shadow, sx - w * 0.5, sy - w * 0.14, w, w * 0.3);
    ctx.drawImage(treeSprite(t.kind), sx - w / 2, sy - h * 0.88, w, h);
  }

  return { canvas, usedFrame: 0, sig: signatureOf(around), chunksVersion };
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
export function prepareTiles(seed: number, want: TileId[], frame: number, chunksVersion: number): void {
  let budget = TILE_BAKES_PER_FRAME;
  for (const { tx, ty } of want) {
    const k = key(tx, ty);
    const have = tiles.get(k);
    if (have) {
      // Слепок округи сверяется, только когда приехал новый кусок карты, а не
      // каждый кадр: это несколько раз в минуту против шестидесяти раз в секунду.
      if (have.chunksVersion !== chunksVersion) {
        have.chunksVersion = chunksVersion;
        if (signatureOf(settlementsAround(paddedRect(tx, ty))) !== have.sig) {
          tiles.delete(k);
          release(have);
        }
      }
      if (tiles.has(k)) continue;
    }
    if (budget <= 0) continue;
    const baked = bake(seed, tx, ty, chunksVersion);
    if (!baked) continue;
    baked.usedFrame = frame;
    tiles.set(k, baked);
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

export const tileCount = (): number => tiles.size;

/** Кусок холста тайла без вылета — именно он ложится на экран. */
export const TILE_SRC = {
  x: TILE_BLEED * TILE_BAKE,
  y: TILE_BLEED * TILE_BAKE,
  size: TILE_CELLS * TILE_BAKE,
};
