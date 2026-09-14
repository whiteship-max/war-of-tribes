import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RosterResponse } from '../../netlify/lib/contract';

/**
 * Дверь к общему реестру замков со стороны игры.
 *
 * Проверяется здесь одно, и оно важнее всего остального: **сервера может не
 * быть, и игра от этого не останавливается**. Не приехал список — карта
 * показывает то, что помнит, и честно называет это старым; нет Telegram —
 * реестра нет вовсе, и об этом сказано словами. Ни одна ветка не бросает
 * наружу и ни одна не ждёт бесконечно.
 *
 * Второе — кто имеет право писать. Вкладка, потерявшая ведение партии, не
 * пишет ни на диск, ни на сервер; в реестр — тоже, иначе она объявляла бы миру
 * своё имя и свою мощь из состояния, которое игрок не выбирал.
 *
 * Замокано ровно две двери: подпись Telegram и сеть. Всё остальное настоящее,
 * включая договор вкладок о ведении партии, — он ходит в то же хранилище.
 */
const H = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(),
  initData: 'подпись' as string | null,
}));

vi.mock('@/telegram/webapp', () => ({ tgInitData: () => H.initData }));
vi.mock('./api', () => ({ apiGet: H.apiGet, apiPut: H.apiPut }));

const shelf = new Map<string, string>();
const KEY = 'tribe.castles.v1';

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (why: string) => ({ ok: false as const, why, body: null });

