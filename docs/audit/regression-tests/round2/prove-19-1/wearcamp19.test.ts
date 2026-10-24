import { it, expect } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
it('sortie at the stakes costs a scout-only bot camp at least one man', () => {
  const w = new LocalWorld({ seed: 7, now: () => 1_700_000_000_000, storage: null }) as any;
  w.save.marches.push({ id: 'camp19', units: { scout: 5 }, power: 10 });
  const win = { campId: 'camp19' } as any; // bot camp (no general)
  const gone = w.wearCamp(win, 0.05, 1_700_000_000_000, 'Вылазка.');
  expect(gone).toBe(1);
  expect(w.save.marches.find((m: any) => m.id === 'camp19').units).toEqual({ scout: 4 });
});
