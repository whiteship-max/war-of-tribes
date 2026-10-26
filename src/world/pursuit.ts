// Перехват в поле: где и когда две фигуры встретятся.
//
// Модуль чистый и без состояния. Всё держится на одном свойстве мира: **отряд
// идёт по прямой с постоянной скоростью**, и положение его выведено из времени
// выхода и времени прибытия. Значит, точка встречи решается уравнением в момент
// отдачи приказа — один раз, — а не нащупывается шагами по таймеру.
//
// Отсюда же и то, чего здесь нет: фоновой работы. Погоня не «идёт» — она уже
// вычислена, и всё, что осталось, это дождаться отметки времени. Смена курса
// цели — новое событие выхода, после которого встреча считается заново тем же
// уравнением.
import type { Coord } from './types';

/** Всё, что нужно знать о движущемся: откуда, куда и в каких пределах времени. */
export interface Moving {
  from: Coord;
  to: Coord;
  departAt: number;
  arriveAt: number;
}

const sub = (a: Coord, b: Coord): Coord => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Coord, b: Coord): number => a.x * b.x + a.y * b.y;
const len = (a: Coord): number => Math.hypot(a.x, a.y);

/** Где движущийся находится в момент t. До выхода — в начале, после прихода — в конце. */
export function positionAt(m: Moving, t: number): Coord {
  const span = m.arriveAt - m.departAt;
  if (span <= 0) return { ...m.to };
  const k = Math.min(1, Math.max(0, (t - m.departAt) / span));
  return { x: m.from.x + (m.to.x - m.from.x) * k, y: m.from.y + (m.to.y - m.from.y) * k };
}

/** Скорость в клетках за миллисекунду. Ноль — стоит. */
export function speedOf(m: Moving): number {
  const span = m.arriveAt - m.departAt;
  if (span <= 0) return 0;
  return len(sub(m.to, m.from)) / span;
}

export interface Meeting {
  /** Где встретятся. */
  at: Coord;
  /** Когда, мс. */
  time: number;
  /** Сколько идти до встречи, секунд. */
  seconds: number;
}

/**
 * Точка и время встречи. Чистая функция от положений, скоростей и времён; ни
 * состояния мира, ни часов устройства.
 *
 * Решается уравнением |A + v·τ − C| = s·τ: квадратное относительно τ, берём
 * меньший неотрицательный корень. Возвращает null, если догнать нельзя — либо
 * не хватает скорости, либо цель успевает дойти раньше встречи. Второе важнее
 * первого: приказ, который молча превратится во что-то другое, — хуже отказа.
 */
export function intercept(chaser: Coord, speed: number, target: Moving, now: number): Meeting | null {
  if (speed <= 0) return null;
  const here = positionAt(target, now);
  // Уже рядом — встреча в этой же точке и сейчас.
  if (len(sub(here, chaser)) < 1e-9) return { at: { ...here }, time: now, seconds: 0 };
  // Цель ещё не вышла и стоит у `from` (MAP-6): успевает погоня туда к выходу — встреча там, в минуту её прихода.
  const lead = Math.max(0, target.departAt - now);
  if (lead > 0) {
    const tau = len(sub(here, chaser)) / speed;
    if (tau <= lead) return { at: { ...here }, time: now + tau, seconds: tau / 1000 };
  }
  const span = target.arriveAt - target.departAt;
  const v: Coord =
    span > 0 && now < target.arriveAt
      ? { x: (target.to.x - target.from.x) / span, y: (target.to.y - target.from.y) / span }
      : { x: 0, y: 0 };
  // Не успевает — встреча после выхода: уравнение решается от виртуального старта `from − v·lead`, откуда цель, идущая с
  // этой минуты, выходит к `from` ровно в минуту выхода; корень раньше выхода — не встреча (цель ещё стоит).
  const a: Coord = { x: here.x - v.x * lead, y: here.y - v.y * lead };
  const d = sub(a, chaser);

  const qa = dot(v, v) - speed * speed;
  const qb = 2 * dot(d, v);
  const qc = dot(d, d);

  let tau: number | null = null;
  if (Math.abs(qa) < 1e-12) {
    // Скорости совпали: уравнение стало линейным. Догнать можно только сзади.
    if (Math.abs(qb) > 1e-12) {
      const t = -qc / qb;
      if (t >= lead) tau = t;
    }
  } else {
    const disc = qb * qb - 4 * qa * qc;
    if (disc >= 0) {
      const root = Math.sqrt(disc);
      const t1 = (-qb - root) / (2 * qa);
      const t2 = (-qb + root) / (2 * qa);
      const good = [t1, t2].filter((t) => t >= lead).sort((x, y) => x - y);
      if (good.length > 0) tau = good[0];
    }
  }
  if (tau === null || !Number.isFinite(tau)) return null;

  const time = now + tau;
  // Цель успевает дойти раньше встречи — значит, перехвата нет. Что делать
  // дальше, решает игрок: бить по её дому или разворачиваться.
  if (time > target.arriveAt) return null;

  const at = positionAt(target, time);
  return { at, time, seconds: tau / 1000 };
}
