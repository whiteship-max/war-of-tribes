// Общие помощники вестей: размер посёлка, толпа, склад, мораль и слава словами.
//
// Живут отдельно от таблиц событий нарочно: таблиц две (`data/events.ts` — прежние вести,
// `data/tidings.ts` — сезонные, случайные и цепочки), и считать «сколько это для нашего
// посёлка» им положено одним кодом. Второй копии `amount` рядом быть не должно: две правды о
// размере награды разошлись бы при первой правке.
import type { GameState, ResourceId } from '../types';
import { START_POP } from '../constants';
import { population, storageCap } from '../derived';

/**
 * Всё, что событие даёт или отнимает, умножается на то, во сколько раз нынешнее
 * племя больше стартового (`START_POP` — под него числа событий и писались), —
 * иначе к концу партии награда события тонет в дневной выработке.
 */
export const scale = (s: GameState): number => Math.max(1, population(s) / START_POP);

/** Число под нынешний размер посёлка. */
export const amount = (s: GameState, n: number): number => Math.max(1, Math.round(n * scale(s)));

/**
 * Сколько человек приводит толпа: доля посёлка, но не меньше горстки — иначе в
 * первые минуты партии событие про беженцев не про что.
 */
export const crowd = (s: GameState, share: number, min: number): number =>
  Math.max(min, Math.round(population(s) * share));

/** Положить на склад (или снять) под потолок склада; возвращает, сколько легло на самом деле. */
export const addRes = (s: GameState, r: ResourceId, n: number): number => {
  const cap = storageCap(s);
  const before = s.resources[r];
  s.resources[r] = Math.max(0, Math.min(cap, before + n));
  return Math.round(s.resources[r] - before);
};

/** Сдвинуть мораль на число события: вниз — не ниже нуля, вверх — не выше ста. */
export const moveMorale = (s: GameState, d: number): void => {
  s.morale = d < 0 ? Math.max(0, s.morale + d) : Math.min(100, s.morale + d);
};

/** Сдвинуть славу: ниже нуля она не падает. */
export const moveFame = (s: GameState, d: number): void => {
  s.prestige = Math.max(0, s.prestige + d);
};

/** Знак числа: «+4», «−4» (минус длинный). */
const signed = (d: number): string => `${d > 0 ? '+' : '−'}${Math.abs(d)}`;

/** «мораль −4», «мораль +4»: знак — из самого числа. */
export const moraleWord = (d: number): string => `мораль ${signed(d)}`;

/** То же с прописной — в начале подписи. */
export const MoraleWord = (d: number): string => `М${moraleWord(d).slice(1)}`;

/** «слава +2», «слава −4». */
export const fameWord = (d: number): string => `слава ${signed(d)}`;

/** То же с прописной. */
export const FameWord = (d: number): string => `С${fameWord(d).slice(1)}`;

/** Склонение «N человек / человека». */
export const people = (n: number): string => {
  const t = n % 100;
  const o = n % 10;
  if (t >= 11 && t <= 14) return `${n} человек`;
  if (o === 1) return `${n} человек`;
  if (o >= 2 && o <= 4) return `${n} человека`;
  return `${n} человек`;
};

/** Первая буква прописной — подпись собирается из кусков, а начинаться должна с большой. */
export const cap = (t: string): string => (t ? t[0].toUpperCase() + t.slice(1) : t);
