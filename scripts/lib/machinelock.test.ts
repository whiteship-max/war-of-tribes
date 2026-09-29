/**
 * Замок машины (`machinelock.mjs`, бюджет железа): тяжёлая работа любого проекта берёт `~/.heavy-job.lock`, занятый
 * ждёт, мёртвый снимается. Здесь замок — во временном файле (довод `file`), а держит его настоящий чужой процесс:
 * «жив ли взявший» спрашивается у системы, и подделать это в одном процессе нечем.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { LOCK_ENV, processBorn, processExists, readLock, releaseLock, takeLock, tokenOf, tryTake, type LockRecord } from './machinelock.mjs';

const MODULE = join(__dirname, 'machinelock.mjs');
const dirs: string[] = [];
const kids: ChildProcess[] = [];

afterEach(() => {
  for (const k of kids.splice(0)) k.kill();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempLock(): string {
  const d = mkdtempSync(join(tmpdir(), 'heavy-lock-'));
  dirs.push(d);
  return join(d, '.heavy-job.lock');
}

/** Чужой процесс, который берёт замок в `file` и держит его, пока жив. Итог — он и его запись. */
async function holder(file: string, hold = true): Promise<{ child: ChildProcess; rec: LockRecord }> {
  const code = `import { tryTake } from ${JSON.stringify(pathToFileURL(MODULE).href)};
const r = tryTake('проба', 'держит', { file: ${JSON.stringify(file)}, env: {} });
console.log(JSON.stringify(r.lock ?? null));
${hold ? 'setInterval(() => {}, 1000);' : ''}`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  kids.push(child);
  const line = await new Promise<string>((resolve, reject) => {
    let out = '';
    child.stdout!.on('data', (b) => {
      out += String(b);
      if (out.includes('\n')) resolve(out.split('\n')[0]);
    });
    child.on('exit', () => resolve(out.split('\n')[0]));
    child.on('error', reject);
  });
  const rec = JSON.parse(line) as LockRecord;
  expect(rec?.pid, 'чужой процесс взял замок').toBe(child.pid);
  return { child, rec };
}

const exited = (child: ChildProcess): Promise<void> => new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', () => r())));

