// Кадр карты целиком: что за чем ложится на полотно.
//
// Всё здесь — функции уровня модуля, а не замыкания внутри компонента. Это не
// вкус, а защита от вполне конкретной ошибки: цикл кадров заводится один раз при
// монтировании (`useEffect` с пустыми зависимостями) и навсегда запоминает то
// окружение, в котором был создан. Любое значение, взятое из области видимости
// рендера, останется в нём таким, каким было в первом кадре, — а в первом кадре
// мира ещё нет. Однажды на этом уже потерялся сид, и нарисованный слой не
// включался вовсе. Теперь брать неоткуда: всё приходит аргументами или из стора.
import { useWorld, worldNow } from '@/world/store';
import { loadedIn } from '@/world/cache';
import { formatLeft, marchPosition, secondsLeft } from '@/world/geo';
import { RELATION_META } from '@/world/data/meta';
import type { MarchView, Rect, SettlementView } from '@/world/types';
import { chunkBitmap } from './tiles';
import { LABEL_FROM, PALETTE } from './const';
import { type Camera, type Viewport, detailAlpha, toScreen, viewRect } from './grid';
import { GRID } from './palette';
import { drawGrid, drawGround, drawVillages, markersOf, settlementsIn } from './detail';

/** Занятые подписями места текущего кадра: соседи не пишут имена друг на друга. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Отступ сверху под шапку карты: подписи координат не должны лезть ей под низ. */
const TOP_INSET = 52;

// ---------- Слои ----------

/**
 * Дальний слой: пиксельный растр, по картинке на кусок. Он лежит основой всегда,
 * даже когда сверху рисуется ближний, — сквозь ещё не испечённый тайл виден
 * именно он, и дырки на экране не бывает никогда.
 */
function drawOverview(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, rect: Rect): void {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const chunk of loadedIn(rect)) {
    const [sx, sy] = toScreen(cam, vp, chunk.rect.x, chunk.rect.y);
    ctx.drawImage(
      chunkBitmap(chunk),
      Math.round(sx),
      Math.round(sy),
      Math.ceil(chunk.rect.w * cam.scale),
      Math.ceil(chunk.rect.h * cam.scale),
    );
  }
  ctx.restore();
}

/** Обзорный значок: цветная точка отношения. Вблизи её сменяет нарисованный. */
function drawDot(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, s: SettlementView): void {
  const [sx, sy] = toScreen(cam, vp, s.x + 0.5, s.y + 0.5);
  if (sx < -cam.scale * 2 || sy < -cam.scale * 2 || sx > vp.w + cam.scale || sy > vp.h + cam.scale) return;
  const r = Math.max(2.5, Math.min(9, cam.scale * 0.42) * (s.mine ? 1.15 : 0.85));
  ctx.beginPath();
  ctx.arc(sx, sy, r, 0, Math.PI * 2);
  ctx.fillStyle = s.color;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(10, 8, 6, 0.75)';
  ctx.stroke();
}

/** Подпись под значком. Если место занято соседом, имя не рисуется вовсе. */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  s: SettlementView,
  near: number,
  taken: Box[],
): void {
  const [sx, sy] = toScreen(cam, vp, s.x + 0.5, s.y + 0.5);
  if (sx < 0 || sy < 0 || sx > vp.w || sy > vp.h) return;
  // Вблизи имя отходит вниз: под ним двор поселения, а не пустая трава.
  const top = sy + Math.max(6, cam.scale * (0.5 + near * 0.7));
  ctx.font = '11px system-ui, sans-serif';
  const width = ctx.measureText(s.name).width;
  const box: Box = { x: sx - width / 2 - 2, y: top, w: width + 4, h: 13 };
  for (const b of taken) {
    if (box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y) return;
  }
  taken.push(box);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(10, 8, 6, 0.85)';
  ctx.strokeText(s.name, sx, top);
  ctx.fillStyle = s.mine ? s.color : '#e7dcc9';
  ctx.fillText(s.name, sx, top);
}

