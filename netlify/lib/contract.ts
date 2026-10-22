/**
 * Договор между игрой и сервером хранения. Один файл на обе стороны нарочно:
 * разъехавшиеся типы клиента и сервера — это отказ, который виден не при сборке,
 * а на телефоне игрока и только в проде.
 *
 * Модуль чистый: ни узла, ни браузера — его читают и `vite`, и сборщик функций.
 * Импорт один, такой же чистый: правила герба (`src/heraldry/arms.ts`, без `@/` и
 * зависимостей) — набор частей у игры и сервера один (docs/polish.md, П-2).
 *
 * Главное свойство записи: **сервер не понимает, что в ней лежит**. Сохранение
 * племени и сохранение мира — непрозрачные строки, сервер их не разбирает, не
 * проверяет и не судит. Он хранит и раздаёт, а не решает. Отсюда и опись
 * (`SaveCard`): чтобы показать игроку, какие две партии разошлись, кто-то должен
 * знать про день и население — и знает это клиент, который опись и складывает.
 */
import { readArms } from '../../src/heraldry/arms.js';
import type { ProposalAct, ProposalView } from '../../src/world/proposals.js';

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
// Судьёй сервер от этого не становится. Имя он только чистит, мощь и население
// приводит к подтверждённому книгами (`routes/castles.confirmedClaim`, docs/security.md),
// герб пускает только из набора (`heraldry/arms.readArms`, docs/polish.md, П-2). И делает
// одну вещь, которую клиенту доверить нельзя: **выбирает клетку**. Клиент,
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
  /**
   * Герб державы строкой (`heraldry/arms.armsCode`), проверенный по набору. Поля нет у строки, легшей до гербов, и у
   * владельца, который герба не собирал: соседи видят прежний герб-башню (`DEFAULT_ARMS`).
   */
  arms?: string;
  /** Мощь: посёлок плюс дружина. Ровно то, что о себе написал владелец. */
  power: number;
  /** Население: жители, бойцы и новобранцы. */
  pop: number;
  /** Когда владелец последний раз был в игре, по серверным часам. */
  seenAt: number;
  /**
   * Когда замок встал в реестр, по серверным часам: «новый сосед» в вестях края (docs/feed.md). Нет поля — строка
   * старше него, и о ней вестей нет.
   */
  since?: number;
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
  /** Герб строкой из набора (`readArms`). Нет поля — владелец герба не собирал (или клиент до гербов). */
  arms?: string;
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
 *
 * Герб не из набора — отказ всей заявке (`null` → 400), а не тихая подмена: честная игра шлёт только герб, прошедший ту
 * же проверку (`profile/identity.profileArms`), и не из набора его присылает только подделанный клиент (ЗЩ-1).
 */
export function readClaim(v: unknown): CastleClaim | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const arms = r.arms === undefined || r.arms === null || r.arms === '' ? '' : readArms(r.arms) ? (r.arms as string) : null;
  if (arms === null) return null;
  const cap = (raw: unknown, max: number): number => Math.min(max, Math.max(0, Math.floor(num(raw) ?? 0)));
  return {
    name: str(r.name, CASTLE_LIMITS.name) ?? '',
    // Имя города читают все соседи, поэтому сервер чистит его сам тем же правилом, что
    // и клиент: присланное поддельным клиентом дальше реестра сырым не уедет.
    city: cityName(r.city) ?? '',
    ...(arms ? { arms } : {}),
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
 *   (бой был, итог в игре), с `field` — полководец встретил его в поле перехватом; `siege-fall` — хлеб под лагерем логова кончился, город взят;
 * - `war` — отряд соседа идёт на город (нападают); `war-fight` — бой между игроками был;
 *   `war-fall` — осаждённый соседом город пал от голода;
 * - `war-parley` — переговоры у стен (docs/siege_v2.md, раздел 7): пришло предложение (сдача на условиях или дань), его
 *   отклонили или дань приняли;
 * - `war-pact` — пакт между игроками (docs/siege_v2.md, 19.2): пакт предложили — тому, кому предложили; приняли — тому, кто
 *   предлагал;
 * - `war-relief` — выручка союзника (19.2): идёт — осаждённому; бой выручки был — союзнику; не пробилась через рогатки —
 *   союзнику и осаждённому;
 * - `war-spy` — чужой лазутчик напал на город: поджёг склад, обокрал или поднял смуту (docs/spy_pvp.md). Разведка и
 *   пойманный лазутчик нападением не считаются: город ничего не потерял.
 *
 * **Слово владельца 16.10.2026 (ВС-1, docs/NOTIFY.md, раздел 13): в настройках бота пять родов — бои, осады, стройка,
 * указы, соседи.** Родам «стройка» и «указы» нужны свои вести, иначе их переключатели ничего бы не переключали:
 *
 * - `build` — стройка кончена: улучшение постройки дошло до нового уровня. Минуту составляет клиент из партии
 *   осторожным прогнозом (`world/notice.draftBuild`);
 * - `grant` — указ админа лёг в журнал игрока (`/give`, docs/admin.md): что прибавлено или убавлено. Составляет сервер
 *   в минуту указа (`commands.ts`).
 *
 * Напоминаний «вернись в игру» и «награда ждёт» по-прежнему нет и быть не может.
 */
export const NOTICE_KINDS = [
  'raid',
  'raid-fight',
  'siege-fall',
  'siege-phase',
  'war',
  'war-fight',
  'war-fall',
  'war-spy',
  'war-phase',
  'war-parley',
  'war-pact',
  'war-relief',
  'build',
  'grant',
  'stab-near',
  'stab-revolt',
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/**
 * Что может прислать клиент. Войну знает только сервер: её поручения клиент составить не может; указ — тоже: его отдаёт
 * админ на сервере.
 */
export const CLIENT_KINDS = ['raid', 'raid-fight', 'siege-fall', 'siege-phase', 'build', 'stab-near', 'stab-revolt'] as const satisfies readonly NoticeKind[];

/** Группа недовольных в вестях стабильности (docs/stability.md, 2.8) — те же имена, что `StabGroup` игры. */
export const NOTICE_GROUPS = ['folk', 'hungry', 'bonded', 'army'] as const;

/**
 * Исход фазы осады в вести (docs/siege_v2.md, 8.3). Весть идёт о значимом — пролом, мор в лагере, сработавший наказ;
 * «без перемен» и «нехватка в городе» бывают в вести только рядом с наказом. Сдача — падение (`siege-fall`, `war-fall`
 * с `gates`).
 */
export const NOTICE_PHASES = ['breach', 'plague', 'short', 'calm'] as const;
export type NoticePhase = (typeof NOTICE_PHASES)[number];

/** Участь, объявленная городу, — теми же именами, что `Fate` мира. */
export const NOTICE_FATES = ['plunder', 'captives', 'burn'] as const;

/** Что с союзом в вести `war-pact` (ДП-1): предложили, приняли, отклонили, срок вышел, отозвали, разорвали. */
export const NOTICE_PACTS = ['offer', 'made', 'no', 'expired', 'withdrawn', 'broken'] as const;
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
  /** Фаза осады (`siege-phase`, `war-phase`): что выпало, номер фазы, сколько проломов стало, какой наказ сработал. */
  phase?: NoticePhase;
  k?: number;
  breaches?: number;
  order?: WarOrderId;
  /** Падение сдачей — ворота открыли (`siege-fall`, `war-fall`), а не голодом. */
  gates?: true;
  /**
   * Бой набега был не у стен, а в поле: полководец вышел на перехват (`raid-fight`, `world/notice`). Прежде о погоне
   * молчало всё (отзыв тестеров 18.10, docs/feedback.md). Старый сервер поле отбросит — и скажет «ударил в стены».
   */
  field?: true;
  /**
   * Переговоры у стен (`war-parley`): какое предложение и чем кончилось. Нет `answer` — предложение пришло получателю, и
   * `about` — минута, до которой оно стоит; есть — ответ на его собственное предложение. Участь условий — в `fate`.
   */
  offer?: 'terms' | 'tribute';
  answer?: 'yes' | 'no';
  /** Бой войны — вылазка на машину лагеря (`WarBattle.burn`): на какую. Нет — бой не за машину. */
  machine?: WarMachine;
  /** Город союзника, пришедшего на выручку (`war-fight` выручки, `war-relief` осаждённому). Строка до `NOTICE_LIMITS.name`. */
  ally?: string;
  /**
   * Кольцо блокады (Р-5, docs/siege_v2.md, 21): у `war-phase` — замкнули (`on`) или разомкнули (`off`), у `war-fight` — бой
   * вылазки на пост кольца (`off`: победа его размыкает). Нет — не о кольце. Старый сервер поле отбросит.
   */
  ring?: 'on' | 'off';
  /** Обстрел за фазу (`war-phase`, Р-5): сколько построек осаждённого потеряли уровень. */
  lost?: number;
  /** Обстрел за фазу (`war-phase`, Р-5): осаждающему — сколько машин лагеря разбил требушет со стены; осаждённому — разбит ли его требушет (1). */
  broke?: number;
  /**
   * Пакт (`war-pact`, 19.2; ДП-1): получателю предложили союз (`offer`), его предложение приняли (`made`) или отклонили
   * (`no`), срок вышел (`expired`; `role: 'atk'` — предлагал получатель), предложение отозвали (`withdrawn`), союз разорвали
   * (`broken`). Старый сервер шлёт только первые два.
   */
  pact?: (typeof NOTICE_PACTS)[number];
  /** Номер предложения (`ProposalView.id`): кнопка «Открыть игру» под вестью ведёт прямо к нему (ДП-1). */
  deal?: string;
  /** Выручка союзника (`war-relief`, 19.2): идёт (осаждённому), бой был (союзнику), не пробилась через рогатки (обоим). */
  relief?: 'going' | 'fight' | 'turned';
  /** Стройка (`build`): какая постройка (`BuildingTypeId`) и до какого уровня дошла. */
  building?: string;
  level?: number;
  /** Вести стабильности (`stab-near`, `stab-revolt`): чья полоса — податные, голодные, невольники, войско. */
  group?: (typeof NOTICE_GROUPS)[number];
  /** Указ (`grant`): номер у игрока и что он прибавил (+) или убавил (−) — те же виды, что у `AdminGrant`. */
  n?: number;
  stock?: Partial<Record<StockKey, number>>;
  troops?: Partial<Record<TroopKey, number>>;
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
 * Настройки игрока, которые знает игра: рычаг — пишет бот или нет — и пояс. Пояс нужен для «в 14:40» в словах и для
 * тихого часа. Остальное — какие роды вестей, тихий час, «только срочное» — правится только в боте (`/notify`, ВС-1,
 * docs/NOTIFY.md, раздел 13) и лежит рядом в записи исходящих (`notify.BotPrefs`): игра его не присылает и затереть не
 * может.
 */
export interface NotifyPrefs {
  on: boolean;
  /** Пояс игрока (`Intl…timeZone`). Пустая строка — пояс по умолчанию (`notify.DEFAULT_TZ`, Москва). */
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
      // Пакт и весть союзнику о его выручке — не о стороне войны: у союзника её нет (docs/siege_v2.md, 19.2).
      if (role) facts.role = role;
      else if (kind !== 'war-pact' && kind !== 'war-relief') return null;
      const mode = oneOf(WAR_MODES, p.mode);
      const site = oneOf(['wall', 'sortie', 'camp', 'joint'] as const, p.site);
      const by = oneOf(['atk', 'def'] as const, p.by);
      if (mode) facts.mode = mode;
      if (site) facts.site = site;
      if (by) facts.by = by;
      if (typeof p.won === 'boolean') facts.won = p.won;
      if (p.taken === true) facts.taken = true;
      const machine = oneOf(WAR_MACHINES, p.machine);
      if (machine) facts.machine = machine;
      const ally = str(p.ally, NOTICE_LIMITS.name);
      if (ally && PLAIN.test(ally)) facts.ally = ally;
      const ring = oneOf(['on', 'off'] as const, p.ring);
      if (ring) facts.ring = ring;
    }
    // Переговоры: какое предложение и чем кончилось. Без них своя запись сервера, перечитанная из хранилища, говорила бы о
    // любом предложении «дань» и теряла бы отказ и взятую дань (docs/siege_v2.md, 19.2).
    if (kind === 'war-parley') {
      const offer = oneOf(['terms', 'tribute'] as const, p.offer);
      if (!offer) return null;
      facts.offer = offer;
      const answer = oneOf(['yes', 'no'] as const, p.answer);
      if (answer) facts.answer = answer;
    }
    if (kind === 'war-pact') {
      const pact = oneOf(NOTICE_PACTS, p.pact);
      if (!pact) return null;
      facts.pact = pact;
      const deal = str(p.deal, 64);
      if (deal && /^[\w.-]+$/.test(deal)) facts.deal = deal;
    }
    if (kind === 'war-relief') {
      const relief = oneOf(['going', 'fight', 'turned'] as const, p.relief);
      if (!relief) return null;
      facts.relief = relief;
    }
    // Поля фазы осады — только у вестей о фазе и о падении.
    if (kind.endsWith('-phase')) {
      const phase = oneOf(NOTICE_PHASES, p.phase);
      const k = num(p.k);
      if (!phase || k === null || k < 1 || k > 99) return null;
      facts.phase = phase;
      facts.k = Math.floor(k);
      const breaches = num(p.breaches);
      if (breaches !== null) facts.breaches = Math.min(3, Math.max(0, Math.floor(breaches)));
      const order = oneOf(WAR_ORDER_IDS, p.order);
      if (order) facts.order = order;
      // Обстрел за фазу (Р-5): числа малые — машин и построек у города немного.
      const lost = num(p.lost);
      if (lost !== null && lost >= 1 && lost <= 99) facts.lost = Math.floor(lost);
      const broke = num(p.broke);
      if (broke !== null && broke >= 1 && broke <= 9) facts.broke = Math.floor(broke);
    }
    if (kind.endsWith('-fall') && p.gates === true) facts.gates = true;
    if (kind === 'raid-fight' && p.field === true) facts.field = true;
    if (kind === 'build') {
      const building = str(p.building, 32);
      const level = num(p.level);
      if (!building || !/^[a-z_]+$/.test(building) || level === null || level < 2 || level > 99) return null;
      facts.building = building;
      facts.level = Math.floor(level);
    }
    if (kind === 'stab-near' || kind === 'stab-revolt') {
      const group = oneOf(NOTICE_GROUPS, p.group);
      if (!group) return null;
      facts.group = group;
    }
    if (kind === 'grant') {
      const n = num(p.n);
      const stock = readDeltas(p.stock, STOCK_KEYS);
      const troops = readDeltas(p.troops, TROOP_KEYS);
      if (n === null || n < 1 || Object.keys(stock).length + Object.keys(troops).length === 0) return null;
      facts.n = Math.floor(n);
      if (Object.keys(stock).length) facts.stock = stock;
      if (Object.keys(troops).length) facts.troops = troops;
    }
    keys.add(key);
    out.push({ key, kind, fireAt, until, p: facts });
  }
  return out;
}

