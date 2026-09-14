/**
 * Исходящие уведомления: принять список, присутствие и настройки; отдать состояние.
 *
 * Сервер здесь **читает то, что хранит** — второй раз после реестра замков, и это решение
 * владельца, записанное вслух (CLAUDE.md, «Личность игрока»; тест `server.test.ts`
 * перечисляет разбирающие записи поимённо). Читает он поручение, а не партию: «в такую-то
 * минуту скажи вот это». О мире он не знает ничего и ничего не судит.
 *
 * Правила те же, что у сохранения:
 *
 * 1. **Личность — только из подписи.** Ключ записи собирается из проверенного
 *    идентификатора; писать можно только себе, и написать можно только себе — адресат
 *    сообщения в следующей пачке берётся из той же подписи.
 * 2. **Форма, а не смысл.** Не больше восьми пунктов, `fireAt` не дальше двенадцати
 *    часов, виды из белого списка, имя двора — строка без разметки, список не чаще раза в
 *    пять секунд, часы составления сходятся с нашими в пределах двух минут
 *    (`contract.readNotices`, `lib/notify.accept`).
 * 3. **Одновременная запись не теряется молча.** Прочитать — изменить — записать поверх
 *    ETag: запись переписывают двое — этот приём и проход доставки.
 *
 * Клиент, у которого уведомления выключены (`NOTIFY_ON` в `src/net/notify.ts`), сюда не
 * ходит вовсе.
 */
import type { Config, Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { readInitData, saveKeyOf } from '../lib/initdata.js';
import { allow, botToken, deny, json, parseJson, readBody } from '../lib/http.js';
import type { NotifyPut } from '../lib/contract.js';
import { accept, readNotify, stateOf } from '../lib/notify.js';

export const config: Config = { path: '/api/notify' };

/** Запросов в минуту на игрока — грубое сито; настоящий предел списка — в самой записи. */
const PER_MINUTE = 30;

/** Сколько раз пытаться выиграть запись у прохода доставки. */
const WRITE_TRIES = 4;

/** Список короткий: восемь пунктов — это пара килобайт. */
const MAX_NOTIFY_BYTES = 16 * 1024;

const store = () => getStore({ name: 'tribe-notify', consistency: 'strong' });
const due = () => getStore({ name: 'tribe-notify-due', consistency: 'strong' });

export default async (req: Request, _context: Context): Promise<Response> => {
  const now = Date.now();
  const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
  if (!auth.ok) return deny(401, 'unauthorized');

  const key = saveKeyOf(auth.user);
  if (!allow(key, PER_MINUTE)) return deny(429, 'slow-down', { 'retry-after': '5' });

  if (req.method === 'GET') {
    const found = await store().getWithMetadata(key, { type: 'text' });
    return json(stateOf(readNotify(found ? parseJson(String(found.data)) : null), now));
  }

  if (req.method !== 'PUT') return deny(405, 'method');

  const text = await readBody(req);
  if (text === null || Buffer.byteLength(text, 'utf8') > MAX_NOTIFY_BYTES) return deny(413, 'too-big');
  const put = parseJson<NotifyPut>(text);
  if (!put) return deny(400, 'bad-body');

  for (let tries = 0; tries < WRITE_TRIES; tries++) {
    const found = await store().getWithMetadata(key, { type: 'text' });
    const rec = readNotify(found ? parseJson(String(found.data)) : null);
    const { record, marks, fail } = accept(rec, put, key, now);
    // Отказан список, а больше в запросе ничего и не было — писать нечего.
    if (fail && put.present === undefined && put.prefs === undefined) return deny(fail.status, fail.error);
    const written = await store().setJSON(
      key,
      record,
      found?.etag ? { onlyIfMatch: found.etag } : { onlyIfNew: true },
    );
    if (!written.modified) continue;
    // Метки — после записи: метка без записи безвредна (проход прочтёт и снимет), запись
    // без метки не ушла бы вовсе. Поэтому ошибка метки — это отказ, а не молчание.
    for (const mark of marks) await due().set(mark, '1');
    if (fail) return deny(fail.status, fail.error);
    return json(stateOf(record, now));
  }
  return deny(429, 'slow-down', { 'retry-after': '5' });
};
