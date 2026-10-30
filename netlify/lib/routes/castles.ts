/**
 * Реестр замков (`/api/castles`): где стоят живые игроки. Один обработчик на Netlify
 * (`functions/castles.mts`) и на своём сервере (`vps/`).
 *
 * Вторая вещь, которую держит сервер, и от первой она отличается ровно одним.
 * Сохранение партии — непрозрачная строка: обработчик в неё не смотрит. Реестр
 * прочитан насквозь — имя, мощь, население, клетка, — и это осознанное сужение
 * правила «сервер хранит и не судит». Второе такое сужение — исходящие
 * уведомления (`routes/notify.ts`), и больше их нет: разбирающих записей
 * ровно две, это тест.
 *
 * Судьёй он от этого не стал. Имя он принимает как есть. Мощь и население — не
 * больше того, что подтверждают книги стройки, войска и жителей в наблюдении
 * игрока (`watch.confirmedOf`, docs/security.md): приписанная мощь пугала бы
 * соседей войском, которого нет. Партию он по-прежнему не разбирает — книги
 * пишет запись партии. И одного он клиенту не доверяет вовсе: **клетку
 * выбирает сам**. Клиент, выбирающий себе место, — это
 * клиент, выбирающий себе соседей: сесть вплотную к слабому, подальше от
 * сильного, за морем от всех сразу. Поэтому поля с координатами в теле запроса
 * нет вовсе, и завести его — не «изменить проверку», а сломать замысел.
 *
 * Личность — только из подписи, ключ строки — только из неё же
 * (`initdata.ts`). Писать можно ровно свою строку, и это не проверка, а
 * устройство: чужого ключа не из чего собрать, а `upsert` трогает одну строку.
 *
 * Чего здесь нет и что не надо доделывать по дороге: никаких действий между
 * игроками, никаких уведомлений, никакого расчёта в фоне. Реестр отвечает на
 * запрос и молчит между ними.
 */
import { readInitData, saveKeyOf } from '../initdata.js';
import { eraGate } from '../era.js';
import { WRITE_TRIES, allow, botToken, deny, json, parseJson, readBody, spawnMode, type Route } from '../http.js';
import { readBandOrder, readClaim, type CastleClaim, type RosterFile, type RosterResponse } from '../contract.js';
import { ROSTER_KEY, bandOrder, fillFree, freeViews, prune, readRoster, rosterEpoch, upsert, viewOf, worthWriting, type FreeHold } from '../roster.js';
import { WARS_KEY, readWars } from '../war.js';
import { STORES } from '../kv.js';
import { addFlags, confirmedOf, observe, readWatchRecord } from '../watch.js';
import { bandsSeen, clockAt, seenOf } from '../bandsight.js';
import { roamOpenFor } from '../../../src/game/roamflag.js';
import { grantsOf, isAdmin, type StoredGrant } from '../admin.js';
import { seedTown } from '../town.js';
import { powerOfCounts } from '../../../src/profile/power.js';
import { START_POP } from '../../../src/game/constants.js';

/** Весь реестр лежит одним значением: его читают целиком и целиком переписывают. */
const KEY = ROSTER_KEY;

/**
 * Докуда игроку раздаются чужие замки, клеток. Не тайна и не проверка: дальше
 * этого он всё равно не дотянется ни камерой (`CAMERA_LEASH`), ни разведкой
 * (`REACH_MAX`), а ответ обязан иметь потолок размера, не зависящий
 * от того, сколько всего игроков в игре.
 *
 * Потолок этот геометрический, а не на глаз: замки не ближе `SETTLE_GAP`
 * друг к другу, значит число их в круге радиусом 200 ограничено площадью круга и этим
 * зазором, сколько бы их ни было на всей карте.
 */
const NEAR = 200;

/** Чаще этого одна и та же строка не переписывается. */
const MIN_WRITE_MS = 10_000;

/**
 * Через сколько тишины строка переписывается ради одной отметки «был в игре».
 * Игра шлёт раз в `ROSTER_PUSH_MS` (`src/net/roster.ts`), поэтому порог ниже — иначе половина отправок
 * не доезжала бы до отметки.
 */
const QUIET_MS = 4 * 60_000;

