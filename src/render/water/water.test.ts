// Вода — одна на игру (docs/polish.md, П-8): круг дождя не режется краем клетки (прежние квадраты), отблеск ночью не
// уходит в белое, хеш без синуса, одна вода у всех мест, рябь карты без плитки и без шва.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WATER_GLSL } from './glsl';
import { drop, knee, rainSlope, rainSlopeAll, ringSlope, wHash } from './model';
import { GLINT_KNEE, LIGHT, RAIN_CELL, RAIN_RING } from './shape';
import { RIPPLE_CELL, paintRippleArcs, rippleArcs } from '@/ui/map/tw/sprites';

const SRC = join(__dirname, '..', '..');
const read = (p: string): string => readFileSync(join(SRC, p), 'utf8');

/** Сеяный ряд чисел: точки проверки — одни и те же на каждом прогоне. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
    return s / 4294967296;
  };
}

describe('вода: круги дождя', () => {
  it('круг не режется краем клетки: перебор шейдера 2 × 2 видит все круги, что задевают точку', () => {
    // Граница области: правило действует везде, где идёт дождь; точки — по всему полю в 40 клеток, в любой миг цикла,
    // при ливне (капля в каждой клетке почти каждый цикл).
    const r = rng(7);
    let touched = 0;
    let edge = 0;
    for (let k = 0; k < 6000; k++) {
      const x = (r() - 0.5) * 40 * RAIN_CELL;
      const y = (r() - 0.5) * 40 * RAIN_CELL;
      const t = r() * 300;
      const [ax, ay] = rainSlope(x, y, t, 1);
      const [bx, by] = rainSlopeAll(x, y, t, 1);
      if (bx !== 0 || by !== 0) touched++;
      // Точка у края клетки — там, где прежняя вода резала круг.
      const fx = (x / RAIN_CELL) % 1;
      if ((bx !== 0 || by !== 0) && (Math.abs(fx) < 0.1 || Math.abs(fx) > 0.9)) edge++;
      expect(Math.hypot(ax - bx, ay - by), `точка ${x.toFixed(3)}, ${y.toFixed(3)}, миг ${t.toFixed(2)}`).toBeLessThan(1e-12);
    }
    // Проверка внутри области: кругов задето много, и у краёв клеток — тоже.
    expect(touched).toBeGreaterThan(1500);
    expect(edge).toBeGreaterThan(200);
  });

  it('круг целиком в половине клетки от своей капли: радиус и полуширина кольца в сумме не больше половины', () => {
    expect(RAIN_RING[0] + RAIN_RING[1]).toBeLessThanOrEqual(0.5);
    // И профиль кольца за полушириной — ровно ноль: хвоста, который вышел бы за перебор, нет.
    const d = { x: 0, y: 0, ph: 0.6 };
    const R = RAIN_RING[0] * (1 - 0.4 * 0.4);
    expect(ringSlope(R + RAIN_RING[1] * 1.001, 0, d)).toEqual([0, 0]);
    expect(Math.abs(ringSlope(R + RAIN_RING[1] * 0.5, 0, d)[0])).toBeGreaterThan(0);
  });

  it('место капли меняется каждый цикл: клетка не бьёт в одну точку, узора-сетки нет', () => {
    const at = new Set<string>();
    for (let t = 0; t < 40; t += 0.37) {
      const d = drop(3, 5, t, 1);
      if (d) at.add(`${d.x.toFixed(3)},${d.y.toFixed(3)}`);
    }
    expect(at.size).toBeGreaterThan(10);
  });
});

describe('вода: свет', () => {
  it('отблеск через мягкий предел не уходит в белое: ни при каком свете не выше предела', () => {
    for (const c of [0, 0.1, 1, 10, 1e3, 1e6]) expect(knee(c)).toBeLessThan(GLINT_KNEE);
    // Луна в полную силу — дорожка и искры разом, ясная ночь: на воде не ярче половины белого.
    const moon = 0.95 * (LIGHT.moonPath[1] + LIGHT.moonCore[1]);
    expect(knee(moon)).toBeLessThan(0.5);
  });

  it('хеш шейдера — без синуса: на телефоне `fract(sin(x)·43758)` при больших x ложится ступенями', () => {
    expect(WATER_GLSL).not.toMatch(/fract\(\s*sin/);
    for (let k = 0; k < 2000; k++) {
      const h = wHash(k * 1.37 - 900, k * 0.61 + 4000);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });
});

describe('вода одна на игру', () => {
  it('город, ролики боя и осады и рыбалка рисуют воду общим кодом (render/water)', () => {
    const city = read('render/city/water.ts');
    expect(city).toContain("import { WATER_GLSL } from '../water/glsl'");
    expect(city).toMatch(/\$\{WATER_GLSL\}/);
    expect(read('render/water/material.ts')).toMatch(/\$\{WATER_GLSL\}/);
    // Ролик боя и осады — одна земля (`reel/land.ts`): река — общим материалом.
    expect(read('render/reel/land.ts')).toMatch(/waterMesh\(water, look, 'tw-river'\)/);
    expect(read('minigames/fishModels.ts')).toMatch(/waterSurface\(g, u, 'water'\)/);
    // Задник ролика осады — город (`city/backdrop.ts`): его река — та же вода города.
    expect(read('render/city/backdrop.ts')).toMatch(/buildWater\(/);
    // Своих шейдеров воды у мест больше нет.
    for (const f of ['render/reel/land.ts', 'minigames/fishModels.ts']) expect(read(f), f).not.toMatch(/fresnel|fres\s*=|reflect\(/i);
  });
});

/** Холст-записка: какие дужки нарисованы (начало и конец по x, высота). */
function recorder(): { ctx: CanvasRenderingContext2D; arcs: [number, number, number][] } {
  const arcs: [number, number, number][] = [];
  let x0 = 0;
  const ctx = {
    lineCap: '',
    strokeStyle: '',
    lineWidth: 1,
    beginPath() {},
    moveTo(x: number) {
      x0 = x;
    },
    quadraticCurveTo(_cx: number, _cy: number, x: number, y: number) {
      arcs.push([x0, x, y]);
    },
    stroke() {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, arcs };
}

describe('карта: рябь моря', () => {
  it('рябь привязана к миру: соседние тайлы рисуют дужки, лежащие на общем крае, одинаково — шва нет', () => {
    const size = 448;
    // Граница области: край тайла — ровно по границе клетки ряби (там дужка соседней клетки и переходит край) и между.
    for (const edge of [36 * RIPPLE_CELL, 36 * RIPPLE_CELL + 13]) {
      const a = recorder();
      const b = recorder();
      paintRippleArcs(a.ctx, edge - size, 2000, size);
      paintRippleArcs(b.ctx, edge, 2000, size);
      // Дужки, пересекающие общий край, в мире — одни и те же у обоих тайлов.
      const cross = (arcs: [number, number, number][], ox: number): string[] =>
        arcs
          .map(([x0, x1, y]) => [x0 + ox, x1 + ox, y + 2000] as const)
          .filter(([x0, x1]) => x0 < edge && x1 > edge)
          .map(([x0, x1, y]) => `${x0.toFixed(2)},${x1.toFixed(2)},${y.toFixed(2)}`)
          .sort();
      const ea = cross(a.arcs, edge - size);
      const eb = cross(b.arcs, edge);
      expect(ea.length, `край ${edge}: дужек на крае`).toBeGreaterThan(2);
      expect(eb, `край ${edge}`).toEqual(ea);
    }
  });

  it('узора-плитки нет: клетка ряби не повторяет соседей ни на каком сдвиге до шестидесяти четырёх клеток', () => {
    const sig = (i: number, j: number): string =>
      rippleArcs(i, j)
        .map((r) => `${(r.x - i * RIPPLE_CELL).toFixed(3)}:${(r.y - j * RIPPLE_CELL).toFixed(3)}:${r.w.toFixed(2)}`)
        .join('|');
    // Прежний узор повторялся каждые 256 пикселей — девять с лишним клеток. Окно 4 × 4 клетки не повторяется ни на каком
    // сдвиге вдоль и поперёк до 64 клеток.
    const win = (i: number, j: number): string => {
      const out: string[] = [];
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) out.push(sig(i + a, j + b));
      return out.join('/');
    };
    const base = win(100, -40);
    for (let k = 1; k <= 64; k++) {
      expect(win(100 + k, -40), `сдвиг ${k} вдоль`).not.toBe(base);
      expect(win(100, -40 + k), `сдвиг ${k} поперёк`).not.toBe(base);
    }
  });
});
