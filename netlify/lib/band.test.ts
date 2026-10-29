// Отряд бродяги в реестре (ПН-3, docs/gdd/path_of_sword.md, 3.5.6, 6.1.3; «Решения ПН-3»): место выхода назначает сервер, ход и
// лагерь выводит сам дверью `world/roam`, подделка — отказ и флаг. Путь здесь включён подменой модуля — на сервере тем же
// выключателем, что у клиента (`game/roamflag`); выключенный держит `bandoff.test.ts`.
//
// Граница области — утверждениями: игроки правда стоят (замок у одного, отряд у другого), клетка правда вода, срок правда
// короче пути, руин правда нет — иначе отказ и флаг мерили бы не то правило.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ROUTES } from './routes/index.js';
import { STORES } from './kv.js';
import { ROSTER_KEY, bandOrder, emptyRoster, readRoster } from './roster.js';
import { readWatchRecord, type FlagKind } from './watch.js';
import type { BandRow, RosterResponse } from './contract.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';
import { ROAM_STUBS } from '../../src/game/roamstubs.js';
import { roamSeat, roamWalkMs, roamWhere, shelterAt } from '../../src/world/roam.js';
import { distance } from '../../src/world/geo.js';
import { fitToSettle } from '../../src/world/settle.js';
import { isWaterAt, settleable } from '../../src/world/land.js';
import { SPAWNS, inSicilyTheatre } from '../../src/world/spawn.js';
import { ruinAt } from '../../src/world/ruins.js';

vi.mock('../../src/game/roamflag.js', () => ({ ROAM_ON: true }));

const NOW = 1_900_000_000_000;
let home: Home;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  home = sqliteHome();
  for (const k of ['TELEGRAM_BOT_TOKEN', 'TRIBE_SPAWN']) saved[k] = process.env[k];
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
  // Тест с игроками на Сицилии: замки — по местам острова, отряды — в регионе острова.
  process.env.TRIBE_SPAWN = 'sicily';
});
afterEach(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await home.close();
});

// Игроки в каждом тесте свои: ведро частоты запросов (`http.allow`) живёт в процессе, и минута «через сутки» одного теста
// оставила бы его пустым для того же игрока в следующем.
const io = (now: number) => ({ stores: home.stores, now, ip: null });
const signed = (id: number, now: number) => ({ 'x-telegram-init-data': signInit(id, Math.floor(now / 1000) - 60), 'content-type': 'application/json' });

