// Земля региона в кадре (docs/map_tw.md, раздел 13.4): снизу вверх — грубый растр снимка, куски обзора, средний
// слой, тайлы ближнего масштаба. Всё — копирование испечённого (`prebake.ts`): кадр не печёт ничего, и в движении
// тоже. Чего ещё нет, того не видно: сквозь него виден слой ниже, а под всеми лежит грубый растр — дыр нет.
import type { Rect } from '@/world/types';
import { CHUNK, WORLD_ORIGIN } from '@/world/data/tuning';
import { TILE_BAKE, TILE_BLEED, TILE_CELLS } from '../const';
import { type Camera, type Viewport, detailAlpha, tileQuad, tileRangeFor, toScreen, viewRect } from '../grid';
import { MID_BLEED, MID_CELLS, MID_PX, OVERVIEW_BLEED, OVERVIEW_PX, twLook } from './bake';
import type { Ground } from './prebake';
import { TW_SPEC } from './spec';

/** С какого масштаба средний слой проступает поверх обзора и с какого он виден целиком. */
export const MID_LO = 12;
export const MID_HI = 16;

export function midAlpha(scale: number): number {
  if (scale <= MID_LO) return 0;
  if (scale >= MID_HI) return 1;
  const t = (scale - MID_LO) / (MID_HI - MID_LO);
  return t * t * (3 - 2 * t);
}

/** Индексы клеток сетки `step`, накрывающих прямоугольник (включительно). */
function range(rect: Rect, step: number): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: Math.floor((rect.x - WORLD_ORIGIN.x) / step),
    y0: Math.floor((rect.y - WORLD_ORIGIN.y) / step),
    x1: Math.floor((rect.x + rect.w - WORLD_ORIGIN.x) / step),
    y1: Math.floor((rect.y + rect.h - WORLD_ORIGIN.y) / step),
  };
}

/**
 * Растр «клетка — `px` пикселей» над прямоугольником `area` — только видимая часть, с клеткой запаса под сглаживание.
 * Растр региона в сотни клеток, растянутый целиком на масштаб в десятки пикселей на клетку, браузер прогонял бы по
 * всей его огромной площади; видимая часть — та же картинка за экран. Им рисуются грубый растр, полутень и владения.
 */
export function drawCells(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, pic: CanvasImageSource, area: Rect, px = 1): void {
  const view = viewRect(cam, vp);
  const x0 = Math.max(area.x, Math.floor(view.x) - 1);
  const y0 = Math.max(area.y, Math.floor(view.y) - 1);
  const x1 = Math.min(area.x + area.w, Math.ceil(view.x + view.w) + 1);
  const y1 = Math.min(area.y + area.h, Math.ceil(view.y + view.h) + 1);
  if (x1 <= x0 || y1 <= y0) return;
  const [sx, sy] = toScreen(cam, vp, x0, y0);
  const [ex, ey] = toScreen(cam, vp, x1, y1);
  const x = Math.round(sx);
  const y = Math.round(sy);
  ctx.drawImage(pic, (x0 - area.x) * px, (y0 - area.y) * px, (x1 - x0) * px, (y1 - y0) * px, x, y, Math.round(ex) - x, Math.round(ey) - y);
}

/** Грубый растр: видимая часть снимка, клетка в пиксель, растянутая со сглаживанием. */
function drawCoarse(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, g: Ground): void {
  if (!g.coarse) return;
  ctx.imageSmoothingEnabled = true;
  drawCells(ctx, cam, vp, g.coarse, g.dataRect);
}

/** Куски обзора: картина без вылета, стык внахлёст на пиксель — как у прежнего обзора. */
function drawOverview(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, rect: Rect, g: Ground): void {
  const r = range(rect, CHUNK);
  const src = CHUNK * OVERVIEW_PX;
  ctx.imageSmoothingEnabled = true;
  for (let cy = r.y0; cy <= r.y1; cy++) {
    for (let cx = r.x0; cx <= r.x1; cx++) {
      const pic = g.overview(cx, cy);
      if (!pic) continue;
      const [sx, sy] = toScreen(cam, vp, WORLD_ORIGIN.x + cx * CHUNK, WORLD_ORIGIN.y + cy * CHUNK);
      ctx.drawImage(pic, OVERVIEW_BLEED, OVERVIEW_BLEED, src, src, Math.round(sx), Math.round(sy), Math.ceil(CHUNK * cam.scale), Math.ceil(CHUNK * cam.scale));
    }
  }
}