const answer = (over: Partial<RosterResponse> = {}): RosterResponse => ({
  now: 1_700_000_000_000,
  epoch: 1206907126,
  mine: { x: 900, y: 1000 },
  castles: [
    { id: 'c1', x: 940, y: 1010, name: 'Сосед', power: 3000, pop: 240, seenAt: 1_700_000_000_000 },
  ],
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  shelf.clear();
  H.apiGet.mockReset();
  H.apiPut.mockReset();
  H.initData = 'подпись';
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

/** Свежий запуск игры: новый экземпляр модуля, которому показали, что о себе слать. */
async function tab(): Promise<typeof import('./roster')> {
  const mod = await import('./roster');
  mod.provideClaim(() => ({ name: 'Вождь', city: 'Ольховец', power: 4200, pop: 310 }));
  return mod;
}

describe('замок появляется при первом входе', () => {
  it('первая отправка — это регистрация, и клетку называет сервер', async () => {
    H.apiPut.mockResolvedValue(ok(answer()));
    const r = await tab();
    expect(r.castleCell()).toBeNull();
    await r.rosterBoot();
    expect(H.apiPut).toHaveBeenCalledTimes(1);
    // В теле — имена и два числа о себе и ни одной координаты: место не выбирают.
    const [path, body] = H.apiPut.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/castles');
    expect(Object.keys(body).sort()).toEqual(['city', 'name', 'pop', 'power']);
    expect(r.castleCell()).toEqual({ x: 900, y: 1000 });
  });

  it('клетка переживает перезапуск: её читают с диска, а не ждут ответа', async () => {
    H.apiPut.mockResolvedValue(ok(answer()));
    await (await tab()).rosterBoot();
    expect(shelf.has(KEY)).toBe(true);

    // Следующий запуск игры — сети нет вовсе.
    vi.resetModules();
    H.apiPut.mockResolvedValue(fail('offline'));
    const again = await tab();
    // Клетка известна **до** всякого разговора: мир строится синхронно.
    expect(again.castleCell()).toEqual({ x: 900, y: 1000 });
    expect(again.castles()).toHaveLength(1);
  });
});

describe('сервера нет — игра идёт', () => {
  it('список не приехал: остаётся прежний, и он назван старым', async () => {
    H.apiPut.mockResolvedValue(ok(answer()));
    const r = await tab();
    await r.rosterBoot();
    const at = r.castlesAt() as number;
    expect(r.useRoster.getState().state).toBe('ok');

    H.apiGet.mockResolvedValue(fail('offline'));
    await r.rosterPull();
    // Соседи на месте, отметка времени не сдвинулась, состояние названо.
    expect(r.castles()).toHaveLength(1);
    expect(r.castlesAt()).toBe(at);
    expect(r.useRoster.getState().state).toBe('stale');
    expect(r.useRoster.getState().why).toContain('памяти');
  });

  it('старый список отличается от свежего по возрасту, а не на глаз', async () => {
    H.apiPut.mockResolvedValue(ok(answer()));
    const r = await tab();
    await r.rosterBoot();
    const at = r.castlesAt() as number;
    expect(r.castlesStale(at + 1000)).toBe(false);
    expect(r.castlesStale(at + r.ROSTER_STALE_MS + 1)).toBe(true);
  });

  it('реестра не было ни разу — это тоже «старый», а не «пусто»', async () => {
    const r = await tab();
    expect(r.castlesStale(Date.now())).toBe(true);
    expect(r.castles()).toEqual([]);
    expect(r.castleCell()).toBeNull();
  });

  it('ни одна ветка не бросает наружу', async () => {
    const r = await tab();
    for (const why of ['offline', 'auth', 'busy', 'server', 'conflict']) {
      H.apiPut.mockResolvedValue(fail(why));
      H.apiGet.mockResolvedValue(fail(why));
      await expect(r.rosterBoot()).resolves.toBeUndefined();
      await expect(r.rosterPull()).resolves.toBeUndefined();
    }
  });

  it('вне Telegram реестра нет вовсе, и запроса тоже нет', async () => {
    H.initData = null;
    const r = await tab();
    await r.rosterBoot();
    await r.rosterPull();
    expect(H.apiPut).not.toHaveBeenCalled();
    expect(H.apiGet).not.toHaveBeenCalled();
    expect(r.useRoster.getState().state).toBe('off');
    expect(r.useRoster.getState().why).toContain('Telegram');
  });

  /**
   * Мир строится синхронно и ждать сеть в конструкторе не может. Значит
   * ожидание обязано кончаться **всегда** — и когда сервер ответил, и когда
   * его нет, и когда ведёт другая вкладка.
   */
  it('ожидание клетки кончается по сроку, даже если разговора не было вовсе', async () => {
    // Мир поднимают и стенды, и отчёты, и тесты — там `rosterBoot` никто не
    // зовёт. Бесконечное ожидание означало бы карту, которая не открывается.
    const r = await tab();
    let done = false;
    void r.rosterReady().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(r.ROSTER_WAIT_MS - 100);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
  });

  it('ожидание клетки кончается в любом случае', async () => {
    for (const setup of [
      () => H.apiPut.mockResolvedValue(ok(answer())),
      () => H.apiPut.mockResolvedValue(fail('offline')),
      () => {
        H.initData = null;
      },
    ]) {
      vi.resetModules();
      H.apiPut.mockReset();
      H.initData = 'подпись';
      setup();
      const r = await tab();
      void r.rosterBoot();
      await vi.advanceTimersByTimeAsync(1);
      await expect(r.rosterReady()).resolves.toBeUndefined();
    }
  });
});

describe('пишет только ведущая вкладка', () => {
  it('вкладка без ведения не отправляет ничего', async () => {
    const session = await import('./session');
    // Ведение занято чужой живой вкладкой.
    shelf.set('tribe.tab.v1', JSON.stringify({ tab: 't-чужая', at: Date.now() }));
    expect(session.leaseHolder()).toBe('other');

    H.apiPut.mockResolvedValue(ok(answer()));
    const r = await tab();
    await r.rosterBoot();
    expect(H.apiPut).not.toHaveBeenCalled();
    expect(r.useRoster.getState().state).toBe('off');
  });

  /**
   * Чтение — другое дело: оно ничего не меняет ни у кого, и вторая вкладка
   * имеет полное право показывать карту.
   */
  it('читать список вкладке без ведения никто не мешает', async () => {
    shelf.set('tribe.tab.v1', JSON.stringify({ tab: 't-чужая', at: Date.now() }));
    H.apiGet.mockResolvedValue(ok(answer()));
    const r = await tab();
    await r.rosterPull();
    expect(H.apiGet).toHaveBeenCalledTimes(1);
    expect(r.castles()).toHaveLength(1);
  });
});

describe('частота названа числами', () => {
  it('своё уезжает раз в пять минут, чужое приезжает раз в минуту', async () => {
    const r = await tab();
    expect(r.ROSTER_PUSH_MS).toBe(5 * 60_000);
    expect(r.ROSTER_PULL_MS).toBe(60_000);
    // Пульс мира идёт раз в две секунды — реестр обязан быть заметно реже.
    expect(r.ROSTER_PULL_MS).toBeGreaterThan(2000 * 10);
  });

  it('список читается по своему таймеру, и таймер останавливается', async () => {
    H.apiGet.mockResolvedValue(ok(answer()));
    const r = await tab();
    r.startPulling();
    expect(H.apiGet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(r.ROSTER_PULL_MS + 1);
    expect(H.apiGet).toHaveBeenCalledTimes(2);
    r.stopPulling();
    await vi.advanceTimersByTimeAsync(r.ROSTER_PULL_MS * 3);
    expect(H.apiGet).toHaveBeenCalledTimes(2);
  });

  it('своя строка уезжает по своему таймеру и молчит без ведения', async () => {
    H.apiPut.mockResolvedValue(ok(answer()));
    const r = await tab();
    await r.rosterBoot();
    expect(H.apiPut).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(r.ROSTER_PUSH_MS + 1);
    expect(H.apiPut).toHaveBeenCalledTimes(2);
    // Ведение перехватила другая вкладка — эта замолкает. Чужая вкладка при
    // этом живая: она подновляет отметку, как это делает всякая ведущая. Просто
    // поставить отметку и ждать пять минут нельзя — она за это время протухнет,
    // и ведение честно освободится.
    const step = 5000;
    for (let waited = 0; waited <= r.ROSTER_PUSH_MS; waited += step) {
      shelf.set('tribe.tab.v1', JSON.stringify({ tab: 't-чужая', at: Date.now() }));
      await vi.advanceTimersByTimeAsync(step);
    }
    expect(H.apiPut).toHaveBeenCalledTimes(2);
  });

  /**
   * Обратная сторона того же: брошенная вкладка не запирает реестр навсегда.
   * Отметка старше `LEASE_STALE_MS` считается ничьей, и следующая отправка
   * проходит — иначе закрытая вкладка молча выключала бы игроку общий мир.
   */
  it('брошенная вкладка ведение не держит', async () => {
    H.apiPut.mockResolvedValue(ok(answer()));
    const r = await tab();
    await r.rosterBoot();
    shelf.set('tribe.tab.v1', JSON.stringify({ tab: 't-чужая', at: Date.now() }));
    await vi.advanceTimersByTimeAsync(r.ROSTER_PUSH_MS + 1);
    expect(H.apiPut).toHaveBeenCalledTimes(2);
  });
});
