// Мощь игрока — одна цифра: посёлок плюс дружина.
//
// Оба слагаемых выводятся из тех же конфигов, из которых считает симуляция и
// строятся карточки войск. Своей таблицы весов «для профиля» здесь нет и быть не
// может: она разъехалась бы с балансом ровно так же, как разъезжается любой
// справочник, переписанный руками. Поэтому в этом файле нет ни одного имени
// здания и ни одного имени вида бойцов — только правила, по которым из конфига
// получается число. Новый вид войск или новое здание попадает в мощь сам.
//
// Алмазы, премиум и покупки в мощь не входят никак: за деньги здесь не купить
// ни одной единицы. Купить можно только время (см. sim/gems.ts), а время в мощи
// не участвует.
import type { GameState, TroopId } from '@/game/types';
import type { BuildingDef } from '@/game/data/buildings';
import { RESOURCE_IDS } from '@/game/constants';
import { BUILDINGS } from '@/game/data/buildings';
import { TROOPS } from '@/game/data/troops';
import { MORALE, PIP, UNIT_STATS } from '@/battle';
import { KIND_OF, profileOfTroop } from '@/game/battle/kinds';
import { battleWeight } from '@/game/battle/price';

/**
 * Степень, с которой уровень входит в мощь здания. Больше единицы нарочно:
 * при линейном счёте двадцать зданий первого уровня весили бы столько же,
 * сколько одно двадцатого, — а это разные посёлки.
 */
export const LEVEL_EXP = 1.5;

/**
 * Порядок числа. Единственная косметическая величина здесь: она умножает оба
 * слагаемых одинаково и потому не может перевесить одно в пользу другого.
 */
export const POWER_SCALE = 10;

// ---------- Посёлок ----------

/** Во что обходится один уровень здания: труд плюс материалы, как в конфиге. */
const buildingCost = (def: BuildingDef): number =>
  def.work + RESOURCE_IDS.reduce((n, r) => n + (def.cost[r] ?? 0), 0);

/**
 * Мера «обычного здания»: среднее по тем, что вообще строятся. Делить на неё
 * нужно, чтобы мощь говорила о развитии посёлка, а не о том, в каких числах
 * записаны цены: подорожает всё вдвое — мощь не шелохнётся, и правильно.
 */
function typicalBuilding(): number {
  const costs = BUILDINGS.map(buildingCost).filter((c) => c > 0);
  if (costs.length === 0) return 1;
  return costs.reduce((a, b) => a + b, 0) / costs.length;
}

/** Вес здания относительно обычного. Костёр ничего не стоит и ничего не весит. */
export const buildingWeight = (def: BuildingDef): number => buildingCost(def) / typicalBuilding();

/**
 * Мощь посёлка. Здания перебираются по конфигу, а не по списку в этом файле:
 * появится новое — оно попадёт в счёт само, как попадает в стартовый посёлок.
 */
export function buildingsPower(s: GameState): number {
  return levelsPower(s.buildings.map((b) => [b.type, b.level]));
}

/** Мощь посёлка по парам «тип — уровень»: одна формула на партию и на опись наблюдения (`powerOfCounts`). */
function levelsPower(levels: Iterable<readonly [string, number]>): number {
  let sum = 0;
  for (const [type, level] of levels) {
    const def = BUILDINGS.find((d) => d.id === type);
    if (!def) continue;
    sum += buildingWeight(def) * Math.pow(Math.max(0, level), LEVEL_EXP);
  }
  return sum * POWER_SCALE;
}

// ---------- Дружина ----------

/**
 * Чего стоит один боец строя этого вида: чем он бьёт, сколько держит и насколько
 * стоек. Все числа — из боевого конфига: сила рода в натиске и огне, показатели рода
 * (`profileOfTroop`) в цене отметки (`PIP`) и мораль рода. Правят баланс боя — меняется и
 * мощь, без правки этого файла. Вещи сюда не входят: в бой они идут через вес вида
 * (`troopWeight`, путь П2 — docs/battle_eu4.md, 14.35).
 */
export function combatValue(troop: TroopId): number {
  const stats = UNIT_STATS[KIND_OF[troop]];
  if (!stats) return 0;
  const p = profileOfTroop(troop);
  const morale = Math.min(MORALE.max, stats.morale);
  const hits = stats.melee * (1 + PIP * p.shockAtk) + stats.ranged * (1 + PIP * p.fireAtk);
  const holds = 1 + (PIP * (p.fireDef + p.shockDef)) / 2;
  return hits * holds * (morale / MORALE.max);
}

/**
 * Вес одного бойца вида: сколько он весит в полевом строю (`price.battleWeight` — тот же
 * перевод, которым пользуется бой: по цене вида) на то, чего этот строй стоит. Дубинщик —
 * единица измерения там и тут.
 */
export const troopWeight = (troop: TroopId): number => battleWeight(troop) * combatValue(troop);

/**
 * Мощь дружины. Виды перебираются по конфигу войск: заведут девятый — он
 * посчитается сам, потому что имён видов здесь нет.
 */
export function troopsPower(s: GameState): number {
  return armyPower(s.army ?? {});
}

function armyPower(army: Readonly<Partial<Record<string, number>>>): number {
  let sum = 0;
  for (const def of TROOPS) sum += Math.max(0, army[def.id] ?? 0) * troopWeight(def.id);
  return sum * POWER_SCALE;
}

// ---------- Итог ----------

/** Мощь игрока: посёлок плюс дружина, одним целым числом. */
export const power = (s: GameState): number => Math.round(buildingsPower(s) + troopsPower(s));

/**
 * Мощь по числам описи наблюдения: уровни зданий по типу и войско по видам. Та же формула, что `power`, — её зовёт
 * сервер, когда считает рейтинг (docs/rating.md): число мощи клиент не присылает, присылает только то, из чего оно
 * выводится, и подделанная цифра мощи в описи в рейтинг не попадает.
 */
export const powerOfCounts = (levels: Readonly<Record<string, number>>, army: Readonly<Record<string, number>>): number =>
  Math.round(levelsPower(Object.entries(levels)) + armyPower(army));
