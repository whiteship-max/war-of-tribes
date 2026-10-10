/**
 * Сохранение игрока (`/api/save`): прочитать своё, записать своё. Больше этот обработчик не
 * умеет ничего, и это его главное свойство. Один на Netlify (`functions/save.mts`) и на своём
 * сервере (`vps/`): разница между ними — только в хранилище, которое приходит в `io`.
 *
 * Три правила, из которых следует всё остальное:
 *
 * 1. **Личность — только из подписи.** Ключ хранилища собирается из
 *    идентификатора, вынутого из `initData` и проверенного HMAC по токену бота
 *    (`initdata.ts`). Ни тела, ни строки запроса, ни заголовка, которым
 *    можно было бы назвать себя чужим именем, здесь нет: читать и писать можно
 *    только своё, и это не проверка, а устройство — чужого ключа не из чего
 *    собрать.
 * 2. **Сервер хранит, а не судит.** Сохранение — непрозрачная строка. Обработчик
 *    не разбирает состояние партии, не считает ресурсы, не начисляет ничего и
 *    ничему не верит на слово ровно потому, что ни во что и не смотрит.
 *    Алмазы ведёт своя книга (`lib/gems.ts`, docs/gems.md): сохранение только
 *    приносит её записку и открывает книгу при первом входе в эпоху мира.
 * 3. **Одновременная запись не теряется молча.** Кто пишет, обязан сказать,
 *    поверх какой записи он пишет (`baseEtag`). Легло что-то другое — ответ 409
 *    вместе с чужой записью, и разбирается с этим игрок, а не сервер.
 *
 * Книги войска, стройки и жителей (docs/pvp.md, разделы 6 и 7): принятая запись двигает их в наблюдении игрока — опись
 * заявляет, сервер подтверждает не больше, чем объясняют правила за прошедшее время. Партию они тоже не разбирают:
 * читают опись, запись войн и книгу алмазов.
 *
 * Админка (docs/admin.md) добавила к ответу записку (`admin`): заморожен ли аккаунт и какие указы админа партия ещё не
 * применила. Замороженному запись не принимается — 423. Попутно сохранение отмечает заход и опись в наблюдении
 * (`watch.ts`); партию оно по-прежнему не разбирает.
 */
import { readInitData, saveKeyOf } from '../initdata.js';
import { eraGate } from '../era.js';
import { allow, botToken, deny, json, parseJson, readBody, type Route } from '../http.js';
import { readRecord, type ConflictResponse, type FrozenResponse, type PullResponse, type PushBody, type PushResponse } from '../contract.js';
import { STORES } from '../kv.js';
import { frozenNow, grantsOf, isFrozen, noteOf } from '../admin.js';
import { booked, invitedBy, observe, tooFast, touched, wrote } from '../watch.js';
import { readWars, WARS_KEY, type WarFile } from '../war.js';
import { gemNoteOf, rushesOf, settleGems } from '../gems.js';

/**
 * Потолки на части записи. Партия племени укладывается в десятки килобайт; мир — нет: каждый из тридцати отчётов о бое
 * (`REPORTS_KEPT`) несёт запись боя на 7–8 КБ, и при 160 КБ запись мира переставала проходить уже на двадцать втором
 * бою — после него сервер отклонял каждую запись партии до конца теста (docs/bughunt.md, «Мир перерастал потолок»).
 * Потолок мира — с запасом вдвое над тридцатью боями; тело запроса целиком — `MAX_BODY_BYTES`.
 */
export const LIMITS = { game: 320 * 1024, world: 448 * 1024 };

/**
 * Чаще этого одна и та же партия не переписывается. Предел настоящий, а не
 * по памяти экземпляра: он выводится из времени в самой записи и переживает и
 * смерть функции, и переезд между её экземплярами. Игра пишет на сервер раз в
 * `PUSH_MS` (`src/net/sync.ts`) — в этот предел она не упирается никогда.
 */
const MIN_WRITE_MS = 4000;

/** Запросов в минуту на игрока — грубое сито поверх настоящего предела. */
const PER_MINUTE = 60;

