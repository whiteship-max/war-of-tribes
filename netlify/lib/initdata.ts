/**
 * Личность игрока. Единственный источник — `initData` Telegram, проверенный
 * подписью по токену бота.
 *
 * Идентификатор из тела запроса не принимается никогда и ни в каком виде: тело
 * пишет клиент, а клиент — это чужой компьютер. Всё, что приходит оттуда,
 * считается заявкой, а не фактом. Отсюда и устройство модуля: наружу торчит
 * одна функция, возвращающая либо личность, либо причину отказа, и обойти её
 * нечем — идентификатора в её входе просто нет, есть только строка initData и
 * токен.
 *
 * Модуль чистый: ни сети, ни хранилища, ни переменных окружения — токен ему
 * передают. Поэтому он проверяется тестом на настоящих подписях, собранных тем
 * же алгоритмом (`initdata.test.ts`), а не на словах.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Кто играет. Больше о нём серверу знать нечего — и не надо. */
export interface TgIdentity {
  /** Идентификатор пользователя Telegram. Ключ, под которым лежит сохранение. */
  id: number;
  /** Когда клиент получил эти данные, Unix-секунды. */
  authDate: number;
  /**
   * Пользователь разрешил боту писать ему (`allows_write_to_pm` под подписью). Есть только когда `true`: так
   * личность без разрешения остаётся той же парой чисел, что была. Строка запуска выдаётся при запуске, и
   * разрешение, данное посреди игры, появится здесь только со следующим.
   */
  allowsWrite?: true;
  /**
   * Имя пользователя Telegram (`@имя` без собаки) — из той же подписанной строки. Нужно только админке: найти игрока
   * по имени (docs/admin.md). Нет имени или оно не похоже на имя Telegram — поля нет.
   */
  username?: string;
}

/** Имя пользователя Telegram: 4–32 знака, латиница, цифры и подчёркивание. */
const USERNAME = /^[A-Za-z0-9_]{4,32}$/;

/**
 * Почему отказано. Наружу эти слова не уходят — снаружи видно только «нет»
 * (см. `http.ts`): подробный отказ рассказывает подбирающему, насколько он
 * близок. Здесь они нужны, чтобы тест мог отличить одну причину от другой.
 */
export type InitDataError =
  /** Заголовка нет вовсе — играют вне Telegram. */
  | 'missing'
  /** Это не строка запуска: нет hash, нет user, или user не разбирается. */
  | 'malformed'
  /** Подпись не сошлась. */
  | 'bad-hash'
  /** Выпущено слишком давно. */
  | 'stale'
  /** Выпущено в будущем: врут часы — наши или чужие. */
  | 'future'
  /** Токена бота нет в окружении: проверять нечем, и тогда пускать нельзя. */
  | 'no-token';

export type InitDataResult = { ok: true; user: TgIdentity } | { ok: false; why: InitDataError };

/**
 * Сколько живёт `initData`.
 *
 * Сутки, и это не небрежность. Telegram выдаёт строку один раз — в момент
 * запуска мини-аппки — и больше её не обновляет: приложение, открытое утром и
 * оставленное на весь день, до вечера ходит с той же `auth_date`. Короткий срок
 * означал бы не «безопаснее», а «к обеду синхронизация отвалилась молча».
 *
 * Цена длинного срока невелика: перехваченная строка даёт доступ к сохранению
 * того же игрока — не к деньгам, не к чужому прогрессу, не к начислению чего бы
 * то ни было. Появится серверная валюта — срок придётся сокращать вместе с
 * заведением сессий, и это отдельная работа, а не строчка здесь.
 */
export const INIT_DATA_TTL_SECONDS = 24 * 60 * 60;

/**
 * Насколько часам клиента позволено убежать вперёд наших. Часы у телефонов
 * расходятся на минуты — отказывать за это нельзя; на час — уже нельзя не
 * отказывать.
 */
export const CLOCK_SKEW_SECONDS = 5 * 60;

/** Пары как есть, в порядке получения: сортировка своя, ниже. */
function pairsOf(raw: string): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of new URLSearchParams(raw)) out.push([k, v]);
  return out;
}

const checkString = (pairs: [string, string][], skip: Set<string>): string =>
  pairs
    .filter(([k]) => !skip.has(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

/** Сравнение подписей постоянным временем: обычное `===` выдаёт длину совпадения. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Проверяет подпись и возвращает личность.
 *
 * `now` — секунды Unix, передаются снаружи: так свежесть проверяется тестом без
 * подмены глобальных часов.
 */
export function readInitData(raw: string | null | undefined, botToken: string, now: number): InitDataResult {
  if (!raw) return { ok: false, why: 'missing' };
  if (!botToken) return { ok: false, why: 'no-token' };

  const pairs = pairsOf(raw);
  const hash = pairs.find(([k]) => k === 'hash')?.[1];
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return { ok: false, why: 'malformed' };

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const sign = (s: string): string => createHmac('sha256', secret).update(s).digest('hex');

  // Из строки проверки выбрасывается `hash`. Поле `signature` — подпись Ed25519
  // для тех, у кого токена бота нет, — у части клиентов приходит вместе с ним, и
  // договориться о том, входит ли оно в строку, у разных версий не вышло.
  // Поэтому принимаются оба разбора: обе проверки — полноценный HMAC тем же
  // секретом, подделать любую из них нельзя, а игра работает на всех клиентах.
  const strict = checkString(pairs, new Set(['hash']));
  const legacy = checkString(pairs, new Set(['hash', 'signature']));
  if (!sameHex(sign(strict), hash) && !sameHex(sign(legacy), hash)) return { ok: false, why: 'bad-hash' };

  const authDate = Number(pairs.find(([k]) => k === 'auth_date')?.[1]);
  if (!Number.isFinite(authDate) || authDate <= 0) return { ok: false, why: 'malformed' };
  if (authDate > now + CLOCK_SKEW_SECONDS) return { ok: false, why: 'future' };
  if (now - authDate > INIT_DATA_TTL_SECONDS) return { ok: false, why: 'stale' };

  const userRaw = pairs.find(([k]) => k === 'user')?.[1];
  if (!userRaw) return { ok: false, why: 'malformed' };
  let id: unknown;
  let allows: unknown;
  let username: unknown;
  try {
    const user = JSON.parse(userRaw) as { id?: unknown; allows_write_to_pm?: unknown; username?: unknown };
    id = user.id;
    allows = user.allows_write_to_pm;
    username = user.username;
  } catch {
    return { ok: false, why: 'malformed' };
  }
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return { ok: false, why: 'malformed' };

  return {
    ok: true,
    user: {
      id,
      authDate,
      ...(allows === true ? { allowsWrite: true as const } : {}),
      ...(typeof username === 'string' && USERNAME.test(username) ? { username } : {}),
    },
  };
}

/**
 * Ключ сохранения в хранилище. Собирается только из проверенного
 * идентификатора: строкой из запроса его подменить нельзя — сюда приходит
 * число, уже прошедшее подпись.
 */
export const saveKeyOf = (user: TgIdentity): string => `tg-${user.id}`;
