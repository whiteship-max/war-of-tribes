// Наборы для балансных проверок: составы, пары кольца, ограничитель и кость. Их читают и тесты
// (раздел 16 документа), и скрипт отчёта — чтобы таблица в отчёте и утверждения в тестах считались
// по одним данным. Расстановку наборы не выбирают: каждый состав встаёт по правилу развёртывания
// (`setup.deploySetup`), потому что раскладки у удара больше нет (docs/battle_eu4.md, 14.5).
import { simulateBattle } from './sim';
import { DICE, FRONT_WIDTH, MORALE } from './config';
import { seededRng } from './rng';
import { deploySetup, emptySectors, stackOf, stackTotal } from './setup';
import { KIND_META } from './names';
import { FRONT, UNIT_KINDS, type ArmySetup, type BattleResult, type Side, type Stack, type UnitKind } from './types';

/** Одинаковая численность: «при прочих равных» — это про число людей. */
export const ARMY_SIZE = 600;

export interface Composition {
  name: string;
  army: Partial<Stack>;
  setup: ArmySetup;
}

const comp = (name: string, army: Partial<Stack>): Composition => ({ name, army, setup: deploySetup(army) });

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
  // Масса лёгкой с малой тяжёлой. Строка появилась, когда лёгкая ждала удара по лучникам за заслоном
  // тяжёлой (заслона больше нет — он жил приказами), и остаётся составом: имя сохранено, чтобы ряды
  // отчёта сравнивались с прежними.
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

// ---------- Ограничитель и кость ----------
//
// Одна строка «Ограничителя» — состав с перевесом 10 % против себя. Из тех же боёв считается и
// кость: сколько из них большая сторона удержала поле. До кости — все (30 из 30 у каждого из
// тринадцати составов), и бой был арифметикой с известным исходом; величина кости выводится так,
// чтобы большая удерживала поле в доле, которую назвал владелец (`DICE.hold`).

/** Боёв на состав: сиды 1..N, нечётный — нападает большая, чётный — меньшая. */
export const OVERSIZE_SEEDS = 30;

/** Состав в `total` бойцов строя: те же доли родов, что у состава в `ARMY_SIZE`. */
export const scaleArmy = (army: Partial<Stack>, total: number): Partial<Stack> =>
  Object.fromEntries(Object.entries(army).map(([k, n]) => [k, Math.round(((n ?? 0) * total) / ARMY_SIZE)])) as Partial<Stack>;

/** Фронт полосы расстановки: первая линия (A, B, C) на число полос. */
export const laneFront = (setup: ArmySetup): number => FRONT.reduce((n, s) => n + stackTotal(setup.sectors[s]), 0) / FRONT.length;

/**
 * Фронт полосы, какой правило развёртывания поставило бы без ширины: всё, что правило ставит в первую
 * линию (пешие и конница), на три полосы. Без ширины — потому что с ней правило кладёт в ряд не больше
 * W, и мерка, выведенная через W, проверяла бы сама себя.
 */
export const openFront = (army: Partial<Stack>): number => {
  const a = stackOf(army);
  return (stackTotal(a) - a.archer) / FRONT.length;
};

/**
 * Состав `COMPOSITIONS[composition]` в `total` бойцов на 10 % больше против себя самого. `width` — ширина
 * фронта боя (`BattleInput.width`); нет — ширина по выключателю. `draws` — сколько ничьих, `gong` — сколько
 * боёв дошло до потолка кругов сечи, никого не сломав (ничья бывает только там).
 */
export function oversize(composition: number, seeds = OVERSIZE_SEEDS, total = ARMY_SIZE, width?: number): { bigLoss: number; smallLoss: number; wins: number; draws: number; gong: number } {
  const c = COMPOSITIONS[composition];
  const army = scaleArmy(c.army, total);
  const small = deploySetup(army, width ?? FRONT_WIDTH);
  const bigger = deploySetup(Object.fromEntries(Object.entries(army).map(([k, n]) => [k, Math.round((n ?? 0) * 1.1)])), width ?? FRONT_WIDTH);
  let bigLoss = 0;
  let smallLoss = 0;
  let wins = 0;
  let draws = 0;
  let gong = 0;
  for (let seed = 1; seed <= seeds; seed += 1) {
    const bigAttacks = seed % 2 === 1;
    const r = simulateBattle({ seed, attacker: bigAttacks ? bigger : small, defender: bigAttacks ? small : bigger, ...(width === undefined ? {} : { width }) });
    bigLoss += r.sides[bigAttacks ? 'attacker' : 'defender'].total.losses;
    smallLoss += r.sides[bigAttacks ? 'defender' : 'attacker'].total.losses;
    if (r.winner === (bigAttacks ? 'attacker' : 'defender')) wins += 1;
    if (r.winner === 'draw') draws += 1;
    // Гонг — потолок кругов сечи (`roundsCap`): бой дошёл до него, никого не сломав.
    if (r.log.some((e) => e.id === 'rounds-out')) gong += 1;
  }
  return { bigLoss, smallLoss, wins, draws, gong };
}

