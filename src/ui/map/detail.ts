// Нарисованный слой карты: земля, сетка координат и поселения.
//
// Всё, что стоит дорого, уже испечено — тайлы в `ground.ts`, спрайты поселений в
// `village.ts`. Здесь остаётся только раскладка: посчитать, куда лечь копии, и
// скопировать. Ни одного пути и ни одного градиента в этом файле нет.
import type { MarchView, Rect, SettlementView } from '@/world/types';
import { loadedIn } from '@/world/cache';
import { WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import { TILE_CACHE } from './const';
import { GRID } from './palette';
import {
  type Camera,
  type TileId,
  type Viewport,
  tileQuad,
  tileRangeFor,
  tilesIn,
  toScreen,
  viewRect,
} from './grid';
import { TILE_SRC, prepareTiles, tileAt } from './ground';
import { type Look, type MarkerKind, drawMarkers, drawSettlement, variantOf } from './village';

/** Сетка подписана только по пятёркам: на каждой клетке цифры сливаются в шум. */
const GRID_STEP = 5;

// ---------- Земля ----------

/**
 * Земля. За кадр это ровно один `drawImage` на тайл — ничего не пересчитывается
 * и не перерисовывается, сколько бы палец ни возил по экрану.
 *
 * Края тайлов сходятся пиксель в пиксель: правая граница берётся не как «левая
 * плюс ширина», а как экранная координата того же мирового столбца, с которого
 * начнётся сосед. Иначе округление разошлось бы на пиксель и по стыкам пошли бы
 * светлые нитки.
 */
export function drawGround(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  seed: number,
  frame: number,
  alpha: number,
): void {
  const rect = viewRect(cam, vp);
  const shown = tilesIn(tileRangeFor(rect));
  // Предохранитель: если на экран просится больше тайлов, чем влезает в кэш,
  // рисовать землю нельзя вовсе. Иначе тайлы начнут вытеснять друг друга и
  // печься заново каждый кадр — самый дорогой из возможных исходов. Полоса
  // перехода подобрана так, что сюда попадает только её самый край, где
  // нарисованный слой всё равно почти прозрачен; вместо него виден обзор.
  if (shown.length > TILE_CACHE) return;
  // Кольцо вокруг экрана печётся заранее, но в очереди стоит после видимого:
  // бюджет выпечки один тайл за кадр, и тратить его на запас нельзя.
  const ring = tilesIn(tileRangeFor(rect, 1));
  const seen = new Set(shown.map((t) => `${t.tx}:${t.ty}`));
  const queue: TileId[] = [...shown, ...ring.filter((t) => !seen.has(`${t.tx}:${t.ty}`))];
  prepareTiles(seed, queue, frame);

  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = alpha;
  for (const { tx, ty } of shown) {
    const canvas = tileAt(tx, ty, frame);
    // Тайла ещё нет — сквозь него виден пиксельный обзор. Дырки не бывает.
    if (!canvas) continue;
    const q = tileQuad(cam, vp, tx, ty);
    ctx.drawImage(canvas, TILE_SRC.x, TILE_SRC.y, TILE_SRC.size, TILE_SRC.size, q.x, q.y, q.w, q.h);
  }
  ctx.restore();
}

// ---------- Сетка координат ----------

/**
 * Тонкие линии по координатам, кратным пяти, и подписи по краям экрана.
 * Подписи прижаты к краю, а не стоят у линий: при перетаскивании они должны
 * оставаться на месте и читаться, а не уезжать вместе с землёй.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  alpha: number,
  topInset: number,
): void {
  if (alpha <= 0) return;
  const rect = viewRect(cam, vp);
  const x0 = Math.ceil(rect.x / GRID_STEP) * GRID_STEP;
  const y0 = Math.ceil(rect.y / GRID_STEP) * GRID_STEP;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = GRID.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = x0; x <= rect.x + rect.w; x += GRID_STEP) {
    const [sx] = toScreen(cam, vp, x, 0);
    ctx.moveTo(Math.round(sx) + 0.5, 0);
    ctx.lineTo(Math.round(sx) + 0.5, vp.h);
  }
  for (let y = y0; y <= rect.y + rect.h; y += GRID_STEP) {
    const [, sy] = toScreen(cam, vp, 0, y);
    ctx.moveTo(0, Math.round(sy) + 0.5);
    ctx.lineTo(vp.w, Math.round(sy) + 0.5);
  }
  ctx.stroke();

  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const plate = (text: string, cx: number, cy: number): void => {
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = GRID.plate;
    ctx.fillRect(cx - w / 2, cy - 8, w, 16);
    ctx.fillStyle = GRID.label;
    ctx.textAlign = 'center';
    ctx.fillText(text, cx, cy + 0.5);
  };

  for (let x = x0; x <= rect.x + rect.w; x += GRID_STEP) {
    if (x < WORLD_ORIGIN.x || x > WORLD_ORIGIN.x + WORLD_SIZE) continue;
    const [sx] = toScreen(cam, vp, x, 0);
    if (sx < 18 || sx > vp.w - 18) continue;
    plate(String(x), sx, topInset + 10);
  }
  for (let y = y0; y <= rect.y + rect.h; y += GRID_STEP) {
    if (y < WORLD_ORIGIN.y || y > WORLD_ORIGIN.y + WORLD_SIZE) continue;
    const [, sy] = toScreen(cam, vp, 0, y);
    if (sy < topInset + 26 || sy > vp.h - 60) continue;
    plate(String(y), 22, sy);
  }
  ctx.restore();
}

// ---------- Поселения ----------

/** Поселения, попадающие в кадр. Порядок — от дальних к ближним. */
export function settlementsIn(rect: Rect): SettlementView[] {
  const out: SettlementView[] = [];
  for (const chunk of loadedIn(rect)) {
    for (const s of chunk.settlements) out.push(s);
  }
  out.sort((a, b) => a.y - b.y);
  return out;
}

/**
 * Что срочного происходит с поселением. Считается один раз на кадр по списку
 * походов: он приходит с пульсом мира и всегда свежий, в отличие от отчётов,
 * которые подгружаются только при открытии панели.
 */
export function markersOf(marches: MarchView[]): Map<string, MarkerKind[]> {
  const out = new Map<string, MarkerKind[]>();
  const add = (id: string, kind: MarkerKind): void => {
    const have = out.get(id);
    if (have) {
      if (!have.includes(kind)) have.push(kind);
    } else out.set(id, [kind]);
  };
  for (const m of marches) {
    if (m.hostile && m.phase === 'out') add(m.targetId, 'attack');
    else if (m.own && m.phase === 'stay') add(m.targetId, 'troops');
  }
  return out;
}

const lookOf = (s: SettlementView): Look => ({
  stage: s.stage,
  relation: s.relation,
  mine: s.mine,
  variant: variantOf(s.id),
  castle: s.castle,
});

/**
 * Поселения нарисованного слоя. Значок — одна копия испечённого спрайта, метки
 * состояния поверх него тремя дугами: они меняются каждую секунду и в спрайт не
 * запекаются.
 */
export function drawVillages(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  list: SettlementView[],
  dpr: number,
  alpha: number,
  markers: Map<string, MarkerKind[]>,
  now: number,
): void {
  if (alpha <= 0) return;
  const px = cam.scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  for (const s of list) {
    const [sx, sy] = toScreen(cam, vp, s.x + 0.5, s.y + 0.5);
    // Спрайт занимает около трёх клеток: за экраном его можно не рисовать, но
    // запас нужен, иначе крыши будут выскакивать на границе.
    if (sx < -px * 2 || sy < -px * 2 || sx > vp.w + px * 2 || sy > vp.h + px * 2) continue;
    drawSettlement(ctx, lookOf(s), px, dpr, sx, sy);
    const kinds = markers.get(s.id);
    if (kinds) drawMarkers(ctx, sx, sy, px, kinds, now);
  }
  ctx.restore();
}
