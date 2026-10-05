/**
 * Разговор с сервером хранения. Тонкий слой, и весь его смысл в одном:
 * **отсюда нельзя выйти исключением и нельзя не выйти вовсе.**
 *
 * Мобильная сеть пропадает — это норма, а не сбой. Поэтому у каждого запроса
 * свой срок, по истечении которого он бросается, а неудача возвращается
 * значением, а не бросается наверх: тому, кто зовёт, не приходится оборачивать
 * каждый вызов в try, и ни один забытый `catch` не может уронить игру.
 *
 * Отдельно про «сервера здесь нет». На dev-сервере и на любом хостинге без
 * функций путь `/api/*` отдаёт страницу игры — с кодом 200. Разобрать её как
 * JSON нельзя, и обычная проверка `res.ok` этого не заметила бы: она сказала
 * бы «всё хорошо». Поэтому ответ считается ответом сервера только когда он
 * назвался JSON; всё остальное читается как «функций тут нет» — и игра просто
 * играет дальше, без синхронизации и без ошибок на экране.
 */
import { tgInitData } from '@/telegram/webapp';
import { setServerTime } from './clock';

/** Сколько ждём ответа. Больше — и игрок успевает решить, что игра зависла. */
const TIMEOUT_MS = 8000;

export type ApiFail =
  /** Сети нет, сервер не ответил в срок, или функций на хостинге нет вовсе. */
  | 'offline'
  /** Подпись не принята: играют вне Telegram или строка запуска протухла. */
  | 'auth'
  /** Поверх нашей записи легла чужая. */
  | 'conflict'
  /** Слишком часто. */
  | 'busy'
  /** Сервер ответил, но чем-то другим. */
  | 'server';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; why: ApiFail; body: unknown };

const fail = (why: ApiFail, body: unknown = null): ApiResult<never> => ({ ok: false, why, body });

async function call<T>(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body) headers['content-type'] = 'application/json';
  if (init.auth !== false) {
    const raw = tgInitData();
    // Без подписи запрос не отправляется вовсе: серверу он не нужен, а нам не
    // нужен его отказ. Личность бывает только настоящая.
    if (!raw) return fail('auth');
    headers['x-telegram-init-data'] = raw;
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers, signal: ctl.signal, cache: 'no-store' });
  } catch {
    return fail('offline');
  } finally {
    clearTimeout(timer);
  }

  if (!(res.headers.get('content-type') ?? '').includes('json')) return fail('offline');

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    return fail('server');
  }

  // Серверное «сейчас» приезжает с любым ответом — и с отказом тоже. Отдельного
  // похода за временем игре поэтому не нужно ни разу за партию.
  const now = (body as { now?: unknown } | null)?.now;
  if (typeof now === 'number') setServerTime(now);

  if (res.ok) return { ok: true, data: body as T };
  if (res.status === 401 || res.status === 403) return fail('auth', body);
  if (res.status === 409) return fail('conflict', body);
  if (res.status === 429) return fail('busy', body);
  return fail('server', body);
}

export const apiGet = <T>(path: string, opts: { auth?: boolean } = {}): Promise<ApiResult<T>> =>
  call<T>(path, { method: 'GET', auth: opts.auth });

/**
 * `keepalive` — запрос обязан пережить выгрузку страницы: так уходит отметка «игрок ушёл»
 * при скрытии. Тело такого запроса браузер ограничивает 64 КБ; партия туда не влезает и
 * так не отправляется, а список уведомлений короток — пунктов в нём не больше `NOTICE_LIMITS.items`.
 */
export const apiPut = <T>(path: string, body: unknown, opts: { keepalive?: boolean } = {}): Promise<ApiResult<T>> =>
  call<T>(path, { method: 'PUT', body: JSON.stringify(body), keepalive: opts.keepalive });

/** Приказ: тело — JSON, ответ — как у всех. Пока зовёт одна война (`net/war.ts`). */
export const apiPost = <T>(path: string, body: unknown): Promise<ApiResult<T>> =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body) });
