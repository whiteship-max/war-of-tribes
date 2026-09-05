// Три фигуры на полотне. Рисуются последними — после тумана и походов: фигура
// не может оказаться под дымкой, которую сама же и разгоняет.
//
// Ничего не печётся: фигур три, и каждая это круг, глиф и пунктир до цели.
import { RELATION_META } from '@/world/data/meta';
import { formatLeft, secondsLeft } from '@/world/geo';
import { figurePosition } from '@/world/store';
import type { FigureView } from '@/world/types';
import { type Camera, type Viewport, toScreen } from './grid';

/** Цвет фигуры — тот же, что у своего поселения: это всё «своё». */
const OWN = RELATION_META.self.color;
const INK = 'rgba(10, 8, 6, 0.85)';

/**
 * Круг обзора выбранной фигуры. Показывается только у той, что в руке: три
 * кольца разом превратили бы карту в мишень.
 */
function drawSight(ctx: CanvasRenderingContext2D, sx: number, sy: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = 'rgba(232, 164, 60, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

/** Пунктир до цели и таймер прибытия — то же, что у похода: правило одно. */
function drawRoute(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  f: FigureView,
  px: number,
  py: number,
  now: number,
): void {
  const [tx, ty] = toScreen(cam, vp, f.to.x + 0.5, f.to.y + 0.5);
  ctx.save();
  ctx.setLineDash([3, 5]);
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = OWN;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.restore();

  const left = formatLeft(secondsLeft(f.arriveAt, now));
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.strokeText(left, tx, ty - 10);
  ctx.fillStyle = OWN;
  ctx.fillText(left, tx, ty - 10);
}

/**
 * Все три фигуры. Павшая не рисуется вовсе: её нет на карте, она возвращается
 * домой, и это видно в её карточке, а не пустым кружком в поле.
 */
export function drawFigures(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  figures: FigureView[],
  picked: string | null,
  now: number,
): void {
  for (const f of figures) {
    if (f.phase === 'down') continue;
    const at = figurePosition(f, now);
    const [px, py] = toScreen(cam, vp, at.x + 0.5, at.y + 0.5);
    if (px < -60 || py < -60 || px > vp.w + 60 || py > vp.h + 60) continue;
    const chosen = picked === f.id;
    if (chosen) drawSight(ctx, px, py, f.sight * cam.scale);
    if (f.phase === 'moving') drawRoute(ctx, cam, vp, f, px, py, now);

    const r = Math.max(9, Math.min(18, cam.scale * 0.34));
    ctx.save();
    ctx.beginPath();
    ctx.arc(px, py - r * 0.2, r, 0, Math.PI * 2);
    ctx.fillStyle = chosen ? OWN : 'rgba(28, 22, 16, 0.92)';
    ctx.fill();
    ctx.lineWidth = chosen ? 2.5 : 1.5;
    ctx.strokeStyle = chosen ? '#fff2d8' : OWN;
    ctx.stroke();
    ctx.font = `${Math.round(r * 1.15)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(f.icon, px, py - r * 0.15);
    ctx.restore();
  }
}
