// Спрайты карты нового вида, что лежат на земле, а не стоят на ней значком (docs/map_tw.md, разделы 4 и 14): осадные
// работы вокруг осаждённого места (ров и два ряда рогаток) и знак участи павшего города; общий кэш спрайтов по
// корзинам масштаба и виды мест и войск, по которым сцена выбирает значок (`tw/scene.ts`) и ночь — огонь (`tw/night.ts`).
// Места, отряды и лагеря рисуются значками нового интерфейса (`tw/marks.ts`); прежние миниатюры-макеты, щитки дальнего
// масштаба и стяги убраны вместе с галереей стенда (решение владельца, раздел 14.4).
//
// Пути — только здесь, при выпечке спрайта (закон кадра, docs/world-map.md): спрайт печётся один раз на вид и корзину,
// в кадре — одно копирование. Единица рисования — клетка: холст масштабируется на пиксели клетки, и формы не зависят
// от размера.
import type { Fate, Stage } from '@/world/types';
import { makeCanvas } from '../paint';
import { FRONT_R, FRONT_STAKES, REAR_R, REAR_STAKES, stakeOrder, stakesAt } from '../siegemark';

type C = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
/** Косой взгляд сверху: круг на земле — эллипс. Тот же, что у прежних поселений (`village.SQUASH`). */
const SQUASH = 0.62;
/** Золото знака участи — светлое золото стороны. */
const GOLD_LIT = '#f4cf78';

// ---------- Примитивы ----------

function ell(ctx: C, x: number, y: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(1e-4, rx), Math.max(1e-4, ry), 0, 0, TAU);
}

function line(ctx: C, x0: number, y0: number, x1: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

// ---------- Осадные работы ----------

const WORK = {
  ditch: 'rgba(84, 62, 38, 0.66)',
  ditchEdge: 'rgba(46, 32, 20, 0.6)',
  bank: 'rgba(196, 168, 116, 0.8)',
  bankShade: 'rgba(70, 52, 32, 0.45)',
  front: '#d8b47a',
  rear: '#9c7040',
  line: '#2a1c10',
};

/** Ров с валом: тёмная полоса под обоими рядами и светлая насыпь снаружи — «город обложен» с первой минуты. */
function ditch(ctx: C): void {
  const inner = FRONT_R - 0.1;
  const outer = REAR_R + 0.1;
  ctx.beginPath();
  ctx.ellipse(0, 0, outer, outer * SQUASH, 0, 0, TAU);
  ctx.ellipse(0, 0, inner, inner * SQUASH, 0, 0, TAU, true);
  ctx.fillStyle = WORK.ditch;
  ctx.fill('evenodd');
  ctx.lineWidth = 0.04;
  ctx.strokeStyle = WORK.ditchEdge;
  ell(ctx, 0, 0, inner, inner * SQUASH);
  ctx.stroke();
  ctx.strokeStyle = WORK.bankShade;
  ctx.lineWidth = 0.07;
  ell(ctx, 0.01, 0.012, outer + 0.04, (outer + 0.04) * SQUASH);
  ctx.stroke();
  ctx.strokeStyle = WORK.bank;
  ctx.lineWidth = 0.055;
  ell(ctx, 0, 0, outer + 0.03, (outer + 0.03) * SQUASH);
  ctx.stroke();
}

/** Рогатка: два кола накрест поперёк кольца, верхушки клонятся `lean` (плюс — в поле, минус — к городу). */
function cross(ctx: C, x: number, y: number, a: number, lean: number, body: string): void {
  const tx = -Math.sin(a);
  const ty = Math.cos(a) * SQUASH;
  const tl = Math.hypot(tx, ty) || 1;
  const ux = (tx / tl) * 0.1;
  const uy = (ty / tl) * 0.1;
  const rx = Math.cos(a) * lean;
  const ry = Math.sin(a) * lean * SQUASH;
  const h = 0.3;
  for (const [x0, y0, x1, y1] of [
    [x - ux, y - uy, x + ux * 1.3 + rx, y + uy * 1.3 - h + ry],
    [x + ux, y + uy, x - ux * 1.3 + rx, y - uy * 1.3 - h + ry],
  ]) {
    ctx.strokeStyle = WORK.line;
    ctx.lineWidth = 0.08;
    line(ctx, x0, y0, x1, y1);
    ctx.strokeStyle = body;
    ctx.lineWidth = 0.044;
    line(ctx, x0, y0, x1, y1);
  }
}

function worksRow(ctx: C, radius: number, n: number, step: number, lean: number, half: WorksHalf, body: string): void {
  const order = stakeOrder(n);
  const shown = stakesAt(n, step);
  const spots: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (order[i] >= shown) continue;
    const a = (i / n) * TAU + (radius === FRONT_R ? 0 : Math.PI / n);
    const y = Math.sin(a) * radius * SQUASH;
    if ((half === 'back') !== y < 0) continue;
    spots.push([Math.cos(a) * radius, y, a]);
  }
  spots.sort((p, q) => p[1] - q[1]);
  for (const [x, y, a] of spots) cross(ctx, x, y, a, lean, body);
}

