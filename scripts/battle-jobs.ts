// Бои `battle:report` для веера (`lib/fan.ts`). Модуль без действий на верхнем уровне: отчёт
// (`battle-report.ts`) раздаёт отсюда задачи дочерним процессам и печатает итоги в своём порядке.
//
// Задача — одно дело из отчёта, названное доводом, а не переданное армией: дочерний процесс строит
// расстановки сам из тех же таблиц (`bench.ts`), и по проводу ходят номера и числа. Итог задачи —
// ровно то, что отчёт прежде считал у себя тем же кодом; сложения, порядок которых влияет на
// последний знак, остаются внутри задачи целиком (`gapAgainst`).
//
// Подмены чисел ядра — варианты раздела «Тяжёлая» — ставит и снимает сама задача, в том процессе,
// который её считает, — у веера это дочерний процесс, и в процессе отчёта подмен нет (кроме
// `TRIBE_FAN=1`, когда задачи идут в нём же подряд). Снять подмену обязательно и здесь: процесс берёт
// задачи одну за другой, и следующая обязана начаться на числах конфига.
//
// Все стороны встают по правилу развёртывания (`setup.deploySetup`): раскладки, плана, приказов,
// пресетов и быстрой атаки у боя больше нет (docs/battle_eu4.md, 14.5), и задач о них — тоже.
import { COUNTER, TEMPER, UNIT_KINDS, UNIT_STATS, deploySetup, simulateBattle, type ArmySetup, type BattleResult } from '../src/battle';
import { ARMY_SIZE, BALANCED_ARMY, COMPOSITIONS, OVERSIZE_SEEDS, RING, SEARCH, compositionLattice, diceStepFor, gapAgainst, latticeDuel, mirrorOf, mirrored, oversize, oversizeHold, scaleArmy, searchPool, withDiceStep, type Mirrored } from '../src/battle/bench';
import { buildCast } from '../src/battle/replay';
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
export type MatrixSet = 'compositions' | 'pure';

const matrixSetups = (set: MatrixSet): ArmySetup[] => {
  if (set === 'compositions') return COMPOSITIONS.map((c) => c.setup);
  return UNIT_KINDS.map((k) => deploySetup({ [k]: ARMY_SIZE }));
};

let pool: ArmySetup[] | null = null;
const poolSetups = (): ArmySetup[] => (pool ??= searchPool());

/** Против кого ищет поиск: сбалансированный состав по правилу развёртывания. */
const balanced = (): ArmySetup => deploySetup(BALANCED_ARMY);

// ---------- Варианты раздела «Тяжёлая» ----------

/**
 * Каждое число тяжёлой по очереди ставится на то, что стоит на той же оси у пехоты или у лёгкой,
 * и решётка перемеряется целиком. `set` ставит подмену и возвращает её снятие. Вариантов раскладки
 * («пресет ставит её во фронт», «резерв не больше прикрытого») больше нет: раскладку решает правило.
 */
interface Variant {
  name: string;
  set: () => () => void;
}

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

/** Первый — «как есть»: числа конфига; это и есть решётка раздела «Решётка составов». */
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
];
export const VARIANT_NAMES: readonly string[] = VARIANTS.map((v) => v.name);

