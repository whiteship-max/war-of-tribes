import { describe, it, expect } from 'bun:test';
import { LocalWorld } from '@/world/local/LocalWorld';
import { DEAL_PAYOUT } from '@/world/data/tuning';
describe('pact catch-up', () => {
  it('pays periods before until', () => {
    const T = 1_000_000_000;
    let now = T;
    const w = new LocalWorld({ seed: 7, now: () => now, storage: null }) as any;
    w.save.pacts.test = { tribute: { until: T + 5 * DEAL_PAYOUT, paidAt: T } };
    const before = JSON.stringify(w.save.effects ?? w.effects ?? []).match(/Дань от державы/g)?.length ?? 0;
    w.stepPacts(T + 10 * DEAL_PAYOUT);
    const s = JSON.stringify(w.save.effects ?? w.effects ?? w.save);
    expect((s.match(/Дань от державы/g)?.length ?? 0) - before).toBe(5);
  });
});
