// Кадр карты целиком: что за чем ложится на полотно.
//
// Всё здесь — функции уровня модуля, а не замыкания внутри компонента. Это не
// вкус, а защита от вполне конкретной ошибки: цикл кадров заводится один раз при
// монтировании (`useEffect` с пустыми зависимостями) и навсегда запоминает то
// окружение, в котором был создан. Любое значение, взятое из области видимости
// рендера, останется в нём таким, каким было в первом кадре, — а в первом кадре
// мира ещё нет. Однажды на этом уже потерялся сид, и нарисованный слой не
// включался вовсе. Теперь брать неоткуда: всё приходит аргументами или из стора.
import { sightDiscs, useWorld, worldNow } from '@/world/store';
import { inSight, type SightDisc } from '@/world/fog';
import { loadedIn } from '@/world/cache';
import { formatLeft, marchPosition, secondsLeft } from '@/world/geo';
import { RELATION_META } from '@/world/data/meta';
import type { Coord, MarchView, Rect, SettlementView } from '@/world/types';
import { chunkBitmap } from './tiles';
import { grainTile, vignette } from './paint';
import { LABEL_FROM, PALETTE } from './const';
import { type Camera, type Viewport, detailAlpha, toScreen, viewRect } from './grid';
import { GRID } from './palette';
import { drawGrid, drawGround, drawVillages, markersOf, settlementsIn } from './detail';
import { drawFog } from './fog';
import { drawZones } from './zones';
import { drawFigures } from './figures';
import { drawHeading, drawParty, lookOf as partyLook } from './party';

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

/**
 * Отряд на карте: колонна людей, знамя, наконечник хода и дорога под ногами.
 *
 * Что здесь считается за кадр и почему это не спор с законом кадра. Спрайт
 * колонны испечён (`party.ts`) и стоит один `drawImage`; наконечник испечён и
 * стоит поворот с копированием. Путями остаются только две линии дороги — и
 * остаются нарочно: концы у них разъезжаются каждый кадр (отряд идёт), и
 * испечь их значило бы перепекать шестьдесят раз в секунду, то есть ровно то,
 * что закон и запрещает. Линий этих на весь кадр два десятка (см. бюджет в
 * `docs/world-map.md`), а не тысячи, как у земли.
 *
 * Пройденное — тусклой сплошной, оставшееся — бегущим пунктиром к цели. Бег
 * пунктира и есть ответ на «куда идёт» там, где до наконечника не дотянулся
 * взгляд.
 */
