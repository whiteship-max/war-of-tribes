/**
 * Сборщик замеров с телефонов (docs/telemetry.md): пачка, которую собирает игра, проходит договор сервера
 * (`contract.readPerf`) — иначе сервер отказывал бы каждому честному телефону; выключенный игроком замер не считает и
 * не шлёт ничего, и накопленное до выключения не уходит.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readPerf, type PerfPut } from '../../netlify/lib/contract';

const sent: { body: PerfPut; keepalive: boolean }[] = [];
vi.mock('@/net/api', () => ({
  apiPut: (_path: string, body: PerfPut, opts: { keepalive?: boolean } = {}) => {
    sent.push({ body, keepalive: opts.keepalive === true });
    return Promise.resolve({ ok: true, data: { now: 0 } });
  },
}));

const store = new Map<string, string>();
const UA =
  'Mozilla/5.0 (Linux; Android 12; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Telegram-Android/11.2.1 (Samsung SM-A125F; Android 12; SDK 31; LOW)';
let clock = 1000;

beforeAll(() => {
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('navigator', { userAgent: UA, deviceMemory: 2, hardwareConcurrency: 8, maxTouchPoints: 5 });
  vi.stubGlobal('screen', { width: 800, height: 360 });
  vi.stubGlobal('devicePixelRatio', 2.625);
  vi.stubGlobal('location', { search: '', hostname: 'game' });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('Telegram', { WebApp: { initData: 'x', initDataUnsafe: { user: { id: 1 } }, platform: 'android', version: '8.0' } });
  vi.stubGlobal('addEventListener', () => undefined);
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Пять минут города ровными шестьюдесятью — через настоящую дверь кадра и подставной экран. */
async function play(seconds: number): Promise<void> {
  const { FrameLoop } = await import('@/render/loop');
  const queue: ((t: number) => void)[] = [];
  let t = clock;
  const loop = new FrameLoop<never>(() => undefined, undefined, {
    raf: (cb) => queue.push(cb),
    caf: () => undefined,
    away: () => false,
  });
  loop.place = 'city';
  loop.restart();
  for (let i = 0; i < seconds * 60; i++) {
    t += 1000 / 60;
    queue.shift()?.(t);
  }
  loop.stop();
  clock = t;
}

describe('пачка игры', () => {
  it('проходит договор сервера целиком', async () => {
    const perf = await import('./telemetry');
    perf.startPerf();
    perf.perfGpu('Mali-G52 MC2');
    perf.perfCity('first');
    await play(300);
    perf.perfCity('ready');
    const { Steady } = await import('@/render/steady');
    const { QUALITIES, VILLAGE_STEADY } = await import('@/render/quality');
    // Сторож опускает высокий: две секунды кадров по 60 мс после прогрева.
    const s = new Steady(QUALITIES, 'high', VILLAGE_STEADY);
    for (let i = 0; i < 200 && s.tier === 'high'; i++) s.feed(60);
    expect(s.tier).toBe('medium');
    perf.perfRestore(640);
    const batch = perf.take(clock);
    expect(batch).not.toBeNull();
    const read = readPerf(JSON.parse(JSON.stringify(batch)));
    expect(read).toEqual(batch);
    const b = batch as PerfPut;
    expect(b.dev).toMatchObject({ kind: 'phone', os: 'android', osv: '12', app: 'tg', tgp: 'android', tgv: '8.0', br: 'chrome', gpu: 'Mali-G52 MC2', w: 360, h: 800, dpr: 2.63, mem: 2, cores: 8, tgc: 'LOW' });
    expect(b.drops).toEqual([{ p: 'city', f: 'high', t: 'medium' }]);
    expect(b.freeze).toEqual([{ k: 'restore', ms: 640 }]);
    expect(b.first).toBe(1000);
    // Кадры: 18 000 кадров экрана — 17 999 промежутков (первый кадр хода промежутка не даёт), все в корзине 16 мс.
    expect(b.fps.city).toEqual({ 16: 17_999 });
    expect(b.span).toBe(300_000);
    // Сказанное уходит один раз: следующая пачка пуста.
    clock += 300_000;
    expect(perf.take(clock)).toBeNull();
  });

  it('при сворачивании пачка уходит с keepalive и тоже проходит договор', async () => {
    const perf = await import('./telemetry');
    const { setAppAsleep } = await import('@/render/loop');
    await play(10);
    setAppAsleep(true);
    setAppAsleep(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].keepalive).toBe(true);
    expect(typeof readPerf(JSON.parse(JSON.stringify(sent[0].body)))).toBe('object');
    expect(perf.perfOn()).toBe(true);
  });
});

describe('«Отправлять замеры» выключено — выключено сразу', () => {
  it('не считает, не шлёт, и накопленное до выключения не уходит', async () => {
    const perf = await import('./telemetry');
    const { setAppAsleep } = await import('@/render/loop');
    const n = sent.length;
    await play(20);
    perf.perfRestore(500);
    perf.setPerfOn(false);
    expect(store.get(perf.PERF_KEY)).toBe('0');
    expect(perf.perfOn()).toBe(false);
    // Выключено: не считает — слушатель двери кадра снят, за минуту кадров сказать нечего.
    await play(60);
    expect(perf.take(clock)).toBeNull();
    // И не шлёт: кадры, сворачивание, первый кадр и замирание — ни одной пачки.
    await play(60);
    perf.perfCity('first');
    perf.perfRestore(700);
    setAppAsleep(true);
    setAppAsleep(false);
    expect(sent).toHaveLength(n);
    // Включили снова: старое не воскресло — до включения сказать нечего.
    perf.setPerfOn(true);
    expect(perf.take(clock)).toBeNull();
    await play(5);
    const b = perf.take(clock);
    expect(b?.fps.city).toBeDefined();
    expect(b?.freeze).toEqual([]);
  });
});
