// Что в почте державы ещё не открывали — для счётчика на гербе и отметки в
// списке.
//
// Это вид, а не партия: в сохранение не едет, на сервер тоже. Лежит в
// localStorage, чтобы перезагрузка не делала прочитанное снова новым, и
// переживает его пропажу: нет хранилища — всё, что ждёт ответа, считается
// непрочитанным, и это не ложь, а осторожность.
//
// Модуль маленький нарочно: его читает герб, а герб едет в первой загрузке.
// Сама почта (`Mail.tsx`, `dispatch.ts`) — в куске меню державы.
import { create } from 'zustand';
import type { ActiveEvent } from '@/game/types';

const KEY = 'tribe.mail.seen';

/** Ключ события в почте: вид и минута прихода — следующее событие того же вида будет новым. */
export const eventKey = (ev: ActiveEvent): string => `event:${ev.defId}:${ev.at}`;
/** Ключ письма в почте. */
export const letterKey = (id: string): string => `letter:${id}`;

/** Ключи всего, что сейчас ждёт ответа. */
export function mailKeys(ev: ActiveEvent | null, letterIds: string[]): string[] {
  return [...letterIds.map(letterKey), ...(ev ? [eventKey(ev)] : [])];
}

function load(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

interface Seen {
  seen: string[];
  /** Отметить открытым. `live` — ключи, что ещё ждут: прочее из памяти уходит. */
  mark: (key: string, live: string[]) => void;
}

export const useSeen = create<Seen>((set, get) => ({
  seen: load(),
  mark: (key, live) => {
    const next = [...new Set([...get().seen.filter((k) => live.includes(k)), key])];
    set({ seen: next });
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Хранилища нет — прочитанное помнится до перезагрузки.
    }
  },
}));

/** Сколько ждущего ещё не открывали. */
export const unreadCount = (keys: string[], seen: string[]): number => keys.filter((k) => !seen.includes(k)).length;
