// Правила посёлка по уровням построек — одни на игру (`derived`: стройка, жильё, склад, тайник, оборона; `world/bridge`:
// ополчение и башня) и на книгу стройки сервера (`netlify/lib/town.ts`, docs/pvp.md, раздел 7): сервер подтверждает
// уровни, жителей и оборону защитника не больше, чем дают эти же формулы. Две копии разошлись бы молча — сервер резал бы
// честный город или пропускал поддельный, — поэтому вторую не заводить. Без `@/`-импортов: модуль читает серверная часть.
//
// Потолки (`…_MAX`, `buildCeil`, `popGrowthCeil`) выводятся из таблиц игры, а не задаются числом: наибольшее, что дают
// сезон, усилители вестей, мораль, вера, указ и рацион вместе. Больше этого у игрока не бывает никак.
import type { BuildingTypeId, ResourceId } from './types';
import {
  BASE_DEFENSE,
  BASE_HOUSING,
  BASE_STORAGE_CAP,
  BUILDER_RATE,
  CRAFTER_BUILD,
  MORALE_OUTPUT_LOW,
  MORALE_OUTPUT_SPAN,
  POP_GROWTH_BASE,
  POP_GROWTH_PER_DAY,
  TOWN_HALL_BUILD_STEP,
  UPGRADE_GROWTH,
  MAX_BUILDING_LEVEL,
  VILLAGER_DEFENSE,
  WALL_REPAIR_SHARE,
} from './constants';
import { BUILDING_BY_ID, slotsAt, type BuildingStats } from './data/buildings';
import { SEASON_MODIFIERS } from './data/seasons';
import { BOONS } from './data/boons';
import { DECREES, RATIONS } from './data/policy';
import { FAITHS, OBSERVANCES, tiltAt } from './data/faiths';
import { levelOutputMult } from './selfcost';
import { statAt } from './train';
import { BATTLE_MAN } from './battle/kinds';

/** Уровни построек по типу — как их держит опись (`WatchCard.buildings`) и книга стройки. Нет типа — уровень 0. */
export type Levels = Readonly<Partial<Record<string, number>>>;

const TYPES = Object.keys(BUILDING_BY_ID) as BuildingTypeId[];

/** Уровень постройки: целый, от нуля до потолка игры. */
export const levelIn = (levels: Levels, type: BuildingTypeId): number =>
  Math.max(0, Math.min(MAX_BUILDING_LEVEL, Math.floor(levels[type] ?? 0)));

/** Сумма пассива по всем постройкам этих уровней. */
const statSum = (levels: Levels, key: keyof BuildingStats): number =>
  TYPES.reduce((t, type) => t + statAt(type, key, levelIn(levels, type)), 0);

/** Вместимость жилья — `derived.housingCapacity`. */
export const housingOf = (levels: Levels): number => BASE_HOUSING + statSum(levels, 'housing');

/** Вместимость склада по каждому припасу — `derived.storageCap`. */
export const storageOf = (levels: Levels): number => BASE_STORAGE_CAP + statSum(levels, 'storage');

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

/**
 * Оборона деревни — `derived.defense`: войско дома, укрепления, база и жители с дубинами, всё под стойкостью веры.
 * `villagers` — жители в городе (без ушедших разведчиками).
 */
export const defenseOf = (levels: Levels, villagers: number, homePower: number, steadfast: number): number =>
  (homePower + statSum(levels, 'defense') + BASE_DEFENSE + Math.max(0, villagers) * VILLAGER_DEFENSE) * (1 + steadfast);

/** Ополчение — оборона без войска, людьми по `BATTLE_MAN` (`world/bridge.militiaMen`). */
export const militiaOf = (defense: number, homePower: number): number => Math.max(0, Math.round((defense - homePower) / BATTLE_MAN));

/** Мест лучников на башне этого уровня (`world/bridge.militiaArchers`: из ополчения, не больше его). */
export const towerArchersAt = (level: number): number => Math.max(0, Math.round(statAt('tower', 'archers', level)));

/** Множитель стройки от уровня ратуши — `derived.townHallBuildMult`. Ратуши нет (0) — единица. */
export const hallBuildMult = (level: number): number => 1 + TOWN_HALL_BUILD_STEP * Math.max(0, level - 1);

/**
 * Скорость стройки, работа в игровую секунду — `derived.buildRate`: свободные руки (`idle`, невольники — своей долей в
 * `bonded`) по `BUILDER_RATE` плюс ремесленники и мастера (`crafters` — их работа), всё под сезоном и ратушей.
 */
export const buildRateOf = (idle: number, bonded: number, crafters: number, build: number, hallLevel: number): number =>
  ((Math.max(0, idle) + Math.max(0, bonded)) * BUILDER_RATE + Math.max(0, crafters)) * build * hallBuildMult(hallLevel);

const most = (xs: number[]): number => Math.max(1, ...xs);
const boost = (xs: (number | undefined)[]): number => xs.reduce<number>((m, x) => (x !== undefined && x > 1 ? m * x : m), 1);
const SEASONS = Object.values(SEASON_MODIFIERS);

