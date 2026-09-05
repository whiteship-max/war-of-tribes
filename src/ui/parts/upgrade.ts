import type { Building, GameState } from '@/game/types';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { buildingHousing, buildingSlots, buildingStat, levelOutputMult } from '@/game/derived';

/**
 * Что именно даст следующий уровень — у склада и у лесопилки это разные вещи.
 * Прибавка считается разностью настоящих величин, а не берётся из `perLevel`:
 * у ратуши жильё появляется не с первого уровня.
 */
export function upgradeGain(s: GameState, b: Building, toLevel: number): string {
  const def = BUILDING_BY_ID[b.type];
  const at = (level: number): Building => ({ ...b, level });
  const parts: string[] = [];
  if (def.job) {
    const step = Math.round((levelOutputMult(toLevel) - levelOutputMult(b.level)) * 100);
    const slots = buildingSlots(at(toLevel)) - buildingSlots(at(b.level));
    parts.push(`+${slots} ${slots === 1 ? 'рабочее место' : 'рабочих мест'}`, `+${step}% к выработке`);
  }
  const housing = buildingHousing(at(toLevel)) - buildingHousing(at(b.level));
  if (housing) parts.push(`+${housing} к жилью`);
  const stats: [keyof typeof def & ('storage' | 'defense' | 'morale'), string][] = [
    ['storage', 'к вместимости склада'],
    ['defense', 'к защите'],
    ['morale', 'к морали'],
  ];
  for (const [key, label] of stats) {
    const d = buildingStat(at(toLevel), key) - buildingStat(at(b.level), key);
    if (d) parts.push(`+${d} ${label}`);
  }
  return parts.length > 0 ? parts.join(', ') : 'Здание станет крепче';
}
