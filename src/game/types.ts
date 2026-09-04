// Базовые типы состояния игры. Симуляция не зависит от рендера и UI.
import type { DecreeId, RationId, TaxId } from './data/policy';

export type ResourceId = 'wood' | 'stone' | 'food' | 'hides' | 'bones' | 'copper' | 'iron';
export type Resources = Record<ResourceId, number>;

/**
 * Снаряжение. Счётчики того же рода, что и ресурсы, но живут отдельно:
 * вместимость склада на них не действует, и чужой набег их не уносит — см. data/equipment.ts.
 */
export type EquipmentId = 'spear' | 'bow' | 'axe' | 'shield' | 'sword' | 'armor';
export type Equipment = Record<EquipmentId, number>;

/**
 * Товар рынка: либо ресурс, либо предмет снаряжения. Ключи снаряжения носят
 * префикс, чтобы один словарь `s.market.bought` держал и то, и другое.
 */
export type GoodId = ResourceId | `eq:${EquipmentId}`;

/**
 * Войска. Боец — не житель с профессией, а единица в счётчике: нанятый уходит
 * из рабочих совсем. Роли «воин» в списке профессий поэтому больше нет.
 */
export type TroopId =
  | 'clubman'
  | 'spearman'
  | 'archer'
  | 'axeman'
  | 'swordsman'
  | 'shieldman'
  | 'legionary';
export type Army = Record<TroopId, number>;

export type JobId =
  | 'idle'
  | 'gatherer'
  | 'hunter'
  | 'woodcutter'
  | 'stonecutter'
  | 'miner'
  | 'farmer'
  | 'herder'
  | 'crafter'
  | 'smith'
  | 'shaman';

export type BuildingTypeId =
  | 'campfire'
  | 'shelter'
  | 'chief_house'
  | 'hut'
  | 'storage'
  | 'gathering'
  | 'sawmill'
  | 'quarry'
  | 'hunter_hut'
  | 'mine'
  | 'workshop'
  | 'farm'
  | 'pen'
  | 'totem'
  | 'palisade'
  | 'tower'
  | 'smithy'
  | 'barracks'
  | 'market';

export type TotemId = 'wolf' | 'bear' | 'eagle';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export interface Villager {
  id: number;
  name: string;
  sex: 'm' | 'f';
  age: number; // в игровых годах
  job: JobId;
  /**
   * Здание, в котором житель работает. null при job === 'idle' и при «вольном сборе» —
   * работе по профессии без профильного здания (вполсилы).
   */
  workplace: number | null;
  /** Врождённый талант: в этой профессии работает эффективнее. */
  talent: JobId | null;
}

export interface Building {
  id: number;
  type: BuildingTypeId;
  /** Текущий уровень, от единицы: все здания стоят с первого дня. */
  level: number;
  /** Накопленная работа текущего улучшения. */
  work: number;
  /** Работа до конца улучшения. 0 — улучшение не идёт. */
  workRequired: number;
}

/** Заказ в казармах. Очередь одна и идёт последовательно, сверху вниз. */
export interface RecruitOrder {
  id: number;
  troop: TroopId;
  /** Сколько бойцов заказано. */
  count: number;
  /** Сколько уже обучено и ушло в армию. */
  done: number;
  /** Накопленная работа над текущим бойцом. */
  work: number;
  /**
   * Жители, ушедшие на учения. Они уже не в племени: не добывают и не строят.
   * Хранятся целиком, чтобы отмена возвращала тех же людей, а не безымянные головы.
   */
  people: Villager[];
}

/**
 * Рынок. Ассортимент не хранится: он выводится из номера дня (см. data/market.ts),
 * поэтому перезагрузка не тасует прилавок заново. Хранить нужно только то, что
 * уже разобрали сегодня — на этом счётчике держатся и дневной лимит, и рост цены.
 */
export interface MarketState {
  /** Игровой день, на который составлен нынешний прилавок. */
  day: number;
  /** Сколько единиц каждого товара уже куплено за этот день. */
  bought: Partial<Record<GoodId, number>>;
}

/**
 * Караван за покупкой. Золото списано при заказе, груза на складе ещё нет:
 * телега выезжает из ворот и возвращается только к `arriveAt`.
 */
export interface Caravan {
  id: number;
  good: GoodId;
  count: number;
  /** Уплаченное золото — ровно столько вернётся при отмене. */
  gold: number;
  /** Игровое время выхода и возвращения, сек. */
  departAt: number;
  arriveAt: number;
}

export interface ActiveEvent {
  defId: string;
  /** Момент появления (игровое время, сек). */
  at: number;
}

export interface LogEntry {
  at: number; // игровое время
  text: string;
  kind: 'info' | 'good' | 'bad' | 'quest';
}

export interface Stats {
  hunts: number;
  battlesWon: number;
  battlesLost: number;
  born: number;
  died: number;
  eventsResolved: number;
  /** Отправлено разведок и набегов — по ним считаются задания про карту. */
  scouted: number;
  raids: number;
  /** Замков, из которых привезли золото. */
  castles: number;
  /** Покупок на рынке. */
  purchases: number;
}

export interface GameState {
  version: number;
  /** Игровое время в секундах (1 игровой день = DAY_LENGTH сек). */
  time: number;
  resources: Resources;
  /** Снаряжение на складе: счётчики, не ограниченные вместимостью. */
  equipment: Equipment;
  /** Армия поселения — счётчики бойцов по видам. */
  army: Army;
  /** Очередь найма в казармах: первый заказ обучается, остальные ждут. */
  recruits: RecruitOrder[];
  /** Что куёт кузница прямо сейчас. null — кузнецы стоят без наряда. */
  forging: EquipmentId | null;
  /** Накопленная работа кузнецов над текущим предметом. */
  forgeWork: number;
  /** Указ вождя: действует, пока выбран. */
  decree: DecreeId;
  /** Рацион племени. */
  ration: RationId;
  /** Уровень налога. */
  tax: TaxId;
  /**
   * Казна племени. Не ресурс: вместимость склада на золото не действует,
   * и чужой набег его не уносит — казну прячут, а не сваливают в амбар.
   */
  gold: number;
  /** Состояние рынка: на какой день собран прилавок и что с него уже взяли. */
  market: MarketState;
  /** Караваны в пути: их груз ещё не на складе. */
  caravans: Caravan[];
  villagers: Villager[];
  buildings: Building[];
  completedQuests: string[];
  activeEvent: ActiveEvent | null;
  nextEventAt: number;
  morale: number; // 0..100
  prestige: number;
  totem: TotemId | null;
  starvation: number; // накопленное время голода, сек
  freezing: number; // накопленное время зимы без дров, сек
  /** Год, за который уже показали предупреждение о зиме (0 — ещё не показывали). */
  winterWarnedYear: number;
  /** Предупреждение «Скоро зима» ждёт показа. */
  winterWarning: boolean;
  growth: number; // накопленный прогресс к появлению нового жителя
  /** Бойцы, ушедшие в поход: деревню они не защищают (см. derived.defense). */
  warriorsAway: number;
  /** Свободные жители, ушедшие разведчиками: они не строят. */
  scoutsAway: number;
  /** Номер текущего шага обучения (см. data/tutorial.ts). */
  tutorialStep: number;
  /** Обучение пройдено или пропущено. */
  tutorialDone: boolean;
  log: LogEntry[];
  stats: Stats;
  nextId: number;
  lastSaved: number; // wall-clock ms
}
