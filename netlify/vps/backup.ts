/**
 * Резервные копии базы своего сервера: снять, перечислить, повернуть, восстановить.
 *
 * Копия снимается на ходу — `VACUUM INTO` пишет согласованный снимок базы вместе с тем, что ещё
 * лежит в журнале WAL, и сервер при этом не останавливается. Пишется она во временный файл и
 * переименовывается только после проверки целостности: файл с именем копии — всегда целая копия,
 * а не недописанная.
 *
 * Копии лежат рядом с базой (`/data/backups`), то есть на том же диске. От ошибки, поломанной
 * партии и неудачного обновления это спасает, от потери сервера — нет: копию с сервера
 * забирают к себе (docs/SERVER.md, «Резервные копии»).
 *
 * Восстановление идёт только под остановленным сервером: живой сервер трогает отметку
 * `serve.alive`, и свежая отметка — отказ. Нынешняя база перед заменой сама уходит копией
 * `before-restore-…`, которую поворот не трогает: восстановление обратимо.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from './driver.js';
import { countRows, openDb } from './sqlite.js';

/** Суточная копия: `tribe-2026-10-04-0330.sqlite` (UTC), при совпадении минуты — с номером. */
export const BACKUP_RE = /^tribe-\d{4}-\d{2}-\d{2}-\d{4}(?:-\d+)?\.sqlite$/;
/** Нынешняя база, снятая перед восстановлением. Повороту не подлежит. */
export const BEFORE_RE = /^before-restore-\d{4}-\d{2}-\d{2}-\d{6}\.sqlite$/;

/** Отметка «сервер работает» свежее этого — сервер жив. Трогает её он раз в `ALIVE_MS`. */
export const ALIVE_MS = 30_000;
export const ALIVE_FRESH_MS = 3 * ALIVE_MS;

const stamp = (now: number): string => new Date(now).toISOString().slice(0, 16).replace('T', '-').replace(':', '');

export const backupName = (now: number, n = 1): string => `tribe-${stamp(now)}${n > 1 ? `-${n}` : ''}.sqlite`;

const quote = (path: string): string => `'${path.replace(/'/g, "''")}'`;

/** Целая ли база в файле. Не целая — отказ, а не «почти копия». */
export function checkFile(file: string): void {
  const db = new DatabaseSync(file);
  try {
    const rows = db.prepare('PRAGMA quick_check').all() as Record<string, unknown>[];
    const verdict = rows.map((r) => String(Object.values(r)[0])).join('; ');
    if (verdict !== 'ok') throw new Error(`копия не целая: ${verdict}`);
    // Это наша база, а не чужой файл: таблица на месте.
    countRows(db);
  } finally {
    db.close();
  }
}

/** Свободное имя суточной копии: две копии в одну минуту ложатся рядом, а не поверх. */
export function freeName(dir: string, now: number): string {
  let name = backupName(now);
  for (let n = 2; existsSync(join(dir, name)); n++) name = backupName(now, n);
  return name;
}

/** Снять копию живой базы в папку копий под именем `name` (по умолчанию — суточная). */
export function makeBackup(db: DatabaseSync, dir: string, now: number, name: string = freeName(dir, now)): string {
  mkdirSync(dir, { recursive: true });
  if (existsSync(join(dir, name))) throw new Error(`копия «${name}» уже есть`);
  const part = join(dir, `.${name}.part`);
  rmSync(part, { force: true });
  try {
    db.exec(`VACUUM INTO ${quote(part)}`);
    checkFile(part);
    renameSync(part, join(dir, name));
  } finally {
    rmSync(part, { force: true });
  }
  return name;
}

export interface BackupInfo {
  name: string;
  bytes: number;
  /** Когда файл записан. */
  at: number;
}

/** Копии в папке — суточные и снятые перед восстановлением, новые первыми. */
export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => BACKUP_RE.test(n) || BEFORE_RE.test(n))
    .map((name) => {
      const st = statSync(join(dir, name));
      return { name, bytes: st.size, at: st.mtimeMs };
    })
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/**
 * Поворот: суточных копий остаётся `keep` самых новых, остальные удаляются. Новизна — по имени, то
 * есть по минуте снятия, а не по времени файла: скопированный руками файл свежим не станет.
 * Копии `before-restore-…` не трогаются никогда.
 */
export function rotate(dir: string, keep: number): string[] {
  const daily = listBackups(dir).filter((b) => BACKUP_RE.test(b.name));
  const gone = daily.slice(keep).map((b) => b.name);
  for (const name of gone) rmSync(join(dir, name), { force: true });
  return gone;
}

/** Самая свежая суточная копия — по минуте в имени. */
export function newestBackupAt(dir: string): number | null {
  const daily = listBackups(dir).filter((b) => BACKUP_RE.test(b.name));
  if (daily.length === 0) return null;
  const m = /^tribe-(\d{4}-\d{2}-\d{2})-(\d{2})(\d{2})/.exec(daily[0].name)!;
  return Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`);
}

/** Жив ли сервер на этой папке данных. */
export function serverAlive(aliveFile: string, now: number): boolean {
  if (!existsSync(aliveFile)) return false;
  return now - statSync(aliveFile).mtimeMs < ALIVE_FRESH_MS;
}

/**
 * Восстановить базу из копии. `name` — только имя файла в папке копий: путь в нём не принимается,
 * чтобы восстановление не подняло базу из случайного места диска.
 */
export function restore(paths: { db: string; backups: string; alive: string }, name: string, now: number): { saved: string | null; rows: number } {
  if (basename(name) !== name || !(BACKUP_RE.test(name) || BEFORE_RE.test(name))) {
    throw new Error(`«${name}» — не имя копии; список копий — команда backups`);
  }
  const source = join(paths.backups, name);
  if (!existsSync(source)) throw new Error(`копии «${name}» нет в ${paths.backups}`);
  if (serverAlive(paths.alive, now)) {
    throw new Error('сервер работает — сперва остановите его: docker compose stop app');
  }
  checkFile(source);

  // Нынешняя база — копией рядом, и только потом замена: восстановление обратимо.
  let saved: string | null = null;
  if (existsSync(paths.db)) {
    const current = openDb(paths.db);
    try {
      const at = new Date(now).toISOString();
      saved = makeBackup(current, paths.backups, now, `before-restore-${at.slice(0, 10)}-${at.slice(11, 19).replace(/:/g, '')}.sqlite`);
    } finally {
      current.close();
    }
  }
  const next = `${paths.db}.restoring`;
  copyFileSync(source, next);
  rmSync(`${paths.db}-wal`, { force: true });
  rmSync(`${paths.db}-shm`, { force: true });
  renameSync(next, paths.db);

  const db = openDb(paths.db);
  try {
    return { saved, rows: countRows(db) };
  } finally {
    db.close();
  }
}
