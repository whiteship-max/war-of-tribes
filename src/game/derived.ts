// Производные величины от состояния: вместимость, скорости, модификаторы.
import type {
  EstateId,
  Advisor,
  AdvisorPost,
  Building,
  BuildingTypeId,
  TroopId,
  Caravan,
  EquipmentId,
  FaithId,
  Flank,
  GameState,
  JobId,
  ObservanceId,
  ResourceId,
  Resources,
  Season,
} from './types';
import {
  BUILD_QUEUE_MAX,
  BONDED_OUTPUT,
  FEAST_COOLDOWN_DAYS,
  FEAST_COOLDOWN_PER_LEVEL,
  FEAST_DAYS,
  FEAST_GOLD_PER_POP,
  INFIRMARY_HEAL_CAP,
  BUILDER_RATE,
  CROWDING_MAX,
  CROWDING_PENALTY,
  CRAFTER_BUILD,
  DAY_LENGTH,
  FREE_RANGE_MULT,
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
  RESOURCE_IDS,
  PRIEST_MORALE,
  PRIEST_MORALE_CAP,
  RITE_MORALE,
  SIEGE_RATION,
  SIEGE_RATION_CUT,
  SIEGE_SOLDIER_FOOD,
  BLOCKADE_YIELD,
  STARVING_MORALE,
  SMITH_WORK,
  STRAIN_DAYS,
  VILLAGER_DEFENSE,
  emptyResources,
} from './constants';
import { asGame, sessionSec, type GameSec } from './pace';
import { BUILDING_BY_ID, MASTERS_AT, jobsOf, type BuildingStats, slotsAt } from './data/buildings';
import { keptType } from './merged';
import { surveyRadiusOf } from './data/survey';
import { buildRateOf, defenseOf, hallBuildMult, headsFoodPerDay, heatingWood, housingOf, keenAt, towerSeatsAt, soldierFoodPerDay as soldierFoodAt, stashAt, storageOf, type Levels } from './build';
import { FAITH_BY_ID, OBSERVANCE_BY_ID, tiltAt, type FaithDef, type FaithTilt } from './data/faiths';
import { FREE_JOBS, JOBS, JOB_BY_ID } from './data/jobs';
import { YARD_BY_JOB } from './data/yards';
import { EQUIPMENT_BY_ID, type EquipmentDef } from './data/equipment';
import { fitStock } from './stockrules';
import { TROOP_BY_ID, TROOP_IDS } from './data/troops';
import { DESERT_SHARE, MASTER_PAID_AS, UPKEEP_TEXT } from './data/upkeep';
import { BATTLE_MAN, troopTotal, troopsAfter, type TroopStack } from './battle/kinds';
import { baseWage, mouthsOf, troopPower } from './battle/price';
import { levelOutputMult } from './selfcost';
import { upgradeCost, upgradeWork } from './labour';
import { statAt, trainRateAt } from './train';
import { DECREE_BY_ID, RATION_BY_ID, TAX_BY_ID, TAX_PER_POP, type DecreeDef, type RationDef, type TaxDef } from './data/policy';
import { CARAVAN_BASE, CARAVAN_FLOOR, CARAVAN_PER_LEVEL } from './data/market';
import { MUTINY_EVENT, ORDER_TEXT } from './data/order';
import {
  DAY_PART_UNTIL,
  FIRST_WINTER_SOFTEN,
  FREEZING_MORALE_PENALTY,
  SEASONS,
  SEASON_DAYLIGHT,
  type DayPart,
  SEASON_DAYS,
  SEASON_META,
  SEASON_MODIFIERS,
  SEASON_SECONDS,
  type SeasonModifiers,
} from './data/seasons';
import { daysSpan } from './span';
import { BOON_BY_ID, type BoonDef } from './data/boons';
import { ESTATE_META } from './data/estates';
import { STAB_STEP, stabClamp, stabOutputMult } from './stabrules';
import { ADVISOR_POSTS, advisorWage, giftOf } from './councilrules';
import { WAGE_MIN_SHARE } from './spiritrules';
import { AGENT_ROLES, recruitWage, recruitAt } from './agentrules';
import { FLANKS, commanderSeated, leadLoyalty, type Birth, type Commander } from './commandrules';
import {
  ESTATES,
  FERVOUR_SCALE,
  LOYAL,
  PIETY_SCALE,
  influenceOf,
  loyaltyFrom,
  loyaltyParts,
  minusOf,
  murmurOf,
  plusOf,
  strengthOf,
  type LoyaltyParts,
} from './estaterules';
import { yieldShare } from '@/world/siegefood';
import { CUT_MAX } from '@/world/data/siegefood';
import type { IconName } from '@/ui/icons/alias';

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

/**
 * Очередь стройки по порядку (СТ-1, docs/ui_v2.md): постройки, на которых идёт улучшение. Порядок — `s.buildQueue`;
 * улучшение, которого список не называет (партия до очереди), встаёт в хвост порядком построек; начатое (с работой) —
 * всегда первым: работа ложится только на первое, и старая партия открывается с текущей стройкой впереди.
 */
export function buildQueue(s: GameState): Building[] {
  const sites = s.buildings.filter(isSite);
  const out: Building[] = [];
  for (const id of s.buildQueue ?? []) {
    const b = sites.find((x) => x.id === id);
    if (b && !out.includes(b)) out.push(b);
  }
  for (const b of sites) if (!out.includes(b)) out.push(b);
  const started = out.findIndex((b) => b.work > 0);
  if (started > 0) out.unshift(...out.splice(started, 1));
  return out;
}

/** Место постройки в очереди стройки, с единицы; не в очереди — 0. */
export const queuePlace = (s: GameState, b: Building): number => buildQueue(s).indexOf(b) + 1;

/** Первое улучшение в очереди — строящееся: над ним работают свободные жители. */
export const currentSite = (s: GameState): Building | null => (s.buildings.some(isSite) ? buildQueue(s)[0] : null);

// ---------- Уровни, слоты, улучшения ----------

/** Множитель выработки рабочего от уровня здания — в `selfcost.ts` (его читает цена своего труда), отсюда тем же именем. */
export { levelOutputMult } from './selfcost';

/**
 * Рабочих мест **одного дела** здания (ЗД-1): у двора с двумя делами — у каждого столько, сколько было у прежнего здания
 * того же уровня. Личного навыка у жителя нет — всю его роль взял на себя уровень здания: он и добавляет места, и
 * поднимает выработку каждому рабочему.
 */
export const deedSlots = (b: Building): number => slotsAt(BUILDING_BY_ID[b.type], b.level);

/** Дела здания по порядку — профессии, которым оно даёт места (ЗД-1); у здания без мест — пусто. */
export const deedsOf = (type: BuildingTypeId): readonly JobId[] => jobsOf(type);

/** Рабочих мест в здании — на всех его делах. */
export function buildingSlots(b: Building): number {
  return deedSlots(b) * jobsOf(b.type).length;
}

/** Здание дела: профессия знает своё здание (`JobDef.building`), а здание каждого типа в посёлке одно. */
export const deedBuilding = (s: GameState, job: JobId): Building | null => {
  const type = JOB_BY_ID[job]?.building;
  return type ? buildingOfType(s, type) : null;
};

/** Сколько человек стоит на деле (ЗД-1): ключ назначения — профессия дела. */
export const deedWorkers = (s: GameState, job: JobId): number => Math.max(0, Math.floor(s.workers?.[job] ?? 0));

/** Сколько невольников стоит на деле. */
export const deedBonded = (s: GameState, job: JobId): number => Math.max(0, Math.floor(s.bondedWork?.[job] ?? 0));

