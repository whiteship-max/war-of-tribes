// Наборы для балансных проверок: составы, пары кольца, настроенная армия
// против шаблона. Их читают и тесты (раздел 16 документа), и скрипт отчёта —
// чтобы таблица в отчёте и утверждения в тестах считались по одним данным.
import { simulateBattle, stackPower } from './sim';
import { COVER, PLANS } from './config';
import { seededRng } from './rng';
import { DEFAULT_ORDERS, QUICK_PRESETS, quickSetup, quickAttack, emptySectors, stackOf } from './setup';
import { KIND_META } from './names';
import { FRONT, HORSE_KINDS, REAR, UNIT_KINDS, type ArcherOrder, type ArmySetup, type BattleResult, type CavalryOrder, type InfantryOrder, type Plan, type ReserveTrigger, type Sector, type Side, type SpearOrder, type Stack, type UnitKind } from './types';

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

// ---------- Решётка составов ----------
//
// Составы, подобранные руками, врут в обе стороны: список не содержит того, кто
// доминирует, и содержит тех, кого доминирующий бьёт для красоты. Решётка берёт все
// составы из `ARMY_SIZE` бойцов строя шагом `LATTICE_STEP` по всем родам ядра — род
// добавили в `UNIT_KINDS`, и решётка знает его сама.

/** Шаг решётки: 150 из 600 — 70 составов при пяти родах, 2415 пар. */
export const LATTICE_STEP = 150;

/** Все составы решётки: каждый род от нуля до всей армии шагом `step`, сумма — `total`. */
export function compositionLattice(step = LATTICE_STEP, total = ARMY_SIZE): Array<Partial<Stack>> {
  const out: Array<Partial<Stack>> = [];
  const walk = (i: number, left: number, cur: Partial<Stack>): void => {
    const kind = UNIT_KINDS[i];
    if (i === UNIT_KINDS.length - 1) {
      out.push({ ...cur, [kind]: left });
      return;
    }
    for (let n = 0; n <= left; n += step) walk(i + 1, left - n, { ...cur, [kind]: n });
  };
  walk(0, total, {});
  return out;
}

export const compositionName = (army: Partial<Stack>): string =>
  UNIT_KINDS.filter((k) => (army[k] ?? 0) > 0)
    .map((k) => `${KIND_META[k].name.toLowerCase()} ${army[k]}`)
    .join(' + ');

/** Самый многочисленный род состава; при равенстве — все равные. */
export const mainKinds = (army: Partial<Stack>): UnitKind[] => {
  const top = Math.max(...UNIT_KINDS.map((k) => army[k] ?? 0));
  return UNIT_KINDS.filter((k) => (army[k] ?? 0) === top);
};

export interface LatticeRow {
  army: Partial<Stack>;
  /** Кого этот состав бьёт по размену (`RATIO_EVEN`) — номера в решётке. */
  beats: number[];
  /** Кому проигрывает по размену. */
  lostTo: number[];
}

/**
 * Каждый состав решётки против каждого, одним зеркальным боем на пару (`mirrored`, сид 1):
 * `layout` — как состав встаёт в поле, по умолчанию стандартный
 * пресет: расстановку решётка не меряет, для неё есть перебор ниже.
 */
export function latticeDuels(armies: Array<Partial<Stack>> = compositionLattice(), layout: (army: Partial<Stack>) => ArmySetup = (a) => quickSetup(a)): LatticeRow[] {
  const setups = armies.map(layout);
  const rows: LatticeRow[] = armies.map((army) => ({ army, beats: [], lostTo: [] }));
  for (let i = 0; i < setups.length; i += 1) {
    for (let j = i + 1; j < setups.length; j += 1) {
      const r = mirrored(setups[i], setups[j], 1).lossRatio;
      if (r >= RATIO_EVEN) {
        rows[i].beats.push(j);
        rows[j].lostTo.push(i);
      } else if (r <= 1 / RATIO_EVEN) {
        rows[j].beats.push(i);
        rows[i].lostTo.push(j);
      }
    }
  }
  return rows;
}

/**
 * Ответа без своего рода нет: всё, что бьёт этот состав, само построено на его главном
 * роде. Так выглядит обязательный род — против массы тяжёлой помогает только тяжёлая.
 * Решётка это видит, а утверждение «каждый кому-то проигрывает» — нет: тяжёлой есть
 * кому проиграть, но все эти «кто» — тяжёлая.
 */
