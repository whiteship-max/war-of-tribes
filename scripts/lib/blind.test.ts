// Слепота быстрой приёмки (`blind.ts`): тронутая строка, которая на мирах быстрой не исполнилась целиком,
// обязана дать «слепа»; исполненная — нет. Проверяется на настоящем прогоне: фикстура выполняется под vite-node
// с покрытием V8, покрытие сопоставляется со строками тем же переводом vite, что у приёмки.
//
// Правило 11: область правила — строки кода модуля, загруженного прогоном. Каждая проверяемая строка найдена
// по тексту фикстуры, и утверждением проверено, что она код (у неё есть отрезок карты), а файл сопоставился.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ROOT } from './setup';
import { blindTo, collect, mappings, namesAt, touches, transformer, type Seen, type Touch } from './blind';
import { hook as coverHook } from './cover.mjs';

const FIXTURE = 'scripts/lib/blind-fixture.ts';
const text = readFileSync(path.join(ROOT, FIXTURE), 'utf8');
/** Номер строки фикстуры, начинающейся (после отступа) с `start`. */
const lineOf = (start: string): number => {
  const i = text.split('\n').findIndex((l) => l.trimStart().startsWith(start));
  if (i < 0) throw new Error(`в фикстуре нет строки «${start}»`);
  return i + 1;
};
const L = {
  rate: lineOf('export const RATE'),
  base: lineOf('export const BASE'),
  branch: lineOf('return n * 100'),
  ran: lineOf('return n + BASE'),
  unused: lineOf('return n * RATE'),
  call: lineOf('used(1)'),
};

let seen: Seen;
let byFunction: Seen;
let hooked: Seen;
let code: string;

beforeAll(async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tribe-blind-test-'));
  const bin = path.join(path.dirname(createRequire(import.meta.url).resolve('vite-node/package.json')), 'vite-node.mjs');
  const r = spawnSync(process.execPath, [bin, FIXTURE], { cwd: ROOT, env: { ...process.env, NODE_V8_COVERAGE: dir, NODE_OPTIONS: '' }, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`фикстура не выполнилась: ${r.stderr}`);
  // Тот же прогон с покрытием по функциям — путём быстрой приёмки: ловушкой `cover.mjs`.
  const fdir = mkdtempSync(path.join(os.tmpdir(), 'tribe-blind-fn-'));
  const f = spawnSync(process.execPath, [bin, FIXTURE], { cwd: ROOT, env: { ...process.env, TRIBE_COVER: fdir, NODE_OPTIONS: `--import=${coverHook}` }, encoding: 'utf8' });
  if (f.status !== 0) throw new Error(`фикстура с покрытием по функциям не выполнилась: ${f.stderr}`);
  const vite = transformer(ROOT);
  try {
    code = (await vite.transform(FIXTURE))!;
    seen = await collect(dir, ROOT, new Set([FIXTURE]), vite.transform);
    byFunction = await collect(dir, ROOT, new Set([FIXTURE]), vite.transform, 'function');
    hooked = await collect(fdir, ROOT, new Set([FIXTURE]), vite.transform, 'function');
  } finally {
    await vite.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(fdir, { recursive: true, force: true });
  }
}, 60_000);

afterAll(() => undefined);

/** Строки фикстуры, у которых есть отрезок карты, — строки кода. */
const codeLines = (): Set<number> => {
  const m = /base64,([A-Za-z0-9+/=]+)\s*$/.exec(code)!;
  const raw = (JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) as { mappings: string }).mappings;
  return new Set(mappings(raw).map(([, , sl]) => sl + 1));
};

const now = (file: string, lines: number[]): Touch => ({ file, was: [], now: lines });
const read = (): string => text;

describe('покрытие прогона сопоставляется со строками', () => {
  it('область: фикстура загружена и сопоставлена, проверяемые строки — код', () => {
    expect(seen.unknown).toEqual([]);
    expect(Object.keys(seen.files)).toEqual([FIXTURE]);
    const lines = codeLines();
    for (const [name, l] of Object.entries(L)) expect(lines.has(l), `${name}: строка ${l} — не код`).toBe(true);
  });

  it('неисполненная ветка и невызванная функция — тёмные, исполненные строки — нет', () => {
    const dark = seen.files[FIXTURE];
    expect(dark).toContain(L.branch);
    expect(dark).toContain(L.unused);
    expect(dark).not.toContain(L.ran);
    expect(dark).not.toContain(L.call);
    expect(dark).not.toContain(L.base);
  });
});

