// Среднее по сидам и его шум для Ц4 `stability:report` (ПБ-1, п. 7). Область — наборы от двух сидов (у одного разброса нет).
import { describe, expect, it } from 'vitest';
import { bandVerdict, meanBand } from './drift';

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
});
