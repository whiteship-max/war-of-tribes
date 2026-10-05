/**
 * Исходящие уведомления — правила сервера, отдельно от разговора по сети.
 *
 * Второе место, где сервер читает то, что хранит (первое — реестр замков), и это решение
 * владельца, записанное в docs/handbook/sync.md и держащееся тестом (`server.test.ts`): разбирающих
 * записей ровно две. Читает он здесь не партию, а поручение — «в такую-то минуту скажи
 * вот это, если игрока нет» — и ничего не решает о мире: не проверяет, идёт ли осада,
 * не считает хлеба, не начисляет ничего. Составляет поручение клиент (`src/world/notice.ts`).
 *
 * Модуль чистый: ни хранилища, ни часов — «сейчас» ему передают. Поэтому каждое правило
 * отправки проверяется тестом без подмены глобальных часов (`notify.test.ts`).
 */
import {
  DEFAULT_PREFS,
  NOTICE_KINDS,
  NOTICE_LIMITS,
  readNotices,
  readPrefs,
  type NoticeItem,
  type NotifyChannel,
  type NotifyPrefs,
  type NotifyPut,
  type NotifyState,
} from './contract.js';

/**
 * Запись исходящих одного игрока. Одна на игрока, переписывается целиком.
 *
 * Версия 2 (05.10.2026): поручения сервера (`srv`) — новости войны между игроками, которые составляет он сам, —
 * отдельно от списка клиента: список клиента заменяется целиком при каждом приёме, и война в нём пропала бы.
 * Канал (`chan`) — может ли бот писать. Настройки — один рычаг (`contract.NotifyPrefs`). Запись версии 1
 * читается: присутствие, список и отправленное остаются, прежние настройки — умолчанием.
 */
export interface NotifyRecord {
  v: 2;
  /** Номер принятого списка: растёт на каждый приём. */
  gen: number;
  /** Серверные часы клиента в минуту составления последнего списка. */
  computedAt: number;
  /** Когда последний список принят, по нашим часам. На этом стоит предел частоты. */
  putAt: number;
  /** `away` — с какой минуты игрока нет (null — он здесь); `beatAt` — последняя отметка. */
  presence: { away: number | null; beatAt: number };
  /** Список клиента: мир на клиенте (набег логова, осада логова). */
  items: NoticeItem[];
  /** Поручения сервера: война между игроками (`war.newsOf`). */
  srv: NoticeItem[];
  /** Что уже ушло: ключ пункта → минута отметки. Живёт `SENT_KEEP`. */
  sent: Record<string, number>;
  /** Сколько ушло в эти сутки игрока. */
  day: { date: string; n: number };
  /** Когда ушло последнее. */
  lastAt: number;
  prefs: NotifyPrefs;
  /** Может ли бот писать: `closed` — Telegram отказал (не разрешено или бот заблокирован). */
  chan: { state: NotifyChannel; at: number };
}

/** Отметка присутствия старше этого — окно убили без события скрытия: игрока нет. */
export const PRESENCE_STALE = 3 * 60_000;
/** Кто ушёл позже, чем за это время до новости, её уже видел. */
export const SEEN_GRACE = 2 * 60_000;
/** Сколько помнится отправленное: дольше любого окна осады. */
export const SENT_KEEP = 48 * 60 * 60_000;
/** Одно сообщение в чат не чаще этого. */
export const PACE = 60_000;
/**
 * Не больше стольких сообщений в сутки игрока. Ручки у игрока нет (рычаг один — «Отключить»); потолок — защита
 * от потока, а не настройка: набег логова даёт два сообщения, осада логова — одно, а у войны боёв столько, сколько
 * вылазок и ударов сделает другая сторона.
 */
export const DAY_CAP = 12;
/** Сколько годна новость об итоге — одно число с клиентом (`contract.RESULT_KEEP`). */
export { RESULT_KEEP } from './contract.js';

