// Типы боевой симуляции. Модуль `battle/` самодостаточен: ни React, ни three,
// ни состояния игры — только эти типы, конфиг и чистая функция. Это условие
// того, что ровно этот код потом запустит сервер, а клиент прогонит его же
// для показа.

/**
 * Пять родов войск полевого боя. Осадные — только против стен, их здесь нет.
 *
 * Конных родов два, и делит их доспех: `cavalry` — лёгкая, та половина конницы, что держится
 * на скорости (лучники, фланг, погоня); `heavy` — тяжёлая, та, что держится на весе (ломает
 * строй в лоб, стоит под стрелами, но манёвра у неё нет). Числа обеих — в `UNIT_STATS`,
 * `COUNTER` и `TEMPER`; своих чисел у классов нет, они делят прежний профиль (docs/stable.md).
 */
export type UnitKind = 'spear' | 'infantry' | 'archer' | 'cavalry' | 'heavy';
export const UNIT_KINDS: readonly UnitKind[] = ['spear', 'infantry', 'archer', 'cavalry', 'heavy'];

/** Конные рода: всё, что верхом. Приказ у каждого свой, но оба — конница. */
export const HORSE_KINDS: readonly UnitKind[] = ['cavalry', 'heavy'];

/** Сколько кого. Внутри симуляции числа дробные, наружу — целые. */
export type Stack = Record<UnitKind, number>;

/**
 * Сектора расстановки, как в документе: фронт A B C (слева направо со стороны
 * самой армии), тыл D E F под ними, резерв R.
 */
export type FrontSector = 'A' | 'B' | 'C';
export type RearSector = 'D' | 'E' | 'F';
export type Sector = FrontSector | RearSector | 'R';
export const FRONT: readonly FrontSector[] = ['A', 'B', 'C'];
export const REAR: readonly RearSector[] = ['D', 'E', 'F'];
export const SECTORS: readonly Sector[] = ['A', 'B', 'C', 'D', 'E', 'F', 'R'];

/** Полоса поля со стороны своей армии: 0 — левый фланг, 1 — центр, 2 — правый. */
export type Lane = 0 | 1 | 2;

/** Общий план боя (раздел 4 документа). */
export type Plan = 'defense' | 'assault' | 'envelop' | 'cavalry-strike' | 'attrition' | 'aggressive';

/** Приказы родам войск (раздел 5). Один приказ на род на всю армию. */
export type CavalryOrder = 'charge' | 'hold-flank' | 'flank' | 'attack-archers' | 'reserve' | 'pursue';
export type ArcherOrder = 'nearest' | 'priority-infantry' | 'priority-cavalry' | 'keep-distance' | 'support-center';
export type SpearOrder = 'hold-line' | 'guard-archers' | 'priority-cavalry' | 'advance';
export type InfantryOrder = 'hold-center' | 'advance' | 'support-weak-flank' | 'break-center';

export interface Orders {
  cavalry: CavalryOrder;
  /**
   * Приказ тяжёлой коннице: те же приказы, что у лёгкой, — но отдельно от неё. Поле
   * необязательное, и читается оно одной дверью (`sim.horseOrder`): расстановка, записанная
   * до появления второго конного рода — в сохранении партии, в слепке мира или в шаблоне, —
   * приезжает без него, и тяжёлая идёт по приказу лёгкой.
   */
  heavy?: CavalryOrder;
  archer: ArcherOrder;
  spear: SpearOrder;
  infantry: InfantryOrder;
}

/** Фазы боя — фиксированные и в этом порядке (раздел 11). */
export type PhaseId =
  | 'ranged'
  | 'approach'
  | 'clash'
  | 'lines'
  | 'flanking'
  | 'reserve'
  | 'morale'
  | 'retreat'
  | 'pursuit';
export const PHASES: readonly PhaseId[] = [
  'ranged',
  'approach',
  'clash',
  'lines',
  'flanking',
  'reserve',
  'morale',
  'retreat',
  'pursuit',
];

/**
 * Отметки полководца: по одной на обстрел, сшибку и сечу и одна на манёвр (docs/battle_eu4.md,
 * раздел 2.4). Отметка — грань кости своей фазы (`DICE`, `PHASE_PIP` в конфиге): полководец с двумя
 * отметками сшибки бросает в сшибке так, будто у кости на две грани больше.
 */
export type PipId = 'fire' | 'shock' | 'melee' | 'maneuver';
export const PIP_IDS: readonly PipId[] = ['fire', 'shock', 'melee', 'maneuver'];
export type Pips = Partial<Record<PipId, number>>;

/** Условие ввода резерва (раздел 6). */
export type ReserveTrigger =
  | { kind: 'immediate' }
  | { kind: 'center-losing' }
  | { kind: 'weak-flank' }
  /** Туда, где проигрываем, — центр или фланг, что слабее. Условие шаблона быстрой атаки. */
  | { kind: 'weakest' }
  | { kind: 'morale' }
  | { kind: 'after-phase'; phase: PhaseId };

