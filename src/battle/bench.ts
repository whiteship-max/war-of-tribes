// Наборы для балансных проверок: составы, пары кольца, настроенная армия
// против шаблона. Их читают и тесты (раздел 16 документа), и скрипт отчёта —
// чтобы таблица в отчёте и утверждения в тестах считались по одним данным.
import { simulateBattle } from './sim';
import { PLANS } from './config';
import { DEFAULT_ORDERS, quickSetup, quickAttack, emptySectors, stackOf } from './setup';
import { FRONT, REAR, type ArmySetup, type BattleResult, type CavalryOrder, type Plan, type Sector, type Side, type Stack } from './types';

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
 * в обход, резерв — туда, где проигрываем. Лучшая ли она из возможных — не
 * измерено: прежнее «перебор 192 расстановок показал потолок ≈25%» стояло без
 * кода, которым его мерили, и не держалось ничем.
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

// ---------- Перебор расстановок ----------
//
// Цена расстановки — насколько лучшая расстановка превосходит быструю атаку — меряется
// здесь, кодом, который лежит в репозитории. Прежде это число («потолок ≈25%») жило
// в тексте без перебора, и перебор, если он и был, однородных вкладов в один сектор не
// видел: ровно там пряталась доминирующая расстановка. Поэтому оси сетки берут крайние
// случаи нарочно — всё в один сектор фронта, все лучники в один сектор тыла, — и тест
// держит, что они в сетке есть.

/** Доли трёх секторов ряда слева направо со стороны своей армии. */
export type Share3 = readonly [number, number, number];

/** Как лечь пешей линии (пехота и копья) по фронту. `роды врозь` — пехота в центре, копья на флангах. */
export const LINE_SHAPES = {
  ровно: [1 / 3, 1 / 3, 1 / 3],
  центр: [0.15, 0.7, 0.15],
  фланги: [0.4, 0.2, 0.4],
  'всё в центр': [0, 1, 0],
  'всё на левый': [1, 0, 0],
  'роды врозь': null,
} as const satisfies Record<string, Share3 | null>;
export type LineShape = keyof typeof LINE_SHAPES;

/** Где лучники: тыл ровно, весь тыл за центром или за левым флангом, во фронте вместе с линией. */
export const ARCHER_PLACES = ['тыл ровно', 'всё за центром', 'всё за левым', 'во фронте'] as const;
export type ArcherPlace = (typeof ARCHER_PLACES)[number];

/** Где конница и с каким приказом. */
export const CAVALRY_PLACES = ['резерв: удар', 'резерв: обход', 'резерв: держать фланг', 'резерв: по лучникам', 'фронт ровно'] as const;
export type CavalryPlace = (typeof CAVALRY_PLACES)[number];

export const RESERVE_KINDS = ['immediate', 'weakest'] as const;

export interface LayoutSpec {
  line: LineShape;
  archers: ArcherPlace;
  cavalry: CavalryPlace;
  plan: Plan;
  reserve: (typeof RESERVE_KINDS)[number];
}

/** Делит `n` по долям, всё целое; остаток — сектору с наибольшей долей. */
function spread(n: number, shares: Share3): [number, number, number] {
  const out = shares.map((s) => Math.floor(n * s)) as [number, number, number];
  const rest = n - out[0] - out[1] - out[2];
  out[shares.indexOf(Math.max(...shares))] += rest;
  return out;
}

const CAVALRY_ORDER: Record<CavalryPlace, CavalryOrder> = {
  'резерв: удар': 'charge',
  'резерв: обход': 'flank',
  'резерв: держать фланг': 'hold-flank',
  'резерв: по лучникам': 'attack-archers',
  'фронт ровно': 'charge',
};

