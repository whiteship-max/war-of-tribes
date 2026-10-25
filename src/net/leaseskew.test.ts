// Ведение партии меряется часами устройства, а не сервера (OPS-2, docs/audit/WORKPLAN.md; архив round2/prove-10-1). Отметку
// ведения (`tribe.tab.v1`) пишут и читают вкладки одного устройства, а поправку к часам сервера каждая вкладка узнаёт сама
// и в своё время: вкладка, сверившая часы, читала свежую отметку соседки, ещё не сверившей, как давнюю — и забирала
// ведение у живой вкладки; две вкладки писали партию разом.
import { afterEach, describe, expect, it, vi } from 'vitest';

const shelf = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => shelf.get(k) ?? null,
    setItem: (k: string, v: string) => void shelf.set(k, v),
    removeItem: (k: string) => void shelf.delete(k),
  },
});

afterEach(() => {
  shelf.clear();
  vi.resetModules();
});

describe('отметка ведения — часами устройства (OPS-2)', () => {
  it('соседка подновила отметку только что, а эта вкладка сверила часы с сервером — ведение не перехватывается', async () => {
    const s = await import('./session');
    const c = await import('./clock');
    // Соседка, ещё без поправки, подновила отметку сейчас — тем же видом, что пишет `claimLease`.
    shelf.set('tribe.tab.v1', JSON.stringify({ tab: 't-other', at: c.deviceNow() }));
    // Эта вкладка узнала: часы устройства отстают от сервера на 20 с (больше срока давности отметки).
    c.setServerTime(c.deviceNow() + 20_000);
    expect(s.leaseHolder()).toBe('other');
    expect(s.beatLease()).toBe(false);
  });

  it('отметка, правда давняя по часам устройства, — свободна', async () => {
    const s = await import('./session');
    const c = await import('./clock');
    shelf.set('tribe.tab.v1', JSON.stringify({ tab: 't-other', at: c.deviceNow() - 10 * 60_000 }));
    expect(s.leaseHolder()).toBe('free');
  });
});
