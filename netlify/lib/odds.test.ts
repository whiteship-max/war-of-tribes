// Шанс окна вольного замка на сервере (ПН-Э2г, docs/gdd/path_of_sword.md, 23.11): адрес `/api/odds` отвечает только тому, кому путь
// открыт; состав отряда — книга реестра, а не слово клиента; кэш — по версии замка и составу, и сбрасывается при любой их смене; у игрока
// не больше одного расчёта сразу; срок расчёта; строки — ровно дверь окна `freeNeeds` (одна с автопилотом).
//
// Граница области — утверждениями: путь не выпущен (`ROAM_ON`), админ в списке, игрок — нет; отряд стоит у стен замка пула (иначе
// «у стен» и вилка мерили бы не то), замок в пуле и не взят.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from './routes/index.js';
import { STORES } from './kv.js';
import { ROSTER_KEY, emptyRoster } from './roster.js';
import { WARS_KEY, emptyWars, type WarFile, type WarRow } from './war.js';
import { isAdmin } from './admin.js';
import type { BandRow, OddsResponse, RosterFile } from './contract.js';
import { BUSY, OddsDesk, TOO_LONG, countPaths, desk, inlineCounter, oddsAsk, setOddsCounter, type OddsAsk, type OddsCounter } from './oddsdesk.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';
import { ROAM_ON } from '../../src/game/roamflag.js';
import { roamSeat } from '../../src/world/roam.js';
import { SPAWNS } from '../../src/world/spawn.js';
import { freeId } from '../../src/world/freecastle.js';
import { freeNeeds, type FreeNeedRow, type FreePathIn } from '../../src/world/freeodds.js';
import { troopTotal } from '../../src/game/battle/kinds.js';

const T0 = 1_900_000_000_000;
const C = SPAWNS[5];
const FREE = freeId(C.x, C.y);
const ADMIN = 501;
const ADMINS = [ADMIN, 502, 503, 504, 505, 506, 507];
const PLAYER = 599;
const BOOK = { spearman: 40, archer: 20 };

let home: Home;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  desk.clear();
  home = sqliteHome();
  for (const k of ['TELEGRAM_BOT_TOKEN', 'ADMIN_IDS']) saved[k] = process.env[k];
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
  process.env.ADMIN_IDS = ADMINS.join(',');
});
afterEach(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  setOddsCounter(inlineCounter);
  desk.clear();
  await home.close();
});

const band = (troops: Record<string, number>, at = { x: C.x + 1, y: C.y }): BandRow => ({
  way: roamSeat(at, T0).way,
  born: T0,
  name: 'Ватага',
  prestige: 1000,
  men: troopTotal(troops),
  seenAt: T0,
  book: { troops, join: -1, drill: 0, fights: 0, grant: 0, keys: [] },
});

const rosterOf = (bands: Record<string, BandRow>, tier: 1 | 2 | 3 = 1): RosterFile => ({
  ...emptyRoster(),
  bands,
  free: { [FREE]: { x: C.x, y: C.y, tier, born: T0 } },
});

async function put(roster: RosterFile, wars: WarFile = emptyWars()): Promise<void> {
  const kv = home.stores(STORES.world, 'strong');
  await kv.setJSON(ROSTER_KEY, roster);
  await kv.setJSON(WARS_KEY, wars);
}

async function ask(id: number, now: number, query = ''): Promise<{ status: number; data: OddsResponse }> {
  const req = new Request(`https://x/api/odds?castle=${encodeURIComponent(FREE)}${query}`, {
    headers: { 'x-telegram-init-data': signInit(id, Math.floor(now / 1000) - 60) },
  });
  const res = await ROUTES['/api/odds'](req, { stores: home.stores, now, ip: null });
  return { status: res.status, data: res.status === 200 ? ((await res.json()) as OddsResponse) : ({} as OddsResponse) };
}

