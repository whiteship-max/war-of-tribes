import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { save } from './routes/save.js';
import { war } from './routes/war.js';
import { STORES, type Kv, type Stores } from './kv.js';
import { ROSTER_KEY, castleIdOf, emptyRoster, upsert } from './roster.js';
import { emptyWars, liveSheet, WARS_KEY, type WarFile, type WarRow } from './war.js';
import { readWatchRecord } from './watch.js';
import { BOOK_SLACK, PIPS_MAX, RESOLVE_MAX, bookAfter, bookLive, deadOf, levelAt, seedBook, workAllowed, type ArmyBook } from './book.js';
import { type CastleClaim, type Counts, type WarResponse, type WarSheet, type WatchCard } from './contract.js';
import { INFIRMARY_HEAL_CAP } from '../../src/game/constants.js';
import { TROOP_BY_ID } from '../../src/game/data/troops.js';
import { trainRateAt } from '../../src/game/train.js';
import { gameSecondsOfMs } from '../../src/game/pace.js';
import { weakCity } from '../../src/world/lairs.js';
import { inHomeTheatre } from '../../src/world/theatre/theatre.js';

/**
 * Книга войска (docs/pvp.md, раздел 6): в бою между игроками участвует только войско, которое сервер может подтвердить.
 * Тесты — на подделку: подправленный клиент заявляет войско, которого нет, — и не выставляет его ни в поход, ни в
 * оборону; приказ сверх подтверждённого — отказ и флаг. И на честного: офлайн, плохая сеть и лазарет флага не дают.
 */
const T0 = 1_900_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const A = 'tg-1001';
const B = 'tg-1002';

const spearWork = TROOP_BY_ID.spearman.work;
/** Сколько копейщиков казармы уровня `level` честно выучат за `ms` настоящего времени. */
const spearsIn = (level: number, ms: number): number => Math.floor((trainRateAt(false, level) * gameSecondsOfMs(ms)) / spearWork);

