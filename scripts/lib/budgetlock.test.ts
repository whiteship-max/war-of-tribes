/**
 * Чужой замок машины — занятая машина (бюджет железа, `budget.foreignRuns`): рендер другого проекта, взявший
 * `~/.heavy-job.lock`, держит приёмку и браузерные отчёты этого, даже если его процессы не похожи на тяжёлые. Замок
 * здесь — во временном файле (`HEAVY_JOB_LOCK_FILE`), держит его чужой процесс — не потомок теста: потомки свои.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';

const MODULE = pathToFileURL(join(__dirname, 'machinelock.mjs')).href;
let dir = '';
let orphan = 0;

afterEach(() => {
  if (orphan) {
    try {
      process.kill(orphan);
    } catch {
      // уже вышел
    }
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

/** Чужой держатель: промежуточный процесс заводит его отвязанным и выходит, и держатель теряет родителя — он не наш. */
function foreignHolder(file: string): number {
  const hold = `import { tryTake } from ${JSON.stringify(MODULE)}; tryTake('проба', 'держит', { file: ${JSON.stringify(file)}, env: {} }); setInterval(() => {}, 1000);`;
  const launch = `const { spawn } = require('node:child_process');
const c = spawn(process.execPath, ['--input-type=module', '-e', ${JSON.stringify(hold)}], { detached: true, stdio: 'ignore' });
c.unref(); console.log(c.pid);`;
  const r = spawnSync(process.execPath, ['-e', launch], { encoding: 'utf8' });
  return Number(r.stdout.trim());
}

it('чужой живой замок — машина занята; взявший умер — свободна', async () => {
  dir = mkdtempSync(join(tmpdir(), 'heavy-lock-'));
  const file = join(dir, '.heavy-job.lock');
  vi.stubEnv('HEAVY_JOB_LOCK_FILE', file);
  vi.stubEnv('HEAVY_JOB_LOCK', '');
  vi.resetModules();
  const { foreignRuns } = await import('./budget');
  const { readLock } = await import('./machinelock.mjs');
  orphan = foreignHolder(file);
  for (let i = 0; i < 100 && !readLock(file); i++) await new Promise((r) => setTimeout(r, 100));
  // Граница области: замок держит живой чужой процесс — правило «чужой замок — занято» спрашивается.
  expect(readLock(file), 'чужой взял замок').toMatchObject({ task: 'держит', pid: orphan });
  const busy = foreignRuns({ browsers: false, runs: false });
  expect(busy.some((l) => /замок машины: проба — держит/.test(l)), busy.join('; ')).toBe(true);
  process.kill(orphan);
  orphan = 0;
  await new Promise((r) => setTimeout(r, 500));
  const free = foreignRuns({ browsers: false, runs: false });
  expect(free.some((l) => /замок машины/.test(l)), 'мёртвый замок машину не держит').toBe(false);
}, 60_000);
