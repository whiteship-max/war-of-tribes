// Бои `battle:report` для веера (`lib/fan.ts`). Модуль без действий на верхнем уровне: отчёт
// (`battle-report.ts`) раздаёт отсюда задачи дочерним процессам и печатает итоги в своём порядке.
//
// Задача — одно дело из отчёта, названное доводом, а не переданное армией: дочерний процесс строит
// расстановки сам из тех же таблиц (`bench.ts`), и по проводу ходят номера и числа. Итог задачи —
// ровно то, что отчёт прежде считал у себя тем же кодом; сложения, порядок которых влияет на
// последний знак, остаются внутри задачи целиком (`latticeWorth`, `gapAgainst`, `holdPoint`).
//
// Подмены чисел ядра — варианты раздела «Тяжёлая» и `COVER.K` раздела «Заслон» — ставит и снимает
// сама задача, в том процессе, который её считает, — у веера это дочерний процесс, и в процессе отчёта
// подмен нет (кроме `TRIBE_FAN=1`, когда задачи идут в нём же подряд). Снять подмену обязательно и
// здесь: процесс берёт задачи одну за другой, и следующая обязана начаться на числах конфига.
import { COUNTER, COVER, PLANS, QUICK_PRESETS, QUICK_PRESET_IDS, TEMPER, UNIT_KINDS, UNIT_STATS, armyTotal, quickSetup, simulateBattle, stackOf, type ArmySetup, type BattleResult, type CavalryOrder, type Plan, type QuickPresetId, type Stack, type UnitKind } from '../src/battle';
import { stackPower } from '../src/battle/sim';
import { ARMY_SIZE, BALANCED_ARMY, COMPOSITIONS, KNOWN_COUNTER, OVERSIZE_SEEDS, RING, SEARCH, TUNED, compositionLattice, diceStepFor, gapAgainst, holdPoint, latticeDuel, latticeWorth, layoutGrid, layoutOf, mirrorOf, mirrored, oversize, oversizeHold, quickOf, screenArmy, searchPool, standardOf, withCoverK, withDiceStep, type Mirrored } from '../src/battle/bench';
import { fan, serveFan } from './lib/fan';

// ---------- Что возвращается ----------

/** Бой для раздела «Длительность»: только то, что тот раздел читает. */
export interface Brief {
  ticks: number;
  reason: BattleResult['reason'];
  /** Кончился раньше гонга: сторона сломалась, а не дождалась потолка кругов сечи. */
  early: boolean;
}

/** Гонг — потолок кругов сечи (`roundsCap`): бой дошёл до него, не сломав никого (событие `rounds-out`). */
const brief = (r: BattleResult): Brief => ({ ticks: r.ticks, reason: r.reason, early: !r.log.some((e) => e.id === 'rounds-out') });

/** Зеркальная пара без журналов: итог `mirrorOf` и её бои для «Длительности». */
export type Pair = Pick<Mirrored, 'field' | 'lossRatio' | 'pyrrhic'> & { results: [Brief, Brief] };
const pairOf = (m: Mirrored): Pair => ({ field: m.field, lossRatio: m.lossRatio, pyrrhic: m.pyrrhic, results: [brief(m.results[0]), brief(m.results[1])] });

// ---------- Кто стоит на поле ----------

/** Наборы, у которых отчёт гоняет матрицу «каждый против каждого». */
export type MatrixSet = 'compositions' | 'plans' | 'presets' | 'pure';

const matrixSetups = (set: MatrixSet): ArmySetup[] => {
  if (set === 'compositions') return COMPOSITIONS.map((c) => c.setup);
  if (set === 'plans') return (Object.keys(PLANS) as Plan[]).map((plan) => quickSetup(BALANCED_ARMY, { plan }));
  if (set === 'presets') return QUICK_PRESET_IDS.map((id) => QUICK_PRESETS[id].layout(stackOf(BALANCED_ARMY)));
  return UNIT_KINDS.map((k) => quickSetup({ [k]: ARMY_SIZE }));
};

let grid: ArmySetup[] | null = null;
/** Расстановки перебора в порядке `layoutGrid`. */
const gridSetups = (): ArmySetup[] => (grid ??= layoutGrid().map((spec) => layoutOf(BALANCED_ARMY, spec)));

let pool: ArmySetup[] | null = null;
const poolSetups = (): ArmySetup[] => (pool ??= searchPool());

let presets: ArmySetup[] | null = null;
const presetSetups = (): ArmySetup[] => (presets ??= matrixSetups('presets'));

