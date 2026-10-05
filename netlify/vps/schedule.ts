/**
 * Расписание своего сервера — внутри процесса, без cron и без второго контейнера.
 *
 * Работ три, и на Netlify из них была одна:
 *
 * - **суточная копия базы** (`backup.ts`) в минуту `BACKUP_AT` по UTC, с поворотом; если свежей
 *   копии нет больше суток — например, сервер только поднялся или стоял, — копия снимается сразу
 *   после запуска;
 * - **отметка «сервер работает»** (`serve.alive`) раз в `ALIVE_MS`: по ней восстановление
 *   отказывается идти под живым сервером;
 * - **проход доставки уведомлений** (`lib/deliver.ts`) раз в минуту — **только если** владелец
 *   включил его (`TRIBE_DELIVER=on`), тот же проход и тот же флаг, что у функции по расписанию на Netlify
 *   (`functions/deliver.mts`): ход войны между игроками и сообщения в Telegram (docs/NOTIFY.md, раздел 12).
 *
 * Часы, время следующей копии и решение «нужна ли копия сразу» — чистые функции: их проверяют
 * тестом без настоящих таймеров (`schedule.test.ts`).
 */
import { closeSync, openSync, rmSync, utimesSync } from 'node:fs';
import type { DatabaseSync } from './driver.js';
import { deliverPass, passIoOf } from '../lib/deliver.js';
import { telegram } from '../lib/telegram.js';
import type { Stores } from '../lib/kv.js';
import { ALIVE_MS, makeBackup, newestBackupAt, rotate } from './backup.js';
import type { VpsConfig } from './config.js';
import { say, sayFail } from './log.js';

const DAY_MS = 24 * 60 * 60_000;
const MINUTE_MS = 60_000;

/** Следующая минута `at` (минута суток UTC) строго позже `now`. */
export function nextAt(now: number, at: number): number {
  const day = Math.floor(now / DAY_MS) * DAY_MS;
  const today = day + at * MINUTE_MS;
  return today > now ? today : today + DAY_MS;
}

/** Нужна ли копия сразу: свежей суточной нет вовсе или она старше суток. */
export const backupOverdue = (newest: number | null, now: number): boolean => newest === null || now - newest >= DAY_MS;

export interface ScheduleIo {
  config: VpsConfig;
  stores: Stores;
  /** База — только у `TRIBE_STORE=sqlite`: на Blobs копии снимает Netlify, а не мы. */
  db: DatabaseSync | null;
  paths: { backups: string; alive: string };
  clock?: () => number;
}

export interface Schedule {
  stop(): void;
}

export function startSchedule(io: ScheduleIo): Schedule {
  const clock = io.clock ?? Date.now;
  const timers: NodeJS.Timeout[] = [];
  let daily: NodeJS.Timeout | null = null;
  let stopped = false;

  // Отметка «сервер работает».
  const touch = (): void => {
    try {
      const t = new Date(clock());
      try {
        utimesSync(io.paths.alive, t, t);
      } catch {
        closeSync(openSync(io.paths.alive, 'a'));
        utimesSync(io.paths.alive, t, t);
      }
    } catch (e) {
      sayFail('отметка «сервер работает» не записана', e);
    }
  };
  touch();
  timers.push(setInterval(touch, ALIVE_MS));

  // Суточная копия.
  const db = io.db;
  if (db) {
    const backup = (): void => {
      try {
        const name = makeBackup(db, io.paths.backups, clock());
        const gone = rotate(io.paths.backups, io.config.backupKeep);
        say(`копия снята: ${name}${gone.length > 0 ? `; убрано старых: ${gone.length}` : ''}`);
      } catch (e) {
        sayFail('копия не снята', e);
      }
    };
    const plan = (): void => {
      if (stopped) return;
      const wait = nextAt(clock(), io.config.backupAt) - clock();
      daily = setTimeout(() => {
        backup();
        plan();
      }, wait);
    };
    if (backupOverdue(newestBackupAt(io.paths.backups), clock())) backup();
    plan();
  }

  // Проход доставки — только по слову владельца.
  if (io.config.deliver) {
    let running = false;
    timers.push(
      setInterval(() => {
        if (running) return;
        running = true;
        deliverPass(passIoOf(io.stores, telegram()), clock(), clock)
          .catch((e) => sayFail('проход доставки упал', e))
          .finally(() => {
            running = false;
          });
      }, MINUTE_MS),
    );
    say('проход доставки уведомлений включён: раз в минуту');
  }

  return {
    stop() {
      stopped = true;
      for (const t of timers) clearInterval(t);
      if (daily) clearTimeout(daily);
      rmSync(io.paths.alive, { force: true });
    },
  };
}
