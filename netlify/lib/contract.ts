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
  /**
   * Слепок обороны для войны между игроками (docs/pvp.md). Сервер читает его, когда на этот город
   * приходит чужое войско; сама партия по-прежнему непрозрачна. Нет поля — клиент до войны.
   */
  war?: WarSheet;
  /** Опись наблюдения для статистики и флагов (docs/admin.md). Нет поля — клиент до админки. */
  watch?: WatchCard;
}

/** Ответ на чтение. `etag` — то, чем потом доказывают, что писали поверх этого. */
export interface PullResponse {
  /** Серверные часы. Приезжают с каждым ответом — отдельного запроса за ними не надо. */
  now: number;
  etag: string | null;
  record: SaveRecord | null;
  /** Заморозка и неприменённые указы админа (docs/admin.md). Нет поля — сервер до админки. */
  admin?: AdminNote;
  /** Алмазы: баланс, лавка и неприменённые дела (docs/gems.md). Нет поля — сервер до алмазов или хранилище не ответило. */
  gems?: GemNote;
}

/**
 * Как часто игра отправляет партию на сервер (`src/net/sync.PUSH_MS`), и чаще какого срока — не отправляет никогда
 * (`sync.HURRY_MS`, раскладка в слепке обороны сменилась). Числа живут здесь, потому что их читают обе стороны:
 * игра — чтобы отправлять, сервер — чтобы считать заходы и время в игре (`lib/watch.ts`).
 */
export const SAVE_PUSH_MS = 60_000;
export const SAVE_HURRY_MS = 6_000;

export interface PushBody {
  /** Поверх какой записи пишем. `null` — записи не было вовсе. */
  baseEtag: string | null;
  record: SaveRecord;
}

export interface PushResponse {
  now: number;
  etag: string;
  rev: number;
  admin?: AdminNote;
  gems?: GemNote;
}

