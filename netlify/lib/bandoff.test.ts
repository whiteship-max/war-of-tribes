// Путь меча закрыт (ПН-3, docs/gdd/path_of_sword.md, 7.5, У1): сервер отклоняет приказы и записи бродяги — без флага (неоткрытое
// не подделка), реестр строк отряда не читает, не пишет и не отдаёт. Выключатель здесь настоящий (`game/roamflag`); открытый путь
// держит `band.test.ts`.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from './routes/index.js';
import { STORES } from './kv.js';
import { ROSTER_KEY, bandOrder, emptyRoster, readRoster } from './roster.js';
import { readWatchRecord } from './watch.js';
import type { RosterResponse } from './contract.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';
import { ROAM_ON } from '../../src/game/roamflag.js';
import { roamSeat } from '../../src/world/roam.js';
import { SPAWNS } from '../../src/world/spawn.js';

const NOW = 1_900_000_000_000;
let home: Home;
let token: string | undefined;
beforeEach(() => {
  home = sqliteHome();
  token = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
});
afterEach(async () => {
  if (token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = token;
  await home.close();
});

const io = (now: number) => ({ stores: home.stores, now, ip: null });
const signed = (id: number, now: number) => ({ 'x-telegram-init-data': signInit(id, Math.floor(now / 1000) - 60), 'content-type': 'application/json' });

describe('Путь меча закрыт — на сервере тоже', () => {
  it('выключатель выключен', () => {
    expect(ROAM_ON).toBe(false);
  });

  it('приказ отряда — отказ 403 без флага; строки отряда в реестре не появляется', async () => {
    const req = new Request('https://x/api/castles', { method: 'POST', headers: signed(301, NOW), body: JSON.stringify({ op: 'seat', name: 'Герой', prestige: 5, men: 6 }) });
    const res = await ROUTES['/api/castles'](req, io(NOW));
    expect(res.status).toBe(403);
    const found = await home.stores(STORES.world).getWithMetadata(ROSTER_KEY);
    expect(found).toBeNull();
    const w = await home.stores(STORES.watch, 'strong').getWithMetadata('tg-301');
    expect(readWatchRecord(w ? JSON.parse(String(w.data)) : null).flags).toEqual([]);
    expect(bandOrder(emptyRoster(), 'k', { op: 'seat', name: 'x', prestige: 0, men: 1 }, NOW, null)).toEqual({ file: emptyRoster(), error: 'Путь меча ещё не открыт.', forged: null });
  });

  it('строка отряда, лежащая в хранилище, не читается и не отдаётся: замок — прежним правилом', async () => {
    const band = { ...roamSeat(SPAWNS[0], NOW), born: NOW, name: 'Чужой', prestige: 1, men: 1, seenAt: NOW };
    const raw = { ...emptyRoster(), bands: { 'tg-302': band } };
    expect(readRoster(raw).bands).toBeUndefined();
    await home.stores(STORES.world, 'strong').setJSON(ROSTER_KEY, raw);
    const put = new Request('https://x/api/castles', { method: 'PUT', headers: signed(302, NOW), body: JSON.stringify({ name: 'Вождь', city: 'Энна', power: 1, pop: 1 }) });
    const res = await ROUTES['/api/castles'](put, io(NOW));
    expect(res.status).toBe(200);
    const data = (await res.json()) as RosterResponse;
    expect(data.band).toBeUndefined();
    expect(data.error).toBeUndefined();
    expect(data.mine).not.toBeNull();
    // Видимость отрядов (ПН-4у) — тоже за выключателем: ни чужих отрядов, ни «кто видит», хоть строка отряда и лежит в хранилище.
    expect(data.bands).toBeUndefined();
    expect(data.seen).toBeUndefined();
    const get = await ROUTES['/api/castles'](new Request('https://x/api/castles', { method: 'GET', headers: signed(302, NOW + 1000) }), io(NOW + 1000));
    const read = (await get.json()) as RosterResponse;
    expect([read.bands, read.seen]).toEqual([undefined, undefined]);
    const after = await home.stores(STORES.world).getWithMetadata(ROSTER_KEY);
    expect(JSON.parse(String(after!.data)).bands, 'запись реестра строк отряда не несёт').toBeUndefined();
  });
});
