// Терра инкогнита — пергамент без рельефа и без точек (docs/gdd/path_of_sword.md, 3.5.7; ПН-00). Лист старой карты знает
// только очертания: суша или вода. Свойство: два атласа, разные только рельефом (горы, холмы, лес против равнины), дают
// один и тот же лист — буква в букву, по журналу вызовов холста. Холста под vitest нет — его журналит подменный документ.
//
// Область правила (правило 11): в листе есть незнакомые клетки (лист рисуется только там) и на них — рельеф, которым
// атласы различаются; это утверждается в самом тесте.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Terrain } from '@/world/types';
import { bakeParchment } from './parchment';
import { type FogLayer, fogLayer, fogPaint } from './fog';

/** Холст, который пишет журнал: каждый вызов и каждое присвоение; картинка пикселей — суммой байтов. */
function recordingCanvas(): { log: string[] } {
  const log: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (_t, k) => {
      if (typeof k !== 'string') return undefined;
      if (k === 'createImageData') return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
      if (k === 'putImageData') {
        return (img: { data: Uint8ClampedArray }) => {
          let sum = 0;
          for (let i = 0; i < img.data.length; i++) sum = (sum * 31 + img.data[i]) % 1_000_000_007;
          log.push(`putImageData(${sum})`);
        };
      }
      return (...a: unknown[]) => void log.push(`${k}(${a.map((v) => (typeof v === 'number' ? v.toFixed(3) : String(v))).join(',')})`);
    },
    set: (_t, k, v) => {
      log.push(`${String(k)}=${String(v)}`);
      return true;
    },
  });
  return { log, ...{ width: 1, height: 1, getContext: () => ctx } };
}

let had: unknown;
beforeEach(() => {
  had = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = { createElement: () => recordingCanvas() };
});
afterEach(() => {
  (globalThis as { document?: unknown }).document = had;
});

const AREA = { x: 100, y: 200, w: 24, h: 18 };
/** Берег: вода слева, суша справа; на суше — горы, холмы и лес полосами. */
const relief = (x: number, y: number): Terrain => {
  const i = x - AREA.x;
  if (i < 6) return 'water';
  const band = (i + (y - AREA.y)) % 4;
  return band === 0 ? 'mountains' : band === 1 ? 'hills' : band === 2 ? 'forest' : 'plain';
};
/** Тот же атлас без рельефа: суша — равнина, вода — вода. */
const flat = (x: number, y: number): Terrain => (relief(x, y) === 'water' ? 'water' : 'plain');
/** Знание: разведана только левая верхняя четверть — остальное терра инкогнита. */
const known = (x: number, y: number): number => (x < AREA.x + 8 && y < AREA.y + 6 ? 1 : 0);

const logOf = (sample: (x: number, y: number) => Terrain): string =>
  (bakeParchment(7, AREA, sample, known, 4) as unknown as { log: string[] }).log.join('\n');

describe('терра инкогнита: пергамент без рельефа (ПН-00)', () => {
  it('лист один и тот же, есть ли на незнакомой земле горы, холмы и лес или одна равнина', () => {
    // Точки внутри области: незнакомая суша с рельефом есть, и атласы на ней действительно различаются.
    let differ = 0;
    for (let y = AREA.y; y < AREA.y + AREA.h; y++) {
      for (let x = AREA.x; x < AREA.x + AREA.w; x++) if (!known(x, y) && relief(x, y) !== flat(x, y)) differ++;
    }
    expect(differ, 'точка внутри области: незнакомая земля с рельефом').toBeGreaterThan(50);
    const a = logOf(relief);
    expect(a, 'точка внутри области: лист нарисован — пиксели и берег').toMatch(/putImageData\(\d+\)[\s\S]*stroke\(\)/);
    expect(a, 'рельеф не рисуется: журнал листа с горами — тот же, что без них').toBe(logOf(flat));
  });

  it('берег — рисуется: суша и вода дают разный лист (свойство выше не держится пустым листом)', () => {
    const sea = (): Terrain => 'water';
    expect(logOf(relief)).not.toBe(logOf(sea));
  });
});

describe('терра инкогнита и туман войны — два слоя, не один (ПН-00)', () => {
  // Знание — квадрат 10×10 у начала; живой обзор — круг радиуса 3 вокруг (2, 2).
  const knownSq = (x: number, y: number): number => (x >= 0 && y >= 0 && x < 10 && y < 10 ? 1 : 0);
  const seen = (x: number, y: number): boolean => (x - 2) ** 2 + (y - 2) ** 2 <= 9;
  const at = (x: number, y: number): FogLayer => fogLayer(knownSq, seen, x, y);

  it('в обзоре — чисто; разведанное вне обзора — туман; у края знания — кромка листа; глубже — пергамент', () => {
    expect(at(2, 2)).toBe('clear');
    expect(at(8, 8), 'разведано, не видно — туман войны').toBe('shroud');
    expect(at(10, 5), 'сосед разведан — кромку рисует лист, растр пуст').toBe('edge');
    expect(at(20, 20), 'незнакомое — терра инкогнита').toBe('parchment');
    // Каждый слой встречается в области — проверка не держится одним слоем.
    const all = new Set<FogLayer>();
    for (let y = -4; y < 16; y++) for (let x = -4; x < 16; x++) all.add(at(x, y));
    expect([...all].sort()).toEqual(['clear', 'edge', 'parchment', 'shroud']);
  });

  it('туман — не пергамент: разведанное вне обзора видно сквозь лёгкую сепию, незнакомое закрыто листом', () => {
    const shroud = fogPaint('shroud')!;
    const parch = fogPaint('parchment')!;
    expect(shroud[3], 'туман полупрозрачен: местность видна').toBeLessThan(128);
    expect(parch[3], 'терра инкогнита непрозрачна: земли под ней не видно').toBe(255);
    expect(shroud.slice(0, 3)).not.toEqual(parch.slice(0, 3));
    expect(fogPaint('clear')).toBeNull();
    expect(fogPaint('edge')).toBeNull();
  });

  it('туман не зависит от того, что разведано рядом, — только от обзора; терра инкогнита — только от знания', () => {
    // Свойство «не сводить»: разведанная клетка никогда не становится пергаментом, незнакомая — туманом.
    for (let y = -4; y < 16; y++) {
      for (let x = -4; x < 16; x++) {
        const l = at(x, y);
        if (knownSq(x, y)) expect(['clear', 'shroud'], `${x},${y}`).toContain(l);
        else expect(['edge', 'parchment'], `${x},${y}`).toContain(l);
      }
    }
  });
});
