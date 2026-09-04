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
}

export interface BuildingDef extends BuildingStats {
  id: BuildingTypeId;
  name: string;
  icon: string;
  description: string;
  cost: Partial<Record<ResourceId, number>>;
  /** Работа строителей на 1 уровень (1 свободный житель = 1 работа/сек). */
  work: number;
  /** Профессия, которой здание даёт рабочие места: их столько же, сколько уровней. */
  job?: JobId;
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
  /** Стартовое здание, нельзя построить вручную. */
  starter?: boolean;
}

/**
 * Каждый тип строится ровно один раз — второго такого же в посёлке не бывает.
 * Поэтому все прибавки набираются уровнями: `perLevel` заменяет собой прежнее
 * «поставь ещё одну хижину». Числа подобраны так, чтобы к раннему государству
 * (потолок 10 уровня) население доходило до 40+ человек.
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
    starter: true,
  },
  {
    id: 'shelter',
    name: 'Укрытие',
    icon: '⛺',
    description: 'Навесы для пришлых и подмастерьев: кто ещё не заслужил места под крышей.',
    cost: {},
    work: 0,
    housing: 4,
    maxLevel: 1,
    starter: true,
  },
  {
    id: 'chief_house',
    name: 'Дом вождя',
    icon: '👑',
    description: 'Отсюда правят: указ, рацион, налог и казна. С шестого уровня это уже двор, и в нём живут.',
    cost: { wood: 30, stone: 15 },
    work: 60,
    morale: 4,
    housing: 6,
    perLevel: { morale: 1, housing: 5 },
    since: { housing: 6 },
  },
  {
    id: 'hut',
    name: 'Хижина',
    icon: '🏠',
    description: 'Единственное настоящее жильё племени. Каждый уровень — ещё пять мест под крышей.',
    cost: { wood: 15 },
    work: 30,
    housing: 6,
    perLevel: { housing: 5 },
  },
  {
    id: 'storage',
    name: 'Склад',
    icon: '🧺',
    description: 'Всё добро племени: запасы, снаряжение, прирост и место под них.',
    cost: { wood: 20, stone: 8 },
    work: 40,
    storage: 220,
    perLevel: { storage: 150 },
  },
  {
    id: 'gathering',
    name: 'Навес собирателей',
    icon: '🍓',
    description: 'Место, куда сносят ягоды и коренья. Даёт работу собирателям.',
    cost: { wood: 10 },
    work: 20,
    job: 'gatherer',
  },
  {
    id: 'sawmill',
    name: 'Лесопилка',
    icon: '🪓',
    description: 'Пилы, козлы и штабель брёвен. Даёт работу лесорубам.',
    cost: { wood: 12 },
    work: 25,
    job: 'woodcutter',
  },
  {
    id: 'quarry',
    name: 'Каменоломня',
    icon: '⛏️',
    description: 'Разработка у скал. Даёт работу каменотёсам.',
    cost: { wood: 10, stone: 5 },
    work: 30,
    job: 'stonecutter',
  },
  {
    id: 'hunter_hut',
    name: 'Охотничий домик',
    icon: '🏹',
    description: 'Сушила для шкур и стойка для копий. Даёт работу охотникам.',
    cost: { wood: 14, bones: 4 },
    work: 35,
    job: 'hunter',
  },
  {
    id: 'mine',
    name: 'Рудник',
    icon: '🕳️',
    description: 'Штольня в скале: медь и железо.',
    cost: { wood: 40, stone: 30 },
    work: 90,
    job: 'miner',
  },
  {
    id: 'workshop',
    name: 'Мастерская',
    icon: '🛠️',
    description: 'Даёт работу ремесленникам: они ускоряют улучшения зданий по всему посёлку.',
    cost: { wood: 25, stone: 10 },
    work: 50,
    job: 'crafter',
  },
  {
    id: 'farm',
    name: 'Ферма',
    icon: '🌾',
    description: 'Поле под ячмень. Каждый уровень — новая полоса и ещё один фермер.',
    cost: { wood: 30, stone: 5 },
    work: 60,
    job: 'farmer',
  },
  {
    id: 'pen',
    name: 'Загон',
    icon: '🐐',
    description: 'Козы и овцы под присмотром пастуха. Зима стаду почти не помеха.',
    cost: { wood: 40, hides: 5 },
    work: 60,
    job: 'herder',
  },
  {
    id: 'totem',
    name: 'Тотем',
    icon: '🗿',
    description: 'Святилище племени. Мораль +8, место шамана.',
    cost: { wood: 20, bones: 10 },
    work: 40,
    morale: 8,
    perLevel: { morale: 2 },
    job: 'shaman',
  },
  {
    id: 'palisade',
    name: 'Частокол',
    icon: '🧱',
    description: 'Стена вокруг поселения. Защита +6, и растёт с каждым уровнем. С четвёртого уровня стена каменная.',
    cost: { wood: 70 },
    work: 90,
    defense: 6,
    perLevel: { defense: 3 },
  },
  {
    id: 'tower',
    name: 'Башня',
    icon: '🗼',
    description: 'Дозорная вышка сбоку от ворот. Защита +4, и растёт с каждым уровнем.',
    cost: { wood: 40, stone: 30 },
    work: 70,
    defense: 4,
    perLevel: { defense: 3 },
  },
  {
    id: 'smithy',
    name: 'Кузница',
    icon: '⚒️',
    description: 'Горн и наковальня. Кузнецы куют снаряжение — то, чем платят за войско.',
    cost: { wood: 50, stone: 60 },
    work: 120,
    job: 'smith',
  },
  {
    id: 'market',
    name: 'Рынок',
    icon: '🛒',
    description: 'Торговый двор у самых ворот. За золото сюда привозят чужое добро — дороже, чем своё, зато сразу.',
    cost: { wood: 90, stone: 70, iron: 20 },
    work: 150,
    morale: 2,
    perLevel: { morale: 1 },
  },
  {
    id: 'barracks',
    name: 'Казармы',
    icon: '⚔️',
    description: 'Двор для учений. Здесь свободные жители становятся бойцами. Защита +2 за уровень.',
    cost: { wood: 60, stone: 30 },
    work: 110,
    defense: 2,
    perLevel: { defense: 2 },
  },
];

export const BUILDING_BY_ID: Record<BuildingTypeId, BuildingDef> = Object.fromEntries(
  BUILDINGS.map((b) => [b.id, b]),
) as Record<BuildingTypeId, BuildingDef>;