export interface ArmySetup {
  sectors: Record<Sector, Stack>;
  plan: Plan;
  orders: Orders;
  reserve: ReserveTrigger;
  /**
   * Ступень снаряжения рода войск, 0..`GEAR.max`: то, что выковала кузница.
   * Каждая ступень прибавляет `GEAR.moralePerLevel` к базовой морали рода —
   * снаряжение делает бойца стойче, а не только больнее. Отображение видов
   * бойцов игры (`TROOPS`) на четыре рода боя — дело моста, не ядра; здесь только число.
   */
  gear?: Partial<Record<UnitKind, number>>;
  /**
   * Прибавка к стартовой морали **каждого своего** сектора: то, с чем эта армия
   * вышла в поле помимо снаряжения. Ноль по умолчанию, и ядро про источник
   * ничего не знает — обряд ли это перед боем, речь ли полководца.
   *
   * Поля веры, племени или стороны у `BattleInput` нет и быть не может, и это
   * не оговорка, а то, чем держится обещание «никаких боевых бонусов вида «моя
   * вера бьёт твою»»: противнику неоткуда взять то, чего ему не передали.
   * Число одинаково работает против кого угодно.
   */
  resolve?: number;
  /**
   * Отметки того, кто ведёт эту сторону. Ядро про источник не знает — как не знает, откуда
   * `resolve`: у игры это уровень полководца, у логова полководца нет, и поле пустое. Нет поля —
   * ноль по всем четырём.
   */
  pips?: Pips;
}

export type Side = 'attacker' | 'defender';
export const SIDES: readonly Side[] = ['attacker', 'defender'];
export type Winner = Side | 'draw';

export interface BattleInput {
  seed: number;
  attacker: ArmySetup;
  defender: ArmySetup;
  /**
   * Ширина фронта полосы в этом бою, бойцов строя: в каждом ряду полосы с каждой стороны бьёт не больше
   * стольких. Нет поля — `FRONT_WIDTH`, если ширина включена (`WIDTH_ON`), иначе боя без ширины;
   * `Infinity` — боя без ширины (так бой шёл до пачки 2).
   */
  width?: number;
}

// ---------- Журнал ----------

interface EventBase {
  tick: number;
  phase: PhaseId;
}

/**
 * Именованные события боя. Это часть ядра, а не украшение: отчёт строится из них.
 * `side` — чьё событие: чьи войска сделали дело или чей сектор пострадал.
 */
export type BattleEvent = EventBase &
  (
    | { id: 'phase-start' }
    /**
     * Кость фазы: что выпало каждой стороне (0..`DICE.faces` − 1) и сколько граней прибавил
     * её полководец (`pips`). Пишется в начале каждой фазы, у которой есть кость (`PHASE_PIP`).
     */
    | { id: 'dice'; rolls: Record<Side, number>; pips: Record<Side, number> }
    /** Лучники нанесли `losses` потерь до контакта. */
    | { id: 'volley'; side: Side; losses: number }
    /** Копья в `sector` остановили кавалерийский удар: конница потеряла больше, чем копейщики. */
    | { id: 'spears-held'; side: Side; sector: Sector; cavalryLost: number; spearsLost: number }
    /** Конница (`side`) вырубила лучников противника в его секторе `target`. */
    | { id: 'cavalry-broke-archers'; side: Side; target: Sector; archersLost: number }
    /** Конница (`side`) перехвачена конницей противника, державшей фланг. */
    | { id: 'cavalry-intercepted'; side: Side; target: Sector }
    /** Сектор `sector` стороны `side` обойдён: удар пришёл с фланга или тыла. */
    | { id: 'flank-turned'; side: Side; sector: Sector; by: Side }
    /** Фронт в `sector` смят потерями: остатки откатились в тыл. */
    | { id: 'sector-collapsed'; side: Side; sector: Sector }
    /** Мораль сектора упала до нуля: бойцы бегут, сектор больше не держит линию. */
    | { id: 'sector-broken'; side: Side; sector: Sector }
    /** Паника перекинулась со сломанного сектора `from` на соседний `to`. */
    | { id: 'panic-spread'; side: Side; from: Sector; to: Sector }
    /** Сторона проиграла стрелковую фазу: до контакта потеряла `losses` против `enemyLosses` у противника. */
    | { id: 'ranged-lost'; side: Side; losses: number; enemyLosses: number }
    /** Противник прошёл сквозь фронт и достиг тыла `sector`. */
    | { id: 'rear-reached'; side: Side; sector: Sector; by: Side }
    /** Резерв (`men` человек) вошёл в `sector`. */
    | { id: 'reserve-committed'; side: Side; sector: Sector; men: number }
    /** Пехота из центра сдвинулась поддержать `to`. */
    | { id: 'infantry-shifted'; side: Side; to: Sector; men: number }
    /** Лучники в `sector` держат дистанцию от медленного противника. */
    | { id: 'archers-kiting'; side: Side; sector: Sector }
    /**
     * Ряд шире фронта: в строю `width`, остальные из `men` стоят глубиной и встают на место павших.
     * `row` — какой ряд полосы: фронт, тыл или обход; `sector` — сектор этой полосы (у обхода — её
     * фронт). Пишется раз за бой на ряд полосы — в первый тик, когда ширина зажала бьющих.
     */
    | { id: 'depth'; side: Side; sector: Sector; row: 'front' | 'rear' | 'strike'; men: number; width: number }
    /** Армия сломалась: сломанные сектора весят `brokenShare` (0..1) от её начальной численности. */
    | { id: 'morale-collapsed'; side: Side; morale: number; brokenShare: number }
    /** Сторона перебита почти целиком. */
    | { id: 'annihilated'; side: Side }
    /** Размен проигран без развала морали: сохранили `kept` долю против `enemyKept` у противника. */
    | { id: 'outfought'; side: Side; kept: number; enemyKept: number }
    /** Сторона отходит: `orderly` — без развала морали, по решению итога. */
    | { id: 'retreat'; side: Side; orderly: boolean }
    /** Преследование: `side` добила отступающих на `losses` человек. */
    | { id: 'pursuit'; side: Side; losses: number }
    /** Итог. `pyrrhic` — поле удержано, но победитель потерял больше проигравшего: победа с непомерными потерями. */
    | { id: 'result'; winner: Winner; reason: ResultReason; pyrrhic: boolean }
  );

