// Общее у слоёв карты: сетка координат, места в кадре и метки походов на них. Земля и значки мест — у вида карты
// (`tw/`); прежние земля и значки удалены вместе с прежней картой (docs/ui_audit.md, 16).
import type { MarchView, Rect, SettlementView } from '@/world/types';
import { loadedIn } from '@/world/cache';
import { WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import { GRID } from './palette';
import { type Camera, type Viewport, toScreen, viewRect } from './grid';
import { type MarkerKind } from './village';

/** Сетка подписана только по пятёркам: на каждой клетке цифры сливаются в шум. */
const GRID_STEP = 5;

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
