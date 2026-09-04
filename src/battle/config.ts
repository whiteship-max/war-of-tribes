// Все числа боя в одном месте. Баланс правится здесь, а не по коду симуляции:
// логика только читает таблицы.
import type {
  ArcherOrder,
  CavalryOrder,
  InfantryOrder,
  PhaseId,
  Plan,
  SpearOrder,
  UnitKind,
} from './types';

// ---------- Роды войск ----------

export interface UnitStats {
  /** Сила в рукопашной на одного бойца. */
  melee: number;
  /** Сила стрельбы на одного бойца. */
  ranged: number;
  /** Сколько урона надо, чтобы выбить одного: броня и стойкость. */
  toughness: number;
  /** Скорость: кто быстрее, тот навязывает или разрывает дистанцию. */
  speed: number;
  /**
   * Базовая мораль рода без снаряжения, 0..`MORALE.max`. Копейщики — отборный
   * строй, пехота — масса: её мораль ниже, и это один из двух рычагов против
   * «набери одной пехоты». Снаряжение из кузницы добавляет сверху (`GEAR`).
   */
  morale: number;
}

export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  spear: { melee: 1.0, ranged: 0, toughness: 1.0, speed: 1, morale: 60 },
  infantry: { melee: 1.0, ranged: 0, toughness: 1.1, speed: 2, morale: 56 },
  archer: { melee: 0.4, ranged: 1.0, toughness: 0.8, speed: 2, morale: 55 },
  cavalry: { melee: 1.3, ranged: 0, toughness: 1.1, speed: 3, morale: 65 },
};

/** Снаряжение: ступень 0..`max`, каждая даёт роду `moralePerLevel` морали. Это и есть связь кузницы с боем. */
export const GEAR = { max: 3, moralePerLevel: 6 };

/**
 * Характер родов — множитель всех потерь морали сектора в зависимости от того,
 * что с ним происходит. Копейщики стойки, пока держат линию; конница высока на
 * разгоне, но хрупка, когда её остановили; лучники в рукопашной ломаются быстро.
 */
export const TEMPER = {
  spear: {
    /** Сомкнутый строй, удар в лоб. */
    holding: 0.8,
    /** Приказ «наступать» или строй разомкнут. */
    advancing: 1.0,
    /** Удар во фланг или тыл строя. */
    flanked: 1.3,
  },
  infantry: { all: 1.0 },
  archer: {
    shooting: 1.0,
    /** Противник дошёл до них, и они не ушли. */
    melee: 2.0,
  },
  cavalry: {
    /** Первое столкновение или обход: конница в движении. */
    charging: 0.6,
    /** Стоит во фронте после столкновения — её остановили. */
    stalled: 1.3,
    /** Ждёт своего манёвра или в резерве. */
    waiting: 1.0,
  },
};

// ---------- Треугольник контрров ----------

/**
 * Копья → Конница → Лучники → Копья. Пехота вне кольца: ×1.0 против всех.
 * Превосходство условно — множитель зависит от приказа и положения, и именно
 * это даёт расстановке рычаг. Все числа раздела 3 документа — здесь.
 */
export const COUNTER = {
  spear: {
    /** Против конницы, пока держат линию (`hold-line`, `guard-archers`, `priority-cavalry`). */
    cavalryHolding: 2.0,
    /** Против конницы с приказом «наступать». */
    cavalryAdvancing: 1.2,
  },
  cavalry: {
    archer: 2.0,
    /** Удар во фланг или тыл — против любого, кроме сомкнутых копий. */
    flank: 1.8,
    /** Против сомкнутых копий (держат линию, и удар — в лоб или в закрытый тыл). */
    spearClosed: 0.5,
    /** Против пехоты: конница ломает несомкнутый строй. Второй рычаг против одной пехоты (документ писал ×1.0). */
    infantry: 1.3,
  },
  archer: {
    spear: 1.5,
    infantry: 0.8,
    cavalry: 0.7,
    /** Стрельба после контакта: лучники ещё бьют через головы, но толку мало. */
    afterContact: 0.3,
  },
  infantry: {
    all: 1.0,
  },
} as const;

/** Обход не конницей (пехота или копья, обошедшие сектор) — скромнее кавалерийского. */
export const FOOT_FLANK = 1.2;

/**
 * Пехота держит сектор. Группа без пехоты получает больше урона и разваливается
 * раньше: доля оставшихся, ниже которой фронт считается смятым.
 */
export const ANCHOR = {
  /** Доля пехоты в группе, с которой сектор считается заякоренным. */
  infantryShare: 0.2,
  collapseAt: 0.3,
  noInfantryCollapseAt: 0.4,
  noInfantryDamageTaken: 1.05,
};

// ---------- Фазы ----------

/** Тики на фазу. Стрелковую тянет темп планов, бой линий может оборваться раньше. */
export const PHASE_TICKS: Record<PhaseId, number> = {
  ranged: 10,
  approach: 4,
  clash: 4,
  lines: 16,
  flanking: 8,
  reserve: 6,
  morale: 6,
  retreat: 8,
  pursuit: 8,
};

