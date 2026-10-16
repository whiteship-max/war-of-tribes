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
import { readClaim, type CastleClaim, type RosterFile, type RosterResponse } from '../contract.js';
import { ROSTER_KEY, prune, readRoster, rosterEpoch, upsert, viewOf, worthWriting } from '../roster.js';
import { STORES } from '../kv.js';
import { confirmedOf, readWatchRecord } from '../watch.js';
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

/** Ответ реестра: своя клетка и соседи в пределах досягаемости. */
function answer(file: RosterFile, key: string, now: number): RosterResponse {
  const own = file.rows[key];
  const mine = own ? { x: own.x, y: own.y } : null;
  const castles = own
    ? viewOf(file).filter((c) => Math.hypot(c.x - own.x, c.y - own.y) <= NEAR)
    : [];
  return { now, epoch: rosterEpoch(), mine, castles };
}

export const castles: Route = async (req, io) => {
  const now = io.now;
  const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
  // Наружу — одно слово на все причины отказа, как и у сохранения.
  if (!auth.ok) return deny(401, 'unauthorized');

  const key = saveKeyOf(auth.user);
  if (!allow(`castles:${key}`, PER_MINUTE, now)) return deny(429, 'slow-down', { 'retry-after': '5' });
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
    return json(answer(file, key, now));
  }

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

    const had = file.rows[key];
    // Ничего не изменилось и писать не за чем — отвечаем тем, что есть. Отказом
    // это не является: реестр общий, и каждая лишняя запись — ещё одна гонка за
    // право его переписать.
    if (had && (now - had.seenAt < MIN_WRITE_MS || !worthWriting(file, key, claim, now, QUIET_MS))) {
      return json(answer(file, key, now));
    }

    const next = prune(upsert(file, key, claim, now, mode), now, key);
    const written = await hot.setJSON(KEY, next, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag });
    if (written.modified) return json(answer(next, key, now));
  }

  // Не смогли пробиться за `WRITE_TRIES` попыток. Это не ошибка: реестр общий, кто-то
  // писал в него быстрее. Игра попробует ещё раз своим чередом.
  return deny(429, 'slow-down', { 'retry-after': '10' });
};

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
