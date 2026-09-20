import { describe, expect, it } from 'vitest';
import { crossing, halfBand, ratioBand, spread, wilson } from './halfband';

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

describe('граница прибавки: парный бутстрап по сидам', () => {
  /** Та же кривая, сдвинутая ровно в `k` раз на каждом сиде: прибавка известна и одинакова у всех сидов. */
  const scaled = (t: number[], k: number): number[] => t.map((x) => x * k);
  /** Те же пороги, но перетасованные: прибавка в среднем та же, а пары «сид к сиду» больше нет. */
  const shuffled = (t: number[]): number[] => {
    const out = t.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = (i * 7919) % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  /** Череда чисел из сида: у теста своя, чтобы прогон повторялся. */
  const noise = (seed: number): (() => number) => {
    let x = seed | 0 || 1;
    return () => {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      return (x >>> 0) / 4294967296;
    };
  };

  it('прибавка одна у всех сидов — парная граница почти схлопывается, а без пар она широка', () => {
    // Ступени здесь мельче отчётных: на грубой сетке само полпути ловится с точностью ступени,
    // и эта зазубрина (±0.06) закрыла бы то, что меряется, — разброс от перевыборки сидов.
    const FINE = Array.from({ length: 191 }, (_, i) => 0.2 + i * 0.02);
    const base = thresholds(40);
    const up = scaled(base, 1.2);
    // Область: обе кривые целиком внутри ступеней, иначе полпути упирается в край.
    expect(Math.max(...up)).toBeLessThan(FINE[FINE.length - 1]);
    const paired = ratioBand(lostBy(base), lostBy(up), FINE, 40);
    expect(paired.ratio, 'точка — то же отношение полпути').toBeCloseTo(1.2, 1);
    // Сид, неудобный одной армии, неудобен и другой: перевыборка двигает оба полпути вместе,
    // и отношение почти не гуляет. Возьми армиям разные наборы сидов — это и упадёт.
    expect(paired.hi - paired.lo, 'парная граница почти нулевая').toBeLessThan(0.03);
    const apart = ratioBand(lostBy(base), lostBy(scaled(shuffled(base), 1.2)), FINE, 40);
    expect(apart.ratio, 'прибавка та же — та же кривая, сдвинутая в 1.2 раза').toBeCloseTo(paired.ratio, 1);
    expect(apart.hi - apart.lo, 'без пар граница широка').toBeGreaterThan(0.1);
  });

  it('граница накрывает настоящую прибавку в 95 случаях из ста, а не в половине', () => {
    // Калибровка: настоящая прибавка считается на двух тысячах сидов, а граница — на сорока,
    // и так сорок раз подряд. Сузь доли перевыборки — покрытие провалится.
    const R = noise(4242);
    const POP = 2000;
    const N = 40;
    const runs = POP / N;
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < POP; i++) {
      const x = 1 + R();
      a.push(x);
      b.push(x * (1.2 + (R() - 0.5) * 0.6));
    }
    expect(Math.max(...b), 'область: обе кривые внутри ступеней').toBeLessThan(SHARES[SHARES.length - 1]);
    const truth = ratioBand(lostBy(a), lostBy(b), SHARES, POP, 1).ratio;
    let inside = 0;
    for (let r = 0; r < runs; r++) {
      const pa = a.slice(r * N, r * N + N);
      const pb = b.slice(r * N, r * N + N);
      const band = ratioBand(lostBy(pa), lostBy(pb), SHARES, N);
      if (band.lo <= truth && truth <= band.hi) inside++;
    }
    expect(inside, `накрыла ${inside} из ${runs}`).toBeGreaterThanOrEqual(runs - 4);
  });

  it('вдвое меньше боёв — шире граница', () => {
    const base = thresholds(40);
    const up = scaled(shuffled(base), 1.2);
    const full = ratioBand(lostBy(base), lostBy(up), SHARES, 40);
    const half = ratioBand(lostBy(base), lostBy(up), SHARES, 20);
    expect(full.hi - full.lo, 'граница не схлопнулась').toBeGreaterThan(0);
    expect(half.hi - half.lo).toBeGreaterThan(full.hi - full.lo);
  });
});
