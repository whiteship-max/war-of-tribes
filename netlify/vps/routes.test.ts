import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STORES, type Stores } from '../lib/kv.js';
import { ROUTES } from '../lib/routes/index.js';
import { placeCastle, settleRandom } from '../../src/world/settle.js';
import { TEST_TOKEN, blobsHome, signInit, sqliteHome, type Home } from './testkit.js';

/**
 * Договор клиента и сервера на двух домах хранилища — одним сценарием.
 *
 * Сценарий зовёт обработчики так же, как их зовут оба дома: функция Netlify и свой сервер передают
 * запрос в `ROUTES[путь]` вместе с хранилищем и минутой. Итог каждого шага — код и тело ответа, где
 * ETag'и заменены на `E1`, `E2`… по порядку появления: значения у домов разные (у Blobs свои, у
 * SQLite свои), а смысл обязан быть один. Два вывода сверяются целиком — расхождение в любом шаге
 * и есть то, что клиент заметил бы после переезда.
 *
 * Отдельно, в каждом доме, — утверждения о самом договоре: подпись, 409 вместо затёртой партии,
 * предел частоты записи, потолок тела, клетку выбирает сервер, метки уведомлений.
 */
const NOW = 1_800_000_000_000;
const SEC = 1000;
const MIN = 60 * SEC;
const A = 1001;
const B = 1002;

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
});

interface Call {
  method?: string;
  user?: number;
  at?: number;
  /** Подпись своей рукой: чужой токен, протухшая дата. */
  init?: string;
  body?: string;
  ip?: string;
}

interface Step {
  label: string;
  status: number;
  body: unknown;
}

