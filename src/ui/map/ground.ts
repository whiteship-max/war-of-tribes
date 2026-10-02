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
  BANK_SHRINK,
  DEEP_ALPHA,
  DEEP_LOOK,
  DEEP_SHARE,
  NODE_R,
  PALETTE,
  RELIEF_PER_CELL,
  RIDGE_R,
  RIVER_R,
  SURF_SHRINK,
  TRACK_R,
  VERGE_R,
  TILE_BAKE,
  TILE_BAKES_PER_FRAME,
  TILE_BLEED,
  TILE_CELLS,
  TILE_MARGIN,
  TILE_POOL,
  TILE_PX,
  TREE_FREE_R,
} from './const';
import { type TileId, tileOrigin } from './grid';
import { type Clearing, type Flag, type Sample, type Stamp, drawnAs, hash, lineStamps, stampsFor, treesIn, waterShare } from './scatter';
import { lattice as latticeOf, shadePixels } from './relief';
import { grassPatch, makeCanvas, softDisc, treeShadow, treeSize, treeSprite } from './paint';
import { TileCache } from './tilecache';
import { bakeCost, probe } from '@/debug';
import { MAP_TW } from './look';
import { setChunkBake } from './tiles';

/** Замер выпечки включён только флагом адреса — в игре это одна проверка булева. */
const PROBE = probe();

/**
 * Новый вид карты (docs/map_tw.md) — своим куском и только по флагу: тайлы и обзор печёт он, а сетка,
 * кэш и правило «стоя не печётся» остаются здешними. Приехал — испечённое прежним видом выбрасывается.
 */
let tw: typeof import('./tw/hook') | null = null;
if (MAP_TW) {
  void import('./tw/hook').then((m) => {
    tw = m;
    setChunkBake(m.overviewChunk);
    dropTiles();
  });
}

/** Отселённые холсты переиспользуются: иначе при броске карты дёргается аллокатор. */
const pool: HTMLCanvasElement[] = [];
let scratch: HTMLCanvasElement | null = null;

/**
 * Вытесненный холст — в пул, пока в пуле есть место, иначе на свалку. Без
 * обнуления размера Safari держит подложку до сборки мусора.
 */
function release(canvas: HTMLCanvasElement): void {
  if (pool.length < TILE_POOL) pool.push(canvas);
  else canvas.width = 0;
}

/** Правило, что держать и что вытеснять, живёт в `tilecache.ts` — без холста и под тестом. */
const tiles = new TileCache<HTMLCanvasElement>(release);