/** Разбор настроек игры: неизвестное и кривое — умолчание, а не отказ. Настройки бота — `notify.readBotPrefs`. */
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
  /**
   * Готовое орудие на башне (`world/bombard.TowerGun`, `PlayerProfile.tower`): башня бьёт по лагерю под городом — и по лагерю
   * игрока тоже (docs/siege_v2.md, раздел 5). Нет поля — орудия нет или слепок старого клиента.
   */
  tower?: WarTowerGun;
  /**
   * Где полководец в минуту слепка — клетка мира на клиенте (`LocalWorld.figureAt`). Удар по лагерю у своих стен и выручка
   * называют, откуда идут (`WarOrder.from`), и сервер сверяет это место с этим: дальше, чем полководец мог уйти за время
   * со слепка, — отказ (docs/security.md, ЗЩ-2). Нет поля — слепок старого клиента: сверки нет.
   */
  gen?: Spot;
}

/** Клетка мира: место полководца в слепке и в приказе. */
export interface Spot {
  x: number;
  y: number;
}

/** Клетка из того, что прислали: два конечных числа в пределах мира с запасом. Нет или мусор — `null`. */
export function readSpot(v: unknown): Spot | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const x = num(r.x);
  const y = num(r.y);
  if (x === null || y === null || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) return null;
  return { x, y };
}

/** Орудие башни в слепке обороны — та же форма, что у мира (`world/bombard.TowerGun`). */
export interface WarTowerGun {
  slow: number;
  thin: number;
  crew: number;
  seats: number;
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
  /** `camp` — в осадном лагере копится залп за фазу (docs/siege_v2.md, 8.4). */
  mode: 'drain' | 'fill' | 'camp' | 'hold';
  homeAt?: number;
  stopAt?: number;
}

/** Отметка энергии из приказа: новый объект; запас не выше полного, мусор — нет отметки. */
export function readEnergy(v: unknown): WarEnergy | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const value = num(r.value);
  const at = num(r.at);
  const mode = r.mode === 'drain' || r.mode === 'fill' || r.mode === 'camp' || r.mode === 'hold' ? r.mode : null;
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
  /**
   * Штраф кости нападающему (`battle.GroundPenalty`): у боя за лагерь — его укрепления (`works`), у штурма — стена
   * (`wall`, `world/wall`). Нет — ноль.
   */
  ground?: { land?: number; crossing?: number; works?: number; wall?: number };
  /** Ширина боя у стены и ворота посреди боя (`world/wall.wallFront`). Нет — ширина фронта, бой в поле. */
  width?: number;
  fire?: number;
  widen?: { round: number; width: number; wall: number };
}

/** Что полководец сделал в своём лагере (`world/siegecraft.Craft`): сколько раз укрепил, сколько залпов дал. */
export interface WarCraft {
  fort?: number;
  shots?: number;
  /** Проломов в стене к минуте боя (0..3) — только в записи боя (`siegecraft.craftAt`). */
  breach?: number;
}

/** Исход фазы осады (`world/siegeroll.PhaseOut`). */
export const WAR_PHASE_OUTS = ['plague', 'calm', 'short', 'breach', 'gates'] as const;
export type WarPhaseOut = (typeof WAR_PHASE_OUTS)[number];

