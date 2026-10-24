import { describe, expect, it, beforeAll } from 'bun:test';
import { createInitialState } from '../state';
import { buildingOfType } from '../derived';
import { startUpgrade } from './actions';
import { GEM_REF_RATE, applyGemDeeds, rushPrice } from './gems';
import { gameSeconds } from '../pace';
import { loadFold } from '../save';
beforeAll(() => loadFold());
describe('cand28', () => {
  it('paid rush whose site finished on its own while in flight delivers nothing', () => {
    const s = createInitialState();
    const hut = buildingOfType(s, 'houses')!;
    expect(startUpgrade(s, hut.id)).toBeNull();
    const left = 8 * 60;
    hut.workRequired = Math.max(hut.workRequired, gameSeconds(left) * GEM_REF_RATE + 1);
    hut.work = hut.workRequired - gameSeconds(left) * GEM_REF_RATE;
    const price = rushPrice(hut);
    expect(price).toBeGreaterThan(0);
    const level = hut.level;
    hut.level += 1; hut.work = 0; hut.workRequired = 0; // build ended locally while order in flight
    const before = JSON.stringify({ b: s.buildings, r: s.resources });
    applyGemDeeds(s, [{ n: 1, at: Date.now(), kind: 'rush', delta: -price, building: 'houses', level: level + 1 } as any]);
    const after = JSON.stringify({ b: s.buildings, r: s.resources });
    console.log('price paid', price, 'state changed?', before !== after);
    expect(after).not.toBe(before);
  });
});
