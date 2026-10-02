// Край старой карты вместо тумана (docs/map_tw.md, раздел 4, «Края»; этап 2; регион — раздел 13.5). Слоя два, как
// у прежнего тумана (`fog.ts`), и сводить их к одному нельзя (docs/handbook/world.md, «Туман войны — два слоя»):
//
// - **незнакомое — пергамент**: лист с чернильным берегом и значками гор, край знания — неровный, словно
//   обгоревший. Незнакомо и неразведанное, и **чужой регион**: старая карта знает землю (атлас один на всех), но
//   не знает, что на ней, — и за границей своего края игрок видит лист, а не пустоту и не обрыв;
// - **разведанное в регионе, но не в живом обзоре — лёгкая сепия**: местность видна как есть, живые данные под ней
//   устарели (карточка клетки скажет насколько). В живом обзоре — ничего.
//
// Цена. Листы — из заранее испечённого региона (`prebake.ts`): печёт их рабочий поток, кадр только копирует.
// Полутень — растр клетка-в-пиксель над всем, куда пускают камеру (рамка региона с краем), а не над экраном:
// движение камеры его не старит. Печётся он заново, только когда сменилось знание или живой обзор, — и только
// стоя, не чаще раза в четверть секунды; в движении кадр рисует прежний.
import type { Rect } from '@/world/types';
import type { SightDisc } from '@/world/fog';
import { cellInSight, sightDiscs, worldNow } from '@/world/store';
import { CHUNK, WORLD_ORIGIN } from '@/world/data/tuning';
import { type Camera, type Viewport, toScreen, viewRect } from '../grid';
import { type Canvas, ctxOf, makeCanvas } from './canvas';
import type { Knowledge } from './knowledge';
import { C } from './palette';
import { SHEET_PAD, SHEET_PX } from './parchment';
import { drawCells } from './layers';
import { type Ground, moving } from './prebake';

// ---------- Полутень и глубокое незнание ----------

/** Полутень разведанного: тёплая сепия, а не серая дымка — карта старая, а не выключенный свет. */
const SHROUD: readonly [number, number, number, number] = [58, 44, 28, Math.round(0.24 * 255)];
const REBAKE_MS = 250;

interface Raster {
  canvas: Canvas;
  rect: Rect;
  /** Под какое знание и какой живой обзор испечён. */
  gen: number;
  discs: string;
  at: number;
}

let raster: Raster | null = null;

const discsKey = (d: SightDisc[]): string => d.map((v) => `${v.x},${v.y},${v.r}`).join(';');

/**
 * Растр полутени над рамкой. Незнакомая клетка, у которой все восемь соседей тоже незнакомы, — **глубокое
 * незнание**: её закрывает лист пергамента и здесь, сплошь. Это подложка под лист, пока тот не испечён: без неё
 * на мгновение было бы видно землю под листом, а за границей региона — чужую землю. Кромку знания рисует только
 * лист — двух кромок, мягкой и рваной, рядом не бывает.
 */
function bakeRaster(rect: Rect, k: Knowledge, discs: SightDisc[], gen: number, key: string, at: number): Raster {
  const { x: x0, y: y0, w, h } = rect;
  const canvas = raster && raster.rect === rect ? raster.canvas : makeCanvas(w, h);
  const ctx = ctxOf(canvas);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const known = (x: number, y: number): number => {
    const i = x - k.rect.x;
    const j = y - k.rect.y;
    return i < 0 || j < 0 || i >= k.rect.w || j >= k.rect.h ? 0 : k.known[j * k.rect.w + i];
  };
  const [pr, pg, pb] = C.parchment;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const wx = x0 + x;
      const wy = y0 + y;
      const i = (y * w + x) * 4;
      if (known(wx, wy)) {
        if (cellInSight(discs, wx, wy)) continue;
        d[i] = SHROUD[0];
        d[i + 1] = SHROUD[1];
        d[i + 2] = SHROUD[2];
        d[i + 3] = SHROUD[3];
        continue;
      }
      let deep = true;
      for (let dy = -1; dy <= 1 && deep; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (known(wx + dx, wy + dy)) {
            deep = false;
            break;
          }
        }
      }
      if (!deep) continue;
      d[i] = pr;
      d[i + 1] = pg;
      d[i + 2] = pb;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, rect, gen, discs: key, at };
}

function drawRaster(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, g: Ground, k: Knowledge): void {
  const now = worldNow();
  const discs = sightDiscs(now);
  const key = discsKey(discs);
  const rect = g.plan.reach;
  const t = performance.now();
  // Первая полутень региона печётся сразу (иначе за границей на мгновение была бы видна чужая земля); дальше —
  // только при новом знании или обзоре и только стоя.
  const prev = raster && raster.rect === rect ? raster : null;
  const stale = !prev || prev.gen !== g.knowledgeGen || prev.discs !== key;
  if (!prev || (stale && !moving() && t - prev.at > REBAKE_MS)) raster = bakeRaster(rect, k, discs, g.knowledgeGen, key, t);
  if (!raster) return;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  drawCells(ctx, cam, vp, raster.canvas, raster.rect);
  ctx.restore();
}

// ---------- Листы ----------

/** Листы видимых кусков — копированием испечённого (`prebake.ts`), без запаса по краю. */
function drawSheets(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, g: Ground): void {
  const pad = SHEET_PAD * SHEET_PX;
  const rect = viewRect(cam, vp);
  const cx0 = Math.floor((rect.x - WORLD_ORIGIN.x) / CHUNK);
  const cy0 = Math.floor((rect.y - WORLD_ORIGIN.y) / CHUNK);
  const cx1 = Math.floor((rect.x + rect.w - WORLD_ORIGIN.x) / CHUNK);
  const cy1 = Math.floor((rect.y + rect.h - WORLD_ORIGIN.y) / CHUNK);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const sheet = g.sheet(cx, cy);
      if (!sheet) continue;
      const [sx, sy] = toScreen(cam, vp, WORLD_ORIGIN.x + cx * CHUNK, WORLD_ORIGIN.y + cy * CHUNK);
      ctx.drawImage(sheet, pad, pad, CHUNK * SHEET_PX, CHUNK * SHEET_PX, sx, sy, CHUNK * cam.scale, CHUNK * cam.scale);
    }
  }
  ctx.restore();
}

/** Туман нового вида: полутень разведанного и лист над незнакомым — своим неразведанным и чужим регионом. */
export function drawTwFog(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, g: Ground | null): void {
  if (!g?.knowledge) return;
  drawRaster(ctx, cam, vp, g, g.knowledge);
  drawSheets(ctx, cam, vp, g);
}

/** Сколько байт держит полутень — бюджету. */
export const shroudBytes = (): number => (raster ? raster.canvas.width * raster.canvas.height * 4 : 0);

export function dropTwFog(): void {
  raster = null;
}
