// АУ-8, п. 2 (OWNER-DECISIONS п. 12, решение владельца 26.10.2026): книга невольников у сервера. Приход — только
// подтверждённое сервером: уведённые войной (запись войн), купленные на рынке (сделки описи, книга рынка), пленные боёв мира
// по таблице наград (AC-1: груз уводимых на бойца); расход — продажа, отпуск, смерть, выкуп — книга идёт за описью вниз.
// Невольников больше книги — флаг «невольники»; продано больше книги — отказ (продажу сервер не принимает) и флаг. Старая
// запись без книги заводит её с текущего числа один раз, без флага.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from './routes/index.js';
import { STORES } from './kv.js';
import { readWatchRecord, type WatchRecord } from './watch.js';
import { seedTown } from './town.js';
import { emptyWars, type WarFile, type WarRow } from './war.js';
import { warFallId, type WarSheet, type WatchCard, type WatchDeal } from './contract.js';
import { BONDED_SLACK, bondedStep, goodsSheet, type BondedBook, type GoodsBook } from './goods.js';
import { deedBonded } from './deeds.js';
import { DEED_TABLE } from '../../src/game/data/deedgain.js';
import { BONDED_GOOD } from '../../src/game/data/market.js';
import { START_POP } from '../../src/game/constants.js';
import { storageOf } from '../../src/game/build.js';
import { stackEscort } from '../../src/world/data/units.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';

const NOW = 1_900_000_000_000;
const MIN = 60_000;
const KEY = 'tg-7001';
const LEVEL1 = seedTown(NOW).levels;

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
  windfalls: 0,
  bonded: 40,
  ...over,
});

/** Война, взявшая город соседа: `led` уведено в минуту падения. */
function fell(led: number, at: number, id = 'w1'): WarFile {
  const file = emptyWars();
  file.wars.push({ id, atk: KEY, def: 'tg-7002', fall: { at, led } } as unknown as WarRow);
  return file;
}

const deal = (seq: number, n: number, at: number): WatchDeal => ({ seq, at, good: BONDED_GOOD.id, n, gold: Math.abs(n) * 5, q: 0 });
const market = (seq: number, deals: WatchDeal[]): WatchCard['market'] => ({ w: 1, bought: {}, sold: {}, got: 0, seq, press: {}, deals });

const ctx = (file: WarFile | null = emptyWars(), seen: string[] = []) => ({ file, key: KEY, seen });

describe('АУ-8 п. 2: книга невольников — чистое правило', () => {
  it('старая запись без книги: книга — с текущего числа, без флага; уже лежащие падения второй раз не засчитываются', () => {
    const step = bondedStep(undefined, card(), NOW, card({ bonded: 400 }), NOW + MIN, ctx(fell(25, NOW - MIN), [warFallId('w1')]));
    expect(step.seeded).toBe(true);
    expect(step.over).toBe(0);
    expect(step.book.n).toBe(400);
    expect(step.book.led).toEqual([warFallId('w1')]);
    const again = bondedStep(step.book, card({ bonded: 400 }), NOW + MIN, card({ bonded: 425 }), NOW + 2 * MIN, ctx(fell(25, NOW - MIN), [warFallId('w1')]));
    expect(again.over, 'падение до книги — уже в её числе').toBe(25 - BONDED_SLACK);
  });

  it('невольники из ничего — сверх книги; книга держит своё', () => {
    const prev: BondedBook = { n: 40, due: [], led: [] };
    const step = bondedStep(prev, card(), NOW, card({ bonded: 400 }), NOW + MIN, ctx());
    expect(step.over).toBe(400 - 40 - BONDED_SLACK);
    expect(step.book.n).toBe(40 + BONDED_SLACK);
  });

  it('пленные войны: падение после книги засчитывается раз; клиент ещё не принял — приход ждёт в книге', () => {
    const prev: BondedBook = { n: 40, due: [], led: [] };
    const at = NOW + MIN / 2;
    const a = bondedStep(prev, card(), NOW, card(), NOW + MIN, ctx(fell(25, at)));
    expect(a.over).toBe(0);
    expect(a.book.due).toEqual([{ id: warFallId('w1'), n: 25 }]);
    const b = bondedStep(a.book, card(), NOW + MIN, card({ bonded: 65 }), NOW + 2 * MIN, ctx(fell(25, at), [warFallId('w1')]));
    expect(b.over, 'принял — без флага').toBe(0);
    expect(b.book).toEqual({ n: 65, due: [], led: [warFallId('w1')] });
    const c = bondedStep(b.book, card({ bonded: 65 }), NOW + 2 * MIN, card({ bonded: 90 }), NOW + 3 * MIN, ctx(fell(25, at), [warFallId('w1')]));
    expect(c.over, 'второй раз то же падение не даёт').toBe(25 - BONDED_SLACK);
  });

  it('покупка на рынке: приход по сделке, пока караван в пути — ждёт; продажа сверх книги — отказ', () => {
    const prev: BondedBook = { n: 40, due: [], led: [] };
    const bought = bondedStep(prev, card({ market: market(0, []) }), NOW, card({ caravans: 1, market: market(1, [deal(1, 30, NOW + 1)]) }), NOW + MIN, ctx());
    expect(bought.over).toBe(0);
    expect(bought.book.due).toEqual([{ id: 'm:1', n: 30 }]);
    const came = bondedStep(bought.book, card({ caravans: 1, market: market(1, [deal(1, 30, NOW + 1)]) }), NOW + MIN, card({ bonded: 70, market: market(1, [deal(1, 30, NOW + 1)]) }), NOW + 2 * MIN, ctx());
    expect(came.over).toBe(0);
    expect(came.book).toEqual({ n: 70, due: [], led: [] });
    const sold = bondedStep(came.book, card({ bonded: 70, market: market(1, []) }), NOW + 2 * MIN, card({ bonded: 0, market: market(2, [deal(2, -500, NOW + 2 * MIN + 1)]) }), NOW + 3 * MIN, ctx());
    expect(sold.refused, 'продано 500 при книге 70').toBe(500 - 70 - BONDED_SLACK);
    const fair = bondedStep(came.book, card({ bonded: 70, market: market(1, []) }), NOW + 2 * MIN, card({ bonded: 20, market: market(2, [deal(2, -50, NOW + 2 * MIN + 1)]) }), NOW + 3 * MIN, ctx());
    expect(fair.refused).toBe(0);
    expect(fair.over).toBe(0);
    expect(fair.book.n, 'расход — книга за описью вниз').toBe(20);
  });

  it('в войну — не больше книги: поддельные невольники не уходят в добычу нападающего', () => {
    const sheet = { bonded: 900 } as unknown as WarSheet;
    const book: GoodsBook = { at: NOW, have: {}, bonded: 900, bonds: { n: 41, due: [{ id: 'm:1', n: 9 }], led: [] } };
    expect(goodsSheet({ ...sheet, stock: {}, gold: 0, food: 0 } as WarSheet, NOW, book).bonded).toBe(50);
    const old: GoodsBook = { at: NOW, have: {}, bonded: 900 };
    expect(goodsSheet({ ...sheet, stock: {}, gold: 0, food: 0 } as WarSheet, NOW, old).bonded, 'книга старше — как было').toBe(900);
  });

  it('пленные боя мира — по таблице наград: груз уводимых на бойца; без дела — ни одного', () => {
    expect(DEED_TABLE.fight.led, 'таблица: уводимых на бойца с запасом').toBe(Math.ceil(stackEscort({ warrior: 1 }) * 1.2));
    const a = card({ troops: { spearman: 10 } });
    const b = card({ troops: { spearman: 10 }, won: 1, deeds: 1, bonded: 40 + 10 * DEED_TABLE.fight.led });
    expect(deedBonded(a, b, MIN)).toBe(10 * DEED_TABLE.fight.led);
    expect(bondedStep({ n: 40, due: [], led: [] }, a, NOW, b, NOW + MIN, ctx()).over).toBe(0);
    expect(deedBonded(a, { ...b, won: 0, deeds: 0 }, MIN)).toBe(0);
  });
});