describe('книга войска: подтверждает только объяснимое правилами', () => {
  it('новый игрок: заявленное с первой минуты войско не подтверждается — сервер его не видел обученным', () => {
    const step = bookAfter(seedBook(T0), T0 + MIN, { troops: { knight: 500, spearman: 300 }, buildings: { barracks: 10, stable: 10 } }, [], null, A);
    // Точка внутри области правила: за минуту честные казармы первого уровня не выучивают ни одного копейщика.
    expect(spearsIn(1, MIN)).toBe(0);
    expect(step.book.bodies).toEqual({});
    expect(step.forged).toBeGreaterThan(700);
  });

  it('честное обучение подтверждается целиком — и офлайн за восемь часов, и записями раз в минуту', () => {
    const level = 2;
    const offline = spearsIn(level, 8 * HOUR);
    expect(offline).toBeGreaterThan(10);
    const after = bookAfter(seedBook(T0), T0 + 8 * HOUR, { troops: { spearman: offline }, buildings: { barracks: level } }, [], null, A, [], { barracks: level });
    expect(after.book.bodies).toEqual({ spearman: offline });
    expect(after.forged).toBe(0);

    // Запись раз в минуту: голова выходит из казарм целиком, а дробь работы ждёт в копилке.
    let book: ArmyBook = { ...seedBook(T0 - HOUR), at: T0 };
    let forged = 0;
    let work = 0;
    let heads = 0;
    for (let t = T0 + MIN; t <= T0 + 3 * HOUR; t += MIN) {
      work += trainRateAt(false, level) * gameSecondsOfMs(MIN);
      while (work >= spearWork) {
        work -= spearWork;
        heads += 1;
      }
      const step = bookAfter(book, t, { troops: { spearman: heads }, buildings: { barracks: level } }, [], null, A, [], { barracks: level });
      book = step.book;
      forged += step.forged;
    }
    expect(heads).toBeGreaterThan(5);
    expect(book.bodies.spearman).toBe(heads);
    expect(forged).toBe(0);
  });

  it('подделка растёт не быстрее казарм: за промежуток — не больше, чем выучили бы казармы подтверждённого уровня с запасом', () => {
    // Уровень заявлен высокий, но книга стройки подтверждает ниже — казармы учат по подтверждённому (`town.buildStep`).
    const span = 40 * MIN;
    const prev = { ...seedBook(T0), at: T0 + span };
    expect(levelAt('barracks', 10, 1)).toBe(1);
    const level = levelAt('barracks', 10, 3);
    expect(level).toBe(3);
    expect(levelAt('barracks', 2, 3), 'заявлено ниже подтверждённого — по заявленному').toBe(2);
    const step = bookAfter(prev, T0 + 2 * span, { troops: { spearman: 10_000 }, buildings: { barracks: 10 } }, [], null, A, [], { barracks: 3 });
    const cap = Math.floor((trainRateAt(false, level) * gameSecondsOfMs(span) * BOOK_SLACK) / spearWork);
    expect(step.book.bodies.spearman).toBeLessThanOrEqual(cap);
    expect(step.book.bodies.spearman).toBeGreaterThan(0);
    expect(step.forged).toBeGreaterThan(9000);
  });

  it('копилка не копит пустое время: после суток простоя — не больше одной головы самого долгого вида сверх обучения', () => {
    const idle = bookAfter({ ...seedBook(T0), at: T0 }, T0 + 24 * HOUR, { troops: {}, buildings: { barracks: 1 } }, [], null, A, [], { barracks: 1 }).book;
    expect(idle.credit.barracks).toBeLessThanOrEqual(Math.max(...Object.values(TROOP_BY_ID).filter((t) => !t.mounted).map((t) => t.work)));
    const dump = bookAfter(idle, T0 + 24 * HOUR + MIN, { troops: { clubman: 1000 }, buildings: { barracks: 1 } }, [], null, A, [], { barracks: 1 });
    expect(dump.book.bodies.clubman ?? 0).toBeLessThanOrEqual(Math.ceil((idle.credit.barracks + workAllowed({ ...idle, credit: {} }, 'barracks', 1, T0 + 24 * HOUR + MIN, 1)) / TROOP_BY_ID.clubman.work));
    expect(dump.book.bodies.clubman ?? 0).toBeLessThan(10);
  });

  it('указ админа входит в книгу один раз, по номеру', () => {
    const grants = [{ n: 1, troops: { spearman: 40 } }];
    const one = bookAfter(seedBook(T0), T0 + MIN, { troops: { spearman: 40 } }, grants, null, A);
    expect(one.book.bodies).toEqual({ spearman: 40 });
    expect(one.book.grant).toBe(1);
    const two = bookAfter(one.book, T0 + 2 * MIN, { troops: { spearman: 80 } }, grants, null, A);
    expect(two.book.bodies.spearman).toBe(40);
    expect(two.forged).toBeGreaterThan(30);
  });

  it('заявленное меньше книги — книга идёт за ним: потери в походах и уход подтверждать нечего', () => {
    const prev: ArmyBook = { ...seedBook(T0), bodies: { spearman: 100, archer: 20 } };
    const step = bookAfter(prev, T0 + MIN, { troops: { spearman: 60 } }, [], null, A);
    expect(step.book.bodies).toEqual({ spearman: 60 });
  });
});

/** Война с одним боем: игрок `atk` потерял `lost` в походе. */
function warWith(lost: Counts, atk = A): WarFile {
  const file = emptyWars();
  file.wars.push({
    id: 'w1',
    atk,
    def: B,
    atkCastle: 'c1',
    defCastle: 'c2',
    atkCity: 'Альфа',
    defCity: 'Бета',
    from: { x: 0, y: 0 },
    to: { x: 1, y: 1 },
    mode: 'storm',
    fate: 'plunder',
    sentAt: T0,
    arriveAt: T0 + MIN,
    phase: 'back',
    army: { troops: {}, resolve: 0, pips: {} },
    battles: [
      {
        id: 'w1.0',
        at: T0 + MIN,
        site: 'wall',
        by: 'atk',
        input: { seed: 1, attacker: { kinds: {} }, defender: { kinds: {} } },
        won: false,
        atkTroops: { spearman: 100 },
        atkLost: lost,
        homeTroops: {},
        homeLost: {},
      },
    ],
  } as WarRow);
  return file;
}

