// Логова: единственная цель на карте, которую можно убрать, а не потрепать.
//
// Чистый модуль того же рода, что `siege.ts` и `spy.ts`: тика у логова нет, всё
// выводится при чтении из двух отметок времени — когда завелось и когда сожгли.
// Поэтому офлайн даёт ровно то же, что непрерывная игра, а сервер потом получит
// тот же ответ из тех же двух чисел.
//
// Петля целиком: логово заводится слабым → медленно крепнет и шлёт набеги чаще
// и сильнее → игрок его сжигает и получает добро и оружие по его силе → на
// месте остаётся пепелище → пепелище остывает → где-то в стороне заводится
// новое, снова слабое. Второй раз сожжённое разграбить нельзя, потому что его
// нет: `lairPhase` перестаёт называть его живым, и мир его больше не показывает.
import {
  LAIR_ARMS_PER_POWER,
  LAIR_CAP,
  LAIR_LOOT_PER_POWER,
  LAIR_POWER_PER_MAN,
  LAIR_RAID_WEIGHT_RIPE,
  LAIR_RIPE,
  LAIR_RUIN,
  LAIR_START,
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

/**
 * Сила логова — чистая функция от опоры и времени появления. Опору (мощь чужих
 * дворов вокруг) считает `gen.lairAnchor`: логово не должно выпадать из мира ни
 * в слабую сторону, ни в сильную.
 *
 * Растёт линейно и упирается в `LAIR_CAP` навсегда. Никакой второй ветки роста
 * тут быть не может: именно на потолке держится обещание, что вернувшийся через
 * три дня игрок застанет цель, а не стену.
 */
export function lairPower(anchor: number, rec: LairRec, now: number): number {
  const k = LAIR_START + (LAIR_CAP - LAIR_START) * lairRipeness(rec, now);
  return Math.max(1, anchor * k);
}

/** Сколько народу в логове. Выводится из силы тем же курсом, что и везде в мире. */
export const lairPop = (power: number): number =>
  Math.max(2, Math.round(power / LAIR_POWER_PER_MAN));

/** Сколько добра лежит в логове. Не восстанавливается: брать его второй раз негде. */
export const lairLoot = (power: number): number => Math.max(1, Math.round(power * LAIR_LOOT_PER_POWER));

/** Сколько оружия. Что это будут за предметы, решает племя, а не мир. */
export const lairArms = (power: number): number => Math.max(1, Math.round(power * LAIR_ARMS_PER_POWER));

/**
 * Насколько охотно логово шлёт набеги. Растёт вместе с силой: непотревоженное
 * логово под боком становится слышно, и это единственная цена бездействия,
 * которая у игрока есть.
 */
export const lairRaidWeight = (base: number, rec: LairRec, now: number): number =>
  base * (1 + (LAIR_RAID_WEIGHT_RIPE - 1) * lairRipeness(rec, now));
