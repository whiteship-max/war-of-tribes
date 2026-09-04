// Типы боевой симуляции. Модуль `battle/` самодостаточен: ни React, ни three,
// ни состояния игры — только эти типы, конфиг и чистая функция. Это условие
// того, что ровно этот код потом запустит сервер, а клиент прогонит его же
// для показа.

/** Четыре рода войск полевого боя. Осадные — только против стен, их здесь нет. */
export type UnitKind = 'spear' | 'infantry' | 'archer' | 'cavalry';
export const UNIT_KINDS: readonly UnitKind[] = ['spear', 'infantry', 'archer', 'cavalry'];

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
}

export type Side = 'attacker' | 'defender';
export const SIDES: readonly Side[] = ['attacker', 'defender'];
export type Winner = Side | 'draw';

export interface BattleInput {
  seed: number;
  attacker: ArmySetup;
  defender: ArmySetup;
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
    /** Фронт в `sector` смят: остатки откатились в тыл. */
    | { id: 'sector-collapsed'; side: Side; sector: Sector }
    /** Противник прошёл сквозь фронт и достиг тыла `sector`. */
    | { id: 'rear-reached'; side: Side; sector: Sector; by: Side }
    /** Резерв (`men` человек) вошёл в `sector`. */
    | { id: 'reserve-committed'; side: Side; sector: Sector; men: number }
    /** Пехота из центра сдвинулась поддержать `to`. */
    | { id: 'infantry-shifted'; side: Side; to: Sector; men: number }
    /** Лучники в `sector` держат дистанцию от медленного противника. */
    | { id: 'archers-kiting'; side: Side; sector: Sector }
    /** Мораль рухнула. */
    | { id: 'morale-collapsed'; side: Side; morale: number }
    /** Сторона перебита почти целиком. */
    | { id: 'annihilated'; side: Side }
    /** Размен проигран без развала морали: сохранили `kept` долю против `enemyKept` у противника. */
    | { id: 'outfought'; side: Side; kept: number; enemyKept: number }
    /** Сторона отходит: `orderly` — без развала морали, по решению итога. */
    | { id: 'retreat'; side: Side; orderly: boolean }
    /** Преследование: `side` добила отступающих на `losses` человек. */
    | { id: 'pursuit'; side: Side; losses: number }
    | { id: 'result'; winner: Winner; reason: ResultReason }
  );

export type EventId = BattleEvent['id'];

/** Событие без тика и фазы — их проставляет симуляция. Omit по объединению, а не по общему типу. */
export type EventBody = BattleEvent extends infer E ? (E extends BattleEvent ? Omit<E, 'tick' | 'phase'> : never) : never;

export type ResultReason = 'morale' | 'annihilated' | 'losses' | 'draw';

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
  /** По секторам расстановки: куда кого поставили и сколько оттуда вернулось. */
  sectors: Record<Sector, { initial: Stack; final: Stack }>;
  /** Мораль к концу боя, 0..100. */
  morale: number;
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
}

export interface BattleResult {
  seed: number;
  ticks: number;
  winner: Winner;
  reason: ResultReason;
  phases: PhaseSpan[];
  sides: Record<Side, SideResult>;
  log: BattleEvent[];
}
