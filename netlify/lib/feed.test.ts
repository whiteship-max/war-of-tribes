import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORES } from './kv.js';
import { ROUTES } from './routes/index.js';
import { emptyRoster, upsert, ROSTER_KEY, castleIdOf, readRoster } from './roster.js';
import { WARS_KEY, emptyWars, type SpyRow, type WarFile, type WarRow } from './war.js';
import { FEED_KEEP_MS, FEED_KEY, LEADER_QUIET_MS, emptyLeaders, feedOf, nextLeaders, readLeaders, type LeaderFile } from './feed.js';
import type { FeedItem, FeedResponse, RosterFile, WatchCard } from './contract.js';
import { SICILY } from '../../src/world/spawn.js';
import { theatreAt, theatres } from '../../src/world/theatre/theatre.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';

/**
 * Вести края (docs/feed.md). Записи подделываются на входе — запись войн, реестр, память первых мест — и проверяется,
 * что лента выводит из них ровно то, что можно знать: тайное без имени, имя — у пойманного; чужой регион не виден; смена
 * первого места — одна на час и не при равенстве; клиент ленту не пишет.
 */
const NOW = 1_800_000_000_000;
const H = 3600_000;
const A = 'tg-1';
const B = 'tg-2';
const C = 'tg-3';

/** Точка вне региона острова: клетка другого региона. */
function farCell(): { x: number; y: number } {
  const t = theatres().find((x) => x.id !== theatreAt(SICILY[0].x, SICILY[0].y)?.id)!;
  for (let y = t.box.y; y < t.box.y + t.box.h; y++) for (let x = t.box.x; x < t.box.x + t.box.w; x++) if (theatreAt(x, y)?.id === t.id) return { x, y };
  throw new Error('нет клетки');
}

/** Реестр: A, B — на острове, C — в другом регионе; все встали неделю назад, вне ленты. */
function roster(): RosterFile {
  let r = emptyRoster();
  r = upsert(r, A, { name: 'Андрей', city: 'Катания', power: 1, pop: 1 }, NOW - 8 * 24 * H);
  r = upsert(r, B, { name: 'Борис', city: 'Энна', power: 1, pop: 1 }, NOW - 8 * 24 * H);
  r = upsert(r, C, { name: 'Вера', city: 'Толедо', power: 1, pop: 1 }, NOW - 8 * 24 * H);
  const rows = { ...r.rows };
  rows[A] = { ...rows[A], x: SICILY[0].x, y: SICILY[0].y };
  rows[B] = { ...rows[B], x: SICILY[1].x, y: SICILY[1].y };
  rows[C] = { ...rows[C], ...farCell() };
  return { ...r, rows };
}

const at = (key: string, r: RosterFile) => ({ x: r.rows[key].x, y: r.rows[key].y });

function war(r: RosterFile, over: Partial<WarRow>, atk = A, def = B): WarRow {
  return {
    id: 'w1',
    atk,
    def,
    atkCastle: castleIdOf(atk),
    defCastle: castleIdOf(def),
    atkCity: r.rows[atk].city ?? '',
    defCity: r.rows[def].city ?? '',
    from: at(atk, r),
    to: at(def, r),
    mode: 'siege',
    fate: 'plunder',
    sentAt: NOW - 10 * H,
    arriveAt: NOW - 8 * H,
    phase: 'camp',
    army: { troops: { spearman: 10 }, resolve: 0, pips: {}, energy: { value: 100, at: NOW, mode: 'fill' } },
    battles: [],
    ...over,
  } as WarRow;
}

function spy(r: RosterFile, deed: SpyRow['deed'], out: Partial<NonNullable<SpyRow['out']>>, atk = A, def = B): SpyRow {
  return {
    id: 's1',
    atk,
    def,
    deed,
    atkCastle: castleIdOf(atk),
    atkCity: r.rows[atk].city ?? '',
    defCastle: castleIdOf(def),
    defCity: r.rows[def].city ?? '',
    from: at(atk, r),
    to: at(def, r),
    sentAt: NOW - 3 * H,
    arriveAt: NOW - 2 * H,
    chance: 0.5,
    peril: 0.1,
    phase: 'back',
    stealth: 0.3,
    heldMs: 0,
    out: { at: NOW - 2 * H, ok: false, slipped: false, held: false, dead: false, ...out },
  } as SpyRow;
}

const feed = (r: RosterFile, wars: Partial<WarFile>, me = B, leaders: LeaderFile = emptyLeaders()): FeedItem[] =>
  feedOf({ wars: { ...emptyWars(), ...wars }, roster: r, leaders }, me, NOW);

