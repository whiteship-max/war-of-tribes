// Доля обнаружений по видам лагеря (ГДД 3.5.3, 3.5.4) — пробами на заглушках ПН-4у.
//
//   заметность = местность × лагерь × размер × ночь × режим марша
//   виден      = расстояние ≤ радиус наблюдателя × заметность
//
// Двери `world/sight` для отряда ещё нет (ПН-4у): множители, радиусы и то, как близко проходит чужой отряд, — входы раздела.
// Местность — настоящая: клетки суши вокруг мест выхода теста с игроками (`world/spawn.SICILY`, `geography.terrainAt`).
// Лагерь в руинах прячет одним множителем руин: 3.5.3 и 3.5.4 называют одно число дважды, и вдвое оно не идёт.
import type { Terrain } from '../../src/world/types';
import type { Gait } from '../../src/world/data/gait';
import { terrainAt } from '../../src/world/geography';
import { SICILY } from '../../src/world/spawn';
import { mixSeed, seeded } from '../../src/game/sim/random';
import type { Camp } from './kinds';

export interface SightKnobs {
  terrain: Record<Terrain, number>;
  size: { per: number; pow: number; floor: number };
  night: number;
  gait: Record<Gait, number>;
  band: number;
  tracker: number;
  camps: Record<Camp, number>;
  /** Лагерь «в пути» — колонна на марше. */
  march: number;
  passing: readonly [number, number];
}

/** Где стоит отряд: лагерь своего вида или колонна в пути режимом марша. */
export type Stand = { camp: Camp } | { march: Gait };

export function visibility(k: SightKnobs, terrain: Terrain, at: Stand, men: number, night: boolean): number {
  const ruin = 'camp' in at && at.camp === 'ruin';
  const ground = ruin ? 1 : k.terrain[terrain];
  const stand = 'camp' in at ? k.camps[at.camp] : k.march * k.gait[at.march];
  const size = Math.max(k.size.floor, Math.pow(men / k.size.per, k.size.pow));
  return ground * stand * size * (night ? k.night : 1);
}

/** Клетки суши в `r` вокруг мест выхода Сицилии — местность, на которой встают отряды теста с игроками. */
export function landAround(r: number): Terrain[] {
  const seen = new Set<string>();
  const out: Terrain[] = [];
  for (const s of SICILY) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const key = `${s.x + dx},${s.y + dy}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const t = terrainAt(0, s.x + dx, s.y + dy);
        if (t !== 'water') out.push(t);
      }
    }
  }
  return out;
}

/** Доля проб, где наблюдатель радиусом `radius` видит отряд: клетка, ночь (каждая вторая проба) и расстояние прохода — сидом. */
export function detectShare(k: SightKnobs, land: readonly Terrain[], at: Stand, men: number, radius: number, samples: number, seed: number): number {
  const rng = seeded(mixSeed(seed, men * 31 + radius * 7));
  let seen = 0;
  for (let i = 0; i < samples; i++) {
    const terrain = land[Math.floor(rng() * land.length)];
    const d = k.passing[0] + (k.passing[1] - k.passing[0]) * rng();
    if (d <= radius * visibility(k, terrain, at, men, i % 2 === 1)) seen++;
  }
  return seen / samples;
}