function worksDraw(ctx: C, front: number, rear: number, half: WorksHalf): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (half === 'back') {
    ditch(ctx);
    worksRow(ctx, REAR_R, REAR_STAKES, rear, 0.09, half, WORK.rear);
    worksRow(ctx, FRONT_R, FRONT_STAKES, front, -0.09, half, WORK.front);
  } else {
    worksRow(ctx, FRONT_R, FRONT_STAKES, front, -0.09, half, WORK.front);
    worksRow(ctx, REAR_R, REAR_STAKES, rear, 0.09, half, WORK.rear);
  }
}

// ---------- Кэш спрайтов ----------

export interface Mini {
  canvas: HTMLCanvasElement;
  /** Где на холсте точка поселения или ног фигурки, в CSS-пикселях. */
  ax: number;
  ay: number;
  /** Размер холста в CSS-пикселях. */
  w: number;
  h: number;
}

/** Холст миниатюры в клетках: ширина, высота и где на нём точка места. */
interface Span {
  w: number;
  h: number;
  ax: number;
  ay: number;
}

/** Корзины размера клетки: спрайт не перепекается на каждом щипке, а берёт ближайшую корзину. */
export const MINI_BUCKETS = [16, 22, 30, 40, 52, 64, 80];
const bucketOf = (px: number): number => MINI_BUCKETS.find((b) => b >= px) ?? MINI_BUCKETS[MINI_BUCKETS.length - 1];

const cache = new Map<string, Mini>();

function bakeMini(span: Span, cell: number, dpr: number, draw: (ctx: C) => void): Mini {
  const w = Math.ceil(span.w * cell);
  const h = Math.ceil(span.h * cell);
  const canvas = makeCanvas(Math.ceil(w * dpr), Math.ceil(h * dpr));
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(cell * dpr, 0, 0, cell * dpr, span.ax * cell * dpr, span.ay * cell * dpr);
    ctx.lineJoin = 'round';
    draw(ctx);
  }
  return { canvas, ax: span.ax * cell, ay: span.ay * cell, w, h };
}

/**
 * Память спрайтов — по байтам, а не по штукам: рогатки на корзине 80 весят много больше знака участи.
 * Вытесняется давно не нужный (свежий — в конец).
 */
const CACHE_BYTES = 16 * 1024 * 1024;
let cacheBytes = 0;
const bytesOf = (m: Mini): number => m.canvas.width * m.canvas.height * 4;

