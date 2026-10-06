/**
 * Записка админки в игре (docs/admin.md): заморожен ли аккаунт и указы админа, приехавшие с ответом сохранения.
 *
 * Указ применяет партия одной дверью (`game/sim/admin.applyGrants`) — сюда его только приносят. Как и синхронизация,
 * модуль про игру не знает: применение ему отдают снаружи (`provideGrants`), иначе импорты замкнулись бы в кольцо
 * (стор игры зовёт синхронизацию, синхронизация — сюда).
 */
import { create } from 'zustand';
import { readAdminNote, type AdminGrant } from '../../netlify/lib/contract';

export interface AdminStore {
  /** Аккаунт заморожен: игру видно, ходить нельзя — плашка (`ui/parts/Frozen.tsx`). */
  frozen: boolean;
}

export const useAdmin = create<AdminStore>(() => ({ frozen: false }));

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
  if (note.grants.length && apply) apply(note.grants);
}
