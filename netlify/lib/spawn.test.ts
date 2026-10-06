/**
 * Тест с игроками: места на Сицилии (docs/test_world.md). Место выдаёт сервер, одно место — одному игроку, даже если
 * двое вошли разом; мест нет — тот же регион по обычным правилам; без настройки — обычное расселение.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { STORES, type Stores } from './kv.js';
import { ROUTES } from './routes/index.js';
import { emptyRoster, placeNew, readRoster, upsert } from './roster.js';
import { spawnMode } from './http.js';
import type { CastleClaim, RosterFile, RosterResponse } from './contract.js';
import { SETTLE_GAP } from '../../src/world/data/tuning.js';
import { fitToSettle, placeCastle, settleRandom } from '../../src/world/settle.js';
import { SICILY, inSicilyTheatre, sicilySlot } from '../../src/world/spawn.js';
import { theatreAt } from '../../src/world/theatre/theatre.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';

const NOW = 1_800_000_000_000;
const SEC = 1000;

const claim = (name: string): CastleClaim => ({ name, city: '', power: 100, pop: 30 });

/** Реестр из `n` игроков, вошедших по одному, в режиме острова. */
function seated(n: number, from = 0): RosterFile {
  let file = emptyRoster();
  for (let i = 0; i < n; i++) file = upsert(file, `tg-${500 + from + i}`, claim(`Вождь ${i}`), NOW, 'sicily');
  return file;
}

const cells = (file: RosterFile): string[] => Object.values(file.rows).map((r) => `${r.x}|${r.y}`);

