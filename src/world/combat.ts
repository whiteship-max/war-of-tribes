// Отряд в числах: потери, остаток, ударная мощь и сид похода. Сам бой считает
// ядро (`src/battle/`), а собирает стороны `world/battle.ts` — здесь только
// перевод «доля потерь → люди», на котором держатся добыча и последствия.
import type { UnitStack } from './types';
import { UNITS } from './data/units';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Разведчики держатся позади — их выбивает реже, чем воинов: потери множатся на эту долю. */
const SCOUT_EXPOSURE = 0.4;

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
