/**
 * Перезапуск своего сервера посреди игры (docs/LAUNCH.md, «Если сервер упал»): процесс умирает без остановки — не
 * закрыв базу, — и поднимается заново на том же файле. Принятое до падения на месте, а повтор того же приказа после
 * подъёма не списывает второй раз: память процесса (вёдра частоты) пропадает, а ключ повтора лежит в базе.
 */
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, sqliteStores } from './sqlite.js';
import { TEST_TOKEN, signInit, tempDir } from './testkit.js';
import { ROUTES } from '../lib/routes/index.js';
import { GEM_GOODS, type GemsResponse } from '../lib/contract.js';

const NOW = 1_900_000_000_000;
const PLAYER = 7101;
let was: string | undefined;

beforeAll(() => {
  was = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
});
afterAll(() => {
  if (was === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = was;
});

const record = { v: 1, rev: 0, updatedAt: 0, device: 'dev-1', game: '{"pop":30}', world: null, card: { name: 'Вождь', day: 3, pop: 60, power: 500, army: 10 } };

describe('перезапуск сервера посреди игры', () => {
  it('процесс убит, не закрыв базу: партия и книга алмазов целы, повтор заказа не списан второй раз', async () => {
    const dir = tempDir('restart');
    const file = join(dir, 'tribe.sqlite');
    const call = async (stores: ReturnType<typeof sqliteStores>, path: string, method: string, body: unknown, now: number) => {
      const res = await ROUTES[path](
        new Request(`https://x${path}`, {
          method,
          headers: { 'x-telegram-init-data': signInit(PLAYER, Math.floor(now / 1000)) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        { stores, now, ip: null },
      );
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    };
    try {
      // До падения: партия записана, заказ лавки принят.
      const first = openDb(file);
      const before = sqliteStores(first);
      const saved = await call(before, '/api/save', 'PUT', { baseEtag: null, record }, NOW);
      expect(saved.status).toBe(200);
      const start = (await call(before, '/api/gems', 'GET', undefined, NOW + 1000)).body as unknown as GemsResponse;
      const order = { op: 'buy', key: 'restart-buy-1', res: GEM_GOODS[0] };
      const bought = (await call(before, '/api/gems', 'POST', order, NOW + 2000)).body as unknown as GemsResponse;
      expect(bought.error).toBeUndefined();
      expect(bought.entry?.n).toBeGreaterThan(0);
      expect(bought.balance).toBeLessThan(start.balance);
      // Падение: база не закрыта, процесс «умер». Подъём — новое соединение с тем же файлом.
      const second = openDb(file);
      try {
        const after = sqliteStores(second);
        const read = await call(after, '/api/save', 'GET', undefined, NOW + 60_000);
        expect(read.status).toBe(200);
        expect(read.body.etag).toBe(saved.body.etag);
        const again = (await call(after, '/api/gems', 'POST', order, NOW + 61_000)).body as unknown as GemsResponse;
        expect(again.balance).toBe(bought.balance);
        expect(again.entry?.n).toBe(bought.entry?.n);
        expect(again.list.filter((e) => e.kind === bought.entry?.kind && e.at === bought.entry?.at)).toHaveLength(1);
      } finally {
        second.close();
        first.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
