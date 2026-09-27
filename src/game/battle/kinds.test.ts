// Перевод бойцов племени в роды боя — единственный мост из видов, которые игрок нанимает, в роды, которыми
// считает ядро (`kinds.ts`). Прежде здесь же жила расстановка обороны по секторам (`formation.ts`); с поставкой 2
// боя она ушла — у частокола строй раскладывает правило, как любой бой (docs/battle_eu4.md, 14.27), — и отряд
// племени входит в бой так же, как в мире: правилом развёртывания по родам (`deploySetup(kindsOf(…))`).
import { describe, expect, it } from 'vitest';
import { UNIT_KINDS, deploySetup, simulateBattle, type ArmySetup } from '@/battle';
import { RATIO_EVEN } from '@/battle/bench';
import { createInitialState } from '../state';
import { wageOf } from '../derived';
import { TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import {
  BATTLE_MAN,
  OWN_KINDS,
  gearOf,
  gearOfTroop,
  kindsOf,
  menOf,
  troopLosses,
  troopTotal,
  troopsAfter,
  weightOf,
  type TroopStack,
} from './kinds';

const GARRISON: TroopStack = { clubman: 6, spearman: 8, archer: 5, axeman: 3, legionary: 2 };

describe('перевод бойцов племени в роды боя', () => {
  it('дубинщик — единица измерения строя, латник весит своей мощью', () => {
    expect(menOf('clubman', 1)).toBe(1);
    expect(menOf('spearman', 1)).toBe(2);
    expect(menOf('legionary', 1)).toBe(16 / BATTLE_MAN);
  });

  it('роды собираются из своих видов', () => {
    const k = kindsOf(GARRISON);
    expect(k.spear).toBe(menOf('spearman', 8));
    expect(k.archer).toBe(menOf('archer', 5));
    // Дубинщики, топорники и латники выходят одной пехотой.
    expect(k.infantry).toBe(menOf('clubman', 6) + menOf('axeman', 3) + menOf('legionary', 2));
    expect(k.cavalry).toBe(0);
  });

  it('снаряжение из кузницы поднимает ступень рода', () => {
    expect(gearOf({ clubman: 10 }).infantry).toBe(0);
    expect(gearOf({ legionary: 10 }).infantry).toBe(3);
    // Смешанный отряд — среднее по людям, а не по видам.
    expect(gearOf({ clubman: 9, legionary: 1 }).infantry).toBe(0);
  });

  it('потери рода списываются со слабых первыми и не уходят в минус', () => {
    const sent: TroopStack = { clubman: 4, legionary: 2 };
    const lost = troopLosses(sent, { spear: 0, infantry: 6, archer: 0, cavalry: 0, heavy: 0 });
    expect(lost.clubman).toBe(4);
    expect(lost.legionary ?? 0).toBe(0);
    const left = troopsAfter(sent, lost);
    expect(left.legionary).toBe(2);
    expect(left.clubman ?? 0).toBe(0);
  });

  it('потери больше отряда его не переворачивают', () => {
    const sent: TroopStack = { clubman: 3 };
    const lost = troopLosses(sent, { spear: 0, infantry: 999, archer: 0, cavalry: 0, heavy: 0 });
    expect(lost.clubman).toBe(3);
    expect(troopTotal(troopsAfter(sent, lost))).toBe(0);
  });
});

/** Отряд племени, вставший по правилу развёртывания, в том виде, в каком его видит ядро: так же, как в мире. */
const armyOf = (troops: TroopStack): ArmySetup => ({ ...deploySetup(kindsOf(troops)), gear: gearOf(troops) });

/** Пара боёв одним сидом: сторона поля не должна решать исход. */
function ratio(a: ArmySetup, b: ArmySetup, seed: number): number {
  const r1 = simulateBattle({ seed, attacker: a, defender: b });
  const r2 = simulateBattle({ seed, attacker: b, defender: a });
  const aLoss = r1.sides.attacker.total.losses + r2.sides.defender.total.losses;
  const bLoss = r1.sides.defender.total.losses + r2.sides.attacker.total.losses;
  return bLoss / Math.max(1, aLoss);
}

/** Средний размен по нескольким сидам: один бой ничего не доказывает. */
const meanRatio = (a: ArmySetup, b: ArmySetup): number => {
  let sum = 0;
  for (let seed = 1; seed <= 6; seed += 1) sum += ratio(a, b, seed);
  return sum / 6;
};

describe('конница племени', () => {
  it('всадник выходит лёгкой конницей, латный — тяжёлой, и все пять родов игроку доступны', () => {
    expect(kindsOf({ rider: 10 }).cavalry).toBe(menOf('rider', 10));
    expect(kindsOf({ rider: 10 }).infantry).toBe(0);
    // Класс решает доспех, а не таблица рядом: тот же конь под доспехом — уже тяжёлая конница.
    expect(kindsOf({ knight: 10 }).heavy).toBe(menOf('knight', 10));
    expect(kindsOf({ knight: 10 }).cavalry).toBe(0);
    // Пустых родов у племени не осталось: все пять родов ядра у игрока есть.
    expect([...OWN_KINDS].sort()).toEqual([...UNIT_KINDS].sort());
  });

  it('копьё и щит всадника поднимают его ступень снаряжения выше дубинщика', () => {
    expect(gearOfTroop('rider')).toBe(2);
    expect(gearOfTroop('rider')).toBeGreaterThan(gearOfTroop('clubman'));
    expect(gearOf({ rider: 5 }).cavalry).toBe(2);
  });

  it('конница дороже пеших своего веса: конь, учения и жалованье за снаряжение', () => {
    const gearCount = (id: (typeof TROOP_IDS)[number]): number =>
      Object.values(TROOP_BY_ID[id].gear).reduce((n, v) => n + (v ?? 0), 0);
    const s = createInitialState(7);
    // Граница: сравниваем с пешими того же веса в строю — иначе «дороже» сошлось бы даром.
    const foot = TROOP_IDS.filter((id) => !TROOP_BY_ID[id].mounted && weightOf(id) <= weightOf('rider'));
    expect(foot.length).toBeGreaterThan(3);
    for (const id of foot) {
      const def = TROOP_BY_ID[id];
      expect(TROOP_BY_ID.rider.work, `учения: ${id}`).toBeGreaterThan(def.work);
      // Доспех — вещь, и за неё платят: латный всадник дороже своего же лёгкого по жалованью.
      expect(wageOf(s, 'knight'), `жалованье: ${id}`).toBeGreaterThan(wageOf(s, id));
    }
    expect(wageOf(s, 'knight')).toBeGreaterThan(wageOf(s, 'rider'));
    expect(gearCount('knight')).toBe(gearCount('rider') + 1);
  });

  it('кольцо работает в обе стороны: конница племени режет лучников и вязнет в копьях', () => {
    // Отряды одной мощи, поэтому сравнивать размен честно.
    const riders = armyOf({ rider: 100 });
    const archers = armyOf({ archer: 280 });
    const spears = armyOf({ spearman: 350 });
    expect(meanRatio(riders, archers)).toBeGreaterThan(RATIO_EVEN);
    expect(meanRatio(riders, spears)).toBeLessThan(1 / RATIO_EVEN);
  });

});
