import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_TOKEN, signInit, tempDir } from './testkit.js';
import { openDb, sqliteStores } from './sqlite.js';
import { STORES } from '../lib/kv.js';
import { ROSTER_KEY, emptyRoster } from '../lib/roster.js';
import type { BandRow, OddsResponse, RosterFile } from '../lib/contract.js';
import { roamSeat } from '../../src/world/roam.js';
import { SPAWNS } from '../../src/world/spawn.js';
import { freeId } from '../../src/world/freecastle.js';

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

/** Окно замка (ПН-Э2г): админ с отрядом у стен вольного замка пула — реестр кладётся в базу до подъёма сервера. */
const ODDS_ADMIN = 9002;
const C = SPAWNS[5];
const FREE = freeId(C.x, C.y);
/** Отряд в 260 чел. — как в замере окна в Chromium (ГДД 23.9.7). */
const ODDS_BAND = { spearman: 160, archer: 60, clubman: 40 };

beforeAll(async () => {
  dir = tempDir('bundle');
  file = join(dir, 'server.mjs');
  const built = spawnSync(process.execPath, [join(ROOT, 'netlify', 'vps', 'build.mjs'), file], { cwd: ROOT, encoding: 'utf8' });
  expect(built.status, built.stderr).toBe(0);

  mkdirSync(join(dir, 'data'), { recursive: true });
  const db = openDb(join(dir, 'data', 'tribe.sqlite'));
  const t0 = Date.now() - 3_600_000;
  const row: BandRow = { way: roamSeat({ x: C.x + 1, y: C.y }, t0).way, born: t0, name: 'Ватага', prestige: 1000, men: 260, seenAt: t0, book: { troops: ODDS_BAND, join: -1, drill: 0, fights: 0, grant: 0, keys: [] } };
  const roster: RosterFile = { ...emptyRoster(), bands: { [`tg-${ODDS_ADMIN}`]: row }, free: { [FREE]: { x: C.x, y: C.y, tier: 1, born: t0 } } };
  await sqliteStores(db)(STORES.world, 'strong').setJSON(ROSTER_KEY, roster);
  db.close();

  child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', file, 'serve'], {
    env: { ...process.env, PORT: '0', TRIBE_DATA: join(dir, 'data'), TELEGRAM_BOT_TOKEN: TEST_TOKEN, ADMIN_IDS: String(ODDS_ADMIN) },
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

  it('шанс окна замка (ПН-Э2г): считает поток сервера, ответ — строки; повтор — из кэша сразу', async () => {
    const auth = { 'x-telegram-init-data': signInit(ODDS_ADMIN, Math.floor(Date.now() / 1000) - 60) };
    const url = `${base}/api/odds?castle=${encodeURIComponent(FREE)}`;
    expect((await fetch(url, { headers: { 'x-telegram-init-data': signInit(9003, Math.floor(Date.now() / 1000) - 60) } })).status, 'не-админу — 403').toBe(403);
    const start = Date.now();
    let got: OddsResponse = { now: 0, wait: true };
    let polls = 0;
    while (got.wait && Date.now() - start < 90_000) {
      if (polls++ > 0) await new Promise((r) => setTimeout(r, 500));
      const res = await fetch(url, { headers: auth });
      expect(res.status).toBe(200);
      got = (await res.json()) as OddsResponse;
    }
    const spent = Date.now() - start;
    expect(got.error, log).toBeUndefined();
    expect(got.rows?.map((r) => r.text).join('\n')).toMatch(/Штурм с ходу[\s\S]*Измор/);
    const again = Date.now();
    const cached = (await (await fetch(url, { headers: auth })).json()) as OddsResponse;
    const hit = Date.now() - again;
    expect(cached.rows).toEqual(got.rows);
    // Замер (правило 12 — этот тест): время расчёта окна на собранном сервере, отряд в 260 чел. у стен замка I.
    console.log(`шанс окна замка на собранном сервере: ${(spent / 1000).toFixed(1)} с (${polls} запросов), повтор из кэша — ${hit} мс`);
  }, 120_000);

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
