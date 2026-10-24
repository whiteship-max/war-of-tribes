import { expect, it } from 'vitest';
import { createInitialState } from '../state';
import { buildingOfType, storageCap } from '../derived';
import { RESOURCE_IDS } from '../constants';
import { BUILDING_BY_ID } from '../data/buildings';
import { cancelRefund } from '../labour';
import { cancelUpgrade } from './actions';
it('started cancel refund of two-part yard equals server cancelRefund', () => {
  const s = createInitialState();
  for (const r of RESOURCE_IDS) s.resources[r] = 0;
  const b = buildingOfType(s, 'hunter_hut')!;
  b.level = 1; b.work = 5; b.workRequired = 100;
  cancelUpgrade(s, b.id);
  const exp = cancelRefund(BUILDING_BY_ID.hunter_hut, 2, true);
  for (const r of RESOURCE_IDS) expect(s.resources[r], r).toBe(exp[r] ?? 0);
});
