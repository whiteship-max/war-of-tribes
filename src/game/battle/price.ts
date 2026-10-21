// Цена вида, его вес в бою и мощь в мире (слово владельца по 14.35, путь П2; docs/battle_eu4.md, 14.35; docs/remeasure.md,
// пункт 1).
//
// **Вес вида в бою — из цены:** столькими бойцами строя голова выходит в бой, во сколько раз её содержание в день дороже
// содержания дубинщика. Вещи идут в бой только так — через цену вида: своих показателей и морали у них нет, показатели в
// бою — только от рода (`KIND_PROFILE`). Прежде вес был мощью вида (мощь / 2), а вещи давали ещё и показатели и мораль,
// и одно снаряжение покупалось дважды — телом в строю и отметками поверх (14.35, «Вес вида: что он делает»).
//
// **Цена — содержание в день: жалованье и паёк** (решение 14.35, «Цена: одна мера»): размер войска держит оно, а не разовая
// плата. Жалованье — без доли веры: она одна на всю деревню и цены вида не меняет. Паёк — в золоте своим трудом
// (`selfcost.selfCost` еды), у конного рта два (`mouthsOf`).
//
// **Вес у вида один** (пункт 1 пачки 5, docs/remeasure.md): мощь мира — тот же вес в бойцах строя, умноженный на
// `BATTLE_MAN` (`powerOf`, `troopPower`). Логово и отряды мира переводятся в людей мощью / `BATTLE_MAN`
// (`garrison.menOfPower`), и мощь игрока теперь та же шкала: «мощь 1000» у логова и у дружины — одна армия в бою. Прежде мир
// весил вид мощью, заданной рукой (`TroopDef.power`), и латник в мире весил восемь бойцов строя, а в бою — пять с половиной.
// Рукой теперь задана только ставка жалованья (`TroopDef.grade`) — цена, из которой вес выводится.
//
// Модуль стоит ниже `derived.ts`: цену вида он считает сам — жалованье, рты и цену своего труда (`selfcost.ts`), — а
// `derived` читает у него мощь, жалованье и рты. Круга импортов нет.
import type { TroopId } from '../types';
import { TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import { GOOD_BY_ID } from '../data/market';
import { TAX_PER_POP } from '../data/policy';
import { HORSE_MOUTHS, WAGE_GEAR, WAGE_HEAD, WAGE_MAN } from '../data/upkeep';
import { SOLDIER_FOOD } from '../constants';
import { selfCost } from '../selfcost';
import { BATTLE_MAN, KIND_OF, TROOPS_OF_KIND, gearOfTroop, type TroopStack } from './kinds';
import { UNIT_KINDS, emptyStack, type Stack, type UnitKind } from '@/battle';

/**
 * Что на бойце надето, в вещах: предметы кузницы и конь под ним. Из этого считается часть
 * жалованья — «платят и за снаряжение» (`WAGE_GEAR`, docs/stable.md, решение 4). Своей таблицы
 * у правила нет: вещи берутся из `TroopDef.gear`, конь — из `mounted`.
 */
export const wageGear = (troop: TroopId): number =>
  gearOfTroop(troop) + (TROOP_BY_ID[troop].mounted ? 1 : 0);

/**
 * Жалованье бойца этого вида за игровой день без доли веры (`derived.wageShare`): с головы, по ставке вида
 * (`TroopDef.grade`) и за снаряжение. Им меряется и цена вида, а с ней его вес в бою и мощь в мире: доля веры одна на всю
 * деревню и цену вида не меняет.
 */
export const baseWage = (troop: TroopId): number =>
  TAX_PER_POP * (WAGE_HEAD + WAGE_MAN * TROOP_BY_ID[troop].grade + WAGE_GEAR * wageGear(troop));

/**
 * Сколько ртов на солдатском пайке. Конь — тоже рот: всадник и его конь едят за двоих, и это
 * то же правило «кто ест — тот считается», только на конях (docs/stable.md, решение 5).
 */
export const mouthsOf = (t: TroopStack): number =>
  TROOP_IDS.reduce((n, id) => n + Math.max(0, t[id] ?? 0) * (TROOP_BY_ID[id].mounted ? HORSE_MOUTHS : 1), 0);

/** Вид, в чьём содержании меряется вес: дубинщик — боец строя без единой вещи. */
export const BASE_TROOP: TroopId = 'clubman';

/** Содержание головы за игровой день, золотом: жалованье без доли веры и паёк по цене своего труда. */
export const upkeepOf = (troop: TroopId): number => baseWage(troop) + SOLDIER_FOOD * mouthsOf({ [troop]: 1 }) * selfCost(GOOD_BY_ID.food);

/**
 * Вес вида в бою: бойцов строя на голову — его содержание к содержанию дубинщика. Читается из цены при каждом вызове, без
 * запоминания: правка жалованья или ставки вида доходит до боя, до мира и до карточки сразу.
 */
export const battleWeight = (troop: TroopId): number => upkeepOf(troop) / upkeepOf(BASE_TROOP);

/**
 * Мощь вида в мире — его вес в бою, в мере мира: `BATTLE_MAN` на бойца строя (дубинщик — 2, как и прежде). Одна шкала с
 * мощью логова и отрядов мира, которые переводятся в людей делением на `BATTLE_MAN` (`garrison.menOfPower`).
 */
export const powerOf = (troop: TroopId): number => BATTLE_MAN * battleWeight(troop);

/**
 * Мощь состава — сумма мощи каждого бойца: мощь всего войска, тех, кто дома, дружины и лагеря считается этой дверью, а не
 * средним на число: латник, ушедший в поле, уносит мощь латника, а не мощь среднего бойца (docs/defense_mix.md).
 */
export const troopPower = (t: TroopStack): number => {
  // Тот же счёт, что `Σ max(0, t[id]) · powerOf(id)`, бит в бит: вид без бойцов прибавляет ровно ноль (цена вида конечна),
  // а содержание дубинщика — делитель веса — считается раз на вызов, а не на каждый вид. Без запоминания, как и вес.
  let base = 0;
  let n = 0;
  for (const id of TROOP_IDS) {
    const k = Math.max(0, t[id] ?? 0);
    if (k === 0) continue;
    if (base === 0) base = upkeepOf(BASE_TROOP);
    n += k * (BATTLE_MAN * (upkeepOf(id) / base));
  }
  return n;
};

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
