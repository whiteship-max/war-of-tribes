/**
 * Вебхук бота (`/api/bot`): настройки вестей — `/notify` и кнопки под ним (роды, тихий час, «только срочное», общий
 * рычаг; ВС-1, docs/NOTIFY.md, раздел 13), «Настроить вести» под каждой вестью и прежние «Отключить» / «Включить» под
 * старыми сообщениями. Один обработчик на Netlify (`functions/bot.mts`) и на своём сервере (`vps/`).
 *
 * **Личность здесь — не из подписи `initData`, а из обновления Telegram**, и это расширение правила «личность
 * только из подписи», сказанное вслух (docs/handbook/sync.md). Доказательство подлинности обновления — секрет
 * вебхука (`http.botSecret`): владелец задаёт его в `setWebhook`, Telegram присылает его заголовком
 * `X-Telegram-Bot-Api-Secret-Token`, и без верного заголовка обработчик не трогает хранилища вовсе. Нет секрета в
 * окружении — вебхук закрыт для всех. Что вебхук может, — ровно одно: показать и переключить настройки вестей того,
 * кто написал `/notify` или нажал кнопку (`message.from.id`, `callback_query.from.id`), и отметить канал по
 * `my_chat_member` (заблокировал бота — закрыт, вернул — открыт). Партию он не читает и не пишет, войн не знает (тест
 * `server.test.ts`).
 *
 * Платежи Telegram (`pre_checkout_query`, `successful_payment`) разбирает `tgpay.ts` раньше всего остального: счетов
 * Telegram сервер не выставляет (алмазы — только за USDT в сети TON, docs/payments.md), поэтому проверке — отказ, а
 * пришедший платёж не начисляет ничего; хранилищ эта дверь не трогает (docs/security.md).
 *
 * Сообщения — команды админа (`commands.ts`, docs/admin.md): отвечает он только `ADMIN_IDS`, остальным молчит; что
 * написал админ, проверяется там раньше любого похода в хранилище. Исключение одно — `/start` (docs/rating.md): на него
 * бот отвечает любому приветствием с кнопкой «Открыть игру», не трогая хранилищ.
 *
 * Telegram ждёт на каждое обновление ответа 200, иначе шлёт его снова: всё, что не наше, — 200 и тишина.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { WRITE_TRIES, allow, botSecret, deny, json, parseJson, readBody, spawnMode, type Route } from '../http.js';
import { applySwitch, closeChannel, readNotify, TOPICS, type BotSwitch, type NotifyRecord } from '../notify.js';
import { STORES } from '../kv.js';
import {
  CALLBACK_MENU,
  CALLBACK_OFF,
  CALLBACK_ON,
  CALLBACK_PANEL_OFF,
  CALLBACK_PANEL_ON,
  CALLBACK_QUIET,
  CALLBACK_URGENT,
  FAILED,
  SAVED,
  SWITCHED_OFF,
  SWITCHED_ON,
  callbackTopic,
  greeting,
  panelRows,
  panelText,
} from '../words.js';
import { telegram, type Telegram } from '../telegram.js';
import { adminCommand } from '../commands.js';
import { adminIds } from '../admin.js';
import { paymentOf, refusePayment } from '../tgpay.js';
import { own } from '../../../src/game/guard.js';

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

/** Приветствий в минуту на человека: `/start` нажимают раз, второй — по ошибке. */
const START_PER_MINUTE = 3;

/**
 * `/start` в личном чате с ботом — от любого, не только от игрока (docs/rating.md): кто это написал. Приветствие —
 * ответ тому, кто написал, и только ему: хранилищ оно не трогает и ничего о человеке не запоминает.
 */
function starter(update: Record<string, unknown>): number | null {
  const msg = update.message as Record<string, unknown> | undefined;
  if (!msg || typeof msg !== 'object' || typeof msg.text !== 'string') return null;
  const chat = (msg.chat ?? {}) as Record<string, unknown>;
  const from = userId((msg.from as Record<string, unknown> | undefined)?.id);
  if (from === null || chat.type !== 'private' || chat.id !== from) return null;
  return /^\/start(?:@\w+)?(?:\s|$)/i.test(msg.text.trim()) ? from : null;
}

/**
 * Что сделать по обновлению: показать настройки (`menu`), переключить их (`switch` — кнопкой настроек, `panel`, или
 * прежним рычагом под старой вестью) или отметить канал (`chan`).
 */
type Change =
  | { switch: BotSwitch; callback: string; chat: number | null; message: number | null; panel: boolean }
  | { menu: true; callback: string | null; chat: number }
  | { chan: 'open' | 'closed' };

/** Данные кнопок настроек — то, что мы сами положили в них (`words.panelRows`); других не бывает. */
const PANEL: Record<string, BotSwitch> = {
  ...Object.fromEntries(TOPICS.map((topic) => [callbackTopic(topic), { topic }])),
  [CALLBACK_QUIET]: { quiet: true },
  [CALLBACK_URGENT]: { urgent: true },
  [CALLBACK_PANEL_OFF]: { on: false },
  [CALLBACK_PANEL_ON]: { on: true },
};