/**
 * Где держится доля владельца: на размере W (`ARMY_AT_W`, решение 2 пачки 2). Выключателя ширины больше нет:
 * с автоматическим резервом режим у боя один (docs/battle_eu4.md, 14.5).
 */
export const holdSize = (): number => ARMY_AT_W;

/** Доля боёв «Ограничителя» в `total` бойцов, где большая сторона удержала поле, — по всем составам разом. */
export function oversizeHold(seeds = OVERSIZE_SEEDS, total = holdSize()): number {
  let wins = 0;
  for (let i = 0; i < COMPOSITIONS.length; i += 1) wins += oversize(i, seeds, total).wins;
  return wins / (COMPOSITIONS.length * seeds);
}

/** Прогнать `fn` при другой величине кости и вернуть её на место. */
export function withDiceStep<T>(step: number, fn: () => T): T {
  const was = DICE.step;
  DICE.step = step;
  try {
    return fn();
  } finally {
    DICE.step = was;
  }
}

/**
 * Прогнать `fn` при темпе потери морали от потерь людьми (`MORALE.perLoss`) в `k` раз выше и вернуть его на место.
 * Проба разбора «исхода на лезвии» (слово владельца 27.09.2026), а не число модели: сдвигается ли лезвие в склон,
 * если мораль падает быстрее тел. `battle:report`, раздел «Лезвие».
 */
export function withMoralePace<T>(k: number, fn: () => T): T {
  const was = MORALE.perLoss;
  MORALE.perLoss = was * k;
  try {
    return fn();
  } finally {
    MORALE.perLoss = was;
  }
}

/**
 * Стояние (docs/battle_eu4.md, 14.25): круг со второго, в котором ни одна сторона не потеряла ни человека, пока никто не
 * сломан. В круге линии сходятся заново, и кто до кого-то дотягивается, тот бьёт; ноль потерь за круг — никто ни с кем
 * не дерётся, и дальше в бою не меняется ничего: он стоит до потолка кругов. Итог — первый такой круг (`circle`, нет —
 * `null`) и сколько кругов, где никто не сломан, проверено (`checked`): граница области для тестов — только в этих
 * кругах стояние и возможно. Один счёт на тест и на отчёт (`battle:report`, «Стояние на решётке составов»).
 */
export function standstill(r: BattleResult): { circle: number | null; checked: number } {
  const rounds = r.log.filter((e) => e.id === 'round').length;
  let checked = 0;
  for (let k = 2; k <= rounds + 1; k += 1) {
    const span = r.phases.filter((p) => p.round === k);
    if (span.length === 0) break;
    const end = span[span.length - 1].to;
    if ((['attacker', 'defender'] as const).some((side) => (r.sides[side].brokenAt ?? Infinity) <= end)) break;
    checked += 1;
    if (span.reduce((n, p) => n + p.losses.attacker + p.losses.defender, 0) <= 0) return { circle: k, checked };
  }
  return { circle: null, checked };
}

/** Перевесы кривой «перевес → поле» (раздел «Лезвие»): большая армия того же состава из меньшей в `total`. */
export const EDGE_STEPS: ReadonlyArray<{ name: string; bigger: (total: number) => number }> = [
  { name: '+1 чел.', bigger: (t) => t + 1 },
  { name: '+1 %', bigger: (t) => Math.round(t * 1.01) },
  { name: '+5 %', bigger: (t) => Math.round(t * 1.05) },
  { name: '+10 %', bigger: (t) => Math.round(t * 1.1) },
];

/**
 * Бои кривой: составы решётки `from..to` в `total` против себя же больших на ступень `EDGE_STEPS[step]`, большая —
 * по очереди с обеих сторон поля, сиды 1..`seeds`. Итог — бой и сторона большей.
 */
export function edgeBattles(step: number, from: number, to: number, seeds: number, total = holdSize()): Array<{ r: BattleResult; big: Side }> {
  const lattice = compositionLattice();
  const out: Array<{ r: BattleResult; big: Side }> = [];
  for (let i = from; i < to; i += 1) {
    const small = deploySetup(scaleArmy(lattice[i], total));
    const big = deploySetup(scaleArmy(lattice[i], EDGE_STEPS[step].bigger(total)));
    for (let seed = 1; seed <= seeds; seed += 1) {
      out.push({ r: simulateBattle({ seed, attacker: big, defender: small }), big: 'attacker' });
      out.push({ r: simulateBattle({ seed, attacker: small, defender: big }), big: 'defender' });
    }
  }
  return out;
}

