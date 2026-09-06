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
import { GEAR, MORALE, UNIT_STATS } from '@/battle';
import { KIND_OF, gearOfTroop, weightOf } from '@/game/battle/kinds';

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
  let sum = 0;
  for (const b of s.buildings) {
    const def = BUILDINGS.find((d) => d.id === b.type);
    if (!def) continue;
    sum += buildingWeight(def) * Math.pow(Math.max(0, b.level), LEVEL_EXP);
  }
  return sum * POWER_SCALE;
}

// ---------- Дружина ----------

/**
 * Чего стоит один боец строя этого рода: чем он бьёт, сколько держит и насколько
 * стоек. Все три числа — из боевого конфига, включая мораль со ступенью
 * снаряжения (`GEAR`). Правят баланс боя — меняется и мощь, без правки этого файла.
 */
export function combatValue(troop: TroopId): number {
  const stats = UNIT_STATS[KIND_OF[troop]];
  if (!stats) return 0;
  const morale = Math.min(MORALE.max, stats.morale + gearOfTroop(troop) * GEAR.moralePerLevel);
  return (stats.melee + stats.ranged) * stats.toughness * (morale / MORALE.max);
}

/**
 * Вес одного бойца вида: сколько он весит в полевом строю (`weightOf` — тот же
 * перевод, которым пользуется бой) на то, чего этот строй стоит. Дубинщик —
 * единица измерения там и тут, латник весит восьмерых и стоек вдобавок.
 */
export const troopWeight = (troop: TroopId): number => weightOf(troop) * combatValue(troop);

/**
 * Мощь дружины. Виды перебираются по конфигу войск: заведут девятый — он
 * посчитается сам, потому что имён видов здесь нет.
 */
export function troopsPower(s: GameState): number {
  let sum = 0;
  for (const def of TROOPS) sum += Math.max(0, s.army?.[def.id] ?? 0) * troopWeight(def.id);
  return sum * POWER_SCALE;
}

// ---------- Итог ----------

/** Мощь игрока: посёлок плюс дружина, одним целым числом. */
export const power = (s: GameState): number => Math.round(buildingsPower(s) + troopsPower(s));
