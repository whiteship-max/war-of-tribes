// Домен общей карты мира. Ничего не знает ни о React, ни о three, ни о том,
// откуда приходят данные: локальная генерация сейчас или сервер потом.
// Единственная связь с симуляцией племени — словарь ресурсов: добыча и грабёж
// говорят на одном языке со складом.
import type { ResourceId } from '@/game/types';

export interface Coord {
  x: number;
  y: number;
}

/** Прямоугольник клеток: левый верхний угол и размеры. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SettlementId = string;
export type TribeId = string;

export type Terrain = 'plain' | 'forest' | 'hills' | 'water';

/** Стадия развития поселения. Читается по иконке на карте — главный способ оценить цель. */
export type Stage = 'camp' | 'village' | 'stronghold' | 'town';

export type Relation = 'self' | 'ally' | 'neutral' | 'enemy' | 'barbarian';

export type UnitId = 'scout' | 'warrior';
export type UnitStack = Partial<Record<UnitId, number>>;

export type Mission = 'raid' | 'scout' | 'support';

/** Куда идёт отряд: к цели, стоит поддержкой, возвращается. */
export type MarchPhase = 'out' | 'stay' | 'back';

export type Loot = Partial<Record<ResourceId, number>>;

/** Точность числа: со временем разведданные грубеют и в конце пропадают. */
export type Precision = 'exact' | 'rough' | 'vague' | 'unknown';

export interface Estimate {
  precision: Precision;
  /** Точное значение; null для всего, кроме 'exact'. */
  value: number | null;
  min: number;
  max: number;
}

/** Снимок чужого поселения, сделанный разведкой или боем. */
export interface Intel {
  /** Момент получения (wall-clock, мс). */
  at: number;
  power: number;
  pop: number;
  /** Сколько добра было видно на момент разведки. */
  loot: number;
}

export interface IntelReading {
  at: number;
  ageSeconds: number;
  precision: Precision;
  power: Estimate;
  pop: Estimate;
  loot: Estimate;
}

/** Поселение как оно видно на карте — без разведки. */
export interface SettlementView {
  id: SettlementId;
  x: number;
  y: number;
  name: string;
  stage: Stage;
  relation: Relation;
  /** Имя владельца-бота; null у варварских лагерей. */
  owner: string | null;
  tribeId: TribeId | null;
  tribeName: string | null;
  /** Цвет отношения — им поселение красится на карте (см. RELATION_META). */
  color: string;
  mine: boolean;
}

/** Кусок карты. Ландшафт идёт компактным массивом: на сервере это будет то же самое. */
export interface RegionChunk {
  rect: Rect;
  /** Индексы TERRAIN_ORDER по клеткам, построчно: i = (y - rect.y) * rect.w + (x - rect.x). */
  terrain: Uint8Array;
  settlements: SettlementView[];
}

export interface SettlementCard extends SettlementView {
  terrain: Terrain;
  /** Расстояние от деревни игрока, клеток. */
  distance: number;
  /** Средняя проходимость по прямой до цели: 1 — равнина, больше — медленнее. */
  terrainFactor: number;
  /** Мощь гарнизона: своя всегда точная, чужая — только из разведки. */
  power: Estimate;
  pop: Estimate;
  intel: IntelReading | null;
  /** Какие действия имеют смысл для этой цели. */
  can: Record<Mission | 'open', boolean>;
  /** Почему действий нет; null — всё доступно. */
  note: string | null;
}

export interface MarchView {
  id: string;
  mission: Mission;
  units: UnitStack;
  /** Свой отряд или чужой. */
  own: boolean;
  /** Идёт на деревню игрока. */
  hostile: boolean;
  phase: MarchPhase;
  from: Coord;
  to: Coord;
  fromName: string;
  toName: string;
  targetId: SettlementId;
  /** Wall-clock, мс: когда вышли и когда придут. */
  departAt: number;
  arriveAt: number;
  loot: Loot | null;
  recallable: boolean;
}

export interface MarchOrder {
  target: SettlementId;
  mission: Mission;
  units: UnitStack;
}

export interface SendResult {
  /** Текст ошибки или null. */
  error: string | null;
  march: MarchView | null;
}

export type ReportKind = 'raid' | 'scout' | 'support' | 'defense';

export interface Report {
  id: string;
  at: number;
  kind: ReportKind;
  title: string;
  target: { id: SettlementId; name: string; x: number; y: number };
  won: boolean;
  sent: UnitStack;
  lost: UnitStack;
  /** Мощь противника в бою и сколько её снесли. null — боя не было. */
  enemyPower: number | null;
  enemyLost: number | null;
  loot: Loot | null;
  /** Что удалось разглядеть. */
  intel: Intel | null;
  text: string;
  read: boolean;
}

/**
 * Что мир требует применить к деревне игрока: погибших, добычу, награбленное у него.
 * Мир считает исход, племя применяет последствия — так расчёт переедет на сервер целиком.
 */
export interface HomeEffect {
  id: string;
  lost: UnitStack;
  /** Плюс — привезли, минус — унесли. */
  resources: Loot;
  prestige: number;
  morale: number;
  /** Настоящий бой — для летописи побед и поражений. null — боя не было. */
  battle: 'won' | 'lost' | null;
  text: string;
  good: boolean;
}

/**
 * Слепок деревни игрока для мира: мир не лезет в состояние племени сам.
 * На сервере эти данные будут его собственными, а метод sync станет heartbeat-ом.
 */
export interface PlayerProfile {
  name: string;
  pop: number;
  /** Оборона прямо сейчас — без тех, кто в походе. */
  defense: number;
  /** Сила одного воина с нынешними технологиями. */
  warriorPower: number;
  /** Что доступно к отправке. */
  units: UnitStack;
  /** Что можно у игрока отнять. */
  resources: Loot;
}

export interface TribeInfo {
  id: TribeId;
  name: string;
  color: string;
  relation: Relation;
  /** 0..100 — накопленная враждебность к игроку. */
  hostility: number;
  settlements: number;
}

export interface WorldInfo {
  seed: number;
  size: number;
  /** Левый верхний угол сетки в отображаемых координатах. */
  origin: Coord;
  home: Coord;
  homeId: SettlementId;
  createdAt: number;
}

/** Что изменилось с прошлого обращения. */
export interface WorldPulse {
  now: number;
  marches: MarchView[];
  /** Новые отчёты — их ещё не видели. */
  reports: Report[];
  /** Последствия для деревни: применяет игровая сторона. */
  effects: HomeEffect[];
  unread: number;
}
