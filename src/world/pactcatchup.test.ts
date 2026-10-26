// Выплаты договора за отлучку (MAP-1, docs/audit/WORKPLAN.md; архив round2/prove-20-1). Договор, истёкший, пока игрока не
// было, прежде удалялся раньше догона: сроки дани до его конца пропадали. Теперь сперва выплачиваются сроки до
// `min(now, until)`, и только потом договор снимается.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { DEAL_PAYOUT } from './data/tuning';

const T = 1_700_000_000_000;

interface Inner {
  save: { pacts: Record<string, Record<string, { until: number; paidAt: number }>>; effects: Array<{ id: string; text: string }> };
  stepPacts(now: number): void;
}

function world(deal: 'tribute' | 'trade') {
  const w = new LocalWorld({ seed: 7, now: () => T, storage: null }) as unknown as Inner;
  w.save.pacts.test = { [deal]: { until: T + 5 * DEAL_PAYOUT, paidAt: T } };
  return w;
}

const paid = (w: Inner, deal: string): number => w.save.effects.filter((e) => e.id.startsWith(`pact-test-${deal}-`) && !e.id.endsWith('-end')).length;

describe('договор: догон выплат до конца срока (MAP-1)', () => {
  for (const deal of ['tribute', 'trade'] as const) {
    it(`${deal}: истёк за отлучку — выплачены все пять сроков до конца, затем снят`, () => {
      const w = world(deal);
      const now = T + 10 * DEAL_PAYOUT;
      expect(now, 'точка внутри области: отлучка дольше договора').toBeGreaterThan(w.save.pacts.test[deal].until);
      w.stepPacts(now);
      expect(paid(w, deal)).toBe(5);
      expect(w.save.pacts.test[deal]).toBeUndefined();
      expect(w.save.effects.some((e) => e.id === `pact-test-${deal}-end`)).toBe(true);
    });
  }

  it('договор ещё идёт — платятся только прошедшие сроки', () => {
    const w = world('tribute');
    w.stepPacts(T + 3 * DEAL_PAYOUT + 1);
    expect(paid(w, 'tribute')).toBe(3);
    expect(w.save.pacts.test.tribute).toBeDefined();
  });

  it('ровно в минуту конца — последний срок выплачен один раз', () => {
    const w = world('tribute');
    w.stepPacts(T + 5 * DEAL_PAYOUT);
    w.stepPacts(T + 6 * DEAL_PAYOUT);
    expect(paid(w, 'tribute')).toBe(5);
  });
});
