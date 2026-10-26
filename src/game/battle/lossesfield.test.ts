// Тест-свойство этапа 8 аудита: потери боя согласованы с весами войск — сквозь настоящий бой. Решётка `losses.test.ts` держит
// раскладку рода на виды (`spreadLosses`) на любых числах; здесь те же утверждения на числах, которые даёт ядро боя
// (`world/battle.resolveField` — одна дверь мира и сервера войны), через `troopLosses`, которым мир и сервер списывают бойцов.
// Область: двести боёв по сеянной кости, составы из всех видов племени, у обеих сторон есть потери (точки внутри — проверено).
import { describe, expect, it } from 'vitest';
import { UNIT_KINDS } from '@/battle';
import { resolveField } from '@/world/battle';
import { TROOP_IDS } from '../data/troops';
import { KIND_OF, TROOPS_OF_KIND, type TroopStack } from './kinds';
import { battleWeight, kindsOf, troopLosses } from './price';

function dice(seed: number): (n: number) => number {
  let x = seed >>> 0 || 1;
  return (n) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % n;
  };
}

function army(roll: (n: number) => number): TroopStack {
  const t: TroopStack = {};
  const kinds = 1 + roll(4);
  for (let i = 0; i < kinds; i++) {
    const id = TROOP_IDS[roll(TROOP_IDS.length)];
    t[id] = (t[id] ?? 0) + 1 + roll(60);
  }
  return t;
}

describe('свойство: потери настоящего боя ложатся на бойцов по весам', () => {
  it('двести боёв: по каждому роду снят вес не меньше потерь и больше их меньше чем на вес одного бойца; весь род — все', () => {
    const bad: string[] = [];
    let lossy = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const roll = dice(seed * 104729);
      const atk = army(roll);
      const def = army(roll);
      const field = resolveField({ seed, attacker: { kinds: kindsOf(atk) }, defender: { kinds: kindsOf(def) } });
      if (!field.result) continue;
      for (const [side, t] of [['attacker', atk], ['defender', def]] as const) {
        const lost = field.result.sides[side].losses;
        const out = troopLosses(t, lost);
        const kinds = kindsOf(t);
        for (const id of TROOP_IDS) if ((out[id] ?? 0) > (t[id] ?? 0)) bad.push(`бой ${seed}, ${side}: ${id} снято больше, чем было`);
        for (const k of UNIT_KINDS) {
          const l = lost[k] ?? 0;
          if (l <= 0) continue;
          lossy++;
          const ids = TROOPS_OF_KIND[k];
          const took = ids.reduce((n, id) => n + (out[id] ?? 0) * battleWeight(id), 0);
          const all = ids.reduce((n, id) => n + (t[id] ?? 0) * battleWeight(id), 0);
          const heaviest = Math.max(...ids.filter((id) => (t[id] ?? 0) > 0).map(battleWeight));
          const why = `бой ${seed}, ${side}, ${k}: пало ${l} из ${kinds[k]}, снят вес ${took.toFixed(2)} из ${all.toFixed(2)}`;
          if (l > kinds[k]) bad.push(`${why} — потерь больше людей строя`);
          if (took < Math.min(l, all) - 1e-9) bad.push(`${why} — меньше потерь`);
          if (took - l >= heaviest) bad.push(`${why} — сверх потерь на вес бойца`);
          if (l >= kinds[k] && ids.some((id) => (out[id] ?? 0) !== (t[id] ?? 0))) bad.push(`${why} — весь род, а снят не весь`);
          if (ids.some((id) => KIND_OF[id] !== k)) bad.push(`${why} — вид не того рода`);
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(lossy, 'точки внутри области: роды с потерями').toBeGreaterThan(300);
  });
});
