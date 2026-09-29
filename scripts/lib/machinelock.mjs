/**
 * Замок тяжёлых задач — один на машину, общий для всех проектов владельца.
 *
 * Зачем. Бюджет железа (`budget.ts`) знает только этот проект: 29.09.2026 машина выключилась от перегрева, пока
 * полная приёмка держала ядра, а в другой сессии шёл рендер видео другого проекта. Замок — файл в домашней папке
 * (`~/.heavy-job.lock`): кто начинает тяжёлую работу — приёмку, веер отчётов, браузерный отчёт, сборку, тесты,
 * рендер, — берёт его, а занятый ждёт. Правило одно на всех, и поэтому модуль — простой JS без зависимостей: его
 * запускает `node` любого проекта (`node machinelock.mjs <задача> -- <команда>`).
 *
 * ЗАПИСЬ. JSON одной строкой: `{ project, task, pid, started }` — проект, задача, номер процесса и минута взятия (ISO).
 * Создаётся атомарно (`wx`: второй создатель получает отказ), снимается тем, кто взял.
 *
 * МЁРТВЫЙ ЗАМОК снимается сам. Мёртв — если процесса с этим номером нет или **процесс с этим номером родился позже
 * замка**: машина владельца выключается посреди прогона (трижды за неделю), замок переживает перезагрузку, а номер
 * на Windows быстро достаётся другому процессу, и без второй проверки все тяжёлые задачи ждали бы вечно.
 *
 * СВОЙ ЗАМОК. Взявший кладёт отметку в переменную окружения (`HEAVY_JOB_LOCK`), и его потомки её наследуют: отчёт под
 * приёмкой, сборка базы во втором worktree, дочерние процессы веера — своя работа, и замок им не мешает.
 */
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, linkSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Где лежит замок. Переменная `HEAVY_JOB_LOCK_FILE` — только для тестов: замок машины один. */
export const LOCK_FILE = process.env.HEAVY_JOB_LOCK_FILE || path.join(homedir(), '.heavy-job.lock');

/** Переменная окружения с отметкой своего замка: её наследуют потомки взявшего. */
export const LOCK_ENV = 'HEAVY_JOB_LOCK';

/** Недописанная запись моложе этого ещё пишется; старше — брошена. */
export const WRITING_MS = 30_000;
/** Процесс, родившийся позже замка больше чем на это, — чужой процесс с тем же номером. */
const BORN_SLACK_MS = 5_000;

/** Как часто занятый замок спрашивают снова и как часто об ожидании говорят строкой. */
export const POLL_MS = 30_000;
export const SAY_MS = 5 * 60_000;

/** Отметка замка — её наследуют потомки. */
export function tokenOf(rec) {
  return `${rec.pid}@${rec.started}`;
}

/**
 * Прочитать замок: `null` — замка нет; `{ broken, age }` — запись не читается (пишется или брошена);
 * иначе `{ project, task, pid, started }`.
 */
export function readLock(file = LOCK_FILE) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  try {
    const j = JSON.parse(text);
    if (j && Number.isInteger(j.pid) && j.pid > 0) {
      return { project: String(j.project ?? '?'), task: String(j.task ?? '?'), pid: j.pid, started: String(j.started ?? '') };
    }
  } catch {
    // ниже: запись не читается
  }
  let age = Infinity;
  try {
    age = Date.now() - statSync(file).mtimeMs;
  } catch {
    // снят между чтениями
  }
  return { broken: true, age };
}

/** Есть ли процесс с этим номером. */
export function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** Когда родился процесс, миллисекунды; не узнать — `null`. */
export function processBorn(pid) {
  if (process.platform === 'win32') {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-Command', `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if ($p) { $p.CreationDate.ToUniversalTime().ToString('o') }`],
      { encoding: 'utf8', windowsHide: true },
    );
    const t = Date.parse((r.stdout ?? '').trim());
    return Number.isNaN(t) ? null : t;
  }
  const r = spawnSync('ps', ['-o', 'lstart=', '-p', String(Number(pid))], { encoding: 'utf8' });
  const t = Date.parse((r.stdout ?? '').trim());
  return Number.isNaN(t) ? null : t;
}

/**
 * Жив ли взявший: процесс есть и родился не позже замка. Чего не узнать, то считается живым — ждать лишнее безопаснее,
 * чем снять чужой живой замок.
 */
export function holderAlive(rec, born = processBorn) {
  if (!processExists(rec.pid)) return false;
  const started = Date.parse(rec.started);
  if (Number.isNaN(started)) return true;
  const b = born(rec.pid);
  return b === null || b <= started + BORN_SLACK_MS;
}

/** Замок — наш: его отметка у нас в окружении (взяли мы или предок). */
export function isOurs(rec, env = process.env) {
  return !!rec && !rec.broken && env[LOCK_ENV] === tokenOf(rec);
}

/**
 * Снять мёртвый замок, не задев живого. Переименование атомарно: снимает один; если под старым именем оказался уже
 * новый замок (кто-то снял мёртвый и взял раньше нас) — он возвращается на место.
 */
