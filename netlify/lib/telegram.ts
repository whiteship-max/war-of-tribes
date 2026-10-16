/**
 * Адаптер Telegram — **единственное место серверной части, которое ходит наружу** (тест «наружу ходит один
 * адаптер», `server.test.ts`). Вызовы Bot API: отправить сообщение, ответить на нажатие кнопки, сменить
 * кнопки под сообщением, ответить на предоплатную проверку платежа (отказом, `lib/tgpay.ts`); для админки
 * (docs/admin.md) — сообщение без кнопок и файл документом. Больше адаптер не
 * знает ничего: ни записей, ни правил отправки.
 *
 * Токен — из одного места (`http.botToken`), в журнал не пишется ничего (журналов у обработчиков нет). Адресат
 * — только числом из подписи или из обновления, пришедшего с секретом вебхука: `chat_id` личного чата бота с
 * игроком равен идентификатору игрока.
 *
 * Сообщения без `parse_mode`: имя двора пришло от клиента, и разметки в тексте быть не должно.
 */
import { appUrl, botToken } from './http.js';
import { BUTTON_OFF, BUTTON_ON, BUTTON_OPEN, CALLBACK_OFF, CALLBACK_ON } from './words.js';

/** Как ушло: доставлено; канал закрыт (403 — не разрешено или бот заблокирован); повторить позже; потеряно. */
export type SendResult = 'ok' | 'closed' | 'retry' | 'lost';

/** Чем ходить наружу. В тестах подменяется — сети у тестов нет. */
export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ status: number }>;

/** Сколько ждать ответа Telegram: проход доставки идёт не дольше своего срока. */
const TIMEOUT_MS = 8_000;

const live: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

/** Кнопка под сообщением: открыть игру (`web_app`) или переключить рычаг (`callback_data`). */
export type InlineButton = { text: string; web_app: { url: string } } | { text: string; callback_data: string };

/**
 * Кнопки под сообщением, одним рядом (решение владельца 06.10.2026): «Открыть игру» — мини-приложение с подписью
 * `initData`, как из меню чата (`web_app`, только в личном чате с ботом — другого у бота нет), и рядом рычаг —
 * выключить, если уведомления включены, и включить, если выключены. Тот же ряд и при смене рычага: кнопка «Открыть
 * игру» не пропадает.
 */
export const keyboard = (on: boolean, app = appUrl()): { inline_keyboard: InlineButton[][] } => ({
  inline_keyboard: [
    [
      { text: BUTTON_OPEN, web_app: { url: app } },
      on ? { text: BUTTON_OFF, callback_data: CALLBACK_OFF } : { text: BUTTON_ON, callback_data: CALLBACK_ON },
    ],
  ],
});

/** Одна кнопка «Открыть игру» — под приветствием и итоговой таблицей (docs/rating.md). */
export const openOnly = (app = appUrl()): { inline_keyboard: InlineButton[][] } => ({
  inline_keyboard: [[{ text: BUTTON_OPEN, web_app: { url: app } }]],
});

/** Вызов Bot API. Ответ классифицируется по коду; тело не читается. */
async function call(method: string, params: Record<string, unknown>, go: Fetcher): Promise<SendResult> {
  return post(method, 'application/json', JSON.stringify(params), go);
}

/** Граница частей файла: в тексте таблицы такой строки нет — в ней только числа, имена и точки с запятой. */
const BOUNDARY = 'tribe-admin-file-7f3a9c';

/**
 * Файл документом (`sendDocument`): тело `multipart/form-data` строкой. Текст файла — UTF-8; кодирует его тот, кто
 * отправляет строку. Подпись — без разметки, как и всё остальное.
 */
function fileBody(chatId: number, name: string, content: string, caption: string): string {
  const part = (field: string, value: string, file?: string): string =>
    `--${BOUNDARY}\r\ncontent-disposition: form-data; name="${field}"${file ? `; filename="${file}"` : ''}\r\n` +
    `${file ? 'content-type: text/csv; charset=utf-8\r\n' : ''}\r\n${value}\r\n`;
  return part('chat_id', String(chatId)) + part('caption', caption) + part('document', content, name.replace(/[^A-Za-z0-9._-]/g, '_')) + `--${BOUNDARY}--\r\n`;
}

async function post(method: string, type: string, body: string, go: Fetcher): Promise<SendResult> {
  const token = botToken();
  if (!token) return 'lost';
  try {
    const res = await go(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': type },
      body,
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
  /** Сообщение игроку с кнопками «Открыть игру» и «Отключить уведомления». */
  send(chatId: number, text: string): Promise<SendResult>;
  /** Ответ на нажатие кнопки: строка во всплывающем окне Telegram. */
  answer(callbackId: string, text: string): Promise<SendResult>;
  /** Сменить рычаг под сообщением, на котором нажали; «Открыть игру» остаётся. */
  button(chatId: number, messageId: number, on: boolean): Promise<SendResult>;
  /** Сообщение админу: текст без кнопок и без разметки (docs/admin.md). */
  say(chatId: number, text: string): Promise<SendResult>;
  /** Файл админу документом: таблица CSV (`/stats`). */
  file(chatId: number, name: string, content: string, caption: string): Promise<SendResult>;
  /** Сообщение с одной кнопкой «Открыть игру»: приветствие на `/start` и итоговая таблица (docs/rating.md). */
  greet(chatId: number, text: string): Promise<SendResult>;
  /** Ответ на предоплатную проверку платежа Telegram (`answerPreCheckoutQuery`); отказ — со строкой плательщику. */
  checkout(queryId: string, ok: boolean, error: string): Promise<SendResult>;
}

/** Потолок текста сообщения Telegram — 4096 знаков; длиннее обрезается с пометкой. */
export const TEXT_MAX = 4000;

export const telegram = (go: Fetcher = live): Telegram => ({
  send: (chatId, text) => call('sendMessage', { chat_id: chatId, text, reply_markup: keyboard(true) }, go),
  answer: (callbackId, text) => call('answerCallbackQuery', { callback_query_id: callbackId, text }, go),
  button: (chatId, messageId, on) =>
    call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: keyboard(on) }, go),
  say: (chatId, text) =>
    call('sendMessage', { chat_id: chatId, text: text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}\n…` : text, link_preview_options: { is_disabled: true } }, go),
  greet: (chatId, text) =>
    call('sendMessage', { chat_id: chatId, text: text.slice(0, TEXT_MAX), reply_markup: openOnly(), link_preview_options: { is_disabled: true } }, go),
  checkout: (queryId, ok, error) =>
    call('answerPreCheckoutQuery', { pre_checkout_query_id: queryId, ok, ...(ok ? {} : { error_message: error.slice(0, 255) }) }, go),
  file: (chatId, name, content, caption) =>
    post('sendDocument', `multipart/form-data; boundary=${BOUNDARY}`, fileBody(chatId, name, content, caption.slice(0, 1000)), go),
});
