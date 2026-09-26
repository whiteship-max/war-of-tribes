// Слова для интерфейса подготовки: как называется род войск, план, приказ и
// условие ввода резерва. Лежат в `battle/` вместе с самими типами — иначе
// список приказов и список подписей разъедутся при первой же правке ядра.
// Зависимостей у модуля нет, как и у всего `battle/`.
import type {
  ArcherOrder,
  CavalryOrder,
  InfantryOrder,
  PipId,
  Plan,
  ReserveTrigger,
  SpearOrder,
  UnitKind,
} from './types';

export interface KindMeta {
  name: string;
  /** Единственное число — для строк вида «1 копейщик». */
  one: string;
  icon: string;
  /** Чем он в бою полезен: одна строка, которую видит игрок при расстановке. */
  hint: string;
}

/** Четыре рода полевого боя. Иконки — те же, что у видов бойцов племени. */
export const KIND_META: Record<UnitKind, KindMeta> = {
  spear: {
    name: 'Копья',
    one: 'копейщик',
    icon: '🔱',
    hint: 'Держат линию и ломают конницу — пока стоят, а не наступают.',
  },
  infantry: {
    name: 'Пехота',
    one: 'пехотинец',
    icon: '⚔️',
    hint: 'Якорь строя: разменов не выигрывает, но сектор с пехотой не бежит.',
  },
  archer: {
    name: 'Лучники',
    one: 'лучник',
    icon: '🏹',
    hint: 'Работают до сближения. В рукопашной почти бесполезны и быстро ломаются.',
  },
  cavalry: {
    name: 'Лёгкая конница',
    one: 'всадник',
    icon: '🐎',
    hint: 'Режет лучников и заходит во фланг, но в лоб не бьёт и разбивается о сомкнутые копья.',
  },
  heavy: {
    name: 'Тяжёлая конница',
    one: 'латный всадник',
    icon: '🏇',
    hint: 'Ломает строй в лоб и стоит под стрелами, но манёвра у неё нет — и сомкнутые копья держат её так же.',
  },
};

export interface PlanMeta {
  name: string;
  /** Что план делает — словами, на кнопке, а не в подсказке. */
  effect: string;
}

export const PLAN_META: Record<Plan, PlanMeta> = {
  defense: { name: 'Оборона', effect: 'Держим строй: меньше своего урона, но и мораль почти не проседает.' },
  assault: { name: 'Прямой натиск', effect: 'Основной удар через центр, фланги слабее.' },
  envelop: { name: 'Охват', effect: 'Давим флангами, центр придерживаем.' },
  'cavalry-strike': { name: 'Кавалерийский удар', effect: 'Пехота вяжет бой, конница идёт в обход.' },
  attrition: { name: 'Изматывание', effect: 'Дольше стреляем перед сближением.' },
  aggressive: { name: 'Агрессивная атака', effect: 'Бьём сильнее, но и получаем больше.' },
};

/** Порядок показа планов в интерфейсе. */
export const PLAN_IDS: readonly Plan[] = [
  'defense',
  'assault',
  'envelop',
  'cavalry-strike',
  'attrition',
  'aggressive',
];

export const SPEAR_ORDER_NAME: Record<SpearOrder, string> = {
  'hold-line': 'держать линию',
  'guard-archers': 'защищать лучников',
  'priority-cavalry': 'приоритет — конница',
  advance: 'наступать',
};

export const INFANTRY_ORDER_NAME: Record<InfantryOrder, string> = {
  'hold-center': 'удерживать центр',
  advance: 'наступать',
  'support-weak-flank': 'поддержать слабый фланг',
  'break-center': 'прорывать центр',
};

export const ARCHER_ORDER_NAME: Record<ArcherOrder, string> = {
  nearest: 'бить по ближайшим',
  'priority-infantry': 'приоритет — пехота',
  'priority-cavalry': 'приоритет — конница',
  'keep-distance': 'держать дистанцию',
  'support-center': 'поддерживать центр',
};

export const CAVALRY_ORDER_NAME: Record<CavalryOrder, string> = {
  charge: 'атаковать сразу',
  'hold-flank': 'держать фланг',
  flank: 'обходить противника',
  'attack-archers': 'атаковать лучников',
  reserve: 'оставаться в резерве',
  pursue: 'преследовать отступающих',
};

/** Приказы по роду войск: один список — и для типов, и для кнопок. */
export const ORDER_NAMES: Record<UnitKind, Record<string, string>> = {
  spear: SPEAR_ORDER_NAME,
  infantry: INFANTRY_ORDER_NAME,
  archer: ARCHER_ORDER_NAME,
  cavalry: CAVALRY_ORDER_NAME,
  heavy: CAVALRY_ORDER_NAME,
};

/**
 * Отметки полководца словами. В каких фазах отметка работает, здесь не пишется: это
 * `PHASE_PIP`, и слова о фазах собирает из него `log.pipPhases` — второй записи «где» нет.
 */
export const PIP_NAME: Record<PipId, string> = {
  fire: 'Обстрел',
  shock: 'Сшибка',
  melee: 'Сеча',
  maneuver: 'Манёвр',
};

export type ReserveKind = ReserveTrigger['kind'];

export const RESERVE_NAME: Record<ReserveKind, string> = {
  immediate: 'сразу после начала',
  'center-losing': 'если центр проигрывает',
  'weak-flank': 'на самый слабый фланг',
  weakest: 'туда, где проигрываем',
  morale: 'при падении морали',
  'after-phase': 'после фазы боя линий',
};

/** Условия ввода резерва в порядке показа. Фаза у «после фазы» одна — бой линий. */
export const RESERVE_TRIGGERS: readonly ReserveTrigger[] = [
  { kind: 'weakest' },
  { kind: 'immediate' },
  { kind: 'center-losing' },
  { kind: 'weak-flank' },
  { kind: 'morale' },
  { kind: 'after-phase', phase: 'lines' },
];

export const sameTrigger = (a: ReserveTrigger, b: ReserveTrigger): boolean =>
  a.kind === b.kind && (a.kind !== 'after-phase' || b.kind !== 'after-phase' || a.phase === b.phase);
