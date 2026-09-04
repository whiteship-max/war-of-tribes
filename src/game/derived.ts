// Производные величины от состояния: вместимость, скорости, модификаторы.
import type {
  Building,
  BuildingTypeId,
  Caravan,
  EquipmentId,
  GameState,
  GoodId,
  JobId,
  ResourceId,
  Resources,
  Season,
} from './types';
import {
  BASE_DEFENSE,
  BASE_HOUSING,
  BASE_STORAGE_CAP,
  BUILDER_RATE,
  CRAFTER_BUILD,
  DAY_LENGTH,
  FREE_RANGE_MULT,
  LEVEL_OUTPUT_STEP,
  MAX_BUILDING_LEVEL,
  MORALE_BASE,
  RECRUIT_WORK,
  RESOURCE_IDS,
  SHAMAN_MORALE,
  SHAMAN_MORALE_CAP,
  SLOTS_PER_LEVEL,
  SMITH_WORK,
  SOLDIER_FOOD,
  UPGRADE_GROWTH,
  VILLAGER_DEFENSE,
  emptyResources,
} from './constants';
import { BUILDING_BY_ID, type BuildingDef, type BuildingStats } from './data/buildings';
import { FREE_JOBS, JOBS, JOB_BY_ID } from './data/jobs';
import { EQUIPMENT_BY_ID, type EquipmentDef } from './data/equipment';
import { TROOP_BY_ID, TROOP_IDS } from './data/troops';
import { DECREE_BY_ID, RATION_BY_ID, TAXES, TAX_BY_ID, TAX_PER_POP, type DecreeDef, type RationDef, type TaxDef } from './data/policy';
import {
  CARAVAN_BASE,
  CARAVAN_PER_LEVEL,
  GOODS,
  GOOD_BY_ID,
  batchCost,
  goodMaterials,
  goodPrice,
  goodStock,
  offerFor,
  type GoodDef,
} from './data/market';
import {
  FIRST_WINTER_SOFTEN,
  FREEZING_MORALE_PENALTY,
  HEATING_CAMPFIRE,
  HEATING_SHELTERED,
  SEASONS,
  SEASON_DAYLIGHT,
  SEASON_DAYS,
  SEASON_MODIFIERS,
  SEASON_SECONDS,
  type SeasonModifiers,
} from './data/seasons';

/** На здании идёт улучшение. */
export const isSite = (b: Building): boolean => b.workRequired > 0;

export const buildingById = (s: GameState, id: number): Building | null =>
  s.buildings.find((b) => b.id === id) ?? null;

/** Единственное здание этого типа. Второго такого в посёлке не бывает. */
export const buildingOfType = (s: GameState, type: BuildingTypeId): Building | null =>
  s.buildings.find((b) => b.type === type) ?? null;

/** Первое улучшение в очереди — над ним работают свободные жители. */
export const currentSite = (s: GameState): Building | null => s.buildings.find(isSite) ?? null;

// ---------- Уровни, слоты, улучшения ----------

/** Множитель выработки рабочего от уровня здания: +10% за уровень. */
export const levelOutputMult = (level: number): number => 1 + LEVEL_OUTPUT_STEP * Math.max(0, level - 1);

/**
 * Рабочих мест в здании. Личного навыка у жителя нет — всю его роль взял на себя
 * уровень здания: он и добавляет места, и поднимает выработку каждому рабочему.
 */
export function buildingSlots(b: Building): number {
  const def = BUILDING_BY_ID[b.type];
  return def.job ? b.level * (def.slotsPerLevel ?? SLOTS_PER_LEVEL) : 0;
}

/** Сколько человек работает в этом здании. Назначение — число, а не список людей. */
export const workerCount = (s: GameState, buildingId: number): number =>
  Math.max(0, Math.floor(s.workers?.[buildingId] ?? 0));

/** Сколько человек занято этой работой вольным сбором — без места в здании. */
export const freeJobCount = (s: GameState, job: JobId): number =>
  Math.max(0, Math.floor(s.freeJobs?.[job] ?? 0));

