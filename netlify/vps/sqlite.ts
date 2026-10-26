/**
 * Хранилище своего сервера — SQLite одним файлом на диске, через ту же дверь `lib/kv.ts`, что и
 * Netlify Blobs. Драйвер встроен в Node (`node:sqlite`): зависимостей у сервера нет, и сборка игры
 * для Netlify от него не меняется ни на байт.
 *
 * Одна таблица на все хранилища: имя хранилища, ключ, значение, ETag. Значение — та же строка, что
 * лежала бы в блобе; ETag — случайная строка в кавычках, как у Blobs, и клиент читает его как
 * непрозрачный, ничего не зная о доме.
 *
 * **Условная запись — одним выражением.** `onlyIfNew` — вставка, которая ничего не делает при
 * занятом ключе; `onlyIfMatch` — обновление с условием на ETag. Сколько строк тронуто, говорит,
 * легла ли запись. Драйвер синхронный, а процесс один, поэтому между проверкой и записью не
 * вклинивается никто — и даже если бы вклинивался, условие проверяет сама база в том же выражении.
 * Всё «прочитать — изменить — записать» живёт выше, в обработчиках, и держится ETag'ом точно так
 * же, как на Netlify.
 */
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from './driver.js';
import type { Kv, StoreName, Stores } from '../lib/kv.js';

/** Версия схемы — `PRAGMA user_version`. Меняется только вместе со ступенью в `openDb`. */
export const SCHEMA_VERSION = 1;

/**
 * Открыть базу. WAL — чтобы чтение не ждало записи и копия (`VACUUM INTO`) снималась на ходу;
 * `synchronous = FULL` — запись партии переживает и выключение питания, а не только падение
 * процесса: записей мало, и каждая — чья-то партия.
 */
export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA busy_timeout = 5000');
  const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (version > SCHEMA_VERSION) {
    db.close();
    throw new Error(`база новее сервера: схема ${version}, сервер знает ${SCHEMA_VERSION}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS blobs (
    store TEXT NOT NULL,
    key TEXT NOT NULL,
    data TEXT NOT NULL,
    etag TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (store, key)
  ) WITHOUT ROWID`);
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

/** Новая версия записи. Случайная, а не счётчик: перенесённые с Netlify ETag'и с нею не встретятся. */
export const freshEtag = (): string => `"${randomBytes(16).toString('hex')}"`;

/** Хранилища поверх открытой базы. Строгость чтения не различается: край у своего сервера один. */
export function sqliteStores(db: DatabaseSync, clock: () => number = Date.now): Stores {
  const get = db.prepare('SELECT data, etag FROM blobs WHERE store = ? AND key = ?');
  const insertNew = db.prepare(
    'INSERT INTO blobs (store, key, data, etag, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (store, key) DO NOTHING',
  );
  const updateIf = db.prepare('UPDATE blobs SET data = ?, etag = ?, updated_at = ? WHERE store = ? AND key = ? AND etag = ?');
  const upsert = db.prepare(
    `INSERT INTO blobs (store, key, data, etag, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (store, key) DO UPDATE SET data = excluded.data, etag = excluded.etag, updated_at = excluded.updated_at`,
  );
  const keys = db.prepare('SELECT key FROM blobs WHERE store = ? AND substr(key, 1, length(?)) = ? ORDER BY key');
  const remove = db.prepare('DELETE FROM blobs WHERE store = ? AND key = ?');

  const write = (store: StoreName, key: string, text: string, opts?: { onlyIfMatch?: string; onlyIfNew?: boolean }) => {
    const etag = freshEtag();
    const at = clock();
    let changed: number | bigint;
    // Условие на ETag — и пустой строкой (OPS-3): пустое условие сходится только с пустой отметкой, а не пишет поверх всего.
    if (opts && 'onlyIfMatch' in opts) changed = updateIf.run(text, etag, at, store, key, opts.onlyIfMatch ?? '').changes;
    else if (opts?.onlyIfNew) changed = insertNew.run(store, key, text, etag, at).changes;
    else changed = upsert.run(store, key, text, etag, at).changes;
    return Number(changed) > 0 ? { modified: true, etag } : { modified: false };
  };

  return (store) => {
    const kv: Kv = {
      getWithMetadata: async (key) => {
        const row = get.get(store, key) as { data: string; etag: string } | undefined;
        return row ? { data: row.data, etag: row.etag } : null;
      },
      setJSON: async (key, value, opts) => write(store, key, JSON.stringify(value), opts),
      set: async (key, value) => write(store, key, value),
      list: async ({ prefix = '', directories = false }) => {
        const all = (keys.all(store, prefix, prefix) as { key: string }[]).map((r) => r.key);
        if (!directories) return { blobs: all.map((key) => ({ key })), directories: [] };
        // Как у Blobs: ключ с косой чертой после приставки — это папка, полным путём до черты.
        const blobs: { key: string }[] = [];
        const dirs = new Set<string>();
        for (const key of all) {
          const rest = key.slice(prefix.length);
          const slash = rest.indexOf('/');
          if (slash < 0) blobs.push({ key });
          else dirs.add(prefix + rest.slice(0, slash));
        }
        return { blobs, directories: [...dirs] };
      },
      delete: async (key) => {
        remove.run(store, key);
      },
    };
    return kv;
  };
}

/**
 * Положить строку как есть — с её ETag'ом. Только для переноса с Netlify (`import.ts`): клиент
 * помнит ETag своей последней записи и сверяет его со серверным (`net/sync.decide`). Перенос,
 * сменивший ETag'и, каждого игрока сделал бы «чужим» своей же партии, и вечер игры без сети ушёл
 * бы в отвергнутые копии.
 */
export function putRaw(db: DatabaseSync, store: StoreName, key: string, data: string, etag: string, at: number): void {
  db.prepare(
    `INSERT INTO blobs (store, key, data, etag, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (store, key) DO UPDATE SET data = excluded.data, etag = excluded.etag, updated_at = excluded.updated_at`,
  ).run(store, key, data, etag, at);
}

/** Сколько строк в хранилище — для переноса и проверки после восстановления. */
export function countRows(db: DatabaseSync, store?: StoreName): number {
  const row = (store
    ? db.prepare('SELECT COUNT(*) AS n FROM blobs WHERE store = ?').get(store)
    : db.prepare('SELECT COUNT(*) AS n FROM blobs').get()) as { n: number };
  return Number(row.n);
}