let foes: ArmySetup[] | null = null;
/** Противники заслона — вся решётка составов стандартным пресетом (`latticeWorth`). */
const latticeFoes = (): ArmySetup[] => (foes ??= compositionLattice().map((a) => quickSetup(a)));

/** Чья расстановка: из перебора, из поиска или именованная. */
export type Who = { grid: number } | { pool: number } | 'TUNED' | 'KNOWN_COUNTER';
const setupOf = (who: Who): ArmySetup => {
  if (who === 'TUNED') return TUNED;
  if (who === 'KNOWN_COUNTER') return KNOWN_COUNTER;
  return 'grid' in who ? gridSetups()[who.grid] : poolSetups()[who.pool];
};

/** Против кого: быстрая атака (пресет по сиду), стандартный пресет или названный пресет. */
export type Opponent = 'quick' | 'standard' | { preset: QuickPresetId };
const opponentOf = (o: Opponent): ((seed: number) => ArmySetup) => {
  if (o === 'quick') return quickOf;
  if (o === 'standard') return standardOf;
  return () => QUICK_PRESETS[o.preset].layout(stackOf(BALANCED_ARMY));
};

// ---------- Варианты раздела «Тяжёлая» ----------

/**
 * Каждое число тяжёлой по очереди ставится на то, что стоит на той же оси у пехоты или у лёгкой,
 * и решётка перемеряется целиком. `set` ставит подмену и возвращает её снятие.
 */
interface Variant {
  name: string;
  set: () => () => void;
  layout?: (a: Partial<Stack>) => ArmySetup;
}

const heavyFront = (army: Partial<Stack>): ArmySetup => {
  const s = quickSetup(army);
  const r = s.sectors.R.heavy;
  if (r > 0) {
    s.sectors.R.heavy = 0;
    const l = Math.floor(r * 0.3);
    const c = Math.floor(r * 0.3);
    s.sectors.A.heavy += l;
    s.sectors.B.heavy += r - l - c;
    s.sectors.C.heavy += c;
  }
  return s;
};
// Резерв по той же мерке, что заслон: пресет держит в резерве не больше, чем прикрывает линия
// (`линия / COVER.K` силы, `stackPower`), остальное — во фронт. Это не правило боя, а расстановка
// перед ним: в бою резерв по-прежнему недосягаем, пока не введён, сколько бы его ни было.
const reserveCovered = (army: Partial<Stack>): ArmySetup => {
  const s = quickSetup(army);
  const line = stackPower(armyTotal({ ...s, sectors: { ...s.sectors, R: stackOf({}) } }));
  const held = stackPower(s.sectors.R);
  if (held <= 0 || held <= line / COVER.K) return s;
  const share = 1 - line / COVER.K / held;
  for (const k of UNIT_KINDS) {
    const out = Math.round(s.sectors.R[k] * share);
    if (out <= 0) continue;
    s.sectors.R[k] -= out;
    const l = Math.floor(out * 0.3);
    const c = Math.floor(out * 0.3);
    s.sectors.A[k] += l;
    s.sectors.B[k] += out - l - c;
    s.sectors.C[k] += c;
  }
  return s;
};

const H = UNIT_STATS.heavy as unknown as Record<string, number>;
const HC = COUNTER.heavy as unknown as Record<string, number>;
const HT = TEMPER.heavy as unknown as Record<string, number>;

/**
 * Подменить числа на время задачи: откат возвращает то, что стояло до подмены, а не записанное рядом
 * число. Прежде откат писал число руками, и после решения 4А (`TEMPER.heavy.stalled` 1.0 → 1.3) вариант
 * «остановленная» вернул бы 1.0 — и все следующие задачи того же процесса шли бы на чужом конфиге.
 */
const swap =
  (...edits: Array<[Record<string, number>, string, number]>) =>
  (): (() => void) => {
    const was = edits.map(([obj, key]) => obj[key]);
    for (const [obj, key, value] of edits) obj[key] = value;
    return () => edits.forEach(([obj, key], i) => (obj[key] = was[i]));
  };