describe('зерно по функциям', () => {
  it('видит невызванную функцию и не видит не пройденной ветки вызванной — это его цена, и она названа', () => {
    const dark = byFunction.files[FIXTURE];
    expect(dark).toContain(L.unused);
    expect(dark).not.toContain(L.branch);
    expect(dark).not.toContain(L.ran);
  });

  it('ловушка cover.mjs пишет то же знание, что покрытие по блокам, прочитанное по функциям', () => {
    expect(hooked.unknown).toEqual([]);
    expect(hooked.files[FIXTURE]).toEqual(byFunction.files[FIXTURE]);
    expect(hooked.grain).toBe('function');
  });
});

describe('слепота к правке', () => {
  const closure = new Set([FIXTURE]);

  it('правка строки, не исполненной быстрой, — слепа, и строка названа', () => {
    const b = blindTo([now(FIXTURE, [L.branch])], closure, seen, seen, read);
    expect(b.spots).toEqual([`${FIXTURE}:${L.branch} — не исполнилась целиком`]);
  });

  it('правка исполненной строки — не слепа', () => {
    expect(blindTo([now(FIXTURE, [L.ran])], closure, seen, seen, read).spots).toEqual([]);
  });

  it('правка числа, которое читает только неисполненный код, — слепа: строка числа исполняется, а читатель — нет', () => {
    const b = blindTo([now(FIXTURE, [L.rate])], closure, seen, seen, read);
    expect(b.spots).toHaveLength(1);
    expect(b.spots[0]).toContain(`«RATE» читают строки, не исполненные целиком: ${FIXTURE}:${L.unused}`);
  });

  it('правка числа, которое читает исполненный код, — не слепа', () => {
    expect(blindTo([now(FIXTURE, [L.base])], closure, seen, seen, read).spots).toEqual([]);
  });

  it('строки базы без покрытия базы — слепа: о них быстрая не знает ничего', () => {
    const b = blindTo([{ file: FIXTURE, was: [L.ran], now: [] }], closure, seen, null, read);
    expect(b.spots[0]).toMatch(/покрытия быстрой на базе нет/);
  });

  it('файл вне замыкания отчёта — не его дело; файл не кода в замыкании — слепа', () => {
    expect(blindTo([now('src/other.ts', [1])], closure, seen, seen, read).spots).toEqual([]);
    const b = blindTo([now('data.json', [1])], new Set([FIXTURE, 'data.json']), seen, seen, read);
    expect(b.spots).toEqual(['data.json — не код: покрытие о нём не говорит']);
  });

  it('несопоставленный файл — слепа', () => {
    const b = blindTo([now(FIXTURE, [L.ran])], closure, { files: {}, unknown: [FIXTURE] }, seen, read);
    expect(b.spots[0]).toMatch(/не сопоставилось/);
  });
});

describe('разбор правки и объявлений', () => {
  it('git diff -U0: заменённые, вставленные и удалённые строки с обеих сторон', () => {
    const diff = ['diff --git a/x.ts b/x.ts', '@@ -3,2 +3,3 @@', '-a', '-b', '+a', '+b', '+c', '@@ -10 +11,0 @@', '-gone', '@@ -20,0 +21,2 @@', '+new', '+new'].join('\n');
    expect(touches(diff)).toEqual([{ file: 'x.ts', was: [3, 4, 10, 20], now: [3, 4, 5, 11, 21, 22] }]);
  });

  it('строка в теле функции ничего не объявляет, строка верхнего уровня — своё имя и ключ таблицы', () => {
    expect(namesAt(text, FIXTURE, L.ran)).toEqual({ inFunction: true, names: [] });
    expect(namesAt(text, FIXTURE, L.rate)).toEqual({ inFunction: false, names: ['RATE'] });
    const table = ['export const T = {', '  alpha: 1,', '  beta: { gamma: 2 },', '};'].join('\n');
    expect(namesAt(table, 't.ts', 2).names.sort()).toEqual(['T', 'alpha']);
    expect(namesAt(table, 't.ts', 3).names.sort()).toEqual(['T', 'beta', 'gamma']);
  });
});
