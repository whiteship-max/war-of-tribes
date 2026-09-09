// Агенты на карте: четыре разных человека, узнаваемых силуэтом.
//
// Устроено ровно как отряды (`party.ts`), и по той же причине — **закон кадра**:
// чистая часть (`agentKey`, `agentBucket`, `agentUnit`, `fanOffsets`,
// `agentIdle`) без canvas, выпечка (`bakeAgent`) на смене вида, направления и
// корзины, кадр — один `drawImage` на фигуру и один на её подпись.
//
// ---------------------------------------------------------------------------
// Различаются **силуэтом**, а не цветом и не значком в одинаковом кружке.
//
// Раньше здесь стояли четыре одинаковых кружка с эмодзи внутри, и это ровно та
// ошибка, которую мы уже проходили на значках: цвет у нас занят стороной (свои —
// золото, чужие — красное, `palette.ts`), и вешать на него второе значение
// нельзя, а глиф в кружке на двадцати пикселях читается пятном. Поэтому все
// четыре — одного цвета, а различает их форма, и различает грубо, чтобы
// работать на самом мелком масштабе:
//
//   * разведчик — низкий, наклонён вперёд, **шире всего в шляпе**;
//   * дипломат — **колокол**: подол до земли, шире всего у ног;
//   * лазутчик — **узкий шип**: плащ в обтяжку и остроконечный капюшон;
//   * полководец — **высокий**: широкие плечи, гребень на шлеме, меч у ноги.
//
// Проверка простая: если фигуру залить одной краской, четыре пятна обязаны
// остаться различимыми. Отсюда и запрет на «отличим лицом» или «отличим оружием
// в руке» — на двадцати пикселях этого нет.
//
// Стороны у ключа выпечки нет, и это не упущение: чужих фигур на карте не
// бывает вовсе (мир отдаёт только своих агентов), а писать код под сторону,
// которой нет, — это заводить вторую правду заранее.
import type { FigureId, FigurePhase } from '@/world/types';
import { PARTY_OWN, TOKEN } from './palette';

type C = CanvasRenderingContext2D;

const TAU = Math.PI * 2;
/** То же сплющивание, что у отрядов и поселений: карта смотрит почти сверху. */
const SQUASH = 0.62;
/** Толщина контура в долях клетки — она и держит силуэт на мелком масштабе. */
const LINE = 0.022;

// ---------- Чистая часть ----------

export interface AgentLook {
  kind: FigureId;
  /** Идёт влево: силуэт печётся зеркально. У стоящего всегда `false`. */
  west: boolean;
}

export const agentKey = (l: AgentLook, bucket: number, dpr: number): string =>
  `${l.kind}|${l.west ? 1 : 0}|${bucket}|${dpr}`;

/**
 * Корзины размера — в **экранных** пикселях на клетку, и лестница у них своя, не
 * та, что у отрядов. Причина: агент обязан быть виден и на пиксельном обзоре,
 * где клетка семь пикселей, а отряд там сходится к наконечнику хода. Поэтому
 * агент рисуется не «в долях клетки», а в долях `agentUnit` — клетки,
 * прижатой к разумному разбегу.
 */
export const AGENT_BUCKETS: number[] = [26, 34, 44, 54];

export const AGENT_MIN = AGENT_BUCKETS[0];
export const AGENT_MAX = AGENT_BUCKETS[AGENT_BUCKETS.length - 1];

/**
 * Во сколько пикселей рисовать агента при таком масштабе. Отдалили карту —
 * фигура не тает вместе с землёй: она и есть то, ради чего на карту смотрят.
 * Приблизили — не раздувается в полэкрана.
 */
export const agentUnit = (scale: number): number => Math.max(AGENT_MIN, Math.min(AGENT_MAX, scale));

export function agentBucket(px: number): number {
  for (const b of AGENT_BUCKETS) if (b >= px) return b;
  return AGENT_MAX;
}

/**
 * Фигуры, стоящие на одной клетке, разводятся в стороны — иначе четверо дома
 * рисуются друг в друге и видно одного. Возвращает смещение каждой в долях
 * `agentUnit`, симметрично относительно клетки; одиночка не смещается вовсе.
 *
 * Ключ — клетка, а не экранная точка: разъезжаться и съезжаться от щипка фигуры
 * не должны.
 */
export function fanOffsets(cells: string[]): number[] {
  const total = new Map<string, number>();
  for (const c of cells) total.set(c, (total.get(c) ?? 0) + 1);
  const seen = new Map<string, number>();
  return cells.map((c) => {
    const n = total.get(c) ?? 1;
    const i = seen.get(c) ?? 0;
    seen.set(c, i + 1);
    return n === 1 ? 0 : (i - (n - 1) / 2) * FAN_STEP;
  });
}