/** Брошенная фаза осады — строка журнала (`world/siegeroll.PhaseRow`). Пишет её сервер в минуту фазы. */
export interface WarPhaseRow {
  at: number;
  die: number;
  mods: Partial<Record<'breach' | 'volley' | 'machine' | 'general' | 'hunger' | 'blockade' | 'progress' | 'wall', number>>;
  out: WarPhaseOut;
  waste: number;
  orders?: WarOrderId[];
  /** Выстрелы фазы (Р-5, `world/siegeroll.Shot`): артиллерия лагеря и требушет на стене. Нет — не стреляли. */
  shots?: WarShot[];
  gun?: WarShot[];
}

/** Выстрел фазы (`world/siegeroll.Shot`): чья машина, попала ли и во что. */
export interface WarShot {
  by: 'mangonel' | 'trebuchet' | 'gun';
  hit: boolean;
  building?: string;
  lost?: true;
  gun?: true;
  camp?: true;
  machine?: WarMachine;
}

/** Наказ, сработавший в минуту фазы (`world/siegeroll.OrderId`; тест сверяет). */
export const WAR_ORDER_IDS = ['volley', 'storm', 'repair', 'ration'] as const;
export type WarOrderId = (typeof WAR_ORDER_IDS)[number];

/** Наказы осаждённого на отлучку (`world/siegeroll.DefendOrders`): чинить пролом, урезать паёк. */
export interface WarDefend {
  repair?: boolean;
  ration?: boolean;
  /** Принять сдачу на условиях не хуже этой участи (docs/siege_v2.md, 8.3; этап 2е). */
  terms?: NoticeFate;
}

/** Наказы осаждённого из приказа: только известные поля. */
export function readDefend(v: unknown): WarDefend {
  if (!v || typeof v !== 'object') return {};
  const r = v as Record<string, unknown>;
  const terms = NOTICE_FATES.find((f) => f === r.terms);
  return { ...(r.repair === true ? { repair: true } : {}), ...(r.ration === true ? { ration: true } : {}), ...(terms ? { terms } : {}) };
}

/** Наказы осаждающего на отлучку (`world/siegeroll.SiegeOrders`): залп каждую фазу, штурм при N проломах. */
export interface WarOrders {
  volley?: boolean;
  storm?: number;
  /** Принять дань не меньше справедливой (docs/siege_v2.md, 8.3; этап 2е). */
  tribute?: boolean;
}

/** Наказы из приказа: только известные поля, штурм — 1..3 пролома. */
export function readOrders(v: unknown): WarOrders {
  if (!v || typeof v !== 'object') return {};
  const r = v as Record<string, unknown>;
  const storm = typeof r.storm === 'number' && Number.isFinite(r.storm) ? Math.min(3, Math.max(0, Math.floor(r.storm))) : 0;
  return { ...(r.volley === true ? { volley: true } : {}), ...(storm > 0 ? { storm } : {}), ...(r.tribute === true ? { tribute: true } : {}) };
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
  /** Проёмы штурма (`world/wall.Opening`) — только показ: ролик рисует выбранный способ. Нет — запись до стены-прохода. */
  openings?: { id: 'breach' | 'gate' | 'tower' | 'ladders' | 'scaling'; share: number; faces: number; round: number; horse: boolean }[];
  /** Вылазка на машину лагеря (docs/siege_v2.md, раздел 5): на какую. Победа её сожгла. Нет — бой не за машину. */
  burn?: WarMachine;
  /** Вылазка на пост кольца блокады (Р-5): победа размыкает кольцо. Нет — бой не за кольцо. */
  breakout?: true;
  /**
   * Выручка: по лагерю ударил сосед-союзник осаждённого (замок), его дружина — `genTroops`/`genLost`. Нет поля — бил сам
   * город. Свою дружину город с этого боя не списывает — списывает союзник.
   */
  ally?: string;
}

/** Участь взятого города — посчитана дверью `spoils.fate`, у обеих сторон одними числами. */
export interface WarFall {
  at: number;
  fate: NoticeFate;
  /** Штурм, голод или сдача — ворота открыли на фазе осады (участь на ступень мягче, гарнизон уходит живым). */
  by: 'storm' | 'hunger' | 'gates';
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
  /** Сдача на условиях (docs/siege_v2.md, 7.1): участь — из принятых условий, а не на ступень мягче объявленной. */
  terms?: true;
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
  wood?: { front: number; rear: number; machines?: number; at?: number; base?: { front: number; rear: number; machines?: number } };
  builders?: number;
  /** Дела полководца в этом лагере (`SiegeWindow.craft`). */
  craft?: WarCraft;
  /** Ход осады фазами (`world/siegeroll`, docs/siege_v2.md, раздел 2): уровень частокола, дни пути лагеря от дома. */
  wall?: number;
  homeDays?: number;
  /**
   * Журнал дел с минутой (`SiegeWindow.log`): залпы и починки; с Р-5 — цель артиллерии лагеря и требушета на стене, кольцо
   * блокады (`world/shelling`, `world/blockade`). Нет поля — лагерь до фаз.
   */
  log?: { at: number; act: 'volley' | 'repair' | 'aim' | 'gunAim' | 'blockade'; aim?: WarAim | WarGunAim; on?: boolean; why?: 'order' | 'ratio' | 'sortie' | 'relief' }[];
  /** Брошенные фазы (`SiegeWindow.phases`). */
  phases?: WarPhaseRow[];
  /** Наказы осаждающего (`SiegeWindow.orders`). */
  orders?: WarOrders;
  /** Осадные машины лагеря — очередь заказов (`SiegeWindow.machines`, `world/machines`). Нет поля — не заказывали. */
  machines?: { id: WarMachine; at: number; spent?: number; burned?: true; broke?: true }[];
  /** Требушет на стене осаждённого (`SiegeWindow.guns`, Р-5). Нет поля — не ставили. */
  guns?: { id: WarMachine; at: number; spent?: number; burned?: true; broke?: true }[];
  /** Постройки города под обстрелом «по городу» (`SiegeWindow.targets`, Р-5): заморожены при постановке лагеря. */
  targets?: string[];
  /** Обстрел лагеря с башни города (`SiegeWindow.fire`, `world/bombard`). Нет поля — башня не бьёт. */
  fire?: { slow: number; thin: number; at: number; base: number };
  /** Осадный паёк осаждённого (`SiegeWindow.ration`). Нет поля — обычный. */
  ration?: boolean;
  /** Наказы осаждённого (`SiegeWindow.defend`). */
  defend?: WarDefend;
  /** Отметки «осада» полководца похода, при постановке лагеря (`SiegeWindow.lead`, docs/siege_v2.md, 2.3). Нет — ноль. */
  lead?: number;
  /** Переговоры у стен (`SiegeWindow.offers`, `world/parley`, раздел 7). Нет поля — никто ничего не предлагал. */
  offers?: WarOffer[];
}

/** Предложение у стен (`world/parley.SiegeOffer`): сдача на условиях от осаждающего, дань за снятие от осаждённого. */
export interface WarOffer {
  kind: 'terms' | 'tribute';
  at: number;
  until: number;
  fate?: NoticeFate;
  price?: number;
  answer?: 'yes' | 'no';
  answeredAt?: number;
}

/**
 * Дань, принятая осаждающим (docs/siege_v2.md, 7.3): добро переходит от города походу той же дверью дележа, что добыча
 * (`spoils.plunder`), — посчитано сервером, у обеих сторон одними числами. Применяет каждая сторона сама, один раз, по
 * отметке `warTributeId` в списке принятого.
 */
export interface WarTribute {
  at: number;
  /** Что ушло данью: припасы и казна. */
  taken: Counts;
  /** Сколько осталось в тайнике. */
  hidden: number;
}

/** Осадные машины (`world/data/machines.MACHINE_IDS`; тест сверяет). */
export const WAR_MACHINES = ['ladders', 'ram', 'tower', 'mangonel', 'trebuchet'] as const;
export type WarMachine = (typeof WAR_MACHINES)[number];
/** Цели артиллерии лагеря и требушета на стене (`world/data/shelling.AIMS`, `GUN_AIMS`; тест сверяет). */
export const WAR_AIMS = ['wall', 'town', 'engines'] as const;
export type WarAim = (typeof WAR_AIMS)[number];
export const WAR_GUN_AIMS = ['camp', 'machines'] as const;
export type WarGunAim = (typeof WAR_GUN_AIMS)[number];
/** Доли древесины машинам (`world/data/machines.MACHINE_SHARES`; тест сверяет). */
export const WAR_MACHINE_SHARES: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

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

/** Чем кончилась: взяли город, отбили, отозвали, сняли осаду, город исчез из реестра, город дал дань (`paid`). */
export type WarEnd = 'taken' | 'beaten' | 'recalled' | 'retreat' | 'lifted' | 'gone' | 'paid';

