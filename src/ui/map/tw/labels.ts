// Подписи карты нового вида (docs/map_tw.md, раздел 4; docs/ui_audit.md, 13): имя поселения — на тёмной плашке, как
// таблички городов на карте кампании Total War и панели нового интерфейса; цвет стороны — полосой у левого края (свой
// город — золотом и золотой рамкой). Крупные места (моря, горы) — по-прежнему чернилами по земле: это карта, а не
// метки. Шрифт — свой, гарнитура заголовков игры (`ui/fonts`, docs/polish.md, П-1): одна на всех устройствах.
import { SIDE_COLOR, sideRgba } from '@/side';
import { CANVAS_SANS, CANVAS_TITLE, onFontsLoaded } from '@/ui/fonts/canvas';

type C = CanvasRenderingContext2D;

/** Гарнитура подписей — заголовков игры (капитель эпохи). */
export const SERIF = CANVAS_TITLE;

/** Плашка — тёмная панель нового вида с тёплой кромкой; текст — светлые чернила. */
const PLATE = 'rgba(22, 16, 11, 0.86)';
const PLATE_EDGE = 'rgba(255, 220, 170, 0.3)';
const INK_LIGHT = '#efe3c8';
const INK_OWN = '#f7e9c6';

/** Разрядка, где браузер её умеет (`letterSpacing`); где нет — без неё. */
function spaced(ctx: C, px: number): void {
  const c = ctx as C & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${px}px`;
}

/** Путь плашки со скруглёнными углами (без `roundRect`: он есть не во всех вебвью). */
function plate(ctx: C, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Поля плашки имени: слева — полоса стороны и зазор, справа — зазор. */
const BAR = 3;
const PAD_L = 8;
const PAD_R = 6;

/**
 * Имя поселения: плашка по середине `x`, `y`. `own` — своё: крупнее, золотая рамка. `color` — цвет стороны или
 * отношения (`RELATION_META`, свой — `side.ts`): им — полоса у левого края.
 */
export function placeLabel(ctx: C, text: string, x: number, y: number, own: boolean, color: string): void {
  ctx.save();
  ctx.font = labelFont(own);
  spaced(ctx, own ? 0.8 : 0.4);
  const tw = ctx.measureText(text).width;
  const w = tw + PAD_L + PAD_R + (own ? 4 : 0);
  const h = own ? 21 : 17;
  const x0 = x - w / 2;
  const y0 = y - h / 2;
  // Тень вниз — плашка стоит над землёй, а не нарисована на ней.
  plate(ctx, x0 + 1, y0 + 1.5, w, h, 4);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.fill();
  plate(ctx, x0, y0, w, h, 4);
  ctx.fillStyle = PLATE;
  ctx.fill();
  ctx.lineWidth = own ? 1.5 : 1;
  ctx.strokeStyle = own ? SIDE_COLOR.ours : PLATE_EDGE;
  ctx.stroke();
  // Полоса стороны — у левого края, во всю высоту плашки.
  ctx.save();
  plate(ctx, x0, y0, w, h, 4);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(x0, y0, BAR, h);
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = own ? INK_OWN : INK_LIGHT;
  ctx.fillText(text, x0 + PAD_L + (own ? 2 : 0), y + 0.5);
  ctx.restore();
}

/** Имя крупного места — моря, гор — разрядкой капителью, светлыми чернилами по воде. */
export function regionLabel(ctx: C, text: string, x: number, y: number, size: number, onWater: boolean): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${size}px ${SERIF}`;
  spaced(ctx, size * 0.35);
  ctx.fillStyle = onWater ? 'rgba(214, 228, 222, 0.78)' : 'rgba(59, 42, 28, 0.78)';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ---------- Подписи игры: испечённые ----------
//
// В кадре игры подпись — копирование испечённой: плашка — путь, тень и полоса, и печь её шестьдесят раз в секунду —
// ровно то, что запрещает закон кадра (docs/world-map.md). Подпись печётся один раз на (текст, своё, цвет, плотность);
// имя своего города меняет игрок, и старое вытесняется.

export interface LabelSprite {
  canvas: HTMLCanvasElement;
  /** Размер в CSS-пикселях; точка подписи — середина. */
  w: number;
  h: number;
}

const labels = new Map<string, LabelSprite>();
const LABELS_MAX = 96;

/** Шрифт подписи — им же меряется вписывание имени (`fitName`). */
export const labelFont = (own: boolean): string => (own ? `700 13px ${SERIF}` : `600 12px ${SERIF}`);

/** Положить в кэш с вытеснением самого старого. */
function keep(key: string, out: LabelSprite): LabelSprite {
  labels.set(key, out);
  if (labels.size > LABELS_MAX) {
    const first = labels.keys().next().value as string;
    const gone = labels.get(first);
    if (gone) gone.canvas.width = 0;
    labels.delete(first);
  }
  return out;
}

export function labelSprite(text: string, own: boolean, dpr: number, color: string): LabelSprite {
  const key = `${own ? 1 : 0}|${color}|${dpr}|${text}`;
  const have = labels.get(key);
  if (have) {
    labels.delete(key);
    labels.set(key, have);
    return have;
  }
  const probe = document.createElement('canvas').getContext('2d');
  let tw = text.length * 7;
  if (probe) {
    probe.font = labelFont(own);
    spaced(probe, own ? 0.8 : 0.4);
    tw = probe.measureText(text).width;
  }
  // Холст шире плашки на поля и тень справа-снизу.
  const w = Math.ceil(tw + PAD_L + PAD_R + (own ? 4 : 0) + 4);
  const h = own ? 26 : 21;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    placeLabel(ctx, text, (w - 2) / 2, (h - 2) / 2, own, color);
  }
  return keep(key, { canvas, w, h });
}

