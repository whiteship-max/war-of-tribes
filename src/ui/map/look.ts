// Вид карты мира: новый, в духе карты кампании (docs/map_tw.md), или прежний. С 03.10.2026 по умолчанию — новый
// (решение владельца, docs/ui_audit.md, 12.8); прежний — запасной: строка «Карта мира» в настройках или адрес
// `?map=old` (`?map=tw` возвращает новый). Выбор запоминается на устройстве — в Телеграме адрес игры не поправишь;
// запись, адрес и приватное окно — общие с интерфейсом и роликом боя (`ui/device.ts`). Сам новый вид едет своим
// куском (`twslot.ts` → `tw/hook.ts`), в первой загрузке от него только этот выбор.
//
// Пишут выбор двое: пункт «Карта мира» (`ui/parts/Settings.tsx`) и адрес на запуске (`bootMapLook`, `main.tsx`), —
// тест «рычаг один» (`ui/device.test.ts`). Карта читает выбор живьём (`twslot.twSlot`): сменили в настройках — следующий
// заход на карту уже в выбранном виде, без перезагрузки (на карте настроек нет — держава под ней не рисуется).
import { deviceChoice, type DeviceStorage } from '../device';

export type MapLook = 'tw' | 'old';

export const MAP_DEFAULT: MapLook = 'tw';

/** Строка «Карта мира» в настройках — порядок кнопок и их слова: умолчание первым. */
export const MAP_LOOKS: readonly (readonly [MapLook, string])[] = [
  ['tw', 'Новая'],
  ['old', 'Прежняя'],
];

export const MAP_KEY = 'tribe.map';

const choice = deviceChoice<MapLook>(MAP_KEY, 'map', ['tw', 'old'], MAP_DEFAULT);

/** Выбор из записи: прежняя — только словом `old`; пустая, битая и чужая запись — умолчание. */
export const mapLookOf = choice.of;

/** Что просит адрес: `?map=tw` или `?map=old`; другое и пустое — ничего. */
export const askedMapLook = choice.asked;

/** Подменить хранилище — тестам. */
export const setMapStorage: (next: DeviceStorage) => void = choice.setStorage;

export const mapLook = choice.get;

export const subscribeMap = choice.subscribe;

/** Записать выбор — пункт «Карта мира» и адрес на запуске. */
export function setMapLook(look: MapLook): void {
  choice.set(look);
}

/** Адрес на запуске: `?map=tw` / `?map=old` пишет выбор, остальное его не трогает. */
export function bootMapLook(search: string): MapLook {
  return choice.boot(search);
}
