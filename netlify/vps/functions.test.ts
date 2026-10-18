import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ROUTES } from '../lib/routes/index.js';
import * as botRoute from '../lib/routes/bot.js';
import * as castlesRoute from '../lib/routes/castles.js';
import * as feedRoute from '../lib/routes/feed.js';
import * as perfRoute from '../lib/routes/perf.js';
import * as gemsRoute from '../lib/routes/gems.js';
import * as notifyRoute from '../lib/routes/notify.js';
import * as payRoute from '../lib/routes/pay.js';
import * as ratingRoute from '../lib/routes/rating.js';
import * as reportRoute from '../lib/routes/report.js';
import * as saveRoute from '../lib/routes/save.js';
import * as timeRoute from '../lib/routes/time.js';
import * as warRoute from '../lib/routes/war.js';
import { TEST_TOKEN, localBlobs, signInit } from './testkit.js';

/**
 * Функции Netlify и свой сервер — одна дверь. Функция объявляет свой путь сама (платформа читает
 * его из исходника), а свой сервер берёт пути из `ROUTES`; тест держит, что пути одни и те же и что
 * функция зовёт ровно тот обработчик, который стоит в `ROUTES` под её путём.
 *
 * Второе — живой прогон функции так, как её зовёт платформа: без доводов о хранилище, с контекстом
 * Blobs в окружении (`NETLIFY_BLOBS_CONTEXT` — так его подставляет Netlify). Контекст смотрит на
 * местный сервер Blobs. Ответ функции обязан совпасть с ответом обработчика из `ROUTES`.
 */
const ROOT = join(__dirname, '..');
const ROUTE_MODULES: Record<string, Record<string, unknown>> = {
  save: saveRoute,
  castles: castlesRoute,
  notify: notifyRoute,
  time: timeRoute,
  war: warRoute,
  bot: botRoute,
  report: reportRoute,
  rating: ratingRoute,
  gems: gemsRoute,
  pay: payRoute,
  feed: feedRoute,
  perf: perfRoute,
};

/** Функции с адресом. Функция по расписанию (`deliver.mts`) адреса не имеет: её держит `lib/server.test.ts`. */
const deployed = readdirSync(join(ROOT, 'functions'))
  .filter((n) => /\.mts$/.test(n))
  .filter((n) => !/\bschedule\s*:/.test(readFileSync(join(ROOT, 'functions', n), 'utf8')));

describe('функции Netlify и свой сервер — одни пути и одни обработчики', () => {
  it('у каждой функции путь из ROUTES, и ROUTES не знает путей, которых нет у функций', () => {
    const paths = deployed.map((n) => /path:\s*'([^']+)'/.exec(readFileSync(join(ROOT, 'functions', n), 'utf8'))?.[1]);
    expect(paths.every((p) => typeof p === 'string')).toBe(true);
    expect([...paths].sort()).toEqual(Object.keys(ROUTES).sort());
  });

  it.each(deployed)('%s зовёт обработчик своего пути и больше ничего не делает', (name) => {
    const src = readFileSync(join(ROOT, 'functions', name), 'utf8');
    const path = /path:\s*'([^']+)'/.exec(src)![1];
    const imported = /import \{ (\w+) \} from '\.\.\/lib\/routes\/(\w+)\.js';/.exec(src);
    expect(imported, 'обработчик импортирован из lib/routes').not.toBeNull();
    const [, fn, file] = imported!;
    expect(ROUTE_MODULES[file]?.[fn], `${file}.${fn}`).toBe(ROUTES[path]);
    expect(src).toMatch(new RegExp(`export default \\([^)]*\\)[^=]*=>\\s*${fn}\\(req, \\{ stores: blobsStores\\(\\), now: Date\\.now\\(\\), ip: `));
    // Тонкая обёртка: ни подписи, ни хранилища, ни разбора — всё это в обработчике.
    expect(src).not.toMatch(/readInitData|getStore|parseJson|\.data\b/);
  });
});

describe('функция Netlify на контексте платформы отвечает как обработчик', () => {
  const NOW = 1_800_000_000_000;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
    const local = await localBlobs();
    stop = local.stop;
    // Так платформа отдаёт функции доступ к Blobs: контекст в окружении, base64 JSON. Подставной
    // `fetch` с ETag при чтении в окружение не положить — его функция берёт из глобального.
    const { fetch: readEtagFetch, ...site } = local.site;
    process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify(site)).toString('base64');
    vi.stubGlobal('fetch', readEtagFetch);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterAll(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    await stop();
  });

  it('сохранение: запись, чтение, 409 на устаревшем ETag — через функцию', async () => {
    const fn = (await import('../functions/save.mjs')).default;
    const ctx = { ip: '10.0.0.1' } as never;
    const init = (): Record<string, string> => ({ 'x-telegram-init-data': signInit(3001, Math.floor(Date.now() / 1000) - 60) });
    const rec = { v: 1, rev: 0, updatedAt: 0, device: 'd', game: '{}', world: null, card: {} };

    const put1 = await fn(new Request('http://t/api/save', { method: 'PUT', headers: init(), body: JSON.stringify({ baseEtag: null, record: rec }) }), ctx);
    const first = (await put1.json()) as { etag: string; rev: number };
    expect(put1.status).toBe(200);
    expect(first.rev).toBe(1);

    const got = (await (await fn(new Request('http://t/api/save', { headers: init() }), ctx)).json()) as { etag: string; record: { updatedAt: number } };
    expect(got.etag).toBe(first.etag);
    expect(got.record.updatedAt).toBe(NOW);

    vi.setSystemTime(NOW + 5000);
    const put2 = await fn(new Request('http://t/api/save', { method: 'PUT', headers: init(), body: JSON.stringify({ baseEtag: first.etag, record: rec }) }), ctx);
    expect(put2.status).toBe(200);
    vi.setSystemTime(NOW + 10_000);
    const stale = await fn(new Request('http://t/api/save', { method: 'PUT', headers: init(), body: JSON.stringify({ baseEtag: first.etag, record: rec }) }), ctx);
    expect(stale.status).toBe(409);
  });

  it('часы: адрес клиента берётся из контекста платформы', async () => {
    const fn = (await import('../functions/time.mjs')).default;
    const res = await fn(new Request('http://t/api/time'), { ip: '10.0.0.2' } as never);
    expect(await res.json()).toEqual({ now: Date.now() });
  });
});
