// Шанс окна замка с сервера (ПН-Э2г): «считаем» — спросить снова к тому же делу; строки — отдать; отказ — словами; закрытый путь — 403.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult } from './api';
import type { OddsResponse } from '../../netlify/lib/contract';

const answers: ApiResult<OddsResponse>[] = [];
const asked: string[] = [];
vi.mock('./api', () => ({
  apiGet: async (path: string) => {
    asked.push(path);
    return answers.shift() ?? { ok: false, why: 'offline', body: null };
  },
}));
const { ODDS_CLOSED, ODDS_GIVE_UP_MS, ODDS_NO_LINK, freeOddsOf } = await import('./odds');

afterEach(() => {
  answers.length = 0;
  asked.length = 0;
});
const ok = (data: OddsResponse): ApiResult<OddsResponse> => ({ ok: true, data });
const rows = [{ text: 'Штурм с ходу', ok: true }];

describe('шанс окна замка с сервера', () => {
  it('«считаем» — спросить снова, пока не придут строки; спрашивает только ключ замка', async () => {
    answers.push(ok({ now: 1, wait: true }), ok({ now: 2, wait: true }), ok({ now: 3, rows }));
    const waits: number[] = [];
    expect(await freeOddsOf('free:10:-4', async (ms) => void waits.push(ms))).toEqual(rows);
    expect(asked).toEqual(Array(3).fill('/api/odds?castle=free%3A10%3A-4'));
    expect(waits).toHaveLength(2);
  });

  it('отказ сервера — словами; путь закрыт — своей строкой; сети нет — «не ответил»; дольше срока — бросить', async () => {
    answers.push(ok({ now: 1, error: 'Этого замка больше нет.' }));
    expect(await freeOddsOf('free:1:1', async () => {})).toBe('Этого замка больше нет.');
    answers.push({ ok: false, why: 'auth', body: { error: 'closed' } });
    expect(await freeOddsOf('free:1:1', async () => {})).toBe(ODDS_CLOSED);
    expect(await freeOddsOf('free:1:1', async () => {})).toBe(ODDS_NO_LINK);
    let t = 0;
    for (let i = 0; i < 5; i++) answers.push(ok({ now: 1, wait: true }));
    expect(await freeOddsOf('free:1:1', async () => {}, () => (t += ODDS_GIVE_UP_MS / 2))).toBe(ODDS_NO_LINK);
  });
});