describe('замок машины', () => {
  it('взятый живым чужим — занят; взявший умер — замок снимается сам и берётся', async () => {
    const file = tempLock();
    const { child, rec } = await holder(file);
    const held = readLock(file) as LockRecord;
    expect(held).toMatchObject({ project: 'проба', task: 'держит', pid: child.pid });
    expect(Date.parse(held.started), 'минута взятия — время').not.toBeNaN();
    // Граница области: взявший жив — правило «мёртвый снимается» здесь ещё не спрашивается.
    expect(processExists(rec.pid)).toBe(true);
    const busy = tryTake('тест', 'ждёт', { file, env: {} });
    expect('held' in busy && !('broken' in busy.held) && busy.held.pid, 'живой чужой держит').toBe(child.pid);
    child.kill();
    await exited(child);
    expect(processExists(rec.pid), 'взявший умер').toBe(false);
    const env: NodeJS.ProcessEnv = {};
    const took = tryTake('тест', 'берёт', { file, env });
    expect('taken' in took, 'мёртвый замок снят и взят').toBe(true);
    expect((readLock(file) as LockRecord).pid).toBe(process.pid);
    expect(env[LOCK_ENV], 'отметка — потомкам').toBe(tokenOf(readLock(file) as LockRecord));
    if ('taken' in took) took.release();
    expect(existsSync(file), 'снят взявшим').toBe(false);
  }, 30_000);

  it('номер, доставшийся другому процессу, замок не держит: процесс родился позже замка', async () => {
    // Машина выключается посреди прогона, замок переживает перезагрузку, а номер уходит другому процессу.
    const file = tempLock();
    const { child } = await holder(file, true);
    const born = processBorn(child.pid!);
    expect(born, 'время рождения узнаётся').not.toBeNull();
    // Граница области: процесс с этим номером жив — иначе замок снимался бы и без второй проверки.
    expect(processExists(child.pid!)).toBe(true);
    const old = { project: 'проба', task: 'до перезагрузки', pid: child.pid!, started: new Date(born! - 60_000).toISOString() };
    writeFileSync(file, `${JSON.stringify(old)}\n`);
    const took = tryTake('тест', 'берёт', { file, env: {} });
    expect('taken' in took, 'замок старше процесса — мёртв').toBe(true);
    if ('taken' in took) took.release();
    // Обратное: запись моложе процесса — замок живой.
    const fresh = { ...old, task: 'держит', started: new Date(born! + 1000).toISOString() };
    writeFileSync(file, `${JSON.stringify(fresh)}\n`);
    const busy = tryTake('тест', 'ждёт', { file, env: {} });
    expect('held' in busy, 'запись моложе процесса — жив').toBe(true);
  }, 30_000);

  it('свой замок: отметка предка в окружении — не ждать; чужой без отметки — ждать', async () => {
    const file = tempLock();
    const { rec } = await holder(file);
    const ours = tryTake('тест', 'потомок', { file, env: { [LOCK_ENV]: tokenOf(rec) } });
    expect('ours' in ours, 'отметка предка — замок свой').toBe(true);
    const theirs = tryTake('тест', 'чужой', { file, env: { [LOCK_ENV]: '1@2000-01-01T00:00:00.000Z' } });
    expect('held' in theirs, 'чужая отметка — ждать').toBe(true);
    const kin = tryTake('тест', 'по цепочке', { file, env: {}, mine: (pid) => pid === rec.pid });
    expect('ours' in kin, 'предок по цепочке процессов — замок свой').toBe(true);
  }, 30_000);

  it('снимает только свой: запись другого взявшего остаётся', () => {
    const file = tempLock();
    const took = tryTake('тест', 'берёт', { file, env: {} });
    expect('taken' in took).toBe(true);
    if (!('taken' in took)) return;
    const other = { project: 'другой', task: 'держит', pid: took.lock.pid, started: new Date(Date.parse(took.lock.started) + 1).toISOString() };
    writeFileSync(file, `${JSON.stringify(other)}\n`);
    releaseLock(took.lock, file);
    expect(readLock(file), 'чужая запись не снята').toMatchObject({ task: 'держит' });
    releaseLock(other, file);
    expect(existsSync(file)).toBe(false);
  });

  it('ждущий дожидается и говорит, кого ждёт', async () => {
    const file = tempLock();
    const { child } = await holder(file);
    const said: string[] = [];
    setTimeout(() => child.kill(), 600);
    const release = await takeLock('тест', 'ждёт', { file, env: {}, pollMs: 100, say: (l) => said.push(l) });
    expect(said[0]).toMatch(/ждёт — замок машины: проба — держит, процесс \d+/);
    expect((readLock(file) as LockRecord).pid).toBe(process.pid);
    release();
    expect(existsSync(file)).toBe(false);
  }, 30_000);

  it('из командной строки: берёт, выполняет, снимает, отдаёт код команды', () => {
    const file = tempLock();
    const inner = `node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.env.HEAVY_JOB_LOCK_FILE,'utf8'));console.log(j.task+'|'+(process.env.HEAVY_JOB_LOCK===j.pid+'@'+j.started));process.exit(3)"`;
    const r = spawnSync(process.execPath, [MODULE, 'рендер', '--', inner], { encoding: 'utf8', env: { ...process.env, HEAVY_JOB_LOCK_FILE: file, [LOCK_ENV]: '' } });
    expect(r.stdout.trim(), 'команда шла под замком и с отметкой').toBe('рендер|true');
    expect(r.status, 'код команды').toBe(3);
    expect(existsSync(file), 'снят').toBe(false);
    const s = spawnSync(process.execPath, [MODULE, 'status'], { encoding: 'utf8', env: { ...process.env, HEAVY_JOB_LOCK_FILE: file } });
    expect(s.stdout).toMatch(/свободен/);
  }, 30_000);

  it('брошенная недописанная запись снимается, свежая — ждёт', () => {
    const file = tempLock();
    writeFileSync(file, '');
    const busy = tryTake('тест', 'ждёт', { file, env: {} });
    expect('held' in busy && 'broken' in busy.held, 'только что заведена — пишется').toBe(true);
    const old = new Date(Date.now() - 120_000);
    // Брошенная — старше полуминуты.
    spawnSync(process.execPath, ['-e', `require('fs').utimesSync(${JSON.stringify(file)}, new Date(${old.getTime()}), new Date(${old.getTime()}))`]);
    const took = tryTake('тест', 'берёт', { file, env: {} });
    expect('taken' in took, 'брошенная снята').toBe(true);
    if ('taken' in took) took.release();
  });
});
