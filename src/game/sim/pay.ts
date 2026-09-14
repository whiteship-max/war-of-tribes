// Плата со склада и возврат цены — одна дверь на всё, что игрок заказывает вперёд:
// улучшение, ковку, набор в казармы, изучение округи и обряд.
//
// Возврат был написан четырежды, и копии успели разойтись: три резали вернувшееся
// вместимостью склада, изучение округи — нет, и отменённые разъезды клали на полный
// склад сверх потолка. Правило одно, и оно то же, что у выработки, наград и
// каравана: сверх вместимости на склад не ложится ничего.
import type { GameState, ResourceId } from '../types';
import { RESOURCE_IDS } from '../constants';
import { storageCap } from '../derived';
import { recordSpent } from '@/profile/stats';

export type Price = Partial<Record<ResourceId, number>>;

/**
 * Списать цену со склада и засчитать её в траты профиля. Хватает ли, спрашивают
 * до вызова (`canAfford`): здесь не проверяется ничего.
 */
export function pay(s: GameState, cost: Price): void {
  for (const r of RESOURCE_IDS) s.resources[r] -= cost[r] ?? 0;
  recordSpent(s, cost);
}

/**
 * Вернуть на склад `k` цен: по `floor(n × k)` каждого ресурса, но не выше
 * вместимости. `k` — доля (половина начатого) или число (нетронутые предметы
 * заказа), или то и другое сразу: целые цены делятся на целое без остатка, и
 * округляется только половина.
 */
export function refund(s: GameState, cost: Price, k: number): void {
  const cap = storageCap(s);
  for (const r of RESOURCE_IDS) {
    const n = cost[r];
    if (n) s.resources[r] = Math.min(cap, s.resources[r] + Math.floor(n * k));
  }
}
