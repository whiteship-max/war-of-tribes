/**
 * Чистый старт и эпоха мира (docs/test_world.md) — на настоящем SQLite. Тесты там, где можно воскресить стёртый мир или
 * открыть стирание чужому: команда только от ADMIN_IDS и только со словом «ДА»; стирает всё, что относится к партиям, и
 * оставляет заморозку и журнал админа; после стирания запрос старой эпохи не пишет и не читает ничего (410), пока идёт
 * стирание — 503; `/spawns` показывает, кто какое место занял.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { botWith } from './routes/bot.js';
import { ROUTES } from './routes/index.js';
import { STORES, type Stores } from './kv.js';
import type { Telegram } from './telegram.js';
import { ERA_KEY, eraNow, readEraFile, wipeWorld } from './era.js';
import { FROZEN_KEY, LOG_KEY, grantsKey, readAdminLog } from './admin.js';
import { ERA_HEADER, readEra } from './contract.js';
import { SICILY } from '../../src/world/spawn.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';

const NOW = 1_900_000_000_000;
const SEC = 1000;
const SECRET = 'test-secret_0123';
const ADMIN = 4242;
const A = 7001;
const B = 7002;

let home: Home;
const env: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'ADMIN_IDS', 'TRIBE_SPAWN']) env[k] = process.env[k];
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  process.env.ADMIN_IDS = String(ADMIN);
  process.env.TRIBE_SPAWN = 'sicily';
  home = sqliteHome();
});
afterEach(async () => {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await home.close();
});

function fakeTg() {
  const said: string[] = [];
  const tg: Telegram = {
    send: async () => 'ok',
    answer: async () => 'ok',
    button: async () => 'ok',
    async say(_chat, text) {
      said.push(text);
      return 'ok';
    },
    file: async () => 'ok',
    greet: async () => 'ok',
  };
  return { tg, said };
}

async function command(t: ReturnType<typeof fakeTg>, from: number, text: string, stores: Stores = home.stores): Promise<string | null> {
  const before = t.said.length;
  const res = await botWith(() => t.tg)(
    new Request('https://x/api/bot', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
      body: JSON.stringify({ update_id: 1, message: { message_id: 9, from: { id: from }, chat: { id: from, type: 'private' }, text } }),
    }),
    { stores, now: NOW, ip: null },
  );
  expect(res.status).toBe(200);
  return t.said.length > before ? t.said[t.said.length - 1] : null;
}

/** Запрос игры: подпись игрока и эпоха заголовком (нет — как у игры, не знавшей стираний). */
async function call(path: string, user: number, opts: { method?: string; body?: unknown; era?: number; at?: number } = {}) {
  const at = opts.at ?? NOW;
  const headers: Record<string, string> = { 'x-telegram-init-data': signInit(user, Math.floor(at / SEC) - 60) };
  if (opts.era !== undefined) headers[ERA_HEADER] = String(opts.era);
  const res = await ROUTES[path](
    new Request(`http://tribe.test${path}`, {
      method: opts.method ?? 'GET',
      headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    }),
    { stores: home.stores, now: at, ip: null },
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const record = () => ({ v: 1, rev: 0, updatedAt: 0, device: 'dev-1', game: '{"pop":30}', world: null, card: { name: 'Вождь', day: 3, pop: 60, power: 500, army: 10 } });

const keys = async (name: (typeof STORES)[keyof typeof STORES]): Promise<string[]> =>
  (await home.stores(name, 'strong').list({})).blobs.map((b) => b.key).sort();

/** Мир, в котором поиграли: две партии, два замка, война, уведомления, наблюдение, отчёт, указ, заморозка, журнал. */
async function lived(): Promise<void> {
  expect((await call('/api/save', A, { method: 'PUT', body: { baseEtag: null, record: record() } })).status).toBe(200);
  expect((await call('/api/save', B, { method: 'PUT', body: { baseEtag: null, record: record() } })).status).toBe(200);
  expect((await call('/api/castles', A, { method: 'PUT', body: { name: 'А', city: '', power: 1, pop: 30 } })).status).toBe(200);
  expect((await call('/api/castles', B, { method: 'PUT', body: { name: 'Б', city: '', power: 1, pop: 30 } })).status).toBe(200);
  await home.stores(STORES.world, 'strong').setJSON('wars', { v: 1, seq: 1, wars: [] });
  await home.stores(STORES.notify, 'strong').setJSON(`tg-${A}`, { v: 1 });
  await home.stores(STORES.due, 'strong').setJSON(`000123/tg-${A}`, {});
  await home.stores(STORES.stats, 'strong').setJSON('2026-10-06/03:30:00.000', { sent: 1 });
  await home.stores(STORES.reports, 'strong').setJSON('mg1abc2d-4567', { text: 'ошибка' });
  await home.stores(STORES.admin, 'strong').setJSON(grantsKey(`tg-${A}`), { v: 1, list: [] });
  await home.stores(STORES.admin, 'strong').setJSON(FROZEN_KEY, { v: 1, keys: {} });
  await home.stores(STORES.admin, 'strong').setJSON(LOG_KEY, { v: 1, list: [] });
  expect(await keys(STORES.watch)).toContain(`tg-${A}`);
}

describe('чистый старт: только админ и только со словом «ДА»', () => {
  it('чужой — тишина, и ничего не стёрто', async () => {
    await lived();
    const t = fakeTg();
    expect(await command(t, A, '/wipeworld ДА')).toBeNull();
    expect(await keys(STORES.saves)).toEqual([`tg-${A}`, `tg-${B}`]);
    expect((await eraNow(home.stores)).era).toBe(0);
  });

  it('админ без «ДА» (и с «да», «ДА!» и лишним словом) — объяснение, и ничего не стёрто', async () => {
    await lived();
    const t = fakeTg();
    for (const text of ['/wipeworld', '/wipeworld да', '/wipeworld ДА!', '/wipeworld ДА совсем']) {
      expect(await command(t, ADMIN, text)).toMatch(/Подтвердить: \/wipeworld ДА/);
    }
    expect(await keys(STORES.saves)).toEqual([`tg-${A}`, `tg-${B}`]);
    expect((await eraNow(home.stores)).era).toBe(0);
  });

  it('«/wipeworld ДА» стирает партии, мир, уведомления, наблюдение, отчёты, указы и поднимает эпоху; заморозка и журнал остаются', async () => {
    await lived();
    const t = fakeTg();
    expect(await command(t, ADMIN, '/wipeworld ДА')).toMatch(/Мир начат заново: эпоха 1/);
    for (const name of [STORES.saves, STORES.notify, STORES.due, STORES.stats, STORES.watch, STORES.reports]) {
      expect([name, await keys(name)]).toEqual([name, []]);
    }
    expect(await keys(STORES.world)).toEqual([ERA_KEY]);
    expect(await keys(STORES.admin)).toEqual([FROZEN_KEY, LOG_KEY].sort());
    expect(await eraNow(home.stores)).toEqual({ v: 1, era: 1, at: NOW });
    const log = await home.stores(STORES.admin, 'strong').getWithMetadata(LOG_KEY);
    expect(readAdminLog(JSON.parse(String(log?.data))).list.at(-1)).toMatchObject({ by: ADMIN, what: expect.stringMatching(/Чистый старт: эпоха мира 1/) });
    // Второй раз — эпоха 2: каждый чистый старт — новый номер.
    expect(await command(t, ADMIN, '/wipeworld ДА')).toMatch(/эпоха 2/);
  });
});

describe('после стирания старая партия не воскресает', () => {
  it('партия старой эпохи: запись — 410 и не легла; чтение — 410; реестр и война — 410', async () => {
    await lived();
    await wipeWorld(home.stores, ADMIN, NOW);
    // Телефон с прошлой эпохой (0 — заголовка нет или 0) пробует вернуть свою партию на пустой сервер.
    for (const era of [undefined, 0]) {
      const put = await call('/api/save', A, { method: 'PUT', body: { baseEtag: null, record: record() }, era, at: NOW + 10 * SEC });
      expect(put).toMatchObject({ status: 410, body: { error: 'era', era: 1 } });
      expect((await call('/api/save', A, { era })).status).toBe(410);
      expect((await call('/api/castles', A, { method: 'PUT', body: { name: 'А', city: '', power: 1, pop: 30 }, era })).status).toBe(410);
      expect((await call('/api/war', A, { era })).status).toBe(410);
      expect((await call('/api/notify', A, { method: 'PUT', body: { present: true }, era })).status).toBe(410);
    }
    expect(await keys(STORES.saves)).toEqual([]);
    expect(await keys(STORES.world)).toEqual([ERA_KEY]);
    // Порча заголовка — тоже чужая эпоха, а не «нулевая».
    expect(readEra('abc')).toBe(-1);
    expect((await call('/api/save', A, { era: -5 })).status).toBe(410);
  });

  it('партия новой эпохи пишется, и место ей выдаётся заново — первое на острове', async () => {
    await lived();
    await wipeWorld(home.stores, ADMIN, NOW);
    const put = await call('/api/save', B, { method: 'PUT', body: { baseEtag: null, record: record() }, era: 1, at: NOW + 10 * SEC });
    expect(put.status).toBe(200);
    const seat = await call('/api/castles', B, { method: 'PUT', body: { name: 'Б', city: '', power: 1, pop: 30 }, era: 1, at: NOW + 10 * SEC });
    expect(seat.status).toBe(200);
    expect(seat.body.mine).toEqual(SICILY[0]);
  });

  it('пока идёт стирание — 503 всем, и записи нет', async () => {
    await home.stores(STORES.world, 'strong').setJSON(ERA_KEY, { v: 1, era: 0, wiping: true, at: NOW });
    const put = await call('/api/save', A, { method: 'PUT', body: { baseEtag: null, record: record() }, era: 0 });
    expect(put.status).toBe(503);
    expect(await keys(STORES.saves)).toEqual([]);
    // Оборванное стирание дотирается повтором и открывает мир.
    const done = await wipeWorld(home.stores, ADMIN, NOW + SEC);
    expect(done).toMatchObject({ era: 1 });
    expect(readEraFile(JSON.parse(String((await home.stores(STORES.world, 'strong').getWithMetadata(ERA_KEY))?.data)))).toEqual({ v: 1, era: 1, at: NOW + SEC });
  });
});

describe('/spawns', () => {
  it('все места острова: занятые — чьи, остальные свободны; чужому — тишина', async () => {
    await lived();
    const t = fakeTg();
    expect(await command(t, A, '/spawns')).toBeNull();
    const text = (await command(t, ADMIN, '/spawns')) as string;
    expect(text).toMatch(/режим TRIBE_SPAWN=sicily включён; эпоха мира 0/);
    expect(text).toContain(`Занято 2 из ${SICILY.length}.`);
    expect(text).toContain(`1. ${SICILY[0].x}|${SICILY[0].y} — «`);
    expect(text).toContain(`tg-${A} (А)`);
    expect(text).toContain(`tg-${B} (Б)`);
    expect(text.split('\n').filter((l) => l.endsWith('— свободно'))).toHaveLength(SICILY.length - 2);
    delete process.env.TRIBE_SPAWN;
    expect(await command(t, ADMIN, '/spawns')).toMatch(/ВЫКЛЮЧЕН/);
  });
});
