/**
 * Вебхук бота (`/api/bot`): кнопки под сообщениями — «Отключить уведомления» и «Включить» (решение владельца,
 * docs/NOTIFY.md, раздел 12). Один обработчик на Netlify (`functions/bot.mts`) и на своём сервере (`vps/`).
 *
 * **Личность здесь — не из подписи `initData`, а из обновления Telegram**, и это расширение правила «личность
 * только из подписи», сказанное вслух (docs/handbook/sync.md). Доказательство подлинности обновления — секрет
 * вебхука (`http.botSecret`): владелец задаёт его в `setWebhook`, Telegram присылает его заголовком
 * `X-Telegram-Bot-Api-Secret-Token`, и без верного заголовка обработчик не трогает хранилища вовсе. Нет секрета в
 * окружении — вебхук закрыт для всех. Что вебхук может, — ровно одно: переключить рычаг уведомлений того, кто
 * нажал кнопку (`callback_query.from.id`), и отметить канал по `my_chat_member` (заблокировал бота — закрыт,
 * вернул — открыт). Партию он не читает и не пишет, войн не знает (тест `server.test.ts`).
 *
 * Telegram ждёт на каждое обновление ответа 200, иначе шлёт его снова: всё, что не наше, — 200 и тишина.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { WRITE_TRIES, allow, botSecret, deny, json, parseJson, readBody, type Route } from '../http.js';
import { closeChannel, readNotify, switchTo, type NotifyRecord } from '../notify.js';
import { STORES } from '../kv.js';
import { CALLBACK_OFF, CALLBACK_ON, SWITCHED_OFF, SWITCHED_ON } from '../words.js';
import { telegram, type Telegram } from '../telegram.js';

/** Обновлений в минуту на игрока — нажатий кнопок больше не бывает. */
const PER_MINUTE = 30;

/** Обновление Telegram короткое; длиннее — не наше. */
const MAX_UPDATE_BYTES = 64 * 1024;

/** Секрет из заголовка против секрета окружения — сравнением постоянного времени по отпечаткам. */
function secretOk(got: string | null): boolean {
  const want = botSecret();
  if (!want || !got) return false;
  const a = createHash('sha256').update(got).digest();
  const b = createHash('sha256').update(want).digest();
  return timingSafeEqual(a, b);
}

/** Идентификатор пользователя Telegram из обновления: только положительное целое. */
const userId = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null);

/** Что сделать с записью игрока по обновлению. */
type Change = { on: boolean; callback: string; chat: number | null; message: number | null } | { chan: 'open' | 'closed' };

function changeOf(update: Record<string, unknown>): { id: number; change: Change } | null {
  const cb = update.callback_query as Record<string, unknown> | undefined;
  if (cb && typeof cb === 'object') {
    const id = userId((cb.from as Record<string, unknown> | undefined)?.id);
    if (id === null || typeof cb.id !== 'string') return null;
    if (cb.data !== CALLBACK_OFF && cb.data !== CALLBACK_ON) return null;
    const msg = (cb.message ?? {}) as Record<string, unknown>;
    const chat = userId((msg.chat as Record<string, unknown> | undefined)?.id);
    const message = typeof msg.message_id === 'number' ? msg.message_id : null;
    return { id, change: { on: cb.data === CALLBACK_ON, callback: cb.id, chat, message } };
  }
  const member = update.my_chat_member as Record<string, unknown> | undefined;
  if (member && typeof member === 'object') {
    const chat = (member.chat ?? {}) as Record<string, unknown>;
    // Только личный чат с ботом: группы и каналы нас не касаются.
    if (chat.type !== 'private') return null;
    const id = userId((member.from as Record<string, unknown> | undefined)?.id);
    const status = (member.new_chat_member as Record<string, unknown> | undefined)?.status;
    if (id === null) return null;
    if (status === 'kicked') return { id, change: { chan: 'closed' } };
    if (status === 'member') return { id, change: { chan: 'open' } };
  }
  return null;
}

/** Обработчик с адаптером снаружи — тест подменяет Telegram, сети у тестов нет. */
export const botWith =
  (tg: () => Telegram): Route =>
  async (req, io) => {
    if (req.method !== 'POST') return deny(405, 'method');
    if (!secretOk(req.headers.get('x-telegram-bot-api-secret-token'))) return deny(401, 'unauthorized');

    const text = await readBody(req);
    if (text === null || Buffer.byteLength(text, 'utf8') > MAX_UPDATE_BYTES) return json({ ok: true });
    const update = parseJson<Record<string, unknown>>(text);
    const found = update && typeof update === 'object' ? changeOf(update) : null;
    if (!found) return json({ ok: true });

    const now = io.now;
    const player = `tg-${found.id}`;
    if (!allow(`bot:${player}`, PER_MINUTE, now)) return json({ ok: true });

    const store = io.stores(STORES.notify);
    const change = found.change;
    let done = false;
    for (let tries = 0; tries < WRITE_TRIES && !done; tries++) {
      const was = await store.getWithMetadata(player);
      const rec = readNotify(was ? parseJson(String(was.data)) : null);
      const next: NotifyRecord =
        'chan' in change ? (change.chan === 'closed' ? closeChannel(rec, now) : { ...rec, chan: { state: 'open', at: now } }) : switchTo(rec, change.on, now);
      const written = await store.setJSON(player, next, was?.etag ? { onlyIfMatch: was.etag } : { onlyIfNew: true });
      done = written.modified;
    }

    if ('callback' in change) {
      const api = tg();
      await api.answer(change.callback, done ? (change.on ? SWITCHED_ON : SWITCHED_OFF) : 'Не вышло. Нажми ещё раз.');
      if (done && change.chat !== null && change.message !== null) await api.button(change.chat, change.message, change.on);
    }
    return json({ ok: true });
  };

export const bot: Route = botWith(() => telegram());
