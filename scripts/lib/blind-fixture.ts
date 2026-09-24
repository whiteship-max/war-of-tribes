// Модуль для теста слепоты быстрой приёмки (`blind.test.ts`): его выполняют под vite-node с покрытием, и
// тест знает, что здесь исполнилось, а что нет. Строки находятся по тексту, а не по номерам.
export const RATE = 2;
export const BASE = 1;

export function used(n: number): number {
  if (n > 10) {
    return n * 100;
  }
  return n + BASE;
}

export function unused(n: number): number {
  return n * RATE;
}

used(1);
