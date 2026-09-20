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

/**
 * Граница **прибавки** — отношения двух полпути, посчитанная парным бутстрапом по сидам.
 *
 * Конверт из краёв двух границ (`lo` одной к `hi` другой) шире правды: у обеих армий бои идут на
 * **одних и тех же** сидах, и сид, неудобный одной, неудобен и другой. Бутстрап переигрывает набор
 * сидов целиком — один и тот же набор для обеих армий, — и меряет разброс самого отношения.
 * Новых боёв он не гонит: переигрываются исходы уже сыгранных.
 */
export interface Ratio {
  /** Отношение полпути: армия с конницей к армии без неё. */
  ratio: number;
  lo: number;
  hi: number;
}

/** Ступени, до которых кривую считать имеет смысл: дальше её перешла даже нижняя граница доли. */
function span(lost: (k: number) => readonly boolean[], shares: readonly number[], n: number): number[] {
  const ks: number[] = [];
  for (const k of shares) {
    ks.push(k);
    const all = lost(k);
    const take = Math.min(n, all.length);
    let x = 0;
    for (let i = 0; i < take; i++) if (all[i]) x++;
    if (wilson(x, take).lo >= 0.5) break;
  }
  return ks;
}

/** Целое из сида: генератор бутстрапа свой, чтобы прогон повторялся буква в букву. */
const rng = (seed: number): (() => number) => {
  let x = (seed | 0) || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
};

/**
 * Перевыборка сидов для нескольких кривых разом: на каждом броске **один и тот же** набор сидов
 * идёт всем кривым, и полпути у них гуляют вместе. Из этого считается всё, что сравнивает кривые
 * между собой, — прибавка конницы и доля, на которой она достигает решения.
 */
export function bootstrapHalves(
  curves: ((k: number) => readonly boolean[])[],
  shares: readonly number[],
  n: number,
  draws = 400,
  seed = 7919,
): { point: number[]; draws: number[][] } {
  const ks = curves.map((c) => span(c, shares, n));
  const point = (i: number, pick: number[]): number =>
    crossing((k) => {
      const all = curves[i](k);
      let x = 0;
      for (const j of pick) if (all[j]) x++;
      return x / pick.length;
    }, ks[i]);
  const all = Array.from({ length: n }, (_, i) => i);
  const next = rng(seed);
  const out: number[][] = [];
  for (let d = 0; d < draws; d++) {
    // Один и тот же набор сидов всем кривым: в этом вся парность.
    const pick = Array.from({ length: n }, () => Math.floor(next() * n));
    out.push(curves.map((_, i) => point(i, pick)));
  }
  return { point: curves.map((_, i) => point(i, all)), draws: out };
}

/** Доли перевыборки, из которых складывается граница в 95 %. */
export function percentile(xs: number[], p: number): number {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN;
}

export function ratioBand(
  base: (k: number) => readonly boolean[],
  with_: (k: number) => readonly boolean[],
  shares: readonly number[],
  n: number,
  draws = 400,
  seed = 7919,
): Ratio {
  const boot = bootstrapHalves([base, with_], shares, n, draws, seed);
  const ratios = boot.draws.map(([a, b]) => b / a);
  return { ratio: boot.point[1] / boot.point[0], lo: percentile(ratios, 0.025), hi: percentile(ratios, 0.975) };
}
