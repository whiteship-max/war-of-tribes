import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROUTES } from './routes/index.js';
import { STORES } from './kv.js';
import { PERF_LIMITS, PERF_PLACES, readPerf, type PerfDevice, type PerfPut } from './contract.js';
import { castleIdOf } from './roster.js';
import { PLACE_WORD, classOf, dayOf, devId, fpsPair, gapAt, mergePerf, perfDays, perfSummary, sweepPerf, type PerfDay } from './perf.js';
import { adminCommand } from './commands.js';
import type { Telegram } from './telegram.js';
import { TEST_TOKEN, signInit, sqliteHome, type Home } from '../vps/testkit.js';

/**
 * Г-1 (docs/telemetry.md): замеры плавности с телефонов. Сервер берёт только известные поля и разумные числа (правило
 * ЗЩ-1): подделка — отказ всей пачке и ни одной записи; честная пачка ложится сутками устройства под номером замка, без
 * ключа игрока; сроку — тридцать суток; сводка `/perf` считает медиану и худшие 5 % по корзинам кадров.
 */
const NOW = 1_900_000_000_000;
const DAY = 86_400_000;
const ADMIN = 4242;
const SECRET = 'test-secret_0123';

let home: Home;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  home = sqliteHome();
  for (const k of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'ADMIN_IDS']) saved[k] = process.env[k];
  process.env.TELEGRAM_BOT_TOKEN = TEST_TOKEN;
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  process.env.ADMIN_IDS = String(ADMIN);
});
afterEach(async () => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  await home.close();
});

const ANDROID: PerfDevice = {
  kind: 'phone',
  os: 'android',
  osv: '12',
  app: 'tg',
  tgp: 'android',
  tgv: '8.0',
  br: 'chrome',
  gpu: 'Mali-G52',
  w: 360,
  h: 800,
  dpr: 2,
  mem: 2,
  cores: 8,
  tgc: 'LOW',
};
const IPHONE: PerfDevice = { ...ANDROID, os: 'ios', osv: '17.4', tgp: 'ios', br: 'safari', gpu: 'Apple GPU', w: 390, h: 844, dpr: 3, mem: null, cores: null, tgc: null };

/** Пачка, какую шлёт игра (`perf/telemetry.take`): пять минут города ровными шестьюдесятью. */
const batch = (over: Partial<PerfPut> = {}): PerfPut => ({
  v: 1,
  build: 'сохр. 23 · index-abc.js',
  span: 300_000,
  dev: ANDROID,
  q: 'medium',
  set: 'auto',
  fps: { city: { 16: 17_000, 17: 900, 33: 40 } },
  drops: [{ p: 'city', f: 'high', t: 'medium' }],
  freeze: [{ k: 'restore', ms: 640 }],
  first: 3400,
  ready: 8100,
  long: { n: 3, ms: 900, max: 640 },
  err: 0,
  ...over,
});

/** Отказ читателя договора — словами; честная пачка — объект. */
const why = (v: unknown): string | null => {
  const r = readPerf(v);
  return typeof r === 'string' ? r : null;
};

const io = (now: number) => ({ stores: home.stores, now, ip: null });
async function send(id: number, body: unknown, now = NOW, method = 'PUT', sign = true): Promise<number> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sign) headers['x-telegram-init-data'] = signInit(id, Math.floor(now / 1000) - 60);
  const res = await ROUTES['/api/perf'](new Request('https://x/api/perf', { method, headers, body: JSON.stringify(body) }), io(now));
  return res.status;
}
const stored = async (): Promise<string[]> => (await home.stores(STORES.perf).list({})).blobs.map((b) => b.key);

