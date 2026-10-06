/**
 * Исходящие уведомления с этой стороны: отдать серверу список черновиков и отметку
 * «игрок здесь / ушёл» (docs/NOTIFY.md, раздел 4), прочесть рычаг и канал для строки в
 * настройках и попросить у Telegram права писать (раздел 12).
 *
 * **Замок клиента — `NOTIFY_ON`**, тем же приёмом, что `CHEATS_ON`: все места вызова стоят за
 * `if (NOTIFY_ON)`. Открыт 05.10.2026 вместе с адаптером Telegram (решение владельца): бот пишет о
 * нападении и о бое. Отправлять или нет, решает сервер — флаг `TRIBE_DELIVER` и рычаг игрока
 * (`prefs.on`, кнопка под сообщением бота), — а клиент только кладёт поручение.
 *
 * Когда клиент говорит с сервером:
 *
 * 1. **первым сетевым вызовом игры** — «здесь» (или «ушёл», если запущены в фоне): иначе
 *    вернувшийся игрок несколько секунд числился бы отсутствующим и получил бы то, что
 *    видит своими глазами;
 * 2. **список изменился** после пульса мира — не чаще раза в `LIST_EVERY`;
 * 3. **страница скрыта** — список и «ушёл», запросом с `keepalive`, чтобы он пережил
 *    выгрузку. `sendBeacon` не годится: он не несёт заголовка подписи;
 * 4. **страница снова видна** — «здесь»; **пока видна** — «здесь» раз в `BEAT_EVERY`.
 *
 * Пишет только ведущая вкладка (`session.ts`): вторая не говорит ничего.
 */
import { apiPut, type ApiResult } from './api';
import { serverNow } from './clock';
import { leaseHolder } from './session';
import { tg, tgUser } from '@/telegram/webapp';
import type { NoticeItem, NotifyChannel, NotifyPrefs, NotifyPut, NotifyState } from '../../netlify/lib/contract';

/** Замок клиента (открыт 05.10.2026, docs/NOTIFY.md, раздел 12). */
export const NOTIFY_ON = true;

/** Список не чаще этого — тот же предел, что держит сервер (`NOTICE_LIMITS.putEvery`). */
export const LIST_EVERY = 5_000;
/** Отметка «здесь», пока страница видна. Сервер считает игрока ушедшим после тишины дольше `PRESENCE_STALE`. */
export const BEAT_EVERY = 60_000;

/** Всё, чем модуль трогает мир снаружи, — чтобы логику можно было прогнать тестом. */
export interface NotifyDeps {
  put: (body: NotifyPut, keepalive: boolean) => Promise<ApiResult<NotifyState>>;
  now: () => number;
  /** Ведём ли мы партию. */
  leading: () => boolean;
  visible: () => boolean;
  /** Пояс игрока — для тихих часов и «HH:MM» в словах. */
  zone: () => string;
  /** Отложить повтор. */
  later: (fn: () => void, ms: number) => void;
  /** Ответ сервера: рычаг и канал — строке в настройках. */
  state?: (s: NotifyState) => void;
}

export interface Notifier {
  /** Первый сетевой вызов игры: присутствие. */
  boot(): void;
  /** Черновики после пульса мира: `at` — минута, на которую они составлены. */
  drafts(items: NoticeItem[], at: number): void;
  /** Страница скрылась или показалась. */
  visibility(): void;
  /** Раз в минуту, пока видна. */
  beat(): void;
}

export function makeNotifier(deps: NotifyDeps): Notifier {
  let sentHash: string | null = null;
  let pending: { items: NoticeItem[]; at: number; hash: string } | null = null;
  let listAt = -Infinity;
  let retry = false;
  let zoneSent = false;

  const settle = (res: ApiResult<NotifyState>, list: typeof pending): void => {
    if (res.ok) {
      deps.state?.(res.data);
      if (list) {
        sentHash = list.hash;
        if (pending?.hash === list.hash) pending = null;
      }
      // Пояс уходит один раз и только если на сервере другой: настроек игрок сейчас не
      // правит, а переписывать их умолчаниями при каждом запуске значило бы затирать выбор.
      const zone = deps.zone();
      if (!zoneSent && res.data.prefs.tz !== zone) {
        zoneSent = true;
        const prefs: NotifyPrefs = { ...res.data.prefs, tz: zone };
        void deps.put({ prefs }, false);
      }
      return;
    }
    // Разметка не прошла — повтор того же списка отказан будет так же. Не долбим.
    if (res.why === 'server' && list) sentHash = list.hash;
    // Частота и часы лечатся временем: ответ уже поправил часы (`api.ts`), и через
    // `LIST_EVERY` список уйдёт снова, если он всё ещё новый.
    if (res.why === 'busy' || res.why === 'server') schedule();
  };

  const schedule = (): void => {
    if (retry) return;
    retry = true;
    deps.later(() => {
      retry = false;
      flush(false);
    }, LIST_EVERY);
  };

  /** Отправить то, что накопилось. `hidden` — на уходе: вместе с «ушёл» и с `keepalive`. */
  const flush = (hidden: boolean): void => {
    if (!deps.leading()) return;
    const list = pending && pending.hash !== sentHash ? pending : null;
    const now = deps.now();
    if (!hidden) {
      if (!list) return;
      if (now - listAt < LIST_EVERY) return schedule();
    }
    const body: NotifyPut = hidden ? { present: false } : {};
    if (list && now - listAt >= LIST_EVERY) {
      body.items = list.items;
      body.computedAt = list.at;
      listAt = now;
    }
    if (!hidden && body.items === undefined) return;
    void deps.put(body, hidden).then((res) => settle(res, body.items ? list : null));
  };

  return {
    boot() {
      if (!deps.leading()) return;
      void deps.put({ present: deps.visible() }, false).then((res) => settle(res, null));
    },
    drafts(items, at) {
      const hash = JSON.stringify(items);
      if (hash === sentHash) {
        pending = null;
        return;
      }
      pending = { items, at, hash };
      if (deps.visible()) flush(false);
    },
    visibility() {
      if (!deps.leading()) return;
      if (deps.visible()) void deps.put({ present: true }, false).then((res) => settle(res, null));
      else flush(true);
    },
    beat() {
      if (!deps.leading() || !deps.visible()) return;
      void deps.put({ present: true }, false).then((res) => settle(res, null));
    },
  };
}