/** Сколько человек работает в этом здании — на всех его делах. Назначение — число, а не список людей. */
export const workerCount = (s: GameState, buildingId: number): number => {
  const b = buildingById(s, buildingId);
  return b ? jobsOf(b.type).reduce((n, job) => n + deedWorkers(s, job), 0) : 0;
};

/** Сколько человек занято этой работой вольным сбором — без места в здании. */
export const freeJobCount = (s: GameState, job: JobId): number =>
  Math.max(0, Math.floor(s.freeJobs?.[job] ?? 0));

/** Профессии, у которых есть место в здании: на них стоят назначения `workers` и `bondedWork`. */
export const PLACED_JOBS: readonly JobId[] = JOBS.filter((j) => j.building).map((j) => j.id);

/** Сколько человек вообще при деле: на делах зданий и на вольном сборе. */
export function busyCount(s: GameState): number {
  let n = 0;
  for (const job of PLACED_JOBS) n += deedWorkers(s, job);
  for (const job of FREE_JOBS) n += freeJobCount(s, job);
  return n;
}

/** Свободные руки: те, кого видно у костра и кем строят. */
export const idleCount = (s: GameState): number => Math.max(0, s.pop - busyCount(s));

// ---------- Невольники на местах ----------
//
// Устроены ровно как жители: число в посёлке (`s.bonded`) и число на каждом
// деле (`s.bondedWork`). Места у них общие с вольными — сколько рук стоит на
// деле, спрашивают у `deedHands`, а не складывают числа по месту вызова.

/** Невольников в посёлке. */
export const bondedTotal = (s: GameState): number => Math.max(0, Math.floor(s.bonded ?? 0));

/** Сколько невольников стоит в этом здании — на всех его делах. Назначение — число, как у жителей. */
export const bondedCount = (s: GameState, buildingId: number): number => {
  const b = buildingById(s, buildingId);
  return b ? jobsOf(b.type).reduce((n, job) => n + deedBonded(s, job), 0) : 0;
};

/** Наёмных мастеров в Мастерской (`GameState.masters`). */
export const mastersCount = (s: GameState): number => Math.max(0, Math.floor(s.masters ?? 0));

/** Дело, на местах которого стоят наёмные мастера: дело Мастерской (`MASTERS_AT`). */
export const MASTERS_JOB: JobId = jobsOf(MASTERS_AT)[0];

/** Сколько наёмных мастеров стоит на деле: все — на деле Мастерской, на остальных ноль. */
export const deedMasters = (s: GameState, job: JobId): number => (job === MASTERS_JOB ? mastersCount(s) : 0);

/** Сколько наёмных мастеров стоит на местах этого здания: все — в Мастерской, в остальных ноль. */
export const mastersOn = (s: GameState, buildingId: number): number =>
  s.buildings.find((b) => b.id === buildingId)?.type === MASTERS_AT ? mastersCount(s) : 0;

/**
 * Сколько рук на местах дела: вольные, невольники и — на деле Мастерской — наёмные мастера. Места у
 * них общие: мастер занимает место ремесленника, а не своё (docs/admin_branch.md, раздел 4.1).
 */
export const deedHands = (s: GameState, job: JobId): number => deedWorkers(s, job) + deedBonded(s, job) + deedMasters(s, job);

/** Сколько рук на местах здания — на всех его делах. */
export const handsCount = (s: GameState, buildingId: number): number => {
  const b = buildingById(s, buildingId);
  return b ? jobsOf(b.type).reduce((n, job) => n + deedHands(s, job), 0) : 0;
};

/**
 * Свободных мест Мастерской для наёмных: её места минус её люди и уже стоящие мастера. Сколько
 * мастеров пускает ветвь, решает гейт (`sim/tech.mastersCap`), — здесь только места здания.
 */
export function mastersRoom(s: GameState): number {
  const hall = buildingOfType(s, MASTERS_AT);
  return hall ? Math.max(0, deedSlots(hall) - deedHands(s, MASTERS_JOB)) : 0;
}

/** Ставят ли невольников на это дело (`JobDef.bonded`). */
export const deedTakesBonded = (job: JobId): boolean => Boolean(JOB_BY_ID[job]?.bonded);

/** Ставят ли невольников хоть на одно дело этого здания. */
export const takesBonded = (b: Building): boolean => jobsOf(b.type).some(deedTakesBonded);

