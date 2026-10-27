/**
 * Ночная приёмка на сервере (УС-2): весть владельцу и границы ночного скрипта. Весть — короткая, без значков, и «принят»
 * только когда всё зелёное и каждый отчёт совпал с базой той же машины; скрипт не выкладывает игру, не даёт контейнеру
 * ключей и не вешает на весть кнопок (задание владельца, docs/handbook/acceptance.md, «Ночная приёмка на сервере»).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNCAPPED } from '../lib/budget';
import { nightMessage, reportRows, testsOf, type Night } from './night-message.mjs';

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string): string => readFileSync(path.join(ROOT, f), 'utf8');

/** Итог `npm run reports` в том виде, в каком его печатает `scripts/reports.ts`. */
const reports = (rows: string[]): string =>
  ['━━━ map:report ━━━', 'кадр ‹12 мс›', '', '━━━ итог ━━━', ...rows, '  всего 3000 с настоящего времени (…), отчётов 3 из 23'].join('\n');
const row = (name: string, verdict: string, code = 'ок', read = 'чтение в замыкании'): string =>
  `  ${name.padEnd(9)} ${code.padEnd(7)} ${'120'.padStart(4)} с   ${read.padEnd(20)} ${verdict}`;

const green: Night['steps'] = ['ci', 'typecheck', 'test', 'build', 'reports'].map((step) => ({ step, code: 0, seconds: 60 }));
const night = (over: Partial<Night> = {}, mode = 'night'): Night => ({
  meta: { master: '1a2b3c4d5e', base: '27e7eea1aa', mode, started: '1000', ended: '7000' },
  steps: green,
  testLog: ' Test Files  495 passed | 3 skipped (498)\n',
  reportsLog: reports([row('battle', 'совпал с 8d14fe5'), row('map', 'совпал с 8d14fe5 (замыкание то же — это повтор)'), row('tap', 'совпал с 8d14fe5')]),
  pulse: '00:31:00\t0.051\t6\n00:32:00\t0.090\t6\n00:33:00\t0.047\t6\n',
  ...over,
});