/** Война глазами игрока. Ключей игроков в ней нет — только замки. */
export interface WarView {
  id: string;
  /**
   * Чья это война для спросившего: он идёт (`atk`), на него идут (`def`) или осадили его союзника по пакту (`ally`) — тогда
   * он может прийти на выручку (docs/siege_v2.md, раздел 5).
   */
  role: 'atk' | 'def' | 'ally';
  /** Замок спросившего-союзника (`role: 'ally'`): по нему он узнаёт свою выручку и свои бои (`WarRelief.castle`, `WarBattle.ally`). */
  me?: string;
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
  /** Поход «Блокада» (Р-5): в минуту постановки лагерь замыкает кольцо, если мощи вчетверо. Нет — обычная осада. */
  ring?: true;
  camp?: WarCamp;
  /** Журнал фаз снятой осады (`WarCamp.phases`, переносится при снятии лагеря). Нет поля — осады не было или она идёт. */
  phases?: WarPhaseRow[];
  /** Когда лагерь доедает город. */
  starvesAt?: number;
  strike?: WarStrike;
  /** Выручка соседей-союзников: идут на лагерь, бьют в минуту прихода (по одной от союзника). Нет — никто не идёт. */
  reliefs?: WarRelief[];
  /** Удары из поля, не пробившиеся через рогатки в минуту прихода (`WarTurned`). Нет — таких не было. */
  turned?: WarTurned[];
  /** Обратный путь: откуда и когда дома. */
  backFrom?: { x: number; y: number };
  backAt?: number;
  battles: WarBattle[];
  fall?: WarFall;
  /** Дань, принятая лагерем (docs/siege_v2.md, 7.3): добро перешло, лагерь снят. Нет — дани не было. */
  tribute?: WarTribute;
  end?: WarEnd;
  endAt?: number;
}

/** Выручка соседа-союзника (docs/siege_v2.md, раздел 5): идёт на лагерь с тыла, бьётся в минуту прихода. */
export interface WarRelief {
  /** Замок союзника и имя его города. */
  castle: string;
  city: string;
  /** Когда вышла — с этой минуты осаждённому весть «союзник идёт» (docs/siege_v2.md, 19.2). Нет — выручка старше поля. */
  sent?: number;
  at: number;
  army: WarArmy;
}

/**
 * Удар из поля, не пробившийся через рогатки лагеря (docs/siege_v2.md, 19.2): в минуту прихода проход был занят, боя не было,
 * дружина цела и стоит в поле. Донесение — у того, чья дружина: у союзника — его выручка (`ally`), у города — удар его
 * полководца. Применяет каждая сторона сама, один раз, по отметке `warTurnedId`.
 */
export interface WarTurned {
  at: number;
  /** Сколько ещё проход был занят в ту минуту, мс (`works.gateBusyText`). */
  waitMs: number;
  /** Сколько бойцов шло. */
  men: number;
  /** Выручка союзника: его замок и имя его города. Нет поля — удар полководца самого города. */
  ally?: string;
  city?: string;
}

/** Пакт между игроками глазами спросившего: заключён, он предложил или предложили ему. */
export interface WarPact {
  castle: string;
  city: string;
  state: 'pact' | 'offered' | 'asked';
  at: number;
}

/** Ответ войны: свои войны и серверное «сейчас»; у отказанного приказа — отказ словами. */
export interface WarResponse {
  now: number;
  wars: WarView[];
  /** Пакты и предложения пакта спросившего (docs/siege_v2.md, раздел 5: выручка). Нет — ни одного. */
  pacts?: WarPact[];
  /**
   * Предложения спросившего (ДП-1): ждущие ответа — свои и ему, и закрытые за последние дни — с итогом. Нет — ни одного.
   * Старый сервер поля не шлёт: «Вести» тогда предложений не показывают.
   */
  proposals?: ProposalView[];
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

/**
 * Приказы войны. Исхода в них нет ни в каком виде — его считает сервер.
 *
 * Участь меняют в лагере так же, как под логовом (docs/siege_audit.md, решение 2): `fate` — объявить новую, `storm` с
 * участью — штурмовать с ней. Нет поля участи у штурма — та, что объявлена (старый клиент шлёт так).
 */
export type WarOrder =
  // `blockade` — поход «Блокада» из «Походов» (Р-5): дойдёт, встанет лагерем и замкнёт кольцо, если хватит мощи.
  | { op: 'march'; target: string; mode: WarMode; fate: NoticeFate; army: WarArmy; blockade?: true }
  | { op: 'recall'; id: string }
  | { op: 'storm'; id: string; fate?: NoticeFate; machines?: WarMachine[] }
  | { op: 'wood'; id: string; machines: number }
  | { op: 'machine'; id: string; machine: WarMachine }
  | { op: 'fate'; id: string; fate: NoticeFate }
  | { op: 'retreat'; id: string }
  | { op: 'sortie'; id: string; troops: Counts }
  | { op: 'craft'; id: string; act: WarCraftAct }
  | { op: 'orders'; id: string; orders: WarOrders }
  | { op: 'strike'; id: string; army: WarArmy; joint: boolean; walkMs: number; from: Spot }
  | { op: 'repair'; id: string }
  | { op: 'ration'; id: string; on: boolean }
  | { op: 'defend'; id: string; defend: WarDefend }
  | { op: 'sally'; id: string; machine: WarMachine; troops: Counts }
  // Р-5 (docs/siege_v2.md, 21.1): цель артиллерии лагеря (осаждающий: стены, город, машины) или требушета на стене
  // (осаждённый: лагерь, машины) — сторону решает сервер по тому, кто шлёт; кольцо блокады; вылазка на пост кольца.
  | { op: 'aim'; id: string; aim: WarAim | WarGunAim }
  | { op: 'blockade'; id: string; on: boolean }
  | { op: 'breakout'; id: string; troops: Counts }
  | { op: 'surrender'; id: string }
  | { op: 'offer'; id: string; kind: 'terms' | 'tribute'; fate?: NoticeFate }
  | { op: 'answer'; id: string; kind: 'terms' | 'tribute'; yes: boolean }
  | { op: 'relief'; id: string; army: WarArmy; walkMs: number; from: Spot }
  | { op: 'pact'; target: string }
  | { op: 'unpact'; target: string }
  // Ответ на предложение соседа по номеру (ДП-1, `world/proposals`): принять, отклонить или отозвать своё. Проверяет сервер:
  // отвечает адресат, отзывает предложивший, пока срок не вышел.
  | { op: 'deal'; id: string; act: ProposalAct }
  | { op: 'spy'; target: string; deed: RivalDeed; energy?: WarEnergy; shown: { chance: number; peril: number }; at: number };

/** Отметка падения города в списке принятого (`WarSheet.seen`): одна на клиент и на сервер. */
export const warFallId = (war: string): string => `${war}.fall`;

/** Отметка дани в списке принятого (`WarSheet.seen`): одна на клиент и на сервер (docs/siege_v2.md, 7.3). */
export const warTributeId = (war: string): string => `${war}.tribute`;

/**
 * Отметка починки пролома в списке принятого (`WarSheet.seen`): защитник платит за неё деревом и камнем со своего склада
 * один раз — когда увидел её в журнале лагеря (`LocalWorld.stepWars`); сервер до этого числит её цену за ним (docs/siege_v2.md,
 * раздел 5).
 */
export const warRepairId = (war: string, at: number): string => `${war}.r${at}`;

/** Отметка требушета на стене (Р-5), за который защитник заплатил: его цена списывается один раз, как у починки. */
export const warGunId = (war: string, at: number): string => `${war}.g${at}`;

/** Отметка попадания обстрела в постройку, отнявшего уровень (Р-5): фаза `k`, выстрел `i` — город теряет уровень один раз. */
export const warShotId = (war: string, k: number, i: number): string => `${war}.s${k}.${i}`;

/** Отметка кольца блокады (Р-5), замкнутого или разомкнутого в минуту `at`: строка летописи о нём ложится один раз. */
export const warRingId = (war: string, at: number): string => `${war}.b${at}`;

/** Отметка удара, не пробившегося через рогатки (`WarTurned`), в списке принятого: донесение о нём ложится один раз. */
export const warTurnedId = (war: string, at: number): string => `${war}.t${at}`;

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
    ...(readTower(r.tower) ? { tower: readTower(r.tower) } : {}),
    ...(readSpot(r.gen) ? { gen: readSpot(r.gen)! } : {}),
  };
}

