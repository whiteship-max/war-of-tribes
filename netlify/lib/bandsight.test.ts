// Видимость отрядов бродяг на сервере (ПН-4у, docs/gdd/path_of_sword.md, 3.5.4, 6.6 и «Решения ПН-4у»): обнаружение считает сервер
// сам — дверью `world/sight` по ходу, земле, часам и сезону отряда; ставит часы по событию (приказ), а чтение ничего не пишет;
// клиентское «меня не видно» не читается; часы, отставшие без долгой отлучки, — флаг. Путь включён подменой модуля (как в
// `band.test.ts`); выключенный — `bandoff.test.ts`.
//
// Граница области — утверждениями (правило 11): «видит» — отряд правда внутри радиуса × заметность, «не видит» — правда снаружи;
// часы правда отстали больше допуска и правда без отлучки дольше потолка догона.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from './routes/index.js';
import { STORES } from './kv.js';
import { ROSTER_KEY, readRoster } from './roster.js';
import { readWatchRecord, type FlagKind } from './watch.js';
import type { BandRow, RosterFile, RosterResponse } from './contract.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';
import { CLOCK_SLACK, bandTime, clockAt, clockLag, lookOfRow, rowConspicuity } from './bandsight.js';
import { detectRange } from '../../src/world/sight.js';
import { roamSeat } from '../../src/world/roam.js';
import { settleable } from '../../src/world/land.js';
import { gameSecondsOfMs, realMs } from '../../src/game/pace.js';
import { DAY_LENGTH, MAX_OFFLINE_DAYS } from '../../src/game/constants.js';

vi.mock('../../src/game/roamflag.js', () => ({ ROAM_ON: true }));

const NOW = 1_900_000_000_000;
let home: Home;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  home = sqliteHome();
  for (const k of ['TELEGRAM_BOT_TOKEN', 'TRIBE_SPAWN']) saved[k] = process.env[k];
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
  delete process.env.TRIBE_SPAWN;
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

