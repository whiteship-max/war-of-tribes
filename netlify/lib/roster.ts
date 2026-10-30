/**
 * Правила реестра замков — отдельно от разговора по сети.
 *
 * Здесь всё, что можно проверить, не поднимая ни хранилища, ни функции: как
 * строка попадает в реестр, кого он забывает и какой у него потолок. Сама
 * функция (`functions/castles.mts`) остаётся тонкой: подпись, чтение блоба,
 * попытка записи, ответ.
 *
 * **Главное свойство и есть причина, по которой это чистая функция.** Игрок
 * пишет только свою строку. Не «проверяется, что свою» — а не из чего написать
 * чужую: `upsert` получает ключ, выведенный из проверенной подписи, и трогает
 * `rows[key]`, ничего больше. Читается это одним взглядом и держится тестом,
 * который сравнивает весь остальной реестр до и после.
 *
 * Модуль серверный: из `src` его не импортируют, поэтому здесь можно всё, что
 * умеет Node 22. Общие с игрой типы лежат в `contract.ts` — один файл на две
 * стороны, как и у сохранения.
 */
import { createHmac } from 'node:crypto';
import { botToken } from './http.js';
import { placeCastle, settleRandom, type Spot } from '../../src/world/settle.js';
import { SPAWNS, inSicilyTheatre, type SpawnMode } from '../../src/world/spawn.js';
import { ATLAS_HASH } from '../../src/world/atlas/data.js';
import { readArms } from '../../src/heraldry/arms.js';
import { energyForged, isNewcomer, placeBand, roamCamp, roamCell, roamGo, roamMoving, roamPlan, roamSeat, untilForged, ROAM_SLACK_MS, type RoamMove } from '../../src/world/roam.js';
import { readMove } from '../../src/world/roammove.js';
import { bookClaim, bookGrants, bookMen, bookMoved, bookOrder, firstBook, startBook } from './roambook.js';
import { isBookOrder, readRoamBook } from './bandorder.js';
import { readGait } from '../../src/world/data/gait.js';
import {
  CASTLE_LIMITS,
  cityName,
  plainText,
  type AdminGrant,
  type BandOrder,
  type BandRow,
  type CastleClaim,
  type CastleRow,
  type CastleView,
  type RosterFile,
} from './contract.js';

/**
 * Сколько замков помещается в реестр и как долго держится замок того, кто не
 * заходит.
 *
 * Предел нужен не от жадности: реестр едет целиком каждому игроку и
 * переписывается целиком на каждую запись, а строка живёт вечно — иначе карта
 * заросла бы замками, к которым никто никогда не вернётся, и каждый занимал бы
 * свои `SETTLE_GAP` клеток.
 *
 * Три месяца — срок, после которого честнее сказать «мир пошёл дальше», чем
 * держать место. Вернувшийся получает новую клетку, и вместе с ней новую карту:
 * деревня при этом цела, теряется только разведанное. Молчать об этом нельзя, и
 * в `docs/sync.md` про это сказано словами.
 */
export const ROSTER_MAX = 5000;
export const ROSTER_FORGET_MS = 90 * 24 * 60 * 60_000;

/** Ключ реестра в хранилище общего мира: весь реестр лежит одним значением. */
export const ROSTER_KEY = 'roster';

/** Земля, на которой считаны координаты. Сменилась — реестр начинается заново. */
export const rosterEpoch = (): number => ATLAS_HASH;

/** Пустой реестр нынешней земли. */
export const emptyRoster = (): RosterFile => ({ v: 1, epoch: rosterEpoch(), rows: {} });

/**
 * Реестр из того, что лежало в хранилище. Чужая земля, испорченный разбор,
 * непонятная версия — всё это читается одинаково: реестра нет, он начинается
 * заново. Приводить тут нечего, ровно как у сохранения мира: координаты старой
 * земли на новой означают не сбой, а другое место.
 */
