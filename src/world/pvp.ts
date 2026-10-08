// Война между игроками — общее для клиента и сервера (docs/pvp.md): путь войска и часы голода. Бой
// считает `world/fights` (одна дверь с миром), здесь только время и место.
//
// Модуль чистый и без DOM: его собирает сервер (`netlify/lib/war.ts`).
import type { Coord } from './types';
import { distance, terrainFactor, travelTime } from './geo';
import { FIGURE_BY_ID } from './data/figures';
import { consumptionPerHour, type SiegeWindow } from './siege';
import { realMs } from '../game/pace';
import { HOUR_MS } from '../game/time';

/**
 * Сид земли для пути между замками. Переправы и броды выводятся из сида мира, а сид у каждого игрока свой;
 * путь войны один на обе стороны и на сервер, поэтому и сид у него один. Разница с личной картой — броды:
 * минута-другая пути, а не другая дорога.
 */
export const WAR_GROUND_SEED = 0;

/**
 * Сколько войско полководца идёт от замка до замка, мс мира: та же формула, что у фигуры на карте
 * (`geo.travelTime` со скоростью полководца) — поход между игроками не ходит быстрее или медленнее его.
 */
export const warWalkMs = (from: Coord, to: Coord): number =>
  Math.round(realMs(travelTime(distance(from, to), terrainFactor(WAR_GROUND_SEED, from, to), FIGURE_BY_ID.general.speed)));

/**
 * Сколько лазутчик идёт от замка до замка, мс мира: та же формула и тот же сид земли, что у похода, со скоростью
 * лазутчика (docs/spy_pvp.md). Путь один на обе стороны и на сервер.
 */
export const spyWalkMs = (from: Coord, to: Coord): number =>
  Math.round(realMs(travelTime(distance(from, to), terrainFactor(WAR_GROUND_SEED, from, to), FIGURE_BY_ID.spy.speed)));

/** Где войско на пути из `from` в `to` в минуту `at`. */
export function warAt(from: Coord, to: Coord, departAt: number, arriveAt: number, at: number): Coord {
  const span = Math.max(1, arriveAt - departAt);
  const t = Math.min(1, Math.max(0, (at - departAt) / span));
  return { x: Math.round(from.x + (to.x - from.x) * t), y: Math.round(from.y + (to.y - from.y) * t) };
}

/** Сколько хлеба осталось у осаждённого к минуте `at` — от окна, той же арифметикой, что часы голода. */
export const foodLeft = (w: SiegeWindow, at: number): number =>
  Math.max(0, w.foodAtStart - (consumptionPerHour(w) * Math.max(0, at - w.startedAt)) / HOUR_MS);
