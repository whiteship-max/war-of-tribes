// АУ-8, п. 8 (решение владельца 26.10.2026): «добро без дела» (`WatchCard.windfalls`, АУ-3) сверяется с книгами сервера.
// Продажа — книгой рынка (выручка сделок описи, невольники — не больше книги невольников), дань войны и кража лазутчика у
// соседа — записью войн (принятое клиентом между описями), прочее добро без дела мира (падение логова голодом, выкуп осады
// логова, возврат найма, ковки и разведки) — потолком таблицы данных (`DEED_TABLE.windfall`, выводит `scripts/deeds/derive.ts`,
// сверяет `derive.test.ts`). Прежде золото добра без дела было без потолка: прибавка `windfalls` давала любую казну без флага.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deedGain } from './deeds.js';
import { flagsBetween, windfallKnown } from './watch.js';
import { seedTown } from './town.js';
import { WARS_KEY, emptyWars, type WarFile, type WarRow } from './war.js';
import { ROUTES } from './routes/index.js';
import { STORES } from './kv.js';
import { readWatchRecord, type WatchRecord } from './watch.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';
import type { WarSheet } from './contract.js';
import { spySeenId, warTributeId, type WatchCard, type WatchDeal } from './contract.js';
import { DEED_TABLE } from '../../src/game/data/deedgain.js';
import { BONDED_GOOD } from '../../src/game/data/market.js';
import { START_POP } from '../../src/game/constants.js';
import { storageOf } from '../../src/game/build.js';

const NOW = 1_900_000_000_000;
const MIN = 60_000;
const KEY = 'tg-7301';
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
  outlays: 0,
  ...over,
});

const sale = (seq: number, good: string, n: number, gold: number): WatchDeal => ({ seq, at: NOW + 1, good, n: -n, gold, q: 0 });
const market = (seq: number, deals: WatchDeal[]): WatchCard['market'] => ({ w: 1, bought: {}, sold: {}, got: 0, seq, press: {}, deals });
const stockFlag = (a: WatchCard, b: WatchCard, known = {}): boolean => flagsBetween(a, NOW, b, NOW + MIN, known).some((f) => f.kind === 'stock');

describe('АУ-8 п. 8: добро без дела — по книгам сервера', () => {
  it('золото: счётчик добра без дела без продаж и без бойцов — потолок таблицы, а не бесконечность', () => {
    const a = card();
    const b = card({ deeds: 1, windfalls: 1, stock: { ...a.stock, gold: 900_000 } });
    expect(deedGain(a, b, MIN, {}).gold, 'потолок конечен').toBeLessThan(Infinity);
    expect(stockFlag(a, b), 'казна из ничего — флаг').toBe(true);
  });

  it('продажа — книгой рынка: выручка сделок описи объясняет казну; сверх неё — флаг', () => {
    const a = card({ market: market(0, []) });
    const b = card({ deeds: 1, windfalls: 1, market: market(1, [sale(1, 'wood', 100, 500)]), stock: { wood: 900, stone: 1000, gold: 510 } });
    expect(deedGain(a, b, MIN, {}).gold).toBeGreaterThanOrEqual(500);
    expect(stockFlag(a, b), 'честная продажа').toBe(false);
    expect(stockFlag(a, { ...b, stock: { ...b.stock, gold: 50_510 } }), 'выручка сверх сделок').toBe(true);
  });

  it('невольники: выручка — только за тех, что были по книге невольников', () => {
    const a = card({ bonded: 10, market: market(0, []) });
    const b = card({ deeds: 1, windfalls: 1, bonded: 0, market: market(1, [sale(1, BONDED_GOOD.id, 10, 400)]) });
    expect(deedGain(a, b, MIN, {}, { bonded: 10 }).gold).toBeGreaterThanOrEqual(400);
    // По книге невольников их не было — выручка не подтверждена (отказ продажи, п. 2).
    expect(deedGain(a, b, MIN, {}, { bonded: 0 }).gold).toBeLessThan(400);
  });

  it('дань войны и кража лазутчика у соседа — записью войн: принятое клиентом между описями, один раз', () => {
    const file: WarFile = emptyWars();
    file.wars.push({ id: 'w1', atk: KEY, def: 'tg-7302', tribute: { at: NOW, taken: { wood: 3000, gold: 700 }, hidden: 0 } } as unknown as WarRow);
    file.spies = [{ id: 's1', atk: KEY, def: 'tg-7303', deed: 'theft', out: { at: NOW, ok: true, slipped: false, held: false, dead: false, stolen: { stone: 400, gold: 300 } } }] as unknown as WarFile['spies'];
    const seen = [warTributeId('w1'), spySeenId('s1')];
    const first = windfallKnown(file, KEY, seen, []);
    expect(first.known).toEqual({ stock: { wood: 3000, stone: 400 }, gold: 1000, items: 2 });
    expect(windfallKnown(file, KEY, seen, first.ids).known, 'второй раз — ничего').toEqual({ stock: {}, gold: 0, items: 0 });
    expect(windfallKnown(file, KEY, [], []).known.items, 'не принятое клиентом — не в допуске').toBe(0);
    const a = card();
    const b = card({ deeds: 2, windfalls: 2, stock: { wood: 4000, stone: 1400, gold: 1010 } });
    expect(stockFlag(a, b, { windfall: first.known }), 'честная дань и кража').toBe(false);
    expect(stockFlag(a, { ...b, stock: { ...b.stock, gold: 90_000 } }, { windfall: first.known }), 'сверх записи войн').toBe(true);
  });

  it('прочее добро без дела мира — груз бойцов (падение логова, выкуп осады логова) по таблице', () => {
    expect(DEED_TABLE.windfall.carry, 'груз на бойца — из таблицы').toBe(DEED_TABLE.fight.carry);
    const a = card({ troops: { spearman: 10 } });
    const b = card({ troops: { spearman: 10 }, deeds: 1, windfalls: 1 });
    expect(deedGain(a, b, MIN, {}).gold).toBe(10 * DEED_TABLE.windfall.carry + DEED_TABLE.windfall.gold);
  });
});