/** Подставной счёт: помнит, с каким отрядом его позвали, отвечает строками пути сразу. */
function spyCounter(): { calls: FreePathIn[]; count: OddsCounter } {
  const calls: FreePathIn[] = [];
  return {
    calls,
    count: async (path) => {
      calls.push(path);
      return [{ id: 'storm', text: `штурм: ${troopTotal(path.band)} чел.`, ok: true }];
    },
  };
}

/** Бой на этом замке в записи войн: гарнизон стал меньше (`war.npcSheet` вычитает потери). */
const battleOn = (wars: WarFile, at: number): WarFile => ({
  ...wars,
  wars: [
    ...wars.wars,
    {
      id: `w${wars.wars.length + 1}`,
      atk: 'tg-other',
      def: FREE,
      phase: 'done',
      end: 'beaten',
      endAt: at,
      battles: [{ id: 'b', at, site: 'storm', by: 'atk', won: false, atkTroops: {}, atkLost: {}, homeTroops: {}, homeLost: { spearman: 30 } }],
    } as unknown as WarRow,
  ],
});

describe('ПН-Э2г: граница области', () => {
  it('путь не выпущен, админ в списке, игрок — нет; отряд стоит у стен, замок в пуле и свободен', () => {
    expect(ROAM_ON).toBe(false);
    expect(isAdmin(ADMIN)).toBe(true);
    expect(isAdmin(PLAYER)).toBe(false);
    const a = oddsAsk(rosterOf({ k: band(BOOK) }), emptyWars(), 'k', FREE, T0 + 60_000);
    expect(typeof a).toBe('object');
    const o = a as OddsAsk;
    expect(o.input.near, 'у стен').toBe(true);
    expect(o.input.look.watching, 'в круге обзора').toBe(true);
  });
});

describe('ПН-Э2г: адрес /api/odds', () => {
  it('не-админу — 403 и ни слова о замке; админу — строки', async () => {
    setOddsCounter(spyCounter().count);
    await put(rosterOf({ [`tg-${PLAYER}`]: band(BOOK), [`tg-${ADMIN}`]: band(BOOK) }));
    const no = await ask(PLAYER, T0 + 60_000);
    expect(no.status, 'не-админу — 403').toBe(403);
    const yes = await ask(ADMIN, T0 + 60_000);
    expect(yes.status).toBe(200);
    expect(yes.data.rows?.length).toBeGreaterThan(0);
  });

  it('состав — книга реестра, а не слово клиента: состав в запросе не читается', async () => {
    const spy = spyCounter();
    setOddsCounter(spy.count);
    await put(rosterOf({ [`tg-${ADMINS[1]}`]: band(BOOK) }));
    const r = await ask(ADMINS[1], T0 + 60_000, `&band=${encodeURIComponent(JSON.stringify({ knight: 999 }))}&troops=knight999`);
    expect(r.status).toBe(200);
    expect(spy.calls.length).toBe(1);
    expect(spy.calls[0].band, 'отряд счёта — книга реестра').toEqual(BOOK);
    expect(r.data.rows?.map((x) => x.text)).toContain(`штурм: ${troopTotal(BOOK)} чел.`);
  });

  it('кэш: повтор — без расчёта; смена гарнизона (бой на замке, ступень) и состава — новый расчёт', async () => {
    const spy = spyCounter();
    setOddsCounter(spy.count);
    const me = ADMINS[2];
    let wars = emptyWars();
    await put(rosterOf({ [`tg-${me}`]: band(BOOK) }), wars);
    await ask(me, T0 + 60_000);
    await ask(me, T0 + 120_000);
    expect(spy.calls.length, 'повтор — из кэша').toBe(1);
    wars = battleOn(wars, T0 + 130_000);
    await put(rosterOf({ [`tg-${me}`]: band(BOOK) }), wars);
    await ask(me, T0 + 140_000);
    expect(spy.calls.length, 'бой на замке сменил гарнизон — кэш сброшен').toBe(2);
    await put(rosterOf({ [`tg-${me}`]: band(BOOK) }, 2), wars);
    await ask(me, T0 + 150_000);
    expect(spy.calls.length, 'ступень замка сменила гарнизон — кэш сброшен').toBe(3);
    await put(rosterOf({ [`tg-${me}`]: band({ ...BOOK, archer: 21 }) }, 2), wars);
    await ask(me, T0 + 160_000);
    expect(spy.calls.length, 'состав сменился — кэш сброшен').toBe(4);
    await ask(me, T0 + 170_000);
    expect(spy.calls.length, 'тот же новый ключ — из кэша').toBe(4);
  });

  it('строки — ровно дверь окна freeNeeds (одна с автопилотом)', async () => {
    const me = ADMINS[3];
    const small = { spearman: 3 };
    await put(rosterOf({ [`tg-${me}`]: band(small) }));
    const r = await ask(me, T0 + 60_000);
    expect(r.status).toBe(200);
    const a = oddsAsk(rosterOf({ [`tg-${me}`]: band(small) }), emptyWars(), `tg-${me}`, FREE, T0 + 60_000) as OddsAsk;
    expect(r.data.rows).toEqual(freeNeeds(a.input).map(({ text, ok }) => ({ text, ok })));
  }, 120_000);
});