let live: Notifier | null = null;

// ---------- Рычаг, канал и право писать (docs/NOTIFY.md, раздел 12) ----------

/** Что сервер сказал о рычаге и канале. `null` — ещё не спрашивали или вне Telegram. */
let known: { on: boolean; chan: NotifyChannel } | null = null;
const listeners = new Set<() => void>();

const keepState = (s: NotifyState): void => {
  if (known?.on === s.prefs.on && known.chan === s.chan) return;
  known = { on: s.prefs.on, chan: s.chan };
  for (const fn of listeners) fn();
};

/** Рычаг и канал для настроек — через подписку, как звук (`sound/settings`). */
export const notifyState = (): { on: boolean; chan: NotifyChannel } | null => known;
export const subscribeNotify = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

const zone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
};

const put = (body: NotifyPut): void => {
  void apiPut<NotifyState>('/api/notify', body).then((res) => {
    if (res.ok) keepState(res.data);
  });
};

/** Разрешил ли игрок боту писать — по строке запуска. Разрешение, данное в этой сессии, видно по ответу запроса. */
let granted = false;
const allowed = (): boolean => granted || tgUser()?.allows_write_to_pm === true;

/**
 * Попросить у Telegram права писать (`requestWriteAccess`, Bot API 6.9). Хватает ли того, что игрок запускал
 * бота, видно по `allows_write_to_pm` в строке запуска: есть — не спрашиваем. Ответ «да» говорит серверу
 * «пробуй писать» (`canWrite`); адресат и так только из подписи.
 */
function requestWrite(): void {
  const app = tg();
  if (!app?.requestWriteAccess || !app.isVersionAtLeast?.('6.9') || allowed()) return;
  app.requestWriteAccess((ok) => {
    if (!ok) return;
    granted = true;
    put({ canWrite: true });
  });
}

const ASKED = 'tribe.notify.asked';

/**
 * Спросить один раз за устройство и в минуту, когда это понятно: на город идут или своё войско вышло на соседа.
 * Без жеста: окно Telegram — системное, и спрашивает оно ровно о том, что игрок видит на экране.
 */
export function askWriteOnce(): void {
  if (!NOTIFY_ON || allowed()) return;
  try {
    if (localStorage.getItem(ASKED)) return;
    localStorage.setItem(ASKED, '1');
  } catch {
    return;
  }
  requestWrite();
}

/** Переключить рычаг из настроек. Включение — жест, и право писать спрашивается в нём же, без `await` перед вызовом. */
export function setNotifyOn(on: boolean): void {
  if (on) requestWrite();
  if (known) keepState({ now: 0, gen: 0, items: 0, away: null, prefs: { on, tz: zone() }, chan: known.chan });
  put({ prefs: { on, tz: zone() } });
}

/**
 * Завести уведомления. Зовут только из-за `if (NOTIFY_ON)` — раньше синхронизации партии
 * и реестра, чтобы присутствие стало первым сетевым вызовом.
 */
export function notifyBoot(): void {
  if (!NOTIFY_ON || live) return;
  live = makeNotifier({
    put: (body, keepalive) => apiPut<NotifyState>('/api/notify', body, { keepalive }),
    now: serverNow,
    leading: () => leaseHolder() !== 'other',
    visible: () => document.visibilityState !== 'hidden',
    zone,
    later: (fn, ms) => void setTimeout(fn, ms),
    state: keepState,
  });
  live.boot();
  document.addEventListener('visibilitychange', () => live?.visibility());
  setInterval(() => live?.beat(), BEAT_EVERY);
}

/** Черновики после пульса мира. Зовут только из-за `if (NOTIFY_ON)`. */
export function notifyDrafts(items: NoticeItem[], at: number): void {
  live?.drafts(items, at);
  // Первый набег на город — та минута, когда просьба писать понятна без слов.
  if (items.length > 0) askWriteOnce();
}
