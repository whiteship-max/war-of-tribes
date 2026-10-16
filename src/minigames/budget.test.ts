/**
 * Бюджет кадра промыслов — счётом по графу сцены (docs/minigames.md, 8; потолки по ступени — docs/polish.md, П-4): тот
 * же граф, что рисуется (`world.furnish`), с той лепкой, с которой сцена встаёт на ступени (`Play.dress`). Область: все
 * четыре игры (рыбалка — у реки и у моря), три ступени, у каждой — её тень (`tier.SHADOWS`: у пола теней нет). Точка
 * внутри области — в графе есть то, ради чего игра: ягоды инстансами, стадо, олени с луком, вода с удочкой.
 */
import { describe, expect, it } from 'vitest';
import { MINI_BUDGET, budgetOf } from './budget';
import { TIERS } from '@/prologue/look';

describe('промыслы: бюджет кадра', () => {
  for (const [id, shore] of [
    ['berries', 'river'],
    ['herd', 'river'],
    ['hunt', 'river'],
    ['fish', 'river'],
    ['fish', 'sea'],
  ] as const) {
    for (const tier of TIERS) {
      it(`${id}${id === 'fish' ? ` (${shore})` : ''}, ${tier}: вызовов и треугольников не больше потолка ступени`, () => {
        const c = budgetOf(id, tier, shore);
        const lim = MINI_BUDGET[tier];
        expect(c.calls, 'в графе что-то есть').toBeGreaterThan(5);
        expect(c.calls + c.shadowCalls, `${id} вызовов`).toBeLessThanOrEqual(lim.calls);
        expect(c.triangles + c.shadowTriangles, `${id} треугольников`).toBeLessThanOrEqual(lim.triangles);
        if (tier === 'base') expect(c.shadowCalls, 'у пола теней нет').toBe(0);
      });
    }
  }

  it('потолок не растёт вниз по ступеням: телефон не дороже настольного, пол — не дороже телефона', () => {
    expect(MINI_BUDGET.lite.triangles).toBeLessThanOrEqual(MINI_BUDGET.full.triangles);
    expect(MINI_BUDGET.base.triangles).toBeLessThanOrEqual(MINI_BUDGET.lite.triangles);
    expect(MINI_BUDGET.lite.calls).toBeLessThanOrEqual(MINI_BUDGET.full.calls);
  });

  it('ягоды — одним вызовом на всю поляну, а не по вызову на ягоду; стадо — по вызову на породу', () => {
    const berries = budgetOf('berries', 'lite', 'river', false);
    const herd = budgetOf('herd', 'lite', 'river', false);
    // Сотня ягод инстансами — один вызов: разница в вызовах между играми — стадо, загон и стог, а не ягоды.
    expect(berries.calls).toBeLessThan(24);
    expect(herd.calls).toBeGreaterThan(berries.calls);
    // Стадо копиями: восемь-девять животных — четыре породы, а не девять вызовов на туловища и девять на ноги.
    expect(herd.calls, 'стадо копиями').toBeLessThan(berries.calls + 22);
  });
});