// ------------------------------------------------ через настоящий обработчик записи ---

let home: Home;
let token: string | undefined;
beforeEach(() => {
  token = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
  home = sqliteHome();
});
afterEach(async () => {
  if (token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
  else process.env.TELEGRAM_BOT_TOKEN = token;
  await home.close();
});

const sheetSeen = (seen: string[]): WarSheet =>
  ({ army: {}, home: {}, militia: 0, archers: 0, resolve: 0, pips: {}, rest: 1, food: 0, townPerHour: 0, perManPerHour: 0, stock: {}, stash: 0, gold: 0, pop: 30, bonded: 0, levels: {}, power: 0, locks: {}, seen }) as WarSheet;

function player(id: number) {
  let etag: string | null = null;
  return {
    async push(watch: WatchCard, war: WarSheet, now: number): Promise<number> {
      const record = { v: 1, rev: 0, updatedAt: 0, device: 'dev-1', game: '{"pop":30}', world: null, card: { name: 'Вождь', day: 3, pop: 60, power: 500, army: 0 }, watch, war };
      const headers = { 'x-telegram-init-data': signInit(id, Math.floor(now / 1000) - 60), 'content-type': 'application/json' };
      const res = await ROUTES['/api/save'](new Request('https://x/api/save', { method: 'PUT', headers, body: JSON.stringify({ baseEtag: etag, record }) }), { stores: home.stores, now, ip: null });
      if (res.status === 200) etag = ((await res.json()) as { etag: string }).etag;
      return res.status;
    },
    async watch(): Promise<WatchRecord> {
      const found = await home.stores(STORES.watch).getWithMetadata(`tg-${id}`);
      return readWatchRecord(found ? JSON.parse(String(found.data)) : null);
    },
  };
}

describe('АУ-8 п. 8: дань войны в записи партии — по записи войн, один раз', () => {
  it('принятая дань объясняет казну; та же дань второй раз — уже нет', async () => {
    const id = 7311;
    const file = emptyWars();
    file.wars.push({ id: 'w9', atk: `tg-${id}`, def: 'tg-7312', phase: 'done', battles: [], tribute: { at: NOW, taken: { wood: 2000, gold: 900 }, hidden: 0 } } as unknown as WarRow);
    await home.stores(STORES.world, 'strong').setJSON(WARS_KEY, file);
    const p = player(id);
    expect(await p.push(card(), sheetSeen([]), NOW)).toBe(200);
    const paid = card({ clock: NOW + MIN, time: 1002, deeds: 1, windfalls: 1, stock: { wood: 3000, stone: 1000, gold: 910 } });
    expect(await p.push(paid, sheetSeen([warTributeId('w9')]), NOW + MIN)).toBe(200);
    let rec = await p.watch();
    expect(rec.flags.map((f) => f.kind), 'честная дань').not.toContain('stock');
    expect(rec.wf).toEqual([warTributeId('w9')]);
    // Та же дань не объясняет новую казну: подделка поднимает счётчик и казну ещё раз.
    const again = card({ clock: NOW + 2 * MIN, time: 1004, deeds: 2, windfalls: 2, stock: { wood: 3000, stone: 1000, gold: 50_910 } });
    expect(await p.push(again, sheetSeen([warTributeId('w9')]), NOW + 2 * MIN)).toBe(200);
    rec = await p.watch();
    expect(rec.flags.map((f) => f.kind)).toContain('stock');
  });
});