function drawMarch(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  m: MarchView,
  now: number,
  withTimer: boolean,
  near: number,
  dpr: number,
  discs: SightDisc[],
): void {
  const color = m.hostile ? RELATION_META.enemy.color : RELATION_META.self.color;
  const standing = m.phase === 'stay';
  const pos = standing ? m.to : marchPosition(m, now);
  const [fx, fy] = toScreen(cam, vp, m.from.x + 0.5, m.from.y + 0.5);
  const [tx, ty] = toScreen(cam, vp, m.to.x + 0.5, m.to.y + 0.5);
  const [px, py] = toScreen(cam, vp, pos.x + 0.5, pos.y + 0.5);

  if (!standing) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    // Пройденное: сплошной след, тусклый. Он отвечает на вопрос «откуда идут» —
    // тот самый, ради которого перехват в поле и существует.
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.moveTo(fx, fy);
    ctx.lineTo(px, py);
    ctx.stroke();
    // Оставшееся: пунктир, бегущий к цели. Смещение считается из времени, а не
    // копится в переменной, — иначе после ухода с карты и возврата дорожка
    // прыгнула бы.
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([4, 5]);
    ctx.lineDashOffset = -((now / 60) % 9);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.restore();
  }

  // Куда идёт. У стоящего лагеря направления нет вовсе: он не идёт.
  const angle = standing ? 0 : Math.atan2(ty - py, tx - px);
  // Колонна печётся зеркально по ходу, чтобы люди шли лицом вперёд, а не спиной.
  const west = tx < px;

  // Сколько их — это разведданные, и решает это одно правило на весь мир:
  // свой отряд считает игрок, чужой — только глаза (`world/sight.ts`). Круг
  // считается ровно тем же вызовом, каким мир решал, показывать ли отряд вообще.
  const look = partyLook({
    own: m.own,
    units: m.units,
    standing,
    seen: m.own || inSight(discs, pos.x, pos.y),
    west,
  });

  if (near > 0) {
    ctx.save();
    ctx.globalAlpha = near;
    drawParty(ctx, look, cam.scale, dpr, px, py);
    ctx.restore();
  }

  // Наконечник виден на любом масштабе: на пиксельном обзоре он и есть отряд.
  // Вблизи он отходит вперёд, чтобы не лежать на колонне.
  const r = Math.max(5, Math.min(12, cam.scale * 0.24));
  if (!standing) {
    const lead = near * cam.scale * 0.62;
    drawHeading(ctx, look.side, dpr, px + Math.cos(angle) * lead, py + Math.sin(angle) * lead, angle, r);
  }

  if (!withTimer && !m.hostile) return;
  const left = formatLeft(secondsLeft(m.arriveAt, now));
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(10, 8, 6, 0.85)';
  ctx.strokeText(left, px, py - r - cam.scale * near * 0.55 - 2);
  ctx.fillStyle = color;
  ctx.fillText(left, px, py - r - cam.scale * near * 0.55 - 2);
}

/**
 * Пульс на клетке, куда игрока привели лупой из письма.
 *
 * Мерка здесь экранная, а не мировая, и это главное: масштаб подбирается под
 * расстояние, и на дальнем виде клетка — три пикселя. Кольцо в клетку было бы
 * не видно ровно тогда, когда оно и нужно. Поэтому кольца растут в пикселях и
 * заметны при любом масштабе.
 *
 * Пульс идёт, пока метка стоит, а не гаснет через секунду: игрок приходит сюда
 * читать карточку и возвращается к ней глазами не раз.
 */
function drawSpot(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, c: Coord, now: number): void {
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
function drawPaper(ctx: CanvasRenderingContext2D, vp: Viewport): void {
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
  // Цвет владений ложится на землю, но под туман: в неразведанное он не заходит
  // ни цветом, ни намёком — мир туда его просто не кладёт.
  drawZones(ctx, cam, vp, now);
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

  // Туман ложится поверх земли и поселений, но под всё, что движется: крыша под
  // дымкой — это и есть смысл слоя, а таймер чужой армии важнее любой дымки.
  drawFog(ctx, cam, vp);

  // Бумага поверх тумана: разведанное и неразведанное лежат на одном листе, и
  // край знания читается краем рисунка, а не выключенным светом.
  drawPaper(ctx, vp);

  // Походы поверх земли и поселений: их таймер важнее любой крыши. Живой обзор
  // считается один раз на кадр: это круг у деревни плюс стоящий лазутчик, то
  // есть два-три круга, — и считает его тот же модуль, что и мир.
  const discs = sightDiscs(now);
  for (const m of state.marches) {
    drawMarch(ctx, cam, vp, m, now, cam.scale >= LABEL_FROM, near, dpr, discs);
  }
  drawFigures(ctx, cam, vp, state.figures, state.picked, now, dpr);

  if (cam.scale >= LABEL_FROM) {
    const taken: Box[] = [];
    // Своя деревня подписывается первой: её имя важнее чужих.
    for (const s of [...inView].sort((a, b) => Number(b.mine) - Number(a.mine))) {
      drawLabel(ctx, cam, vp, s, near, taken);
    }
  }

  // Метка лупы поверх всего: её и завели затем, чтобы взгляд нашёл её сразу.
  if (state.spotlight) drawSpot(ctx, cam, vp, state.spotlight, now);

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
