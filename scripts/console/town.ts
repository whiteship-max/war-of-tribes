// Посёлок мерки для консоли: тот же, что у отчётов (`autopilot.townAt`), — уровни построек, жители, склад и войско мерки.
import { kindsOf } from '@/game/battle/price';
import type { GameState, TroopId } from '@/game/types';
import { TROOP_IDS } from '@/game/data/troops';
import { militiaArchers, militiaMen } from '@/world/bridge';
import { townAt } from '../autopilot';
import { troopsWords, type SideSpec } from './lib';

/** Посёлок уровня `level`; `army` — своё войско вместо мерки (виды племени, головы). */
export function townOf(level: number, army?: Partial<Record<TroopId, number>>): GameState {
  const g = townAt(level);
  if (army) for (const id of TROOP_IDS) g.army[id] = Math.max(0, Math.round(army[id] ?? 0));
  return g;
}

/** Оборона посёлка: весь гарнизон дома, ополчение и стрелки башни — как их считает мир (`world/bridge`). */
export function townSide(level: number, _seed: number, army?: Partial<Record<TroopId, number>>): { side: SideSpec; militia: number; archers: number; g: GameState } {
  const g = townOf(level, army);
  const side: SideSpec = { troops: { ...g.army }, kinds: kindsOf(g.army), beasts: false, read: `гарнизон посёлка ${level}-го уровня (${troopsWords(g.army)})` };
  return { side, militia: militiaMen(g), archers: militiaArchers(g), g };
}
