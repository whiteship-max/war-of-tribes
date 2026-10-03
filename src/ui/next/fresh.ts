// Свежесть тревоги нового интерфейса: пилюля с текстом или значок (`Alerts.tsx`). Чистый модуль — его
// сверяет тест на границе срока.

/** Сколько новая тревога стоит пилюлей с текстом, прежде чем свернуться в значок (3.7). */
export const ALERT_FRESH_MS = 4000;

/**
 * Когда тревога появилась впервые за этот заход. Память интерфейса, не партии: перезапуск показывает
 * висящие тревоги пилюлями ещё раз — игрок их в этом заходе не видел.
 */
const firstSeen = new Map<string, number>();

/** Свежая ли тревога: пилюля с текстом, а не значок. Чистая — её сверяет тест на границе срока. */
export function isFresh(key: string, now: number, seen: Map<string, number> = firstSeen): boolean {
  let at = seen.get(key);
  if (at === undefined) {
    at = now;
    seen.set(key, at);
  }
  return now - at < ALERT_FRESH_MS;
}
