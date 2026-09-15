// Гибель агента на деле — одно правило на мир, на меню приказа и на карточку.
//
// Шанс дела и гибель — **две разные величины**, и игрок видит их раздельно, двумя
// числами до приказа. Шансом дела владеет Дозор (`spy.spyChance`), гибелью — сам
// агент и обстановка, и **Дозора среди входов этого модуля нет и не будет**: ни
// шанса, ни `keen`, ни стражи. Это тест по исходнику и прогон с Дозором первого и
// десятого уровня (`peril.test.ts`).
//
// Кость у гибели своя: у разведчика — второе число броска прихода, у лазутчика — своё
// зерно, в котором нет шанса дела (`spy.spyDeathRoll`). Потому гибель не зависит от
// того, удалось ли дело: разведчик может пересчитать войско и не вернуться, лазутчик
// может провалиться и уцелеть. Два числа на кнопке — это две независимые вероятности,
// ровно то, что на ней написано.
//
// Из чего гибель складывается:
//
//   гибель = PERIL_BASE × скрытность × цель × час × время года × память × даль
//
// Скрытность — единственное, что в гибели принадлежит агенту, и она главнее любого
// множителя обстановки **по построению**: размах каждого из них — доля размаха
// скрытности (`PERIL_SHARE` < 1), а не своё число. Правка доли, дотянувшая её до
// единицы, ломает тест, сравнивающий вклады замером.
//
// Модуль чистый: ни состояния, ни часов, ни `Math.random`. Время деревни приходит
// числом — мир его не толкует, а переносит из слепка (`PlayerProfile.time`).
import { dayPartAt, seasonOf } from '@/game/derived';
import type { DayPart } from '@/game/data/seasons';
import { MAX_AGENT_LEVEL, STEALTH_PERIL_SPAN } from '@/game/data/agents';
import type { Season } from '@/game/types';
import {
  PERIL_BASE,
  PERIL_FAR,
  PERIL_MAX,
  PERIL_MEMORY,
  PERIL_MEMORY_FULL,
  PERIL_SHARE,
  ROUT_PERIL,
} from './data/tuning';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** Во сколько раз скрытность режет гибель на этом уровне лазутчика. У остальных агентов — 1. */
export function veilAt(level: number): number {
  const extra = Math.max(0, Math.min(MAX_AGENT_LEVEL, Math.floor(level)) - 1);
  return STEALTH_PERIL_SPAN ** (-extra / (MAX_AGENT_LEVEL - 1));
}

/** Из чего складывается гибель на одном деле. */
export interface PerilCase {
  /** Скрытность агента множителем, 0..1: 1 — скрытности нет (все, кроме лазутчика). */
  veil: number;
  /** Спелость цели, 0..1. Замок — 1. */
  ripeness: number;
  /** Игровое время деревни в минуту дела, секунды. Из него — час и время года. */
  villageTime: number;
  /** Сколько раз наши агенты бывали у цели за окно памяти — любым исходом. */
  visits: number;
  /** Клеток от дома до цели. */
  distance: number;
}

export type PerilFactorId = keyof typeof PERIL_SHARE;

export interface PerilFactor {
  id: PerilFactorId;
  /** Во сколько раз этот множитель двигает гибель от середины. */
  mult: number;
  /** Слово для игрока: что именно в обстановке. */
  words: string;
}

/** Положение каждого множителя на его шкале: 0 — самый безопасный случай, 1 — самый опасный. */
const HOUR_AT: Record<DayPart, number> = { night: 0, morning: 0.5, evening: 0.5, day: 1 };
const SEASON_AT: Record<Season, number> = { autumn: 0, spring: 0.5, summer: 0.75, winter: 1 };

const HOUR_WORDS: Record<DayPart, string> = {
  night: 'ночь: темнота прячет',
  morning: 'утро: полусвет',
  evening: 'вечер: полусвет',
  day: 'день: заметнее',
};
const SEASON_WORDS: Record<Season, string> = {
  autumn: 'осень: туманы',
  spring: 'весна',
  summer: 'лето: долгий день',
  winter: 'зима: следы на снегу',
};

/** Множитель от положения на шкале: середина — единица, края — доля размаха скрытности. */
const factor = (id: PerilFactorId, at: number): number => STEALTH_PERIL_SPAN ** (PERIL_SHARE[id] * (clamp01(at) - 0.5));