export function readRoster(raw: unknown): RosterFile {
  if (!raw || typeof raw !== 'object') return emptyRoster();
  const r = raw as Partial<RosterFile>;
  if (r.v !== 1 || r.epoch !== rosterEpoch() || !r.rows || typeof r.rows !== 'object') return emptyRoster();
  const rows: Record<string, CastleRow> = {};
  for (const [key, row] of Object.entries(r.rows)) {
    if (!row || typeof row !== 'object') continue;
    const c = row as Partial<CastleRow>;
    if (typeof c.x !== 'number' || typeof c.y !== 'number') continue;
    rows[key] = {
      x: Math.round(c.x),
      y: Math.round(c.y),
      name: typeof c.name === 'string' ? c.name : '',
      // Имя города чистится и на чтении: строка могла лечь до правила об имени.
      ...(cityName(c.city) ? { city: cityName(c.city) as string } : {}),
      // Герб — тоже: строка не из набора соседям не уедет (набор мог сузиться новой сборкой).
      ...(readArms(c.arms) ? { arms: c.arms as string } : {}),
      power: Math.max(0, Math.floor(Number(c.power) || 0)),
      pop: Math.max(0, Math.floor(Number(c.pop) || 0)),
      seenAt: Math.max(0, Math.floor(Number(c.seenAt) || 0)),
      ...(Number(c.since) > 0 ? { since: Math.floor(Number(c.since)) } : {}),
    };
  }
  // Отряды бродяг (ПН-3) читаются всегда: с 30.10.2026 путь открыт по игроку (админам, `roamflag.roamOpenFor`), и запись реестра
  // любым игроком обязана нести строки отряда дальше, а не ронять их. Отдаёт их игроку только ответ того, кому путь открыт (`routes/castles`).
  const bands: Record<string, BandRow> = {};
  if (r.bands && typeof r.bands === 'object') {
    for (const [key, row] of Object.entries(r.bands)) {
      const b = readBandRow(row);
      if (b) bands[key] = b;
    }
  }
  return { v: 1, epoch: rosterEpoch(), rows, ...(Object.keys(bands).length > 0 ? { bands } : {}) };
}

const whole = (v: unknown, max: number): number => Math.min(max, Math.max(0, Math.floor(Number(v) || 0)));

/** Ход отряда из строки реестра — запись двери хода. */
export const moveOfRow = (b: BandRow): RoamMove => ({ way: b.way, camp: b.camp ?? null, ...(b.energy ? { energy: b.energy } : {}) });

/** Поля хода строки из записи двери хода: лагеря нет — поля нет. */
const rowOfMove = (m: RoamMove): Pick<BandRow, 'way' | 'camp' | 'energy'> => ({
  way: m.way,
  ...(m.camp ? { camp: m.camp } : {}),
  ...(m.energy ? { energy: m.energy } : {}),
});

/** Строка отряда из хранилища: ход — формой двери хода (`world/roammove.readMove`), имя и знамя — чистые. Мусор — `null`. */
export function readBandRow(v: unknown): BandRow | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const move = readMove(r);
  if (!move) return null;
  return {
    ...rowOfMove(move),
    born: whole(r.born, Number.MAX_SAFE_INTEGER),
    name: plainText(r.name, CASTLE_LIMITS.name) ?? '',
    ...(readArms(r.arms) ? { arms: r.arms as string } : {}),
    prestige: whole(r.prestige, 1e9),
    men: whole(r.men, 1e6),
    seenAt: whole(r.seenAt, Number.MAX_SAFE_INTEGER),
    ...clockOf(r.clock),
    ...((): Pick<BandRow, 'book'> => {
      const book = readRoamBook(r.book);
      return book ? { book } : {};
    })(),
  };
}

/** Часы партии из строки хранилища (ПН-4у): оба числа конечные и не меньше нуля, иначе поля нет. */
function clockOf(v: unknown): Pick<BandRow, 'clock'> {
  if (!v || typeof v !== 'object') return {};
  const c = v as Record<string, unknown>;
  const time = Number(c.time);
  const at = Number(c.at);
  return Number.isFinite(time) && Number.isFinite(at) && time >= 0 && at >= 0 ? { clock: { time, at } } : {};
}

