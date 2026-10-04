// Кадр карты мира. Карта одна — в духе карты кампании (docs/map_tw.md), своим куском (`twslot.ts` → `tw/hook.ts`):
// приехал — кадр целиком его. Прежняя карта удалена вместе с переключателем «Карта мира» (docs/ui_audit.md, 16); пока
// кусок едет (или не приехал вовсе), на месте карты — пустота и бумага, без земли и целей: палец по ней ничего не
// открывает, а приказ за край отклонит мир (`twslot.reachable`).
//
// Здесь же метка лупы и лист бумаги — их берёт и новый вид (`tw/frame.ts`).
import type { Coord } from '@/world/types';
import { grainTile, vignette } from './paint';
import { PALETTE } from './const';
import { type Camera, type Viewport, toScreen } from './grid';
import { GRID } from './palette';
import { twSlot } from './twslot';

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

// ---------- Бумага ----------

/**
 * Узор зерна. Считается один раз на контекст: `createPattern` из готового холста
 * — операция дешёвая, но звать её шестьдесят раз в секунду незачем.
 */
let grain: CanvasPattern | null = null;

/**
 * Лист, на котором всё это нарисовано: зерно пергамента и затемнение к краям.
 *
 * Это последнее, что отделяет карту от поля с фигурками, и стоит оно двух
 * заливок на кадр. Закону кадра это не противоречит: и зерно, и затемнение —
 * готовые холсты, испечённые один раз (`paint.ts`), а в кадре от них остаётся
 * заливка узором и `drawImage`. Ни пути, ни градиента здесь не создаётся.
 *
 * Ложится **поверх тумана и под всё движущееся**. Поверх тумана — потому что
 * неразведанное от этого перестаёт быть выключенным светом и становится
 * незаполненной частью чертежа: бумага на нём та же, что и на разведанном.
 * Под движущимся — потому что зерно на таймере чужой армии это не бумага, а
 * грязь на стекле.
 */
export function drawPaper(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  if (!grain) grain = ctx.createPattern(grainTile(), 'repeat');
  if (grain) {
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, vp.w, vp.h);
  }
  ctx.drawImage(vignette(), 0, 0, vp.w, vp.h);
}

/** Новый мир — новые заготовки: узор держит ссылку на прежний холст зерна. */
export function dropPaper(): void {
  grain = null;
}

// ---------- Кадр ----------

/** Один кадр карты: новый вид, а пока он не приехал — пустота под бумагой. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  dpr: number,
  frame: number,
): void {
  const tw = twSlot();
  if (tw) {
    tw.frame(ctx, cam, vp, dpr, frame);
    return;
  }
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, vp.w, vp.h);
  drawPaper(ctx, vp);
}
