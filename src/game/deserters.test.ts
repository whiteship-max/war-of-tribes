// Тревога о дезертирах (BTL-8, п. 3; архив round1/game-core/prove-11-1): уходят головы, а не рты. Раненые и новобранцы уходят
// голодом поголовно (`sim/upkeep`), а прогноз считал их долю ртами — `mouthCount − armySize`, — и конь всадника в строю шёл
// туда лишним «новобранцем»: при пяти тысячах всадников тревога обещала уход вдвое больше настоящего.
import { describe, expect, it } from 'vitest';
import { createInitialState } from './state';
import { armySize, mastersCount, troopsEat, upkeepInfo } from './derived';
import { DESERT_SHARE } from './data/upkeep';
import { TROOP_IDS } from './data/troops';

function starving(riders: number, recruits = 0) {
  const s = createInitialState(1);
  for (const id of TROOP_IDS) s.army[id] = 0;
  s.army.rider = riders;
  s.recruits = recruits > 0 ? [{ id: 1, troop: 'rider', count: recruits, done: 0, work: 0 } as (typeof s.recruits)[number]] : [];
  s.resources.food = 0;
  s.pay = { ...s.pay, late: 1e9, debt: s.pay?.debt ?? 0, from: 0 };
  return s;
}

describe('тревога о дезертирах — головами', () => {
  it('строй из всадников: уходит доля голов строя, конь не новобранец (prove-11-1)', () => {
    const s = starving(5000);
    expect(troopsEat(s), 'граница области: бойцы едят').toBe(true);
    const u = upkeepInfo(s);
    expect(u.unfed, 'точка внутри области: голод есть').toBeGreaterThan(0);
    expect(u.leavingPerDay).toBeCloseTo(DESERT_SHARE * Math.max(u.unpaid, u.unfed) * (armySize(s) + mastersCount(s)), 9);
  });

  it('новобранцы на учениях уходят голодом поголовно — их головы, а не рты с конями', () => {
    const s = starving(100, 40);
    const u = upkeepInfo(s);
    const share = Math.max(u.unpaid, u.unfed);
    expect(u.leavingPerDay).toBeCloseTo(DESERT_SHARE * (share * (armySize(s) + mastersCount(s)) + u.unfed * 40), 9);
  });
});