const sample: Sample = (x, y) => drawnAs(cachedTerrain(x, y));

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
  /** Внутренний край. Задан — рисуется не пятно, а кайма между ним и `shrink`. */
  inner?: number,
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
  const lay = (k: number): void => {
    for (const s of stamps) {
      const r = s.r * k * TILE_BAKE;
      if (r <= 0) continue;
      const [sx, sy] = toPx(s.x, s.y);
      mc.drawImage(disc, sx - r, sy - r, r * 2, r * 2);
    }
  };
  lay(shrink);

  // Кайма, а не пятно. Нужна ровно там, где полоса обязана лежать **по урезу** и
  // ни на шаг внутрь: прибой, нарисованный пятном, проступает сквозь узкую реку
  // (в ней поле едва переходит порог, и вода не закрывает подложку целиком) —
  // река выходит в светлую клетку. Вычитание внутренней части это и снимает.
  if (inner !== undefined) {
    mc.globalCompositeOperation = 'destination-out';
    lay(inner);
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

// ---------- Рельеф ----------

/** Холст под краску рельефа. Один на все тайлы: печётся-то по одному за кадр. */
let shadeCanvas: HTMLCanvasElement | null = null;
let shadeImage: ImageData | null = null;

/**
 * Свет и тень по высоте на весь тайл.
 *
 * Считается по редкой решётке и растягивается с билинейным сглаживанием, а не
 * по пикселю: свет по склону меняется плавно, и узел на `TILE_BAKE / RELIEF_PER_CELL`
 * device-пикселей от следующего даёт ровно ту же картинку вчетверо дешевле. Решётка берётся с
 * запасом в клетку с каждой стороны — уклон считается разностью соседних узлов,
 * и без запаса по кромке тайла шла бы полоса без света.
 *
 * В кадре это ничего не стоит: слой запечён внутрь тайла, как и всё остальное.
 */
function paintRelief(ctx: CanvasRenderingContext2D, seed: number, o: { x: number; y: number }): void {
  const span = TILE_CELLS + TILE_BLEED * 2;
  const lat = latticeOf(
    seed,
    { x: o.x - TILE_BLEED - 1, y: o.y - TILE_BLEED - 1, w: span + 2, h: span + 2 },
    sample,
    has(FEATURE.ridge),
  );
  const size = Math.round(span * RELIEF_PER_CELL);
  if (!shadeCanvas) shadeCanvas = makeCanvas(size, size);
  const sc = ctxOf(shadeCanvas);
  if (!shadeImage) shadeImage = sc.createImageData(size, size);
  shadePixels(lat, shadeImage.data, RELIEF_PER_CELL, size);
  sc.putImageData(shadeImage, 0, 0);
  ctx.drawImage(shadeCanvas, 0, 0, TILE_PX, TILE_PX);
}

// ---------- Выпечка ----------

/**
 * Весь тайл с запасом — открытое море. Вода — большая доля настоящей карты
 * (`npm run world:report`, строка «ландшафт»), и таких тайлов в Атлантике и
 * Средиземном подряд десятки.
 *
 * Быстрый путь для них — не оптимизация впрок, а необходимость: обычная выпечка
 * кладёт на такой тайл диски всех клеток запаса, по `STAMPS_PER_CELL` на клетку и
 * на каждый слой воды, и все они дают ровно
 * один цвет — поле насыщено везде, где до берега больше запаса. Считается это
 * по той же области, из которой берутся штампы, поэтому шва на границе с землёй
 * не появляется: у прибрежного тайла в запасе есть суша, и он печётся обычным
 * порядком.
 */
function allWater(pad: Rect): boolean {
  for (let y = pad.y - 1; y < pad.y + pad.h + 1; y++) {
    for (let x = pad.x - 1; x < pad.x + pad.w + 1; x++) {
      const t = sample(x, y);
      if (t !== null && t !== 'water') return false;
    }
  }
  return true;
}

function bake(seed: number, tx: number, ty: number): HTMLCanvasElement | null {
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

  // Открытое море — два прямоугольника вместо всех этих дисков. Второй —
  // глубина: до берега отсюда дальше любого запаса, значит это открытая вода, и
  // она обязана быть того же тона, каким её красит прибрежный тайл у своей
  // дальней кромки. Иначе на стыке пошла бы ступенька по цвету.
  if (allWater(pad)) {
    ctx.fillStyle = PALETTE.water;
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
    ctx.globalAlpha = DEEP_ALPHA;
    ctx.fillStyle = PALETTE.deep;
    ctx.fillRect(0, 0, TILE_PX, TILE_PX);
    ctx.globalAlpha = 1;
    return canvas;
  }

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

  // 4. Степь и пустыня — теми же кляксами, что и холмы. Пустыня светлее и
  // плотнее: Сахара на карте должна читаться песком, а не выгоревшим лугом.
  paintStamps(ctx, stampsFor(seed, pad, 'steppe', sample), PALETTE.steppe, toPx, 1, 0.7);
  const desert = stampsFor(seed, pad, 'desert', sample);
  paintStamps(ctx, desert, PALETTE.desert, toPx, 1, 0.9);
  paintStamps(ctx, desert, PALETTE.desertLight, toPx, 0.6, 0.5);

  // 5. Рельеф: свет и тень по высоте. Ложится на всю землю разом и **до воды** —
  // море потом накроет собой дно, и рябь по нему не пойдёт. Это самый сильный
  // слой на тайле: без него всё остальное рисуется на плоской заливке.
  paintRelief(ctx, seed, o);

  // 6. Вода четырьмя тонами. Прибой выходит на сушу, отмель садится ровно по
  // урезу, тело внутри неё, глубина — там, где до берега далеко. Все четыре
  // считаются из одного поля и одних штампов, поэтому их края — одна линия.
  const water = stampsFor(seed, pad, 'water', sample);
  paintStamps(ctx, water, PALETTE.surf, toPx, SURF_SHRINK, 0.5, 1);
  paintStamps(ctx, water, PALETTE.shallow, toPx, 1, 0.95);
  paintStamps(ctx, water, PALETTE.water, toPx, 0.88, 1);
  const open: Flag = (x, y) => waterShare(x, y, sample, DEEP_LOOK) >= DEEP_SHARE;
  paintStamps(ctx, stampsFor(seed, pad, 'water', sample, open), PALETTE.deep, toPx, 0.9, DEEP_ALPHA);

  // 7. Местность поверх ландшафта. Порядок здесь — это правила словами: хребет
  // лежит на холмах, река режет всё, переправа ложится поверх реки (мост и виден
  // как то, что реку перекрывает), тракт идёт последним и проходит по мосту.
  // Хребет вблизи — **гребень**, а не бурая полоса поперёк гор. Полосу рисовали,
  // пока земля была плоской и другого способа сказать «здесь горы» не было;
  // теперь массу гор держит рельеф, и тёмная лента поверх него читается шрамом.
  // Осталась от неё узкая тень у подножия и светлый камень по самому гребню.
  const crest = lineStamps(pad, hasOnly(FEATURE.ridge, FEATURE.pass), RIDGE_R);
  paintStamps(ctx, crest, PALETTE.ridge, toPx, 1, 0.28);
  paintStamps(ctx, crest, PALETTE.ridgeLight, toPx, 0.5, 0.5);
  paintStamps(ctx, lineStamps(pad, has(FEATURE.pass), NODE_R), PALETTE.pass, toPx, 1, 0.7);

  // Река лежит в берегах, а не поверх зелени: сначала сырая пойма вдвое шире
  // русла, потом светлая вода, потом тёмная стремнина.
  const river = lineStamps(pad, has(FEATURE.river), RIVER_R);
  paintStamps(ctx, river, PALETTE.bank, toPx, BANK_SHRINK, 0.45);
  paintStamps(ctx, river, PALETTE.river, toPx, 1.15, 0.9);
  paintStamps(ctx, river, PALETTE.riverDeep, toPx, 0.8, 1);
  paintStamps(ctx, lineStamps(pad, has(FEATURE.ford), NODE_R), PALETTE.ford, toPx, 1, 0.9);
  paintStamps(ctx, lineStamps(pad, has(FEATURE.bridge), NODE_R), PALETTE.bridge, toPx, 1, 0.95);

  // Обочина — широкая расчищенная кайма, колея — узкая полоса посреди неё.
  paintStamps(ctx, lineStamps(pad, has(FEATURE.road), VERGE_R), PALETTE.verge, toPx, 1, 0.3);
  paintStamps(ctx, lineStamps(pad, has(FEATURE.track), TRACK_R), PALETTE.road, toPx, 1, 0.9);

  // 8. Деревья. Двор поселения красит его собственный спрайт, а тайлу от
  // поселения нужно только место, чтобы не сажать туда лес. Берутся с запасом в
  // две клетки: дерево за краем тайла заходит внутрь кроной, и без запаса по
  // границе шла бы линия срезанных верхушек. Порода решается местом, а не
  // деревом (`scatter.coniferAt`): юг не хвойный.
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
    ctx.drawImage(treeSprite(t.kind, t.conifer), sx - w / 2, sy - h * 0.88, w, h);
  }

  return canvas;
}

