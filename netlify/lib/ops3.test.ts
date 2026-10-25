/**
 * Конкурентные записи (OPS-3, docs/audit/WORKPLAN.md) — на настоящем SQLite, где можно; остальное — по исходнику обработчика.
 *  · пустой ETag в условии — условная запись, которая не сходится, а не безусловная (`vps/sqlite.ts`, `blobs.ts`);
 *  · `admin.rewrite` над записью без ETag — ошибка, а не тихий `null` после всех попыток;
 *  · стирание, начатое после проверки эпохи, — запись партии не ложится (эпоха проверяется и перед самой записью);
 *  · квота отчётов списывается после того, как отчёт лёг;
 *  · война: флаг подделки — после записи, слепки — заново на каждой попытке.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from './routes/index.js';
import { reportWith } from './routes/report.js';
import { STORES, type Kv, type Stores } from './kv.js';
import { ERA_KEY } from './era.js';
import { rewrite } from './admin.js';
import { reportId } from './reports.js';
import { readWatchRecord } from './watch.js';
import type { Telegram } from './telegram.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';

const NOW = 1_900_000_000_000;
const A = 7001;

let home: Home;
let token: string | undefined;
beforeEach(() => {
  token = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
  home = sqliteHome();
});
afterEach(async () => {
  if (token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = token;
  await home.close();
});

const src = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('пустой ETag — условие, а не его отсутствие', () => {
  it('SQLite: onlyIfMatch с пустой строкой не перезаписывает лежащее', async () => {
    const kv = home.stores(STORES.world, 'strong');
    await kv.setJSON('k', { v: 1 });
    const w = await kv.setJSON('k', { v: 2 }, { onlyIfMatch: '' });
    expect(w.modified).toBe(false);
    expect(JSON.parse(String((await kv.getWithMetadata('k'))!.data))).toEqual({ v: 1 });
  });

  it('Blobs: пустое условие не превращается в безусловную запись (по исходнику двери)', () => {
    expect(src('./blobs.ts')).toMatch(/'onlyIfMatch' in opts && !opts\.onlyIfMatch/);
  });
});

describe('admin.rewrite над записью без ETag', () => {
  it('ошибка, а не тихий null', async () => {
    let writes = 0;
    const kv = {
      getWithMetadata: async () => ({ data: '{"v":1}' }),
      setJSON: async () => {
        writes++;
        return { modified: false };
      },
    } as unknown as Kv;
    await expect(rewrite(kv, 'k', (v) => v, (cur) => cur)).rejects.toThrow(/ETag/);
    expect(writes).toBe(0);
  });
});

describe('стирание после проверки эпохи', () => {
  it('запись партии, чья проверка эпохи прошла до закрытия мира, не ложится', async () => {
    // Стирание закрывает мир в ту минуту, когда обработчик читает партию: проверка эпохи на входе уже пройдена.
    const raced: Stores = (name, consistency) => {
      const kv = home.stores(name, consistency);
      if (name !== STORES.saves) return kv;
      return {
        ...kv,
        getWithMetadata: async (key: string) => {
          await home.stores(STORES.world, 'strong').setJSON(ERA_KEY, { v: 1, era: 0, wiping: true, at: NOW });
          return kv.getWithMetadata(key);
        },
      };
    };
    const record = { v: 1, rev: 0, updatedAt: 0, device: 'dev-1', game: '{"pop":30}', world: null, card: { name: 'Вождь', day: 3, pop: 60, power: 500, army: 10 } };
    const res = await ROUTES['/api/save'](
      new Request('http://tribe.test/api/save', {
        method: 'PUT',
        headers: { 'x-telegram-init-data': signInit(A, Math.floor(NOW / 1000) - 60) },
        body: JSON.stringify({ baseEtag: null, record }),
      }),
      { stores: raced, now: NOW, ip: null },
    );
    expect(res.status).toBe(503);
    expect((await home.stores(STORES.saves, 'strong').list({})).blobs).toEqual([]);
  });
});

describe('квота отчётов — после записи отчёта', () => {
  it('отчёт не лёг — квота часа не тронута', async () => {
    const tg = { say: async () => 'ok' } as unknown as Telegram;
    const key = `tg-${A}`;
    // Отчёт с тем же номером уже лежит (та же миллисекунда): условная запись отчёта не сходится.
    await home.stores(STORES.reports, 'strong').setJSON(reportId(NOW, key), { v: 1 });
    const res = await reportWith(() => tg)(
      new Request('https://x/api/report', {
        method: 'POST',
        headers: { 'x-telegram-init-data': signInit(A, Math.floor(NOW / 1000) - 60) },
        body: JSON.stringify({ text: 'ошибка', ctx: { build: 'v1', device: 'Android', screen: '390×844 @3', view: 'город', scene: 'ok', events: [], clock: NOW, day: 3 } }),
      }),
      { stores: home.stores, now: NOW, ip: null },
    );
    expect(res.status).toBe(429);
    const found = await home.stores(STORES.watch, 'strong').getWithMetadata(key);
    expect(readWatchRecord(found ? JSON.parse(String(found.data)) : null).reports).toEqual([]);
  });
});

describe('война: флаг подделки и слепки на повторах (по исходнику обработчика)', () => {
  const code = src('./routes/war.ts');
  const loop = code.slice(code.indexOf('for (let tries = 0; tries < WRITE_TRIES; tries++)'));
  it('слепки обороны читаются заново на каждой попытке записи', () => {
    expect(loop.indexOf('sheets.clear()')).toBeGreaterThan(-1);
    expect(loop.indexOf('sheets.clear()')).toBeLessThan(loop.indexOf('advance(file, now, sheets)'));
  });
  it('флаг подделки пишется только там, где ответ уходит: без записи или после легшей записи', () => {
    const flag = [...loop.matchAll(/await flagForged\(\)/g)].map((m) => m.index ?? 0);
    expect(flag.length).toBe(2);
    expect(loop.slice(flag[0] - 40, flag[0])).toContain('if (!changed)');
    expect(flag[1]).toBeGreaterThan(loop.indexOf('if (written.modified)'));
  });
});
