// Расстановки: пустые заготовки и шаблон быстрой атаки. Быстрая атака — не
// «плохой вариант», а разумный шаблон: пехота в центре, копейщики на флангах,
// лучники в тылу, конница в резерве, охват (раздел 15 документа). Настроенная армия должна
// выигрывать у него около 15% по потерям — это держит тест.
import {
  FRONT,
  REAR,
  SECTORS,
  UNIT_KINDS,
  type ArmySetup,
  type Orders,
  type Sector,
  type Stack,
} from './types';

export const emptyStack = (): Stack => ({ spear: 0, infantry: 0, archer: 0, cavalry: 0 });

export const stackOf = (part: Partial<Stack>): Stack => ({ ...emptyStack(), ...part });

export const stackTotal = (s: Stack): number => UNIT_KINDS.reduce((n, k) => n + s[k], 0);

export const emptySectors = (): Record<Sector, Stack> =>
  Object.fromEntries(SECTORS.map((id) => [id, emptyStack()])) as Record<Sector, Stack>;

export const DEFAULT_ORDERS: Orders = {
  cavalry: 'charge',
  archer: 'nearest',
  spear: 'hold-line',
  infantry: 'hold-center',
};

/** Сумма по всем секторам. */
export function armyTotal(setup: ArmySetup): Stack {
  const out = emptyStack();
  for (const id of SECTORS) for (const k of UNIT_KINDS) out[k] += setup.sectors[id][k];
  return out;
}

/** Делит `n` на три части долями `shares`, остаток — в середину. Всё целое. */
function split3(n: number, shares: [number, number, number]): [number, number, number] {
  const a = Math.floor(n * shares[0]);
  const c = Math.floor(n * shares[2]);
  return [a, n - a - c, c];
}

/**
 * Шаблон быстрой атаки для любого состава. Фронт — пехота в центре, копья по
 * флангам; без пехоты копья держат весь фронт, без копий пехота растягивается
 * на фланги. Лучники — в тыл 30/40/30, конница — в резерв и входит на слабый
 * фланг. Армия из одной конницы выходит из резерва сразу: ждать ей нечего.
 */
export function quickSetup(army: Partial<Stack>, over: Partial<ArmySetup> = {}): ArmySetup {
  const a = stackOf(army);
  const sectors = emptySectors();
  if (a.infantry > 0 && a.spear > 0) {
    sectors.B.infantry = a.infantry;
    const [l, mid, r] = split3(a.spear, [0.5, 0, 0.5]);
    sectors.A.spear = l;
    sectors.C.spear = r;
    sectors.B.spear = mid;
  } else if (a.infantry > 0) {
    const [l, mid, r] = split3(a.infantry, [0.25, 0.5, 0.25]);
    sectors.A.infantry = l;
    sectors.B.infantry = mid;
    sectors.C.infantry = r;
  } else if (a.spear > 0) {
    const [l, mid, r] = split3(a.spear, [0.3, 0.4, 0.3]);
    sectors.A.spear = l;
    sectors.B.spear = mid;
    sectors.C.spear = r;
  }
  const [dl, dm, dr] = split3(a.archer, [0.3, 0.4, 0.3]);
  sectors.D.archer = dl;
  sectors.E.archer = dm;
  sectors.F.archer = dr;
  const frontEmpty = FRONT.every((id) => stackTotal(sectors[id]) === 0);
  if (frontEmpty && a.cavalry > 0) {
    // Некому держать фронт — конница идёт первой.
    const [l, mid, r] = split3(a.cavalry, [0.3, 0.4, 0.3]);
    sectors.A.cavalry = l;
    sectors.B.cavalry = mid;
    sectors.C.cavalry = r;
  } else {
    sectors.R.cavalry = a.cavalry;
  }
  return {
    sectors,
    plan: 'envelop',
    orders: { ...DEFAULT_ORDERS },
    reserve: { kind: 'weakest' },
    ...over,
  };
}

/** Проверка входа: хотя бы один боец, ни одного отрицательного или дробного числа. */
export function validateSetup(setup: ArmySetup): string | null {
  let total = 0;
  for (const id of SECTORS) {
    for (const k of UNIT_KINDS) {
      const n = setup.sectors[id][k];
      if (!Number.isInteger(n) || n < 0) return `сектор ${id}: ${k} = ${n}`;
      total += n;
    }
  }
  if (total === 0) return 'армия пуста';
  return null;
}

export { FRONT, REAR };