/** Сколько человек вообще при деле: в зданиях и на вольном сборе. */
export function busyCount(s: GameState): number {
  let n = 0;
  for (const b of s.buildings) n += workerCount(s, b.id);
  for (const job of FREE_JOBS) n += freeJobCount(s, job);
  return n;
}

/** Свободные руки: те, кого видно у костра и кем строят. */
export const idleCount = (s: GameState): number => Math.max(0, s.pop - busyCount(s));

/**
 * Пассивный эффект здания с учётом уровня: база + прибавка за каждый уровень сверх
 * того, с которого эффект вообще появляется (`since`). У большинства зданий это
 * первый уровень; у Дома вождя жильё начинается с шестого.
 */
export function buildingStat(b: Building, key: keyof BuildingStats): number {
  const def = BUILDING_BY_ID[b.type];
  const base = def[key] ?? 0;
  if (base === 0) return 0;
  const from = def.since?.[key] ?? 1;
  if (b.level < from) return 0;
  return base + (def.perLevel?.[key] ?? 0) * (b.level - from);
}

/** Потолок уровня для типа здания: свой предел и общий предел. */
export function maxLevelFor(type: BuildingTypeId): number {
  const def = BUILDING_BY_ID[type];
  return Math.min(def.maxLevel ?? MAX_BUILDING_LEVEL, MAX_BUILDING_LEVEL);
}

const scaleCost = (
  cost: Partial<Record<ResourceId, number>>,
  k: number,
): Partial<Record<ResourceId, number>> => {
  const out: Partial<Record<ResourceId, number>> = {};
  for (const r of RESOURCE_IDS) if (cost[r]) out[r] = Math.round((cost[r] as number) * k);
  return out;
};

/** Цена улучшения до уровня toLevel: базовая стоимость, умноженная на 1.4 за каждый уровень. */
export const upgradeCost = (def: BuildingDef, toLevel: number): Partial<Record<ResourceId, number>> =>
  scaleCost(def.cost, Math.pow(UPGRADE_GROWTH, toLevel - 1));

/** Работа строителей на улучшение — растёт так же, как цена. */
export const upgradeWork = (def: BuildingDef, toLevel: number): number =>
  Math.round(def.work * Math.pow(UPGRADE_GROWTH, toLevel - 1));

export interface UpgradeInfo {
  /** Уровень, до которого улучшаем. */
  level: number;
  cost: Partial<Record<ResourceId, number>>;
  work: number;
  maxLevel: number;
  affordable: boolean;
  /** Почему нельзя прямо сейчас; null — можно. */
  blocked: string | null;
}

export function upgradeInfo(s: GameState, b: Building): UpgradeInfo {
  const def = BUILDING_BY_ID[b.type];
  const maxLevel = maxLevelFor(b.type);
  const level = b.level + 1;
  const cost = upgradeCost(def, level);
  const work = upgradeWork(def, level);
  const affordable = canAfford(s, cost);
  let blocked: string | null = null;
  if (isSite(b)) blocked = 'Улучшение уже идёт.';
  else if (level > maxLevel) blocked = b.level <= 1 ? 'Это здание не улучшается.' : 'Максимальный уровень.';
  else if (!affordable) blocked = 'Не хватает ресурсов.';
  return { level, cost, work, maxLevel, affordable, blocked };
}

/** Что в здании требует внимания — маркер над крышей и метка в списке построек. */
export type Attention = 'idle' | 'slot' | 'upgrade';

export function buildingAttention(s: GameState, b: Building): Attention | null {
  if (isSite(b)) return null;
  const slots = buildingSlots(b);
  if (slots > 0) {
    const n = workerCount(s, b.id);
    if (n === 0) return 'idle';
    if (n < slots) return 'slot';
  }
  return upgradeInfo(s, b).blocked === null ? 'upgrade' : null;
}

