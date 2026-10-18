/**
 * Пачка замеров (docs/telemetry.md): из сырого счёта сборщика (`perf/telemetry.drain`) — тело `/api/perf` договора, и
 * отправка. Своим куском, догружаемым после старта: в первую загрузку едет только счёт кадров, а описание устройства и
 * сборка пачки — нет (бюджет задания: не больше 2 КБ к первой загрузке).
 *
 * Устройство — классом: вид, ОС и её главная версия, клиент Telegram или браузер, видеокарта, экран, плотность, память
 * и ядра. Строка браузера целиком не уходит: в ней модель телефона и сборка — отпечаток, а не класс.
 */
import { deviceRatio } from '@/render/loop';
import { tgClassOf } from '@/render/quality';
import { deviceCaps, gfx, levelNow } from '@/render/gfx';
import { apiPut } from '@/net/api';
import { buildId } from '@/net/snapshot';
import { inTelegram, tg } from '@/telegram/webapp';
import { PERF_LIMITS as L, perfDropOk, type PerfDevice, type PerfPut } from '../../netlify/lib/contract';
import { drain, type Drained } from './telemetry';

const pick = (s: string | undefined, re: RegExp): string => (s && re.test(s) ? s : '');

export function device(gpu: string): PerfDevice {
  const ua = navigator.userAgent;
  const caps = deviceCaps(gpu || null);
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const os: PerfDevice['os'] = ios
    ? 'ios'
    : /Android/.test(ua)
      ? 'android'
      : /Windows/.test(ua)
        ? 'windows'
        : /Mac OS X/.test(ua)
          ? 'mac'
          : /Linux|X11|CrOS/.test(ua)
            ? 'linux'
            : 'other';
  const v = (ios ? /OS (\d+)[_.](\d+)/ : os === 'android' ? /Android (\d+)()/ : os === 'mac' ? /Mac OS X (\d+)[_.](\d+)/ : /Windows NT (\d+)\.(\d+)/).exec(ua);
  const osv = v && os !== 'linux' && os !== 'other' ? (v[2] ? `${v[1]}.${v[2]}` : v[1]) : '';
  const s = [screen.width, screen.height].map((x) => Math.min(8000, Math.max(100, Math.round(x)))).sort((a, b) => a - b);
  const app = tg();
  const inTg = inTelegram();
  return {
    kind: !caps.coarse ? 'desktop' : s[0] >= 600 ? 'tablet' : 'phone',
    os,
    osv: /^\d{1,3}(\.\d{1,3})?$/.test(osv) ? osv : '',
    app: inTg ? 'tg' : 'web',
    tgp: inTg ? pick(app?.platform, /^[a-z_]{0,16}$/) : '',
    tgv: inTg ? pick(app?.version, /^\d{1,2}(\.\d{1,2}){0,2}$/) : '',
    br: /YaBrowser/.test(ua)
      ? 'yandex'
      : /SamsungBrowser/.test(ua)
        ? 'samsung'
        : /Edg\//.test(ua)
          ? 'edge'
          : /Firefox|FxiOS/.test(ua)
            ? 'firefox'
            : /Chrome|CriOS/.test(ua)
              ? 'chrome'
              : /AppleWebKit/.test(ua)
                ? 'safari'
                : 'other',
    gpu: gpu.replace(/[^\x20-\x7e]/g, '?').slice(0, L.gpu),
    w: s[0],
    h: s[1],
    dpr: Math.min(8, Math.max(0.5, Math.round(deviceRatio() * 100) / 100)),
    mem: caps.memory !== null && caps.memory >= 0.25 && caps.memory <= 64 ? caps.memory : null,
    cores: caps.cores !== null && caps.cores >= 1 && caps.cores <= 256 ? Math.round(caps.cores) : null,
    tgc: os === 'android' ? tgClassOf(ua) : null,
  };
}

/** Пачка договора из накопленного; сказать нечего — `null`. Сказанное уходит один раз: счёт начинается заново. */
export function take(at: number): PerfPut | null {
  const d = drain(at);
  return d && pack(d);
}

function pack(d: Drained): PerfPut {
  const fps: PerfPut['fps'] = {};
  for (const [p, h] of d.hist) {
    const o: Record<string, number> = {};
    h.forEach((c, i) => {
      if (c) o[i] = c;
    });
    fps[p] = o;
  }
  const out: PerfPut = {
    v: 1,
    build: buildId().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, L.build),
    span: d.span,
    dev: device(d.gpu),
    q: levelNow(location.search),
    set: gfx().quality,
    fps,
    drops: d.drops.filter((x) => perfDropOk(x.f, x.t)),
    freeze: d.freeze,
    long: d.long && { n: d.long.n, ms: Math.round(d.long.ms), max: Math.round(d.long.max) },
    err: Math.min(L.errors, d.err),
  };
  if (d.first !== undefined) out.first = d.first;
  if (d.ready !== undefined) out.ready = d.ready;
  return out;
}

/**
 * Отправить забранный счёт. При сворачивании — `keepalive`: запрос обязан пережить выгрузку страницы. Ответ не нужен —
 * пачка не повторяется.
 */
export function send(d: Drained, away: boolean): void {
  void apiPut('/api/perf', pack(d), { keepalive: away });
}
