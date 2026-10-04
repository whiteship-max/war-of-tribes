import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_TOKEN, signInit, tempDir } from './testkit.js';

/**
 * Собранный сервер — тот самый файл, что ляжет в образ. Собирается тем же путём, что в
 * `Dockerfile` (`node netlify/vps/build.mjs <выход>`), поднимается отдельным процессом Node на
 * свободном порту и разговаривает по сети. Ловит то, чего не видят тесты исходников: модуль, не
 * попавший в сборку, `node:sqlite`, который сборщик попытался бы упаковать, импорт, который
 * работает в vitest и падает в голом Node.
 */
const ROOT = join(__dirname, '..', '..');
let dir: string;
let file: string;
let child: ChildProcess;
let base: string;
let log = '';

beforeAll(async () => {
  dir = tempDir('bundle');
  file = join(dir, 'server.mjs');
  const built = spawnSync(process.execPath, [join(ROOT, 'netlify', 'vps', 'build.mjs'), file], { cwd: ROOT, encoding: 'utf8' });
  expect(built.status, built.stderr).toBe(0);

  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', file, 'serve'], {
    env: { ...process.env, PORT: '0', TRIBE_DATA: join(dir, 'data'), TELEGRAM_BOT_TOKEN: TEST_TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`сервер не поднялся:\n${log}`)), 15_000);
    const take = (chunk: Buffer): void => {
      log += chunk.toString();
      const m = /слушаю порт (\d+)/.exec(log);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    };
    child.stdout!.on('data', take);
    child.stderr!.on('data', take);
    child.once('exit', (code) => reject(new Error(`сервер вышел с кодом ${code}:\n${log}`)));
  });
  base = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    const gone = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await gone;
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('собранный сервер', () => {
  it('один файл: снаружи только встроенное в Node', () => {
    const src = readFileSync(file, 'utf8');
    const imports = [...src.matchAll(/^import .* from "([^"]+)";$/gm)].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((i) => !i.startsWith('node:'))).toEqual([]);
    // SQLite — через require (`driver.ts`), и сборщик оставил его как есть.
    expect(src).toMatch(/\("node:sqlite"\)/);
  });

  it('поднимается, открывает базу, снимает первую копию', async () => {
    // Копия снимается сразу после того, как сервер начал слушать: её строка — следом.
    for (let i = 0; i < 50 && !/копия снята/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
    expect(log).toMatch(/хранилище: SQLite/);
    expect(log).toMatch(/копия снята: tribe-\d{4}-\d{2}-\d{2}-\d{4}\.sqlite/);
    expect(existsSync(join(dir, 'data', 'tribe.sqlite'))).toBe(true);
  });

  it('отвечает по договору: часы, подпись, запись и чтение сохранения', async () => {
    expect((await fetch(`${base}/api/time`)).status).toBe(200);
    expect((await fetch(`${base}/api/save`)).status).toBe(401);
    const auth = { 'x-telegram-init-data': signInit(9001, Math.floor(Date.now() / 1000) - 60) };
    const rec = { v: 1, rev: 0, updatedAt: 0, device: 'd', game: '{"pop":30}', world: null, card: {} };
    const put = await fetch(`${base}/api/save`, { method: 'PUT', headers: auth, body: JSON.stringify({ baseEtag: null, record: rec }) });
    expect(put.status).toBe(200);
    const got = (await (await fetch(`${base}/api/save`, { headers: auth })).json()) as { record: { game: string } };
    expect(got.record.game).toBe('{"pop":30}');
  });

  it('без токена бота не поднимается и говорит почему', () => {
    const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', file, 'serve'], {
      env: { ...process.env, PORT: '0', TRIBE_DATA: join(dir, 'empty'), TELEGRAM_BOT_TOKEN: '' },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/токен бота не задан/);
  });
});
