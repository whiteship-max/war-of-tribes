// Генератор случайных чисел с возможностью подмены (для тестов).
let generator: () => number = Math.random;

export const rnd = (): number => generator();
export const rndInt = (min: number, max: number): number => min + Math.floor(rnd() * (max - min + 1));
export const chance = (p: number): boolean => rnd() < p;
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];

export function setRandom(fn: () => number): void {
  generator = fn;
}

/** Простой детерминированный генератор (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
