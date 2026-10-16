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
 *
 * **ВС-1 (16.10.2026, docs/NOTIFY.md, раздел 13): без спама.** Весть идёт не одна, а письмом: у каждой вести есть род
 * (бои, осады, стройка, указы, соседи — `topicOf`) и важность (`tierOf`). Срочное уходит сразу, обычное — склейкой за
 * окно `GLUE_MS` одним письмом со сводкой, а свежее письмо того же рода правится, а не повторяется (`FRESH_MS`).
 * Мелочь остаётся в игре. Тихий час — в поясе игрока: срочное без звука, обычное — утренней сводкой. Письмо, которое
 * проход взял, лежит в записи (`out`) с арендой (`LEASE_MS`): упавший проход не теряет его — следующий отправит снова.
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

// ------------------------------------------------ роды и важность (ВС-1) ---

/**
 * Роды вестей — те, что владелец назвал для настроек бота (16.10.2026): бои, осады, стройка, указы, соседи. Род
 * выводится из вида и фактов (`topicOf`), а не пишется в пункт: правило одно, и второго мнения о роде быть не может.
 */
export const TOPICS = ['fights', 'sieges', 'build', 'grants', 'neighbors'] as const;
export type Topic = (typeof TOPICS)[number];

/** Важность: срочное — сразу; обычное — склейкой; мелочь — только в игре. */
export type Tier = 'urgent' | 'normal' | 'minor';

/** Род вести. Поход соседа лагерем — уже осада; штурмом — бой. */
export function topicOf(item: NoticeItem): Topic {
  switch (item.kind) {
    case 'raid':
    case 'raid-fight':
    case 'war-fight':
      return 'fights';
    case 'war':
      return item.p.mode === 'siege' ? 'sieges' : 'fights';
    case 'siege-fall':
    case 'siege-phase':
    case 'war-fall':
    case 'war-phase':
    case 'war-parley':
    case 'war-relief':
      return 'sieges';
    case 'war-pact':
    case 'war-spy':
      return 'neighbors';
    case 'build':
      return 'build';
    case 'grant':
      return 'grants';
  }
}

/**
 * Важность вести. Срочное по слову владельца — набег, осада, сдача, предложение пакта или условий: на город идут
 * (`raid`, `war`), город пал или открыл ворота (`siege-fall`, `war-fall` и штурм, взявший город, — у того, чей город),
 * пролом в своей стене (на следующей фазе город может сдаться — пора дать наказ чинить), предложение сдачи или дани
 * (`war-parley` без ответа) и пакта. Мелочь — фаза осады, в которой сработал только наказ (залп, паёк, починка): её
 * видно в окне осады, и звать ради неё из чата незачем. Остальное — обычное.
 */
export function tierOf(item: NoticeItem): Tier {
  const p = item.p;
  switch (item.kind) {
    case 'raid':
    case 'war':
    case 'siege-fall':
      return 'urgent';
    case 'war-fall':
      return p.role === 'atk' ? 'normal' : 'urgent';
    case 'war-fight':
      return p.taken && p.role === 'def' ? 'urgent' : 'normal';
    case 'siege-phase':
    case 'war-phase':
      if (p.phase === 'breach') return p.role === 'atk' ? 'normal' : 'urgent';
      return p.phase === 'plague' ? 'normal' : 'minor';
    case 'war-parley':
      return p.answer ? 'normal' : 'urgent';
    case 'war-pact':
      return p.pact === 'offer' ? 'urgent' : 'normal';
    default:
      return 'normal';
  }
}

/**
 * Настройки бота (`/notify`): правятся только кнопками в боте и лежат рядом с настройками игры, а не в них — игра
 * присылает свои (`NotifyPrefs`) целиком и затёрла бы их.
 */
