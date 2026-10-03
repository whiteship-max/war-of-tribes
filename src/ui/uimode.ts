/**
 * Интерфейс этого устройства: прежний или новый (docs/ui_audit.md, раздел «Новый интерфейс»). Одна дверь —
 * как у графики (`render/gfx.ts`) и вида карты (`ui/map/look.ts`).
 *
 * ПО УМОЛЧАНИЮ — ПРЕЖНИЙ, пока владелец не одобрит новый (решение владельца 03.10.2026). Новый включают
 * двумя путями: строкой «Интерфейс» в настройках или адресом `?ui=new` (`?ui=old` возвращает прежний).
 * Адрес не «сильнее записи», а пишет её: в Телеграме адрес игры не поправишь, и выбор, сделанный ссылкой
 * на тестовый сайт, обязан пережить перезагрузку так же, как выбор в настройках (так устроен `?map=tw`).
 *
 * ЖИВЁТ В localStorage, А НЕ В СОХРАНЕНИИ: это свойство телефона, а не партии. `SAVE_VERSION` от него не
 * зависит, сервер его не видит, другой телефон начинает с прежнего.
 *
 * Пишут выбор двое: пункт «Интерфейс» (`ui/parts/Settings.tsx`) и адрес на запуске (`bootUiMode`), — тест
 * «рычаг один» (`uimode.test.ts`). Читают все, кто рисует по-разному в двух видах, через `useUiNew`.
 */
import { useSyncExternalStore } from 'react';

export type UiMode = 'old' | 'new';

export const UI_DEFAULT: UiMode = 'old';

/** Строка «Интерфейс» в настройках — порядок кнопок и их слова. */
export const UI_MODES: readonly (readonly [UiMode, string])[] = [
  ['old', 'Прежний'],
  ['new', 'Новый'],
];

export const UI_KEY = 'tribe.ui';

/** Выбор из записи: всё, кроме ровно `new`, — прежний. Битая запись не включает непроверенное. */
export const uiModeOf = (raw: string | null): UiMode => (raw === 'new' ? 'new' : 'old');

/** Что просит адрес: `?ui=new` или `?ui=old`; другое и пустое — ничего. */
export function askedUiMode(search: string): UiMode | null {
  const v = new URLSearchParams(search).get('ui');
  return v === 'new' || v === 'old' ? v : null;
}

export interface UiStorage {
  read(key: string): string | null;
  write(key: string, value: string): void;
}

/** Тихое хранилище: приватное окно или запрет записи — не повод падать. */
const browserStorage: UiStorage = {
  read(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // приватное окно: выбор не переживёт перезагрузку, но этот заход работает
    }
  },
};

let storage: UiStorage = browserStorage;
/** Выбор этого захода: запись может не пережить приватное окно, а заход обязан видеть своё. */
let current: UiMode | null = null;
const listeners = new Set<() => void>();

/** Подменить хранилище — тестам. */
export function setUiStorage(next: UiStorage): void {
  storage = next;
  current = null;
}

export function uiMode(): UiMode {
  if (current === null) current = uiModeOf(storage.read(UI_KEY));
  return current;
}

export function subscribeUi(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Записать выбор — пункт «Интерфейс» и адрес на запуске. */
export function setUiMode(mode: UiMode): void {
  if (mode === uiMode()) return;
  current = mode;
  storage.write(UI_KEY, mode);
  for (const fn of listeners) fn();
}

/** Адрес на запуске: `?ui=new` / `?ui=old` пишет выбор, остальное его не трогает. */
export function bootUiMode(search: string): UiMode {
  const asked = askedUiMode(search);
  if (asked) setUiMode(asked);
  return uiMode();
}

/** Новый ли интерфейс сейчас — для компонентов; переключение в настройках перерисовывает сразу. */
export function useUiNew(): boolean {
  return useSyncExternalStore(subscribeUi, uiMode, uiMode) === 'new';
}