/** Отряд в пути: пунктир до цели, стрелка по направлению движения и таймер. */
function drawMarch(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  m: MarchView,
  now: number,
  withTimer: boolean,
): void {
  const color = m.hostile ? RELATION_META.enemy.color : RELATION_META.self.color;
  const pos = m.phase === 'stay' ? m.to : marchPosition(m, now);
  const [fx, fy] = toScreen(cam, vp, m.from.x + 0.5, m.from.y + 0.5);
  const [tx, ty] = toScreen(cam, vp, m.to.x + 0.5, m.to.y + 0.5);
  const [px, py] = toScreen(cam, vp, pos.x + 0.5, pos.y + 0.5);

  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.restore();

  // Стрелка смотрит туда, куда идёт отряд.
  const angle = Math.atan2(ty - py, tx - px);
  const r = Math.max(5, Math.min(13, cam.scale * 0.28));
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(-r * 0.7, r * 0.7);
  ctx.lineTo(-r * 0.35, 0);
  ctx.lineTo(-r * 0.7, -r * 0.7);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(10, 8, 6, 0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  if (!withTimer && !m.hostile) return;
  const left = formatLeft(secondsLeft(m.arriveAt, now));
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(10, 8, 6, 0.85)';
  ctx.strokeText(left, px, py - r - 2);
  ctx.fillStyle = color;
  ctx.fillText(left, px, py - r - 2);
}

// ---------- Кадр ----------

/**
 * Один кадр карты. Порядок снизу вверх: пустота за краем мира → пиксельный
 * обзор → нарисованная земля → сетка координат → поселения → походы → подписи →
 * выбранная клетка. Дорогого тут нет ничего: земля стоит по одному `drawImage`
 * на тайл, поселения — по одному на значок, всё остальное это десяток линий.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  dpr: number,
  frame: number,
): void {
  const rect = viewRect(cam, vp);
  const near = detailAlpha(cam.scale);
  const far = 1 - near;
  const state = useWorld.getState();
  const seed = state.info?.seed ?? 0;
  const now = worldNow();

  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, vp.w, vp.h);

  drawOverview(ctx, cam, vp, rect);
  if (near > 0 && seed) drawGround(ctx, cam, vp, seed, frame, near);
  drawGrid(ctx, cam, vp, near, TOP_INSET);

  const inView = settlementsIn(rect);

  // Поселения: на обзоре — цветные точки (карта читается как расстановка сил),
  // вблизи — нарисованные значки. В полосе перехода оба, встречной прозрачностью.
  if (far > 0) {
    ctx.save();
    ctx.globalAlpha = far;
    for (const s of inView) drawDot(ctx, cam, vp, s);
    ctx.restore();
  }
  if (near > 0) drawVillages(ctx, cam, vp, inView, dpr, near, markersOf(state.marches), now);

  // Походы поверх земли и поселений: их таймер важнее любой крыши.
  for (const m of state.marches) drawMarch(ctx, cam, vp, m, now, cam.scale >= LABEL_FROM);

  if (cam.scale >= LABEL_FROM) {
    const taken: Box[] = [];
    // Своя деревня подписывается первой: её имя важнее чужих.
    for (const s of [...inView].sort((a, b) => Number(b.mine) - Number(a.mine))) {
      drawLabel(ctx, cam, vp, s, near, taken);
    }
  }

  const sel = state.selected;
  if (!sel) return;
  const [sx, sy] = toScreen(cam, vp, sel.x, sel.y);
  const [bx, by] = toScreen(cam, vp, sel.x + 1, sel.y + 1);
  ctx.fillStyle = GRID.selectFill;
  ctx.fillRect(Math.round(sx), Math.round(sy), Math.round(bx - sx), Math.round(by - sy));
  ctx.strokeStyle = GRID.select;
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(sx) - 1, Math.round(sy) - 1, Math.round(bx - sx) + 2, Math.round(by - sy) + 2);
}
