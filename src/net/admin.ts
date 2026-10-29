/**
 * Записка админки в игре (docs/admin.md): заморожен ли аккаунт и указы админа, приехавшие с ответом сохранения.
 *
 * Указ применяет партия одной дверью (`game/sim/admin.applyGrants`) — сюда его только приносят. Как и синхронизация,
 * модуль про игру не знает: применение ему отдают снаружи (`provideGrants`), иначе импорты замкнулись бы в кольцо
 * (стор игры зовёт синхронизацию, синхронизация — сюда).
 */
import { create } from 'zustand';
import { readAdminNote, type AdminGrant } from '../../netlify/lib/contract';
import { roamOn, setRoamOpen } from '@/game/roamflag';

export interface AdminStore {
  /** Аккаунт заморожен: игру видно, ходить нельзя — плашка (`ui/parts/Frozen.tsx`). */
  frozen: boolean;
  /**
   * Путь меча открыт этому игроку (`roamflag.roamOn`: выпущен всем или сервер назвал игрока админом). Поле — для перерисовки
   * стартового экрана, когда слово сервера пришло; правило — одно, в `roamflag`.
   */
  roam: boolean;
}

/**
 * Слово сервера «этот игрок — админ» на устройстве (30.10.2026): партия бродяги читается раньше первого ответа сервера
 * (`save.deserialize` за выключателем), и без памяти она прочлась бы лордом и легла бы на сервер лордом. Память только открывает
 * путь на этом устройстве — приказы отряда сервер проверяет сам (`routes/castles`).
 */
const ADMIN_KEY = 'tribe.admin.v1';

function readDeviceAdmin(): boolean {
  try {
    return localStorage.getItem(ADMIN_KEY) === '1';
  } catch {
    return false;
  }
}

function keepDeviceAdmin(admin: boolean): void {
  try {
    if (admin) localStorage.setItem(ADMIN_KEY, '1');
    else localStorage.removeItem(ADMIN_KEY);
  } catch {
    /* хранилища может не быть — тогда память только на эту сессию */
  }
}

// Раньше чтения партии: модуль импортирует синхронизация, а её — стор игры, задолго до `loadGame`.
setRoamOpen(readDeviceAdmin());

export const useAdmin = create<AdminStore>(() => ({ frozen: false, roam: roamOn() }));

let apply: ((grants: AdminGrant[]) => void) | null = null;

/** Чем применять указы — отдаёт стор игры. */
export const provideGrants = (fn: (grants: AdminGrant[]) => void): void => {
  apply = fn;
};

/**
 * Записка из ответа сервера. Нет её вовсе — сервер до админки, и ничего не меняется. Указы уходят в партию все:
 * лишние (уже применённые) дверь отсеет номером.
 */
export function takeNote(raw: unknown): void {
  if (raw === undefined || raw === null) return;
  const note = readAdminNote(raw);
  if (useAdmin.getState().frozen !== note.frozen) useAdmin.setState({ frozen: note.frozen });
  // Записка есть, а слова «админ» в ней нет — игрок не админ (или перестал им быть): память стирается.
  const admin = note.admin === true;
  if (admin !== readDeviceAdmin()) keepDeviceAdmin(admin);
  setRoamOpen(admin);
  if (useAdmin.getState().roam !== roamOn()) useAdmin.setState({ roam: roamOn() });
  if (note.grants.length && apply) apply(note.grants);
}
