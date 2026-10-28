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
import { KIND_PROFILE, TEMPER, UNIT_KINDS, UNIT_STATS, deploySetup, simulateBattle, type ArmySetup, type BattleResult, type Side } from '../src/battle';
import { ARMY_SIZE, BALANCED_ARMY, COMPOSITIONS, OVERSIZE_SEEDS, SEARCH, compositionLattice, diceStepFor, edgeBattles, gapAgainst, latticeHold, stepHold, surplusSplit, type SurplusGroup, holdSize, latticeDuel, mirrorOf, mirrored, oversize, oversizeHold, scaleArmy, searchPool, standstill, withDiceStep, withMoralePace, type LatticeDuel, type Mirrored } from '../src/battle/bench';
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
const HP = KIND_PROFILE.heavy as unknown as Record<string, number>;
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
  // Сила тяжёлой с пересмотра баланса — показатели рода (конь) и вещей; решётка голая, без вещей (14.35).
  { name: 'натиск коня 1 → 0 (пехота)', set: swap([HP, 'shockAtk', 0]) },
  { name: 'страх коня 1 → 0 (пехота)', set: swap([HP, 'moraleAtk', 0]) },
  { name: 'мораль 65 → 56 (пехота)', set: swap([H, 'morale', 56]) },
  { name: 'в обходе 0.6 → 1.0 (пехота)', set: swap([HT, 'charging', 1.0]) },
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
  /**
   * Кость: шаг, выведенный делением отрезка на решётке «Лезвия» (`bench.diceStepFor`), доля владельца на решётке с костью
   * конфига на окне ширин вывода (`bench.stepHold`) и поле большей без кости — на решётке и на «Ограничителе».
   */
  | { kind: 'dice' }
  /**
   * Кость по месту прибавки (задача 3 захода 30.09 (день), docs/battle_eu4.md, 14.35): набор `set` на размере W по группам
   * «прибавка большей в строю» и «в резерве» — с костью конфига и без кости (`bench.surplusSplit`).
   */
  | { kind: 'surplus'; set: 'limiter' | 'lattice' }
  /** Сколько боёв доходит до кругов в `total` бойцов строя: матрица составов. */
  | { kind: 'reach'; total: number }
  /**
   * «Лезвие» (разбор, слово владельца 27.09.2026): составы решётки `from..to` против себя больших на ступень
   * `EDGE_STEPS[step]`; `dice` — без кости (0), с шагом конфига или с данным шагом (выведенным, `bench.diceStepFor`);
   * `pace` — темп потери морали (`withMoralePace`).
   */
  | { kind: 'edge'; step: number; dice: 'bare' | 'config' | number; pace: number; from: number; to: number }
  /**
   * Стояние на решётке (docs/battle_eu4.md, 14.25–14.27): составы решётки `from..to` в `total` бойцов строя против
   * каждого другого состава решётки, обе стороны поля, сид 1 — сколько боёв дошло до потолка кругов, сколько ничьих и
   * сколько стояло (`bench.standstill`).
   */
  | { kind: 'still'; total: number; from: number; to: number }
  /**
   * Монотонность против того же противника (слово владельца по П0, docs/battle_eu4.md, 14.35): составы решётки `from..to`
   * в `total` бойцов строя против каждого состава решётки того же размера, без кости, сид 1, обе стороны поля; где меньший X
   * держит поле, тот же X на 10 % больше против того же Y — тоже держит ли. Как стоит первая линия у меньшего и у большего
   * (`MONO_KINDS`) — чтобы видеть, что добавили люди: новую полосу, ширину или только резерв.
   */
  | { kind: 'mono'; total: number; from: number; to: number }
  /**
   * Цена грани кости (слово владельца по 14.35, docs/battle_eu4.md): составы решётки `from..to` в размере W против себя
   * же, у «нас» — одна правка (`FACES[variant]`), кость конфига, сиды 1..`FACE_SEEDS`, «мы» — с обеих сторон поля.
   */
  | { kind: 'face'; variant: number; from: number; to: number }
  /**
   * Погоня и стек (слово владельца по 14.35, пп. 5–6): составы решётки `from..to` — половина W против целого W того же
   * состава, кость конфига, сиды 1..`FACE_SEEDS`, большая — с обеих сторон поля.
   */
  | { kind: 'rout'; from: number; to: number };


