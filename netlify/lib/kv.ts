/**
 * Хранилище сервера — одна узкая дверь на два дома: Netlify Blobs (`blobs.ts`) и SQLite на диске
 * своего сервера (`vps/sqlite.ts`). Обработчики (`routes/*`) знают только эту дверь и не знают, в
 * чьём доме живут: логика одна, копий нет.
 *
 * Дверь узкая нарочно: ровно то, чем пользуются обработчики и проход доставки, — чтение текстом
 * вместе с ETag, условная запись, перечисление и удаление. Всё остальное, что умеет Blobs, второму
 * дому пришлось бы повторять, и повторённое разошлось бы молча.
 *
 * **Главное свойство — условная запись.** `onlyIfMatch` пишет, только если лежит ровно та версия,
 * которую назвали; `onlyIfNew` — только если не лежит ничего. Не вышло — `modified: false`, а не
 * исключение. На этом стоит весь договор сохранения: «поверх какой записи пишем» (`baseEtag`) и
 * ответ 409, а не молча затёртая чужая партия. Что оба дома держат это одинаково, проверяет один
 * набор тестов на обоих (`vps/kv.test.ts`).
 */

/** Условие записи: поверх ровно этой версии или только в пустое место. */
export interface Conditions {
  onlyIfMatch?: string;
  onlyIfNew?: boolean;
}

export interface Kv {
  /** Значение текстом и его версия. Нет ключа — `null`. */
  getWithMetadata(key: string): Promise<{ data: string; etag?: string } | null>;
  /** Записать JSON. Условие не сошлось — `modified: false`, и ничего не записано. */
  setJSON(key: string, value: unknown, opts?: Conditions): Promise<{ modified: boolean; etag?: string }>;
  /** Записать строку как есть, без условий. */
  set(key: string, value: string): Promise<unknown>;
  /**
   * Ключи под приставкой. С `directories` ключи с косой чертой после приставки сворачиваются в
   * папки — полным путём до черты, как это делает Blobs: `000123/tg-1` → папка `000123`.
   */
  list(opts: { prefix?: string; directories?: boolean }): Promise<{ blobs: { key: string }[]; directories: string[] }>;
  delete(key: string): Promise<void>;
}

/**
 * Имена хранилищ. Одни на Netlify и на своём сервере: перенос данных (`vps/import.ts`) идёт по
 * ним же, и хранилище, не названное здесь, при переезде осталось бы на Netlify.
 */
export const STORES = {
  /** Сохранения партий, ключ `tg-<id>`. */
  saves: 'tribe-saves',
  /** Общий мир: реестр замков одной записью. */
  world: 'tribe-world',
  /** Исходящие уведомления, ключ `tg-<id>`. */
  notify: 'tribe-notify',
  /** Индекс исходящих по минутам: пустые метки `<минута>/<ключ игрока>`. */
  due: 'tribe-notify-due',
  /** Счётчики проходов доставки. */
  stats: 'tribe-notify-stats',
  /**
   * Админка (docs/admin.md): заморозка одной записью (`frozen`), указы игрока (`grants/tg-<id>`) и журнал админа
   * (`log`). Пишет только команда бота от `ADMIN_IDS`; читают сохранение, война и проход доставки.
   */
  admin: 'tribe-admin',
  /** Наблюдение за игроком: заходы, опись, журнал действий города и флаги, ключ `tg-<id>`. */
  watch: 'tribe-watch',
  /** Отчёты об ошибках, ключ — номер отчёта. */
  reports: 'tribe-reports',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/** Все хранилища — для переноса и для проверки, что ни одно не забыто. */
export const ALL_STORES: readonly StoreName[] = Object.values(STORES);

/**
 * Строгость чтения. На Netlify `eventual` читает с края сети и может отдать вчерашнее; на своём
 * сервере край один, и строгость там ничего не стоит — SQLite её не различает.
 */
export type Consistency = 'strong' | 'eventual';

/** Как открыть хранилище по имени. */
export type Stores = (name: StoreName, consistency?: Consistency) => Kv;
