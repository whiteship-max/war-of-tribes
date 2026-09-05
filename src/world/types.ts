// Домен общей карты мира. Ничего не знает ни о React, ни о three, ни о том,
// откуда приходят данные: локальная генерация сейчас или сервер потом.
// Единственная связь с симуляцией племени — словарь ресурсов: добыча и грабёж
// говорят на одном языке со складом.
import type { ResourceId } from '@/game/types';
import type { TroopStack } from '@/game/battle/kinds';
import type { ArmySetup, BattleResult, QuickPresetId, Side, Stack, UnitKind } from '@/battle';

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

/**
 * Добыча. Кроме ресурсов сюда может попасть золото — но только из замка и только
 * после того, как племя узнало о деньгах. Обратно золото не ходит: чужой набег
 * уносит со склада ресурсы, а казну не трогает (её прячут, а не сваливают в амбар).
 */
export type Loot = Partial<Record<ResourceId | 'gold', number>>;

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
  /**
   * Во сколько раз медленнее стареет этот снимок. Записывается в момент разведки
   * по уровню Дозора: данные, собранные хорошим дозором, и остаются хорошими.
   * Пусто — как без дозора (единица).
   */
  keen?: number;
  /** Кого разглядели — по родам полевого боя, в бойцах строя. */
  kinds?: Stack;
  /**
   * Как противник стоял: шесть секторов без резерва. Резерв и условие его ввода
   * разведка не показывает — это единственная по-настоящему скрытая вещь в игре.
   */
  formation?: Partial<Record<string, Stack>>;
  /** Уклад войска словами: «копейная стена», «конная дружина». */
  style?: string;
}

export interface IntelReading {
  at: number;
  ageSeconds: number;
  precision: Precision;
  power: Estimate;
  pop: Estimate;
  loot: Estimate;
  /** Численность по родам с той точностью, что осталась. null — состав не разглядели. */
  kinds: Partial<Record<UnitKind, Estimate>> | null;
  /** Построение по секторам. null — данные слишком стары: построение уже не то. */
  formation: Partial<Record<string, Stack>> | null;
  style: string | null;
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
  /** Замок: цель с казной, крепче обычного поселения. */
  castle: boolean;
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
  /** Состав отряда по видам бойцов племени. Пусто у чужих отрядов. */
  troops?: TroopStack;
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
  /** Кто именно идёт: без этого бой не знает состава и считает отряд пехотой. */
  troops?: TroopStack;
  /**
   * Расстановка, план, приказы и резерв. null или пусто — быстрая атака: пресет
   * выберется по сиду похода, и противник не знает, какой из четырёх пришёл.
   */
  setup?: ArmySetup | null;
}

export interface SendResult {
  /** Текст ошибки или null. */
  error: string | null;
  march: MarchView | null;
}

export type ReportKind = 'raid' | 'scout' | 'support' | 'defense';

/**
 * Бой целиком: журнал, потери по секторам и исход. Отчёт на экране строится из
 * него, а не из чисел рядом, — событие, которого нет в журнале, в отчёт не попадёт.
 */
export interface BattleRecord {
  /** За какую сторону играл игрок. */
  us: Side;
  /** Пресет быстрой атаки, если расстановку не задавали. */
  preset: QuickPresetId | null;
  result: BattleResult;
}

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
  /** Полевой бой с журналом. null — боя не было (разведка, поддержка). */
  battle: BattleRecord | null;
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
  /** Кого именно недосчитались: бой знает состав, и списывать надо тех же. */
  lostTroops?: TroopStack;
  /** Плюс — привезли, минус — унесли. */
  resources: Loot;
  prestige: number;
  morale: number;
  /** Настоящий бой — для летописи побед и поражений. null — боя не было. */
  battle: 'won' | 'lost' | null;
  /**
   * Насколько плохо кончился бой у стены, 0..1. Мир не знает, что с этим числом
   * сделает племя, и знать не должен: у него это просто мера того, насколько
   * чужие похозяйничали вокруг деревни.
   */
  sacked?: number;
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
  /** Гарнизон по видам бойцов: из него собирается оборона в бою. */
  army?: TroopStack;
  /** Что даёт оборону помимо бойцов — частокол, башня, сами жители. В поле это ополчение. */
  militia?: number;
  /** Сколько из этого ополчения стоит стрелками: столько людей ставит на стену башня. */
  militiaArchers?: number;
  /** Как деревня встречает набег. null — обороняется тем, что вышло само. */
  defenseSetup?: ArmySetup | null;
  /** Что доступно к отправке. */
  units: UnitStack;
  /**
   * Что можно у игрока отнять. Золота здесь нет: казну набегом не берут. Того,
   * что лежит в тайнике, здесь тоже нет — мир про это добро просто не знает,
   * поэтому и унести его не может (см. bridge.playerProfile).
   */
  resources: Loot;
  /** Насколько дольше видно чужую армию до прихода, секунд. Работа Дозора. */
  warning?: number;
  /** Во сколько раз медленнее стареет разведка игрока. Тоже Дозор. */
  intelKeen?: number;
  /** Ступень снаряжения, которую конюшня добавляет коннице игрока. */
  mountGear?: number;
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
