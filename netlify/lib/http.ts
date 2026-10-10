/**
 * Общее для всех обработчиков: ответы, разбор тела, ограничения и то, что обработчику дают
 * снаружи (`Io`).
 *
 * Правило про ошибки одно и держится здесь, а не в каждой функции: наружу
 * уходит короткое слово и код состояния, внутрь — причина. Подробный отказ
 * («подпись не сошлась» против «строка протухла») рассказывает подбирающему,
 * насколько он близок, а игроку не говорит ничего: у него всё либо работает,
 * либо нет.
 */
import type { Stores } from './kv.js';
import { spawnModeOf, type SpawnMode } from '../../src/world/spawn.js';

/** Больше этого тело запроса не принимается. Потолки частей сохранения (`LIMITS` в `routes/save.ts`) в него укладываются. */
export const MAX_BODY_BYTES = 512 * 1024;

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // Ответы адресные: кэшировать их нельзя ни браузеру, ни краю сети.
  'cache-control': 'no-store',
  // Кросс-доменных заголовков здесь нет нарочно: игра и функции живут на одном
  // адресе, а разрешать чужим страницам ходить сюда от имени игрока незачем.
  'x-content-type-options': 'nosniff',
} as const;

export const json = (body: unknown, status = 200, extra: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });

/** Отказ. Наружу — только `error` одним словом. */
export const deny = (status: number, error: string, extra: Record<string, string> = {}): Response =>
  json({ error }, status, extra);

/**
 * Тело запроса строкой, с потолком по размеру.
 *
 * Проверяется дважды: сперва заявленная длина — чтобы не тянуть мегабайты
 * вовсе, — потом настоящая, потому что заголовку верить нельзя.
 */
export async function readBody(req: Request): Promise<string | null> {
  const claimed = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(claimed) && claimed > MAX_BODY_BYTES) return null;
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return null;
  return text;
}

/** Разбор JSON, который не бросает: неразобранное — это отказ, а не пятисотка. */
export function parseJson<T>(text: string): T | null {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' ? (v as T) : null;
  } catch {
    return null;
  }
}

/**
 * Ограничитель частоты — ведро на ключ, в памяти экземпляра функции.
 *
 * Честно о том, чего он не может: экземпляров у функции несколько, они
 * поднимаются и умирают, и общей памяти у них нет. Значит, он режет петлю,
 * долбящую из одного места, но не распределённый поток. Настоящий предел,
 * который переживает смерть экземпляра, стоит рядом и другого рода: сохранение
 * нельзя переписать чаще, чем раз в `MIN_WRITE_MS`, и считается это по времени
 * в самой записи (см. `routes/save.ts`). Два слоя разной природы — потому
 * что каждый по отдельности дырявый.
 *
 * На своём сервере экземпляр один и живёт неделями, и вёдра всех адресов лежат в одной памяти.
 * Поэтому ключ ведра начинается с имени адреса (`save:tg-1`, `castles:tg-1`): у адресов разные
 * потолки, и общее ведро на игрока резало бы сохранение запросами реестра.
 */
const buckets = new Map<string, { tokens: number; at: number; cap: number }>();

export function allow(key: string, perMinute: number, now: number = Date.now()): boolean {
  const b = buckets.get(key) ?? { tokens: perMinute, at: now, cap: perMinute };
  // Ведро наполняется равномерно: за минуту — полный запас.
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
  b.at = now;
  b.cap = perMinute;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  // Экземпляр живёт долго, а ключей за это время накапливается сколько угодно: полные вёдра
  // выбрасываем, они ничего не помнят. Полнота считается с доливом по времени и по потолку
  // своего ведра — не по потолку того, кто зашёл последним.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (v.tokens + ((now - v.at) / 60000) * v.cap >= v.cap - 0.01) buckets.delete(k);
    }
  }
  return true;
}

/**
 * Сколько раз функция пытается выиграть запись поверх ETag, прежде чем отказать. Одно число
 * на всех, кто переписывает общую запись: реестр замков и исходящие уведомления.
 */
export const WRITE_TRIES = 4;

/**
 * Очередь к общей записи внутри экземпляра: `run` — чтение, расчёт и условная запись — идёт по одному на имя.
 *
 * Правду держит условная запись по ETag и без очереди, но в давке она дорога: запросы, прочитавшие одну версию,
 * выигрывают по одному за круг, и за `WRITE_TRIES` кругов проходят не все — остальным отказ, хотя ничего не нарушено
 * (прогон ботов, docs/playtest_sim.md, «Мелкое», п. 1). На своём сервере экземпляр один, и очередь снимает гонку
 * целиком; на Netlify экземпляр держит один запрос за раз, и гонку между экземплярами по-прежнему держат попытки.
 */
