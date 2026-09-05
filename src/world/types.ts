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

/** Три фигуры на карте, по одной каждой. Список закрыт: вторых полководцев нет. */
export type FigureId = 'scout' | 'diplomat' | 'general';

/** Что фигура делает прямо сейчас. */
export type FigurePhase =
  /** Дома, у своего поселения. */
  | 'home'
  /** В пути к назначенной клетке. */
  | 'moving'
  /** Стоит в поле или у чужого поселения. */
  | 'field'
  /** Погибла и возвращается: через положенное время встанет дома. */
  | 'down';

/** Договоры дипломата. Порядок — от простого к трудному (см. data/figures.ts). */
export type DealId = 'truce' | 'trade' | 'tribute' | 'alliance';

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
  /**
   * Клетка в обзоре прямо сейчас: живые данные настоящие. Ложь — показано
   * последнее увиденное, и это надо сказать игроку словами, а не молча.
   */
  visible: boolean;
  /** Когда живые данные видели в последний раз, мс. null — никогда. */
  seenAt: number | null;
  /** Живые данные устарели: `visible` ложно, а память о месте есть. */
  stale: boolean;
  /**
   * Численность на момент последнего взгляда. null — не разглядели ни разу.
   * Имя отдельное от `SettlementCard.pop` нарочно: там оценка с точностью, здесь
   * то самое число, которое видели своими глазами.
   */
  seenPop: number | null;
  /** Оттуда прямо сейчас выходит войско. Видно только пока клетка в обзоре. */
  marching: boolean;
}

/** Кусок карты. Ландшафт идёт компактным массивом: на сервере это будет то же самое. */
export interface RegionChunk {
  rect: Rect;
  /** Индексы TERRAIN_ORDER по клеткам, построчно: i = (y - rect.y) * rect.w + (x - rect.x). */
  terrain: Uint8Array;
  /**
   * Разведанная местность тем же порядком: 1 — клетка открыта навсегда.
   * Рельеф приезжает и для закрытых клеток: мир живёт на клиенте, и утаивать
   * от него то, что он сам считает из сида, бессмысленно. Правда — эта маска,
   * по ней карта и рисует дымку; на сервере он же обрежет и рельеф.
   */
  explored: Uint8Array;
  /**
   * Признаки местности тем же порядком: биты `FEATURE` из `world/geography.ts` —
   * река, мост, брод, хребет, перевал, тракт и его колея. Рисуются они и на
   * дальнем масштабе, и на ближнем, поэтому едут вместе с ландшафтом, а не
   * считаются на карте заново: считать одно и то же двумя способами — верный
   * путь к тому, что мост на картинке окажется не там, где мост в расчёте пути.
   */
  features: Uint8Array;
  /**
   * Чья это земля: 0 — ничья, иначе номер племени плюс единица (цвет берётся из
   * `TRIBE_COLORS` по тому же номеру). **Заполняется только для разведанных
   * клеток.** В тумане здесь всегда ноль, и это не украшение интерфейса, а
   * правило: цвет чужого владения — такие же разведданные, как численность
   * гарнизона, и узнавать их, не заглянув туда, нельзя.
   */
  influence: Uint8Array;
  /** Поселения, о которых игрок уже знает. Закрытых клеток здесь нет. */
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
  /** Какие фигуры стоят у этой цели вплотную — им и доступны здешние действия. */
  figuresHere: FigureId[];
  /** Договоры с племенем цели, действующие прямо сейчас. */
  deals: DealView[];
  /** Какие действия имеют смысл для этой цели. */
  can: Record<Mission | 'open', boolean>;
  /** Почему действий нет; null — всё доступно. */
  note: string | null;
}

/** Договор с чужим племенем, подписанный дипломатом. */
export interface DealView {
  id: DealId;
  tribeId: TribeId;
  tribeName: string;
  /** До какого момента он в силе, мс. */
  until: number;
}

/**
 * Фигура на карте. Положение считается из времени выхода и времени прибытия —
 * ровно как у похода. Поэтому фигура, шедшая, пока игрока не было, оказывается
 * там же, где оказалась бы при непрерывной игре: догон ничего не «доигрывает».
 */
export interface FigureView {
  id: FigureId;
  name: string;
  icon: string;
  phase: FigurePhase;
  /** Где она сейчас: в пути — точка между `from` и `to`. */
  at: Coord;
  from: Coord;
  to: Coord;
  departAt: number;
  arriveAt: number;
  /** Радиус обзора в клетках. */
  sight: number;
  /** Поселение, у которого фигура стоит вплотную. null — чистое поле. */
  atId: SettlementId | null;
  atName: string | null;
  /** Стоит у своего поселения: полководец здесь меняет состав. */
  atHome: boolean;
  /** Когда павшая фигура вернётся в строй, мс. 0 — она в строю. */
  downUntil: number;
  /** Войско при полководце. Пусто у остальных двоих. */
  troops: TroopStack;
  /** Мощь этого войска: её же вычитают из обороны деревни. */
  power: number;
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

/**
 * Приказ полководцу ударить по поселению, у которого он стоит. Цели в приказе
 * нет нарочно: она выведена из того, где он стоит, — иначе появился бы второй
 * способ назначить цель, и они разошлись бы.
 */
export interface AttackOrder {
  /**
   * Расстановка, план, приказы и резерв. null — быстрая атака: пресет выберется
   * по сиду, и противник не знает, какой из четырёх пришёл.
   */
  setup?: ArmySetup | null;
}

export interface AttackResult {
  /** Текст ошибки или null. */
  error: string | null;
  /** Отчёт о бое: его же кладут в список отчётов. */
  reportId: string | null;
  won: boolean;
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
  /** Три фигуры целиком: их положение выводится из времени, а не из тика. */
  figures: FigureView[];
  /** Новые отчёты — их ещё не видели. */
  reports: Report[];
  /** Последствия для деревни: применяет игровая сторона. */
  effects: HomeEffect[];
  unread: number;
}
