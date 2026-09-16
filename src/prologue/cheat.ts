/**
 * Что код делает с поляной.
 *
 * Вторая дверь того же инструмента (правила — `src/cheats.ts`, дверь деревни —
 * `game/sim/cheat.ts`). Общего кода у дверей нет ни строки, и это не упущение:
 * состояния у деревни и поляны разные целиком, а общее между ними — только
 * список кодов и слова, и они лежат в одном месте.
 *
 * МОДУЛЬ ЧИСТЫЙ, И ГРАНИЦА ВРЕМЕНИ ЗДЕСЬ ТА ЖЕ, ЧТО ВЕЗДЕ: «сейчас» приходит
 * числом, часов он не читает. Возвращает он **новую** запись, а не правит
 * старую, — тем же правилом, каким живут `fire.feed` и `body.eat`.
 *
 * ЧТО КОД НЕ ДЕЛАЕТ. Не воскрешает: мёртвому дают «Снова», а не код. Не
 * назначает жену и не называет сына — это два решения игрока, и отнимать их у
 * него значило бы проверять не игру, а свою же подстановку. Дом он ставит, а
 * гостью только зовёт: принять её — по-прежнему нажатие.
 */
import type { CheatId } from '@/cheats';
import { HOUSE_LOGS } from './craft';
import { HEARTH_CAP } from './fire';
import { GUEST_FIRST_MS, LOVE_DAYS } from './kin';
import { QUIVER_MAX } from './craft';
import type { PrologueSave } from './save';

/** Сколько полен в руках даёт код. Три дерева: хватит и очагу, и стройке. */
export const CHEAT_LOGS = 9;

/** Сколько мяса каждого вида. Шесть жареных — полный живот на отлучку (`body.STARVE_H`). */
export const CHEAT_MEAT = 6;

/** Сколько шкур. Одной хватает на одежду, вторая — чтобы было видно счётчик. */
export const CHEAT_HIDES = 2;

/**
 * Применить код к поляне.
 *
 * Возвращает новую запись и строку для игрока. Неизвестный сюда не доходит:
 * узнаёт код `cheatOf`, а этот разбор только исполняет.
 */
export function applyCheat(s: PrologueSave, id: CheatId, now: number): { save: PrologueSave; said: string } {
  if (id === 'glade') {
    return {
      save: {
        ...s,
        cheated: true,
        // Очаг полон, и отсчёт у него с этой минуты — ровно как у подложенных
        // дров. Хозяйская мера переезжает как есть: жена бережёт огонь и после
        // кода, а завести её тут заново значило бы вторую правду о том же.
        hearth: { fuel: HEARTH_CAP, at: now, ...(s.hearth.kept ? { kept: true as const } : {}) },
        axe: true,
        kit: true,
        logs: s.logs + CHEAT_LOGS,
        quiver: QUIVER_MAX,
        meat: { cooked: s.meat.cooked + CHEAT_MEAT, raw: s.meat.raw + CHEAT_MEAT },
        hides: s.hides + CHEAT_HIDES,
      },
      said: `Код: очаг полон, ${CHEAT_LOGS} полен, мяса по ${CHEAT_MEAT}, шкур ${CHEAT_HIDES}, колчан полон.`,
    };
  }
  if (id === 'home') {
    return {
      save: {
        ...s,
        cheated: true,
        house: HOUSE_LOGS,
        // Дом «достроен» ровно столько времени назад, чтобы гостья уже вышла к
        // огню: правило прихода при этом не тронуто — оно считает от этой минуты
        // (`kin.guestAt`), а не получает исключение.
        builtAt: now - GUEST_FIRST_MS,
        // Любовь в записи не хранится — хранятся дни общей жизни, и полными их
        // кладёт код (`kin.love` из них и считает полную, `kin.LOVE_FULL`).
        bond: {
          meal: { n: LOVE_DAYS, day: -1 },
          hug: { n: LOVE_DAYS, day: -1 },
          night: { n: LOVE_DAYS, day: -1 },
          wood: { n: LOVE_DAYS, day: -1 },
        },
      },
      said: 'Код: дом достроен, у огня ждёт гостья, любовь полна. Принять и назвать сына — твоё.',
    };
  }
  return { save: s, said: '' };
}