function cached(key: string, make: () => Mini): Mini {
  const have = cache.get(key);
  if (have) {
    cache.delete(key);
    cache.set(key, have);
    return have;
  }
  const m = make();
  cache.set(key, m);
  cacheBytes += bytesOf(m);
  while (cacheBytes > CACHE_BYTES && cache.size > 1) {
    const first = cache.keys().next().value as string;
    const gone = cache.get(first);
    cache.delete(first);
    if (gone) {
      cacheBytes -= bytesOf(gone);
      gone.canvas.width = 0;
    }
  }
  return m;
}

/** Сколько байт держат спрайты миниатюр — бюджету (`docs/map_tw.md`, раздел 8). */
export const miniBytes = (): number => cacheBytes;

/** Копирование миниатюры в кадр: `px` — пикселей на клетку сейчас, спрайт растягивается из корзины. */
export function drawMini(ctx: C, m: Mini, cellPx: number, bucket: number, sx: number, sy: number): void {
  const k = cellPx / bucket;
  ctx.drawImage(m.canvas, sx - m.ax * k, sy - m.ay * k, m.w * k, m.h * k);
}

export const miniBucket = bucketOf;

export function dropMinis(): void {
  for (const m of cache.values()) m.canvas.width = 0;
  cache.clear();
  cacheBytes = 0;
}

// ---------- Виды мест и войск: договор сцены, касания и ночи ----------

/** Что за место: город или двор игрока, замок, логово, пепелище. */
export type PlaceKind = 'city' | 'castle' | 'lair' | 'ruin';

export interface PlaceLook {
  kind: PlaceKind;
  /** Размер места: стоянка, деревня, острог, крепость (`world/data/meta.stageOf`). */
  stage: Stage;
  /** Цвет стороны или отношения (`RELATION_META`): им — полоса подписи. */
  color: string;
  /** Своё поселение. */
  own: boolean;
}

/**
 * Войско на карте. `size`: 0 — слух (сколько их, неизвестно, `world/sight`), 1 — горстка, 2 — отряд, 3 — войско,
 * 4 — орда. `camp` — стоит лагерем у цели (осада, подмога). Значок по виду — `scene.hostMarkOf`.
 */
export interface HostLook {
  color: string;
  size: 0 | 1 | 2 | 3 | 4;
  west: boolean;
  camp: boolean;
}

/** Осадные работы вокруг города: ров и два ряда рогаток (`siegemark.worksStep`: 0..8 на сторону). */
export type WorksHalf = 'back' | 'front';

export function worksKey(front: number, rear: number, half: WorksHalf, bucket: number, dpr: number): string {
  return `works:${front}:${rear}:${half}:${bucket}:${dpr}`;
}

/** Холст рогаток — тот же, что у прежних (`siegemark`): кольцо внутри вырубки, точка — середина клетки. */
const WORKS_SPAN: Span = { w: 3.2, h: 2.4, ax: 1.6, ay: 1.3 };

export function worksSprite(front: number, rear: number, half: WorksHalf, cellPx: number, dpr: number): Mini {
  const b = bucketOf(cellPx);
  return cached(worksKey(front, rear, half, b, dpr), () => bakeMini(WORKS_SPAN, b, dpr, (ctx) => worksDraw(ctx, front, rear, half)));
}

// ---------- Знак участи ----------

const FELL_H = 18;
const FELL_FONT = "600 11px Georgia, 'Times New Roman', serif";
/** Светлые чернила знака участи на тёмной плашке. */
const FELL_INK = '#efe3c8';

