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
  if (RESOURCE_IDS.some((r) => (cost[r] ?? 0) > 0)) outlay(s);
}

/**
 * Разовая трата — склад или казна убыли разом (`stats.outlays`). Её зовёт каждая дверь, которая убавляет склад или
 * казну мимо расхода и разовых дел: без неё книга запасов сервера сочла бы честную трату спрятанным добром (docs/security.md,
 * ЗЩ-2). Какие двери, держит тест (`sim/outlays.test.ts`).
 */
export function outlay(s: GameState): void {
  s.stats.outlays = (s.stats.outlays ?? 0) + 1;
}

/**
 * Вернуть на склад `k` цен: по `floor(n × k)` каждого ресурса, но не выше
 * вместимости. `k` — доля (половина начатого) или число (нетронутые предметы
 * заказа), или то и другое сразу: целые цены делятся на целое без остатка, и
 * округляется только половина.
 *
 * Возврат — разовое дело описи (`stats.windfalls`): добро легло на склад разом, мимо выработки, и сервер не должен
 * счесть его флагом «рост склада» (docs/security.md, раздел 8).
 */
export function refund(s: GameState, cost: Price, k: number): void {
  const cap = storageCap(s);
  let back = false;
  for (const r of RESOURCE_IDS) {
    const n = cost[r];
    if (n) s.resources[r] = Math.min(cap, s.resources[r] + Math.floor(n * k));
    if (n && Math.floor(n * k) > 0) back = true;
  }
  if (back) s.stats.windfalls = (s.stats.windfalls ?? 0) + 1;
}
