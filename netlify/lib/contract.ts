/**
 * Договор между игрой и сервером хранения. Один файл на обе стороны нарочно:
 * разъехавшиеся типы клиента и сервера — это отказ, который виден не при сборке,
 * а на телефоне игрока и только в проде.
 *
 * Модуль чистый: ни узла, ни браузера, ни импортов — его читают и `vite`, и
 * сборщик функций.
 *
 * Главное свойство записи: **сервер не понимает, что в ней лежит**. Сохранение
 * племени и сохранение мира — непрозрачные строки, сервер их не разбирает, не
 * проверяет и не судит. Он хранит и раздаёт, а не решает. Отсюда и опись
 * (`SaveCard`): чтобы показать игроку, какие две партии разошлись, кто-то должен
 * знать про день и население — и знает это клиент, который опись и складывает.
 */

/** Краткая опись партии — на случай, когда игрок выбирает между двумя. */
export interface SaveCard {
  /** Имя вождя. */
  name: string;
  /** Игровой день. */
  day: number;
  /** Население: жители, бойцы и новобранцы. */
  pop: number;
  /** Мощь: посёлок плюс дружина. */
  power: number;
  /** Бойцов в дружине. */
  army: number;
}

/** Запись игрока в хранилище. Одна на игрока, переписывается целиком. */
export interface SaveRecord {
  v: 1;
  /** Номер записи: растёт на единицу за каждую. Нужен показу, не логике. */
  rev: number;
  /** Когда записали, по серверным часам. */
  updatedAt: number;
  /** Кто записал: короткий постоянный признак устройства. */
  device: string;
  /** Сохранение племени — та же строка, что лежит в localStorage. */
  game: string;
  /** Сохранение мира. Его может не быть: карту игрок мог ни разу не открыть. */
  world: string | null;
  card: SaveCard;
}

/** Ответ на чтение. `etag` — то, чем потом доказывают, что писали поверх этого. */
export interface PullResponse {
  /** Серверные часы. Приезжают с каждым ответом — отдельного запроса за ними не надо. */
  now: number;
  etag: string | null;
  record: SaveRecord | null;
}

export interface PushBody {
  /** Поверх какой записи пишем. `null` — записи не было вовсе. */
  baseEtag: string | null;
  record: SaveRecord;
}

export interface PushResponse {
  now: number;
  etag: string;
  rev: number;
}

/** Ответ 409: пока мы играли, поверх нашей записи легла чужая. */
export interface ConflictResponse {
  error: 'conflict';
  now: number;
  etag: string | null;
  record: SaveRecord | null;
}

const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length <= max ? v : null;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Разбор записи, пришедшей от клиента. Сервер не верит телу запроса ни в одном
 * поле: лишнее выбрасывается, недостающее — отказ. Возвращается новый объект, а
 * не приведённый тип, — иначе в хранилище уехало бы всё, что прислали.
 */
export function readRecord(v: unknown, limits: { game: number; world: number }): SaveRecord | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const game = str(r.game, limits.game);
  if (game === null || game.length === 0) return null;
  let world: string | null = null;
  if (r.world !== null && r.world !== undefined) {
    // Мир либо строка в пределах потолка, либо отказ. Обрезать или подменять
    // на `null` нельзя: игрок получил бы обратно партию без карты и не узнал бы
    // почему.
    world = str(r.world, limits.world);
    if (world === null) return null;
  }
  const device = str(r.device, 64);
  if (!device) return null;
  const c = (r.card ?? {}) as Record<string, unknown>;
  return {
    v: 1,
    rev: Math.max(0, Math.floor(num(r.rev) ?? 0)),
    // Время ставит сервер, а не клиент: часы телефона тут не при чём, и
    // присланное значение выбрасывается молча.
    updatedAt: 0,
    device,
    game,
    world,
    card: {
      name: str(c.name, 64) ?? '',
      day: Math.max(0, Math.floor(num(c.day) ?? 0)),
      pop: Math.max(0, Math.floor(num(c.pop) ?? 0)),
      power: Math.max(0, Math.floor(num(c.power) ?? 0)),
      army: Math.max(0, Math.floor(num(c.army) ?? 0)),
    },
  };
}

// ---------- Реестр замков ----------
//
// Вторая запись, которую держит сервер, и она устроена **не так**, как первая.
// Сохранение партии — непрозрачная строка: сервер её не читает. Реестр замков
// прочитан насквозь: имя, мощь, население и клетка. Это осознанное сужение
// правила «сервер хранит и не судит». Второе такое сужение — исходящие
// уведомления ниже, и больше их нет: `server.test.ts` держит ровно два.
//
// Судьёй сервер от этого не становится. Он не проверяет ни имени, ни мощи, ни
// населения — что игрок о себе написал, то и раздаётся соседям. Он делает одну
// вещь, которую клиенту доверить нельзя: **выбирает клетку**. Клиент,
// выбирающий себе место, — это клиент, выбирающий себе соседей, и потому
// координат в теле запроса нет вовсе.

