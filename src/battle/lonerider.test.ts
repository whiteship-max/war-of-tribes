// Одинокий всадник (BTL-5, docs/audit/WORKPLAN.md; архив round1/server-battle-net/prove-6-1): конница встаёт с краёв поровну, и
// нечётный остаток ждёт в резерве (слово владельца, docs/battle_eu4.md, 14.33). У стороны, где весь строй — один всадник (или
// всадник и лучники), края не берут никого, резерв встаёт только туда, где сторона стояла, — и такая сторона проигрывала, не
// войдя в бой. С версии правил 2 всадник, которому некуда встать, кроме резерва, при пустой первой линии встаёт в центр;
// нечётный остаток при стоящей линии ждёт в резерве, как прежде.
import { describe, expect, it } from 'vitest';
import { BATTLE_RULES, FIRST_RULES, LONE_RIDER_RULES } from './config';
import { deploy } from './setup';
import { FRONT } from './types';

const inFront = (s: ReturnType<typeof deploy>, k: 'cavalry' | 'heavy'): number => FRONT.reduce((n, id) => n + s[id][k], 0);

describe('одинокий всадник не уходит в резерв', () => {
  it('весь строй — один всадник: он в первой линии, резерв пуст (prove-6-1)', () => {
    expect(BATTLE_RULES, 'граница области: нынешняя версия знает правило').toBeGreaterThanOrEqual(LONE_RIDER_RULES);
    for (const k of ['cavalry', 'heavy'] as const) {
      for (const army of [{ [k]: 1 }, { [k]: 1, archer: 3 }]) {
        const s = deploy(army, 20);
        expect(s.R[k], JSON.stringify(army)).toBe(0);
        expect(inFront(s, k), JSON.stringify(army)).toBe(1);
      }
    }
  });

  it('нечётный остаток при стоящей линии ждёт в резерве, как прежде (14.33)', () => {
    expect(deploy({ cavalry: 3 }, 20).R.cavalry).toBe(1);
    expect(deploy({ cavalry: 1, spear: 10 }, 20).R.cavalry).toBe(1);
    expect(deploy({ heavy: 5, infantry: 4 }, 20).R.heavy).toBe(1);
  });

  it('запись боя старше правила раскладывается по своим', () => {
    expect(FIRST_RULES, 'граница области: первая версия правила не знает').toBeLessThan(LONE_RIDER_RULES);
    expect(deploy({ cavalry: 1 }, 20, FIRST_RULES).R.cavalry).toBe(1);
    expect(deploy({ cavalry: 1 }, 20, BATTLE_RULES).R.cavalry).toBe(0);
  });
});