/** Строки реестра, которые надо пронести при записи замка: отряды — как были. */
const bandsOf = (file: RosterFile): Pick<RosterFile, 'bands'> => (file.bands && Object.keys(file.bands).length > 0 ? { bands: file.bands } : {});

/** Где уже стоят замки. Ровно это и получает правило расселения. */
export const spotsOf = (file: RosterFile): Spot[] =>
  Object.values(file.rows).map((r) => ({ x: r.x, y: r.y }));

/**
 * Идентификатор замка наружу. Не телеграмный: соседям знать, кто именно за ним
 * играет, незачем — имя вождь называет сам.
 *
 * Хеш ключа с секретом сервера (HMAC от токена бота). Голый хеш `tg-<id>` обращался перебором номеров Telegram: ключ
 * устроен известно, хеш быстрый, и номер игрока по идентификатору замка находил любой сосед (docs/LAUNCH.md,
 * «Безопасность»). Токен на сервере есть всегда — без него не проходит ни одна подпись; переезд на свой сервер с тем
 * же ботом идентификаторы не меняет. Токена нет (тесты без подписи) — прежний хеш без секрета. Смена правила меняет
 * идентификаторы стоящих замков: выкладывается вместе с `/wipeworld ДА`.
 */
export function castleIdOf(key: string, token: string = botToken()): string {
  if (token) {
    const h = createHmac('sha256', token).update(`castle:${key}`).digest();
    return `c${h.readUInt32BE(0).toString(36).padStart(7, '0')}${h.readUInt32BE(4).toString(36).padStart(7, '0')}`;
  }
  const mix = (salt: number): string => {
    let h = salt >>> 0;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36).padStart(7, '0');
  };
  return `c${mix(0x811c9dc5)}${mix(0x9e3779b1)}`;
}

/** Реестр глазами игрока: строки с опознавательным номером вместо ключа. */
export const viewOf = (file: RosterFile): CastleView[] =>
  Object.entries(file.rows).map(([key, row]) => ({ id: castleIdOf(key), ...row }));

/**
 * Положить свою строку.
 *
 * Клетка выбирается **здесь и только для новой строки**: у стоящего замка она
 * не меняется никогда, и поля для неё в `claim` не существует. Место ищет
 * `place`, а не сам `upsert`, по одной причине — расселение зависит от того,
 * кто уже стоит, а «кто уже стоит» может измениться между чтением и записью.
 * Поэтому зовут его на каждой попытке записи, с тем реестром, который только
 * что прочитали.
 *
 * Возвращается новый реестр. Прежний не трогается: сравнить «что было» и «что
 * стало» — это и есть проверка того, что чужие строки целы.
 */
export function upsert(file: RosterFile, key: string, claim: CastleClaim, now: number, mode: SpawnMode | null = null): RosterFile {
  const had = file.rows[key];
  const at: Spot = had ?? placeNew(file, key, mode);
  return {
    v: 1,
    epoch: file.epoch,
    ...bandsOf(file),
    rows: {
      ...file.rows,
      [key]: {
        x: at.x,
        y: at.y,
        name: claim.name,
        ...(cityName(claim.city) ? { city: cityName(claim.city) as string } : {}),
        ...(readArms(claim.arms) ? { arms: claim.arms } : {}),
        power: claim.power,
        pop: claim.pop,
        seenAt: now,
        // Когда встал — у новой строки «сейчас», у стоящей прежнее (вести края, «новый сосед»).
        ...(had ? (had.since ? { since: had.since } : {}) : { since: now }),
      },
    },
  };
}