export const answerlessOwnKind = (rows: LatticeRow[], i: number): boolean =>
  rows[i].lostTo.length > 0 && rows[i].lostTo.every((j) => mainKinds(rows[i].army).every((k) => (rows[j].army[k] ?? 0) > 0));

// ---------- Заслон: линия по силе ----------
//
// Лёгкая, ждущая удара по лучникам, за заслоном на тех же полосах (`Battle.expose`). Прежде
// заслон прикрывал по наличию, и самый тонкий был лучшим: чем меньше латных впереди, тем больше
// лёгких за ними. Стенд меряет, что даёт манёвр при заслоне каждой толщины, — им выведен
// `COVER.K`, и на нём стоит тест «линия по силе».

/** Кто стоит заслоном: латные и пехота. Ждут — лёгкие. */
export const SCREEN_KINDS: readonly UnitKind[] = ['heavy', 'infantry'];
/** Шаг толщины заслона в бойцах строя. */
export const SCREEN_STEP = 50;

/** Армия `ARMY_SIZE`: заслон `men` рода `screen`, остальное — лёгкие; в каждом секторе фронта по трети того и другого. */
export function screenArmy(screen: UnitKind, men: number, light: CavalryOrder): ArmySetup {
  const third = (n: number): [number, number, number] => spread(n, [1 / 3, 1 / 3, 1 / 3]);
  const s = third(men);
  const w = third(ARMY_SIZE - men);
  return setupOf(
    { A: { [screen]: s[0], cavalry: w[0] }, B: { [screen]: s[1], cavalry: w[1] }, C: { [screen]: s[2], cavalry: w[2] } },
    { orders: { ...DEFAULT_ORDERS, cavalry: light } },
  );
}

/** Заслон тоньше ждущих — по той же силе, какой бой меряет линию (`sim.stackPower`). */
export const screenThinner = (screen: UnitKind, men: number): boolean =>
  stackPower(stackOf({ [screen]: men })) < stackPower(stackOf({ cavalry: ARMY_SIZE - men }));

/** Толщины заслона шагом `SCREEN_STEP`, при которых он тоньше ждущих: область свойства. */
export function screenPoints(screen: UnitKind): number[] {
  const out: number[] = [];
  for (let men = SCREEN_STEP; screenThinner(screen, men); men += SCREEN_STEP) out.push(men);
  return out;
}

/**
 * Что армия стоит против всей решётки составов: средний геометрический размен (чужие потери
 * к своим), одним зеркальным боем на противника. Геометрический — чтобы один разгром не
 * перевешивал десяток ровных боёв.
 */
export function latticeWorth(setup: ArmySetup, foes: ArmySetup[] = compositionLattice().map((a) => quickSetup(a))): number {
  let log = 0;
  for (const foe of foes) log += Math.log(mirrored(setup, foe, 1).lossRatio);
  return Math.exp(log / foes.length);
}

/**
 * Манёвр лёгкой за заслоном при нынешнем `COVER.K`: по толщинам `screenPoints`. Свойство:
 * при заслоне тоньше ждущих ценность манёвра не падает с толщиной заслона.
 */
export function screenCurve(screen: UnitKind, foes?: ArmySetup[]): Array<{ men: number; worth: number }> {
  return screenPoints(screen).map((men) => ({ men, worth: latticeWorth(screenArmy(screen, men, 'attack-archers'), foes) }));
}

/** Кривая не падает: тоньше заслон — не больше манёвра. */
export const nonDecreasing = (curve: Array<{ worth: number }>): boolean => curve.every((p, i) => i === 0 || curve[i - 1].worth <= p.worth);

/** Сетка `K`, из которой выводится `COVER.K`: наименьшее, при котором кривые обоих заслонов не падают. */
export const COVER_K_GRID: readonly number[] = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1];