/** Орудие башни из слепка: доли — 0..1, расчёт и места — целые до десятка. Нет или мусор — нет. */
function readTower(v: unknown): WarTowerGun | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const crew = num(r.crew);
  if (crew === null || crew <= 0) return undefined;
  return {
    slow: Math.min(1, real(r.slow, 1)),
    thin: Math.min(1, real(r.thin, 1)),
    crew: Math.min(10, Math.floor(crew)),
    seats: Math.min(10, Math.floor(real(r.seats, 10))),
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

/**
 * Сколько принятых итогов (боёв, падений, тайных дел) слепок помнит сверх тех, что сервер ещё отдаёт. Было 200 — меньше,
 * чем итогов лежит у сервера на одного игрока за неделю (войн и дел до `WAR_MAX` каждых): вытесненный номер сервер
 * снова вычитал из слепка, а игра снова применяла (docs/bughunt.md, «Больше двухсот итогов»).
 */
export const WAR_SEEN_MAX = 2000;

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
      // Кольцо — только у осады: штурм с ходу кольца не замыкает.
      const ring = mode === 'siege' && r.blockade === true ? { blockade: true as const } : {};
      return target && mode && fate && army ? { op: 'march', target, mode, fate, army, ...ring } : null;
    }
    case 'aim': {
      const aim = [...WAR_AIMS, ...WAR_GUN_AIMS].find((a) => a === r.aim);
      return id && aim ? { op: 'aim', id, aim } : null;
    }
    case 'blockade':
      return id && typeof r.on === 'boolean' ? { op: 'blockade', id, on: r.on } : null;
    case 'breakout':
      return id ? { op: 'breakout', id, troops: readCounts(r.troops) } : null;
    case 'recall':
    case 'retreat':
      return id ? { op: r.op, id } : null;
    case 'storm': {
      const fate = NOTICE_FATES.find((f) => f === r.fate);
      // Машины штурма — из списка, без повторов; нет поля — все готовые (старый клиент шлёт так).
      const machines = Array.isArray(r.machines) ? WAR_MACHINES.filter((e) => (r.machines as unknown[]).includes(e)) : null;
      return id ? { op: 'storm', id, ...(fate ? { fate } : {}), ...(machines ? { machines } : {}) } : null;
    }
    case 'wood': {
      const share = WAR_MACHINE_SHARES.find((x) => x === r.machines);
      return id && share !== undefined ? { op: 'wood', id, machines: share } : null;
    }
    case 'machine': {
      const machine = WAR_MACHINES.find((e) => e === r.machine);
      return id && machine ? { op: 'machine', id, machine } : null;
    }
    case 'fate': {
      const fate = NOTICE_FATES.find((f) => f === r.fate);
      return id && fate ? { op: 'fate', id, fate } : null;
    }
    case 'sortie':
      return id ? { op: 'sortie', id, troops: readCounts(r.troops) } : null;
    case 'craft': {
      const act = WAR_CRAFTS.find((a) => a === r.act);
      return id && act ? { op: 'craft', id, act } : null;
    }
    case 'orders':
      return id ? { op: 'orders', id, orders: readOrders(r.orders) } : null;
    case 'strike': {
      const army = readArmy(r.army);
      const walk = num(r.walkMs);
      const from = readSpot(r.from);
      return id && army && walk !== null && from
        ? { op: 'strike', id, army, joint: r.joint === true, walkMs: Math.min(24 * 3600_000, Math.max(0, walk)), from }
        : null;
    }
    case 'repair':
    case 'surrender':
      return id ? { op: r.op, id } : null;
    case 'ration':
      return id && typeof r.on === 'boolean' ? { op: 'ration', id, on: r.on } : null;
    case 'offer': {
      const kind = r.kind === 'terms' || r.kind === 'tribute' ? r.kind : null;
      const fate = NOTICE_FATES.find((f) => f === r.fate);
      return id && kind ? { op: 'offer', id, kind, ...(kind === 'terms' && fate ? { fate } : {}) } : null;
    }
    case 'answer': {
      const kind = r.kind === 'terms' || r.kind === 'tribute' ? r.kind : null;
      return id && kind && typeof r.yes === 'boolean' ? { op: 'answer', id, kind, yes: r.yes } : null;
    }
    case 'defend':
      return id ? { op: 'defend', id, defend: readDefend(r.defend) } : null;
    case 'sally': {
      const machine = WAR_MACHINES.find((e) => e === r.machine);
      return id && machine ? { op: 'sally', id, machine, troops: readCounts(r.troops) } : null;
    }
    case 'relief': {
      const army = readArmy(r.army);
      const walk = num(r.walkMs);
      const from = readSpot(r.from);
      return id && army && walk !== null && from ? { op: 'relief', id, army, walkMs: Math.min(24 * 3600_000, Math.max(0, walk)), from } : null;
    }
    case 'pact':
    case 'unpact': {
      const target = str(r.target, 64);
      return target ? { op: r.op, target } : null;
    }
    case 'deal': {
      // Список — тот же, что `world/proposals.PROPOSAL_ACTS` (тип держит `satisfies`): значением оттуда не берётся, чтобы
      // словарь предложений мог брать имя города у договора (`cityOr`) без кольца импортов.
      const act = (['yes', 'no', 'withdraw'] as const satisfies readonly ProposalAct[]).find((a) => a === r.act);
      return id && act ? { op: 'deal', id, act } : null;
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
export const STOCK_KEYS = ['wood', 'stone', 'food', 'hides', 'charcoal', 'copper', 'iron', 'gold'] as const;
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

/**
 * Кости стали углём (10.10.2026, docs/economy.md): запись, легшая на сервер до этого (указ `/give`, покупка лавки), читается
 * с углём вместо костей — иначе неприменённый указ или оплаченная покупка пропали бы молча. Партия и мир приводятся своей
 * ступенью (`game/charcoal`); здесь — только чтение того, что сервер хранит.
 */
const boneless = (v: unknown): unknown => {
  if (v === 'bones') return 'charcoal';
  if (!v || typeof v !== 'object' || !('bones' in v)) return v;
  const { bones, ...rest } = v as Record<string, unknown>;
  const both = typeof bones === 'number' && typeof rest.charcoal === 'number';
  return { ...rest, charcoal: both ? (rest.charcoal as number) + (bones as number) : (rest.charcoal ?? bones) };
};

/** Указ из ответа сервера или из хранилища: новый объект; без номера или пустой — `null`. */
export function readGrant(v: unknown): AdminGrant | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const n = num(r.n);
  const at = num(r.at);
  if (n === null || n < 1 || !Number.isInteger(n) || at === null) return null;
  const stock = readDeltas(boneless(r.stock), STOCK_KEYS);
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
  /**
   * Невольники (`bondedTotal`): руки стройки. Книга стройки сервера (docs/pvp.md, раздел 7) считает их не больше жителей.
   * Нет поля — опись до книги стройки: стройка идёт одними жителями.
   */
  bonded?: number;
  /**
   * Идущая стройка — первая в очереди (`derived.currentSite`): тип, до какого уровня и сколько работы сделано. По ней книга
   * стройки подтверждает работу, а сервер считает остаток для цены ускорения. Нет поля — стройки нет.
   */
  site?: { type: string; level: number; done: number };
  /**
   * Очередь стройки по порядку (СТ-1, docs/ui_v2.md): тип и до какого уровня; первая — идущая стройка (`site`). По ней книга
   * стройки сервера держит порядок, оплату заложенного и возврат отменённого (`town.queueStep`, `watch.flagsBetween`), а
   * ускорение за алмазы отказывает ждущему. Нет поля — опись до очереди: книга видит одну первую стройку.
   */
  queue?: { type: string; level: number }[];
  /** Сколько бойцов казармы и конюшня выучат за игровой день — не больше. */
  train: number;
  /**
   * Разовые дела партии одним счётчиком: события, бои, логова, набеги, покупки, ежедневки, промыслы, указы. Дело
   * может разом принести добро, поэтому между двумя описями с одинаковым счётчиком рост склада обязан уложиться в
   * выработку.
   */
  deeds: number;
  /**
   * Разовые траты партии одним счётчиком (`stats.outlays`): плата за заказ, пир, наём, покупка, обряд, мятеж, убыль от мира
   * без боя. Между двумя описями без дел и трат склад убывает только расходом — хлебом, дровами, жалованьем, — и книга
   * запасов сервера держит его «не меньше» (`goods.goodsStep`, docs/security.md, ЗЩ-2). Нет поля — опись до книги запасов:
   * каждый промежуток считается с тратой.
   */
  outlays?: number;
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
  /**
   * Стабильность державы (docs/stability.md, 2.7): ступень и счёт для книги стабильности — сколько ступеней куплено и
   * очков каждого вида на них ушло, сколько мятежей поднялось и сколько подавлено боем. Нет поля — опись до стабильности.
   */
  stab?: WatchStab;
  /**
   * Вести державы (СБ-2, docs/stability.md, «СБ-2»): сколько ответов за партию и последние из них — для книги вестей
   * сервера (правило «crown»). Нет поля — опись до вестей державы.
   */
  crown?: WatchCrown;
  /**
   * Совет Ратуши (РТ-1, docs/city_v3.md, «Решения РТ-1»): кто сидит — должность, номер просителя, уровень, черта, минута
   * найма — и счёт наймов, платы за найм и жалованья, для книги совета сервера (правило «council»). Нет поля — опись до совета
   * или совета не было.
   */
  council?: WatchCouncil;
}

/** Советник в описи: должность и черта — строкой как есть (чужая — флаг книги, а не тихая потеря), уровень — целым. */
export interface WatchAdvisor {
  post: string;
  n: number;
  level: number;
  trait: string;
  at: number;
}

/** Совет в описи — то, что сверяет сервер (`watch.councilFlags`, правило «council»). */
export interface WatchCouncil {
  seats: WatchAdvisor[];
  hired: number;
  fees: number;
  paid: number;
}

/** Сколько мест совета опись везёт самое большее: должностей три — лишние говорят о подделке, и сервер их видит. */
const COUNCIL_READ_MAX = 8;