/** Сколько невольников стоит по делам. */
export function bondedBusy(s: GameState): number {
  let n = 0;
  for (const job of PLACED_JOBS) n += deedBonded(s, job);
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
export const buildingStat = (b: Building, key: keyof BuildingStats): number => statAt(b.type, key, b.level);

/** Потолок уровня для типа здания: свой предел и общий предел. */
export function maxLevelFor(type: BuildingTypeId): number {
  const def = BUILDING_BY_ID[type];
  return Math.min(def.maxLevel ?? MAX_BUILDING_LEVEL, MAX_BUILDING_LEVEL);
}

/** Цена и работа улучшения — растут одной лестницей. Формулы одни на игру и сервер (`game/labour.ts`). */
export { upgradeCost, upgradeWork };

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
  else if (level > maxLevel) blocked = b.level <= 1 ? 'Это здание не улучшается.' : 'Высший уровень.';
  else if (buildQueue(s).length >= BUILD_QUEUE_MAX) blocked = `Очередь стройки полна: ${BUILD_QUEUE_MAX} из ${BUILD_QUEUE_MAX}.`;
  else if (!affordable) blocked = 'Не хватает запасов.';
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

/** Слова заботы; значок — по ключу (`attn-<забота>`, накладная `ui/icons/registry.ts`). */
export const ATTENTION_META: Record<Attention, { text: string }> = {
  idle: { text: 'Стоит без рабочих' },
  order: { text: 'Кузнецы без заказа' },
  slot: { text: 'Есть свободное место' },
  upgrade: { text: 'Пора улучшить' },
};

// ---------- Вместимости ----------

/** Жилых мест в здании. */
export const buildingHousing = (b: Building): number => buildingStat(b, 'housing');

/** Уровни построек по типу — вход общих формул посёлка (`game/build.ts`), тот же, что опись шлёт серверу. */
export const levelsOf = (s: GameState): Levels => {
  // Тот же словарь, что `Object.fromEntries(s.buildings.map(…))`, — циклом: его собирают жильё и склад на каждом шаге.
  const out: Record<string, number> = {};
  for (const b of s.buildings) out[b.type] = b.level;
  return out;
};

/** Вместимость жилья. Формула одна на игру и книгу стройки сервера (`game/build.housingOf`). */
export const housingCapacity = (s: GameState): number => housingOf(levelsOf(s));

/** Вместимость склада. Формула одна на игру и книгу стройки сервера (`game/build.storageOf`). */
export const storageCap = (s: GameState): number => storageOf(levelsOf(s));

/** Сколько человек по профессиям: рабочие на делах зданий, вольный сбор и свободные руки. */
export function jobCounts(s: GameState): Record<JobId, number> {
  const counts = Object.fromEntries(JOBS.map((j) => [j.id, 0])) as Record<JobId, number>;
  for (const job of PLACED_JOBS) counts[job] += deedWorkers(s, job);
  for (const job of FREE_JOBS) counts[job] += freeJobCount(s, job);
  counts.idle = idleCount(s);
  return counts;
}

/**
 * Сколько человек одной профессией — ровно `jobCounts(s)[job]`, без счёта всех прочих: мораль и набожность спрашивают
 * служителей на каждом шаге племени, а `jobCounts` собирает словарь всех профессий.
 */
export function jobCount(s: GameState, job: JobId): number {
  if (job === 'idle') return idleCount(s);
  return (JOB_BY_ID[job]?.building ? deedWorkers(s, job) : 0) + (JOB_BY_ID[job]?.freeRange ? freeJobCount(s, job) : 0);
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
  taxOf(s).perPop * population(s) * TAX_PER_POP * treasurerMult(s) * estateGoldMult(s) + faithGoldPerDay(s);

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

/** Сколько идёт караван при нынешнем уровне рынка, секунд игрового времени. */
export const caravanSeconds = (s: GameState): GameSec =>
  asGame(sessionSec(Math.max(CARAVAN_FLOOR, CARAVAN_BASE - CARAVAN_PER_LEVEL * Math.max(0, marketLevel(s) - 1))));

/** Доля пути каравана, 0..1. По ней сцена ведёт телегу от ворот и обратно. */
export function caravanProgress(s: GameState, c: Caravan): number {
  const total = Math.max(0.001, c.arriveAt - c.departAt);
  return Math.max(0, Math.min(1, (s.time - c.departAt) / total));
}

/** Во что единица товара обходится своим трудом, в золоте, — в `selfcost.ts` (её читает цена вида), отсюда тем же именем. */
export { selfCost } from './selfcost';

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
 * Бойцы в обороне деревни: гарнизон и отряд полководца, пока он в городе (и во время
 * сбора тоже). Отряды в пути, сбор вне города и отряд в поле деревню не защищают
 * (`world/muster`).
 */
export const homeArmy = (s: GameState): number => troopTotal(homeTroops(s));

/**
 * Мощь тех, кто дома, — сумма мощи тех, кто дома (`price.troopPower`). Прежде она
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
  // Любой житель может отбиваться дубиной, но слабо. Стойкость от веры — множитель на всё разом, а не слагаемое: приход
  // не добавляет людей на стену, он держит тех, кто на ней уже стоит. Число берётся из наклона (`faithTilt`) и потому
  // растёт вместе с храмом и укладом. Формула одна на игру и книгу стройки сервера (`game/build.defenseOf`).
  return defenseOf(levelsOf(s), s.pop - Math.max(0, s.scoutsAway), homeArmyPower(s), faithTilt(s).steadfast);
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
export const towerSeats = (s: GameState): number => towerSeatsAt(buildingOfType(s, 'tower')?.level ?? 0);

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

/** Сколько ртов на солдатском пайке, с конями, — в `battle/price.ts` (их читает цена вида), отсюда тем же именем. */
export { mouthsOf } from './battle/price';

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
export const intelKeen = (s: GameState): number => keenAt(buildingOfType(s, 'watch')?.level ?? 0);

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

/** Тайник по уровню — формула одна на игру и книгу стройки сервера (`game/build.stashAt`). */
export { stashAt };

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
  else if (cooldown > 0) blocked = `Бочки пусты ещё ${daysSpan(Math.ceil(cooldown / DAY_LENGTH))}`;
  else if (s.gold < cost) blocked = 'Не хватает золота.';
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
  // Налог — тем же, чем его собирает казна (`taxIncomePerDay`: Казначей и сословия), иначе доля закята в жалованье и в сборе
  // разошлась бы, и мусульманский город держал бы войска не столько же, сколько соседи.
  const tax = taxOf(s).perPop * TAX_PER_POP * treasurerMult(s) * estateGoldMult(s);
  const faith = faithTilt(s).goldPerPop;
  if (faith >= 0 || tax + faith <= 0) return 1;
  return Math.min(1, (tax + faith) / tax);
}

/** Жалованье одного бойца этого вида за игровой день, золотом. */
/**
 * Жалованье бойца этого вида за игровой день без доли веры и «что на нём надето» — в `battle/price.ts`: жалованье — часть
 * цены вида, а цена — его вес в бою и мощь в мире. Отсюда тем же именем.
 */
export { baseWage, wageGear } from './battle/price';

/**
 * Жалованье бойца этого вида за игровой день, золотом: ставка вида, доля веры (`wageShare`) и содержание, которого требует
 * рыцарство в силе (РТ-2, минус рыцарей — `estateWageMult`). Мастер платится как боец-эталон (`masterWage`) — и рыцари
 * дорожат его той же долей, как закят.
 */
export const wageOf = (s: GameState, troop: TroopId): number => baseWage(troop) * wageShare(s) * estateWageMult(s);

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

/**
 * Доля полного жалованья, которую дружине платят сейчас (ДР-1): полное — единица, минимальное — `WAGE_MIN_SHARE`. Пишет режим
 * одна дверь (`sim/upkeep.setWageMode`); мастеров, совет и агентов он не касается — они не дружина.
 */
export const wagePaidShare = (s: GameState): number => (s.pay?.wage?.mode === 'min' ? WAGE_MIN_SHARE : 1);

/** Жалованье бойца этого вида за игровой день при нынешнем жалованье дружине (ДР-1: полное или минимальное). */
export const troopWage = (s: GameState, troop: TroopId): number => wageOf(s, troop) * wagePaidShare(s);

/** Жалованье войска за игровой день. Новобранцев на учениях оно не касается. */
export const armyWagesPerDay = (s: GameState): number =>
  TROOP_IDS.reduce((sum, id) => sum + Math.max(0, s.army?.[id] ?? 0) * troopWage(s, id), 0);

/** Жалованье наёмных мастеров за игровой день. */
export const mastersWagesPerDay = (s: GameState): number => mastersCount(s) * masterWage(s);

/**
 * Вся ведомость за игровой день: войско и наёмные мастера. **Казна одна, и ведомость одна** —
 * из неё платит `sim/upkeep`, по ней «по средствам» решает, сколько ещё держать, и по ней же
 * уходят недоплаченные. Второй ведомости у мастеров нет.
 */
export const wagesPerDay = (s: GameState): number =>
  armyWagesPerDay(s) + mastersWagesPerDay(s) + councilWagesPerDay(s) + agentWagesPerDay(s) + commandWagesPerDay(s);

// ---------- Совет Ратуши (РТ-1) ----------
//
// Советник — не правитель и не житель: он служит за жалованье из той же ведомости и приносит пользу своей должности — Староста
// к стройке и добыче, Казначей к налогу и торговле, Воевода к стойкости дружины (docs/city_v3.md, «Решения РТ-1»). Здесь —
// только чтение: кто сидит и сколько это даёт, формулами `councilrules`; пишет совет одна дверь — `sim/council`.

/** Уровень ратуши — по нему ступень совета (`councilrules.councilTier`); ратуши нет — 0. */
export const hallLevel = (s: GameState): number => buildingOfType(s, 'town_hall')?.level ?? 0;

/** Советник на должности; нет — `null`. */
export const councilSeat = (s: GameState, post: AdvisorPost): Advisor | null => s.council?.seats?.[post] ?? null;

/** Польза должности сейчас: доля (Староста, Казначей) или очки стойкости (Воевода); места нет — ноль. */
export function councilGift(s: GameState, post: AdvisorPost): number {
  const a = councilSeat(s, post);
  return a ? giftOf(post, a.level, a.trait) : 0;
}

/** Множитель Старосты: стройка и добыча дворов. */
export const stewardMult = (s: GameState): number => 1 + councilGift(s, 'steward');

/** Множитель Казначея: налог и выручка рынка. */
export const treasurerMult = (s: GameState): number => 1 + councilGift(s, 'treasurer');

/** Жалованье совета за игровой день — та же ведомость, что войско и мастера (`wagesPerDay`). */
export const councilWagesPerDay = (s: GameState): number =>
  ADVISOR_POSTS.reduce((n, p) => {
    const a = councilSeat(s, p);
    return a ? n + advisorWage(a.level, a.trait) : n;
  }, 0);

/**
 * Жалованье агентов, нанятых в Ратуше (АГ-1), за игровой день — в той же ведомости, что войско, мастера и совет: по уровню
 * кандидата и чертам (`agentrules.recruitWage`). Свой человек (без метки найма) служит без жалованья, пустое место — тоже.
 */
export const agentWagesPerDay = (s: GameState): number =>
  AGENT_ROLES.reduce((n, id) => {
    const p = s.agents?.[id];
    if (!p || p.vacant || !p.cand) return n;
    const r = recruitAt(s.seed, p.cand.n, p.cand.tier);
    return n + recruitWage(r.level, r.traits);
  }, 0);

// ---------- Командиры флангов (ДР-3) ----------
//
// Командиры — люди «Командующих» в отряде полководца (docs/siege_v2.md, «Решения ДР-3»): кандидат, род и тактика выводятся из
// метки найма (`commandrules.commanderAt`). Здесь — только чтение, которое нужно ведомости и сословиям; пишет места одна дверь —
// `sim/command`.

/** Кандидат человека на месте фланга `f`; места нет — `null`. */
export function commanderOn(s: GameState, f: Flank): Commander | null {
  const c = s.command?.seats?.[f];
  // Служба (ДР-5): опыт за бои поднимает уровень на службе и тактику, жалованье — по уровню найма.
  return c ? commanderSeated(s.seed, c) : null;
}

/** Жалованье командиров флангов в игровой день — ступень совета по уровню и чертам кандидата (`agentrules.recruitWage`). */
export const commandWagesPerDay = (s: GameState): number =>
  FLANKS.reduce((n, f) => {
    const c = commanderOn(s, f);
    return c ? n + recruitWage(c.level, c.traits) : n;
  }, 0);

/** Слагаемое лояльности рыцарства от людей на местах командиров: милость лордам, обида за безродных (К5). */
export const commandLead = (s: GameState): number =>
  leadLoyalty(FLANKS.map((f) => commanderOn(s, f)?.birth).filter((b): b is Birth => b !== undefined));

// ---------- Сословия (РТ-2) ----------
//
// Влияние и лояльность выводятся, а не хранятся (docs/stability.md, «РТ-2»): уровни построек, привилегии, указ и усилители —
// всё, из чего они сделаны; числа и формулы — `estaterules`, одни с сервером. Здесь — чтение и рычаги, которые сословия кладут
// в двери игры: золото, стройка, дворы, прирост, хлеб, жалованье, стойкость, недовольство податных и набожность. Привилегии и
// дары пишет одна дверь — `sim/estates`.

/** Сословие сейчас: влияние, лояльность и её слагаемые, сила, плюс и минус долями. */
export interface EstateNow {
  id: EstateId;
  infl: number;
  loyalty: number;
  parts: LoyaltyParts;
  strength: number;
  plus: number;
  minus: number;
  /** Город живёт по указу этого сословия. */
  decree: boolean;
}

/** Сословие, по чьему указу живёт город; указ короны — `null`. */
export const estateDecree = (s: GameState): EstateId | null => decreeOf(s).estate ?? null;

/** Что вести и дары кладут в лояльность сословия — усилителями (`data/boons`, поле `estates`). */
export const estateMood = (s: GameState, e: EstateId): number => activeBoons(s).reduce((n, { def }) => n + (def.estates?.[e] ?? 0), 0);

/** Все пять сословий сейчас — одна мерка на рычаги, окно, ропот и опись. */
export const estatesNow = (s: GameState): Record<EstateId, EstateNow> => estatesWith(s, s.estates?.priv);

/**
 * Сословия при привилегиях `priv` — та же мерка, что `estatesNow`: окно меряет ею, что изменит дарование или отнятие, до
 * касания (примерка той же дверью, правило 18).
 */
export function estatesWith(s: GameState, priv: Partial<Record<EstateId, number>> | undefined): Record<EstateId, EstateNow> {
  const infl = influenceOf(levelsOf(s), priv);
  const dec = estateDecree(s);
  const out = {} as Record<EstateId, EstateNow>;
  for (const e of ESTATES) {
    // Командиры флангов (ДР-3): слагаемое знати — одно правило `loyaltyParts` решает, какому сословию оно не безразлично.
    const parts = loyaltyParts(e, priv, infl[e], estateMood(s, e), commandLead(s));
    const loyalty = loyaltyFrom(parts);
    const strength = strengthOf(infl[e], dec === e);
    out[e] = { id: e, infl: infl[e], loyalty, parts, strength, plus: plusOf(e, strength, loyalty), minus: minusOf(e, strength), decree: dec === e };
  }
  return out;
}

/** Доля минуса — не больше целого: множитель «один минус доля» не уходит ниже нуля. */
const cutOf = (minus: number): number => 1 - Math.max(0, Math.min(1, minus));

/** Золото налога: купцы — плюс, крестьяне и десятина духовенства — минус. */
export function estateGoldMult(s: GameState): number {
  const n = estatesNow(s);
  return (1 + n.merchants.plus) * cutOf(n.peasants.minus) * cutOf(n.clergy.minus);
}

/** Выручка рынка — купцы. */
export const merchantsMult = (s: GameState): number => 1 + estatesNow(s).merchants.plus;

/** Скорость стройки — цехи. */
export const guildsMult = (s: GameState): number => 1 + estatesNow(s).guilds.plus;

/** Добыча дворов — крестьяне. */
export const peasantsMult = (s: GameState): number => 1 + estatesNow(s).peasants.plus;

/** Прирост: крестьяне — плюс, рыцари — минус. */
export function estateGrowthMult(s: GameState): number {
  const n = estatesNow(s);
  return (1 + n.peasants.plus) * cutOf(n.knights.minus);
}

/** Хлеб, который ест город: цехи в силе едят больше. */
export const estateFoodMult = (s: GameState): number => 1 + estatesNow(s).guilds.minus;

/** Содержание войска: рыцари в силе требуют больше. */
export const estateWageMult = (s: GameState): number => 1 + estatesNow(s).knights.minus;

/** Какую долю налога в недовольстве податных гасит проповедь духовенства. */
export const clergyRelief = (s: GameState): number => Math.min(1, estatesNow(s).clergy.plus);

/** Что духовенство прибавляет к набожности. */
export const clergyPiety = (s: GameState): number => PIETY_SCALE * estatesNow(s).clergy.plus;

/**
 * Можно ли объявить указ: указ короны — всегда, указ сословия — пока сословие верно (`estaterules.LOYAL`, docs/stability.md,
 * Р1.6). Отказ — словами с числом лояльности: кнопка и сервер спрашивают одну мерку.
 */
export function decreeBlock(s: GameState, id: DecreeDef['id']): string | null {
  const e = DECREE_BY_ID[id]?.estate;
  if (!e) return null;
  const loyalty = estatesNow(s)[e].loyalty;
  return loyalty >= LOYAL ? null : `${ESTATE_META[e].name}: лояльность ${Math.floor(loyalty)} из ${LOYAL} — указ откроет верное сословие.`;
}

/**
 * Цена дара сословию: день полного налога города золотом (высокий налог со всех жителей, `TAX_PER_POP`), крестьянству — день
 * хлеба, который ест город (`townFoodPerDay`). От размера города, как у вестей. Одна мерка у кнопки дара и у жалобы сословия.
 */
export function estateGiftPrice(s: GameState, e: EstateId): { gold: number } | { food: number } {
  if (ESTATE_META[e].gift === 'food') return { food: Math.max(1, Math.ceil(townFoodPerDay(s))) };
  return { gold: Math.max(1, Math.ceil(population(s) * TAX_PER_POP * TAX_BY_ID.high.perPop)) };
}

/** Ропот сословия — причина у податных, % (`estaterules.murmurOf`). */
export const estateMurmur = (s: GameState, e: EstateId): number => {
  const n = estatesNow(s)[e];
  return murmurOf(n.infl, n.loyalty);
};

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
  const army = (mouthCount(s) * siegeSoldierFood(s, mods) + mastersFoodPerDay(s, mods)) * siegeRation(s);
  return { army: army > 0 ? Math.min(1, short / army) : 0, town: short > army };
}