export const emptyNotify = (): NotifyRecord => ({
  v: 2,
  gen: 0,
  computedAt: 0,
  putAt: 0,
  presence: { away: null, beatAt: 0 },
  items: [],
  srv: [],
  sent: {},
  day: { date: '', n: 0 },
  lastAt: 0,
  prefs: { ...DEFAULT_PREFS },
  chan: { state: 'unknown', at: 0 },
});

const n = (v: unknown, dflt = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

/**
 * Запись из хранилища. Разбирается так же недоверчиво, как тело запроса: испорченное —
 * пустая запись, а не исключение. Версия 1 приводится к 2 (шапка `NotifyRecord`).
 */
export function readNotify(raw: unknown): NotifyRecord {
  if (!raw || typeof raw !== 'object') return emptyNotify();
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 && r.v !== 2) return emptyNotify();
  const presence = (r.presence ?? {}) as Record<string, unknown>;
  const day = (r.day ?? {}) as Record<string, unknown>;
  const chan = (r.chan ?? {}) as Record<string, unknown>;
  const sent: Record<string, number> = {};
  if (r.sent && typeof r.sent === 'object') {
    for (const [k, at] of Object.entries(r.sent as Record<string, unknown>)) {
      if (typeof at === 'number' && Number.isFinite(at) && k.length <= NOTICE_LIMITS.key) sent[k] = at;
    }
  }
  const state = chan.state === 'open' || chan.state === 'closed' ? chan.state : 'unknown';
  return {
    v: 2,
    gen: Math.max(0, Math.floor(n(r.gen))),
    computedAt: n(r.computedAt),
    putAt: n(r.putAt),
    presence: {
      away: typeof presence.away === 'number' && Number.isFinite(presence.away) ? presence.away : null,
      beatAt: n(presence.beatAt),
    },
    // Своя запись читается без потолка по времени: срок пункта проверили при приёме. Список прежних видов
    // (осада по рогаткам и хлебу, версия 1) не разбирается — и читается пустым: клиент пришлёт новый.
    items: readNotices(r.items ?? [], Number.POSITIVE_INFINITY) ?? [],
    srv: r.v === 2 ? (readNotices(r.srv ?? [], Number.POSITIVE_INFINITY, NOTICE_KINDS) ?? []) : [],
    sent,
    day: { date: typeof day.date === 'string' ? day.date.slice(0, 10) : '', n: Math.max(0, Math.floor(n(day.n))) },
    lastAt: n(r.lastAt),
    prefs: r.v === 2 ? readPrefs(r.prefs) : { ...DEFAULT_PREFS, tz: readPrefs(r.prefs).tz },
    chan: { state, at: n(chan.at) },
  };
}

/** Метка индекса: минута `fireAt` и ключ игрока. Минута дополнена нулями — метки сортируются строкой. */
export const minuteOf = (ms: number): string => String(Math.floor(ms / 60_000)).padStart(9, '0');
export const markOf = (item: Pick<NoticeItem, 'fireAt'>, player: string): string => `${minuteOf(item.fireAt)}/${player}`;

/** Ключ игрока в метке. Только такой вид и принимается — других ключей из метки не собрать. */
export const PLAYER_KEY = /^tg-[1-9]\d{0,19}$/;

/** Отказ приёма: код ответа и одно слово наружу. */
export type AcceptFail = { status: number; error: string };

/**
 * Принять то, что прислал клиент, поверх записи. Возвращает новую запись и метки, которые
 * надо положить в индекс, либо отказ.
 *
 * Присутствие принимается всегда — даже когда список отказан за частоту: отметка
 * «ушёл», пришедшая запросом на скрытии страницы, не имеет права пропасть оттого, что за
 * три секунды до неё уехал список. Время присутствия ставит сервер.
 */
