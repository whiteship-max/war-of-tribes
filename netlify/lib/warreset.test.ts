// Старые войны после обнуления партии (ПН-5, хвост б; `partyreset`, 30.10.2026): война и тайное дело, начатые раньше минуты
// обнуления игрока, — прежней партии. Новой партии сервер их не отдаёт (`war.warsOf`, `spiesOf` с `since`), и применить их ей нечем:
// бои, падение и дань старой войны не ложатся на новую партию второй раз.
//
// Граница области — утверждениями: война начата раньше метки обнуления (внутри правила «прежней партии») и позже неё (снаружи);
// у необнулённой стороны та же война видна — иначе «не отдаётся» мерило бы пустую запись.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from './routes/index.js';
import { STORES } from './kv.js';
import { resetOf, resetParty } from './partyreset.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { WARS_KEY, applyOrder, emptyWars, spiesOf, warsOf, type SheetAt, type WarFile } from './war.js';
import type { CastleClaim, WarArmy, WarResponse, WarSheet } from './contract.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';

const A = 'tg-1001';
const B = 'tg-1002';
const C = 'tg-1003';
const T0 = 1_900_000_000_000;
const RESET = T0 + 60_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });
const sheet = (): WarSheet => ({
  army: { spearman: 60, archer: 30, swordsman: 30 },
  home: { spearman: 40, archer: 20 },
  militia: 20,
  archers: 6,
  resolve: 0,
  pips: {},
  rest: 1,
  food: 2000,
  townPerHour: 20,
  perManPerHour: 1,
  stock: { food: 2000, wood: 800, stone: 300 },
  stash: 100,
  gold: 400,
  pop: 400,
  bonded: 20,
  levels: { walls: 3, farm: 4, smithy: 2 },
  power: 5000,
  locks: {},
  seen: [],
});
const army = (troops: Record<string, number>): WarArmy => ({ troops, resolve: 0, pips: {} });

/** Две войны B: старая (A идёт на B) — до обнуления B, новая (B идёт на C) — после. */
function twoWars(): WarFile {
  let roster = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), T0);
  roster = upsert(roster, B, claim('Бета'), T0);
  roster = upsert(roster, C, claim('Гамма'), T0);
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(), at: T0 }],
    [B, { sheet: sheet(), at: T0 }],
    [C, { sheet: sheet(), at: T0 }],
  ]);
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null };
  const file = emptyWars();
  const march = { op: 'march' as const, target: castleIdOf(B), mode: 'siege' as const, fate: 'plunder' as const, army: army({ spearman: 20 }) };
  expect(applyOrder(file, A, march, T0, ctx)).toBeNull();
  expect(applyOrder(file, B, { ...march, target: castleIdOf(C), army: army({ archer: 10 }) }, RESET + 60_000, ctx)).toBeNull();
  expect(file.wars.map((w) => w.sentAt), 'граница: одна война до метки обнуления, другая после').toEqual([T0, RESET + 60_000]);
  return file;
}

describe('старые войны после обнуления партии (дверь `warsOf`)', () => {
  it('война, начатая раньше обнуления, обнулённому не отдаётся; позже — отдаётся; другой стороне — своя старая', () => {
    const file = twoWars();
    expect(warsOf(file, B).map((w) => w.sentAt), 'без обнуления видны обе').toEqual([RESET + 60_000, T0]);
    expect(warsOf(file, B, RESET).map((w) => w.sentAt)).toEqual([RESET + 60_000]);
    expect(warsOf(file, A).map((w) => w.sentAt), 'необнулённый нападающий видит свою старую').toEqual([T0]);
    // Ровно на метке — война уже новой партии (метка — минута стирания; раньше неё — прежняя).
    expect(warsOf(file, B, T0).map((w) => w.sentAt)).toEqual([RESET + 60_000, T0]);
  });

  it('тайное дело — тем же правилом', () => {
    const file = twoWars();
    // Дело лазутчика как строка записи: отдаётся оно защитнику только пойманным или сделанным — здесь важна одна минута.
    const spy = { id: 's1', atk: A, def: B, sentAt: T0, arriveAt: T0 + 1000 } as unknown as NonNullable<WarFile['spies']>[number];
    file.spies = [spy];
    expect(spiesOf(file, A).length, 'граница: нападающий видит своё дело').toBe(1);
    expect(spiesOf(file, A, RESET)).toEqual([]);
  });
});

describe('старые войны после обнуления партии (адрес `/api/war`)', () => {
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

  const pull = async (id: number, now: number): Promise<WarResponse> => {
    const headers = { 'x-telegram-init-data': signInit(id, Math.floor(now / 1000) - 60) };
    const res = await ROUTES['/api/war'](new Request('https://x/api/war', { method: 'GET', headers }), { stores: home.stores, now, ip: null });
    expect(res.status).toBe(200);
    return (await res.json()) as WarResponse;
  };

  it('после обнуления новая партия получает только войну, начатую позже метки; нападающий — свою старую', async () => {
    await home.stores(STORES.world, 'strong').setJSON(WARS_KEY, twoWars());
    const now = RESET + 120_000;
    expect((await pull(1002, now)).wars.length, 'до обнуления защитник видит обе').toBe(2);
    await resetParty(home.stores, B, 0, RESET);
    expect(await resetOf(home.stores, B)).toBe(RESET);
    expect((await pull(1002, now)).wars.map((w) => w.sentAt)).toEqual([RESET + 60_000]);
    expect((await pull(1001, now)).wars.map((w) => w.sentAt)).toEqual([T0]);
  });
});