export interface BotPrefs {
  /** Роды, о которых бот молчит. */
  mute: Topic[];
  /** Только срочное: обычное не уходит вовсе. */
  urgent: boolean;
  /** Тихий час: минуты суток в поясе игрока, с какой и до какой (через полночь — `from > to`); `null` — без тихого часа. */
  quiet: { from: number; to: number } | null;
}

/** Тихий час по слову владельца — 23:00–08:00 по времени игрока. */
export const DEFAULT_QUIET = { from: 23 * 60, to: 8 * 60 } as const;

/** Что предлагает кнопка тихого часа — по кругу. Первый — умолчание. */
export const QUIET_CHOICES: readonly ({ from: number; to: number } | null)[] = [
  DEFAULT_QUIET,
  { from: 22 * 60, to: 7 * 60 },
  { from: 0, to: 9 * 60 },
  null,
];

export const defaultBot = (): BotPrefs => ({ mute: [], urgent: false, quiet: { ...DEFAULT_QUIET } });

/**
 * Пояс, если игра его не прислала (Telegram пояса не даёт, а игра шлёт пояс устройства): «иначе Европа» по слову
 * владельца — Москва, как у времени админа (docs/admin.md: владелец и игроки теста живут в ней).
 */
export const DEFAULT_TZ = 'Europe/Moscow';
export const zoneOf = (tz: string): string => tz || DEFAULT_TZ;

const minuteOfDay = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 24 * 60 ? v : null;

/** Разбор настроек бота: кривое и неизвестное — умолчание. */
export function readBotPrefs(v: unknown): BotPrefs {
  if (!v || typeof v !== 'object') return defaultBot();
  const r = v as Record<string, unknown>;
  const mute = Array.isArray(r.mute) ? TOPICS.filter((t) => (r.mute as unknown[]).includes(t)) : [];
  let quiet: BotPrefs['quiet'] = { ...DEFAULT_QUIET };
  if (r.quiet === null) quiet = null;
  else if (r.quiet && typeof r.quiet === 'object') {
    const q = r.quiet as Record<string, unknown>;
    const from = minuteOfDay(q.from);
    const to = minuteOfDay(q.to);
    if (from !== null && to !== null && from !== to) quiet = { from, to };
  }
  return { mute, urgent: r.urgent === true, quiet };
}

// ------------------------------------------------ запись ---

/** Нить рода: последнее письмо этого рода, которое ещё можно править. Пункты — последние `LETTER_LINES`, всего — `n`. */
export interface Thread {
  msg: number;
  /** Когда письмо ушло. От этой минуты считается свежесть (`FRESH_MS`): правки её не продлевают. */
  at: number;
  n: number;
  items: NoticeItem[];
}

/** О чём письмо: один род, сводка нескольких (`mix`) или утренняя сводка за тихий час (`night`). */
export type Head = Topic | 'mix' | 'night';
const HEADS: readonly Head[] = [...TOPICS, 'mix', 'night'];

/**
 * Письмо в очереди отправки. Лежит в записи от минуты, когда проход его взял, до ответа Telegram: упадёт процесс
 * между ними — аренда (`lease`) кончится, и письмо отправит следующий проход. Слова собираются в минуту отправки из
 * пунктов — повтор даёт те же слова.
 */
export interface Letter {
  id: string;
  /** Новое сообщение или правка прежнего письма рода (`msg`). */
  mode: 'new' | 'edit';
  head: Head;
  urgent: boolean;
  /** Без звука: срочное в тихий час. */
  silent: boolean;
  /** Пункты для слов, последние `LETTER_LINES`: у правки — вся нить с новыми. */
  items: NoticeItem[];
  /** Сколько пунктов всего (у правки — вся нить). */
  n: number;
  /** Ключи, которые письмо закрывает. Отмечены «ушло» в минуту, когда проход взял письмо. */
  keys: string[];
  msg?: number;
  /** До какой минуты письмо держит взявший проход; 0 — свободно. */
  lease: number;
  tries: number;
  /** Не раньше этой минуты: Telegram просил подождать (`retry_after`). */
  next: number;
}

