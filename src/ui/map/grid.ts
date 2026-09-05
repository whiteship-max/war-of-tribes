// Геометрия экрана карты: камера, видимая область, сетка тайлов.
//
// Здесь нет ни canvas, ни React — только числа. Это сделано ради тестов: под
// vitest среда 'node', и всё, что трогает холст, проверить нечем. Ошибка в этих
// формулах видна как пропавшая полоса при перетаскивании, поэтому они живут
// отдельным файлом и проверяются напрямую.
import type { Coord, Rect } from '@/world/types';
import { WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import { FADE_HI, FADE_LO, SCALE_MAX, SCALE_MIN, TILE_CELLS } from './const';

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
 * Насколько близко к кромке экрана разрешено подпустить якорь, в пикселях.
 * Мерка именно пиксельная, а не в клетках: закрывают якорь шапка карты сверху и
 * два ряда кнопок снизу, а их высота от масштаба не зависит. Ноль означал бы,
 * что фигуру можно увести ровно за край и потерять из виду.
 */
export const LEASH_EDGE = 72;

/**
 * Поводок камеры: куда игрок вообще может смотреть.
 *
 * Свободного обзора мира у игрока нет — камера стоит на своём поселении или на
 * одной из своих фигур. Но приколачивать её к точке нельзя: приказ движения
 * отдаётся тапом по клетке, и указывать надо в темноту за краем обзора. Отсюда
 * поводок: смещение разрешено на обзор якоря плюс небольшой запас.
 *
 * Второе ограничение — экран. Отпустить камеру дальше половины видимой области
 * значило бы позволить увести фигуру за кромку и потерять её из виду, поэтому
 * из двух пределов берётся меньший: на дальнем масштабе решает поводок, на
 * ближнем — экран, а на самом близком камера просто стоит на якоре.
 */
export function leashCamera(cam: Camera, vp: Viewport, leash: { x: number; y: number; r: number }): Camera {
  const maxX = Math.min(leash.r, Math.max(0, (vp.w / 2 - LEASH_EDGE) / cam.scale));
  const maxY = Math.min(leash.r, Math.max(0, (vp.h / 2 - LEASH_EDGE) / cam.scale));
  return clampCamera({
    ...cam,
    cx: clamp(cam.cx, leash.x - maxX, leash.x + maxX),
    cy: clamp(cam.cy, leash.y - maxY, leash.y + maxY),
  });
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
  // Правый край исключающий: клетка 599 последняя, значит граница — 600.
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

/** Клетка внутри тайла? Нужна тестам покрытия и отбраковке декора. */
export const tileHasCell = (tx: number, ty: number, x: number, y: number): boolean => {
  const o = tileOrigin(tx, ty);
  return x >= o.x && y >= o.y && x < o.x + TILE_CELLS && y < o.y + TILE_CELLS;
};

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
