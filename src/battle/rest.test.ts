// Мораль между боями в ядре (docs/battle_eu4.md, 14.30–14.31; EU4): сторона может выйти в бой не в полной морали —
// дралась недавно. Ядро про источник не знает, как про `resolve`: ему дают долю полной морали (`ArmySetup.rest`), оно
// множит на неё стартовую мораль строя и резерва и отдаёт, с какой долей уцелевшие выходят из боя (`SideResult.rest`).
import { describe, expect, it } from 'vitest';
import {
  FRONT_WIDTH,
  describeEvent,
  deploySetup,
  simulateBattle,
  startMorale,
  stackOf,
  summarize,
  type ArmySetup,
  type BattleInput,
  type BattleResult,
  type Stack,
} from '@/battle';

const W = FRONT_WIDTH;

/** Бой двух развёрнутых по правилу армий; доля морали — нападающему, если дана. */
const fight = (a: Partial<Stack>, d: Partial<Stack>, seed: number, rest?: { attacker?: number; defender?: number }): BattleResult => {
  const input: BattleInput = {
    seed,
    attacker: { ...deploySetup(stackOf(a)), ...(rest?.attacker !== undefined ? { rest: rest.attacker } : {}) },
    defender: { ...deploySetup(stackOf(d)), ...(rest?.defender !== undefined ? { rest: rest.defender } : {}) },
  };
  return simulateBattle(input);
};

/** Составы, на которых бой идёт по-разному: пешие, с луками, с конницей, шире трёх W — с резервом. */
const PAIRS: [Partial<Stack>, Partial<Stack>][] = [
  [{ infantry: 200, archer: 80 }, { spear: 150, infantry: 100 }],
  [{ spear: 120, cavalry: 60, archer: 60 }, { infantry: 260 }],
  [{ infantry: 5 * W, archer: W }, { infantry: 4 * W, spear: W }],
  [{ heavy: 40, infantry: 150 }, { spear: 200, archer: 60 }],
  // Большая армия бьёт меньшую, и её резерв встаёт в строй и доживает до конца боя — на нём видно, с какой моралью он встал.
  [{ infantry: 5 * W }, { infantry: 2 * W }],
];

describe('мораль между боями: ядро', () => {
  it('без поля и с полной долей — один и тот же бой байт в байт, без события усталости', () => {
    for (const [a, d] of PAIRS) {
      for (const seed of [1, 2, 3]) {
        const plain = fight(a, d, seed);
        const full = fight(a, d, seed, { attacker: 1, defender: 1 });
        expect(JSON.stringify(full), 'полная доля — тот же бой').toBe(JSON.stringify(plain));
        expect(plain.log.some((e) => e.id === 'weary'), 'свежих не называют уставшими').toBe(false);
      }
    }
  });

  it('доля множит стартовую мораль ровно во столько раз', () => {
    const setup: ArmySetup = { ...deploySetup(stackOf({ infantry: 100, spear: 60, archer: 40 })), resolve: 4 };
    const stack = stackOf({ infantry: 30, spear: 20, archer: 10 });
    const full = startMorale(setup, stack);
    expect(full, 'граница области: свежая мораль не ноль').toBeGreaterThan(0);
    for (const r of [0, 0.25, 0.5, 0.9]) expect(startMorale({ ...setup, rest: r }, stack)).toBeCloseTo(full * r, 9);
    expect(startMorale({ ...setup, rest: 1.7 }, stack), 'выше полной не бывает').toBeCloseTo(full, 9);
  });

  it('уцелевшие выходят не бодрее, чем вошли: доля на выходе не выше доли на входе — и у вошедшего резерва', () => {
    // Мораль в бою только убывает; вошедший из резерва встаёт с той же долей, что и строй (`refill` → `startMorale`).
    let withReserve = 0;
    for (const [a, d] of PAIRS) {
      for (const r of [0.2, 0.5, 0.8]) {
        for (const seed of [1, 2, 3, 4]) {
          const res = fight(a, d, seed, { attacker: r });
          if (res.log.some((e) => e.id === 'reserve-committed' && e.side === 'attacker')) withReserve++;
          const out = res.sides.attacker.rest;
          expect(out, 'доля на выходе есть').toBeDefined();
          if (res.sides.attacker.total.final > 0) expect(out!, `вход ${r}, сид ${seed}`).toBeLessThanOrEqual(r + 0.005);
        }
      }
    }
    // Граница области: в выборке есть бои, где резерв уставшей стороны вошёл в строй.
    expect(withReserve, 'резерв уставшей стороны входил в бой').toBeGreaterThan(0);
  });

  it('свежая сторона выходит с долей до единицы, и тот, кто бежал, уносит меньше победителя', () => {
    let seen = 0;
    for (const [a, d] of PAIRS) {
      for (const seed of [1, 2, 3, 4]) {
        const res = fight(a, d, seed);
        for (const side of ['attacker', 'defender'] as const) {
          const out = res.sides[side].rest!;
          expect(out).toBeGreaterThanOrEqual(0);
          expect(out).toBeLessThanOrEqual(1);
        }
        if (res.winner === 'draw') continue;
        const loser = res.winner === 'attacker' ? 'defender' : 'attacker';
        if (res.sides[loser].total.final <= 0) continue;
        seen++;
        expect(res.sides[loser].rest!, `сид ${seed}: проигравший уставшее победителя`).toBeLessThan(res.sides[res.winner].rest!);
      }
    }
    expect(seen, 'граница области: есть бои с уцелевшими у проигравшего').toBeGreaterThan(0);
  });

  it('событие усталости — в начале боя, с долей на входе, и отчёт называет его словами', () => {
    const res = fight(PAIRS[0][0], PAIRS[0][1], 5, { attacker: 0.437 });
    const weary = res.log.filter((e) => e.id === 'weary');
    expect(weary).toHaveLength(1);
    expect(weary[0]).toEqual(expect.objectContaining({ side: 'attacker', rest: 0.44, tick: 1 }));
    expect(describeEvent(weary[0], 'attacker')).toBe('наши: вышли в бой уставшими — мораль 44% от полной');
    const line = summarize(res, 'defender').keys.find((k) => k.text.includes('уставшими'));
    expect(line?.text).toBe('Чужие вышли в бой уставшими: мораль 44 % от полной — дрались недавно.');
    expect(line?.good, 'усталость противника — к добру для нас').toBe(true);
  });
});