/**
 * Ближний масштаб накрывает тайл среднего слоя целиком: все тайлы ближнего масштаба над ним уже приехали (или не нужны
 * вовсе — за каймой региона). Там, где хоть одного нет, средний слой лежит под ним и вблизи: ближний масштаб
 * печётся вокруг камеры по ходу, и сквозь недостающий тайл виден средний слой, а не растянутый обзор.
 */
function midCovered(g: Ground, tx: number, ty: number): boolean {
  const x0 = WORLD_ORIGIN.x + tx * MID_CELLS;
  const y0 = WORLD_ORIGIN.y + ty * MID_CELLS;
  const r = tileRangeFor({ x: x0, y: y0, w: MID_CELLS - 0.001, h: MID_CELLS - 0.001 });
  for (let ny = r.ty0; ny <= r.ty1; ny++) for (let nx = r.tx0; nx <= r.tx1; nx++) if (!g.near(nx, ny) && g.nearWanted(nx, ny)) return false;
  return true;
}

/** Средний слой под тайлами ближнего масштаба: там, где тайлы видны целиком и все на месте, его нет. */
function drawMid(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, rect: Rect, g: Ground): void {
  if (!TW_SPEC[twLook().quality].mid) return;
  const a = midAlpha(cam.scale);
  if (a <= 0) return;
  const close = detailAlpha(cam.scale) >= 1;
  const r = range(rect, MID_CELLS);
  const src = MID_CELLS * MID_PX;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.imageSmoothingEnabled = true;
  for (let ty = r.y0; ty <= r.y1; ty++) {
    for (let tx = r.x0; tx <= r.x1; tx++) {
      const pic = g.mid(tx, ty);
      if (!pic || (close && midCovered(g, tx, ty))) continue;
      const [sx, sy] = toScreen(cam, vp, WORLD_ORIGIN.x + tx * MID_CELLS, WORLD_ORIGIN.y + ty * MID_CELLS);
      const [ex, ey] = toScreen(cam, vp, WORLD_ORIGIN.x + (tx + 1) * MID_CELLS, WORLD_ORIGIN.y + (ty + 1) * MID_CELLS);
      // Целые пиксели и стык внахлёст на пиксель: дробный край со сглаживанием дал бы нитку шва.
      const x = Math.floor(sx);
      const y = Math.floor(sy);
      ctx.drawImage(pic, MID_BLEED, MID_BLEED, src, src, x, y, Math.ceil(ex) - x, Math.ceil(ey) - y);
    }
  }
  ctx.restore();
}

/** Кусок холста тайла без вылета — он и ложится на экран (тот же, что у прежней земли, `ground.TILE_SRC`). */
const NEAR_SRC = { x: TILE_BLEED * TILE_BAKE, size: TILE_CELLS * TILE_BAKE };

/** Тайлы ближнего масштаба — по одному `drawImage`, края — общим округлением (`grid.tileQuad`). */
function drawNear(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, rect: Rect, g: Ground): number {
  const alpha = detailAlpha(cam.scale);
  if (alpha <= 0) return 0;
  const r = tileRangeFor(rect);
  let gaps = 0;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  for (let ty = r.ty0; ty <= r.ty1; ty++) {
    for (let tx = r.tx0; tx <= r.tx1; tx++) {
      const pic = g.near(tx, ty);
      if (!pic) {
        // Дыра — только там, где тайл нужен: за каймой региона землю закрывает лист, и тайла там нет нарочно.
        if (g.nearWanted(tx, ty)) gaps++;
        continue;
      }
      const q = tileQuad(cam, vp, tx, ty);
      ctx.drawImage(pic, NEAR_SRC.x, NEAR_SRC.x, NEAR_SRC.size, NEAR_SRC.size, q.x, q.y, q.w, q.h);
    }
  }
  ctx.restore();
  return gaps;
}

/** Земля региона за кадр; вернёт, сколько тайлов ближнего масштаба на экране ещё не приехало. */
export function drawGround(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, rect: Rect, g: Ground): number {
  ctx.save();
  drawCoarse(ctx, cam, vp, g);
  drawOverview(ctx, cam, vp, rect, g);
  drawMid(ctx, cam, vp, rect, g);
  const gaps = drawNear(ctx, cam, vp, rect, g);
  ctx.restore();
  return gaps;
}
