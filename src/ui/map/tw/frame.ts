// Кадр карты нового вида целиком (docs/map_tw.md, этап 2): земля, места, войска, агенты, подписи — в духе
// карты кампании. Прежний кадр (`frame.drawFrame`) отдаёт сюда всё, когда кусок нового вида приехал
// (`twslot.ts`), и сам остаётся нетронутым: прежний вид — картой игры до слова владельца.
//
// Закон кадра тот же, что у прежнего (docs/world-map.md): в кадре ничего не печётся — земля, места,
// войска, значки и подписи — копирование испечённого; путями остаются только линии походов (концы у них
// едут каждый кадр) и наконечники хода. Что где стоит — одна правда на кадр и палец (`tw/scene.ts`).
import { sightDiscs, useWorld, worldNow } from '@/world/store';
import { useGame } from '@/game/store';
import { drawNight, dropNight, nightAt } from './night';
import { secondsLeft } from '@/world/geo';
import { sideWorks } from '@/world/works';
import { realLeft } from '@/ui/parts/wait';
import type { Coord, Rect } from '@/world/types';
import { LABEL_FROM, PALETTE } from '../const';
import { type Camera, type Viewport, detailAlpha, toScreen, viewRect } from '../grid';
import { drawGrid, drawGround, markersOf, settlementsIn } from '../detail';
import { drawOverview, drawPaper, drawSpot } from '../frame';
import { drawTwZones, dropTwZones } from './zones';
import { drawTwFog, prepareTwFog } from './fog';
import { startFrame } from './gate';
import { drawAgent } from '../agent';
import type { MarkerKind } from '../village';
import { FELL_WORDS, LABEL_MAX_PX, fellShown, fitLabel, worksStand, worksStep } from '../siegemark';
import { type Mini, badgeSprite, drawMini, fellSprite, flagSprite, hostSprite, miniBucket, pinSprite, placeSprite, worksSprite } from './mini';
import { labelFont, labelSprite, regionSprite } from './labels';
import { REGION_CELLS, onWater, regionAlpha, regionSize } from './regions';
import { type Box, type FigureItem, type HostItem, type PlaceItem, figureItems, hostItems, miniAlpha, placeItems, placesRect } from './scene';

/** Отступ сверху под шапку карты — тот же, что у прежнего кадра. */
const TOP_INSET = 52;

const OWN = '#e8a43c';
const INK = 'rgba(40, 28, 18, 0.85)';
const SERIF = "Georgia, 'Times New Roman', 'Noto Serif', serif";

// ---------- Испечённое: копирование ----------

/**
 * Метки поверх ночи: бейджи мест и сроки походов кадр откладывает сюда и рисует после ночной заливки — ночь
 * темнит землю и фигурки, а не то, что игрок читает (проверка этапа 2: срок набега в полночь читался чёрным
 * по тёмному). Очередь живёт один кадр.
 */
const marks: (() => void)[] = [];

/** Значок постоянного размера: точка привязки значка — на точке места. */
function blit(ctx: CanvasRenderingContext2D, m: Mini, x: number, y: number): void {
  ctx.drawImage(m.canvas, x - m.ax, y - m.ay, m.w, m.h);
}

// ---------- Места ----------

/**
 * Подписи: какие места называются на каком масштабе. Своё — всегда; замки живых соседей — издали: это и
 * есть карта держав; остальное — логова, пепелища и места, которых ещё не видел никто (мир отдаёт их
 * нейтральными, `LocalWorld.view`), — вблизи, с того же масштаба, что у прежней карты.
 */
const NAME_CASTLE_FROM = 7;

function namedAt(it: PlaceItem, scale: number): boolean {
  if (it.s.mine) return true;
  if (it.look.kind === 'castle') return scale >= NAME_CASTLE_FROM;
  return scale >= LABEL_FROM;
}