export const ATTENTION_META: Record<Attention, { icon: string; text: string }> = {
  idle: { icon: '💤', text: 'Стоит без рабочих' },
  slot: { icon: '👤', text: 'Есть свободное место' },
  upgrade: { icon: '⬆️', text: 'Можно улучшить' },
};

// ---------- Вместимости ----------

/** Жилых мест в здании. */
export const buildingHousing = (b: Building): number => buildingStat(b, 'housing');

export function housingCapacity(s: GameState): number {
  let cap = BASE_HOUSING;
  for (const b of s.buildings) cap += buildingHousing(b);
  return cap;
}

export function storageCap(s: GameState): number {
  let cap = BASE_STORAGE_CAP;
  for (const b of s.buildings) cap += buildingStat(b, 'storage');
  return cap;
}

/** Сколько человек по профессиям: рабочие зданий, вольный сбор и свободные руки. */
export function jobCounts(s: GameState): Record<JobId, number> {
  const counts = Object.fromEntries(JOBS.map((j) => [j.id, 0])) as Record<JobId, number>;
  for (const b of s.buildings) {
    const job = BUILDING_BY_ID[b.type].job;
    if (job) counts[job] += workerCount(s, b.id);
  }
  for (const job of FREE_JOBS) counts[job] += freeJobCount(s, job);
  counts.idle = idleCount(s);
  return counts;
}

// ---------- Указ и рацион ----------

/** Действующий указ вождя. Старое сохранение без поля читается как «без указа». */
export const decreeOf = (s: GameState): DecreeDef => DECREE_BY_ID[s.decree] ?? DECREE_BY_ID.none;

/** Действующий рацион. */
export const rationOf = (s: GameState): RationDef => RATION_BY_ID[s.ration] ?? RATION_BY_ID.normal;

/** Прибавка к морали за игровой день от указа и рациона вместе. */
export const policyMoralePerDay = (s: GameState): number =>
  decreeOf(s).moralePerDay + rationOf(s).moralePerDay;

// ---------- Золото, налог, рынок ----------

/** Действующий уровень налога. Старое сохранение без поля читается как «без налога». */
export const taxOf = (s: GameState): TaxDef => TAX_BY_ID[s.tax] ?? TAX_BY_ID.none;

/** Сбор золота за игровой день: с каждого человека посёлка, включая бойцов. */
export const taxIncomePerDay = (s: GameState): number => taxOf(s).perPop * population(s) * TAX_PER_POP;

/** Уровень рынка. */
export const marketLevel = (s: GameState): number => buildingOfType(s, 'market')?.level ?? 0;

/** Что стоит на прилавке сегодня. Пусто, пока нет рынка. */
export const marketOffer = (s: GameState): GoodDef[] => offerFor(dayOf(s.time), marketLevel(s), GOODS);

/**
 * Сколько единиц товара уже взяли с прилавка сегодня. Счётчик от прошлого дня
 * не считается: прилавок обновляется по номеру дня, а не по тому, успел ли
 * пройти шаг симуляции.
 */
export const marketBought = (s: GameState, id: GoodId): number => {
  if (!s.market || s.market.day !== dayOf(s.time)) return 0;
  return Math.max(0, s.market.bought[id] ?? 0);
};

/** Дневной запас товара при нынешнем уровне рынка. */
export const marketStock = (s: GameState, def: GoodDef): number => goodStock(def, marketLevel(s));

/** Сколько ещё можно взять сегодня. */
export const marketLeft = (s: GameState, def: GoodDef): number =>
  Math.max(0, marketStock(s, def) - marketBought(s, def.id));

/** Цена следующей единицы с учётом того, сколько уже скупили за день. */
export const marketPrice = (s: GameState, def: GoodDef): number =>
  goodPrice(def, marketLevel(s), marketBought(s, def.id));

/** Во что обойдётся партия из `count` единиц. Считается поштучно. */
export const marketCost = (s: GameState, def: GoodDef, count: number): number =>
  batchCost(def, marketLevel(s), marketBought(s, def.id), count);

