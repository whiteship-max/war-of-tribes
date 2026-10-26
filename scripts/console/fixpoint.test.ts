// Правила остановки `npm run derive` (fixpoint.ts): «не сошлось» — стоп, качание W в пределах ±2 — полусумма и флаг, строки
// таблицы у ворот — так же. Область правила — шаги вывода после первого (у первого нет прежнего записанного, качаться нечему);
// каждая точка качания проверяется на то, что она внутри: записанное ушло от прежнего, выведенное повернуло назад.
import { describe, expect, it } from 'vitest';
import { GATE_SETTLE, W_SWING, gateMove, gateSettled, wMove, type Table } from './fixpoint';

const table = (wolves: number[], raiders: number[]): Table => ({ wolves, raiders });

describe('вывод W', () => {
  it('выведенное = записанному — неподвижная точка, даже на последнем шаге', () => {
    expect(wMove([102, 105], 105, false)).toEqual({ kind: 'fixed' });
    expect(wMove([102, 105], 105, true)).toEqual({ kind: 'fixed' });
  });

  it('идёт в одну сторону — шаг дальше, на последнем — не сошлось (вывод 26.10.2026: 102 → 105 → 111 → 113 → 114)', () => {
    expect(wMove([102], 105, false)).toEqual({ kind: 'step', next: 105 });
    // Внутри области: записанное шло вверх (111 → 113), выведенное — тоже вверх и в пределах 2: это не качание.
    expect(Math.abs(114 - 113)).toBeLessThanOrEqual(W_SWING);
    expect(wMove([102, 105, 111, 113], 114, false)).toEqual({ kind: 'step', next: 114 });
    expect(wMove([102, 105, 111, 113], 114, true)).toEqual({ kind: 'stuck' });
  });

  it('повернуло назад в пределах ±2 — полусумма округлением и конец; на границе 2 — тоже', () => {
    // 113 → 114 → 113: записанное шло вверх, выведенное повернуло вниз на 1.
    expect(wMove([113, 114], 113, false)).toEqual({ kind: 'swing', next: 114 });
    // Граница: на 2 назад — качание; полусумма 113.5 → 114.
    expect(wMove([111, 115], 113, false)).toEqual({ kind: 'swing', next: 114 });
    expect(wMove([111, 115], 113, true)).toEqual({ kind: 'swing', next: 114 });
    // Вниз, потом вверх — так же.
    expect(wMove([116, 113], 114, true)).toEqual({ kind: 'swing', next: 114 });
  });

  it('повернуло назад дальше 2 — не качание: шаг дальше, на последнем — не сошлось', () => {
    expect(wMove([105, 111], 108, false)).toEqual({ kind: 'step', next: 108 });
    expect(wMove([105, 111], 108, true)).toEqual({ kind: 'stuck' });
  });

  it('у первого шага прежнего нет — назад повернуть нечему: близкое выведенное — шаг, а не качание', () => {
    expect(wMove([113], 112, false)).toEqual({ kind: 'step', next: 112 });
    expect(wMove([113], 112, true)).toEqual({ kind: 'stuck' });
  });
});

describe('вывод таблицы у ворот', () => {
  const was = table([100, 1000], [200, 2000]);

  it('все строки в 1 % — села; строка за 1 % — нет', () => {
    expect(GATE_SETTLE).toBe(0.01);
    expect(gateSettled(was, table([101, 990], [198, 2020]))).toBe(true);
    expect(gateSettled(was, table([102, 1000], [200, 2000]))).toBe(false);
    expect(gateMove([was], table([101, 990], [198, 2020]), true)).toEqual({ kind: 'settled' });
  });

  it('не севшие повернули назад — полусуммой, севшие — выведенными, флаг на строки', () => {
    const prev = table([100, 900], [200, 2400]);
    // Внутри области: волки 2-го шли вверх (900 → 1000) и повернули вниз, разбойники 2-го шли вниз (2400 → 2000) и повернули вверх.
    const move = gateMove([prev, was], table([100, 940], [201, 2200]), false);
    expect(move).toEqual({ kind: 'swing', table: table([100, 970], [201, 2100]), rows: ['волки 2-го', 'разбойники 2-го'] });
  });

  it('строка идёт в одну сторону — шаг, повернувшие — уже полусуммой; на последнем — не сошлось с её именем', () => {
    const prev = table([100, 900], [200, 2000]);
    // Волки 2-го повернули назад (900 → 1000 → 940); волки 1-го шли и идут вверх (100 → 100 → 120: прежде стояли — не поворот).
    const next = table([120, 940], [200, 2000]);
    expect(gateMove([prev, was], next, false)).toEqual({ kind: 'step', table: table([120, 970], [200, 2000]) });
    expect(gateMove([prev, was], next, true)).toEqual({ kind: 'stuck', rows: ['волки 1-го'] });
  });

  it('первый шаг: поворачивать нечему — не севшие идут, на последнем — не сошлось', () => {
    expect(gateMove([was], table([120, 1000], [200, 2000]), false)).toEqual({ kind: 'step', table: table([120, 1000], [200, 2000]) });
    expect(gateMove([was], table([120, 1000], [200, 2000]), true)).toEqual({ kind: 'stuck', rows: ['волки 1-го'] });
  });
});
