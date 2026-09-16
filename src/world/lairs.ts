// Логова: единственная цель на карте, которую можно убрать, а не потрепать.
//
// Чистый модуль того же рода, что `siege.ts` и `spy.ts`: тика у логова нет, всё
// выводится при чтении из двух отметок времени — когда завелось и когда сожгли.
// Поэтому офлайн даёт ровно то же, что непрерывная игра, а сервер потом получит
// тот же ответ из тех же двух чисел.
//
// Петля целиком: логово заводится слабым → медленно крепнет и шлёт набеги чаще
// и сильнее → игрок его сжигает и получает добро по его силе → на
// месте остаётся пепелище → пепелище остывает → где-то в стороне заводится
// новое, снова слабое. Второй раз сожжённое разграбить нельзя, потому что его
// нет: `lairPhase` перестаёт называть его живым, и мир его больше не показывает.
//
// Сила растёт от двух вещей и ни от чего третьего: от возраста логова и от зрелости
// города, которую меряют **жители**. Обороны здесь нет ни одним путём — ни числом, ни
// уровнем укреплений: игрок, строящий защиту, не должен усиливать врага.
import {
  LAIR_ANCHOR_MID,
  LAIR_ARMS_PER_POWER,
  LAIR_CAP,
  LAIR_GOLD_PER_POWER,
  LAIR_LEVEL_BASE,
  LAIR_LEVEL_PER_VILLAGER,
  LAIR_LOOT_PER_POWER,
  LAIR_POWER_BASE,
  LAIR_POWER_PER_LEVEL,
  LAIR_POWER_PER_MAN,
  LAIR_RAID_WEIGHT_RIPE,
  LAIR_RIPE,
  LAIR_RUIN,
  LAIR_SHIELD_FROM,
  LAIR_SHIELD_FULL,
  LAIR_START,
  LAIR_STEP,
} from './data/tuning';

/**
 * Всё, что про логово нельзя вывести из сида. Два числа, и оба — отметки
 * времени: когда завелось и когда сожгли. Ни силы, ни запаса, ни стадии здесь
 * нет и быть не должно — они считаются.
 */
export interface LairRec {
  bornAt: number;
  /** 0 — стоит. */
  burnedAt: number;
}

/** Что сейчас на месте: логово, пепелище или уже ничего. */
export type LairPhase = 'alive' | 'ruin' | 'gone';

export function lairPhase(rec: LairRec, now: number): LairPhase {
  if (rec.burnedAt <= 0) return 'alive';
  return now < rec.burnedAt + LAIR_RUIN ? 'ruin' : 'gone';
}

/** Сколько пепелищу осталось, мс. 0 — оно уже сошло или его не было. */
export function ruinLeft(rec: LairRec, now: number): number {
  if (rec.burnedAt <= 0) return 0;
  return Math.max(0, rec.burnedAt + LAIR_RUIN - now);
}

/**
 * Насколько логово выросло: 0 — только завелось, 1 — упёрлось в потолок.
 * Отсюда выводится всё остальное, поэтому потолок стоит ровно в одном месте.
 */
export function lairRipeness(rec: LairRec, now: number): number {
  const age = Math.max(0, now - rec.bornAt);
  return Math.min(1, LAIR_RIPE > 0 ? age / LAIR_RIPE : 1);
}

/** Доля полной силы по возрасту: от `LAIR_START` у только что заведённого до `LAIR_CAP`. */
const ageShare = (rec: LairRec, now: number): number => LAIR_START + (LAIR_CAP - LAIR_START) * lairRipeness(rec, now);

/** Зрелость города в уровнях посёлка мерки — из жителей, и только из них. */
export const lairLevel = (villagers: number): number =>
  Math.max(0, LAIR_LEVEL_PER_VILLAGER * Math.max(0, villagers) + LAIR_LEVEL_BASE);

