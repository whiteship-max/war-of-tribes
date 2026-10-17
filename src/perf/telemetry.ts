/**
 * Замеры плавности с телефонов (docs/telemetry.md) — сборщик и отправка. Игра сама сообщает серверу, как она идёт на
 * настоящих телефонах: кадры по местам, уровень графики и его понижения сторожем, замирание при возврате, первый кадр
 * города, длинные задачи и число ошибок, устройство классом. Ни имени, ни строки браузера, ни координат: игрока сервер
 * знает только номером замка, который выводит из подписи сам.
 *
 * **Цена для игры — ни одного своего кадра и ни одного своего таймера на кадр.** Промежутки между кадрами приносит
 * дверь кадра (`loop.onFrameGap`), понижения — сторож (`steady.onSteadyDrop`); здесь только счёт в корзины. Пачка
 * уходит раз в `BATCH_MS` и при сворачивании (`watchAway`), подписанным запросом той же двери, что сохранение
 * (`net/api`). Не ушла — пропадает: замеры не догоняют, и очередь на телефоне не копится.
 *
 * **Выключено игроком — выключено сразу:** слушатели снимаются, накопленное выбрасывается, и не уходит ничего
 * (строка «Отправлять замеры» в настройках, `setPerfOn`). Вне Telegram подписи нет, и сборщик не заводится вовсе.
 */
import { deviceRatio, onFrameGap, watchAway, type FramePlace } from '@/render/loop';
import { onSteadyDrop } from '@/render/steady';
import { tgClassOf } from '@/render/quality';
import { deviceCaps, gfx, levelNow } from '@/render/gfx';
import { apiPut } from '@/net/api';
import { buildId } from '@/net/snapshot';
import { inTelegram, tg } from '@/telegram/webapp';
import { PERF_LIMITS as L, perfDropOk, type PerfDevice, type PerfDrop, type PerfFreeze, type PerfPut } from '../../netlify/lib/contract';

/** Пачка — раз в пять минут: сводке хватает, а запросов у сервера — дюжина в час на игрока. */
export const BATCH_MS = 5 * 60_000;

/** Запись выбора на устройстве; `0` — игрок выключил. Умолчание — включено (решение владельца, задание Г-1). */
export const PERF_KEY = 'tribe.perf';

// ---------- рычаг ----------

const read = (): boolean => {
  try {
    return localStorage.getItem(PERF_KEY) !== '0';
  } catch {
    return true;
  }
};
let on = read();
const listeners = new Set<() => void>();

export const perfOn = (): boolean => on;

export function subscribePerf(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/** Строка настроек: выключение — сразу, слушатели снимаются и накопленное выбрасывается. */
export function setPerfOn(next: boolean): void {
  try {
    localStorage.setItem(PERF_KEY, next ? '1' : '0');
  } catch {
    // приватное окно: выбор живёт до перезагрузки
  }
  if (next === on) return;
  on = next;
  take(now());
  if (started) arm(on);
  for (const cb of listeners) cb();
}

// ---------- счёт ----------

const now = (): number => performance.now();

/** Промежутки между кадрами по местам: корзина в миллисекунду, последняя — «столько и дольше». */
const hist = new Map<FramePlace, Uint32Array>();
let place: FramePlace = 'city';
let drops: PerfDrop[] = [];
let freeze: PerfFreeze[] = [];
let first: number | undefined;
let ready: number | undefined;
/** Первый кадр и «встал» — раз за заход: следующие сцены (смена графики, пересборка) — не начало игры. */
let firstDone = false;
let readyDone = false;
/** Пересборка города после потерянного контекста: с какой минуты ждём первого кадра новой сцены. */
let rebuildAt = 0;
let long = { n: 0, ms: 0, max: 0 };
let longOk = false;
let err = 0;
let since = now();
let gpu = '';

const gap = (p: FramePlace, ms: number): void => {
  place = p;
  let h = hist.get(p);
  if (!h) hist.set(p, (h = new Uint32Array(L.bucket + 1)));
  h[Math.min(L.bucket, Math.max(0, Math.floor(ms)))]++;
};

const drop = (f: string, t: string): void => {
  if (drops.length < L.drops && perfDropOk(f, t)) drops.push({ p: place, f, t });
};

const fault = (): void => {
  if (on) err++;
};

/** Видеокарту называет сцена города: контекст WebGL есть только у неё (`Scene.ts`). */
export function perfGpu(name: string | null): void {
  if (name) gpu = name.replace(/[^\x20-\x7e]/g, '?').slice(0, L.gpu);
}

const freezeOf = (k: PerfFreeze['k'], ms: number): void => {
  if (on && freeze.length < L.freeze) freeze.push({ k, ms: Math.min(L.freezeMs, Math.max(0, Math.round(ms))) });
};

/** Контекст WebGL вернулся: сколько длился первый кадр после возврата (сборка программ и слоёв заново), мс. */
export const perfRestore = (ms: number): void => freezeOf('restore', ms);

/** Контекст не вернулся в срок: сцена города собирается заново — отсчёт до её первого кадра. */
export function perfRebuild(): void {
  rebuildAt = now();
}

/**
 * Город нарисовал первый кадр (`'first'`) или встал целиком (`'ready'`). Первый кадр сцены, собранной после потери
 * контекста, — конец замирания пересборки, а не начало игры.
 */
export function perfCity(what: 'first' | 'ready'): void {
  if (!on) return;
  const t = now();
  if (what === 'first' && rebuildAt) {
    freezeOf('rebuild', t - rebuildAt);
    rebuildAt = 0;
    return;
  }
  const ms = Math.min(L.firstMs, Math.max(1, Math.round(t)));
  if (what === 'first' && !firstDone) {
    firstDone = true;
    first = ms;
  } else if (what === 'ready' && !readyDone && firstDone) {
    readyDone = true;
    ready = Math.max(ms, first ?? 1);
  }
}

// ---------- устройство ----------

const pick = (s: string | undefined, re: RegExp): string => (s && re.test(s) ? s : '');

function device(): PerfDevice {
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
  const osv = v && os !== 'linux' && os !== 'other' ? (v[2] ? `${v[1]}.${v[2]}` : v[1]).slice(0, 7) : '';
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
    gpu,
    w: s[0],
    h: s[1],
    dpr: Math.min(8, Math.max(0.5, Math.round(deviceRatio() * 100) / 100)),
    mem: caps.memory !== null && caps.memory >= 0.25 && caps.memory <= 64 ? caps.memory : null,
    cores: caps.cores !== null && caps.cores >= 1 && caps.cores <= 256 ? Math.round(caps.cores) : null,
    tgc: os === 'android' ? tgClassOf(ua) : null,
  };
}