describe('ПН-Э2г: стол расчётов', () => {
  const a = (key: string): OddsAsk => {
    const o = oddsAsk(rosterOf({ k: band(BOOK) }), emptyWars(), 'k', FREE, T0 + 60_000) as OddsAsk;
    return { ...o, key };
  };

  it('у игрока не больше одного расчёта сразу: второй ключ ждёт, пока кончится первый', async () => {
    let free: (rows: FreeNeedRow[]) => void = () => {};
    let running = 0;
    let most = 0;
    const d = new OddsDesk(
      (path) =>
        new Promise((ok) => {
          running++;
          most = Math.max(most, running);
          free = (rows) => {
            running--;
            ok(rows);
          };
          void path;
        }),
      { perMinute: 40, holdMs: 5, calcMs: 1000, queue: 4, cache: 10, failMs: 1000 },
    );
    expect(await d.ask('p', a('k1'), T0)).toEqual({ wait: true });
    expect(await d.ask('p', a('k2'), T0)).toEqual({ wait: true });
    expect(d.started, 'второй ключ того же игрока расчёта не начал').toBe(1);
    expect(most).toBe(1);
    free([]);
    await new Promise((r) => setTimeout(r, 10));
    await d.ask('p', a('k2'), T0);
    expect(d.started, 'прежний кончился — начался второй').toBe(2);
    expect(most).toBe(1);
    free([]);
  });

  it('очередь всех игроков не длиннее предела: дальше — «сервер занят»', async () => {
    const d = new OddsDesk(() => new Promise(() => {}), { perMinute: 40, holdMs: 1, calcMs: 1000, queue: 2, cache: 10, failMs: 1000 });
    await d.ask('p1', a('a1'), T0);
    await d.ask('p2', a('a2'), T0);
    expect(await d.ask('p3', a('a3'), T0)).toEqual({ error: BUSY });
  });

  it('срок расчёта: дольше — «не посчитан», и тот же ключ не считается снова до срока памяти', async () => {
    let t = 0;
    const slow: OddsCounter = async (path, ms) => countPaths(path, ms, () => (t += 1000));
    const d = new OddsDesk(slow, { perMinute: 40, holdMs: 50, calcMs: 1500, queue: 4, cache: 10, failMs: 60_000 });
    expect(await d.ask('p', a('x'), T0)).toEqual({ error: TOO_LONG });
    expect(await d.ask('p', a('x'), T0 + 1000)).toEqual({ error: TOO_LONG });
    expect(d.started).toBe(1);
  });

  it('стол экземпляра — один (`desk`), счёт подставляется', () => {
    expect(desk).toBeInstanceOf(OddsDesk);
  });
});
