/**
 * Весть ночной приёмки (УС-2, docs/handbook/acceptance.md, «Ночная приёмка на сервере»): из логов одной ночи — короткий
 * текст владельцу в бот и вердикт «принят» или нет.
 *
 *   node scripts/ci/night-message.mjs <папка ночи>     пишет в неё message.txt и verdict
 *
 * Простой JS без пакетов, как `lib/machinelock.mjs`: его запускает `node` из копии ночных скриптов (`/opt/tribe-ci/night/bin`),
 * а не из проверяемого дерева — на коммите, где этого файла ещё нет, ночь всё равно должна дописать весть.
 *
 * Что лежит в папке ночи: `meta` (строки `ключ=значение` — пишет `deploy/ci/night.sh`), `summary.tsv` (шаг, код, секунды,
 * конец — пишет `deploy/ci/night-inner.sh`), логи шагов `test.log`, `reports.log`, отклик боевого `pulse.tsv` (время, секунды,
 * ядра контейнера).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Обязательные шаги ночи по порядку; `reports` идёт, только если сборка прошла. */
export const STEPS = ['ci', 'typecheck', 'test', 'build', 'reports'];

const STEP_WORD = { ci: 'пакеты', typecheck: 'типы', test: 'тесты', build: 'сборка', reports: 'отчёты' };

