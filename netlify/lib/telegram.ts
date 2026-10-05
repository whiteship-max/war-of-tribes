/**
 * Адаптер Telegram — **единственное место серверной части, которое ходит наружу** (тест «наружу ходит один
 * адаптер», `server.test.ts`). Три вызова Bot API: отправить сообщение, ответить на нажатие кнопки, сменить
 * кнопку под сообщением. Больше адаптер не знает ничего: ни записей, ни правил отправки.
 *
 * Токен — из одного места (`http.botToken`), в журнал не пишется ничего (журналов у обработчиков нет). Адресат
 * — только числом из подписи или из обновления, пришедшего с секретом вебхука: `chat_id` личного чата бота с
 * игроком равен идентификатору игрока.
 *
 * Сообщения без `parse_mode`: имя двора пришло от клиента, и разметки в тексте быть не должно.
 */
import { botToken } from './http.js';
import { BUTTON_OFF, BUTTON_ON, CALLBACK_OFF, CALLBACK_ON } from './words.js';

/** Как ушло: доставлено; канал закрыт (403 — не разрешено или бот заблокирован); повторить позже; потеряно. */
export type SendResult = 'ok' | 'closed' | 'retry' | 'lost';

/** Чем ходить наружу. В тестах подменяется — сети у тестов нет. */
export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number }>;

/** Сколько ждать ответа Telegram: проход доставки идёт не дольше своего срока. */
const TIMEOUT_MS = 8_000;

const live: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

/** Кнопка под сообщением: выключить, если уведомления включены, и включить, если выключены. */
export const switchButton = (on: boolean): { inline_keyboard: { text: string; callback_data: string }[][] } => ({
  inline_keyboard: [[on ? { text: BUTTON_OFF, callback_data: CALLBACK_OFF } : { text: BUTTON_ON, callback_data: CALLBACK_ON }]],
});

/** Вызов Bot API. Ответ классифицируется по коду; тело не читается. */
async function call(method: string, params: Record<string, unknown>, go: Fetcher): Promise<SendResult> {
  const token = botToken();
  if (!token) return 'lost';
  try {
    const res = await go(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (res.status === 200) return 'ok';
    if (res.status === 403) return 'closed';
    if (res.status === 429 || res.status >= 500) return 'retry';
    return 'lost';
  } catch {
    // Сеть или срок ответа: годный пункт уйдёт следующим проходом, если ещё годен.
    return 'retry';
  }
}

export interface Telegram {
  /** Сообщение игроку с кнопкой «Отключить уведомления». */
  send(chatId: number, text: string): Promise<SendResult>;
  /** Ответ на нажатие кнопки: строка во всплывающем окне Telegram. */
  answer(callbackId: string, text: string): Promise<SendResult>;
  /** Сменить кнопку под сообщением, на котором нажали. */
  button(chatId: number, messageId: number, on: boolean): Promise<SendResult>;
}

export const telegram = (go: Fetcher = live): Telegram => ({
  send: (chatId, text) => call('sendMessage', { chat_id: chatId, text, reply_markup: switchButton(true) }, go),
  answer: (callbackId, text) => call('answerCallbackQuery', { callback_query_id: callbackId, text }, go),
  button: (chatId, messageId, on) =>
    call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: switchButton(on) }, go),
});
