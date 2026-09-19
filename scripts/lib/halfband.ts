/**
 * Доверительная граница «полпути» — силы противника, при которой проигрывается половина боёв.
 *
 * Отчёт «Конюшня» (`raid-stable.ts`) меряет силу армии точкой, где доля проигранных боёв доходит до
 * половины: на каждой ступени силы гоняется `n` боёв с разными сидами, между ступенями — линейно. Доля
 * из `n` боёв — оценка, а не число, и чем меньше боёв, тем шире её разброс; полпути наследует его.
 * Без границы в самом выводе меньшее число боёв превратило бы долю побед в шум, и заметить это было бы
 * нечем (docs/realm.md, раздел 8, «Цена разделов raid:report»).
 *
 * Граница — по точкам: на каждой ступени интервал Уилсона для доли проигранных (95 %), и полпути
 * верхней кривой (раньше доходит до половины) и нижней (позже). Интервал по точкам, не по кривой
 * целиком: сиды у ступеней общие, и кривая одного набора сидов идёт гладко — её разброс и есть то,
 * что меряется.
 */

/** z для двусторонних 95 %. */
export const Z95 = 1.96;

/** Интервал Уилсона для доли `k` успехов из `n`. */
export function wilson(k: number, n: number, z: number = Z95): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const mid = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z / (1 + z2 / n)) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) };
}

/** Полпути кривой `share` по ступеням `shares`: где доля доходит до половины, линейно между ступенями. */
export function crossing(share: (k: number) => number, shares: readonly number[]): number {
  let prevK = shares[0];
  let prev = share(prevK);
  if (prev >= 0.5) return prevK;
  for (let i = 1; i < shares.length; i++) {
    const k = shares[i];
    const r = share(k);
    if (r >= 0.5) return prevK + ((0.5 - prev) / Math.max(1e-9, r - prev)) * (k - prevK);
    prevK = k;
    prev = r;
  }
  return Infinity;
}

export interface Band {
  /** Полпути по доле. */
  half: number;
  /** Полпути верхней границы доли: сильнее этого армия быть может, слабее — вряд ли. */
  lo: number;
  /** Полпути нижней границы доли. */
  hi: number;
}

/**
 * Полпути и граница по исходам боёв. `lost(k)` — по бою на сид: проигран ли (одни и те же сиды на
 * каждой ступени); `n` — сколько первых сидов брать, чтобы увидеть, какой была бы граница при меньшем
 * числе боёв на тех же боях.
 */
export function halfBand(lost: (k: number) => readonly boolean[], shares: readonly number[], n?: number): Band {
  const count = (k: number): [number, number] => {
    const all = lost(k);
    const take = Math.min(n ?? all.length, all.length);
    let x = 0;
    for (let i = 0; i < take; i++) if (all[i]) x++;
    return [x, take];
  };
  return {
    half: crossing((k) => {
      const [x, m] = count(k);
      return x / m;
    }, shares),
    lo: crossing((k) => wilson(...count(k)).hi, shares),
    hi: crossing((k) => wilson(...count(k)).lo, shares),
  };
}

/** Относительная полуширина границы: (hi − lo) / 2 / полпути. Бесконечность, если граница не замкнулась. */
export const spread = (b: Band): number => (b.hi - b.lo) / 2 / b.half;
