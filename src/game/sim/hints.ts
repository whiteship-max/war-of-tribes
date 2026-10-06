// Подсказки по ходу игры: какие показаны и выключены ли — одна дверь к полю `GameState.hints` (docs/rating.md).
// Что сказать и когда пора — данные `data/hints.ts`; показывает `ui/next/Hints.tsx`.
import type { GameState } from '../types';

/** Эта подсказка уже показана. */
export const hintSeen = (s: GameState, id: string): boolean => s.hints?.seen.includes(id) ?? false;

/** Игрок выключил подсказки в настройках. */
export const hintsOff = (s: GameState): boolean => s.hints?.off === true;

/** Отметить показанной: второй раз она не встанет — ни на этом устройстве, ни на другом (поле лежит в партии). */
export function markHint(s: GameState, id: string): void {
  if (hintSeen(s, id)) return;
  s.hints = { ...s.hints, seen: [...(s.hints?.seen ?? []), id] };
}

/** Включить или выключить подсказки. Показанные остаются показанными. */
export function setHintsOff(s: GameState, off: boolean): void {
  s.hints = { seen: s.hints?.seen ?? [], ...(off ? { off: true } : {}) };
}
