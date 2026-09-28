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
import { COUNTER, RETREAT, TEMPER, UNIT_KINDS, UNIT_STATS, deploySetup, simulateBattle, type ArmySetup, type BattleResult, type PhaseId, type Side, type Stack } from '../src/battle';
import { ARMY_SIZE, BALANCED_ARMY, COMPOSITIONS, OVERSIZE_SEEDS, RING, SEARCH, compositionLattice, diceStepFor, edgeBattles, gapAgainst, holdSize, latticeDuel, mirrorOf, mirrored, oversize, oversizeHold, scaleArmy, searchPool, standstill, withDiceStep, withMoralePace, type Mirrored } from '../src/battle/bench';
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
  | { kind: 'rout'; from: number; to: number }
  /** Пара кольца, сиды 1..seeds, оба боя пары: потери каждой стороны по группам фаз (`PHASE_GROUPS`). */
  | { kind: 'ringPhases'; ring: number; seeds: number }
  /**
   * Кольцо ролями (слово владельца по 14.35, п. 2): составы с лучниками `ROLES.ours[from..to]` и те же без лучников против
   * каждого состава с большой долей копий (`ROLES.foes`), сиды 1..`ROLE_SEEDS`, обе стороны поля.
   */
  | { kind: 'roles'; from: number; to: number };

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

/** Группы фаз для кольца: обстрел (стрельба и сближение), сшибка, сеча (бой линий и прежние его фазы), отход, погоня. */
export const PHASE_GROUPS: ReadonlyArray<{ name: string; phases: readonly PhaseId[] }> = [
  { name: 'обстрел', phases: ['ranged', 'approach'] },
  { name: 'сшибка', phases: ['clash'] },
  { name: 'сеча', phases: ['lines', 'flanking', 'reserve', 'morale'] },
  { name: 'отход', phases: ['retreat'] },
  { name: 'погоня', phases: ['pursuit'] },
];
const groupLosses = (r: BattleResult, side: Side): number[] => PHASE_GROUPS.map((g) => r.phases.filter((p) => g.phases.includes(p.phase)).reduce((n, p) => n + p.losses[side], 0));

/**
 * Составы раздела «Кольцо ролями». Противник — состав решётки, в котором копий не меньше половины. «Мы» — состав решётки с
 * лучниками и хоть одним другим родом; «тот же без лучников» — его прочие рода, доведённые до того же размера в тех же долях
 * (остаток округления — самому многочисленному роду): так сравнивается сам вклад лучников, а не размер армии.
 */
export const ROLES = ((): { ours: Array<Partial<Stack>>; bare: Array<Partial<Stack>>; foes: Array<Partial<Stack>> } => {
  const lattice = compositionLattice();
  const foes = lattice.filter((a) => (a.spear ?? 0) * 2 >= ARMY_SIZE);
  const ours = lattice.filter((a) => (a.archer ?? 0) > 0 && (a.archer ?? 0) < ARMY_SIZE);
  const bare = ours.map((a) => {
    const rest = UNIT_KINDS.filter((k) => k !== 'archer' && (a[k] ?? 0) > 0);
    const left = rest.reduce((n, k) => n + (a[k] ?? 0), 0);
    const out: Partial<Stack> = {};
    for (const k of rest) out[k] = Math.floor(((a[k] ?? 0) * ARMY_SIZE) / left);
    const top = rest.reduce((b, k) => ((a[k] ?? 0) > (a[b] ?? 0) ? k : b), rest[0]);
    out[top] = (out[top] ?? 0) + ARMY_SIZE - rest.reduce((n, k) => n + (out[k] ?? 0), 0);
    return out;
  });
  return { ours, bare, foes };
})();
/** Сиды раздела «Кольцо ролями»: два на пару с каждой стороны поля — четыре боя на (состав, противник). */
export const ROLE_SEEDS = 2;

/**
 * Погоня в бою: кто проиграл, сколько он потерял всего, сколько — в погоне, и упёрлась ли погоня в потолок
 * (`RETREAT.pursuitCap` от того, что у проигравшего стояло к началу отхода, — так бюджет ставит `Battle.decide`).
 */
