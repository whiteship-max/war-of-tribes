// Производные величины от состояния: вместимость, скорости, модификаторы.
import type {
  Building,
  BuildingTypeId,
  TroopId,
  Caravan,
  EquipmentId,
  FaithId,
  GameState,
  GoodId,
  JobId,
  ObservanceId,
  ResourceId,
  Resources,
  Season,
} from './types';
import {
  BASE_DEFENSE,
  BASE_HOUSING,
  BONDED_OUTPUT,
  FEAST_COOLDOWN_DAYS,
  FEAST_COOLDOWN_PER_LEVEL,
  FEAST_DAYS,
  FEAST_GOLD_PER_POP,
  INFIRMARY_HEAL_CAP,
  BASE_STORAGE_CAP,
  BUILDER_RATE,
  CROWDING_MAX,
  CROWDING_PENALTY,
  CRAFTER_BUILD,
  DAY_LENGTH,
  FREE_RANGE_MULT,
  LEVEL_OUTPUT_STEP,
  MAX_BUILDING_LEVEL,
  MORALE_BASE,
  MORALE_OUTPUT_LOW,
  MORALE_OUTPUT_SPAN,
  MUTINY_FUSE,
  MUTINY_PAY_FOOD,
  MUTINY_PAY_GOLD,
  MUTINY_SUPPRESS_FLEE,
  MUTINY_TOWN_LEAVE,
  ORDER_HOUSEHOLD,
  ORDER_PER_GUARD,
  ORDER_PER_TOWNSMAN,
  ORDER_UNREST,
  ORDER_WARN,
  PIETY_BASE,
  PIETY_HERESY,
  PIETY_HERESY_MORALE,
  PIETY_HUNGER,
  PIETY_PER_LEVEL,
  PIETY_PER_PRIEST,
  PIETY_PRESSURE,
  PIETY_PRIEST_CAP,
  PIETY_RELIC,
  PIETY_RITE,
  PIETY_SIEGE,
  RECRUIT_WORK,
  RESOURCE_IDS,
  PRIEST_MORALE,
  PRIEST_MORALE_CAP,
  RITE_MORALE,
  SIEGE_FOOD_YIELD,
  SIEGE_YIELD,
  SMITH_WORK,
  TOWN_HALL_BUILD_STEP,
  SOLDIER_FOOD,
  STRAIN_DAYS,
  UPGRADE_GROWTH,
  VILLAGER_DEFENSE,
  emptyResources,
} from './constants';
import { asGame, sessionSec, type GameSec } from './pace';
import { BUILDING_BY_ID, MASTERS_AT, type BuildingDef, type BuildingStats, slotsAt } from './data/buildings';
import { surveyRadiusOf } from './data/survey';
import { FAITH_BY_ID, OBSERVANCE_BY_ID, tiltAt, type FaithDef, type FaithTilt } from './data/faiths';
import { FREE_JOBS, JOBS, JOB_BY_ID } from './data/jobs';
import { EQUIPMENT_BY_ID, type EquipmentDef } from './data/equipment';
import { TROOP_BY_ID, TROOP_IDS } from './data/troops';
import { DESERT_SHARE, HORSE_MOUTHS, MASTER_PAID_AS, UPKEEP_TEXT, WAGE_GEAR, WAGE_HEAD, WAGE_MAN } from './data/upkeep';
import { BATTLE_MAN, gearOfTroop, troopPower, troopTotal, troopsAfter, weightOf, type TroopStack } from './battle/kinds';
import { DECREE_BY_ID, RATION_BY_ID, TAXES, TAX_BY_ID, TAX_PER_POP, type DecreeDef, type RationDef, type TaxDef } from './data/policy';
import {
  BONDED_GOOD,
  BONDED_SALE,
  CARAVAN_BASE,
  CARAVAN_FLOOR,
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
import { MUTINY_EVENT, ORDER_TEXT } from './data/order';
import {
  DAY_PART_UNTIL,
  FIRST_WINTER_SOFTEN,
  FREEZING_MORALE_PENALTY,
  HEATING_CAMPFIRE,
  HEATING_SHELTERED,
  SEASONS,
  SEASON_DAYLIGHT,
  type DayPart,
  SEASON_DAYS,
  SEASON_META,
  SEASON_MODIFIERS,
  SEASON_SECONDS,
  type SeasonModifiers,
} from './data/seasons';
import { daysSpan, gameDaysText } from './span';

/** На здании идёт улучшение. */
export const isSite = (b: Building): boolean => b.workRequired > 0;

export const buildingById = (s: GameState, id: number): Building | null =>
  s.buildings.find((b) => b.id === id) ?? null;

/** Единственное здание этого типа. Второго такого в посёлке не бывает. */
export const buildingOfType = (s: GameState, type: BuildingTypeId): Building | null =>
  s.buildings.find((b) => b.type === type) ?? null;

/**
 * Здание стоит за стеной — значит, до него дотягивается чужой набег. Единственный
 * источник правды: поле `outside` в определении здания. План поселения ставит
 * такие здания на четвёртое кольцо, но решает это не он.
 */
export const isOutsideWall = (type: BuildingTypeId): boolean =>
  BUILDING_BY_ID[type].outside === true;

/** Первое улучшение в очереди — над ним работают свободные жители. */
export const currentSite = (s: GameState): Building | null => s.buildings.find(isSite) ?? null;

// ---------- Уровни, слоты, улучшения ----------

/** Множитель выработки рабочего от уровня здания: +`LEVEL_OUTPUT_STEP` за уровень. */
export const levelOutputMult = (level: number): number => 1 + LEVEL_OUTPUT_STEP * Math.max(0, level - 1);

/**
 * Рабочих мест в здании. Личного навыка у жителя нет — всю его роль взял на себя
 * уровень здания: он и добавляет места, и поднимает выработку каждому рабочему.
 */
export function buildingSlots(b: Building): number {
  return slotsAt(BUILDING_BY_ID[b.type], b.level);
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

// ---------- Невольники на местах ----------
//
// Устроены ровно как жители: число в посёлке (`s.bonded`) и число в каждом
// здании (`s.bondedWork`). Места у них общие с вольными — сколько рук стоит в
// здании, спрашивают у `handsCount`, а не складывают два числа по месту вызова.

/** Невольников в посёлке. */
export const bondedTotal = (s: GameState): number => Math.max(0, Math.floor(s.bonded ?? 0));

/** Сколько невольников стоит в этом здании. Назначение — число, как у жителей. */
export const bondedCount = (s: GameState, buildingId: number): number =>
  Math.max(0, Math.floor(s.bondedWork?.[buildingId] ?? 0));

/** Наёмных мастеров в Мастерской (`GameState.masters`). */
export const mastersCount = (s: GameState): number => Math.max(0, Math.floor(s.masters ?? 0));

/** Сколько наёмных мастеров стоит на местах этого здания: все — в Мастерской, в остальных ноль. */
export const mastersOn = (s: GameState, buildingId: number): number =>
  s.buildings.find((b) => b.id === buildingId)?.type === MASTERS_AT ? mastersCount(s) : 0;

/**
 * Сколько рук на местах здания: вольные, невольники и — в Мастерской — наёмные мастера. Места у
 * них общие: мастер занимает место ремесленника, а не своё (docs/admin_branch.md, раздел 4.1).
 */
export const handsCount = (s: GameState, buildingId: number): number =>
  workerCount(s, buildingId) + bondedCount(s, buildingId) + mastersOn(s, buildingId);

/**
 * Свободных мест Мастерской для наёмных: её места минус её люди и уже стоящие мастера. Сколько
 * мастеров пускает ветвь, решает гейт (`sim/tech.mastersCap`), — здесь только места здания.
 */
export function mastersRoom(s: GameState): number {
  const hall = buildingOfType(s, MASTERS_AT);
  return hall ? Math.max(0, buildingSlots(hall) - handsCount(s, hall.id)) : 0;
}

/** Ставят ли невольников на работу этого здания (`JobDef.bonded`). */
export const takesBonded = (b: Building): boolean => {
  const job = BUILDING_BY_ID[b.type].job;
  return Boolean(job && JOB_BY_ID[job].bonded);
};

/** Сколько невольников стоит по зданиям. */
export function bondedBusy(s: GameState): number {
  let n = 0;
  for (const b of s.buildings) n += bondedCount(s, b.id);
  return n;
}

/** Невольники без места: они на стройке, как свободные руки. */
export const bondedIdle = (s: GameState): number => Math.max(0, bondedTotal(s) - bondedBusy(s));

/** Сколько невольников ведут торговцы: заплачено, но в посёлке их ещё нет. */
export const bondedIncoming = (s: GameState): number =>
  (s.caravans ?? []).reduce((n, c) => n + (c.good === 'bonded' ? Math.max(0, c.count) : 0), 0);

/**
 * Пассивный эффект здания с учётом уровня: база + прибавка за каждый уровень сверх
 * того, с которого эффект вообще появляется (`since`). У большинства зданий это
 * первый уровень; у ратуши жильё начинается позже (её `since` в `data/buildings.ts`).
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

/** Цена улучшения до уровня toLevel: базовая стоимость, умноженная на `UPGRADE_GROWTH` за каждый уровень. */
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
export type Attention = 'idle' | 'order' | 'slot' | 'upgrade';

export function buildingAttention(s: GameState, b: Building): Attention | null {
  if (isSite(b)) return null;
  const slots = buildingSlots(b);
  // Двор, где работают одни невольники, не стоит без рабочих: руки на местах есть.
  const n = slots > 0 ? handsCount(s, b.id) : 0;
  // Простаивающая кузница — первое, что надо сказать про неё: кузнецы стоят у
  // холодного горна, и каждая минута такого простоя это потерянная минута.
  // Стоит выше «есть свободное место»: пустой горн дороже пустого места.
  if (b.type === 'smithy' && n > 0 && (s.forge?.length ?? 0) === 0) return 'order';
  if (slots > 0) {
    if (n === 0) return 'idle';
    if (n < slots) return 'slot';
  }
  return upgradeInfo(s, b).blocked === null ? 'upgrade' : null;
}

export const ATTENTION_META: Record<Attention, { icon: string; text: string }> = {
  idle: { icon: '💤', text: 'Стоит без рабочих' },
  order: { icon: '⚒️', text: 'Кузнецы без заказа' },
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

/**
 * Сбор золота за игровой день: с каждого человека посёлка, включая бойцов.
 *
 * Десятина и закят идут этой же дверью и с тем же знаком, что налог: приход
 * собирает (плюс) или раздаёт (минус). Отдельного потока золота под веру нет и
 * заводить его нельзя — казна в игре одна, и путь в неё должен быть один.
 * Сумма умеет уйти в минус: закят при пустой казне просто ничего не возьмёт
 * (`marketTick` не пускает золото ниже нуля).
 */
export const taxIncomePerDay = (s: GameState): number =>
  taxOf(s).perPop * population(s) * TAX_PER_POP + faithGoldPerDay(s);

/**
 * Что даст и чего будет стоить налог `id` этому посёлку прямо сейчас — числами самой игры:
 * сбор казны за день, мораль, к которой придёт племя, и множитель выработки при ней. Ратуша
 * ставит это на кнопку налога: цену называют числом до выбора, а не словом. Считается тем же
 * кодом, что игра, на посёлке с подменённым налогом — своей формулы здесь нет.
 */
export function taxQuote(s: GameState, id: TaxDef['id']): { gold: number; morale: number; output: number } {
  const t: GameState = { ...s, tax: id };
  const morale = moraleTarget(t);
  return { gold: taxIncomePerDay(t), morale, output: moraleOutputMult(morale) };
}

/** Уровень рынка. */
export const marketLevel = (s: GameState): number => buildingOfType(s, 'market')?.level ?? 0;

/**
 * Что стоит на прилавке сегодня. Пусто, пока нет рынка.
 *
 * Невольничий ряд стоит всегда и места в круговороте товаров не занимает: он
 * добавляется к прилавку дня последней строкой, а не тянется из перемешанного
 * списка. Продать невольников — рычаг против мятежа, и рычаг, который есть
 * через день, рычагом не является. Ассортимент прочего от этого не меняется ни
 * на товар.
 */
export const marketOffer = (s: GameState): GoodDef[] => {
  const level = marketLevel(s);
  if (level <= 0) return [];
  return [...offerFor(dayOf(s.time), level, GOODS), BONDED_GOOD];
};

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

/** Сколько невольников уже продано торговцам сегодня. Счёт от прошлого дня не считается. */
export const marketSold = (s: GameState, id: GoodId): number => {
  if (!s.market || s.market.day !== dayOf(s.time)) return 0;
  return Math.max(0, s.market.sold?.[id] ?? 0);
};

/**
 * Сколько невольников торговцы возьмут сегодня. Столько же, сколько приводят за
 * день: уводят не больше, чем могут прокормить в дороге.
 */
export const bondedSaleLeft = (s: GameState): number =>
  marketLevel(s) <= 0 ? 0 : Math.max(0, marketStock(s, BONDED_GOOD) - marketSold(s, 'bonded'));

/**
 * Почём торговцы берут одного невольника. Всегда заметно ниже цены, по которой
 * они его приводят, и без роста за день: купить и тут же продать — это отдать
 * торговцам разницу, а не заработать на ней.
 */
export const bondedSalePrice = (): number => Math.floor(BONDED_GOOD.price * BONDED_SALE);

/** Во что обойдётся партия из `count` единиц. Считается поштучно. */
export const marketCost = (s: GameState, def: GoodDef, count: number): number =>
  batchCost(def, marketLevel(s), marketBought(s, def.id), count);

/** Сколько идёт караван при нынешнем уровне рынка, секунд игрового времени. */
export const caravanSeconds = (s: GameState): GameSec =>
  asGame(sessionSec(Math.max(CARAVAN_FLOOR, CARAVAN_BASE - CARAVAN_PER_LEVEL * Math.max(0, marketLevel(s) - 1))));

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
  // Людей своим трудом не производят: прирост племени бесплатен и медленен, и
  // сравнивать цену невольника с ним не с чем. Его цена меряется его же работой —
  // окупаемостью, и считает её `npm run order:report`, а держит тест.
  if (def.kind === 'bonded') return 0;
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
export const armyPower = (s: GameState): number => troopPower(s.army ?? {});

/**
 * Кто дома, по видам: всё войско минус те, кого мир числит не в обороне (`s.away`).
 * Отрицательного не бывает: ушедшего, которого у племени уже нет, нет и дома.
 */
export const homeTroops = (s: GameState): TroopStack => troopsAfter(s.army ?? {}, s.away ?? {});

/**
 * Бойцы в обороне деревни: гарнизон и дружина, собранная у своих ворот. Отряды в
 * пути и дружина в сборе и в поле деревню не защищают (`world/muster`).
 */
export const homeArmy = (s: GameState): number => troopTotal(homeTroops(s));

/**
 * Мощь тех, кто дома, — сумма мощи тех, кто дома (`kinds.troopPower`). Прежде она
 * была долей всей мощи по числу оставшихся, и полководец, уведший латников, оставлял
 * дома «средних бойцов»: показанная оборона выходила на 39 % выше настоящей, а
 * уведший лёгких — на 31 % ниже (docs/defense_mix.md, раздел 1).
 */
export const homeArmyPower = (s: GameState): number => troopPower(homeTroops(s));

/**
 * Оборона деревни. Армия в походе сюда не входит — это и есть цена похода:
 * пока отряд в пути, дом стоит открытым.
 */
export function defense(s: GameState): number {
  let d = homeArmyPower(s);
  for (const b of s.buildings) d += buildingStat(b, 'defense');
  d += BASE_DEFENSE;
  // Любой житель может отбиваться дубиной, но слабо.
  d += Math.max(0, s.pop - Math.max(0, s.scoutsAway)) * VILLAGER_DEFENSE;
  // Стойкость от веры — множитель на всё разом, а не слагаемое: приход не
  // добавляет людей на стену, он держит тех, кто на ней уже стоит. Число берётся
  // из наклона (`faithTilt`) и потому растёт вместе с храмом и укладом.
  return d * (1 + faithTilt(s).steadfast);
}

// ---------- Службы посёлка ----------
//
// Пять зданий третьего кольца не производят ничего и рабочих мест не дают:
// каждое правит одно число в другой части игры. Все они читаются одинаково —
// через `buildingStat`, поэтому уровень везде работает сам собой.

/** Величина пассива здания этого типа. Ноль, если такого здания нет. */
export function statOf(s: GameState, type: BuildingTypeId, key: keyof BuildingStats): number {
  const b = buildingOfType(s, type);
  return b ? buildingStat(b, key) : 0;
}

/**
 * Мест лучников на башне: поле здания целым вниз. Малая прибавка гасит ошибку дроби —
 * три трети в числах с плавающей точкой не всегда единица.
 */
export const towerSeats = (s: GameState): number => Math.floor(statOf(s, 'tower', 'seats') + 1e-9);

/**
 * Какая доля павших в бою ранена и ляжет в лазарет, 0..`INFIRMARY_HEAL_CAP`.
 * Потолок здесь не украшение: без него война на высоком уровне перестала бы
 * стоить людей, а победа с непомерными потерями — быть непомерной.
 */
export const healShare = (s: GameState): number =>
  Math.min(INFIRMARY_HEAL_CAP, statOf(s, 'infirmary', 'heal') / 100);

/** Сколько раненых лазарет держит разом: поле здания целым вниз. */
export const infirmaryBeds = (s: GameState): number => Math.floor(statOf(s, 'infirmary', 'beds') + 1e-9);

/** Раненые по видам: в лазарете (`lying`) и при полководце в поле (`carried`). */
export function woundedStacks(s: GameState): { lying: TroopStack; carried: TroopStack } {
  const lying: TroopStack = {};
  const carried: TroopStack = {};
  for (const g of s.wounded ?? []) {
    const to = g.until === null ? carried : lying;
    for (const [id, n] of Object.entries(g.troops) as [TroopId, number][]) to[id] = (to[id] ?? 0) + n;
  }
  return { lying, carried };
}

/** Сколько мест лазарета занято. Раненые при полководце мест не занимают, пока дружина в поле. */
/**
 * Сколько мест лазарета занято — **в бойцах строя**, а не в головах. Голова всадника весит
 * семь бойцов строя, и по головам конница лечилась бы даром: чем дороже боец, тем выгоднее
 * (docs/stable.md, решение 9). Ёмкость выведена в тех же единицах — 11 на уровень (`data/buildings.ts`).
 */
export const bedsTaken = (s: GameState): number => troopPower(woundedStacks(s).lying) / BATTLE_MAN;

/**
 * Кто ест солдатский паёк, по видам: строй, новобранцы на учениях и раненые — в лазарете и при
 * полководце. **Одна дверь на расход и на голод**: сколько войско съедает (`foodConsumptionPerDay`)
 * и между кем делится нехватка (`foodShortfall`), считается по этому списку. Пока расход и голод
 * считали каждый своих, новобранцы ели, но в делитель голода не входили, и за их хлеб уходили
 * готовые бойцы (docs/infirmary.md, раздел 5).
 */
export function soldierMouths(s: GameState): { army: TroopStack; recruits: TroopStack; wounded: TroopStack } {
  const army: TroopStack = {};
  for (const id of TROOP_IDS) if ((s.army?.[id] ?? 0) > 0) army[id] = s.army[id];
  const recruits: TroopStack = {};
  for (const o of s.recruits ?? []) {
    const left = Math.max(0, o.count - o.done);
    if (left > 0) recruits[o.troop] = (recruits[o.troop] ?? 0) + left;
  }
  const { lying, carried } = woundedStacks(s);
  const wounded: TroopStack = { ...lying };
  for (const [id, n] of Object.entries(carried) as [TroopId, number][]) wounded[id] = (wounded[id] ?? 0) + n;
  return { army, recruits, wounded };
}

/**
 * Сколько ртов на солдатском пайке. Конь — тоже рот: всадник и его конь едят за двоих, и это
 * то же правило «кто ест — тот считается», только на конях (docs/stable.md, решение 5).
 */
export const mouthsOf = (t: TroopStack): number =>
  TROOP_IDS.reduce((n, id) => n + Math.max(0, t[id] ?? 0) * (TROOP_BY_ID[id].mounted ? HORSE_MOUTHS : 1), 0);

/** Сколько ртов на солдатском пайке — сумма `soldierMouths` вместе с конями. */
export function mouthCount(s: GameState): number {
  const m = soldierMouths(s);
  return mouthsOf(m.army) + mouthsOf(m.recruits) + mouthsOf(m.wounded);
}

/**
 * Во сколько раз медленнее стареют разведданные. Единица — как без дозора.
 * Снимок запоминает это число в момент разведки: данные, собранные хорошим
 * дозором, и остаются хорошими (см. world/intel.readIntel).
 */
export const intelKeen = (s: GameState): number => 1 + statOf(s, 'watch', 'intel') / 100;

/**
 * Насколько Дозор удлиняет предупреждение о чужой армии, **игровых** секунд: мир прибавляет их к
 * своим игровым дням (`AI_WARNING_BASE`) дверью времени (`LocalWorld.warningMs`), и со шкалой
 * (`game/pace`) идёт вся семья — предупреждение и эта прибавка.
 * Правило, которое нельзя нарушать: предупреждение обязано быть длиннее потолка
 * сбора дружины (`HANDOVER_MAX`), иначе набег появляется уже без холодного ответа.
 * Поэтому дозор время только прибавляет, а не задаёт его целиком.
 */
export const warningSeconds = (s: GameState): GameSec => asGame(statOf(s, 'watch', 'warn'));

/**
 * Радиус земли, открытой изучением округи, клеток. Ноль — не изучено ничего.
 *
 * Это единственное число, которым Дозор правит карту мира: оно едет туда
 * слепком деревни (`PlayerProfile.survey`), как предупреждение о набеге и
 * вместимость отряда. Живого обзора радиус не даёт — он открывает землю, и
 * только (см. docs/fog-and-figures.md).
 */
export const surveyRadius = (s: GameState): number => surveyRadiusOf(s.survey?.done ?? 0);

/** Во сколько раз быстрее учится конница благодаря конюшне. */
export const cavalryTrain = (s: GameState): number => 1 + statOf(s, 'stable', 'train') / 100;

/**
 * Сколько коней держит конюшня — стойла, общие на оба конных рода.
 *
 * Это единственный потолок конницы, и он не украшение: прибавка конницы к войску растёт без
 * насыщения, и без предела лучшее войско — одна конница. Предел выведен из замера: доля, на
 * которой конница прибавляет войску одно решение — 15 %, разрыв настроенной армии и быстрой
 * атаки (docs/stable.md, «Места»).
 */
export const stalls = (s: GameState): number => Math.round(statOf(s, 'stable', 'stalls'));

/** Сколько коней уже занято: строй, учения и раненые — конь с всадником не расседлан. */
export const stallsTaken = (s: GameState): number => {
  const m = soldierMouths(s);
  const mounted = (t: TroopStack): number =>
    TROOP_IDS.reduce((n, id) => n + (TROOP_BY_ID[id].mounted ? Math.max(0, t[id] ?? 0) : 0), 0);
  return mounted(m.army) + mounted(m.recruits) + mounted(m.wounded);
};

/**
 * Сколько единиц каждого припаса прячет Тайник этого уровня.
 *
 * Растёт **геометрически**, тем же множителем `UPGRADE_GROWTH`, каким дорожают
 * улучшения зданий, и это не украшение, а всё содержание таблицы. Обещание
 * тайника одно и должно держаться на любом уровне: **спрятанного хватает на
 * одно улучшение того уровня, на котором игрок сейчас стоит.** Улучшения дорожают
 * в `UPGRADE_GROWTH` раз за уровень; расти линейно тайник не может — к десятому уровню он
 * перестал бы покрывать даже среднее улучшение, а таблица, верная на первый день
 * и бессмысленная на десятый, хуже отсутствующей.
 *
 * Вместимость склада при этом растёт линейно, поэтому доля спрятанного сама
 * собой идёт от мелочи на первом уровне к заметной части на десятом. Ни на каком
 * уровне это не «весь склад» — неуязвимый склад убил бы и риск копить, и смысл
 * нападать. Числа — `npm run sack:report`, раздел «тайник»; вывод — docs/sack.md.
 */
export const stashAt = (level: number): number =>
  Math.round((BUILDING_BY_ID.cache.hidden ?? 0) * Math.pow(UPGRADE_GROWTH, Math.max(1, level) - 1));

/** Сколько единиц каждого ресурса тайник прячет от чужого набега прямо сейчас. */
export const hiddenStash = (s: GameState): number => {
  const b = buildingOfType(s, 'cache');
  return b ? stashAt(b.level) : 0;
};

export interface FeastInfo {
  /** Прибавка к морали, пока пир идёт. */
  bonus: number;
  /** Сколько золота стоит пир прямо сейчас: по числу ртов. */
  cost: number;
  /** Секунд игрового времени до конца пира; 0 — пира нет. */
  left: number;
  /** Секунд до следующего пира; 0 — можно прямо сейчас. */
  cooldown: number;
  /**
   * Сколько секунд после пира бочки стоят пустыми при нынешнем трактире —
   * полный откат, а не остаток. Его и укорачивает уровень.
   */
  wait: number;
  /** Почему нельзя; null — можно. */
  blocked: string | null;
}

/**
 * Пир в трактире: единственный быстрый рычаг морали в игре и второй выход у
 * золота после рынка. Прибавка временная, стоит по числу ртов и упирается в
 * откат — уровень трактира делает пир крепче, а откат короче.
 */
export function feastInfo(s: GameState): FeastInfo {
  const tavern = buildingOfType(s, 'tavern');
  const bonus = tavern ? buildingStat(tavern, 'feast') : 0;
  const level = tavern?.level ?? 0;
  const cost = Math.ceil(FEAST_GOLD_PER_POP * population(s));
  const left = Math.max(0, (s.feastUntil ?? 0) - s.time);
  const wait = Math.max(1, FEAST_COOLDOWN_DAYS - FEAST_COOLDOWN_PER_LEVEL * Math.max(0, level - 1)) * DAY_LENGTH;
  // `feastUntil` — ноль ровно до первого пира (после него он всегда больше нуля,
  // пир длится дни). По нему и отличается «ещё не пировали» от «только что
  // пировали в первую же секунду партии»: первый пир доступен сразу.
  const cooldown = s.feastUntil > 0 ? Math.max(0, s.feastAt + wait - s.time) : 0;
  let blocked: string | null = null;
  if (!tavern) blocked = 'Трактира нет.';
  else if (left > 0) blocked = 'Пир и так идёт.';
  else if (cooldown > 0) blocked = `Бочки пусты: ещё ${daysSpan(Math.ceil(cooldown / DAY_LENGTH))}`;
  else if (s.gold < cost) blocked = `Не хватает золота: нужно ${cost}.`;
  return { bonus, cost, left, cooldown, wait, blocked };
}

/** Прибавка к морали от идущего пира. Ноль, если пира нет. */
export const feastMorale = (s: GameState): number =>
  (s.feastUntil ?? 0) > s.time ? feastInfo(s).bonus : 0;

/** Сколько игрового времени длится пир. */
export const feastSeconds = (): number => FEAST_DAYS * DAY_LENGTH;

// ---------- Содержание войска ----------
//
// Потолка дружины нет: войско держит цена. Каждый боец ест из общего котла и
// получает жалованье из казны; нечем кормить или нечем платить — войско убывает
// (`sim/upkeep.ts`). Здесь всё, что считается при чтении: жалованье, терпение,
// доли неоплаченного и некормленного. Числа — `data/upkeep.ts`, замер —
// `npm run pop:report`, раздел «Содержание войска».

/**
 * Какую долю жалованья платит деревня, чья вера раздаёт казну (закят): воин там
 * не наёмник, а долг. Доля — ровно та, что остаётся от сбора с человека после
 * раздачи: при ней деревня держит столько же войска, сколько соседи при том же
 * налоге, на любом уровне храма и при любом налоге.
 *
 * Постоянной долей это сделать нельзя, и это замерено, а не предположено: закят
 * растёт с уровнем храма, а сбор — с налогом, и доля, подобранная под умеренный
 * налог на десятом уровне, на высоком налоге делает жалованье дешевле налога с
 * головы — армию не держит уже ничто (раздел «Закят» в `pop:report`).
 *
 * Вера, которая собирает (десятина) или не трогает казну, платит полное жалованье.
 * Раздаёт больше, чем собирает налог, — полное тоже: платить воинам нечем, и
 * дешевле тут делать не от чего.
 */
export function wageShare(s: GameState): number {
  const tax = taxOf(s).perPop * TAX_PER_POP;
  const faith = faithTilt(s).goldPerPop;
  if (faith >= 0 || tax + faith <= 0) return 1;
  return Math.min(1, (tax + faith) / tax);
}

/** Жалованье одного бойца этого вида за игровой день, золотом. */
/**
 * Что на бойце надето, в вещах: предметы кузницы и конь под ним. Из этого считается часть
 * жалованья — «платят и за снаряжение» (`WAGE_GEAR`, docs/stable.md, решение 4). Своей таблицы
 * у правила нет: вещи берутся из `TroopDef.gear`, конь — из `mounted`.
 */
export const wageGear = (troop: TroopId): number =>
  gearOfTroop(troop) + (TROOP_BY_ID[troop].mounted ? 1 : 0);

export const wageOf = (s: GameState, troop: TroopId): number =>
  TAX_PER_POP * (WAGE_HEAD + WAGE_MAN * weightOf(troop) + WAGE_GEAR * wageGear(troop)) * wageShare(s);

/**
 * Сколько рук даёт стройке один наёмный мастер: его ставка (`CRAFTER_BUILD` под множителем
 * ремесленника в Мастерской) против ставки свободного жителя на стройке (`BUILDER_RATE`). Сезон
 * стройки и ратуша множат обоих одинаково и сокращаются. Руки растут с уровнем Мастерской и с
 * моралью — ровно так же, как растёт то, что мастер строит.
 */
export function masterHands(s: GameState, mods: SeasonModifiers = seasonMods(s)): number {
  const shop = buildingOfType(s, 'workshop');
  if (!shop) return 0;
  return (CRAFTER_BUILD * workerMultiplier(s, 'crafter', shop, mods)) / BUILDER_RATE;
}

/**
 * Жалованье одного наёмного мастера за игровой день. **Мастер платится как отнятые руки** (решение
 * владельца, docs/admin_branch.md, раздел 4.1): боец отнимает у стройки одного жителя и стоит своё
 * жалованье; мастер даёт стройке `masterHands` рук и стоит столько же бойцов-эталонов
 * (`MASTER_PAID_AS`). Своего числа цены нет: только жалованье бойца и две ставки рук. Отсюда
 * свойство, на котором стоит спор: **единица стройки, купленная мастером, стоит ровно столько, во
 * сколько стройке обходится боец**, — и закят, множащий жалованье бойца, множит её той же долей.
 */
export const masterWage = (s: GameState): number => wageOf(s, MASTER_PAID_AS) * masterHands(s);

/** Жалованье войска за игровой день. Новобранцев на учениях оно не касается. */
export const armyWagesPerDay = (s: GameState): number =>
  TROOP_IDS.reduce((sum, id) => sum + Math.max(0, s.army?.[id] ?? 0) * wageOf(s, id), 0);

/** Жалованье наёмных мастеров за игровой день. */
export const mastersWagesPerDay = (s: GameState): number => mastersCount(s) * masterWage(s);

/**
 * Вся ведомость за игровой день: войско и наёмные мастера. **Казна одна, и ведомость одна** —
 * из неё платит `sim/upkeep`, по ней «по средствам» решает, сколько ещё держать, и по ней же
 * уходят недоплаченные. Второй ведомости у мастеров нет.
 */
export const wagesPerDay = (s: GameState): number => armyWagesPerDay(s) + mastersWagesPerDay(s);

/** Сколько войску причитается сейчас: в отсрочку приведённой партии — ничего. */
export const wagesDue = (s: GameState): number => (s.time < (s.pay?.from ?? 0) ? 0 : wagesPerDay(s));

/** Сколько игровых дней войско терпит неуплату и голод. Работа Статуи — верность полководцу. */
export const payGraceDays = (s: GameState): number => statOf(s, 'statue', 'loyalty');

/**
 * Какая доля войска не оплачена: нехватка, делённая на жалованье. Пока долга нет,
 * неоплаченных нет — плата идёт из казны, сколько бы она ни убывала.
 */
export function unpaidShare(s: GameState): number {
  if ((s.pay?.debt ?? 0) <= 0) return 0;
  const due = wagesDue(s);
  if (due <= 0) return 0;
  return Math.max(0, Math.min(1, (due - taxIncomePerDay(s)) / due));
}

/**
 * Нехватка еды, когда амбар пуст: кого нечем кормить. **Войско ест последним** —
 * сначала посёлок, и голод у жителей начинается только тогда, когда нехватка
 * больше того, что ест войско (`town`). Иначе за армию платил бы посёлок, и потолок
 * по еде войска не касался бы вовсе.
 */
export function foodShortfall(s: GameState, mods: SeasonModifiers = seasonMods(s)): { army: number; town: boolean } {
  if (s.resources.food > 0.5) return { army: 0, town: false };
  const short = foodConsumptionPerDay(s, mods) - productionPerDay(s, mods).food;
  if (short <= 0) return { army: 0, town: false };
  // Нехватка делится между всеми, кто ест солдатский паёк (`soldierMouths`), а не между строем:
  // кто ест — тот и считается.
  // Наёмные мастера едят последними вместе с войском — «по тем же правилам, что у войска»: нехватка
  // делится и на них, и уходят они той же дверью (`sim/upkeep`).
  const army = mouthCount(s) * soldierFoodPerDay(s, mods) + mastersFoodPerDay(s, mods);
  return { army: army > 0 ? Math.min(1, short / army) : 0, town: short > army };
}

export interface UpkeepInfo {
  /** Вся ведомость за день по нынешнему составу: войско и наёмные мастера. */
  wages: number;
  /** Из неё — войску. */
  armyWages: number;
  /** Из неё — наёмным мастерам. */
  mastersWages: number;
  /** Сколько наёмных мастеров в ведомости. */
  masters: number;
  /** Сколько причитается сейчас: ноль в отсрочку. */
  due: number;
  /** Что дают казне налог и вера за день. */
  income: number;
  debt: number;
  graceDays: number;
  /** Сколько дней живой игры войско уже терпит. */
  lateDays: number;
  /** Дней до конца отсрочки; ноль — платят. */
  amnestyDays: number;
  /** Дней до пустой казны при нынешней нехватке; null — казна не убывает. */
  treasuryDays: number | null;
  unpaid: number;
  unfed: number;
  /** Почему войско терпит или уходит; null — не терпит. */
  why: 'pay' | 'food' | null;
  /** Сколько бойцов уходит за день, если терпение кончилось; ноль — не уходят. */
  leavingPerDay: number;
}

/** Всё о содержании войска в эту минуту — для казарм, ратуши и тревоги. */
export function upkeepInfo(s: GameState): UpkeepInfo {
  const wages = wagesPerDay(s);
  const due = wagesDue(s);
  const income = taxIncomePerDay(s);
  const unpaid = unpaidShare(s);
  const unfed = foodShortfall(s).army;
  const graceDays = payGraceDays(s);
  const lateDays = (s.pay?.late ?? 0) / DAY_LENGTH;
  const share = Math.max(unpaid, unfed);
  const why = share <= 0 ? null : unpaid >= unfed ? 'pay' : 'food';
  const gap = due - income;
  return {
    wages,
    armyWages: armyWagesPerDay(s),
    mastersWages: mastersWagesPerDay(s),
    masters: mastersCount(s),
    due,
    income,
    debt: s.pay?.debt ?? 0,
    graceDays,
    lateDays,
    amnestyDays: Math.max(0, ((s.pay?.from ?? 0) - s.time) / DAY_LENGTH),
    treasuryDays: gap > 0 && s.gold > 0 ? s.gold / gap : null,
    unpaid,
    unfed,
    why,
    // Строй и наёмные мастера уходят по большей из двух долей, раненые и новобранцы — только голодом (`sim/upkeep`).
    leavingPerDay:
      why && lateDays >= graceDays
        ? DESERT_SHARE * (share * (armySize(s) + mastersCount(s)) + unfed * (mouthCount(s) - armySize(s)))
        : 0,
  };
}

/** Сколько бойцов ждёт своей очереди в казармах. */
export const recruitsQueued = (s: GameState): number =>
  (s.recruits ?? []).reduce((n, o) => n + Math.max(0, o.count - o.done), 0);

/**
 * Скорость обучения в казармах: работа в секунду. Зависит от уровня казарм —
 * учения идут своим чередом, без рабочих и без сезона. Растёт она быстрее выработки
 * зданий, потому что умножается ещё и на сам уровень: дружина в сотни бойцов при
 * линейном росте набиралась бы часами.
 *
 * **Вид бойца обязателен.** Скорости «казарм вообще» у игры нет: всадник учится
 * с множителем конюшни, пеший — без. Пока вид был необязательным, очередь казарм
 * и карточка вида считали срок без него и показывали всаднику 13 секунд там, где
 * очередь шла 5. Теперь такой срок просто не собирается.
 */
export function recruitRate(s: GameState, troop: TroopId): number {
  // Конницу учат в конюшне, пеших — в казармах: у каждого здания своя очередь и свой уровень.
  // Формула одна и та же, поэтому при равных уровнях срок найма головы прежний.
  const mounted = TROOP_BY_ID[troop].mounted === true;
  const b = buildingOfType(s, mounted ? 'stable' : 'barracks');
  if (!b) return 0;
  const base = RECRUIT_WORK * b.level * levelOutputMult(b.level);
  return mounted ? base * cavalryTrain(s) : base;
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
  /** Что куётся прямо сейчас. null — очередь пуста, кузница стоит. */
  item: EquipmentId | null;
  def: EquipmentDef | null;
  /** Работа в секунду. */
  rate: number;
  /** Накоплено и нужно работы на текущий предмет. */
  work: number;
  need: number;
  /** Сколько заказов в очереди. */
  queued: number;
  /** Секунд до конца первого заказа целиком; null — работа стоит. */
  eta: number | null;
  /** Почему кузница молчит; null — всё в порядке. */
  blocked: string | null;
  /** Кузница простаивает: кузнецы есть, а заказов нет. Это надо показывать. */
  idle: boolean;
}

/**
 * Что происходит в кузнице. Материалов эта функция не спрашивает: за заказ
 * платят вперёд, поэтому встать посреди дела он не может — встать он может
 * только оттого, что от горна ушли люди.
 */
export function forgeInfo(s: GameState, mods: SeasonModifiers = seasonMods(s)): ForgeInfo {
  const order = s.forge?.[0] ?? null;
  const def = order ? EQUIPMENT_BY_ID[order.item] : null;
  const rate = forgeRate(s, mods);
  const smiths = forgeHands(s);
  const work = order?.work ?? 0;
  const need = def?.work ?? 0;
  let blocked: string | null = null;
  if (!def) blocked = 'Заказов нет — кузница стоит.';
  else if (rate <= 0) blocked = 'В кузнице никто не работает.';
  const left = def && order ? def.work * (order.count - order.done) - work : 0;
  return {
    item: order?.item ?? null,
    def,
    rate,
    work,
    need,
    queued: s.forge?.length ?? 0,
    eta: def && rate > 0 ? Math.max(0, Math.ceil(left / rate)) : null,
    blocked,
    // Простой — это кузнецы у холодного горна. Кузница без людей не простаивает,
    // она просто пуста, и лечится это другим: людьми, а не заказом.
    idle: !order && smiths > 0,
  };
}

/** Сколько кузнецов стоит у горна. Отдельной функцией: её спрашивают и панель, и сцена. */
export function forgeHands(s: GameState): number {
  const smithy = buildingOfType(s, 'smithy');
  return smithy ? workerCount(s, smithy.id) : 0;
}

// ---------- Производство ----------

/**
 * Во что мораль обходится выработке: от `MORALE_OUTPUT_LOW` при нуле до
 * `MORALE_OUTPUT_LOW + MORALE_OUTPUT_SPAN` при сотне. Отдельной функцией, потому
 * что это же число показывает справочный экран счастья — считать его дважды нельзя.
 */
export const moraleOutputMult = (morale: number): number =>
  MORALE_OUTPUT_LOW + (Math.max(0, Math.min(100, morale)) / 100) * MORALE_OUTPUT_SPAN;

/** Множитель производительности профессии с учётом веры, сезона и указа. */
export function jobMultiplier(s: GameState, job: JobId, mods: SeasonModifiers = seasonMods(s)): number {
  let m = mods.jobs[job] ?? 1;
  m *= moraleOutputMult(s.morale);
  // Вера двигает выработку одним множителем на все профессии сразу — служб и
  // постов не бывает «только у охотника». Профессии врозь она не трогает и
  // трогать не должна: тогда одна вера оказалась бы лучшей под одно хозяйство,
  // а вера достаётся по месту, а не выбирается.
  m *= faithTilt(s).output;
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

/**
 * Осада идёт прямо сейчас? Ровно тогда, когда мир её положил: срок считает он
 * (`world/siege.ts`), а снимает поле мост (`bridge.syncSiege`). Своего срока здесь
 * нет — сверка с часами племени была второй правдой о том же. Офлайн-догон, у
 * которого мира нет, снимает поле сам по переведённому сроку (`sim/tick`).
 */
export const underSiege = (s: GameState): boolean => s.siege !== null;

/**
 * Во сколько раз осада срезала приток этого ресурса. Единственное место, где
 * это решается: панели и тик спрашивают его, а не проверяют осаду у себя.
 */
export const siegeYield = (s: GameState, r: ResourceId): number =>
  !underSiege(s) ? 1 : r === 'food' ? SIEGE_FOOD_YIELD : SIEGE_YIELD;

/** Режет готовую выработку осадой. Мутирует на месте — как и всё здесь. */
function cutBySiege(s: GameState, out: Resources): Resources {
  if (!underSiege(s)) return out;
  for (const r of RESOURCE_IDS) out[r] *= siegeYield(s, r);
  return out;
}

/**
 * Выработка одного здания без осады: вольные и невольники на его местах.
 *
 * Невольники идут той же строкой — та же таблица профессии, тот же множитель
 * места, сезона, морали, веры и указа, — и только на свою долю (`BONDED_OUTPUT`).
 * Второго расчёта выработки под них нет и заводить его нельзя: две формулы
 * одного и того же разойдутся при первой правке одной из них.
 */
function yardYield(s: GameState, out: Resources, b: Building, mods: SeasonModifiers): void {
  const job = BUILDING_BY_ID[b.type].job;
  if (!job) return;
  const mult = workerMultiplier(s, job, b, mods);
  addYield(out, job, workerCount(s, b.id), mult);
  addYield(out, job, bondedCount(s, b.id), mult * bondedShare(s));
}

/** Валовое производство за игровой день. */
export function productionPerDay(s: GameState, mods: SeasonModifiers = seasonMods(s)): Resources {
  const out = emptyResources();
  for (const b of s.buildings) yardYield(s, out, b, mods);
  for (const job of FREE_JOBS) {
    addYield(out, job, freeJobCount(s, job), workerMultiplier(s, job, null, mods));
  }
  return cutBySiege(s, out);
}

/** Что производит одно здание за день — для его собственной панели. */
export function buildingProduction(s: GameState, b: Building, mods: SeasonModifiers = seasonMods(s)): Resources {
  const out = emptyResources();
  yardYield(s, out, b, mods);
  return cutBySiege(s, out);
}

/**
 * Расход еды за день. Бойцы не добывают и не строят, но едят из того же котла —
 * иначе армия обходилась бы племени только людьми. Рацион множит весь расход.
 */
export function foodConsumptionPerDay(s: GameState, mods: SeasonModifiers = seasonMods(s)): number {
  // Новобранцы на учениях и раненые уже не жители, но кормятся так же, как бойцы: список ртов один
  // на расход и на голод (`soldierMouths`).
  return townFoodPerDay(s, mods) + mouthCount(s) * soldierFoodPerDay(s, mods) + mastersFoodPerDay(s, mods);
}

/**
 * Сколько за день съедают наёмные мастера. Паёк у них жителя — по голове, тем же сезоном и
 * рационом, — а голодают они как войско: едят последними (`foodShortfall`). Под осадой они
 * заперты в городе и едят из того же амбара (`world/bridge`, `foodPerHour`).
 */
export const mastersFoodPerDay = (s: GameState, mods: SeasonModifiers = seasonMods(s)): number =>
  mastersCount(s) * mods.food * rationOf(s).food;

/**
 * Сколько съедает за день сам посёлок — без единого бойца. Отдельно от общего
 * расхода это нужно осаде: под стенами еду ест то, что внутри, а дружина в
 * поле кормится не из осаждённого амбара. Считается тут, а не в мире: мир про
 * жителей и профессии не знает и знать не должен.
 */
export function townFoodPerDay(s: GameState, mods: SeasonModifiers = seasonMods(s)): number {
  let total = 0;
  const counts = jobCounts(s);
  for (const job of JOBS) total += counts[job.id];
  // Невольники едят по головам, как все: из того же котла, по тому же пайку и
  // с тем же зимним множителем. Под осадой они заперты в городе вместе со всеми
  // и едят из осаждённого амбара — часы голода от них короче.
  total += bondedTotal(s);
  return total * mods.food * rationOf(s).food;
}

/**
 * Что добавляет к дневному расходу один боец. Сезон и рацион множат его так же,
 * как и всё остальное, — иначе зимняя осада считалась бы по летним числам.
 */
export const soldierFoodPerDay = (s: GameState, mods: SeasonModifiers = seasonMods(s)): number =>
  SOLDIER_FOOD * mods.food * rationOf(s).food;

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
  // Наёмный мастер работает по ставке ремесленника — на голову та же `CRAFTER_BUILD` и тот же
  // множитель; своей ставки у него нет (docs/admin_branch.md, раздел 4.1).
  return CRAFTER_BUILD * (workerCount(s, shop.id) + mastersOn(s, shop.id)) * workerMultiplier(s, 'crafter', shop, mods);
}

/**
 * Сколько из скорости стройки приносят наёмные мастера — под теми же сезоном и ратушей, что вся
 * стройка (`buildRate`). Та же ставка на голову, что у ремесленника, умноженная на число мастеров:
 * своей доли у них нет, и панель Мастерской показывает ровно это число.
 */
export function mastersBuildShare(s: GameState, mods: SeasonModifiers = seasonMods(s)): number {
  const shop = buildingOfType(s, 'workshop');
  if (!shop) return 0;
  return mastersOn(s, shop.id) * crafterHeadShare(s, mods);
}

/**
 * Сколько стройки в секунду даёт одна голова Мастерской — ремесленник или наёмный мастер — под
 * сезоном и ратушей. Из этого числа складывается и вклад мастеров, и то, что обещает строка найма.
 */
export function crafterHeadShare(s: GameState, mods: SeasonModifiers = seasonMods(s)): number {
  const shop = buildingOfType(s, 'workshop');
  if (!shop) return 0;
  return CRAFTER_BUILD * workerMultiplier(s, 'crafter', shop, mods) * mods.build * townHallBuildMult(s);
}

/**
 * Множитель скорости стройки от уровня ратуши: +`TOWN_HALL_BUILD_STEP` за уровень сверх первого.
 * Ратуша не даёт труда сама — она им распоряжается, поэтому это множитель ко
 * всему, что строит посёлок, а не ещё одно слагаемое.
 */
export function townHallBuildMult(s: GameState): number {
  const hall = buildingOfType(s, 'town_hall');
  if (!hall) return 1;
  return 1 + TOWN_HALL_BUILD_STEP * Math.max(0, hall.level - 1);
}

/**
 * Скорость стройки: свободные жители с площади плюс ремесленники в мастерской,
 * всё это — под рукой ратуши.
 * Улучшения — единственная прогрессия посёлка, и мастерская существует ради них.
 */
export function buildRate(s: GameState, mods: SeasonModifiers = seasonMods(s)): number {
  // Ушедшие разведчиками — те же свободные жители: пока они в пути, стройка идёт без них.
  const idle = Math.max(0, jobCounts(s).idle - Math.max(0, s.scoutsAway));
  // Невольники без места — на стройке, тем же трудом и на ту же долю, что в поле.
  const bonded = bondedIdle(s) * bondedShare(s);
  return ((idle + bonded) * BUILDER_RATE + crafterBuildRate(s, mods)) * mods.build * townHallBuildMult(s);
}

/**
 * Сколько мастерская прибавляет к скорости стройки на самом деле: вклад ремесленников
 * под теми же множителями сезона и ратуши, что и вся стройка (`buildRate`). Панель
 * мастерской писала голый `crafterBuildRate` — у ратуши десятого уровня 8.0/с там, где
 * в стройку шло 13.8/с. Сходство с `buildRate` держит тест: сумма без мастерской и
 * этого вклада обязана давать полную скорость.
 */
export const crafterBuildShare = (s: GameState, mods: SeasonModifiers = seasonMods(s)): number =>
  crafterBuildRate(s, mods) * mods.build * townHallBuildMult(s);

export function canAfford(s: GameState, cost: Partial<Record<ResourceId, number>>): boolean {
  for (const r of RESOURCE_IDS) if ((cost[r] ?? 0) > s.resources[r]) return false;
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
  // Скидка на весь посёлок (`HEATING_CAMPFIRE`) — всегда: костра она не спрашивает.
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

/** Одно слагаемое морали: почему племя довольно или недовольно именно сейчас. */
export interface MoraleLine {
  id: string;
  icon: string;
  name: string;
  /** Вклад в целевую мораль. Ноль в список не попадает. */
  value: number;
  /** Откуда взялось число — живыми величинами этой партии. */
  hint: string;
}

export interface MoraleBreakdown {
  /** Мораль устоявшегося племени, от которой всё считается. */
  base: number;
  lines: MoraleLine[];
  /** База со всеми слагаемыми, до приведения к шкале. */
  raw: number;
  /** Она же в пределах 0..100. */
  clamped: number;
  /** Просадка от налога — она вычитается уже после приведения к шкале. */
  tax: number;
  /**
   * Прибавка от пира в трактире. Стоит рядом с налогом, потому что ложится туда
   * же — после приведения к шкале: до неё она бы утонула (см. moraleBreakdown).
   */
  feast: number;
  /**
   * Прибавка от обряда в храме. Ложится туда же, где пир, но это другое число и
   * другое здание: пока они лежали одним полем, справка о морали подписывала
   * обряд без пира «Пиром в трактире».
   */
  rite: number;
  /** Итог: к какой морали стремится племя. */
  target: number;
}

/**
 * Разбор целевой морали по слагаемым. `moraleTarget` считается отсюда же, а не
 * рядом: экран счастья показывает ровно то, чем живёт симуляция, и разойтись
 * им негде.
 */
export function moraleBreakdown(s: GameState): MoraleBreakdown {
  const lines: MoraleLine[] = [];
  // Ноль в список не попадает: строка «зима −0» была бы шумом. Исключение —
  // рычаги, про которые игрок иначе не узнает, что они у него вообще есть.
  const add = (id: string, icon: string, name: string, value: number, hint: string, keepZero = false): void => {
    if (keepZero || Math.abs(value) > 0.001) lines.push({ id, icon, name, value, hint });
  };

  const pop = s.pop;
  const housing = housingCapacity(s);
  // Теснота считается долей, а не головами: при сотнях жителей штраф
  // «минус пять за человека сверх крыш» обнулял бы мораль от одного лишнего.
  if (pop <= housing) {
    add('housing', '🛏️', 'Жильё с запасом', 10, `${housing - pop} свободных мест из ${housing}`);
  } else {
    const over = pop - housing;
    add(
      'crowding',
      '🏚️',
      'Теснота',
      -Math.min(CROWDING_MAX, (CROWDING_PENALTY * over) / Math.max(1, housing)),
      `${over} чел. сверх крыш — потолок штрафа −${CROWDING_MAX}`,
    );
  }

  const eat = foodConsumptionPerDay(s);
  const foodDays = s.resources.food / Math.max(1, eat);
  if (s.resources.food <= 0) add('starving', '💀', 'Закрома пусты', -25, 'еды нет вовсе');
  else if (foodDays >= 3) add('fed', '🍖', 'Сытость', 10, `запас на ${gameDaysText(foodDays.toFixed(1))}`);
  else if (foodDays < 1) add('hungry', '🍖', 'Голодно', -8, `запас меньше дня: ${foodDays.toFixed(1)}`);

  for (const b of s.buildings) {
    const v = buildingStat(b, 'morale');
    const def = BUILDING_BY_ID[b.type];
    add(`b-${b.id}`, def.icon, def.name, v, `уровень ${b.level}`);
  }

  const priests = jobCounts(s).priest;
  add(
    'priests',
    '🕯️',
    'Жрецы в церкви',
    priestMorale(s),
    `${priests} чел. по +${PRIEST_MORALE}, потолок +${PRIEST_MORALE_CAP}`,
    true,
  );

  add(
    'prestige',
    '🏅',
    'Слава племени',
    Math.min(10, s.prestige / 5),
    `${s.stats.battlesWon} побед · ${s.stats.battlesLost} поражений, слава ${Math.round(s.prestige)}`,
  );

  const season = seasonOf(s.time);
  add('season', SEASON_META[season].icon, SEASON_META[season].name, seasonMods(s).morale, 'сезонный сдвиг');
  if (s.freezing > 0) add('freezing', '🥶', 'Племя мёрзнет', -FREEZING_MORALE_PENALTY, 'дрова кончились');

  // Вера. Два слагаемых, и они разной природы: наклон — то, что вера просит и
  // даёт всегда (десятина давит, община держит), а ересь — то, что случается,
  // когда набожность провалилась. Считаются они не здесь: строка берёт готовое
  // число у `faithTilt` и `heresyMorale`, второй формулы тут быть не должно.
  const fd = faithDef(s);
  if (fd) {
    add('faith', fd.icon, fd.name, faithTilt(s).morale, `${fd.temple} ${templeLevel(s)} ур., ${OBSERVANCE_BY_ID[observanceOf(s)].name.toLowerCase()}`);
    add('heresy', '🔥', 'Вера трещит', heresyMorale(s), `набожность ${Math.round(piety(s))} из ${PIETY_HERESY}`);
  }

  const raw = lines.reduce((n, l) => n + l.value, MORALE_BASE);
  const clamped = Math.min(100, raw);
  // Налог давит на мораль не медленным сползанием, а прямо: сползание племя
  // отыграло бы за минуту, а просадка держится ровно столько, сколько держат налог.
  // Вычитается он уже из приведённой к шкале величины — иначе в большом посёлке,
  // где мораль и так упёрлась в потолок, налог не стоил бы вообще ничего.
  // Пир прибавляется там же, где вычитается налог, — **после** приведения к
  // шкале. Иначе он утонул бы: постоянных источников морали в посёлке на потолке
  // уровней уже больше, чем вмещает шкала, и ещё одно слагаемое до `Math.min`
  // не стоило бы ничего. А так пир делает ровно то, ради чего он есть: отыгрывает
  // просадку от налога, голода, тесноты и холода — и ни разу не переполняет шкалу.
  const tax = taxOf(s).moralePenalty;
  // Обряд ложится там же, где пир, и по той же причине: до `Math.min` он утонул
  // бы в посёлке на потолке уровней, где постоянных источников морали и так
  // больше, чем вмещает сотня.
  const feast = feastMorale(s);
  const rite = riteMorale(s);
  return {
    base: MORALE_BASE,
    lines,
    raw,
    clamped,
    tax,
    feast,
    rite,
    target: Math.max(0, Math.min(100, clamped - tax + feast + rite)),
  };
}

/** К какой морали стремится племя при текущих условиях. */
export const moraleTarget = (s: GameState): number => moraleBreakdown(s).target;

/**
 * Что служители храма дают морали: по голове и до потолка. Уровень храма их не
 * усиливает — места служителей упираются в потолок раньше, чем кончаются уровни.
 * Отдельной функцией, потому что это число читает не только разбор морали, но и
 * кнопка улучшения: замер «что дадут новые места» обязан считать ровно этим.
 */
export const priestMorale = (s: GameState): number =>
  Math.min(PRIEST_MORALE_CAP, jobCounts(s).priest * PRIEST_MORALE);

// ---------- Вера и набожность ----------
//
// Набожность — величина того же рода, что мораль, и с одним важным отличием:
// своего поля в состоянии у неё нет. Она **считается при чтении** из храма,
// уклада, обряда, чужой веры вокруг и надлома — а значит не может разойтись со
// своими слагаемыми, не требует ни тика, ни офлайн-догона, и вернувшийся после
// долгого отсутствия игрок застаёт ровно то же, что застал бы, просидев всё это
// время в игре.
//
// Считается это здесь и только здесь. Панель храма своих формул не держит:
// слагаемые приходят отсюда готовыми, ровно как у морали (`moraleBreakdown`).
// Действия над верой — обряд, уклад, крещение — живут в `sim/faith.ts`.

/** Слагаемое набожности — одна строка на экране храма. */
export interface PietyLine {
  id: string;
  icon: string;
  name: string;
  value: number;
  hint: string;
}

export interface PietyBreakdown {
  base: number;
  lines: PietyLine[];
  /** Сумма до приведения к шкале. */
  raw: number;
  /** Итог, 0..100. */
  value: number;
}

/** Уровень храма. Ноль — храма нет вовсе. */
export const templeLevel = (s: GameState): number => buildingOfType(s, 'church')?.level ?? 0;

/** Уклад храма. Сохранение без поля читается как ровный обычай. */
export const observanceOf = (s: GameState): ObservanceId =>
  OBSERVANCE_BY_ID[s.faith?.observance as ObservanceId] ? s.faith.observance : 'even';

/** Вера деревни. null — мир ещё не назвал клетку замка. */
export const faithOf = (s: GameState): FaithId | null => s.faith?.id ?? null;

/** Определение веры деревни. null — вера ещё неизвестна. */
export const faithDef = (s: GameState): FaithDef | null => {
  const id = faithOf(s);
  return id ? FAITH_BY_ID[id] : null;
};

/** Идёт ли обряд прямо сейчас. */
export const riteActive = (s: GameState): boolean => (s.faith?.riteUntil ?? 0) > s.time;

/**
 * Надлом на сейчас: сколько его осталось от отметки. Убывает линейно за
 * `STRAIN_DAYS` игровых дней — считается при чтении, а не сползает в тике.
 */
export function strainNow(s: GameState): number {
  const f = s.faith;
  if (!f || f.strain <= 0) return 0;
  const gone = Math.max(0, s.time - f.strainAt) / (STRAIN_DAYS * DAY_LENGTH);
  return Math.max(0, f.strain * (1 - gone));
}

/** Наклон веры, когда веры нет: ничего не даёт и ничего не просит. */
const FLAT_TILT: FaithTilt = {
  boon: '',
  burden: '',
  goldPerPop: 0,
  morale: 0,
  output: 1,
  steadfast: 0,
  learning: 1,
  growth: 0,
  fervour: 0,
  pressure: 1,
};

/**
 * Наклон веры прямо сейчас: уровень храма и уклад. Плоский, пока вера
 * неизвестна, — и это не заглушка, а честный ответ: деревня, о которой мир ещё
 * не сказал, где она стоит, ничего от веры не получает и ничего не платит.
 */
export function faithTilt(s: GameState): FaithTilt {
  const id = faithOf(s);
  return id ? tiltAt(id, templeLevel(s), observanceOf(s)) : FLAT_TILT;
}

/**
 * Разбор набожности по слагаемым. `piety` считается отсюда же, а не рядом:
 * экран храма показывает ровно то, чем живёт игра, и разойтись им негде.
 */
export function pietyBreakdown(s: GameState): PietyBreakdown {
  const lines: PietyLine[] = [];
  const add = (id: string, icon: string, name: string, value: number, hint: string, keepZero = false): void => {
    if (keepZero || Math.abs(value) > 0.001) lines.push({ id, icon, name, value, hint });
  };
  const id = faithOf(s);
  if (!id) return { base: PIETY_BASE, lines, raw: PIETY_BASE, value: PIETY_BASE };
  const def = FAITH_BY_ID[id];
  const level = templeLevel(s);
  const obs = OBSERVANCE_BY_ID[observanceOf(s)];

  add('temple', def.icon, def.temple, level * PIETY_PER_LEVEL, `уровень ${level} по +${PIETY_PER_LEVEL}`);
  const priests = jobCounts(s).priest;
  add(
    'priests',
    '🕯️',
    'Служители прихода',
    priestPiety(s),
    `${priests} чел. по +${PIETY_PER_PRIEST}, потолок +${PIETY_PRIEST_CAP}`,
    true,
  );
  add('observance', obs.icon, obs.name, obs.piety, obs.effect, true);

  if (riteActive(s)) {
    const feast = def.feasts[seasonOf(s.time)];
    add('rite', feast.icon, `Обряд: ${feast.name}`, PIETY_RITE, 'приход служит и празднует');
  }
  if (s.faith.relic) add('relic', '📿', FAITH_BY_ID[s.faith.relic].relic, PIETY_RELIC, 'реликвия прихода');

  // Чужая вера вокруг. Множитель — свойство самой веры (`tilt.pressure`), а не
  // оценка её: у язычества нет ни грамоты, ни дальнего владыки, к которому
  // отсылают спорщика, поэтому спор идёт в самой деревне.
  const pressure = Math.max(0, Math.min(1, s.faith.pressure ?? 0));
  add(
    'pressure',
    '🧭',
    'Округа иной веры',
    -pressure * PIETY_PRESSURE * def.tilt.pressure,
    `${Math.round(pressure * 100)}% земли вокруг верит иначе`,
  );

  const foodDays = s.resources.food / Math.max(1, foodConsumptionPerDay(s));
  if (foodDays < 1) add('hunger', '🍖', 'Голодно в приходе', -PIETY_HUNGER, 'за что нам это');
  if (s.siege) add('siege', '⚔️', 'Под стенами чужие', -PIETY_SIEGE, `осадил ${s.siege.byName}`);
  add('strain', '💔', 'Надлом', -strainNow(s), 'навязанные решения ещё помнят');

  const raw = lines.reduce((n, l) => n + l.value, PIETY_BASE);
  return { base: PIETY_BASE, lines, raw, value: Math.max(0, Math.min(100, raw)) };
}

/** Набожность деревни, 0..100. */
export const piety = (s: GameState): number => pietyBreakdown(s).value;

/**
 * Что служители дают набожности: по голове и до потолка, как у морали. Пока мир
 * не назвал веру, набожности не считается вовсе — и служители ничего не дают.
 */
export const priestPiety = (s: GameState): number =>
  faithOf(s) === null ? 0 : Math.min(PIETY_PRIEST_CAP, jobCounts(s).priest * PIETY_PER_PRIEST);

/** Вера трещит: набожность упала ниже порога. */
export const heresy = (s: GameState): boolean => faithOf(s) !== null && piety(s) < PIETY_HERESY;

/**
 * Во что ересь обходится морали. Между порогом и нулём — линейно: приход не
 * разваливается со щелчком, он расходится тем сильнее, чем меньше в нём веры.
 *
 * Второй механики под это не заведено, и это решение, а не экономия. В деревне
 * бунта нет ни в каком виде: `revolts` в мире — окно на **чужом** поселении,
 * его поднимает лазутчик, и к своему двору оно неприменимо. Поэтому ересь идёт
 * туда, где деревня и так живёт: в мораль, в строку тревоги и в событие с
 * выбором.
 */
export function heresyMorale(s: GameState): number {
  // Набожность спрашивается один раз: `pietyBreakdown` строит список строк, а
  // зовут отсюда каждый тик через `moraleBreakdown`. Через `heresy(s)` вышло бы
  // два прохода на ровном месте.
  if (faithOf(s) === null) return 0;
  const p = piety(s);
  if (p >= PIETY_HERESY) return 0;
  return -PIETY_HERESY_MORALE * (1 - p / PIETY_HERESY);
}

/** Прибавка к морали, пока идёт обряд. Ложится после шкалы, там же, где пир. */
export const riteMorale = (s: GameState): number => (riteActive(s) ? RITE_MORALE : 0);

/**
 * Прибавка к стойкости дружины на время обряда — единственное, что вера кладёт
 * в бой. Число зависит от **своей** веры, своего храма и своего уклада, и ни от
 * чего больше: у `BattleInput` нет поля веры вовсе, и взять её противнику
 * неоткуда (см. `LocalWorld.ownResolve` и `sim/faith.test.ts`).
 */
export const fervour = (s: GameState): number => (riteActive(s) ? faithTilt(s).fervour : 0);

/**
 * Как здание называется у этой деревни. Отличается от `def.name` ровно у одного
 * здания и ровно по одной причине: храм у мусульман — мечеть, у язычников —
 * капище, и подписывать их «Церковью» значит врать игроку на самом видном месте.
 *
 * Живёт здесь, а не в панели, чтобы имя было одно: его берут и шапка панели, и
 * список построек в ратуше. Идентификатор здания при этом прежний (`church`) —
 * от него зависят план посёлка, модель, значок и сохранение, и трогать их
 * из-за подписи нельзя.
 */
export function buildingTitle(s: GameState, type: BuildingTypeId): string {
  if (type !== 'church') return BUILDING_BY_ID[type].name;
  return faithDef(s)?.temple ?? BUILDING_BY_ID[type].name;
}

/** Сбор веры за игровой день: десятина в казну (плюс) или закят из неё (минус). */
export const faithGoldPerDay = (s: GameState): number => faithTilt(s).goldPerPop * population(s);

// ---------- Порядок в городе ----------
//
// Порядок отвечает на один вопрос: удержит ли власть невольников. Своего поля в
// состоянии у него нет — он считается при чтении, как набожность, — поэтому не
// может разойтись со своими слагаемыми и не требует ни тика, ни догона.
//
// Считается он отношением: сколько невольников держит надзор — сами дворы,
// стража дома и спокойные горожане — против того, сколько их есть. Надзор равен
// числу невольников — порядок 50. Без невольников держать некого, и порядок
// полный при любом гарнизоне и любой морали: мятежа без невольников не бывает.
//
// От морали порядок отличается по существу, а не подписью. Мораль — довольны ли
// горожане: от неё выработка и прирост. Порядок — удержит ли власть тех, у кого
// воли нет: от него мятеж. Мораль входит в порядок одним слагаемым (спокойные
// горожане держат невольников), а порядок в мораль не входит никак. Это две
// разные величины об одном городе, а не две правды об одном вопросе.

/** Слагаемое надзора: кто и скольких невольников держит. */
export interface OrderLine {
  id: 'household' | 'guards' | 'town';
  icon: string;
  name: string;
  /** Скольких невольников держит это слагаемое. */
  value: number;
  /** Откуда взялось число — живыми величинами этой партии. */
  hint: string;
}

export interface OrderBreakdown {
  lines: OrderLine[];
  /** Надзор: скольких невольников держат все слагаемые вместе. */
  hold: number;
  /** Сколько невольников. */
  bonded: number;
  /** Порядок, 0..100. */
  value: number;
}

/**
 * Разбор порядка по слагаемым. `extraBonded` — сколько невольников прибавится:
 * рынок показывает, каким станет порядок **до** покупки, и считает он это той же
 * функцией, а не своей.
 */
export function orderBreakdown(s: GameState, extraBonded = 0): OrderBreakdown {
  const T = ORDER_TEXT.lines;
  const guards = homeArmy(s);
  const pop = Math.max(0, s.pop);
  const lines: OrderLine[] = [
    { id: 'household', icon: T.household.icon, name: T.household.name, value: ORDER_HOUSEHOLD, hint: T.household.hint },
    {
      id: 'guards',
      icon: T.guards.icon,
      name: T.guards.name,
      value: guards * ORDER_PER_GUARD,
      hint: T.guards.hint(guards, ORDER_PER_GUARD),
    },
    {
      id: 'town',
      icon: T.town.icon,
      name: T.town.name,
      // Недовольный горожанин невольников не держит: при морали M он держит
      // M/100 от того, что держит довольный. Сюда мораль и входит — одним
      // слагаемым, и больше нигде.
      value: pop * ORDER_PER_TOWNSMAN * (Math.max(0, Math.min(100, s.morale)) / 100),
      hint: T.town.hint(pop, ORDER_PER_TOWNSMAN, s.morale),
    },
  ];
  const hold = lines.reduce((n, l) => n + l.value, 0);
  const bonded = Math.max(0, bondedTotal(s) + extraBonded);
  const value = bonded <= 0 ? 100 : (100 * hold) / (hold + bonded);
  return { lines, hold, bonded, value };
}

/** Порядок в городе, 0..100. */
export const orderValue = (s: GameState): number => orderBreakdown(s).value;

/**
 * Ступень порядка. `none` — невольников нет; `shaky` — их больше, чем держит
 * надзор; `unrest` — ропот, и срок до мятежа идёт.
 */
export type OrderState = 'none' | 'calm' | 'shaky' | 'unrest';

export function orderState(s: GameState): OrderState {
  const o = orderBreakdown(s);
  if (o.bonded <= 0) return 'none';
  if (o.value < ORDER_UNREST) return 'unrest';
  if (o.value < ORDER_WARN) return 'shaky';
  return 'calm';
}

/** Мятеж на столе: окно ждёт ответа. */
export const mutinyOpen = (s: GameState): boolean => s.inbox.some((e) => e.defId === MUTINY_EVENT);

/**
 * Секунд до мятежа, пока идёт ропот. null — ропота нет: порядок выше порога, или
 * мятеж уже поднялся и ждёт ответа. Срок идёт только при игроке, поэтому здесь
 * он читается из накопленного ропота, а не из часов.
 */
export function unrestLeft(s: GameState): GameSec | null {
  if (mutinyOpen(s) || orderState(s) !== 'unrest') return null;
  return asGame(Math.max(0, MUTINY_FUSE - Math.max(0, s.unrest ?? 0)));
}

/**
 * Какую долю работы вольного делает невольник сейчас. Пока мятеж ждёт ответа, невольники стоят —
 * ноль: мятеж ждёт сутки, как любое донесение (решение владельца, docs/time.md, раздел 16), и
 * окно, которое можно держать открытым, не должно держать их за работой. Одна дверь на поле и на
 * стройку — второго «работают ли невольники» быть не должно.
 */
export const bondedShare = (s: GameState): number => (mutinyOpen(s) ? 0 : BONDED_OUTPUT);

/** Что сделает мятеж прямо сейчас — всё, что игрок обязан знать до него. */
export interface MutinyForecast {
  /** Сколько невольников поднимется. */
  bonded: number;
  /** Бойцов дома и их мощь. */
  guards: number;
  power: number;
  /**
   * Скольких невольников стража подавит. Мятежник бьётся, как житель на стене
   * (`VILLAGER_DEFENSE`): число про то, чего стоит безоружный в драке, в игре
   * одно, и второго под мятеж не заводится.
   */
  crush: number;
  /** Подавит ли стража мятеж прямо сейчас. */
  holds: boolean;
  /** Сколько невольников сбежит, если подавит. */
  flee: number;
  /** Сколько горожан уйдёт, если не подавит. */
  leave: number;
  /** Во что обойдётся раздача: еда и золото на голову. */
  payFood: number;
  payGold: number;
}

export function mutinyForecast(s: GameState): MutinyForecast {
  const bonded = bondedTotal(s);
  const power = homeArmyPower(s);
  const crush = Math.floor(power / VILLAGER_DEFENSE);
  const pop = Math.max(0, s.pop);
  const heads = pop + bonded;
  return {
    bonded,
    guards: homeArmy(s),
    power,
    crush,
    holds: bonded <= crush,
    flee: Math.round(bonded * MUTINY_SUPPRESS_FLEE),
    leave: Math.round(pop * MUTINY_TOWN_LEAVE),
    payFood: Math.ceil(heads * MUTINY_PAY_FOOD),
    payGold: Math.ceil(heads * MUTINY_PAY_GOLD),
  };
}

// ---------- Тревоги ----------

export interface Alert {
  id: string;
  icon: string;
  text: string;
  /**
   * Вторая строка — цена того, о чём тревога. Нужна там, где срок и цена
   * обязаны стоять рядом: уходить из игры решают, глядя на срок.
   */
  sub?: string;
  /** Куда ведёт тап: тип здания, панель которого стоит открыть. */
  goto?: BuildingTypeId;
  /**
   * Куда ведёт тап, если чинят это не в здании: справка о порядке. Строкой, а не
   * типом раздела шторки, — симуляция про шторку не знает.
   */
  open?: 'order';
}

/**
 * Критические состояния, которые обязаны всплыть поверх любого экрана.
 * Порядок — по остроте: первым идёт то, от чего уже умирают.
 */
export function alerts(s: GameState): Alert[] {
  const out: Alert[] = [];
  const eat = foodConsumptionPerDay(s);
  const foodDays = s.resources.food / Math.max(1, eat);
  const short = foodShortfall(s);
  // Нечем кормить только войско — это тревога о войске, ниже; о голоде племени
  // говорится, только когда нехватка дошла до посёлка.
  if (s.resources.food <= 0.5 && (short.town || short.army === 0)) {
    out.push({ id: 'starving', icon: '💀', text: 'Еда кончилась — племя голодает', goto: 'storage' });
  }
  else if (foodDays < 1) out.push({ id: 'food', icon: '🍖', text: `Еда на исходе: меньше дня запаса`, goto: 'storage' });

  const heat = heatingWoodPerDay(s);
  if (heat > 0) {
    if (s.freezing > 0) out.push({ id: 'freezing', icon: '🥶', text: 'Дрова кончились — племя мёрзнет', goto: 'storage' });
    else if (s.resources.wood / heat < 1) out.push({ id: 'wood', icon: '🌲', text: 'Дров хватит меньше чем на день', goto: 'storage' });
  }
  // Войско. Одна строка на обе причины — неуплату и голод, — потому что и дверь у
  // них одна (`sim/upkeep`). Сначала то, что уже идёт, потом срок, потом отсрочка,
  // потом казна, которая вот-вот опустеет.
  const up = upkeepInfo(s);
  const flow = UPKEEP_TEXT.flowSub(up.due || up.wages, up.income);
  if (up.why) {
    const why = UPKEEP_TEXT.why[up.why];
    const army = armySize(s) > 0;
    const hired = up.masters > 0;
    const sub = up.why === 'food' ? UPKEEP_TEXT.foodSub : flow;
    const goto: BuildingTypeId = up.why === 'food' ? 'storage' : 'barracks';
    if (up.leavingPerDay > 0) {
      out.push({
        id: 'desert',
        icon: UPKEEP_TEXT.icon,
        text: UPKEEP_TEXT.leavingAlert(why, Math.max(1, Math.round(up.leavingPerDay)), UPKEEP_TEXT.whoGoes(army, hired)),
        sub,
        goto,
      });
    } else {
      out.push({
        id: 'desert-soon',
        icon: UPKEEP_TEXT.icon,
        text: UPKEEP_TEXT.graceAlert(why, Math.max(1, Math.ceil(up.graceDays - up.lateDays)), UPKEEP_TEXT.whoDat(army, hired)),
        sub,
        goto,
      });
    }
  } else if (up.amnestyDays > 0 && up.wages > up.income) {
    out.push({ id: 'wages-soon', icon: UPKEEP_TEXT.icon, text: UPKEEP_TEXT.amnestyAlert(Math.ceil(up.amnestyDays)), sub: flow, goto: 'barracks' });
  } else if (up.treasuryDays !== null && up.treasuryDays < up.graceDays) {
    out.push({ id: 'treasury', icon: UPKEEP_TEXT.icon, text: UPKEEP_TEXT.treasuryAlert(Math.max(1, Math.ceil(up.treasuryDays))), sub: flow, goto: 'barracks' });
  }
  // Порядок. Второй механики под мятеж нет — как и под ересь: строка тревоги,
  // ропот со сроком и событие с выбором. Цена стоит второй строкой прямо под
  // сроком — так же, как у голода под осадой: решение уходить из игры принимают,
  // глядя на срок, и цена обязана стоять рядом с ним. Пока мятеж ждёт ответа,
  // строки нет: всё сказано в самом окне.
  const order = orderState(s);
  if (order === 'unrest' && !mutinyOpen(s)) {
    out.push({
      id: 'unrest',
      icon: ORDER_TEXT.mutiny.icon,
      text: ORDER_TEXT.unrestAlert(unrestLeft(s) ?? MUTINY_FUSE),
      sub: ORDER_TEXT.priceShort(mutinyForecast(s).holds),
      open: 'order',
    });
  } else if (order === 'shaky') {
    out.push({ id: 'order', icon: ORDER_TEXT.icon, text: ORDER_TEXT.shakyAlert(orderValue(s)), open: 'order' });
  }
  // Кузнецы у холодного горна. Не «умирают», но час такого простоя стоит игроку
  // ровно часа: заказ он закрывает одним тапом, а не заметив — теряет вечер.
  // Строка идёт последней: голод и холод острее.
  if (forgeInfo(s).idle) {
    out.push({ id: 'forge-idle', icon: '⚒️', text: 'Кузнецы стоят без заказа', goto: 'smithy' });
  }
  // Ересь. Второй механики под неё нет: в деревне это строка тревоги, просадка
  // морали и событие с выбором — то, чем деревня живёт всегда.
  if (heresy(s)) {
    out.push({ id: 'heresy', icon: '🔥', text: 'В приходе раскол — вера трещит', goto: 'church' });
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

/** Время суток в эту игровую секунду — по тем же границам, что значок строки состояния. */
export function dayPartAt(time: number): DayPart {
  const solar = solarPhase(dayFraction(time), seasonOf(time));
  if (solar < DAY_PART_UNTIL.morning) return 'morning';
  if (solar < DAY_PART_UNTIL.day) return 'day';
  if (solar < DAY_PART_UNTIL.evening) return 'evening';
  return 'night';
}