describe('потери войны не возвращаются', () => {
  const lost = { spearman: 40 };
  const dead = deadOf({ id: 'w1.0', lost, wounds: true });
  const wounded = lost.spearman - dead.spearman;

  it('погибшие — всё, кроме доли лазарета', () => {
    expect(wounded).toBe(Math.ceil(lost.spearman * INFIRMARY_HEAL_CAP));
    expect(deadOf({ id: 'w1.fall', lost, wounds: false })).toEqual(lost);
  });

  it('клиент «принял» бой, но павших не вычел — книга вычтет их сама, и это флаг', () => {
    const prev: ArmyBook = { ...seedBook(T0 - 10 * HOUR), at: T0, bodies: { spearman: 100 } };
    const step = bookAfter(prev, T0 + 2 * MIN, { troops: { spearman: 100 } }, [], warWith(lost), A, ['w1.0']);
    expect(step.book.bodies.spearman).toBeLessThanOrEqual(100 - dead.spearman + 1);
    expect(step.book.lost).toEqual(['w1.0']);
    expect(step.forged).toBeGreaterThan(20);
    // Книга помнит вычтенное: следующая запись того же боя второй раз не вычитает.
    const again = bookAfter(step.book, T0 + 3 * MIN, { troops: { spearman: 60 }, hurt: { spearman: wounded } }, [], warWith(lost), A, ['w1.0']);
    expect(again.book.bodies.spearman).toBe(Math.min(100 - dead.spearman, 60 + wounded));
  });

  it('честный клиент с ранеными в лазарете флага не получает и ничего не теряет', () => {
    const prev: ArmyBook = { ...seedBook(T0 - 10 * HOUR), at: T0, bodies: { spearman: 100 } };
    const step = bookAfter(prev, T0 + 2 * MIN, { troops: { spearman: 60 }, hurt: { spearman: wounded } }, [], warWith(lost), A, ['w1.0']);
    expect(step.book.bodies.spearman).toBe(60 + wounded);
    expect(step.forged).toBe(0);
  });

  it('честный клиент, ещё не узнавший о бое, флага не получает', () => {
    const prev: ArmyBook = { ...seedBook(T0 - 10 * HOUR), at: T0, bodies: { spearman: 100 } };
    const step = bookAfter(prev, T0 + 2 * MIN, { troops: { spearman: 100 } }, [], warWith(lost), A, []);
    expect(step.forged).toBe(0);
    expect(step.book.bodies.spearman).toBeLessThan(100);
  });

  it('в бою — книга за вычетом боёв, которых она ещё не видела', () => {
    const book: ArmyBook = { ...seedBook(T0), bodies: { spearman: 100 } };
    expect(bookLive(book, warWith(lost), A)).toEqual({ spearman: 100 - dead.spearman });
    expect(bookLive({ ...book, lost: ['w1.0'] }, warWith(lost), A)).toEqual({ spearman: 100 });
  });
});

describe('слепок обороны: войско и гарнизон — не больше подтверждённого', () => {
  const sheet = (over: Partial<WarSheet> = {}): WarSheet => ({
    army: { swordsman: 5000, spearman: 40 },
    home: { swordsman: 5000, spearman: 40 },
    militia: 20,
    archers: 6,
    resolve: 99,
    pips: { fire: 50, shock: 50 },
    rest: 1,
    food: 2000,
    townPerHour: 20,
    perManPerHour: 1,
    stock: {},
    stash: 0,
    gold: 0,
    pop: 400,
    bonded: 0,
    levels: {},
    power: 1e9,
    locks: {},
    seen: [],
    retinue: { swordsman: 5000 },
    ...over,
  });

  it('по видам — меньшее из заявленного и книги; мощь — по подтверждённому; стойкость и отметки — в пределах правил', () => {
    const book: ArmyBook = { ...seedBook(T0), bodies: { spearman: 30 } };
    const live = liveSheet(emptyWars(), B, { sheet: sheet(), at: T0, book }, T0);
    expect(live.army).toEqual({ spearman: 30 });
    expect(live.home).toEqual({ spearman: 30 });
    expect(live.retinue).toEqual({});
    expect(live.power).toBeLessThan(1e6);
    expect(live.resolve).toBe(RESOLVE_MAX);
    expect(RESOLVE_MAX).toBeLessThan(99);
    expect(Object.values(live.pips).reduce((t, n) => t + n, 0)).toBe(PIPS_MAX);
  });
});

