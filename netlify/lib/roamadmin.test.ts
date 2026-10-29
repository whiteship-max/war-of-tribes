// Путь меча по игроку (30.10.2026, решение владельца): до выпуска путь открыт админам (`ADMIN_IDS` — тот же список, что у команд бота
// и указов) и закрыт остальным. Выключатель здесь настоящий (`game/roamflag`, `ROAM_ON` выключен): правило — `roamOpenFor(isAdmin)`.
//
// Граница области — утверждениями: путь правда не выпущен (`ROAM_ON`), админ правда в списке, игрок правда не в нём, строка отряда
// правда лежит в реестре — иначе «отдаёт» и «не отдаёт» мерили бы не то правило.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from './routes/index.js';
import { STORES } from './kv.js';
import { ROSTER_KEY, readRoster } from './roster.js';
import { isAdmin } from './admin.js';
import { readWatchRecord } from './watch.js';
import type { PullResponse, RosterResponse } from './contract.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';
import { ROAM_ON } from '../../src/game/roamflag.js';

const NOW = 1_900_000_000_000;
// Админы — свои в каждом тесте: ведро частоты запросов (`http.allow`) живёт в процессе.
const ADMIN = 401;
const ADMINS = [ADMIN, 411, 421, 431];
let home: Home;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  home = sqliteHome();
  for (const k of ['TELEGRAM_BOT_TOKEN', 'TRIBE_SPAWN', 'ADMIN_IDS']) saved[k] = process.env[k];
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
  process.env.TRIBE_SPAWN = 'sicily';
  process.env.ADMIN_IDS = ADMINS.join(',');
});
afterEach(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await home.close();
});

const io = (now: number) => ({ stores: home.stores, now, ip: null });
const signed = (id: number, now: number) => ({ 'x-telegram-init-data': signInit(id, Math.floor(now / 1000) - 60), 'content-type': 'application/json' });

async function call(id: number, now: number, method: 'GET' | 'PUT' | 'POST', body?: unknown): Promise<{ status: number; data: RosterResponse }> {
  const req = new Request('https://x/api/castles', { method, headers: signed(id, now), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const res = await ROUTES['/api/castles'](req, io(now));
  return { status: res.status, data: res.status === 200 ? ((await res.json()) as RosterResponse) : ({} as RosterResponse) };
}
const seat = (id: number, now: number) => call(id, now, 'POST', { op: 'seat', name: `Герой ${id}`, prestige: 0, men: 6 });
const castle = (id: number, now: number) => call(id, now, 'PUT', { name: `Вождь ${id}`, city: 'Энна', power: 1, pop: 1 });

async function roster() {
  const found = await home.stores(STORES.world).getWithMetadata(ROSTER_KEY);
  return readRoster(found ? JSON.parse(String(found.data)) : null);
}
async function flags(id: number) {
  const found = await home.stores(STORES.watch, 'strong').getWithMetadata(`tg-${id}`);
  return readWatchRecord(found ? JSON.parse(String(found.data)) : null).flags;
}

describe('Путь меча на сервере — по игроку', () => {
  it('граница: путь не выпущен, админ в списке, игрок — нет', () => {
    expect(ROAM_ON).toBe(false);
    expect(isAdmin(ADMIN)).toBe(true);
    expect(isAdmin(402)).toBe(false);
  });

  it('админ встаёт отрядом; игроку — 403 без флага, строки отряда у него нет', async () => {
    const a = await seat(ADMIN, NOW);
    expect(a.status).toBe(200);
    expect(a.data.band, 'админу сервер назначил место выхода').toBeDefined();
    const p = await seat(402, NOW + 1000);
    expect(p.status).toBe(403);
    expect(await flags(402)).toEqual([]);
    const f = await roster();
    expect(Object.keys(f.bands ?? {})).toEqual([`tg-${ADMIN}`]);
  });

  it('строка отряда админа видна только ему и переживает запись реестра игроком', async () => {
    expect((await seat(ADMIN, NOW)).status).toBe(200);
    expect((await roster()).bands?.[`tg-${ADMIN}`], 'граница: строка отряда лежит').toBeDefined();
    const put = await castle(402, NOW + 60_000);
    expect(put.status).toBe(200);
    expect([put.data.band, put.data.bands, put.data.seen]).toEqual([undefined, undefined, undefined]);
    const get = await call(402, NOW + 120_000, 'GET');
    expect([get.data.band, get.data.bands, get.data.seen]).toEqual([undefined, undefined, undefined]);
    const f = await roster();
    expect(f.rows['tg-402'], 'замок игрока записан').toBeDefined();
    expect(f.bands?.[`tg-${ADMIN}`], 'запись игрока не уронила строку отряда').toBeDefined();
    expect((await call(ADMIN, NOW + 180_000, 'GET')).data.band?.name).toBe(`Герой ${ADMIN}`);
  });

  it('админ, вставший замком новой партией, входит в путь: строка замка уходит, чужие строки целы', async () => {
    const id = 411;
    expect((await castle(id, NOW)).status).toBe(200);
    expect((await castle(412, NOW + 1000)).status).toBe(200);
    const before = await roster();
    expect(before.rows[`tg-${id}`], 'граница: у админа замок').toBeDefined();
    const a = await seat(id, NOW + 60_000);
    expect(a.status).toBe(200);
    expect(a.data.error).toBeUndefined();
    expect(a.data.mine).toBeNull();
    const after = await roster();
    expect(after.rows[`tg-${id}`]).toBeUndefined();
    expect(after.bands?.[`tg-${id}`]).toBeDefined();
    expect(after.rows['tg-412']).toEqual(before.rows['tg-412']);
    expect(await flags(id)).toEqual([]);
  });

  it('игрок с замком приказом отряда в путь не входит: 403, строка замка цела', async () => {
    expect((await castle(413, NOW)).status).toBe(200);
    expect((await seat(413, NOW + 60_000)).status).toBe(403);
    const f = await roster();
    expect(f.rows['tg-413']).toBeDefined();
    expect(f.bands?.['tg-413']).toBeUndefined();
  });

  it('записка админки называет админа админом, игрока — нет', async () => {
    const get = async (id: number) => {
      const res = await ROUTES['/api/save'](new Request('https://x/api/save', { method: 'GET', headers: signed(id, NOW) }), io(NOW));
      return ((await res.json()) as PullResponse).admin;
    };
    expect((await get(421))?.admin).toBe(true);
    expect(await get(422)).not.toHaveProperty('admin');
  });
});
