// Вода — одна на игру (docs/polish.md, П-8): двойник шейдера на процессоре — круги дождя и предел отблеска теми же
// числами (`shape.ts`), что и `glsl.ts`. Его читают тесты: круг не режется краем клетки, отблеск не уходит в белое.
import { GLINT_KNEE, RAIN_CELL, RAIN_RATE, RAIN_RING } from './shape';

const fract = (x: number): number => x - Math.floor(x);

/** Хеш шейдера (`wHash`) — без синуса. */
export function wHash(x: number, y: number): number {
  let a = fract(x * 0.1031);
  let b = fract(y * 0.1031);
  let c = fract(x * 0.1031);
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  return fract((a + b) * c);
}

/** Капля клетки в миг `t`: где (в клетках) и на какой доле цикла, или `null`, если в этот цикл клетка сухая. */
export function drop(cx: number, cy: number, t: number, rain: number): { x: number; y: number; ph: number } | null {
  const rate = RAIN_RATE[0] + (RAIN_RATE[1] - RAIN_RATE[0]) * rain;
  const cyc = t * rate + wHash(cx, cy) * 7.31;
  const ci = Math.floor(cyc);
  const sx = cx + ci * 0.618;
  const sy = cy + ci * 1.414;
  if (wHash(sx + 11.7, sy + 11.7) > rain * 0.85 + 0.1) return null;
  return { x: cx + wHash(sx + 3.1, sy + 3.1), y: cy + wHash(sx + 5.9, sy + 5.9), ph: cyc - ci };
}

/** Наклон кольца одной капли в точке (в клетках): тот же профиль, что `wRain`. */
export function ringSlope(px: number, py: number, d: { x: number; y: number; ph: number }): [number, number] {
  const dx = px - d.x;
  const dy = py - d.y;
  const r = Math.hypot(dx, dy);
  const e = 1 - d.ph;
  const x = (r - RAIN_RING[0] * (1 - e * e)) / RAIN_RING[1];
  if (Math.abs(x) >= 1) return [0, 0];
  const s = Math.sin(x * Math.PI) * (1 - x * x) * (1 - x * x) * e * Math.sqrt(e) * 0.5;
  const k = s / Math.max(r, 1e-4);
  return [dx * k, dy * k];
}

/** Наклон дождя в точке мира (м), как в шейдере: перебор 2 × 2 ближних клеток. */
export function rainSlope(x: number, y: number, t: number, rain: number): [number, number] {
  const cx = x / RAIN_CELL;
  const cy = y / RAIN_CELL;
  const bx = Math.floor(cx - 0.5);
  const by = Math.floor(cy - 0.5);
  let gx = 0;
  let gy = 0;
  for (let j = 0; j < 4; j++) {
    const d = drop(bx + (j % 2), by + Math.floor(j / 2), t, rain);
    if (!d) continue;
    const [sx, sy] = ringSlope(cx, cy, d);
    gx += sx;
    gy += sy;
  }
  return [gx, gy];
}

/** Наклон дождя в точке, если перебрать все клетки 5 × 5 вокруг: правда, с которой сверяют перебор шейдера. */
export function rainSlopeAll(x: number, y: number, t: number, rain: number): [number, number] {
  const cx = x / RAIN_CELL;
  const cy = y / RAIN_CELL;
  let gx = 0;
  let gy = 0;
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      const d = drop(Math.floor(cx) + i, Math.floor(cy) + j, t, rain);
      if (!d) continue;
      const [sx, sy] = ringSlope(cx, cy, d);
      gx += sx;
      gy += sy;
    }
  }
  return [gx, gy];
}

/** Мягкий предел отблеска (`wKnee`). */
export const knee = (c: number): number => c / (1 + c / GLINT_KNEE);
