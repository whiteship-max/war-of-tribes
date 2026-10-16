import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORES } from './kv.js';
import { ROUTES } from './routes/index.js';
import { botWith } from './routes/bot.js';
import { emptyRoster, upsert, ROSTER_KEY, castleIdOf } from './roster.js';
import { WARS_KEY, emptyWars, pruneWars, warTally, WAR_KEEP_MS, type WarFile, type WarRow } from './war.js';
import { FROZEN_KEY } from './admin.js';
import { RATING_WEIGHTS, ratingPoints, type RatingResponse, type WatchCard, type WarBattle } from './contract.js';
import { rank } from './rating.js';
import { seedTown } from './town.js';
import { seedBook } from './book.js';
import type { Telegram } from './telegram.js';
import { powerOfCounts } from '../../src/profile/power.js';
import { SICILY } from '../../src/world/spawn.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';

/**
 * Рейтинг (docs/rating.md). Тесты там, где можно подделать очки, сломать сервер или открыть рассылку чужому: мощь —
 * из описи формулой игры, а не цифрой клиента; победы и взятые города — только из записи войн; замороженного в
 * рейтинге нет; ключей игроков в ответе нет; `/final` рассылает только админ и только со словом «ДА».
 */
const NOW = 1_800_000_000_000;
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

