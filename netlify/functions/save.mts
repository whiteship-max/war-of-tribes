/**
 * Сохранение игрока: прочитать своё, записать своё. Больше эта функция не умеет
 * ничего, и это её главное свойство.
 *
 * Три правила, из которых следует всё остальное:
 *
 * 1. **Личность — только из подписи.** Ключ хранилища собирается из
 *    идентификатора, вынутого из `initData` и проверенного HMAC по токену бота
 *    (`lib/initdata.ts`). Ни тела, ни строки запроса, ни заголовка, которым
 *    можно было бы назвать себя чужим именем, здесь нет: читать и писать можно
 *    только своё, и это не проверка, а устройство — чужого ключа не из чего
 *    собрать.
 * 2. **Сервер хранит, а не судит.** Сохранение — непрозрачная строка. Функция
 *    не разбирает состояние партии, не считает ресурсы, не начисляет ничего и
 *    ничему не верит на слово ровно потому, что ни во что и не смотрит.
 *    Алмазов здесь нет ни в каком виде — ни поля, ни имени (тест `sync.test.ts`
 *    читает эту папку исходником).
 * 3. **Одновременная запись не теряется молча.** Кто пишет, обязан сказать,
 *    поверх какой записи он пишет (`baseEtag`). Легло что-то другое — ответ 409
 *    вместе с чужой записью, и разбирается с этим игрок, а не сервер.
 */
import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { readInitData, saveKeyOf } from '../lib/initdata.js';
import { allow, botToken, deny, json, parseJson, readBody } from '../lib/http.js';
import { readRecord, type ConflictResponse, type PullResponse, type PushBody, type PushResponse } from '../lib/contract.js';

export const config: Config = {
  /**
   * Путь объявлен здесь, а не переписыванием в `netlify.toml`: у сайта стоит
   * общее правило «любой путь отдаёт index.html», и правило функции обязано
   * стоять раньше него. Объявленный путь платформа разбирает до переписываний,
   * поэтому порядок правил в двух файлах (`_redirects` и `netlify.toml`)
   * перестаёт иметь значение.
   */
  path: '/api/save',
};

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

const store = () => getStore({ name: 'tribe-saves', consistency: 'strong' });

export default async (req: Request, _context: Context): Promise<Response> => {
  const now = Date.now();
  const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
  // Наружу — одно слово на все причины отказа. Который именно замок не сошёлся,
  // знать полезно только тому, кто их подбирает.
  if (!auth.ok) return deny(401, 'unauthorized');

  const key = saveKeyOf(auth.user);
  if (!allow(key, PER_MINUTE)) return deny(429, 'slow-down', { 'retry-after': '5' });

  if (req.method === 'GET') {
    const found = await store().getWithMetadata(key, { type: 'text' });
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

  const found = await store().getWithMetadata(key, { type: 'text' });
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

  const written = await store().setJSON(
    key,
    record,
    baseEtag === null ? { onlyIfNew: true } : { onlyIfMatch: baseEtag },
  );
  // Между чтением и записью успел кто-то третий. Не ошибка сервера — та же
  // развилка, что и выше, только выигранная не нами.
  if (!written.modified || !written.etag) {
    const again = await store().getWithMetadata(key, { type: 'text' });
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
