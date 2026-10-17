// Ночь на карте нового вида (docs/map_tw.md, раздел 6; этап 2). Часы — те же, что у сцены города: фаза
// солнца из игрового времени партии (`derived.solarPhase`, `dayFraction`, `seasonOf`) — «один источник правды
// и для HUD, и для освещения сцены»; своих часов дня у карты нет и заводить их нельзя.
//
// Цена — одна заливка «умножением» на весь кадр и огоньки мест (`sparks.ts`, свой кусок — при первой ночи). Заливки днём нет
// вовсе. Подписи, сроки и метки ложатся поверх ночи: ночь темнит землю, а не то, что игрок читает.
import { dayFraction, seasonOf, solarPhase } from '@/game/derived';
import type { PlaceItem } from './scene';

/** Ночь целиком — от и до, в фазе солнца (0 — рассвет, 0.25 — полдень, 0.5 — закат, 0.75 — полночь). */
const DUSK = [0.44, 0.58] as const;
const DAWN = [0.94, 1.06] as const;

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Сколько ночи в фазе солнца: 0 — день, 1 — глубокая ночь; сумерки — плавно. */
export function nightOf(solar: number): number {
  const s = ((solar % 1) + 1) % 1;
  if (s >= DUSK[0] && s <= DUSK[1]) return smooth((s - DUSK[0]) / (DUSK[1] - DUSK[0]));
  if (s > DUSK[1] && s < DAWN[0]) return 1;
  // Рассвет переходит через ноль: 0.94…1 и 0…0.06.
  const d = s >= DAWN[0] ? s : s + 1;
  if (d >= DAWN[0] && d <= DAWN[1]) return 1 - smooth((d - DAWN[0]) / (DAWN[1] - DAWN[0]));
  return 0;
}

/** Ночь в игровую секунду партии. */
export const nightAt = (time: number): number => nightOf(solarPhase(dayFraction(time), seasonOf(time)));

/**
 * Ночная заливка: синий сумрак умножением. Не чёрный — карта ночью читается, как ночная сцена города: земля
 * темнеет и холодеет, огни мест — тёплые.
 */
const DEEP: readonly [number, number, number] = [86, 98, 140];

type Sparks = typeof import('./sparks');
let lights: Sparks | null = null;
let loading = false;

/**
 * Ночь: синий сумрак умножением на весь кадр, сверху огоньки мест (`sparks.ts`, свой кусок). Вернёт `true`, пока кусок
 * огней едет: карте — нарисовать ещё кадр.
 */
export function drawNight(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number, places: PlaceItem[], amount: number, dpr: number): boolean {
  if (amount <= 0) return false;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const r = Math.round(255 + (DEEP[0] - 255) * amount);
  const g = Math.round(255 + (DEEP[1] - 255) * amount);
  const b = Math.round(255 + (DEEP[2] - 255) * amount);
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  if (lights) {
    lights.drawSparks(ctx, scale, places, amount, dpr);
    return false;
  }
  if (!loading) {
    loading = true;
    import('./sparks')
      .then((m) => (lights = m))
      .catch(() => (loading = false));
  }
  return true;
}

export function dropNight(): void {
  lights?.dropSparks();
}