const watch = (over: Partial<WatchCard> = {}): WatchCard => ({
  build: 'v1',
  city: '',
  clock: NOW,
  time: 1000,
  level: 1,
  buildings: { town_hall: 2, houses: 3 },
  pop: 40,
  stock: {},
  prod: {},
  cap: 1000,
  troops: { spearman: 10 },
  queued: 0,
  away: 0,
  caravans: 0,
  wounded: 0,
  train: 6,
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

/** Книги, подтверждающие опись целиком, — как у честного игрока после записи партии (`watch.booked`). */
const booksOf = (card: WatchCard) => ({
  town: { ...seedTown(NOW), levels: { ...seedTown(NOW).levels, ...card.buildings }, pop: card.pop },
  book: { ...seedBook(NOW), bodies: card.troops },
});

/** Игроки в реестре, у каждого опись наблюдения; книги — подтверждают опись, если не названы свои (`books`). */
async function world(players: { id: number; city: string; card?: WatchCard; books?: object }[], wars: WarFile = emptyWars()): Promise<void> {
  let roster = emptyRoster();
  for (const p of players) roster = upsert(roster, `tg-${p.id}`, { name: `Вождь ${p.id}`, city: p.city, power: 1, pop: 1 }, NOW);
  await home.stores(STORES.world).setJSON(ROSTER_KEY, roster);
  await home.stores(STORES.world).setJSON(WARS_KEY, wars);
  for (const p of players) {
    if (!p.card) continue;
    const books = p.books ?? booksOf(p.card);
    await home.stores(STORES.watch).setJSON(`tg-${p.id}`, { v: 1, first: NOW, last: NOW, name: `Вождь ${p.id}`, power: 1e9, card: { ...p.card, city: p.city }, cardAt: NOW, ...books });
  }
}

async function ask(id: number | null, method = 'GET'): Promise<{ status: number; body: RatingResponse & { error?: string } }> {
  const req = new Request('https://x/api/rating', {
    method,
    headers: id === null ? {} : { 'x-telegram-init-data': signInit(id, Math.floor(NOW / 1000) - 60) },
  });
  const res = await ROUTES['/api/rating'](req, { stores: home.stores, now: NOW, ip: null });
  return { status: res.status, body: (await res.json()) as RatingResponse & { error?: string } };
}

const battle = (id: string, by: 'atk' | 'def', won: boolean): WarBattle => ({
  id,
  at: NOW,
  site: by === 'atk' ? 'wall' : 'sortie',
  by,
  input: { seed: 1, attacker: { kinds: {} }, defender: { kinds: {} } },
  won,
  atkTroops: {},
  atkLost: {},
  homeTroops: {},
  homeLost: {},
});

const warRow = (id: string, atk: string, def: string, battles: WarBattle[], taken: boolean, endAt = NOW): WarRow =>
  ({
    id,
    atk,
    def,
    atkCastle: castleIdOf(atk),
    defCastle: castleIdOf(def),
    atkCity: '',
    defCity: '',
    from: { x: 0, y: 0 },
    to: { x: 1, y: 1 },
    mode: 'storm',
    fate: 'plunder',
    sentAt: NOW - 1000,
    arriveAt: NOW - 500,
    phase: 'done',
    army: { troops: {}, resolve: 0, pips: {} },
    battles,
    ...(taken ? { fall: { at: NOW, fate: 'plunder', by: 'storm', taken: {}, led: 0, lost: {}, bondedLost: 0, popLost: 0, fallen: [], burned: false, hidden: 0, routed: {} } } : {}),
    end: taken ? 'taken' : 'beaten',
    endAt,
  }) as WarRow;

describe('очки считает сервер', () => {
  it('мощь — из описи формулой игры; цифра мощи клиента в рейтинг не идёт', async () => {
    const card = watch();
    await world([{ id: 11, city: 'Алькамо', card }]);
    const { status, body } = await ask(11);
    expect(status).toBe(200);
    const want = powerOfCounts(card.buildings, card.troops);
    expect(want).toBeGreaterThan(0);
    // В записи наблюдения лежит «мощь» 1e9 — её прислал клиент описью партии. Рейтинг её не читает.
    expect(body.rows[0].power).toBe(want);
    expect(body.rows[0].points).toBe(ratingPoints(want, 0, 0));
  });

  it('опись, приписавшая себе уровни, войско и жителей сверх книг сервера, места не получает (docs/security.md)', async () => {
    const forged = watch({ buildings: { town_hall: 20, houses: 20 }, troops: { spearman: 100_000 }, pop: 90_000 });
    const honest = watch();
    // Подделка: книги — посёлок новой партии, войска сервер не видел. Честный: книги подтверждают опись.
    await world([
      { id: 31, city: 'Энна', card: forged, books: { town: seedTown(NOW), book: seedBook(NOW) } },
      { id: 32, city: 'Ното', card: honest },
    ]);
    const { body } = await ask(31);
    const mine = body.rows.find((r) => r.mine)!;
    // Подтверждено — первый уровень тех же построек и ни одного бойца.
    expect(mine.power).toBe(powerOfCounts({ town_hall: 1, houses: 1 }, {}));
    expect(mine.pop).toBe(seedTown(NOW).pop);
    expect(body.rows.map((r) => r.city)).toEqual(['Ното', 'Энна']);
  });

  it('мощь описи та же, что у игры: формула одна (`power`)', async () => {
    const { createInitialState } = await import('../../src/game/state.js');
    const { power } = await import('../../src/profile/power.js');
    const s = createInitialState();
    s.army.spearman = 7;
    s.buildings[0].level = 3;
    const levels = Object.fromEntries(s.buildings.map((b) => [b.type, b.level]));
    expect(powerOfCounts(levels, s.army as Record<string, number>)).toBe(power(s));
  });

  it('запрос не несёт очков: только GET, другое — 405 и ничего не тронуто', async () => {
    await world([{ id: 12, city: 'Ното', card: watch() }]);
    const { status } = await ask(12, 'POST');
    expect(status).toBe(405);
  });

  it('без подписи — 401', async () => {
    await world([{ id: 13, city: 'Ното', card: watch() }]);
    expect((await ask(null)).status).toBe(401);
  });

  it('победы и взятые города — по записи войн; веса — из договора', async () => {
    const a = 'tg-21';
    const b = 'tg-22';
    const wars: WarFile = {
      ...emptyWars(),
      wars: [
        // Штурм удался и город взят: победа и город — нападающему.
        warRow('w1', a, b, [battle('w1.1', 'atk', true)], true),
        // Штурм отбит, потом вылазка города удалась: обе победы — городу.
        warRow('w2', a, b, [battle('w2.1', 'atk', false), battle('w2.2', 'def', true)], false),
      ],
    };
    expect(warTally(wars)).toEqual({ [a]: { won: 1, taken: 1 }, [b]: { won: 2, taken: 0 } });
    await world([{ id: 21, city: 'Агридженто', card: watch({ troops: {} }) }, { id: 22, city: 'Рагуза', card: watch({ troops: {} }) }], wars);
    const { body } = await ask(21);
    const mine = body.rows.find((r) => r.mine)!;
    expect([mine.won, mine.taken]).toEqual([1, 1]);
    const p = powerOfCounts(watch().buildings, {});
    expect(mine.points).toBe(Math.round(p * RATING_WEIGHTS.power + RATING_WEIGHTS.win + RATING_WEIGHTS.taken));
    expect(body.rows.map((r) => r.city)).toEqual(['Агридженто', 'Рагуза']);
  });

  it('убранная из записи война не теряется: её итоги переходят в итоги эпохи', () => {
    const file: WarFile = { ...emptyWars(), wars: [warRow('old', 'tg-1', 'tg-2', [battle('old.1', 'atk', true)], true, NOW)] };
    const before = warTally(file);
    pruneWars(file, NOW + WAR_KEEP_MS + 1);
    expect(file.wars).toHaveLength(0);
    expect(warTally(file)).toEqual(before);
  });
});

describe('кто в рейтинге и что уходит наружу', () => {
  it('замороженного нет; ключей игроков в ответе нет; своя строка отмечена', async () => {
    await world([
      { id: 31, city: 'Сиракузы', card: watch() },
      { id: 32, city: 'Катания', card: watch({ troops: { spearman: 500 } }) },
    ]);
    await home.stores(STORES.admin).setJSON(FROZEN_KEY, { v: 1, keys: { 'tg-32': { at: NOW, by: ADMIN, why: '' } } });
    const { body } = await ask(31);
    expect(body.rows.map((r) => r.city)).toEqual(['Сиракузы']);
    expect(body.rows[0].mine).toBe(true);
    expect(body.rows[0].id).toBe(castleIdOf('tg-31'));
    expect(JSON.stringify(body)).not.toMatch(/tg-\d/);
  });

  it('равные очки делят место', () => {
    const row = (id: string, points: number) => ({ key: id, id, x: 0, y: 0, city: id, name: '', points, power: points, pop: 0, won: 0, taken: 0 });
    expect(rank([row('a', 5), row('b', 9), row('c', 5), row('d', 1)]).map((r) => `${r.id}${r.place}`)).toEqual(['b1', 'a2', 'c2', 'd4']);
  });
});

// ------------------------------------------------ бот: /final и /start ---

function fakeTg() {
  const greeted: { chat: number; text: string }[] = [];
  const said: { chat: number; text: string }[] = [];
  const tg: Telegram = {
    send: async () => 'ok',
    answer: async () => 'ok',
    button: async () => 'ok',
    file: async () => 'ok',
    async say(chat, text) {
      said.push({ chat, text });
      return 'ok';
    },
    async greet(chat, text) {
      greeted.push({ chat, text });
      return 'ok';
    },
    checkout: async () => 'ok',
  };
  return { tg, greeted, said };
}

async function message(t: ReturnType<typeof fakeTg>, from: number, text: string): Promise<void> {
  const req = new Request('https://x/api/bot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': SECRET },
    body: JSON.stringify({ update_id: 1, message: { message_id: 9, from: { id: from }, chat: { id: from, type: 'private' }, text } }),
  });
  const res = await botWith(() => t.tg)(req, { stores: home.stores, now: NOW, ip: null });
  expect(res.status).toBe(200);
}

