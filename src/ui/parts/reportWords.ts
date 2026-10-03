// Слова отчёта о походе: кто ушёл и не вернулся, что привезли. Одна дверь на отчёт (`ReportPanel`) и на карточку итога
// ролика боя (`ui/battle/TwReplay`): строка, сказанная в двух местах своей арифметикой, разошлась бы при первой правке
// (CLAUDE.md, правило 18).
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { UNITS } from '@/world/data/units';
import type { Loot, UnitStack } from '@/world/types';

/** Отряд словами: значок и число по видам, «—» — никого. */
export const unitsText = (units: UnitStack): string =>
  UNITS.filter((u) => (units[u.id] ?? 0) > 0)
    .map((u) => `${u.icon} ${units[u.id]}`)
    .join(' · ') || '—';

/** Добыча словами: значок и число по припасам и золоту. Пусто — пустая строка. */
export const lootText = (loot: Loot | null): string => {
  if (!loot) return '';
  const parts = RESOURCE_IDS.filter((r) => loot[r]).map((r) => `${RESOURCE_META[r].icon} ${Math.abs(loot[r] as number)}`);
  if (loot.gold) parts.push(`💰 ${Math.abs(loot.gold)}`);
  return parts.join(' · ');
};