describe('вести края: что выводится из записи войн', () => {
  it('осада и падение голодом — две записи, с именем осаждавшего и сроком осады', () => {
    const r = roster();
    const w = war(r, { phase: 'done', end: 'taken', endAt: NOW - H, fall: { at: NOW - H, fate: 'plunder', by: 'hunger' } as WarRow['fall'] });
    const items = feed(r, { wars: [w] });
    expect(items.map((x) => x.kind)).toEqual(['fell', 'siege']);
    expect(items[0]).toMatchObject({ city: 'Энна', byCity: 'Катания', byRuler: 'Андрей', how: 'hunger', siegeMs: 7 * H, mine: true });
    expect(items[1]).toMatchObject({ at: NOW - 8 * H, x: SICILY[1].x, y: SICILY[1].y });
  });

  it('осада снята без падения — «выстоял», как кончилась; штурм с ходу отбит — «отбил штурм»', () => {
    const r = roster();
    const lifted = war(r, { id: 'w1', phase: 'back', end: 'retreat', endAt: NOW - H });
    const repelled = war(r, { id: 'w2', mode: 'storm', phase: 'back', end: 'beaten', endAt: NOW - 8 * H });
    const items = feed(r, { wars: [lifted, repelled] });
    expect(items.map((x) => `${x.kind}:${x.how ?? ''}`)).toEqual(['lifted:retreat', 'repelled:', 'siege:']);
  });

  it('отозванный поход и поход в пути в ленту не попадают: о походе знает только защитник', () => {
    const r = roster();
    const going = war(r, { id: 'w1', phase: 'march', arriveAt: NOW + H });
    const recalled = war(r, { id: 'w2', phase: 'back', end: 'recalled', endAt: NOW - 9 * H });
    expect(feed(r, { wars: [going, recalled] })).toEqual([]);
  });

  it('у удавшегося тайного дела нет имени нападающего; у пойманного — есть', () => {
    const r = roster();
    const fire = spy(r, 'fire', { ok: true });
    const fireItem = feed(r, { spies: [fire] }, C);
    // Чужой регион — в ленте C записи нет вовсе (ниже); у соседа по острову — есть, без имени.
    expect(fireItem).toEqual([]);
    const items = feed(r, { spies: [fire] }, B);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'spy', how: 'fire', city: 'Энна' });
    expect(JSON.stringify(items[0])).not.toMatch(/Катания|Андрей|tg-/);
    expect(items[0].byCity).toBeUndefined();

    const caught = feed(r, { spies: [spy(r, 'theft', { held: true })] }, B);
    expect(caught[0]).toMatchObject({ kind: 'caught', how: 'held', byCity: 'Катания', byRuler: 'Андрей' });
    const dead = feed(r, { spies: [spy(r, 'unrest', { dead: true })] }, B);
    expect(dead[0]).toMatchObject({ kind: 'caught', how: 'dead', byCity: 'Катания' });
  });

  it('разведка и тихий провал следа не оставляют', () => {
    const r = roster();
    expect(feed(r, { spies: [spy(r, 'look', { ok: true, intel: { home: {}, army: {}, militia: 0, archers: 0, pop: 1, power: 1 } })] })).toEqual([]);
    expect(feed(r, { spies: [spy(r, 'fire', { ok: false, slipped: true })] })).toEqual([]);
  });

  it('удача тайного дела у нападающего не «своя»: отметки нет, чтобы не выдать его соседям по экрану', () => {
    const r = roster();
    const items = feed(r, { spies: [spy(r, 'fire', { ok: true })] }, A);
    expect(items).toHaveLength(1);
    expect(items[0].mine).toBeUndefined();
  });
});

describe('вести края: регион, срок, новый сосед', () => {
  it('чужой регион не виден: война на острове не попадает в ленту города в другом регионе', () => {
    const r = roster();
    const w = war(r, {});
    expect(feed(r, { wars: [w] }, B).length).toBeGreaterThan(0);
    expect(feed(r, { wars: [w] }, C)).toEqual([]);
  });

  it('замка в реестре нет — ленты нет', () => {
    expect(feed(roster(), { wars: [war(roster(), {})] }, 'tg-99')).toEqual([]);
  });

  it('старше недели и из будущего — не показываются', () => {
    const r = roster();
    const old = war(r, { phase: 'done', end: 'retreat', arriveAt: NOW - FEED_KEEP_MS - 2 * H, endAt: NOW - FEED_KEEP_MS - H });
    expect(feed(r, { wars: [old] })).toEqual([]);
    const fresh = war(r, { arriveAt: NOW - H });
    expect(feed(r, { wars: [fresh] }).map((x) => x.kind)).toEqual(['siege']);
  });

  it('новый сосед — из отметки реестра `since`; стоящая строка её не меняет', () => {
    let r = roster();
    r = upsert(r, 'tg-4', { name: 'Олег', city: 'Сиракузы', power: 1, pop: 1 }, NOW - H);
    r = { ...r, rows: { ...r.rows, 'tg-4': { ...r.rows['tg-4'], x: SICILY[2].x, y: SICILY[2].y } } };
    const again = upsert(r, 'tg-4', { name: 'Олег', city: 'Сиракузы', power: 5, pop: 5 }, NOW);
    expect(again.rows['tg-4'].since).toBe(NOW - H);
    // Реестр переживает запись и чтение с отметкой.
    expect(readRoster(JSON.parse(JSON.stringify(again))).rows['tg-4'].since).toBe(NOW - H);
    const items = feed(again, {}, B);
    expect(items).toEqual([expect.objectContaining({ kind: 'settled', city: 'Сиракузы', ruler: 'Олег', at: NOW - H })]);
    expect(feed(again, {}, 'tg-4')[0].mine).toBe(true);
  });
});