/**
 * Ест ли боец хлеб — строй, новобранец и раненый. Нет (ВРЕМЕННО ДЛЯ ТЕСТА, `TEST_ARMY_FOOD = 0`) — голодная доля
 * `foodShortfall.army` ложится только на наёмных мастеров, и бойцы голодом не уходят (`sim/upkeep`, `upkeepInfo`).
 */
export const troopsEat = (s: GameState, mods: SeasonModifiers = seasonMods(s)): boolean => soldierFoodPerDay(s, mods) > 0;

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

/** Головы на пайке вне строя — раненые и новобранцы на учениях: их голод уводит поголовно (`sim/upkeep`). */
const idleHeads = (s: GameState): number => {
  const m = soldierMouths(s);
  return troopTotal(m.recruits) + troopTotal(m.wounded);
};

/** Всё о содержании войска в эту минуту — для казарм, ратуши и тревоги. */
export function upkeepInfo(s: GameState): UpkeepInfo {
  const wages = wagesPerDay(s);
  const due = wagesDue(s);
  const income = taxIncomePerDay(s);
  const unpaid = unpaidShare(s);
  const unfed = foodShortfall(s).army;
  // Бойцы, что не едят (`troopsEat`), голодом не уходят: голодная доля — только мастерам.
  const unfedTroops = troopsEat(s) ? unfed : 0;
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
    // Строй и наёмные мастера уходят по большей из двух долей, раненые и новобранцы — только голодом (`sim/upkeep`), и
    // уходят головы, а не рты: конь всадника — рот, но не новобранец (BTL-8).
    leavingPerDay:
      why && lateDays >= graceDays
        ? DESERT_SHARE * (Math.max(unpaid, unfedTroops) * armySize(s) + share * mastersCount(s) + unfedTroops * idleHeads(s))
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
  // Формула одна и та же, поэтому при равных уровнях срок найма головы прежний; она же — у книги войска сервера
  // (`train.trainRateAt`, docs/pvp.md, раздел 6).
  const mounted = TROOP_BY_ID[troop].mounted === true;
  const b = buildingOfType(s, mounted ? 'stable' : 'barracks');
  return b ? trainRateAt(mounted, b.level) : 0;
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
  if (!def) blocked = 'Заказов нет, кузница стоит.';
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
  // Ступень стабильности — поправкой морали на всю выработку, той же ценой, что мораль (docs/stability.md, 2.6).
  m *= stabOutputMult(s.stab?.level ?? 0);
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
 *
 * Штраф — от соотношения сил лагеря и гарнизона (ОС-1, `world/siegefood`): его решает мир и кладёт мост
 * (`SiegeState.cut`), доля по ресурсу — `siegefood.yieldShare`. Нет поля — наибольший штраф (хлеб ноль, прочее четверть:
 * осада до ОС-1). Кольцо блокады — ноль всему.
 */
export const siegeYield = (s: GameState, r: ResourceId): number =>
  !underSiege(s) ? 1 : s.siege?.blockade ? BLOCKADE_YIELD : yieldShare(s.siege?.cut ?? CUT_MAX, r === 'food');

/** Режет готовую выработку осадой. Мутирует на месте — как и всё здесь. */
function cutBySiege(s: GameState, out: Resources): Resources {
  if (!underSiege(s)) return out;
  for (const r of RESOURCE_IDS) out[r] *= siegeYield(s, r);
  return out;
}

/**
 * Выработка одного дела без осады: вольные и невольники на его местах (ЗД-1: дело — профессия здания).
 *
 * Невольники идут той же строкой — та же таблица профессии, тот же множитель
 * места, сезона, морали, веры и указа, — и только на свою долю (`BONDED_OUTPUT`).
 * Второго расчёта выработки под них нет и заводить его нельзя: две формулы
 * одного и того же разойдутся при первой правке одной из них.
 */
function deedYield(s: GameState, out: Resources, b: Building, job: JobId, mods: SeasonModifiers): void {
  // Постройка под обстрелом стоит фазу без работы (Р-5, `world/shelling`): её работники едят, но не дают ничего.
  if (s.siege?.idle?.includes(b.type)) return;
  // Добыча дворов — под рукой Старосты (РТ-1): дела дворов (`YARD_BY_JOB`), а не горн и не мастерская.
  // Сословия (РТ-2): дворы — под рукой крестьянства.
  const mult = workerMultiplier(s, job, b, mods) * (YARD_BY_JOB.has(job) ? stewardMult(s) * peasantsMult(s) : 1);
  addYield(out, job, deedWorkers(s, job), mult * freeShare(s));
  addYield(out, job, deedBonded(s, job), mult * bondedShare(s));
}

/** Выработка одного здания без осады — сумма его дел. */
function yardYield(s: GameState, out: Resources, b: Building, mods: SeasonModifiers): void {
  for (const job of jobsOf(b.type)) deedYield(s, out, b, job, mods);
}

/** Выработка вольного сбора без осады: свободные руки на работах без места в здании (`FREE_JOBS`). */
function freeYield(s: GameState, out: Resources, mods: SeasonModifiers): void {
  for (const job of FREE_JOBS) {
    addYield(out, job, freeJobCount(s, job), workerMultiplier(s, job, null, mods) * freeShare(s));
  }
}

/** Валовое производство за игровой день. */
export function productionPerDay(s: GameState, mods: SeasonModifiers = seasonMods(s)): Resources {
  const out = emptyResources();
  for (const b of s.buildings) yardYield(s, out, b, mods);
  freeYield(s, out, mods);
  return cutBySiege(s, out);
}

/**
 * Валовая добыча хлеба за игровой день без штрафа осады (ОС-1): её везёт слепок осады (`bridge.playerProfile`), и сервер войны
 * сам режет её штрафом по соотношению сил своей мерки (`world/siegefood`). Постройка под обстрелом не даёт и здесь.
 */
export function grossFoodPerDay(s: GameState, mods: SeasonModifiers = seasonMods(s)): number {
  const out = emptyResources();
  for (const b of s.buildings) yardYield(s, out, b, mods);
  freeYield(s, out, mods);
  return out.food;
}

/** Что производит одно здание за день — для его собственной панели. */
export function buildingProduction(s: GameState, b: Building, mods: SeasonModifiers = seasonMods(s)): Resources {
  const out = emptyResources();
  yardYield(s, out, b, mods);
  return cutBySiege(s, out);
}

/** Что производит одно дело здания за день — строка дела в окне двора (ЗД-1). */
export function deedProduction(s: GameState, b: Building, job: JobId, mods: SeasonModifiers = seasonMods(s)): Resources {
  const out = emptyResources();
  if (jobsOf(b.type).includes(job)) deedYield(s, out, b, job, mods);
  return cutBySiege(s, out);
}

/**
 * Что даёт за день вольный сбор — работы с Площади без места в здании. Валовое производство — сумма выработки зданий
 * (`buildingProduction`) и этой; разбор «в день» запаса (`ui/next/hudTips`) пишет её строкой Площади.
 */
export function freeRangeProduction(s: GameState, mods: SeasonModifiers = seasonMods(s)): Resources {
  const out = emptyResources();
  freeYield(s, out, mods);
  return cutBySiege(s, out);
}

/**
 * Расход еды за день. Бойцы не добывают и не строят, но едят из того же котла —
 * иначе армия обходилась бы племени только людьми. Рацион множит весь расход.
 */
export function foodConsumptionPerDay(s: GameState, mods: SeasonModifiers = seasonMods(s)): number {
  // Новобранцы на учениях и раненые уже не жители, но кормятся так же, как бойцы: список ртов один
  // на расход и на голод (`soldierMouths`).
  return (townFoodPerDay(s, mods) + mouthCount(s) * siegeSoldierFood(s, mods) + mastersFoodPerDay(s, mods)) * siegeRation(s);
}

/**
 * Паёк бойца за день с осадой: под лагерем — паёк жителя (`SIEGE_SOLDIER_FOOD`, ОС-1), иначе обычный. Одна дверь на расход и
 * на голод (`foodShortfall`); слепок осады везёт миру уже осадный (`bridge.playerProfile`).
 */
export const siegeSoldierFood = (s: GameState, mods: SeasonModifiers = seasonMods(s)): number =>
  underSiege(s) ? besiegedSoldierFood(s, mods) : soldierFoodPerDay(s, mods);

/** Осадный паёк бойца за день — паёк жителя (`SIEGE_SOLDIER_FOOD`): его везёт слепок осады, есть осада сейчас или нет. */
export const besiegedSoldierFood = (s: GameState, mods: SeasonModifiers = seasonMods(s)): number => soldierFoodPerDay(s, mods) * SIEGE_SOLDIER_FOOD;

/**
 * Осадный паёк (docs/siege_v2.md, раздел 5; ответ владельца 6): урезан — весь расход ×¾ (`SIEGE_RATION`), иначе единица.
 * Множит общий расход и голод (`foodConsumptionPerDay`, `foodShortfall`), а не части: мост везёт миру расход без пайка
 * (`bridge.playerProfile`), и окно осады умножает его тем же числом само (`siege.consumptionPerHour`) — второй нормы нет.
 */
export const siegeRation = (s: GameState): number => (s.siege?.ration ? SIEGE_RATION : 1);

/** Сколько морали стоит урезанный паёк: кара пустых закромов в доле урезанного (`STARVING_MORALE` × ¼). */
export const rationMorale = (): number => STARVING_MORALE * SIEGE_RATION_CUT;

/**
 * Сколько за день съедают наёмные мастера. Паёк у них жителя — по голове, тем же сезоном и
 * рационом, — а голодают они как войско: едят последними (`foodShortfall`). Под осадой они
 * заперты в городе и едят из того же амбара (`world/bridge`, `foodPerHour`).
 */
export const mastersFoodPerDay = (s: GameState, mods: SeasonModifiers = seasonMods(s)): number =>
  headsFoodPerDay(mastersCount(s), mods.food, rationOf(s).food);

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
  // Цехи в силе (РТ-2) едят больше — минус ремесленного города.
  return headsFoodPerDay(total, mods.food, rationOf(s).food) * estateFoodMult(s);
}

