// Полоса ролика TW: фаза с кругом и мораль армий из журнала (docs/battle_tw.md, раздел 4).
import { describe, expect, it } from 'vitest';
import { standBattle } from '../battle-stand';
import { twPlanOfRecord } from '../tw/record';
import { fullMorale, hudAt } from './hud';

const battle = standBattle(new URLSearchParams('replay=tw&men=600&foe=560&seed=7&place=woods,road&hour=10'));
const plan = twPlanOfRecord(battle.result, battle.us, battle.troops, 'medium', undefined, battle.place, battle.beastSide);
const cast = plan.cast;

describe('полоса ролика TW', () => {
  it('мораль на конце каждой фазы — мораль журнала к концу этой фазы', () => {
    // Граница области: у журнала мораль фаз есть, и фаз больше одной.
    expect(battle.result.phases.every((p) => p.morale)).toBe(true);
    let checked = 0;
    for (const span of cast.spans) {
      const p = battle.result.phases.find((x) => x.from === span.from && x.to === span.to && x.phase === span.phase);
      if (!p || span.t1 <= span.t0) continue;
      const hud = hudAt(cast, battle.result, span.t1);
      for (const side of ['attacker', 'defender'] as const) expect(hud.morale[side]).toBeCloseTo(Math.min(1, p.morale![side] / fullMorale(battle.result, side)!), 6);
      expect(hud.phase).toBe(p.phase);
      expect(hud.round).toBe(p.round ?? 1);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it('внутри фазы мораль идёт прямой от прежней фазы к этой — без скачков', () => {
    let worst = 0;
    for (let t = 0; t < cast.seconds; t += 0.05) {
      const a = hudAt(cast, battle.result, t);
      const b = hudAt(cast, battle.result, t + 0.05);
      for (const side of ['attacker', 'defender'] as const) worst = Math.max(worst, Math.abs((b.morale[side] ?? 0) - (a.morale[side] ?? 0)));
    }
    // Двадцатая секунды — не больше десятой полной морали: полоса едет, а не прыгает.
    expect(worst).toBeLessThan(0.1);
  });

  it('у записи без морали фаз полоса морали не выдумывает', () => {
    const old = { ...battle.result, phases: battle.result.phases.map(({ morale: _m, ...p }) => p) };
    const hud = hudAt(cast, old, cast.seconds / 2);
    expect(hud.morale.attacker).toBeNull();
    expect(hud.morale.defender).toBeNull();
  });

  it('свежая армия начинает полной полосой, уставшая — неполной', () => {
    const fresh = hudAt(cast, battle.result, 0);
    expect(fresh.morale.attacker).toBeCloseTo(1, 6);
    expect(fresh.morale.defender).toBeCloseTo(1, 6);
    // Та же запись, но армия вышла в бой с половиной морали (событие `weary`): полоса — от полной, а не от стартовой.
    const tired = { ...battle.result, log: [{ tick: 1, phase: 'ranged' as const, id: 'weary' as const, side: 'attacker' as const, rest: 0.5 }, ...battle.result.log] };
    expect(hudAt(cast, tired, 0).morale.attacker).toBeCloseTo(0.5, 6);
  });
});