/** Сколько идёт караван при нынешнем уровне рынка, секунд игрового времени. */
export const caravanSeconds = (s: GameState): number =>
  Math.max(12, CARAVAN_BASE - CARAVAN_PER_LEVEL * Math.max(0, marketLevel(s) - 1));

/** Доля пути каравана, 0..1. По ней сцена ведёт телегу от ворот и обратно. */
export function caravanProgress(s: GameState, c: Caravan): number {
  const total = Math.max(0.001, c.arriveAt - c.departAt);
  return Math.max(0, Math.min(1, (s.time - c.departAt) / total));
}

/**
 * Во что единица товара обходится своим трудом, в золоте.
 *
 * Считается из собственных чисел игры: человек за день приносит казне
 * `bestTaxPerPop` золота, а тот же человек на своём месте в здании
 * `REFERENCE_LEVEL` уровня добывает `yield * levelOutputMult` единиц товара.
 * Отношение и есть «цена своего труда» — с ней сравнивается цена рынка,
 * и рынок обязан быть дороже (см. MIN_MARKUP и тест).
 *
 * Для снаряжения своим трудом считается стоимость материалов: работу кузнеца
 * рынок сверху и накидывает.
 */
const REFERENCE_LEVEL = 5;

const bestTaxPerPop = (): number => Math.max(...TAXES.map((t) => t.perPop)) * TAX_PER_POP;

/** Лучшая дневная добыча одного работника по этому ресурсу — эталон «сделать самому». */
function bestYieldPerWorker(r: ResourceId): number {
  let best = 0;
  for (const job of JOBS) {
    const y = job.yield[r] ?? 0;
    if (y > best) best = y;
  }
  return best * levelOutputMult(REFERENCE_LEVEL);
}

export function selfCost(def: GoodDef): number {
  if (def.resource) {
    const per = bestYieldPerWorker(def.resource);
    return per > 0 ? bestTaxPerPop() / per : 0;
  }
  let sum = 0;
  for (const [r, n] of Object.entries(goodMaterials(def))) {
    const g = GOOD_BY_ID[r];
    if (g && n) sum += g.price * n;
  }
  return sum;
}

// ---------- Армия ----------

export const armySize = (s: GameState): number =>
  TROOP_IDS.reduce((n, id) => n + Math.max(0, s.army?.[id] ?? 0), 0);

/**
 * Мощь армии считается из состава отряда и ничего больше не учитывает:
 * снаряжение уже вложено в вид бойца. Эту же мощь берёт карта мира.
 */
export const armyPower = (s: GameState): number =>
  TROOP_IDS.reduce((n, id) => n + Math.max(0, s.army?.[id] ?? 0) * TROOP_BY_ID[id].power, 0);

/** Средняя мощь бойца — по ней мир пересчитывает ушедший в поход отряд. */
export const soldierPower = (s: GameState): number => {
  const n = armySize(s);
  return n > 0 ? armyPower(s) / n : 0;
};

/** Бойцы, оставшиеся дома. Ушедшие в поход деревню не защищают. */
export const homeArmy = (s: GameState): number =>
  Math.max(0, armySize(s) - Math.max(0, s.warriorsAway));

/** Мощь тех, кто дома: доля полной мощи по числу оставшихся. */
export const homeArmyPower = (s: GameState): number => homeArmy(s) * soldierPower(s);

/** Сколько людей сейчас вне деревни: они не защищают её и не строят. */
export const awayCount = (s: GameState): number =>
  Math.max(0, s.warriorsAway) + Math.max(0, s.scoutsAway);

/**
 * Оборона деревни. Армия в походе сюда не входит — это и есть цена похода:
 * пока отряд в пути, дом стоит открытым.
 */
export function defense(s: GameState): number {
  let d = homeArmyPower(s);
  for (const b of s.buildings) d += buildingStat(b, 'defense');
  d += BASE_DEFENSE;
  if (s.totem === 'bear') d += 2;
  // Любой житель может отбиваться дубиной, но слабо.
  d += Math.max(0, s.pop - Math.max(0, s.scoutsAway)) * VILLAGER_DEFENSE;
  return d;
}

