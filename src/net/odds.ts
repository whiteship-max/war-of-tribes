/**
 * Шанс окна вольного замка с сервера (`GET /api/odds?castle=…`, ПН-Э2г; docs/gdd/path_of_sword.md, 23.11). Счёт — на сервере
 * (`netlify/lib/oddsdesk.ts`, той же дверью окна, что автопилот прибора), отсюда уходит только ключ замка: состав отряда, его клетку и
 * престиж сервер берёт из своего реестра. Сервер считает секунды и отвечает «считаем» (`wait`) — окно спрашивает снова, раз в
 * `ODDS_POLL_MS`, и встаёт к тому же делу, а не к новому; ответ из кэша сервера — первым же запросом.
 *
 * Отсюда нельзя выйти исключением (как у всего `net/api`): нет сети, нет подписи, сервер отказал — строка словами, окно её покажет.
 */
import { apiGet } from './api';
import type { OddsResponse } from '../../netlify/lib/contract';

/** Как часто окно переспрашивает «считаем». */
export const ODDS_POLL_MS = 1500;
/** Дольше этого окно не ждёт: сервер считает не дольше своего срока, а дальше — «не посчитан». */
export const ODDS_GIVE_UP_MS = 60_000;

export const ODDS_NO_LINK = 'Шанс у стен не посчитан: сервер не ответил.';
export const ODDS_CLOSED = 'Шанс у стен не посчитан: путь закрыт.';

export interface OddsRow {
  text: string;
  ok: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

/** Строки «Что нужно, чтобы взять» замка `castle` от сервера; отказ — словами. `wait` и `clock` — тест. */
export async function freeOddsOf(castle: string, wait: (ms: number) => Promise<void> = sleep, clock: () => number = () => performance.now()): Promise<OddsRow[] | string> {
  const start = clock();
  for (let first = true; ; first = false) {
    if (!first) await wait(ODDS_POLL_MS);
    const r = await apiGet<OddsResponse>(`/api/odds?castle=${encodeURIComponent(castle)}`);
    if (!r.ok) {
      if (r.why === 'busy' && clock() - start < ODDS_GIVE_UP_MS) continue;
      return r.why === 'auth' && (r.body as { error?: string } | null)?.error === 'closed' ? ODDS_CLOSED : ODDS_NO_LINK;
    }
    if (r.data.rows) return r.data.rows;
    if (r.data.error) return r.data.error;
    if (clock() - start >= ODDS_GIVE_UP_MS) return ODDS_NO_LINK;
  }
}
