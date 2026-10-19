// Слова отчёта о походе: кто ушёл и не вернулся, что привезли. Одна дверь на отчёт (`ReportPanel`) и на карточку итога
// ролика боя (`ui/battle/TwReplay`): строка, сказанная в двух местах своей арифметикой, разошлась бы при первой правке
// (CLAUDE.md, правило 18).
import { RESOURCE_IDS, RESOURCE_META } from '@/game/constants';
import { UNITS } from '@/world/data/units';
import type { Loot, UnitStack } from '@/world/types';

/** Отряд словами: вид и число, «—» — никого. Строка, а не значки: её вставляют в другие строки (сводка похода). */
export const unitsText = (units: UnitStack): string =>
  UNITS.filter((u) => (units[u.id] ?? 0) > 0)
    .map((u) => `${u.name.toLowerCase()} ${units[u.id]}`)
    .join(' · ') || '—';

/** Добыча словами: припас и число, золото последним. Пусто — пустая строка. */
export const lootText = (loot: Loot | null): string => {
  if (!loot) return '';
  const parts = RESOURCE_IDS.filter((r) => loot[r]).map((r) => `${RESOURCE_META[r].name.toLowerCase()} ${Math.abs(loot[r] as number)}`);
  if (loot.gold) parts.push(`золото ${Math.abs(loot.gold)}`);
  return parts.join(' · ');
};
