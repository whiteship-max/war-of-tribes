import { readGrants, noteOf } from './netlify/lib/admin';
import { test, expect } from 'bun:test';
test('51 unseen grants all delivered', () => {
  const list = Array.from({ length: 51 }, (_, i) => ({ n: i + 1, at: 1, by: 1, stock: { wood: 10 }, troops: {} }));
  const g = readGrants({ v: 1, seq: 51, list });
  const note = noteOf(false, g, 0);
  expect(note.grants.length).toBe(51);
});
