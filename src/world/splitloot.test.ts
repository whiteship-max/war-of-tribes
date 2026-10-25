// ECO-7: итог, разложенный по видам добра, складывается ровно в итог — дань пакта и цена дара и мира (`splitLoot`, правило
// MAP-5: floor и остаток по единице первым видам, нули пропускаются). Прежде цена дара округляла каждый вид отдельно — сумма
// видов расходилась с итогом в обе стороны. Дань пакта резала остаток (floor), но на мирах генератора у держав по два вида и
// итог чётный — остатка не бывает, и тест на ней упасть не мог бы (правило 11): она переведена на ту же раздачу ради одного
// правила, её держит свойство `splitLoot`.
import { describe, expect, it } from 'vitest';
import { splitLoot, lootTotal } from './letters';
import { LocalWorld } from './local/LocalWorld';
import type { Loot } from './types';
import type { GenSettlement } from './gen';
import type { ResourceId } from '@/game/types';
import { GIFT_PER_POP } from './data/tuning';

const MIXES: ResourceId[][] = [['food'], ['food', 'wood'], ['food', 'wood', 'stone'], ['wood', 'stone', 'iron', 'hides']];

describe('ECO-7: итог по видам — ровно итог', () => {
  it('splitLoot: сумма видов равна итогу, виды отличаются не больше чем на единицу, нулей нет', () => {
    for (const mix of MIXES) {
      for (let total = 0; total <= 40; total++) {
        const out = splitLoot(total, mix);
        expect(lootTotal(out), `${total} на ${mix.join(',')}`).toBe(total);
        const vals = Object.values(out) as number[];
        expect(vals.every((v) => v >= 1)).toBe(true);
        if (vals.length > 1) expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1);
        expect(vals.length).toBe(Math.min(total, mix.length));
      }
    }
  });

  it('цена дара и мира — сумма видов равна итогу, посчитанному от двора', () => {
    const now = 1_900_000_000_000;
    const w = new LocalWorld({ seed: 5, now: () => now, storage: null });
    const priv = w as unknown as {
      gen: { settlements: GenSettlement[] };
      orderCost: (a: string, s: GenSettlement, now: number) => Loot;
      popNow: (s: GenSettlement, now: number) => number;
    };
    let checked = 0;
    for (const s of priv.gen.settlements) {
      for (const [action, per] of [
        ['gift', GIFT_PER_POP],
        ['peace', null],
      ] as const) {
        const cost = priv.orderCost(action, s, now);
        const total = lootTotal(cost);
        if (per !== null) expect(total, `${action} ${s.id}`).toBe(Math.max(1, Math.round(priv.popNow(s, now) * per)));
        const vals = Object.values(cost) as number[];
        expect(Math.max(...vals) - Math.min(...vals)).toBeLessThanOrEqual(1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(12);
  });
});