// ---------- пачка ----------

/**
 * Собрать пачку и начать счёт заново. Сказать нечего (ни кадра, ни события) — `null`. Охват — время с прошлой пачки,
 * не дольше потолка договора.
 */
export function take(at: number): PerfPut | null {
  const span = Math.min(L.spanMax, Math.round(at - since));
  since = at;
  const fps: PerfPut['fps'] = {};
  let frames = 0;
  for (const [p, h] of hist) {
    const o: Record<string, number> = {};
    h.forEach((c, i) => {
      if (c) o[i] = c;
    });
    fps[p] = o;
    frames++;
  }
  const out: PerfPut = {
    v: 1,
    build: buildId().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, L.build),
    span,
    dev: device(),
    q: levelNow(location.search),
    set: gfx().quality,
    fps,
    drops,
    freeze,
    long: longOk ? { n: long.n, ms: Math.round(long.ms), max: Math.round(long.max) } : null,
    err: Math.min(L.errors, err),
  };
  if (first !== undefined) out.first = first;
  if (ready !== undefined) out.ready = ready;
  const said = frames || drops.length || freeze.length || first !== undefined || ready !== undefined || err;
  hist.clear();
  drops = [];
  freeze = [];
  first = ready = undefined;
  long = { n: 0, ms: 0, max: 0 };
  err = 0;
  return said && span >= L.spanMin ? out : null;
}

function flush(away: boolean): void {
  if (!on) return;
  const batch = take(now());
  // При сворачивании — `keepalive`: запрос обязан пережить выгрузку страницы. Ответ не нужен — пачка не повторяется.
  if (batch) void apiPut('/api/perf', batch, { keepalive: away });
}

// ---------- заводка ----------

let started = false;

function arm(yes: boolean): void {
  onFrameGap(yes ? gap : null);
  onSteadyDrop(yes ? drop : null);
}

/** Завести сборщик — раз за заход, из `main.tsx`. Вне Telegram подписи нет: не заводится. */
export function startPerf(): void {
  if (started || !inTelegram()) return;
  started = true;
  arm(on);
  addEventListener('error', fault);
  addEventListener('unhandledrejection', fault);
  // Long Tasks API есть только у Chromium (Android, Telegram на компьютере); у WebKit — `null` в пачке, а не ноль.
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    longOk = true;
    new PerformanceObserver((list) => {
      if (!on) return;
      for (const e of list.getEntries()) {
        long.n++;
        long.ms += e.duration;
        long.max = Math.max(long.max, e.duration);
      }
    }).observe({ type: 'longtask', buffered: true });
  }
  setInterval(() => flush(false), BATCH_MS);
  watchAway((away) => {
    if (away) flush(true);
    // Время в фоне — не охват пачки: кадров там нет, и пачка не делится на него.
    else since = now();
  });
}
