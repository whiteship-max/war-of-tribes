import { expect, it } from 'vitest';
const shelf = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (k: string) => shelf.get(k) ?? null, setItem: (k: string, v: string) => void shelf.set(k, v), removeItem: (k: string) => void shelf.delete(k) } });
it('a lease beaten just now by another (unsynced) tab is not stale after this tab syncs its clock', async () => {
  const s = await import('./session'); const c = await import('./clock');
  // other tab, offset 0, beat right now (same shape claimLease writes)
  shelf.set('tribe.tab.v1', JSON.stringify({ tab: 't-other', at: Date.now() }));
  c.setServerTime(Date.now() + 20000); // this tab: device clock 20 s slow vs server
  expect(s.leaseHolder()).toBe('other');
  expect(s.beatLease()).toBe(false); // must not steal the live tab's lease
});