/** Шаг разведения. Чуть шире фигуры: силуэты не должны касаться друг друга. */
export const FAN_STEP = 0.62;

/**
 * Свободен ли агент — то есть **требует ли он внимания**. Дошёл и стоит без
 * дела, приказ отработан, наблюдать не поставлен. Это единственное, что
 * свёрнутая панель агентов обязана сообщать не открываясь.
 *
 * Наблюдающий лазутчик занят: он именно этим и занят, и дёргать его незачем.
 */
export function agentIdle(
  f: { phase: FigurePhase; busyUntil: number; watching: boolean },
  now: number,
): boolean {
  if (f.phase === 'down' || f.phase === 'moving') return false;
  if (f.watching) return false;
  return f.busyUntil <= now;
}

// ---------- Габариты ----------

/**
 * Спрайт занимает 0.64×0.94 единицы, точка привязки — та, где агент стоит на
 * земле. Вверх места больше: там гребень, шляпа и меч.
 */
const SPAN_W = 0.64;
const SPAN_H = 0.94;
const ANCHOR_X = 0.32;
const ANCHOR_Y = 0.84;

export interface AgentSprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  ax: number;
  ay: number;
  /** Единица, под которую выпечено: копию растягивают из неё. */
  unit: number;
}

// ---------- Кисти ----------

const P = PARTY_OWN;

/** Пятно на земле: без него фигура висит в воздухе. */
function shadow(ctx: C, x: number, r: number): void {
  ctx.fillStyle = P.shade;
  ctx.beginPath();
  ctx.ellipse(x, 0, r, r * SQUASH * 0.5, 0, 0, TAU);
  ctx.fill();
}

/** Контур: он держит силуэт там, где фигура мельче двадцати пикселей. */
function outline(ctx: C): void {
  ctx.strokeStyle = P.line;
  ctx.lineWidth = LINE;
  ctx.stroke();
}

function head(ctx: C, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = P.steel;
  ctx.fill();
  outline(ctx);
}

/**
 * Разведчик: низкий, наклонён вперёд, широкополая шляпа. Шляпа и есть его
 * силуэт — единственная фигура, которая шире всего в голове.
 */
function scout(ctx: C, dir: number): void {
  shadow(ctx, 0, 0.13);
  const lean = dir * 0.07;

  // Посох вперёд — им и меряют брод. Он же второй признак наклона.
  ctx.strokeStyle = P.shaft;
  ctx.lineWidth = LINE * 1.5;
  ctx.beginPath();
  ctx.moveTo(dir * 0.17, 0.01);
  ctx.lineTo(dir * 0.07, -0.46);
  ctx.stroke();

  // Шаг: ноги врозь, задняя отстала.
  ctx.strokeStyle = P.line;
  ctx.lineWidth = LINE * 1.7;
  ctx.beginPath();
  ctx.moveTo(lean * 0.5, -0.17);
  ctx.lineTo(dir * 0.11, 0);
  ctx.moveTo(lean * 0.5, -0.17);
  ctx.lineTo(-dir * 0.1, -0.01);
  ctx.stroke();

  // Короткая куртка, а не плащ: он ходит быстро и налегке. Тело плотное —
  // иначе под широкой шляпой не остаётся фигуры, и силуэт читается лампой.
  ctx.beginPath();
  ctx.moveTo(-0.105, -0.14);
  ctx.lineTo(lean - 0.1, -0.4);
  ctx.lineTo(lean + 0.1, -0.4);
  ctx.lineTo(0.105, -0.14);
  ctx.closePath();
  ctx.fillStyle = P.cloth;
  ctx.fill();
  outline(ctx);

  head(ctx, lean * 1.15, -0.45, 0.05);

  // Шляпа: плоский широкий эллипс. Полтора корпуса в ширину — на любом
  // масштабе это первое, что видно.
  ctx.beginPath();
  ctx.ellipse(lean * 1.15, -0.475, 0.16, 0.038, 0, 0, TAU);
  ctx.fillStyle = P.clothDark;
  ctx.fill();
  outline(ctx);
}

/**
 * Дипломат: подол до земли, шире всего у ног. Ног не видно вовсе — он не ходит,
 * он приезжает. Свиток поперёк груди — единственная его подробность.
 */