/** Первый — «как есть»: числа конфига, стандартный пресет; это и есть решётка раздела «Решётка составов». */
const VARIANTS: Variant[] = [
  { name: 'как есть', set: () => () => {} },
  { name: 'рукопашная 1.3 → 1.0 (лёгкая)', set: swap([H, 'melee', 1.0]) },
  { name: 'по пехоте ×1.3 → ×1.0 (лёгкая)', set: swap([HC, 'infantry', 1.0]) },
  { name: 'рукопашная и по пехоте → 1.0', set: swap([H, 'melee', 1.0], [HC, 'infantry', 1.0]) },
  { name: 'мораль 65 → 56 (пехота)', set: swap([H, 'morale', 56]) },
  { name: 'стойкость 1.1 → 0.8 (лёгкая)', set: swap([H, 'toughness', 0.8]) },
  // Слабая фаза латной — сеча (решение 4А): вариант показывает, что было бы без неё.
  { name: 'остановленная 1.3 → 1.0 (пехота)', set: swap([HT, 'stalled', 1.0]) },
  { name: 'на разгоне 0.6 → 1.0 (пехота)', set: swap([HT, 'charging', 1.0]) },
  { name: 'скорость 2 → 1 (копья)', set: swap([H, 'speed', 1]) },
  { name: 'числа те же, пресет ставит её во фронт', set: () => () => {}, layout: heavyFront },
  { name: 'числа те же, резерв не больше прикрытого', set: () => () => {}, layout: reserveCovered },
  { name: 'рукопашная 1.0 и резерв не больше прикрытого', set: swap([H, 'melee', 1.0]), layout: reserveCovered },
];
export const VARIANT_NAMES: readonly string[] = VARIANTS.map((v) => v.name);

/** Подмена ставится на время задачи и снимается при любом исходе. */
function under<T>(variant: number, fn: (layout: (a: Partial<Stack>) => ArmySetup) => T): T {
  const v = VARIANTS[variant];
  const undo = v.set();
  try {
    return fn(v.layout ?? ((a) => quickSetup(a)));
  } finally {
    undo();
  }
}

// ---------- Задачи ----------

export type Job =
  /** Пара матрицы i–j (i < j): бои сидов 1..seeds и те же бои глазами j. */
  | { kind: 'pair'; set: MatrixSet; i: number; j: number; seeds: number }
  /** Пара кольца контрров, сиды 1..seeds. */
  | { kind: 'ring'; ring: number; seeds: number }
  /** Строки решётки `from..to` при варианте «Тяжёлой»: размен (`mirrored`, сид 1) с каждым j > i по порядку. */
  | { kind: 'lattice'; variant: number; from: number; to: number }
  /** Что заслон стоит против решётки (`latticeWorth`); `k` — `COVER.K` на время задачи, `null` — как в конфиге. */
  | { kind: 'worth'; screen: UnitKind; men: number; order: CavalryOrder; k: number | null }
  /** Разрыв против противника (`gapAgainst`). */
  | { kind: 'gap'; who: Who; opp: Opponent; n: number; from: number }
  /** Отбор перебора `from..to`: против каждого пресета по бою с обеих сторон поля. */
  | { kind: 'grid'; from: number; to: number }
  /** Отбор поиска `from..to` (`SEARCH.screen` боёв). */
  | { kind: 'pool'; opp: Opponent; from: number; to: number }
  /** Лучшая расстановка перебора против перебора `from..to`, бой с сидом i + 1. */
  | { kind: 'vsGrid'; best: number; from: number; to: number }
  /** Точка поля (`holdPoint`, 40 боёв на шаг). */
  | { kind: 'hold'; who: Who | 'quick' }
  /**
   * Ограничитель: состав с перевесом 10 % против себя (`bench.oversize`) в `total` бойцов строя. `bare` — бой без
   * ширины (`width: Infinity`; в задачу веера бесконечность не пролезает — JSON пишет её как null), иначе — по
   * выключателю.
   */
  | { kind: 'oversize'; composition: number; total: number; bare?: boolean }
  /** Кость: шаг, выведенный делением отрезка (`bench.diceStepFor`), и поле большей без кости. */
  | { kind: 'dice' };

export type Out =
  | { kind: 'pair'; ab: Pair[]; ba: Pair[] }
  | { kind: 'ring'; pairs: Pair[] }
  | { kind: 'lattice'; ratios: number[] }
  | { kind: 'worth'; worth: number }
  | { kind: 'gap'; gap: { gap: number; lost: number; won: number } }
  | { kind: 'grid'; rows: Array<{ gap: number; held: number }> }
  | { kind: 'pool'; gaps: number[] }
  | { kind: 'vsGrid'; rows: Array<{ held: boolean; own: number; theirs: number } | null> }
  | { kind: 'hold'; point: number }
  | { kind: 'oversize'; bigLoss: number; smallLoss: number; wins: number; draws: number; gong: number }
  | { kind: 'dice'; derived: number; bare: number };

