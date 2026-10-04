// Мораль армии между боями словами (docs/battle_eu4.md, 14.31) — одна строка на все места показа: карточка
// полководца, меню приказов, окна осады, «Идут на нас». Числа не считаются здесь ни одного: долю и минуту полной
// морали даёт мир одной дверью (`world/rest`, вид `RestView`), срок печатает модуль сроков (`wait.realLeft`).
import { secondsLeft } from '@/world/geo';
import type { RestView } from '@/world/types';
import { realLeft } from './wait';

/** Процент полной морали: вниз, чтобы 99.6 % не читалось полной. */
export const restPercent = (rest: RestView): number => Math.floor(rest.share * 100);

/**
 * Строка о морали армии: «Отряд дрался недавно. Мораль 40 %, полная через 25 мин». `who` — подлежащее с
 * глаголом («Отряд дрался», «Лагерь дрался»). Свежей армии строки нет.
 */
export function restLine(rest: RestView | undefined, who: string, now: number): string | null {
  if (!rest) return null;
  return `${who} недавно. Мораль ${restPercent(rest)} %, полная через ${realLeft(secondsLeft(rest.fullAt, now))}.`;
}

/** Почему уставших лучше не посылать — правило боя, которое ядро уже держит: сектор без морали уходит с поля. */
export const REST_WHY = 'Уставший отряд раньше уходит с поля. Отдых идёт и в пути.';
