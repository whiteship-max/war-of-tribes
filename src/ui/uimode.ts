/**
 * Интерфейс этого устройства: новый или прежний (docs/ui_audit.md, раздел «Новый интерфейс»). Одна дверь —
 * как у вида карты (`ui/map/look.ts`) и ролика боя (`ui/battle/look.ts`); запись, адрес и приватное окно у трёх
 * общие (`ui/device.ts`).
 *
 * ПО УМОЛЧАНИЮ — НОВЫЙ (решение владельца 03.10.2026, docs/ui_audit.md, 12.8; до него по умолчанию стоял прежний).
 * Прежний — запасной: строка «Интерфейс» в настройках или адрес `?ui=old` (`?ui=new` возвращает новый). Адрес не
 * «сильнее записи», а пишет её: в Телеграме адрес игры не поправишь.
 *
 * Пишут выбор двое: пункт «Интерфейс» (`ui/parts/Settings.tsx`) и адрес на запуске (`bootUiMode`), — тест
 * «рычаг один» (`uimode.test.ts`). Читают все, кто рисует по-разному в двух видах, через `useUiNew`.
 */
import { useSyncExternalStore } from 'react';
import { deviceChoice, type DeviceStorage } from './device';

export type UiMode = 'old' | 'new';

export const UI_DEFAULT: UiMode = 'new';

/** Строка «Интерфейс» в настройках — порядок кнопок и их слова: умолчание первым. */
export const UI_MODES: readonly (readonly [UiMode, string])[] = [
  ['new', 'Новый'],
  ['old', 'Прежний'],
];

export const UI_KEY = 'tribe.ui';

const choice = deviceChoice<UiMode>(UI_KEY, 'ui', ['old', 'new'], UI_DEFAULT);

export type UiStorage = DeviceStorage;

/** Выбор из записи: прежний — только словом `old`; пустая, битая и чужая запись — умолчание. */
export const uiModeOf = choice.of;

/** Что просит адрес: `?ui=new` или `?ui=old`; другое и пустое — ничего. */
export const askedUiMode = choice.asked;

/** Подменить хранилище — тестам. */
export const setUiStorage = choice.setStorage;

export const uiMode = choice.get;

export const subscribeUi = choice.subscribe;

/** Записать выбор — пункт «Интерфейс» и адрес на запуске. */
export function setUiMode(mode: UiMode): void {
  choice.set(mode);
}

/** Адрес на запуске: `?ui=new` / `?ui=old` пишет выбор, остальное его не трогает. */
export function bootUiMode(search: string): UiMode {
  return choice.boot(search);
}

/** Новый ли интерфейс сейчас — для компонентов; переключение в настройках перерисовывает сразу. */
export function useUiNew(): boolean {
  return useSyncExternalStore(subscribeUi, uiMode, uiMode) === 'new';
}
