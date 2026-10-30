// Пул вольных замков в реестре (ПН-10, docs/gdd/path_of_sword.md, 6.4): размер от числа бродяг, клетки — где может стоять замок, клетки
// пула — занятые места расселения; строки пула переживают любую запись реестра.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BandRow, CastleClaim, RosterFile, RosterResponse } from './contract.js';
import { ROSTER_KEY, emptyRoster, fillFree, placeNew, prune, readRoster, spotsOf, upsert, type FreeHold } from './roster.js';
import { ROUTES } from './routes/index.js';
import { STORES } from './kv.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';
import { freeId, freePoolSize } from '../../src/world/freecastle.js';
import { fitToSettle } from '../../src/world/settle.js';
import { roamSeat } from '../../src/world/roam.js';
import { SETTLE_GAP } from '../../src/world/data/tuning.js';

const T0 = 1_900_000_000_000;
const claim = (name: string): CastleClaim => ({ name, city: name, power: 100, pop: 50 });

function lords(n: number): RosterFile {
  let r = emptyRoster();
  for (let i = 0; i < n; i++) r = upsert(r, `tg-${4000 + i}`, claim(`Лорд ${i}`), T0);
  return r;
}

const bands = (n: number): Record<string, BandRow> =>
  Object.fromEntries(Array.from({ length: n }, (_, i) => [`tg-${5000 + i}`, { way: roamSeat({ x: 0, y: 0 }, T0).way, born: T0, name: 'Б', prestige: 0, men: 5, seenAt: T0 }]));

const gap = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('ПН-10: пул вольных замков', () => {
  it('размер — max(базовый, ceil(бродяг × доля)); клетки — где может стоять замок, в зазоре от всех замков; повтор ставит то же', () => {
    for (const n of [0, 3, 20]) {
      const base = { ...lords(4), bands: bands(n) };
      const r = fillFree(base, T0, {}, null);
      const free = Object.entries(r.free ?? {});
      expect(free.length, `${n} бродяг`).toBe(freePoolSize(n));
      expect(freePoolSize(20), 'точка внутри области: пул от бродяг больше базового').toBeGreaterThan(freePoolSize(0));
      for (const [id, f] of free) {
        expect(id).toBe(freeId(f.x, f.y));
        expect(fitToSettle(f), `клетка ${id} годна для замка`).toBe(true);
        for (const c of Object.values(base.rows)) expect(gap(f, c)).toBeGreaterThanOrEqual(SETTLE_GAP);
        for (const [other, g] of free) if (other !== id) expect(gap(f, g)).toBeGreaterThanOrEqual(SETTLE_GAP);
        expect([1, 2, 3]).toContain(f.tier);
      }
      expect(fillFree(base, T0, {}, null).free, 'повтор после проигранной записи ставит то же').toEqual(r.free);
    }
  });

  it('взятый отрядом замок пул не держит — встаёт новый; сожжённый держит', () => {
    const r = fillFree({ ...lords(2), bands: bands(0) }, T0, {}, null);
    const [first] = Object.keys(r.free ?? {});
    const hold = (fate: FreeHold['fate']): Record<string, FreeHold> => ({ [first]: { key: 'tg-1', at: T0, war: 'w1', fate } });
    expect(Object.keys(fillFree(r, T0, hold('occupy'), null).free ?? {})).toHaveLength(freePoolSize(0) + 1);
    expect(Object.keys(fillFree(r, T0, hold('burn'), null).free ?? {})).toHaveLength(freePoolSize(0));
  });

  it('клетки пула исключены из расселения: новичок не встаёт в зазор вольного замка', () => {
    const r = fillFree({ ...lords(3), bands: bands(10) }, T0, {}, null);
    expect(spotsOf(r).length, 'занятые места — замки и пул').toBe(3 + Object.keys(r.free ?? {}).length);
    for (let i = 0; i < 12; i++) {
      const at = placeNew(r, `tg-${6000 + i}`, null);
      for (const f of Object.values(r.free ?? {})) expect(gap(at, f), `новичок ${i} у вольного замка`).toBeGreaterThanOrEqual(SETTLE_GAP);
    }
  });

  it('строки пула переживают чтение, запись замка и прополку', () => {
    const r = fillFree({ ...lords(2), bands: bands(0) }, T0, {}, null);
    expect(readRoster(JSON.parse(JSON.stringify(r))).free).toEqual(r.free);
    expect(upsert(r, 'tg-7000', claim('Новый'), T0 + 1).free).toEqual(r.free);
    expect(prune(r, T0 + 400 * 24 * 3_600_000, 'tg-7000').free, 'вольные замки не забываются').toEqual(r.free);
  });
});

describe('ПН-10: вольные замки видят только те, у кого путь открыт', () => {
  const saved: Record<string, string | undefined> = {};
  let home: Home;
  beforeEach(() => {
    home = sqliteHome();
    for (const k of ['TELEGRAM_BOT_TOKEN', 'ADMIN_IDS']) saved[k] = process.env[k];
    process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
    process.env.ADMIN_IDS = '901';
  });
  afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await home.close();
  });

  const ask = async (id: number): Promise<RosterResponse> => {
    const headers = { 'x-telegram-init-data': signInit(id, Math.floor(T0 / 1000) - 60) };
    const res = await ROUTES['/api/castles'](new Request('https://x/api/castles', { headers }), { stores: home.stores, now: T0, ip: null });
    return (await res.json()) as RosterResponse;
  };

  it('лорду — ни одной строки пула, админу на пути — замки рядом с отрядом', async () => {
    const lords3 = lords(3);
    const at = Object.values(lords3.rows)[0];
    const base: RosterFile = { ...lords3, bands: { 'tg-901': { way: roamSeat({ x: at.x, y: at.y }, T0).way, born: T0, name: 'Админ', prestige: 0, men: 5, seenAt: T0 } } };
    const r = fillFree(base, T0, {}, null);
    await home.stores(STORES.world, 'strong').setJSON(ROSTER_KEY, r);
    expect(Object.keys(r.free ?? {}).length, 'точка внутри области: пул стоит').toBeGreaterThan(0);
    expect((await ask(902)).free, 'путь закрыт — пула в ответе нет').toBeUndefined();
    const open = await ask(901);
    expect(open.free?.length, 'путь открыт — замки рядом').toBeGreaterThan(0);
    for (const f of open.free ?? []) expect(r.free?.[f.id]).toMatchObject({ x: f.x, y: f.y, tier: f.tier });
  });
});
