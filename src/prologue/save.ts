/**
 * Что предыстория помнит между заходами.
 *
 * СВОЙ КЛЮЧ, А НЕ СОХРАНЕНИЕ ПАРТИИ, И ЭТО РЕШЕНИЕ, А НЕ УДОБСТВО.
 *
 * Сохранение племени (`game/save.ts`) уезжает на сервер одной строкой, и всё,
 * что в него положено, становится общим на все устройства и получает версию,
 * миграции и цену ошибки в потерянных партиях. Предыстории там делать нечего
 * по трём причинам сразу:
 *
 *   - её состояние не имеет отношения к деревне и в неё не переходит — связи с
 *     основной игрой в этом куске нет вовсе и заводить её нельзя;
 *   - на сервер она не едет: так поставлена задача;
 *   - `SAVE_VERSION` поднимать под неё было бы неправдой — формат партии не
 *     менялся, и старые сохранения приводить не к чему.
 *
 * Поэтому здесь отдельный ключ и отдельная маленькая версия — тем же способом,
 * каким рядом живут переключатель музыки и сохранение мира. Не прочиталось,
 * не то, из будущей версии — начинаем сначала: терять тут нечего, а падать в
 * чёрный экран из-за строки в localStorage нельзя.
 *
 * ВРЕМЯ ЗДЕСЬ ОДНО И ТОЛЬКО НАШЕ. Все отметки — `serverNow()` из
 * `net/clock.ts`, единственной двери к «сейчас». Записывается не «сколько
 * осталось», а «сколько было и когда»: остальное считается на чтении
 * (`fire.ts`, `glade.ts`), и потому запись может случиться в любую минуту или
 * не случиться вовсе.
 */
import { serverNow } from '@/net/clock';
import { newHearth, type Hearth } from './fire';
import { TREES } from './glade';

const KEY = 'tribe.prologue.v1';

/** Версия формата. Своя, маленькая, к `SAVE_VERSION` партии отношения не имеет. */
export const PROLOGUE_VERSION = 1;

export interface PrologueSave {
  v: number;
  hearth: Hearth;
  /** Полен в руках. */
  logs: number;
  /** Взят ли топор с пня. */
  axe: boolean;
  /**
   * Когда свалено дерево — по одному числу на дерево, 0 у нетронутого.
   * Стоит оно сейчас или уже отросло, считает `glade.standing`.
   */
  felled: number[];
}

/** Новая предыстория: костёр початый, топор на пне, лес цел. */
export function freshPrologue(now = serverNow()): PrologueSave {
  return { v: PROLOGUE_VERSION, hearth: newHearth(now), logs: 0, axe: false, felled: TREES.map(() => 0) };
}

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/**
 * Прочитать сохранение.
 *
 * Всё, что не сошлось, молча заменяется свежим: чужая версия, битая строка,
 * localStorage под запретом (приватное окно и вебвью такое умеют). Спрашивать
 * игрока тут не о чем — режим временный и прогресса в нём на три минуты.
 */
export function loadPrologue(now = serverNow()): PrologueSave {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshPrologue(now);
    const p = JSON.parse(raw) as Partial<PrologueSave>;
    if (p?.v !== PROLOGUE_VERSION) return freshPrologue(now);
    const fresh = freshPrologue(now);
    return {
      v: PROLOGUE_VERSION,
      hearth: {
        fuel: num(p.hearth?.fuel, fresh.hearth.fuel),
        at: num(p.hearth?.at, now),
      },
      logs: Math.max(0, Math.floor(num(p.logs, 0))),
      axe: p.axe === true,
      // Длина списка идёт от нынешней поляны, а не от записи: деревьев могло
      // стать больше, и лишние обязаны оказаться стоящими, а не undefined.
      felled: TREES.map((_, i) => num(p.felled?.[i], 0)),
    };
  } catch {
    return freshPrologue(now);
  }
}

/** Записать. Неудача записи — не повод падать: в приватном окне её и не бывает. */
export function savePrologue(s: PrologueSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* некуда писать — значит, играем эту сессию и всё */
  }
}

/** Начать предысторию заново — служебное, для проверки с телефона. */
export function resetPrologue(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* нечего убирать */
  }
}