/**
 * Запись исходящих одного игрока. Одна на игрока, переписывается целиком.
 *
 * Версия 2 (05.10.2026): поручения сервера (`srv`) — новости войны между игроками, которые составляет он сам, —
 * отдельно от списка клиента: список клиента заменяется целиком при каждом приёме, и война в нём пропала бы.
 * Канал (`chan`) — может ли бот писать. Запись версии 1 читается: присутствие, список и отправленное остаются,
 * прежние настройки — умолчанием.
 *
 * ВС-1 (16.10.2026) — поля с умолчанием, версия та же: настройки бота (`bot`), нити родов (`threads`) и очередь
 * писем (`out`). Запись без них читается умолчанием: всё включено, тихий час 23–08, нитей и писем нет.
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
  /** Список клиента: мир на клиенте (набег логова, осада логова) и стройка. */
  items: NoticeItem[];
  /** Поручения сервера: война между игроками (`war.newsOf`) и указы админа. */
  srv: NoticeItem[];
  /** Что уже ушло или взято в письмо: ключ пункта → минута отметки. Живёт `SENT_KEEP`. */
  sent: Record<string, number>;
  /** Сколько новых сообщений ушло в эти сутки игрока (правки не в счёт). */
  day: { date: string; n: number };
  /** Когда ушло последнее новое сообщение. */
  lastAt: number;
  prefs: NotifyPrefs;
  bot: BotPrefs;
  /** Последнее письмо каждого рода — его правит следующая весть того же рода, пока оно свежее. */
  threads: Partial<Record<Topic, Thread>>;
  /** Очередь отправки: письма, взятые проходом и ещё не подтверждённые Telegram. */
  out: Letter[];
  /** Может ли бот писать: `closed` — Telegram отказал (не разрешено или бот заблокирован). */
  chan: { state: NotifyChannel; at: number };
}

/** Отметка присутствия старше этого — окно убили без события скрытия: игрока нет. */
export const PRESENCE_STALE = 3 * 60_000;
/** Кто ушёл позже, чем за это время до новости, её уже видел. */
export const SEEN_GRACE = 2 * 60_000;
/** Сколько помнится отправленное: дольше любого окна осады. */
export const SENT_KEEP = 48 * 60 * 60_000;
/** Новое обычное письмо в чат не чаще этого. Срочное и правка — без паузы. */
export const PACE = 60_000;
/** Окно склейки: обычные вести, созревшие за это время, идут одним письмом (ВС-1: «окно в несколько минут»). */
export const GLUE_MS = 5 * 60_000;
/** Письмо рода свежее столько от минуты отправки — следующая весть того же рода правит его, а не шлёт новое. */
export const FRESH_MS = 30 * 60_000;
/** Сколько пунктов называет письмо поимённо; остальные — числом («…и раньше ещё 3»). */
export const LETTER_LINES = 6;
/**
 * Не больше стольких новых обычных писем в сутки игрока. Потолок — защита от потока, а не настройка: со склейкой до
 * него доходит только бесконечная война.
 */
export const DAY_CAP = 12;
/** Срочное потолку `DAY_CAP` не подчиняется — только этому, защите от сломанного источника. */
export const URGENT_CAP = 2 * DAY_CAP;
/** Срочных писем одному игроку за проход — остальные следующим. */
export const URGENT_PER_PASS = 3;
/** Сколько проход держит взятое письмо. Дольше любого прохода (`deliver.PASS_BUDGET_MS`). */
export const LEASE_MS = 2 * 60_000;
/** Сколько раз письмо пробует уйти, прежде чем считается потерянным. */
export const LETTER_TRIES = 5;
/** Сколько ждать, если Telegram просил подождать, не сказав сколько. */
export const RETRY_MS = 60_000;
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
  bot: defaultBot(),
  threads: {},
  out: [],
  chan: { state: 'unknown', at: 0 },
});

