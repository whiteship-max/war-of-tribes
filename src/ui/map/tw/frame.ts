// Кадр карты нового вида целиком (docs/map_tw.md, этап 2): земля, места, войска, агенты, подписи — в духе
// карты кампании. Прежний кадр (`frame.drawFrame`) отдаёт сюда всё, когда кусок нового вида приехал
// (`twslot.ts`), и сам остаётся нетронутым: прежний вид — запасной, его выбирают в настройках (`look.ts`).
//
// Закон кадра тот же, что у прежнего (docs/world-map.md): в кадре ничего не печётся — земля, места,
// войска, значки и подписи — копирование испечённого; путями остаются только линии походов (концы у них
// едут каждый кадр) и наконечники хода. Что где стоит — одна правда на кадр и палец (`tw/scene.ts`).
//
// Карта по регионам (docs/map_tw.md, раздел 13): земля региона испечена заранее (`prebake.ts`, рабочий поток), и
// кадр её только копирует (`layers.ts`) — в движении печь нечего. За границей региона — лист старой карты
// (`fog.ts`): чужая земля игроку незнакома, как неразведанная. Объекты вне региона в кадр не попадают
// (`scene.ts`).
import { sightDiscs, useWorld, worldNow } from '@/world/store';
import { useGame } from '@/game/store';
import { drawNight, dropNight, nightAt } from './night';
import { drawClouds, dropClouds } from './clouds';
import { columnAlpha, drawCampFires, drawColumn, drawSmoke, drawSurf, dropAlive } from './alive';
import { secondsLeft } from '@/world/geo';
import { sideWorks } from '@/world/works';
import { realLeft } from '@/ui/parts/wait';
import type { Coord } from '@/world/types';
import { LABEL_FROM } from '../const';
import { type Camera, type Viewport, detailAlpha, toScreen, viewRect } from '../grid';
import { drawGrid, markersOf, settlementsIn } from '../detail';
import { drawPaper, drawSpot } from '../frame';
import { probe, shownGaps } from '@/debug';
import { drawTwZones, dropTwZones } from './zones';
import { drawTwFog } from './fog';
import { drawGround } from './layers';
import { moving, prebakeBusy, prebakeFrame, prebakeIdle, prebaked } from './prebake';
import type { FrameMotion } from '../still';
import { seasonOf } from '@/game/derived';
import { weatherNow } from '@/ui/parts/weather';
import { TW } from './palette';
import { SIDE_COLOR, sideRgba } from '@/side';
import { withinActive } from './theatre/active';
import { drawAgent } from '../agent';
import { marchArms } from '../arms';
import { armsCode, armsOr } from '@/heraldry/arms';
import type { MarkerKind } from '../village';
import { FELL_WORDS, LABEL_MAX_PX, fellShown, fitLabel, worksStand, worksStep } from '../siegemark';
import { type Mini, drawMini, fellSprite, miniBucket, worksSprite } from './mini';
import { BADGE_D, type BadgeKind, badgeSprite, markPx, markSprite } from './marks';
import { TIMER_FONT, labelFont, labelSprite, regionSprite, timerSprite, timerTextWidth, timerWidth } from './labels';
import { REGION_CELLS, onWater, regionAlpha, regionSize } from './regions';
import { type Box, type FigureItem, type HostItem, type PlaceItem, figureItems, hostItems, miniAlpha, placeItems, placesRect } from './scene';

/** Отступ сверху под шапку карты — тот же, что у прежнего кадра. */
const TOP_INSET = 52;

/** Свои: путь, срок, выбор — цвет стороны (`side.ts`). */
const OWN = SIDE_COLOR.ours;
const INK = 'rgba(40, 28, 18, 0.85)';

/** Счёт недопечённого на экране — только под `?probe=1` (`npm run map:report`, «кадров с обзором»). */
const PROBE = probe();

// ---------- Испечённое: копирование ----------

/**
 * Метки поверх ночи: бейджи мест и сроки походов кадр откладывает сюда и рисует после ночной заливки — ночь
 * темнит землю и фигурки, а не то, что игрок читает (проверка этапа 2: срок набега в полночь читался чёрным
 * по тёмному). Очередь живёт один кадр.
 */
