/**
 * Общее для всех функций: ответы, разбор тела, ограничения.
 *
 * Правило про ошибки одно и держится здесь, а не в каждой функции: наружу
 * уходит короткое слово и код состояния, внутрь — причина. Подробный отказ
 * («подпись не сошлась» против «строка протухла») рассказывает подбирающему,
 * насколько он близок, а игроку не говорит ничего: у него всё либо работает,
 * либо нет.
 */

/** Больше этого тело запроса не принимается. Сохранение партии втрое меньше. */
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
 * в самой записи (см. `functions/save.mts`). Два слоя разной природы — потому
 * что каждый по отдельности дырявый.
 */
const buckets = new Map<string, { tokens: number; at: number }>();

export function allow(key: string, perMinute: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  // Ведро наполняется равномерно: за минуту — полный запас.
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  // Экземпляр функции живёт долго, а ключей за это время накапливается сколько
  // угодно: полные вёдра выбрасываем, они ничего не помнят.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.tokens >= perMinute - 0.01) buckets.delete(k);
  }
  return true;
}

/**
 * Сколько раз функция пытается выиграть запись поверх ETag, прежде чем отказать. Одно число
 * на всех, кто переписывает общую запись: реестр замков и исходящие уведомления.
 */
export const WRITE_TRIES = 4;

/** Токен бота из окружения. В репозитории его нет и быть не может. */
export const botToken = (): string => process.env.TELEGRAM_BOT_TOKEN ?? '';