describe('договор: только известные поля и разумные числа', () => {
  it('честная пачка проходит целиком', () => {
    const r = readPerf(batch());
    expect(typeof r).toBe('object');
    expect(r).toEqual(batch());
  });

  it('незнакомое поле на любом уровне — отказ', () => {
    expect(why({ ...batch(), name: 'Иван' })).toBe('поля');
    expect(why({ ...batch(), dev: { ...ANDROID, ua: 'Mozilla/5.0' } })).toBe('устройство: поля');
    expect(why({ ...batch(), dev: { ...ANDROID, lat: 55.7 } })).toBe('устройство: поля');
    expect(why({ ...batch(), fps: { city: { 16: 10 }, lobby: { 16: 10 } } })).toBe('кадры: места');
    expect(why({ ...batch(), drops: [{ p: 'city', f: 'high', t: 'medium', who: 'x' }] })).toBe('понижения: шаг');
    expect(why({ ...batch(), long: { n: 1, ms: 60, max: 60, sum: 1 } })).toBe('длинные задачи');
    // Обязательное поле пропало — тоже форма не та.
    const { err: _err, ...noErr } = batch();
    expect(why(noErr)).toBe('поля');
  });

  it('кадров не больше, чем успевает дверь кадра: граница — `fps` в секунду охвата', () => {
    const span = 300_000;
    const cap = Math.ceil((span / 1000) * PERF_LIMITS.fps);
    // Точка внутри правила: ровно на потолке проходит, и сумма промежутков (16 мс) короче охвата.
    expect(cap * 16).toBeLessThanOrEqual(span + 1000);
    expect(why(batch({ span, fps: { city: { 16: cap } } }))).toBeNull();
    expect(why(batch({ span, fps: { city: { 16: cap - 1, 15: 2 } } }))).toBe('кадры: city: больше, чем успевает дверь кадра');
    // Каждое место по отдельности в потолке, а вместе — больше двух цепочек разом.
    expect(why(batch({ span, fps: { city: { 0: cap }, map: { 0: cap }, battle: { 0: 1 } } }))).toBe('кадры: всего');
  });

  it('промежутки кадров не длиннее охвата пачки', () => {
    // 3 000 кадров по 100 мс и дольше — пять минут ровно; на секунду больше запаса — отказ.
    expect(why(batch({ span: 300_000, fps: { city: { 100: 3000, 16: 62 } } }))).toBeNull();
    expect(why(batch({ span: 300_000, fps: { city: { 100: 3011 } } }))).toBe('кадры: city: дольше охвата');
  });

  it('числа вне разумного — отказ, а не обрезка', () => {
    expect(why(batch({ span: 999 }))).toBe('охват');
    expect(why(batch({ span: PERF_LIMITS.spanMax + 1 }))).toBe('охват');
    expect(why(batch({ fps: { city: { 101: 5 } } }))).toBe('кадры: city: корзина');
    expect(why(batch({ fps: { city: { '016': 5 } } }))).toBe('кадры: city: корзина');
    expect(why(batch({ fps: { city: { 16: 0 } } }))).toBe('кадры: city: счёт');
    expect(why(batch({ fps: { city: { 16: 2.5 } } }))).toBe('кадры: city: счёт');
    expect(why(batch({ dev: { ...ANDROID, dpr: 40 } }))).toBe('устройство: плотность');
    expect(why(batch({ dev: { ...ANDROID, w: 900, h: 400 } }))).toBe('устройство: экран');
    expect(why(batch({ dev: { ...ANDROID, mem: 512 } }))).toBe('устройство: память');
    expect(why(batch({ dev: { ...ANDROID, gpu: 'Мали' } }))).toBe('устройство: видеокарта');
    expect(why(batch({ dev: { ...ANDROID, osv: 'Android 12' } }))).toBe('устройство: версия ОС');
    expect(why(batch({ dev: { ...IPHONE, tgc: 'HIGH' } }))).toBe('устройство: класс Telegram не на Android');
    expect(why(batch({ freeze: [{ k: 'restore', ms: PERF_LIMITS.freezeMs + 1 }] }))).toBe('замирания: число');
    expect(why(batch({ first: 0 }))).toBe('первый кадр');
    expect(why(batch({ first: 9000, ready: 8000 }))).toBe('город встал раньше первого кадра');
    expect(why(batch({ err: PERF_LIMITS.errors + 1 }))).toBe('ошибки');
    expect(why(batch({ q: 'ultra' as never }))).toBe('уровень');
  });

  it('понижение — только шаг вниз по одной лестнице сторожа', () => {
    expect(why(batch({ drops: [{ p: 'hunt', f: 'full', t: 'base' }] }))).toBeNull();
    expect(why(batch({ drops: [{ p: 'city', f: 'medium', t: 'high' }] }))).toBe('понижения: шаг');
    expect(why(batch({ drops: [{ p: 'city', f: 'high', t: 'lite' }] }))).toBe('понижения: шаг');
    expect(why(batch({ drops: [{ p: 'city', f: 'low', t: 'low' }] }))).toBe('понижения: шаг');
    expect(why(batch({ drops: Array.from({ length: PERF_LIMITS.drops + 1 }, () => ({ p: 'city' as const, f: 'high', t: 'low' })) }))).toBe('понижения');
  });

  it('длинные задачи: каждая не короче 50 мс, самая долгая — не больше суммы', () => {
    expect(why(batch({ long: { n: 4, ms: 150, max: 60 } }))).toBe('длинные задачи: сумма');
    expect(why(batch({ long: { n: 1, ms: 60, max: 70 } }))).toBe('длинные задачи: сумма');
    expect(why(batch({ long: { n: 0, ms: 60, max: 60 } }))).toBe('длинные задачи: сумма');
    expect(why(batch({ long: null }))).toBeNull();
  });
});

