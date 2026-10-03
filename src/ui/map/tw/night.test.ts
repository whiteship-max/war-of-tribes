// Ночь на карте нового вида (`tw/night.ts`): часы — фаза солнца партии, как у сцены города; днём заливки нет.
import { describe, expect, it } from 'vitest';
import { nightOf } from './night';

describe('ночь карты по фазе солнца', () => {
  it('полдень — день, полночь — ночь; рассвет и закат — между', () => {
    expect(nightOf(0.25)).toBe(0);
    expect(nightOf(0.1)).toBe(0);
    expect(nightOf(0.4)).toBe(0);
    expect(nightOf(0.75)).toBe(1);
    expect(nightOf(0.62)).toBe(1);
    expect(nightOf(0.9)).toBe(1);
    expect(nightOf(0.5)).toBeGreaterThan(0);
    expect(nightOf(0.5)).toBeLessThan(1);
    expect(nightOf(0)).toBeGreaterThan(0);
    expect(nightOf(0)).toBeLessThan(1);
  });

  it('сумерки плавные: закат растёт, рассвет убывает, на стыке суток шва нет', () => {
    let prev = -1;
    for (let s = 0.4; s <= 0.6; s += 0.005) {
      const n = nightOf(s);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    prev = 2;
    for (let s = 0.9; s <= 1.1; s += 0.005) {
      const n = nightOf(s % 1);
      expect(n).toBeLessThanOrEqual(prev + 1e-9);
      prev = n;
    }
    expect(Math.abs(nightOf(0.99999) - nightOf(0))).toBeLessThan(0.01);
  });
});
