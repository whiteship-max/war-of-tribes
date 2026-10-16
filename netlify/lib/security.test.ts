import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from './routes/index.js';
import { botWith } from './routes/bot.js';
import { STORES } from './kv.js';
import { CITY_RULES, WARN, confirmedPower, flagsBetween, readWatchRecord, type FlagKind, type WatchRecord } from './watch.js';
import { readLedger, settlePurchase } from './gems.js';
import { ROSTER_KEY, readRoster } from './roster.js';
import { seedTown } from './town.js';
import type { Telegram } from './telegram.js';
import { PAY_NOT_COUNTED, PAY_NOT_SOLD } from './words.js';
import type { GemsResponse, RatingResponse, WatchCard } from './contract.js';
import { BUILDING_BY_ID } from '../../src/game/data/buildings.js';
import { START_POP } from '../../src/game/constants.js';
import { START_GEMS, fullWork, rushPriceOfWork } from '../../src/game/gemrules.js';
import { upgradeCost } from '../../src/game/labour.js';
import { gameSecondsOfMs } from '../../src/game/pace.js';
import { storageOf } from '../../src/game/build.js';
import { powerOfCounts } from '../../src/profile/power.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';

/**
 * ЗЩ-1 (docs/security.md): подделанный клиент. Сервер не верит клиенту ни в чём, что даёт выгоду: каждое правило таблицы
 * города (`CITY_RULES`) — запись партии с невозможной описью через настоящий обработчик; ответ — отказ подтвердить (в
 * рейтинг, реестр и войну идёт подтверждённое), строка «внимание:» в журнале города и ни одного упавшего запроса. Алмазы —
 * только подтверждённой оплатой: приказ их не начисляет, сохранение их не несёт, платёж Telegram не засчитывается, повтор
 * оплаты не начисляет второй раз.
 */
const NOW = 1_900_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const SECRET = 'test-secret_0123';
const ADMIN = 4242;

let home: Home;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  home = sqliteHome();
  for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'ADMIN_IDS', 'TRIBE_SPAWN']) saved[k] = process.env[k];
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  process.env.ADMIN_IDS = String(ADMIN);
  delete process.env.TRIBE_SPAWN;
});
afterEach(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await home.close();
});

/** Посёлок новой партии — все постройки первого уровня (`createInitialState`), как его знает книга стройки. */
const LEVEL1 = seedTown(NOW).levels;

/** Опись, какую шлёт игра (`net/snapshot.watchOf`): посёлок новой партии, ни дел, ни войска. */
const card = (over: Partial<WatchCard> = {}): WatchCard => ({
  build: 'v1',
  city: 'Энна',
  clock: NOW,
  time: 1000,
  level: 1,
  buildings: { ...LEVEL1 },
  pop: START_POP,
  stock: { wood: 1000, stone: 1000, gold: 10 },
  prod: {},
  cap: storageOf(LEVEL1),
  troops: {},
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
  ...over,
});

const io = (now: number) => ({ stores: home.stores, now, ip: null });
const signed = (id: number, now: number) => ({ 'x-telegram-init-data': signInit(id, Math.floor(now / 1000) - 60) });

/** Записи партии одного игрока подряд: каждая — поверх прежней, со своей описью и минутой. */
function player(id: number) {
  let etag: string | null = null;
  return {
    key: `tg-${id}`,
    async push(watch: WatchCard, now: number, extra: Record<string, unknown> = {}): Promise<number> {
      const record = { v: 1, rev: 0, updatedAt: 0, device: 'dev-1', game: '{"pop":30}', world: null, card: { name: 'Вождь', day: 3, pop: 60, power: 500, army: 0 }, watch, ...extra };
      const req = new Request('https://x/api/save', { method: 'PUT', headers: { ...signed(id, now), 'content-type': 'application/json' }, body: JSON.stringify({ baseEtag: etag, record }) });
      const res = await ROUTES['/api/save'](req, io(now));
      if (res.status === 200) etag = ((await res.json()) as { etag: string }).etag;
      return res.status;
    },
    async watch(): Promise<WatchRecord> {
      const found = await home.stores(STORES.watch).getWithMetadata(`tg-${id}`);
      return readWatchRecord(found ? JSON.parse(String(found.data)) : null);
    },
  };
}

