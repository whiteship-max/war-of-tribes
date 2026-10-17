// Огни мест на ночной карте (docs/polish.md, П-9): огоньки окон и факелов вокруг значка, загораются по одному. Ленивый
// кусок: его тянет ночь карты (`night.ts`) при первой ночи — в первую загрузку он не едет (дверь «огни карты» в
// `vite.config.ts`).
import { makeCanvas } from '../paint';
import type { PlaceItem } from './scene';

const smooth = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Сколько огоньков у места (docs/polish.md, П-9): окна и факелы города вокруг его значка; у логова — костёр. Свет — от
 * огней, а не пятно на всё место: огоньки загораются по одному на закате и гаснут к рассвету в обратном порядке.
 */
export function sparksOf(it: Pick<PlaceItem, 'look'>): number {
  const l = it.look;
  return l.kind === 'ruin' ? 0 : l.kind === 'lair' ? 2 : l.stage === 'town' ? 11 : l.stage === 'stronghold' ? 8 : 5;
}

/** Число огонька от места и номера: [0, 1), без синуса. */
function spark01(id: string, j: number, k: number): number {
  let h = j * 7919 + k * 104729;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x5bd1e995);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** С какой доли ночи горит огонёк `j` места: первые — в сумерках, последние — к темноте. */
export const sparkThreshold = (id: string, j: number): number => 0.08 + 0.72 * spark01(id, j, 3);

const sparks = new Map<number, HTMLCanvasElement>();
const SPARK_PX = 16;

/** Огонёк: тёплое сердце и узкий ореол, испечён один раз на плотность. */
function spark(dpr: number): HTMLCanvasElement {
  const have = sparks.get(dpr);
  if (have) return have;
  const n = Math.ceil(SPARK_PX * dpr);
  const c = makeCanvas(n, n);
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0, '#fff0c8');
    g.addColorStop(0.16, '#ffc470f0');
    g.addColorStop(0.42, '#ff964648');
    g.addColorStop(1, '#ff8c3c00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, n, n);
  }
  sparks.set(dpr, c);
  return c;
}

/** Огоньки мест поверх ночной заливки: `amount` — доля ночи. */
export function drawSparks(ctx: CanvasRenderingContext2D, scale: number, places: PlaceItem[], amount: number, dpr: number): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const dot = spark(dpr);
  for (const it of places) {
    // Свет места — огоньки окон и факелов кольцом вокруг значка, снаружи его тела (корона и отметки уровня — не огни), у
    // логова — костёр у края; пятна на всё место нет (docs/polish.md, П-9). Чем больше место, тем шире кольцо.
    const n = sparksOf(it);
    const id = String(it.s.id);
    const ring = Math.max(5, scale * 0.06 * n);
    const b = it.body;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    for (let j = 0; j < n; j++) {
      const on = smooth((amount - sparkThreshold(id, j)) / 0.14);
      if (on <= 0) continue;
      const a = spark01(id, j, 1) * Math.PI * 2;
      const d = 4 + spark01(id, j, 2) * ring;
      const size = (it.look.kind === 'lair' ? 13 : 7) + 4 * spark01(id, j, 4);
      ctx.globalAlpha = on;
      ctx.drawImage(dot, cx + Math.cos(a) * ((b.x1 - b.x0) / 2 + d) - size / 2, cy + Math.sin(a) * ((b.y1 - b.y0) / 2 + d * 0.75) - size / 2, size, size);
    }
  }
  ctx.restore();
}

export function dropSparks(): void {
  sparks.clear();
}
