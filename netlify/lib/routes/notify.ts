/**
 * Исходящие уведомления (`/api/notify`): принять список, присутствие и настройки; отдать
 * состояние. Один обработчик на Netlify (`functions/notify.mts`) и на своём сервере (`vps/`).
 *
 * Сервер здесь **читает то, что хранит** — второй раз после реестра замков, и это решение
 * владельца, записанное вслух (docs/handbook/sync.md, «Личность игрока»; тест `server.test.ts`
 * перечисляет разбирающие записи поимённо). Читает он поручение, а не партию: «в такую-то
 * минуту скажи вот это». О мире он не знает ничего и ничего не судит.
 *
 * Правила те же, что у сохранения:
 *
 * 1. **Личность — только из подписи.** Ключ записи собирается из проверенного
 *    идентификатора; писать можно только себе, и написать можно только себе — адресат
 *    сообщения бота берётся из той же подписи. Из неё же — разрешение писать
 *    (`allows_write_to_pm`): канал, закрытый отказом Telegram, этим открывается снова.
 * 2. **Форма, а не смысл.** Число пунктов, даль `fireAt`, частота списка и расхождение
 *    часов составления с нашими — в потолках `NOTICE_LIMITS`, виды из белого списка, имя
 *    двора — строка без разметки (`contract.readNotices`, `notify.accept`).
 * 3. **Одновременная запись не теряется молча.** Прочитать — изменить — записать поверх
 *    ETag: запись переписывают двое — этот приём и проход доставки.
 *
 * Игрок, выключивший уведомления, по-прежнему присылает присутствие и список: рычаг (`prefs.on`) решает
 * проход доставки, а не клиент, — кнопка под сообщением бота переключает его, не спрашивая игру.
 */
import { readInitData, saveKeyOf } from '../initdata.js';
import { WRITE_TRIES, allow, botToken, deny, json, parseJson, readBody, type Route } from '../http.js';
import type { NotifyPut } from '../contract.js';
import { accept, readNotify, stateOf } from '../notify.js';
import { STORES } from '../kv.js';

/** Запросов в минуту на игрока — грубое сито; настоящий предел списка — в самой записи. */
const PER_MINUTE = 30;

/** Список короткий: пунктов в нём не больше `NOTICE_LIMITS.items`. */
const MAX_NOTIFY_BYTES = 16 * 1024;

export const notify: Route = async (req, io) => {
  const now = io.now;
  const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
  if (!auth.ok) return deny(401, 'unauthorized');

  const key = saveKeyOf(auth.user);
  if (!allow(`notify:${key}`, PER_MINUTE, now)) return deny(429, 'slow-down', { 'retry-after': '5' });

  const store = io.stores(STORES.notify);
  const due = io.stores(STORES.due);

  if (req.method === 'GET') {
    const found = await store.getWithMetadata(key);
    return json(stateOf(readNotify(found ? parseJson(String(found.data)) : null), now));
  }

  if (req.method !== 'PUT') return deny(405, 'method');

  const text = await readBody(req);
  if (text === null || Buffer.byteLength(text, 'utf8') > MAX_NOTIFY_BYTES) return deny(413, 'too-big');
  const put = parseJson<NotifyPut>(text);
  if (!put) return deny(400, 'bad-body');

  for (let tries = 0; tries < WRITE_TRIES; tries++) {
    const found = await store.getWithMetadata(key);
    const rec = readNotify(found ? parseJson(String(found.data)) : null);
    const { record, marks, fail } = accept(rec, put, key, now, auth.user.allowsWrite === true);
    // Отказан список, а больше в запросе ничего и не было — писать нечего.
    if (fail && put.present === undefined && put.prefs === undefined && put.canWrite === undefined) return deny(fail.status, fail.error);
    const written = await store.setJSON(
      key,
      record,
      found?.etag ? { onlyIfMatch: found.etag } : { onlyIfNew: true },
    );
    if (!written.modified) continue;
    // Метки — после записи: метка без записи безвредна (проход прочтёт и снимет), запись
    // без метки не ушла бы вовсе. Поэтому ошибка метки — это отказ, а не молчание.
    for (const mark of marks) await due.set(mark, '1');
    if (fail) return deny(fail.status, fail.error);
    return json(stateOf(record, now));
  }
  return deny(429, 'slow-down', { 'retry-after': '5' });
};
