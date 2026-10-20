// Куда открыть игру по ссылке (ДП-1): кнопка «Открыть игру» под вестью Telegram о предложении соседа несёт
// `?go=deal-<номер>` (`netlify/lib/telegram.appAt`), и игра встаёт на «Вестях» → «Соседи» прямо на этом предложении. Не
// дождались списка с сервера — «Вести» покажут список, а карточка откроется сама, как только предложение придёт: открытое
// помнится ключом (`useRealm.mail`). Предложение уже закрыто — карточка скажет, чем кончилось.
import { useRealm } from './open';
import { dealKey } from './unread';

const GO = /^deal-([\w.-]{1,64})$/;

/** Номер предложения из адреса запуска; нет его — null. */
export function dealFrom(search: string): string | null {
  const go = new URLSearchParams(search).get('go') ?? '';
  return GO.exec(go)?.[1] ?? null;
}

let used = false;

/** Открыть «Вести» на предложении из адреса — один раз за запуск: адрес игра не меняет, а вернуться в город игрок волен. */
export function openFromLink(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  if (used) return false;
  used = true;
  const id = dealFrom(search);
  if (!id) return false;
  useRealm.getState().setMailTab('letter');
  useRealm.getState().openMail(dealKey(id));
  return true;
}