/** Сколько бойцов ждёт своей очереди в казармах. */
export const recruitsQueued = (s: GameState): number =>
  (s.recruits ?? []).reduce((n, o) => n + Math.max(0, o.count - o.done), 0);

/**
 * Скорость обучения в казармах: работа в секунду. Зависит только от уровня казарм —
 * учения идут своим чередом, без рабочих и без сезона. Растёт она быстрее выработки
 * зданий, потому что умножается ещё и на сам уровень: дружина в сотни бойцов при
 * линейном росте набиралась бы часами.
 */
export function recruitRate(s: GameState): number {
  const b = buildingOfType(s, 'barracks');
  return b ? RECRUIT_WORK * b.level * levelOutputMult(b.level) : 0;
}

// ---------- Кузница ----------

/**
 * Работа кузнецов в секунду: сколько их, какого уровня кузница и есть ли навык —
 * всё это уже сидит в множителе жителя.
 */
export function forgeRate(s: GameState, mods: SeasonModifiers = seasonMods(s)): number {
  const smithy = buildingOfType(s, 'smithy');
  if (!smithy) return 0;
  return SMITH_WORK * workerCount(s, smithy.id) * workerMultiplier(s, 'smith', smithy, mods);
}

export interface ForgeInfo {
  item: EquipmentId | null;
  def: EquipmentDef | null;
  /** Работа в секунду. */
  rate: number;
  /** Накоплено и нужно работы на текущий предмет. */
  work: number;
  need: number;
  /** Секунд до готовности; null — работа стоит. */
  eta: number | null;
  /** Почему кузница молчит; null — всё в порядке. */
  blocked: string | null;
}

export function forgeInfo(s: GameState, mods: SeasonModifiers = seasonMods(s)): ForgeInfo {
  const item = s.forging;
  const def = item ? EQUIPMENT_BY_ID[item] : null;
  const rate = forgeRate(s, mods);
  const work = s.forgeWork ?? 0;
  const need = def?.work ?? 0;
  let blocked: string | null = null;
  if (!def) blocked = 'Выбери, что куём.';
  else if (rate <= 0) blocked = 'В кузнице никто не работает.';
  else if (work >= need && !canAfford(s, def.cost)) blocked = 'Не хватает материалов на предмет.';
  const eta = def && rate > 0 ? Math.max(0, Math.ceil((need - work) / rate)) : null;
  return { item, def, rate, work, need, eta, blocked };
}

// ---------- Производство ----------

/** Множитель производительности профессии с учётом тотема, сезона и указа. */
export function jobMultiplier(s: GameState, job: JobId, mods: SeasonModifiers = seasonMods(s)): number {
  let m = mods.jobs[job] ?? 1;
  if (job === 'hunter' && s.totem === 'wolf') m *= 1.15;
  if (job === 'farmer' && s.totem === 'eagle') m *= 1.1;
  // Мораль: от 0.7 при нуле до 1.15 при сотне.
  m *= 0.7 + (s.morale / 100) * 0.45;
  // Указ вождя действует на всю выработку разом — ровно на объявленную величину.
  m *= decreeOf(s).output;
  return m;
}

/**
 * Полный множитель выработки одного рабочего: профессия и место работы.
 * Место — это уровень здания (`levelOutputMult`) либо половина для вольного
 * сбора. Личного навыка у жителя нет: люди одинаковы, разницу делает здание.
 */
export function workerMultiplier(
  s: GameState,
  job: JobId,
  place: Building | null,
  mods: SeasonModifiers = seasonMods(s),
): number {
  const spot = place ? levelOutputMult(place.level) : JOB_BY_ID[job].building ? FREE_RANGE_MULT : 1;
  return jobMultiplier(s, job, mods) * spot;
}

/** Складывает дневную выработку `n` рабочих одной профессии. */
function addYield(out: Resources, job: JobId, n: number, mult: number): void {
  if (n <= 0 || mult <= 0) return;
  const def = JOB_BY_ID[job];
  for (const r of RESOURCE_IDS) {
    const y = def.yield[r];
    if (y) out[r] += y * n * mult;
  }
}