const turns = new Map<string, Promise<void>>();

export function inTurn<T>(name: string, run: () => Promise<T>): Promise<T> {
  const mine = (turns.get(name) ?? Promise.resolve()).then(run);
  const done = mine.then(
    () => undefined,
    () => undefined,
  );
  turns.set(name, done);
  // Очередь опустела — имя не держим: имён немного, но память экземпляра живёт неделями.
  void done.then(() => {
    if (turns.get(name) === done) turns.delete(name);
  });
  return mine;
}

/** Токен бота из окружения. В репозитории его нет и быть не может. */
export const botToken = (): string => process.env.TELEGRAM_BOT_TOKEN ?? '';

/**
 * Секрет вебхука бота: владелец задаёт его в `setWebhook` (`secret_token`), и Telegram присылает его заголовком
 * `X-Telegram-Bot-Api-Secret-Token` в каждом обновлении. Нет секрета — вебхук закрыт для всех (`routes/bot.ts`).
 */
export const botSecret = (): string => process.env.TELEGRAM_WEBHOOK_SECRET ?? '';

/** Боевой адрес игры — тот, что стоит Menu Button'ом в @BotFather (CLAUDE.md, «Выкладка»). */
export const APP_URL = 'https://celebrated-yeot-73e410.netlify.app';

/**
 * Адрес игры для кнопки «Открыть игру» под сообщениями бота (`web_app`, docs/NOTIFY.md, 12.10): `TRIBE_APP_URL`, если
 * задан и это HTTPS (Telegram открывает мини-приложение только по HTTPS), иначе боевой адрес. Одно правило на оба дома:
 * на Netlify переменной нет — боевой адрес; свой сервер на своём домене вписывает свой (docs/SERVER.md).
 */
export const appUrl = (env: Record<string, string | undefined> = process.env): string => {
  const v = (env.TRIBE_APP_URL ?? '').trim();
  return /^https:\/\/[^\s/]+(\/\S*)?$/.test(v) ? v : APP_URL;
};

/**
 * Проход доставки уведомлений включён: `TRIBE_DELIVER=on`. Одно правило на оба дома — функцию по расписанию
 * Netlify (`functions/deliver.mts`) и расписание своего сервера (`vps/config.ts` читает то же имя).
 */
export const deliverOn = (env: Record<string, string | undefined> = process.env): boolean => (env.TRIBE_DELIVER ?? '').trim() === 'on';

/**
 * Темп войны между игроками для проверки (docs/pvp.md): во сколько раз быстрее идут походы, обратный путь и
 * часы голода под лагерем. Поход идёт игровым временем, и между соседями это сутки настоящих часов — сценарий
 * на двух аккаунтах столько не ждёт. Переменная окружения `TRIBE_WAR_PACE`; нет её — 1, обычная игра. Клиент
 * берёт срок у сервера, поэтому и рассинхрона нет: темп приезжает в ответе войны.
 */
export const warPace = (): number => {
  const n = Number(process.env.TRIBE_WAR_PACE);
  return Number.isFinite(n) && n >= 1 ? Math.min(1000, n) : 1;
};

/**
 * Режим появления новых игроков (docs/test_world.md): `TRIBE_SPAWN=sicily` — новички встают на двенадцать мест Сицилии
 * (`world/spawn.ts`), а защита слабого в войне между игроками выключена. Нет переменной — обычное расселение и обычная
 * война. Одно правило на оба дома: Netlify читает переменную окружения функции, свой сервер — ту же (`vps/config.ts`).
 */
export const spawnMode = (env: Record<string, string | undefined> = process.env): SpawnMode | null => spawnModeOf(env.TRIBE_SPAWN);

/**
 * Что обработчику дают снаружи — и больше ничего. Обработчик один на Netlify и на своём сервере
 * (`routes/`); разница между домами — только в том, что лежит здесь.
 */
export interface Io {
  /** Хранилища: Netlify Blobs или SQLite. */
  stores: Stores;
  /** Минута прихода запроса, по серверным часам. Одна на весь запрос. */
  now: number;
  /** Адрес клиента — только для сита частоты у часов. Неизвестен — `null`. */
  ip: string | null;
}

/** Обработчик адреса: запрос — ответ, без исключений наружу по своей воле. */
export type Route = (req: Request, io: Io) => Promise<Response>;
