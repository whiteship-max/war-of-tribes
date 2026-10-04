import { existsSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORES } from '../lib/kv.js';
import { BACKUP_RE, backupName, listBackups, makeBackup, newestBackupAt, restore, rotate } from './backup.js';
import { pathsOf } from './config.js';
import type { DatabaseSync } from './driver.js';
import { countRows, openDb, sqliteStores } from './sqlite.js';
import { tempDir } from './testkit.js';

/**
 * Копии базы: целые, по имени — минута снятия, поворот не трогает лишнего, восстановление
 * обратимо и не идёт под живым сервером. Каждый случай — на настоящем файле SQLite.
 */
const T = Date.UTC(2026, 9, 4, 3, 30);
let dir: string;
let paths: ReturnType<typeof pathsOf>;
let db: DatabaseSync;

beforeEach(() => {
  dir = tempDir('backup');
  paths = pathsOf(dir);
  db = openDb(paths.db);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // уже закрыта восстановлением
  }
  rmSync(dir, { recursive: true, force: true });
});

const put = (key: string, value: unknown): Promise<unknown> => sqliteStores(db)(STORES.saves).setJSON(key, value);
const get = async (file: string, key: string): Promise<string | null> => {
  const other = openDb(file);
  try {
    return (await sqliteStores(other)(STORES.saves).getWithMetadata(key))?.data ?? null;
  } finally {
    other.close();
  }
};

describe('копия', () => {
  it('снимается на ходу, называется минутой снятия и содержит то же самое', async () => {
    await put('tg-1', { rev: 1 });
    const name = makeBackup(db, paths.backups, T);
    expect(name).toBe('tribe-2026-10-04-0330.sqlite');
    expect(BACKUP_RE.test(name)).toBe(true);
    expect(await get(join(paths.backups, name), 'tg-1')).toBe('{"rev":1}');
    // Недописанных файлов рядом не остаётся.
    expect(readdirSync(paths.backups)).toEqual([name]);
  });

  it('две копии в одну минуту ложатся рядом, а не поверх', () => {
    const a = makeBackup(db, paths.backups, T);
    const b = makeBackup(db, paths.backups, T);
    expect([a, b]).toEqual(['tribe-2026-10-04-0330.sqlite', 'tribe-2026-10-04-0330-2.sqlite']);
  });

  it('свежесть — по минуте в имени', () => {
    expect(newestBackupAt(paths.backups)).toBeNull();
    makeBackup(db, paths.backups, T - 86_400_000);
    makeBackup(db, paths.backups, T);
    expect(newestBackupAt(paths.backups)).toBe(T);
  });
});

describe('поворот', () => {
  it('остаются N самых новых суточных; снятые перед восстановлением не трогаются', () => {
    for (let d = 0; d < 5; d++) makeBackup(db, paths.backups, T - d * 86_400_000);
    writeFileSync(join(paths.backups, 'before-restore-2026-01-01-000000.sqlite'), '');
    writeFileSync(join(paths.backups, 'чужой файл.txt'), '');
    const gone = rotate(paths.backups, 3);
    expect(gone.sort()).toEqual([backupName(T - 4 * 86_400_000), backupName(T - 3 * 86_400_000)].sort());
    expect(readdirSync(paths.backups).sort()).toEqual(
      [
        backupName(T),
        backupName(T - 86_400_000),
        backupName(T - 2 * 86_400_000),
        'before-restore-2026-01-01-000000.sqlite',
        'чужой файл.txt',
      ].sort(),
    );
  });
});

describe('восстановление', () => {
  it('возвращает базу на минуту копии, а нынешнюю кладёт рядом', async () => {
    await put('tg-1', { rev: 1 });
    const name = makeBackup(db, paths.backups, T);
    await put('tg-1', { rev: 2 });
    await put('tg-2', { rev: 1 });
    db.close();

    const { saved, rows } = restore(paths, name, T + 3_600_000);
    expect(rows).toBe(1);
    expect(await get(paths.db, 'tg-1')).toBe('{"rev":1}');
    expect(await get(paths.db, 'tg-2')).toBeNull();
    // Обратимо: прежняя база — копией, в ней обе записи.
    expect(saved).toMatch(/^before-restore-2026-10-04-043000\.sqlite$/);
    expect(await get(join(paths.backups, saved!), 'tg-1')).toBe('{"rev":2}');
    expect(listBackups(paths.backups).map((b) => b.name)).toContain(saved);
  });

  it('под живым сервером не идёт', () => {
    const name = makeBackup(db, paths.backups, T);
    db.close();
    writeFileSync(paths.alive, '');
    const fresh = new Date(T + 10_000);
    utimesSync(paths.alive, fresh, fresh);
    expect(() => restore(paths, name, T + 20_000)).toThrow(/сервер работает/);
    // Отметка старше трёх отметочных сроков — сервер мёртв, можно.
    expect(() => restore(paths, name, T + 10_000 + 120_000)).not.toThrow();
  });

  it('путь вместо имени копии не принимается', () => {
    db.close();
    for (const bad of ['../tribe.sqlite', join(dir, 'tribe.sqlite'), 'tribe.sqlite', 'нет-такой.sqlite']) {
      expect(() => restore(paths, bad, T), bad).toThrow();
    }
    expect(existsSync(paths.db)).toBe(true);
  });

  it('битая копия — отказ, и нынешняя база цела', async () => {
    await put('tg-1', { rev: 7 });
    db.close();
    const name = backupName(T);
    mkdirSync(paths.backups, { recursive: true });
    writeFileSync(join(paths.backups, name), 'это не база sqlite, это просто текст, и его много'.repeat(200));
    expect(() => restore(paths, name, T)).toThrow();
    expect(await get(paths.db, 'tg-1')).toBe('{"rev":7}');
    const reopened = openDb(paths.db);
    expect(countRows(reopened)).toBe(1);
    reopened.close();
  });
});