/**
 * Клетка для новой строки.
 *
 * Обычный режим — правило расселения (`settle.placeCastle`). Режим `sicily` (docs/test_world.md) — первое свободное из
 * мест по порядку списка (`world/spawn.SPAWNS`: остров, потом материк с юга на север); занято место, на котором уже
 * стоит чья-то строка. Свободных нет — обычное правило, но только в регионе острова: новичок обязан мочь воевать с
 * теми, кто уже стоит.
 *
 * Зовут её внутри цикла записи, на только что прочитанном реестре (`routes/castles.ts`): двое, вошедших разом, не займут
 * одно место — второй проиграет условную запись, перечитает реестр и увидит место занятым.
 */
export function placeNew(file: RosterFile, key: string, mode: SpawnMode | null): Spot {
  const taken = spotsOf(file);
  if (mode === 'sicily') {
    const busy = new Set(taken.map((t) => `${t.x}|${t.y}`));
    const free = SPAWNS.find((s) => !busy.has(`${s.x}|${s.y}`));
    if (free) return { x: free.x, y: free.y };
    return placeCastle(settleRandom(key), taken, inSicilyTheatre);
  }
  return placeCastle(settleRandom(key), taken);
}

/**
 * Убрать забытые замки и лишние сверх потолка.
 *
 * Порядок важен: сперва по сроку, потом по потолку, и всегда по «последний раз
 * был в игре» — самые старые уходят первыми. Своя строка от прополки защищена
 * отдельно: игрок, который прямо сейчас пишет, не может оказаться забытым, как
 * бы ни разошлись часы.
 */
export function prune(file: RosterFile, now: number, keep: string): RosterFile {
  // Отряды забываются тем же сроком, что замки (ПН-3): строка, к которой никто не возвращается, не держит место у руин.
  const bands = Object.entries(file.bands ?? {}).filter(([key, b]) => key === keep || now - b.seenAt <= ROSTER_FORGET_MS);
  const bandsGone = bands.length !== Object.keys(file.bands ?? {}).length;
  const keptBands = bands.length > 0 ? { bands: Object.fromEntries(bands) } : {};
  const alive = Object.entries(file.rows).filter(
    ([key, row]) => key === keep || now - row.seenAt <= ROSTER_FORGET_MS,
  );
  const left =
    alive.length <= ROSTER_MAX
      ? alive
      : [...alive]
          // Своя строка идёт первой и потому переживает срез при любом потолке;
          // дальше — по свежести, и уходят самые давние.
          .sort((a, b) => (a[0] === keep ? -1 : b[0] === keep ? 1 : b[1].seenAt - a[1].seenAt))
          .slice(0, ROSTER_MAX);
  if (left.length === Object.keys(file.rows).length && !bandsGone) return file;
  return { v: 1, epoch: file.epoch, rows: Object.fromEntries(left), ...keptBands };
}

/**
 * Стоит ли вообще писать. Строка переписывается ради имени, герба, мощи и
 * отметки «был в игре»; если ничего из этого не сдвинулось заметно, а с
 * прошлой записи прошло меньше срока, запись не нужна вовсе.
 *
 * Это не бережливость, а прямая защита общего блоба: реестр один на всех, и
 * каждая лишняя запись — это ещё одна гонка за право его переписать.
 */
export function worthWriting(file: RosterFile, key: string, claim: CastleClaim, now: number, quiet: number): boolean {
  const had = file.rows[key];
  if (!had) return true;
  const sameCity = (cityName(had.city) ?? '') === (cityName(claim.city) ?? '');
  const sameArms = (had.arms ?? '') === (readArms(claim.arms) ? claim.arms : '');
  if (had.name !== claim.name || !sameCity || !sameArms || had.power !== claim.power || had.pop !== claim.pop) {
    return true;
  }
  return now - had.seenAt >= quiet;
}

// ---------- Отряд бродяги (ПН-3, docs/gdd/path_of_sword.md, 3.5.6) ----------
//
// Строка отряда пишется так же, как замок: только своя (ключ — из подписи), место выхода — сервер, внутри цикла записи на только
// что прочитанном реестре (двое, вошедших разом, не встанут у одних руин). Ход и лагерь сервер выводит сам дверью `world/roam` —
// той же, что показала окно клиенту; из приказа он берёт только клетку, режим и вид лагеря, а срок, который видел игрок, —
// для сверки. Невозможное (вода, чужой регион, руин нет, срок короче пути, сил не было и минутой раньше) — отказ и флаг; отказ,
// который объясняет запаздывание приказа, — без флага. Игроку, которому путь закрыт (`roamflag.roamOpenFor`), сюда не доходит ни один приказ: дверь — `routes/castles`.

