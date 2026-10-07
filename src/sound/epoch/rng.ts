// Сеяная кость звука. Случайность устройства в звуке законна (`sim/random.test.ts`), но сеяная удобнее: образцы для
// владельца (`npm run audio:samples`) и тесты повторяются от зерна, а в игре зерно берётся случайным один раз.

export type Rng = () => number;

/** mulberry32: тридцать два бита состояния, period 2^32 — для музыки с запасом. */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Целое в [lo, hi]. */
export const int = (rnd: Rng, lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));

/** Число в [lo, hi). */
export const span = (rnd: Rng, lo: number, hi: number): number => lo + rnd() * (hi - lo);

/** Один из. */
export const pick = <T>(rnd: Rng, items: readonly T[]): T => items[Math.floor(rnd() * items.length)];

/** Из взвешенного списка. */
export function weighted<T>(rnd: Rng, items: readonly (readonly [T, number])[]): T {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [v, w] of items) {
    r -= w;
    if (r < 0) return v;
  }
  return items[items.length - 1][0];
}