/** Совет описи: места — должность и черта строкой до 16 знаков, номер и минута — неотрицательные, уровень — целым ±99. */
function readCouncil(v: unknown): Pick<WatchCard, 'council'> {
  if (!v || typeof v !== 'object') return {};
  const r = v as Record<string, unknown>;
  const seats: WatchAdvisor[] = [];
  for (const x of (Array.isArray(r.seats) ? r.seats : []).slice(0, COUNCIL_READ_MAX)) {
    if (!x || typeof x !== 'object') continue;
    const a = x as Record<string, unknown>;
    const post = str(a.post, 16);
    const trait = str(a.trait, 16);
    const level = num(a.level);
    if (!post || !trait || level === null) continue;
    seats.push({ post, n: whole(a.n, 1e12), level: Math.round(Math.max(-99, Math.min(99, level))), trait, at: whole(a.at, 1e12) });
  }
  return { council: { seats, hired: whole(r.hired, 1e9), fees: whole(r.fees, 1e12), paid: whole(r.paid, 1e12) } };
}

/** Ответ на весть державы в описи: номер за партию, вид, номер ответа и игровая секунда прихода. */
export interface WatchCrownEntry {
  n: number;
  id: string;
  opt: number;
  at: number;
}

/** Книга вестей в описи — то, что сверяет сервер (`watch.crownFlags`, правило «crown»). */
export interface WatchCrown {
  n: number;
  last: WatchCrownEntry[];
}

/** Сколько ответов опись везёт самое большее — по одному на строку книги игры (`crownrules.CROWN_BOOK`), с запасом. */
const CROWN_LAST_MAX = 24;

/**
 * Книга вестей описи: счёт — неотрицательным целым, ответы — номер, вид строкой до 32 знаков, номер ответа и минута.
 * Вид не сверяется здесь с таблицей: незнакомый вид — флаг книги, а не тихая потеря строки (подделку не прячут подрезкой).
 */
function readCrown(v: unknown): Pick<WatchCard, 'crown'> {
  if (!v || typeof v !== 'object') return {};
  const r = v as Record<string, unknown>;
  const last = Array.isArray(r.last) ? r.last : [];
  const entries: WatchCrownEntry[] = [];
  for (const e of last.slice(-CROWN_LAST_MAX)) {
    if (!e || typeof e !== 'object') continue;
    const x = e as Record<string, unknown>;
    if (typeof x.id !== 'string' || x.id.length === 0 || x.id.length > 32) continue;
    entries.push({ n: whole(x.n, 1e9), id: x.id, opt: whole(x.opt, 99), at: whole(x.at, 1e12) });
  }
  return { crown: { n: whole(r.n, 1e9), last: entries } };
}

/** Стабильность в описи — то, что сверяет книга стабильности сервера (`watch.flagsBetween`, правило «stab»). */
export interface WatchStab {
  /** Ступень как есть, целым: вне −3…+3 — флаг, а не поправка (подделку не прячут подрезкой). */
  level: number;
  bought: number;
  spent: number;
  revolts: number;
  held: number;
}

const whole = (v: unknown, max: number): number => Math.floor(Math.min(max, Math.max(0, num(v) ?? 0)));

/** Стабильность описи: ступень — целым как есть (в пределах ±99), счёт — неотрицательным целым; нет поля — нет. */
function readStab(v: unknown): Pick<WatchCard, 'stab'> {
  if (!v || typeof v !== 'object') return {};
  const r = v as Record<string, unknown>;
  const level = num(r.level);
  if (level === null) return {};
  return {
    stab: {
      level: Math.round(Math.max(-99, Math.min(99, level))),
      bought: whole(r.bought, 1e9),
      spent: whole(r.spent, 1e12),
      revolts: whole(r.revolts, 1e9),
      held: whole(r.held, 1e9),
    },
  };
}

/** Идущая стройка описи: тип — строка до 32 знаков, уровень — целый 2..100, работа — неотрицательная. */
function readSite(v: unknown): Pick<WatchCard, 'site'> {
  if (!v || typeof v !== 'object') return {};
  const r = v as Record<string, unknown>;
  const type = str(r.type, 32);
  const level = num(r.level);
  const done = num(r.done);
  if (!type || level === null || !Number.isInteger(level) || level < 2 || level > 100 || done === null || done < 0) return {};
  return { site: { type, level, done: Math.min(done, 1e12) } };
}

/** Сколько мест очереди стройки читает сервер: больше — подделка, и лишнее ему не нужно, чтобы сказать флаг. */
export const QUEUE_READ_MAX = 32;

/** Очередь стройки описи: места с типом до 32 знаков и целым уровнем 2..100, порядок как есть; нет поля — нет очереди. */
function readQueue(v: unknown): Pick<WatchCard, 'queue'> {
  if (!Array.isArray(v)) return {};
  const queue: { type: string; level: number }[] = [];
  for (const x of v.slice(0, QUEUE_READ_MAX)) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const type = str(r.type, 32);
    const level = num(r.level);
    if (type && level !== null && Number.isInteger(level) && level >= 2 && level <= 100) queue.push({ type, level });
  }
  return { queue };
}

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
    ...(r.bonded !== undefined ? { bonded: whole(r.bonded, 1e9) } : {}),
    ...readSite(r.site),
    ...readQueue(r.queue),
    train: whole(r.train, 1e9),
    deeds: whole(r.deeds, 1e12),
    ...(r.outlays !== undefined ? { outlays: whole(r.outlays, 1e12) } : {}),
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
    ...readStab(r.stab),
    ...readCrown(r.crown),
    ...readCouncil(r.council),
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
  /** Герб из реестра замков, проверенный набором (`readArms`); нет — прежний герб-башня. */
  arms?: string;
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

// ------------------------------------------------ вести края (docs/feed.md) ---
//
// Лента событий региона. Пишет её сервер: каждая запись выводится из того, что он сам хранит, — записи войн (бои,
// осады, падения, дела лазутчиков), реестра замков (новый сосед) и памяти первых мест рейтинга. Клиент записей не
// присылает: тела у запроса нет. Тайное остаётся тайным: имя хозяина лазутчика — только у пойманного (docs/spy_pvp.md).

/**
 * Что случилось: город взят (`fell`), осада началась (`siege`), осада снята (`lifted`), штурм с ходу отбит
 * (`repelled`), тайное дело удалось (`spy`), лазутчик пойман (`caught`), новый сосед (`settled`), первое место рейтинга
 * сменилось (`leader`).
 */
export const FEED_KINDS = ['fell', 'siege', 'lifted', 'repelled', 'spy', 'caught', 'settled', 'leader'] as const;
export type FeedKind = (typeof FEED_KINDS)[number];

/** Запись ленты. Ключей игроков нет — только имена городов и правителей, как у рейтинга. */
export interface FeedItem {
  /** Номер записи — из того, что её породило (`fell:<война>`), один и тот же при каждом чтении. */
  id: string;
  kind: FeedKind;
  /** Когда, по серверным часам. */
  at: number;
  /** Где — касание записи ведёт сюда на карте. */
  x: number;
  y: number;
  /** Город, с которым это случилось: осаждённый, взятый, новый, первый. */
  city: string;
  /** Другая сторона: город и правитель нападавшего или хозяина пойманного лазутчика. Нет — тайна или её нет. */
  byCity?: string;
  byRuler?: string;
  /** Правитель города `city` — у нового соседа и первого места. */
  ruler?: string;
  /**
   * Подробность: как взят (`storm`, `hunger`), как снята осада (`retreat`, `lifted`, `beaten`), какое дело удалось
   * (`fire`, `theft`, `unrest`), что с пойманным (`held`, `dead`).
   */
  how?: string;
  /** Сколько стояла осада, мс — у взятого голодом или осадой. */
  siegeMs?: number;
  /** Запись про свой город спросившего. */
  mine?: true;
}

export interface FeedResponse {
  now: number;
  items: FeedItem[];
}

// ------------------------------------------------ алмазы (docs/gems.md) ---

/**
 * Виды записей журнала алмазов: стартовые (сервер кладёт при первом входе в эпоху мира), покупка набора (место под
 * оплату; сегодня её нет), покупка в лавке и ускорение стройки. Начисляют только `start` и `purchase` — одной дверью
 * `netlify/lib/gems.creditGems`; `buy` и `rush` только списывают.
 */
export const GEM_KINDS = ['start', 'purchase', 'buy', 'rush'] as const;
export type GemKind = (typeof GEM_KINDS)[number];

/** Припасы лавки — виды склада без золота: золото за алмазы не продаётся. */
export const GEM_GOODS = ['wood', 'stone', 'food', 'hides', 'charcoal', 'copper', 'iron'] as const satisfies readonly StockKey[];
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
  const res = boneless(r.res);
  if (isGood(res)) out.res = res;
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

// ------------------------------------------------ оплата наборов (docs/payments.md) ---

/**
 * Жизнь заказа: создан (номер и сумма выданы) → ждёт перевода (кошелёк подписал) → оплачен (сервер нашёл перевод в сети)
 * → начислено (алмазы легли через `creditGems`). Не нашли перевода в срок — истёк; поздний перевод с тем же номером
 * сервер ещё неделю ищет и начисляет (`lib/pay.ts`, `PAY_LATE_MS`).
 */