const marks: (() => void)[] = [];
/** Пилюли сроков, уже легшие в этот кадр: следующая ищет свободное место (`drawTimer`). */
const timers: Box[] = [];
/** Метки у мест и значки отрядов этого кадра: подписи их обходят (`drawLabels`). */
const busy: Box[] = [];
/** Тела значков мест этого кадра: сроки походов их обходят (`drawTimer`). */
const places: Box[] = [];

/**
 * Что движется в этом кадре само (`still.ts`): кадр отмечает по ходу, карта решает по итогу, когда рисовать следующий.
 * Живёт один кадр, как очереди выше.
 */
const motion: FrameMotion = { busy: false, live: false, decor: false, clock: false };

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

/**
 * Метки у места — малые значки нового вида столбиком у левого плеча значка (у правого стоят агенты — у ворот,
 * `scene.atGate`): под ударом и гости у ворот (волки, разбойники) мигают, свои войска стоят ровно, осада — только
 * издали: вблизи её говорят рогатки на земле.
 */
function drawBadges(ctx: CanvasRenderingContext2D, it: PlaceItem, kinds: MarkerKind[], siege: boolean, gate: BadgeKind[], mini: boolean, dpr: number, now: number): void {
  const list: BadgeKind[] = [...gate];
  for (const k of kinds) if (k === 'attack' || k === 'troops') list.push(k);
  if (siege && !mini) list.push('siege');
  if (list.length === 0) return;
  const step = BADGE_D + 2;
  const x = it.body.x0 - BADGE_D / 2 + 3;
  let y = it.sy - it.d / 2 + BADGE_D / 2 - 2;
  for (const k of list) {
    const at = y;
    const blink = k === 'attack' || k === 'wolves' || k === 'raiders';
    if (blink) motion.live = true;
    busy.push({ x0: x - BADGE_D / 2, y0: at - BADGE_D / 2, x1: x + BADGE_D / 2, y1: at + BADGE_D / 2 });
    marks.push(() => {
      ctx.globalAlpha = blink ? 0.55 + 0.45 * Math.abs(Math.sin(now / 380)) : 1;
      blit(ctx, badgeSprite(k, dpr), x, at);
      ctx.globalAlpha = 1;
    });
    y += step;
  }
}