/** Имя крупного места — тоже испечённое: разрядка и курсив, по воде светлыми чернилами. */
export function regionSprite(text: string, size: number, onWater: boolean, dpr: number): LabelSprite {
  const key = `r|${size}|${onWater ? 1 : 0}|${dpr}|${text}`;
  const have = labels.get(key);
  if (have) return have;
  const probe = document.createElement('canvas').getContext('2d');
  let tw = text.length * size * 0.8;
  if (probe) {
    probe.font = `${size}px ${SERIF}`;
    spaced(probe, size * 0.35);
    tw = probe.measureText(text).width;
  }
  const w = Math.ceil(tw + size);
  const h = Math.ceil(size * 1.6);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    regionLabel(ctx, text, w / 2, h / 2, size, onWater);
  }
  const out = { canvas, w, h };
  labels.set(key, out);
  return out;
}

// ---------- Срок похода: пилюля ----------
//
// Срок до прихода над отрядом — на тёмной пилюле с кромкой цвета стороны: чужой набег — красной, свой — золотой. Текст
// меняется раз в секунду и пишется в кадре (как и прежде), а пилюля печётся раз на (ширину, сторону, плотность): путь
// со скруглением в кадре не строится.

/** Шрифт срока: свой, цифры одной ширины. */
export const TIMER_FONT = `700 12px ${CANVAS_SANS}`;
/** Высота пилюли срока, CSS px. */
export const TIMER_H = 16;
/** Ширина пилюли — ступенями по 6 px: строка срока меняется каждую секунду, а пилюль печётся считанное число. */
export const timerWidth = (textW: number): number => Math.ceil((textW + 12) / 6) * 6;

export function timerSprite(w: number, ours: boolean, dpr: number): LabelSprite {
  const key = `t|${w}|${ours ? 1 : 0}|${dpr}`;
  const have = labels.get(key);
  if (have) return have;
  const h = TIMER_H;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((w + 2) * dpr);
  canvas.height = Math.ceil((h + 2) * dpr);
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    plate(ctx, 1, 1.5, w, h, h / 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fill();
    plate(ctx, 0.5, 0.5, w, h, h / 2);
    ctx.fillStyle = PLATE;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = sideRgba(ours, 0.95);
    ctx.stroke();
  }
  const out = { canvas, w: w + 2, h: h + 2 };
  labels.set(key, out);
  return out;
}

/** Ширина строки срока шрифтом срока — мерка одна, на кадр; кэш сбрасывает `dropLabels`. */
const widths = new Map<string, number>();
let measurer: CanvasRenderingContext2D | null = null;
export function timerTextWidth(text: string): number {
  const have = widths.get(text);
  if (have !== undefined) return have;
  measurer ??= document.createElement('canvas').getContext('2d');
  let w = text.length * 6.5;
  if (measurer) {
    measurer.font = TIMER_FONT;
    w = measurer.measureText(text).width;
  }
  if (widths.size > 256) widths.clear();
  widths.set(text, w);
  return w;
}

export function dropLabels(): void {
  for (const l of labels.values()) l.canvas.width = 0;
  labels.clear();
  widths.clear();
}

// Доехал свой шрифт — подписи, испечённые подменой, печёт заново; кадр будит `WorldMap` тем же событием.
onFontsLoaded(dropLabels);