describe('весть ночной приёмки', () => {
  it('итог отчётов читается строками reports.ts: имя, код, чтение, вердикт', () => {
    const rows = reportRows(reports([row('siege', 'СДВИНУЛСЯ против 8d14fe5: 4 стр.'), row('tap', '', 'КОД 1'), row('pop', 'совпал с 8d14fe5', 'ок', 'МИМО ЗАМЫКАНИЯ: 2')]))!;
    expect(rows.map((r) => [r.name, r.ok, r.missed])).toEqual([
      ['siege', true, false],
      ['tap', false, false],
      ['pop', true, true],
    ]);
    expect(rows[0].verdict).toBe('СДВИНУЛСЯ против 8d14fe5: 4 стр.');
  });

  it('всё зелёное и всё совпало — принят, база сдвигается на master', () => {
    const { text, accepted } = nightMessage(night());
    expect(accepted).toBe(true);
    expect(text).toContain('совпали 3 из 3');
    expect(text).toContain('Итог: принят, база теперь 1a2b3c4');
    expect(text).toContain('Время: 1 ч 40 мин');
    expect(text).toContain('/api/time до 0.09 с');
  });

  it('сдвиг, разошедшийся повтор, упавший отчёт и чтение мимо замыкания — не принят, и каждый назван', () => {
    const log = reports([
      row('siege', 'СДВИНУЛСЯ против 8d14fe5: 4 стр.'),
      row('map', 'совпал с 8d14fe5; ПОВТОР 8d14fe5 РАЗОШЁЛСЯ: 2 стр.'),
      row('tap', 'совпал с 8d14fe5', 'КОД 1'),
      row('pop', 'совпал с 8d14fe5', 'ок', 'МИМО ЗАМЫКАНИЯ: 1'),
      row('battle', 'совпал с 8d14fe5'),
    ]);
    const { text, accepted } = nightMessage(night({ reportsLog: log }));
    expect(accepted).toBe(false);
    expect(text).toContain('совпали 1 из 5');
    expect(text).toContain('сдвинулись: siege');
    expect(text).toContain('повтор разошёлся: map');
    expect(text).toContain('упали: tap');
    expect(text).toContain('чтение мимо замыкания: pop');
    expect(text).toContain('Итог: не принят, база прежняя 27e7eea');
  });

  it('красные тесты названы файлами, и с ними не принят даже при совпавших отчётах', () => {
    const testLog = ' FAIL  src/battle/wall.test.ts > стена > сид 7\n FAIL  src/battle/wall.test.ts > стена > сид 9\n FAIL  netlify/lib/war.test.ts > x\n Test Files  2 failed | 493 passed (495)\n';
    expect(testsOf(testLog).files).toEqual(['src/battle/wall.test.ts', 'netlify/lib/war.test.ts']);
    const steps = green.map((s) => (s.step === 'test' ? { ...s, code: 1 } : s));
    const { text, accepted } = nightMessage(night({ steps, testLog }));
    expect(accepted).toBe(false);
    expect(text).toContain('Тесты: КРАСНЫЕ 2 файл.: src/battle/wall.test.ts, netlify/lib/war.test.ts');
  });

  it('сборка не прошла — отчёты не шли, не принят', () => {
    const steps = green.filter((s) => s.step !== 'reports').map((s) => (s.step === 'build' ? { ...s, code: 2 } : s));
    const { text, accepted } = nightMessage(night({ steps, reportsLog: null }));
    expect(accepted).toBe(false);
    expect(text).toContain('Отчёты: не шли');
    expect(text).toContain('сборка КОД 2');
  });

  it('закладка базы: сравнивать не с чем — заложена, если каждый отчёт прошёл и читал своё', () => {
    const log = reports([row('battle', 'вывода базы нет (--before)'), row('tap', 'вывода базы нет (--before)')]);
    expect(nightMessage(night({ reportsLog: log }, 'seed'))).toMatchObject({ accepted: true });
    expect(nightMessage(night({ reportsLog: log }, 'seed')).text).toContain('база машины заложена на 1a2b3c4');
    // Тот же вывод обычной ночью — не принят: базы нет, и «совпал» не сказан ни разу.
    expect(nightMessage(night({ reportsLog: log })).accepted).toBe(false);
    const bad = reports([row('battle', 'вывода базы нет (--before)'), row('tap', '', 'КОД 1')]);
    expect(nightMessage(night({ reportsLog: bad }, 'seed')).text).toContain('не прошли: tap');
  });

  it('весть короткая и без значков: ни эмодзи, ни разметки', () => {
    const { text } = nightMessage(night());
    expect(text.split('\n').length).toBeLessThanOrEqual(10);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toMatch(/[*_`<>]/);
  });
});

describe('границы ночного скрипта', () => {
  const host = read('deploy/ci/night.sh');
  const code = host
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');

  it('игру не выкладывает: ни update.sh, ни docker compose', () => {
    expect(code).not.toMatch(/update\.sh|docker compose|docker-compose/);
  });

  it('контейнеру — только папка приёмки: ни .env игры, ни ~/tribe, ни токена', () => {
    const run = code.slice(code.indexOf('docker run -d'), code.indexOf('> /dev/null ||', code.indexOf('docker run -d')));
    expect(run).toContain('-v "$CI:$CI"');
    expect(run).not.toMatch(/--env-file|tribe\/\.env|TELEGRAM|ADMIN_IDS|HOME\/tribe/);
    expect(run).toMatch(/--cpus="\$cpus"/);
    expect(run).toMatch(/nice -n 19/);
  });

  it('весть уходит без кнопок и разметки', () => {
    expect(code).toContain('sendMessage');
    expect(code).not.toMatch(/reply_markup|inline_keyboard|parse_mode/);
  });

  it('по расписанию — только если master изменился и не чаще раза в сутки', () => {
    expect(code).toMatch(/\[ "\$master" = "\$\(cat "\$N\/last-checked"/);
    expect(code).toMatch(/-lt 72000 \]/);
    expect(code).toMatch(/line="30 1 \* \* \* /);
  });

  it('шаги в контейнере: пакеты, типы, тесты, сборка, все отчёты — по одному и в этом порядке', () => {
    const steps = [...read('deploy/ci/night-inner.sh').matchAll(/^step (\w+) (.+)$/gm)].map((m) => [m[1], m[2].replace(/\s*\|\|.*$/, '')]);
    expect(steps).toEqual([
      ['ci', 'npm ci --no-audit --no-fund'],
      ['typecheck', 'npm run typecheck'],
      ['test', 'npm test'],
      ['build', 'npm run build'],
      ['reports', 'npm run reports -- --all --base "$base" $before'],
    ]);
  });

  it('Chromium контейнера: WebGL программный, флаги отчёта — последними, потолок кадров не снят', () => {
    const wrap = read('deploy/ci/chromium.sh');
    expect(wrap).toContain('--use-angle=swiftshader');
    expect(wrap.trimEnd().endsWith('"$@"')).toBe(true);
    for (const flag of UNCAPPED) expect(wrap).not.toContain(flag);
  });

  it('образ контейнера — на Node из .nvmrc', () => {
    expect(read('deploy/ci/Dockerfile')).toMatch(new RegExp(`^FROM node:${read('.nvmrc').trim()}-bookworm$`, 'm'));
  });

  it('патч обычных правил трогает только временные множители теста и их утверждения', () => {
    const files = [...read('deploy/ci/normal-rules.patch').matchAll(/^diff --git a\/(\S+)/gm)].map((m) => m[1]);
    expect(files.sort()).toEqual(['netlify/lib/security.test.ts', 'netlify/lib/warfast.test.ts', 'src/game/armyfood.test.ts', 'src/game/constants.ts', 'src/world/data/tuning.ts']);
    const added = read('deploy/ci/normal-rules.patch')
      .split('\n')
      .filter((l) => /^\+[^+]/.test(l) && /^\+export const/.test(l));
    expect(added).toEqual(['+export const TEST_ARMY_FOOD: number = 1;', '+export const TEST_TRAVEL_SPEED = 1;']);
  });
});
