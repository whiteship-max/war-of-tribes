// Кадр карты мира. Карта одна — в духе карты кампании (docs/map_tw.md), своим куском (`twslot.ts` → `tw/hook.ts`):
// приехал — кадр целиком его. Прежняя карта удалена вместе с переключателем «Карта мира» (docs/ui_audit.md, 16); пока
// кусок едет (или не приехал вовсе), на месте карты — пустота, без земли и целей: палец по ней ничего не открывает, а
// приказ за край отклонит мир (`twslot.reachable`). Бумагу (зерно и затемнение) рисует кусок вида (`tw/paper.ts`, К-1):
// кусок едет с запуска игры, и пустота до него бывает разве что на первом же входе на карту.
//
// Здесь же метка лупы — её берёт и новый вид (`tw/frame.ts`).
import type { Coord } from '@/world/types';
import { PALETTE } from './const';
import { type Camera, type Viewport, toScreen } from './grid';
import { GRID } from './palette';
import { twSlot } from './twslot';
import { STILL_FRAME, type FrameMotion } from './still';

/**
 * Пульс на клетке, куда игрока привели лупой из письма.
 *
 * Мерка здесь экранная, а не мировая, и это главное: масштаб подбирается под
 * расстояние, и на дальнем виде клетка — `SCALE_MIN` пикселей. Кольцо в клетку было бы
 * не видно ровно тогда, когда оно и нужно. Поэтому кольца растут в пикселях и
 * заметны при любом масштабе.
 *
 * Пульс идёт, пока метка стоит, а не гаснет через секунду: игрок приходит сюда
 * читать карточку и возвращается к ней глазами не раз.
 */
export function drawSpot(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, c: Coord, now: number): void {
  const [px, py] = toScreen(cam, vp, c.x + 0.5, c.y + 0.5);
  // Кольцо рисуется дважды: тёмный след пошире, светлое поверх. Земля под
  // меткой бывает и травой, и песком, и снегом, и одноцветное кольцо на
  // светлом читается хуже, чем не нарисованное вовсе.
  const ring = (r: number, alpha: number): void => {
    ctx.globalAlpha = alpha * 0.5;
    ctx.lineWidth = 5;
    ctx.strokeStyle = PALETTE.void;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = GRID.select;
    ctx.stroke();
  };
  ctx.save();
  // Две волны вполоборота друг к другу: одна всегда близко к середине, и метку
  // видно в любой момент цикла, а не только на его начале.
  for (const phase of [0, 0.5]) {
    const t = ((now % SPOT_MS) / SPOT_MS + phase) % 1;
    ring(SPOT_R + t * SPOT_GROW, 0.9 * (1 - t));
  }
  ring(SPOT_R, 1);
  ctx.restore();
}

/** Пульс метки: радиус покоя, насколько разбегается волна и за сколько. */
const SPOT_R = 20;
const SPOT_GROW = 26;
const SPOT_MS = 1600;

// ---------- Кадр ----------

/** Один кадр карты: новый вид, а пока он не приехал — пустота. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  dpr: number,
  frame: number,
): FrameMotion {
  const tw = twSlot();
  if (tw) return tw.frame(ctx, cam, vp, dpr, frame);
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, vp.w, vp.h);
  // Кусок вида едет: лист рисуется каждый кадр, пока он не приедет, — ячейку никто не толкает.
  return { ...STILL_FRAME, busy: true };
}
