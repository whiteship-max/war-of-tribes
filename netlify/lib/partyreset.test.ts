// Обнуление партии одного игрока (30.10.2026, `partyreset.resetParty`): архив → стирание → метка. Трогает только его записи — чужие
// партии и наблюдение остаются байт в байт, с теми же ETag; метку несёт записка админки только ему.
//
// Граница области — утверждениями: у обоих игроков правда лежат партия и наблюдение до обнуления — иначе «стёрто» и «цело» мерили бы
// пустоту.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from './routes/index.js';
import { STORES } from './kv.js';
import { LOG_KEY, readAdminLog } from './admin.js';
import { archiveKey, resetKey, resetOf, resetParty } from './partyreset.js';
import type { PullResponse } from './contract.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';

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
const signed = (id: number, now: number) => ({ 'x-telegram-init-data': signInit(id, Math.floor(now / 1000) - 60) });

async function put(store: string, key: string, v: unknown): Promise<void> {
  await home.stores(store as never, 'strong').setJSON(key, v);
}
async function raw(store: string, key: string): Promise<{ data: string; etag: string | null } | null> {
  const got = await home.stores(store as never, 'strong').getWithMetadata(key);
  return got ? { data: String(got.data), etag: got.etag ?? null } : null;
}

async function seed(): Promise<void> {
  for (const k of ['tg-501', 'tg-502']) {
    await put(STORES.saves, k, { game: `{"party":"${k}"}`, rev: 7, updatedAt: NOW - 1000 });
    await put(STORES.watch, k, { v: 1, flags: [], seen: 3, who: k });
  }
}

describe('обнуление партии — только своей', () => {
  it('архив целиком, стёрты партия и наблюдение, метка и строка журнала; чужие записи — байт в байт', async () => {
    await seed();
    const other = { save: await raw(STORES.saves, 'tg-502'), watch: await raw(STORES.watch, 'tg-502') };
    const mine = { save: await raw(STORES.saves, 'tg-501'), watch: await raw(STORES.watch, 'tg-501') };
    expect([other.save, other.watch, mine.save, mine.watch].every(Boolean), 'граница: у обоих есть партия и наблюдение').toBe(true);

    const done = await resetParty(home.stores, 'tg-501', 0, NOW);
    expect(done).toEqual({ archive: archiveKey('tg-501', NOW), save: true, watch: true, at: NOW });

    expect(await raw(STORES.saves, 'tg-501')).toBeNull();
    expect(await raw(STORES.watch, 'tg-501')).toBeNull();
    expect(await raw(STORES.saves, 'tg-502')).toEqual(other.save);
    expect(await raw(STORES.watch, 'tg-502')).toEqual(other.watch);

    const arch = JSON.parse((await raw(STORES.admin, archiveKey('tg-501', NOW)))!.data);
    expect(arch.save.data).toBe(mine.save!.data);
    expect(arch.watch.data).toBe(mine.watch!.data);
    expect(await resetOf(home.stores, 'tg-501')).toBe(NOW);
    expect(await resetOf(home.stores, 'tg-502')).toBe(0);
    const log = readAdminLog(JSON.parse((await raw(STORES.admin, LOG_KEY))!.data));
    expect(log.list.at(-1)).toMatchObject({ who: 'tg-501', at: NOW });
  });

  it('записка админки несёт метку только обнулённому; повтор ставит метку новее', async () => {
    await seed();
    await resetParty(home.stores, 'tg-501', 0, NOW);
    const note = async (id: number, now: number) => {
      const res = await ROUTES['/api/save'](new Request('https://x/api/save', { method: 'GET', headers: signed(id, now) }), io(now));
      return (await res.json()) as PullResponse;
    };
    const mine = await note(501, NOW + 1000);
    expect(mine.record, 'партии на сервере нет').toBeNull();
    expect(mine.admin?.reset).toBe(NOW);
    expect((await note(502, NOW + 1000)).admin).not.toHaveProperty('reset');
    await resetParty(home.stores, 'tg-501', 0, NOW + 5000);
    expect(JSON.parse((await raw(STORES.admin, resetKey('tg-501')))!.data).at).toBe(NOW + 5000);
  });

  it('чужой ключ не того вида — отказ, ничего не тронуто', async () => {
    await seed();
    expect(await resetParty(home.stores, 'tg-*', 0, NOW)).toMatch(/не похож/);
    expect(await raw(STORES.saves, 'tg-501')).not.toBeNull();
  });
});
