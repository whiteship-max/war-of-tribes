// Средний масштаб нового вида (docs/map_tw.md, раздел 5; этап 2). Между обзором (4 px на клетку) и тайлами
// ближнего масштаба (64 px на клетку, с 32 px на экране) на экране стоял кусок обзора, растянутый в 4–8 раз:
// мыло вместо берега и река шириной в палец (этап 1, круг 8). Средний слой — тайлы по 8 клеток: свет решёткой
// 8 узлов на клетку (вдвое чаще обзора), холст 16 px на клетку с купами леса и рекой лентой (`bake.bakeMid`).
//
// Закон кадра тот же: тайл печётся раз за жизнь в кэше, не больше одной выпечки нового вида за кадр (общая
// очередь `gate.ts`), в кадре — копирование. Пока тайл не испечён, под ним виден кусок обзора — дырки нет.
// Сезон и уровень сменились — `dropMid` (зовёт `hook.syncLook` вместе с кусками обзора).
import type { Rect } from '@/world/types';
import { useWorld } from '@/world/store';
import { WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import { type Camera, type Viewport, detailAlpha, toScreen } from '../grid';
import { MID_BLEED, MID_CELLS, MID_PX, bakeMid, midNeed, midReady, twLook } from './bake';
import { baked, mayBake } from './gate';
import { TW_SPEC } from './spec';

/** С какого масштаба средний слой проступает поверх обзора и с какого он виден целиком. */
export const MID_LO = 12;
export const MID_HI = 16;

/**
 * Тайлов в памяти: экран телефона на 12 px на клетку — до 45 тайлов с запасом; тайл — 136² px (74 КБ),
 * всего до 4.4 МБ.
 */
const MID_MAX = 60;
const LAST = Math.ceil(WORLD_SIZE / MID_CELLS) - 1;

const tiles = new Map<string, HTMLCanvasElement>();
const askedAt = new Map<string, number>();
let tilesSeed = 0;

export function midAlpha(scale: number): number {
  if (scale <= MID_LO) return 0;
  if (scale >= MID_HI) return 1;
  const t = (scale - MID_LO) / (MID_HI - MID_LO);
  return t * t * (3 - 2 * t);
}

function tileFor(seed: number, tx: number, ty: number, now: number): HTMLCanvasElement | null {
  const key = `${tx}:${ty}`;
  const have = tiles.get(key);
  if (have) {
    tiles.delete(key);
    tiles.set(key, have);
    return have;
  }
  if (!mayBake(now)) return null;
  // Тайлу нужна округа под свет, тень и сплайн; кадр заказывает куски только под экраном с запасом, и край
  // слоя без этого вечно стоял бы куском обзора. Заказ — раз в секунду на тайл (мир знает, что уже едет).
  if (!midReady(tx, ty)) {
    if (now - (askedAt.get(key) ?? -Infinity) > 1000) {
      askedAt.set(key, now);
      useWorld.getState().ensureRegion(midNeed(tx, ty));
    }
    return null;
  }
  const canvas = bakeMid(seed, tx, ty);
  if (!canvas) return null;
  baked(now);
  tiles.set(key, canvas);
  while (tiles.size > MID_MAX) {
    const first = tiles.keys().next().value as string;
    const gone = tiles.get(first);
    if (gone) gone.width = 0;
    tiles.delete(first);
  }
  return canvas;
}

/** Средний слой под тайлами ближнего масштаба. Там, где тайлы видны целиком, его нет. */
export function drawMid(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, rect: Rect): void {
  if (!TW_SPEC[twLook().quality].mid) return;
  const a = midAlpha(cam.scale);
  if (a <= 0 || detailAlpha(cam.scale) >= 1) return;
  const seed = useWorld.getState().info?.seed ?? 0;
  if (!seed) return;
  if (seed !== tilesSeed) {
    dropMid();
    tilesSeed = seed;
  }
  const now = performance.now();
  const tx0 = Math.max(0, Math.floor((rect.x - WORLD_ORIGIN.x) / MID_CELLS));
  const ty0 = Math.max(0, Math.floor((rect.y - WORLD_ORIGIN.y) / MID_CELLS));
  const tx1 = Math.min(LAST, Math.floor((rect.x + rect.w - WORLD_ORIGIN.x) / MID_CELLS));
  const ty1 = Math.min(LAST, Math.floor((rect.y + rect.h - WORLD_ORIGIN.y) / MID_CELLS));
  const src = MID_CELLS * MID_PX;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.imageSmoothingEnabled = true;
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const c = tileFor(seed, tx, ty, now);
      if (!c) continue;
      const [sx, sy] = toScreen(cam, vp, WORLD_ORIGIN.x + tx * MID_CELLS, WORLD_ORIGIN.y + ty * MID_CELLS);
      const [ex, ey] = toScreen(cam, vp, WORLD_ORIGIN.x + (tx + 1) * MID_CELLS, WORLD_ORIGIN.y + (ty + 1) * MID_CELLS);
      // Целые пиксели и стык внахлёст на пиксель: дробный край со сглаживанием дал бы нитку шва.
      const x = Math.floor(sx);
      const y = Math.floor(sy);
      ctx.drawImage(c, MID_BLEED, MID_BLEED, src, src, x, y, Math.ceil(ex) - x, Math.ceil(ey) - y);
    }
  }
  ctx.restore();
}

/** Сколько байт держит средний слой — бюджету. */
export function midBytes(): number {
  let n = 0;
  for (const c of tiles.values()) n += c.width * c.height * 4;
  return n;
}

export function dropMid(): void {
  for (const c of tiles.values()) c.width = 0;
  tiles.clear();
  askedAt.clear();
}