/**
 * Защита новичка: доля силы набега, с которой логово выходит на город этой зрелости. Ноль —
 * набег не выходит вовсе; единица — полная сила. Сила **самого логова** от неё не зависит:
 * логово у молодого города не бутафорское, оно просто его ещё не замечает.
 */
export const lairShield = (villagers: number): number =>
  Math.min(1, Math.max(0, (lairLevel(villagers) - LAIR_SHIELD_FROM) / (LAIR_SHIELD_FULL - LAIR_SHIELD_FROM)));

/** Сколько жителей нужно городу, чтобы логово выходило на него долей `share` силы набега. */
export const shieldVillagers = (share: number): number =>
  Math.ceil(
    (LAIR_SHIELD_FROM + (LAIR_SHIELD_FULL - LAIR_SHIELD_FROM) * Math.min(1, Math.max(0, share)) - LAIR_LEVEL_BASE) /
      LAIR_LEVEL_PER_VILLAGER,
  );

/**
 * Сила логова — чистая функция от опоры, времени появления и жителей города. Опору
 * (расстояние до замка) считает `gen.lairAnchor`: у медианной опоры (`LAIR_ANCHOR_MID`)
 * дозревшее логово — ровно ступень (`LAIR_STEP`) обороны посёлка мерки той же зрелости.
 *
 * По возрасту растёт линейно и упирается в `LAIR_CAP` навсегда: вернувшийся через три дня
 * игрок застаёт логово на потолке своего города, а не стену. Растёт город — растёт и логово;
 * город пустеет — слабеет и оно.
 */
export function lairPower(anchor: number, rec: LairRec, now: number, villagers: number): number {
  const mature = LAIR_STEP * (LAIR_POWER_PER_LEVEL * lairLevel(villagers) + LAIR_POWER_BASE);
  return Math.max(1, (anchor / LAIR_ANCHOR_MID) * ageShare(rec, now) * mature);
}

/**
 * Прежняя сила логова — опора и возраст, без зрелости города. Из неё и только из неё
 * считается оружие добычи (`lairArms`): предметы дают силу, и логово — единственное
 * место, где их получают даром, поэтому с ростом логова они не растут.
 */
export function lairArmsBase(anchor: number, rec: LairRec, now: number): number {
  return Math.max(1, anchor * ageShare(rec, now));
}

/**
 * Набег на город: всё логово, умноженное на защиту новичка. Доли логова, которая уходит в
 * набег, нет — при ней выросшее логово нельзя было бы сжечь вовсе (docs/lair_growth.md,
 * раздел 5). Ноль — набег не выходит.
 */
export const lairRaid = (power: number, villagers: number): number => power * lairShield(villagers);

/** Сколько народу в логове. Выводится из силы тем же курсом, что и везде в мире. */
export const lairPop = (power: number): number =>
  Math.max(2, Math.round(power / LAIR_POWER_PER_MAN));

/** Сколько добра лежит в логове. Не восстанавливается: брать его второй раз негде. */
export const lairLoot = (power: number): number => Math.max(1, Math.round(power * LAIR_LOOT_PER_POWER));

/** Сколько золота в казне логова — сверх добра, отдельным ключом добычи. */
export const lairGold = (power: number): number => Math.max(0, Math.round(power * LAIR_GOLD_PER_POWER));

/**
 * Сколько оружия. Считается от прежней силы (`lairArmsBase`), а не от выросшей: у предметов
 * своя дверь. Что это будут за предметы, решает племя, а не мир.
 */
export const lairArms = (power: number): number => Math.max(1, Math.round(power * LAIR_ARMS_PER_POWER));

/**
 * Насколько охотно логово шлёт набеги. Растёт вместе с силой: непотревоженное
 * логово под боком становится слышно, и это единственная цена бездействия,
 * которая у игрока есть.
 */
export const lairRaidWeight = (base: number, rec: LairRec, now: number): number =>
  base * (1 + (LAIR_RAID_WEIGHT_RIPE - 1) * lairRipeness(rec, now));
