/**
 * Перенос данных: Netlify Blobs → SQLite своего сервера.
 *
 * Читает каждое хранилище из `lib/kv.ALL_STORES` целиком — ключ, значение и **ETag** — и кладёт
 * строки как есть. ETag переносится нарочно и без него перенос был бы поломкой: клиент помнит ETag
 * своей последней записи и по нему решает, его ли это партия на сервере (`src/net/sync.decide`).
 * Новый ETag у каждой записи значил бы «на сервере чужая партия» у каждого игрока: серверная копия
 * победила бы, а вечер игры без сети ушёл бы в отвергнутые.
 *
 * Сначала читается всё, потом пишется одной транзакцией: перенос, оборвавшийся на середине сети,
 * не оставляет базу наполовину заполненной. Непустая база без `--replace` — отказ; с `--replace`
 * она сперва уходит копией (`backup.ts`), потом очищается. Под живым сервером перенос не идёт —
 * та же отметка `serve.alive`, что у восстановления.
 *
 * Ключей игроков перенос не печатает: только сколько строк в каком хранилище.
 */
import type { DatabaseSync } from './driver.js';
import { ALL_STORES, type StoreName, type Stores } from '../lib/kv.js';
import { countRows, freshEtag, putRaw } from './sqlite.js';

export interface ImportTally {
  /** Строк по хранилищам. */
  stores: Record<StoreName, number>;
  total: number;
  /** Строки без ETag у источника: им выдан новый, и их владелец увидит партию «чужой». */
  noEtag: number;
  /** Были в списке, но не прочитались: сняты между списком и чтением. Не перенесены. */
  missing: number;
}

export async function importBlobs(
  from: Stores,
  db: DatabaseSync,
  opts: { replace: boolean; dryRun: boolean; now: number },
): Promise<ImportTally> {
  const before = countRows(db);
  if (before > 0 && !opts.replace && !opts.dryRun) {
    throw new Error(`в базе уже ${before} строк — перенос поверх них только с --replace (база сперва уйдёт копией)`);
  }

  const rows: { store: StoreName; key: string; text: string; etag: string | null }[] = [];
  const tally: ImportTally = { stores: {} as Record<StoreName, number>, total: 0, noEtag: 0, missing: 0 };
  for (const store of ALL_STORES) {
    const kv = from(store, 'strong');
    const { blobs } = await kv.list({});
    tally.stores[store] = 0;
    for (const { key } of blobs) {
      const got = await kv.getWithMetadata(key);
      if (!got) {
        tally.missing++;
        continue;
      }
      rows.push({ store, key, text: got.data, etag: got.etag ?? null });
      tally.stores[store]++;
      tally.total++;
      if (!got.etag) tally.noEtag++;
    }
  }
  if (opts.dryRun) return tally;

  db.exec('BEGIN IMMEDIATE');
  try {
    if (opts.replace) {
      const wipe = db.prepare('DELETE FROM blobs WHERE store = ?');
      for (const store of ALL_STORES) wipe.run(store);
    }
    for (const r of rows) {
      putRaw(db, r.store, r.key, r.text, r.etag ?? freshEtag(), opts.now);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return tally;
}