/** Клетки новичков — отрядов моложе 48 настоящих часов (решение С5), кроме своего: от них держится место выхода следующего. */
export function newcomersOf(file: RosterFile, now: number, except: string): Spot[] {
  return Object.entries(file.bands ?? {})
    .filter(([k, b]) => k !== except && isNewcomer(b.born, now))
    .map(([, b]) => roamCell(b.way, now));
}

/**
 * Место выхода нового отряда (`world/roam.placeBand`): у руин или опушки, вдали от замков и новичков; в режиме Сицилии — в
 * регионе острова, как замки теста. Ключ — тот же, что у замка, с приставкой: повтор ищет теми же бросками.
 */
export function placeBandNew(file: RosterFile, key: string, now: number, mode: SpawnMode | null): Spot {
  return placeBand(settleRandom(`band:${key}`), spotsOf(file), newcomersOf(file, now, key), mode === 'sicily' ? inSicilyTheatre : undefined);
}

/** Что сервер знает о партии для книги отряда (ПН-6): сид из описи и указы админа. */
export interface BookKnown {
  seed?: number;
  grants?: readonly Pick<AdminGrant, 'n' | 'troops'>[];
}

/** Итог приказа отряда: реестр после него, отказ словами и флаг для наблюдения игрока. */
export interface BandAnswer {
  file: RosterFile;
  error: string | null;
  forged: { kind: 'forged' | 'walk'; text: string } | null;
}

const spot = (c: { x: number; y: number }): string => `${Math.round(c.x)}|${Math.round(c.y)}`;

/**
 * Приказ отряда бродяги: встать в реестр (место назначит сервер), «Идти сюда», «Встать лагерем». Пишет только свою строку.
 * Возвращает новый реестр (прежний не тронут), отказ и флаг. `clock` — часы партии из описи (ПН-4у, `bandsight.clockOf`).
 */
