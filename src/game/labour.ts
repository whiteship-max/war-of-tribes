// Труд и цена улучшения — одна формула на игру (`derived.upgradeWork`, `derived.upgradeCost`: стройка) и на сервер
// (`netlify/lib/gems.ts`: потолок цены ускорения — полный труд уровня, docs/gems.md; `netlify/lib/watch.ts`: стройка без
// платы, docs/security.md). Две формулы разошлись бы молча: сервер брал бы за ускорение не то, что показывает кнопка, и
// ждал бы со склада не ту цену, что списала игра. Без `@/`-импортов: модуль читает серверная часть.
import { CANCEL_STARTED_SHARE, RESOURCE_IDS, UPGRADE_GROWTH } from './constants';
import type { BuildingDef } from './data/buildings';
import type { ResourceId } from './types';

/** Работа строителей на улучшение до уровня `toLevel` — растёт так же, как цена. */
export const upgradeWork = (def: Pick<BuildingDef, 'work'>, toLevel: number): number =>
  Math.round(def.work * Math.pow(UPGRADE_GROWTH, toLevel - 1));

/** Цена улучшения до уровня `toLevel`: базовая стоимость, умноженная на `UPGRADE_GROWTH` за каждый уровень. */
export function upgradeCost(def: Pick<BuildingDef, 'cost'>, toLevel: number): Partial<Record<ResourceId, number>> {
  const k = Math.pow(UPGRADE_GROWTH, toLevel - 1);
  const out: Partial<Record<ResourceId, number>> = {};
  for (const r of RESOURCE_IDS) if (def.cost[r]) out[r] = Math.round((def.cost[r] as number) * k);
  return out;
}

/**
 * Доля цены, которую возвращает отмена улучшения (СТ-1): начатое — половину (`CANCEL_STARTED_SHARE`), нетронутое — целиком.
 * Начатое — то, на что легла работа, а работа ложится только на первое в очереди. Одно правило на игру
 * (`sim/actions.cancelUpgrade`) и на сервер (`netlify/lib/watch.ts`: возврат не больше положенного).
 */
export const cancelShare = (started: boolean): number => (started ? CANCEL_STARTED_SHARE : 1);

/** Сколько вернёт отмена улучшения до уровня `toLevel` — по `floor` каждого ресурса, как `sim/pay.refund`. */
export function cancelRefund(def: Pick<BuildingDef, 'cost'>, toLevel: number, started: boolean): Partial<Record<ResourceId, number>> {
  const k = cancelShare(started);
  const out: Partial<Record<ResourceId, number>> = {};
  for (const [r, v] of Object.entries(upgradeCost(def, toLevel)) as [ResourceId, number][]) if (Math.floor(v * k) > 0) out[r] = Math.floor(v * k);
  return out;
}