export const PAY_STATES = ['created', 'waiting', 'paid', 'credited', 'expired'] as const;
export type PayState = (typeof PAY_STATES)[number];

/** Заказ глазами игрока. */
export interface PayOrderView {
  /** Номер заказа; в комментарии перевода — `TRIBE-<номер>`. */
  id: string;
  /** Набор (`data/gems.GEM_PACKS`). */
  pack: string;
  gems: number;
  usdt: number;
  at: number;
  /** До какой минуты ждём перевода. */
  until: number;
  state: PayState;
  /** Что не так с переводом, словами (сумма не та). */
  note?: string;
}

/** Сообщение кошельку через TON Connect (`sendTransaction`). */
export interface PayTx {
  /** Секунды Unix: до какого времени кошелёк может подписать. */
  validUntil: number;
  /** Сеть TON Connect: `-3` тестовая, `-239` основная. */
  network: string;
  messages: { address: string; amount: string; payload: string }[];
}

/** Ответ `/api/pay`. */
export interface PayResponse {
  now: number;
  /** Оплата настроена на сервере. */
  on: boolean;
  net?: 'testnet' | 'mainnet';
  /** Последние заказы игрока, свежие в конце. */
  orders: PayOrderView[];
  /** На новый заказ: что подписать кошельком. */
  tx?: PayTx;
  order?: PayOrderView;
  /** Сколько алмазов легло этой проверкой. */
  credited?: number;
  error?: string;
}

/** Запрос `/api/pay`: новый заказ (набор, адрес и сеть кошелька) или «кошелёк подписал». */
export type PayRequest = { op: 'order'; pack: string; wallet: string; chain: string } | { op: 'sent'; id: string };

/** Номер заказа: десять знаков без похожих (0/O, 1/I). */
export const PAY_ID = /^[A-HJ-NP-Z2-9]{10}$/;
/** Комментарий перевода по номеру заказа. */
export const payComment = (id: string): string => `TRIBE-${id}`;

export function readPayRequest(v: unknown): PayRequest | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (r.op === 'order') {
    const pack = str(r.pack, 16);
    const wallet = str(r.wallet, 80);
    const chain = str(r.chain, 8);
    return pack && wallet && chain ? { op: 'order', pack, wallet, chain } : null;
  }
  if (r.op === 'sent') return typeof r.id === 'string' && PAY_ID.test(r.id) ? { op: 'sent', id: r.id } : null;
  return null;
}

/** Заказ из ответа или хранилища: новый объект; кривой — `null`. */
export function readPayOrder(v: unknown): PayOrderView | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const at = num(r.at);
  const until = num(r.until);
  const gems = num(r.gems);
  const usdt = num(r.usdt);
  const pack = str(r.pack, 16);
  if (typeof r.id !== 'string' || !PAY_ID.test(r.id) || !pack || at === null || until === null || gems === null || usdt === null) return null;
  if (typeof r.state !== 'string' || !(PAY_STATES as readonly string[]).includes(r.state)) return null;
  const out: PayOrderView = { id: r.id, pack, gems, usdt, at, until, state: r.state as PayState };
  const note = str(r.note, 200);
  if (note) out.note = note;
  return out;
}

/** Ответ `/api/pay`: заказы — только целые. */
export function readPayResponse(v: unknown): PayResponse | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const now = num(r.now);
  if (now === null) return null;
  const orders = Array.isArray(r.orders) ? r.orders.map(readPayOrder).filter((o): o is PayOrderView => o !== null) : [];
  const out: PayResponse = { now, on: r.on === true, orders };
  if (r.net === 'testnet' || r.net === 'mainnet') out.net = r.net;
  const order = readPayOrder(r.order);
  if (order) out.order = order;
  const credited = num(r.credited);
  if (credited !== null && credited > 0) out.credited = credited;
  if (typeof r.error === 'string') out.error = r.error.slice(0, 300);
  const tx = r.tx as Record<string, unknown> | undefined;
  if (tx && typeof tx.validUntil === 'number' && typeof tx.network === 'string' && Array.isArray(tx.messages)) {
    const messages = tx.messages.flatMap((m) => {
      const x = m as Record<string, unknown>;
      return typeof x?.address === 'string' && typeof x.amount === 'string' && typeof x.payload === 'string' ? [{ address: x.address, amount: x.amount, payload: x.payload }] : [];
    });
    if (messages.length) out.tx = { validUntil: tx.validUntil, network: tx.network, messages };
  }
  return out;
}

// ---------- Замеры плавности с телефонов (docs/telemetry.md) ----------
//
// Игра сама сообщает, как она идёт на настоящих телефонах: пачка раз в пять минут и при сворачивании (`/api/perf`, PUT,
// подписью `initData`, как сохранение). Только техническое: кадры по местам, уровень графики и его понижения, замирание
// при возврате, первый кадр города, длинные задачи, число ошибок, устройство без имени и строки браузера. Игрок для
// сервера — номер замка (`roster.castleIdOf` из подписи); имени, ключа `tg-…` и координат в замерах нет.
//
// **Сервер не верит пачке ни в чём** (правило ЗЩ-1, docs/security.md): незнакомое поле на любом уровне, чужое слово или
// число вне разумного — отказ всей пачке (400), а не обрезка. Подделка ничего не даёт игроку, но засоряла бы сводку
// `/perf`, по которой решают, что чинить.

/** Места замера кадров — то же, что `render/loop.FramePlace` (тест «места одни»). */
export const PERF_PLACES = ['city', 'map', 'battle', 'siege', 'prologue', 'berries', 'herd', 'hunt', 'fish'] as const;
export type PerfPlace = (typeof PERF_PLACES)[number];

/**
 * Лестницы сторожа плавности (`render/steady`): уровни сцены города и роликов (`render/quality`) и ступени предыстории и
 * промыслов (`prologue/look`). Понижение — шаг вниз по одной лестнице.
 */
export const PERF_LADDERS = [
  ['high', 'medium', 'low'],
  ['full', 'lite', 'base'],
] as const;

/**
 * Потолки пачки. Кадров на место — не больше `fps` в секунду охваченного времени (потолок двери кадра 60 и запас на
 * дрожь отметок), на все места — вдвое больше (две цепочки могут идти разом). Промежуток кадра — корзинами по
 * миллисекунде от 0 до `bucket`; последняя — «столько и дольше».
 */
export const PERF_LIMITS = {
  spanMin: 1000,
  spanMax: 20 * 60_000,
  bucket: 100,
  fps: 62,
  drops: 8,
  freeze: 4,
  freezeMs: 120_000,
  firstMs: 600_000,
  /** Длинная задача — от 50 мс (Long Tasks API): больше одной на 50 мс времени не бывает. */
  longMs: 50,
  errors: 1000,
  gpu: 96,
  build: 64,
  /** Пачек в минуту с одного игрока — сито поверх `perDay`. */
  perMinute: 4,
  /** Пачек в сутки на одно устройство игрока: пять минут круглые сутки — 288, остальное — сворачивания. */
  perDay: 400,
  /** Сколько дней сервер хранит замеры. */
  keepDays: 30,
} as const;

/** Устройство — классом, без имён: ни строки браузера, ни модели, ни координат. */
export interface PerfDevice {
  kind: 'phone' | 'tablet' | 'desktop';
  os: 'ios' | 'android' | 'windows' | 'mac' | 'linux' | 'other';
  /** Главная версия ОС: `17.4`, `14`; не узнали — пусто. */
  osv: string;
  /** Telegram (WebView мини-аппы) или браузер. */
  app: 'tg' | 'web';
  /** Платформа клиента Telegram (`ios`, `android`, `tdesktop`, `weba`…) и версия Bot API; вне Telegram — пусто. */
  tgp: string;
  tgv: string;
  br: 'chrome' | 'safari' | 'firefox' | 'samsung' | 'yandex' | 'edge' | 'other';
  /** Видеокарта (`WEBGL_debug_renderer_info`); браузер скрыл — пусто. */
  gpu: string;
  /** Экран в точках CSS (короткая сторона — `w`) и плотность. */
  w: number;
  h: number;
  dpr: number;
  /** Память, ГБ (`navigator.deviceMemory`), и ядра; не говорит — `null`. */
  mem: number | null;
  cores: number | null;
  /** Класс Telegram на Android (`quality.tgClassOf`). */
  tgc: 'LOW' | 'AVERAGE' | 'HIGH' | null;
}

/** Понижение сторожем: где и с какой ступени на какую. */
export interface PerfDrop {
  p: PerfPlace;
  f: string;
  t: string;
}

/** Замирание при возврате: первый кадр после возврата контекста (`restore`) или пересборка сцены (`rebuild`), мс. */
export interface PerfFreeze {
  k: 'restore' | 'rebuild';
  ms: number;
}

