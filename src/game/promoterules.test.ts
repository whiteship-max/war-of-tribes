// Повышение за золото (ПН-6, ГДД 3.4.2): дерево из снаряжения, цена — разность полных цен по основе рынка, путь не важен.
import { describe, expect, it } from 'vitest';
import type { TroopId } from './types';
import { TROOP_IDS } from './data/troops';
import { canPromote, demoteKit, demoteTargets, promoteBill, promoteTargets, promoteUnit, promoteWorth } from './promoterules';

/** Все цепочки повышения от `from` до `to` по дереву: каждый шаг — `canPromote`. */
function chains(from: TroopId, to: TroopId): TroopId[][] {
  if (from === to) return [[from]];
  const out: TroopId[][] = [];
  for (const mid of promoteTargets(from)) {
    if (mid !== to && !canPromote(mid, to)) continue;
    for (const rest of chains(mid, to)) out.push([from, ...rest]);
  }
  return out;
}

const stepsCost = (path: TroopId[]): number => path.slice(1).reduce((t, id, i) => t + promoteUnit(path[i], id), 0);

describe('повышение за золото (ГДД 3.4.2)', () => {
  it('таблица ГДД из дубинщика — та же формула (основа рынка)', () => {
    const from: Partial<Record<TroopId, number>> = { spearman: 80, archer: 107, axeman: 150, swordsman: 340, shieldman: 460, rider: 504, knight: 631, legionary: 876 };
    for (const [id, gold] of Object.entries(from) as [TroopId, number][]) expect(promoteUnit('clubman', id), id).toBe(gold);
  });

  it('дерево — из снаряжения, и это дерево ГДД', () => {
    expect(promoteTargets('clubman')).toEqual(TROOP_IDS.filter((id) => id !== 'clubman'));
    expect(promoteTargets('spearman')).toEqual(['rider', 'knight']);
    expect(promoteTargets('rider')).toEqual(['knight']);
    expect(promoteTargets('swordsman')).toEqual(['shieldman', 'legionary']);
    expect(promoteTargets('shieldman')).toEqual(['legionary']);
    expect(promoteTargets('archer')).toEqual([]);
    expect(promoteTargets('axeman')).toEqual([]);
    expect(promoteTargets('knight')).toEqual([]);
    expect(demoteTargets('knight')).toEqual(['clubman', 'spearman', 'rider']);
  });

  it('полная цена не убывает вверх по дереву — повышение не бывает даром без обоза', () => {
    for (const a of TROOP_IDS) for (const b of promoteTargets(a)) expect(promoteWorth(b), `${a} → ${b}`).toBeGreaterThan(promoteWorth(a));
  });

  it('любой путь повышения стоит столько же, сколько прямой (находка ПН-0ч: 816 против 631)', () => {
    let multi = 0;
    for (const a of TROOP_IDS) {
      for (const b of promoteTargets(a)) {
        const paths = chains(a, b);
        // Область правила: путь существует, и среди путей есть путь длиннее одного шага (иначе равенство даром).
        expect(paths.length, `${a} → ${b}`).toBeGreaterThan(0);
        if (paths.some((p) => p.length > 2)) multi++;
        for (const p of paths) expect(stepsCost(p), p.join(' → ')).toBe(promoteUnit(a, b));
      }
    }
    // Многошаговых пар не меньше пяти: дубинщик → всадник, латный всадник, щитоносец, латник; копейщик → латный всадник; мечник → латник.
    expect(multi).toBeGreaterThanOrEqual(5);
    expect(stepsCost(['clubman', 'spearman', 'rider', 'knight'])).toBe(631);
  });

  it('снаряжение из обоза засчитывается даром по основе, не ниже нуля и не больше нужного', () => {
    const none = promoteBill('clubman', 'spearman', 3)!;
    expect(none.gold).toBe(240);
    const two = promoteBill('clubman', 'spearman', 3, { spear: 2 })!;
    expect(two.gold).toBe(240 - 2 * 40);
    expect(two.fromCargo).toEqual({ spear: 2 });
    const many = promoteBill('clubman', 'spearman', 3, { spear: 9, sword: 4 })!;
    expect(many.fromCargo).toEqual({ spear: 3 });
    // Всадник → латный всадник: доспех (300) дороже шага (127) — повышение даром, но не в плюс.
    const armor = promoteBill('rider', 'knight', 1, { armor: 1 })!;
    expect(armor.full).toBe(127);
    expect(armor.gold).toBe(0);
    expect(promoteBill('archer', 'rider', 1)).toBeNull();
    expect(promoteBill('clubman', 'spearman', 0)).toBeNull();
  });

  it('разжаловать — снятое в обоз; повысить обратно из обоза — платится только припас', () => {
    expect(demoteKit('knight', 'spearman', 2)).toEqual({ shield: 2, armor: 2 });
    expect(demoteKit('spearman', 'knight', 1)).toBeNull();
    const back = promoteBill('spearman', 'knight', 2, demoteKit('knight', 'spearman', 2)!)!;
    expect(back.gold).toBe(Math.max(0, 2 * promoteUnit('spearman', 'knight') - 2 * (80 + 300)));
  });
});
