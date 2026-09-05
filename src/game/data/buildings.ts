import type { BuildingTypeId, JobId, ResourceId } from '../types';

/** Пассивные эффекты здания — растут не множителем, а прибавкой за уровень. */
export interface BuildingStats {
  /** Сколько жителей может жить. */
  housing?: number;
  /** Прибавка вместимости склада. */
  storage?: number;
  /** Защита поселения. */
  defense?: number;
  /** Постоянный бонус к морали. */
  morale?: number;
  /**
   * Сколько ополченцев выходит стрелками, а не пехотой. Это и есть работа башни:
   * частокол даёт плоскую оборону, башня — стрелков на ней. Число не добавляет
   * людей, а переводит часть уже посчитанного ополчения в другой род боя
   * (см. world/bridge.militiaArchers).
   */
  archers?: number;
}

export interface BuildingDef extends BuildingStats {
  id: BuildingTypeId;
  name: string;
  icon: string;
  description: string;
  /**
   * База цены улучшений: подъём до уровня L стоит cost × UPGRADE_GROWTH^(L−1)
   * ресурсов и столько же раз больше труда, чем `work` (см. derived.upgradeCost).
   */
  cost: Partial<Record<ResourceId, number>>;
  /** База труда строителей на улучшение. */
  work: number;
  /** Профессия, которой здание даёт рабочие места. */
  job?: JobId;
  /**
   * Рабочих мест за уровень. По умолчанию `SLOTS_PER_LEVEL`. Своё число нужно
   * там, где толпа бессмысленна: у горна, у верстака и в церкви людей помещается
   * заметно меньше, чем на поле или в лесу.
   */
  slotsPerLevel?: number;
  /** Прибавка пассивных эффектов за каждый уровень сверх первого. */
  perLevel?: BuildingStats;
  /**
   * С какого уровня эффект вообще появляется. По умолчанию с первого.
   * Дом вождя так и раздаёт жильё: сначала это дом одного человека, и только
   * с шестого уровня — двор с людьми (см. buildingStat).
   */
  since?: Partial<Record<keyof BuildingStats, number>>;
  /** Потолок уровня для этого типа. По умолчанию MAX_BUILDING_LEVEL. */
  maxLevel?: number;
}

/**
 * Каждого типа в посёлке ровно одно здание, и все они стоят с первого дня.
 * Поэтому все прибавки набираются уровнями: `perLevel` заменяет собой прежнее
 * «поставь ещё одну хижину».
 *
 * Масштаб: игра идёт к боям в сотни бойцов, поэтому на потолке (10 уровень)
 * посёлок держит порядка семисот жителей, а рабочих мест даёт чуть больше —
 * выбор, кого куда поставить, должен оставаться выбором. Цены и труд подняты
 * под этот же порядок: производство при семи сотнях рабочих выросло примерно
 * в тридцать раз против прежнего.
 */