/** Ответ 409: пока мы играли, поверх нашей записи легла чужая. */
export interface ConflictResponse {
  error: 'conflict';
  now: number;
  etag: string | null;
  record: SaveRecord | null;
  admin?: AdminNote;
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
    ...(r.war ? { war: readSheet(r.war) ?? undefined } : {}),
    ...(r.watch ? { watch: readWatch(r.watch) } : {}),
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
// строка до `CITY_MAX` знаков, без разметки. Сверх него — без управляющих и **невидимых**
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
// если игрока нет». Ничего не проверяет о мире, ничего не начисляет. Поручения о мире на
// клиенте составляет клиент из сохранения мира (`src/world/notice.ts`); о войне между
// игроками — сам сервер, из записи войн (`lib/war.newsOf`): её бой считает он же.

/**
 * Белый список видов. **Решение владельца (05.10.2026): бот пишет о двух вещах — на город
 * нападают и бой уже был (итог)**, и тест держит виды поимённо: вида «вернись в игру»,
 * «стройка готова», «награда ждёт» здесь быть не может — это напоминания игры о себе, а не о
 * городе, и именно из-за них уведомления выключают целиком. Новый вид — правкой этой строки
 * и теста, и никак иначе.
 *
 * - `raid` — набег логова идёт на город (нападают); `raid-fight` — набег дошёл до города
 *   (бой был, итог в игре); `siege-fall` — хлеб под лагерем логова кончился, город взят;
 * - `war` — отряд соседа идёт на город (нападают); `war-fight` — бой между игроками был;
 *   `war-fall` — осаждённый соседом город пал от голода;
 * - `war-spy` — чужой лазутчик напал на город: поджёг склад, обокрал или поднял смуту (docs/spy_pvp.md). Разведка и
 *   пойманный лазутчик нападением не считаются: город ничего не потерял.
 */
export const NOTICE_KINDS = ['raid', 'raid-fight', 'siege-fall', 'war', 'war-fight', 'war-fall', 'war-spy'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/** Что может прислать клиент. Войну знает только сервер: её поручения клиент составить не может. */
export const CLIENT_KINDS = ['raid', 'raid-fight', 'siege-fall'] as const satisfies readonly NoticeKind[];

/** Участь, объявленная городу, — теми же именами, что `Fate` мира. */
export const NOTICE_FATES = ['plunder', 'captives', 'burn'] as const;
export type NoticeFate = (typeof NOTICE_FATES)[number];

/**
 * Числа для слов. Только то, что до `until` само не двигается: имя двора, участь и
 * отметки времени, уже записанные в сохранении мира или войны. Запаса, мощи, потерь здесь нет
 * и быть не может — они устаревают сами (docs/NOTIFY.md, раздел 4, правило 3).
 */
export interface NoticeFacts {
  /** Кто: имя логова или города соседа. Строка до `NOTICE_LIMITS.name`, без разметки. */
  from: string;
  fate: NoticeFate;
  /** О какой минуте пункт: приход отряда у набега и войны, конец хлеба у осады, минута боя. */
  about: number;
  /** Война: чья сторона у получателя — он идёт (`atk`) или на него идут (`def`). */
  role?: 'atk' | 'def';
  /** Война в пути: штурм с ходу или осада лагерем. */
  mode?: WarMode;
  /** Бой войны: где, кто нападал в этом бою, победила ли сторона получателя, взят ли город этим боем. */
  site?: WarSite;
  by?: 'atk' | 'def';
  won?: boolean;
  taken?: true;
}

/** Пункт исходящих. Ключ — имя момента, а не время: по нему не уходит второй раз. */
export interface NoticeItem {
  key: string;
  kind: NoticeKind;
  /** С какой минуты пункт годится к отправке. */
  fireAt: number;
  /** До какой минуты он годен: после неё ответить уже нечем или новость устарела. */
  until: number;
  p: NoticeFacts;
}

/**
 * Настройки игрока. Рычаг один — пишет бот или нет (решение владельца: кнопка «Отключить уведомления» под
 * каждым сообщением и «Включить», когда выключены). Тихих часов нет: о нападении и о бое бот пишет в любое
 * время суток. Пояс нужен для «в 14:40» в словах.
 */
export interface NotifyPrefs {
  on: boolean;
  /** Пояс игрока (`Intl…timeZone`). Пустая строка — UTC. */
  tz: string;
}

export const DEFAULT_PREFS: NotifyPrefs = { on: true, tz: '' };

/**
 * Сколько годна новость об итоге (`raid-fight`, `siege-fall`, `war-fight`, `war-fall`): позже она уже не новость —
 * игрок узнает её в игре. Одно число на клиент и сервер.
 */
export const RESULT_KEEP = 12 * 60 * 60_000;

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
  /**
   * Игрок только что разрешил боту писать (`requestWriteAccess`). Сервер верит этому ровно настолько, что
   * пробует писать снова: адресат — только из подписи, и ложное «разрешил» получит отказ Telegram себе же.
   */
  canWrite?: true;
}

/** Может ли бот писать игроку: не знаем, можно, закрыто (отказ Telegram или бот заблокирован). */
export type NotifyChannel = 'unknown' | 'open' | 'closed';

/** Ответ `/api/notify`: состояние без самих пунктов и без журнала отправленного. */
export interface NotifyState {
  now: number;
  gen: number;
  items: number;
  away: number | null;
  prefs: NotifyPrefs;
  chan: NotifyChannel;
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
 * Разбор списка. Как и у записи партии: лишнее выбрасывается, а нарушение формы — отказ всему
 * списку, а не обрезка. Список, из которого молча выпал пункт, говорил бы игроку меньше, чем
 * клиент думает, что сказал.
 *
 * `now` — серверные часы: `fireAt` дальше `NOTICE_LIMITS.ahead` от них не принимается. `kinds` —
 * какие виды принимаются: от клиента — только `CLIENT_KINDS` (войну он прислать не может), своя
 * запись сервера читается со всеми.
 */
export function readNotices(v: unknown, now: number, kinds: readonly NoticeKind[] = CLIENT_KINDS): NoticeItem[] | null {
  if (!Array.isArray(v) || v.length > NOTICE_LIMITS.items) return null;
  const out: NoticeItem[] = [];
  const keys = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const kind = oneOf(kinds, r.kind);
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
    // Пометки «полный сбор не успеет» (`late`) больше нет: набег годен до прихода, как война (docs/NOTIFY.md, 12.11). Её
    // шлёт закэшированный бандл прежней сборки и несёт запись прежнего сервера — поле отбрасывается, как всякое лишнее.
    const facts: NoticeFacts = { from, fate, about };
    // Поля войны — только у видов войны: клиент их не шлёт, а своя запись сервера их несёт.
    if (kind.startsWith('war')) {
      const role = oneOf(['atk', 'def'] as const, p.role);
      if (!role) return null;
      facts.role = role;
      const mode = oneOf(WAR_MODES, p.mode);
      const site = oneOf(['wall', 'sortie', 'camp', 'joint'] as const, p.site);
      const by = oneOf(['atk', 'def'] as const, p.by);
      if (mode) facts.mode = mode;
      if (site) facts.site = site;
      if (by) facts.by = by;
      if (typeof p.won === 'boolean') facts.won = p.won;
      if (p.taken === true) facts.taken = true;
    }
    keys.add(key);
    out.push({ key, kind, fireAt, until, p: facts });
  }
  return out;
}

/** Разбор настроек: неизвестное и кривое — умолчание, а не отказ. Прежние настройки (виды, тихие часы) не читаются. */
export function readPrefs(v: unknown): NotifyPrefs {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return {
    on: typeof r.on === 'boolean' ? r.on : DEFAULT_PREFS.on,
    tz: str(r.tz, 64) ?? DEFAULT_PREFS.tz,
  };
}

// ---------- Война между игроками ----------
//
// Третья запись, которую сервер читает насквозь, и единственная, где он **считает**: бой между
// игроками (docs/pvp.md). Решение владельца 05.10.2026: бой считает сервер тем же ядром, в минуту
// прихода войска, по сохранениям обоих игроков; клиент свой исход прислать не может — поля исхода в
// приказах нет вовсе, как нет координат в строке реестра.
//
// Что сервер берёт из сохранения защитника, — слепок обороны (`WarSheet`), который клиент кладёт рядом с
// партией. Его считает мир той же дверью, что бой у своих ворот (`LocalWorld.warSheet`), и сервер ему
// верит ровно настолько, насколько верит описи: сервер по-прежнему не ловит читерство, он только не
// даёт стороне назвать свой исход.

/** Числа по видам: бойцы племени (`TroopStack`), роды боя (`Stack`), припасы. */
export type Counts = Record<string, number>;

/** С чем войско идёт на город: штурм с ходу или осада лагерем. */
export const WAR_MODES = ['storm', 'siege'] as const;
export type WarMode = (typeof WAR_MODES)[number];

/**
 * Слепок обороны города — поле записи партии (`SaveRecord.war`). Всё, что нужно серверу, чтобы
 * посчитать бой у стены, часы голода и участь взятого города, и ничего сверх.
 */
export interface WarSheet {
  /** Всё войско по видам — потолок того, что игрок может увести в поход. */
  army: Counts;
  /** Кто дома в обороне по видам: гарнизон и дружина у ворот (`LocalWorld.defenders`). */
  home: Counts;
  /** Ополчение — частокол, башня и жители; из них стрелками — `archers`. */
  militia: number;
  archers: number;
  /** Стойкость (обряд), отметки полководца у ворот и мораль обороны, 0..1. */
  resolve: number;
  pips: Counts;
  rest: number;
  /** Хлеб и расход — часы голода той же дверью, что у осады логова (`siege.openSiege`). */
  food: number;
  townPerHour: number;
  perManPerHour: number;
  /** Что потеряет взятый город — дверь участи `spoils.fate`. */
  stock: Counts;
  stash: number;
  gold: number;
  pop: number;
  bonded: number;
  levels: Counts;
  /** Мощь войска — защита слабого (`lairs.weakCity`) по жителям или войску. */
  power: number;
  /** Какие участи этот игрок объявить не может — словами отказа гейта. */
  locks: Partial<Record<NoticeFate, string>>;
  /**
   * Какие бои и падения войны этот город уже принял на себя (`WarBattle.id`, `<война>.fall`). Остальное сервер
   * вычитает из слепка сам (`war.liveSheet`): слепок мог лечь раньше, чем клиент узнал о бое.
   */
  seen: string[];
  /**
   * Какая часть `home` — отряд полководца, стоящий дома (`LocalWorld.defenders().standing`, docs/retinue.md). Слепок лёг
   * до выхода полководца в поход на игрока — сервер вычтет из `home` ушедших, но не больше этого (`war.liveSheet`).
   * Нет поля (слепок старого клиента) — ушедшие считаются стоявшими дома целиком.
   */
  retinue?: Counts;
  /**
   * Свои войны, чьё войско в этом слепке уже не дома: полководец в походе на игрока (`StoredFigure.war`). Война кончилась,
   * а слепка новее нет, — сервер прибавит вернувшихся сам (`war.liveSheet`).
   */
  out?: string[];
  /**
   * Тайная служба города (docs/spy_pvp.md): Дозор, скрытность и черты своего лазутчика и стоит ли он дома. Нападающему —
   * шанс, гибель и поимка его дела; защитнику — охрана от чужого. Нет поля (слепок старого клиента) — лазутчика против
   * этого города не послать и свой не отправить.
   */
  watch?: SpyWatch;
  /** Игровое время деревни в минуту слепка, секунды (`GameState.time`): час и время года в городе — в гибели лазутчика. */
  time?: number;
}

/** Тайная служба города в слепке обороны (`WarSheet.watch`). */
export interface SpyWatch {
  /** Дозор (`intelKeen`, от единицы): шанс своего дела и охрана от чужого. */
  keen: number;
  /** Скрытность своего лазутчика множителем гибели, 0..1 (`PlayerProfile.veil`). */
  veil: number;
  /** Скрытность долей: какой провал проходит незамеченным (`PlayerProfile.stealth`). */
  stealth: number;
  /** Черта «сколько его держат» множителем срока плена (`LocalWorld.spyTimes`). */
  held: number;
  /** Свой лазутчик дома — у ворот или в городе: он и охраняет. */
  home: boolean;
}

/** Войско в походе: дружина полководца и то, что он кладёт в бой. */
export interface WarArmy {
  troops: Counts;
  resolve: number;
  pips: Counts;
  /** Мораль между боями (`world/rest.RestPair`). Нет — свежее. */
  rest?: { share: number; at: number; men: number };
  /**
   * Энергия полководца (`world/energy.EnergyMark`, docs/agent_energy.md): сколько было в минуту `at` и что с запасом с
   * неё. В приказе — отметка клиента, в войне — отметка сервера: дело у стен списывается при выходе, дорога уходит по
   * дням пути, у стен энергия стоит. Нет — полный запас.
   */
  energy?: WarEnergy;
}

/** Отметка энергии полководца в войне — та же форма, что у двери энергии (`world/energy.EnergyMark`). */
export interface WarEnergy {
  value: number;
  at: number;
  mode: 'drain' | 'fill' | 'hold';
  homeAt?: number;
  stopAt?: number;
}

/** Отметка энергии из приказа: новый объект; запас не выше полного, мусор — нет отметки. */
export function readEnergy(v: unknown): WarEnergy | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const value = num(r.value);
  const at = num(r.at);
  const mode = r.mode === 'drain' || r.mode === 'fill' || r.mode === 'hold' ? r.mode : null;
  if (value === null || at === null || mode === null) return undefined;
  const homeAt = num(r.homeAt);
  const stopAt = num(r.stopAt);
  return {
    value: Math.max(0, Math.min(100, value)),
    at,
    mode,
    ...(homeAt !== null ? { homeAt } : {}),
    ...(stopAt !== null ? { stopAt } : {}),
  };
}

