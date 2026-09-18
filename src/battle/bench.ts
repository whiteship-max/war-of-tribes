// Наборы для балансных проверок: составы, пары кольца, настроенная армия
// против шаблона. Их читают и тесты (раздел 16 документа), и скрипт отчёта —
// чтобы таблица в отчёте и утверждения в тестах считались по одним данным.
import { simulateBattle } from './sim';
import { PLANS } from './config';
import { seededRng } from './rng';
import { DEFAULT_ORDERS, quickSetup, quickAttack, emptySectors, stackOf } from './setup';
import { FRONT, HORSE_KINDS, REAR, type ArcherOrder, type ArmySetup, type BattleResult, type CavalryOrder, type InfantryOrder, type Plan, type ReserveTrigger, type Sector, type Side, type SpearOrder, type Stack } from './types';

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
  // Конных родов два (docs/stable.md): тяжёлая одна и в паре с пехотой — как лёгкая выше.
  comp('тяжёлая', { heavy: 600 }),
  comp('пех+тяж', { infantry: 400, heavy: 200 }),
  // Масса лёгкой за тонким заслоном тяжёлой. Строка стоит не для красоты: из всех составов
  // шагом 50 бойцов по пяти родам «сбаланс» бьют только такие — лёгкая ждёт удара по лучникам
  // за заслоном, который её прикрывает (`Battle.expose`: линия — присутствие, а не сила).
  comp('конн за заслоном', { cavalry: 500, heavy: 100 }),
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
// в тексте, а перебора не было ни в одном коммите — и никто не видел, что однородный
// вклад в один сектор бьёт всё: ровно там пряталась доминирующая расстановка. Поэтому
// оси сетки берут крайние случаи нарочно — всё в один сектор фронта, все лучники в один
// сектор тыла, — и тест держит, что они в сетке есть.

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
  // Оба конных рода — одним правилом и одним приказом: ось сетки — где конница, а не какая.
  for (const k of HORSE_KINDS) {
    if (spec.cavalry === 'фронт ровно') {
      const cav = spread(a[k], [1 / 3, 1 / 3, 1 / 3]);
      FRONT.forEach((id, i) => {
        s[id][k] = cav[i];
      });
    } else s.R[k] = a[k];
  }
  return {
    sectors: s,
    plan: spec.plan,
    orders: { ...DEFAULT_ORDERS, cavalry: CAVALRY_ORDER[spec.cavalry], heavy: CAVALRY_ORDER[spec.cavalry] },
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
 * Настроенная армия — эталон разрыва: против быстрой атаки (случайный пресет по
 * сиду) выигрывает по потерям в коридоре, который держит тест (`npm run battle:report`,
 * раздел «Разрыв быстрой атаки»), и против каждого пресета в отдельности не
 * проигрывает. Берётся из сетки перебора, а не пишется руками: пехота в центре,
 * копья на флангах, лучники ровно в тылу, конница в резерве «держать фланг» — то же,
 * что стандартный пресет, кроме приказа коннице и тыла лучников. Лучшей из возможных
 * она не является: и сетка, и случайный поиск ниже находят разрыв намного больше.
 *
 * Прежний эталон (натиск, пехота с копьями вперемешку, конница «в обход») собирался под
 * прежний конный род: после раскола конницы он дал 3.6 % и проигрывал стандартному
 * пресету — пресет теперь ставит лёгкую бить лучников (docs/stable.md).
 */
export const TUNED_SPEC: LayoutSpec = { line: 'роды врозь', archers: 'тыл ровно', cavalry: 'резерв: держать фланг', plan: 'envelop', reserve: 'weakest' };
export const TUNED: ArmySetup = layoutOf(BALANCED_ARMY, TUNED_SPEC);

// ---------- Случайный поиск расстановок ----------
//
// Сетка меряет цену расстановки по осям, которые кто-то придумал; всё, что между осями, —
// лучники во фронте вперемешку с линией, конница по фронту неровно, приказы копьям и
// пехоте, — ей не видно. Поиск берёт расстановки наугад из сеяного генератора и отбирает
// лучших против заданного противника. Сид закреплён: одни и те же расстановки на каждом
// прогоне, и найденное можно переписать в эталон, не теряя происхождения.

const SPEAR_ORDERS: readonly SpearOrder[] = ['hold-line', 'guard-archers', 'priority-cavalry', 'advance'];
const INFANTRY_ORDERS: readonly InfantryOrder[] = ['hold-center', 'advance', 'support-weak-flank', 'break-center'];
const ARCHER_ORDERS: readonly ArcherOrder[] = ['nearest', 'priority-infantry', 'priority-cavalry', 'keep-distance', 'support-center'];
const HORSE_ORDERS: readonly CavalryOrder[] = ['charge', 'hold-flank', 'flank', 'attack-archers', 'pursue'];
const RESERVES: readonly ReserveTrigger['kind'][] = ['immediate', 'weakest', 'center-losing', 'weak-flank', 'morale'];

/** Сид поиска, число расстановок и боёв отбора: `battle:report`, раздел «Случайный поиск расстановок». */
export const SEARCH = { seed: 12345, n: 2500, screen: 10 };

/** Одна расстановка армии наугад: каждый род целиком, ни один боец не остаётся за полем. */
export function randomLayout(army: Partial<Stack>, rng: () => number): ArmySetup {
  const a = stackOf(army);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  const split = (n: number): number[] => {
    const w = [rng() ** 2, rng() ** 2, rng() ** 2];
    const sum = w[0] + w[1] + w[2];
    const out = w.map((x) => Math.floor((n * x) / sum));
    out[0] += n - out[0] - out[1] - out[2];
    return out;
  };
  const s = emptySectors();
  const inf = split(a.infantry);
  const spr = split(a.spear);
  const arc = split(a.archer);
  const archersFront = rng() < 0.2;
  FRONT.forEach((id, i) => {
    s[id].infantry = inf[i];
    s[id].spear = spr[i];
  });
  (archersFront ? FRONT : REAR).forEach((id, i) => (s[id].archer = arc[i]));
  const horseInReserve = rng() < 0.7;
  for (const k of HORSE_KINDS) {
    if (horseInReserve) s.R[k] = a[k];
    else split(a[k]).forEach((n, i) => (s[FRONT[i]][k] += n));
  }
  const horse = pick(HORSE_ORDERS);
  return {
    sectors: s,
    plan: pick(Object.keys(PLANS) as Plan[]),
    orders: { spear: pick(SPEAR_ORDERS), infantry: pick(INFANTRY_ORDERS), archer: pick(ARCHER_ORDERS), cavalry: horse, heavy: horse },
    reserve: { kind: pick(RESERVES) } as ReserveTrigger,
  };
}

/** Все расстановки поиска с их разрывом против `opponent` на `SEARCH.screen` боях, лучшие первыми. */
export function searchLayouts(opponent: (seed: number) => ArmySetup): Array<{ gap: number; setup: ArmySetup }> {
  const rng = seededRng(SEARCH.seed);
  const out: Array<{ gap: number; setup: ArmySetup }> = [];
  for (let i = 0; i < SEARCH.n; i += 1) {
    const setup = randomLayout(BALANCED_ARMY, rng);
    out.push({ gap: gapAgainst(setup, opponent, SEARCH.screen).gap, setup });
  }
  return out.sort((x, y) => y.gap - x.gap);
}

/**
 * Известный контрер стандартного пресета: против него одного выигрывает намного
 * больше, но против случайного пресета — не больше настроенной армии
 * (`npm run battle:report`, раздел «Разрыв быстрой атаки»). Это и есть
 * смысл пресетов: контрить нечего, пока не знаешь, какой пришёл.
 *
 * Найден случайным поиском, но не тем, что закоммичен: щупом сессии 18.09.2026 с тем же
 * генератором и другим порядком бросков. Закоммиченный поиск (раздел «Случайный поиск
 * расстановок») среди первых двухсот контреров стандарта такого не находит: берущие у
 * стандарта больше 40 % там либо сильны и против случайного пресета, либо почти бесполезны
 * против него. Эталон держит свойство теста примером, а насколько он типичен, говорит тот
 * раздел — с расколом конницы сильный контрер стандарта чаще всего силён против всех.
 */
export const KNOWN_COUNTER: ArmySetup = setupOf(
  {
    A: { spear: 41, infantry: 50, archer: 8, cavalry: 21 },
    B: { spear: 56, infantry: 44, archer: 87, cavalry: 43 },
    C: { spear: 53, infantry: 106, archer: 55, cavalry: 36 },
  },
  { plan: 'aggressive', orders: { spear: 'advance', infantry: 'hold-center', archer: 'nearest', cavalry: 'hold-flank', heavy: 'hold-flank' }, reserve: { kind: 'weak-flank' } },
);

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
