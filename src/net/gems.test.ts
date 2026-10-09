import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GemEntry } from '../../netlify/lib/contract';

/**
 * Алмазы в игре — только слово сервера (docs/gems.md). Баланс меняет одна записка из ответа (`takeGems`), дела уходят в
 * партию через дверь, отданную стором игры, без связи тратить нельзя, а приказов у игры два — и оба тратят.
 */
let init = '';
vi.mock('@/telegram/webapp', () => ({ tgInitData: () => init }));

const { GEMS_STALE_MS, OFFLINE, OUTSIDE, gemsOffline, gemsQuiet, provideGemDeeds, takeGems, useGems } = await import('./gems');
const { serverNow } = await import('./clock');

afterEach(() => {
  init = '';
  useGems.setState({ balance: null, shop: null, list: [], at: null, why: null, busy: null });
});

const deed = (n: number): GemEntry => ({ n, at: 1, delta: -10, kind: 'buy', res: 'wood', amount: 100 });

describe('записка сервера — единственный источник баланса', () => {
  it('баланс и лавка — из записки; дела уходят в партию; кривая записка ничего не меняет', () => {
    const got: GemEntry[][] = [];
    provideGemDeeds((d) => got.push(d));
    takeGems({ balance: 87, shop: { day: 5, used: 2 }, deeds: [deed(2), { n: 3, at: 1, delta: 120, kind: 'start' }] });
    expect(useGems.getState().balance).toBe(87);
    expect(useGems.getState().shop).toEqual({ day: 5, used: 2 });
    // Стартовые — не дело для партии: в партию уходят только лавка и ускорение.
    expect(got).toEqual([[deed(2)]]);
    takeGems({ balance: 'много' });
    takeGems(null);
    takeGems(undefined);
    expect(useGems.getState().balance).toBe(87);
  });

  it('без связи и вне Telegram тратить нельзя — словами', () => {
    expect(gemsOffline({ balance: 100, at: serverNow(), why: null })).toBe(OUTSIDE);
    init = 'signed';
    expect(gemsOffline({ balance: null, at: null, why: null })).toBe(OFFLINE);
    expect(gemsOffline({ balance: 100, at: serverNow(), why: null })).toBeNull();
    expect(gemsOffline({ balance: 100, at: serverNow() - GEMS_STALE_MS - 1, why: null }), 'сервер молчит дольше трёх записей').toBe(OFFLINE);
    takeGems({ balance: 100, shop: { day: 1, used: 0 }, deeds: [] });
    expect(gemsOffline()).toBeNull();
    gemsQuiet('offline');
    expect(gemsOffline()).toBe(OFFLINE);
    takeGems({ balance: 100, shop: { day: 1, used: 0 }, deeds: [] });
    expect(gemsOffline(), 'записка вернула связь').toBeNull();
  });

  it('приказов у игры два — купить в лавке и ускорить; оба только тратят', () => {
    const src = readFileSync(join(__dirname, 'gems.ts'), 'utf8');
    expect([...src.matchAll(/op: '(\w+)'/g)].map((m) => m[1]).sort()).toEqual(['buy', 'rush']);
    expect(src).not.toMatch(/creditGems|purchase|start/);
  });
});
