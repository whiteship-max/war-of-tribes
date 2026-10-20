/**
 * Адаптер Telegram — **единственное место серверной части, которое ходит наружу** (тест «наружу ходит один
 * адаптер», `server.test.ts`). Вызовы Bot API: отправить сообщение, поправить своё сообщение, ответить на нажатие
 * кнопки, сменить кнопки под сообщением, ответить на предоплатную проверку платежа (отказом, `lib/tgpay.ts`); для админки
 * (docs/admin.md) — сообщение без кнопок и файл документом. Больше адаптер не знает ничего: ни записей, ни правил отправки.
 *
 * Токен — из одного места (`http.botToken`), в журнал не пишется ничего (журналов у обработчиков нет). Адресат
 * — только числом из подписи или из обновления, пришедшего с секретом вебхука: `chat_id` личного чата бота с
 * игроком равен идентификатору игрока.
 *
 * Сообщения без `parse_mode`: имя двора пришло от клиента, и разметки в тексте быть не должно.
 *
 * Ответ Telegram читается там, где он нужен правилам (ВС-1, docs/NOTIFY.md, раздел 13): номер нового сообщения — чтобы
 * следующая весть того же рода поправила его, а не легла рядом; `retry_after` у 429 — чтобы очередь подождала ровно
 * столько, сколько просит Telegram; описание отказа правки — «письма уже нет» отличается от «нечего менять».
 */
import { appUrl, botToken } from './http.js';
import { BUTTON_OPEN, BUTTON_SETUP, CALLBACK_MENU } from './words.js';

/** Как ушло: доставлено; канал закрыт (403 — не разрешено или бот заблокирован); повторить позже; потеряно. */
export type SendResult = 'ok' | 'closed' | 'retry' | 'lost';

/**
 * Итог письма игроку: как ушло, номер нового сообщения, сколько ждать (мс), если Telegram просил подождать. `gone` —
 * правка не вышла: письма уже нет или его нельзя править; та же весть уйдёт новым сообщением.
 */
export interface Sent {
  result: SendResult | 'gone';
  msg?: number;
  after?: number;
}

/** Ответ на вызов: код и, где есть, тело. */
export type FetchReply = { status: number; json?: () => Promise<unknown> };

/** Чем ходить наружу. В тестах подменяется — сети у тестов нет. */
export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<FetchReply>;

/** Сколько ждать ответа Telegram: проход доставки идёт не дольше своего срока. */
const TIMEOUT_MS = 8_000;

const live: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });

/** Кнопка под сообщением: открыть игру (`web_app`) или нажатие боту (`callback_data`). */
export type InlineButton = { text: string; web_app: { url: string } } | { text: string; callback_data: string };
export type Markup = { inline_keyboard: InlineButton[][] };

/** Кнопка настроек — то, что видит игрок, и то, что она шлёт боту. */
export type PanelButton = { text: string; act: string };

/**
 * Кнопки под вестью, одним рядом: «Открыть игру» — мини-приложение с подписью `initData`, как из меню чата (`web_app`,
 * только в личном чате с ботом — другого у бота нет; решение владельца 06.10.2026), и рядом «Настроить вести» —
 * открывает настройки (`/notify`). Прежняя кнопка-рычаг «Отключить уведомления» ушла в настройки (ВС-1): там рядом и
 * роды, и тихий час, и «только срочное», а выключать всё целиком — не единственный выход.
 */
export const keyboard = (app = appUrl()): Markup => ({
  inline_keyboard: [
    [
      { text: BUTTON_OPEN, web_app: { url: app } },
      { text: BUTTON_SETUP, callback_data: CALLBACK_MENU },
    ],
  ],
});

/**
 * Адрес игры, открытой прямо на месте (ДП-1): `?go=deal-<номер>` — «Вести» на предложении соседа. Параметр — в строке
 * запроса, а не после `#`: хвост после `#` Telegram занимает своими данными запуска.
 */
export const appAt = (app: string, go?: string): string => (go ? `${app}${app.includes('?') ? '&' : '?'}go=${encodeURIComponent(go)}` : app);

/** Одна кнопка «Открыть игру» — под приветствием и итоговой таблицей (docs/rating.md). */
export const openOnly = (app = appUrl()): Markup => ({
  inline_keyboard: [[{ text: BUTTON_OPEN, web_app: { url: app } }]],
});

/** Настройки вестей: ряды кнопок из слов (`words.panelRows`) и последним рядом — «Открыть игру». */
export const panelKeyboard = (rows: PanelButton[][], app = appUrl()): Markup => ({
  inline_keyboard: [...rows.map((row) => row.map((b) => ({ text: b.text, callback_data: b.act }))), [{ text: BUTTON_OPEN, web_app: { url: app } }]],
});

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

/** Ответ Bot API, как он есть: код и тело, если оно читается. Сеть или срок — `null`. */
async function raw(method: string, type: string, body: string, go: Fetcher): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const token = botToken();
  if (!token) return { status: 401, body: {} };
  try {
    const res = await go(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': type }, body });
    let parsed: unknown = null;
    try {
      parsed = res.json ? await res.json() : null;
    } catch {
      parsed = null;
    }
    return { status: res.status, body: parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {} };
  } catch {
    return null;
  }
}

