/**
 * Эпоха мира глазами игры (docs/test_world.md): после `/wipeworld ДА` старая партия с телефона не воскресает — ни с
 * диска, ни миром, ни клеткой реестра, ни запросом под новым номером. Облако Telegram — в `telegram/cloud.test.ts`:
 * упоминать его можно только там.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERA_HEADER } from '../../netlify/lib/contract';

const H = vi.hoisted(() => ({ initData: 'подпись' as string | null }));
vi.mock('@/telegram/webapp', () => ({ tgInitData: () => H.initData }));

const disk = new Map<string, string>();

beforeEach(() => {
  vi.resetModules();
  disk.clear();
  H.initData = 'подпись';
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => disk.get(k) ?? null,
      setItem: (k: string, v: string) => void disk.set(k, v),
      removeItem: (k: string) => void disk.delete(k),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('номер эпохи на устройстве', () => {
  it('не слышали ни разу — 0; сервер назвал другую — запомнили, замолчали, перезапуск', async () => {
    const era = await import('./era');
    const restart = vi.fn();
    era.setEraRestart(restart);
    expect(era.knownEra()).toBe(0);
    expect(era.adoptEra(0)).toBe(false);
    expect(era.eraLeaving()).toBe(false);
    expect(era.adoptEra(3)).toBe(true);
    expect(disk.get('tribe.era')).toBe('3');
    expect(era.eraLeaving()).toBe(true);
    expect(restart).toHaveBeenCalledTimes(1);
    // Порча не принимается.
    era.resetEraForTest();
    expect(era.adoptEra(-1)).toBe(false);
    expect(era.adoptEra(Number.NaN)).toBe(false);
  });

  it('номер не записался — перезапуска нет (иначе по кругу), но и запросов больше нет', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota');
        },
        removeItem: () => {},
      },
    });
    const era = await import('./era');
    const restart = vi.fn();
    era.setEraRestart(restart);
    expect(era.adoptEra(2)).toBe(true);
    expect(restart).not.toHaveBeenCalled();
    expect(era.eraLeaving()).toBe(true);
  });
});

describe('дверь запросов', () => {
  it('эпоха уходит заголовком с каждым запросом; 410 — новая эпоха, и больше ни одного запроса', async () => {
    disk.set('tribe.era', '1');
    const seen: Record<string, string>[] = [];
    const fetchMock = vi.fn(async (_path: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return new Response(JSON.stringify({ error: 'era', era: 2, now: 1 }), { status: 410, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    const era = await import('./era');
    const restart = vi.fn();
    era.setEraRestart(restart);
    const api = await import('./api');
    const res = await api.apiPut('/api/save', { baseEtag: null, record: {} });
    expect(res).toMatchObject({ ok: false, why: 'era' });
    expect(seen[0][ERA_HEADER]).toBe('1');
    expect(disk.get('tribe.era')).toBe('2');
    expect(restart).toHaveBeenCalledTimes(1);
    // Пока игра уходит на перезапуск, старая партия не уйдёт и под новым номером: запросов нет вовсе.
    expect(await api.apiPut('/api/save', { baseEtag: null, record: {} })).toMatchObject({ ok: false, why: 'era' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('после чистого старта старая партия с телефона не воскресает', () => {
  it('партия прошлой эпохи на диске не загружается: новая, без окна «старый формат»; своей эпохи — загружается', async () => {
    const { createInitialState } = await import('@/game/state');
    const { saveGame, loadGame } = await import('@/game/save');
    const old = createInitialState();
    old.gold = 4242;
    saveGame(old);
    const fresh = await loadGame({ era: 1 });
    expect(fresh).toMatchObject({ fresh: true, legacy: false });
    expect(fresh.state.gold).not.toBe(4242);
    // Граница области: та же строка в своей эпохе читается — отказ выше дала именно эпоха, а не порча.
    const same = await loadGame({ era: 0 });
    expect(same.fresh).toBe(false);
    expect(same.state.gold).toBe(4242);
  });

  it('мир прошлой эпохи не читается: новый мир; своей эпохи — тот же', async () => {
    const { LocalWorld } = await import('@/world/local/LocalWorld');
    let text: string | null = null;
    const storage = { read: () => text, write: (s: string) => void (text = s) };
    const T1 = 1_700_000_000_000;
    const T2 = T1 + 86_400_000;
    const first = new LocalWorld({ seed: 77, now: () => T1, storage, era: 0 });
    await first.readReports();
    expect(text).not.toBeNull();
    const createdOf = (w: unknown): number => (w as { save: { createdAt: number } }).save.createdAt;
    expect(createdOf(new LocalWorld({ seed: 77, now: () => T2, storage, era: 0 }))).toBe(T1);
    expect(createdOf(new LocalWorld({ seed: 77, now: () => T2, storage, era: 1 }))).toBe(T2);
  });

  it('клетка реестра прошлой эпохи не годится: мир ждёт новую от сервера', async () => {
    vi.doMock('./api', () => ({ apiGet: vi.fn(), apiPut: vi.fn() }));
    const cached = JSON.stringify({ at: 1, epoch: 1, mine: { x: 741, y: 1335 }, castles: [] });
    disk.set('tribe.castles.v1', cached);
    expect((await import('./roster')).castleCell()).toEqual({ x: 741, y: 1335 });
    vi.resetModules();
    disk.set('tribe.era', '1');
    expect((await import('./roster')).castleCell()).toBeNull();
    vi.doUnmock('./api');
  });
});
