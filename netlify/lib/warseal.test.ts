// Сид живой войны (БЕЗ-1, docs/trust-boundary.md, 6в): номер войны клиент видит, а общий код боя и фаз осады у него есть. С секретом
// сервера (`TRIBE_WAR_SECRET`) сид боя, кость фазы, падение и дело лазутчика выводятся из номера, закрытого секретом (`warseal.sealed`), —
// клиент вперёд не досчитает; без секрета — прежние сиды (тесты, отчёты и прибор не сдвигаются).
//
// Граница области — утверждениями: бой правда был (штурм дошёл), лагерь правда встал и фазы правда брошены сервером (их не меньше
// названного), и без секрета клиент по виду войны досчитывает их все — то есть находка жива, и тест мерит её закрытие, а не пустоту.
// Секрет в тесте — тестовый ключ (хеш строки-метки), а не значение сервера: так прогон повторяется число в число.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CastleClaim, WarArmy, WarResponse, WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { WARS_KEY, advance, applyOrder, battleSeed, emptyWars, warSeed, warsOf, type SheetAt, type WarFile, type WarRow } from './war.js';
import { WAR_SECRET, sealed, unsealed, warSecret } from './warseal.js';
import { ROUTES } from './routes/index.js';
import { STORES } from './kv.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';
import { dieOf, phaseAt, rollSeed, rowsOf, setPhaseDie } from '../../src/world/siegeroll.js';
import { siegeSince, type SiegeWindow } from '../../src/world/siege.js';

const A = 'tg-2001';
const B = 'tg-2002';
const T0 = 1_900_000_000_000;
const HOUR = 3600_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });
const sheet = (): WarSheet => ({
  army: { spearman: 60, archer: 30, swordsman: 30 },
  home: { spearman: 40, archer: 20 },
  militia: 20,
  archers: 6,
  resolve: 0,
  pips: {},
  rest: 1,
  // Хлеба — на много фаз: голод не обрывает осаду раньше, чем брошены фазы, о которых тест.
  food: 20_000,
  townPerHour: 20,
  perManPerHour: 1,
  stock: { food: 20_000, wood: 800, stone: 300 },
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

function setup(t0: number) {
  let roster = emptyRoster();
  roster = upsert(roster, A, claim('Альфа'), t0);
  roster = upsert(roster, B, claim('Бета'), t0);
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(), at: t0 }],
    [B, { sheet: sheet(), at: t0 }],
  ]);
  return { sheets, ctx: { roster, sheet: (k: string) => sheets.get(k) ?? null }, file: emptyWars() as WarFile };
}

/** Штурм с ходу: бой — в минуту прихода. */
function stormed(t0: number): { file: WarFile; w: WarRow } {
  const s = setup(t0);
  expect(applyOrder(s.file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: army({ spearman: 60, archer: 30 }) }, t0, s.ctx)).toBeNull();
  const w = s.file.wars[0];
  advance(s.file, w.arriveAt + 1, s.sheets);
  expect(w.battles.length, 'точка внутри области: бой был').toBeGreaterThan(0);
  return { file: s.file, w };
}

/**
 * Осада: лагерь встал, сервер бросает фазы до `phases` или до конца войны. Возвращает войну и пары «что брошено — что клиент досчитал бы
 * по виду войны у защитника» (сид лагеря из `campId` и минуты постановки, кость — `dieOf`: тот же код, что у сервера).
 */
