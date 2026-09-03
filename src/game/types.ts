// Базовые типы состояния игры. Симуляция не зависит от рендера и UI.
import type { DecreeId, RationId } from './data/policy';

export type ResourceId = 'wood' | 'stone' | 'food' | 'hides' | 'bones' | 'copper' | 'iron';
export type Resources = Record<ResourceId, number>;

/**
 * Снаряжение. Счётчики того же рода, что и ресурсы, но живут отдельно:
 * вместимость склада на них не действует, и чужой набег их не уносит — см. data/equipment.ts.
 */
export type EquipmentId = 'spear' | 'bow' | 'axe' | 'shield' | 'sword' | 'armor';
export type Equipment = Record<EquipmentId, number>;

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
  | 'scholar'
  | 'shaman';

export type BuildingTypeId =
  | 'campfire'
  | 'shelter'
  | 'chief_house'
  | 'hut'
  | 'storage'
  | 'knowledge'
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
  | 'barracks';

export type TechBranch = 'settlement' | 'craft' | 'war' | 'society';

export type TechId =
  // ремесло
  | 'stone_tools'
  | 'woodworking'
  | 'bone_tools'
  | 'leatherworking'
  | 'metallurgy'
  | 'iron_working'
  // поселение
  | 'housing'
  | 'farming'
  | 'animal_husbandry'
  | 'palisade'
  | 'towers'
  // война
  | 'spears'
  | 'bows'
  | 'warband'
  | 'axes'
  | 'shields'
  | 'bronze_weapons'
  | 'swords'
  | 'armor'
  // общество
  | 'chiefdom'
  | 'shamanism'
  | 'totem'
  | 'traditions'
  | 'statehood';

/**
 * Эпоха — технический уровень племени. Двигается только технологиями и задаёт
 * потолок уровней зданий и материалы построек. В строке состояния её нет:
 * там стоит стадия поселения (см. StageId). Эпоху показывают в Доме вождя.
 */
export type EraId = 'camp' | 'stone' | 'tribe' | 'bronze' | 'iron' | 'state';

/** Стадия поселения — единственная видимая игроку шкала прогресса. */
export type StageId = 'camp' | 'tribal' | 'village' | 'fortified' | 'town';

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
  /**
   * Место на карте поселения. Оставлено для старых сохранений: место здания
   * теперь выводится из его типа по фиксированному плану (render/plan.ts).
   */
  slot: number;
  /** Текущий уровень. 0 — здание ещё строится и не работает. */
  level: number;
  /** Накопленная работа текущей стройки или улучшения. */
  work: number;
  /** Работа до конца стройки. 0 — стройка не идёт. */
  workRequired: number;
}

export interface Research {
  techId: TechId;
  work: number;
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
  villagers: Villager[];
  buildings: Building[];
  techs: TechId[];
  research: Research | null;
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
