/**
 * Бюджет кадра промыслов — счётом по графу сцены (docs/minigames.md, 8): тот же граф, что рисуется (`world.furnish`).
 * Область: обе игры, с тенью и без (пол `base` теней не держит). Точка внутри области — в графе есть то, ради чего
 * игра: ягоды инстансами и стадо.
 */
import { describe, expect, it } from 'vitest';
import { MINI_BUDGET, budgetOf } from './budget';

describe('промыслы: бюджет кадра', () => {
  for (const id of ['berries', 'herd'] as const) {
    it(`${id}: вызовов и треугольников не больше потолка — с тенью и без`, () => {
      for (const shadows of [true, false]) {
        const c = budgetOf(id, shadows);
        expect(c.calls, 'в графе что-то есть').toBeGreaterThan(5);
        expect(c.calls + c.shadowCalls, `${id} вызовов`).toBeLessThanOrEqual(MINI_BUDGET.calls);
        expect(c.triangles + c.shadowTriangles, `${id} треугольников`).toBeLessThanOrEqual(MINI_BUDGET.triangles);
        if (!shadows) expect(c.shadowCalls).toBe(0);
      }
    });
  }

  it('ягоды — одним вызовом на всю поляну, а не по вызову на ягоду', () => {
    const berries = budgetOf('berries', false);
    const herd = budgetOf('herd', false);
    // Сотня ягод инстансами — один вызов: разница в вызовах между играми — стадо, загон и стог, а не ягоды.
    expect(berries.calls).toBeLessThan(20);
    expect(herd.calls).toBeGreaterThan(berries.calls);
  });
});