/** Положение памяти цели: сколько раз наши тут бывали, до полной памяти. */
export const memoryAt = (visits: number): number => clamp01(Math.max(0, visits) / PERIL_MEMORY_FULL);
/** Положение дали. */
export const reachAt = (distance: number): number => clamp01(Math.max(0, distance) / PERIL_FAR);

/** Множители обстановки на этом деле — каждый со своим словом. */
export function perilFactors(c: PerilCase): PerilFactor[] {
  const part = dayPartAt(Math.max(0, c.villageTime));
  const season = seasonOf(Math.max(0, c.villageTime));
  const ripe = clamp01(c.ripeness);
  const visits = Math.max(0, Math.floor(c.visits));
  return [
    {
      id: 'target',
      mult: factor('target', ripe),
      words: ripe >= 0.75 ? 'спелое логово: часовые настороже' : ripe <= 0.25 ? 'свежее логово: стерегут вполглаза' : 'логово в силе',
    },
    { id: 'hour', mult: factor('hour', HOUR_AT[part]), words: HOUR_WORDS[part] },
    { id: 'season', mult: factor('season', SEASON_AT[season]), words: SEASON_WORDS[season] },
    {
      id: 'memory',
      mult: factor('memory', memoryAt(visits)),
      words: visits === 0 ? 'здесь наших ещё не видели' : visits === 1 ? 'здесь наши уже бывали' : 'здесь наши бывали не раз',
    },
    {
      id: 'reach',
      mult: factor('reach', reachAt(c.distance)),
      words: reachAt(c.distance) >= 0.5 ? 'далеко от дома' : 'недалеко от дома',
    },
  ];
}

/** Гибель на одном деле, 0..`PERIL_MAX`. */
export function perilOf(c: PerilCase): number {
  let p = PERIL_BASE * clamp01(c.veil);
  for (const f of perilFactors(c)) p *= f.mult;
  return Math.min(PERIL_MAX, Math.max(0, p));
}

/**
 * Две главные причины словами — по тому, насколько множитель уводит гибель от
 * середины, в любую сторону: игрок должен видеть и то, что ему вредит, и то, что
 * помогает, — и то и другое можно поменять.
 */
export function perilWhy(c: PerilCase, count = 2): string[] {
  return perilFactors(c)
    .filter((f) => Math.abs(Math.log(f.mult)) > 1e-9)
    .sort((a, b) => Math.abs(Math.log(b.mult)) - Math.abs(Math.log(a.mult)))
    .slice(0, count)
    .map((f) => f.words);
}

/** Погиб ли агент: кость гибели легла ниже гибели. Единственное место, где это решается. */
export const diesAt = (roll: number, peril: number): boolean => roll < peril;

/**
 * Какую долю дел агент не переживёт — **замером**, а не пересказом числа: решение
 * `diesAt` прогоняется по всей кости равными шагами. Этим числом говорят меню
 * приказа, карточка и отчёт о гибели.
 */
export function perilShare(peril: number, steps = 10_000): number {
  let n = 0;
  for (let i = 0; i < steps; i++) if (diesAt((i + 0.5) / steps, peril)) n++;
  return n / steps;
}

/**
 * Гибель разбитого полководца — если его дружину перебили до последнего бойца. У
 * ворот `ROUT_PERIL`, дальше от дома больше — тем же множителем дали, что у тайного
 * дела. Ни часа, ни времени года, ни памяти: поле боя не тайное дело.
 */
export const routPeril = (distance: number): number =>
  Math.min(0.9, ROUT_PERIL * STEALTH_PERIL_SPAN ** (PERIL_SHARE.reach * reachAt(distance)));

/**
 * Сколько раз наши бывали у цели и ещё не забыты к минуте `now`. Считаются **заходы**, а
 * не поимки, и это не мелочь: поимок больше у того, у кого слабее Дозор, и память по
 * поимкам протащила бы Дозор в гибель обходом. Заходы — решение игрока, а не здания.
 */
export const recentVisits = (marks: readonly number[] | undefined, now: number): number =>
  (marks ?? []).filter((at) => at <= now && now - at < PERIL_MEMORY).length;

/** Гибель словами: «4,2 %», «меньше 0,1 %», «нет». Одно правило на меню, карточку и отчёт. */
export function perilText(share: number): string {
  if (share <= 0) return 'нет';
  if (share < 0.001) return 'меньше 0,1 %';
  const pct = share * 100;
  return `${pct < 10 ? pct.toFixed(1).replace('.', ',') : Math.round(pct)} %`;
}
