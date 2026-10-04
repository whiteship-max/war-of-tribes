import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deny, type Route } from '../lib/http.js';
import { ROUTES } from '../lib/routes/index.js';
import { listen } from './listen.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from './testkit.js';

/**
 * Приём HTTP своего сервера: настоящий сокет, настоящий `fetch`. Проверяется не смысл ответов —
 * он у обработчиков (`routes.test.ts`), — а то, что прослойка его не портит: заголовки, потолок
 * тела, адрес клиента от Caddy, неизвестный путь и упавший обработчик.
 */
let home: Home;
let server: Server;
let base: string;
const errors: string[] = [];

const BOOM = '/api/boom';
const boom: Route = async () => {
  throw new Error('обработчик упал');
};
const echoIp: Route = async (_req, io) => deny(418, io.ip ?? 'нет адреса');

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
  home = sqliteHome();
  server = await listen({ routes: { ...ROUTES, [BOOM]: boom, '/api/ip': echoIp }, stores: home.stores, onError: (p) => errors.push(p) }, 0, '127.0.0.1');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await home.close();
});

const auth = (id: number): Record<string, string> => ({ 'x-telegram-init-data': signInit(id, Math.floor(Date.now() / 1000) - 60) });

describe('приём HTTP своего сервера', () => {
  it('часы: JSON, без кэша, nosniff — те же заголовки, что у функций Netlify', async () => {
    const res = await fetch(`${base}/api/time?cache=bust`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    const { now } = (await res.json()) as { now: number };
    expect(Math.abs(now - Date.now())).toBeLessThan(5000);
  });

  it('сохранение проходит сокет целиком: запись и чтение своего', async () => {
    const rec = { v: 1, rev: 0, updatedAt: 0, device: 'd', game: '{"pop":30}', world: null, card: {} };
    const put = await fetch(`${base}/api/save`, { method: 'PUT', headers: { ...auth(5001), 'content-type': 'application/json' }, body: JSON.stringify({ baseEtag: null, record: rec }) });
    expect(put.status).toBe(200);
    const { etag } = (await put.json()) as { etag: string };
    const got = (await (await fetch(`${base}/api/save`, { headers: auth(5001) })).json()) as { etag: string; record: { game: string } };
    expect(got.etag).toBe(etag);
    expect(got.record.game).toBe('{"pop":30}');
  });

  /**
   * Тело сверх потолка копится не целиком, но обработчик обязан увидеть, что оно больше потолка, и
   * ответить 413 — как на Netlify, — а не разобрать обрезанное как испорченное и ответить 400.
   */
  it('тело больше потолка — 413, а не обрезанное 400', async () => {
    const big = JSON.stringify({ baseEtag: null, record: { game: 'x'.repeat(700 * 1024) } });
    const res = await fetch(`${base}/api/save`, { method: 'PUT', headers: auth(5002), body: big });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'too-big' });
  });

  /**
   * Без заявленной длины (тело потоком, `transfer-encoding: chunked`) первая проверка `readBody`
   * молчит, и 413 держится только на лишнем байте, который приём оставляет сверх потолка.
   */
  it('тело потоком, без заявленной длины, больше потолка — тоже 413', async () => {
    const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctl) {
        if (sent >= 700 * 1024) return ctl.close();
        sent += chunk.length;
        ctl.enqueue(chunk);
      },
    });
    const res = await fetch(`${base}/api/save`, { method: 'PUT', headers: auth(5004), body, duplex: 'half' } as RequestInit);
    expect(res.status).toBe(413);
  });

  it('адрес клиента — правый в X-Forwarded-For (его ставит Caddy), без заголовка — адрес сокета', async () => {
    const via = await fetch(`${base}/api/ip`, { headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' } });
    expect(await via.json()).toEqual({ error: '203.0.113.7' });
    const direct = await fetch(`${base}/api/ip`);
    expect(((await direct.json()) as { error: string }).error).toMatch(/127\.0\.0\.1/);
  });

  it('сито часов считает адреса раздельно', async () => {
    const ask = (ip: string) => fetch(`${base}/api/time`, { headers: { 'x-forwarded-for': ip } }).then((r) => r.status);
    const one: number[] = [];
    for (let i = 0; i < 61; i++) one.push(await ask('198.51.100.1'));
    expect(one.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(one[60]).toBe(429);
    expect(await ask('198.51.100.2')).toBe(200);
  });

  it('неизвестный путь — 404 JSON; путь со слэшем на конце — тоже неизвестный', async () => {
    for (const path of ['/api/nope', '/api/time/', '/']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: 'not-found' });
    }
  });

  it('упавший обработчик — 500 простым текстом, в журнал уходит только адрес', async () => {
    const res = await fetch(`${base}${BOOM}?secret=x`, { headers: auth(5003) });
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(errors).toEqual([BOOM]);
  });
});