/** Сторона боя в форме ядра (`world/battle.FieldSide`): роды боя и то, что кладётся поверх. */
export interface WarSide {
  kinds: Counts;
  resolve?: number;
  pips?: Counts;
  rest?: number;
  garrison?: Counts;
}

/** Вход боя целиком. Ядро детерминировано: клиент пересчитывает по нему журнал для ролика. */
export interface WarInput {
  seed: number;
  attacker: WarSide;
  defender: WarSide;
  /** Штраф кости нападающему (`battle.GroundPenalty`): у боя за лагерь — его укрепления (`works`). Нет — ноль. */
  ground?: { land?: number; crossing?: number; works?: number };
}

/** Что полководец сделал в своём лагере (`world/siegecraft.Craft`): сколько раз укрепил, сколько залпов дал. */
export interface WarCraft {
  fort?: number;
  shots?: number;
}

/** Дела полководца в лагере — строки таблицы энергии (`world/siegecraft.CraftAct`). */
export const WAR_CRAFTS = ['fortify', 'bombard'] as const;
export type WarCraftAct = (typeof WAR_CRAFTS)[number];

export type WarSite = 'wall' | 'sortie' | 'camp' | 'joint';

/** Бой войны. Посчитан сервером; клиент только показывает и применяет свою сторону. */
export interface WarBattle {
  id: string;
  at: number;
  site: WarSite;
  /** Кто нападал в этом бою: осаждающий (`atk` — штурм) или город (`def` — вылазка, удар, совместный удар). */
  by: 'atk' | 'def';
  input: WarInput;
  /** Победил ли тот, кто нападал в этом бою. */
  won: boolean;
  /** Войско похода в бою и его потери, по видам племени. */
  atkTroops: Counts;
  atkLost: Counts;
  /** Гарнизон города в бою и его потери, по видам племени. */
  homeTroops: Counts;
  homeLost: Counts;
  /** Дружина полководца города в ударе по лагерю и её потери. */
  genTroops?: Counts;
  genLost?: Counts;
  /** Ополчение города в бою у стены — не бойцы, в казармах их нет. */
  militia?: { men: number; archers: number };
  /** Сколько вышло и пробилось через рогатки со стороны города и с тыла. */
  through?: { went: number; passed: number };
  rearThrough?: { went: number; passed: number };
  /** Что было сделано в лагере к этому бою: укрепления и обстрел. Нет — ничего. */
  craft?: WarCraft;
}

/** Участь взятого города — посчитана дверью `spoils.fate`, у обеих сторон одними числами. */
export interface WarFall {
  at: number;
  fate: NoticeFate;
  by: 'storm' | 'hunger';
  /** Что увёз победитель (припасы и казна) и сколько людей увёл. */
  taken: Counts;
  led: number;
  /** Что потерял город: припасы и казна, невольники, горожане, уровни построек, пожар. */
  lost: Counts;
  bondedLost: number;
  popLost: number;
  fallen: { id: string; from: number; to: number }[];
  burned: boolean;
  /** Сколько осталось в тайнике. */
  hidden: number;
  /** Гарнизон, разошедшийся при падении голодом. */
  routed: Counts;
}

/** Лагерь под городом — окно осады (`world/siege.SiegeWindow`) как есть. */
export interface WarCamp {
  byId: string;
  campId: string;
  startedAt: number;
  sinceAt?: number;
  foodAtStart: number;
  garrisonAtStart: number;
  townPerHour: number;
  perManPerHour: number;
  gateAt?: number;
  rearGateAt?: number;
  fate?: NoticeFate;
  wood?: { front: number; rear: number; at?: number; base?: { front: number; rear: number } };
  builders?: number;
  /** Дела полководца в этом лагере (`SiegeWindow.craft`). */
  craft?: WarCraft;
}

/** Удар полководца города по лагерю: идёт, бьётся в минуту прихода. */
export interface WarStrike {
  at: number;
  army: WarArmy;
  /** Зовут ли гарнизон во фронт — совместный удар. */
  joint: boolean;
}

/**
 * Где сейчас война: идут к городу (`march`), стоят лагерем (`camp`), возвращаются (`back`), кончилась
 * (`done`).
 */
export type WarPhase = 'march' | 'camp' | 'back' | 'done';