describe('/final — итоговый рейтинг в бот', () => {
  const players = [
    { id: 41, city: 'Марсала', card: watch({ troops: { spearman: 50 } }) },
    { id: 42, city: 'Трапани', card: watch() },
  ];

  it('чужому — тишина, рассылки нет', async () => {
    await world(players);
    const t = fakeTg();
    await message(t, 41, '/final ДА');
    expect(t.greeted).toEqual([]);
    expect(t.said).toEqual([]);
  });

  it('админу без «ДА» — только таблица ему; со «ДА» — каждому игроку его место', async () => {
    await world(players);
    const t = fakeTg();
    await message(t, ADMIN, '/final');
    expect(t.greeted).toEqual([]);
    expect(t.said.at(-1)?.text).toMatch(/1\. «Марсала»[\s\S]*2\. «Трапани»[\s\S]*\/final ДА/);
    await message(t, ADMIN, '/final ДА');
    expect(t.greeted.map((g) => g.chat).sort()).toEqual([41, 42]);
    expect(t.greeted.find((g) => g.chat === 42)?.text).toMatch(/Твоё место — 2 из 2\./);
    expect(t.said.at(-1)?.text).toMatch(/дошло 2 из 2/);
  });
});

describe('/start — приветствие', () => {
  it('любому: что за игра и кнопка; строка про Сицилию — только в режиме острова', async () => {
    await world([]);
    const t = fakeTg();
    await message(t, 777, '/start');
    expect(t.greeted).toHaveLength(1);
    expect(t.greeted[0].chat).toBe(777);
    expect(t.greeted[0].text).not.toMatch(/Сицили/);
    process.env.TRIBE_SPAWN = 'sicily';
    await message(t, 778, '/start');
    expect(t.greeted[1].text).toMatch(new RegExp(`острове до ${SICILY.length} городов`));
    // Админ-команды /start не открывает: чужому на другое — тишина.
    await message(t, 777, '/help');
    expect(t.said).toEqual([]);
  });
});
