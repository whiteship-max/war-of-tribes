/**
 * Свой сервер игры — вход. Одна программа на всё, что нужно на сервере владельца:
 *
 *     serve                 принимать запросы игры (по умолчанию)
 *     backup                снять копию базы сейчас
 *     backups               список копий
 *     restore <имя>         восстановить базу из копии (сервер остановлен)
 *     import-blobs [--dry-run] [--replace]
 *                           перенести данные с Netlify Blobs (сервер остановлен)
 *
 * В контейнере это `docker compose run --rm app <команда>`; пошагово — docs/SERVER.md.
 *
 * Своего смысла у сервера нет: обработчики адресов — те же, что у функций Netlify
 * (`lib/routes/`), договор с клиентом — тот же (`lib/contract.ts`), личность — та же подпись
 * (`lib/initdata.ts`). Здесь только дом: хранилище, приём HTTP, расписание и копии.
 */
import { mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import type { DatabaseSync } from './driver.js';
import { blobsStores } from '../lib/blobs.js';
import { botToken } from '../lib/http.js';
import { ALL_STORES, type Stores } from '../lib/kv.js';
import { ROUTES } from '../lib/routes/index.js';
import { listBackups, makeBackup, restore, rotate, serverAlive } from './backup.js';
import { ENV, pathsOf, readConfig, type VpsConfig } from './config.js';
import { importBlobs } from './import.js';
import { listen } from './listen.js';
import { say, sayFail } from './log.js';
import { startSchedule } from './schedule.js';
import { countRows, openDb, sqliteStores } from './sqlite.js';

const USAGE = `Команды: serve | backup | backups | restore <имя копии> | import-blobs [--dry-run] [--replace]`;

function fail(message: string): never {
  sayFail('остановка', new Error(message));
  process.exit(1);
}

function config(): VpsConfig {
  const { config, problems } = readConfig(process.env);
  if (problems.length > 0) fail(`настройки не разобраны:\n  ${problems.join('\n  ')}`);
  return config;
}

function openData(cfg: VpsConfig): { db: DatabaseSync; paths: ReturnType<typeof pathsOf> } {
  const paths = pathsOf(cfg.dataDir);
  mkdirSync(cfg.dataDir, { recursive: true });
  return { db: openDb(paths.db), paths };
}

async function serve(): Promise<void> {
  const cfg = config();
  // Без токена подпись проверять нечем, и каждый игрок получил бы отказ: игра шла бы без
  // синхронизации, и никто бы не узнал почему. Лучше не подняться и сказать.
  if (!botToken()) fail('токен бота не задан — впишите его в .env (docs/SERVER.md, «Переменные»)');

  let db: DatabaseSync | null = null;
  let stores: Stores;
  const paths = pathsOf(cfg.dataDir);
  mkdirSync(cfg.dataDir, { recursive: true });
  if (cfg.store === 'sqlite') {
    db = openDb(paths.db);
    stores = sqliteStores(db);
    say(`хранилище: SQLite, ${paths.db}, строк ${countRows(db)}`);
  } else {
    stores = blobsStores(cfg.netlify!);
    say('хранилище: Netlify Blobs');
  }

  const server: Server = await listen(
    { routes: ROUTES, stores, onError: (path) => say(`обработчик ${path} упал — ответ 500`) },
    cfg.port,
  );
  const address = server.address();
  say(`слушаю порт ${typeof address === 'object' && address ? address.port : cfg.port}; адреса: ${Object.keys(ROUTES).join(' ')}`);

  const schedule = startSchedule({ config: cfg, stores, db, paths });

  const stop = (signal: string): void => {
    say(`${signal}: останавливаюсь`);
    schedule.stop();
    server.close(() => {
      db?.close();
      say('остановлен');
      process.exit(0);
    });
    // Висящие соединения закрывать не ждём дольше десяти секунд.
    setTimeout(() => {
      db?.close();
      process.exit(0);
    }, 10_000).unref();
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}

function backupNow(): void {
  const cfg = config();
  const { db, paths } = openData(cfg);
  try {
    const name = makeBackup(db, paths.backups, Date.now());
    const gone = rotate(paths.backups, cfg.backupKeep);
    say(`копия снята: ${name}${gone.length > 0 ? `; убрано старых: ${gone.length}` : ''}`);
  } finally {
    db.close();
  }
}

function showBackups(): void {
  const { backups } = pathsOf(config().dataDir);
  const list = listBackups(backups);
  if (list.length === 0) say(`копий нет (${backups})`);
  for (const b of list) say(`${b.name}  ${(b.bytes / 1024).toFixed(1)} КБ`);
}

function restoreFrom(name: string | undefined): void {
  if (!name) fail(`какую копию? ${USAGE}`);
  const paths = pathsOf(config().dataDir);
  const { saved, rows } = restore(paths, name, Date.now());
  say(`база восстановлена из ${name}: строк ${rows}${saved ? `; прежняя база сохранена как ${saved}` : ''}`);
}

async function importFromBlobs(args: string[]): Promise<void> {
  const cfg = config();
  if (!cfg.netlify) fail(`для переноса нужны ${ENV.netlifySite} и ${ENV.netlifyToken} (docs/SERVER.md, «Перенос данных»)`);
  const dryRun = args.includes('--dry-run');
  const replace = args.includes('--replace');
  const { db, paths } = openData(cfg);
  try {
    if (!dryRun && serverAlive(paths.alive, Date.now())) fail('сервер работает — сперва остановите его: docker compose stop app');
    if (!dryRun && replace && countRows(db) > 0) say(`прежняя база сохранена копией: ${makeBackup(db, paths.backups, Date.now())}`);
    const tally = await importBlobs(blobsStores(cfg.netlify), db, { replace, dryRun, now: Date.now() });
    for (const store of ALL_STORES) say(`${store}: ${tally.stores[store]}`);
    say(`${dryRun ? 'было бы перенесено' : 'перенесено'} строк: ${tally.total}${tally.noEtag ? `; без ETag у источника: ${tally.noEtag}` : ''}${tally.missing ? `; пропало между списком и чтением: ${tally.missing}` : ''}`);
  } finally {
    db.close();
  }
}

const [cmd = 'serve', ...rest] = process.argv.slice(2);
try {
  if (cmd === 'serve') await serve();
  else if (cmd === 'backup') backupNow();
  else if (cmd === 'backups') showBackups();
  else if (cmd === 'restore') restoreFrom(rest[0]);
  else if (cmd === 'import-blobs') await importFromBlobs(rest);
  else fail(`не знаю команды «${cmd}». ${USAGE}`);
} catch (e) {
  sayFail(cmd, e);
  process.exit(1);
}
