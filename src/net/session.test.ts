import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Две вкладки одной игры. Хранилище здесь настоящее по поведению — обычная
 * карта строк, — а вот вкладок в тесте две, и каждая со своим модулем: признак
 * вкладки живёт в памяти модуля, поэтому вторую вкладку изображает второй его
 * экземпляр (`vi.resetModules`). Иначе «другая вкладка» была бы той же самой, и
 * тест доказывал бы обратное тому, ради чего написан.
 */
const shelf = new Map<string, string>();

function fakeStorage(): void {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => shelf.get(k) ?? null,
      setItem: (k: string, v: string) => void shelf.set(k, v),
      removeItem: (k: string) => void shelf.delete(k),
    },
  });
}

type Session = typeof import('./session');

const openTab = async (): Promise<Session> => {
  vi.resetModules();
  return import('./session');
};

beforeEach(() => {
  shelf.clear();
  fakeStorage();
});

describe('устройство', () => {
  it('признак заводится один раз и переживает перезапуск', async () => {
    const first = (await openTab()).device();
    expect(first).toMatch(/^d-/);
    // Перезапуск игры — новый экземпляр модуля, то же хранилище.
    expect((await openTab()).device()).toBe(first);
  });
});

describe('ведение партии между вкладками', () => {
  it('свободное ведение забирает та вкладка, что открылась', async () => {
    const a = await openTab();
    expect(a.leaseHolder()).toBe('free');
    a.claimLease();
    expect(a.leaseHolder()).toBe('mine');
  });

  it('вторая вкладка видит, что ведёт не она', async () => {
    const a = await openTab();
    a.claimLease();
    const b = await openTab();
    expect(b.leaseHolder()).toBe('other');
  });

  /**
   * Ради этого всё и заведено: вторая вкладка не подновляет чужую отметку
   * молча. Перехват бывает только по решению игрока — `claimLease`, и зовёт
   * его кнопка в окне, а не таймер.
   */
  it('вторая вкладка не перехватывает ведение сама', async () => {
    const a = await openTab();
    a.claimLease();
    const b = await openTab();
    expect(b.beatLease()).toBe(false);
    expect(b.leaseHolder()).toBe('other');
    // А по решению игрока — перехватывает, и тогда первая узнаёт об этом сама.
    b.claimLease();
    expect(b.leaseHolder()).toBe('mine');
    expect(a.beatLease()).toBe(false);
  });

  it('брошенное ведение подбирается: вкладку закрыли, а отметка осталась', async () => {
    const a = await openTab();
    a.claimLease();
    const raw = JSON.parse(shelf.get('tribe.tab.v1')!) as { tab: string; at: number };
    shelf.set('tribe.tab.v1', JSON.stringify({ ...raw, at: raw.at - a.LEASE_STALE_MS - 1 }));
    const b = await openTab();
    expect(b.leaseHolder()).toBe('free');
    expect(b.beatLease()).toBe(true);
  });

  it('вкладка, отпустившая ведение на выходе, освобождает его', async () => {
    const a = await openTab();
    a.claimLease();
    a.dropLease();
    const b = await openTab();
    expect(b.leaseHolder()).toBe('free');
  });

  it('чужое ведение отпустить нельзя', async () => {
    const a = await openTab();
    a.claimLease();
    const b = await openTab();
    b.dropLease();
    expect(b.leaseHolder()).toBe('other');
  });

  it('порченая отметка читается как свободно, а не как исключение', async () => {
    shelf.set('tribe.tab.v1', '{не json');
    const a = await openTab();
    expect(a.leaseHolder()).toBe('free');
  });
});