/**
 * Что добавляет к дневному расходу один боец. Сезон и рацион множат его так же,
 * как и всё остальное, — иначе зимняя осада считалась бы по летним числам.
 */
export const soldierFoodPerDay = (s: GameState, mods: SeasonModifiers = seasonMods(s)): number =>
  soldierFoodAt(mods.food, rationOf(s).food);

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
  return CRAFTER_BUILD * workerMultiplier(s, 'crafter', shop, mods) * mods.build * townHallBuildMult(s) * buildBoost(s);
}

/**
 * Рука стройки сверх ратуши: Староста совета (РТ-1) и цехи в силе (РТ-2) — тем же множителем, что у `buildRate`
 * (`build.buildRateOf`, не ниже единицы): доля Мастерской и мастеров в панели — ровно та, что они прибавляют к стройке.
 */
export const buildBoost = (s: GameState): number => Math.max(1, stewardMult(s) * guildsMult(s));

/**
 * Множитель скорости стройки от уровня ратуши: +`TOWN_HALL_BUILD_STEP` за уровень сверх первого.
 * Ратуша не даёт труда сама — она им распоряжается, поэтому это множитель ко
 * всему, что строит посёлок, а не ещё одно слагаемое.
 */
export const townHallBuildMult = (s: GameState): number => hallBuildMult(buildingOfType(s, 'town_hall')?.level ?? 0);

