// Труд и цена улучшения — одна формула на игру (`derived.upgradeWork`, `derived.upgradeCost`: стройка) и на сервер
// (`netlify/lib/gems.ts`: потолок цены ускорения — полный труд уровня, docs/gems.md; `netlify/lib/watch.ts`: стройка без
// платы, docs/security.md). Две формулы разошлись бы молча: сервер брал бы за ускорение не то, что показывает кнопка, и
// ждал бы со склада не ту цену, что списала игра. Без `@/`-импортов: модуль читает серверная часть.
import { RESOURCE_IDS, UPGRADE_GROWTH } from './constants';
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
