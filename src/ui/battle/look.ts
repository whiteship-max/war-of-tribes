// Какой ролик боя показывать: в стиле Total War (docs/battle_tw.md) или прежний. С 03.10.2026 по умолчанию — новый
// (решение владельца, docs/ui_audit.md, 12.8); прежний — запасной: строка «Ролик боя» в настройках или адрес
// `?battle=old` (`?battle=tw` возвращает новый). Запоминается на устройстве, как вид карты (`tribe.map`): в Телеграме
// адрес с параметром открывают один раз, а смотреть бой хочется и после перезапуска. Это настройка устройства, а не
// партии: в сохранение она не идёт; запись, адрес и приватное окно — общие с интерфейсом и картой (`ui/device.ts`).
//
// Пишут выбор двое: пункт «Ролик боя» (`ui/parts/Settings.tsx`) и адрес на запуске (`bootBattleLook`, `main.tsx`), —
// тест «рычаг один» (`ui/device.test.ts`). Ролик читает выбор один раз на показ (`BattleReplay`).
import { deviceChoice, type DeviceStorage } from '../device';

export type BattleLook = 'tw' | 'old';

export const BATTLE_DEFAULT: BattleLook = 'tw';

/** Строка «Ролик боя» в настройках — порядок кнопок и их слова: умолчание первым. */
export const BATTLE_LOOKS: readonly (readonly [BattleLook, string])[] = [
  ['tw', 'Новый'],
  ['old', 'Прежний'],
];

export const BATTLE_LOOK_KEY = 'tribe.battle';

const choice = deviceChoice<BattleLook>(BATTLE_LOOK_KEY, 'battle', ['tw', 'old'], BATTLE_DEFAULT);

/** Выбор из записи: прежний — только словом `old`; пустая, битая и чужая запись — умолчание. */
export const battleLookOf = choice.of;

/** Что просит адрес: `?battle=tw` или `?battle=old`; другое и пустое — ничего. */
export const askedBattleLook = choice.asked;

/** Подменить хранилище — тестам. */
export const setBattleStorage: (next: DeviceStorage) => void = choice.setStorage;

export const battleLook = choice.get;

export const subscribeBattle = choice.subscribe;

/** Записать выбор — пункт «Ролик боя» и адрес на запуске. */
export function setBattleLook(look: BattleLook): void {
  choice.set(look);
}

/** Адрес на запуске: `?battle=tw` / `?battle=old` пишет выбор, остальное его не трогает. */
export function bootBattleLook(search: string): BattleLook {
  return choice.boot(search);
}