/** Замок игрока в общем реестре. */
export interface CastleRow {
  /** Клетка. Её назначает сервер; из тела запроса она не принимается никогда. */
  x: number;
  y: number;
  /** Имя вождя — то же, что стоит в описи партии. */
  name: string;
  /**
   * Имя города, которое назвал владелец, уже очищенное (`cityName`). Поля нет у строки
   * от клиента, который имени города ещё не знал: соседи увидят имя по умолчанию.
   */
  city?: string;
  /** Мощь: посёлок плюс дружина. Ровно то, что о себе написал владелец. */
  power: number;
  /** Население: жители, бойцы и новобранцы. */
  pop: number;
  /** Когда владелец последний раз был в игре, по серверным часам. */
  seenAt: number;
}

/**
 * Реестр целиком. Ключ строки — проверенный подписью идентификатор, и писать
 * можно только свою.
 *
 * `epoch` — отпечаток земли, на которой считались координаты (`ATLAS_HASH`).
 * Без него пересборка атласа оставила бы старые клетки лежать как ни в чём не
 * бывало, а замок, стоявший на 541|822, оказался бы посреди залива — та же беда,
 * ради которой у сохранения мира нижняя граница версии равна верхней.
 */
export interface RosterFile {
  v: 1;
  epoch: number;
  rows: Record<string, CastleRow>;
}

/**
 * Что игрок сообщает о себе. Координат здесь нет и завести их нельзя: тип —
 * это и есть запрет, а `readClaim` собирает новый объект, а не приводит тип.
 */
export interface CastleClaim {
  name: string;
  /** Имя города, очищенное `cityName`. Пустая строка — владелец его не называл. */
  city: string;
  power: number;
  pop: number;
}

/**
 * Чужой замок глазами игрока. Идентификатор здесь **не** телеграмный: он
 * выведен из ключа хешем и наружу уходит только он. Кто именно играет за этот
 * замок, соседям знать незачем, а имя вождь называет сам.
 */
export interface CastleView extends CastleRow {
  id: string;
}

/** Ответ реестра. Один на чтение и на запись: обе стороны хотят одного и того же. */
export interface RosterResponse {
  now: number;
  epoch: number;
  /** Своя клетка. `null` — замок ещё не поставлен. */
  mine: { x: number; y: number } | null;
  castles: CastleView[];
}

/** Потолки полей строки. Реестр читают все, и раздувать его никому нельзя. */
export const CASTLE_LIMITS = { name: 64, power: 1e9, pop: 1e9 } as const;

/**
 * Разбор того, что игрок сообщил о себе. Как и у записи партии, возвращается
 * **новый объект**, а не приведённый тип: иначе в реестр уехало бы всё, что
 * прислали, — включая координаты, которых игрок называть не вправе.
 */
export function readClaim(v: unknown): CastleClaim | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const cap = (raw: unknown, max: number): number => Math.min(max, Math.max(0, Math.floor(num(raw) ?? 0)));
  return {
    name: str(r.name, CASTLE_LIMITS.name) ?? '',
    // Имя города читают все соседи, поэтому сервер чистит его сам тем же правилом, что
    // и клиент: присланное поддельным клиентом дальше реестра сырым не уедет.
    city: cityName(r.city) ?? '',
    power: cap(r.power, CASTLE_LIMITS.power),
    pop: cap(r.pop, CASTLE_LIMITS.pop),
  };
}

// ---------- Имя города ----------
//
// Имя города игрок пишет сам, и видят его все: карта, панели, отчёты, письма и чужие
// игроки через реестр. Правило очистки поэтому одно на обе стороны и лежит здесь, в
// договоре, — рядом с правилом имени двора в уведомлениях, от которого оно и взято:
// строка до сорока знаков, без разметки. Сверх него — без управляющих и **невидимых**
// знаков (нулевой ширины, направления письма, мягкого переноса): имя из одних таких
// знаков выглядит пустым, а пустым имя быть не может.
//
// Ругательства здесь не ловятся и ловиться не будут: фильтра слов у игры нет, и решать
// это надо отдельно, а не строкой регулярного выражения.

/**
 * Потолок имени города в знаках. Он же потолок имени двора в уведомлениях
 * (`NOTICE_LIMITS.name` берёт его отсюда): правило одно, и числа у него одно.
 */