export function accept(
  rec: NotifyRecord,
  put: NotifyPut,
  player: string,
  now: number,
  allowsWrite = false,
): { record: NotifyRecord; marks: string[]; fail: AcceptFail | null } {
  const next: NotifyRecord = { ...rec, presence: { ...rec.presence }, sent: pruneSent(rec.sent, now) };
  let fail: AcceptFail | null = null;
  const marks: string[] = [];

  if (put.present === true) next.presence = { away: null, beatAt: now };
  // Уже ушедший остаётся ушедшим с прежней минуты: повторное «ушёл» раньше ухода не сдвигает.
  if (put.present === false) next.presence = { away: rec.presence.away ?? now, beatAt: now };
  if (put.prefs !== undefined) next.prefs = readPrefs(put.prefs);
  // Разрешение писать: из подписанной строки запуска (`allows_write_to_pm`) или со слов клиента сразу после
  // `requestWriteAccess`. Закрытый отказом Telegram канал этим открывается снова — проверит его следующая отправка.
  if (allowsWrite || put.canWrite === true) next.chan = { state: 'open', at: now };

  if (put.items !== undefined) {
    const computedAt = typeof put.computedAt === 'number' && Number.isFinite(put.computedAt) ? put.computedAt : null;
    const items = readNotices(put.items, now);
    if (now - rec.putAt < NOTICE_LIMITS.putEvery) fail = { status: 429, error: 'slow-down' };
    // Список, составленный по несверенным часам, промахнулся бы на всю разницу.
    else if (computedAt === null || Math.abs(computedAt - now) > NOTICE_LIMITS.skew) fail = { status: 400, error: 'clock' };
    else if (!items) fail = { status: 400, error: 'bad-body' };
    else {
      next.gen = rec.gen + 1;
      next.items = items;
      next.computedAt = computedAt;
      next.putAt = now;
      for (const item of items) marks.push(markOf(item, player));
    }
  }
  return { record: next, marks: [...new Set(marks)], fail };
}

const pruneSent = (sent: Record<string, number>, now: number): Record<string, number> =>
  Object.fromEntries(Object.entries(sent).filter(([, at]) => now - at < SENT_KEEP));

/** Состояние наружу: без пунктов и без журнала отправленного. */
export const stateOf = (rec: NotifyRecord, now: number): NotifyState => ({
  now,
  gen: rec.gen,
  items: rec.items.length,
  away: rec.presence.away,
  prefs: rec.prefs,
  chan: rec.chan.state,
});

/**
 * Поручения сервера: добавить новости войны (`add`) и снять отменённые (`drop` — отозванный поход). Ключ — имя
 * момента: пришедшая второй раз новость не задваивается, а ушедшая не уйдёт снова (`sent`). Просроченные
 * снимаются; лишние сверх потолка — самые старые. Возвращает метки индекса, которые надо положить.
 */
export function news(rec: NotifyRecord, add: NoticeItem[], drop: string[], player: string, now: number): { record: NotifyRecord; marks: string[] } {
  const gone = new Set(drop);
  const fresh = add.filter((i) => i.until > now && rec.sent[i.key] === undefined);
  const keys = new Set(fresh.map((i) => i.key));
  const srv = [...rec.srv.filter((i) => !gone.has(i.key) && !keys.has(i.key) && i.until > now), ...fresh]
    .sort((a, b) => a.fireAt - b.fireAt)
    .slice(-NOTICE_LIMITS.items);
  const marks = [...new Set(fresh.filter((i) => srv.includes(i)).map((i) => markOf(i, player)))];
  return { record: { ...rec, srv }, marks };
}

/** Telegram отказал: писать нельзя, пока игрок не разрешит снова (строка запуска, `requestWriteAccess`, «Старт» боту). */
export const closeChannel = (rec: NotifyRecord, now: number): NotifyRecord => ({ ...rec, chan: { state: 'closed', at: now } });

/** Игрок нажал кнопку под сообщением или переключил в игре. Нажатие кнопки — тоже «бот может писать». */
export const switchTo = (rec: NotifyRecord, on: boolean, now: number): NotifyRecord => ({
  ...rec,
  prefs: { ...rec.prefs, on },
  chan: { state: 'open', at: now },
});

/** Дата и минута суток в поясе игрока. Неизвестный пояс — UTC. */
export function localTime(now: number, tz: string): { date: string; minute: number } {
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return localTime(now, 'UTC');
  }
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

