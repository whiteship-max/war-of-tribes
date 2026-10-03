// Какой ролик боя показывать: прежний (по умолчанию) или в стиле Total War (docs/battle_tw.md). Переключатель —
// адресом `?battle=tw` / `?battle=old`, запоминается на устройстве, как вид карты (`tribe.map`): в Телеграме адрес
// с параметром открывают один раз, а смотреть бой хочется и после перезапуска. Это настройка устройства, а не
// партии: в сохранение она не идёт.
export type BattleLook = 'tw' | 'old';

export const BATTLE_LOOK_KEY = 'tribe.battle';

export function battleLook(): BattleLook {
  try {
    const p = new URLSearchParams(location.search).get('battle');
    if (p === 'tw' || p === 'old') {
      if (p === 'tw') localStorage.setItem(BATTLE_LOOK_KEY, 'tw');
      else localStorage.removeItem(BATTLE_LOOK_KEY);
      return p;
    }
    return localStorage.getItem(BATTLE_LOOK_KEY) === 'tw' ? 'tw' : 'old';
  } catch {
    return 'old';
  }
}