/** Запросов в минуту на игрока. Игре на чтение нужен один раз в `ROSTER_PULL_MS`. */
const PER_MINUTE = 40;

/**
 * Ответ реестра: своя клетка и соседи в пределах досягаемости. Свой отряд бродяги (ПН-3) и видимость отрядов (ПН-4у) — только тому,
 * кому Путь меча открыт (`roamOpen`: правило `roamflag.roamOpenFor`, с 30.10.2026 — админам); замки соседей отряд видит от своей клетки.
 */
function answer(file: RosterFile, key: string, now: number, roamOpen: boolean, holds: Readonly<Record<string, FreeHold>> = {}): RosterResponse {
  const own = file.rows[key];
  const band = roamOpen ? file.bands?.[key] : undefined;
  const mine = own ? { x: own.x, y: own.y } : null;
  const from = own ?? band?.way.to ?? null;
  const castles = from ? viewOf(file).filter((c) => Math.hypot(c.x - from.x, c.y - from.y) <= NEAR) : [];
  const res: RosterResponse = { now, epoch: rosterEpoch(), mine, castles, ...(band ? { band } : {}) };
  // Видимость отрядов бродяг (ПН-4у) — считает сервер сам, дверью `world/sight` (`bandsight.ts`): чужие отряды, которых игрок видит,
  // и кто видит его отряд. Чтение ничего не пишет — это функция строк реестра и минуты. Путь закрыт игроку — полей нет.
  if (roamOpen) {
    const seenBands = bandsSeen(file, key, now);
    if (seenBands.length > 0) res.bands = seenBands;
    const seen = seenOf(file, key, now);
    if (seen) res.seen = seen;
    // Вольные замки пула (ПН-10): кто взял и что сожжено — из записи войн (`WarFile.free`), а не из строки реестра.
    const free = from ? freeViews(file, key, holds, from, NEAR, now) : [];
    if (free.length > 0) res.free = free;
  }
  return res;
}

/**
 * Чьи вольные замки (ПН-10) — из записи войн: взятие и сожжение решает бой на сервере войны (`war.ts`). Чтение без строгости, как у
 * реестра: запись войн живёт минутами. Не прочиталась — замки свободны на вид, а взять чужой не даст сама война.
 */
async function holdsOf(io: Parameters<Route>[1]): Promise<Record<string, FreeHold>> {
  try {
    const got = await io.stores(STORES.world, 'eventual').getWithMetadata(WARS_KEY);
    return readWars(got ? parseJson(String(got.data)) : null).free ?? {};
  } catch {
    return {};
  }
}