/** Строки журнала города о невозможном — с началом «внимание:». */
const warnings = (rec: WatchRecord): string[] => rec.journal.filter((e) => e.text.startsWith(WARN)).map((e) => e.text);
const kinds = (rec: WatchRecord): FlagKind[] => rec.flags.map((f) => f.kind);

describe('таблица правил города: каждое правило держит подделанный клиент', () => {
  it('таблица одна, и у каждого правила есть общая с игрой формула и флаг', () => {
    expect(CITY_RULES.map((r) => r.id)).toEqual(['level', 'pace', 'paid', 'stock', 'troops', 'people']);
    for (const r of CITY_RULES) {
      expect(r.formula.length, r.id).toBeGreaterThan(5);
      expect(r.act.length, r.id).toBeGreaterThan(3);
    }
  });

  it('уровень выше книги: все постройки десятого уровня с первой записи — подтверждён посёлок новой партии, «внимание:», запись принята', async () => {
    const p = player(5101);
    const top = Object.fromEntries(Object.keys(LEVEL1).map((t) => [t, 10]));
    expect(await p.push(card({ buildings: top, level: 10, cap: storageOf(top) }), NOW)).toBe(200);
    const rec = await p.watch();
    // Книга засчитала только то, что стройка даёт без времени, — даровые пять минут уровня (`gemrules.rushFreeWork`), —
    // и ни одного десятого: в войну, рейтинг и реестр идёт почти посёлок новой партии.
    for (const [t, lv] of Object.entries(rec.town?.levels ?? {})) expect(lv, t).toBeLessThanOrEqual(2);
    expect(kinds(rec)).toContain('built');
    expect(warnings(rec).some((t) => /стройка сверх подтверждённой/.test(t))).toBe(true);
    expect(confirmedPower(rec)).toBeLessThan(powerOfCounts(top, {}) / 5);
  });

  it('стройка быстрее срока: ратуша десятого уровня через минуту — не подтверждена, «внимание:»', async () => {
    const p = player(5102);
    expect(await p.push(card(), NOW)).toBe(200);
    const fast = { ...LEVEL1, town_hall: 10 };
    expect(await p.push(card({ buildings: fast, level: 10, clock: NOW + MIN, time: 1000 + gameSecondsOfMs(MIN) }), NOW + MIN)).toBe(200);
    const rec = await p.watch();
    expect(rec.town?.levels.town_hall).toBeLessThan(10);
    expect(kinds(rec)).toContain('built');
    expect(warnings(rec).length).toBeGreaterThan(0);
  });

  it('цена не списана: уровень построен по сроку, а склад не убыл — «стройка без платы»; честный, заплативший, — без флага', async () => {
    const cost = upgradeCost(BUILDING_BY_ID.houses, 2);
    expect(cost.wood).toBeGreaterThan(0);
    const later = NOW + 3 * HOUR;
    const built = { ...LEVEL1, houses: 2 };
    const at = (stock: WatchCard['stock']) => card({ buildings: built, stock, clock: later, time: 1000 + gameSecondsOfMs(3 * HOUR) });

    const cheat = player(5103);
    expect(await cheat.push(card(), NOW)).toBe(200);
    expect(await cheat.push(at({ wood: 1000, stone: 1000, gold: 10 }), later)).toBe(200);
    const rec = await cheat.watch();
    // Точка внутри правила: уровень подтверждён по сроку (флага «стройка сверх» нет), на первой описи стройки не было.
    expect(rec.town?.levels.houses).toBe(2);
    expect(kinds(rec)).not.toContain('built');
    expect(kinds(rec)).toContain('unpaid');
    expect(warnings(rec).some((t) => /стройка без платы/.test(t))).toBe(true);

    const honest = player(5104);
    expect(await honest.push(card(), NOW)).toBe(200);
    expect(await honest.push(at({ wood: 1000 - (cost.wood ?? 0), stone: 1000 - (cost.stone ?? 0), gold: 10 }), later)).toBe(200);
    const fair = await honest.watch();
    expect(fair.town?.levels.houses).toBe(2);
    expect(kinds(fair)).toEqual([]);
    expect(warnings(fair)).toEqual([]);
  });

  it('цена: где правило не спрашивается — стройка на первой описи (очередь за ней оплачена раньше) и промежуток с разовым делом', () => {
    const a = card({ site: { type: 'houses', level: 2, done: 10 } });
    const b = card({ buildings: { ...LEVEL1, houses: 2, town_hall: 2 }, clock: NOW + HOUR, time: a.time + gameSecondsOfMs(HOUR) });
    const flags = (x: WatchCard, y: WatchCard): FlagKind[] => flagsBetween(x, NOW, y, NOW + HOUR).map((f) => f.kind);
    expect(flags(a, b)).not.toContain('unpaid');
    expect(flags(a, { ...b, deeds: 1 })).not.toContain('unpaid');
    // Та же пара без стройки на первой описи — флаг: точка внутри правила.
    const { site, ...bare } = a;
    expect(site).toBeDefined();
    expect(flags(bare, b)).toContain('unpaid');
  });

  it('запасы выше вместимости: опись назвала склад десятого уровня — вместимость подтверждённого первого, «внимание:»', async () => {
    const p = player(5105);
    const big = { ...LEVEL1, storage: 10 };
    const cap = storageOf(LEVEL1);
    expect(await p.push(card({ buildings: big, cap: storageOf(big), stock: { wood: cap * 3, gold: 10 } }), NOW)).toBe(200);
    const rec = await p.watch();
    expect(storageOf(big)).toBeGreaterThan(cap * 3);
    expect(kinds(rec)).toContain('cap');
    expect(warnings(rec).some((t) => /вместимости подтверждённых построек/.test(t))).toBe(true);
  });

  it('войска больше нанятых: пять тысяч копейщиков с первой записи — сервер подтверждает ноль, в рейтинг они не идут', async () => {
    const p = player(5106);
    expect(await p.push(card({ troops: { spearman: 5000 } }), NOW)).toBe(200);
    const rec = await p.watch();
    expect(rec.book?.bodies.spearman ?? 0).toBe(0);
    expect(kinds(rec)).toContain('forged');
    expect(warnings(rec).some((t) => /войско сверх подтверждённого/.test(t))).toBe(true);
    expect(confirmedPower(rec)).toBe(powerOfCounts(LEVEL1, {}));
  });

  it('жители сверх прироста: десять тысяч с первой записи — подтверждено не больше посёлка новой партии с вестями', async () => {
    const p = player(5107);
    expect(await p.push(card({ pop: 10_000 }), NOW)).toBe(200);
    const rec = await p.watch();
    expect(rec.town?.pop ?? 0).toBeLessThan(200);
    expect(kinds(rec)).toContain('people');
  });
});