function diplomat(ctx: C, dir: number): void {
  shadow(ctx, 0, 0.16);

  ctx.beginPath();
  ctx.moveTo(-0.225, 0);
  ctx.lineTo(-0.085, -0.42);
  ctx.lineTo(0.085, -0.42);
  ctx.lineTo(0.225, 0);
  ctx.closePath();
  ctx.fillStyle = P.cloth;
  ctx.fill();
  outline(ctx);

  // Теневая половина подола: объём без градиента — градиент дорог и при выпечке.
  ctx.beginPath();
  ctx.moveTo(dir * 0.03, 0);
  ctx.lineTo(dir * 0.02, -0.42);
  ctx.lineTo(dir * 0.085, -0.42);
  ctx.lineTo(dir * 0.225, 0);
  ctx.closePath();
  ctx.fillStyle = P.clothDark;
  ctx.fill();

  // Свиток: светлая поперечина. Горизонталь на вертикальном силуэте видна
  // раньше, чем разбирается, что это.
  ctx.beginPath();
  ctx.moveTo(-0.115, -0.27);
  ctx.lineTo(0.115, -0.27);
  ctx.strokeStyle = P.tent;
  ctx.lineWidth = LINE * 2.6;
  ctx.stroke();

  head(ctx, 0, -0.48, 0.055);
}

/**
 * Лазутчик: узкий шип. Плащ в обтяжку, остроконечный капюшон вместо головы,
 * шеи нет. Самая маленькая фигура из четырёх — он и должен теряться взглядом.
 */
function spy(ctx: C, dir: number): void {
  shadow(ctx, 0, 0.11);

  // Плащ в обтяжку, и **несимметричный**: за спиной он тянется хвостом. Это и
  // разводит его с дипломатом на мелком масштабе — там оба сводятся к
  // треугольнику, и различает их только то, что у одного треугольник ровный, а
  // у другого завален назад.
  ctx.beginPath();
  ctx.moveTo(-dir * 0.155, 0.01);
  ctx.lineTo(-dir * 0.062, -0.29);
  ctx.lineTo(dir * 0.062, -0.29);
  ctx.lineTo(dir * 0.075, 0);
  ctx.closePath();
  ctx.fillStyle = P.clothDark;
  ctx.fill();
  outline(ctx);

  // Капюшон: остриё завалено вперёд — он сгорблен и смотрит из-под него.
  ctx.beginPath();
  ctx.moveTo(-dir * 0.075, -0.26);
  ctx.lineTo(dir * 0.075, -0.5);
  ctx.lineTo(dir * 0.072, -0.27);
  ctx.closePath();
  ctx.fillStyle = P.cloth;
  ctx.fill();
  outline(ctx);

  // Тень под капюшоном: лица нет и быть не должно.
  ctx.beginPath();
  ctx.ellipse(dir * 0.025, -0.3, 0.032, 0.026, 0, 0, TAU);
  ctx.fillStyle = P.mass;
  ctx.fill();
}

/**
 * Полководец: высокий, плечи широкие, гребень на шлеме, меч у ноги. Меч, а не
 * копьё, — нарочно: копья носит колонна за его спиной, и повторять её древко
 * значило бы потерять вожака в собственном войске.
 */
function general(ctx: C, dir: number): void {
  shadow(ctx, 0, 0.15);

  // Меч раньше тела: он стоит у ноги, а не лежит на груди.
  ctx.strokeStyle = P.steel;
  ctx.lineWidth = LINE * 1.6;
  ctx.beginPath();
  ctx.moveTo(dir * 0.185, -0.04);
  ctx.lineTo(dir * 0.185, -0.5);
  ctx.stroke();
  // Крестовина — она и отличает меч от древка на десяти пикселях.
  ctx.strokeStyle = P.shaft;
  ctx.lineWidth = LINE * 1.8;
  ctx.beginPath();
  ctx.moveTo(dir * 0.135, -0.44);
  ctx.lineTo(dir * 0.235, -0.44);
  ctx.stroke();

  ctx.strokeStyle = P.line;
  ctx.lineWidth = LINE * 1.9;
  ctx.beginPath();
  ctx.moveTo(-0.06, -0.21);
  ctx.lineTo(-0.095, 0);
  ctx.moveTo(0.06, -0.21);
  ctx.lineTo(0.095, 0);
  ctx.stroke();

  // Плечи вдвое шире пояса: этим он и отличается от всех остальных.
  ctx.beginPath();
  ctx.moveTo(-0.1, -0.19);
  ctx.lineTo(-0.165, -0.52);
  ctx.lineTo(0.165, -0.52);
  ctx.lineTo(0.1, -0.19);
  ctx.closePath();
  ctx.fillStyle = P.cloth;
  ctx.fill();
  outline(ctx);

  ctx.beginPath();
  ctx.moveTo(dir * 0.03, -0.19);
  ctx.lineTo(dir * 0.04, -0.52);
  ctx.lineTo(dir * 0.165, -0.52);
  ctx.lineTo(dir * 0.1, -0.19);
  ctx.closePath();
  ctx.fillStyle = P.clothDark;
  ctx.fill();

  head(ctx, 0, -0.575, 0.05);

  // Гребень: он и делает силуэт выше всех прочих — на две головы выше
  // дипломата, и это видно даже там, где сам шлем уже пятно.
  ctx.beginPath();
  ctx.moveTo(-0.062, -0.6);
  ctx.quadraticCurveTo(0, -0.79, 0.062, -0.6);
  ctx.closePath();
  ctx.fillStyle = P.cloth;
  ctx.fill();
  outline(ctx);
}

