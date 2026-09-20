// Сроки словами — единственное место интерфейса, которое печатает секунды.
//
// У игры двое часов (`game/pace.ts`): стройка, ковка, учения, найм, караван и ропот идут
// игровыми секундами, поход, предупреждение о набеге и осада — настоящими. Игроку показывают
// всегда настоящие: он ждёт своими часами. Прежде игровые секунды печатались как есть — «~40 с»
// прямо в разметке, в двух десятках мест, — и верно это было ровно пока игровая секунда
// равнялась настоящей. Теперь у срока два входа, и какими часами он идёт, видно по имени
// функции в месте вызова, а не подразумевается.
//
// Держит это тест по исходникам (`game/pace.test.ts`): секунды словом «с» в `src/ui` печатает
// только этот модуль.
import { realSeconds } from '@/game/pace';

/** Срок в ИГРОВЫХ секундах → сколько настоящих секунд игрок прождёт, целым вверх. */
export const waitSeconds = (gameSec: number): number => Math.ceil(realSeconds(Math.max(0, gameSec)));

/** «40 с»: короткий срок, игровые секунды на входе. */
export const waitShort = (gameSec: number): string => `${waitSeconds(gameSec)} с`;

/** Настоящие секунды с долей: «7.5 с» — таймер мини-игры и журналы приборов. */
export const realShort = (realSec: number, digits = 1): string => `${realSec.toFixed(digits)} с`;

/** «2 мин 40 с» из НАСТОЯЩИХ секунд: срок без округления до минут. */
export function realMinSec(realSec: number): string {
  const total = Math.max(0, Math.round(realSec));
  const m = Math.floor(total / 60);
  const r = total % 60;
  if (m === 0) return `${r} с`;
  return r > 0 ? `${m} мин ${r} с` : `${m} мин`;
}

/** «2 мин 40 с» из ИГРОВЫХ секунд. */
export const waitMinSec = (gameSec: number): string => realMinSec(realSeconds(gameSec));

/** Срок стройки в списке: на 375 px «~2 м 10 с» читается, «~130 с» — нет. Игровые секунды на входе. */
export function waitEta(gameSec: number | null): string {
  if (gameSec === null) return 'нет строителей';
  const sec = realSeconds(gameSec);
  if (sec < 60) return `~${Math.ceil(sec)} с`;
  const m = Math.floor(sec / 60);
  const r = Math.round(sec % 60);
  return r > 0 ? `~${m} м ${r} с` : `~${m} м`;
}

/** «2 мин 30 с», а с часа — «1 ч 5 мин»: долгий срок из ИГРОВЫХ секунд. */
export function waitSpan(gameSec: number): string {
  const sec = realSeconds(gameSec);
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m <= 0) return `${s} с`;
  if (m < 60) return s > 0 ? `${m} мин ${s} с` : `${m} мин`;
  return `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

/** Отметка журнала приборов: «+1.5с» от начала записи, настоящие миллисекунды. */
export const sinceMark = (ms: number): string => `+${(ms / 1000).toFixed(1)}с`;

/** «2.5 с»: разница сроков, уже приведённая к настоящим секундам и округлённая вызывающим. */
export const realPlain = (realSec: number): string => `${realSec} с`;