export type EventId = BattleEvent['id'];

/** Событие без тика и фазы — их проставляет симуляция. Omit по объединению, а не по общему типу. */
export type EventBody = BattleEvent extends infer E ? (E extends BattleEvent ? Omit<E, 'tick' | 'phase'> : never) : never;

export type ResultReason = 'morale' | 'annihilated' | 'losses' | 'draw';

/**
 * Исход для стороны: результат и цена отдельно. Поле удерживает тот, у кого
 * дольше держится мораль, — и это может стоить больше, чем поражение. Победа
 * с размером потерь выше, чем у противника, — `pyrrhic`, и отчёт называет её
 * прямо, а не оставляет игроку выяснять по остаткам армии.
 */
export type Verdict = 'victory' | 'pyrrhic' | 'defeat' | 'draw';

// ---------- Итог ----------

export interface SideTotals {
  initial: number;
  final: number;
  losses: number;
}

export interface SideResult {
  initial: Stack;
  final: Stack;
  losses: Stack;
  total: SideTotals;
  /**
   * По секторам расстановки: куда кого поставили, сколько оттуда вернулось,
   * мораль сектора к концу боя (0..100; пустой сектор — 0) и бежал ли он.
   */
  sectors: Record<Sector, { initial: Stack; final: Stack; morale: number; broken: boolean }>;
  /** Мораль армии к концу боя, 0..100: средняя по живым секторам, взвешенная числом людей. */
  morale: number;
  /** Результат и цена: победа, победа с непомерными потерями, поражение, ничья. */
  verdict: Verdict;
  /** Сторона сломалась (мораль или истребление) — тик, когда это случилось. */
  brokenAt: number | null;
  /** Сколько противника выбила стрельба до первого контакта и за весь бой. */
  rangedBeforeContact: number;
  rangedTotal: number;
}

export interface PhaseSpan {
  phase: PhaseId;
  /** Первый и последний тик фазы включительно. */
  from: number;
  to: number;
  /** Сколько каждая сторона потеряла за эту фазу (дробные, наружу не округляются: сумма по фазам ≈ потери). */
  losses: Record<Side, number>;
  /**
   * Те же потери по секторам расстановки, откуда бойцы родом. Без этого показ
   * знает, сколько сторона потеряла, но не знает, где именно всё сломалось:
   * фланг, выбитый за одну фазу, таял бы так же плавно, как центр,
   * перемалывавшийся весь бой.
   *
   * Сектор бойца не меняется за бой: пехота, ушедшая поддержать фланг, и резерв,
   * вошедший в центр, остаются родом из своего сектора — иначе потери «переезжали»
   * бы вместе с людьми и суммы не сошлись бы.
   *
   * Поле необязательное: у записей боя, посчитанных до его появления, его нет,
   * и восстановить его задним числом неоткуда. Раскадровка это переживает —
   * тогда сектор тает по общему ходу потерь своей стороны, как раньше.
   */
  bySector?: Record<Side, Partial<Record<Sector, number>>>;
}

export interface BattleResult {
  seed: number;
  ticks: number;
  winner: Winner;
  reason: ResultReason;
  /** Победитель потерял больше проигравшего: размен ниже `PYRRHIC_BELOW`. */
  pyrrhic: boolean;
  phases: PhaseSpan[];
  sides: Record<Side, SideResult>;
  log: BattleEvent[];
}