/**
 * Скорость стройки: свободные жители с площади плюс ремесленники в мастерской,
 * всё это — под рукой ратуши.
 * Улучшения — единственная прогрессия посёлка, и мастерская существует ради них.
 */
export function buildRate(s: GameState, mods: SeasonModifiers = seasonMods(s)): number {
  // Ушедшие разведчиками — те же свободные жители: пока они в пути, стройка идёт без них.
  // Вставшие мятежом не строят — той же долей, что не работают в поле (`freeShare`).
  const idle = Math.max(0, jobCounts(s).idle - Math.max(0, s.scoutsAway)) * freeShare(s);
  // Невольники без места — на стройке, тем же трудом и на ту же долю, что в поле.
  const bonded = bondedIdle(s) * bondedShare(s);
  // Формула одна на игру и книгу стройки сервера (`game/build.buildRateOf`; потолок сервера — `buildCeil`).
  // Цехи в силе (РТ-2) множат стройку той же дверью, что Староста: потолок сервера — тот же множитель (`build.buildCeil`).
  return buildRateOf(idle, bonded, crafterBuildRate(s, mods), mods.build, buildingOfType(s, 'town_hall')?.level ?? 0, buildBoost(s));
}

/**
 * Сколько мастерская прибавляет к скорости стройки на самом деле: вклад ремесленников
 * под теми же множителями сезона и ратуши, что и вся стройка (`buildRate`). Панель
 * мастерской писала голый `crafterBuildRate` — у ратуши десятого уровня 8.0/с там, где
 * в стройку шло 13.8/с. Сходство с `buildRate` держит тест: сумма без мастерской и
 * этого вклада обязана давать полную скорость.
 */
export const crafterBuildShare = (s: GameState, mods: SeasonModifiers = seasonMods(s)): number =>
  crafterBuildRate(s, mods) * mods.build * townHallBuildMult(s) * buildBoost(s);

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

/**
 * Усилители от ответов на вести, чей срок ещё впереди (docs/events.md, раздел 3). Считается при чтении: тика у
 * усилителя нет, и догон отлучки снимает его сам тем, что двигает `s.time`. Неизвестный вид (вести убрали из игры)
 * пропускается молча — партия из-за него не ломается.
 */
export function activeBoons(s: GameState): { def: BoonDef; until: number }[] {
  const out: { def: BoonDef; until: number }[] = [];
  for (const b of s.boons ?? []) {
    const def = BOON_BY_ID[b.id];
    if (def && b.until > s.time) out.push({ def, until: b.until });
  }
  return out;
}