/** Тело `/api/perf`. */
export interface PerfPut {
  v: 1;
  /** Версия игры — та же строка, что в описи (`snapshot.buildId`). */
  build: string;
  /** Сколько настоящего времени охватывает пачка, мс. */
  span: number;
  dev: PerfDevice;
  /** Уровень графики, на котором стоит город сейчас (`gfx.levelNow`), и выбор игрока в настройках. */
  q: 'high' | 'medium' | 'low' | null;
  set: 'auto' | 'high' | 'medium' | 'low';
  /** Промежутки между кадрами по местам: корзина (мс) → сколько кадров. */
  fps: Partial<Record<PerfPlace, Record<string, number>>>;
  drops: PerfDrop[];
  freeze: PerfFreeze[];
  /** От начала страницы до первого кадра города и до города, вставшего целиком, мс; раз за заход. */
  first?: number;
  ready?: number;
  /** Длинные задачи главного потока: сколько, сумма и самая долгая, мс; браузер не умеет мерить — `null`. */
  long: { n: number; ms: number; max: number } | null;
  /** Ошибок JS (`error`, `unhandledrejection`). Только число — текст ошибки может нести чужое. */
  err: number;
}

export interface PerfResponse {
  now: number;
}

const own = (v: unknown, keys: readonly string[], need: readonly string[] = keys): Record<string, unknown> | null => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!keys.includes(k)) return null;
  for (const k of need) if (!(k in r)) return null;
  return r;
};
const int = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isOneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

const DEVICE_KEYS = ['kind', 'os', 'osv', 'app', 'tgp', 'tgv', 'br', 'gpu', 'w', 'h', 'dpr', 'mem', 'cores', 'tgc'] as const;

function readPerfDevice(v: unknown): PerfDevice | string {
  const d = own(v, DEVICE_KEYS);
  if (!d) return 'устройство: поля';
  if (!isOneOf(d.kind, ['phone', 'tablet', 'desktop'] as const)) return 'устройство: вид';
  if (!isOneOf(d.os, ['ios', 'android', 'windows', 'mac', 'linux', 'other'] as const)) return 'устройство: ОС';
  if (typeof d.osv !== 'string' || !/^(\d{1,3}(\.\d{1,3})?)?$/.test(d.osv)) return 'устройство: версия ОС';
  if (!isOneOf(d.app, ['tg', 'web'] as const)) return 'устройство: клиент';
  if (typeof d.tgp !== 'string' || !/^[a-z_]{0,16}$/.test(d.tgp)) return 'устройство: платформа Telegram';
  if (typeof d.tgv !== 'string' || !/^(\d{1,2}(\.\d{1,2}){0,2})?$/.test(d.tgv)) return 'устройство: версия Telegram';
  if (!isOneOf(d.br, ['chrome', 'safari', 'firefox', 'samsung', 'yandex', 'edge', 'other'] as const)) return 'устройство: браузер';
  if (typeof d.gpu !== 'string' || d.gpu.length > PERF_LIMITS.gpu || !/^[\x20-\x7e]*$/.test(d.gpu)) return 'устройство: видеокарта';
  if (!int(d.w, 100, 8000) || !int(d.h, 100, 8000) || d.w > d.h) return 'устройство: экран';
  if (typeof d.dpr !== 'number' || !(d.dpr >= 0.5 && d.dpr <= 8)) return 'устройство: плотность';
  if (d.mem !== null && !(typeof d.mem === 'number' && d.mem >= 0.25 && d.mem <= 64)) return 'устройство: память';
  if (d.cores !== null && !int(d.cores, 1, 256)) return 'устройство: ядра';
  if (d.tgc !== null && !isOneOf(d.tgc, ['LOW', 'AVERAGE', 'HIGH'] as const)) return 'устройство: класс Telegram';
  if (d.tgc !== null && d.os !== 'android') return 'устройство: класс Telegram не на Android';
  return {
    kind: d.kind,
    os: d.os,
    osv: d.osv,
    app: d.app,
    tgp: d.tgp,
    tgv: d.tgv,
    br: d.br,
    gpu: d.gpu,
    w: d.w,
    h: d.h,
    dpr: d.dpr,
    mem: d.mem as number | null,
    cores: d.cores as number | null,
    tgc: d.tgc as PerfDevice['tgc'],
  };
}

/** Шаг вниз по одной лестнице сторожа. */
export const perfDropOk = (f: string, t: string): boolean =>
  PERF_LADDERS.some((l) => (l as readonly string[]).includes(f) && (l as readonly string[]).indexOf(t) > (l as readonly string[]).indexOf(f));

/**
 * Пачка из тела запроса — целиком или причина отказа словами. Новый объект: лишнего из тела в нём нет. Числа не
 * обрезаются, а проверяются — обрезанная подделка выглядела бы честной.
 */
export function readPerf(v: unknown): PerfPut | string {
  const r = own(v, ['v', 'build', 'span', 'dev', 'q', 'set', 'fps', 'drops', 'freeze', 'first', 'ready', 'long', 'err'], ['v', 'build', 'span', 'dev', 'q', 'set', 'fps', 'drops', 'freeze', 'long', 'err']);
  if (!r) return 'поля';
  if (r.v !== 1) return 'версия';
  if (typeof r.build !== 'string' || r.build.length > PERF_LIMITS.build || /[\u0000-\u001f\u007f]/.test(r.build)) return 'версия игры';
  if (!int(r.span, PERF_LIMITS.spanMin, PERF_LIMITS.spanMax)) return 'охват';
  const span = r.span;
  const dev = readPerfDevice(r.dev);
  if (typeof dev === 'string') return dev;
  if (r.q !== null && !isOneOf(r.q, ['high', 'medium', 'low'] as const)) return 'уровень';
  if (!isOneOf(r.set, ['auto', 'high', 'medium', 'low'] as const)) return 'выбор';

  const cap = Math.ceil((span / 1000) * PERF_LIMITS.fps);
  const places = own(r.fps, PERF_PLACES, []);
  if (!places) return 'кадры: места';
  const fps: PerfPut['fps'] = {};
  let total = 0;
  for (const p of PERF_PLACES) {
    if (!(p in places)) continue;
    const h = places[p];
    if (!h || typeof h !== 'object' || Array.isArray(h)) return `кадры: ${p}`;
    const out: Record<string, number> = {};
    let n = 0;
    for (const [k, c] of Object.entries(h as Record<string, unknown>)) {
      if (!/^(0|[1-9]\d{0,2})$/.test(k) || Number(k) > PERF_LIMITS.bucket) return `кадры: ${p}: корзина`;
      if (!int(c, 1, cap)) return `кадры: ${p}: счёт`;
      out[k] = c;
      n += c;
    }
    if (n > cap) return `кадры: ${p}: больше, чем успевает дверь кадра`;
    // Кадры идут друг за другом: сумма промежутков не длиннее охвата (корзина — нижний край промежутка).
    // Первый промежуток пачки мог начаться до её начала — отсюда секунда запаса.
    if (Object.entries(out).reduce((a, [k, c]) => a + Number(k) * c, 0) > span + 1000) return `кадры: ${p}: дольше охвата`;
    total += n;
    if (n) fps[p] = out;
  }
  if (total > cap * 2) return 'кадры: всего';

  if (!Array.isArray(r.drops) || r.drops.length > PERF_LIMITS.drops) return 'понижения';
  const drops: PerfDrop[] = [];
  for (const x of r.drops) {
    const d = own(x, ['p', 'f', 't']);
    if (!d || !isOneOf(d.p, PERF_PLACES) || typeof d.f !== 'string' || typeof d.t !== 'string' || !perfDropOk(d.f, d.t)) return 'понижения: шаг';
    drops.push({ p: d.p, f: d.f, t: d.t });
  }
  if (!Array.isArray(r.freeze) || r.freeze.length > PERF_LIMITS.freeze) return 'замирания';
  const freeze: PerfFreeze[] = [];
  for (const x of r.freeze) {
    const f = own(x, ['k', 'ms']);
    if (!f || !isOneOf(f.k, ['restore', 'rebuild'] as const) || !int(f.ms, 0, PERF_LIMITS.freezeMs)) return 'замирания: число';
    freeze.push({ k: f.k, ms: f.ms });
  }
  let long: PerfPut['long'] = null;
  if (r.long !== null) {
    const l = own(r.long, ['n', 'ms', 'max']);
    // Задача, начатая до пачки, засчитывается ей целиком — отсюда запас одной долгой задачи сверх охвата.
    const room = span + PERF_LIMITS.freezeMs;
    if (!l || !int(l.n, 0, Math.ceil(span / PERF_LIMITS.longMs) + 1) || !int(l.ms, 0, room) || !int(l.max, 0, PERF_LIMITS.freezeMs)) return 'длинные задачи';
    if (l.max > l.ms || l.ms < l.n * PERF_LIMITS.longMs || (l.n === 0) !== (l.ms === 0)) return 'длинные задачи: сумма';
    long = { n: l.n, ms: l.ms, max: l.max };
  }
  if (!int(r.err, 0, PERF_LIMITS.errors)) return 'ошибки';

  const out: PerfPut = { v: 1, build: r.build, span, dev, q: r.q as PerfPut['q'], set: r.set, fps, drops, freeze, long, err: r.err };
  for (const k of ['first', 'ready'] as const) {
    if (!(k in r)) continue;
    if (!int(r[k], 1, PERF_LIMITS.firstMs)) return k === 'first' ? 'первый кадр' : 'город встал';
    out[k] = r[k] as number;
  }
  if (out.first !== undefined && out.ready !== undefined && out.ready < out.first) return 'город встал раньше первого кадра';
  return out;
}