/**
 * Почему пункт не уходит — или что он уходит. Порядок проверок и есть порядок причин в
 * счётчиках: пункт, которому рано, не считается «игрок здесь».
 */
export type Verdict =
  | 'send'
  /** Ещё рано. */
  | 'early'
  /** «Годно до» прошло: ответить уже нечем. */
  | 'expired'
  /** Уже ушло. */
  | 'sent'
  /** Игрок выключил уведомления. */
  | 'off'
  /** Telegram отказал: писать нельзя. */
  | 'closed'
  /** Игрок здесь. */
  | 'present'
  /** Игрок ушёл позже, чем это стало новостью: он это видел. */
  | 'seen'
  /** Суточный потолок. */
  | 'cap'
  /** Одно в чат за проход и не чаще `PACE`: уйдёт следующим проходом, если годно. */
  | 'pace';

/** С какой минуты игрока нет. null — он здесь. */
export function awaySince(rec: NotifyRecord, now: number): number | null {
  if (rec.presence.away !== null) return rec.presence.away;
  // Окно убили без события скрытия: отметки нет дольше срока — ушёл в минуту последней.
  return now - rec.presence.beatAt > PRESENCE_STALE ? rec.presence.beatAt : null;
}

function verdictOf(rec: NotifyRecord, item: NoticeItem, now: number): Verdict {
  if (now < item.fireAt) return 'early';
  if (now >= item.until) return 'expired';
  if (rec.sent[item.key] !== undefined) return 'sent';
  if (!rec.prefs.on) return 'off';
  if (rec.chan.state === 'closed') return 'closed';
  const away = awaySince(rec, now);
  if (away === null) return 'present';
  if (item.fireAt < away + SEEN_GRACE) return 'seen';
  const today = localTime(now, rec.prefs.tz).date;
  if (rec.day.date === today && rec.day.n >= DAY_CAP) return 'cap';
  if (now - rec.lastAt < PACE) return 'pace';
  return 'send';
}

export interface Choice {
  /** Что уходит в этот проход. Не больше одного. */
  pick: NoticeItem | null;
  verdicts: { item: NoticeItem; verdict: Verdict }[];
}

/**
 * Что отправить в этот проход. Правила — docs/NOTIFY.md, раздел 4: пункт из последнего
 * списка клиента или из поручений сервера, `fireAt ≤ now < until`, игрок отсутствует и ушёл до
 * новости, ключа нет в отправленном, рычаг включён, канал не закрыт, потолки. Созрели два — уходит
 * раньше созревший, второй ждёт прохода. Тихих часов нет (решение владельца): о нападении и о бое —
 * в любое время суток.
 */
export function choose(rec: NotifyRecord, now: number): Choice {
  const verdicts = [...rec.items, ...rec.srv]
    .sort((a, b) => a.fireAt - b.fireAt)
    .map((item) => ({ item, verdict: verdictOf(rec, item, now) }));
  let pick: NoticeItem | null = null;
  for (const v of verdicts) {
    if (v.verdict !== 'send') continue;
    if (pick) v.verdict = 'pace';
    else pick = v.item;
  }
  return { pick, verdicts };
}

/** Запись с отметкой «ушло». Пишется условно и **до** отправки. */
export function markSent(rec: NotifyRecord, item: NoticeItem, now: number): NotifyRecord {
  const today = localTime(now, rec.prefs.tz).date;
  return {
    ...rec,
    sent: { ...pruneSent(rec.sent, now), [item.key]: now },
    day: { date: today, n: rec.day.date === today ? rec.day.n + 1 : 1 },
    lastAt: now,
  };
}

/** Разбирать ли метку дальше: всё, что лежит в её минуте, решено окончательно. */
export function markDone(choice: Choice, minute: string, raced: boolean): boolean {
  if (raced) return false;
  return !choice.verdicts.some(
    (v) => minuteOf(v.item.fireAt) === minute && (v.verdict === 'early' || v.verdict === 'pace'),
  );
}