async function call(id: number, now: number, method: 'GET' | 'PUT' | 'POST', body?: unknown): Promise<{ status: number; data: RosterResponse }> {
  const req = new Request('https://x/api/castles', { method, headers: signed(id, now), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const res = await ROUTES['/api/castles'](req, io(now));
  return { status: res.status, data: res.status === 200 ? ((await res.json()) as RosterResponse) : ({} as RosterResponse) };
}

const seat = (id: number, now: number) => call(id, now, 'POST', { op: 'seat', name: `Герой ${id}`, prestige: 5, men: 6 });
const castle = (id: number, now: number) => call(id, now, 'PUT', { name: `Вождь ${id}`, city: 'Энна', power: 1, pop: 1 });

async function flags(id: number): Promise<FlagKind[]> {
  const found = await home.stores(STORES.watch, 'strong').getWithMetadata(`tg-${id}`);
  return readWatchRecord(found ? JSON.parse(String(found.data)) : null).flags.map((f) => f.kind);
}

async function file() {
  const found = await home.stores(STORES.world).getWithMetadata(ROSTER_KEY);
  return readRoster(found ? JSON.parse(String(found.data)) : null);
}

describe('место выхода назначает сервер', () => {
  it('у руин или опушки, на суше замка, в регионе острова, не ближе заглушки к замкам и к другим новичкам', async () => {
    expect((await castle(101, NOW)).status).toBe(200);
    expect((await castle(102, NOW)).status).toBe(200);
    const a = await seat(201, NOW + 1000);
    expect(a.status).toBe(200);
    const b = await seat(202, NOW + 2000);
    const gap = ROAM_STUBS.spawnGap.value;
    const f = await file();
    const castles = Object.values(f.rows);
    expect(castles).toHaveLength(2);
    for (const [band, other] of [
      [a.data.band!, null],
      [b.data.band!, a.data.band!],
    ] as [BandRow, BandRow | null][]) {
      const at = band.way.to;
      expect(shelterAt(at)).toBe(true);
      expect(fitToSettle(at)).toBe(true);
      expect(inSicilyTheatre(at)).toBe(true);
      for (const c of castles) expect(distance(at, c)).toBeGreaterThanOrEqual(gap);
      if (other) expect(distance(at, other.way.to), 'от новичка').toBeGreaterThanOrEqual(gap);
    }
    // Метка рождения — часы сервера; клиент её не присылает.
    expect(a.data.band?.born).toBe(NOW + 1000);
    // Строки замка у бродяги нет; у владельца замка нет строки отряда.
    expect(f.rows['tg-201']).toBeUndefined();
    expect(f.bands?.['tg-101']).toBeUndefined();
  });

  it('старый клиент читает реестр как раньше: в списке замков отрядов нет; чужой отряд вне обзора не отдаётся (обнаружение — ПН-4у, bandsight.test.ts)', async () => {
    await castle(101, NOW);
    await seat(201, NOW + 1000);
    await seat(202, NOW + 2000);
    const lord = await call(101, NOW + 3000, 'GET');
    expect(lord.data.band).toBeUndefined();
    expect(lord.data.castles.map((c) => c.name)).toEqual(['Вождь 101']);
    const band = await call(201, NOW + 3000, 'GET');
    expect(band.data.band?.name).toBe('Герой 201');
    expect(band.data.mine).toBeNull();
    expect(JSON.stringify(band.data)).not.toContain('Герой 202');
  });
});

describe('ход отряда: сервер выводит его сам той же дверью', () => {
  it('«Идти сюда»: срок — путь двери хода; положение — функцией записи, без опроса', async () => {
    const s = (await seat(201, NOW)).data.band!;
    const from = s.way.to;
    let to = from;
    for (let d = 3; d < 12 && to === from; d++) for (const c of [{ x: from.x + d, y: from.y }, { x: from.x - d, y: from.y }, { x: from.x, y: from.y + d }, { x: from.x, y: from.y - d }]) if (to === from && settleable(c.x, c.y) && inSicilyTheatre(c)) to = c;
    expect(to).not.toBe(from);
    const walk = roamWalkMs(from, to, 'normal');
    const go = await call(201, NOW + 5000, 'POST', { op: 'go', to, until: NOW + 5000 + walk });
    expect(go.data.error).toBeUndefined();
    const row = go.data.band!;
    expect(row.way).toEqual({ from, to, at: NOW + 5000, until: NOW + 5000 + walk });
    // Сервер не опрашивает отряд: та же строка, чтение через сутки — положение функцией записи.
    const later = await call(201, NOW + 86_400_000, 'GET');
    expect(later.data.band?.way).toEqual(row.way);
    expect(roamWhere(later.data.band!.way, NOW + 86_400_000)).toEqual(to);
    expect(await flags(201)).toEqual([]);
  });

  it('подделка: вода — отказ и флаг; срок короче пути — ход своим сроком и флаг «срок пути»', async () => {
    const s = (await seat(211, NOW)).data.band!;
    const from = s.way.to;
    let sea = from;
    for (let d = 1; d < 60 && sea === from; d++) for (const c of [{ x: from.x + d, y: from.y }, { x: from.x - d, y: from.y }, { x: from.x, y: from.y + d }, { x: from.x, y: from.y - d }]) if (sea === from && isWaterAt(c.x, c.y)) sea = c;
    expect(isWaterAt(sea.x, sea.y)).toBe(true);
    const wet = await call(211, NOW + 1000, 'POST', { op: 'go', to: sea });
    expect(wet.data.error).toBe('Туда не пройти: там вода. Идут в клетку суши.');
    expect(wet.data.band?.way).toEqual(s.way);
    expect(await flags(211)).toContain('forged');
    let to = from;
    for (let d = 3; d < 12 && to === from; d++) for (const c of [{ x: from.x + d, y: from.y }, { x: from.x - d, y: from.y }, { x: from.x, y: from.y + d }]) if (to === from && settleable(c.x, c.y) && inSicilyTheatre(c)) to = c;
    const fast = await call(211, NOW + 2000, 'POST', { op: 'go', to, until: NOW + 2000 + 1000 });
    expect(fast.data.error).toBeUndefined();
    // Граница: названный срок правда раньше пути дальше запаздывания приказа.
    expect(roamWalkMs(from, to, 'normal')).toBeGreaterThan(1000 + 90_000);
    expect(fast.data.band?.way.until).toBe(NOW + 2000 + roamWalkMs(from, to, 'normal'));
    expect(await flags(211)).toContain('walk');
  });

  it('лагерь в руинах там, где руин нет, — отказ и флаг; открытый — встаёт', async () => {
    const s = (await seat(221, NOW)).data.band!;
    const at = s.way.to;
    const ruins = ruinAt(at.x, at.y) !== null;
    const res = await call(221, NOW + 1000, 'POST', { op: 'camp', kind: 'ruin', men: 6 });
    if (ruins) {
      expect(res.data.band?.camp?.kind).toBe('ruin');
    } else {
      expect(res.data.error).toBe('Здесь нет руин: в руинах встают у руин на карте.');
      expect(await flags(221)).toContain('forged');
    }
    const open = await call(221, NOW + 2000, 'POST', { op: 'camp', kind: 'open', men: 6 });
    expect(open.data.band?.camp).toEqual(ruins ? { kind: 'open', since: NOW + 1000, builders: 6 } : { kind: 'open', since: NOW + 2000, builders: 6 });
  });

  it('у игрока либо замок, либо отряд: приказ отряда от замка и строка замка от отряда — отказ и флаг', async () => {
    await castle(131, NOW);
    const lordBand = await seat(131, NOW + 1000);
    expect(lordBand.data.error).toBe('У тебя замок: отряда бродяги нет.');
    expect(await flags(131)).toContain('forged');
    await seat(231, NOW);
    const bandCastle = await castle(231, NOW + 1000);
    expect(bandCastle.data.error).toBe('Ты бродяга: замка у тебя нет.');
    expect((await file()).rows['tg-231']).toBeUndefined();
    expect(await flags(231)).toContain('forged');
  });
});

describe('приказ отряда — чистая функция реестра', () => {
  it('сил не хватает и минутой раньше — флаг; хватало минутой раньше — отказ без флага (запаздывание приказа)', () => {
    const at = SPAWNS[0];
    const to = { x: at.x + 3, y: at.y };
    expect(settleable(to.x, to.y)).toBe(true);
    const row = (value: number, mode: 'hold' | 'drain', rate?: number): BandRow => ({
      ...roamSeat(at, NOW),
      energy: { value, at: NOW, mode, ...(rate ? { rate, stopAt: NOW + 3_600_000 } : {}) },
      camp: undefined,
      born: NOW,
      name: 'x',
      prestige: 0,
      men: 5,
      seenAt: NOW,
    } as BandRow);
    const f = (b: BandRow) => ({ ...emptyRoster(), bands: { k: b } });
    const need = (roamWalkMs(at, to, 'normal') * 100) / (50 * 30 * 60_000);
    // Граница: дорога правда стоит больше единицы.
    expect(need).toBeGreaterThan(1);
    const dry = bandOrder(f(row(0, 'hold')), 'k', { op: 'go', to }, NOW + 1000, 'sicily');
    expect(dry.error).toMatch(/^Не хватит сил на дорогу/);
    expect(dry.forged?.kind).toBe('forged');
    // Отряд в пути: за минуту до приказа сил хватало, к приказу дорога их съела — честный клиент видел окно минутой раньше.
    const walking: BandRow = {
      ...row(0, 'hold'),
      energy: { value: need + 0.03, at: NOW - 60_000, mode: 'drain', stopAt: NOW + 3_600_000 },
      way: { from: at, to: { x: at.x - 4, y: at.y }, at: NOW - 60_000, until: NOW + 3_600_000 },
    };
    const late = bandOrder(f(walking), 'k', { op: 'go', to }, NOW, 'sicily');
    expect(late.error).toMatch(/^Не хватит сил на дорогу/);
    expect(late.forged).toBeNull();
  });
});
