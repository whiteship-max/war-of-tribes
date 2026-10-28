// Среднее по сидам и его шум для Ц4 `stability:report` (ПБ-1, п. 7). Область — наборы от двух сидов (у одного разброса нет).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { CROWN_SET, bandVerdict, meanBand } from './drift';

describe('среднее по сидам и его шум (ПБ-1, п. 7)', () => {
  it('среднее и граница: ошибка — разброс сидов на корень из их числа', () => {
    const b = meanBand([-4, -6, -5, -7, -3, -6]);
    expect(b.mean).toBeCloseTo(-31 / 6, 12);
    const sd = Math.sqrt([-4, -6, -5, -7, -3, -6].reduce((a, x) => a + (x + 31 / 6) ** 2, 0) / 5);
    expect(b.se).toBeCloseTo(sd / Math.sqrt(6), 12);
    expect(b.hi - b.mean).toBeCloseTo(1.96 * b.se, 12);
    expect(meanBand([2]).se, 'у одного сида шума не измерить').toBe(0);
  });
  it('вердикт: вся граница внутри — в цели, вся снаружи — вне, цель внутри границы — в шуме набора', () => {
    expect(bandVerdict({ mean: -2, se: 1, lo: -4, hi: 0 }, 5)).toBe('в цели');
    expect(bandVerdict({ mean: -8, se: 1, lo: -10, hi: -6 }, 5)).toBe('вне цели');
    expect(bandVerdict({ mean: -5.2, se: 0.9, lo: -7, hi: -3.4 }, 5)).toBe('граница цели в шуме набора');
  });

  it('набор вестей Ц4 — двенадцать сидов (решение владельца по ПБ-1, П7), и отчёт берёт его отсюда', () => {
    expect([...CROWN_SET]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // Тот же разброс сидов на вдвое большем наборе — ошибка среднего в √2 уже: граница, ради которой набор вырос.
    const six = [-4, -6, -5, -7, -3, -6];
    expect(meanBand([...six, ...six]).se * Math.sqrt(12 / 6)).toBeCloseTo(meanBand(six).se * Math.sqrt(10 / 11), 12);
    const src = readFileSync(new URL('../stability-report.ts', import.meta.url), 'utf8');
    expect(src, 'stability-report.ts: набор Ц4 по умолчанию — CROWN_SET').toMatch(/process\.env\.CROWN_SEEDS \?\? CROWN_SET\.join\(','\)/);
  });
});