export function battleJob(job: Job): Out {
  switch (job.kind) {
    case 'pair': {
      const s = matrixSetups(job.set);
      const ms = Array.from({ length: job.seeds }, (_, n) => mirrored(s[job.i], s[job.j], n + 1));
      // Пара j–i — те же два боя в обратном порядке, а не два новых.
      return { kind: 'pair', ab: ms.map(pairOf), ba: ms.map((m) => pairOf(mirrorOf(m.results[1], m.results[0]))) };
    }
    case 'ring': {
      const { a, b } = RING[job.ring];
      return { kind: 'ring', pairs: Array.from({ length: job.seeds }, (_, n) => pairOf(mirrored(a, b, n + 1))) };
    }
    case 'lattice':
      return under(job.variant, (layout) => {
        const setups = compositionLattice().map(layout);
        const ratios: number[] = [];
        for (let i = job.from; i < job.to; i += 1) for (let j = i + 1; j < setups.length; j += 1) ratios.push(latticeDuel(setups, i, j));
        return { kind: 'lattice', ratios };
      });
    case 'worth': {
      const against = latticeFoes();
      const worth = (): number => latticeWorth(screenArmy(job.screen, job.men, job.order), against);
      return { kind: 'worth', worth: job.k === null ? worth() : withCoverK(job.k, worth) };
    }
    case 'gap':
      return { kind: 'gap', gap: gapAgainst(setupOf(job.who), opponentOf(job.opp), job.n, job.from) };
    case 'grid': {
      const all = gridSetups();
      const foes = presetSetups();
      const rows: Array<{ gap: number; held: number }> = [];
      for (let g = job.from; g < job.to; g += 1) {
        let own = 0;
        let theirs = 0;
        let held = 0;
        foes.forEach((foe, i) => {
          for (const attacks of [true, false]) {
            const seed = i * 2 + (attacks ? 1 : 2);
            const r = simulateBattle({ seed, attacker: attacks ? all[g] : foe, defender: attacks ? foe : all[g] });
            const me = attacks ? 'attacker' : 'defender';
            own += r.sides[me].total.losses;
            theirs += r.sides[attacks ? 'defender' : 'attacker'].total.losses;
            if (r.winner === me) held += 1;
          }
        });
        rows.push({ gap: theirs / Math.max(1, own) - 1, held });
      }
      return { kind: 'grid', rows };
    }
    case 'pool': {
      const all = poolSetups();
      const opp = opponentOf(job.opp);
      const gaps: number[] = [];
      for (let i = job.from; i < job.to; i += 1) gaps.push(gapAgainst(all[i], opp, SEARCH.screen).gap);
      return { kind: 'pool', gaps };
    }
    case 'vsGrid': {
      const all = gridSetups();
      const best = all[job.best];
      const rows: Array<{ held: boolean; own: number; theirs: number } | null> = [];
      for (let i = job.from; i < job.to; i += 1) {
        if (i === job.best) {
          rows.push(null);
          continue;
        }
        const attacks = i % 2 === 0;
        const r = simulateBattle({ seed: i + 1, attacker: attacks ? best : all[i], defender: attacks ? all[i] : best });
        const me = attacks ? 'attacker' : 'defender';
        rows.push({ held: r.winner === me, own: r.sides[me].total.losses, theirs: r.sides[attacks ? 'defender' : 'attacker'].total.losses });
      }
      return { kind: 'vsGrid', rows };
    }
    case 'hold': {
      const setup = job.who === 'quick' ? (seed: number) => quickOf(seed * 7 + 3) : ((s) => () => s)(setupOf(job.who));
      return { kind: 'hold', point: holdPoint(setup, 40) };
    }
    case 'oversize':
      return { kind: 'oversize', ...oversize(job.composition, OVERSIZE_SEEDS, job.total, job.bare ? Infinity : undefined) };
    case 'dice':
      // Кость ставится и снимается внутри `diceStepFor` и `withDiceStep`: следующая задача процесса
      // начинается на числе конфига.
      return { kind: 'dice', derived: diceStepFor(), bare: withDiceStep(0, () => oversizeHold()) };
  }
}

/** Раздать задачи веером; итоги — в порядке задач. */
export const runJobs = (jobs: readonly Job[]): Promise<Out[]> => fan(battleJob, import.meta.url, jobs);

serveFan(import.meta.url, { battleJob });