/** Чем кончилась: взяли город, отбили, отозвали, сняли осаду, город исчез из реестра. */
export type WarEnd = 'taken' | 'beaten' | 'recalled' | 'retreat' | 'lifted' | 'gone';

/** Война глазами игрока. Ключей игроков в ней нет — только замки. */
export interface WarView {
  id: string;
  /** Чья это война для спросившего: он идёт (`atk`) или на него идут (`def`). */
  role: 'atk' | 'def';
  atkCastle: string;
  defCastle: string;
  atkCity: string;
  defCity: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  mode: WarMode;
  fate: NoticeFate;
  sentAt: number;
  arriveAt: number;
  phase: WarPhase;
  army: WarArmy;
  /**
   * С кем войско вышло (`army.troops` в минуту выхода): столько сервер вычитает из гарнизона нападающего, пока его слепок
   * лёг раньше выхода (`war.liveSheet`, docs/retinue.md). Нет — война старше поля, берётся нынешнее войско.
   */
  went?: Counts;
  camp?: WarCamp;
  /** Когда лагерь доедает город. */
  starvesAt?: number;
  strike?: WarStrike;
  /** Обратный путь: откуда и когда дома. */
  backFrom?: { x: number; y: number };
  backAt?: number;
  battles: WarBattle[];
  fall?: WarFall;
  end?: WarEnd;
  endAt?: number;
}

/** Ответ войны: свои войны и серверное «сейчас»; у отказанного приказа — отказ словами. */
export interface WarResponse {
  now: number;
  wars: WarView[];
  /** Темп войны (`TRIBE_WAR_PACE`): во сколько раз быстрее походы и голод. Нет — 1. */
  pace?: number;
  error?: string;
  /** Дела своего лазутчика у соседей и чужих — у нас, которые мы видим (docs/spy_pvp.md). Нет — нет ни одного. */
  spies?: SpyView[];
  /** Меню дел против города, если о нём спросили (`GET /api/war?spy=<замок>`). */
  spyMenu?: SpyMenu;
}

// ---------- Лазутчик против соседа (docs/spy_pvp.md) ----------
//
// Исход считает сервер, как бой: в приказе — какое дело и к какому городу, отметка энергии и показанные числа (чтобы
// сервер отказал, если обстановка сменилась), а исхода нет ни в каком виде. Кости — из номера дела, который назначает
// сервер.

export const RIVAL_DEEDS = ['look', 'fire', 'theft', 'unrest'] as const;
export type RivalDeed = (typeof RIVAL_DEEDS)[number];

/** Где дело: лазутчик идёт к городу, его держат там в плену, идёт домой, дело кончено. */
export type SpyPhase = 'go' | 'held' | 'back' | 'done';

/** Что разведал лазутчик: войско и оборона соседа точно, на минуту дела. */
export interface SpyIntel {
  home: Counts;
  army: Counts;
  militia: number;
  archers: number;
  pop: number;
  power: number;
}

/** Чем кончилось дело — посчитано сервером в минуту прихода. */
export interface SpyOut {
  at: number;
  ok: boolean;
  slipped: boolean;
  held: boolean;
  dead: boolean;
  /** Города больше нет в игре — дела не было, лазутчик идёт домой. */
  gone?: true;
  intel?: SpyIntel;
  burned?: Counts;
  stolen?: Counts;
  lured?: number;
  morale?: number;
}

/** Дело лазутчика глазами стороны. Защитник видит дело, только если оно его задело или лазутчика поймали. */
export interface SpyView {
  id: string;
  role: 'atk' | 'def';
  deed: RivalDeed;
  /** Чей лазутчик. У защитника — пусто, пока лазутчика не поймали (удача и тихий провал имени не оставляют). */
  atkCastle: string;
  atkCity: string;
  defCastle: string;
  defCity: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  sentAt: number;
  arriveAt: number;
  /** Показанные и применённые числа: шанс и гибель, замороженные при приказе. */
  chance: number;
  peril: number;
  phase: SpyPhase;
  /** Энергия лазутчика — отметка сервера (у нападающего). */
  energy?: WarEnergy;
  releaseAt?: number;
  backAt?: number;
  endAt?: number;
  out?: SpyOut;
}

/** Строка меню дел против города. */
export interface SpyOption {
  deed: RivalDeed;
  can: boolean;
  reason: string | null;
  chance: number;
  peril: number;
  why: string[];
}

/** Меню дел против города: на какую минуту посчитано и сколько идти (с темпом войны). */
export interface SpyMenu {
  target: string;
  at: number;
  walkMs: number;
  options: SpyOption[];
}

/** Отметка дела в списке принятого (`WarSheet.seen`): одна на клиент и на сервер. */
export const spySeenId = (id: string): string => `${id}.spy`;

/** Приказы войны. Исхода в них нет ни в каком виде — его считает сервер. */
export type WarOrder =
  | { op: 'march'; target: string; mode: WarMode; fate: NoticeFate; army: WarArmy }
  | { op: 'recall'; id: string }
  | { op: 'storm'; id: string }
  | { op: 'retreat'; id: string }
  | { op: 'sortie'; id: string; troops: Counts }
  | { op: 'craft'; id: string; act: WarCraftAct }
  | { op: 'strike'; id: string; army: WarArmy; joint: boolean; walkMs: number }
  | { op: 'spy'; target: string; deed: RivalDeed; energy?: WarEnergy; shown: { chance: number; peril: number }; at: number };

/** Отметка падения города в списке принятого (`WarSheet.seen`): одна на клиент и на сервер. */
export const warFallId = (war: string): string => `${war}.fall`;

/** Потолки слепка и приказа. Видов племени и припасов — десятки; больше — порча. */
export const WAR_LIMITS = { keys: 64, count: 1e7 } as const;

/** Числа по видам из того, что прислали: новый объект, только конечные неотрицательные целые. */
export function readCounts(v: unknown): Counts {
  const out: Counts = {};
  if (!v || typeof v !== 'object') return out;
  let n = 0;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (n >= WAR_LIMITS.keys || k.length > 32) break;
    const x = num(raw);
    if (x === null || x <= 0) continue;
    out[k] = Math.min(WAR_LIMITS.count, Math.floor(x));
    n++;
  }
  return out;
}

/** Дробные числа по видам (отметки полководца) — те же правила, без округления. */
const readReals = (v: unknown): Counts => {
  const out: Counts = {};
  if (!v || typeof v !== 'object') return out;
  let n = 0;
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (n >= WAR_LIMITS.keys || k.length > 32) break;
    const x = num(raw);
    if (x === null || x <= 0) continue;
    out[k] = Math.min(WAR_LIMITS.count, x);
    n++;
  }
  return out;
};