/**
 * Наименьшая величина кости, при которой большая на 10 % удерживает поле не чаще `hold`: делением
 * отрезка. Доля убывает с величиной кости — чем сильнее удача, тем чаще меньшая устоит. Отрезок
 * `hi` взят с запасом: при нём удача разбрасывает урон фазы на ±45 %, дальше кость решала бы всё.
 * Меряется там, где держится доля владельца (`holdSize`): на размере W.
 */
export function diceStepFor(hold = DICE.hold, hi = 0.1, steps = 12, total = holdSize()): number {
  let lo = 0;
  for (let i = 0; i < steps; i += 1) {
    const mid = (lo + hi) / 2;
    if (withDiceStep(mid, () => oversizeHold(OVERSIZE_SEEDS, total)) > hold) lo = mid;
    else hi = mid;
  }
  return hi;
}

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
  return mirrorOf(simulateBattle({ seed, attacker: a, defender: b }), simulateBattle({ seed, attacker: b, defender: a }));
}

/**
 * Итог пары из двух уже сыгранных боёв: `r1` — a нападает, `r2` — b нападает. Пара b–a — те же
 * два боя в обратном порядке, `mirrorOf(r2, r1)`: считать её второй раз незачем.
 */
export function mirrorOf(r1: BattleResult, r2: BattleResult): Mirrored {
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

/** Расстановка вручную: только указанные сектора. Так стоит раскладка обороны игрока до поставки 2 — и тесты, которым нужна своя. */
export function setupOf(sectors: Partial<Record<keyof ArmySetup['sectors'], Partial<Stack>>>, over: Partial<ArmySetup> = {}): ArmySetup {
  const full = emptySectors();
  for (const [id, stack] of Object.entries(sectors)) full[id as keyof typeof full] = stackOf(stack ?? {});
  return { ...over, sectors: full };
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
 * `layout` — как состав встаёт в поле, по умолчанию — правило развёртывания.
 */
export function latticeDuels(armies: Array<Partial<Stack>> = compositionLattice(), layout: (army: Partial<Stack>) => ArmySetup = (a) => deploySetup(a)): LatticeRow[] {
  const setups = armies.map(layout);
  return latticeRows(armies, (i, j) => latticeDuel(setups, i, j));
}

/** Бой решётки i–j (i < j): размен i одним зеркальным боем, сид 1. */
export const latticeDuel = (setups: readonly ArmySetup[], i: number, j: number): number => mirrored(setups[i], setups[j], 1).lossRatio;

/**
 * Строки решётки из разменов пар i < j (`latticeDuel`): кто кого бьёт, в порядке обхода пар.
 * Размен может прийти откуда угодно — из боя здесь же или из задачи веера (`battle:report`).
 */
export function latticeRows(armies: ReadonlyArray<Partial<Stack>>, ratio: (i: number, j: number) => number): LatticeRow[] {
  const rows: LatticeRow[] = armies.map((army) => ({ army, beats: [], lostTo: [] }));
  for (let i = 0; i < armies.length; i += 1) {
    for (let j = i + 1; j < armies.length; j += 1) {
      const r = ratio(i, j);
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

/** Кольцо: каждая пара встаёт по правилу развёртывания, `a` должен побеждать. Приказов нет — кольцо держит род. */
export const RING: Array<{ name: string; a: ArmySetup; b: ArmySetup }> = [
  { name: 'копья бьют конницу', a: deploySetup({ spear: ARMY_SIZE }), b: deploySetup({ cavalry: ARMY_SIZE }) },
  { name: 'конница бьёт лучников', a: deploySetup({ cavalry: ARMY_SIZE }), b: deploySetup({ archer: ARMY_SIZE }) },
  { name: 'лучники бьют копья', a: deploySetup({ archer: ARMY_SIZE }), b: deploySetup({ spear: ARMY_SIZE }) },
];

/**
 * Пороги кольца (тест «кольцо контрров», `battle.test.ts`): на каждом из сидов `1…seeds` контрящий выигрывает размен не
 * ниже `RATIO_EVEN`, а в среднем по ним — больше `mean`. Одни числа на тест и на строку отчёта (`battle:report`, «Кольцо
 * контрров»): отчёт печатает средний размен по своим сидам, и без порогов рядом его сравнивали не с тем порогом.
 */
export const RING_BAR = { seeds: 12, mean: 1.5 } as const;

/** Сбалансированный состав: мерка размера W (`ARMY_AT_W`) и противник поиска составов. */
export const BALANCED_ARMY: Partial<Stack> = { spear: 150, infantry: 200, archer: 150, cavalry: 100 };

/**
 * Размер боя, на котором ширина ровно заполнена (docs/battle_eu4.md, раздел 8.1, решение 2; 14.5, «Перемер»):
 * численность армии, при которой сбалансированный состав по правилу развёртывания ставит в полосу ровно
 * `FRONT_WIDTH` — медианный бой игры, по которому ширина и выведена. Выведено из правила, а не выбрано:
 * фронт полосы без ширины (`openFront`) растёт с армией линейно, и W он достигает при этой численности.
 */
export const ARMY_AT_W = Math.round((ARMY_SIZE * FRONT_WIDTH) / openFront(BALANCED_ARMY));

/**
 * Три размера ограничителя: ниже ширины, на ней и вдвое выше. Доля владельца (80 %) держится на
 * среднем, когда ширина включена (`holdSize`); вдвое больший — точка теста «заполненная ширина
 * зажимает» (`battle.test.ts`). Печатать все три будет `battle:report` (docs/battle_eu4.md, раздел 8.5, пункт 5).
 */
export const OVERSIZE_SIZES: readonly number[] = [Math.round(ARMY_AT_W / 2), ARMY_AT_W, 2 * ARMY_AT_W];

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

// ---------- Случайный поиск составов ----------
//
// Машинка двухэтапного поиска пережила расстановку: расстановку выбирать больше некому, и поиск
// наведён на составы (docs/battle_eu4.md, 14.5). Он берёт составы наугад из сеяного генератора — в
// тех же `ARMY_SIZE` бойцах строя, каждый встаёт по правилу развёртывания — и отбирает лучших против
// заданного противника. Решётка видит составы шагом `LATTICE_STEP`; всё, что между её узлами, видит
// только поиск. Сид закреплён: одни и те же составы на каждом прогоне.

/**
 * Поиск в два этапа: все `n` составов — отбор на `screen` боях, `finalists` лучших — перемер на `final`
 * новых сидах с `finalFrom` (отбор на десяти боях выбирает и удачу: лучший по отбору почти всегда
 * переоценён). `battle:report`, раздел «Случайный поиск составов».
 */
export const SEARCH = { seed: 12345, n: 2500, screen: 10, finalists: 20, final: 100, finalFrom: 1001 };

/** Один состав наугад в `total` бойцов строя: доли родов из сеяного генератора, сумма ровно `total`. */
export function randomArmy(rng: () => number, total = ARMY_SIZE): Stack {
  const w = UNIT_KINDS.map(() => rng() ** 2);
  const sum = w.reduce((n, x) => n + x, 0);
  const out = stackOf({});
  UNIT_KINDS.forEach((k, i) => (out[k] = Math.floor((total * w[i]) / sum)));
  out[UNIT_KINDS[w.indexOf(Math.max(...w))]] += total - stackTotal(out);
  return out;
}

/** Все составы поиска по порядку, вставшие по правилу: `i`-й — один и тот же на любом прогоне. */
export function searchPool(): ArmySetup[] {
  const rng = seededRng(SEARCH.seed);
  return Array.from({ length: SEARCH.n }, () => deploySetup(randomArmy(rng)));
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
 * Два этапа против `opponent`: отбор всех составов поиска, `SEARCH.finalists` лучших —
 * перемер на новых сидах. Возвращает финалистов, лучших по перемеру первыми, и место каждого
 * на отборе (порядок `index` сохранён в `rank`).
 */
export function searchFinal(opponent: (seed: number) => ArmySetup): Array<Finalist & { rank: number }> {
  const pool = searchPool();
  const shortlist = searchShortlist(
    pool.map((setup) => gapAgainst(setup, opponent, SEARCH.screen).gap),
    pool,
  );
  return searchFinish(shortlist, shortlist.map((f) => gapAgainst(f.setup, opponent, SEARCH.final, SEARCH.finalFrom)));
}

/** Первый этап: разрыв на отборе у каждого состава поиска (`screens[i]` — у `pool[i]`), `SEARCH.finalists` лучших. */
export function searchShortlist(screens: readonly number[], pool: readonly ArmySetup[] = searchPool()): Array<Omit<Finalist, 'final'> & { rank: number }> {
  return pool
    .map((setup, index) => ({ index, setup, screen: screens[index] }))
    .sort((x, y) => y.screen - x.screen)
    .slice(0, SEARCH.finalists)
    .map((f, rank) => ({ ...f, rank }));
}

/** Второй этап: перемер (`finals[k]` — у `shortlist[k]`), лучшие по перемеру первыми. */
export function searchFinish(shortlist: ReadonlyArray<Omit<Finalist, 'final'> & { rank: number }>, finals: ReadonlyArray<Finalist['final']>): Array<Finalist & { rank: number }> {
  return shortlist.map((f, k) => ({ ...f, final: finals[k] })).sort((x, y) => y.final.gap - x.final.gap);
}
