import { existsSync, readdirSync, rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORES, type StoreName, type Stores } from '../lib/kv.js';
import { pathsOf, readConfig, type VpsConfig } from './config.js';
import type { DatabaseSync } from './driver.js';
import { backupOverdue, nextAt, startSchedule } from './schedule.js';
import { openDb, sqliteStores } from './sqlite.js';
import { tempDir } from './testkit.js';

const DAY = 86_400_000;
const MIN = 60_000;

describe('когда следующая копия', () => {
  const at = 3 * 60 + 30; // 03:30 UTC

  it('сегодня, если минута ещё впереди; завтра, если прошла или ровно сейчас', () => {
    const day = Date.UTC(2026, 9, 4);
    expect(nextAt(day + 1 * 60 * MIN, at)).toBe(day + 210 * MIN);
    expect(nextAt(day + 210 * MIN, at)).toBe(day + DAY + 210 * MIN);
    expect(nextAt(day + 23 * 60 * MIN, at)).toBe(day + DAY + 210 * MIN);
  });

  it('сразу после запуска — если копии нет или ей сутки', () => {
    const now = Date.UTC(2026, 9, 4, 12);
    expect(backupOverdue(null, now)).toBe(true);
    expect(backupOverdue(now - DAY, now)).toBe(true);
    expect(backupOverdue(now - DAY + MIN, now)).toBe(false);
  });
});

describe('расписание в процессе', () => {
  const T = Date.UTC(2026, 9, 4, 3, 0);
  let dir: string;
  let db: DatabaseSync;
  let opened: StoreName[];
  let stores: Stores;
  const config = (env: Record<string, string> = {}): VpsConfig => readConfig({ BACKUP_AT: '03:30', ...env }).config;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    dir = tempDir('schedule');
    db = openDb(pathsOf(dir).db);
    opened = [];
    const real = sqliteStores(db);
    stores = (name, c) => {
      opened.push(name);
      return real(name, c);
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('копия — сразу при запуске (копий нет) и потом в минуту BACKUP_AT; отметка «работает» — и снята при остановке', async () => {
    const paths = pathsOf(dir);
    const s = startSchedule({ config: config(), stores, db, paths });
    expect(existsSync(paths.alive)).toBe(true);
    expect(readdirSync(paths.backups)).toEqual(['tribe-2026-10-04-0300.sqlite']);
    await vi.advanceTimersByTimeAsync(29 * MIN);
    expect(readdirSync(paths.backups)).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect(readdirSync(paths.backups).sort()).toEqual(['tribe-2026-10-04-0300.sqlite', 'tribe-2026-10-04-0330.sqlite']);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(readdirSync(paths.backups)).toHaveLength(3);
    s.stop();
    expect(existsSync(paths.alive)).toBe(false);
  });

  // Свой срок: четверо суток поддельных минут с копиями файла SQLite — дома (Windows) 4.2 с в одиночку, и под нагрузкой
  // полного `npm test` общий потолок 5 с ронял прогон (20.10.2026).
  it('поворот держит BACKUP_KEEP суточных копий', async () => {
    const paths = pathsOf(dir);
    const s = startSchedule({ config: config({ BACKUP_KEEP: '2' }), stores, db, paths });
    await vi.advanceTimersByTimeAsync(4 * DAY);
    expect(readdirSync(paths.backups)).toHaveLength(2);
    s.stop();
  }, 30_000);

  /**
   * Доставка заморожена владельцем (docs/SUBTRACT.md). Переезд — не повод её разморозить: без
   * `TRIBE_DELIVER=on` проход не открывает ни одного хранилища исходящих за сколько угодно минут.
   */
  it('проход доставки без слова владельца не идёт', async () => {
    const s = startSchedule({ config: config(), stores, db, paths: pathsOf(dir) });
    await vi.advanceTimersByTimeAsync(10 * MIN);
    expect(opened.filter((n) => n === STORES.due || n === STORES.notify || n === STORES.stats)).toEqual([]);
    s.stop();
  });

  it('с TRIBE_DELIVER=on — проход раз в минуту, и счётчик прохода ложится в своё хранилище', async () => {
    const s = startSchedule({ config: config({ TRIBE_DELIVER: 'on' }), stores, db, paths: pathsOf(dir) });
    await vi.advanceTimersByTimeAsync(MIN + 1000);
    expect(opened).toContain(STORES.due);
    const { blobs } = await sqliteStores(db)(STORES.stats).list({});
    expect(blobs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2 * MIN);
    expect((await sqliteStores(db)(STORES.stats).list({})).blobs).toHaveLength(3);
    s.stop();
  });

  it('на Blobs копий нет — их держит Netlify; отметка «работает» есть', async () => {
    const paths = pathsOf(dir);
    const s = startSchedule({ config: config(), stores, db: null, paths });
    await vi.advanceTimersByTimeAsync(DAY);
    expect(existsSync(paths.backups)).toBe(false);
    expect(existsSync(paths.alive)).toBe(true);
    s.stop();
  });
});
