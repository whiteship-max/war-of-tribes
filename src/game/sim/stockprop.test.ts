// Тест-свойство этапа 8 аудита: склад не выше вместимости и не ниже нуля (решение владельца п. 1, OWNER-DECISIONS: правило
// `max(0, min(cap, before + n))` главнее варианта WORKPLAN «прибавка никогда не уменьшает запас»). Дверь — `sim/stock.addStock`
// на настоящей партии. Область: вместимость от единицы до потолка склада, запас от нуля до вдвое выше вместимости (склад
// потерял уровень), прибавки и убавки любого размера, дробью и через край, и не-числа на входе.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { RESOURCE_IDS } from '../constants';
import { addStock } from './stock';

function dice(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

describe('свойство: addStock держит склад в [0, вместимость]', () => {
  it('десять тысяч прибавок и убавок: запас в пределах, легло со знаком прибавки и не больше её', () => {
    const s = createInitialState(1);
    const rnd = dice(20261025);
    const odd = [Number.NaN, Infinity, -Infinity, 0, -0];
    let over = 0;
    let gains = 0;
    let losses = 0;
    for (let i = 0; i < 10_000; i++) {
      const r = RESOURCE_IDS[Math.floor(rnd() * RESOURCE_IDS.length)];
      const cap = 1 + Math.floor(rnd() * 50_000);
      const before = rnd() < 0.2 ? cap * (1 + rnd()) : cap * rnd();
      const n = rnd() < 0.02 ? odd[Math.floor(rnd() * odd.length)] : (rnd() - 0.5) * 3 * cap;
      s.resources[r] = before;
      if (before > cap) over++;
      const laid = addStock(s, r, n, cap);
      const after = s.resources[r];
      const at = `шаг ${i}: ${r}, было ${before}, вместимость ${cap}, n ${n}`;
      expect(Number.isFinite(after), at).toBe(true);
      expect(after, at).toBeGreaterThanOrEqual(0);
      expect(after, at).toBeLessThanOrEqual(cap);
      const from = Math.min(before, cap);
      expect(laid, at).toBeCloseTo(after - from, 6);
      if (Number.isFinite(n) && n > 0) {
        gains++;
        expect(laid, at).toBeGreaterThanOrEqual(0);
        expect(laid, at).toBeLessThanOrEqual(n + 1e-9);
      }
      if (Number.isFinite(n) && n < 0) {
        losses++;
        expect(laid, at).toBeLessThanOrEqual(0);
        expect(laid, at).toBeGreaterThanOrEqual(n - 1e-9);
      }
    }
    expect(over, 'точки внутри области: запас выше вместимости').toBeGreaterThan(500);
    expect(gains, 'точки внутри области: прибавки').toBeGreaterThan(3000);
    expect(losses, 'точки внутри области: убавки').toBeGreaterThan(3000);
  });
});
