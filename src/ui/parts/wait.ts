// Сроки словами — единственное место интерфейса, которое печатает секунды, минуты и часы.
//
// У игры двое часов (`game/pace.ts`): стройка, ковка, учения, найм, изучение округи и ропот идут
// игровыми секундами, поход, предупреждение о набеге, осада и почта — настоящими. Игроку показывают
// всегда настоящие: он ждёт своими часами. Прежде игровые секунды печатались как есть — «~40 с»
// прямо в разметке, в двух десятках мест, — и верно это было ровно пока игровая секунда равнялась
// настоящей.
//
// Какими часами идёт срок, теперь видно дважды:
//  · по имени функции: `wait…` берёт игровые секунды, `real…` — настоящие;
//  · **по типу**: `wait…` принимает только `GameSec` (срок, который назвали игровым — `asGame` или
//    функция симуляции), а `real…` и `world/geo.formatLeft` помеченное игровым не принимают. Срок,
//    напечатанный не теми часами, — ошибка компиляции (`wait.test.ts` держит это строками
//    `@ts-expect-error`: пропади метка — упадёт `npm run typecheck`).
//
// Держит первое тест по исходникам (`game/pace.test.ts`): единицу времени после числа в `src/ui`
// печатает только этот модуль, и `formatLeft` мира интерфейс берёт только отсюда.
import { realSeconds, type GameSec, type RealSecArg } from '@/game/pace';
import { daysBoth, daysSpan, gameDaysText, gameSpan, realSpan } from '@/game/span';
import { formatLeft } from '@/world/geo';

// ---------- срок племени: игровые секунды на входе ----------

/** Сколько настоящих секунд игрок прождёт срок племени, целым вверх. */
export const waitSeconds = (gameSec: GameSec): number => Math.ceil(realSeconds(Math.max(0, gameSec)));

/** «40 с». */
export const waitShort = (gameSec: GameSec): string => `${waitSeconds(gameSec)} с`;

/** «2 мин 40 с»: срок без округления до минут. */
export const waitMinSec = (gameSec: GameSec): string => realMinSec(realSeconds(gameSec));

/** «4:07», а с часа — «1:05:00»: тем же видом, каким мир показывает поход. */
export const waitLeft = (gameSec: GameSec): string => formatLeft(realSeconds(gameSec));

/** Срок стройки в списке: на 375 px «~2 м 10 с» читается, «~130 с» — нет. */
export function waitEta(gameSec: GameSec | null): string {
  if (gameSec === null) return 'нет строителей';
  const sec = realSeconds(gameSec);
  if (sec < 60) return `~${Math.ceil(sec)} с`;
  const m = Math.floor(sec / 60);
  const r = Math.round(sec % 60);
  return r > 0 ? `~${m} м ${r} с` : `~${m} м`;
}

/** «2 мин 30 с», с часа — «1 ч 5 мин», с двух суток — «4 сут 4 ч»: долгий срок племени. Формула — `game/span`. */
export const waitSpan = (gameSec: GameSec): string => gameSpan(gameSec);

// ---------- срок в игровых днях ----------
//
// Где игрок ждёт — настоящее время (`waitDays`). Где игровые дни — свойство мира или механики,
// единица названа (`gameDaysText`: «3 игр. дн.»). Нужно и то и другое — оба (`waitDaysBoth`).
// Голого «дн.» в интерфейсе нет: после поворота шкалы его прочли бы сутками (docs/time.md, раздел 16).

/** Срок в игровых днях настоящим временем: «1 ч 30 мин». */
export const waitDays = (gameDays: number): string => daysSpan(gameDays);
/** «3 игр. дн. — 1 ч 30 мин». */
export const waitDaysBoth = (gameDays: number): string => daysBoth(gameDays);
export { gameDaysText };

/** «24 ч», «1 ч 5 мин»: настоящий срок словами, той же формулой. */
export const realSpanText = (realSec: RealSecArg): string => realSpan(realSec);

// ---------- срок мира и устройства: настоящие секунды на входе ----------

/** «4:07» — срок мира. Тот же `formatLeft`, что у мира: интерфейс берёт его только отсюда. */
export const realLeft = (realSec: RealSecArg): string => formatLeft(realSec);

/** «7.5 с»: таймер мини-игры. */
export const realShort = (realSec: RealSecArg, digits = 1): string => `${realSec.toFixed(digits)} с`;

/** «2.5 с»: число уже приведено к настоящим секундам и округлено вызывающим. */
export const realPlain = (realSec: RealSecArg): string => `${realSec} с`;

/** «2 мин 40 с». */
export function realMinSec(realSec: RealSecArg): string {
  const total = Math.max(0, Math.round(realSec));
  const m = Math.floor(total / 60);
  const r = total % 60;
  if (m === 0) return `${r} с`;
  return r > 0 ? `${m} мин ${r} с` : `${m} мин`;
}

/** «5 мин»: целые минуты из настоящих миллисекунд. */
export const realMinutes = (ms: number): string => `${Math.round(ms / 60_000)} мин`;

/** «3 ч 20 мин» или «20 мин»: сколько игрока не было, сколько до смены задания. */
export function realHoursMin(realSec: RealSecArg): string {
  const h = Math.floor(realSec / 3600);
  const m = Math.floor((realSec % 3600) / 60);
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

/** Срок донесения: «3 ч 05 мин», пока больше часа, потом «4:07». */
export function realDue(realSec: RealSecArg): string {
  const t = Math.max(0, Math.ceil(realSec));
  if (t >= 3600) {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    return `${h} ч ${String(m).padStart(2, '0')} мин`;
  }
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

/** Отметка журнала приборов: «+1.5с» от начала записи, настоящие миллисекунды. */
export const sinceMark = (ms: number): string => `+${(ms / 1000).toFixed(1)}с`;