describe('подтверждённое — в рейтинг и реестр замков', () => {
  it('реестр: мощь и население, которые видят соседи, — не больше подтверждённого книгами', async () => {
    const p = player(5201);
    const top = Object.fromEntries(Object.keys(LEVEL1).map((t) => [t, 10]));
    await p.push(card({ buildings: top, troops: { spearman: 5000 }, pop: 9000 }), NOW);
    const req = new Request('https://x/api/castles', {
      method: 'PUT',
      headers: { ...signed(5201, NOW + 20_000), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Вождь', city: 'Энна', power: 1e9, pop: 1e9 }),
    });
    expect((await ROUTES['/api/castles'](req, io(NOW + 20_000))).status).toBe(200);
    const found = await home.stores(STORES.world).getWithMetadata(ROSTER_KEY);
    const row = readRoster(JSON.parse(String(found!.data))).rows[p.key];
    const rec = await p.watch();
    expect(row.power).toBe(confirmedPower(rec));
    expect(row.power).toBeLessThan(powerOfCounts(top, { spearman: 5000 }) / 10);
    expect(row.pop).toBeLessThan(200);
  });

  it('реестр до первой записи партии: посёлок новой партии, а не названное клиентом', async () => {
    const req = new Request('https://x/api/castles', {
      method: 'PUT',
      headers: { ...signed(5202, NOW), 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Вождь', city: 'Энна', power: 1e9, pop: 1e9 }),
    });
    expect((await ROUTES['/api/castles'](req, io(NOW))).status).toBe(200);
    const found = await home.stores(STORES.world).getWithMetadata(ROSTER_KEY);
    const row = readRoster(JSON.parse(String(found!.data))).rows['tg-5202'];
    expect(row.power).toBe(powerOfCounts(LEVEL1, {}));
    expect(row.pop).toBe(START_POP);
  });

  it('рейтинг: мощь подделки — подтверждённая', async () => {
    const p = player(5203);
    const top = Object.fromEntries(Object.keys(LEVEL1).map((t) => [t, 10]));
    await p.push(card({ buildings: top, troops: { spearman: 5000 } }), NOW);
    const put = new Request('https://x/api/castles', { method: 'PUT', headers: { ...signed(5203, NOW + 20_000), 'content-type': 'application/json' }, body: JSON.stringify({ name: 'В', city: 'Энна', power: 1, pop: 1 }) });
    await ROUTES['/api/castles'](put, io(NOW + 20_000));
    const res = await ROUTES['/api/rating'](new Request('https://x/api/rating', { headers: signed(5203, NOW + 30_000) }), io(NOW + 30_000));
    const body = (await res.json()) as RatingResponse;
    expect(body.rows.find((r) => r.mine)?.power).toBe(confirmedPower(await p.watch()));
    expect(body.rows.find((r) => r.mine)?.power).toBeLessThan(powerOfCounts(top, { spearman: 5000 }) / 10);
  });
});

describe('алмазы: только подтверждённая оплата', () => {
  async function gems(id: number, now: number, order?: unknown): Promise<{ status: number; body: GemsResponse }> {
    const req = new Request('https://x/api/gems', {
      method: order ? 'POST' : 'GET',
      headers: { ...signed(id, now), 'content-type': 'application/json' },
      ...(order ? { body: JSON.stringify(order) } : {}),
    });
    const res = await ROUTES['/api/gems'](req, io(now));
    return { status: res.status, body: (await res.json()) as GemsResponse };
  }

  it('клиент не может объявить алмазы: ни полем сохранения, ни описью, ни приказом', async () => {
    const p = player(5301);
    // Сохранение с «алмазами» в записи и в описи: сервер их не читает.
    expect(await p.push({ ...card(), gems: 99_999 } as WatchCard, NOW, { gems: 99_999, balance: 99_999 })).toBe(200);
    expect((await gems(5301, NOW + 1000)).body.balance).toBe(START_GEMS);
    // Приказа, который начисляет, нет: неизвестный вид, отрицательная цена — 400, книга не тронута.
    for (const order of [
      { op: 'credit', key: 'k-credit-1', amount: 1000 },
      { op: 'purchase', key: 'k-buy-0001', gems: 1000 },
      { op: 'rush', key: 'k-rush-neg', building: 'houses', level: 2, work: 100, price: -500 },
      { op: 'buy', key: 'k-buy-gems', res: 'gems' },
    ]) {
      expect((await gems(5301, NOW + 2000, order)).status, JSON.stringify(order)).toBe(400);
    }
    expect((await gems(5301, NOW + 3000)).body.balance).toBe(START_GEMS);
  });

  it('ускорение по подделанной цене: остаток назван, цена — нет; отказ, алмазы не списаны, «внимание:» в журнале', async () => {
    const p = player(5302);
    const level = 2;
    // Стройка, которую даром не ускорить: цена полного остатка — больше одного алмаза. Точка внутри правила цены.
    const type = Object.keys(LEVEL1).find((t) => rushPriceOfWork(fullWork(t as keyof typeof BUILDING_BY_ID, level)) > 1)!;
    expect(type).toBeDefined();
    const work = fullWork(type as keyof typeof BUILDING_BY_ID, level);
    await p.push(card({ site: { type, level, done: 0 } }), NOW);
    const r = await gems(5302, NOW + 1000, { op: 'rush', key: 'k-rush-0001', building: type, level, work, price: 1 });
    expect(r.status).toBe(200);
    expect(r.body.error).toMatch(/Ускорение стоит \d+, а не 1/);
    expect(r.body.balance).toBe(START_GEMS);
    const rec = await p.watch();
    expect(warnings(rec).some((t) => t.includes(`ускорение ${type} до ур. 2`))).toBe(true);
  });

  it('повтор оплаты: тот же заказ, начисленный дважды, ложится один раз', async () => {
    const grant = { amount: 550, key: 'pay:ABCDEFGHJK', at: NOW };
    const first = await settlePurchase(home.stores, 'tg-5303', grant);
    const again = await settlePurchase(home.stores, 'tg-5303', { ...grant, at: NOW + MIN });
    expect(first?.ledger.balance).toBe(START_GEMS + 550);
    expect(again?.ledger.balance).toBe(START_GEMS + 550);
    const found = await home.stores(STORES.gems).getWithMetadata('tg-5303');
    expect(readLedger(JSON.parse(String(found!.data)))?.list.filter((e) => e.kind === 'purchase')).toHaveLength(1);
  });
});

describe('платёж Telegram: счетов Telegram сервер не выставляет — ни один не засчитывается', () => {
  function fakeTg() {
    const calls: string[] = [];
    const tg: Telegram = {
      letter: async () => ({ result: 'ok' }),
      edit: async () => ({ result: 'ok' }),
      panel: async () => 'ok',
      repanel: async () => 'ok',
      answer: async () => 'ok',
      button: async () => 'ok',
      async say(chat, text) {
        calls.push(`say:${chat}:${text}`);
        return 'ok';
      },
      file: async () => 'ok',
      greet: async () => 'ok',
      async checkout(id, ok, error) {
        calls.push(`checkout:${id}:${ok}:${error}`);
        return 'ok';
      },
    };
    return { tg, calls };
  }

  async function hook(t: ReturnType<typeof fakeTg>, update: unknown, secret = SECRET): Promise<number> {
    const req = new Request('https://x/api/bot', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
      body: JSON.stringify(update),
    });
    return (await botWith(() => t.tg)(req, io(NOW))).status;
  }

  const paid = (charge: string) => ({
    update_id: 7,
    message: {
      message_id: 3,
      from: { id: 5401 },
      chat: { id: 5401, type: 'private' },
      successful_payment: { currency: 'XTR', total_amount: 500, invoice_payload: 'pack:big', telegram_payment_charge_id: charge, provider_payment_charge_id: '' },
    },
  });

  it('предоплатная проверка — отказ словами: деньги не спишутся', async () => {
    const t = fakeTg();
    const update = { update_id: 6, pre_checkout_query: { id: 'q-1', from: { id: 5401 }, currency: 'XTR', total_amount: 500, invoice_payload: 'pack:big' } };
    expect(await hook(t, update)).toBe(200);
    expect(t.calls).toEqual([`checkout:q-1:false:${PAY_NOT_SOLD}`]);
  });

  it('successful_payment не начисляет ничего — ни в первый раз, ни повтором; плательщику — «не засчитан», админу — «внимание:»', async () => {
    const t = fakeTg();
    expect(await hook(t, paid('ch-1'))).toBe(200);
    expect(await hook(t, paid('ch-1'))).toBe(200);
    // Книги алмазов у плательщика нет вовсе: вебхук хранилища алмазов не знает.
    expect(await home.stores(STORES.gems).getWithMetadata('tg-5401')).toBeNull();
    expect(t.calls.filter((c) => c === `say:5401:${PAY_NOT_COUNTED}`)).toHaveLength(2);
    const alert = t.calls.filter((c) => c.startsWith(`say:${ADMIN}:${WARN}`));
    expect(alert).toHaveLength(2);
    expect(alert[0]).toMatch(/500 XTR, чек ch-1/);
  });

  it('без секрета вебхука — 401, никто ничего не услышал', async () => {
    const t = fakeTg();
    expect(await hook(t, paid('ch-2'), 'wrong-secret')).toBe(401);
    expect(t.calls).toEqual([]);
  });
});
