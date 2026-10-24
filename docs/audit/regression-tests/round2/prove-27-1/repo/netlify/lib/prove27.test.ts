import { describe, it, expect } from 'bun:test';
import { applyGemOrder, gemNoteOf, openLedger, type GemLedger } from './gems';
import { applyGemDeeds, gemSeen } from '@/game/sim/gems';
import { createInitialState } from '@/game/state';
const DAY = 86_400_000;
describe('c27', () => {
  it('device 51+ deeds behind receives every unseen buy', () => {
    const t0 = Date.UTC(2026, 9, 10, 12);
    let l: GemLedger = { ...openLedger(t0), balance: 1e7 };
    let buys = 0;
    for (let d = 0; d < 6; d++) for (let i = 0; i < 10; i++) {
      const r = applyGemOrder(l, { op: 'buy', key: `k${d}-${i}`, res: 'wood' }, t0 + d * DAY + i);
      if (r.ledger) { l = r.ledger; buys++; }
    }
    expect(buys).toBe(60);
    const s = createInitialState(1);
    let applied = 0;
    for (let k = 0; k < 3; k++) applied += applyGemDeeds(s, gemNoteOf(l, gemSeen(s), t0 + 6 * DAY).deeds);
    console.log('applied', applied, 'gemSeen', gemSeen(s));
    expect(applied).toBe(60);
  });
});
