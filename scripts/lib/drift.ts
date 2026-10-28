/**
 * Среднее по сидам и его шум (ПБ-1, п. 7; docs/siege_v2.md, «Решения ПБ-1»): Ц4 `stability:report` меряет сдвиг стабильности от
 * вестей средним по сидам, и одно число без шума не говорит, вышло ли оно за цель или качнулось в пределах набора (−5.2 % при цели
 * ±5 на шести сидах — флаг приёмки ПЛ-1). Граница — нормальная, по разбросу сидов (у шести сидов — грубо, но видно порядок).
 */
import { Z95 } from './halfband';

export interface MeanBand {
  mean: number;
  /** Стандартная ошибка среднего: разброс сидов на корень из их числа. */
  se: number;
  lo: number;
  hi: number;
}

/** Среднее значений `xs` (по сиду на значение) и его 95-процентная граница. Меньше двух — границы нет (ширина ноль). */
export function meanBand(xs: readonly number[]): MeanBand {
  const n = xs.length;
  const mean = n > 0 ? xs.reduce((a, b) => a + b, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
  const se = n > 1 ? sd / Math.sqrt(n) : 0;
  return { mean, se, lo: mean - Z95 * se, hi: mean + Z95 * se };
}

/** Где граница среднего относительно цели ±`limit`: вся внутри, вся снаружи или цель в пределах шума набора. */
export function bandVerdict(b: MeanBand, limit: number): 'в цели' | 'вне цели' | 'граница цели в шуме набора' {
  if (b.lo >= -limit && b.hi <= limit) return 'в цели';
  if (b.hi < -limit || b.lo > limit) return 'вне цели';
  return 'граница цели в шуме набора';
}