/** Прогнать `fn` при другом `COVER.K` и вернуть его на место. */
export function withCoverK<T>(k: number, fn: () => T): T {
  const was = COVER.K;
  COVER.K = k;
  try {
    return fn();
  } finally {
    COVER.K = was;
  }
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
 * `from` — первый сид: перемер на новых сидах не повторяет боёв отбора.
 */
export function gapAgainst(setup: ArmySetup, opponent: (seed: number) => ArmySetup, n: number, from = 1): { gap: number; lost: number; won: number } {
  let own = 0;
  let theirs = 0;
  let lost = 0;
  let won = 0;
  for (let seed = from; seed < from + n; seed += 1) {
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

/**
 * Поиск в два этапа: все `n` расстановок — отбор на `screen` боях, `finalists` лучших —
 * перемер на `final` новых сидах с `finalFrom` (отбор на десяти боях выбирает и удачу: лучший
 * по отбору почти всегда переоценён). `battle:report`, раздел «Случайный поиск расстановок».
 */
export const SEARCH = { seed: 12345, n: 2500, screen: 10, finalists: 20, final: 100, finalFrom: 1001 };

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

/** Все расстановки поиска по порядку: `i`-я — одна и та же на любом прогоне. */
export function searchPool(): ArmySetup[] {
  const rng = seededRng(SEARCH.seed);
  return Array.from({ length: SEARCH.n }, () => randomLayout(BALANCED_ARMY, rng));
}

export interface Finalist {
  /** Номер в поиске (`searchPool`). */
  index: number;
  setup: ArmySetup;
  /** Разрыв на отборе (`SEARCH.screen` боёв). */
  screen: number;
  /** Разрыв на перемере (`SEARCH.final` новых сидов). */
  final: { gap: number; won: number; lost: number };
}

/**
 * Два этапа против `opponent`: отбор всех расстановок поиска, `SEARCH.finalists` лучших —
 * перемер на новых сидах. Возвращает финалистов, лучших по перемеру первыми, и место каждого
 * на отборе (порядок `index` сохранён в `rank`).
 */
export function searchFinal(opponent: (seed: number) => ArmySetup): Array<Finalist & { rank: number }> {
  const screened = searchPool()
    .map((setup, index) => ({ index, setup, screen: gapAgainst(setup, opponent, SEARCH.screen).gap }))
    .sort((x, y) => y.screen - x.screen)
    .slice(0, SEARCH.finalists);
  return screened
    .map((f, rank) => ({ ...f, rank, final: gapAgainst(f.setup, opponent, SEARCH.final, SEARCH.finalFrom) }))
    .sort((x, y) => y.final.gap - x.final.gap);
}

/** Стандартный пресет той же армии: против него ищется контрер. */
export const standardOf = (): ArmySetup => QUICK_PRESETS.standard.layout(stackOf(BALANCED_ARMY));

/**
 * Условия известного контрера — те же, что держит тест: против стандарта больше 40 %, против
 * случайного пресета от 5 % до 25 % и меньше половины того, что против стандарта. Контрер бьёт
 * шаблон, который знает, и не бьёт быструю атаку сильнее настроенной армии.
 */
export const COUNTER_TERMS = { known: 0.4, randomLow: 0.05, randomHigh: 0.25 };
export const counterHolds = (known: number, random: number): boolean =>
  known > COUNTER_TERMS.known && random > COUNTER_TERMS.randomLow && random <= COUNTER_TERMS.randomHigh && random < known / 2;

/**
 * Финалисты поиска против стандарта с тем, выполняют ли они условия контрера (`counterHolds`)
 * на новых сидах: против стандарта — перемер финала, против случайного пресета — `SEARCH.final`
 * боёв с тех же сидов. Известный контрер — первый, кто выполняет; отчёт печатает каждого
 * финалиста с обоими числами и то, какое условие не выполнено.
 */
export function counterSearch(): Array<Finalist & { rank: number; random: number; holds: boolean }> {
  return searchFinal(standardOf).map((f) => {
    const random = gapAgainst(f.setup, quickOf, SEARCH.final, SEARCH.finalFrom).gap;
    return { ...f, random, holds: counterHolds(f.final.gap, random) };
  });
}

/**
 * Известный контрер стандартного пресета: против него одного выигрывает намного больше, но
 * против случайного пресета — не больше настроенной армии (тест «известный контрер»). Смысл
 * пресетов: контрить нечего, пока не знаешь, какой пришёл.
 *
 * **Это пример щупа, а не вывод поиска.** Найден 18.09.2026 тем же генератором с другим
 * порядком бросков; закоммиченный поиск (`counterSearch`, `battle:report`, раздел «Случайный
 * поиск расстановок») расстановки с условиями теста среди своих финалистов не находит, и что
 * именно у них не выполнено, печатает тот раздел. Как быть с тестом — решение владельца
 * (docs/stable.md, раздел 12); до него пример держит свойство, а поиск честно говорит, что его
 * не повторяет.
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