// ---------- Кэш ----------

/** Последний запрос кадра и ёмкость — только для щупа стенда ниже. */
let lastWant = 0;
let lastCapacity = 0;

/**
 * Сколько тайлов испечено с запуска. Счётчик, а не замер: целое на выпечку ничего не
 * стоит, а тест «рогатки и знаки участи не прибавили ни одной выпечки» (`siegemark.test.ts`)
 * читает именно его — через настоящий кадр, а не через рассуждение о том, что спрайт
 * поверх тайла тайла не касается.
 */
let bakedTotal = 0;
export const tileBakes = (): number => bakedTotal;

/** Готовый тайл или null, если его ещё не испекли — тогда сквозь него виден обзор. */
export function tileAt(tx: number, ty: number): HTMLCanvasElement | null {
  return tiles.get(tx, ty);
}

/**
 * Кадр земли: пометить запрос, испечь недостающее — не больше
 * `TILE_BAKES_PER_FRAME` за кадр, — вытеснить сверх ёмкости. Бюджет жёсткий: две
 * выпечки подряд уже видны рывком при броске карты (цена одной — `npm run map:report`,
 * раздел «бросок карты и стоянка»).
 *
 * Сколько держать, решает не этот файл: ёмкость приходит от кадра (`cacheFor`),
 * а правило вытеснения — из `tilecache.ts`.
 */
export function prepareTiles(seed: number, want: TileId[], frame: number, capacity: number): void {
  // Новый вид сменил уровень или сезон — испечённое устарело целиком (раз в сезон, не в кадр).
  if (tw?.syncLook()) dropTiles();
  tiles.frame(want, frame, capacity, TILE_BAKES_PER_FRAME, (tx, ty) => {
    // Цена выпечки — своё число, а не доля кадра: в медиану кадра она не попадает
    // вовсе (тайл печётся раз на десятки кадров), а чувствуется именно рывком.
    // Под `?probe=1` её снимает `npm run map:report`; в игре остаётся проверка булева.
    const t0 = PROBE ? performance.now() : 0;
    const baked = tw ? tw.bakeTile(seed, tx, ty, takeCanvas) : bake(seed, tx, ty);
    // Считается только состоявшаяся выпечка. Отказ по неприехавшим кускам стоит
    // обхода сетки и возврата, и в среднем такие отказы утопили бы настоящее
    // число: их за бросок набирается больше, чем самих тайлов.
    if (baked && PROBE) bakeCost(performance.now() - t0);
    if (baked) bakedTotal++;
    return baked;
  });
  lastWant = want.length;
  lastCapacity = capacity;
}

/** Что кадр просил и сколько кэш держит — стенду (`npm run map:report`), под `?probe=1`. */
if (PROBE && typeof window !== 'undefined') {
  (window as unknown as { __mapTiles?: () => unknown }).__mapTiles = () => ({
    size: tiles.size,
    want: lastWant,
    capacity: lastCapacity,
    pool: pool.length,
  });
}

/** Новый мир или долгий уход в обзор: держать холсты кэша незачем. */
export function dropTiles(): void {
  tiles.drop((canvas) => {
    canvas.width = 0;
  });
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
