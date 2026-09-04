// Наборы для балансных проверок: составы, пары кольца, настроенная армия
// против шаблона. Их читают и тесты (раздел 16 документа), и скрипт отчёта —
// чтобы таблица в отчёте и утверждения в тестах считались по одним данным.
import { simulateBattle } from './sim';
import { quickSetup, emptySectors, stackOf } from './setup';
import type { ArmySetup, BattleResult, Side, Stack } from './types';

/** Одинаковая численность: «при прочих равных» — это про число людей. */
export const ARMY_SIZE = 600;

export interface Composition {
  name: string;
  army: Partial<Stack>;
  setup: ArmySetup;
}

const comp = (name: string, army: Partial<Stack>): Composition => ({ name, army, setup: quickSetup(army) });

export const COMPOSITIONS: Composition[] = [
  comp('пехота', { infantry: 600 }),
  comp('копья', { spear: 600 }),
  comp('лучники', { archer: 600 }),
  comp('конница', { cavalry: 600 }),
  comp('сбаланс', { spear: 150, infantry: 200, archer: 150, cavalry: 100 }),
  comp('копья+луки', { spear: 300, archer: 300 }),
  comp('пехота+луки', { infantry: 350, archer: 250 }),
  comp('конн+луки', { cavalry: 250, archer: 350 }),
  comp('пех+конн', { infantry: 400, cavalry: 200 }),
  comp('копья+конн', { spear: 350, cavalry: 250 }),
];

/** Чужие потери к своим: больше единицы — размен в свою пользу. */
export const lossRatio = (r: BattleResult, side: Side): number =>
  r.sides[side === 'attacker' ? 'defender' : 'attacker'].total.losses / Math.max(1, r.sides[side].total.losses);

export interface Mirrored {
  winner: 'a' | 'b' | 'draw';
  /** Потери b к потерям a, суммарно за оба боя. */
  lossRatio: number;
  ticks: number;
  results: [BattleResult, BattleResult];
}

/** Пара боёв одним сидом: сначала a нападает, потом b, — чтобы сторона поля не решала. */
export function mirrored(a: ArmySetup, b: ArmySetup, seed: number): Mirrored {
  const r1 = simulateBattle({ seed, attacker: a, defender: b });
  const r2 = simulateBattle({ seed, attacker: b, defender: a });
  const aLoss = r1.sides.attacker.total.losses + r2.sides.defender.total.losses;
  const bLoss = r1.sides.defender.total.losses + r2.sides.attacker.total.losses;
  const aWins = (r1.winner === 'attacker' ? 1 : 0) + (r2.winner === 'defender' ? 1 : 0);
  const bWins = (r1.winner === 'defender' ? 1 : 0) + (r2.winner === 'attacker' ? 1 : 0);
  const ratio = bLoss / Math.max(1, aLoss);
  let winner: Mirrored['winner'] = 'draw';
  if (aWins > bWins) winner = 'a';
  else if (bWins > aWins) winner = 'b';
  else if (ratio > 1.05) winner = 'a';
  else if (ratio < 1 / 1.05) winner = 'b';
  return { winner, lossRatio: ratio, ticks: (r1.ticks + r2.ticks) / 2, results: [r1, r2] };
}

/** Расстановка вручную: только указанные сектора. */
export function setupOf(sectors: Partial<Record<keyof ArmySetup['sectors'], Partial<Stack>>>, over: Partial<ArmySetup> = {}): ArmySetup {
  const full = emptySectors();
  for (const [id, stack] of Object.entries(sectors)) full[id as keyof typeof full] = stackOf(stack ?? {});
  const base = quickSetup({});
  return { ...base, sectors: full, ...over, orders: { ...base.orders, ...(over.orders ?? {}) } };
}

/** Кольцо: каждая пара при правильных приказах, `a` должен побеждать. */
export const RING: Array<{ name: string; a: ArmySetup; b: ArmySetup }> = [
  {
    name: 'копья (держать линию) бьют конницу',
    a: quickSetup({ spear: ARMY_SIZE }, { orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry: 'charge' } }),
    b: quickSetup({ cavalry: ARMY_SIZE }),
  },
  {
    name: 'конница бьёт лучников',
    a: quickSetup({ cavalry: ARMY_SIZE }, { orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry: 'attack-archers' } }),
    b: quickSetup({ archer: ARMY_SIZE }),
  },
  {
    name: 'лучники (держать дистанцию) бьют копья',
    a: quickSetup({ archer: ARMY_SIZE }, { orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'keep-distance', cavalry: 'charge' } }),
    b: quickSetup({ spear: ARMY_SIZE }, { orders: { spear: 'advance', infantry: 'hold-center', archer: 'nearest', cavalry: 'charge' } }),
  },
];

/** Армия для замера разрыва: одна и та же, на шаблоне и настроенная под шаблон. */
export const BALANCED_ARMY: Partial<Stack> = { spear: 150, infantry: 200, archer: 150, cavalry: 100 };

export const TUNED_VS_QUICK: { quick: ArmySetup; tuned: ArmySetup } = {
  quick: quickSetup(BALANCED_ARMY),
  tuned: setupOf(
    // Настройка под известный шаблон: фланги заякорены пехотой, чтобы не разваливались,
    // лучники бьют по пехоте противника, конница ждёт в резерве, куда придётся.
    { A: { infantry: 40, spear: 55 }, B: { infantry: 120, spear: 40 }, C: { infantry: 40, spear: 55 }, D: { archer: 45 }, E: { archer: 60 }, F: { archer: 45 }, R: { cavalry: 100 } },
    { plan: 'envelop', orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'priority-infantry', cavalry: 'charge' }, reserve: { kind: 'weakest' } },
  ),
};