/** Бейджи у места: под ударом мигает, свои войска стоят ровно. Столбиком слева от тела. */
function drawBadges(ctx: CanvasRenderingContext2D, it: PlaceItem, kinds: MarkerKind[], siege: boolean, mini: boolean, dpr: number, now: number): void {
  const list: ('attack' | 'troops' | 'siege')[] = [];
  for (const k of kinds) if (k === 'attack' || k === 'troops') list.push(k);
  // Осада на дальнем масштабе: рядов рогаток не разобрать, а «в осаде» обязано читаться издали.
  if (siege && !mini) list.push('siege');
  if (list.length === 0) return;
  const step = 17;
  const x = mini ? it.body.x0 - 2 : it.body.x1 + 6;
  let y = mini ? it.body.y0 + 10 : it.body.y0 + 6;
  for (const k of list) {
    const at = y;
    marks.push(() => {
      ctx.globalAlpha = k === 'attack' ? 0.55 + 0.45 * Math.abs(Math.sin(now / 380)) : 1;
      blit(ctx, badgeSprite(k, dpr), x, at);
      ctx.globalAlpha = 1;
    });
    y += step;
  }
}

function drawPlaces(ctx: CanvasRenderingContext2D, cam: Camera, items: PlaceItem[], dpr: number, now: number, markers: Map<string, MarkerKind[]>): void {
  const px = cam.scale;
  const ma = miniAlpha(px);
  const bucket = miniBucket(px);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  for (const it of items) {
    const { s, look, sx, sy } = it;
    const siege = s.besieged && worksStand(s.besieged.starvesAt, now) ? s.besieged : null;
    if (ma > 0) {
      ctx.globalAlpha = ma;
      // Рогатки обнимают город: дальняя половина кольца — под двором, ближняя — поверх. Готовность сторон —
      // та же `works.sideWorks`, что считает бой и окна осады, на минуту кадра.
      const front = siege ? worksStep(sideWorks(siege.since, now, 'front', siege.wood)) : 0;
      const rear = siege ? worksStep(sideWorks(siege.since, now, 'rear', siege.wood)) : 0;
      if (siege) drawMini(ctx, worksSprite(front, rear, 'back', px, dpr), px, bucket, sx, sy);
      drawMini(ctx, placeSprite(look, px, dpr), px, bucket, sx, sy);
      if (siege) drawMini(ctx, worksSprite(front, rear, 'front', px, dpr), px, bucket, sx, sy);
    }
    if (ma < 1) {
      ctx.globalAlpha = 1 - ma;
      blit(ctx, pinSprite({ kind: look.kind, color: look.color, own: look.own }, dpr), sx, sy);
    }
    ctx.globalAlpha = 1;
    const kinds = markers.get(s.id) ?? [];
    drawBadges(ctx, it, kinds, siege !== null, ma >= 0.5, dpr, now);
  }
  ctx.restore();
}

// ---------- Войска ----------

/**
 * Путь похода: пройденное — тусклой чертой, оставшееся — пунктиром следов к цели, бегущим по времени (а не
 * по счётчику кадров: после ухода с карты и возврата дорожка не прыгает). Две линии на отряд — те же, что
 * у прежнего кадра; здесь только чернила и светлая сердцевина, как у пути на карте кампании.
 */
function drawRoute(ctx: CanvasRenderingContext2D, fx: number, fy: number, px: number, py: number, tx: number, ty: number, color: string, now: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(px, py);
  ctx.stroke();
  ctx.globalAlpha = 0.7;
  ctx.setLineDash([2, 7]);
  ctx.lineDashOffset = -((now / 70) % 9);
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.restore();
}

