// Кузница. Кузнецы куют то, что выбрал игрок; готовое кладётся на склад
// обычным счётчиком. Ни инвентаря, ни качества, ни износа — см. data/equipment.ts.
import type { EquipmentId, GameState } from '../types';
import { RESOURCE_IDS } from '../constants';
import { EQUIPMENT_BY_ID } from '../data/equipment';
import { builtOfType, canAfford, forgeRate } from '../derived';
import type { SeasonModifiers } from '../data/seasons';
import { log } from './log';

/** Выбирает, что куёт кузница. null — снять наряд. */
export function setForging(s: GameState, item: EquipmentId | null): string | null {
  if (item === null) {
    s.forging = null;
    return null;
  }
  const def = EQUIPMENT_BY_ID[item];
  if (!def) return 'Такого снаряжения нет.';
  if (!builtOfType(s, 'smithy')) return 'Сначала построй кузницу.';
  if (s.forging === item) return null;
  s.forging = item;
  // Накопленную работу не выбрасываем: руки кузнеца заняты тем же делом,
  // просто наряд переменился. Больше одного предмета впрок она всё равно не копится.
  return null;
}

/**
 * Шаг кузницы. Работа копится до цены предмета и там останавливается: если
 * материалов нет, кузнец ждёт с готовой заготовкой, а панель пишет, чего не хватает.
 * Так игрок не упирается в молчаливый тупик.
 */
export function forgeTick(s: GameState, dt: number, mods: SeasonModifiers): void {
  const item = s.forging;
  if (!item) return;
  const def = EQUIPMENT_BY_ID[item];
  if (!def) {
    s.forging = null;
    return;
  }
  const rate = forgeRate(s, mods);
  if (rate <= 0) return;
  s.forgeWork = Math.min(def.work, (s.forgeWork ?? 0) + rate * dt);
  // Одна попытка за тик: заготовка готова — платим материалами и кладём предмет.
  if (s.forgeWork < def.work) return;
  if (!canAfford(s, def.cost)) return;
  for (const r of RESOURCE_IDS) s.resources[r] -= def.cost[r] ?? 0;
  s.forgeWork -= def.work;
  s.equipment[item] = (s.equipment[item] ?? 0) + 1;
  log(s, `Кузница: готов ${def.one}.`, 'good');
}