/** ETag'и — в `E1`, `E2`… по порядку появления: значения у домов свои, смысл — общий. */
function normalizer(): (v: unknown) => unknown {
  const seen = new Map<string, string>();
  const walk = (v: unknown, key = ''): unknown => {
    if (key === 'etag' && typeof v === 'string') {
      if (!seen.has(v)) seen.set(v, `E${seen.size + 1}`);
      return seen.get(v);
    }
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return (v) => walk(v);
}

const record = (over: Record<string, unknown> = {}) => ({
  v: 1,
  rev: 0,
  updatedAt: 0,
  device: 'd-test',
  game: '{"pop":30}',
  world: '{"v":9}',
  card: { name: 'Вождь', day: 3, pop: 30, power: 120, army: 4 },
  ...over,
});

async function scenario(home: Home): Promise<{ steps: Step[]; dueMarks: string[] }> {
  const norm = normalizer();
  const steps: Step[] = [];
  const raw: Record<string, { status: number; body: Record<string, unknown> }> = {};
  const call = async (label: string, path: string, c: Call = {}): Promise<Record<string, unknown>> => {
    const at = c.at ?? NOW;
    const headers: Record<string, string> = {};
    if (c.init !== undefined) headers['x-telegram-init-data'] = c.init;
    else if (c.user !== undefined) headers['x-telegram-init-data'] = signInit(c.user, Math.floor(at / SEC) - 60);
    const req = new Request(`http://tribe.test${path}`, { method: c.method ?? 'GET', headers, body: c.body });
    const res = await ROUTES[path](req, { stores: home.stores, now: at, ip: c.ip ?? '10.0.0.1' });
    await home.settle();
    expect(res.headers.get('content-type'), label).toMatch(/^application\/json/);
    expect(res.headers.get('cache-control'), label).toBe('no-store');
    const body = (await res.json()) as Record<string, unknown>;
    raw[label] = { status: res.status, body };
    steps.push({ label, status: res.status, body: norm(body) });
    return body;
  };
  const put = (label: string, path: string, user: number, value: unknown, at = NOW) =>
    call(label, path, { method: 'PUT', user, at, body: JSON.stringify(value) });

  await call('часы', '/api/time');
  await call('часы: не тот метод', '/api/time', { method: 'POST', body: '{}' });

  await call('сохранение: без подписи', '/api/save');
  await call('сохранение: чужой токен', '/api/save', { init: signInit(A, NOW / SEC - 60, '654321:BB-another-bot') });
  await call('сохранение: протухшая подпись', '/api/save', { init: signInit(A, NOW / SEC - 25 * 3600) });
  await call('сохранение: пусто', '/api/save', { user: A });
  const first = await put('сохранение: первая запись', '/api/save', A, {
    baseEtag: null,
    record: record({ gems: 9999, admin: true, updatedAt: 9_999_999_999_999 }),
  });
  await call('сохранение: чтение', '/api/save', { user: A });
  await call('сохранение: чужая партия не видна', '/api/save', { user: B });
  await put('сохранение: «пусто», а запись есть', '/api/save', A, { baseEtag: null, record: record() }, NOW + 5 * SEC);
  await put('сохранение: чаще четырёх секунд', '/api/save', A, { baseEtag: first.etag, record: record() }, NOW + 1 * SEC);
  await put('сохранение: вторая запись', '/api/save', A, { baseEtag: first.etag, record: record({ game: '{"pop":31}' }) }, NOW + 5 * SEC);
  await put('сохранение: устаревший ETag', '/api/save', A, { baseEtag: first.etag, record: record() }, NOW + 10 * SEC);
  await call('сохранение: кривое тело', '/api/save', { method: 'PUT', user: A, at: NOW + 20 * SEC, body: 'не json' });
  await call('сохранение: тело больше потолка', '/api/save', {
    method: 'PUT',
    user: A,
    at: NOW + 20 * SEC,
    body: JSON.stringify({ baseEtag: null, record: record({ game: 'x'.repeat(600 * 1024) }) }),
  });
  await call('сохранение: не тот метод', '/api/save', { method: 'DELETE', user: A });

  await call('замки: до замка', '/api/castles', { user: A });
  await put('замки: первый замок', '/api/castles', A, { name: 'Вождь А', city: 'Град', power: 100, pop: 30, x: 1, y: 1 });
  await put('замки: второй игрок', '/api/castles', B, { name: 'Вождь Б', power: 50, pop: 20 });
  await call('замки: чтение', '/api/castles', { user: A });

  await call('уведомления: пусто', '/api/notify', { user: A });
  await put('уведомления: ушёл', '/api/notify', A, { present: false });
  const item = {
    key: 'raid:m4:1',
    kind: 'raid',
    fireAt: NOW + 10 * SEC + 3 * MIN,
    until: NOW + 20 * MIN,
    p: { from: 'Логово разбойников', fate: 'plunder', about: NOW + 20 * MIN },
  };
  await put('уведомления: список', '/api/notify', A, { computedAt: NOW + 10 * SEC, items: [item] }, NOW + 10 * SEC);
  await put('уведомления: список чаще пяти секунд', '/api/notify', A, { computedAt: NOW + 11 * SEC, items: [item] }, NOW + 11 * SEC);

  const due = await home.stores(STORES.due).list({});
  return { steps, dueMarks: due.blobs.map((b) => b.key).sort() };
}

const HOMES = [
  ['SQLite', sqliteHome],
  ['Netlify Blobs', blobsHome],
] as const;

const results = new Map<string, { steps: Step[]; dueMarks: string[] }>();
const homes: Home[] = [];

beforeAll(async () => {
  for (const [name, make] of HOMES) {
    const home = await make();
    homes.push(home);
    results.set(name, await scenario(home));
  }
});

afterAll(async () => {
  for (const home of homes) await home.close();
});

const step = (home: string, label: string): Step => {
  const s = results.get(home)!.steps.find((x) => x.label === label);
  if (!s) throw new Error(`нет шага «${label}»`);
  return s;
};

describe.each(HOMES.map(([name]) => [name]))('договор на доме %s', (home) => {
  const at = (label: string) => step(home, label);

  it('часы отдают серверное «сейчас» и не принимают записи', () => {
    expect(at('часы')).toEqual({ label: 'часы', status: 200, body: { now: NOW } });
    expect(at('часы: не тот метод').status).toBe(405);
  });

  it('личность только из подписи: без неё, с чужой и с протухшей — одно слово отказа', () => {
    for (const label of ['сохранение: без подписи', 'сохранение: чужой токен', 'сохранение: протухшая подпись']) {
      expect(at(label), label).toMatchObject({ status: 401, body: { error: 'unauthorized' } });
    }
  });

  it('сохранение: первая запись, чтение своего, чужое не видно', () => {
    expect(at('сохранение: пусто').body).toEqual({ now: NOW, etag: null, record: null });
    expect(at('сохранение: первая запись')).toMatchObject({ status: 200, body: { now: NOW, etag: 'E1', rev: 1 } });
    const read = at('сохранение: чтение').body as { etag: string; record: Record<string, unknown> };
    expect(read.etag).toBe('E1');
    // Время ставит сервер, лишнее не проезжает.
    expect(read.record).toEqual(record({ rev: 1, updatedAt: NOW }));
    expect(at('сохранение: чужая партия не видна').body).toMatchObject({ etag: null, record: null });
  });

  it('одновременная запись не теряется молча: 409 с чужой записью, а не поверх', () => {
    expect(at('сохранение: «пусто», а запись есть')).toMatchObject({
      status: 409,
      body: { error: 'conflict', etag: 'E1', record: { rev: 1 } },
    });
    expect(at('сохранение: вторая запись')).toMatchObject({ status: 200, body: { etag: 'E2', rev: 2 } });
    expect(at('сохранение: устаревший ETag')).toMatchObject({
      status: 409,
      body: { error: 'conflict', etag: 'E2', record: { rev: 2, game: '{"pop":31}' } },
    });
  });

  it('пределы: частота записи, кривое тело, потолок тела, метод', () => {
    expect(at('сохранение: чаще четырёх секунд')).toMatchObject({ status: 429, body: { error: 'slow-down' } });
    expect(at('сохранение: кривое тело')).toMatchObject({ status: 400, body: { error: 'bad-body' } });
    expect(at('сохранение: тело больше потолка')).toMatchObject({ status: 413, body: { error: 'too-big' } });
    expect(at('сохранение: не тот метод')).toMatchObject({ status: 405, body: { error: 'method' } });
  });

  it('реестр: клетку выбирает сервер, присланные координаты не значат ничего', () => {
    expect(at('замки: до замка').body).toMatchObject({ mine: null, castles: [] });
    const own = placeCastle(settleRandom(`tg-${A}`), []);
    expect(at('замки: первый замок').body).toMatchObject({ mine: own });
    const second = at('замки: второй игрок').body as { mine: { x: number; y: number } };
    expect(second.mine).toEqual(placeCastle(settleRandom(`tg-${B}`), [own]));
    const read = at('замки: чтение').body as { mine: unknown; castles: { name: string; city?: string }[] };
    expect(read.mine).toEqual(own);
    expect(read.castles.find((c) => c.name === 'Вождь А')).toMatchObject({ city: 'Град', power: 100, pop: 30 });
  });

  it('уведомления: присутствие, список и метка в индексе по минуте', () => {
    expect(at('уведомления: пусто').body).toMatchObject({ gen: 0, items: 0, away: null });
    expect(at('уведомления: ушёл').body).toMatchObject({ away: NOW });
    expect(at('уведомления: список')).toMatchObject({ status: 200, body: { gen: 1, items: 1 } });
    expect(at('уведомления: список чаще пяти секунд')).toMatchObject({ status: 429 });
    const minute = String(Math.floor((NOW + 10 * SEC + 3 * MIN) / MIN)).padStart(9, '0');
    expect(results.get(home)!.dueMarks).toEqual([`${minute}/tg-${A}`]);
  });
});

it('оба дома отвечают одно и то же — шаг в шаг', () => {
  const [sqlite, blobs] = HOMES.map(([name]) => results.get(name)!);
  expect(sqlite.steps.length).toBeGreaterThan(20);
  expect(blobs.steps).toEqual(sqlite.steps);
  expect(blobs.dueMarks).toEqual(sqlite.dueMarks);
});

describe('гонка: между чтением и записью успел третий', () => {
  /**
   * Обработчик сохранения читает запись, сверяет ETag и пишет условно. Сверка до записи ловит
   * устаревший ETag, но не того, кто записал **между** чтением и записью: его ловит только условная
   * запись дома. Здесь третий вклинивается ровно туда — подменой двери, которая перед первой
   * записью обработчика даёт записать чужому. Ответ обязан быть 409 с записью третьего, на обоих
   * домах.
   */
  const racing = (home: Home, intruder: () => Promise<unknown>): Stores => (name, c) => {
    const kv = home.stores(name, c);
    let fired = false;
    return {
      ...kv,
      setJSON: async (key, value, opts) => {
        if (!fired) {
          fired = true;
          await intruder();
          await home.settle();
        }
        return kv.setJSON(key, value, opts);
      },
    };
  };
  const rec = record();
  const save = (stores: Stores, user: number, baseEtag: string | null, at: number) =>
    ROUTES['/api/save'](
      new Request('http://tribe.test/api/save', {
        method: 'PUT',
        headers: { 'x-telegram-init-data': signInit(user, Math.floor(at / SEC) - 60) },
        body: JSON.stringify({ baseEtag, record: rec }),
      }),
      { stores, now: at, ip: null },
    );

  it.each(HOMES.map(([name], i) => [name, i]))('%s: поверх своей версии, а третий успел раньше — 409 с его записью', async (_name, i) => {
    const home = homes[Number(i)];
    const user = 3100 + Number(i);
    const first = (await (await save(home.stores, user, null, NOW)).json()) as { etag: string };
    await home.settle();
    const third = () => home.stores(STORES.saves).setJSON(`tg-${user}`, { ...rec, rev: 7 }, { onlyIfMatch: first.etag });
    const res = await save(racing(home, third), user, first.etag, NOW + 5 * SEC);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { record: { rev: number } }).record.rev).toBe(7);
  });

  it.each(HOMES.map(([name], i) => [name, i]))('%s: в пустое место, а третий успел раньше — 409 с его записью', async (_name, i) => {
    const home = homes[Number(i)];
    const user = 3200 + Number(i);
    const third = () => home.stores(STORES.saves).setJSON(`tg-${user}`, { ...rec, rev: 7 }, { onlyIfNew: true });
    const res = await save(racing(home, third), user, null, NOW);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { record: { rev: number } }).record.rev).toBe(7);
  });
});

describe('сито частоты: у адресов свои вёдра', () => {
  /**
   * На своём сервере экземпляр один, и вёдра всех адресов лежат в одной памяти. Ведро на игрока,
   * общее для адресов, резало бы сохранение запросами реестра — на Netlify этого не было, потому
   * что у каждой функции своя память.
   */
  it.each(HOMES.map(([name], i) => [name, i]))('%s: реестр упёрся в свой потолок, сохранение — нет', async (_name, i) => {
    const user = 2000 + Number(i);
    const home = homes[Number(i)];
    const ask = (path: string) =>
      ROUTES[path](
        new Request(`http://tribe.test${path}`, { headers: { 'x-telegram-init-data': signInit(user, NOW / SEC - 60) } }),
        { stores: home.stores, now: NOW, ip: null },
      );
    const statuses: number[] = [];
    for (let n = 0; n < 41; n++) statuses.push((await ask('/api/castles')).status);
    expect(statuses.slice(0, 40).every((s) => s === 200)).toBe(true);
    expect(statuses[40]).toBe(429);
    expect((await ask('/api/save')).status).toBe(200);
  });
});