function besieged(t0: number, phases: number): { w: WarRow; pairs: { die: number; guess: number }[] } {
  const s = setup(t0);
  expect(applyOrder(s.file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 60, archer: 30 }) }, t0, s.ctx)).toBeNull();
  const w = s.file.wars[0];
  advance(s.file, w.arriveAt + 1, s.sheets);
  expect(w.phase, 'точка внутри области: лагерь встал').toBe('camp');
  const since = siegeSince(w.camp as SiegeWindow);
  // Вид войны у защитника после каждой фазы — то, что у клиента есть: лагерь с номером и брошенными строками. Война кончилась —
  // лагеря в виде нет, считаем по последнему.
  let camp: SiegeWindow | null = null;
  for (let k = 1; k <= phases && w.phase === 'camp'; k++) {
    advance(s.file, phaseAt(since, k) + 1, s.sheets);
    const seen = warsOf(s.file, B).find((x) => x.id === w.id)?.camp as SiegeWindow | undefined;
    if (seen) camp = seen;
  }
  const rows = camp ? rowsOf(camp) : [];
  const pairs = rows.map((r, i) => ({ die: r.die, guess: dieOf(rollSeed(camp as SiegeWindow), i + 1) }));
  return { w, pairs };
}

let saved: string | undefined;
beforeEach(() => {
  saved = process.env[WAR_SECRET];
  setPhaseDie(null);
});
afterEach(() => {
  if (saved === undefined) delete process.env[WAR_SECRET];
  else process.env[WAR_SECRET] = saved;
});
const TEST_KEY = createHash('sha256').update('warseal.test: тестовый ключ, не секрет сервера').digest('hex');
const secret = (): string => {
  const v = TEST_KEY;
  process.env[WAR_SECRET] = v;
  return v;
};

describe('секрет сидов войны (warseal)', () => {
  it('без секрета номер как есть; с секретом — другой, повторяемый, свой у каждого назначения и без секрета внутри', () => {
    delete process.env[WAR_SECRET];
    expect(warSecret()).toBe('');
    expect(sealed('w1abc', 'battle#0')).toBe('w1abc');
    const v = secret();
    const a = sealed('w1abc', 'battle#0');
    expect(a).not.toBe('w1abc');
    expect(sealed('w1abc', 'battle#0')).toBe(a);
    expect(sealed('w1abc', 'battle#1')).not.toBe(a);
    expect(sealed('w1abc', 'siege')).not.toBe(a);
    expect(a).not.toContain(v.slice(0, 8));
    expect(unsealed(() => sealed('w1abc', 'battle#0')), 'репетиция окна — без секрета').toBe('w1abc');
    expect(sealed('w1abc', 'battle#0'), 'после репетиции секрет снова в силе').toBe(a);
  });
});

describe('сид боя живой войны', () => {
  // Набор: восемь войн с разной минутой приказа — восемь номеров (правило 17: не один бой).
  const T = Array.from({ length: 8 }, (_, i) => T0 + i * 7 * HOUR + i * 977);

  it('без секрета — прежний сид из номера (тесты, отчёты, прибор не сдвигаются)', () => {
    delete process.env[WAR_SECRET];
    for (const t of T) {
      const { w } = stormed(t);
      expect(w.battles[0].input.seed).toBe(warSeed(w.id, 0));
    }
  });

  it('с секретом сид боя по номеру войны не досчитать', () => {
    secret();
    for (const t of T) {
      const { w } = stormed(t);
      expect(w.battles[0].input.seed, `война ${w.id}: сид боя — номер, закрытый секретом`).toBe(battleSeed(w.id, 0));
      expect(w.battles[0].input.seed, `война ${w.id}: сид боя не выводится из номера, который видит клиент`).not.toBe(warSeed(w.id, 0));
    }
  });
});

describe('кость фазы осады', () => {
  // Набор: четыре осады по восемь фаз — не меньше шестнадцати брошенных фаз в сумме.
  const T = [T0, T0 + 3 * HOUR + 11, T0 + 9 * HOUR + 37, T0 + 20 * HOUR + 101];
  const pool = (): { die: number; guess: number }[] => T.flatMap((t) => besieged(t, 8).pairs);

  it('без секрета клиент досчитывает каждую фазу по виду войны — находка жива', () => {
    delete process.env[WAR_SECRET];
    const pairs = pool();
    expect(pairs.length, 'точка внутри области: фаз брошено достаточно').toBeGreaterThanOrEqual(16);
    expect(pairs.filter((p) => p.die === p.guess).length).toBe(pairs.length);
  });

  it('с секретом совпадает не больше трети — на уровне случая (d14), а не все', () => {
    secret();
    const pairs = pool();
    expect(pairs.length, 'точка внутри области: фаз брошено достаточно').toBeGreaterThanOrEqual(16);
    const hit = pairs.filter((p) => p.die === p.guess).length;
    expect(hit, `совпало ${hit} из ${pairs.length}`).toBeLessThanOrEqual(Math.floor(pairs.length / 3));
  });
});

