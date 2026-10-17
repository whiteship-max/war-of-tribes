import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from './routes/index.js';
import { STORES } from './kv.js';
import { ROSTER_KEY, castleIdOf, readRoster, upsert, emptyRoster } from './roster.js';
import { readClaim, type RatingResponse, type RosterResponse } from './contract.js';
import { DEFAULT_ARMS, anyArms, armsCode, armsOr, lairArms } from '../../src/heraldry/arms.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';

/**
 * П-2 (docs/polish.md): герб державы доходит до соседей через реестр замков, и сервер пускает его только из набора
 * (правило ЗЩ-1: клиенту не верим). Через настоящий обработчик `/api/castles` на SQLite: что один игрок записал, то другой
 * читает; подделанные части — 400, и строка в реестре не меняется; строка до гербов — без поля, у соседей прежняя башня.
 */
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
const signed = (id: number, now: number) => ({ 'x-telegram-init-data': signInit(id, Math.floor(now / 1000) - 60) });

async function claim(id: number, body: Record<string, unknown>, now = NOW): Promise<Response> {
  const req = new Request('https://x/api/castles', {
    method: 'PUT',
    headers: { ...signed(id, now), 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Вождь', city: 'Энна', power: 1, pop: 1, ...body }),
  });
  return ROUTES['/api/castles'](req, io(now));
}

async function roster(id: number, now = NOW): Promise<RosterResponse> {
  const res = await ROUTES['/api/castles'](new Request('https://x/api/castles', { headers: signed(id, now) }), io(now));
  expect(res.status).toBe(200);
  return (await res.json()) as RosterResponse;
}

async function stored() {
  const found = await home.stores(STORES.world).getWithMetadata(ROSTER_KEY);
  return readRoster(found ? JSON.parse(String(found.data)) : null);
}

/** Между двумя записями одной строки реестра (`routes/castles.MIN_WRITE_MS`). */
const MIN_WRITE = 10_000;

const LION = 'french-quarterly-azure-or-lion-gules';
const EAGLE = 'kite-plain-sable-sable-eagle-or';

describe('герб в реестре замков', () => {
  it('сохраняется и доходит до соседей: реестр и рейтинг', async () => {
    expect((await claim(6001, { arms: LION })).status).toBe(200);
    expect((await claim(6002, { arms: EAGLE }, NOW + 1000)).status).toBe(200);
    const seen = await roster(6002, NOW + 2000);
    const neighbour = seen.castles.find((c) => c.id === castleIdOf('tg-6001'));
    expect(neighbour?.arms).toBe(LION);
    expect(armsCode(armsOr(neighbour?.arms))).toBe(LION);
    // Сменил герб — соседи видят новый (строка переписывается ради герба, даже если остальное то же и тишина не вышла).
    const later = NOW + MIN_WRITE + 1000;
    expect((await claim(6001, { arms: EAGLE }, later)).status).toBe(200);
    expect((await roster(6002, later + 1000)).castles.find((c) => c.id === castleIdOf('tg-6001'))?.arms).toBe(EAGLE);

    const res = await ROUTES['/api/rating'](new Request('https://x/api/rating', { headers: signed(6002, later + 2000) }), io(later + 2000));
    const rows = ((await res.json()) as RatingResponse).rows;
    expect(rows.find((r) => r.id === castleIdOf('tg-6001'))?.arms).toBe(EAGLE);
    expect(rows.find((r) => r.mine)?.arms).toBe(EAGLE);
  });

  it('подделанные части — отказ 400, и строка в реестре прежняя', async () => {
    expect((await claim(6011, { arms: LION })).status).toBe(200);
    for (const bad of [
      'french-quarterly-azure-or-dragon-gules',
      'french-checky-azure-or-lion-gules',
      'heater-plain-or-or-tower-argent',
      'kite-plain-sable-sable-axes-argent',
      'heater-plain-or-or-skull-sable',
      `${LION}-x`,
      'x'.repeat(5000),
      42,
      { shield: 'heater' },
      ['heater', 'plain'],
    ]) {
      const res = await claim(6011, { arms: bad }, NOW + 1000);
      expect(res.status, JSON.stringify(bad).slice(0, 60)).toBe(400);
    }
    expect((await stored()).rows['tg-6011'].arms).toBe(LION);
    // Новичок с подделкой в реестр не встаёт вовсе.
    expect((await claim(6012, { arms: 'kite-plain-sable-sable-wolf-argent' })).status).toBe(400);
    expect((await stored()).rows['tg-6012']).toBeUndefined();
  });

  it('старый игрок без герба: поля нет, соседи видят прежний герб-башню', async () => {
    expect((await claim(6021, {})).status).toBe(200);
    expect((await claim(6022, { arms: LION }, NOW + 1000)).status).toBe(200);
    const row = (await roster(6022)).castles.find((c) => c.id === castleIdOf('tg-6021'));
    expect(row).toBeDefined();
    expect(row!.arms).toBeUndefined();
    expect(armsOr(row!.arms)).toEqual(DEFAULT_ARMS);
    expect(armsCode(DEFAULT_ARMS)).toBe('heater-plain-or-or-tower-sable');
  });

  it('строка, легшая в хранилище в обход заявки, на чтении герба не несёт', () => {
    const file = upsert(emptyRoster(), 'tg-1', { name: 'А', city: '', power: 1, pop: 1 }, NOW);
    const forged = { ...file, rows: { 'tg-1': { ...file.rows['tg-1'], arms: armsCode(lairArms('x')) } } };
    expect(anyArms(forged.rows['tg-1'].arms).charge).toMatch(/axes|skull|wolf/);
    expect(readRoster(forged).rows['tg-1'].arms).toBeUndefined();
    // И заявка с пустым гербом — не ошибка: это «не собирал».
    expect(readClaim({ name: 'А', city: '', power: 1, pop: 1, arms: '' })).toEqual({ name: 'А', city: '', power: 1, pop: 1 });
  });
});