describe('вести края: первое место', () => {
  const ranked = (...rows: [string, number][]) => rows.map(([key, place]) => ({ key, place }));

  it('смена записывается, когда первый один и он другой', () => {
    const one = nextLeaders(emptyLeaders(), ranked([A, 1], [B, 2]), NOW);
    expect(one?.list).toEqual([{ key: A, at: NOW }]);
    expect(nextLeaders(one!, ranked([A, 1], [B, 2]), NOW + 2 * H)).toBeNull();
    expect(nextLeaders(one!, ranked([B, 1], [A, 2]), NOW + 2 * H)?.list.map((x) => x.key)).toEqual([A, B]);
  });

  it('делят первое место — смены нет; прошло меньше часа — смены нет', () => {
    const one = nextLeaders(emptyLeaders(), ranked([A, 1]), NOW)!;
    expect(nextLeaders(one, ranked([B, 1], [A, 1]), NOW + 2 * H)).toBeNull();
    // Точка внутри области: час ещё не прошёл.
    expect(LEADER_QUIET_MS - 1).toBeLessThan(LEADER_QUIET_MS);
    expect(nextLeaders(one, ranked([B, 1], [A, 2]), NOW + LEADER_QUIET_MS - 1)).toBeNull();
    expect(nextLeaders(one, ranked([B, 1], [A, 2]), NOW + LEADER_QUIET_MS)).not.toBeNull();
  });

  it('смена первого места видна всем регионам: рейтинг один на мир', () => {
    const r = roster();
    const leaders: LeaderFile = { v: 1, list: [{ key: A, at: NOW - H }] };
    expect(feed(r, {}, C, leaders)).toEqual([expect.objectContaining({ kind: 'leader', city: 'Катания', ruler: 'Андрей' })]);
  });

  it('испорченная память читается пустой', () => {
    expect(readLeaders({ v: 2 })).toEqual(emptyLeaders());
    expect(readLeaders({ v: 1, list: [{ key: 5 }, { key: A, at: NOW }] }).list).toEqual([{ key: A, at: NOW }]);
  });
});

describe('вести края: адрес', () => {
  let home: Home;
  let saved: string | undefined;
  beforeEach(() => {
    home = sqliteHome();
    saved = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
  });
  afterEach(async () => {
    if (saved === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = saved;
    await home.close();
  });

  const card = (troops: Record<string, number>): WatchCard =>
    ({ build: 'v1', city: '', clock: NOW, time: 1, level: 1, buildings: { town_hall: 1 }, pop: 10, stock: {}, prod: {}, cap: 1, troops, queued: 0, away: 0, caravans: 0, wounded: 0, train: 6, deeds: 0, won: 0, lost: 0, lairs: 0, raids: 0, games: 0, haul: 0, haulCap: 0, cheated: false, lead: 0, seen: 0 }) as WatchCard;

  async function ask(id: number | null, method = 'GET', body?: string) {
    const req = new Request('https://x/api/feed', {
      method,
      body,
      headers: id === null ? {} : { 'x-telegram-init-data': signInit(id, Math.floor(NOW / 1000) - 60) },
    });
    const res = await ROUTES['/api/feed'](req, { stores: home.stores, now: NOW, ip: null });
    return { status: res.status, body: (await res.json()) as FeedResponse };
  }

  it('без подписи — 401; записи не принимаются — только GET', async () => {
    expect((await ask(null)).status).toBe(401);
    expect((await ask(2, 'POST', JSON.stringify({ items: [{ kind: 'fell' }] }))).status).toBe(405);
  });

  it('отдаёт ленту из записи войн и запоминает первое место один раз', async () => {
    const r = roster();
    await home.stores(STORES.world).setJSON(ROSTER_KEY, r);
    await home.stores(STORES.world).setJSON(WARS_KEY, { ...emptyWars(), wars: [war(r, {})] });
    await home.stores(STORES.watch).setJSON(A, { v: 1, first: NOW, last: NOW, name: 'Андрей', power: 1, card: card({ spearman: 50 }), cardAt: NOW });
    await home.stores(STORES.watch).setJSON(B, { v: 1, first: NOW, last: NOW, name: 'Борис', power: 1, card: card({}), cardAt: NOW });

    const got = await ask(2);
    expect(got.status).toBe(200);
    expect(got.body.items.map((x) => x.kind)).toEqual(['leader', 'siege']);
    expect(JSON.stringify(got.body)).not.toMatch(/tg-\d/);
    const mem = readLeaders(JSON.parse(String((await home.stores(STORES.world).getWithMetadata(FEED_KEY))!.data)));
    expect(mem.list).toEqual([{ key: A, at: NOW }]);
    // Второе чтение той же минутой ничего не дописывает.
    await ask(1);
    const mem2 = readLeaders(JSON.parse(String((await home.stores(STORES.world).getWithMetadata(FEED_KEY))!.data)));
    expect(mem2.list).toHaveLength(1);
  });
});