const real = (v: unknown, max: number): number => Math.min(max, Math.max(0, num(v) ?? 0));

/** Слепок обороны из того, что прислали или что лежит. Нет его или он испорчен — `null`. */
export function readSheet(v: unknown): WarSheet | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const locks: Partial<Record<NoticeFate, string>> = {};
  const l = (r.locks && typeof r.locks === 'object' ? r.locks : {}) as Record<string, unknown>;
  for (const f of NOTICE_FATES) {
    const why = str(l[f], 200);
    if (why) locks[f] = why;
  }
  return {
    army: readCounts(r.army),
    home: readCounts(r.home),
    militia: Math.floor(real(r.militia, WAR_LIMITS.count)),
    archers: Math.floor(real(r.archers, WAR_LIMITS.count)),
    resolve: real(r.resolve, 100),
    pips: readReals(r.pips),
    rest: Math.min(1, real(r.rest, 1)),
    food: real(r.food, 1e12),
    townPerHour: real(r.townPerHour, 1e9),
    perManPerHour: real(r.perManPerHour, 1e9),
    stock: readCounts(r.stock),
    stash: Math.floor(real(r.stash, 1e12)),
    gold: Math.floor(real(r.gold, 1e12)),
    pop: Math.floor(real(r.pop, 1e9)),
    bonded: Math.floor(real(r.bonded, 1e9)),
    levels: readCounts(r.levels),
    power: real(r.power, 1e12),
    locks,
    seen: Array.isArray(r.seen) ? r.seen.filter((x): x is string => typeof x === 'string' && x.length <= 48).slice(-WAR_SEEN_MAX) : [],
    ...(r.retinue && typeof r.retinue === 'object' ? { retinue: readCounts(r.retinue) } : {}),
    ...(Array.isArray(r.out) ? { out: r.out.filter((x): x is string => typeof x === 'string' && x.length <= 48).slice(-WAR_OUT_MAX) } : {}),
    ...(readSpyWatch(r.watch) ? { watch: readSpyWatch(r.watch) } : {}),
    ...(num(r.time) !== null ? { time: real(r.time, 1e12) } : {}),
  };
}

/** Тайная служба из слепка: новый объект; Дозор от единицы, доли — 0..1. Нет или мусор — нет. */
function readSpyWatch(v: unknown): SpyWatch | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (num(r.keen) === null) return undefined;
  return {
    keen: Math.max(1, real(r.keen, 100)),
    veil: Math.min(1, real(r.veil ?? 1, 1)),
    stealth: Math.min(1, real(r.stealth, 1)),
    held: Math.max(0.1, real(r.held ?? 1, 10)),
    home: r.home === true,
  };
}

/** Сколько своих войн слепок называет ушедшими: у города один полководец, больше — порча. */
export const WAR_OUT_MAX = 4;

/** Сколько принятых боёв слепок помнит: больше, чем войн лежит у сервера на один город. */
export const WAR_SEEN_MAX = 200;

/** Войско из приказа: новый объект. */
export function readArmy(v: unknown): WarArmy | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const troops = readCounts(r.troops);
  const rest = r.rest && typeof r.rest === 'object' ? (r.rest as Record<string, unknown>) : null;
  const energy = readEnergy(r.energy);
  return {
    troops,
    resolve: real(r.resolve, 100),
    pips: readReals(r.pips),
    ...(rest && num(rest.at) !== null
      ? { rest: { share: Math.min(1, real(rest.share, 1)), at: num(rest.at) as number, men: Math.floor(real(rest.men, WAR_LIMITS.count)) } }
      : {}),
    ...(energy ? { energy } : {}),
  };
}

/** Приказ войны из тела запроса: новый объект, лишние поля (и всякий «исход») отбрасываются. */
export function readWarOrder(v: unknown): WarOrder | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const id = str(r.id, 64);
  switch (r.op) {
    case 'march': {
      const target = str(r.target, 64);
      const mode = WAR_MODES.find((m) => m === r.mode);
      const fate = NOTICE_FATES.find((f) => f === r.fate);
      const army = readArmy(r.army);
      return target && mode && fate && army ? { op: 'march', target, mode, fate, army } : null;
    }
    case 'recall':
    case 'storm':
    case 'retreat':
      return id ? { op: r.op, id } : null;
    case 'sortie':
      return id ? { op: 'sortie', id, troops: readCounts(r.troops) } : null;
    case 'craft': {
      const act = WAR_CRAFTS.find((a) => a === r.act);
      return id && act ? { op: 'craft', id, act } : null;
    }
    case 'strike': {
      const army = readArmy(r.army);
      const walk = num(r.walkMs);
      return id && army && walk !== null
        ? { op: 'strike', id, army, joint: r.joint === true, walkMs: Math.min(24 * 3600_000, Math.max(0, walk)) }
        : null;
    }
    case 'spy': {
      const target = str(r.target, 64);
      const deed = RIVAL_DEEDS.find((d) => d === r.deed);
      const shown = (r.shown && typeof r.shown === 'object' ? r.shown : {}) as Record<string, unknown>;
      const chance = num(shown.chance);
      const peril = num(shown.peril);
      const at = num(r.at);
      const energy = readEnergy(r.energy);
      return target && deed && chance !== null && peril !== null && at !== null
        ? { op: 'spy', target, deed, shown: { chance, peril }, at, ...(energy ? { energy } : {}) }
        : null;
    }
    default:
      return null;
  }
}

// ---------- Админка, наблюдение, отчёты об ошибках (docs/admin.md) ----------
//
// Инструменты для теста с игроками (решение владельца 06.10.2026). Партия по-прежнему непрозрачна: числа для
// наблюдения клиент кладёт рядом с ней описью (`WatchCard`) — так же, как `SaveCard`, теми же функциями игры, что
// интерфейс. Указ админа — запись в журнале игрока на сервере (`AdminGrant`); партию правит не сервер, а клиент,
// одной дверью (`src/game/sim/admin.ts`) и ровно один раз — по номеру указа.

/**
 * Виды склада, которые правит указ: семь припасов и золото. Тот же список, что у игры (`constants.RESOURCE_IDS` и
 * золото) — сверяет тест (`src/net/admin.test.ts`). Алмазов здесь нет и быть не может: начисление алмазов одно —
 * `netlify/lib/gems.creditGems` (docs/gems.md).
 */
export const STOCK_KEYS = ['wood', 'stone', 'food', 'hides', 'bones', 'copper', 'iron', 'gold'] as const;
export type StockKey = (typeof STOCK_KEYS)[number];

/** Виды бойцов, которые правит указ. Тот же список, что у игры (`data/troops.TROOP_IDS`) — сверяет тот же тест. */
export const TROOP_KEYS = ['clubman', 'spearman', 'archer', 'axeman', 'swordsman', 'shieldman', 'rider', 'knight', 'legionary'] as const;
export type TroopKey = (typeof TROOP_KEYS)[number];