describe('ответ клиенту (`/api/war`)', () => {
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

  const pull = async (id: number, now: number): Promise<string> => {
    const headers = { 'x-telegram-init-data': signInit(id, Math.floor(now / 1000) - 60) };
    const res = await ROUTES['/api/war'](new Request('https://x/api/war', { method: 'GET', headers }), { stores: home.stores, now, ip: null });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect((JSON.parse(text) as WarResponse).wars.length, 'точка внутри области: война в ответе есть').toBeGreaterThan(0);
    return text;
  };

  /** Сиды, которые клиенту знать до решения нельзя: ключи дел и сиды будущих боёв. */
  const hidden = (w: WarRow): string[] => [
    ...['siege', 'fall', 'spy'].map((t) => sealed(w.id, t)),
    ...Array.from({ length: 12 }, (_, n) => sealed(w.id, `battle#${n}`)),
    ...Array.from({ length: 12 }, (_, n) => String(battleSeed(w.id, n))).filter((_, n) => n >= w.battles.length),
  ];

  it('ни секрета, ни ключей дел, ни сидов будущих боёв; сид — только у решённого боя, номер лагеря — открытый', async () => {
    const v = secret();
    const s = setup(T0);
    expect(applyOrder(s.file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 60, archer: 30 }) }, T0, s.ctx)).toBeNull();
    const w = s.file.wars[0];
    advance(s.file, w.arriveAt + 1, s.sheets);
    advance(s.file, phaseAt(siegeSince(w.camp as SiegeWindow), 2) + 1, s.sheets);
    expect(rowsOf(w.camp as SiegeWindow).length, 'точка внутри области: фазы брошены').toBeGreaterThan(0);
    await home.stores(STORES.world, 'strong').setJSON(WARS_KEY, s.file);
    const now = phaseAt(siegeSince(w.camp as SiegeWindow), 2) + 2;
    for (const id of [2001, 2002]) {
      const text = await pull(id, now);
      expect(text, 'секрета в ответе нет').not.toContain(v);
      for (const h of hidden(w)) expect(text, `в ответе нет ${h}`).not.toContain(h);
      const seeds: string[] = [];
      const walk = (x: unknown, path: string): void => {
        if (!x || typeof x !== 'object') return;
        for (const [k, y] of Object.entries(x)) {
          if (k === 'seed') seeds.push(path);
          walk(y, `${path}.${k}`);
        }
      };
      const body = JSON.parse(text) as WarResponse;
      walk(body, '');
      expect(seeds.filter((p) => !/^\.wars\.\d+\.battles\.\d+\.input$/.test(p)), 'сид — только у решённого боя').toEqual([]);
      expect(body.wars[0].camp?.campId, 'номер лагеря — открытый номер войны').toBe(w.id);
    }
  });
});

describe('сиды живой войны — одной дверью (по исходникам `war.ts`)', () => {
  const src = readFileSync(join(__dirname, 'war.ts'), 'utf8');
  it('бой, падение, кость фазы и дело лазутчика — через `sealed`; голого номера в сиде нет', () => {
    expect(src).not.toMatch(/warSeed\(w\.id/);
    expect(src).toMatch(/fallSeed\(warSeed\(sealed\(w\.id, 'fall'\)/);
    expect(src).not.toMatch(/rollPhase\(camp\b/);
    expect(src).toMatch(/rollPhase\(sealedCamp,/);
    expect(src).not.toMatch(/rollSeed\(camp\)/);
    expect(src).toMatch(/rivalRolls\(sealed\(x\.id, 'spy'\)\)/);
  });
});