const n = (v: unknown, dflt = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);
const count = (v: unknown): number => Math.max(0, Math.floor(n(v)));
const msgId = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);
/** Пункты своей записи: все виды, без потолка по времени. Испорченный список — пустой. */
const ownItems = (v: unknown): NoticeItem[] => readNotices(v ?? [], Number.POSITIVE_INFINITY, NOTICE_KINDS) ?? [];

function readThreads(v: unknown): Partial<Record<Topic, Thread>> {
  const out: Partial<Record<Topic, Thread>> = {};
  if (!v || typeof v !== 'object') return out;
  for (const t of TOPICS) {
    const r = (v as Record<string, unknown>)[t] as Record<string, unknown> | undefined;
    const msg = msgId(r?.msg);
    if (!r || msg === null) continue;
    const items = ownItems(r.items);
    if (!items.length) continue;
    out[t] = { msg, at: n(r.at), n: Math.max(items.length, count(r.n)), items };
  }
  return out;
}

/** Писем в очереди одного игрока — больше не бывает: за проход их берётся не больше `URGENT_PER_PASS` + 1. */
const OUT_MAX = 16;

function readLetters(v: unknown): Letter[] {
  if (!Array.isArray(v)) return [];
  const out: Letter[] = [];
  for (const raw of v.slice(0, OUT_MAX)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const head = HEADS.find((h) => h === r.head);
    const items = ownItems(r.items);
    const msg = msgId(r.msg);
    if (typeof r.id !== 'string' || !head || !items.length) continue;
    const keys = Array.isArray(r.keys) ? r.keys.filter((k): k is string => typeof k === 'string' && k.length <= NOTICE_LIMITS.key).slice(0, 32) : [];
    const letter: Letter = {
      id: r.id.slice(0, 40),
      mode: r.mode === 'edit' && msg !== null ? 'edit' : 'new',
      head,
      urgent: r.urgent === true,
      silent: r.silent === true,
      items,
      n: Math.max(items.length, count(r.n)),
      keys,
      lease: n(r.lease),
      tries: count(r.tries),
      next: n(r.next),
    };
    if (letter.mode === 'edit' && msg !== null) letter.msg = msg;
    out.push(letter);
  }
  return out;
}

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
  const v2 = r.v === 2;
  return {
    v: 2,
    gen: count(r.gen),
    computedAt: n(r.computedAt),
    putAt: n(r.putAt),
    presence: {
      away: typeof presence.away === 'number' && Number.isFinite(presence.away) ? presence.away : null,
      beatAt: n(presence.beatAt),
    },
    // Своя запись читается без потолка по времени: срок пункта проверили при приёме. Список прежних видов
    // (осада по рогаткам и хлебу, версия 1) не разбирается — и читается пустым: клиент пришлёт новый.
    items: readNotices(r.items ?? [], Number.POSITIVE_INFINITY) ?? [],
    srv: v2 ? ownItems(r.srv) : [],
    sent,
    day: { date: typeof day.date === 'string' ? day.date.slice(0, 10) : '', n: count(day.n) },
    lastAt: n(r.lastAt),
    prefs: v2 ? readPrefs(r.prefs) : { ...DEFAULT_PREFS, tz: readPrefs(r.prefs).tz },
    bot: v2 ? readBotPrefs(r.bot) : defaultBot(),
    threads: v2 ? readThreads(r.threads) : {},
    out: v2 ? readLetters(r.out) : [],
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
  // Игра правит только свои настройки — рычаг и пояс; настройки бота (`bot`) она не знает и не трогает.
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
 * Поручения сервера: добавить новости войны и указы (`add`) и снять отменённые (`drop` — отозванный поход). Ключ — имя
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

/** Игрок переключил рычаг кнопкой в боте или в игре. Нажатие кнопки — тоже «бот может писать». */
export const switchTo = (rec: NotifyRecord, on: boolean, now: number): NotifyRecord => ({
  ...rec,
  prefs: { ...rec.prefs, on },
  chan: { state: 'open', at: now },
});

/** Кнопка настроек в боте (`/notify`): что она меняет. */
export type BotSwitch = { topic: Topic } | { quiet: true } | { urgent: true } | { on: boolean };

/** Нажатая кнопка настроек — новая запись. Нажатие — тоже «бот может писать». */
export function applySwitch(rec: NotifyRecord, sw: BotSwitch, now: number): NotifyRecord {
  if ('on' in sw) return switchTo(rec, sw.on, now);
  const bot: BotPrefs = { ...rec.bot, mute: [...rec.bot.mute] };
  if ('topic' in sw) {
    const off = bot.mute.includes(sw.topic);
    bot.mute = TOPICS.filter((t) => (t === sw.topic ? !off : bot.mute.includes(t)));
  }
  if ('urgent' in sw) bot.urgent = !bot.urgent;
  if ('quiet' in sw) {
    const q = bot.quiet;
    const at = QUIET_CHOICES.findIndex((c) => (c === null ? q === null : q !== null && c.from === q.from && c.to === q.to));
    const pick = QUIET_CHOICES[(at + 1) % QUIET_CHOICES.length];
    bot.quiet = pick === null ? null : { ...pick };
  }
  return { ...rec, bot, chan: { state: 'open', at: now } };
}

/** Дата и минута суток в поясе игрока. Неизвестный пояс — пояс по умолчанию. */
export function localTime(now: number, tz: string): { date: string; minute: number } {
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: zoneOf(tz),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return tz === DEFAULT_TZ ? { date: new Date(now).toISOString().slice(0, 10), minute: Math.floor((now % 86_400_000) / 60_000) } : localTime(now, DEFAULT_TZ);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

/** Внутри ли тихого часа минута `at` в поясе `tz`. */
export function inQuiet(at: number, tz: string, quiet: BotPrefs['quiet']): boolean {
  if (!quiet) return false;
  const m = localTime(at, tz).minute;
  return quiet.from < quiet.to ? m >= quiet.from && m < quiet.to : m >= quiet.from || m < quiet.to;
}

/** Минута, когда кончится тихий час, идущий в `now`. Не в тихом часу — `now`. */
export function quietEnd(now: number, tz: string, quiet: BotPrefs['quiet']): number {
  if (!quiet || !inQuiet(now, tz, quiet)) return now;
  const m = localTime(now, tz).minute;
  return now - (now % 60_000) + ((quiet.to - m + 24 * 60) % (24 * 60)) * 60_000;
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
  /** Уже ушло или лежит в очереди письмом. */
  | 'sent'
  /** Игрок выключил уведомления. */
  | 'off'
  /** Telegram отказал: писать нельзя. */
  | 'closed'
  /** Мелочь: только в игре. */
  | 'minor'
  /** Род выключен в настройках бота. */
  | 'muted'
  /** «Только срочное», а весть обычная. */
  | 'filtered'
  /** Игрок здесь. */
  | 'present'
  /** Игрок ушёл позже, чем это стало новостью: он это видел. */
  | 'seen'
  /** Суточный потолок. */
  | 'cap'
  /** Тихий час: обычное ждёт утра. */
  | 'quiet'
  /** Окно склейки ещё открыто: ждёт соседей. */
  | 'glue'
  /** Темп: новое письмо не чаще `PACE`, срочных — не больше `URGENT_PER_PASS` за проход. */
  | 'pace';

/** С какой минуты игрока нет. null — он здесь. */
export function awaySince(rec: NotifyRecord, now: number): number | null {
  if (rec.presence.away !== null) return rec.presence.away;
  // Окно убили без события скрытия: отметки нет дольше срока — ушёл в минуту последней.
  return now - rec.presence.beatAt > PRESENCE_STALE ? rec.presence.beatAt : null;
}

function verdictOf(rec: NotifyRecord, item: NoticeItem, now: number, inOut: Set<string>, today: string): Verdict {
  if (now < item.fireAt) return 'early';
  if (now >= item.until) return 'expired';
  if (rec.sent[item.key] !== undefined || inOut.has(item.key)) return 'sent';
  if (!rec.prefs.on) return 'off';
  if (rec.chan.state === 'closed') return 'closed';
  const tier = tierOf(item);
  if (tier === 'minor') return 'minor';
  if (rec.bot.mute.includes(topicOf(item))) return 'muted';
  if (tier === 'normal' && rec.bot.urgent) return 'filtered';
  const away = awaySince(rec, now);
  if (away === null) return 'present';
  if (item.fireAt < away + SEEN_GRACE) return 'seen';
  const sentToday = rec.day.date === today ? rec.day.n : 0;
  if (sentToday >= (tier === 'urgent' ? URGENT_CAP : DAY_CAP)) return 'cap';
  if (tier === 'urgent') return 'send';
  if (inQuiet(now, rec.prefs.tz, rec.bot.quiet)) return 'quiet';
  return 'glue';
}

/** Что решил проход об одном игроке. */
export interface Plan {
  /** Новые письма: срочные по одному, обычные — одним письмом. */
  letters: Letter[];
  verdicts: { item: NoticeItem; verdict: Verdict }[];
  /** Когда снова посмотреть на игрока: окно склейки, конец тихого часа, темп, потолок. `null` — незачем. */
  wake: number | null;
}

/** Нить рода, которую ещё можно править. */
export const freshThread = (rec: NotifyRecord, topic: Topic, now: number): Thread | null => {
  const t = rec.threads[topic];
  return t && now - t.at < FRESH_MS ? t : null;
};

/**
 * Что отправить в этот проход. Правила — docs/NOTIFY.md, разделы 4 и 13: пункт из последнего списка клиента или из
 * поручений сервера, `fireAt ≤ now < until`, игрок отсутствует и ушёл до новости, ключа нет в отправленном и в
 * очереди, рычаг включён, канал не закрыт, род не выключен, потолки.
 *
 * - **Срочное — сразу**, своим письмом, в тихий час — без звука. Ни склейка, ни тихий час, ни темп его не держат.
 * - **Обычное — склейкой:** ждёт, пока от самой ранней из ждущих вестей пройдёт `GLUE_MS`, и уходит одним письмом
 *   — со всеми ждущими любого рода. Все одного рода и письмо этого рода свежее — правка его, а не новое сообщение.
 * - **Тихий час:** обычное ждёт его конца и уходит утренней сводкой (`night`) — одним письмом.
 */
export function plan(rec: NotifyRecord, now: number, id = String(now)): Plan {
  const inOut = new Set(rec.out.flatMap((l) => l.keys));
  const today = localTime(now, rec.prefs.tz).date;
  const verdicts = [...rec.items, ...rec.srv]
    .sort((a, b) => a.fireAt - b.fireAt)
    .map((item) => ({ item, verdict: verdictOf(rec, item, now, inOut, today) }));
  const letters: Letter[] = [];
  const wakes: number[] = [];
  const hush = inQuiet(now, rec.prefs.tz, rec.bot.quiet);
  const letter = (over: Pick<Letter, 'mode' | 'head' | 'urgent' | 'items' | 'n' | 'keys'> & { msg?: number }): Letter => ({
    id: `${id}-${letters.length}`,
    silent: over.urgent && hush,
    lease: 0,
    tries: 0,
    next: 0,
    ...over,
    items: over.items.slice(-LETTER_LINES),
  });

  // Срочное: по письму на весть, не больше `URGENT_PER_PASS` за проход.
  for (const v of verdicts) {
    if (v.verdict !== 'send') continue;
    if (letters.length >= URGENT_PER_PASS) {
      v.verdict = 'pace';
      wakes.push(now + 60_000);
      continue;
    }
    letters.push(letter({ mode: 'new', head: topicOf(v.item), urgent: true, items: [v.item], n: 1, keys: [v.item.key] }));
  }

  // Обычное: всё, что ждёт склейки, одним письмом, когда окно самой ранней закрылось.
  const glued = verdicts.filter((v) => v.verdict === 'glue');
  if (glued.length) {
    const first = Math.min(...glued.map((v) => v.item.fireAt));
    const items = glued.map((v) => v.item);
    const topics = [...new Set(items.map(topicOf))];
    const night = items.some((i) => inQuiet(i.fireAt, rec.prefs.tz, rec.bot.quiet));
    const thread = topics.length === 1 && !night ? freshThread(rec, topics[0], now) : null;
    const keys = items.map((i) => i.key);
    if (now < first + GLUE_MS) wakes.push(first + GLUE_MS);
    else if (thread) {
      for (const v of glued) v.verdict = 'send';
      letters.push(letter({ mode: 'edit', head: topics[0], urgent: false, items: [...thread.items, ...items], n: thread.n + items.length, keys, msg: thread.msg }));
    } else if (now - rec.lastAt < PACE) {
      for (const v of glued) v.verdict = 'pace';
      wakes.push(rec.lastAt + PACE);
    } else {
      for (const v of glued) v.verdict = 'send';
      const head: Head = night ? 'night' : topics.length === 1 ? topics[0] : 'mix';
      letters.push(letter({ mode: 'new', head, urgent: false, items, n: items.length, keys }));
    }
  }
  if (verdicts.some((v) => v.verdict === 'quiet')) wakes.push(quietEnd(now, rec.prefs.tz, rec.bot.quiet));
  // Потолок снимается в полночь игрока; смотреть раз в час — проще, чем считать полночь в чужом поясе.
  if (verdicts.some((v) => v.verdict === 'cap' && v.item.until > now + 60 * 60_000)) wakes.push(now + 60 * 60_000);
  return { letters, verdicts, wake: wakes.length ? Math.min(...wakes) : null };
}

/**
 * Взять письма: положить в очередь с арендой и отметить их ключи «ушло». Пишется условно и **до** отправки: два
 * наложившихся прохода не отправят дважды — второй проиграет запись. Письма прежних проходов, чья аренда кончилась
 * (процесс упал, не дождавшись ответа) и чей срок повтора настал, берутся снова.
 */
export function claim(rec: NotifyRecord, letters: Letter[], now: number): { record: NotifyRecord; taken: Letter[] } {
  const lease = now + LEASE_MS;
  const taken: Letter[] = [];
  const out = rec.out.map((l) => {
    if (l.lease > now || l.next > now) return l;
    const t = { ...l, lease };
    taken.push(t);
    return t;
  });
  for (const l of letters) {
    const t = { ...l, lease };
    taken.push(t);
    out.push(t);
  }
  const sent = pruneSent(rec.sent, now);
  for (const l of letters) for (const k of l.keys) sent[k] = now;
  // Срочное — первым: оно не ждёт, пока уйдёт сводка.
  taken.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  return { record: { ...rec, sent, out }, taken };
}

/** Чем кончилась отправка письма. `msg` — номер нового сообщения; `after` — сколько ждать, если просили подождать. */
export type Outcome =
  | { id: string; result: 'ok'; msg?: number }
  | { id: string; result: 'closed' }
  | { id: string; result: 'retry'; after?: number }
  | { id: string; result: 'lost' }
  /** Правка не вышла: письма нет или его нельзя править — уйдёт новым сообщением. */
  | { id: string; result: 'gone' }
  /** Не пробовали: проход остановился (Telegram просил подождать всех). Аренда снимается, попытка не в счёт. */
  | { id: string; result: 'later' };

/**
 * Что выбыло из очереди само: потеряно после `LETTER_TRIES` попыток или устарело, не уйдя (`lost`), и отменено — игрок
 * выключил вести или Telegram закрыл канал, пока письмо ждало повтора. Взятое проходом не трогается.
 */
export function expire(rec: NotifyRecord, now: number): { record: NotifyRecord; lost: number } {
  const free = rec.out.filter((l) => l.lease <= now);
  if (free.length === 0) return { record: rec, lost: 0 };
  const shut = !rec.prefs.on || rec.chan.state === 'closed';
  const stale = (l: Letter): boolean => l.tries >= LETTER_TRIES || l.items.every((i) => i.until <= now);
  const gone = free.filter((l) => shut || stale(l));
  if (gone.length === 0) return { record: rec, lost: 0 };
  const out = rec.out.filter((l) => !gone.includes(l));
  // Отменённое не ушло: его вести снова ждут — уйдут, когда вести включат или канал откроется, если ещё годны.
  return shut ? { record: { ...rec, out, sent: unmark(rec.sent, gone) }, lost: 0 } : { record: { ...rec, out }, lost: gone.length };
}

/** Снять отметку «ушло» с вестей писем, которые так и не ушли. */
const unmark = (sent: Record<string, number>, letters: Letter[]): Record<string, number> => {
  const keys = new Set(letters.flatMap((l) => l.keys));
  return Object.fromEntries(Object.entries(sent).filter(([k]) => !keys.has(k)));
};

/**
 * Итоги отправки поверх записи — свежей, перечитанной после отправки: её мог переписать приём клиента или вебхук,
 * поэтому итог — правка по номеру письма, а не запись поверх. Ушло — письмо выбывает из очереди, новое сообщение
 * становится нитью своего рода; правка — продолжает нить.
 */
export function settle(rec: NotifyRecord, outcomes: Outcome[], now: number): NotifyRecord {
  let next: NotifyRecord = { ...rec, out: [...rec.out], threads: { ...rec.threads } };
  const today = localTime(now, rec.prefs.tz).date;
  for (const o of outcomes) {
    const at = next.out.findIndex((l) => l.id === o.id);
    if (at < 0) continue;
    const l = next.out[at];
    if (o.result === 'later') {
      next.out[at] = { ...l, lease: 0 };
      continue;
    }
    if (o.result === 'retry') {
      next.out[at] = { ...l, lease: 0, tries: l.tries + 1, next: now + Math.max(1_000, o.after ?? RETRY_MS) };
      continue;
    }
    if (o.result === 'gone') {
      // Прежнего письма нет: те же вести уходят новым сообщением, а нить рода начинается заново.
      const fresh: Letter = { ...l, mode: 'new', lease: 0, tries: l.tries + 1, next: now };
      delete fresh.msg;
      next.out[at] = fresh;
      if (l.head !== 'mix' && l.head !== 'night') delete next.threads[l.head];
      continue;
    }
    next.out.splice(at, 1);
    // Канал закрыт: остальные письма этому игроку ушли бы в тот же отказ — очередь пуста до нового разрешения, а их
    // вести снова ждут. Весть отказанного письма не повторяется — как и прежде.
    if (o.result === 'closed') next = { ...closeChannel(next, now), out: [], sent: unmark(next.sent, next.out) };
    if (o.result !== 'ok') continue;
    if (l.mode === 'new') {
      next.day = { date: today, n: next.day.date === today ? next.day.n + 1 : 1 };
      next.lastAt = now;
    }
    if (l.head === 'mix' || l.head === 'night') continue;
    if (l.mode === 'edit') {
      const t = next.threads[l.head];
      if (t) next.threads[l.head] = { ...t, n: l.n, items: l.items };
    } else if (o.msg !== undefined) next.threads[l.head] = { msg: o.msg, at: now, n: l.n, items: l.items };
  }
  return next;
}

/** Когда снова посмотреть на очередь: аренда или срок повтора ближайшего письма. */
export function outWake(rec: NotifyRecord, now: number): number | null {
  const at = rec.out.map((l) => Math.max(l.lease, l.next, now));
  return at.length ? Math.min(...at) : null;
}