// ------------------------------------------------ путь через обработчики ---

const TOKEN = '123456:AA-test-token-not-a-real-one';

function memoryStores() {
  const data = new Map<string, Map<string, { value: string; etag: string }>>();
  let n = 0;
  const kv = (name: string): Kv => {
    const m = data.get(name) ?? new Map();
    data.set(name, m);
    return {
      async getWithMetadata(key) {
        const v = m.get(key);
        return v ? { data: v.value, etag: v.etag } : null;
      },
      async setJSON(key, value, opts) {
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
  const put = (store: string, key: string, value: unknown): void => {
    kv(store);
    data.get(store)?.set(key, { value: JSON.stringify(value), etag: `e${++n}` });
  };
  return { stores, json, put };
}

/** Подписанная строка запуска, выданная в минуту `at`. */
function signInit(id: number, at: number): string {
  const fields: Record<string, string> = { auth_date: String(Math.floor(at / 1000) - 60), user: JSON.stringify({ id }) };
  const check = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const p = new URLSearchParams(fields);
  p.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return p.toString();
}

const idOf = (key: string): number => Number(key.slice(3));

const card = (troops: Counts, buildings: Counts = { barracks: 1, stable: 1 }): WatchCard => ({
  build: 'v1',
  city: 'Город',
  clock: 0,
  time: 0,
  level: 1,
  buildings,
  pop: 2000,
  stock: {},
  prod: {},
  cap: 1000,
  troops,
  queued: 0,
  away: 0,
  caravans: 0,
  wounded: 0,
  train: 0,
  deeds: 0,
  won: 0,
  lost: 0,
  lairs: 0,
  raids: 0,
  games: 0,
  haul: 0,
  haulCap: 0,
  cheated: false,
  lead: 0,
  seen: 0,
});

const defence = (army: Counts, home: Counts = army): WarSheet => ({
  army,
  home,
  militia: 0,
  archers: 0,
  resolve: 0,
  pips: {},
  rest: 1,
  food: 2000,
  townPerHour: 20,
  perManPerHour: 1,
  stock: { food: 2000 },
  stash: 0,
  gold: 0,
  pop: 2000,
  bonded: 0,
  levels: {},
  power: 0,
  locks: {},
  seen: [],
});

type S = ReturnType<typeof memoryStores>;
const etags = new Map<string, string | null>();

async function push(s: S, key: string, at: number, troops: Counts, sheet: WarSheet = defence(troops)) {
  const record = { v: 1, rev: 0, updatedAt: 0, device: 'dev', game: '{}', world: null, card: { name: 'Вождь', day: 1, pop: 2000, power: 0, army: 0 }, watch: card(troops), war: sheet };
  const res = await save(
    new Request('https://x/api/save', {
      method: 'PUT',
      headers: { 'x-telegram-init-data': signInit(idOf(key), at), 'content-type': 'application/json' },
      body: JSON.stringify({ baseEtag: etags.get(key) ?? null, record }),
    }),
    { stores: s.stores, now: at, ip: null },
  );
  expect(res.status).toBe(200);
  etags.set(key, ((await res.json()) as { etag: string }).etag);
}

async function order(s: S, key: string, at: number, body?: unknown): Promise<WarResponse> {
  const res = await war(
    new Request('https://x/api/war', {
      method: body ? 'POST' : 'GET',
      headers: { 'x-telegram-init-data': signInit(idOf(key), at), ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    { stores: s.stores, now: at, ip: null },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as WarResponse;
}

const march = (troops: Counts) => ({ op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: { troops, resolve: 0, pips: {} } });

const flagsOf = (s: S, key: string): string[] => readWatchRecord(s.json(STORES.watch, key)).flags.map((f) => f.kind);

describe('подправленный клиент не выставляет в бой больше войска, чем у него есть', () => {
  const saved: Record<string, string | undefined> = {};
  let base = T0;
  beforeEach(() => {
    // Ведро частоты запросов помнит минуту ключа: время каждого теста идёт вперёд, не назад.
    base += 100 * HOUR;
    saved.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    saved.TRIBE_SPAWN = process.env.TRIBE_SPAWN;
    process.env.TELEGRAM_BOT_TOKEN = TOKEN;
    delete process.env.TRIBE_SPAWN;
    etags.clear();
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function world(): S {
    const s = memoryStores();
    const claim = (name: string): CastleClaim => ({ name, city: name, power: 0, pop: 2000 });
    let r = emptyRoster();
    r = upsert(r, A, claim('Альфа'), base);
    r = upsert(r, B, claim('Бета'), base);
    // Точки внутри области правила: один край, и защита слабого не мешает по жителям даже при войске в ноль.
    expect(inHomeTheatre(r.rows[A], r.rows[B])).toBe(true);
    expect(weakCity(2000, 0)).toBe(false);
    s.put(STORES.world, ROSTER_KEY, r);
    return s;
  }

  it('поход: заявленное войско сверх книги — отказ словами и флаг; подтверждённое — уходит', async () => {
    const s = world();
    await push(s, A, base, {});
    await push(s, B, base, {});
    // Честные десять часов казарм первого уровня, потом подделка: тысяча мечников.
    const honest = spearsIn(1, 10 * HOUR);
    expect(honest).toBeGreaterThanOrEqual(30);
    await push(s, A, base + 10 * HOUR, { spearman: 30 });
    await push(s, A, base + 10 * HOUR + MIN, { spearman: 30, swordsman: 1000 });
    expect(flagsOf(s, A)).toContain('forged');

    const forged = await order(s, A, base + 10 * HOUR + 2 * MIN, march({ spearman: 30, swordsman: 1000 }));
    expect(forged.error).toMatch(/Сервер подтверждает в войске только 3\d из 1030 бойцов/);
    expect(forged.wars).toEqual([]);
    expect(readWatchRecord(s.json(STORES.watch, A)).flags.find((f) => f.kind === 'forged')?.n).toBeGreaterThanOrEqual(2);

    const ok = await order(s, A, base + 10 * HOUR + 3 * MIN, march({ spearman: 30 }));
    expect(ok.error).toBeUndefined();
    expect(ok.wars).toHaveLength(1);
    expect(ok.wars[0].army.troops).toEqual({ spearman: 30 });
  });

  it('оборона: защитник заявил гарнизон, которого сервер не видел обученным, — у стены только подтверждённое', async () => {
    const s = world();
    await push(s, A, base, {});
    await push(s, B, base, {});
    await push(s, A, base + 10 * HOUR, { spearman: 30 });
    await push(s, B, base + 10 * HOUR, { swordsman: 5000 });
    expect(flagsOf(s, B)).toContain('forged');
    const sent = await order(s, A, base + 10 * HOUR + MIN, march({ spearman: 30 }));
    expect(sent.error).toBeUndefined();
    const w = sent.wars[0];
    const after = await order(s, A, w.arriveAt + 1);
    const battle = after.wars[0].battles[0];
    // У стены — только то, что казармы первого уровня могли выучить за десять часов с запасом, а не пять тысяч.
    const cap = Math.floor((trainRateAt(false, 1) * gameSecondsOfMs(10 * HOUR) * BOOK_SLACK) / TROOP_BY_ID.swordsman.work);
    expect(cap).toBeLessThan(100);
    expect(battle.homeTroops).toEqual(readWatchRecord(s.json(STORES.watch, B)).book?.bodies);
    expect(battle.homeTroops.swordsman).toBeLessThanOrEqual(cap);
    expect(battle.atkTroops).toEqual({ spearman: 30 });
  });

  it('честный игрок: офлайн, плохая сеть (запись войн не прочиталась) — ни флага, ни отказа', async () => {
    const s = world();
    await push(s, A, base, {});
    await push(s, B, base, {});
    // Запись войн испорчена — книга идёт без потерь войны, а запись партии не падает.
    s.put(STORES.world, WARS_KEY, 'не запись');
    const honest = spearsIn(1, 10 * HOUR);
    await push(s, A, base + 10 * HOUR, { spearman: honest });
    expect(flagsOf(s, A)).not.toContain('forged');
    const sent = await order(s, A, base + 10 * HOUR + MIN, march({ spearman: honest }));
    expect(sent.error).toBeUndefined();
    expect(flagsOf(s, A)).not.toContain('forged');
  });

});