/** Валовое производство за игровой день. */
export function productionPerDay(s: GameState, mods: SeasonModifiers = seasonMods(s)): Resources {
  const out = emptyResources();
  for (const b of s.buildings) {
    const job = BUILDING_BY_ID[b.type].job;
    if (!job) continue;
    addYield(out, job, workerCount(s, b.id), workerMultiplier(s, job, b, mods));
  }
  for (const job of FREE_JOBS) {
    addYield(out, job, freeJobCount(s, job), workerMultiplier(s, job, null, mods));
  }
  return out;
}

/** Что производит одно здание за день — для его собственной панели. */
export function buildingProduction(s: GameState, b: Building, mods: SeasonModifiers = seasonMods(s)): Resources {
  const out = emptyResources();
  const job = BUILDING_BY_ID[b.type].job;
  if (job) addYield(out, job, workerCount(s, b.id), workerMultiplier(s, job, b, mods));
  return out;
}

/**
 * Расход еды за день. Бойцы не добывают и не строят, но едят из того же котла —
 * иначе армия обходилась бы племени только людьми. Рацион множит весь расход.
 */
export function foodConsumptionPerDay(s: GameState, mods: SeasonModifiers = seasonMods(s)): number {
  let total = 0;
  const counts = jobCounts(s);
  for (const job of JOBS) total += counts[job.id] * (job.foodMultiplier ?? 1);
  // Новобранцы на учениях уже не жители, но кормятся так же, как бойцы.
  total += (armySize(s) + recruitsQueued(s)) * SOLDIER_FOOD;
  return total * mods.food * rationOf(s).food;
}

/** Чистый баланс за день (производство минус потребление еды и дрова на очаг). */
export function netPerDay(s: GameState): Resources {
  const p = productionPerDay(s);
  p.food -= foodConsumptionPerDay(s);
  p.wood -= heatingWoodPerDay(s);
  return p;
}

/** Вклад ремесленников мастерской в стройку: работа в секунду. */
export function crafterBuildRate(s: GameState, mods: SeasonModifiers = seasonMods(s)): number {
  const shop = buildingOfType(s, 'workshop');
  if (!shop) return 0;
  return CRAFTER_BUILD * workerCount(s, shop.id) * workerMultiplier(s, 'crafter', shop, mods);
}

/**
 * Скорость стройки: свободные жители с площади плюс ремесленники в мастерской.
 * Улучшения — единственная прогрессия посёлка, и мастерская существует ради них.
 */
export function buildRate(s: GameState, mods: SeasonModifiers = seasonMods(s)): number {
  // Ушедшие разведчиками — те же свободные жители: пока они в пути, стройка идёт без них.
  const idle = Math.max(0, jobCounts(s).idle - Math.max(0, s.scoutsAway));
  return (idle * BUILDER_RATE + crafterBuildRate(s, mods)) * mods.build;
}

export function canAfford(s: GameState, cost: Partial<Record<ResourceId, number>>): boolean {
  for (const r of RESOURCE_IDS) if ((cost[r] ?? 0) > s.resources[r]) return false;
  return true;
}

/** Хватает ли снаряжения на складе. */
export function hasEquipment(s: GameState, need: Partial<Record<EquipmentId, number>>): boolean {
  for (const [id, n] of Object.entries(need)) {
    if ((s.equipment?.[id as EquipmentId] ?? 0) < (n ?? 0)) return false;
  }
  return true;
}

// ---------- Сезоны ----------

/** Сквозной номер сезона от начала партии (0 — первая весна). */
export const seasonIndex = (time: number): number => Math.floor(time / SEASON_SECONDS);

export const seasonOf = (time: number): Season => SEASONS[seasonIndex(time) % SEASONS.length];

/** Номер игрового года, с единицы. */
export const yearOf = (time: number): number => Math.floor(seasonIndex(time) / SEASONS.length) + 1;

