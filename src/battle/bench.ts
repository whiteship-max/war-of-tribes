// Наборы для балансных проверок: составы, пары кольца, настроенная армия
// против шаблона. Их читают и тесты (раздел 16 документа), и скрипт отчёта —
// чтобы таблица в отчёте и утверждения в тестах считались по одним данным.
import { simulateBattle } from './sim';
import { quickSetup, quickAttack, emptySectors, stackOf } from './setup';
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

/**
 * Размен в этих пределах — поровну. Балансные пороги задаются по размену, а не
 * по доле побед: в зеркале одинаковых армий перевес в 5% каскадом даёт 10/0/0,
 * доля побед плохой измеритель, размен — хороший.
 */
export const RATIO_EVEN = 1.05;

/**
 * Потолки ограничителя «перевес 10%»: размен большей стороны не выше этого.
 * У составов с пешей линией (пехота или копья) — 1.6 на состав и 1.5 в среднем.
 * Составы без линии (одни лучники, одна конница, конница с луками) держат свой
 * потолок: без якоря сектор и должен рушиться, а кольцо добивает лучников, когда
 * линии нет, — это замысел, но и у него есть граница, иначе предохранитель
 * ничего не предохраняет.
 */
export const OVERSIZE_CAP = { line: 1.6, lineMean: 1.5, noLine: 2.0 };

/** Есть ли у состава пешая линия — пехота или копья. */
export const hasLine = (army: Partial<Stack>): boolean => (army.infantry ?? 0) > 0 || (army.spear ?? 0) > 0;

export interface Mirrored {
  /** Кто выиграл размен: потери противника больше своих хотя бы в `RATIO_EVEN` раз. */
  winner: 'a' | 'b' | 'draw';
  /** Потери b к потерям a, суммарно за оба боя. */
  lossRatio: number;
  /** Сколько раз каждая сторона удержала поле (из двух боёв) — результат, не цена. */
  field: { a: number; b: number };
  /** Сколько из двух боёв — победы с непомерными потерями. */
  pyrrhic: number;
  ticks: number;
  results: [BattleResult, BattleResult];
}

/** Пара боёв одним сидом: сначала a нападает, потом b, — чтобы сторона поля не решала. */
export function mirrored(a: ArmySetup, b: ArmySetup, seed: number): Mirrored {
  const r1 = simulateBattle({ seed, attacker: a, defender: b });
  const r2 = simulateBattle({ seed, attacker: b, defender: a });
  const aLoss = r1.sides.attacker.total.losses + r2.sides.defender.total.losses;
  const bLoss = r1.sides.defender.total.losses + r2.sides.attacker.total.losses;
  const field = {
    a: (r1.winner === 'attacker' ? 1 : 0) + (r2.winner === 'defender' ? 1 : 0),
    b: (r1.winner === 'defender' ? 1 : 0) + (r2.winner === 'attacker' ? 1 : 0),
  };
  const ratio = bLoss / Math.max(1, aLoss);
  let winner: Mirrored['winner'] = 'draw';
  if (ratio >= RATIO_EVEN) winner = 'a';
  else if (ratio <= 1 / RATIO_EVEN) winner = 'b';
  return { winner, lossRatio: ratio, field, pyrrhic: (r1.pyrrhic ? 1 : 0) + (r2.pyrrhic ? 1 : 0), ticks: (r1.ticks + r2.ticks) / 2, results: [r1, r2] };
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

/** Армия для замера разрыва: одна и та же, на быстрой атаке и настроенная. */
export const BALANCED_ARMY: Partial<Stack> = { spear: 150, infantry: 200, archer: 150, cavalry: 100 };

/**
 * Настроенная армия — эталон разрыва: против быстрой атаки (случайный пресет по
 * сиду) выигрывает около 15% по потерям, и против каждого пресета в отдельности
 * не проигрывает. Фланги заякорены пехотой, натиск через центр, конница уходит
 * в обход, резерв — туда, где проигрываем. Перебор 192 расстановок показал
 * потолок ≈25% против случайного пресета: выше не поднимается ни одна.
 */
export const TUNED: ArmySetup = setupOf(
  { A: { infantry: 40, spear: 55 }, B: { infantry: 120, spear: 40 }, C: { infantry: 40, spear: 55 }, D: { archer: 45 }, E: { archer: 60 }, F: { archer: 45 }, R: { cavalry: 100 } },
  { plan: 'assault', orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry: 'flank' }, reserve: { kind: 'weakest' } },
);

/**
 * Известный контрер стандартного пресета: против него одного выигрывает вдвое и
 * больше, но против случайного пресета — не больше настроенной армии. Это и есть
 * смысл пресетов: контрить нечего, пока не знаешь, какой пришёл.
 */
export const KNOWN_COUNTER: ArmySetup = setupOf(
  { A: { infantry: 50, spear: 45 }, B: { infantry: 100, spear: 60 }, C: { infantry: 50, spear: 45 }, D: { archer: 60 }, E: { archer: 30 }, F: { archer: 60 }, R: { cavalry: 100 } },
  { plan: 'assault', orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry: 'hold-flank' }, reserve: { kind: 'immediate' } },
);

/** Быстрая атака той же армии: пресет по сиду боя. */
export const quickOf = (seed: number): ArmySetup => quickAttack(BALANCED_ARMY, seed).setup;

/**
 * Разрыв по потерям: `setup` против `opponent(seed)` на `n` боях с обеих сторон
 * поля. Больше нуля — `setup` теряет меньше. `lost` — сколько боёв `setup` проиграл.
 */
export function gapAgainst(setup: ArmySetup, opponent: (seed: number) => ArmySetup, n: number): { gap: number; lost: number; won: number } {
  let own = 0;
  let theirs = 0;
  let lost = 0;
  let won = 0;
  for (let seed = 1; seed <= n; seed += 1) {
    const attacks = seed % 2 === 1;
    const foe = opponent(seed);
    const r = simulateBattle({ seed, attacker: attacks ? setup : foe, defender: attacks ? foe : setup });
    const me: Side = attacks ? 'attacker' : 'defender';
    own += r.sides[me].total.losses;
    theirs += r.sides[me === 'attacker' ? 'defender' : 'attacker'].total.losses;
    if (r.winner === me) won += 1;
    else if (r.winner !== 'draw') lost += 1;
  }
  return { gap: theirs / Math.max(1, own) - 1, lost, won };
}
