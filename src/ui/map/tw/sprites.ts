// Кисти нового вида: кроны, тень кроны, рябь моря. Печётся один раз на запуск, в выпечке тайла — только
// копирование (закон кадра, docs/world-map.md). Пути и градиенты живут здесь, а не в тайле. Холсты — из
// `canvas.ts`: кисти пекутся там же, где выпечка, — в странице или в рабочем потоке.
import { type Canvas, type Ctx, ctxOf, makeCanvas } from './canvas';
import { TW } from './palette';

/** Сторона спрайта кроны: рисуется крупно и уменьшается при выпечке — край выходит мягким. */
const CROWN_PX = 40;
/** Видов на породу: одинаковые кроны читаются узором, а не лесом. */
export const CROWN_KINDS = 6;

const crowns: (Canvas | null)[] = Array(CROWN_KINDS * 2).fill(null);
let shadowSprite: Canvas | null = null;
let ripple: Canvas | null = null;

/** Детерминированный шум кисти: спрайт одинаков на каждом запуске. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

/**
 * Лиственная крона: несколько клубов листвы, тёмный низ справа, свет слева-сверху — как у рельефа.
 * Заполняет квадрат спрайта; ствола не видно — сверху его закрывает крона.
 */
function broadleaf(ctx: Ctx, kind: number): void {
  const s = CROWN_PX;
  const rnd = rng(9001 + kind * 31);
  const dark = TW.broadleaf[kind];
  const lit = TW.broadleafLit[kind];
  const clumps: [number, number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * 0.16;
    clumps.push([0.5 + Math.cos(a) * d, 0.52 + Math.sin(a) * d, 0.2 + rnd() * 0.08]);
  }
  ctx.fillStyle = dark;
  for (const [x, y, r] of clumps) {
    ctx.beginPath();
    ctx.arc(x * s, y * s, r * s, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const [x, y, r] of clumps) {
    const g = ctx.createRadialGradient((x - r * 0.45) * s, (y - r * 0.5) * s, 0, (x - r * 0.2) * s, (y - r * 0.2) * s, r * s);
    g.addColorStop(0, lit);
    g.addColorStop(0.75, dark);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x * s, y * s, r * s * 0.92, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Хвоя: узкий ярус за ярусом, левый бок на свету. */
function conifer(ctx: Ctx, kind: number): void {
  const s = CROWN_PX;
  const dark = TW.conifer[kind];
  const lit = TW.coniferLit[kind];
  const tiers = 3;
  for (let t = 0; t < tiers; t++) {
    const top = 0.08 + t * 0.2;
    const bottom = top + 0.42;
    const half = 0.16 + t * 0.07;
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(0.5 * s, top * s);
    ctx.lineTo((0.5 + half) * s, bottom * s);
    ctx.lineTo((0.5 - half) * s, bottom * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = lit;
    ctx.beginPath();
    ctx.moveTo(0.5 * s, top * s);
    ctx.lineTo(0.5 * s, bottom * s);
    ctx.lineTo((0.5 - half) * s, bottom * s);
    ctx.closePath();
    ctx.fill();
  }
}

/** Крона: `kind` — номер вида, `isConifer` — порода. */
export function crown(kind: number, isConifer: boolean): Canvas {
  const i = (isConifer ? CROWN_KINDS : 0) + kind;
  const have = crowns[i];
  if (have) return have;
  const c = makeCanvas(CROWN_PX, CROWN_PX);
  const ctx = ctxOf(c);
  if (isConifer) conifer(ctx, kind);
  else broadleaf(ctx, kind);
  crowns[i] = c;
  return c;
}

/**
 * Купа: несколько крон с тенями одним спрайтом. Лес на карте кампании — масса, а не россыпь, и купой
 * он стоит в выпечке впятеро меньше копирований, чем деревом: на телефоне это и есть цена тайла.
 * `count` — крон в купе (1…5), `variant` — раскладка, `isConifer` — порода.
 */
export const GROVE_PX = 100;
/** Сколько клеток покрывает спрайт купы. */
/** Холст с запасом под тень: крона того же размера, что и при 80 px на 0.62 клетки, а тень не режется краем. */
export const GROVE_CELLS = 0.775;
export const GROVE_MAX = 5;
export const GROVE_VARIANTS = 3;
const groves = new Map<number, Canvas>();

export function grove(count: number, variant: number, isConifer: boolean): Canvas {
  const key = (isConifer ? 1000 : 0) + count * 10 + variant;
  const have = groves.get(key);
  if (have) return have;
  const s = GROVE_PX;
  const c = makeCanvas(s, s);
  const ctx = ctxOf(c);
  const rnd = rng(7001 + key * 13);
  const perCell = s / GROVE_CELLS;
  const trees: { x: number; y: number; d: number; k: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = count === 1 ? 0 : 0.07 + rnd() * 0.12;
    const d = (isConifer ? 0.2 + rnd() * 0.07 : 0.26 + rnd() * 0.1) * perCell;
    trees.push({ x: s / 2 + Math.cos(a) * r * perCell, y: s / 2 + Math.sin(a) * r * perCell * 0.8, d, k: Math.floor(rnd() * CROWN_KINDS) });
  }
  trees.sort((a, b) => a.y - b.y);
  const shadow = crownShadow();
  for (const t of trees) {
    const w = t.d * 1.2;
    ctx.drawImage(shadow, t.x - w / 2 + t.d * 0.28, t.y - w * 0.32 + t.d * 0.3, w, w * 0.64);
  }
  for (const t of trees) {
    const sprite = crown(t.k, isConifer);
    const h = isConifer ? t.d * 1.3 : t.d;
    ctx.drawImage(sprite, t.x - t.d / 2, t.y - h * (isConifer ? 0.75 : 0.5), t.d, h);
  }
  groves.set(key, c);
  return c;
}

/** Тень кроны: мягкий эллипс; ложится вправо-вниз — свет слева-сверху. */
export function crownShadow(): Canvas {
  if (shadowSprite) return shadowSprite;
  const s = 32;
  const c = makeCanvas(s, s);
  const ctx = ctxOf(c);
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, TW.treeShadow);
  g.addColorStop(0.6, 'rgba(28, 30, 22, 0.28)');
  g.addColorStop(1, 'rgba(28, 30, 22, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  shadowSprite = c;
  return c;
}

/** Сторона узора ряби в пикселях выпечки; узор бесшовный и привязан к миру (`bake.ts`). */
export const RIPPLE_PX = 256;

/**
 * Рябь моря: короткие светлые дужки вразброс — так море читается водой, а не синей заливкой. Узор
 * бесшовный: дужка у края повторяется у противоположного края.
 */
export function ripplePattern(): Canvas {
  if (ripple) return ripple;
  const s = RIPPLE_PX;
  const c = makeCanvas(s, s);
  const ctx = ctxOf(c);
  const rnd = rng(4242);
  ctx.lineCap = 'round';
  for (let i = 0; i < 140; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const w = 6 + rnd() * 14;
    const light = rnd() < 0.7;
    ctx.strokeStyle = light ? 'rgba(220, 236, 232, 0.55)' : 'rgba(14, 34, 48, 0.45)';
    ctx.lineWidth = 0.9 + rnd() * 0.8;
    for (const ox of [-s, 0, s]) {
      for (const oy of [-s, 0, s]) {
        const cx = x + ox;
        const cy = y + oy;
        if (cx + w < 0 || cx - w > s || cy + 4 < 0 || cy - 4 > s) continue;
        ctx.beginPath();
        ctx.moveTo(cx - w / 2, cy);
        ctx.quadraticCurveTo(cx, cy - 2.2, cx + w / 2, cy);
        ctx.stroke();
      }
    }
  }
  ripple = c;
  return c;
}

/** Новый мир или уход с карты: спрайты дешёвые, пусть пекутся заново. */
export function dropTwSprites(): void {
  crowns.fill(null);
  groves.clear();
  shadowSprite = null;
  ripple = null;
}