/** Меньше этого фаза не длится, даже если сторона уже сломалась. */
export const PHASE_MIN: Partial<Record<PhaseId, number>> = {
  lines: 12,
  flanking: 4,
  reserve: 2,
  morale: 4,
};

/** Границы стрелковой фазы после сдвига темпа. */
export const RANGED_TICKS = { min: 8, max: 20 };

/**
 * Медленные не могут сократить дистанцию: позиция из одних бойцов со скоростью
 * не выше этой вступает в рукопашную на столько тиков позже начала столкновения.
 */
export const SLOW_CONTACT = { speedAtMost: 1, delay: 3 };

/** Сколько первых тиков стрельбы бьют по морали в полную силу; дальше противник обвыкся. */
export const RANGED_SHOCK_TICKS = 8;
export const RANGED_SHOCK_LATE = 0.5;

// ---------- Урон ----------

/** Доля противника, которую выбивает один боец силы 1 за тик рукопашной и стрельбы. */
export const MELEE_RATE = 0.0115;
export const RANGED_RATE = 0.011;
/** Разброс урона за тик, ±доля. Единственное место, где бой смотрит на сид. */
export const JITTER = 0.08;
/** Первое столкновение: удар конницы с разбега. */
export const CLASH_CAVALRY_IMPACT = 1.5;
/** Первое столкновение: сомкнутые копья встречают его упёршись. */
export const CLASH_SPEAR_BRACE = 0.85;
/** Лучники держат дистанцию от медленного противника: урон им и их стрельба. */
export const KITING = { damageTaken: 0.4, ranged: 0.6 };

// ---------- Мораль ----------

/**
 * Мораль своя у каждого сектора (у каждой группы на поле). Сектор с нулевой
 * моралью ломается: бойцы бегут, линия открывается. Армия отступает, когда
 * сломанные сектора весят достаточно, — это и есть нормальный конец боя.
 *
 * Ограничитель: паника с перекидыванием — прямой путь к тому, что перевес в 10%
 * лавиной превращается в разгром 2:1. Порог слома армии, сила паники и якорь
 * пехоты подобраны так, чтобы при перевесе 10% размен не превышал ≈1.5, — это
 * держит тест «перевес в 10% не даёт лавины».
 */
export const MORALE = {
  max: 100,
  /** Сколько морали уносит потеря всего сектора (пропорционально доле потерь сектора за тик). */
  perLoss: 280,
  /** Удар во фланг или тыл: разово при обходе и за каждый тик под таким ударом. */
  flankTurned: 8,
  flankDrain: 1.2,
  /** Противник дошёл до тыла. */
  rearReached: 5,
  /** Проигрыш стрелковой фазы: сторона потеряла до контакта заметно больше противника. */
  rangedLost: 8,
  rangedLostRatio: 1.3,
  /** Паника: сосед сломался — разово; и за каждый тик, пока сосед сломан. */
  panic: 8,
  panicDrain: 0.6,
  /** Якорь: сектор с пехотой (`ANCHOR.infantryShare`) теряет мораль медленнее и слабее принимает панику. */
  anchor: 0.75,
  anchorPanic: 0.5,
  /** Вошедший резерв поднимает мораль сектора, куда вошёл. */
  reserveBoost: 15,
  /** Армия сломалась, когда сломанные или перебитые сектора весят столько от её начальной численности. */
  armyBreakShare: 0.5,
  /** В фазе «падение морали» потери бьют сильнее. */
  phaseMult: 1.5,
  /** Потеряв столько, сторона ломается независимо от морали. */
  autoBreakLoss: 0.65,
  /** Сломавшаяся армия выходит из боя ещё до фазы отступления: бьёт слабее и её меньше достают. */
  brokenDealt: 0.6,
  brokenTaken: 0.6,
  /** Бегущий сектор почти не отбивается и подставляет спину. */
  fledDealt: 0.3,
  fledTaken: 1.0,
  /** Резерв по условию «мораль» входит, когда мораль армии ниже этого. */
  reserveTriggerAt: 60,
};

/** Сила урона от морали сектора: при нуле — половина. */
export const moraleDamageMult = (morale: number): number => 0.5 + 0.5 * Math.max(0, Math.min(100, morale)) / 100;

// ---------- Отход и преследование ----------

export const RETREAT = {
  /** Отступающие отбиваются слабо и выходят из контакта. */
  dealt: 0.5,
  taken: 0.3,
  /** Преследование: сколько отступающих выбивает один преследователь за тик. */
  pursuitKills: { cavalry: 0.15, infantry: 0.02, spear: 0.015, archer: 0.03 } as Record<UnitKind, number>,
  /** Приказ коннице «преследовать». */
  pursueOrder: 2.0,
  /** Больше этой доли отступивших преследование не выбивает: проигравший уходит домой. */
  pursuitCap: 0.04,
};