// ---------- Выпечка ----------

export function bakeAgent(look: AgentLook, unit: number, dpr: number): AgentSprite {
  const w = SPAN_W * unit;
  const h = SPAN_H * unit;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  const ctx = canvas.getContext('2d');
  const sprite: AgentSprite = { canvas, w, h, ax: ANCHOR_X * unit, ay: ANCHOR_Y * unit, unit };
  if (!ctx) return sprite;

  const u = unit * dpr;
  ctx.setTransform(u, 0, 0, u, ANCHOR_X * u, ANCHOR_Y * u);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const dir = look.west ? -1 : 1;
  switch (look.kind) {
    case 'scout':
      scout(ctx, dir);
      break;
    case 'diplomat':
      diplomat(ctx, dir);
      break;
    case 'spy':
      spy(ctx, dir);
      break;
    case 'general':
      general(ctx, dir);
      break;
  }
  return sprite;
}

const cache = new Map<string, AgentSprite>();
/** Четыре вида на два направления — восемь на корзине; дюжина держит и щипок. */
const CACHE_MAX = 12;

export function agentSprite(look: AgentLook, px: number, dpr: number): AgentSprite {
  const bucket = agentBucket(px);
  const key = agentKey(look, bucket, dpr);
  const have = cache.get(key);
  if (have) {
    cache.delete(key);
    cache.set(key, have);
    return have;
  }
  const made = bakeAgent(look, bucket, dpr);
  cache.set(key, made);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return made;
}

/** Кадр: одно копирование. cx, cy — где агент стоит на земле, в CSS-пикселях. */
export function drawAgent(ctx: C, look: AgentLook, px: number, dpr: number, cx: number, cy: number): void {
  const sp = agentSprite(look, px, dpr);
  const k = px / sp.unit;
  ctx.drawImage(sp.canvas, cx - sp.ax * k, cy - sp.ay * k, sp.w * k, sp.h * k);
}

// ---------- Подпись ----------

/**
 * Имя агента — тоже спрайт, а не `fillText` за кадр. Раскладка текста в браузере
 * стоит дороже копирования картинки, а имён всего четыре и меняться они не
 * умеют вовсе.
 *
 * Кегль постоянный в экранных пикселях: подпись отвечает на «кто это», а не на
 * «как далеко» — расти вместе с масштабом ей незачем.
 */
const LABEL_FONT = '11px system-ui, sans-serif';
export const LABEL_H = 15;
const LABEL_PAD = 4;

export interface LabelSprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

const labels = new Map<string, LabelSprite>();
const LABEL_MAX = 8;

function bakeLabel(text: string, dpr: number): LabelSprite {
  const probe = document.createElement('canvas').getContext('2d');
  let width = text.length * 6;
  if (probe) {
    probe.font = LABEL_FONT;
    width = probe.measureText(text).width;
  }
  const w = width + LABEL_PAD * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(LABEL_H * dpr));
  const ctx = canvas.getContext('2d');
  const sprite: LabelSprite = { canvas, w, h: LABEL_H };
  if (!ctx) return sprite;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = TOKEN.textEdge;
  ctx.strokeText(text, w / 2, LABEL_H / 2);
  ctx.fillStyle = TOKEN.glyph;
  ctx.fillText(text, w / 2, LABEL_H / 2);
  return sprite;
}

export function labelSprite(text: string, dpr: number): LabelSprite {
  const key = `${text}|${dpr}`;
  const have = labels.get(key);
  if (have) {
    labels.delete(key);
    labels.set(key, have);
    return have;
  }
  const made = bakeLabel(text, dpr);
  labels.set(key, made);
  if (labels.size > LABEL_MAX) {
    const oldest = labels.keys().next().value;
    if (oldest !== undefined) labels.delete(oldest);
  }
  return made;
}

export function dropAgents(): void {
  cache.clear();
  labels.clear();
}
