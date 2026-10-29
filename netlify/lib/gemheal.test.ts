// Лечение за алмазы (ПН-6, ГДД 3.3.1, решение В11): цена — кривая ожидания от оставшегося срока раненых, та же, что у ускорения стройки;
// остаток сервер берёт больший из своего (часы партии по описи) и названного игрой, не больше полного срока; дороже показанной —
// отказ и «внимание:». Дело ложится партии одной дверью (`applyGemDeeds`) и поднимает раненых со сроком не позже названного.
//
// Граница области — утверждениями: остаток правда больше пяти бесплатных минут и меньше полного срока, иначе цена мерила бы края.
import { describe, expect, it } from 'vitest';
import { applyGemOrder, openLedger } from './gems.js';
import { readGemOrder, readGemEntry, gemDeed } from './contract.js';
import { RUSH_FREE_SECONDS, gemsForWait, healFullSeconds, healLeft, healPriceOfLeft, rushPriceOfWork, GEM_REF_RATE } from '../../src/game/gemrules.js';
import { createInitialState } from '../../src/game/state.js';
import { applyGemDeeds } from '../../src/game/sim/gems.js';
import { DAY_LENGTH, WOUND_DAYS } from '../../src/game/constants.js';
import { gameSeconds } from '../../src/game/pace.js';

const AT = 1_900_000_000_000;

describe('лечение за алмазы: цена', () => {
  it('та же кривая, что ускорение стройки: последние пять минут даром', () => {
    const left = 30 * 60;
    expect(left).toBeGreaterThan(RUSH_FREE_SECONDS);
    expect(left).toBeLessThan(healFullSeconds());
    expect(healPriceOfLeft(left)).toBe(gemsForWait(left - RUSH_FREE_SECONDS));
    // Ускорение стройки на то же ожидание стоит столько же.
    expect(healPriceOfLeft(left)).toBe(rushPriceOfWork(gameSeconds(left) * GEM_REF_RATE));
    expect(healPriceOfLeft(RUSH_FREE_SECONDS)).toBe(0);
    expect(healFullSeconds()).toBeCloseTo(healLeft(WOUND_DAYS * DAY_LENGTH, 0), 6);
  });
});

describe('лечение за алмазы: приказ на сервере', () => {
  const order = (left: number, price: number, until = 5000) => readGemOrder({ op: 'heal', key: 'heal-key-1', until, left, price })!;

  it('читается только целым', () => {
    expect(order(600, 3)).toEqual({ op: 'heal', key: 'heal-key-1', until: 5000, left: 600, price: 3 });
    expect(readGemOrder({ op: 'heal', key: 'heal-key-1', until: -1, left: 600, price: 3 })).toBeNull();
    expect(readGemOrder({ op: 'heal', key: 'heal-key-1', until: 5, left: 600, price: 1.5 })).toBeNull();
  });

  it('честная цена списывается, запись — дело лечения со сроком', () => {
    const left = 30 * 60;
    expect(left).toBeLessThan(healFullSeconds());
    const price = healPriceOfLeft(left);
    const step = applyGemOrder(openLedger(AT), order(left, price), AT, left);
    expect(step.error).toBeUndefined();
    expect(step.entry?.delta).toBe(-price);
    expect(step.entry?.until).toBe(5000);
    const e = readGemEntry(step.entry);
    expect(e && gemDeed(e)).toBe(true);
    // Тот же срок второй раз за десять минут — второй приказ.
    const twice = applyGemOrder(step.ledger!, { ...order(left, price), key: 'heal-key-2' }, AT + 60_000, left);
    expect(twice.error).toMatch(/уже подняты/);
  });

  it('игра назвала остаток меньше часов партии — платит за настоящий; дороже показанной — отказ и «внимание:»', () => {
    const real = 50 * 60;
    expect(real).toBeLessThan(healFullSeconds());
    const cheat = order(600, healPriceOfLeft(600));
    const step = applyGemOrder(openLedger(AT), cheat, AT, real);
    expect(step.ledger).toBeNull();
    expect(step.warn).toMatch(/^лечение раненых/);
    // Остаток больше полного срока не принимается: цена — не выше полного.
    const top = applyGemOrder(openLedger(AT), order(1e9, 1e6), AT, 1e9);
    expect(top.entry?.delta).toBe(-healPriceOfLeft(healFullSeconds()));
    // Последние пять минут — даром и приказом не идут.
    expect(applyGemOrder(openLedger(AT), order(60, 0), AT, 60).error).toMatch(/даром/);
  });
});

describe('лечение за алмазы: дело в партии лорда', () => {
  it('раненые со сроком не позже названного встают в строй, позже — лежат', () => {
    const s = createInitialState(7);
    s.time = 1000;
    s.army.spearman = 2;
    s.wounded = [
      { troops: { spearman: 3 }, until: 1500 },
      { troops: { archer: 2 }, until: 2000 },
      { troops: { clubman: 1 }, until: 9000 },
    ];
    const laid = applyGemDeeds(s, [{ n: 1, at: AT, delta: -20, kind: 'heal', until: 2000 }]);
    expect(laid).toBe(1);
    expect(s.army.spearman).toBe(5);
    expect(s.army.archer).toBe(2);
    expect(s.wounded).toEqual([{ troops: { clubman: 1 }, until: 9000 }]);
    // Повтор того же номера не поднимает второй раз.
    expect(applyGemDeeds(s, [{ n: 1, at: AT, delta: -20, kind: 'heal', until: 9000 }])).toBe(0);
    expect(s.wounded.length).toBe(1);
  });
});