/** Подмена ставится на время задачи и снимается при любом исходе. */
function under<T>(variant: number, fn: () => T): T {
  const undo = VARIANTS[variant].set();
  try {
    return fn();
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
  /** Разрыв состава поиска против сбалансированного (`gapAgainst`). */
  | { kind: 'gap'; pool: number; n: number; from: number }
  /** Отбор поиска `from..to` (`SEARCH.screen` боёв против сбалансированного). */
  | { kind: 'pool'; from: number; to: number }
  /**
   * Ограничитель: состав с перевесом 10 % против себя (`bench.oversize`) в `total` бойцов строя. `bare` — бой без
   * ширины (`width: Infinity`; в задачу веера бесконечность не пролезает — JSON пишет её как null), иначе — по
   * выключателю.
   */
  | { kind: 'oversize'; composition: number; total: number; bare?: boolean }
  /** Кость: шаг, выведенный делением отрезка (`bench.diceStepFor`), и поле большей без кости. */
  | { kind: 'dice' }
  /** Сколько боёв доходит до кругов в `total` бойцов строя: матрица составов. */
  | { kind: 'reach'; total: number };

/**
 * Сколько боёв (`n`) дошло до круга (`rounds`), сколько всего было сшибок (`clashes`), сколько тиков шёл каждый бой
 * и сколько секунд длится его ролик (`buildCast`: такт сечи ролика ограничен по устройству) — по возрастанию.
 */
export interface Reach {
  n: number;
  rounds: number;
  clashes: number;
  ticks: number[];
  seconds: number[];
}

export type Out =
  | { kind: 'pair'; ab: Pair[]; ba: Pair[] }
  | { kind: 'ring'; pairs: Pair[] }
  | { kind: 'lattice'; ratios: number[] }
  | { kind: 'gap'; gap: { gap: number; lost: number; won: number } }
  | { kind: 'pool'; gaps: number[] }
  | { kind: 'oversize'; bigLoss: number; smallLoss: number; wins: number; draws: number; gong: number }
  | { kind: 'dice'; derived: number; bare: number }
  | { kind: 'reach'; matrix: Reach };

const reachOf = (rs: readonly BattleResult[]): Reach => ({
  n: rs.length,
  rounds: rs.filter((r) => r.log.some((e) => e.id === 'round')).length,
  clashes: rs.reduce((n, r) => n + r.phases.filter((p) => p.phase === 'clash').length, 0),
  ticks: rs.map((r) => r.ticks).sort((a, b) => a - b),
  seconds: rs.map((r) => buildCast(r, 'attacker').seconds).sort((a, b) => a - b),
});

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
      return under(job.variant, () => {
        const setups = compositionLattice().map((a) => deploySetup(a));
        const ratios: number[] = [];
        for (let i = job.from; i < job.to; i += 1) for (let j = i + 1; j < setups.length; j += 1) ratios.push(latticeDuel(setups, i, j));
        return { kind: 'lattice', ratios };
      });
    case 'gap':
      return { kind: 'gap', gap: gapAgainst(poolSetups()[job.pool], balanced, job.n, job.from) };
    case 'pool': {
      const all = poolSetups();
      const gaps: number[] = [];
      for (let i = job.from; i < job.to; i += 1) gaps.push(gapAgainst(all[i], balanced, SEARCH.screen).gap);
      return { kind: 'pool', gaps };
    }
    case 'oversize':
      return { kind: 'oversize', ...oversize(job.composition, OVERSIZE_SEEDS, job.total, job.bare ? Infinity : undefined) };
    case 'dice':
      // Кость ставится и снимается внутри `diceStepFor` и `withDiceStep`: следующая задача процесса
      // начинается на числе конфига.
      return { kind: 'dice', derived: diceStepFor(), bare: withDiceStep(0, () => oversizeHold()) };
    case 'reach': {
      const matrix: BattleResult[] = [];
      const setups = COMPOSITIONS.map((c) => deploySetup(scaleArmy(c.army, job.total)));
      for (let i = 0; i < setups.length; i += 1) {
        for (let j = 0; j < setups.length; j += 1) {
          if (i === j) continue;
          for (let seed = 1; seed <= 2; seed += 1) matrix.push(simulateBattle({ seed, attacker: setups[i], defender: setups[j] }));
        }
      }
      return { kind: 'reach', matrix: reachOf(matrix) };
    }
  }
}

/** Раздать задачи веером; итоги — в порядке задач. */
export const runJobs = (jobs: readonly Job[]): Promise<Out[]> => fan(battleJob, import.meta.url, jobs);

serveFan(import.meta.url, { battleJob });