/**
 * Правки «нас» в разделе «Цена грани»: отметка полководца +1 в одной фазе (обстрел, сшибка, сеча), по одной в каждой из трёх
 * (так стоит полководец с тремя кружками сверх первого), и штраф местности −1 (грань земли). Манёвра здесь нет: без переправы
 * он ничего не снимает (`groundFaces`). «Как есть» — равные армии: от неё меряется сдвиг.
 */
export const FACES: ReadonlyArray<{ name: string; with: (s: ArmySetup) => ArmySetup }> = [
  { name: 'как есть (равные армии)', with: (s) => s },
  { name: 'отметка +1: обстрел', with: (s) => ({ ...s, pips: { fire: 1 } }) },
  { name: 'отметка +1: сшибка', with: (s) => ({ ...s, pips: { shock: 1 } }) },
  { name: 'отметка +1: сеча', with: (s) => ({ ...s, pips: { melee: 1 } }) },
  { name: 'отметки +1 во всех трёх', with: (s) => ({ ...s, pips: { fire: 1, shock: 1, melee: 1 } }) },
  { name: 'штраф местности −1', with: (s) => ({ ...s, ground: { land: 1 } }) },
];
/** Сиды раздела «Цена грани» и боёв 2 : 1 — те же четыре, что у «Лезвия» с костью. */
export const FACE_SEEDS = 4;

/**
 * Погоня в бою: кто проиграл, сколько он потерял всего, сколько — в погоне, и выбила ли погоня всех бегущих — армия
 * уничтожена: перебит (`annihilated`, осталось меньше 3 %) в фазе погони. Потолка у погони нет (П2, docs/battle_eu4.md,
 * 14.35): уничтожения стека отдельным правилом нет, оно следует из погони (слово владельца по 14.35, п. 6).
 */
export interface PursuitOf {
  loser: Side;
  lost: number;
  pursuit: number;
  wiped: boolean;
}
export function pursuitOf(r: BattleResult): PursuitOf | null {
  if (r.winner === 'draw') return null;
  const loser: Side = r.winner === 'attacker' ? 'defender' : 'attacker';
  const pursuit = r.phases.filter((p) => p.phase === 'pursuit').reduce((n, p) => n + p.losses[loser], 0);
  const wiped = r.log.some((e) => e.id === 'annihilated' && e.side === loser && e.phase === 'pursuit');
  return { loser, lost: r.sides[loser].total.losses, pursuit, wiped };
}

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
  | { kind: 'lattice'; duels: LatticeDuel[] }
  | { kind: 'gap'; gap: { gap: number; lost: number; won: number } }
  | { kind: 'pool'; gaps: number[] }
  | { kind: 'oversize'; bigLoss: number; smallLoss: number; wins: number; draws: number; gong: number }
  | { kind: 'dice'; derived: number; bare: number; lattice: number; latticeBare: number }
  | { kind: 'surplus'; split: Record<'line' | 'reserve', SurplusGroup> }
  | { kind: 'reach'; matrix: Reach }
  | { kind: 'edge'; edge: Edge }
  | { kind: 'still'; n: number; gong: number; draws: number; stood: number }
  | { kind: 'mono'; n: number; held: number; drops: Array<{ i: number; j: number; side: Side; how: MonoKind }> }
  | { kind: 'face'; n: number; held: number; draws: number }
  | { kind: 'rout'; rout: Rout };

/**
 * Бои 2 : 1 (раздел «Погоня»): сколько их (`n`), в скольких меньшая удержала поле, сколько проиграла; у проигравшей меньшей —
 * доля армии, потерянная к концу боя (`smallLoss`), потери всего и в погоне, сколько раз погоня выбила всех бегущих (`wiped`) и
 * сколько раз её перебили в бою до погони (`annihilated`: осталось меньше 3 %).
 */
export interface Rout {
  n: number;
  smallHeld: number;
  smallLost: number;
  smallLoss: number[];
  lost: number;
  pursuit: number;
  wiped: number;
  annihilated: number;
}

/**
 * Итог боёв «Лезвия»: сколько их (`n`), в скольких поле удержала большая (`held`), сколько ничьих, чем кончились
 * (`reason` результата: `morale` — у проигравшего в строю никого и встать некому, `annihilated` — перебит, `losses` —
 * никто не сломался, итог по сохранённым) и какую долю армии потерял проигравший к концу боя, с погоней (`loserLoss`).
 * `spearsHeld` — в скольких боях журнал пишет «копья остановили удар» (`spears-held`): событие, которого после
 * правила развёртывания почти не бывает (docs/battle_eu4.md, 14.20).
 */