const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Строки итога `npm run reports` (`scripts/reports.ts`, «━━━ итог ━━━»): отчёт, код, секунды, чтение, вердикт. */
export function reportRows(log) {
  const lines = plain(log).split('\n');
  const at = lines.findIndex((l) => l.includes('━━━ итог ━━━'));
  if (at < 0) return null;
  const rows = [];
  for (const line of lines.slice(at + 1)) {
    const m = /^ {2}(\S+)\s+(ок|КОД -?\d+)\s+(\d+) с\s+(чтение в замыкании|МИМО ЗАМЫКАНИЯ: \d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    rows.push({ name: m[1], ok: m[2] === 'ок', seconds: Number(m[3]), missed: m[4] !== 'чтение в замыкании', verdict: m[5] });
  }
  return rows;
}

/** Совпал ли отчёт с базой: «совпал», и повтор того же замыкания (если был) не разошёлся. */
export const matched = (r) => r.ok && !r.missed && r.verdict.startsWith('совпал') && !r.verdict.includes('РАЗОШЁЛСЯ');

/** Красные файлы тестов из вывода vitest (`FAIL  путь > …`) и строка «Test Files …». */
export function testsOf(log) {
  const text = plain(log);
  const files = [...new Set([...text.matchAll(/^\s*FAIL\s+(\S+\.test\.tsx?)/gm)].map((m) => m[1]))];
  const total = /Test Files\s+(.+)$/m.exec(text)?.[1].trim() ?? null;
  return { files, total };
}

/** Секунды словами: «1 ч 42 мин», «18 мин», «40 с». */
export function span(sec) {
  const s = Math.round(sec);
  if (s < 60) return `${s} с`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${m % 60} мин`;
}

/** Отклик боевого за ночь: худший и средний по медиане замер, с какими ядрами начали и на чём кончили. */
export function pulseOf(tsv) {
  const rows = tsv
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((c) => c.length >= 3 && Number.isFinite(Number(c[1])))
    .map((c) => ({ t: Number(c[1]), cpus: Number(c[2]) }));
  if (rows.length === 0) return null;
  const ts = rows.map((r) => r.t).sort((a, b) => a - b);
  return { max: ts[ts.length - 1], median: ts[Math.floor(ts.length / 2)], first: rows[0].cpus, last: rows[rows.length - 1].cpus, n: rows.length };
}

/**
 * Весть и вердикт. Принят — только всё зелёное: каждый шаг с кодом 0 и каждый отчёт совпал с базой той же машины. Иначе
 * база остаётся прежней, и сдвиг разбирает человек (правило 9: маскировать сдвиг нельзя, принять его — решение).
 */
export function nightMessage({ meta, steps, testLog, reportsLog, pulse }) {
  const short = (sha) => (sha ?? '?').slice(0, 7);
  const code = new Map(steps.map((s) => [s.step, s]));
  const out = [`Ночная приёмка TRIBE: master ${short(meta.master)}, база ${short(meta.base)}`];

  const seed = meta.mode === 'seed';
  const rows = reportsLog ? reportRows(reportsLog) : null;
  const rep = code.get('reports');
  if (!rep) out.push('Отчёты: не шли (сборка не прошла)');
  else if (!rows || rows.length === 0) out.push(`Отчёты: итога нет, код ${rep.code}`);
  else if (seed) {
    // Закладка базы: сравнивать не с чем, важно только, что каждый прошёл и прочитал своё.
    const bad = rows.filter((r) => !r.ok || r.missed).map((r) => r.name);
    out.push(`Отчёты: прошли ${rows.length - bad.length} из ${rows.length}${bad.length ? `; не прошли: ${bad.join(', ')}` : ''}`);
  } else {
    const list = (pred) => rows.filter(pred).map((r) => r.name);
    const parts = [`совпали ${list(matched).length} из ${rows.length}`];
    const shifted = list((r) => r.verdict.includes('СДВИНУЛСЯ'));
    const diverged = list((r) => r.verdict.includes('РАЗОШЁЛСЯ'));
    const failed = list((r) => !r.ok);
    const missed = list((r) => r.missed);
    const noBase = list((r) => r.ok && !r.verdict.startsWith('совпал') && !r.verdict.includes('СДВИНУЛСЯ'));
    if (shifted.length) parts.push(`сдвинулись: ${shifted.join(', ')}`);
    if (diverged.length) parts.push(`повтор разошёлся: ${diverged.join(', ')}`);
    if (failed.length) parts.push(`упали: ${failed.join(', ')}`);
    if (missed.length) parts.push(`чтение мимо замыкания: ${missed.join(', ')}`);
    if (noBase.length) parts.push(`без базы: ${noBase.join(', ')}`);
    out.push(`Отчёты: ${parts.join('; ')}`);
  }

  const test = code.get('test');
  const t = testsOf(testLog ?? '');
  if (!test) out.push('Тесты: не шли');
  else if (test.code === 0) out.push(`Тесты: зелёные${t.total ? ` (${t.total})` : ''}`);
  else {
    const shown = t.files.slice(0, 5).join(', ');
    out.push(`Тесты: КРАСНЫЕ${t.files.length ? ` ${t.files.length} файл.: ${shown}${t.files.length > 5 ? ' и др.' : ''}` : `, код ${test.code}`}`);
  }

  const other = ['ci', 'typecheck', 'build'].map((s) => {
    const x = code.get(s);
    return `${STEP_WORD[s]} ${!x ? 'не шли' : x.code === 0 ? 'ок' : `КОД ${x.code}`}`;
  });
  out.push(`Пол: ${other.join(', ')}`);

  const floorSec = steps.filter((s) => s.step !== 'reports').reduce((a, s) => a + s.seconds, 0);
  const total = Number(meta.ended) - Number(meta.started);
  out.push(`Время: ${span(Number.isFinite(total) && total > 0 ? total : floorSec + (rep?.seconds ?? 0))} (пол ${span(floorSec)}, отчёты ${span(rep?.seconds ?? 0)})`);

  const p = pulse ? pulseOf(pulse) : null;
  if (p) out.push(`Боевой: /api/time до ${p.max.toFixed(2)} с, медиана ${p.median.toFixed(2)} с; ядер ${p.first}${p.last !== p.first ? ` → ${p.last}` : ''}`);

  const green = STEPS.every((s) => code.get(s)?.code === 0) && !!rows && rows.length > 0;
  const accepted = green && rows.every(seed ? (r) => r.ok && !r.missed : matched);
  if (seed) out.push(accepted ? `Итог: база машины заложена на ${short(meta.master)}` : 'Итог: база не заложена');
  else out.push(accepted ? `Итог: принят, база теперь ${short(meta.master)}` : `Итог: не принят, база прежняя ${short(meta.base)}`);
  if (meta.dir) out.push(`Лог: ${meta.dir}`);
  return { text: out.join('\n'), accepted };
}

/** Папка ночи → вход `nightMessage`. */
export function readNight(dir) {
  const read = (f) => (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), 'utf8') : null);
  const meta = Object.fromEntries(
    (read('meta') ?? '')
      .split('\n')
      .map((l) => /^(\w+)=(.*)$/.exec(l.trim()))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
  const steps = (read('summary.tsv') ?? '')
    .split('\n')
    .map((l) => l.split('\t'))
    .filter((c) => c.length >= 3)
    .map((c) => ({ step: c[0], code: Number(c[1]), seconds: Number(c[2]) }));
  return { meta: { dir, ...meta }, steps, testLog: read('test.log'), reportsLog: read('reports.log'), pulse: read('pulse.tsv') };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2];
  if (!dir) throw new Error('укажи папку ночи');
  const { text, accepted } = nightMessage(readNight(dir));
  writeFileSync(path.join(dir, 'message.txt'), `${text}\n`);
  writeFileSync(path.join(dir, 'verdict'), accepted ? 'принят\n' : 'не принят\n');
  console.log(text);
}