export const BUILDINGS: BuildingDef[] = [
  {
    id: 'campfire',
    name: 'Костёр',
    icon: '🔥',
    description: 'Сердце посёлка. Отсюда людей отправляют на вольный сбор, здесь же видно настроение племени.',
    cost: {},
    work: 0,
    maxLevel: 1,
  },
  {
    id: 'chief_house',
    name: 'Дом вождя',
    icon: '👑',
    description: 'Отсюда правят: указ, рацион, налог и казна. С шестого уровня это уже двор, и в нём живут.',
    cost: { wood: 364, stone: 182 },
    work: 728,
    morale: 4,
    housing: 40,
    perLevel: { morale: 1, housing: 30 },
    since: { housing: 6 },
  },
  {
    id: 'houses',
    name: 'Жилища',
    icon: '🏘️',
    description: 'Дворы племени: не один дом, а улица домов. Каждый уровень — ещё шесть десятков мест под крышей.',
    cost: { wood: 182, stone: 42 },
    work: 364,
    // Сюда же ушли двадцать пять мест бывшего укрытия: плоская прибавка без
    // цены и без уровня была подпоркой старого племенного старта.
    housing: 45,
    perLevel: { housing: 60 },
  },
  {
    id: 'storage',
    name: 'Склад',
    icon: '🧺',
    description: 'Всё добро племени: запасы, снаряжение, прирост и место под них.',
    cost: { wood: 238, stone: 98 },
    work: 490,
    storage: 3600,
    perLevel: { storage: 3200 },
  },
  {
    id: 'gathering',
    name: 'Навес собирателей',
    icon: '🍓',
    description: 'Место, куда сносят ягоды и коренья. Даёт работу собирателям.',
    cost: { wood: 119 },
    work: 245,
    job: 'gatherer',
  },
  {
    id: 'sawmill',
    name: 'Лесопилка',
    icon: '🪓',
    description: 'Пилы, козлы и штабель брёвен. Даёт работу лесорубам.',
    cost: { wood: 140 },
    work: 301,
    job: 'woodcutter',
  },
  {
    id: 'quarry',
    name: 'Каменоломня',
    icon: '⛏️',
    description: 'Разработка у скал. Даёт работу каменотёсам.',
    cost: { wood: 119, stone: 63 },
    work: 364,
    job: 'stonecutter',
  },
  {
    id: 'hunter_hut',
    name: 'Охотничий домик',
    icon: '🏹',
    description: 'Сушила для шкур и стойка для копий. Даёт работу охотникам.',
    cost: { wood: 168, bones: 49 },
    work: 420,
    job: 'hunter',
  },
  {
    id: 'mine',
    name: 'Рудник',
    icon: '🕳️',
    description: 'Штольня в скале: медь и железо.',
    cost: { wood: 476, stone: 364 },
    work: 1092,
    job: 'miner',
  },
  {
    id: 'workshop',
    name: 'Мастерская',
    icon: '🛠️',
    description: 'Даёт работу ремесленникам: они ускоряют улучшения зданий по всему посёлку.',
    cost: { wood: 301, stone: 119 },
    work: 602,
    job: 'crafter',
    slotsPerLevel: 6,
  },
  {
    id: 'farm',
    name: 'Ферма',
    icon: '🌾',
    description: 'Поле под ячмень. Каждый уровень — новая полоса и дюжина рук на ней.',
    cost: { wood: 364, stone: 63 },
    work: 728,
    job: 'farmer',
  },
  {
    id: 'pen',
    name: 'Загон',
    icon: '🐐',
    description: 'Козы и овцы под присмотром пастуха. Зима стаду почти не помеха.',
    cost: { wood: 476, hides: 63 },
    work: 728,
    job: 'herder',
  },
  {
    id: 'church',
    name: 'Церковь',
    icon: '⛪',
    description: 'Главный дом духа племени: здесь служат жрецы и здесь раз и навсегда выбирают покровителя.',
    cost: { wood: 238, bones: 119 },
    work: 490,
    morale: 8,
    perLevel: { morale: 2 },
    job: 'priest',
    slotsPerLevel: 2,
  },
  {
    id: 'palisade',
    name: 'Частокол',
    icon: '🧱',
    description: 'Кольцо укреплений. Даёт посёлку плоскую оборону и выводит в поле ополчение. С четвёртого уровня стена каменная.',
    cost: { wood: 840, stone: 168 },
    work: 1092,
    defense: 40,
    perLevel: { defense: 24 },
  },
  {
    id: 'tower',
    name: 'Башня',
    icon: '🗼',
    description: 'Вышка над воротами. Обороны даёт мало, зато ставит часть ополчения стрелками: с неё бьют, а не машут дубиной.',
    cost: { wood: 476, stone: 364 },
    work: 854,
    defense: 10,
    archers: 6,
    perLevel: { defense: 5, archers: 6 },
  },
  {
    id: 'smithy',
    name: 'Кузница',
    icon: '⚒️',
    description: 'Горн и наковальня. Кузнецы куют снаряжение — то, чем платят за войско.',
    cost: { wood: 602, stone: 728 },
    work: 1456,
    job: 'smith',
    slotsPerLevel: 4,
  },
  {
    id: 'market',
    name: 'Рынок',
    icon: '🛒',
    description: 'Торговый двор у самых ворот. За золото сюда привозят чужое добро — дороже, чем своё, зато сразу.',
    cost: { wood: 1092, stone: 840, iron: 238 },
    work: 1820,
    morale: 2,
    perLevel: { morale: 1 },
  },
  {
    id: 'barracks',
    name: 'Казармы',
    icon: '⚔️',
    description: 'Двор для учений. Здесь свободные жители становятся бойцами. Каждый уровень ускоряет учения и добавляет защиты.',
    cost: { wood: 728, stone: 364 },
    work: 1330,
    defense: 10,
    perLevel: { defense: 10 },
  },
];

export const BUILDING_BY_ID: Record<BuildingTypeId, BuildingDef> = Object.fromEntries(
  BUILDINGS.map((b) => [b.id, b]),
) as Record<BuildingTypeId, BuildingDef>;
