// Дань и выкуп не больше доли склада (MAP-5, docs/audit/WORKPLAN.md; архив round1/world/prove-1-1). `spread` давал каждому
// виду не меньше единицы и округлял долю вверх: при пустом складе (потолок 1) двор с тремя видами просил три, а при
// потолке 10 и трёх видах — двенадцать. Теперь раздача — `splitLoot` (виды складываются ровно в итог), потолок может быть
// нулём, и тогда письма с данью или выкупом нет вовсе.
import { describe, expect, it } from 'vitest';
import { letterCost, lootTotal, pickLetter, type LetterCandidate } from './letters';
import { TRIBUTE_MAX_SHARE } from './data/tuning';

const cand = (o: Partial<LetterCandidate> = {}): LetterCandidate => ({
  id: 'x',
  name: 'Двор',
  pop: 1000,
  lootMix: ['food', 'wood', 'stone'],
  standing: 'neutral',
  attitude: 0,
  captives: 0,
  ...o,
});

describe('дань и выкуп не больше доли склада (MAP-5)', () => {
  it('на решётке складов просьба не выше потолка и складывается ровно в него', () => {
    for (const kind of ['tribute', 'ransom'] as const) {
      for (const total of [0, 1, 6, 7, 20, 67, 100, 1000]) {
        for (const mix of [['food'], ['food', 'wood'], ['food', 'wood', 'stone'], ['food', 'wood', 'stone', 'iron']] as const) {
          const c = cand({ lootMix: [...mix], captives: 5 });
          const cap = Math.floor(total * TRIBUTE_MAX_SHARE);
          const cost = letterCost(kind, c, { food: total });
          expect(lootTotal(cost), `${kind}: склад ${total}, ${mix.length} видов`).toBeLessThanOrEqual(cap);
          for (const v of Object.values(cost)) expect(v).toBeGreaterThan(0);
        }
      }
    }
  });

  it('потолок выше просьбы — просят ровно своё', () => {
    const cost = letterCost('tribute', cand({ pop: 10 }), { food: 100_000 });
    expect(lootTotal(cost)).toBe(16);
  });

  it('пустой склад — ни дани, ни выкупа не просят', () => {
    const cands = [cand({ captives: 3 })];
    for (let n = 0; n < 40; n++) {
      const d = pickLetter(5, n, cands, {});
      expect(d === null || (d.kind !== 'tribute' && d.kind !== 'ransom'), `письмо ${n}: ${d?.kind}`).toBe(true);
    }
  });
});