export const CITY_MAX = 40;

/** Имя города того, кто его не назвал. */
export const DEFAULT_CITY = 'Безымянный город';

/**
 * Что вырезается из имени: управляющие (`Cc`), невидимые форматирующие (`Cf` — нулевая
 * ширина, направление письма, мягкий перенос), разделители строк и абзацев, знаки
 * разметки. Остальные пробелы сводятся к одному обычному.
 */
const CITY_CUT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}<>`*_[\]\\]/gu;
const CITY_SPACE = /[\s\p{Zs}]+/gu;

/**
 * Имя города в пригодном виде или `null`, если от присланного ничего не осталось. Одна
 * дверь на всё: ввод игрока, сохранение, слепок в мир, реестр на сервере и чужие строки
 * реестра на клиенте.
 *
 * Потолок меряется так же, как его меряет разбор списка уведомлений (`str` — по длине
 * строки), иначе очищенное клиентом имя из широких знаков сервер бы отверг. Режется при
 * этом целыми знаками, а не по половинке суррогатной пары: последний знак не бывает
 * половиной буквы.
 */
export function cityName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const flat = raw.replace(CITY_CUT, '').replace(CITY_SPACE, ' ').trim();
  let cut = '';
  for (const ch of flat) {
    if (cut.length + ch.length > CITY_MAX) break;
    cut += ch;
  }
  cut = cut.trim();
  return cut.length > 0 ? cut : null;
}

/** Имя города для показа: очищенное или имя по умолчанию. */
export const cityOr = (raw: unknown): string => cityName(raw) ?? DEFAULT_CITY;

// ---------- Исходящие уведомления ----------
//
// Третья запись, которую держит сервер, и вторая, которую он читает (docs/NOTIFY.md,
// раздел 3). Читает он не партию, а поручение: «в такую-то минуту скажи вот это,
// если игрока нет». Ничего не проверяет о мире, ничего не начисляет. Составляет
// поручение клиент из сохранения мира (`src/world/notice.ts`), сервер только
// проверяет форму и держит до срока.

/**
 * Белый список видов. **Три и только три**, и тест держит их поимённо: вида «вернись в
 * игру», «стройка готова», «награда ждёт» здесь быть не может — это напоминания игры о
 * себе, а не о городе, и именно из-за них уведомления выключают целиком, вместе с
 * осадой. Новый вид — правкой этой строки и теста, и никак иначе.
 */
export const NOTICE_KINDS = ['raid', 'siege-works', 'siege-bread'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** Участь, объявленная городу, — теми же именами, что `Fate` мира. */
export const NOTICE_FATES = ['plunder', 'captives', 'burn'] as const;
export type NoticeFate = (typeof NOTICE_FATES)[number];

/**
 * Числа для слов. Только то, что до `until` само не двигается: имя двора, участь и
 * отметки времени, уже записанные в сохранении мира. Запаса, мощи, потерь здесь нет и
 * быть не может — они устаревают сами (docs/NOTIFY.md, раздел 4, правило 3).
 */
export interface NoticeFacts {
  /** Откуда пришли: имя двора. Строка до `NOTICE_LIMITS.name`, без разметки. */
  from: string;
  fate: NoticeFate;
  /** О какой минуте пункт: приход отряда у набега, конец хлеба у осады. */
  about: number;
  /** Набег: когда запрётся оборона. */
  freezeAt?: number;
  /** Осада: когда достроятся рогатки со стороны города и со стороны поля. */
  frontAt?: number;
  rearAt?: number;
}

/** Пункт исходящих. Ключ — имя момента, а не время: по нему не уходит второй раз. */
export interface NoticeItem {
  key: string;
  kind: NoticeKind;
  /** С какой минуты пункт годится к отправке. */
  fireAt: number;
  /** До какой минуты он годен: после неё ответить уже нечем. */
  until: number;
  p: NoticeFacts;
}

/** Настройки игрока. Каналов в них нет: каналы — следующая пачка. */
export interface NotifyPrefs {
  /** Отряд на подходе. */
  raid: boolean;
  /** Осада: рогатки и хлеб одной строкой. */
  siege: boolean;
  /** Тихие часы: минуты суток в поясе игрока, `from` может быть больше `to` (через полночь). */
  quiet: { on: boolean; from: number; to: number };
  /** Не больше в сутки. */
  perDay: 3 | 6 | 10;
  /** Пояс игрока (`Intl…timeZone`). Пустая строка — UTC. */
  tz: string;
}

export const DEFAULT_PREFS: NotifyPrefs = {
  raid: true,
  siege: true,
  quiet: { on: true, from: 23 * 60, to: 8 * 60 },
  perDay: 6,
  tz: '',
};

/** Потолки формы. Поддельный клиент может навредить только себе — и то в этих пределах. */
export const NOTICE_LIMITS = {
  items: 8,
  /** Дальше этого `fireAt` не принимается: столько не длится ни одно окно. */
  ahead: 12 * 60 * 60_000,
  name: CITY_MAX,
  key: 96,
  /** Насколько часы, по которым составлен список, могут разойтись с серверными. */
  skew: 2 * 60_000,
  /** Чаще этого список одного игрока не принимается. */
  putEvery: 5_000,
} as const;

/** Что клиент кладёт на `/api/notify`. Всё необязательно: присутствие ходит и без списка. */
export interface NotifyPut {
  /** Серверное «сейчас» клиента в минуту составления списка. Нужно, только если есть список. */
  computedAt?: number;
  items?: NoticeItem[];
  /** Игрок здесь (страница видна) или ушёл. Время ставит сервер. */
  present?: boolean;
  prefs?: NotifyPrefs;
}

/** Ответ `/api/notify`: состояние без самих пунктов и без журнала отправленного. */
export interface NotifyState {
  now: number;
  gen: number;
  items: number;
  away: number | null;
  prefs: NotifyPrefs;
}

/** Имя двора без разметки: ни угловых скобок, ни знаков выделения, ни управляющих символов. */
const PLAIN = /^[^\p{Cc}<>`*_[\]\\]+$/u;

