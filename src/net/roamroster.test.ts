// Реестр со стороны игры в фазе бродяги (ПН-3, docs/gdd/path_of_sword.md, 3.5.6): отряд встаёт строкой отряда, а не замка;
// **мир бродяги не строится, пока сервер не назвал клетку** — ожидание кончается только строкой отряда; строку сервера партия
// берёт через сток (`provideBandSink`). Путь включён подменой модуля; выключенный реестр — прежний (`roster.test.ts`).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BandRow, RosterResponse } from '../../netlify/lib/contract';

const H = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock('@/telegram/webapp', () => ({ tgInitData: () => 'подпись' }));
vi.mock('./api', () => ({ apiGet: H.apiGet, apiPut: H.apiPut, apiPost: H.apiPost }));
vi.mock('@/game/roamflag', () => ({ ROAM_ON: true }));

const shelf = new Map<string, string>();
const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (why: string) => ({ ok: false as const, why, body: null });

const ROW: BandRow = {
  way: { from: { x: 765, y: 1340 }, to: { x: 765, y: 1340 }, at: 1, until: 1 },
  energy: { value: 100, at: 1, mode: 'hold' },
  born: 1,
  name: 'Ратко',
  prestige: 5,
  men: 6,
  seenAt: 1,
};
const answer = (band?: BandRow): RosterResponse => ({ now: 1, epoch: 1, mine: null, castles: [], ...(band ? { band } : {}) });

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  shelf.clear();
  H.apiGet.mockReset();
  H.apiPut.mockReset();
  H.apiPost.mockReset();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => shelf.get(k) ?? null,
      setItem: (k: string, v: string) => void shelf.set(k, v),
      removeItem: (k: string) => void shelf.delete(k),
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('отряд бродяги в реестре со стороны игры', () => {
  it('встаёт строкой отряда, строки замка не шлёт; строка сервера уходит в партию', async () => {
    H.apiPost.mockResolvedValue(ok(answer(ROW)));
    const r = await import('./roster');
    const sunk: BandRow[] = [];
    r.provideClaim(() => ({ name: 'Вождь', city: '', power: 1, pop: 1 }));
    r.provideBand(() => ({ op: 'seat', name: 'Ратко', prestige: 5, men: 6 }));
    r.provideBandSink((row) => sunk.push(row));
    await r.rosterBoot();
    expect(H.apiPut, 'строки замка нет').not.toHaveBeenCalled();
    expect(H.apiPost).toHaveBeenCalledWith('/api/castles', { op: 'seat', name: 'Ратко', prestige: 5, men: 6 });
    expect(sunk).toEqual([ROW]);
    expect(r.bandRow()).toEqual(ROW);
    expect(r.castleCell()).toBeNull();
    await r.rosterReady();
  });

  it('сервер не назвал клетку — мир ждёт и повторяет, а не ставит отряд сам', async () => {
    // Четыре отказа подряд: повторы через 2, 4, 8 с — к сроку ожидания без разговора (`ROSTER_WAIT_MS`) клетки всё ещё нет.
    H.apiPost
      .mockResolvedValueOnce(fail('server'))
      .mockResolvedValueOnce(fail('offline'))
      .mockResolvedValueOnce(fail('server'))
      .mockResolvedValueOnce(fail('offline'))
      .mockResolvedValue(ok(answer(ROW)));
    const r = await import('./roster');
    r.provideClaim(() => ({ name: 'Вождь', city: '', power: 1, pop: 1 }));
    r.provideBand(() => ({ op: 'seat', name: 'Ратко', prestige: 5, men: 6 }));
    let ready = false;
    void r.rosterReady().then(() => {
      ready = true;
    });
    await r.rosterBoot();
    // Граница: срок ожидания без разговора давно прошёл бы — в Telegram он не действует.
    await vi.advanceTimersByTimeAsync(r.ROSTER_WAIT_MS + 1000);
    expect(r.bandRow()).toBeNull();
    expect(ready, 'мир не строится без клетки').toBe(false);
    expect(H.apiPost.mock.calls.length).toBeGreaterThanOrEqual(3);
    await vi.advanceTimersByTimeAsync(r.SEAT_RETRY_MAX_MS * 3);
    expect(r.bandRow()).toEqual(ROW);
    expect(ready).toBe(true);
  });

  it('приказ отряда: отказ сервера — его словами; принят — строка', async () => {
    const r = await import('./roster');
    H.apiPost.mockResolvedValueOnce(ok({ ...answer(ROW), error: 'Туда не пройти: там вода. Идут в клетку суши.' }));
    expect(await r.bandOrder({ op: 'go', to: { x: 1, y: 1 } })).toBe('Туда не пройти: там вода. Идут в клетку суши.');
    H.apiPost.mockResolvedValueOnce(ok(answer(ROW)));
    expect(await r.bandOrder({ op: 'camp', kind: 'open', men: 6 })).toEqual(ROW);
  });
});