/** Наибольший множитель стройки сезона с усилителями вестей поверх (`derived.seasonMods`): все, что ускоряют, разом. */
export const BUILD_MOD_MAX = most(SEASONS.map((m) => m.build)) * boost(BOONS.map((b) => b.build));

/** Наибольшая выработка вольной веры: наклон при высшем храме и самом строгом укладе. */
const faithMax = (pick: (t: ReturnType<typeof tiltAt>) => number): number =>
  Math.max(...FAITHS.flatMap((f) => OBSERVANCES.flatMap((o) => [0, MAX_BUILDING_LEVEL].map((l) => pick(tiltAt(f.id, l, o.id))))));

/**
 * Наибольший множитель ремесленника (`derived.jobMultiplier('crafter')`): сезон двора, усилители вестей, полная мораль,
 * вера и указ — каждый в своём наибольшем.
 */
export const CRAFTER_MULT_MAX =
  most(SEASONS.map((m) => m.jobs.crafter ?? 1)) *
  boost(BOONS.map((b) => b.jobs?.crafter)) *
  (MORALE_OUTPUT_LOW + MORALE_OUTPUT_SPAN) *
  Math.max(1, faithMax((t) => t.output)) *
  most(DECREES.map((d) => d.output));

/** Наибольшая стойкость веры (`faithTilt.steadfast`) — множитель обороны. */
export const STEADFAST_MAX = Math.max(0, faithMax((t) => t.steadfast));

/**
 * Потолок скорости стройки посёлка этих уровней с `heads` руками (жители и невольники): каждая голова — свободными руками
 * (`BUILDER_RATE`), и сверх того места Мастерской этого уровня дважды (ремесленники и наёмные мастера) — ремесленником в
 * наибольшем множителе, всё под наибольшим сезоном и ратушей. Честная стройка (`derived.buildRate`) не бывает быстрее —
 * тест: ремесленник стоит на месте Мастерской, а не сверх него, и свободной головой он не считается дважды.
 */
export function buildCeil(levels: Levels, heads: number): number {
  const shop = levelIn(levels, 'workshop');
  const crafter = CRAFTER_BUILD * CRAFTER_MULT_MAX * levelOutputMult(Math.max(1, shop));
  const places = 2 * slotsAt(BUILDING_BY_ID.workshop, shop);
  return (Math.max(0, heads) * BUILDER_RATE + places * crafter) * BUILD_MOD_MAX * hallBuildMult(levelIn(levels, 'town_hall'));
}

/** Наибольшая доля прироста в игровой день (`sim/population.popGrowth`): полная мораль, жильё и еда, щедрый паёк, вера. */
export const POP_RATE_MAX = POP_GROWTH_PER_DAY * most(RATIONS.map((r) => r.growth)) * (1 + Math.max(0, faithMax((t) => t.growth)));

/**
 * Сколько жителей прирост может прибавить за `days` игровых дней к `pop` — не больше, чем растёт `pop + POP_GROWTH_BASE`
 * со ставкой `rate` (по умолчанию наибольшей) сложным процентом: прирост идёт от уже прибывших.
 */
export const popGrowthCeil = (pop: number, days: number, rate = POP_RATE_MAX): number =>
  (Math.max(0, pop) + POP_GROWTH_BASE) * (Math.exp(rate * Math.max(0, days)) - 1);

/**
 * Толпа одной вести (`data/eventKit.crowd`): доля всех людей посёлка, но не меньше горстки. Здесь — наибольшая из вестей:
 * беженцы. Тест читает все `crowd(…)` в данных вестей и держит их не больше этого.
 */
export const CROWD_MAX = { share: 0.06, min: 8 } as const;

/** Наибольшая толпа одной вести у посёлка из `souls` людей. */
export const crowdMax = (souls: number): number => Math.max(CROWD_MAX.min, Math.round(Math.max(0, souls) * CROWD_MAX.share));

/** Наибольшая доля труда уровня, которую весть кладёт в стройку разом (`data/events.EVENT_WORK`: артель, день на стройке). */
export const EVENT_WORK_MAX = 0.35;

/**
 * Цена починки пролома при стенах уровня `level` (docs/siege_v2.md, раздел 5): треть цены этого уровня
 * (`WALL_REPAIR_SHARE`) — той же лестницей `UPGRADE_GROWTH`, что улучшение (`derived.upgradeCost`). Одна формула на игру
 * (окно осады, починка у мира) и на сервер войны (проверка склада защитника). Стен нет — чинить нечего, цены нет.
 */
export function wallRepairCost(level: number): Partial<Record<ResourceId, number>> {
  const lv = Math.max(0, Math.min(MAX_BUILDING_LEVEL, Math.floor(level)));
  if (lv < 1) return {};
  const k = Math.pow(UPGRADE_GROWTH, lv - 1) * WALL_REPAIR_SHARE;
  const out: Partial<Record<ResourceId, number>> = {};
  for (const [r, v] of Object.entries(BUILDING_BY_ID.palisade.cost) as [ResourceId, number][]) if (v) out[r] = Math.round(v * k);
  return out;
}