/**
 * Имя двора в пригодном для списка виде: без разметки и не длиннее потолка. Зовёт его
 * клиент, составляя черновики, — иначе одно странное имя стоило бы отказа всему списку.
 * Очистка та же, что у имени города (`cityName`): правило об именах одно.
 */
export const plainName = (s: string): string => cityName(s) ?? '—';

const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null =>
  typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : null;

/**
 * Разбор списка, пришедшего от клиента. Как и у записи партии: лишнее выбрасывается,
 * а нарушение формы — отказ всему списку, а не обрезка. Список, из которого молча
 * выпал пункт, говорил бы игроку меньше, чем клиент думает, что сказал.
 *
 * `now` — серверные часы: `fireAt` дальше двенадцати часов от них не принимается.
 */
export function readNotices(v: unknown, now: number): NoticeItem[] | null {
  if (!Array.isArray(v) || v.length > NOTICE_LIMITS.items) return null;
  const out: NoticeItem[] = [];
  const keys = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const kind = oneOf(NOTICE_KINDS, r.kind);
    const key = str(r.key, NOTICE_LIMITS.key);
    const fireAt = num(r.fireAt);
    const until = num(r.until);
    if (!kind || !key || !key.startsWith(`${kind}:`) || keys.has(key)) return null;
    if (fireAt === null || until === null || fireAt >= until || fireAt > now + NOTICE_LIMITS.ahead) return null;
    const p = (r.p ?? {}) as Record<string, unknown>;
    const from = str(p.from, NOTICE_LIMITS.name);
    const fate = oneOf(NOTICE_FATES, p.fate);
    const about = num(p.about);
    if (!from || !PLAIN.test(from) || !fate || about === null) return null;
    const facts: NoticeFacts = { from, fate, about };
    for (const f of ['freezeAt', 'frontAt', 'rearAt'] as const) {
      if (p[f] === undefined) continue;
      const n = num(p[f]);
      if (n === null) return null;
      facts[f] = n;
    }
    keys.add(key);
    out.push({ key, kind, fireAt, until, p: facts });
  }
  return out;
}

/** Разбор настроек: неизвестное и кривое — умолчание, а не отказ. */
export function readPrefs(v: unknown): NotifyPrefs {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const q = (r.quiet && typeof r.quiet === 'object' ? r.quiet : {}) as Record<string, unknown>;
  const minute = (raw: unknown, dflt: number): number => {
    const n = num(raw);
    return n === null ? dflt : Math.min(1439, Math.max(0, Math.floor(n)));
  };
  const per = num(r.perDay);
  return {
    raid: typeof r.raid === 'boolean' ? r.raid : DEFAULT_PREFS.raid,
    siege: typeof r.siege === 'boolean' ? r.siege : DEFAULT_PREFS.siege,
    quiet: {
      on: typeof q.on === 'boolean' ? q.on : DEFAULT_PREFS.quiet.on,
      from: minute(q.from, DEFAULT_PREFS.quiet.from),
      to: minute(q.to, DEFAULT_PREFS.quiet.to),
    },
    perDay: per === 3 || per === 6 || per === 10 ? per : DEFAULT_PREFS.perDay,
    tz: str(r.tz, 64) ?? DEFAULT_PREFS.tz,
  };
}
