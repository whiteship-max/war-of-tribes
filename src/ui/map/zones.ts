// Зоны влияния племён на полотне: чья это земля.
//
// Слой устроен как туман — растр по клетке на пиксель, растянутый на экран с
// билинейным сглаживанием. Отсюда мягкий край пятна без единого градиента: цвет
// племени и должен расплываться, потому что никакой границы в мире нет, есть
// затухание влияния (`world/territory.ts`).
//
// Правило, ради которого слой отделён от земли: в тумане не проступает ничего.
// Мир кладёт в кусок карты цвет только для разведанных клеток, а здесь этого
// даже не приходится проверять — в неразведанной клетке приходит ноль.
import { influenceAt } from '@/world/cache';
import { TRIBE_COLORS } from '@/world/data/meta';
import { type Camera, type Viewport, toScreen, viewRect } from './grid';

/** Насколько густо. Земля под цветом обязана остаться читаемой. */
const TINT = 0.32;

/** Запас клеток вокруг экрана: растр переживает мелкие сдвиги пальцем. */
const MARGIN = 6;

/** Как часто пересобирается. Владения меняются стадиями, а не кадрами. */
const REBAKE_MS = 1000;

interface Baked {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  at: number;
}

let baked: Baked | null = null;

export function dropZones(): void {
  baked = null;
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

const colors = TRIBE_COLORS.map(rgb);

function bake(x0: number, y0: number, w: number, h: number, at: number): Baked | null {
  const canvas = baked?.canvas ?? document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const alpha = Math.round(TINT * 255);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const owner = influenceAt(x0 + x, y0 + y);
      if (owner === 0) continue;
      const [r, g, b] = colors[(owner - 1) % colors.length];
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, x: x0, y: y0, w, h, at };
}

/**
 * Кладёт цвет владений поверх земли, но под туман и под всё, что движется:
 * дымка обязана гасить и его, иначе на границе знания цвет проступал бы там,
 * где местность ещё чёрная.
 */
export function drawZones(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, now: number): void {
  const rect = viewRect(cam, vp);
  const x0 = Math.floor(rect.x) - MARGIN;
  const y0 = Math.floor(rect.y) - MARGIN;
  const w = Math.ceil(rect.w) + MARGIN * 2 + 2;
  const h = Math.ceil(rect.h) + MARGIN * 2 + 2;
  const stale =
    !baked ||
    now - baked.at > REBAKE_MS ||
    x0 < baked.x ||
    y0 < baked.y ||
    x0 + w > baked.x + baked.w ||
    y0 + h > baked.y + baked.h;
  if (stale) baked = bake(x0, y0, w, h, now) ?? baked;
  if (!baked) return;

  const [sx, sy] = toScreen(cam, vp, baked.x, baked.y);
  const [ex, ey] = toScreen(cam, vp, baked.x + baked.w, baked.y + baked.h);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(baked.canvas, Math.round(sx), Math.round(sy), Math.round(ex - sx), Math.round(ey - sy));
  ctx.restore();
}
