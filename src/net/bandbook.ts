// Приказы книги отряда (ПН-6, решение ВП4; `netlify/lib/roambook.ts`) — доставка очереди партии (`RoamState.outbox`) серверу. Своим
// модулем куска пути (`game/roamdoor`): дело уже легло в партию, приказ ждёт связи и уходит по порядку, по одному, раньше отметки
// отряда (`net/roster` зовёт `flushBook` перед `seat`), — так отметка не называет людей, которых книга ещё не знает.
//
// Итог приказа: принят — снят из очереди, строка отряда легла в партию (`keepRosterResponse`); отказ сервера — снят, слова игроку
// (честная партия отказа не получает: правила одни); связи нет — приказ ждёт следующей отметки. Вне Telegram и у второй вкладки книги
// на сервере нет — очередь просто снимается.
import { useGame } from '@/game/store';
import { dropBook } from '@/game/sim/bandranks';
import type { RosterResponse } from '../../netlify/lib/contract';
import { apiPost } from './api';
import { keepRosterResponse } from './roster';
import { tgInitData } from '@/telegram/webapp';
import { leaseHolder } from './session';

/** Сервер принимает приказы отряда в Telegram и только у ведущей вкладки — как и строку реестра. */
const online = (): boolean => Boolean(tgInitData()) && leaseHolder() !== 'other';

let flushing: Promise<void> | null = null;

async function run(): Promise<void> {
  for (;;) {
    const o = useGame.getState().s.roam?.outbox?.[0];
    if (!o) return;
    const res = await apiPost<RosterResponse>('/api/castles', o);
    if (!res.ok) return;
    useGame.getState().world((st) => dropBook(st, [o.key]));
    if (res.data.error) useGame.getState().showToast(res.data.error);
    else keepRosterResponse(res.data);
  }
}

/** Отправить очередь книги отряда; идёт уже — тот же проход. */
export function flushBook(): Promise<void> {
  if (!online()) {
    const box = useGame.getState().s.roam?.outbox;
    if (box?.length) useGame.getState().world((st) => dropBook(st, box.map((o) => o.key)));
    return Promise.resolve();
  }
  return (flushing ??= run().finally(() => {
    flushing = null;
  }));
}