/** Гости у ворот своего города: вызов к воротам, который мир ещё не посчитал (`sim/gate`, `GameState.gate`). */
function gateBadges(): BadgeKind[] {
  const gate = useGame.getState().s?.gate ?? [];
  const out: BadgeKind[] = [];
  for (const g of gate) {
    const k: BadgeKind = g.foe === 'wolves' ? 'wolves' : 'raiders';
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

function drawPlaces(ctx: CanvasRenderingContext2D, cam: Camera, items: PlaceItem[], dpr: number, now: number, markers: Map<string, MarkerKind[]>): void {
  const px = cam.scale;
  const ma = miniAlpha(px);
  const bucket = miniBucket(px);
  const gate = gateBadges();
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  // Своё — последним: на дальнем масштабе соседи ложатся под него, а не на него.
  const order = items.some((it) => it.s.mine) ? [...items].sort((a, b) => Number(a.s.mine) - Number(b.s.mine)) : items;
  for (const it of order) {
    const { s, sx, sy } = it;
    const siege = s.besieged && worksStand(s.besieged.starvesAt, now) ? s.besieged : null;
    // Рогатки растут по часам мира: шаг стройки — не чаще раза в секунду.
    if (siege) motion.clock = true;
    // Рогатки обнимают место вблизи: дальняя половина кольца — под значком, ближняя — поверх. Готовность сторон — та
    // же `works.sideWorks`, что считает бой и окна осады, на минуту кадра.
    const front = siege ? worksStep(sideWorks(siege.since, now, 'front', siege.wood)) : 0;
    const rear = siege ? worksStep(sideWorks(siege.since, now, 'rear', siege.wood)) : 0;
    if (siege && ma > 0) {
      ctx.globalAlpha = ma;
      drawMini(ctx, worksSprite(front, rear, 'back', px, dpr), px, bucket, sx, sy);
      ctx.globalAlpha = 1;
    }
    blit(ctx, markSprite(it.mark, it.d, dpr), sx, sy);
    if (siege && ma > 0) {
      ctx.globalAlpha = ma;
      drawMini(ctx, worksSprite(front, rear, 'front', px, dpr), px, bucket, sx, sy);
      ctx.globalAlpha = 1;
    }
    const kinds = markers.get(s.id) ?? [];
    drawBadges(ctx, it, kinds, siege !== null, s.mine ? gate : [], ma >= 0.5, dpr, now);
    // Живая карта (`alive.ts`): дым над осаждённым городом, над пепелищем и над сожжённым — после значков, огонь лагеря
    // ночью — поверх ночи.
    const burnt = s.ruin || (s.fell !== null && s.fell.fate === 'burn' && fellShown(s.fell, now));
    // Стенд: `?smoke=1` — свой город как осаждённый (дым и огни), чтобы снять их без осады; игре адрес ничего не даёт.
    const shown = siege !== null || (FORCED_SMOKE && s.mine);
    if (shown || burnt) smokes.push({ x: sx, y: sy, weight: shown ? 1 : 0.6, seed: seedOf(s.id), siege: shown });
  }
  ctx.restore();
}

const FORCED_SMOKE = typeof location !== 'undefined' && new URLSearchParams(location.search).get('smoke') === '1';

/** Дым и огонь мест кадра: собирает `drawPlaces`, рисует кадр — дым под ночью, огонь над ней. */
const smokes: { x: number; y: number; weight: number; seed: number; siege: boolean }[] = [];

/** Герб своего профиля строкой (`ProfileState.arms`): метка своего города и знамёна своих колонн (П-2). */
const ownArms = (): string | null | undefined => useGame.getState().s.profile.arms;

/** Число от имени места: у каждого столба своя доля такта и свои огни. */
function seedOf(id: string): number {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 9973;
}

// ---------- Войска ----------

/**
 * Путь похода: пройденное — тусклой чертой, оставшееся — пунктиром следов к цели, бегущим по времени (а не
 * по счётчику кадров: после ухода с карты и возврата дорожка не прыгает). Две линии на отряд — те же, что
 * у прежнего кадра; здесь только чернила и светлая сердцевина, как у пути на карте кампании.
 */
function drawRoute(ctx: CanvasRenderingContext2D, fx: number, fy: number, px: number, py: number, tx: number, ty: number, color: string, now: number, trim = 0): void {
  // Концы пути — у кольца значка места, а не в его середине: линия не перечёркивает рисунок города.
  if (trim > 0) {
    [fx, fy] = cut(fx, fy, px, py, trim);
    [tx, ty] = cut(tx, ty, px, py, trim);
  }
  // Следы бегут к цели по часам — путь движется сам.
  motion.live = true;
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

/** Точка `a`, сдвинутая к `b` на `by` (не дальше середины пути). */
function cut(ax: number, ay: number, bx: number, by_: number, by: number): [number, number] {
  const dx = bx - ax;
  const dy = by_ - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [ax, ay];
  const k = Math.min(by, len / 2) / len;
  return [ax + dx * k, ay + dy * k];
}

/** Полрадиуса значка крепости на масштабе — сколько отрезать у концов пути. */
const routeTrim = (scale: number): number => markPx(scale, 4, false) / 2 + 2;

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

/**
 * Срок до прихода над отрядом — пилюлей нового вида (docs/ui_audit.md, 13): тёмная плашка с кромкой цвета стороны
 * (чужой — красной, свой — золотой), светлые цифры. Пилюля испечена (`labels.timerSprite`), в кадре пишется только
 * строка — как и прежде. Точка `y` — низ пилюли.
 */
function drawTimer(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, dpr: number): void {
  const ours = color === OWN;
  const p = timerSprite(timerWidth(timerTextWidth(text)), ours, dpr);
  // Сроки соседних отрядов не ложатся друг на друга: занятое место — выше на пилюлю (не дальше трёх ступеней).
  let top = y - p.h;
  // Значки мест и меток срок тоже не закрывает: пилюля над отрядом у стены ложилась на город.
  const blocked = (b: Box): boolean => overlaps(b, timers) || overlaps(b, places);
  for (let i = 0; i < 3 && blocked({ x0: x - p.w / 2, y0: top, x1: x + p.w / 2, y1: top + p.h }); i++) top -= p.h + 1;
  timers.push({ x0: x - p.w / 2, y0: top, x1: x + p.w / 2, y1: top + p.h });
  ctx.drawImage(p.canvas, x - p.w / 2, top, p.w, p.h);
  ctx.font = TIMER_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Цифры — светлые, с оттенком стороны: на тёмной пилюле читаются и днём, и в ночь.
  ctx.fillStyle = ours ? '#f7e6bd' : '#ffdcd3';
  ctx.fillText(text, x, top + p.h / 2 + 0.5);
}

function drawHosts(ctx: CanvasRenderingContext2D, cam: Camera, items: HostItem[], dpr: number, now: number): void {
  const px = cam.scale;
  const withTimer = px >= LABEL_FROM;
  for (const it of items) {
    const { m, look, sx, sy, fx, fy, tx, ty, standing, angle, body } = it;
    if (!standing) drawRoute(ctx, fx, fy, sx, sy, tx, ty, look.color, now, routeTrim(px));
    // Вблизи идущий отряд — колонна со знаменем впереди (`alive.ts`), издали — прежний значок; между — перетекают.
    const col = standing ? 0 : columnAlpha(px);
    if (col < 1) {
      ctx.globalAlpha = 1 - col;
      blit(ctx, markSprite(it.mark, it.d, dpr), sx, sy);
      ctx.globalAlpha = 1;
    }
    if (col > 0 && drawColumn(ctx, sx, sy, angle, look.size, look.color, px, dpr, col, seedOf(m.id), marchArms(m, ownArms()))) motion.decor = true;
    busy.push(body);
    if (!standing) {
      // Впереди значка — не на нём: шеврон у кольца показывает, куда идёт отряд, и издали.
      const lead = it.d / 2 + 6;
      drawChevron(ctx, sx + Math.cos(angle) * lead, sy + Math.sin(angle) * lead, angle, Math.max(5, Math.min(8, it.d * 0.22)), look.color);
    }
    if (!withTimer && !m.hostile) continue;
    motion.clock = true;
    const text = realLeft(secondsLeft(m.arriveAt, now));
    marks.push(() => drawTimer(ctx, text, sx, body.y0 - 3, look.color, dpr));
  }
}

// ---------- Агенты ----------

function drawFigures(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, items: FigureItem[], picked: string | null, dpr: number, now: number): void {
  const px = cam.scale;
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
      ctx.strokeStyle = sideRgba(true, 0.6);
      ctx.beginPath();
      // Обзор — от настоящей клетки агента, а не от точки рисунка у ворот (`scene.atGate`).
      ctx.arc(rx, ry, f.sight * px, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    if (f.phase === 'moving') {
      const [fx, fy] = toScreen(cam, vp, f.from.x + 0.5, f.from.y + 0.5);
      drawRoute(ctx, fx, fy, hx, py, tx, ty, OWN, now, routeTrim(px));
      const text = realLeft(secondsLeft(f.arriveAt, now));
      marks.push(() => drawTimer(ctx, text, tx, ty - 8, OWN, dpr));
    }
    if (it.hostMark && it.hostBox) {
      // Войско полководца в пути — колонной за ним, как поход (`alive.ts`); стоящее — значком.
      const col = f.phase === 'moving' && it.host ? columnAlpha(px) : 0;
      if (col < 1) {
        ctx.globalAlpha = 1 - col;
        blit(ctx, markSprite(it.hostMark, it.hostD, dpr), hx, py);
        ctx.globalAlpha = 1;
      }
      if (col > 0 && it.host && drawColumn(ctx, hx, py, Math.atan2(ty - py, tx - hx), it.host.size, it.host.color, px, dpr, col, seedOf(f.id), armsCode(armsOr(ownArms())))) {
        motion.decor = true;
      }
      busy.push(it.hostBox);
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
    if (f.energy) drawEnergy(ctx, ax, py, unit, f.energy.value / f.energy.max, f.spent);
  }
}

/**
 * Энергия у значка агента (docs/agent_energy.md): тонкая полоска под ногами — сколько осталось. Цвет — своей стороны
 * (`side.ts`: красный — только враг); выбившийся из сил — бледнее: идёт домой и дел не берёт.
 */
function drawEnergy(ctx: CanvasRenderingContext2D, x: number, y: number, unit: number, share: number, spent: boolean): void {
  const w = Math.max(14, Math.min(28, unit * 0.5));
  const h = 3;
  const top = y + 3;
  const k = Math.max(0, Math.min(1, share));
  ctx.save();
  ctx.fillStyle = 'rgba(10, 8, 6, 0.75)';
  ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, h + 2);
  ctx.fillStyle = sideRgba(true, spent ? 0.45 : 0.95);
  ctx.fillRect(x - w / 2, top, w * k, h);
  ctx.restore();
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

/**
 * Чьё имя важнее: своё — первым и не уступает никому; дальше живые соседи — крупные раньше мелких (Сицилия: двенадцать
 * городов в 5,8–6 клетках друг от друга, docs/test_world.md, — на 7 px на клетку 40.6–42 px, и все имена не лягут);
 * логова и пепелища — последними.
 */
function labelRank(it: PlaceItem): number {
  if (it.s.mine) return 100;
  if (it.s.ruin) return 0;
  return (it.s.relation === 'barbarian' ? 10 : 20 + (it.look.kind === 'castle' ? 10 : 0)) + it.mark.pips;
}

/**
 * Где искать место подписи у значка: под ним, над ним, справа, слева, наискось — первое свободное. Подписи не ложатся ни на
 * значки мест и отрядов, ни на метки, ни на сроки походов, ни друг на друга; не нашлось места — имя уступает (своё не
 * уступает никогда и ложится туда, где закроет меньше всего, — `leastCovered`).
 */
function labelSpots(b: Box, sx: number, sy: number, w: number, h: number): Box[] {
  const below = (x0: number): Box => ({ x0, y0: b.y1 + 2, x1: x0 + w, y1: b.y1 + 2 + h });
  const above = (x0: number): Box => ({ x0, y0: b.y0 - 2 - h, x1: x0 + w, y1: b.y0 - 2 });
  return [
    below(sx - w / 2),
    above(sx - w / 2),
    { x0: b.x1 + 3, y0: sy - h / 2, x1: b.x1 + 3 + w, y1: sy + h / 2 },
    { x0: b.x0 - 3 - w, y0: sy - h / 2, x1: b.x0 - 3, y1: sy + h / 2 },
    // Наискось — край подписи у середины значка: имя проскальзывает мимо соседа, не отрываясь от своего места.
    below(sx - w * 0.15),
    below(sx - w * 0.85),
    above(sx - w * 0.15),
    above(sx - w * 0.85),
  ];
}

/** Место, где подпись закроет меньше всего чужого: первое из равных — порядок мест тот же, что у `labelSpots`. */
function leastCovered(spots: Box[], taken: Box[]): Box {
  let best = spots[0];
  let least = Infinity;
  for (const b of spots) {
    const n = taken.filter((t) => b.x0 < t.x1 && b.x1 > t.x0 && b.y0 < t.y1 && b.y1 > t.y0).length;
    if (n < least) {
      least = n;
      best = b;
    }
  }
  return best;
}

const onScreen = (b: Box, vp: Viewport): boolean => b.x0 >= 2 && b.x1 <= vp.w - 2 && b.y0 >= TOP_INSET && b.y1 <= vp.h - 2;

function drawLabels(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, items: PlaceItem[], dpr: number, now: number): Box[] {
  // Занято до подписей: значки мест, значки отрядов, метки и сроки.
  const taken: Box[] = [...items.map((it) => it.body), ...busy, ...timers];
  const order = [...items].sort((a, b) => labelRank(b) - labelRank(a));
  for (const it of order) {
    const { s, sx, sy, body } = it;
    if (sx < -40 || sx > vp.w + 40 || body.y1 < -20 || body.y1 > vp.h + 20) continue;
    // Свой значок подписи не мешает: подпись ищет место вокруг него, а не поверх.
    const others = taken.filter((t) => t !== body);
    let under = body.y1 + 2;
    if (namedAt(it, cam.scale)) {
      const l = labelSprite(fitName(s.name, s.mine), s.mine, dpr, it.look.color);
      const spots = labelSpots(body, sx, sy, l.w, l.h);
      const box = spots.find((b) => onScreen(b, vp) && !overlaps(b, others)) ?? (s.mine ? leastCovered(spots, others) : null);
      if (box) {
        taken.push(box);
        ctx.drawImage(l.canvas, box.x0, box.y0, l.w, l.h);
        if (box === spots[0]) under = box.y1 + 1;
      }
    }
    // Знак участи павшего — под именем или под значком; он важнее имени и ложится, даже если имя уступило соседу.
    if (cam.scale >= LABEL_FROM && fellShown(s.fell, now)) {
      // Знак участи сходит по часам мира.
      motion.clock = true;
      const p = fellSprite(s.fell.fate, FELL_WORDS[s.fell.fate], dpr);
      const box: Box = { x0: sx - p.ax, y0: under - p.ay, x1: sx - p.ax + p.w, y1: under - p.ay + p.h };
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
    // Имена морей и гор — своего региона: имя за границей легло бы на лист старой карты.
    if (!withinActive(Math.floor(r.x), Math.floor(r.y))) continue;
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
  // Выбранное — цветом действия нового вида (`--accent`, он же цвет своей стороны, `side.ts`), как рамка выбранной
  // ячейки в интерфейсе (docs/ui_audit.md, 3.8).
  ctx.strokeStyle = OWN;
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

/**
 * Один кадр нового вида. Снизу вверх: пергамент → земля региона (грубый растр, обзор, средний слой, тайлы) →
 * владения → сетка (вблизи) → места → туман и лист за границей → бумага → походы → агенты → подписи → метка лупы →
 * выбранная клетка. Выпечки в кадре нет: работы уходят рабочему потоку (`prebakeFrame`), а без потока страница
 * печёт свою долю после кадра и только стоя (`prebakeIdle`).
 */
export function drawTwFrame(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number, frame: number): FrameMotion {
  motion.busy = false;
  motion.live = false;
  motion.decor = false;
  motion.clock = false;
  const rect = viewRect(cam, vp);
  const near = detailAlpha(cam.scale);
  const state = useWorld.getState();
  const now = worldNow();

  prebakeFrame(cam, vp, frame);
  const ground = prebaked();
  // Под всем — пергамент: за краем испечённого не пустота, а лист старой карты.
  ctx.fillStyle = TW.parchment;
  ctx.fillRect(0, 0, vp.w, vp.h);
  const gaps = ground ? drawGround(ctx, cam, vp, rect, ground) : 0;
  if (PROBE) shownGaps(gaps);
  // Прибой у берегов (`alive.ts`): над землёй, под владениями, туманом и ночью; берег выводится стоя, кусками.
  const surf = drawSurf(ctx, cam, vp, ground, !moving());
  if (surf === 'waves') motion.decor = true;
  if (surf === 'baking') motion.busy = true;
  // Владения — тоньше прежних, с чертой границы по краю (`tw/zones.ts`); под туманом, как и прежде. Растр — над
  // рамкой региона и заново только при новых данных и стоя.
  drawTwZones(ctx, cam, vp, now, ground ? { rect: ground.plan.reach, stamp: ground.dataGen, may: !moving() } : undefined);
  // Сетка координат — только вблизи и тоньше прежней: по ней прыгают к «541|822», а издали она — решётка
  // поверх карты кампании.
  drawGrid(ctx, cam, vp, near * 0.6, TOP_INSET);

  marks.length = 0;
  timers.length = 0;
  busy.length = 0;
  const items = placeItems(cam, vp, settlementsIn(placesRect(rect)), dpr, ownArms());
  places.length = 0;
  for (const it of items) places.push(it.body);
  smokes.length = 0;
  drawPlaces(ctx, cam, items, dpr, now, markersOf(state.marches));
  for (const sm of smokes) if (drawSmoke(ctx, sm.x, sm.y, cam.scale, sm.weight, sm.seed)) motion.decor = true;
  // Облака и их тени — погода региона (docs/city.md, 15): над землёй и местами, под листом за границей региона.
  if (drawClouds(ctx, cam, vp, nightNow())) motion.decor = true;

  // Незнакомое — лист старой карты (своё неразведанное и чужой регион), разведанное вне обзора — сепия
  // (`tw/fog.ts`): поверх мест, под всем, что движется, — как прежний туман.
  drawTwFog(ctx, cam, vp, ground);
  drawPaper(ctx, vp);

  // Живой обзор — один раз на кадр, тем же модулем, что у мира (`world/sight` через `sightDiscs`).
  const discs = sightDiscs(now);
  drawHosts(ctx, cam, hostItems(cam, vp, state.marches, discs, now, dpr), dpr, now);
  drawFigures(ctx, cam, vp, figureItems(cam, vp, state.figures, now, dpr), state.picked, dpr, now);

  // Ночь — по часам партии, как у сцены города (`tw/night.ts`); подписи и сроки — поверх неё.
  const night = nightNow();
  drawNight(ctx, vp.w, vp.h, cam.scale, items, night, dpr);
  // Огни осадного лагеря — поверх ночи: их и видно только ночью.
  for (const sm of smokes) if (sm.siege && drawCampFires(ctx, sm.x, sm.y, cam.scale, night, sm.seed)) motion.decor = true;
  for (const draw of marks) draw();
  marks.length = 0;

  drawRegions(ctx, cam, vp, dpr, drawLabels(ctx, cam, vp, items, dpr, now));

  // Метка лупы и выбранная клетка — только в своём регионе: за его границей лист, и метки там нечему держать.
  if (state.spotlight && withinActive(state.spotlight.x, state.spotlight.y)) {
    drawSpot(ctx, cam, vp, state.spotlight, now);
    // Пульс лупы расходится кругами сам.
    motion.live = true;
  }
  if (state.selected && withinActive(state.selected.x, state.selected.y)) drawSelected(ctx, cam, vp, state.selected);

  // Страница без рабочего потока печёт свою долю — после кадра и только стоя.
  prebakeIdle();
  // Пока камеру ведут, карта и так рисует каждый кадр — очередь выпечки второй раз за кадр не перебирается.
  if (!moving() && prebakeBusy()) motion.busy = true;
  return { ...motion };
}

/**
 * Что кадр читает из партии — одной строкой: ночь (`nightNow`), гости у ворот (`gateBadges`), погода облаков
 * (`drawClouds`) и сезон выпечки (`hook.syncLook`). Стоящая карта будится, когда строка сменилась (`WorldMap`,
 * `still.ts`), а не на каждом шаге племени — он дважды в секунду кладёт в стор свежую партию. Новое чтение партии в
 * кадре дописывается сюда же: иначе стоящая карта увидит его только к страховочному сроку (`still.IDLE_MS`).
 */
export function partyLook(): string {
  const s = useGame.getState().s;
  if (!s) return '';
  const w = weatherNow(s);
  const q = (x: number): number => Math.round(x * 50);
  return [Math.round(nightNow() * 100), gateBadges().join(','), seasonOf(s.time), q(w.cloud), q(w.rain), q(w.snow), q(w.storm)].join('|');
}

export function dropFrame(): void {
  fitted.clear();
  dropAlive();
  dropNight();
  dropClouds();
  dropTwZones();
}