export function bandOrder(
  file: RosterFile,
  key: string,
  o: BandOrder,
  now: number,
  mode: SpawnMode | null,
  clock?: BandRow['clock'],
  known: BookKnown = {},
): BandAnswer {
  const had = file.bands?.[key];
  // Записанный реестр — с прополкой забытых, как у замка (`prune`): своя строка от неё защищена. Часы партии (ПН-4у) — отметка
  // сервера из описи, ставится каждым принятым приказом: событие и есть то, по чему сервер обновляет видимость.
  const put = (row: BandRow): RosterFile => prune({ ...file, bands: { ...(file.bands ?? {}), [key]: clock ? { ...row, clock } : row } }, now, key);
  const no = (error: string, forged: BandAnswer['forged'] = null): BandAnswer => ({ file, error, forged });
  // У игрока либо замок, либо отряд: игрок с замком приказов отряда не шлёт — честный клиент в фазе лорда их не знает.
  if (file.rows[key]) return no('У тебя замок: отряда бродяги нет.', { kind: 'forged', text: 'Приказ отряда бродяги от игрока с замком в реестре.' });
  if (o.op === 'seat') {
    // Книга отряда (ПН-6): новая строка — Воин; строка до книги — с первой отметки; дальше — указы админа и убыль словами клиента,
    // а сверх книги — флаг. Людей строки (видимость, рогатки) — по книге.
    // Клиент до ПН-6 у строки до книги (troops не шлёт) — по-старому, словами клиента.
    const base = had ? (had.book ?? (o.troops ? firstBook(o.troops) : null)) : startBook();
    const granted = base ? bookGrants(base, known.grants ?? []) : null;
    const claimed = granted && o.troops ? bookClaim(granted, o.troops) : { book: granted, forged: null };
    const book = claimed.book;
    const banner = { name: o.name, ...(o.arms ? { arms: o.arms } : {}), prestige: o.prestige, men: book ? bookMen(book) : o.men, seenAt: now, ...(book ? { book } : {}) };
    const forged = claimed.forged ? { kind: 'forged' as const, text: claimed.forged } : null;
    if (had) {
      const { arms: _old, ...kept } = had;
      return { file: put({ ...kept, ...banner }), error: null, forged };
    }
    const at = placeBandNew(file, key, now, mode);
    return { file: put({ ...rowOfMove(roamSeat(at, now)), born: now, ...banner }), error: null, forged };
  }
  if (!had) return no('Отряд ещё не вышел на карту: место выхода не названо.');
  const m = moveOfRow(had);
  if (isBookOrder(o)) {
    if (!had.book) return no('Отряд ещё не отметился: книга не заведена.');
    const step = bookOrder(bookGrants(had.book, known.grants ?? []), o, { now, cell: roamCell(m.way, now), moving: roamMoving(m.way, now), seed: known.seed });
    if (step.error) return no(step.error, step.forged ? { kind: 'forged', text: step.forged } : null);
    // Принятый приказ тоже может нести флаг: сдача договора сверх таблицы наград принята срезанной (ПН-7).
    return { file: put({ ...had, book: step.book, men: bookMen(step.book), seenAt: now }), error: null, forged: step.forged ? { kind: 'forged', text: step.forged } : null };
  }
  // Отряд стоял и минуту назад: клетка у клиента и у сервера одна — отказ клетки честный клиент не получает.
  const still = !roamMoving(m.way, now) && !roamMoving(m.way, now - ROAM_SLACK_MS);
  if (o.op === 'go') {
    const gait = readGait(o.gait);
    const next = roamGo(m, o.to, gait, now);
    if (typeof next === 'string') {
      const plan = roamPlan(m, o.to, now);
      if (plan.block) {
        // «Уже здесь» объясняет запаздывание (отряд дошёл, пока шёл приказ); вода, русло, гребень, край — нет.
        const forged = plan.block === 'Отряд уже здесь.' ? null : { kind: 'forged' as const, text: `Ход отряда в ${spot(o.to)}: ${plan.block}` };
        return no(next, forged);
      }
      return no(next, energyForged(m, o.to, gait, now) ? { kind: 'forged', text: `Ход отряда в ${spot(o.to)} без сил: ${next}` } : null);
    }
    // Срок — сервера; названный игроком срок раньше пути дальше запаздывания приказа — флаг «срок пути», ход принят своим сроком.
    const walk =
      o.until !== undefined && untilForged(o.until, next.way.until)
        ? { kind: 'walk' as const, text: `Ход отряда в ${spot(o.to)}: игрок назвал приход на ${Math.round((next.way.until - o.until) / 1000)} с раньше пути.` }
        : null;
    const row: BandRow = { ...had, ...rowOfMove(next), seenAt: now, ...(had.book ? { book: bookMoved(had.book) } : {}) };
    if (!next.camp) delete row.camp;
    return { file: put(row), error: null, forged: walk };
  }
  // Рогатки ставят люди отряда — не больше, чем знает книга (ПН-6).
  const men = had.book ? Math.min(o.men, bookMen(had.book)) : o.men;
  const next = roamCamp(m, o.kind, men, now);
  if (typeof next === 'string') {
    const honest = next === 'Отряд уже стоит этим лагерем.' || next === 'Лагеря нет: отряд и так стоит в поле.';
    return no(next, still && !honest ? { kind: 'forged', text: `Лагерь отряда в ${spot(roamCell(m.way, now))}: ${next}` } : null);
  }
  const row: BandRow = { ...had, ...rowOfMove(next), men: had.book ? bookMen(had.book) : o.men, seenAt: now };
  if (!next.camp) delete row.camp;
  return { file: put(row), error: null, forged: null };
}