/** Наконечник хода — чернильный шеврон цвета стороны впереди отряда: куда идёт, видно и с дальнего масштаба. */
function drawChevron(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, r: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(-r * 0.7, -r * 0.75);
  ctx.lineTo(-r * 0.25, 0);
  ctx.lineTo(-r * 0.7, r * 0.75);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

/** Срок до прихода над отрядом: чернила с пергаментным ореолом. */
function drawTimer(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.font = `700 11px ${SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = 'rgba(236, 222, 190, 0.9)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color === OWN ? '#6a4310' : '#7a2418';
  ctx.fillText(text, x, y);
}

function drawHosts(ctx: CanvasRenderingContext2D, cam: Camera, items: HostItem[], dpr: number, now: number): void {
  const px = cam.scale;
  const ma = miniAlpha(px);
  const bucket = miniBucket(px);
  const withTimer = px >= LABEL_FROM;
  for (const it of items) {
    const { m, look, sx, sy, fx, fy, tx, ty, standing, angle, body } = it;
    if (!standing) drawRoute(ctx, fx, fy, sx, sy, tx, ty, look.color, now);
    ctx.save();
    if (ma > 0) {
      ctx.globalAlpha = ma;
      drawMini(ctx, hostSprite(look, px, dpr), px, bucket, sx, sy);
    }
    if (ma < 1) {
      ctx.globalAlpha = 1 - ma;
      blit(ctx, flagSprite({ color: look.color, size: look.size, camp: look.camp }, dpr), sx, sy);
    }
    ctx.restore();
    if (!standing) {
      // Впереди тела отряда — не на нём: на миниатюре шеврон лежал бы поверх щита.
      const lead = Math.max(14, (body.x1 - body.x0) * 0.55);
      drawChevron(ctx, sx + Math.cos(angle) * lead, sy - 4 + Math.sin(angle) * lead, angle, Math.max(5, Math.min(9, px * 0.2)), look.color);
    }
    if (!withTimer && !m.hostile) continue;
    const text = realLeft(secondsLeft(m.arriveAt, now));
    marks.push(() => drawTimer(ctx, text, sx, body.y0 - 3, look.color));
  }
}

// ---------- Агенты ----------

function drawFigures(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, items: FigureItem[], picked: string | null, dpr: number, now: number): void {
  const px = cam.scale;
  const ma = miniAlpha(px);
  const bucket = miniBucket(px);
  for (const it of items) {
    const { f, px: hx, ax, py, tx, ty, unit, west } = it.spot;
    const [rx, ry] = it.at;
    if (hx < -80 || py < -80 || hx > vp.w + 80 || py > vp.h + 80) continue;
    const chosen = picked === f.id;
    if (chosen) {
      // Обзор агента в руке — пунктирный круг: сколько он видит, решает мир (`f.sight`).
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(232, 164, 60, 0.6)';
      ctx.beginPath();
      // Обзор — от настоящей клетки агента, а не от точки рисунка у ворот (`scene.atGate`).
      ctx.arc(rx, ry, f.sight * px, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (f.phase === 'moving') {
      const [fx, fy] = toScreen(cam, vp, f.from.x + 0.5, f.from.y + 0.5);
      drawRoute(ctx, fx, fy, hx, py, tx, ty, OWN, now);
      const text = realLeft(secondsLeft(f.arriveAt, now));
      marks.push(() => drawTimer(ctx, text, tx, ty - 10, OWN));
    }
    if (it.host) {
      ctx.save();
      if (ma > 0) {
        ctx.globalAlpha = ma;
        drawMini(ctx, hostSprite(it.host, px, dpr), px, bucket, hx, py);
      }
      if (ma < 1) {
        ctx.globalAlpha = 1 - ma;
        blit(ctx, flagSprite({ color: it.host.color, size: it.host.size, camp: it.host.camp }, dpr), hx, py);
      }
      ctx.restore();
    }
    if (chosen) {
      ctx.save();
      ctx.strokeStyle = 'rgba(40, 28, 18, 0.5)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(ax, py, unit * 0.3, unit * 0.3 * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = OWN;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    drawAgent(ctx, { kind: f.id, west }, unit, dpr, ax, py);
  }
}

// ---------- Подписи ----------

const overlaps = (b: Box, taken: Box[]): boolean => taken.some((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0);

/** Вписанные имена: мерка — шрифт подписи, а не прежний `system-ui` (`siegemark.fittedLabel` держит свой). */
const fitted = new Map<string, string>();
let measurer: CanvasRenderingContext2D | null = null;

function fitName(name: string, own: boolean): string {
  const key = `${own ? 1 : 0}|${name}`;
  const have = fitted.get(key);
  if (have !== undefined) return have;
  measurer ??= document.createElement('canvas').getContext('2d');
  let out = name;
  if (measurer) {
    const m = measurer;
    m.font = labelFont(own);
    out = fitLabel(name, LABEL_MAX_PX, (t) => m.measureText(t).width);
  }
  if (fitted.size > 128) fitted.clear();
  fitted.set(key, out);
  return out;
}

function drawLabels(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, items: PlaceItem[], dpr: number, now: number): Box[] {
  const taken: Box[] = [];
  // Своё — первым: его имя важнее чужих и не уступает места соседу.
  const order = [...items].sort((a, b) => Number(b.s.mine) - Number(a.s.mine));
  for (const it of order) {
    const { s, sx, body } = it;
    if (sx < -40 || sx > vp.w + 40 || body.y1 < -20 || body.y1 > vp.h + 20) continue;
    let top = body.y1 + 3;
    if (namedAt(it, cam.scale)) {
      const l = labelSprite(fitName(s.name, s.mine), s.mine, dpr);
      const box: Box = { x0: sx - l.w / 2, y0: top, x1: sx + l.w / 2, y1: top + l.h };
      if (s.mine || !overlaps(box, taken)) {
        taken.push(box);
        ctx.drawImage(l.canvas, box.x0, box.y0, l.w, l.h);
        top += l.h + 1;
      }
    }
    // Знак участи павшего — под именем; он важнее имени и встаёт на его место, если то уступило соседу.
    if (cam.scale >= LABEL_FROM && fellShown(s.fell, now)) {
      const p = fellSprite(s.fell.fate, FELL_WORDS[s.fell.fate], dpr);
      const box: Box = { x0: sx - p.ax, y0: top - p.ay, x1: sx - p.ax + p.w, y1: top - p.ay + p.h };
      taken.push(box);
      ctx.drawImage(p.canvas, box.x0, box.y0, p.w, p.h);
    }
  }
  return taken;
}

/**
 * Имена морей, гор и островов издали (`tw/regions.ts`): по ним карта узнаётся без легенды. Имена мест важнее
 * — крупное имя, легшее на подпись поселения, уступает. Вблизи гаснут: там их место занимает сама земля.
 */
function drawRegions(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number, taken: Box[]): void {
  const a = regionAlpha(cam.scale);
  if (a <= 0) return;
  ctx.save();
  ctx.globalAlpha = a;
  for (const r of REGION_CELLS) {
    const [x, y] = toScreen(cam, vp, r.x, r.y);
    if (x < -200 || y < -40 || x > vp.w + 200 || y > vp.h + 40) continue;
    const l = regionSprite(r.name, regionSize(r.kind, cam.scale), onWater(r.kind), dpr);
    const box: Box = { x0: x - l.w / 2, y0: y - l.h / 2, x1: x + l.w / 2, y1: y + l.h / 2 };
    if (box.x1 < 0 || box.x0 > vp.w || box.y0 < TOP_INSET || box.y1 > vp.h || overlaps(box, taken)) continue;
    taken.push(box);
    ctx.drawImage(l.canvas, box.x0, box.y0, l.w, l.h);
  }
  ctx.restore();
}

// ---------- Выбор ----------

/** Выбранная клетка — кольцо на земле под местом, а не квадрат сетки: сетки на карте кампании нет. */
function drawSelected(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, c: Coord): void {
  const [x, y] = toScreen(cam, vp, c.x + 0.5, c.y + 0.5);
  const rx = Math.max(13, cam.scale * 0.62);
  ctx.save();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(30, 20, 12, 0.5)';
  ctx.beginPath();
  ctx.ellipse(x, y, rx, rx * 0.62, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#f1e3bd';
  ctx.stroke();
  ctx.restore();
}

// ---------- Кадр ----------

/**
 * Сколько ночи сейчас: по игровому времени партии. `?night=0|1` в адресе — стенду снимков (`map-tw:shots`):
 * дождаться настоящей ночи в снимке нечем.
 */
const FORCED_NIGHT = ((): number | null => {
  if (typeof location === 'undefined') return null;
  const v = new URLSearchParams(location.search).get('night');
  return v === null ? null : Math.max(0, Math.min(1, Number(v) || 0));
})();

function nightNow(): number {
  if (FORCED_NIGHT !== null) return FORCED_NIGHT;
  const s = useGame.getState().s;
  return s ? nightAt(s.time) : 0;
}

/** Слой земли среднего масштаба (`tw/mid.ts`) — заводит дверь вида, когда он есть. */
let midLayer: ((ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, rect: Rect) => void) | null = null;
export const setMidLayer = (f: typeof midLayer): void => {
  midLayer = f;
};

/**
 * Один кадр нового вида. Снизу вверх: пустота → обзор кусками → средний слой → тайлы → владения → сетка
 * (вблизи) → места → туман → бумага → походы → агенты → подписи → метка лупы → выбранная клетка.
 */
export function drawTwFrame(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number, frame: number): void {
  const rect = viewRect(cam, vp);
  const near = detailAlpha(cam.scale);
  const state = useWorld.getState();
  const seed = state.info?.seed ?? 0;
  const now = worldNow();

  // Общая очередь выпечки (`gate.ts`): одна на кадр, лист над незнанием — первым.
  startFrame(frame, near);
  prepareTwFog(cam, vp);
  ctx.fillStyle = PALETTE.void;
  ctx.fillRect(0, 0, vp.w, vp.h);
  drawOverview(ctx, cam, vp, rect);
  midLayer?.(ctx, cam, vp, rect);
  if (near > 0 && seed) drawGround(ctx, cam, vp, seed, frame, near);
  // Владения — тоньше прежних, с чертой границы по краю (`tw/zones.ts`); под туманом, как и прежде.
  drawTwZones(ctx, cam, vp, now);
  // Сетка координат — только вблизи и тоньше прежней: по ней прыгают к «541|822», а издали она — решётка
  // поверх карты кампании.
  drawGrid(ctx, cam, vp, near * 0.6, TOP_INSET);

  marks.length = 0;
  const places = placeItems(cam, vp, settlementsIn(placesRect(rect)), dpr);
  drawPlaces(ctx, cam, places, dpr, now, markersOf(state.marches));

  // Неразведанное — лист старой карты, разведанное вне обзора — сепия (`tw/fog.ts`): поверх мест, под всем,
  // что движется, — как прежний туман.
  drawTwFog(ctx, cam, vp);
  drawPaper(ctx, vp);

  // Живой обзор — один раз на кадр, тем же модулем, что у мира (`world/sight` через `sightDiscs`).
  const discs = sightDiscs(now);
  drawHosts(ctx, cam, hostItems(cam, vp, state.marches, discs, now, dpr), dpr, now);
  drawFigures(ctx, cam, vp, figureItems(cam, vp, state.figures, now, dpr), state.picked, dpr, now);

  // Ночь — по часам партии, как у сцены города (`tw/night.ts`); подписи и сроки — поверх неё.
  drawNight(ctx, vp.w, vp.h, cam.scale, places, nightNow(), dpr);
  for (const draw of marks) draw();
  marks.length = 0;

  drawRegions(ctx, cam, vp, dpr, drawLabels(ctx, cam, vp, places, dpr, now));

  if (state.spotlight) drawSpot(ctx, cam, vp, state.spotlight, now);
  if (state.selected) drawSelected(ctx, cam, vp, state.selected);
}

export function dropFrame(): void {
  fitted.clear();
  dropNight();
  dropTwZones();
}