/** Прогресс внутри сезона, 0..1. */
export const seasonProgress = (time: number): number => (time % SEASON_SECONDS) / SEASON_SECONDS;

/** Номер дня внутри сезона, с единицы. */
export const seasonDayOf = (time: number): number => Math.floor(seasonProgress(time) * SEASON_DAYS) + 1;

export const seasonAfter = (season: Season): Season =>
  SEASONS[(SEASONS.indexOf(season) + 1) % SEASONS.length];

/**
 * Смягчает штрафы сезона: множитель ниже единицы подтягивается к ней, бонусы не трогаются.
 * Множитель потребления еды и расход дров — тоже штрафы, просто растут вверх.
 */
function soften(m: SeasonModifiers, k: number): SeasonModifiers {
  const damp = (x: number): number => (x < 1 ? 1 - (1 - x) * k : x);
  const jobs: Partial<Record<JobId, number>> = {};
  for (const [job, mult] of Object.entries(m.jobs)) jobs[job as JobId] = damp(mult);
  return {
    jobs,
    build: damp(m.build),
    morale: m.morale < 0 ? m.morale * k : m.morale,
    food: 1 + (m.food - 1) * k,
    heating: m.heating * k,
  };
}

/** Множители сезона для конкретного года: первая зима мягче остальных. */
export function seasonModsFor(season: Season, year: number): SeasonModifiers {
  const base = SEASON_MODIFIERS[season];
  if (season !== 'winter' || year > 1) return base;
  return soften(base, FIRST_WINTER_SOFTEN);
}

/** Действующие сейчас множители сезона. Единственная точка входа для симуляции. */
export const seasonMods = (s: GameState): SeasonModifiers => seasonModsFor(seasonOf(s.time), yearOf(s.time));

/** Множители ближайшей зимы — она всегда завершает текущий год. */
export const winterMods = (s: GameState): SeasonModifiers => seasonModsFor('winter', yearOf(s.time));

export const isFirstWinter = (s: GameState): boolean => yearOf(s.time) === 1;

/** Сколько жителей помещается под крышу. */
export function roofCapacity(s: GameState): number {
  let cap = 0;
  for (const b of s.buildings) cap += buildingHousing(b);
  return cap;
}

/**
 * Дрова на отопление за игровой день. Вне зимы — ноль. Считается по жителям:
 * бойцы греются у своего огня в казармах, отдельной статьи на них нет.
 */
export function heatingWoodPerDay(s: GameState, mods: SeasonModifiers = seasonMods(s)): number {
  if (mods.heating <= 0) return 0;
  const pop = s.pop;
  const roofed = Math.min(pop, roofCapacity(s));
  const open = pop - roofed;
  // Общий костёр греет весь посёлок и срезает расход.
  return (roofed * HEATING_SHELTERED + open) * mods.heating * HEATING_CAMPFIRE;
}

export interface ResourceForecast {
  have: number;
  /** Сколько уйдёт сверх производства за всю зиму. */
  need: number;
  /** Чистый расход в день: потребление минус зимнее производство. */
  drainPerDay: number;
  /** На сколько дней зимы хватит запаса. */
  days: number;
  ok: boolean;
}

export interface WinterForecast {
  winterDays: number;
  first: boolean;
  food: ResourceForecast;
  wood: ResourceForecast;
}

function forecast(have: number, drainPerDay: number, days: number): ResourceForecast {
  const covered = drainPerDay <= 0 ? days : Math.min(days, have / drainPerDay);
  return {
    have,
    need: Math.max(0, drainPerDay) * days,
    drainPerDay,
    days: covered,
    ok: covered >= days - 0.01,
  };
}

/**
 * Расчёт «переживём ли зиму» при нынешнем составе племени: сколько уйдёт еды и дров
 * и на сколько дней зимы хватит того, что уже на складе.
 */
