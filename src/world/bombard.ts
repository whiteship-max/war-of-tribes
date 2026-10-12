// Обстрел лагеря с башни осаждённого города: балиста и катапульта.
//
// Модуль чистый, того же рода, что `works.ts` и `siege.ts`: ни состояния мира, ни часов,
// ни `Math.random`. И правило то же — **считаем при чтении, не тикаем**. Обстрел лежит в
// окне осады одной записью (`SiegeWindow.fire`), замороженной на минуту, когда она
// заведена, и всё остальное выводится из неё в момент вопроса:
//
//  - **выбитая доля мощи лагеря** растёт ровно со временем на часах самих рогаток
//    (`CAMP_WORKS_RIPE`) до потолка орудия и дальше не растёт (`thinAt`);
//  - **рогатки со стороны города** рубятся долей `1 − slow` (`firePlan`): тот же приём,
//    что доли древесины, — план лагеря, а не второй счёт готовности.
//
// Сила меняется событием, а не тиком: орудие поставили или сняли, расчёт ушёл на вылазку
// или вернулся. Событие записывает, что было выбито и построено к его минуте, и дальше
// растёт от этого (`reaim`) — прошлое не переписывается ни в какую сторону.
//
// Прикладывается обстрел к лагерю в одном месте мира — `LocalWorld.campArmy`: лагерь,
// которым бьются, прорежён там, а план рогаток замедлен там же. Ядро боя (`src/battle/`)
// про орудия не знает: они меняют лагерь до боя, а не бой.
//
// Проход обстрел не сужает не исключением, а правилом прохода: рогатки держат те, кто их
// строил (`works.campPass`, `SiegeWindow.builders`), и выбитые после этого проход не
// трогают — ни обстрелом, ни боем.
import { sideWorks, type WoodPlan } from './works';
import { CAMP_WOOD, CAMP_WORKS_RIPE } from './data/tuning';

/**
 * Орудие башни глазами мира: его сила и сколько на башне мест для расчёта. Приезжает
 * слепком деревни только у готового орудия; мир про здания и уровни не знает.
 */
export interface TowerGun {
  /** Доля выработки рогаток со стороны города, которую съедает орудие в полную силу. */
  slow: number;
  /** Потолок выбитой доли мощи лагеря в полную силу. */
  thin: number;
  /** Сколько лучников нужно орудию, чтобы бить в полную силу. */
  crew: number;
  /** Мест лучников на башне. */
  seats: number;
}

/** Сила обстрела в эту минуту: орудие на долю своего расчёта. */
export interface Aim {
  slow: number;
  thin: number;
}

/** Обстрел в окне осады. Заморожен на минуту `at`: дальше растёт от `base`. */
export interface Fire {
  /** Доля выработки фронта, которую съедает обстрел. */
  slow: number;
  /** Потолок выбитой доли мощи лагеря. */
  thin: number;
  /** С какой минуты идут эти числа, мс. */
  at: number;
  /** Сколько мощи лагеря было выбито к `at`, 0..1. */
  base: number;
}

const NONE: Aim = { slow: 0, thin: 0 };

/**
 * С какой силой бьёт башня, если дома `archers` лучников: орудие на долю расчёта.
 * Лучник на башне — лучник, который дома: ушёл на вылазку или к полководцу — его место
 * пустует. Мест меньше расчёта — орудие и в полный сбор бьёт той же долей.
 */
export function aimOf(gun: TowerGun | undefined, archers: number): Aim {
  if (!gun || gun.crew <= 0) return NONE;
  const manned = Math.min(Math.max(0, Math.floor(gun.seats)), Math.max(0, Math.floor(archers)));
  const share = Math.min(1, manned / gun.crew);
  if (share <= 0) return NONE;
  return { slow: clamp01(gun.slow) * share, thin: clamp01(gun.thin) * share };
}

/** Выбитая доля мощи лагеря в минуту `at`, 0..1. Нет обстрела — ноль. */
export function thinAt(fire: Fire | undefined, at: number): number {
  if (!fire) return 0;
  const base = clamp01(fire.base);
  const grown = base + clamp01(fire.thin) * (Math.max(0, at - fire.at) / CAMP_WORKS_RIPE);
  return Math.min(Math.max(base, clamp01(fire.thin)), grown);
}

/**
 * План рогаток под обстрелом: фронт рубится долей `1 − slow`. Без обстрела — план как
 * есть, и окно без поля древесины остаётся без поля.
 */
export function firePlan(fire: Fire | undefined, wood: WoodPlan | undefined): WoodPlan | undefined {
  if (!fire || fire.slow <= 0) return wood;
  const plan = wood ?? CAMP_WOOD;
  return { ...plan, front: plan.front * (1 - clamp01(fire.slow)) };
}

/**
 * Башня стала бить иначе в минуту `at`: обстрел и доли древесины окна после этого
 * события. Что было выбито и построено к этой минуте, остаётся: выбитые не встают, а
 * вложенное в рогатки старым темпом становится базой, от которой они растут новым
 * (`WoodPlan.base`). Та же сила — окно не трогается вовсе.
 */
export function reaim(
  prev: Fire | undefined,
  wood: WoodPlan | undefined,
  since: number,
  at: number,
  next: Aim,
): { fire: Fire | undefined; wood: WoodPlan | undefined } {
  const was: Aim = prev ?? NONE;
  if (was.slow === next.slow && was.thin === next.thin) return { fire: prev, wood };
  const base = thinAt(prev, at);
  let plan = wood;
  if (was.slow !== next.slow) {
    const built = firePlan(prev, wood) ?? CAMP_WOOD;
    const raw = wood ?? CAMP_WOOD;
    const from = Math.max(since, at);
    plan = {
      front: raw.front,
      rear: raw.rear,
      at: from,
      base: { front: sideWorks(since, from, 'front', built), rear: sideWorks(since, from, 'rear', built) },
    };
  }
  const idle = next.slow <= 0 && next.thin <= 0 && base <= 0;
  return { fire: idle ? undefined : { slow: next.slow, thin: next.thin, at, base }, wood: plan };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
}

/**
 * Роды лагеря, прорежённые обстрелом: каждый род — доля `1 − thin`, до целого. Одна мерка на лагерь в бою у мира
 * (`LocalWorld.campArmy`) и у сервера войны (`war.campSide`): в бою те, кого башня не выбила.
 */
export function thinKinds<K extends string>(kinds: Record<K, number>, thin: number): Record<K, number> {
  if (thin <= 0) return kinds;
  const out = { ...kinds };
  for (const k of Object.keys(out) as K[]) out[k] = Math.round(out[k] * (1 - clamp01(thin)));
  return out;
}