export interface Edge {
  n: number;
  held: number;
  draws: number;
  reasons: Record<string, number>;
  loserLoss: number[];
  spearsHeld: number;
  /** Погоня (раздел «Погоня»): потери проигравших всего и в погоне, и в скольких боях погоня выбила всех бегущих (`pursuitOf`). */
  lost: number;
  pursuit: number;
  wiped: number;
}

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
    case 'lattice':
      return under(job.variant, () => {
        const setups = compositionLattice().map((a) => deploySetup(a));
        const duels: LatticeDuel[] = [];
        for (let i = job.from; i < job.to; i += 1) for (let j = i + 1; j < setups.length; j += 1) duels.push(latticeDuel(setups, i, j));
        return { kind: 'lattice', duels };
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
      return {
        kind: 'dice',
        derived: diceStepFor(),
        bare: withDiceStep(0, () => oversizeHold()),
        // Доля владельца на наборе вывода шага — окне ширин вокруг W (`bench.stepHold`, ПБ-1, п. 2).
        lattice: stepHold(),
        // Без кости бой от сида не зависит — одного сида хватает.
        latticeBare: withDiceStep(0, () => latticeHold(1)),
      };
    case 'surplus':
      return { kind: 'surplus', split: surplusSplit(job.set) };
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
    case 'edge': {
      // Бой без кости от сида не зависит: кость — единственная случайность ядра. Поэтому без кости — один бой на
      // сторону поля, с костью — четыре сида. Подмены (кость, темп морали) снимаются здесь же.
      const seeds = job.dice === 'bare' ? 1 : 4;
      const run = (): Array<{ r: BattleResult; big: 'attacker' | 'defender' }> => edgeBattles(job.step, job.from, job.to, seeds);
      const dice = job.dice;
      const fights = withMoralePace(job.pace, () => (dice === 'bare' ? withDiceStep(0, run) : typeof dice === 'number' ? withDiceStep(dice, run) : run()));
      const edge: Edge = { n: 0, held: 0, draws: 0, reasons: {}, loserLoss: [], spearsHeld: 0, lost: 0, pursuit: 0, wiped: 0 };
      for (const { r, big } of fights) {
        edge.n += 1;
        if (r.winner === big) edge.held += 1;
        if (r.winner === 'draw') edge.draws += 1;
        if (r.log.some((e) => e.id === 'spears-held')) edge.spearsHeld += 1;
        edge.reasons[r.reason] = (edge.reasons[r.reason] ?? 0) + 1;
        if (r.winner !== 'draw') {
          const loser = r.sides[r.winner === 'attacker' ? 'defender' : 'attacker'].total;
          edge.loserLoss.push(loser.losses / Math.max(1, loser.initial));
        }
        const p = pursuitOf(r);
        if (p) {
          edge.lost += p.lost;
          edge.pursuit += p.pursuit;
          if (p.wiped) edge.wiped += 1;
        }
      }
      return { kind: 'edge', edge };
    }
    case 'face': {
      const lattice = compositionLattice();
      const total = holdSize();
      const out = { kind: 'face' as const, n: 0, held: 0, draws: 0 };
      for (let i = job.from; i < job.to; i += 1) {
        const theirs = deploySetup(scaleArmy(lattice[i], total));
        const ours = FACES[job.variant].with(theirs);
        for (let seed = 1; seed <= FACE_SEEDS; seed += 1) {
          // «Мы» нападаем и обороняемся тем же сидом: сторона поля не решает.
          const a = simulateBattle({ seed, attacker: ours, defender: theirs });
          const d = simulateBattle({ seed, attacker: theirs, defender: ours });
          out.n += 2;
          if (a.winner === 'attacker') out.held += 1;
          if (d.winner === 'defender') out.held += 1;
          if (a.winner === 'draw') out.draws += 1;
          if (d.winner === 'draw') out.draws += 1;
        }
      }
      return out;
    }
    case 'rout': {
      const lattice = compositionLattice();
      const total = holdSize();
      const out: Rout = { n: 0, smallHeld: 0, smallLost: 0, smallLoss: [], lost: 0, pursuit: 0, wiped: 0, annihilated: 0 };
      for (let i = job.from; i < job.to; i += 1) {
        const small = deploySetup(scaleArmy(lattice[i], Math.round(total / 2)));
        const big = deploySetup(scaleArmy(lattice[i], total));
        for (let seed = 1; seed <= FACE_SEEDS; seed += 1) {
          for (const [r, smallSide] of [
            [simulateBattle({ seed, attacker: small, defender: big }), 'attacker'],
            [simulateBattle({ seed, attacker: big, defender: small }), 'defender'],
          ] as Array<[BattleResult, Side]>) {
            out.n += 1;
            if (r.winner === smallSide) out.smallHeld += 1;
            const p = pursuitOf(r);
            if (!p || p.loser !== smallSide) continue;
            out.smallLost += 1;
            const t = r.sides[smallSide].total;
            out.smallLoss.push(t.losses / Math.max(1, t.initial));
            out.lost += p.lost;
            out.pursuit += p.pursuit;
            if (p.wiped) out.wiped += 1;
            if (r.reason === 'annihilated') out.annihilated += 1;
          }
        }
      }
      return { kind: 'rout', rout: out };
    }
    case 'still': {
      const setups = compositionLattice().map((a) => deploySetup(scaleArmy(a, job.total)));
      const out = { kind: 'still' as const, n: 0, gong: 0, draws: 0, stood: 0 };
      for (let i = job.from; i < job.to; i += 1) {
        for (let j = 0; j < setups.length; j += 1) {
          if (i === j) continue;
          const r = simulateBattle({ seed: 1, attacker: setups[i], defender: setups[j] });
          out.n += 1;
          if (r.log.some((e) => e.id === 'rounds-out')) out.gong += 1;
          if (r.winner === 'draw') out.draws += 1;
          if (standstill(r).circle !== null) out.stood += 1;
        }
      }
      return out;
    }
    case 'mono': {
      const lattice = compositionLattice();
      const small = lattice.map((a) => deploySetup(scaleArmy(a, job.total)));
      const big = lattice.map((a) => deploySetup(scaleArmy(a, Math.round(job.total * 1.1))));
      const out = { kind: 'mono' as const, n: 0, held: 0, drops: [] as Array<{ i: number; j: number; side: Side; how: MonoKind }> };
      const fight = (x: ArmySetup, y: ArmySetup, side: Side): BattleResult =>
        simulateBattle({ seed: 1, attacker: side === 'attacker' ? x : y, defender: side === 'attacker' ? y : x });
      withDiceStep(0, () => {
        for (let i = job.from; i < job.to; i += 1) {
          for (let j = 0; j < lattice.length; j += 1) {
            for (const side of ['attacker', 'defender'] as const) {
              out.n += 1;
              if (fight(small[i], small[j], side).winner !== side) continue;
              out.held += 1;
              if (fight(big[i], small[j], side).winner !== side) out.drops.push({ i, j, side, how: monoKind(small[i], big[i]) });
            }
          }
        }
      });
      return out;
    }
  }
}

/**
 * Что прибавка в 10 % сделала с первой линией у X (сектора A, B, C): встала в полосу, где у меньшего X не было никого, —
 * «новая полоса»; прибавила людей в тех же полосах — «шире»; первая линия та же, прибавка — только резерв.
 */
export type MonoKind = 'новая полоса' | 'шире' | 'только резерв';
export const MONO_KINDS: readonly MonoKind[] = ['новая полоса', 'шире', 'только резерв'];
const frontOf = (s: ArmySetup): number[] => (['A', 'B', 'C'] as const).map((k) => Object.values(s.sectors[k]).reduce((n, v) => n + v, 0));
function monoKind(small: ArmySetup, big: ArmySetup): MonoKind {
  const a = frontOf(small);
  const b = frontOf(big);
  if (a.some((n, k) => n > 0 !== b[k] > 0)) return 'новая полоса';
  return a.every((n, k) => n === b[k]) ? 'только резерв' : 'шире';
}

/** Раздать задачи веером; итоги — в порядке задач. */
export const runJobs = (jobs: readonly Job[]): Promise<Out[]> => fan(battleJob, import.meta.url, jobs);

serveFan(import.meta.url, { battleJob });