export function winterForecast(s: GameState): WinterForecast {
  const mods = winterMods(s);
  const prod = productionPerDay(s, mods);
  return {
    winterDays: SEASON_DAYS,
    first: isFirstWinter(s),
    food: forecast(s.resources.food, foodConsumptionPerDay(s, mods) - prod.food, SEASON_DAYS),
    wood: forecast(s.resources.wood, heatingWoodPerDay(s, mods) - prod.wood, SEASON_DAYS),
  };
}

// ---------- Население ----------

/**
 * Всё население поселения: жители, бойцы и те, кто сейчас на учениях.
 * С него собирается налог: наём людей казну не уменьшает.
 */
export const population = (s: GameState): number =>
  s.pop + armySize(s) + recruitsQueued(s);

/** К какой морали стремится племя при текущих условиях. */
export function moraleTarget(s: GameState): number {
  let t = MORALE_BASE;
  const pop = s.pop;
  const housing = housingCapacity(s);
  if (pop <= housing) t += 10;
  else t -= 5 * (pop - housing);
  const foodDays = s.resources.food / Math.max(1, foodConsumptionPerDay(s));
  if (s.resources.food <= 0) t -= 25;
  else if (foodDays >= 3) t += 10;
  else if (foodDays < 1) t -= 8;
  for (const b of s.buildings) t += buildingStat(b, 'morale');
  t += Math.min(SHAMAN_MORALE_CAP, jobCounts(s).shaman * SHAMAN_MORALE);
  t += Math.min(10, s.prestige / 5);
  t += seasonMods(s).morale;
  if (s.freezing > 0) t -= FREEZING_MORALE_PENALTY;
  // Налог давит на мораль не медленным сползанием, а прямо: сползание племя
  // отыграло бы за минуту, а просадка держится ровно столько, сколько держат налог.
  // Вычитается он уже из приведённой к шкале величины — иначе в большом посёлке,
  // где мораль и так упёрлась в потолок, налог не стоил бы вообще ничего.
  return Math.max(0, Math.min(100, t) - taxOf(s).moralePenalty);
}

// ---------- Тревоги ----------

export interface Alert {
  id: string;
  icon: string;
  text: string;
  /** Куда ведёт тап: тип здания, панель которого стоит открыть. */
  goto?: BuildingTypeId;
}

/**
 * Критические состояния, которые обязаны всплыть поверх любого экрана.
 * Порядок — по остроте: первым идёт то, от чего уже умирают.
 */
export function alerts(s: GameState): Alert[] {
  const out: Alert[] = [];
  const eat = foodConsumptionPerDay(s);
  const foodDays = s.resources.food / Math.max(1, eat);
  if (s.resources.food <= 0.5) out.push({ id: 'starving', icon: '💀', text: 'Еда кончилась — племя голодает', goto: 'storage' });
  else if (foodDays < 1) out.push({ id: 'food', icon: '🍖', text: `Еда на исходе: меньше дня запаса`, goto: 'storage' });

  const heat = heatingWoodPerDay(s);
  if (heat > 0) {
    if (s.freezing > 0) out.push({ id: 'freezing', icon: '🥶', text: 'Дрова кончились — племя мёрзнет', goto: 'storage' });
    else if (s.resources.wood / heat < 1) out.push({ id: 'wood', icon: '🌲', text: 'Дров хватит меньше чем на день', goto: 'storage' });
  }
  return out;
}

export const dayOf = (time: number): number => Math.floor(time / DAY_LENGTH) + 1;
export const dayFraction = (time: number): number => (time % DAY_LENGTH) / DAY_LENGTH;

/**
 * Переводит долю суток в фазу солнца: 0 — рассвет, 0.25 — полдень, 0.5 — закат,
 * 0.75 — глубокая ночь. Зимой светлая половина сжата, поэтому ночь длиннее.
 * Один источник правды и для HUD, и для освещения сцены.
 */
export function solarPhase(frac: number, season: Season): number {
  const light = SEASON_DAYLIGHT[season];
  return frac < light ? (frac / light) * 0.5 : 0.5 + ((frac - light) / (1 - light)) * 0.5;
}
