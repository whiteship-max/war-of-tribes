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
import { onFrameGap, watchAway, type FramePlace } from '@/render/loop';
import { onSteadyDrop } from '@/render/steady';
import { inTelegram } from '@/telegram/webapp';
import { PERF_LIMITS as L, type PerfDrop, type PerfFreeze } from '../../netlify/lib/contract';

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
  drain(now());
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
  if (drops.length < L.drops) drops.push({ p: place, f, t });
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

// ---------- пачка ----------

/** Сырой счёт с прошлой пачки — из него пачку договора собирает догружаемый кусок (`perf/batch`). */
export interface Drained {
  span: number;
  hist: Map<FramePlace, Uint32Array>;
  drops: PerfDrop[];
  freeze: PerfFreeze[];
  first?: number;
  ready?: number;
  long: { n: number; ms: number; max: number } | null;
  err: number;
  gpu: string;
}

/**
 * Забрать накопленное и начать счёт заново. Сказать нечего (ни кадра, ни события) или охват короче потолка договора —
 * `null`. Охват — время с прошлой пачки, не дольше потолка договора.
 */
export function drain(at: number): Drained | null {
  const out: Drained = { span: Math.min(L.spanMax, Math.round(at - since)), hist: new Map(hist), drops, freeze, first, ready, long: longOk ? long : null, err, gpu };
  since = at;
  const said = hist.size || drops.length || freeze.length || first !== undefined || ready !== undefined || err;
  hist.clear();
  drops = [];
  freeze = [];
  first = ready = undefined;
  long = { n: 0, ms: 0, max: 0 };
  err = 0;
  return said && out.span >= L.spanMin ? out : null;
}

/** Сборка пачки и отправка — своим куском (`perf/batch`): в первую загрузку едет только счёт. */
const batch = (): Promise<typeof import('./batch')> => import('./batch');

/** Счёт забирается сразу, в минуту пачки или сворачивания, — кусок отправки получает его готовым, когда догрузится. */
function flush(away: boolean): void {
  const d = on ? drain(now()) : null;
  if (d) void batch().then((b) => b.send(d, away));
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
  // Кусок отправки — заранее, после старта: при сворачивании ждать сети за ним поздно.
  setTimeout(() => void batch(), 20_000);
  watchAway((away) => {
    if (away) flush(true);
    // Время в фоне — не охват пачки: кадров там нет, и пачка не делится на него.
    else since = now();
  });
}
