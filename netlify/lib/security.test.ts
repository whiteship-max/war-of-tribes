import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from './routes/index.js';
import { botWith } from './routes/bot.js';
import { STORES } from './kv.js';
import { CITY_RULES, WARN, bookOf, confirmedPower, flagsBetween, readWatchRecord, townOf, type FlagKind, type WatchRecord } from './watch.js';
import { readLedger, settlePurchase } from './gems.js';
import { ROSTER_KEY, readRoster } from './roster.js';
import { eatFloorOf, seedTown } from './town.js';
import { emptyWars, liveSheet, readStoredSheet } from './war.js';
import type { Telegram } from './telegram.js';
import { PAY_NOT_COUNTED, PAY_NOT_SOLD } from './words.js';
import type { GemsResponse, RatingResponse, WarSheet, WatchCard } from './contract.js';
import { BUILDING_BY_ID } from '../../src/game/data/buildings.js';
import { BUILD_QUEUE_MAX, START_POP } from '../../src/game/constants.js';
import { START_GEMS, fullWork, rushPriceOfWork } from '../../src/game/gemrules.js';
import { cancelRefund, upgradeCost } from '../../src/game/labour.js';
import { DAY_LENGTH, gameDaysOfMs, gameDaysPerHour, gameSecondsOfMs } from '../../src/game/pace.js';
import { STAB_BAND, stabPrice, stabSelfRiseCeil } from '../../src/game/stabrules.js';
import { GOODS_SLACK, drainCeil } from './goods.js';
import { CLOCK_SKEW_SECONDS } from './initdata.js';
import { headsFoodPerDay, soldierFoodPerDay, storageOf } from '../../src/game/build.js';
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
    expect(CITY_RULES.map((r) => r.id)).toEqual(['level', 'pace', 'paid', 'queue', 'refund', 'stock', 'troops', 'people', 'goods', 'eat', 'stab']);
    for (const r of CITY_RULES) {
      expect(r.formula.length, r.id).toBeGreaterThan(5);
      expect(r.act.length, r.id).toBeGreaterThan(3);
    }
  });

  // Книга стабильности (docs/stability.md, 2.7): опись везёт ступень и счёт; сервер сверяет их формулами игры (`game/stabrules`).
  // Область правила: обе описи несут стабильность, между ними — час (точка внутри: ровная жизнь за час до «Лада» не доходит).
  it('стабильность: ступень из ничего, очки сверх правителя, подавленный мятеж без боя — «внимание:»; честная покупка — без флага', async () => {
    const later = NOW + HOUR;
    const t = 1000 + gameSecondsOfMs(HOUR);
    const stab = (o: Partial<NonNullable<WatchCard['stab']>> = {}): WatchCard['stab'] => ({ level: 0, bought: 0, spent: 0, revolts: 0, held: 0, ...o });
    expect(stabSelfRiseCeil(gameSecondsOfMs(HOUR) / DAY_LENGTH, 0, STAB_BAND), 'точка внутри: за час сама — не больше ступени').toBeLessThanOrEqual(1);

    const forged = player(5191);
    expect(await forged.push(card({ stab: stab() }), NOW)).toBe(200);
    expect(await forged.push(card({ clock: later, time: t, stab: stab({ level: 3 }) }), later)).toBe(200);
    const rec = await forged.watch();
    expect(kinds(rec)).toContain('stab');
    expect(warnings(rec).some((x) => /подняться выше \+1 она не могла/.test(x)), 'подъём выше «Лада» без покупки').toBe(true);

    const greedy = player(5192);
    expect(await greedy.push(card({ stab: stab() }), NOW)).toBe(200);
    expect(await greedy.push(card({ clock: later, time: t, stab: stab({ level: 1, bought: 1, spent: 100_000 }) }), later)).toBe(200);
    expect(warnings(await greedy.watch()).some((x) => /правитель дал бы не больше/.test(x)), 'очков сверх правителя').toBe(true);

    const cheap = player(5193);
    expect(await cheap.push(card({ stab: stab() }), NOW)).toBe(200);
    expect(await cheap.push(card({ clock: later, time: t, stab: stab({ level: 1, bought: 1, spent: 1 }) }), later)).toBe(200);
    expect(warnings(await cheap.watch()).some((x) => /ступень стоит не меньше/.test(x)), 'ступень дешевле цены').toBe(true);

    const bloodless = player(5194);
    expect(await bloodless.push(card({ stab: stab({ level: -1, revolts: 1 }) }), NOW)).toBe(200);
    expect(await bloodless.push(card({ clock: later, time: t, stab: stab({ level: -1, revolts: 1, held: 1 }) }), later)).toBe(200);
    expect(warnings(await bloodless.watch()).some((x) => /Подавлено мятежей 1/.test(x)), 'подавлен без выигранного боя').toBe(true);

    const range = player(5195);
    expect(await range.push(card({ stab: stab({ level: 7 }) }), NOW)).toBe(200);
    expect(warnings(await range.watch()).some((x) => /вне шкалы/.test(x)), 'ступень вне шкалы').toBe(true);

    const honest = player(5196);
    expect(await honest.push(card({ stab: stab() }), NOW)).toBe(200);
    const price = stabPrice(1);
    expect(await honest.push(card({ clock: later, time: t, deeds: 1, won: 1, stab: stab({ level: 1, bought: 1, spent: price, revolts: 1, held: 1 }) }), later)).toBe(200);
    const fair = await honest.watch();
    expect(kinds(fair)).not.toContain('stab');
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

/** Приказ алмазов игрока `id` (GET без приказа) через настоящий обработчик. */
async function gems(id: number, now: number, order?: unknown): Promise<{ status: number; body: GemsResponse }> {
  const req = new Request('https://x/api/gems', {
    method: order ? 'POST' : 'GET',
    headers: { ...signed(id, now), 'content-type': 'application/json' },
    ...(order ? { body: JSON.stringify(order) } : {}),
  });
  const res = await ROUTES['/api/gems'](req, io(now));
  return { status: res.status, body: (await res.json()) as GemsResponse };
}

describe('алмазы: только подтверждённая оплата', () => {

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

/**
 * ЗЩ-2 (docs/security.md): склад и казна защитника — из книги запасов, а не из слепка обороны; расход хлеба — не ниже пола
 * игры. Запись партии принимается (200), невозможное — флаг и строка «внимание:», в войну идёт подтверждённое: слепок,
 * собранный так, как его собирает обработчик войны (`readStoredSheet` + книги из наблюдения).
 */
describe('ЗЩ-2: склад, казна и хлеб защитника — из подтверждённого', () => {
  const sheet = (over: Partial<WarSheet> = {}): WarSheet => ({
    army: {},
    home: {},
    militia: 0,
    archers: 0,
    resolve: 0,
    pips: {},
    rest: 1,
    food: 0,
    townPerHour: eat.townPerHour,
    perManPerHour: eat.perManPerHour,
    stock: { wood: 1000, stone: 1000 },
    stash: 0,
    gold: 10,
    pop: START_POP,
    bonded: 0,
    levels: {},
    power: 0,
    locks: {},
    seen: [],
    ...over,
  });
  // Честный расход посёлка новой партии — формулой игры при обычном пайке; пол — при самом скудном.
  const eat = { townPerHour: headsFoodPerDay(START_POP, 1, 1) * gameDaysPerHour(), perManPerHour: soldierFoodPerDay(1, 1) * gameDaysPerHour() };

  /** Слепок обороны так, как его видит война: лежащая запись партии и книги из наблюдения. */
  async function warSide(p: ReturnType<typeof player>): Promise<WarSheet> {
    const found = await home.stores(STORES.saves).getWithMetadata(p.key);
    const s = readStoredSheet(found ? JSON.parse(String(found.data)) : null)!;
    const rec = await p.watch();
    return liveSheet(emptyWars(), p.key, { ...s, book: bookOf(rec, NOW), town: townOf(rec, NOW), ...(rec.goods ? { goods: rec.goods } : {}) }, s.at);
  }

  it('слепок прячет склад и казну, опись — нет: флаг, «внимание:», в войну — опись; честный — без флагов', async () => {
    const honest = player(5201);
    expect(await honest.push(card({ outlays: 0 }), NOW, { war: sheet() })).toBe(200);
    expect(kinds(await honest.watch())).toEqual([]);
    expect((await warSide(honest)).stock).toEqual({ wood: 1000, stone: 1000 });

    const p = player(5202);
    expect(await p.push(card({ outlays: 0 }), NOW, { war: sheet({ stock: {}, gold: 0 }) })).toBe(200);
    const rec = await p.watch();
    expect(kinds(rec)).toEqual(['hidden']);
    expect(warnings(rec).join('\n')).toMatch(/Слепок обороны называет меньше/);
    const war = await warSide(p);
    expect(war.stock).toEqual({ wood: 1000, stone: 1000 });
    expect(war.gold).toBe(10);
  });

  it('склад опустел в минуту без дел и трат: книга держит, флаг; с тратой — не держит', async () => {
    const full = { wood: 1000, stone: 1000, gold: 5000 };
    const p = player(5203);
    expect(await p.push(card({ outlays: 0, stock: full }), NOW, { war: sheet({ gold: 5000 }) })).toBe(200);
    expect(await p.push(card({ outlays: 0, stock: { gold: 0 } }), NOW + MIN, { war: sheet({ stock: {}, gold: 0 }) })).toBe(200);
    const rec = await p.watch();
    expect(kinds(rec)).toContain('hidden');
    expect(warnings(rec).join('\n')).toMatch(/Склад убыл без разовых дел и трат/);
    // Казна без дела убывает только закятом с голов посёлка (войска нет): книга держит прежнее за вычетом потолка расхода
    // за минуту с допуском часов; камень без дела не убывает вовсе — единица на дробь.
    const could = drainCeil(rec.town!.levels, START_POP, 0, 0).gold * gameDaysOfMs(MIN + CLOCK_SKEW_SECONDS * 1000) * GOODS_SLACK + 1;
    expect(could, 'точка внутри области: убыль больше позволенного').toBeLessThan(5000);
    expect(rec.goods?.have.gold).toBe(Math.floor(5000 - could));
    const war = await warSide(p);
    expect(war.gold).toBe(Math.floor(5000 - could));
    expect(war.stock.stone).toBe(999);

    const q = player(5204);
    expect(await q.push(card({ outlays: 0, stock: full }), NOW, { war: sheet({ gold: 5000 }) })).toBe(200);
    expect(await q.push(card({ outlays: 1, stock: { gold: 0 } }), NOW + MIN, { war: sheet({ stock: {}, gold: 0 }) })).toBe(200);
    const fair = await q.watch();
    expect(kinds(fair)).toEqual([]);
    expect((await warSide(q)).gold).toBe(0);
  });

  it('расход хлеба ниже самого скудного пайка: флаг «расход хлеба ниже правил», в осаду — пол', async () => {
    const p = player(5205);
    expect(await p.push(card({ outlays: 0 }), NOW, { war: sheet({ townPerHour: 0, perManPerHour: 0 }) })).toBe(200);
    const rec = await p.watch();
    expect(kinds(rec)).toEqual(['eat']);
    expect(warnings(rec).join('\n')).toMatch(/Расход хлеба в слепке обороны/);
    const war = await warSide(p);
    const floor = eatFloorOf(START_POP, 0);
    expect(war.townPerHour).toBeCloseTo(floor.townPerHour, 9);
    expect(war.perManPerHour).toBeCloseTo(floor.perManPerHour, 9);
    // Точка внутри области: пол ниже честного расхода, но не ноль.
    expect(floor.townPerHour).toBeGreaterThan(0);
    expect(floor.townPerHour).toBeLessThan(eat.townPerHour);
  });
});

describe('СТ-1: очередь стройки — порядок, оплата, возврат, ускорение', () => {
  const half = cancelRefund(BUILDING_BY_ID.houses, 2, true);
  const full = cancelRefund(BUILDING_BY_ID.barracks, 2, false);
  /** Две стройки: Жилища строятся (работа есть), казармы ждут. Обе оплачены до первой описи. */
  const queued = card({
    site: { type: 'houses', level: 2, done: 50 },
    queue: [
      { type: 'houses', level: 2 },
      { type: 'barracks', level: 2 },
    ],
  });
  /** Обе отменены через минуту: склад вырос на `grow` по видам. */
  const cancelled = (grow: Partial<Record<string, number>>): WatchCard =>
    card({
      clock: NOW + MIN,
      time: queued.time + gameSecondsOfMs(MIN),
      queue: [],
      stock: Object.fromEntries(Object.entries(queued.stock).map(([k, v]) => [k, v + (grow[k] ?? 0)])),
    });
  const sum = (x: Partial<Record<string, number>>, y: Partial<Record<string, number>>): Partial<Record<string, number>> =>
    Object.fromEntries([...new Set([...Object.keys(x), ...Object.keys(y)])].map((k) => [k, (x[k] ?? 0) + (y[k] ?? 0)]));

  it('возврат положенного — без флагов; начатое назвало всю цену — «возврат сверх положенного», «внимание:»', async () => {
    expect(half.wood ?? 0, 'точка внутри правила: половина — меньше всей цены').toBeLessThan(upgradeCost(BUILDING_BY_ID.houses, 2).wood ?? 0);
    const honest = player(5601);
    expect(await honest.push(queued, NOW)).toBe(200);
    expect(await honest.push(cancelled(sum(half, full)), NOW + MIN)).toBe(200);
    const fair = await honest.watch();
    expect(kinds(fair)).toEqual([]);

    const cheat = player(5602);
    expect(await cheat.push(queued, NOW)).toBe(200);
    expect(await cheat.push(cancelled(sum(upgradeCost(BUILDING_BY_ID.houses, 2), full)), NOW + MIN)).toBe(200);
    const rec = await cheat.watch();
    expect(kinds(rec)).toContain('refund');
    expect(kinds(rec)).not.toContain('stock');
    expect(warnings(rec).some((t) => /возврат сверх положенного/.test(t) && /отменено стройки 2/.test(t))).toBe(true);
  });

  it('возврат без отмены — рост склада; с разовым делом правило не спрашивается', () => {
    const still = { ...cancelled(full), queue: queued.queue, site: queued.site };
    expect(flagsBetween(queued, NOW, still, NOW + MIN).map((f) => f.kind)).toContain('stock');
    expect(flagsBetween(queued, NOW, { ...cancelled(sum(upgradeCost(BUILDING_BY_ID.houses, 2), full)), deeds: 1 }, NOW + MIN)).toEqual([]);
  });

  it('оплата по очереди: ждущее, заложенное между описями, уносит свою цену; оплаченное до первой описи — нет', () => {
    const a = card({ site: { type: 'houses', level: 2, done: 50 }, queue: [{ type: 'houses', level: 2 }] });
    const added = { ...a, clock: NOW + MIN, time: a.time + gameSecondsOfMs(MIN), queue: [...a.queue!, { type: 'barracks', level: 2 }] };
    const flags = (b: WatchCard): FlagKind[] => flagsBetween(a, NOW, b, NOW + MIN).map((f) => f.kind);
    // До очереди правило молчало бы: на первой описи шла стройка. Теперь — флаг, точка внутри правила.
    expect(flags(added)).toContain('unpaid');
    const cost = upgradeCost(BUILDING_BY_ID.barracks, 2);
    const paid = { ...added, stock: Object.fromEntries(Object.entries(a.stock).map(([k, v]) => [k, v - (cost[k as keyof typeof cost] ?? 0)])) };
    expect(flags(paid)).toEqual([]);
    expect(flags({ ...a, clock: NOW + MIN, time: added.time })).toEqual([]);
  });

  it('очередь против правил — «очередь стройки», места не признаны; честная — признана целиком', async () => {
    const honest = player(5603);
    expect(await honest.push(queued, NOW)).toBe(200);
    expect((await honest.watch()).town?.queue).toEqual(['houses:2', 'barracks:2']);

    const long = player(5604);
    const six = Object.keys(LEVEL1).filter((t) => (BUILDING_BY_ID[t as keyof typeof BUILDING_BY_ID].maxLevel ?? 99) > 1).slice(0, BUILD_QUEUE_MAX + 1).map((type) => ({ type, level: 2 }));
    expect(await long.push(card({ queue: six, site: { type: six[0].type, level: 2, done: 0 } }), NOW)).toBe(200);
    const rec = await long.watch();
    expect(kinds(rec)).toContain('queue');
    expect(rec.town?.queue).toHaveLength(BUILD_QUEUE_MAX);
    expect(warnings(rec).some((t) => /очередь стройки/i.test(t) && /6-е место/.test(t))).toBe(true);

    const twice = player(5605);
    expect(await twice.push(card({ queue: [{ type: 'houses', level: 2 }, { type: 'houses', level: 3 }] }), NOW)).toBe(200);
    expect(kinds(await twice.watch())).toContain('queue');

    // Начатое сдвинуто на второе место: на первой записи Жилища строились, на второй впереди казармы.
    const moved = player(5606);
    expect(await moved.push(queued, NOW)).toBe(200);
    const swap = { ...queued, clock: NOW + MIN, time: queued.time + gameSecondsOfMs(MIN), site: { type: 'barracks', level: 2, done: 0 }, queue: [...queued.queue!].reverse() };
    expect(await moved.push(swap, NOW + MIN)).toBe(200);
    const m = await moved.watch();
    expect(kinds(m)).toContain('queue');
    expect(m.town?.queue).not.toContain('houses:2');
    expect(warnings(m).some((t) => /начатая стройка сдвинута на 2-е место/.test(t))).toBe(true);
  });

  it('ускорение ждущего — отказ, алмазы не списаны; строящееся той же записи — не отказ «нет стройки»', async () => {
    const p = player(5607);
    // Ждущее, которое даром не ускорить: точка внутри правила цены, отказ — не из-за даровых минут.
    const work = fullWork('barracks', 2);
    expect(rushPriceOfWork(work)).toBeGreaterThan(1);
    expect(await p.push(queued, NOW)).toBe(200);
    const r = await gems(5607, NOW + 1000, { op: 'rush', key: 'k-rush-q001', building: 'barracks', level: 2, work, price: rushPriceOfWork(work) });
    expect(r.status).toBe(200);
    expect(r.body.error).toBe('Такой стройки нет.');
    expect(r.body.balance).toBe(START_GEMS);
    const first = fullWork('houses', 2) - 50;
    const ok = await gems(5607, NOW + 2000, { op: 'rush', key: 'k-rush-q002', building: 'houses', level: 2, work: first, price: rushPriceOfWork(first) });
    expect(ok.body.error ?? '').not.toBe('Такой стройки нет.');
  });
});
