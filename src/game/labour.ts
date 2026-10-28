// Труд и цена улучшения — одна формула на игру (`derived.upgradeWork`, `derived.upgradeCost`: стройка) и на сервер
// (`netlify/lib/gems.ts`: потолок цены ускорения — полный труд уровня, docs/gems.md; `netlify/lib/watch.ts`: стройка без
// платы, docs/security.md). Две формулы разошлись бы молча: сервер брал бы за ускорение не то, что показывает кнопка, и
// ждал бы со склада не ту цену, что списала игра. Без `@/`-импортов: модуль читает серверная часть.
import { CANCEL_STARTED_SHARE, RESOURCE_IDS, UPGRADE_GROWTH } from './constants';
import type { BuildingDef } from './data/buildings';
import type { ResourceId } from './types';

/** Цена здания по частям: у двора с двумя делами — цены дел (ЗД-1, `BuildingDef.parts`), у остальных — оно само. */
type Priced = Pick<BuildingDef, 'cost' | 'work' | 'parts'>;
const partsOf = (def: Partial<Priced>): readonly Partial<Pick<BuildingDef, 'cost' | 'work'>>[] => def.parts ?? [def];

/**
 * Работа строителей на улучшение до уровня `toLevel` — растёт так же, как цена. У двора с двумя делами — работа **более долгого**
 * из его дел, каждое своей лестницей и своим округлением (ПБ-1, п. 5, решение владельца 28.10.2026: время улучшения двора — по
 * более долгому из двух прежних, а не сумма; прежде, с ЗД-1, — сумма). Цена и возврат отмены — по-прежнему сумма частей.
 */
export const upgradeWork = (def: Partial<Priced>, toLevel: number): number =>
  partsOf(def).reduce((n, p) => Math.max(n, Math.round((p.work ?? 0) * Math.pow(UPGRADE_GROWTH, toLevel - 1))), 0);

/**
 * Цена улучшения до уровня `toLevel`: базовая стоимость, умноженная на `UPGRADE_GROWTH` за каждый уровень. У двора с двумя
 * делами — сумма цен дел, каждая со своим округлением (ЗД-1): кто качал два прежних здания вровень, платит бит в бит то же.
 */
export function upgradeCost(def: Partial<Priced>, toLevel: number): Partial<Record<ResourceId, number>> {
  const k = Math.pow(UPGRADE_GROWTH, toLevel - 1);
  const out: Partial<Record<ResourceId, number>> = {};
  for (const p of partsOf(def)) {
    for (const r of RESOURCE_IDS) if (p.cost?.[r]) out[r] = (out[r] ?? 0) + Math.round((p.cost[r] as number) * k);
  }
  return out;
}

/**
 * Доля цены, которую возвращает отмена улучшения (СТ-1): начатое — половину (`CANCEL_STARTED_SHARE`), нетронутое — целиком.
 * Начатое — то, на что легла работа, а работа ложится только на первое в очереди. Одно правило на игру
 * (`sim/actions.cancelUpgrade`) и на сервер (`netlify/lib/watch.ts`: возврат не больше положенного).
 */
export const cancelShare = (started: boolean): number => (started ? CANCEL_STARTED_SHARE : 1);

/**
 * Сколько вернёт отмена улучшения до уровня `toLevel` — по `floor` каждого ресурса, как `sim/pay.refund`. У двора с двумя
 * делами — по делам, как вернули бы два прежних здания (ЗД-1).
 */
export function cancelRefund(def: Partial<Priced>, toLevel: number, started: boolean): Partial<Record<ResourceId, number>> {
  const k = cancelShare(started);
  const out: Partial<Record<ResourceId, number>> = {};
  for (const p of partsOf(def)) {
    for (const [r, v] of Object.entries(upgradeCost({ cost: p.cost ?? {} }, toLevel)) as [ResourceId, number][]) {
      if (Math.floor(v * k) > 0) out[r] = (out[r] ?? 0) + Math.floor(v * k);
    }
  }
  return out;
}