describe('/api/perf: подпись, отказ подделке, номер замка вместо игрока', () => {
  it('честная пачка ложится сутками устройства под номером замка; ключа игрока в записи нет', async () => {
    expect(await send(7001, batch())).toBe(200);
    const keys = await stored();
    const castle = castleIdOf('tg-7001', TEST_TOKEN);
    expect(keys).toHaveLength(1);
    expect(keys[0].startsWith(`${dayOf(NOW)}/${castle}.`)).toBe(true);
    const raw = String((await home.stores(STORES.perf).getWithMetadata(keys[0]))?.data);
    expect(raw).not.toContain('7001');
    expect(raw).not.toContain('tg-');
    // Вторая пачка того же устройства вливается в те же сутки: корзины сложены.
    expect(await send(7001, batch(), NOW + 300_000)).toBe(200);
    const [day] = await perfDays(home.stores(STORES.perf), NOW + 300_000, 1);
    expect(day.n).toBe(2);
    expect(day.fps.city?.['16']).toBe(34_000);
    expect(day.first).toEqual([3400, 3400]);
  });

  it('подделка — 400 и ни одной записи', async () => {
    const bad = [{ ...batch(), user: 'Иван' }, batch({ span: 5 }), batch({ fps: { city: { 16: 1e7 } } }), batch({ dev: { ...ANDROID, gpu: 'x'.repeat(200) } }), 'не json', null];
    // По минуте на пачку: сито частоты (`perMinute`) не должно ответить за читателя договора.
    for (let i = 0; i < bad.length; i++) expect(await send(7002, bad[i], NOW + i * 60_000)).toBe(400);
    expect(await stored()).toEqual([]);
  });

  it('без подписи — 401; не PUT — 405; слишком часто — 429', async () => {
    expect(await send(7003, batch(), NOW, 'PUT', false)).toBe(401);
    expect(await send(7003, batch(), NOW, 'POST')).toBe(405);
    const at = NOW + 10 * DAY;
    const codes: number[] = [];
    for (let i = 0; i < PERF_LIMITS.perMinute + 2; i++) codes.push(await send(7004, batch(), at));
    expect(codes.slice(0, PERF_LIMITS.perMinute).every((c) => c === 200)).toBe(true);
    expect(codes.slice(PERF_LIMITS.perMinute)).toEqual([429, 429]);
  });

  it('сутки устройства полны — 429, запись не растёт', async () => {
    const kv = home.stores(STORES.perf);
    const castle = castleIdOf('tg-7005', TEST_TOKEN);
    let day: PerfDay | null = null;
    for (let i = 0; i < PERF_LIMITS.perDay; i++) day = mergePerf(day, castle, batch(), NOW);
    await kv.setJSON(`${dayOf(NOW)}/${castle}.${devId(ANDROID)}`, day);
    expect(await send(7005, batch(), NOW + 1)).toBe(429);
    const [got] = await perfDays(kv, NOW + 1, 1, castle);
    expect(got.n).toBe(PERF_LIMITS.perDay);
  });

  it('срок — тридцать суток: старше уносит уборка', async () => {
    const kv = home.stores(STORES.perf);
    const old = NOW - (PERF_LIMITS.keepDays + 1) * DAY;
    const edge = NOW - PERF_LIMITS.keepDays * DAY;
    await kv.setJSON(`${dayOf(old)}/c1.a`, mergePerf(null, 'c1', batch(), old));
    await kv.setJSON(`${dayOf(edge)}/c1.a`, mergePerf(null, 'c1', batch(), edge));
    await kv.setJSON(`${dayOf(NOW)}/c1.a`, mergePerf(null, 'c1', batch(), NOW));
    expect(await sweepPerf(kv, NOW)).toBe(1);
    expect((await stored()).sort()).toEqual([`${dayOf(edge)}/c1.a`, `${dayOf(NOW)}/c1.a`]);
  });
});

