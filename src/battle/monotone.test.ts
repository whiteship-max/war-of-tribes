// Монотонность в несимметричном бою (слово владельца по П0 пересмотра баланса, docs/battle_eu4.md, 14.35): тест
// «больше того же — не хуже» (`battle.test.ts`) сравнивает состав с самим собой — большой против малого — и не видит
// «больше того же против того же противника». Этот тест — тот же вопрос для каждой пары решётки: X больше на 10 % против
// того же Y без кости держит поле не реже, чем X в своём размере. Файл свой: пар 70 × 70, и бои идут в своём работнике.
import { describe, expect, it } from 'vitest';
import { simulateBattle } from './sim';
import { armyTotal, deploySetup, stackTotal } from './setup';
import { compositionLattice, compositionName, holdSize, scaleArmy, withDiceStep } from './bench';
import type { ArmySetup, Side } from './types';

describe('монотонность против того же противника: больше того же — не реже', () => {
  it('X на 10 % больше против того же Y без кости держит поле не реже X — все пары решётки, обе стороны поля, ½W и W', () => {
    withDiceStep(0, () => {
      const lattice = compositionLattice();
      const lost: string[] = [];
      let held = 0;
      let bigger = 0;
      const fight = (x: ArmySetup, y: ArmySetup, side: Side) =>
        simulateBattle({ seed: 1, attacker: side === 'attacker' ? x : y, defender: side === 'attacker' ? y : x });
      for (const total of [Math.round(holdSize() / 2), holdSize()]) {
        const small = lattice.map((a) => deploySetup(scaleArmy(a, total)));
        const big = lattice.map((a) => deploySetup(scaleArmy(a, Math.round(total * 1.1))));
        // Граница области: большая правда больше — иначе «не реже» было бы даром.
        big.forEach((b, i) => (stackTotal(armyTotal(b)) > stackTotal(armyTotal(small[i])) ? (bigger += 1) : 0));
        for (let i = 0; i < lattice.length; i += 1) {
          for (let j = 0; j < lattice.length; j += 1) {
            for (const side of ['attacker', 'defender'] as const) {
              // Граница области: утверждение спрашивается только там, где меньшая держит поле, — иначе «не реже» даром.
              if (fight(small[i], small[j], side).winner !== side) continue;
              held += 1;
              const r = fight(big[i], small[j], side);
              if (r.winner !== side) {
                lost.push(`${total}: ${compositionName(lattice[i])} против ${compositionName(lattice[j])} (${side === 'attacker' ? 'нападает' : 'обороняется'})`);
              }
            }
          }
        }
      }
      expect(bigger, 'составов, где большая правда больше').toBe(2 * compositionLattice().length);
      // Ничьих без кости на решётке нет (стояния нет — `battle.test.ts`), и из пары боёв i–j и j–i поле держит один:
      // меньшая держит поле ровно в половине боёв.
      expect(held, 'боёв, где меньшая держит поле').toBe(compositionLattice().length ** 2 * 2);
      expect(lost, 'больший X держит поле реже меньшего против того же Y').toEqual([]);
    });
  }, 600_000);
});
