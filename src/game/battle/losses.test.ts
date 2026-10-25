// Мост людей строя и бойцов племени (BTL-1, docs/audit/WORKPLAN.md): потери рода снимают бойцов целиком — сначала вниз по
// каждому виду, слабые первыми, потом остаток одним бойцом первому виду, у которого остались люди; род выходит в бой одним
// округлением суммы весов. Прежде остаток округлялся по каждому виду, и латник, латный всадник или щитоносец, потерявший
// меньше половины своего веса, не погибал никогда (архив round1/game-core/prove-2-1).
import { describe, expect, it } from 'vitest';
import { UNIT_KINDS, type UnitKind } from '@/battle';
import { TROOP_IDS } from '../data/troops';
import { KIND_OF, TROOPS_OF_KIND, type TroopStack } from './kinds';
import { battleWeight, kindsOf, menOf, shareLosses, shareOfKinds, spreadLosses } from './price';

/** Решётка составов рода: по каждому виду 0, 1, 2 или 5 бойцов (у рода в один вид — 1…40). */
function lattice(kind: UnitKind): TroopStack[] {
  const ids = TROOPS_OF_KIND[kind];
  if (ids.length === 1) return Array.from({ length: 40 }, (_, i) => ({ [ids[0]]: i + 1 }));
  const counts = [0, 1, 2, 5];
  let out: TroopStack[] = [{}];
  for (const id of ids) out = out.flatMap((t) => counts.map((n) => (n > 0 ? { ...t, [id]: n } : t)));
  return out.filter((t) => Object.keys(t).length > 0);
}

const weightOf = (t: TroopStack): number => TROOP_IDS.reduce((n, id) => n + (t[id] ?? 0) * battleWeight(id), 0);

describe('потери рода — бойцами племени', () => {
  it('один боец любого вида, потерявший хоть одного из своих людей строя, погибает (архив prove-2-1)', () => {
    for (const id of TROOP_IDS) {
      const k = KIND_OF[id];
      const men = kindsOf({ [id]: 1 })[k];
      expect(men, `${id}: граница области — у одного бойца больше одного человека строя или ровно один`).toBeGreaterThanOrEqual(1);
      for (let l = 1; l <= men; l += 1) expect(spreadLosses({ [id]: 1 }, k, l)[id] ?? 0, `${id}: пало ${l} из ${men}`).toBe(1);
    }
  });

  it('снятый вес не меньше потерь и больше их меньше чем на вес одного бойца рода; весь род — все бойцы', () => {
    let points = 0;
    const bad: string[] = [];
    for (const kind of UNIT_KINDS) {
      const heaviest = Math.max(...TROOPS_OF_KIND[kind].map(battleWeight));
      for (const t of lattice(kind)) {
        const men = kindsOf(t)[kind];
        const all = weightOf(t);
        for (let lost = 1; lost <= men; lost += 1) {
          // Граница области: род в бою есть, и потеряно не больше, чем его людей строя.
          if (!(lost >= 1 && lost <= men)) bad.push(`вне области: ${lost} из ${men}`);
          const out = spreadLosses(t, kind, lost);
          const took = weightOf(out);
          const why = `${JSON.stringify(t)} пало ${lost} из ${men}: снято ${JSON.stringify(out)} весом ${took.toFixed(2)}`;
          if (TROOP_IDS.some((id) => (out[id] ?? 0) > (t[id] ?? 0))) bad.push(`${why} — больше, чем было`);
          if (took < Math.min(lost, all) - 1e-9) bad.push(`${why} — меньше потерь`);
          if (took - lost >= heaviest) bad.push(`${why} — сверх потерь на вес бойца`);
          if (lost === men && Math.abs(took - all) > 1e-9) bad.push(`${why} — весь род, а снят не весь`);
          points += 1;
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(points).toBeGreaterThan(5000);
  });

  it('род выходит в бой одним округлением суммы весов: не дальше полчеловека от неё', () => {
    for (const kind of UNIT_KINDS) {
      for (const t of lattice(kind)) {
        const w = weightOf(t);
        expect(w, 'граница области: в роде кто-то есть').toBeGreaterThan(0);
        const men = kindsOf(t)[kind];
        expect(Math.abs(men - w), `${kind} ${JSON.stringify(t)}: ${men} при весе ${w.toFixed(3)}`).toBeLessThanOrEqual(0.5);
      }
    }
    // Один вид — то же правило: `menOf` и есть сумма рода в один вид.
    for (const id of TROOP_IDS) for (const n of [1, 2, 5, 13]) expect(kindsOf({ [id]: n })[KIND_OF[id]]).toBe(menOf(id, n));
  });

  it('доля войска — к ближнему: истощение фазы не тает лагерь быстрее своей доли', () => {
    // Доля фазы — от 1 % до 30 %; граница области — у каждого рода снимается меньше его людей строя.
    const bad: string[] = [];
    for (const kind of UNIT_KINDS) {
      const heaviest = Math.max(...TROOPS_OF_KIND[kind].map(battleWeight));
      for (const t of lattice(kind)) {
        for (const share of [0.01, 0.021, 0.05, 0.1, 0.3]) {
          const hit = shareOfKinds(t, share)[kind];
          if (hit > kindsOf(t)[kind]) bad.push(`вне области: ${hit}`);
          const took = weightOf(shareLosses(t, share));
          if (Math.abs(took - hit) > heaviest / 2 + 1e-9) bad.push(`${kind} ${JSON.stringify(t)} доля ${share}: снято весом ${took.toFixed(2)} при ${hit}`);
        }
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    // Лагерь из 96 бойцов (тест ОС-1б, campmelt.test.ts) при доле фазы 2,1 % теряет двоих, а не четверых.
    const camp = { spearman: 48, archer: 24, swordsman: 24 };
    expect(Object.values(shareLosses(camp, 0.021)).reduce((n, v) => n + (v ?? 0), 0)).toBe(2);
  });
});
