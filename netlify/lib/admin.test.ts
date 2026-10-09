import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { botWith } from './routes/bot.js';
import { save } from './routes/save.js';
import { war } from './routes/war.js';
import { reportWith } from './routes/report.js';
import { STORES, type Kv, type Stores } from './kv.js';
import type { Telegram } from './telegram.js';
import { FROZEN_ORDER, adminIds, grantsKey, readAdminLog, readFrozen, readGrants } from './admin.js';
import { kindOf, parseGive, statsCsv } from './commands.js';
import { readWatchRecord, flagsBetween, flagsOf } from './watch.js';
import { REPORT_LIMITS, readAdminNote, readGrant, type WatchCard } from './contract.js';

/**
 * Админка (docs/admin.md). Тесты там, где без них можно открыть админку чужому, начислить из ничего или потерять
 * отчёт: чужой id не проходит и ничего не трогает; указ — номером, ровно один раз и без алмазов; заморозка закрывает
 * запись и войну; отчёт ложится и доходит до админа, поток режется; флаги выводятся из правил, а не из воздуха.
 */
const TOKEN = '123456:AA-test-token-not-a-real-one';
const SECRET = 'test-secret_0123';
const NOW = 1_900_000_000_000;
const ADMIN = 4242;
const PLAYER = 7001;

function memoryStores() {
  const data = new Map<string, Map<string, { value: string; etag: string }>>();
  const touched: string[] = [];
  let n = 0;
  const kv = (name: string): Kv => {
    const m = data.get(name) ?? new Map();
    data.set(name, m);
    return {
      async getWithMetadata(key) {
        touched.push(`get:${name}`);
        const v = m.get(key);
        return v ? { data: v.value, etag: v.etag } : null;
      },
      async setJSON(key, value, opts) {
        touched.push(`set:${name}`);
        const had = m.get(key);
        if (opts?.onlyIfNew && had) return { modified: false };
        if (opts?.onlyIfMatch && had?.etag !== opts.onlyIfMatch) return { modified: false };
        const etag = `e${++n}`;
        m.set(key, { value: JSON.stringify(value), etag });
        return { modified: true, etag };
      },
      async set(key, value) {
        m.set(key, { value, etag: `e${++n}` });
      },
      async list(opts) {
        touched.push(`list:${name}`);
        return { blobs: [...m.keys()].filter((k) => k.startsWith(opts.prefix ?? '')).map((key) => ({ key })), directories: [] };
      },
      async delete(key) {
        m.delete(key);
      },
    };
  };
  const stores: Stores = (name) => kv(name);
  const json = (store: string, key: string): unknown => {
    const v = data.get(store)?.get(key);
    return v ? JSON.parse(v.value) : null;
  };
  return { stores, data, touched, json };
}

function fakeTg() {
  const said: { chat: number; text: string }[] = [];
  const files: { chat: number; name: string; content: string }[] = [];
  const greeted: { chat: number; text: string }[] = [];
  const tg: Telegram = {
    send: async () => 'ok',
    answer: async () => 'ok',
    button: async () => 'ok',
    async say(chat, text) {
      said.push({ chat, text });
      return 'ok';
    },
    async file(chat, name, content) {
      files.push({ chat, name, content });
      return 'ok';
    },
    async greet(chat, text) {
      greeted.push({ chat, text });
      return 'ok';
    },
  };
  return { tg, said, files, greeted };
}

/** Подписанная строка запуска — тем же алгоритмом, каким её собирает Telegram. */
function signInit(id: number, username?: string): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(NOW / 1000) - 60),
    user: JSON.stringify({ id, ...(username ? { username } : {}) }),
  };
  const check = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const p = new URLSearchParams(fields);
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}

const message = (from: number, text: string, chat = from, type = 'private') => ({
  update_id: 1,
  message: { message_id: 9, from: { id: from }, chat: { id: chat, type }, text },
});

async function command(s: ReturnType<typeof memoryStores>, t: ReturnType<typeof fakeTg>, from: number, text: string, now = NOW) {
  const req = new Request('https://x/api/bot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify(message(from, text)),
  });
  const res = await botWith(() => t.tg)(req, { stores: s.stores, now, ip: null });
  expect(res.status).toBe(200);
  return t.said[t.said.length - 1]?.text ?? '';
}