/** `/notify` в личном чате с ботом: кто написал. */
function asker(update: Record<string, unknown>): number | null {
  const msg = update.message as Record<string, unknown> | undefined;
  if (!msg || typeof msg !== 'object' || typeof msg.text !== 'string') return null;
  const chat = (msg.chat ?? {}) as Record<string, unknown>;
  const from = userId((msg.from as Record<string, unknown> | undefined)?.id);
  if (from === null || chat.type !== 'private' || chat.id !== from) return null;
  return /^\/notify(?:@\w+)?(?:\s|$)/i.test(msg.text.trim()) ? from : null;
}

function changeOf(update: Record<string, unknown>): { id: number; change: Change } | null {
  const ask = asker(update);
  if (ask !== null) return { id: ask, change: { menu: true, callback: null, chat: ask } };
  const cb = update.callback_query as Record<string, unknown> | undefined;
  if (cb && typeof cb === 'object') {
    const id = userId((cb.from as Record<string, unknown> | undefined)?.id);
    if (id === null || typeof cb.id !== 'string') return null;
    // Данные кнопки — то, что мы сами положили в неё (`telegram.keyboard`, `telegram.panelKeyboard`); других не бывает.
    const { data: pressed } = cb as { data?: unknown };
    if (typeof pressed !== 'string') return null;
    if (pressed === CALLBACK_MENU) return { id, change: { menu: true, callback: cb.id, chat: id } };
    const legacy = pressed === CALLBACK_OFF || pressed === CALLBACK_ON;
    const sw = legacy ? { on: pressed === CALLBACK_ON } : (own(PANEL, pressed) ?? null);
    if (!sw) return null;
    const msg = (cb.message ?? {}) as Record<string, unknown>;
    const chat = userId((msg.chat as Record<string, unknown> | undefined)?.id);
    const message = typeof msg.message_id === 'number' ? msg.message_id : null;
    return { id, change: { switch: sw, callback: cb.id, chat, message, panel: !legacy } };
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
    // Платёж Telegram — до команд админа: `successful_payment` приходит сообщением, и команды проглотили бы его молча.
    const paid = update && typeof update === 'object' ? paymentOf(update) : null;
    if (paid) {
      if (allow(`pay-tg:${paid.from}`, START_PER_MINUTE, io.now)) await refusePayment(paid, tg(), adminIds());
      return json({ ok: true });
    }
    const start = update && typeof update === 'object' ? starter(update) : null;
    if (start !== null) {
      if (allow(`start:${start}`, START_PER_MINUTE, io.now)) await tg().greet(start, greeting(spawnMode() === 'sicily'));
      return json({ ok: true });
    }
    // Настройки вестей — любому в личном чате с ботом, раньше команд админа: `/notify` у админа — тоже его настройки.
    const found = update && typeof update === 'object' ? changeOf(update) : null;
    if (!found) {
      if (update && typeof update === 'object') await adminCommand(update, io, tg);
      return json({ ok: true });
    }

    const now = io.now;
    const player = `tg-${found.id}`;
    if (!allow(`bot:${player}`, PER_MINUTE, now)) return json({ ok: true });

    const store = io.stores(STORES.notify);
    const change = found.change;
    if ('menu' in change) {
      // Показать — только прочесть: настройки меняют кнопки под этим сообщением.
      const was = await store.getWithMetadata(player);
      const rec = readNotify(was ? parseJson(String(was.data)) : null);
      const api = tg();
      if (change.callback !== null) await api.answer(change.callback, '');
      await api.panel(change.chat, panelText(rec), panelRows(rec));
      return json({ ok: true });
    }

    let done: NotifyRecord | null = null;
    for (let tries = 0; tries < WRITE_TRIES && !done; tries++) {
      const was = await store.getWithMetadata(player);
      const rec = readNotify(was ? parseJson(String(was.data)) : null);
      const next: NotifyRecord =
        'chan' in change ? (change.chan === 'closed' ? closeChannel(rec, now) : { ...rec, chan: { state: 'open', at: now } }) : applySwitch(rec, change.switch, now);
      const written = await store.setJSON(player, next, was?.etag ? { onlyIfMatch: was.etag } : { onlyIfNew: true });
      if (written.modified) done = next;
    }

    if ('switch' in change) {
      const api = tg();
      const sw = change.switch;
      await api.answer(change.callback, !done ? FAILED : 'on' in sw ? (sw.on ? SWITCHED_ON : SWITCHED_OFF) : SAVED);
      if (done && change.chat !== null && change.message !== null) {
        // Настройки правят своё сообщение новыми отметками; прежний рычаг под старой вестью меняет ряд на нынешний.
        if (change.panel) await api.repanel(change.chat, change.message, panelText(done), panelRows(done));
        else await api.button(change.chat, change.message);
      }
    }
    return json({ ok: true });
  };

export const bot: Route = botWith(() => telegram());
