// Ополчение при вере (BTL-3, docs/audit/WORKPLAN.md): ополчение — оборона без войска, а стойкость веры поднимает и войско дома
// (`defenseOf`: всё под `1 + steadfast`). Прежде из обороны вычиталось войско без стойкости, и его прибавка от веры
// становилась ополчением: чем больше войска дома, тем больше «жителей с дубинами» (архив round1/game-core/prove-12-1).
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { faithTilt, homeArmyPower } from '@/game/derived';
import { defenseOf, militiaOf, STEADFAST_MAX } from '@/game/build';
import { militiaArchers, militiaMen } from './bridge';
import { seedTown, townSheet } from '../../netlify/lib/town';
import type { WarSheet } from '../../netlify/lib/contract';

describe('ополчение не растёт от войска под стойкостью веры', () => {
  it('формула: то же ополчение при любом войске дома (prove-12-1)', () => {
    for (const steadfast of [0, 0.1, 0.2, STEADFAST_MAX]) {
      const levels = { palisade: 3, tower: 2 };
      const bare = militiaOf(defenseOf(levels, 200, 0, steadfast), 0, steadfast);
      expect(bare, 'точка внутри области: ополчение есть').toBeGreaterThan(0);
      for (const army of [10, 1000, 25_000]) expect(militiaOf(defenseOf(levels, 200, army, steadfast), army, steadfast), `стойкость ${steadfast}, войско ${army}`).toBe(bare);
    }
  });

  it('мост: войско дома не превращается в ополчение и в лучников башни', () => {
    const s = createInitialState(7);
    s.faith.id = 'orthodox';
    expect(faithTilt(s).steadfast, 'точка внутри области: вера даёт стойкость').toBeGreaterThan(0);
    const men = militiaMen(s);
    const bows = militiaArchers(s);
    const power = homeArmyPower(s);
    s.army.spearman = (s.army.spearman ?? 0) + 300;
    expect(homeArmyPower(s), 'точка внутри области: войска дома стало больше').toBeGreaterThan(power);
    expect(militiaMen(s)).toBe(men);
    expect(militiaArchers(s)).toBe(bows);
  });

  it('сервер: потолок ополчения книги стройки не растёт с войском дома', () => {
    const book = seedTown(1_900_000_000_000);
    const sheet = { army: {}, home: {}, militia: 5000, archers: 0, resolve: 0, pips: {}, rest: 1, food: 0, townPerHour: 0, perManPerHour: 0, stock: {}, stash: 0, gold: 0, pop: 9000, bonded: 0, levels: {}, power: 0, locks: {}, seen: [] } as WarSheet;
    const bare = townSheet(sheet, book, 0).militia;
    expect(bare, 'точка внутри области: потолок ниже названного описью').toBeLessThan(5000);
    expect(townSheet(sheet, book, 20_000).militia).toBe(bare);
  });
});