/** Потолок одного числа указа по модулю. Больше на складе и в войске не бывает. */
export const GRANT_MAX = 1e7;

/** Сколько последних указов игрока лежит на сервере. Номер у партии один, и обрезка списка ничего не теряет. */
export const GRANTS_KEEP = 50;

/** Указ админа глазами клиента: номер, минута и что поменять. Кто отдал — знает только журнал админа. */
export interface AdminGrant {
  /** Номер по порядку у этого игрока: 1, 2, 3… Партия применяет только номера старше своего `adminSeen`. */
  n: number;
  /** Когда отдан, по серверным часам. */
  at: number;
  /** Склад и золото: прибавка (+) или убавка (−). */
  stock: Partial<Record<StockKey, number>>;
  /** Бойцы по видам: прибавка (+) или убавка (−). */
  troops: Partial<Record<TroopKey, number>>;
}

/** Что сервер сообщает клиенту об админке вместе с ответом сохранения. */
export interface AdminNote {
  /** Аккаунт заморожен: записи и приказы войны не принимаются. */
  frozen: boolean;
  /** Указы, ещё не применённые этой партией (номер старше присланного в описи). */
  grants: AdminGrant[];
}

/**
 * Эпоха мира (docs/test_world.md): номер чистого старта. Игра шлёт свою в этом заголовке с каждым запросом; сервер, у
 * которого другая, отвечает 410 (`EraGoneResponse`) и не пишет ничего. Нет заголовка — эпоха 0, мир ни разу не стирали.
 */
export const ERA_HEADER = 'x-tribe-era';

/** Эпоха из заголовка: целое не меньше нуля; нет заголовка — 0; порча — −1, она не совпадёт ни с какой эпохой. */
export function readEra(v: string | null | undefined): number {
  const n = Number((v ?? '').trim() || '0');
  return Number.isSafeInteger(n) && n >= 0 ? n : -1;
}

/** Ответ 410: мир начат заново, у сервера эпоха `era`. Старая партия не принимается и не отдаётся. */
export interface EraGoneResponse {
  error: 'era';
  era: number;
  now: number;
}

/** Ответ 423: аккаунт заморожен, запись не принята. */
export interface FrozenResponse {
  error: 'frozen';
  now: number;
  admin: AdminNote;
}

/** Числа со знаком по известным видам: новый объект, только целые, не больше `GRANT_MAX` по модулю, без нулей. */
export function readDeltas<K extends string>(v: unknown, keys: readonly K[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  if (!v || typeof v !== 'object') return out;
  const r = v as Record<string, unknown>;
  for (const k of keys) {
    const x = num(r[k]);
    if (x === null) continue;
    const n = Math.trunc(Math.max(-GRANT_MAX, Math.min(GRANT_MAX, x)));
    if (n !== 0) out[k] = n;
  }
  return out;
}

/** Указ из ответа сервера или из хранилища: новый объект; без номера или пустой — `null`. */
export function readGrant(v: unknown): AdminGrant | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const n = num(r.n);
  const at = num(r.at);
  if (n === null || n < 1 || !Number.isInteger(n) || at === null) return null;
  const stock = readDeltas(r.stock, STOCK_KEYS);
  const troops = readDeltas(r.troops, TROOP_KEYS);
  if (Object.keys(stock).length + Object.keys(troops).length === 0) return null;
  return { n, at, stock, troops };
}

/** Записка админки из ответа: кривое — «не заморожен, указов нет». */
export function readAdminNote(v: unknown): AdminNote {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const grants = Array.isArray(r.grants) ? r.grants.map(readGrant).filter((g): g is AdminGrant => g !== null) : [];
  grants.sort((a, b) => a.n - b.n);
  return { frozen: r.frozen === true, grants: grants.slice(-GRANTS_KEEP) };
}

/**
 * Опись наблюдения: числа партии для статистики и флагов подозрительного. Считает её клиент теми же функциями, что
 * интерфейс (`src/net/snapshot.ts`); сервер её только читает и сравнивает две соседние описи. Судьёй сервер от этого
 * не становится: флаг — подсказка админу, а не приговор, и партию он не трогает.
 */
export interface WatchCard {
  /** Версия игры: ступень сохранения и имя входного куска сборки. */
  build: string;
  /** Имя города, очищенное (`cityName`); не назван — пусто. */
  city: string;
  /** Часы устройства в минуту описи (`deviceNow`): сдвиг против серверных — флаг. */
  clock: number;
  /** Часы партии, игровые секунды (`s.time`). */
  time: number;
  /** Уровень ратуши. */
  level: number;
  /**
   * Уровни построек по типу. Из них и войска сервер сам выводит мощь для рейтинга (`profile/power.powerOfCounts`,
   * docs/rating.md). Нет поля — опись до рейтинга: в мощь идёт только войско.
   */
  buildings: Counts;
  /** Жители (без бойцов и учеников). */
  pop: number;
  /** Склад и золото по видам `STOCK_KEYS`. */
  stock: Counts;
  /** Приток за игровой день: выработка по припасам, золото — налог и вера. */
  prod: Counts;
  /** Вместимость склада по каждому припасу. */
  cap: number;
  /** Войско по видам. */
  troops: Counts;
  /** Бойцов в обучении (очередь казарм и конюшни). */
  queued: number;
  /** Вне города: бойцы в походах и разведчики. Вернулись — могли привезти добычу, это тоже разовое дело. */
  away: number;
  /** Караванов рынка в пути: пришедший кладёт товар на склад разом. */
  caravans: number;
  /** Раненых в лазарете. */
  wounded: number;
  /**
   * Раненые по видам — в лазарете и при полководце в поле. Книга войска сервера считает тела (`troops` + `hurt`): раненый
   * встаёт тем же бойцом, и подтверждать его второй раз незачем (docs/pvp.md, раздел 6). Нет поля — опись до книги.
   */
  hurt?: Counts;
  /** Сколько бойцов казармы и конюшня выучат за игровой день — не больше. */
  train: number;
  /**
   * Разовые дела партии одним счётчиком: события, бои, логова, набеги, покупки, ежедневки, промыслы, указы. Дело
   * может разом принести добро, поэтому между двумя описями с одинаковым счётчиком рост склада обязан уложиться в
   * выработку.
   */
  deeds: number;
  /** Боёв выиграно и проиграно, логов сожжено, набегов отправлено. */
  won: number;
  lost: number;
  lairs: number;
  raids: number;
  /** Промыслов сыграно и сколько добра они принесли всего. */
  games: number;
  haul: number;
  /** Потолок добычи одного промысла сейчас — сумма по видам (`minigameCap`), наибольший из промыслов. */
  haulCap: number;
  /** Партию помечали кодами проверки (`GameState.cheated`). */
  cheated: boolean;
  /** Опережение часов партии скоростью проверки, мс (`GameState.lead`). */
  lead: number;
  /** Номер последнего применённого указа админа (`GameState.adminSeen`). */
  seen: number;
  /**
   * Номер последней применённой записи журнала алмазов (`GameState.gemSeen`, docs/gems.md): записка сохранения везёт
   * только дела старше. Нет поля — опись до алмазов на сервере.
   */
  gemSeen?: number;
}

