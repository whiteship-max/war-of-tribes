/**
 * Замеры плавности с телефонов (`/api/perf`, PUT; docs/telemetry.md): игра шлёт пачку раз в пять минут и при
 * сворачивании, сервер вливает её в сутки устройства (`lib/perf.ts`). Один обработчик на Netlify (`functions/perf.mts`) и
 * на своём сервере.
 *
 * Личность — только из подписи, как у сохранения; в запись идёт не ключ игрока, а номер замка (`roster.castleIdOf`).
 * Пачке сервер не верит ни в чём (правило ЗЩ-1): `contract.readPerf` отказывает целиком за незнакомое поле и за число
 * вне разумного — 400. Поток держат два сита: ведро в памяти (`PERF_LIMITS.perMinute` в минуту) и
 * потолок пачек на сутки устройства в самой записи (`perDay`), который переживает смерть экземпляра.
 */
import { readInitData, saveKeyOf } from '../initdata.js';
import { allow, botToken, deny, json, parseJson, readBody, type Route } from '../http.js';
import { PERF_LIMITS, readPerf, type PerfResponse } from '../contract.js';
import { STORES } from '../kv.js';
import { castleIdOf } from '../roster.js';
import { sweepPerf, writePerf } from '../perf.js';

/** Пачка замеров мала: больше этого — не пачка (кадры девяти мест по сто одной корзине — около восьми килобайт). */
export const PERF_MAX_BYTES = 32 * 1024;

/** Уборка старше срока — не чаще раза в час на экземпляр. */
const SWEEP_EVERY = 3_600_000;
let swept = 0;

export const perf: Route = async (req, io) => {
  const now = io.now;
  const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
  if (!auth.ok) return deny(401, 'unauthorized');
  const key = saveKeyOf(auth.user);
  if (req.method !== 'PUT') return deny(405, 'method');
  if (!allow(`perf:${key}`, PERF_LIMITS.perMinute, now)) return deny(429, 'slow-down', { 'retry-after': '60' });

  const text = await readBody(req);
  if (text === null || text.length > PERF_MAX_BYTES) return deny(413, 'too-big');
  const batch = readPerf(parseJson<unknown>(text));
  // Причину словами знает только тест (`readPerf`): наружу, как везде, — одно слово отказа.
  if (typeof batch === 'string') return deny(400, 'bad-body');

  const kv = io.stores(STORES.perf);
  const put = await writePerf(kv, castleIdOf(key), batch, now);
  if (put === 'full') return deny(429, 'day-full', { 'retry-after': '3600' });
  if (put === 'busy') return deny(503, 'busy', { 'retry-after': '30' });
  if (now - swept >= SWEEP_EVERY) {
    swept = now;
    await sweepPerf(kv, now);
  }
  const body: PerfResponse = { now };
  return json(body);
};