export interface PursuitOf {
  loser: Side;
  lost: number;
  pursuit: number;
  capped: boolean;
}
export function pursuitOf(r: BattleResult): PursuitOf | null {
  if (r.winner === 'draw') return null;
  const loser: Side = r.winner === 'attacker' ? 'defender' : 'attacker';
  const at = r.phases.findIndex((p) => p.phase === 'retreat');
  const before = (at < 0 ? r.phases : r.phases.slice(0, at)).reduce((n, p) => n + p.losses[loser], 0);
  const budget = RETREAT.pursuitCap * Math.max(0, r.sides[loser].total.initial - before);
  const pursuit = r.phases.filter((p) => p.phase === 'pursuit').reduce((n, p) => n + p.losses[loser], 0);
  // Итог стороны округлён (`total.initial`), потери фаз — нет: упор в потолок признаётся с запасом в процент бюджета.
  return { loser, lost: r.sides[loser].total.losses, pursuit, capped: budget > 0 && pursuit >= budget * 0.99 };
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
  | { kind: 'ring'; pairs: Pair[] }
  | { kind: 'lattice'; ratios: number[] }
  | { kind: 'gap'; gap: { gap: number; lost: number; won: number } }
  | { kind: 'pool'; gaps: number[] }
  | { kind: 'oversize'; bigLoss: number; smallLoss: number; wins: number; draws: number; gong: number }
  | { kind: 'dice'; derived: number; bare: number }
  | { kind: 'reach'; matrix: Reach }
  | { kind: 'edge'; edge: Edge }
  | { kind: 'still'; n: number; gong: number; draws: number; stood: number }
  | { kind: 'mono'; n: number; held: number; drops: Array<{ i: number; j: number; side: Side; how: MonoKind }> }
  | { kind: 'face'; n: number; held: number; draws: number }
  | { kind: 'rout'; rout: Rout }
  | { kind: 'ringPhases'; a: number[]; b: number[] }
  | { kind: 'roles'; rows: Array<{ ours: number; foe: number; with: number; without: number; n: number }> };

/**
 * Бои 2 : 1 (раздел «Погоня»): сколько их (`n`), в скольких меньшая удержала поле, сколько проиграла; у проигравшей меньшей —
 * доля армии, потерянная к концу боя (`smallLoss`), потери всего и в погоне, упоры погони в потолок и сколько раз её перебили
 * (`annihilated`: осталось меньше 3 %).
 */
export interface Rout {
  n: number;
  smallHeld: number;
  smallLost: number;
  smallLoss: number[];
  lost: number;
  pursuit: number;
  capped: number;
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
  /** Погоня (раздел «Погоня»): потери проигравших всего и в погоне, и в скольких боях погоня упёрлась в потолок (`pursuitOf`). */
  lost: number;
  pursuit: number;
  capped: number;
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
    case 'edge': {
      // Бой без кости от сида не зависит: кость — единственная случайность ядра. Поэтому без кости — один бой на
      // сторону поля, с костью — четыре сида. Подмены (кость, темп морали) снимаются здесь же.
      const seeds = job.dice === 'bare' ? 1 : 4;
      const run = (): Array<{ r: BattleResult; big: 'attacker' | 'defender' }> => edgeBattles(job.step, job.from, job.to, seeds);
      const dice = job.dice;
      const fights = withMoralePace(job.pace, () => (dice === 'bare' ? withDiceStep(0, run) : typeof dice === 'number' ? withDiceStep(dice, run) : run()));
      const edge: Edge = { n: 0, held: 0, draws: 0, reasons: {}, loserLoss: [], spearsHeld: 0, lost: 0, pursuit: 0, capped: 0 };
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
          if (p.capped) edge.capped += 1;
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
      const out: Rout = { n: 0, smallHeld: 0, smallLost: 0, smallLoss: [], lost: 0, pursuit: 0, capped: 0, annihilated: 0 };
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
            if (p.capped) out.capped += 1;
            if (r.reason === 'annihilated') out.annihilated += 1;
          }
        }
      }
      return { kind: 'rout', rout: out };
    }
    case 'ringPhases': {
      const { a, b } = RING[job.ring];
      const la = PHASE_GROUPS.map(() => 0);
      const lb = PHASE_GROUPS.map(() => 0);
      for (let seed = 1; seed <= job.seeds; seed += 1) {
        const m = mirrored(a, b, seed);
        // Первый бой пары — a нападает, второй — b нападает (`mirrored`).
        for (const [r, sa] of [
          [m.results[0], 'attacker'],
          [m.results[1], 'defender'],
        ] as Array<[BattleResult, Side]>) {
          const sb: Side = sa === 'attacker' ? 'defender' : 'attacker';
          groupLosses(r, sa).forEach((v, k) => (la[k] += v));
          groupLosses(r, sb).forEach((v, k) => (lb[k] += v));
        }
      }
      return { kind: 'ringPhases', a: la, b: lb };
    }
    case 'roles': {
      const rows: Array<{ ours: number; foe: number; with: number; without: number; n: number }> = [];
      const foes = ROLES.foes.map((f) => deploySetup(f));
      for (let i = job.from; i < job.to; i += 1) {
        const withA = deploySetup(ROLES.ours[i]);
        const without = deploySetup(ROLES.bare[i]);
        foes.forEach((foe, e) => {
          const row = { ours: i, foe: e, with: 0, without: 0, n: 0 };
          for (let seed = 1; seed <= ROLE_SEEDS; seed += 1) {
            const m1 = mirrored(withA, foe, seed);
            const m2 = mirrored(without, foe, seed);
            row.with += m1.field.a;
            row.without += m2.field.a;
            row.n += 2;
          }
          rows.push(row);
        });
      }
      return { kind: 'roles', rows };
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