describe('/perf: считает верно', () => {
  /** Слабый Android: 900 кадров по 16 мс и 100 по 50 — медиана 60, худшие 5 % — 20. Сильный iPhone — ровно 60. */
  const days = (): PerfDay[] => [
    mergePerf(null, 'cweak', batch({ fps: { city: { 16: 900, 50: 100 } }, drops: [{ p: 'city', f: 'high', t: 'medium' }], freeze: [{ k: 'rebuild', ms: 2100 }], first: 9000, ready: 12_000, err: 2 }), NOW),
    mergePerf(null, 'cgood', batch({ dev: IPHONE, q: 'high', fps: { city: { 16: 1000 }, battle: { 16: 500, 40: 500 } }, drops: [], freeze: [{ k: 'restore', ms: 600 }], first: 2000, ready: 4000, long: null }), NOW),
  ];

  it('медиана и худшие 5 % по корзинам', () => {
    const h = { 16: 900, 50: 100 };
    expect(gapAt(h, 0.5)).toBe(16.5);
    expect(gapAt(h, 0.95)).toBe(50.5);
    expect(fpsPair(h)).toBe('60 · 20');
    expect(fpsPair({ 100: 10 })).toBe('<10 · <10');
    expect(fpsPair({ 33: 50, 16: 50 })).toBe('60 · 30');
  });

  it('класс устройства — тот же суд, что выбирает уровень графики', () => {
    expect(classOf(ANDROID)).toBe('Android слабый');
    expect(classOf(IPHONE)).toBe('iPhone средний');
    expect(classOf({ ...ANDROID, kind: 'desktop', os: 'windows', gpu: 'NVIDIA GeForce RTX 3060', tgc: null, mem: 8 })).toBe('ПК сильный');
  });

  it('сводка: места, классы, уровни, понижения, замирания, первый кадр, худшие устройства', () => {
    const text = perfSummary(days(), 7);
    expect(text).toContain('устройств 2, игроков 2, пачек 2');
    // Город вместе: 1 900 кадров по 16 мс и 100 по 50 — худшие 5 % ровно на краю 16 мс.
    expect(text).toContain('город 60 · 60 (устр. 2, кадров 2000)');
    expect(text).toContain('ролик боя 60 · 25 (устр. 1, кадров 1000)');
    expect(text).toContain('Android слабый 60 · 20 (устр. 1)');
    expect(text).toContain('iPhone средний 60 · 60 (устр. 1)');
    expect(text).toContain('Уровень графики сейчас: высокий 1, средний 1, низкий 0');
    expect(text).toContain('Сторож опустил: 1 — высокий→средний 1 (город 1)');
    expect(text).toContain('Замирание при возврате (случаев 2): медиана 600 мс, худшее 2.1 с (пересборок сцены 1)');
    expect(text).toContain('Первый кадр города: медиана 2.0 с, худшие 5 % 9.0 с; город встал: медиана 4.0 с');
    expect(text).toContain('Ошибок JS: 2 (у 1 устр.)');
    const worst = text.slice(text.indexOf('Худшие устройства'));
    expect(worst.indexOf('cweak')).toBeGreaterThan(0);
    expect(worst.indexOf('cweak')).toBeLessThan(worst.indexOf('cgood'));
    expect(worst).toContain('1. 60 · 20 город — Android слабый: Android 12 · телефон 360×800 @2 · Mali-G52 · 2 ГБ, 8 ядер · Telegram android 8.0 · класс LOW');
  });

  it('пусто — так и сказано', () => {
    expect(perfSummary([], 7)).toMatch(/^Замеров за 7 дн\. нет/);
  });

  it('/perf и /perf <кто> через бота: только админу, игрок — по номеру замка из ключа', async () => {
    const said: string[] = [];
    const tg = { say: async (_c: number, text: string) => (said.push(text), 'ok') } as unknown as Telegram;
    const update = (from: number, text: string) => ({ message: { text, from: { id: from }, chat: { id: from, type: 'private' } } });
    expect(await send(7010, batch())).toBe(200);
    // Партия есть — `/perf 7010` находит игрока по номеру (`lookup`), а замеры — по его замку.
    await home.stores(STORES.saves).setJSON('tg-7010', { v: 1 });
    await adminCommand(update(ADMIN, '/perf'), io(NOW + 1000), () => tg);
    expect(said[0]).toContain('Замеры за 7 дн.: устройств 1, игроков 1');
    await adminCommand(update(ADMIN, '/perf 7010'), io(NOW + 1000), () => tg);
    expect(said[1]).toContain(`замок ${castleIdOf('tg-7010', TEST_TOKEN)}`);
    expect(said[1]).toContain('Устройство: Android 12 · телефон 360×800 @2 · Mali-G52');
    // 17 000 кадров по 16 мс, 900 по 17 и 40 по 33: худшие 5 % — в корзине 17 мс, 57 кадров в секунду.
    expect(said[1]).toContain('город 60 · 57');
    expect(said[1]).toContain('Длинные задачи: 3, всего 900 мс, самая долгая 640 мс. Ошибок JS: 0.');
    // Чужому — тишина.
    await adminCommand(update(999, '/perf'), io(NOW + 1000), () => tg);
    expect(said).toHaveLength(2);
  });

  it('у каждого места замера — слово в сводке', () => {
    expect(Object.keys(PLACE_WORD).sort()).toEqual([...PERF_PLACES].sort());
  });
});
