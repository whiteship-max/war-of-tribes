// Срок словами — для строк, которые собирает сама симуляция: тревоги, отказы, подсказки событий,
// летопись. Интерфейс берёт те же слова через свой модуль сроков (`ui/parts/wait.ts`), и формула у
// них одна — эта.
//
// Правило (решение владельца, docs/time.md, раздел 16): **там, где игрок ждёт, игра говорит
// настоящим временем — сколько ждать на самом деле.** Игровые дни остаются там, где речь о мире:
// возраст, дата, летопись, срок как свойство механики, — и тогда единица названа («игр. дн.»), а
// не оставлена голым «дн.»: после поворота шкалы «3 дн.» — это полтора часа, а прочёл бы игрок
// «трое суток». Нужно и то и другое — показаны оба (`daysBoth`), одно другим молча не подменяется.
import { DAY_LENGTH, realSeconds } from './pace';

/** Настоящие секунды словами: «40 с», «2 мин 30 с», «1 ч 5 мин», «6 ч», «4 сут 4 ч». */
export function realSpan(realSec: number): string {
  const total = Math.max(0, Math.round(realSec));
  const s = total % 60;
  const m = Math.floor((total % 3600) / 60);
  if (total < 60) return `${s} с`;
  if (total < 3600) return s > 0 ? `${m} мин ${s} с` : `${m} мин`;
  if (total < 48 * 3600) {
    const h = Math.floor(total / 3600);
    return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
  }
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3600);
  return h > 0 ? `${d} сут ${h} ч` : `${d} сут`;
}

/** Срок в игровых секундах — настоящим временем: сколько игрок прождёт. */
export const gameSpan = (gameSec: number): string => realSpan(realSeconds(Math.max(0, gameSec)));

/** Срок в игровых днях — настоящим временем: сколько игрок прождёт. */
export const daysSpan = (gameDays: number): string => gameSpan(gameDays * DAY_LENGTH);

/** Игровые дни как свойство мира, с названной единицей: «3 игр. дн.». */
export const gameDaysText = (gameDays: number | string): string => `${gameDays} игр. дн.`;

/** И то и другое: «3 игр. дн. — 1 ч 30 мин». Срок как свойство механики, которого игрок ещё и ждёт. */
export const daysBoth = (gameDays: number): string => `${gameDaysText(gameDays)} — ${daysSpan(gameDays)}`;