/** Код ответа — в итог. Сеть или срок ответа: годное уйдёт следующим проходом, если ещё годно. */
const resultOf = (status: number | null): SendResult =>
  status === null ? 'retry' : status === 200 ? 'ok' : status === 403 ? 'closed' : status === 429 || status >= 500 ? 'retry' : 'lost';

async function post(method: string, type: string, body: string, go: Fetcher): Promise<SendResult> {
  return resultOf((await raw(method, type, body, go))?.status ?? null);
}

/** Вызов Bot API без чтения ответа: админке и кнопкам хватает кода. */
const call = (method: string, params: Record<string, unknown>, go: Fetcher): Promise<SendResult> =>
  post(method, 'application/json', JSON.stringify(params), go);

/** Telegram отказал править, потому что менять нечего: текст и кнопки те же. Это не ошибка. */
const NOT_MODIFIED = /message is not modified/i;

/**
 * Вызов, у которого читается ответ: номер нового сообщения, `retry_after` у 429 (секунды — в мс) и описание отказа
 * правки. Отказ правки 400 — «письма нет» (`gone`), кроме «нечего менять» (`ok`).
 */
async function letterCall(method: string, params: Record<string, unknown>, go: Fetcher, editing: boolean): Promise<Sent> {
  const res = await raw(method, 'application/json', JSON.stringify(params), go);
  const result = resultOf(res?.status ?? null);
  if (!res) return { result };
  const message = (res.body.result ?? {}) as Record<string, unknown>;
  const id = typeof message.message_id === 'number' && Number.isSafeInteger(message.message_id) && message.message_id > 0 ? message.message_id : undefined;
  if (result === 'ok') return id !== undefined ? { result, msg: id } : { result };
  if (res.status === 429) {
    const after = (res.body.parameters as Record<string, unknown> | undefined)?.retry_after;
    return typeof after === 'number' && Number.isFinite(after) && after > 0 ? { result, after: Math.min(after, 3600) * 1000 } : { result };
  }
  if (editing && res.status === 400) {
    const why = typeof res.body.description === 'string' ? res.body.description : '';
    return { result: NOT_MODIFIED.test(why) ? 'ok' : 'gone' };
  }
  return { result };
}

export interface Telegram {
  /**
   * Весть игроку — новое сообщение с кнопками «Открыть игру» и «Настроить вести». `silent` — без звука (тихий час). `go` —
   * куда открыть игру (`appAt`): весть о предложении соседа ведёт прямо к нему (ДП-1).
   */
  letter(chatId: number, text: string, silent: boolean, go?: string): Promise<Sent>;
  /** Поправить своё письмо: новая весть того же рода ложится в прежнее сообщение. */
  edit(chatId: number, messageId: number, text: string, go?: string): Promise<Sent>;
  /** Ответ на нажатие кнопки: строка во всплывающем окне Telegram. */
  answer(callbackId: string, text: string): Promise<SendResult>;
  /** Поставить под сообщением, на котором нажали прежнюю кнопку-рычаг, нынешний ряд кнопок вести. */
  button(chatId: number, messageId: number): Promise<SendResult>;
  /** Настройки вестей: новым сообщением (`/notify`, «Настроить вести»). */
  panel(chatId: number, text: string, rows: PanelButton[][]): Promise<SendResult>;
  /** Настройки вестей после нажатия: то же сообщение с новыми отметками. */
  repanel(chatId: number, messageId: number, text: string, rows: PanelButton[][]): Promise<SendResult>;
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

const cut = (text: string): string => (text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX)}\n…` : text);
const quiet = { link_preview_options: { is_disabled: true } };

export const telegram = (go: Fetcher = live): Telegram => ({
  letter: (chatId, text, silent, to) =>
    letterCall('sendMessage', { chat_id: chatId, text: cut(text), reply_markup: keyboard(appAt(appUrl(), to)), disable_notification: silent, ...quiet }, go, false),
  edit: (chatId, messageId, text, to) =>
    letterCall('editMessageText', { chat_id: chatId, message_id: messageId, text: cut(text), reply_markup: keyboard(appAt(appUrl(), to)), ...quiet }, go, true),
  answer: (callbackId, text) => call('answerCallbackQuery', { callback_query_id: callbackId, text }, go),
  button: (chatId, messageId) => call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: keyboard() }, go),
  panel: (chatId, text, rows) => call('sendMessage', { chat_id: chatId, text: cut(text), reply_markup: panelKeyboard(rows), ...quiet }, go),
  repanel: async (chatId, messageId, text, rows) => {
    const sent = await letterCall('editMessageText', { chat_id: chatId, message_id: messageId, text: cut(text), reply_markup: panelKeyboard(rows), ...quiet }, go, true);
    return sent.result === 'gone' ? 'lost' : sent.result;
  },
  say: (chatId, text) => call('sendMessage', { chat_id: chatId, text: cut(text), ...quiet }, go),
  greet: (chatId, text) => call('sendMessage', { chat_id: chatId, text: text.slice(0, TEXT_MAX), reply_markup: openOnly(), ...quiet }, go),
  checkout: (queryId, ok, error) =>
    call('answerPreCheckoutQuery', { pre_checkout_query_id: queryId, ok, ...(ok ? {} : { error_message: error.slice(0, 255) }) }, go),
  file: (chatId, name, content, caption) =>
    post('sendDocument', `multipart/form-data; boundary=${BOUNDARY}`, fileBody(chatId, name, content, caption.slice(0, 1000)), go),
});