describe('места острова: выдача', () => {
  it('двенадцать вошедших — двенадцать разных мест острова, по порядку списка', () => {
    const file = seated(12);
    const got = Object.keys(file.rows)
      .sort()
      .map((k) => file.rows[k]);
    expect(got.map((r) => sicilySlot(r))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(new Set(cells(file)).size).toBe(12);
  });

  it('стоящий замок не переезжает: повторная запись того же игрока места не меняет и чужого не берёт', () => {
    let file = seated(3);
    const before = { ...file.rows['tg-501'] };
    file = upsert(file, 'tg-501', claim('Вождь 1, новое имя'), NOW + 60_000, 'sicily');
    expect({ x: file.rows['tg-501'].x, y: file.rows['tg-501'].y }).toEqual({ x: before.x, y: before.y });
    // Четвёртый получает четвёртое место, а не освободившееся «второе».
    file = upsert(file, 'tg-900', claim('Новичок'), NOW, 'sicily');
    expect(sicilySlot(file.rows['tg-900'])).toBe(4);
  });

  it('место освободилось (строку забыли) — его получает следующий новичок', () => {
    const file = seated(5);
    const rows = { ...file.rows };
    delete rows['tg-502'];
    const next = upsert({ ...file, rows }, 'tg-901', claim('Новичок'), NOW, 'sicily');
    expect(sicilySlot(next.rows['tg-901'])).toBe(3);
  });

  it('мест нет — свободная клетка в регионе острова по обычным правилам расселения', () => {
    let file = seated(12);
    for (let i = 0; i < 4; i++) {
      const key = `tg-${700 + i}`;
      file = upsert(file, key, claim(`Сверх ${i}`), NOW, 'sicily');
      const at = file.rows[key];
      expect([key, sicilySlot(at)]).toEqual([key, 0]);
      // Тот же регион, что у острова: на острове воюют только внутри региона (`theatre.inHomeTheatre`).
      expect([key, theatreAt(at.x, at.y)?.id]).toEqual([key, 'italy']);
      expect([key, inSicilyTheatre(at), fitToSettle(at)]).toEqual([key, true, true]);
      // Обычные правила: не ближе обычной границы ни к одному из стоящих.
      for (const [other, row] of Object.entries(file.rows)) {
        if (other === key) continue;
        expect([key, other, Math.hypot(row.x - at.x, row.y - at.y) >= SETTLE_GAP]).toEqual([key, other, true]);
      }
    }
  });

  it('без режима — прежнее правило, бросок в бросок', () => {
    const file = seated(3);
    const spots = Object.values(file.rows).map((r) => ({ x: r.x, y: r.y }));
    expect(placeNew(file, 'tg-77', null)).toEqual(placeCastle(settleRandom('tg-77'), spots));
    let plain = emptyRoster();
    plain = upsert(plain, 'tg-1', claim('Первый'), NOW);
    expect(sicilySlot(plain.rows['tg-1'])).toBe(0);
  });

  it('настройка сервера: TRIBE_SPAWN=sicily — остров, иначе — обычное расселение', () => {
    expect(spawnMode({ TRIBE_SPAWN: 'sicily' })).toBe('sicily');
    expect(spawnMode({})).toBeNull();
    expect(spawnMode({ TRIBE_SPAWN: 'off' })).toBeNull();
  });
});

describe('места острова: двое разом не займут одно место (обработчик реестра на SQLite)', () => {
  let home: Home;
  const saved = process.env.TRIBE_SPAWN;
  beforeAll(() => {
    process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
    process.env.TRIBE_SPAWN = 'sicily';
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.TRIBE_SPAWN;
    else process.env.TRIBE_SPAWN = saved;
  });
  afterEach(async () => {
    await home?.close();
  });

  const enter = (stores: Stores, user: number, at = NOW) =>
    ROUTES['/api/castles'](
      new Request('http://tribe.test/api/castles', {
        method: 'PUT',
        headers: { 'x-telegram-init-data': signInit(user, Math.floor(at / SEC) - 60) },
        body: JSON.stringify(claim(`Вождь ${user}`)),
      }),
      { stores, now: at, ip: null },
    );

  const roster = async (stores: Stores): Promise<RosterFile> => {
    const found = await stores(STORES.world, 'strong').getWithMetadata('roster');
    return readRoster(found ? JSON.parse(String(found.data)) : null);
  };

  it('второй вклинился между чтением и записью первого — у них разные места', async () => {
    home = sqliteHome();
    // Подмена двери: перед первой записью обработчика первого игрока целиком проходит вход второго. Первый прочитал
    // реестр пустым и выбрал место 1 — его условная запись обязана проиграть, а повтор — увидеть место занятым.
    let fired = false;
    const racing: Stores = (name, c) => {
      const kv = home.stores(name, c);
      return {
        ...kv,
        setJSON: async (key, value, opts) => {
          if (!fired && name === STORES.world && key === 'roster') {
            fired = true;
            const res = await enter(home.stores, 4002);
            expect(res.status).toBe(200);
          }
          return kv.setJSON(key, value, opts);
        },
      };
    };
    const res = await enter(racing, 4001);
    expect(fired).toBe(true);
    expect(res.status).toBe(200);
    const first = ((await res.json()) as RosterResponse).mine;
    const file = await roster(home.stores);
    const second = file.rows['tg-4002'];
    expect(first).not.toBeNull();
    expect(sicilySlot(second)).toBe(1);
    expect(sicilySlot(first as { x: number; y: number })).toBe(2);
    expect(new Set(cells(file)).size).toBe(2);
  });

  it('двенадцать вошли одновременно — двенадцать разных мест острова', async () => {
    home = sqliteHome();
    const users = Array.from({ length: 12 }, (_, i) => 4100 + i);
    // Все разом; кто проиграл все попытки записи (429), входит снова — так делает игра.
    let left = users;
    for (let round = 0; round < 20 && left.length > 0; round++) {
      const answers = await Promise.all(left.map(async (u) => [u, (await enter(home.stores, u, NOW + round * 20 * SEC)).status] as const));
      left = answers.filter(([, status]) => status !== 200).map(([u]) => u);
    }
    expect(left).toEqual([]);
    const file = await roster(home.stores);
    expect(Object.keys(file.rows).length).toBe(12);
    expect(new Set(cells(file)).size).toBe(12);
    expect(Object.values(file.rows).every((r) => sicilySlot(r) > 0)).toBe(true);
    expect(new Set(Object.values(file.rows).map((r) => sicilySlot(r)))).toEqual(new Set(SICILY.map((_, i) => i + 1)));
  });
});
