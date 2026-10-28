// Геометрия экрана карты: камера, видимая область, сетка тайлов.
//
// Здесь нет ни canvas, ни React — только числа. Это сделано ради тестов: под
// vitest среда 'node', и всё, что трогает холст, проверить нечем. Ошибка в этих
// формулах видна как пропавшая полоса при перетаскивании, поэтому они живут
// отдельным файлом и проверяются напрямую.
import type { Coord, Rect } from '@/world/types';
import { WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import { FADE_HI, FADE_LO, SCALE_MAX, SCALE_MIN, SPARE_CELLS, TILE_CELLS, TILE_POOL, TILE_PROMISE, TILE_PX } from './const';

export interface Camera {
  /** Мировая клетка под серединой экрана. */
  cx: number;
  cy: number;
  /** Пикселей на клетку. */
  scale: number;
}

/** Размер полотна в CSS-пикселях. */
export interface Viewport {
  w: number;
  h: number;
}

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

// ---------- Камера ----------

/** Какая часть мира видна сейчас, в клетках. */
export function viewRect(cam: Camera, vp: Viewport): Rect {
  return {
    x: cam.cx - vp.w / (2 * cam.scale),
    y: cam.cy - vp.h / (2 * cam.scale),
    w: vp.w / cam.scale,
    h: vp.h / cam.scale,
  };
}

export function toScreen(cam: Camera, vp: Viewport, wx: number, wy: number): [number, number] {
  return [(wx - cam.cx) * cam.scale + vp.w / 2, (wy - cam.cy) * cam.scale + vp.h / 2];
}

export function toWorld(cam: Camera, vp: Viewport, sx: number, sy: number): Coord {
  return { x: (sx - vp.w / 2) / cam.scale + cam.cx, y: (sy - vp.h / 2) / cam.scale + cam.cy };
}

/**
 * Камеру отпускают чуть за край мира: упираться в стену на первой же клетке
 * неприятно, а пустая кайма показывает, что мир кончился.
 */
export const CAM_PAD = 6;

export function clampCamera(cam: Camera): Camera {
  return {
    scale: clamp(cam.scale, SCALE_MIN, SCALE_MAX),
    cx: clamp(cam.cx, WORLD_ORIGIN.x - CAM_PAD, WORLD_ORIGIN.x + WORLD_SIZE + CAM_PAD),
    cy: clamp(cam.cy, WORLD_ORIGIN.y - CAM_PAD, WORLD_ORIGIN.y + WORLD_SIZE + CAM_PAD),
  };
}

/**
 * Камера карты свободна у всех (ПН-00, docs/gdd/path_of_sword.md, 3.5.7; решение владельца П2, Н11): поводка, якоря и
 * потолка отдаления нет — прежние `leashCamera` и `zoomFloor` удалены вместе со строкой «Дальше разведанного карту не
 * отдалить». Держат её двое: край мира (`clampCamera`) и рамка региона (`frame` — `twSlot().hold`, docs/map_tw.md, 13.5):
 * это край мира v1, а не поводок. Сведения на отдалении не растут — их держит туман (`tw/fog.ts`), а цену кадра —
 * ограничитель детализации (`tw/far.ts`).
 */
export function holdCamera(cam: Camera, vp: Viewport, frame?: (c: Camera, vp: Viewport) => Camera): Camera {
  const held = clampCamera(cam);
  return frame ? frame(held, vp) : held;
}

/** Сдвиг пальцем: экранные пиксели переводятся в клетки текущим масштабом. */
export function panBy(cam: Camera, dx: number, dy: number): Camera {
  return clampCamera({ ...cam, cx: cam.cx - dx / cam.scale, cy: cam.cy - dy / cam.scale });
}

/**
 * Щипок вокруг точки экрана: клетка под пальцами остаётся под пальцами.
 * Ничего, кроме камеры, не трогает — выбранное поселение живёт в сторе и
 * переживает любой зум.
 */
export function zoomAt(cam: Camera, vp: Viewport, sx: number, sy: number, k: number): Camera {
  const before = toWorld(cam, vp, sx, sy);
  const zoomed: Camera = { ...cam, scale: clamp(cam.scale * k, SCALE_MIN, SCALE_MAX) };
  const after = toWorld(zoomed, vp, sx, sy);
  return clampCamera({ ...zoomed, cx: zoomed.cx + before.x - after.x, cy: zoomed.cy + before.y - after.y });
}

/** Перевести камеру ровно на заданный масштаб, не уводя середину экрана. */
export const scaleTo = (cam: Camera, vp: Viewport, scale: number): Camera =>
  zoomAt(cam, vp, vp.w / 2, vp.h / 2, scale / cam.scale);

// ---------- Два вида ----------

export type MapMode = 'overview' | 'detail';

/** Какой вид считается главным на этом масштабе — по нему переключается кнопка. */
export const modeFor = (scale: number): MapMode => (scale >= (FADE_LO + FADE_HI) / 2 ? 'detail' : 'overview');

/**
 * Насколько проявлен нарисованный слой: 0 — только пиксельный обзор, 1 — только
 * нарисованный, между — оба сразу со встречной прозрачностью. Мгновенная подмена
 * читается как сбой отрисовки, поэтому переход всегда через полосу.
 */
export function detailAlpha(scale: number): number {
  if (scale <= FADE_LO) return 0;
  if (scale >= FADE_HI) return 1;
  const t = (scale - FADE_LO) / (FADE_HI - FADE_LO);
  // Сглаживание по краям полосы: линейный перелив заметен как рывок на входе.
  return t * t * (3 - 2 * t);
}

// ---------- Мир в клетках ----------

/**
 * Целые клетки, попадающие в область, обрезанные по краю мира. Пустой
 * прямоугольник (w или h равны нулю) означает, что в кадре мира нет вовсе.
 */
export function visibleCells(rect: Rect): Rect {
  const x0 = Math.max(WORLD_ORIGIN.x, Math.floor(rect.x));
  const y0 = Math.max(WORLD_ORIGIN.y, Math.floor(rect.y));
  // Правый край исключающий: последняя клетка — `WORLD_ORIGIN + WORLD_SIZE − 1`, значит граница — `WORLD_ORIGIN + WORLD_SIZE`.
  const x1 = Math.min(WORLD_ORIGIN.x + WORLD_SIZE, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(WORLD_ORIGIN.y + WORLD_SIZE, Math.ceil(rect.y + rect.h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

// ---------- Сетка тайлов ----------

/**
 * Тайлы привязаны к абсолютной сетке мира, а не к экрану: поэтому перетаскивание
 * не сдвигает их границы и уже испечённый тайл годится в любом кадре.
 */
export interface TileRange {
  /** Включительно с обеих сторон. */
  tx0: number;
  ty0: number;
  tx1: number;
  ty1: number;
}

export interface TileId {
  tx: number;
  ty: number;
}

export const tileIndexX = (x: number): number => Math.floor((x - WORLD_ORIGIN.x) / TILE_CELLS);
export const tileIndexY = (y: number): number => Math.floor((y - WORLD_ORIGIN.y) / TILE_CELLS);

/** Последний тайл, в котором ещё есть клетки мира. */
export const TILE_LAST = Math.ceil(WORLD_SIZE / TILE_CELLS) - 1;

/** Мировая клетка левого верхнего угла тайла. */
export const tileOrigin = (tx: number, ty: number): Coord => ({
  x: WORLD_ORIGIN.x + tx * TILE_CELLS,
  y: WORLD_ORIGIN.y + ty * TILE_CELLS,
});

/**
 * Тайлы, накрывающие область. Правый край берётся с запасом в сторону лишнего
 * тайла, а не недостающего: лишний стоит один `drawImage`, недостающий — дыра
 * на экране. `margin` добавляет кольцо тайлов вокруг — их пекут заранее, чтобы
 * при перетаскивании полоса выезжала уже готовой.
 */
export function tileRangeFor(rect: Rect, margin = 0): TileRange {
  const tx0 = clamp(tileIndexX(rect.x) - margin, 0, TILE_LAST);
  const ty0 = clamp(tileIndexY(rect.y) - margin, 0, TILE_LAST);
  const tx1 = clamp(tileIndexX(rect.x + rect.w) + margin, 0, TILE_LAST);
  const ty1 = clamp(tileIndexY(rect.y + rect.h) + margin, 0, TILE_LAST);
  return { tx0, ty0, tx1, ty1 };
}

export function tilesIn(range: TileRange): TileId[] {
  const out: TileId[] = [];
  for (let ty = range.ty0; ty <= range.ty1; ty++) {
    for (let tx = range.tx0; tx <= range.tx1; tx++) out.push({ tx, ty });
  }
  return out;
}

// ---------- Что кадр просит у кэша земли ----------

/**
 * Запрос кадра к кэшу земли: экран и запас вокруг него.
 *
 * Это **единственное** место, где сказано, сколько тайлов кадр держит живыми. Из
 * него же выводится ёмкость кэша (`cacheFor`): прежде ёмкость была числом рядом
 * с запросом, и число держало экран, а запас — нет. Два определения одного и
 * того же расходятся молча; одно — не может.
 */
export interface TileRequest {
  /** Тайлы экрана: их кадр рисует. */
  shown: TileId[];
  /**
   * Запас вокруг экрана: печётся заранее и не рисуется. Ближние к экрану идут
   * первыми — когда места мало, отрезается дальний край запаса, а не ближний.
   */
  spare: TileId[];
}

/** Расстояние от тайла до прямоугольника, в клетках. Внутри — ноль. */
function tileGap(t: TileId, rect: Rect): number {
  const o = tileOrigin(t.tx, t.ty);
  const dx = Math.max(rect.x - (o.x + TILE_CELLS), 0, o.x - (rect.x + rect.w));
  const dy = Math.max(rect.y - (o.y + TILE_CELLS), 0, o.y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

export function tileRequest(rect: Rect): TileRequest {
  const inner = tileRangeFor(rect);
  const outer = tileRangeFor({
    x: rect.x - SPARE_CELLS,
    y: rect.y - SPARE_CELLS,
    w: rect.w + SPARE_CELLS * 2,
    h: rect.h + SPARE_CELLS * 2,
  });
  const spare = tilesIn(outer).filter(
    (t) => t.tx < inner.tx0 || t.tx > inner.tx1 || t.ty < inner.ty0 || t.ty > inner.ty1,
  );
  // Порядок полный и не зависит от порядка обхода: у неподвижной камеры отрезанный
  // край запаса обязан быть одним и тем же от кадра к кадру, иначе он пёкся бы
  // по очереди — та же перепечка, только по кругу.
  spare.sort((a, b) => tileGap(a, rect) - tileGap(b, rect) || a.ty - b.ty || a.tx - b.tx);
  return { shown: tilesIn(inner), spare };
}

/**
 * Очередь кадра к кэшу: экран, потом запас — сколько влезет в ёмкость. `null` —
 * экран не влезает даже без запаса: так бывает только на экране больше
 * обещанного на мелких масштабах, и нарисованного слоя там нет.
 *
 * Отрезать живёт здесь, а не в кадре: по этой же функции тест гоняет кэш и
 * проверяет, что неподвижная камера не печёт ничего. Проверка по своей копии
 * обрезки проверяла бы копию.
 */
export function frameQueue(rect: Rect, capacity: number): { shown: TileId[]; queue: TileId[] } | null {
  const { shown, spare } = tileRequest(rect);
  if (shown.length > capacity) return null;
  return { shown, queue: [...shown, ...spare.slice(0, capacity - shown.length)] };
}

/**
 * Где по одной оси меняется число накрытых тайлов, если сдвигать область в
 * пределах одного тайла. Число это кусочно-постоянно и прыгает ровно тогда, когда
 * край области — с запасом или без — переходит границу тайла. Поэтому худший
 * случай ищется не перебором положений, а в точках перелома и между ними: так он
 * точный, а не «достаточно густо проверенный».
 */
function breakpoints(len: number): number[] {
  const edges = [0, len, -SPARE_CELLS, len + SPARE_CELLS];
  const cuts = new Set<number>([0]);
  for (const e of edges) cuts.add((((-e % TILE_CELLS) + TILE_CELLS) % TILE_CELLS));
  const sorted = [...cuts].sort((a, b) => a - b);
  const out = [...sorted];
  for (let i = 0; i < sorted.length; i++) {
    const next = i + 1 < sorted.length ? sorted[i + 1] : TILE_CELLS;
    out.push((sorted[i] + next) / 2);
  }
  return out;
}

/**
 * Сколько тайлов кадр может попросить на этом экране в худшем положении камеры.
 *
 * Считается у нижнего края полосы перехода: ниже нарисованного слоя нет вовсе, а
 * выше экран накрывает меньше клеток, и просить больше кадр не может. Считает
 * тот же `tileRequest`, которым просит кадр, — формулы рядом с ним здесь нет.
 */
export function worstRequest(vp: Viewport): number {
  const w = vp.w / FADE_LO;
  const h = vp.h / FADE_LO;
  // Середина мира: у края карту обрезает её граница, и тайлов там меньше.
  const bx = WORLD_ORIGIN.x + Math.floor(TILE_LAST / 2) * TILE_CELLS;
  const by = WORLD_ORIGIN.y + Math.floor(TILE_LAST / 2) * TILE_CELLS;
  let worst = 0;
  for (const ox of breakpoints(w)) {
    for (const oy of breakpoints(h)) {
      const r = tileRequest({ x: bx + ox, y: by + oy, w, h });
      worst = Math.max(worst, r.shown.length + r.spare.length);
    }
  }
  return worst;
}

/**
 * Потолок кэша земли в тайлах: столько кадр просит на обещанном экране
 * (`TILE_PROMISE`). Экран больше обещанного памяти сверх этого не получает — он
 * теряет запас, а на мелких масштабах и нарисованный слой (числа — у `TILE_PROMISE`).
 */
export const TILE_CEILING = worstRequest(TILE_PROMISE);

let capMemo: { w: number; h: number; n: number } | null = null;
/** Сколько раз ёмкость считалась заново — тесту «не каждый кадр». */
let worstCounted = 0;
export const capacityCounted = (): number => worstCounted;

/**
 * Ёмкость кэша земли для этого экрана: сколько кадр просит в худшем положении
 * камеры, но не больше потолка. Числа, подобранного однажды, здесь нет — поменяй
 * запас, полосу перехода или сторону тайла, и ёмкость пересчитается сама.
 */
export function cacheFor(vp: Viewport): number {
  // Ёмкость зависит только от размера экрана, а кадр вблизи спрашивает её каждый раз: прежде каждый кадр перебирал
  // все положения камеры заново (К-1, docs/telemetry.md). Размер тот же — ответ тот же.
  if (capMemo && capMemo.w === vp.w && capMemo.h === vp.h) return capMemo.n;
  capMemo = { w: vp.w, h: vp.h, n: Math.min(worstRequest(vp), TILE_CEILING) };
  worstCounted++;
  return capMemo.n;
}

/**
 * Сколько памяти земля может занять на этом экране, в байтах: ёмкость кэша, пул
 * запасных холстов и черновик для клякс. У холста 2D подложка ровно ширина ×
 * высота × 4 байта, так что это не оценка, а счёт.
 */
export const tileMemory = (vp: Viewport): number => (cacheFor(vp) + TILE_POOL + 1) * TILE_PX * TILE_PX * 4;

/** Куда лечь копии тайла на экране, в CSS-пикселях, уже округлённое. */
export interface Quad {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Экранный прямоугольник тайла. Обе границы считаются из мировых координат углов,
 * а не как «левая плюс ширина»: правый край тайла выводится ровно тем же
 * выражением, что левый край соседа, поэтому округление у них общее и щели в
 * пиксель между копиями не бывает. Формула живёт здесь, а не рядом с
 * `drawImage`: под vitest холста нет, а промах на краю — это как раз та полоса
 * пустоты при перетаскивании, ради которой всё и затевалось.
 */
export function tileQuad(cam: Camera, vp: Viewport, tx: number, ty: number): Quad {
  const o = tileOrigin(tx, ty);
  const [ax, ay] = toScreen(cam, vp, o.x, o.y);
  const [bx, by] = toScreen(cam, vp, o.x + TILE_CELLS, o.y + TILE_CELLS);
  const x = Math.round(ax);
  const y = Math.round(ay);
  return { x, y, w: Math.round(bx) - x, h: Math.round(by) - y };
}
