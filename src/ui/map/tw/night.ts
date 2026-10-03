// Ночь на карте нового вида (docs/map_tw.md, раздел 6; этап 2). Часы — те же, что у сцены города: фаза
// солнца из игрового времени партии (`derived.solarPhase`, `dayFraction`, `seasonOf`) — «один источник правды
// и для HUD, и для освещения сцены»; своих часов дня у карты нет и заводить их нельзя.
//
// Цена — одна заливка «умножением» на весь кадр и по копированию испечённого огня на место. Заливки днём нет
// вовсе. Подписи, сроки и метки ложатся поверх ночи: ночь темнит землю, а не то, что игрок читает.
import { dayFraction, seasonOf, solarPhase } from '@/game/derived';
import { makeCanvas } from '../paint';
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

const glows = new Map<number, HTMLCanvasElement>();
const GLOW_PX = 64;

/** Тёплое пятно огня, испечённое один раз на плотность. */
function glow(dpr: number): HTMLCanvasElement {
  const have = glows.get(dpr);
  if (have) return have;
  const n = Math.ceil(GLOW_PX * dpr);
  const c = makeCanvas(n, n);
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0, 'rgba(255, 178, 92, 0.62)');
    g.addColorStop(0.35, 'rgba(255, 150, 70, 0.3)');
    g.addColorStop(1, 'rgba(255, 140, 60, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
  }
  glows.set(dpr, c);
  return c;
}

/** Сила огня места: город светит окнами и факелами на стенах, логово — костром, пепелище — нет. */
function lightOf(it: PlaceItem): number {
  if (it.look.kind === 'ruin') return 0;
  if (it.look.kind === 'lair') return 0.75;
  return it.look.stage === 'town' ? 1.35 : it.look.stage === 'stronghold' ? 1.15 : 0.95;
}

export function drawNight(ctx: CanvasRenderingContext2D, w: number, h: number, scale: number, places: PlaceItem[], amount: number, dpr: number): void {
  if (amount <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  const r = Math.round(255 + (DEEP[0] - 255) * amount);
  const g = Math.round(255 + (DEEP[1] - 255) * amount);
  const b = Math.round(255 + (DEEP[2] - 255) * amount);
  ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = amount;
  const spot = glow(dpr);
  for (const it of places) {
    const k = lightOf(it);
    if (k <= 0) continue;
    // Огонь с поселение размером, но не меньше значка: издали город — тёплая точка, как на ночной карте.
    const rr = Math.max(12, scale * 0.95 * k);
    ctx.drawImage(spot, it.sx - rr, it.sy - rr * 0.8, rr * 2, rr * 2);
  }
  ctx.restore();
}

export function dropNight(): void {
  glows.clear();
}