async function call(id: number, now: number, method: 'GET' | 'PUT' | 'POST', body?: unknown): Promise<RosterResponse> {
  const req = new Request('https://x/api/castles', { method, headers: signed(id, now), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const res = await ROUTES['/api/castles'](req, io(now));
  expect(res.status).toBe(200);
  return (await res.json()) as RosterResponse;
}

async function file(): Promise<{ file: RosterFile; etag: string | null }> {
  const found = await home.stores(STORES.world, 'strong').getWithMetadata(ROSTER_KEY);
  return { file: readRoster(found ? JSON.parse(String(found.data)) : null), etag: found?.etag ?? null };
}

/** Положить строку отряда в реестр прямо — место выхода сервер назначил бы далеко от замков, а здесь нужен отряд у стен. */
async function putBand(key: string, row: BandRow): Promise<void> {
  const { file: f } = await file();
  await home.stores(STORES.world, 'strong').setJSON(ROSTER_KEY, { ...f, bands: { ...(f.bands ?? {}), [key]: row } });
}

async function flags(id: number): Promise<FlagKind[]> {
  const found = await home.stores(STORES.watch, 'strong').getWithMetadata(`tg-${id}`);
  return readWatchRecord(found ? JSON.parse(String(found.data)) : null).flags.map((f) => f.kind);
}

/** Опись партии в наблюдении: часы партии `time` пришли в минуту `at`. */
async function card(id: number, time: number, at: number): Promise<void> {
  const found = await home.stores(STORES.watch, 'strong').getWithMetadata(`tg-${id}`);
  const rec = found ? JSON.parse(String(found.data)) : {};
  await home.stores(STORES.watch, 'strong').setJSON(`tg-${id}`, { ...rec, card: { time }, cardAt: at });
}

const bandRow = (at: { x: number; y: number }, over: Partial<BandRow> = {}): BandRow => ({
  ...roamSeat(at, NOW),
  camp: { kind: 'hidden', since: NOW, builders: 20 },
  born: NOW,
  name: 'Ратко',
  prestige: 3,
  men: 20,
  seenAt: NOW,
  clock: { time: 0, at: NOW },
  ...over,
});

/**
 * Клетки суши у замка `c`: первая, где отряд (скрытый лагерь, 20 человек) правда внутри обнаружения, и первая — правда снаружи,
 * но **внутри живого круга замка**: там решает заметность, а не радиус, и мерка «только радиус» видела бы отряд.
 */
function spots(c: { x: number; y: number }, now: number): { inside: { x: number; y: number }; outside: { x: number; y: number } } {
  let inside: { x: number; y: number } | null = null;
  let outside: { x: number; y: number } | null = null;
  const live = detectRange({ kind: 'castle', at: c }, 1);
  for (let d = 2; d < 60 && !(inside && outside); d++) {
    for (const at of [{ x: c.x + d, y: c.y }, { x: c.x - d, y: c.y }, { x: c.x, y: c.y + d }, { x: c.x, y: c.y - d }]) {
      if (!settleable(at.x, at.y)) continue;
      const r = detectRange({ kind: 'castle', at: c }, rowConspicuity(bandRow(at), now));
      if (!inside && d <= r - 0.5) inside = at;
      if (!outside && d >= r + 0.5 && d < live) outside = at;
    }
  }
  if (!inside || !outside) throw new Error('нет клеток у замка');
  return { inside, outside };
}

describe('сервер считает обнаружение сам', () => {
  it('замок видит отряд в радиусе × заметность и не видит за ним; чужой отряд — живьём, без цели хода', async () => {
    const lord = await call(101, NOW, 'PUT', { name: 'Вождь', city: 'Энна', power: 1, pop: 1 });
    const c = lord.mine!;
    const { inside, outside } = spots(c, NOW + 1000);
    await putBand('tg-201', bandRow(inside));
    await putBand('tg-202', bandRow(outside, { name: 'Дальний' }));
    const seen = await call(101, NOW + 1000, 'GET');
    expect(seen.bands?.map((b) => b.name)).toEqual(['Ратко']);
    const b = seen.bands![0];
    expect(b.at).toEqual(inside);
    expect(b.men).toBe(20);
    expect(b.camp).toBe('hidden');
    // Наблюдателю — колонна и место, но не ключ игрока и не цель хода.
    expect(JSON.stringify(b)).not.toMatch(/tg-201|"to"|"way"/);
    expect(b.id).toMatch(/^c[0-9a-z]+$/);
  });

  it('кто видит наш отряд: замок — по имени; стоящий отряд — по имени, только если и мы его видим', async () => {
    const lord = await call(102, NOW, 'PUT', { name: 'Вождь', city: 'Энна', power: 1, pop: 1 });
    const { inside } = spots(lord.mine!, NOW + 1000);
    await putBand('tg-211', bandRow(inside));
    const me = await call(211, NOW + 1000, 'GET');
    expect(me.seen).toEqual({ count: 1, by: [{ kind: 'castle', id: expect.any(String), name: 'Вождь', city: 'Энна' }] });
    // Чужой стоящий отряд рядом: оба стоят — оба смотрят; видим друг друга — имя есть.
    const near = { x: inside.x, y: inside.y + 1 };
    await putBand('tg-212', bandRow(near, { name: 'Сосед', camp: { kind: 'open', since: NOW, builders: 20 } }));
    const both = await call(211, NOW + 2000, 'GET');
    expect(both.seen?.count).toBe(2);
    expect(both.seen?.by.map((b) => b.name).sort()).toEqual(['Вождь', 'Сосед']);
    expect(both.bands?.map((b) => b.name)).toEqual(['Сосед']);
  });

  it('видит нас отряд, которого мы не видим, — глаз числом, без имени', async () => {
    const lord = await call(108, NOW, 'PUT', { name: 'Вождь', city: 'Энна', power: 1, pop: 1 });
    const { inside } = spots(lord.mine!, NOW + 1000);
    // Мы — открытым лагерем, сосед — скрытым одиночкой: он видит нас дальше, чем мы его. Граница — утверждением.
    const me = bandRow(inside, { camp: { kind: 'open', since: NOW, builders: 20 } });
    let hid: { x: number; y: number } | null = null;
    for (let d = 1; d < 12 && !hid; d++) {
      const at = { x: inside.x, y: inside.y + d };
      const sly = bandRow(at, { men: 1 });
      const theySee = d <= detectRange({ kind: 'band', at }, rowConspicuity(me, NOW + 1000));
      const weSee = d <= detectRange({ kind: 'band', at: inside }, rowConspicuity(sly, NOW + 1000));
      if (theySee && !weSee) hid = at;
    }
    expect(hid, 'клетка, откуда нас видят, а мы — нет').not.toBeNull();
    await putBand('tg-271', me);
    await putBand('tg-272', bandRow(hid!, { men: 1, name: 'Тихий' }));
    const got = await call(271, NOW + 1000, 'GET');
    expect(got.seen?.count).toBe(2);
    expect(got.seen?.by.map((b) => b.name)).toEqual(['Вождь']);
    expect(got.bands ?? []).toEqual([]);
  });

  it('идущий отряд не смотрит: в пути наблюдателем он не бывает', async () => {
    const lord = await call(103, NOW, 'PUT', { name: 'Вождь', city: 'Энна', power: 1, pop: 1 });
    const { inside } = spots(lord.mine!, NOW + 1000);
    const walking = bandRow({ x: inside.x, y: inside.y + 1 }, { camp: undefined, way: { from: { x: inside.x, y: inside.y + 1 }, to: { x: inside.x + 30, y: inside.y + 1 }, at: NOW, until: NOW + 86_400_000 } });
    await putBand('tg-221', bandRow(inside));
    await putBand('tg-222', walking);
    const me = await call(221, NOW + 1000, 'GET');
    expect(me.seen?.by.map((b) => b.kind)).toEqual(['castle']);
  });
});

describe('клиентское «меня не видно» не читается', () => {
  it('приказ с полями «скрыт», «не виден», «заметность 0» — та же строка и та же видимость, что без них', async () => {
    const lord = await call(104, NOW, 'PUT', { name: 'Вождь', city: 'Энна', power: 1, pop: 1 });
    const { inside } = spots(lord.mine!, NOW + 1000);
    await putBand('tg-231', bandRow(inside, { camp: undefined }));
    await call(231, NOW + 1000, 'POST', { op: 'camp', kind: 'open', men: 20, hidden: true, seen: false, conspicuity: 0, sight: { count: 0 } });
    // В хранилище — как записано, без чистки чтением: слова клиента о своей видимости там нет вовсе.
    const raw = await home.stores(STORES.world, 'strong').getWithMetadata(ROSTER_KEY);
    const stored = JSON.parse(String(raw?.data)).bands['tg-231'];
    expect(stored.camp.kind).toBe('open');
    expect(JSON.stringify(stored)).not.toMatch(/"hidden"|"conspicuity"|"seen"|"sight"/);
    const view = await call(104, NOW + 2000, 'GET');
    expect(view.bands?.map((b) => b.name)).toEqual(['Ратко']);
    expect(view.bands?.[0].camp).toBe('open');
  });
});

describe('расчёт по событию, а не тиком', () => {
  it('чтение реестра ничего не пишет; опрос каждую минуту — то же, что одно чтение', async () => {
    const lord = await call(105, NOW, 'PUT', { name: 'Вождь', city: 'Энна', power: 1, pop: 1 });
    const { inside } = spots(lord.mine!, NOW + 1000);
    await putBand('tg-241', bandRow(inside));
    const before = await file();
    let last: RosterResponse | null = null;
    for (let m = 1; m <= 30; m++) last = await call(105, NOW + m * 60_000, 'GET');
    const after = await file();
    expect(after.etag).toBe(before.etag);
    const once = await call(105, NOW + 30 * 60_000, 'GET');
    expect(once.bands).toEqual(last?.bands);
  });

  it('часы отряда ставит приказ — из описи партии; чтение их не трогает', async () => {
    const lord = await call(106, NOW, 'PUT', { name: 'Вождь', city: 'Энна', power: 1, pop: 1 });
    const { inside } = spots(lord.mine!, NOW + 1000);
    await putBand('tg-251', bandRow(inside, { clock: undefined, camp: undefined }));
    await card(251, 5000, NOW + 500);
    await call(106, NOW + 1000, 'GET');
    expect((await file()).file.bands?.['tg-251'].clock).toBeUndefined();
    await call(251, NOW + 2000, 'POST', { op: 'camp', kind: 'hidden', men: 20 });
    const row = (await file()).file.bands!['tg-251'];
    expect(row.clock).toEqual({ time: 5000, at: NOW + 500 });
    // Дальше часы ведёт сервер сам — дверью времени.
    expect(bandTime(row, NOW + 3_600_000)).toBe(5000 + gameSecondsOfMs(NOW + 3_600_000 - (NOW + 500)));
    expect(lookOfRow(row, NOW + 3_600_000).season).toBeDefined();
    expect(await flags(251)).toEqual([]);
  });
});

describe('подделка — флаг', () => {
  it('часы описи отстали больше допуска без долгой отлучки — флаг «time», ночь и сезон сервер ведёт своими часами', async () => {
    const lord = await call(107, NOW, 'PUT', { name: 'Вождь', city: 'Энна', power: 1, pop: 1 });
    const { inside } = spots(lord.mine!, NOW + 1000);
    await putBand('tg-261', bandRow(inside, { clock: { time: 1000, at: NOW } }));
    const hour = 3_600_000;
    // Граница: за час честные часы ушли бы на 120 игр. с; опись говорит +2 — отстали на 118, это больше допуска, а час — меньше
    // потолка догона.
    await card(261, 1002, NOW + hour);
    expect(clockLag({ time: 1000, at: NOW }, { time: 1002, at: NOW + hour })).toBeGreaterThan(CLOCK_SLACK);
    expect(hour).toBeLessThan(realMs(MAX_OFFLINE_DAYS * DAY_LENGTH));
    await call(261, NOW + hour + 1000, 'POST', { op: 'camp', kind: 'open', men: 20 });
    expect(await flags(261)).toContain('time');
    expect((await file()).file.bands!['tg-261'].clock).toEqual({ time: 1000 + gameSecondsOfMs(hour), at: NOW + hour });
  });

  it('честные часы — без флага: вровень с настоящим, в допуске и после отлучки дольше потолка догона', () => {
    const prev = { time: 1000, at: NOW };
    const hour = 3_600_000;
    expect(clockAt(prev, { time: 1000 + gameSecondsOfMs(hour) } as never, NOW + hour).flag).toBeNull();
    expect(clockAt(prev, { time: 1000 + gameSecondsOfMs(hour) - CLOCK_SLACK + 0.5 } as never, NOW + hour).flag).toBeNull();
    // Отлучка дольше потолка: догон сжал часы — отставание честное.
    const long = realMs(MAX_OFFLINE_DAYS * DAY_LENGTH) + hour;
    const after = clockAt(prev, { time: 1000 + MAX_OFFLINE_DAYS * DAY_LENGTH } as never, NOW + long);
    expect(after.flag).toBeNull();
    expect(after.clock).toEqual({ time: 1000 + MAX_OFFLINE_DAYS * DAY_LENGTH, at: NOW + long });
  });
});
