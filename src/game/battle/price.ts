// Цена вида и его вес в бою (слово владельца по 14.35, путь П2; docs/battle_eu4.md, 14.35).
//
// **Вес вида в бою — из цены:** столькими бойцами строя голова выходит в бой, во сколько раз её содержание в день дороже
// содержания дубинщика. Вещи идут в бой только так — через цену вида: своих показателей и морали у них нет, показатели в
// бою — только от рода (`KIND_PROFILE`). Прежде вес был мощью вида (мощь / 2), а вещи давали ещё и показатели и мораль,
// и одно снаряжение покупалось дважды — телом в строю и отметками поверх (14.35, «Вес вида: что он делает»).
//
// **Цена — содержание в день: жалованье и паёк** (решение 14.35, «Цена: одна мера»): размер войска держит оно, а не разовая
// плата. Жалованье — без доли веры: она одна на всю деревню и цены вида не меняет. Паёк — в золоте своим трудом
// (`derived.selfCost` еды), у конного рта два (`derived.mouthsOf`).
//
// Весов у вида два: в бою — по цене (здесь), в хозяйстве и мире — по мощи (`kinds.powerWeight`, `BATTLE_MAN`). Долг
// «свести при перемере мира» записан в 14.35.
//
// Модуль лежит отдельно от `kinds.ts` нарочно: цена берётся у `derived.ts`, а тот сам читает `kinds.ts`, — перевод голов в
// бойцов строя живёт здесь, чтобы круга импортов не было.
import type { TroopId } from '../types';
import { TROOP_IDS } from '../data/troops';
import { GOOD_BY_ID } from '../data/market';
import { SOLDIER_FOOD } from '../constants';
import { baseWage, mouthsOf, selfCost } from '../derived';
import { KIND_OF, TROOPS_OF_KIND, type TroopStack } from './kinds';
import { UNIT_KINDS, emptyStack, type Stack, type UnitKind } from '@/battle';

/** Вид, в чьём содержании меряется вес: дубинщик — боец строя без единой вещи. */
export const BASE_TROOP: TroopId = 'clubman';

/** Содержание головы за игровой день, золотом: жалованье без доли веры и паёк по цене своего труда. */
export const upkeepOf = (troop: TroopId): number => baseWage(troop) + SOLDIER_FOOD * mouthsOf({ [troop]: 1 }) * selfCost(GOOD_BY_ID.food);

/**
 * Вес вида в бою: бойцов строя на голову — его содержание к содержанию дубинщика. Читается из цены при каждом вызове, без
 * запоминания: правка жалованья или мощи вида доходит до боя и до карточки сразу.
 */
export const battleWeight = (troop: TroopId): number => upkeepOf(troop) / upkeepOf(BASE_TROOP);

/** Сколько бойцов строя даёт n бойцов этого вида. Ноль людей — ноль строя. */
export const menOf = (troop: TroopId, n: number): number => (n > 0 ? Math.max(1, Math.round(n * battleWeight(troop))) : 0);

/** Состав в родах боя — то, что понимает ядро. */
export function kindsOf(t: TroopStack): Stack {
  const out: Stack = emptyStack();
  for (const id of TROOP_IDS) out[KIND_OF[id]] += menOf(id, Math.max(0, t[id] ?? 0));
  return out;
}

/**
 * Потери по роду переводятся обратно в бойцов племени: доля от каждого вида этого
 * рода, слабые первыми — как в `removeSoldiers`. Так отряд из дубинщиков и латников
 * теряет сперва дубинщиков, а не «полтора латника».
 */
export function spreadLosses(t: TroopStack, kind: UnitKind, lostMen: number): TroopStack {
  const out: TroopStack = {};
  if (lostMen <= 0) return out;
  let left = lostMen;
  // Слабые первыми: список видов рода уже идёт от дешёвого к дорогому.
  for (const id of TROOPS_OF_KIND[kind]) {
    const have = Math.max(0, t[id] ?? 0);
    if (have <= 0 || left <= 0) continue;
    const w = battleWeight(id);
    const take = Math.min(have, Math.round(left / w));
    if (take > 0) {
      out[id] = take;
      left -= take * w;
    }
  }
  return out;
}

/** Потери сразу по всем родам. */
export function troopLosses(t: TroopStack, lost: Stack): TroopStack {
  const out: TroopStack = {};
  for (const k of UNIT_KINDS) {
    const part = spreadLosses(t, k, lost[k]);
    for (const id of TROOP_IDS) if (part[id]) out[id] = (out[id] ?? 0) + (part[id] as number);
  }
  return out;
}