const card = (over: Partial<WatchCard> = {}): WatchCard => ({
  build: 'v1',
  city: 'Новгород',
  clock: NOW,
  time: 1000,
  level: 2,
  buildings: { town_hall: 2 },
  pop: 50,
  stock: { wood: 100, gold: 10 },
  prod: { wood: 300, gold: 20 },
  cap: 1000,
  troops: { spearman: 10 },
  queued: 0,
  away: 0,
  caravans: 0,
  wounded: 0,
  train: 6,
  deeds: 5,
  won: 1,
  lost: 0,
  lairs: 0,
  raids: 0,
  games: 2,
  haul: 100,
  haulCap: 200,
  cheated: false,
  lead: 0,
  seen: 0,
  ...over,
});

const record = (watch?: WatchCard) => ({ v: 1, rev: 0, updatedAt: 0, device: 'dev-1', game: '{"pop":30}', world: null, card: { name: 'Вождь', day: 3, pop: 60, power: 500, army: 10 }, ...(watch ? { watch } : {}) });

async function saveCall(s: ReturnType<typeof memoryStores>, method: 'GET' | 'PUT', body?: unknown, now = NOW, user = PLAYER) {
  const req = new Request('https://x/api/save', {
    method,
    headers: { 'x-telegram-init-data': signInit(user, 'ivan_99'), ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const res = await save(req, { stores: s.stores, now, ip: null });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// У каждого теста записи свой игрок: сито частоты (`http.allow`) общее на процесс, и минуты у тестов разные.
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'ADMIN_IDS']) saved[k] = process.env[k];
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  process.env.ADMIN_IDS = `${ADMIN}, 5151`;
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('админ — только ADMIN_IDS', () => {
  it('список: числа через запятую или пробел; мусор и пусто — никого', () => {
    expect([...adminIds({ ADMIN_IDS: '12, 34 56;x;-7;0' })]).toEqual([12, 34, 56]);
    expect(adminIds({}).size).toBe(0);
    expect(adminIds({ ADMIN_IDS: 'all' }).size).toBe(0);
  });

  it('чужой id не проходит: ни ответа, ни похода в хранилище', async () => {
    const s = memoryStores();
    const t = fakeTg();
    for (const text of ['/help', '/give 7001 дерево 500', '/stats', '/freeze 7001', '/player 7001']) await command(s, t, 999, text);
    expect(t.said).toEqual([]);
    expect(t.files).toEqual([]);
    expect(s.touched).toEqual([]);
  });

  it('админ в группе или от чужого имени в личном чате — тоже тишина', async () => {
    const s = memoryStores();
    const t = fakeTg();
    const req = (body: unknown) =>
      new Request('https://x/api/bot', { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': SECRET }, body: JSON.stringify(body) });
    await botWith(() => t.tg)(req(message(ADMIN, '/stats', -100, 'group')), { stores: s.stores, now: NOW, ip: null });
    await botWith(() => t.tg)(req(message(ADMIN, '/stats', 777)), { stores: s.stores, now: NOW, ip: null });
    expect(t.said).toEqual([]);
    expect(s.touched).toEqual([]);
  });

  it('без секрета вебхука команда админа не доходит вовсе', async () => {
    const s = memoryStores();
    const t = fakeTg();
    const res = await botWith(() => t.tg)(
      new Request('https://x/api/bot', { method: 'POST', body: JSON.stringify(message(ADMIN, '/stats')) }),
      { stores: s.stores, now: NOW, ip: null },
    );
    expect(res.status).toBe(401);
    expect(t.said).toEqual([]);
  });

  it('админу на неизвестное — список команд', async () => {
    const said = await command(memoryStores(), fakeTg(), ADMIN, 'привет');
    expect(said).toMatch(/\/give/);
    expect(said).toMatch(/\/stats/);
  });
});

describe('указ: номером, один раз, без алмазов', () => {
  it('словарь: имена игры, падежи, латиница; неизвестное и двусмысленное — нет', () => {
    expect(kindOf('дерево')).toEqual({ stock: 'wood' });
    expect(kindOf('Древесины')).toEqual({ stock: 'wood' });
    expect(kindOf('камня')).toEqual({ stock: 'stone' });
    expect(kindOf('золото')).toEqual({ stock: 'gold' });
    expect(kindOf('копейщиков')).toEqual({ troop: 'spearman' });
    expect(kindOf('латные')).toEqual({ troop: 'knight' });
    expect(kindOf('латники')).toEqual({ troop: 'legionary' });
    expect(kindOf('knight')).toEqual({ troop: 'knight' });
    expect(kindOf('лат')).toBeNull();
    for (const gem of ['алмазы', 'алмаз', 'gems', 'gem', 'кристаллы']) expect(kindOf(gem), gem).toBeNull();
  });

  it('разбор: пары с конца, кто — спереди, минус убавляет', () => {
    expect(parseGive(['Великий', 'Новгород', 'дерево', '500', 'копейщики', '-10'])).toEqual({
      who: 'Великий Новгород',
      stock: { wood: 500 },
      troops: { spearman: -10 },
    });
    expect(parseGive(['7001', 'алмазы', '100'])).toMatch(/Не знаю/);
    expect(parseGive(['7001', 'дерево'])).toMatch(/Нужно/);
    expect(parseGive(['дерево', '5'])).toMatch(/Кому/);
  });

  it('договор не пропускает чужих видов: алмазов в указе нет, даже если их положить в хранилище руками', () => {
    const g = readGrant({ n: 1, at: NOW, stock: { wood: 5, gems: 1000 }, troops: { spearman: 1, dragon: 3 } });
    expect(g).toEqual({ n: 1, at: NOW, stock: { wood: 5 }, troops: { spearman: 1 } });
    expect(readGrant({ n: 2, at: NOW, stock: { gems: 1000 } })).toBeNull();
  });

  it('/give кладёт указ с номером; сохранение отдаёт его, пока партия не назвала номер своим', async () => {
    const s = memoryStores();
    const t = fakeTg();
    await saveCall(s, 'PUT', { baseEtag: null, record: record(card()) });
    const said = await command(s, t, ADMIN, '/give 7001 дерево 500 копейщики -3');
    expect(said).toMatch(/Указ №1/);
    expect(readGrants(s.json(STORES.admin, grantsKey('tg-7001'))).list).toMatchObject([{ n: 1, by: ADMIN, stock: { wood: 500 }, troops: { spearman: -3 } }]);
    await command(s, t, ADMIN, '/give @ivan_99 золото 50');
    expect(readGrants(s.json(STORES.admin, grantsKey('tg-7001'))).seq).toBe(2);

    const pull = await saveCall(s, 'GET', undefined, NOW + 1000);
    const note = readAdminNote(pull.body.admin);
    expect(note.grants.map((g) => g.n)).toEqual([1, 2]);
    // Кто отдал указ, клиенту знать незачем.
    expect(JSON.stringify(pull.body.admin)).not.toMatch(/"by"/);

    const etag = pull.body.etag as string;
    const push = await saveCall(s, 'PUT', { baseEtag: etag, record: record(card({ seen: 1 })) }, NOW + 60_000);
    expect(push.status).toBe(200);
    expect(readAdminNote(push.body.admin).grants.map((g) => g.n)).toEqual([2]);

    const log = readAdminLog(s.json(STORES.admin, 'log'));
    expect(log.list.map((e) => e.what)).toEqual(['Указ №1: древесина +500, копейщики −3', 'Указ №2: золото +50']);
    expect(log.list.every((e) => e.by === ADMIN && e.who === 'tg-7001')).toBe(true);
  });

  it('указ неизвестному игроку не ложится', async () => {
    const s = memoryStores();
    const said = await command(s, fakeTg(), ADMIN, '/give 123 дерево 5');
    expect(said).toMatch(/Не нашёл/);
    expect(s.json(STORES.admin, grantsKey('tg-123'))).toBeNull();
  });
});

describe('заморозка', () => {
  it('замороженному: запись — 423 с запиской, приказ войны — отказ; разморозка возвращает запись', async () => {
    const s = memoryStores();
    const t = fakeTg();
    const first = await saveCall(s, 'PUT', { baseEtag: null, record: record(card()) }, NOW, 7002);
    expect(first.status).toBe(200);
    expect(await command(s, t, ADMIN, '/freeze 7002 чит на золото')).toMatch(/заморожен/);
    expect(readFrozen(s.json(STORES.admin, 'frozen')).keys['tg-7002']).toMatchObject({ by: ADMIN, why: 'чит на золото' });

    const blocked = await saveCall(s, 'PUT', { baseEtag: first.body.etag, record: record(card()) }, NOW + 60_000, 7002);
    expect(blocked.status).toBe(423);
    expect(blocked.body).toMatchObject({ error: 'frozen', admin: { frozen: true } });
    expect((await saveCall(s, 'GET', undefined, NOW + 61_000, 7002)).body.admin).toMatchObject({ frozen: true });

    const order = await war(
      new Request('https://x/api/war', {
        method: 'POST',
        headers: { 'x-telegram-init-data': signInit(7002) },
        body: JSON.stringify({ op: 'recall', id: 'w1' }),
      }),
      { stores: s.stores, now: NOW + 62_000, ip: null },
    );
    expect(((await order.json()) as { error?: string }).error).toBe(FROZEN_ORDER);

    expect(await command(s, t, ADMIN, '/unfreeze 7002')).toMatch(/разморожен/);
    const again = await saveCall(s, 'PUT', { baseEtag: first.body.etag, record: record(card()) }, NOW + 120_000, 7002);
    expect(again.status).toBe(200);
    expect(readAdminLog(s.json(STORES.admin, 'log')).list.map((e) => e.what)).toEqual(['Заморозка: чит на золото', 'Разморозка']);
  });
});

describe('отчёт об ошибке', () => {
  const send = (s: ReturnType<typeof memoryStores>, t: ReturnType<typeof fakeTg>, text: string, now: number) =>
    reportWith(() => t.tg)(
      new Request('https://x/api/report', {
        method: 'POST',
        headers: { 'x-telegram-init-data': signInit(PLAYER, 'ivan_99') },
        body: JSON.stringify({ text, ctx: { build: 'v1', device: 'Android', screen: '390×844 @3', view: 'город', scene: 'ok', events: ['день 3: стройка'], clock: now, day: 3 } }),
      }),
      { stores: s.stores, now, ip: null },
    );

  it('ложится, доходит админам коротко и читается /report целиком; поток режется по часу', async () => {
    const s = memoryStores();
    const t = fakeTg();
    const res = await send(s, t, 'Пропала деревня после сворачивания', NOW);
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(t.said.map((x) => x.chat).sort()).toEqual([ADMIN, 5151]);
    expect(t.said[0].text).toMatch(new RegExp(`/report ${id}`));
    const full = await command(s, t, ADMIN, `/report ${id}`);
    expect(full).toMatch(/Пропала деревня/);
    expect(full).toMatch(/Android/);
    expect(full).toMatch(/день 3: стройка/);

    for (let i = 1; i < REPORT_LIMITS.perHour; i++) expect((await send(s, t, `ещё ${i}`, NOW + i * 1000)).status).toBe(200);
    const over = await send(s, t, 'лишний', NOW + 10_000);
    expect(over.status).toBe(429);
    expect((await send(s, t, 'через час', NOW + 3600_000 + 1)).status).toBe(200);
  });

  it('без подписи — 401, и ничего не легло', async () => {
    const s = memoryStores();
    const res = await reportWith(() => fakeTg().tg)(new Request('https://x/api/report', { method: 'POST', body: '{"text":"x"}' }), {
      stores: s.stores,
      now: NOW,
      ip: null,
    });
    expect(res.status).toBe(401);
    expect(s.touched).toEqual([]);
  });
});

describe('флаги выводятся из правил игры', () => {
  const MIN = 60_000;

  it('склад без разовых дел растёт не быстрее выработки; с делом — объяснён', () => {
    // Минута настоящего — 1/30 игрового дня (×30): выработка 300 в день даёт за минуту 10, с запасом вдвое — 20.
    const a = card();
    const honest = card({ time: a.time + 2, stock: { wood: 110, gold: 10 } });
    expect(flagsBetween(a, NOW, honest, NOW + MIN)).toEqual([]);
    const cheat = card({ time: a.time + 2, stock: { wood: 5100, gold: 10 } });
    expect(flagsBetween(a, NOW, cheat, NOW + MIN).map((f) => f.kind)).toEqual(['stock']);
    const deed = card({ time: a.time + 2, stock: { wood: 5100, gold: 10 }, deeds: 6 });
    expect(flagsBetween(a, NOW, deed, NOW + MIN)).toEqual([]);
    // Вернулись из похода или пришёл караван — добыча и товар легли разом.
    expect(flagsBetween(a, NOW, card({ time: a.time + 2, stock: { wood: 900, gold: 10 }, away: 3 }), NOW + MIN)).toEqual([]);
    expect(flagsBetween(card({ caravans: 1 }), NOW, card({ time: a.time + 2, stock: { wood: 900, gold: 10 } }), NOW + MIN)).toEqual([]);
  });

  it('войско без дел растёт не быстрее обучения', () => {
    const a = card();
    const cheat = card({ time: a.time + 2, troops: { spearman: 60 } });
    const found = flagsBetween(a, NOW, cheat, NOW + MIN);
    expect(found.map((f) => f.kind)).toEqual(['army']);
    expect(found[0].text).toMatch(/\+50/);
  });

  it('время партии не обгоняет настоящее; промыслы — не чаще энергии и не богаче потолка', () => {
    const a = card();
    expect(flagsBetween(a, NOW, card({ time: a.time + 600 }), NOW + MIN).map((f) => f.kind)).toContain('time');
    expect(flagsBetween(a, NOW, card({ time: a.time + 2, games: 12, deeds: 15, haul: 1000 }), NOW + MIN).map((f) => f.kind)).toEqual(['games']);
    expect(flagsBetween(a, NOW, card({ time: a.time + 2, games: 3, deeds: 6, haul: 5000 }), NOW + MIN).map((f) => f.kind)).toEqual(['haul']);
  });

  it('опись сама по себе: коды проверки и часы устройства', () => {
    expect(flagsOf(card(), NOW)).toEqual([]);
    expect(flagsOf(card({ cheated: true, clock: NOW + 20 * MIN }), NOW).map((f) => f.kind)).toEqual(['cheat', 'clock']);
    // Сверх вместимости склада игра не кладёт ничего; золото в казне — не на складе.
    expect(flagsOf(card({ stock: { wood: 1500, gold: 99_999 } }), NOW).map((f) => f.kind)).toEqual(['cap']);
  });

  it('запись партии кладёт флаг в наблюдение, и /flags его показывает', async () => {
    const s = memoryStores();
    const t = fakeTg();
    const first = await saveCall(s, 'PUT', { baseEtag: null, record: record(card()) }, NOW, 7003);
    await saveCall(s, 'PUT', { baseEtag: first.body.etag, record: record(card({ time: 1002, stock: { wood: 99_000, gold: 10 } })) }, NOW + MIN, 7003);
    const rec = readWatchRecord(s.json(STORES.watch, 'tg-7003'));
    // Десять копейщиков с первой же записи сервер обученными не видел — это и книга войска (docs/pvp.md, раздел 6).
    expect(rec.flags.map((f) => f.kind)).toEqual(['forged', 'cap', 'stock']);
    expect(rec.user).toBe('ivan_99');
    expect(rec.writes).toBe(2);
    expect(rec.played).toBe(MIN);
    expect(await command(s, t, ADMIN, '/flags')).toMatch(/рост склада/);
  });
});

describe('/stats — файл CSV', () => {
  it('BOM, точка с запятой, строка на игрока; админ получает файл', async () => {
    const s = memoryStores();
    const t = fakeTg();
    await saveCall(s, 'PUT', { baseEtag: null, record: record(card()) }, NOW, 7004);
    await command(s, t, ADMIN, '/stats');
    expect(t.files).toHaveLength(1);
    const csv = t.files[0].content;
    expect(csv.startsWith('﻿id;')).toBe(true);
    const rows = csv.trim().split('\r\n');
    expect(rows).toHaveLength(2);
    expect(rows[1].split(';')[0]).toBe('7004');
    expect(rows[1]).toMatch(/Новгород/);
    expect(statsCsv([], { v: 1, keys: {} }).trim().split('\r\n')).toHaveLength(1);
  });
});