/** Множители сезона с усилителями поверх: множители перемножаются, как сезон с двором. */
function withBoons(base: SeasonModifiers, s: GameState): SeasonModifiers {
  const on = activeBoons(s);
  if (on.length === 0) return base;
  const jobs: Partial<Record<JobId, number>> = { ...base.jobs };
  let { build, food, heating } = base;
  for (const { def } of on) {
    for (const [job, m] of Object.entries(def.jobs ?? {}) as [JobId, number][]) jobs[job] = (jobs[job] ?? 1) * m;
    build *= def.build ?? 1;
    food *= def.food ?? 1;
    heating *= def.heating ?? 1;
  }
  return { ...base, jobs, build, food, heating };
}

/**
 * Действующие сейчас множители сезона — с усилителями вестей поверх. Единственная точка входа для симуляции: усилитель
 * — поле сезона, а не условие в коде (CLAUDE.md, «Правила»).
 */
export const seasonMods = (s: GameState): SeasonModifiers => withBoons(seasonModsFor(seasonOf(s.time), yearOf(s.time)), s);

/** Сколько усилители вестей прибавляют к цели морали (с минусом — отнимают). Ложится после потолка шкалы, как пир. */
export const boonMorale = (s: GameState): number => activeBoons(s).reduce((n, b) => n + (b.def.morale ?? 0), 0);

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
  return heatingWood(roofed, open, mods.heating);
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

/**
 * Сколько сезонов вперёд смотрит прогноз хлеба под осадой, наибольшее: сто игровых лет. Год с ровным или растущим складом
 * кончает прогноз раньше — дальше сезоны повторяются, и склад не опустеет никогда.
 */
const SIEGE_FORECAST_SEASONS = 100 * SEASONS.length;

/**
 * Через сколько игровых секунд склад не оплатит прокорм под нынешней осадой — **для сведения** (ОС-1, docs/siege_v2.md, 23):
 * окно защитника пишет срок (`siegewords.breadWords`), мир по нему ставит лагерю логова срок отлучки (`SiegeState.until`).
 * Голод им не решается: сдаёт город только засуха шага (`sim/siege.siegeHunger`). Считается по сезонам вперёд — те же
 * добыча со штрафом осады (`productionPerDay`) и расход (`foodConsumptionPerDay`), что у шага, склад не выше вместимости.
 * Без осады, год без убыли склада (после первого) или сто лет вперёд — бесконечность. Сезон с годом (первая зима мягче) даёт
 * одно и то же сальдо, и оно считается один раз на вид сезона.
 */