export const save: Route = async (req, io) => {
  const now = io.now;
  const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
  // Наружу — одно слово на все причины отказа. Который именно замок не сошёлся,
  // знать полезно только тому, кто их подбирает.
  if (!auth.ok) return deny(401, 'unauthorized');

  const key = saveKeyOf(auth.user);
  if (!allow(`save:${key}`, PER_MINUTE, now)) return deny(429, 'slow-down', { 'retry-after': '5' });
  // Эпоха мира (docs/test_world.md): партия другой эпохи не пишется и не читается — после чистого старта она не воскресает.
  const gone = await eraGate(req, io);
  if (gone) return gone;

  const store = io.stores(STORES.saves);
  const frozen = isFrozen(await frozenNow(io.stores), key);
  const grants = await grantsOf(io.stores, key);
  const user = auth.user.username;
  // Кто привёл (docs/feed.md, раздел 3): метка ляжет только на первом заходе — в `touched`.
  const ref = invitedBy(auth.user.start, key);

  if (req.method === 'GET') {
    const found = await store.getWithMetadata(key);
    // Книга алмазов (docs/gems.md): первый вход в эпоху мира открывает её со стартовыми. Не ответила — без записки.
    const ledger = await settleGems(io.stores, key, now);
    // Партия на устройстве может быть впереди серверной записи: указы и дела алмазов — все, что лежат; лишние клиент
    // отсеет номером.
    const body: PullResponse = {
      now,
      etag: found?.etag ?? null,
      record: found ? parseJson(String(found.data)) : null,
      admin: noteOf(frozen, grants, 0),
      ...(ledger ? { gems: gemNoteOf(ledger.ledger, 0, now) } : {}),
    };
    await observe(io.stores, key, (rec) => touched(rec, now, user, ref));
    return json(body);
  }

  if (req.method !== 'PUT') return deny(405, 'method');

  const text = await readBody(req);
  if (text === null) return deny(413, 'too-big');
  const sent = parseJson<PushBody>(text);
  if (!sent) return deny(400, 'bad-body');
  const record = readRecord(sent.record, LIMITS);
  if (!record) return deny(400, 'bad-body');
  const baseEtag = typeof sent.baseEtag === 'string' ? sent.baseEtag : null;
  const admin = noteOf(frozen, grants, record.watch?.seen ?? 0);

  // Замороженный видит игру, но записи его не принимаются: ответ скажет почему, и игра покажет плашку.
  if (frozen) {
    const body: FrozenResponse = { error: 'frozen', now, admin };
    await observe(io.stores, key, (rec) => touched(rec, now, user, ref));
    return json(body, 423);
  }

  const found = await store.getWithMetadata(key);
  const current = found ? parseJson<{ rev?: number; updatedAt?: number }>(String(found.data)) : null;

  // Расхождение видно до записи: пишущий назвал не ту запись, поверх которой
  // лёг бы. Отдаём чужую целиком — выбирать между двумя партиями игроку, и
  // выбирать ему есть из чего только вместе с описью.
  if ((found?.etag ?? null) !== baseEtag) {
    const body: ConflictResponse = {
      error: 'conflict',
      now,
      etag: found?.etag ?? null,
      record: found ? parseJson(String(found.data)) : null,
      admin,
    };
    return json(body, 409);
  }

  if (current && typeof current.updatedAt === 'number' && now - current.updatedAt < MIN_WRITE_MS) {
    await observe(io.stores, key, (rec) => tooFast(rec, now));
    return deny(429, 'slow-down', { 'retry-after': '5' });
  }

  record.rev = (current?.rev ?? 0) + 1;
  record.updatedAt = now;

  const written = await store.setJSON(
    key,
    record,
    baseEtag === null ? { onlyIfNew: true } : { onlyIfMatch: baseEtag },
  );
  // Между чтением и записью успел кто-то третий. Не ошибка сервера — та же
  // развилка, что и выше, только выигранная не нами.
  if (!written.modified || !written.etag) {
    const again = await store.getWithMetadata(key);
    const body: ConflictResponse = {
      error: 'conflict',
      now,
      etag: again?.etag ?? null,
      record: again ? parseJson(String(again.data)) : null,
      admin,
    };
    return json(body, 409);
  }

  const card = record.card;
  const rev = record.rev;
  // Книга войска (docs/pvp.md, раздел 6) вычитает потери войны, посчитанные сервером, — по записи войн. Не прочиталась —
  // потери подождут следующей записи: книга помнит, какие бои уже вычла.
  const wars = await readWarsSoft(io);
  const seen = record.war?.seen;
  // Книга алмазов — записка партии (баланс, лавка, неприменённые дела) и уровни, ускоренные за алмазы: книга стройки
  // подтверждает их без работы (docs/pvp.md, раздел 7). Не ответила — без записки; ускорения подождут следующей записи.
  const ledger = await settleGems(io.stores, key, now);
  const paid = rushesOf(ledger?.ledger ?? null);
  await observe(io.stores, key, (rec) => booked(wrote(touched(rec, now, user, ref), now, card, record.watch, rev), now, record.watch, seen, grants.list, wars, key, paid));
  const body: PushResponse = {
    now,
    etag: written.etag,
    rev: record.rev,
    admin,
    ...(ledger ? { gems: gemNoteOf(ledger.ledger, record.watch?.gemSeen ?? 0, now) } : {}),
  };
  return json(body);
};

/** Запись войн для книги войска — только чтение и попутно: ошибка хранилища не роняет запись партии. */
async function readWarsSoft(io: Parameters<Route>[1]): Promise<WarFile | null> {
  try {
    const found = await io.stores(STORES.world, 'eventual').getWithMetadata(WARS_KEY);
    return readWars(found ? parseJson(String(found.data)) : null);
  } catch {
    return null;
  }
}