function removeDead(file, judged) {
  const aside = `${file}.dead-${process.pid}-${Date.now()}`;
  try {
    renameSync(file, aside);
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  const moved = readLock(aside);
  const same = judged === null ? !moved || moved.broken : moved && !moved.broken && tokenOf(moved) === tokenOf(judged);
  if (!same) {
    try {
      linkSync(aside, file);
    } catch {
      // на месте уже третий замок — пусть живёт он
    }
  }
  try {
    unlinkSync(aside);
  } catch {
    // уже убран
  }
}

/**
 * Попробовать взять замок сейчас. Итог: `{ taken: true, lock, release }` — взят; `{ ours: true, lock }` — он уже наш;
 * `{ held: lock }` — занят живым чужим (или пишется: `lock` — `{ broken }`). `options.mine(pid)` — свой ли процесс
 * (предок): спрашивается, только когда отметки в окружении нет, а держит живой.
 */
export function tryTake(project, task, options = {}) {
  const file = options.file ?? LOCK_FILE;
  const env = options.env ?? process.env;
  const born = options.born ?? processBorn;
  for (let attempt = 0; attempt < 5; attempt++) {
    const rec = { project, task, pid: process.pid, started: new Date().toISOString() };
    try {
      const fd = openSync(file, 'wx');
      try {
        writeSync(fd, `${JSON.stringify(rec)}\n`);
      } finally {
        closeSync(fd);
      }
      env[LOCK_ENV] = tokenOf(rec);
      const release = () => releaseLock(rec, file);
      process.once('exit', release);
      return { taken: true, lock: rec, release };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const held = readLock(file);
    if (held === null) continue;
    if (held.broken) {
      if (held.age < WRITING_MS) return { held };
      removeDead(file, null);
      continue;
    }
    if (isOurs(held, env)) return { ours: true, lock: held };
    if (!holderAlive(held, born)) {
      removeDead(file, held);
      continue;
    }
    if (options.mine?.(held.pid)) return { ours: true, lock: held };
    return { held };
  }
  return { held: readLock(file) ?? { broken: true, age: 0 } };
}

/** Снять свой замок: только если в файле всё ещё он. */
export function releaseLock(rec, file = LOCK_FILE) {
  const now = readLock(file);
  if (!now || now.broken || tokenOf(now) !== tokenOf(rec)) return;
  try {
    unlinkSync(file);
  } catch {
    // уже снят
  }
}

/** Кто держит замок — словами. */
export function holderWords(held) {
  if (held.broken) return 'замок машины пишется';
  const t = new Date(held.started);
  const at = Number.isNaN(t.getTime()) ? held.started : t.toLocaleString('ru-RU');
  return `замок машины: ${held.project} — ${held.task}, процесс ${held.pid}, с ${at}`;
}

/**
 * Взять замок, дождавшись его: занят — ждать, говоря об этом строкой сразу и раз в `SAY_MS`. Итог — функция, снимающая
 * замок (у своего замка предка — пустая: снимет взявший).
 */
export async function takeLock(project, task, options = {}) {
  const say = options.say ?? ((line) => console.log(line));
  const poll = options.pollMs ?? POLL_MS;
  let said = -Infinity;
  const from = Date.now();
  for (;;) {
    const r = tryTake(project, task, options);
    if (r.taken) {
      if (said > -Infinity) say(`${task}: замок машины свободен через ${Math.round((Date.now() - from) / 1000)} с`);
      return r.release;
    }
    if (r.ours) return () => {};
    if (Date.now() - said >= (options.sayMs ?? SAY_MS)) {
      said = Date.now();
      say(`${task} ждёт — ${holderWords(r.held)}`);
    }
    await new Promise((res) => setTimeout(res, poll));
  }
}

/**
 * Запуск из командной строки — для любого проекта:
 *
 *   node machinelock.mjs <задача> -- <команда>   взять замок (дождавшись), выполнить команду, снять
 *   node machinelock.mjs status                  кто держит замок
 *
 * Проект — имя текущей папки. Команда наследует отметку замка: если она сама — тяжёлая задача с замком, она его не ждёт.
 */
async function cli(argv) {
  if (argv[0] === 'status') {
    const held = readLock();
    if (!held) console.log('замок машины свободен');
    else if (held.broken) console.log(holderWords(held));
    else console.log(`${holderWords(held)}${holderAlive(held) ? '' : ' — процесс мёртв, замок снимет следующий'}`);
    return 0;
  }
  const dash = argv.indexOf('--');
  const task = argv.slice(0, dash < 0 ? argv.length : dash).join(' ').trim();
  const command = dash < 0 ? '' : argv.slice(dash + 1).join(' ').trim();
  if (!task || !command) {
    console.error('как: node machinelock.mjs <задача> -- <команда>   или   node machinelock.mjs status');
    return 2;
  }
  const release = await takeLock(path.basename(process.cwd()), task);
  try {
    return await new Promise((resolve) => {
      const child = spawn(command, { stdio: 'inherit', shell: true, env: process.env });
      child.on('error', (e) => {
        console.error(`${task}: команда не запустилась — ${e.message}`);
        resolve(1);
      });
      child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });
  } finally {
    release();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  process.exitCode = await cli(process.argv.slice(2));
}