export function siegeDryIn(s: GameState): number {
  if (!underSiege(s)) return Infinity;
  const cap = storageCap(s);
  const nets = new Map<string, number>();
  const netAt = (t: number): number => {
    const season = seasonOf(t);
    const year = yearOf(t);
    const key = `${season}:${season === 'winter' && year === 1 ? 1 : 2}`;
    let net = nets.get(key);
    if (net === undefined) {
      const mods = withBoons(seasonModsFor(season, year), s);
      net = (productionPerDay(s, mods).food - foodConsumptionPerDay(s, mods)) / DAY_LENGTH;
      nets.set(key, net);
    }
    return net;
  };
  let food = Math.max(0, s.resources.food);
  let t = s.time;
  // Склад в начале года: год прошёл, а склад не убыл — дальше сезоны те же (зима после первой — одна), и он не опустеет.
  let yearFood = food;
  for (let i = 0; i < SIEGE_FORECAST_SEASONS; i++) {
    const end = (seasonIndex(t) + 1) * SEASON_SECONDS;
    const net = netAt(t);
    const span = end - t;
    if (net < 0 && food + net * span < 0) return t + food / -net - s.time;
    food = fitStock(food, net * span, cap);
    t = end;
    if ((i + 1) % SEASONS.length === 0) {
      if (food >= yearFood && yearOf(t) > 1) return Infinity;
      yearFood = food;
    }
  }
  return Infinity;
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
  /** Значок набора (docs/icons.md). */
  icon: IconName;
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
  /** Усилители вестей: праздник по вести, лютый холод (docs/events.md). Ложатся туда же, где пир, — после шкалы. */
  boon: number;
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
  const add = (id: string, icon: IconName, name: string, value: number, hint: string, keepZero = false): void => {
    if (keepZero || Math.abs(value) > 0.001) lines.push({ id, icon, name, value, hint });
  };

  const pop = s.pop;
  const housing = housingCapacity(s);
  // Теснота считается долей, а не головами: при сотнях жителей штраф
  // «минус пять за человека сверх крыш» обнулял бы мораль от одного лишнего.
  if (pop <= housing) {
    add('housing', 'ui-bed', 'Жильё с запасом', 10, `${housing - pop} свободных мест из ${housing}`);
  } else {
    const over = pop - housing;
    add(
      'crowding',
      'ui-ruin',
      'Теснота',
      -Math.min(CROWDING_MAX, (CROWDING_PENALTY * over) / Math.max(1, housing)),
      `${over} сверх крыш, штраф не больше −${CROWDING_MAX}`,
    );
  }

  const eat = foodConsumptionPerDay(s);
  const foodDays = s.resources.food / Math.max(1, eat);
  if (s.resources.food <= 0) add('starving', 'ui-skull', 'Закрома пусты', -STARVING_MORALE, 'еды нет');
  else if (foodDays >= 3) add('fed', 'res-food', 'Сытость', 10, `запас на ${daysSpan(foodDays)}`);
  else if (foodDays < 1) add('hungry', 'res-food', 'Голодно', -8, `запас на ${daysSpan(foodDays)}`);
  // Осадный паёк — та же кара в доле урезанного (docs/siege_v2.md, раздел 5): своей строкой, вне цепочки запаса.
  if (s.siege?.ration) add('ration', 'ui-bowl', 'Осадный паёк', -rationMorale(), `еды ×${SIEGE_RATION}`);

  for (const b of s.buildings) {
    const v = buildingStat(b, 'morale');
    const def = BUILDING_BY_ID[b.type];
    add(`b-${b.id}`, `bld-${b.type}`, def.name, v, `ур. ${b.level}`);
  }

  const priests = jobCount(s, 'priest');
  add(
    'priests',
    'ui-candle',
    'Служители',
    priestMorale(s),
    `${priests} по +${PRIEST_MORALE}, не больше +${PRIEST_MORALE_CAP}`,
    true,
  );

  add(
    'prestige',
    'ui-medal',
    'Слава города',
    Math.min(10, s.prestige / 5),
    `${s.stats.battlesWon} побед · ${s.stats.battlesLost} поражений, слава ${Math.round(s.prestige)}`,
  );

  const season = seasonOf(s.time);
  add('season', `season-${season}`, SEASON_META[season].name, seasonMods(s).morale, 'сезонный сдвиг');
  if (s.freezing > 0) add('freezing', 'season-winter', 'Город мёрзнет', -FREEZING_MORALE_PENALTY, 'дрова кончились');

  // Вера. Два слагаемых, и они разной природы: наклон — то, что вера просит и
  // даёт всегда (десятина давит, община держит), а ересь — то, что случается,
  // когда набожность провалилась. Считаются они не здесь: строка берёт готовое
  // число у `faithTilt` и `heresyMorale`, второй формулы тут быть не должно.
  const fd = faithDef(s);
  if (fd) {
    add('faith', fd.icon, fd.name, faithTilt(s).morale, `${fd.temple} ур. ${templeLevel(s)}, ${OBSERVANCE_BY_ID[observanceOf(s)].name.toLowerCase()}`);
    add('heresy', 'ui-flame', 'Вера трещит', heresyMorale(s), `набожность ${Math.round(piety(s))}, раскол ниже ${PIETY_HERESY}`);
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
  // Усилители вестей — там же и по той же причине: праздник по вести, утонувший в потолке, не стоил бы ничего.
  const boon = boonMorale(s);
  return {
    base: MORALE_BASE,
    lines,
    raw,
    clamped,
    tax,
    feast,
    rite,
    boon,
    target: Math.max(0, Math.min(100, clamped - tax + feast + rite + boon)),
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
  Math.min(PRIEST_MORALE_CAP, jobCount(s, 'priest') * PRIEST_MORALE);

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
  /** Значок набора (docs/icons.md). */
  icon: IconName;
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
  const add = (id: string, icon: IconName, name: string, value: number, hint: string, keepZero = false): void => {
    if (keepZero || Math.abs(value) > 0.001) lines.push({ id, icon, name, value, hint });
  };
  const id = faithOf(s);
  if (!id) return { base: PIETY_BASE, lines, raw: PIETY_BASE, value: PIETY_BASE };
  const def = FAITH_BY_ID[id];
  const level = templeLevel(s);
  const obs = OBSERVANCE_BY_ID[observanceOf(s)];

  add('temple', 'bld-church', def.temple, level * PIETY_PER_LEVEL, `ур. ${level}, по +${PIETY_PER_LEVEL}`);
  const priests = jobCount(s, 'priest');
  add(
    'priests',
    'ui-candle',
    'Служители прихода',
    priestPiety(s),
    `${priests} по +${PIETY_PER_PRIEST}, не больше +${PIETY_PRIEST_CAP}`,
    true,
  );
  add('observance', obs.icon, obs.name, obs.piety, obs.effect, true);

  if (riteActive(s)) {
    const feast = def.feasts[seasonOf(s.time)];
    add('rite', feast.icon, `Обряд: ${feast.name}`, PIETY_RITE, 'приход служит и празднует');
  }
  if (s.faith.relic) add('relic', 'ui-beads', FAITH_BY_ID[s.faith.relic].relic, PIETY_RELIC, 'реликвия прихода');

  // Чужая вера вокруг. Множитель — свойство самой веры (`tilt.pressure`), а не
  // оценка её: у язычества нет ни грамоты, ни дальнего владыки, к которому
  // отсылают спорщика, поэтому спор идёт в самой деревне.
  const pressure = Math.max(0, Math.min(1, s.faith.pressure ?? 0));
  add(
    'pressure',
    'hud-map',
    'Округа иной веры',
    -pressure * PIETY_PRESSURE * def.tilt.pressure,
    `${Math.round(pressure * 100)}% земли вокруг верит иначе`,
  );

  const foodDays = s.resources.food / Math.max(1, foodConsumptionPerDay(s));
  if (foodDays < 1) add('hunger', 'res-food', 'Голодно в приходе', -PIETY_HUNGER, 'за что нам это');
  if (s.siege) add('siege', 'alert-siege', 'Под стенами враги', -PIETY_SIEGE, `осада, ${s.siege.byName}`);
  add('strain', 'ui-heartbreak', 'Надлом', -strainNow(s), 'навязанные решения ещё помнят');
  // Духовенство в силе (РТ-2) — набожность прихода.
  add('clergy', 'est-clergy', 'Духовенство', clergyPiety(s), 'сословие в силе');

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
  faithOf(s) === null ? 0 : Math.min(PIETY_PRIEST_CAP, jobCount(s, 'priest') * PIETY_PER_PRIEST);

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
 * Стойкость дружины целиком — то, что мост везёт в бой (`world/bridge`): обряд веры, Воевода совета (РТ-1) и рыцарство в силе
 * (РТ-2, плюс рыцарей очками шкалы `FERVOUR_SCALE`), а купечество в силе снимает долю (его минус). Ниже нуля стойкости нет —
 * бой её не принимает (`battle/sim`): купцы режут то, что дали обряд, Воевода и рыцари.
 */
export function armyResolve(s: GameState): number {
  const n = estatesNow(s);
  return Math.max(0, fervour(s) + councilGift(s, 'marshal') + FERVOUR_SCALE * n.knights.plus) * cutOf(n.merchants.minus);
}

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
  // Старая запись мира (донесение, выстрел) может назвать здание, ушедшее в двор (ЗД-1): имя — двора.
  const kept = BUILDING_BY_ID[type] ? type : keptType(type);
  if (!kept) return String(type);
  if (kept !== 'church') return BUILDING_BY_ID[kept].name;
  return faithDef(s)?.temple ?? BUILDING_BY_ID[kept].name;
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
  id: 'household' | 'guards' | 'town' | 'stab' | 'ration';
  /** Значок набора (docs/icons.md). */
  icon: IconName;
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
  // Ступень стабильности держит невольников, как поправка морали спокойных жителей (docs/stability.md, 2.6): плюс — крепче,
  // минус — слабее. Ноль в список не идёт.
  const level = stabClamp(s.stab?.level ?? 0);
  if (level !== 0) {
    lines.push({ id: 'stab', icon: T.stab.icon, name: T.stab.name, value: (pop * ORDER_PER_TOWNSMAN * STAB_STEP * level) / 100, hint: T.stab.hint(level) });
  }
  // Осадный паёк — порядок платит той же долей урезанного (docs/siege_v2.md, раздел 5): голодных держать труднее.
  if (s.siege?.ration) {
    const held = lines.reduce((n, l) => n + l.value, 0);
    lines.push({ id: 'ration', icon: T.ration.icon, name: T.ration.name, value: -held * SIEGE_RATION_CUT, hint: T.ration.hint(SIEGE_RATION_CUT) });
  }
  const hold = Math.max(0, lines.reduce((n, l) => n + l.value, 0));
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

/**
 * Какую долю своей работы делают вольные сейчас. Встали мятежом податные или голодные — вставшие не работают ни в поле, ни
 * на стройке, пока мятеж не кончился: на столе, у ворот или затяжным упадком (`GameState.stab.revolt`, docs/stability.md,
 * 2.4). Одна дверь на поле и на стройку, как `bondedShare` у невольников.
 */
export function freeShare(s: GameState): number {
  const r = s.stab?.revolt;
  if (!r || (r.until !== undefined && r.until <= s.time)) return 1;
  return Math.max(0, 1 - Math.max(0, r.rebels) / Math.max(1, s.pop));
}

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
  /** Значок набора (docs/icons.md). */
  icon: IconName;
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
    out.push({ id: 'starving', icon: 'alert-starving', text: 'Амбары пусты, город голодает', goto: 'storage' });
  }
  else if (foodDays < 1) out.push({ id: 'food', icon: 'res-food', text: 'Еды не хватит и на день', goto: 'storage' });

  const heat = heatingWoodPerDay(s);
  if (heat > 0) {
    if (s.freezing > 0) out.push({ id: 'freezing', icon: 'alert-freezing', text: 'Дров нет, город мёрзнет', goto: 'storage' });
    else if (s.resources.wood / heat < 1) out.push({ id: 'wood', icon: 'res-wood', text: 'Дров не хватит и на день', goto: 'storage' });
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
    out.push({ id: 'forge-idle', icon: 'bld-smithy', text: 'Кузнецы сидят без заказа', goto: 'smithy' });
  }
  // Ересь. Второй механики под неё нет: в деревне это строка тревоги, просадка
  // морали и событие с выбором — то, чем деревня живёт всегда.
  if (heresy(s)) {
    out.push({ id: 'heresy', icon: 'ui-flame', text: 'В приходе раскол', goto: 'church' });
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