const whole = (v: unknown, max: number): number => Math.floor(Math.min(max, Math.max(0, num(v) ?? 0)));

/** Опись наблюдения из того, что прислали: новый объект; нет её — `undefined`. */
export function readWatch(v: unknown): WatchCard | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const big = WAR_LIMITS.count * 1e3;
  return {
    build: str(r.build, 64) ?? '',
    city: cityName(r.city) ?? '',
    clock: whole(r.clock, 1e14),
    time: whole(r.time, 1e12),
    level: whole(r.level, 100),
    buildings: readCounts(r.buildings),
    pop: whole(r.pop, 1e9),
    stock: readCounts(r.stock),
    prod: readCounts(r.prod),
    cap: whole(r.cap, big),
    troops: readCounts(r.troops),
    queued: whole(r.queued, 1e9),
    away: whole(r.away, 1e9),
    caravans: whole(r.caravans, 1e6),
    wounded: whole(r.wounded, 1e9),
    ...(r.hurt && typeof r.hurt === 'object' ? { hurt: readCounts(r.hurt) } : {}),
    train: whole(r.train, 1e9),
    deeds: whole(r.deeds, 1e12),
    won: whole(r.won, 1e9),
    lost: whole(r.lost, 1e9),
    lairs: whole(r.lairs, 1e9),
    raids: whole(r.raids, 1e9),
    games: whole(r.games, 1e9),
    haul: whole(r.haul, 1e12),
    haulCap: whole(r.haulCap, big),
    cheated: r.cheated === true,
    lead: whole(r.lead, 1e12),
    seen: whole(r.seen, 1e9),
    ...(r.gemSeen !== undefined ? { gemSeen: whole(r.gemSeen, 1e12) } : {}),
  };
}

/** Потолки отчёта об ошибке. Пять отчётов в час с одного игрока — больше живой человек не пишет. */
export const REPORT_LIMITS = { text: 2000, perHour: 5, scene: 4000, events: 15, event: 200, field: 300 } as const;

/** Что игра знает о себе в минуту отчёта — собирается сама, игрок пишет только текст. */
export interface ReportCtx {
  /** Версия игры — та же строка, что в описи наблюдения. */
  build: string;
  /** Устройство: строка браузера и платформа Telegram. */
  device: string;
  /** Размер экрана и плотность: `390×844 @3`. */
  screen: string;
  /** Текущий экран: город, карта, меню державы с разделом, панель здания. */
  view: string;
  /** Что было со сценой (`scenelog.report`), обрезано. */
  scene: string;
  /** Последние строки летописи партии. */
  events: string[];
  /** Часы устройства в минуту отчёта. */
  clock: number;
  /** Игровой день партии. */
  day: number;
}

/** Тело `/api/report`. */
export interface ReportPut {
  text: string;
  ctx: ReportCtx;
  /**
   * Снимок экрана по желанию игрока — место оставлено (docs/admin.md): поле появится вместе с хранилищем файлов и
   * своим потолком. Сейчас сервер его не принимает и не хранит.
   */
  shot?: null;
}

/** Ответ `/api/report`: номер отчёта или отказ «слишком часто». */
export interface ReportResponse {
  now: number;
  id: string;
}

/** Отчёт из тела запроса: новый объект, всё обрезано по потолкам; пустой текст — `null`. */
export function readReport(v: unknown): ReportPut | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const text = typeof r.text === 'string' ? r.text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, REPORT_LIMITS.text) : '';
  if (!text) return null;
  const c = (r.ctx && typeof r.ctx === 'object' ? r.ctx : {}) as Record<string, unknown>;
  const cut = (x: unknown, max: number = REPORT_LIMITS.field): string => (typeof x === 'string' ? x.slice(0, max) : '');
  return {
    text,
    ctx: {
      build: cut(c.build, 64),
      device: cut(c.device),
      screen: cut(c.screen, 64),
      view: cut(c.view, 120),
      scene: cut(c.scene, REPORT_LIMITS.scene),
      events: Array.isArray(c.events) ? c.events.slice(-REPORT_LIMITS.events).map((e) => cut(e, REPORT_LIMITS.event)).filter(Boolean) : [],
      clock: whole(c.clock, 1e14),
      day: whole(c.day, 1e9),
    },
  };
}

// ---------- Рейтинг игроков (docs/rating.md) ----------
//
// Очки считает сервер: мощь — из описи наблюдения (уровни построек и войско) той же формулой, что игра; победы и взятые
// города — из записи войн, которую клиент не пишет вовсе. Поля «очки» в запросах нет ни одного: подделать нечего.

/**
 * Веса очков — данные дизайна, одно место на сервер и на экран рейтинга.
 * - `power` — 1: мощь и есть мера города, очко за единицу.
 * - `win` — 100: выигранный бой войны между игроками; столько весит отряд в двадцать дубинщиков (5,6 мощи каждый), —
 *   ощутимо, но мощь не перекрывает.
 * - `taken` — 1000: взятый город — главный успех войны, десять побед; это мощь четырёх стартовых городов (230).
 */
export const RATING_WEIGHTS = { power: 1, win: 100, taken: 1000 } as const;

/** Строка рейтинга. Ключа игрока нет — только номер замка, как у реестра (`CastleView.id`). */
export interface RatingRow {
  /** Место: равные очки — одно место. */
  place: number;
  /** Номер замка в реестре и его клетка — касание строки ведёт к городу на карте. */
  id: string;
  x: number;
  y: number;
  city: string;
  /** Имя правителя. */
  name: string;
  points: number;
  power: number;
  /** Жители. */
  pop: number;
  /** Боёв войны выиграно и городов взято — по записи войн сервера. */
  won: number;
  taken: number;
  /** Строка спросившего. */
  mine?: true;
}

export interface RatingResponse {
  now: number;
  rows: RatingRow[];
}

/** Очки по слагаемым — одна формула на сервер и на подсказку экрана. */
export const ratingPoints = (power: number, won: number, taken: number): number =>
  Math.round(power * RATING_WEIGHTS.power + won * RATING_WEIGHTS.win + taken * RATING_WEIGHTS.taken);

