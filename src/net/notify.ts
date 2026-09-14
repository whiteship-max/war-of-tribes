/**
 * Исходящие уведомления с этой стороны: отдать серверу список черновиков и отметку
 * «игрок здесь / ушёл» (docs/NOTIFY.md, раздел 4).
 *
 * **Выключено замком — `NOTIFY_ON`**, тем же приёмом, что `CHEATS_ON`. `false` значит:
 * ни одного запроса на `/api/notify`, ни одного черновика, посчитанного впустую, ни строки
 * в настройках. Все места вызова стоят за `if (NOTIFY_ON)`, и сборщик выбрасывает их вместе
 * с этим модулем — игрок, который уведомлений не включал, не платит за них ни байтом кода.
 * Второй замок — на сервере: адаптеров в проходе доставки нет ни одного (`server.test.ts`).
 *
 * Когда клиент говорит с сервером:
 *
 * 1. **первым сетевым вызовом игры** — «здесь» (или «ушёл», если запущены в фоне): иначе
 *    вернувшийся игрок несколько секунд числился бы отсутствующим и получил бы то, что
 *    видит своими глазами;
 * 2. **список изменился** после пульса мира — не чаще раза в пять секунд;
 * 3. **страница скрыта** — список и «ушёл», запросом с `keepalive`, чтобы он пережил
 *    выгрузку. `sendBeacon` не годится: он не несёт заголовка подписи;
 * 4. **страница снова видна** — «здесь»; **пока видна** — «здесь» раз в минуту.
 *
 * Пишет только ведущая вкладка (`session.ts`): вторая не говорит ничего.
 */
import { apiPut, type ApiResult } from './api';
import { serverNow } from './clock';
import { leaseHolder } from './session';
import type { NoticeItem, NotifyPrefs, NotifyPut, NotifyState } from '../../netlify/lib/contract';

/** Замок клиента. Включение — отдельная пачка, вместе с настройками и адаптером. */
export const NOTIFY_ON = false;

/** Список не чаще этого — тот же предел, что держит сервер (`NOTICE_LIMITS.putEvery`). */
export const LIST_EVERY = 5_000;
/** Отметка «здесь», пока страница видна. Сервер считает игрока ушедшим после трёх минут тишины. */
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
    // Частота и часы лечатся временем: ответ уже поправил часы (`api.ts`), и через пять
    // секунд список уйдёт снова, если он всё ещё новый.
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
    zone: () => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
      } catch {
        return '';
      }
    },
    later: (fn, ms) => void setTimeout(fn, ms),
  });
  live.boot();
  document.addEventListener('visibilitychange', () => live?.visibility());
  setInterval(() => live?.beat(), BEAT_EVERY);
}

/** Черновики после пульса мира. Зовут только из-за `if (NOTIFY_ON)`. */
export function notifyDrafts(items: NoticeItem[], at: number): void {
  live?.drafts(items, at);
}