export const castles: Route = async (req, io) => {
  const now = io.now;
  const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
  // Наружу — одно слово на все причины отказа, как и у сохранения.
  if (!auth.ok) return deny(401, 'unauthorized');

  const key = saveKeyOf(auth.user);
  if (!allow(`castles:${key}`, PER_MINUTE, now)) return deny(429, 'slow-down', { 'retry-after': '5' });
  // Путь меча — по игроку (30.10.2026): правило одно с клиентом, админ — тот же список, что у команд бота и указов.
  const admin = isAdmin(auth.user.id);
  const open = roamOpenFor(admin);
  // Эпоха мира (docs/test_world.md): партия другой эпохи не пишется и не читается — после чистого старта она не воскресает.
  const gone = await eraGate(req, io);
  if (gone) return gone;

  /**
   * Чтение и запись разведены по строгости нарочно. Записи строгая сверка нужна:
   * без неё «прочитал — изменил — записал» встаёт на устаревшем значении и
   * повторяется до бесконечности. Чтению не нужна: реестр и так живёт минутами,
   * а строгое чтение идёт мимо края сети — то есть каждый игрок на каждом чтении
   * платил бы за свежесть, которой всё равно не пользуется.
   */
  const hot = io.stores(STORES.world, 'strong');
  const cool = io.stores(STORES.world, 'eventual');

  if (req.method === 'GET') {
    const found = await cool.getWithMetadata(KEY);
    const file = readRoster(found ? parseJson(String(found.data)) : null);
    return json(answer(file, key, now, open, open ? await holdsOf(io) : {}));
  }

  if (req.method === 'POST') return bandRoute(req, io, key, now, admin);
  if (req.method !== 'PUT') return deny(405, 'method');

  const text = await readBody(req);
  if (text === null) return deny(413, 'too-big');
  const sent = parseJson<unknown>(text);
  const said = readClaim(sent);
  if (!said) return deny(400, 'bad-body');
  // Мощь и население — не больше подтверждённого (docs/security.md). Наблюдение не прочиталось — реестр подождёт.
  const claim = await confirmedClaim(io, key, said);
  if (!claim) return deny(503, 'busy', { 'retry-after': '10' });

  // Режим появления (docs/test_world.md): места острова или обычное расселение — один на весь запрос.
  const mode = spawnMode();
  // Прочитать — изменить — записать, и место для нового замка выбирается
  // **внутри** цикла. Иначе двое, зашедших в одну секунду, посчитали бы клетку
  // каждый по своему списку, и второй записал бы место, выбранное без учёта
  // первого, — то есть сервер сам поставил бы два замка вплотную.
  for (let tries = 0; tries < WRITE_TRIES; tries++) {
    const found = await hot.getWithMetadata(KEY);
    const file = readRoster(found ? parseJson(String(found.data)) : null);
    const etag = found?.etag ?? null;

    // У игрока либо замок, либо отряд (ПН-3): отряд бродяги замок не просит — честный клиент в фазе бродяги строку замка не шлёт.
    if (file.bands?.[key]) {
      await observe(io.stores, key, (rec) => addFlags(rec, now, [{ kind: 'forged', text: 'Строка замка от отряда бродяги: у бродяги замка нет.' }]));
      return json({ ...answer(file, key, now, open), error: 'Ты бродяга: замка у тебя нет.' });
    }
    const had = file.rows[key];
    // Ничего не изменилось и писать не за чем — отвечаем тем, что есть. Отказом
    // это не является: реестр общий, и каждая лишняя запись — ещё одна гонка за
    // право его переписать.
    if (had && (now - had.seenAt < MIN_WRITE_MS || !worthWriting(file, key, claim, now, QUIET_MS))) {
      return json(answer(file, key, now, open));
    }

    const next = prune(upsert(file, key, claim, now, mode), now, key);
    // Эпоха — ещё раз, перед самой записью (OPS-3): стирание после проверки на входе не воскрешает строку старой эпохи.
    const late = await eraGate(req, io);
    if (late) return late;
    const written = await hot.setJSON(KEY, next, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag });
    if (written.modified) return json(answer(next, key, now, open));
  }

  // Не смогли пробиться за `WRITE_TRIES` попыток. Это не ошибка: реестр общий, кто-то
  // писал в него быстрее. Игра попробует ещё раз своим чередом.
  return deny(429, 'slow-down', { 'retry-after': '10' });
};

/**
 * Приказ отряда бродяги (ПН-3, `POST`): встать в реестр, «Идти сюда», «Встать лагерем». Путь закрыт игроку (`roamOpenFor`: до
 * выпуска — не админ) — отказ 403 без флага (честный клиент такого не шлёт, а неоткрытое не подделка). Ход и лагерь выводит сервер
 * дверью `world/roam` (`roster.bandOrder`); невозможное — отказ словами и флаг в наблюдении игрока. Место выхода выбирается внутри
 * цикла записи, как клетка замка: двое, вошедших разом, не встанут у одних руин.
 *
 * Админ входит в путь новой партией (стартовый экран, 30.10.2026), а новая партия до кнопки уже встала в реестр строкой замка: его
 * первое «встать» отрядом снимает свою строку замка — у игрока либо замок, либо отряд. Только у админа: игроку с замком приказ
 * отряда по-прежнему подделка. Выпуск Среза 1 решит, как входят в путь все (чистый старт эпохи, 6.7).
 */