/** Итог без развала морали: сторона отходит, если сохранила меньше противника в этот раз. */
export const WITHDRAW_RATIO = 1.05;
/** Сторона считается истреблённой, когда осталась меньше этой доли. */
export const ANNIHILATED_AT = 0.03;

// ---------- Планы ----------

export interface PlanMods {
  dealt: number;
  taken: number;
  /** Сдвиг стартовой морали каждого сектора. */
  morale: number;
  /** Множители урона по полосам: центр и фланги. */
  center: number;
  flank: number;
  /** Сдвиг длины стрелковой фазы, тиков. */
  tempo: number;
  /** Множитель всех потерь морали: оборона держит строй. */
  shock: number;
  /** Стрельба и рукопашная отдельно (изматывание). */
  ranged: number;
  /** Кавалерийский удар: конница в обходе. */
  strike: number;
}

/**
 * В модели морали каждая лишняя потеря стоит дорого, поэтому планы выровнены
 * по размену в зеркале одинаковых армий (, раздел
 * «Планы»): ни один не выигрывает у всех, каждый кому-то проигрывает. Оборона
 * с прежними ×0.8/×0.7 не проигрывала никому, изматывание с ×0.9 урона и
 * агрессия с −5 морали проигрывали всем.
 */
export const PLANS: Record<Plan, PlanMods> = {
  defense: { dealt: 0.85, taken: 0.9, morale: 5, center: 1, flank: 1, tempo: 1, shock: 0.8, ranged: 1, strike: 1 },
  assault: { dealt: 1, taken: 1, morale: 0, center: 1.25, flank: 0.95, tempo: 0, shock: 0.97, ranged: 1, strike: 1 },
  envelop: { dealt: 1, taken: 1, morale: 0, center: 0.9, flank: 1.15, tempo: 0, shock: 1, ranged: 1, strike: 1 },
  'cavalry-strike': { dealt: 1, taken: 1, morale: 0, center: 1, flank: 1, tempo: 0, shock: 1, ranged: 1, strike: 1.15 },
  attrition: { dealt: 1, taken: 1, morale: 0, center: 1, flank: 1, tempo: 5, shock: 1, ranged: 1.15, strike: 1 },
  aggressive: { dealt: 1.2, taken: 1.12, morale: 0, center: 1, flank: 1, tempo: -2, shock: 1, ranged: 1, strike: 1 },
};

/** Охват: фланг, чья сила больше вражеской во столько раз, заворачивает к центру этой долей людей. */
export const ENVELOP = { advantage: 1.3, share: 0.25 };
/** Пехота «поддержать слабый фланг»: порог слабости и доля центра, которая уходит. */
export const SUPPORT_FLANK = { weakBelow: 0.8, share: 0.3, minCenter: 40 };
/** Резерв: центр или фланг считается проигрывающим ниже этого отношения сил. */
export const RESERVE_LOSING = 0.8;

// ---------- Приказы ----------

export interface OrderMods {
  dealt: number;
  taken: number;
}

export const SPEAR_ORDERS: Record<SpearOrder, OrderMods & { closed: boolean }> = {
  'hold-line': { dealt: 1, taken: 1, closed: true },
  'guard-archers': { dealt: 1, taken: 1, closed: true },
  'priority-cavalry': { dealt: 1, taken: 1, closed: true },
  advance: { dealt: 1.15, taken: 1.1, closed: false },
};

export const INFANTRY_ORDERS: Record<InfantryOrder, OrderMods> = {
  'hold-center': { dealt: 1, taken: 0.9 },
  advance: { dealt: 1.15, taken: 1.1 },
  'support-weak-flank': { dealt: 1, taken: 1 },
  'break-center': { dealt: 1.3, taken: 1.2 },
};

export const ARCHER_ORDERS: Record<ArcherOrder, OrderMods> = {
  nearest: { dealt: 1, taken: 1 },
  'priority-infantry': { dealt: 1, taken: 1 },
  'priority-cavalry': { dealt: 1, taken: 1 },
  'keep-distance': { dealt: 1, taken: 1 },
  'support-center': { dealt: 1, taken: 1 },
};

export const CAVALRY_ORDERS: Record<CavalryOrder, OrderMods> = {
  charge: { dealt: 1, taken: 1 },
  'hold-flank': { dealt: 1, taken: 0.9 },
  flank: { dealt: 1, taken: 1 },
  'attack-archers': { dealt: 1, taken: 1 },
  reserve: { dealt: 1, taken: 1 },
  pursue: { dealt: 1, taken: 1 },
};

/** Приоритет цели: во сколько раз охотнее бьют по выбранному роду. */
export const TARGET_PRIORITY = 3;

// ---------- Журнал ----------

/** Событие о размене пишется, только если выбито не меньше стольких человек и такой доли участников. */
export const EVENT_MIN = 5;
export const EVENT_SHARE = 0.05;
