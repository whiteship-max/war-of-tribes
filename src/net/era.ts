/**
 * Эпоха мира глазами игры (docs/test_world.md): номер чистого старта, которому принадлежит всё, что лежит на устройстве.
 *
 * Админ стёр сервер (`/wipeworld ДА`) — эпоха на сервере выросла. Игра шлёт свою с каждым запросом (`api.ts`, заголовок
 * `ERA_HEADER`); у сервера другая — ответ 410 с новым номером, и игра приходит сюда: запоминает номер, замолкает (ни
 * одного запроса больше) и перезапускается. После перезапуска всё, что лежит на устройстве от прошлой эпохи, не читается:
 * партия (`save.loadGame` — в том числе поднятая из облака Telegram), мир (`LocalWorld`), клетка из реестра (`roster`),
 * отметка синхронизации и отложенная партия (`sync`) — каждый сверяет свою эпоху с `knownEra()` сам. Стирать их руками
 * не нужно: следующая запись ляжет поверх.
 *
 * Модуль — лист: ничего не импортирует, его зовут `api.ts`, `sync.ts`, `roster.ts`, стор игры и мир.
 */
const KEY = 'tribe.era';

let memo: number | null = null;
/** Эпоха сменилась в этой сессии: игра перезапускается и больше не говорит с сервером. */
let leaving = false;

/** Эпоха, которой принадлежит то, что лежит на устройстве. Ни разу не слышали — 0: мир не стирали. */
export function knownEra(): number {
  if (memo !== null) return memo;
  let n = 0;
  try {
    const raw = localStorage.getItem(KEY);
    const v = Number(raw);
    if (raw !== null && Number.isSafeInteger(v) && v >= 0) n = v;
  } catch {
    /* localStorage может быть недоступен — тогда эпоха 0 */
  }
  memo = n;
  return n;
}

/** Игра уходит на перезапуск в новую эпоху: запросов больше нет, иначе старая партия ушла бы под новым номером. */
export const eraLeaving = (): boolean => leaving;

/** Как перезапустить игру. Подменяется тестом: в Node перезапускать нечего. */
let restart = (): void => {
  if (typeof location !== 'undefined') location.reload();
};

export const setEraRestart = (fn: () => void): void => {
  restart = fn;
};

/**
 * Сервер назвал другую эпоху. Возвращает `true`, если эпоха и правда другая: тогда игра замолкает и перезапускается.
 *
 * Номер не записался (хранилище недоступно) — перезапуска нет: после него игра снова прочла бы старый номер и ушла по
 * кругу. Тогда она просто молчит до конца сессии — старая партия на сервер не уйдёт всё равно.
 */
export function adoptEra(era: number): boolean {
  if (!Number.isSafeInteger(era) || era < 0 || era === knownEra()) return false;
  leaving = true;
  memo = era;
  let kept = false;
  try {
    localStorage.setItem(KEY, String(era));
    kept = localStorage.getItem(KEY) === String(era);
  } catch {
    kept = false;
  }
  if (kept) restart();
  return true;
}

/** Для тестов: забыть прочитанное. */
export function resetEraForTest(): void {
  memo = null;
  leaving = false;
}
