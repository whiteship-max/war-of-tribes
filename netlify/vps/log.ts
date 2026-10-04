/**
 * Журнал своего сервера — единственное место, где он пишет в консоль (`server.test.ts`). Пишет он о
 * том, что сделал сам: запустился, снял копию, перенёс данные, на каком адресе упал обработчик.
 * Ни запроса, ни ключа игрока, ни токена здесь не бывает: строку собирает вызывающий из своих слов
 * и чисел, а модуль приёма запросов (`listen.ts`) этот журнал не импортирует вовсе.
 *
 * Читает его владелец командой `docker compose logs app` (docs/SERVER.md).
 */
export function say(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

/** Сказать о сбое: имя и текст ошибки, без стека — путь стека говорит о коде, а не о беде. */
export function sayFail(what: string, e: unknown): void {
  const text = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.error(`${new Date().toISOString()} ${what}: ${text}`);
}