/** Знак участи в квадрате 1×1 с серединой в нуле: пламя, цепь, открытый пустой сундук. */
function fellGlyph(ctx: C, fate: Fate, ink: string): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (fate === 'burn') {
    ctx.beginPath();
    ctx.moveTo(-0.32, 0.42);
    ctx.quadraticCurveTo(-0.46, -0.05, -0.08, -0.46);
    ctx.quadraticCurveTo(-0.02, -0.12, 0.14, -0.22);
    ctx.quadraticCurveTo(0.46, 0.05, 0.32, 0.42);
    ctx.closePath();
    ctx.fillStyle = '#d4602c';
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.07;
    ctx.stroke();
    ctx.fillStyle = '#f2c056';
    ctx.beginPath();
    ctx.moveTo(-0.13, 0.42);
    ctx.quadraticCurveTo(-0.2, 0.12, 0.0, -0.08);
    ctx.quadraticCurveTo(0.22, 0.14, 0.13, 0.42);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (fate === 'captives') {
    // Два звена цепи: связанные, а не рядом.
    ctx.strokeStyle = ink;
    ctx.lineWidth = 0.13;
    for (const [x, y] of [
      [-0.17, 0.13],
      [0.17, -0.13],
    ] as [number, number][]) {
      ctx.beginPath();
      ctx.ellipse(x, y, 0.3, 0.15, -0.7, 0, TAU);
      ctx.stroke();
    }
    return;
  }
  // Грабёж: пустой сундук с откинутой крышкой.
  ctx.fillStyle = '#8a5a34';
  ctx.fillRect(-0.4, -0.02, 0.8, 0.42);
  ctx.fillStyle = '#3e2a1a';
  ctx.fillRect(-0.32, 0.02, 0.64, 0.12);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 0.08;
  ctx.strokeRect(-0.4, -0.02, 0.8, 0.42);
  ctx.fillStyle = '#a06a3c';
  ctx.beginPath();
  ctx.moveTo(-0.4, -0.02);
  ctx.lineTo(-0.22, -0.44);
  ctx.lineTo(0.5, -0.32);
  ctx.lineTo(0.4, -0.02);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = GOLD_LIT;
  ctx.fillRect(-0.05, 0.12, 0.1, 0.1);
}

/** Знак участи павшего города: плашка пергамента со знаком и словом (`siegemark.FELL_WORDS`). */
export function fellSprite(fate: Fate, text: string, dpr: number): Mini {
  return cached(`fell:${fate}:${text}:${dpr}`, () => {
    // Плашка по длине слова: мерится той же гарнитурой, которой пишется.
    let textW = text.length * 6.5;
    const probe = makeCanvas(1, 1).getContext('2d');
    if (probe) {
      probe.font = FELL_FONT;
      textW = Math.ceil(probe.measureText(text).width);
    }
    const pad = 6;
    const glyph = 12;
    const w = pad + glyph + 4 + textW + pad + 2;
    const h = FELL_H;
    // Холст на два пикселя шире плашки: справа-снизу ложится её тень.
    return bakeMini({ w: w + 2, h: h + 2, ax: w / 2, ay: 0 }, 1, dpr, (ctx) => {
      ctx.translate(-w / 2, 0);
      // Плашка с подрезанными углами — ярлык на карте, а не кнопка интерфейса.
      const plate = (): void => {
        const c = 4;
        ctx.beginPath();
        ctx.moveTo(c, 0.5);
        ctx.lineTo(w - c, 0.5);
        ctx.lineTo(w - 0.5, h / 2);
        ctx.lineTo(w - c, h - 0.5);
        ctx.lineTo(c, h - 0.5);
        ctx.lineTo(0.5, h / 2);
        ctx.closePath();
      };
      ctx.save();
      ctx.translate(1, 1.5);
      plate();
      ctx.fillStyle = 'rgba(26, 20, 16, 0.35)';
      ctx.fill();
      ctx.restore();
      plate();
      // Плашка нового вида — та же, что у имени места (`labels.placeLabel`): тёмная, с тёплой кромкой.
      ctx.fillStyle = 'rgba(22, 16, 11, 0.88)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 220, 170, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.save();
      ctx.translate(pad + glyph / 2, h / 2);
      ctx.scale(glyph, glyph);
      fellGlyph(ctx, fate, FELL_INK);
      ctx.restore();
      ctx.font = FELL_FONT;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillStyle = FELL_INK;
      ctx.fillText(text, pad + glyph + 4, h / 2 + 0.5);
    });
  });
}