/** Расстановка армии по описанию. Кладёт армию целиком: ни один боец не остаётся за полем. */
export function layoutOf(army: Partial<Stack>, spec: LayoutSpec): ArmySetup {
  const a = stackOf(army);
  const s = emptySectors();
  const shape = LINE_SHAPES[spec.line];
  const inf = spread(a.infantry, shape ?? [0.15, 0.7, 0.15]);
  const spr = spread(a.spear, shape ?? [0.5, 0, 0.5]);
  FRONT.forEach((id, i) => {
    s[id].infantry = inf[i];
    s[id].spear = spr[i];
  });
  const archers =
    spec.archers === 'тыл ровно' ? spread(a.archer, [1 / 3, 1 / 3, 1 / 3]) : spec.archers === 'всё за центром' ? spread(a.archer, [0, 1, 0]) : spec.archers === 'всё за левым' ? spread(a.archer, [1, 0, 0]) : spread(a.archer, shape ?? [0.15, 0.7, 0.15]);
  (spec.archers === 'во фронте' ? FRONT : REAR).forEach((id, i) => {
    s[id].archer = archers[i];
  });
  if (spec.cavalry === 'фронт ровно') {
    const cav = spread(a.cavalry, [1 / 3, 1 / 3, 1 / 3]);
    FRONT.forEach((id, i) => {
      s[id].cavalry = cav[i];
    });
  } else s.R.cavalry = a.cavalry;
  return {
    sectors: s,
    plan: spec.plan,
    orders: { ...DEFAULT_ORDERS, cavalry: CAVALRY_ORDER[spec.cavalry] },
    reserve: { kind: spec.reserve },
  };
}

export const layoutName = (spec: LayoutSpec): string => `${spec.line} | ${spec.archers} | ${spec.cavalry} | ${spec.plan} | ${spec.reserve}`;

/** Вся сетка: произведение осей. */
export function layoutGrid(): LayoutSpec[] {
  const out: LayoutSpec[] = [];
  for (const line of Object.keys(LINE_SHAPES) as LineShape[])
    for (const archers of ARCHER_PLACES)
      for (const cavalry of CAVALRY_PLACES)
        for (const plan of Object.keys(PLANS) as Plan[])
          for (const reserve of RESERVE_KINDS) out.push({ line, archers, cavalry, plan, reserve });
  return out;
}

/**
 * Однородный вклад: вся пешая линия в одном секторе фронта или все лучники в одном
 * секторе тыла. Выводится из самой расстановки, а не из имени оси, — чтобы тест
 * проверял то, что лежит на поле.
 */
export function homogeneous(setup: ArmySetup): boolean {
  const one = (ids: readonly Sector[], kinds: Array<keyof Stack>): boolean => {
    const loads = ids.map((id) => kinds.reduce((n, k) => n + setup.sectors[id][k], 0));
    const total = loads.reduce((n, x) => n + x, 0);
    return total > 0 && loads.filter((x) => x > 0).length === 1;
  };
  return one(FRONT, ['infantry', 'spear']) || one(REAR, ['archer']);
}

/**
 * Удерживает ли `setup` поле против быстрой атаки армии, умноженной на `k`: доля
 * удержанных из `n` боёв с обеих сторон поля. Мерка цены расстановки силой — при каком
 * перевесе врага расстановка перестаёт удерживать поле.
 */
export function fieldVsScaledQuick(setup: (seed: number) => ArmySetup, k: number, n: number): number {
  const enemyArmy = Object.fromEntries(Object.entries(BALANCED_ARMY).map(([kind, m]) => [kind, Math.round((m ?? 0) * k)])) as Partial<Stack>;
  let held = 0;
  for (let seed = 1; seed <= n; seed += 1) {
    const attacks = seed % 2 === 1;
    const own = setup(seed);
    const foe = quickAttack(enemyArmy, seed).setup;
    const r = simulateBattle({ seed, attacker: attacks ? own : foe, defender: attacks ? foe : own });
    if (r.winner === (attacks ? 'attacker' : 'defender')) held += 1;
  }
  return held / n;
}

/** Перевес врага, при котором доля удержанного поля переходит через половину: делением отрезка. */
export function holdPoint(setup: (seed: number) => ArmySetup, n: number, lo = 0.6, hi = 1.8, steps = 9): number {
  for (let i = 0; i < steps; i += 1) {
    const mid = (lo + hi) / 2;
    if (fieldVsScaledQuick(setup, mid, n) >= 0.5) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
