// Кость партии: события деревни и короткая стычка у стены.
//
// Поток выводится из сида партии и числа уже брошенных костей — оба лежат в
// сохранении, — поэтому перезагрузка не перебрасывает кость. Тесты и отчёты
// подменяют её `setRandom` (`sim/random.ts`), игра — никогда.
import type { GameState } from '../types';
import { mixSeed, overridden, seeded } from './random';

/** Следующее число потока партии, 0..1. */
export function roll(s: GameState): number {
  const fixed = overridden();
  if (fixed) return fixed();
  const n = s.rolls ?? 0;
  s.rolls = n + 1;
  return seeded(mixSeed(s.seed ?? 0, n))();
}

export const rollInt = (s: GameState, min: number, max: number): number => min + Math.floor(roll(s) * (max - min + 1));
export const chance = (s: GameState, p: number): boolean => roll(s) < p;
