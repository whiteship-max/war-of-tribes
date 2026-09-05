// Свой генератор, чтобы модуль боя ни от чего не зависел: mulberry32, как и в
// остальной игре. Один сид — одна последовательность и в браузере, и на Node.

export type Rng = () => number;

export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
