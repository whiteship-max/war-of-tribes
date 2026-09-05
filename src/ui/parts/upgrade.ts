import type { Building, GameState } from '@/game/types';
import { RECRUIT_WORK } from '@/game/constants';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { OFFER_PER_LEVEL } from '@/game/data/market';
import { buildingHousing, buildingSlots, buildingStat, levelOutputMult } from '@/game/derived';

/**
 * Что именно даст следующий уровень — у склада и у лесопилки это разные вещи.
 * Прибавка считается разностью настоящих величин, а не берётся из `perLevel`:
 * у Дома вождя жильё появляется не с первого уровня.
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
  const stats: [keyof typeof def & ('storage' | 'defense' | 'morale' | 'archers'), string][] = [
    ['storage', 'к вместимости склада'],
    ['defense', 'к защите'],
    ['morale', 'к морали'],
    ['archers', 'стрелков ополчения на стене'],
  ];
  for (const [key, label] of stats) {
    const d = buildingStat(at(toLevel), key) - buildingStat(at(b.level), key);
    if (d) parts.push(`+${d} ${label}`);
  }
  // Главное, что даёт уровень казармам и рынку, в пассивы не попадает: скорость
  // учений и прилавок считаются своими формулами. Без этих строк на кнопке
  // улучшения казарм стояла бы одна защита, а рынка — одна мораль.
  if (b.type === 'barracks') {
    const rate = (level: number): number => RECRUIT_WORK * level * levelOutputMult(level);
    const gain = Math.round((rate(toLevel) / Math.max(0.001, rate(b.level)) - 1) * 100);
    parts.push(`+${gain}% к скорости учений`);
  }
  if (b.type === 'market') {
    const goods = OFFER_PER_LEVEL * (toLevel - b.level);
    if (goods) parts.push(`+${goods} ${goods === 1 ? 'товар' : 'товара'} на прилавке`);
    parts.push('больше дневного запаса и короче дорога каравана');
  }
  return parts.length > 0 ? parts.join(', ') : 'Здание станет крепче';
}