async function bandRoute(req: Request, io: Parameters<Route>[1], key: string, now: number, admin: boolean): Promise<Response> {
  if (!roamOpenFor(admin)) return deny(403, 'roam-off');
  const text = await readBody(req);
  if (text === null) return deny(413, 'too-big');
  const order = readBandOrder(parseJson<unknown>(text));
  if (!order) return deny(400, 'bad-body');
  const hot = io.stores(STORES.world, 'strong');
  const mode = spawnMode();
  // Часы партии отряда (ПН-4у) — из описи наблюдения, по событию: ими сервер ведёт ночь и сезон отряда до следующего приказа.
  let card: { card: ReturnType<typeof readWatchRecord>['card']; at: number } = { card: undefined, at: 0 };
  try {
    const got = await io.stores(STORES.watch, 'strong').getWithMetadata(key);
    const rec = readWatchRecord(got ? parseJson(String(got.data)) : null);
    card = { card: rec.card, at: rec.cardAt };
  } catch {
    // Наблюдение не ответило — строка живёт прежней отметкой часов.
  }
  // Указы админа отряду (ПН-6): их бойцы ложатся в книгу отряда по номеру. Хранилище не ответило — книга подождёт следующего приказа.
  // Вольные замки пула (ПН-10): взятые отрядами пул не держат — пул пополняется приказом отряда внутри цикла записи.
  const holds = await holdsOf(io);
  let grants: StoredGrant[] = [];
  try {
    grants = (await grantsOf(io.stores, key)).list;
  } catch {
    grants = [];
  }
  for (let tries = 0; tries < WRITE_TRIES; tries++) {
    const found = await hot.getWithMetadata(KEY);
    const read = readRoster(found ? parseJson(String(found.data)) : null);
    const etag = found?.etag ?? null;
    // Вход админа в путь новой партией: своя строка замка уходит с первым «встать» отрядом (см. выше).
    const file = admin && order.op === 'seat' && read.rows[key] && !read.bands?.[key] ? dropCastle(read, key) : read;
    const time = clockAt(file.bands?.[key]?.clock, card.card, card.at);
    const done = bandOrder(file, key, order, now, mode, time.clock, { ...(card.card?.seed !== undefined ? { seed: card.card.seed } : {}), grants });
    const flag = async (): Promise<void> => {
      const f = [...(done.forged ? [done.forged] : []), ...(time.flag && !done.error ? [time.flag] : [])];
      if (f.length > 0) await observe(io.stores, key, (rec) => addFlags(rec, now, f));
    };
    if (done.error) {
      await flag();
      return json({ ...answer(read, key, now, true, holds), error: done.error });
    }
    const next = fillFree(done.file, now, holds, mode);
    // Эпоха — ещё раз, перед самой записью (OPS-3): стирание после проверки на входе не воскрешает строку старой эпохи.
    const late = await eraGate(req, io);
    if (late) return late;
    const written = await hot.setJSON(KEY, next, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag });
    if (written.modified) {
      await flag();
      return json(answer(next, key, now, true, holds));
    }
  }
  return deny(429, 'slow-down', { 'retry-after': '10' });
}

/** Реестр без строки замка игрока `key` (вход админа в путь): прочие строки — те же. */
function dropCastle(file: RosterFile, key: string): RosterFile {
  const { [key]: _gone, ...rows } = file.rows;
  return { ...file, rows };
}

/**
 * Что игрок сообщил о себе, приведённое к подтверждённому книгами: мощь — формулой игры по подтверждённым уровням и войску,
 * население — подтверждённые жители, войско и ученики (`derived.population`). Записи наблюдения ещё нет (первый заход до
 * первой записи партии) — посёлок новой партии: всё первого уровня, войска нет, `START_POP` жителей. `null` — хранилище
 * наблюдения не ответило.
 */
async function confirmedClaim(io: Parameters<Route>[1], player: string, said: CastleClaim): Promise<CastleClaim | null> {
  let conf: ReturnType<typeof confirmedOf>;
  try {
    const found = await io.stores(STORES.watch, 'strong').getWithMetadata(player);
    const rec = readWatchRecord(found ? parseJson(String(found.data)) : null);
    conf = confirmedOf(rec);
    if (conf) conf = { ...conf, pop: conf.pop + Object.values(conf.troops).reduce((t, x) => t + x, 0) + Math.min(rec.card?.queued ?? 0, rec.town?.queued ?? 0) };
  } catch {
    return null;
  }
  const power = conf ? powerOfCounts(conf.levels, conf.troops) : powerOfCounts(seedTown(1).levels, {});
  const pop = conf ? conf.pop : START_POP;
  return { ...said, power: Math.min(said.power, power), pop: Math.min(said.pop, pop) };
}
