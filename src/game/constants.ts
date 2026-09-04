import type { ResourceId, Resources } from './types';

/** Длина игрового дня в секундах реального времени. */
export const DAY_LENGTH = 60;
/** Через сколько дней жителю прибавляется год. */
export const DAYS_PER_YEAR = 4;
/** Максимум офлайн-прогресса при возвращении в игру. */
export const MAX_OFFLINE_SECONDS = 4 * 3600;
/** Сколько работы строителей нужно накопить для нового жителя. */
export const GROWTH_REQUIRED = 80;
/** Через сколько секунд голода умирает житель. */
export const STARVATION_DEATH = 2 * DAY_LENGTH;
export const BASE_STORAGE_CAP = 120;
export const BASE_HOUSING = 1;
export const EVENT_INTERVAL_MIN = 70;
export const EVENT_INTERVAL_MAX = 140;

/**
 * Потолок уровня здания. Каждый тип строится ровно один раз, поэтому уровни —
 * единственная линия развития постройки, и их должно хватать на всю партию.
 */
export const MAX_BUILDING_LEVEL = 10;
/** Прибавка к выработке каждого рабочего за уровень здания. */
export const LEVEL_OUTPUT_STEP = 0.1;
/**
 * Во сколько раз дорожает улучшение с каждым уровнем. На десяти уровнях
 * 1.4 даёт ×20 к цене последнего шага — дорого, но в пределах склада.
 */
export const UPGRADE_GROWTH = 1.4;
/**
 * Труд одного свободного жителя на стройке в секунду. Больше единицы: племя
 * позднего средневековья строит с инструментом, а не голыми руками.
 */
export const BUILDER_RATE = 1.2;
/**
 * Труд ремесленника в мастерской на улучшениях, в секунду на единицу его
 * множителя. Мастер стоит больше строителя с площади — на этом и держится
 * мастерская.
 */
export const CRAFTER_BUILD = 1.5;
/** Оборона посёлка без единого бойца и здания: щиты и клинки по домам. */
export const BASE_DEFENSE = 7;
/**
 * Мораль устоявшегося племени при прочих равных: тёплая одежда, вождь и обычаи
 * у него уже есть, поэтому база выше половины шкалы.
 */
export const MORALE_BASE = 72;
/**
 * Сколько уровней приходится на одну визуальную ступень здания: 1–3, 4–7, 8–10.
 * Ступеней три, и каждая заметно крупнее предыдущей — см. render/buildings.ts.
 */
export const VISUAL_TIERS: [number, number] = [4, 8];
/**
 * «Вольный сбор»: работа по профессии без профильного здания. Вполсилы, но доступна
 * всегда — новая партия не должна начинаться с нулевым доходом.
 */
export const FREE_RANGE_MULT = 0.5;
/** Насколько эффективнее житель в профессии своего таланта. */
export const TALENT_MULT = 1.5;

/**
 * Работа кузнеца в секунду при множителе 1. Предметы стоят десятки очков
 * (см. data/equipment.ts), поэтому копьё у одного кузнеца в кузнице 1 уровня
 * выходит примерно за 20 секунд.
 */
export const SMITH_WORK = 1;
/** Работа казарм в секунду на первом уровне: скорость найма растёт с уровнем. */
export const RECRUIT_WORK = 1;
/**
 * Сколько ест боец против жителя. Он не добывает и не строит, но кормится
 * из того же котла — армия должна стоить не только людей, но и еды.
 */
export const SOLDIER_FOOD = 1.2;

export const RESOURCE_IDS: ResourceId[] = ['wood', 'stone', 'food', 'hides', 'bones', 'copper', 'iron'];

export const RESOURCE_META: Record<ResourceId, { name: string; icon: string }> = {
  wood: { name: 'Древесина', icon: '🌲' },
  stone: { name: 'Камень', icon: '⛰️' },
  food: { name: 'Еда', icon: '🍖' },
  hides: { name: 'Шкуры', icon: '🦌' },
  bones: { name: 'Кости', icon: '🦴' },
  copper: { name: 'Медь', icon: '🟠' },
  iron: { name: 'Железо', icon: '⚙️' },
};

export const emptyResources = (): Resources => ({
  wood: 0,
  stone: 0,
  food: 0,
  hides: 0,
  bones: 0,
  copper: 0,
  iron: 0,
});