// ------------------------------------------------ через настоящий обработчик записи ---

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

function player(id: number) {
  let etag: string | null = null;
  return {
    async push(watch: WatchCard, now: number): Promise<number> {
      const record = { v: 1, rev: 0, updatedAt: 0, device: 'dev-1', game: '{"pop":30}', world: null, card: { name: 'Вождь', day: 3, pop: 60, power: 500, army: 0 }, watch };
      const headers = { 'x-telegram-init-data': signInit(id, Math.floor(now / 1000) - 60), 'content-type': 'application/json' };
      const req = new Request('https://x/api/save', { method: 'PUT', headers, body: JSON.stringify({ baseEtag: etag, record }) });
      const res = await ROUTES['/api/save'](req, { stores: home.stores, now, ip: null });
      if (res.status === 200) etag = ((await res.json()) as { etag: string }).etag;
      return res.status;
    },
    async watch(): Promise<WatchRecord> {
      const found = await home.stores(STORES.watch).getWithMetadata(`tg-${id}`);
      return readWatchRecord(found ? JSON.parse(String(found.data)) : null);
    },
  };
}

describe('АУ-8 п. 2: книга невольников в записи партии', () => {
  it('первая опись заводит книгу без флага; невольники из ничего — флаг «невольники» со строкой «внимание:»', async () => {
    const p = player(7101);
    expect(await p.push(card({ bonded: 40 }), NOW)).toBe(200);
    let rec = await p.watch();
    expect(rec.flags.map((f) => f.kind)).not.toContain('bonded');
    expect(rec.goods?.bonds?.n).toBe(40);
    expect(await p.push(card({ clock: NOW + MIN, time: 1002, bonded: 900 }), NOW + MIN)).toBe(200);
    rec = await p.watch();
    expect(rec.flags.map((f) => f.kind)).toContain('bonded');
    expect(rec.journal.some((e) => e.text.startsWith('внимание:') && /Невольников заявлено 900/.test(e.text))).toBe(true);
    expect(rec.goods?.bonds?.n, 'книга держит своё').toBe(40 + BONDED_SLACK);
  });

  it('честный рост: бой с победой и уведёнными — без флага', async () => {
    const p = player(7102);
    const troops = { spearman: 10 };
    expect(await p.push(card({ bonded: 40, troops }), NOW)).toBe(200);
    expect(await p.push(card({ clock: NOW + MIN, time: 1002, troops, won: 1, deeds: 1, bonded: 40 + 30 }), NOW + MIN)).toBe(200);
    expect((await p.watch()).flags.map((f) => f.kind)).not.toContain('bonded');
  });
});