// ------------------------------------------------ алмазы (docs/gems.md) ---

/**
 * Виды записей журнала алмазов: стартовые (сервер кладёт при первом входе в эпоху мира), покупка набора (место под
 * оплату; сегодня её нет), покупка в лавке и ускорение стройки. Начисляют только `start` и `purchase` — одной дверью
 * `netlify/lib/gems.creditGems`; `buy` и `rush` только списывают.
 */
export const GEM_KINDS = ['start', 'purchase', 'buy', 'rush'] as const;
export type GemKind = (typeof GEM_KINDS)[number];

/** Припасы лавки — виды склада без золота: золото за алмазы не продаётся. */
export const GEM_GOODS = ['wood', 'stone', 'food', 'hides', 'bones', 'copper', 'iron'] as const satisfies readonly StockKey[];
export type GemGood = (typeof GEM_GOODS)[number];

/** Потолки журнала: ключ повтора, сколько записей лежит, сколько уходит в окно «История» и в записку сохранения. */
export const GEM_LIMITS = { key: 64, keep: 1000, view: 100, deeds: 50, building: 32 } as const;

/** Запись журнала алмазов глазами клиента. Номер — по порядку у игрока, как у указов. */
export interface GemEntry {
  n: number;
  /** Когда, по серверным часам. */
  at: number;
  /** Изменение баланса: +120 стартовые, −15 ускорение. */
  delta: number;
  kind: GemKind;
  /** Лавка: какой припас и сколько. */
  res?: GemGood;
  amount?: number;
  /** Ускорение: постройка и уровень, до которого она достроена. */
  building?: string;
  level?: number;
}

/** Лавка за сегодня: номер суток (`gemrules.shopDay`) и сколько покупок уже сделано. */
export interface GemShop {
  day: number;
  used: number;
}

/**
 * Записка об алмазах — с каждым ответом сохранения и на `/api/gems`. Баланс считает только сервер; дела для партии
 * (`deeds` — покупки лавки и ускорения) партия применяет одной дверью (`src/game/sim/gems.applyGemDeeds`) ровно один
 * раз, по номеру (`GameState.gemSeen`), как указы админа.
 */
export interface GemNote {
  balance: number;
  shop: GemShop;
  /** Записи с делом для партии, номер старше присланного в описи (`WatchCard.gemSeen`). */
  deeds: GemEntry[];
}

/** Ответ `/api/gems`: записка, журнал для «Истории» и, на приказ, — его запись или отказ словами. */
export interface GemsResponse extends GemNote {
  now: number;
  /** Последние записи журнала, свежие в конце. */
  list: GemEntry[];
  /** Запись принятого приказа (и повтора того же ключа — та же запись, второй раз не списано). */
  entry?: GemEntry;
  /** Отказ словами — приказ не исполнен, ничего не списано. */
  error?: string;
}

/**
 * Приказ серверу: купить в лавке или ускорить стройку. `key` — ключ повтора: тот же ключ второй раз не списывает, а
 * возвращает прежнюю запись. Ускорение называет постройку, уровень, остаток работы и цену, которую видел игрок: сервер
 * считает свою по остатку не больше полного труда уровня и не берёт больше показанной.
 */
export type GemOrder =
  | { op: 'buy'; key: string; res: GemGood }
  | { op: 'rush'; key: string; building: string; level: number; work: number; price: number };

const gemKey = (v: unknown): string | null => (typeof v === 'string' && /^[\w.:-]{6,64}$/.test(v) ? v : null);
const isGood = (v: unknown): v is GemGood => typeof v === 'string' && (GEM_GOODS as readonly string[]).includes(v);

/** Приказ из тела запроса: новый объект; кривое — `null`. */
export function readGemOrder(v: unknown): GemOrder | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const key = gemKey(r.key);
  if (!key) return null;
  if (r.op === 'buy') return isGood(r.res) ? { op: 'buy', key, res: r.res } : null;
  if (r.op === 'rush') {
    const building = str(r.building, GEM_LIMITS.building);
    const level = num(r.level);
    const work = num(r.work);
    const price = num(r.price);
    if (!building || level === null || work === null || price === null) return null;
    if (!Number.isInteger(level) || work < 0 || price < 0 || !Number.isInteger(price)) return null;
    return { op: 'rush', key, building, level, work, price };
  }
  return null;
}

/** Запись журнала из ответа или хранилища: новый объект; без номера или вида — `null`. */
export function readGemEntry(v: unknown): GemEntry | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const n = num(r.n);
  const at = num(r.at);
  const delta = num(r.delta);
  if (n === null || n < 1 || !Number.isInteger(n) || at === null || delta === null || !Number.isInteger(delta)) return null;
  if (typeof r.kind !== 'string' || !(GEM_KINDS as readonly string[]).includes(r.kind)) return null;
  const out: GemEntry = { n, at, delta, kind: r.kind as GemKind };
  if (isGood(r.res)) out.res = r.res;
  const amount = num(r.amount);
  if (amount !== null && amount > 0) out.amount = Math.floor(amount);
  const building = str(r.building, GEM_LIMITS.building);
  if (building) out.building = building;
  const level = num(r.level);
  if (level !== null && Number.isInteger(level) && level > 0) out.level = level;
  return out;
}

/** Есть ли у записи дело для партии: лавка кладёт припас, ускорение достраивает. */
export const gemDeed = (e: GemEntry): boolean =>
  (e.kind === 'buy' && e.res !== undefined && (e.amount ?? 0) > 0) || (e.kind === 'rush' && e.building !== undefined && e.level !== undefined);

/** Записка из ответа: кривое или нет её — `null` (сервер до алмазов или ответ без записки). */
export function readGemNote(v: unknown): GemNote | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const bal = num(r.balance);
  if (bal === null) return null;
  const shop = (r.shop && typeof r.shop === 'object' ? r.shop : {}) as Record<string, unknown>;
  const deeds = Array.isArray(r.deeds) ? r.deeds.map(readGemEntry).filter((e): e is GemEntry => e !== null && gemDeed(e)) : [];
  deeds.sort((a, b) => a.n - b.n);
  return {
    balance: Math.max(0, Math.floor(bal)),
    shop: { day: Math.max(0, Math.floor(num(shop.day) ?? 0)), used: Math.max(0, Math.floor(num(shop.used) ?? 0)) },
    deeds: deeds.slice(-GEM_LIMITS.deeds),
  };
}

/** Журнал из ответа `/api/gems`: только целые записи, по номеру. */
export function readGemList(v: unknown): GemEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .map(readGemEntry)
    .filter((e): e is GemEntry => e !== null)
    .sort((a, b) => a.n - b.n)
    .slice(-GEM_LIMITS.view);
}
