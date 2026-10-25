// Потери похода по составу (BTL-6, docs/audit/WORKPLAN.md; архив round1/game-core/prove-8-1): бой назвал, кто пал, — списываются
// они. Прежде, если названных уже не было в войске (латников распустили, пока шёл поход), списание по составу давало ноль, и
// `applyExpedition` снимал «слабых первыми» — гибли дубинщики, которых в бою не было.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { TROOP_IDS } from '../data/troops';
import { applyExpedition, type ExpeditionOutcome } from './expedition';

const outcome = (over: Partial<ExpeditionOutcome>): ExpeditionOutcome =>
  ({ warriorsLost: 0, scoutsLost: 0, resources: {}, gold: 0, prestige: 0, morale: 0, battle: 'won', text: '', kind: 'bad', ...over }) as ExpeditionOutcome;

function clubmen(n: number) {
  const s = createInitialState(7);
  for (const id of TROOP_IDS) s.army[id] = 0;
  s.army.clubman = n;
  s.pop = Math.max(s.pop, 2 * n);
  return s;
}

describe('потери похода — по составу, который назвал бой', () => {
  it('названных в войске уже нет — других не списывают (prove-8-1)', () => {
    const s = clubmen(10);
    expect(s.army.knight, 'точка внутри области: латников нет').toBe(0);
    applyExpedition(s, outcome({ warriorsLost: 3, troopsLost: { knight: 3 } }));
    expect(s.army.clubman).toBe(10);
  });

  it('названные есть — списываются они', () => {
    const s = clubmen(10);
    s.army.knight = 4;
    applyExpedition(s, outcome({ warriorsLost: 3, troopsLost: { knight: 3 } }));
    expect(s.army.knight).toBe(1);
    expect(s.army.clubman).toBe(10);
  });

  it('старый поход без состава — слабые первыми, как прежде', () => {
    const s = clubmen(10);
    s.army.knight = 4;
    applyExpedition(s, outcome({ warriorsLost: 3 }));
    expect(s.army.clubman).toBe(7);
    expect(s.army.knight).toBe(4);
  });
});
