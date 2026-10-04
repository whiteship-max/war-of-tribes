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
 *    Алмазов здесь нет ни в каком виде — ни поля, ни имени (тест `server.test.ts`
 *    читает эту папку исходником).
 * 3. **Одновременная запись не теряется молча.** Кто пишет, обязан сказать,
 *    поверх какой записи он пишет (`baseEtag`). Легло что-то другое — ответ 409
 *    вместе с чужой записью, и разбирается с этим игрок, а не сервер.
 */
import { readInitData, saveKeyOf } from '../initdata.js';
import { allow, botToken, deny, json, parseJson, readBody, type Route } from '../http.js';
import { readRecord, type ConflictResponse, type PullResponse, type PushBody, type PushResponse } from '../contract.js';
import { STORES } from '../kv.js';

/** Потолки на части записи. Партия целиком укладывается в десятки килобайт. */
const LIMITS = { game: 320 * 1024, world: 160 * 1024 };

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

  const store = io.stores(STORES.saves);

  if (req.method === 'GET') {
    const found = await store.getWithMetadata(key);
    const body: PullResponse = {
      now,
      etag: found?.etag ?? null,
      record: found ? parseJson(String(found.data)) : null,
    };
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
    };
    return json(body, 409);
  }

  if (current && typeof current.updatedAt === 'number' && now - current.updatedAt < MIN_WRITE_MS) {
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
    };
    return json(body, 409);
  }

  const body: PushResponse = { now, etag: written.etag, rev: record.rev };
  return json(body);
};
