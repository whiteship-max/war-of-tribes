import { describe, expect, it } from 'vitest';
import { crossing, halfBand, spread, wilson } from './halfband';

// Ступени силы — как в «Конюшне» (`raid-stable.ts`, SHARES): 0.2…4.0 шагом 0.1.
const SHARES = Array.from({ length: 39 }, (_, i) => 0.2 + i * 0.1);

/**
 * Синтетические бои: у сида i свой порог силы, выше которого бой проигран. Пороги — равномерно по
 * [1.0, 2.0], то есть настоящее полпути — 1.5, и вся кривая лежит внутри ступеней. Первая половина
 * сидов — пороги через один: подвыборка «первые n/2 боёв» идёт той же кривой, только с меньшим числом
 * боёв, и сравнение ширины меряет число боёв, а не удачу подвыборки.
 */
const thresholds = (n: number): number[] =>
  Array.from({ length: n }, (_, i) => {
    const rank = i < n / 2 ? 2 * i : 2 * (i - n / 2) + 1;
    return 1 + rank / (n - 1);
  });
const lostBy = (t: number[]) => (k: number): boolean[] => t.map((x) => x <= k + 1e-9);

describe('доверительная граница полпути', () => {
  it('интервал Уилсона при половине из сорока — около ±0.15, и у нуля он не уходит ниже нуля', () => {
    const w = wilson(20, 40);
    expect((w.hi - w.lo) / 2).toBeGreaterThan(0.14);
    expect((w.hi - w.lo) / 2).toBeLessThan(0.16);
    expect(wilson(0, 40).lo).toBe(0);
    expect(wilson(0, 40).hi).toBeGreaterThan(0);
    expect(wilson(40, 40).hi).toBe(1);
  });

  it('граница окружает полпути и сужается с числом боёв', () => {
    const t = thresholds(40);
    // Область: кривая целиком внутри ступеней — иначе полпути упирается в край и граница не значит ничего.
    expect(Math.min(...t)).toBeGreaterThan(SHARES[0]);
    expect(Math.max(...t)).toBeLessThan(SHARES[SHARES.length - 1]);
    const all = halfBand(lostBy(t), SHARES);
    const half = halfBand(lostBy(t), SHARES, 20);
    for (const b of [all, half]) {
      expect(Number.isFinite(b.lo) && Number.isFinite(b.hi)).toBe(true);
      expect(b.lo).toBeLessThan(b.half);
      expect(b.half).toBeLessThan(b.hi);
    }
    // Настоящее полпути (1.5) внутри границы при любом числе боёв.
    expect(all.lo).toBeLessThan(1.5);
    expect(all.hi).toBeGreaterThan(1.5);
    // Вдвое меньше боёв — граница шире.
    expect(spread(half)).toBeGreaterThan(spread(all));
  });

  it('полпути по доле — та же линейная точка, что у отчёта', () => {
    const t = thresholds(40);
    const lost = lostBy(t);
    const share = (k: number) => lost(k).filter(Boolean).length / t.length;
    expect(halfBand(lost, SHARES).half).toBe(crossing(share, SHARES));
  });
});
