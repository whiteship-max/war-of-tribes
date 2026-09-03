// Бой. Считается детерминированно по сиду похода: один и тот же поход всегда даёт
// один и тот же исход. Это нужно и для тестов, и для будущего сервера — он должен
// уметь пересчитать бой у себя и получить ровно то же самое.
import { seeded } from '@/game/sim/random';
import type { UnitId, UnitStack } from './types';
import { UNITS } from './data/units';

export interface BattleInput {
  /** Сид похода. */
  seed: number;
  /** Мощь нападающего отряда. */
  attack: number;
  /** Мощь обороны цели. */
  defense: number;
}

export interface BattleOutcome {
  won: boolean;
  /** Удача нападающего, −0.15…+0.15. */
  luck: number;
  /** Доля потерь нападающего и обороняющегося, 0..1. */
  attackerLoss: number;
  defenderLoss: number;
}

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Разведчики держатся позади — их выбивает вчетверо реже, чем воинов. */
const SCOUT_EXPOSURE = 0.4;

/**
 * Короткий расчёт: отношение сил решает исход, удача сдвигает его на ±15%.
 * Проигравший теряет много, но не всё — остатки отряда уходят домой. Игра лёгкая,
 * потерять всё за один неудачный набег нельзя.
 */
export function resolveBattle({ seed, attack, defense }: BattleInput): BattleOutcome {
  const rng = seeded(seed >>> 0);
  const luck = (rng() - 0.5) * 0.3;
  const atk = Math.max(0, attack * (1 + luck));
  const def = Math.max(0.001, defense);
  const ratio = atk / def;

  if (ratio >= 1) {
    return {
      won: true,
      luck,
      attackerLoss: clamp(Math.pow(1 / ratio, 1.5) * 0.9, 0, 0.85),
      defenderLoss: clamp(1 - 0.2 / ratio, 0.5, 1),
    };
  }
  return {
    won: false,
    luck,
    attackerLoss: clamp(0.55 + 0.4 * (1 - ratio), 0.55, 0.95),
    defenderLoss: clamp(Math.pow(ratio, 1.5) * 0.8, 0, 0.7),
  };
}

/** Кого недосчитались: доля потерь по каждому виду юнитов. */
export function stackLosses(units: UnitStack, ratio: number): UnitStack {
  const out: UnitStack = {};
  for (const u of UNITS) {
    const n = units[u.id] ?? 0;
    if (n <= 0) continue;
    const r = clamp(ratio * (u.id === 'scout' ? SCOUT_EXPOSURE : 1), 0, 1);
    const lost = r >= 0.999 ? n : Math.min(n, Math.round(n * r));
    if (lost > 0) out[u.id] = lost;
  }
  return out;
}

/** Что осталось от отряда после потерь. */
export function stackAfter(units: UnitStack, lost: UnitStack): UnitStack {
  const out: UnitStack = {};
  for (const u of UNITS) {
    const n = (units[u.id] ?? 0) - (lost[u.id] ?? 0);
    if (n > 0) out[u.id] = n;
  }
  return out;
}

/** Сид похода из сида мира и его номера: походы не повторяют друг друга. */
export function marchSeed(worldSeed: number, ordinal: number): number {
  let h = (worldSeed ^ Math.imul(ordinal + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Ударная мощь отряда при известной силе одного воина. */
export function stackPower(units: UnitStack, warriorPower: number): number {
  let power = 0;
  for (const u of UNITS) {
    const n = units[u.id] ?? 0;
    if (n > 0) power += n * u.attack * (u.id === 'warrior' ? warriorPower : 1);
  }
  return power;
}

export const unitIds = (): UnitId[] => UNITS.map((u) => u.id);
