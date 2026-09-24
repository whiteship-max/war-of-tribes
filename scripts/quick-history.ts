/**
 * Поймала бы быстрая приёмка прошлые сдвиги — проверка на истории (docs/realm.md, раздел 8).
 *
 *   npm run quick:history                 все пары из кэша: сдвиг полного прогона не больше 60 строк
 *   npm run quick:history -- --lines 500  порог сдвига пары
 *   npm run quick:history -- --only raid-growth
 *   npm run quick:history -- --plan       только срез и пары, без прогонов
 *
 * ПАРЫ — не список рукой, а кэш приёмки (`.git/tribe-reports`): для каждого отчёта с быстрым режимом берутся
 * его чистые прогоны (без незакоммиченного, код 0), по коммиту на замыкание, в порядке истории, и пара — два
 * соседних прогона, чей полный вывод разошёлся. Сдвиг в сотни строк быстрая видит заведомо; мерить надо малые —
 * поэтому по умолчанию пары с малым сдвигом.
 *
 * БЫСТРАЯ НА СТАРОМ КОДЕ. Старые отчёты быстрой двери не знают, и для проверки им подкладывается ровно её срез:
 * каждое `const X = fights('…', ПОЛНОЕ, БЫСТРОЕ)` и `worlds('…', [МИРЫ], k)` нынешних отчётов находится в старом
 * файле как `const X = ПОЛНОЕ;` и заменяется выбором по `TRIBE_QUICK`. Срез берётся из нынешних исходников, а
 * не пишется здесь второй раз. Не нашлось места в старом файле — пара так и помечается, а не гоняется наугад.
 *
 * ВЕРДИКТ по паре — тот же, что у приёмки: быстрый вывод на двух коммитах разошёлся — «поймала»; совпал, а
 * тронутый код быстрая не исполнила целиком (`lib/blind.ts`) — «слепа» (сказала бы «нужен полный»); совпал и
 * не слепа — «ПРОПУСТИЛА МОЛЧА». Последнее — нарушение обещания быстрой приёмки, и команда выходит кодом 1.
 * Слепота считается в обоих зёрнах покрытия на одних и тех же данных (по блокам — прогон пишет их, по функциям —
 * те же данные, прочитанные по функциям): так видно, что стоило бы зерно подешевле.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os, { availableParallelism } from 'node:os';
import path from 'node:path';
import { owners } from './lib/affected';
import { blindTo, collect, touches, transformer, type Seen } from './lib/blind';
import { measure, shifts } from './lib/measured';
import { lastSeconds, storeDir, type RunMeta } from './lib/runs';
import { ROOT, setupOf } from './lib/setup';
import { commitTree, git } from './lib/tree';

const argv = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const LINES = Number(arg('--lines') ?? 60);
const ONLY = arg('--only')?.split(',');

/** Отчёты с быстрым режимом — у кого в замыкании дверь быстрой приёмки. */
const QUICK_DOOR = 'scripts/lib/quick.ts';
const head = commitTree(ROOT, 'HEAD');
const quickable = owners(head, setupOf(head, []))
  .owners.filter((o) => o.kind === 'report' && o.closure.files.has(QUICK_DOOR))
  .map((o) => o.name)
  .filter((n) => !ONLY || ONLY.includes(n));

// ---------- Срез быстрой из нынешних исходников ----------

interface Cut {
  file: string;
  name: string;
  full: string;
  quick: string;
}

function cuts(): Cut[] {
  const out: Cut[] = [];
  for (const file of head.files.filter((f) => /^scripts\/[\w-]+\.ts$/.test(f))) {
    const text = head.read(file);
    for (const m of text.matchAll(/const (\w+) = fights\('[^']*', (.+), (\d+)\);/g)) out.push({ file, name: m[1], full: m[2], quick: m[3] });
    for (const m of text.matchAll(/const (\w+) = worlds\('[^']*', (\[[^\]]*\]), (\d+)\);/g)) out.push({ file, name: m[1], full: m[2], quick: `${m[2]}.slice(0, ${m[3]})` });
  }
  return out;
}

/** Подложить срез в старое дерево. Отдаёт то, что не легло. */
function patch(dir: string, list: Cut[]): string[] {
  const missed: string[] = [];
  for (const c of list) {
    const p = path.join(dir, c.file);
    if (!existsSync(p)) {
      missed.push(`${c.file}: нет файла`);
      continue;
    }
    const text = readFileSync(p, 'utf8');
    const re = new RegExp(`const ${c.name} = ${c.full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')};`);
    if (!re.test(text)) {
      missed.push(`${c.file}: нет «const ${c.name} = ${c.full};»`);
      continue;
    }
    writeFileSync(p, text.replace(re, `const ${c.name} = process.env.TRIBE_QUICK === '1' ? ${c.quick} : ${c.full};`));
  }
  return missed;
}

// ---------- Пары из кэша ----------

interface Pair {
  report: string;
  a: string;
  b: string;
  lines: number;
}

function pairs(): Pair[] {
  const order = git(ROOT, ['rev-list', '--abbrev-commit', '--abbrev=7', 'HEAD']).split('\n');
  const pos = (c: string): number => {
    const i = order.findIndex((x) => x.startsWith(c));
    return i < 0 ? Infinity : -i;
  };
  const out: Pair[] = [];
  for (const report of quickable) {
    const dir = path.join(storeDir(ROOT), report);
    if (!existsSync(dir)) continue;
    const runs: (RunMeta & { txt: string })[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json') || f.endsWith('.seen.json')) continue;
      const m = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as RunMeta;
      if (!m.dirty && m.exit === 0 && Number.isFinite(pos(m.commit))) runs.push({ ...m, txt: path.join(dir, f.replace(/\.json$/, '.txt')) });
    }
    const byKey = new Map<string, RunMeta & { txt: string }>();
    for (const r of runs) if (!byKey.has(r.key) || pos(r.commit) < pos(byKey.get(r.key)!.commit)) byKey.set(r.key, r);
    const list = [...byKey.values()].sort((x, y) => pos(x.commit) - pos(y.commit));
    for (let i = 1; i < list.length; i++) {
      const d = shifts(readFileSync(list[i - 1].txt, 'utf8'), readFileSync(list[i].txt, 'utf8')).length;
      if (d > 0 && d <= LINES) out.push({ report, a: list[i - 1].commit, b: list[i].commit, lines: d });
    }
  }
  return out;
}

// ---------- Прогоны ----------

interface Quick {
  output: string;
  /** Покрытие быстрой по блокам и то же покрытие, прочитанное по функциям (`blind.Grain`). */
  seen: Seen | null;
  byFunction: Seen | null;
  missed: string[];
  exit: number;
}

async function quickAt(commit: string, report: string, list: Cut[]): Promise<Quick> {
  const dir = mkdtempSync(path.join(os.tmpdir(), `tribe-qh-${commit}-${report}-`));
  rmSync(dir, { recursive: true, force: true });
  git(ROOT, ['worktree', 'add', '--detach', dir, commit]);
  const modules = path.join(dir, 'node_modules');
  const cov = mkdtempSync(path.join(os.tmpdir(), 'tribe-qh-cov-'));
  try {
    if (process.platform === 'win32') spawnSync('cmd', ['/c', 'mklink', '/J', modules, path.join(ROOT, 'node_modules')], { stdio: 'ignore' });
    else spawnSync('ln', ['-s', path.join(ROOT, 'node_modules'), modules]);
    const missed = patch(dir, list);
    const bin = path.join(ROOT, 'node_modules', 'vite-node', 'vite-node.mjs');
    const r = await new Promise<{ exit: number; output: string }>((resolve) => {
      const chunks: Buffer[] = [];
      const child = spawn(process.execPath, [bin, `scripts/${report}-report.ts`], {
        cwd: dir,
        env: { ...process.env, TRIBE_QUICK: '1', TRIBE_FAN: '1', NODE_V8_COVERAGE: cov, FORCE_COLOR: '0', NODE_OPTIONS: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (b: Buffer) => chunks.push(b));
      child.stderr.on('data', (b: Buffer) => chunks.push(b));
      child.on('close', (code) => resolve({ exit: code ?? 1, output: Buffer.concat(chunks).toString('utf8') }));
    });
    const tree = commitTree(ROOT, commit);
    const closure = owners(tree, setupOf(tree, [])).owners.find((o) => o.kind === 'report' && o.name === report)?.closure;
    const vite = transformer(dir);
    const code = closure ? new Set([...closure.files].filter((f) => /\.(ts|tsx|mts|js|mjs)$/.test(f))) : null;
    const seen = code ? await collect(cov, dir, code, vite.transform) : null;
    const byFunction = code ? await collect(cov, dir, code, vite.transform, 'function') : null;
    await vite.close();
    return { output: r.output, seen, byFunction, missed, exit: r.exit };
  } finally {
    rmSync(cov, { recursive: true, force: true });
    if (process.platform === 'win32') spawnSync('cmd', ['/c', 'rmdir', modules], { stdio: 'ignore' });
    else rmSync(modules, { force: true });
    git(ROOT, ['worktree', 'remove', '--force', dir]);
  }
}

async function main(): Promise<void> {
  const list = cuts();
  const todo = pairs();
  console.log(`Срез быстрой (из нынешних исходников): ${list.map((c) => `${c.name} ${c.full} → ${c.quick}`).join('; ')}.`);
  console.log(`Пар со сдвигом полного вывода от 1 до ${LINES} строк: ${todo.length}.`);
  for (const p of todo) console.log(`  ${p.report} ${p.a} → ${p.b}: полный сдвинулся на ${p.lines} стр.`);
  if (argv.includes('--plan')) return;
  // Тяжёлые — первыми: хвост проверки — самый долгий прогон.
  const jobs = [...new Set(todo.flatMap((p) => [`${p.a}|${p.report}`, `${p.b}|${p.report}`]))].sort((x, y) => lastSeconds(ROOT, y.split('|')[1]) - lastSeconds(ROOT, x.split('|')[1]));
  const done = new Map<string, Quick>();
  let next = 0;
  const width = Math.max(1, availableParallelism() - 1);
  const started = performance.now();
  await Promise.all(
    Array.from({ length: Math.min(width, jobs.length) }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        const [commit, report] = job.split('|');
        done.set(job, await quickAt(commit, report, list));
        console.log(`  быстрая ${report} на ${commit}: код ${done.get(job)!.exit}`);
      }
    }),
  );
  console.log('');
  console.log(' отчёт        пара                полный сдвиг  быстрая сдвиг  вердикт');
  let silent = 0;
  let silentFn = 0;
  for (const p of todo) {
    const qa = done.get(`${p.a}|${p.report}`)!;
    const qb = done.get(`${p.b}|${p.report}`)!;
    let verdict: string;
    let fast = '—';
    if (qa.missed.length || qb.missed.length) verdict = `срез не лёг: ${[...qa.missed, ...qb.missed].slice(0, 2).join('; ')}`;
    else if (qa.exit !== 0 || qb.exit !== 0) verdict = `быстрая упала (код ${qa.exit}/${qb.exit})`;
    else {
      const d = shifts(qa.output, qb.output).length;
      fast = String(d);
      if (d > 0) verdict = 'поймала';
      else {
        const tb = commitTree(ROOT, p.b);
        const ta = commitTree(ROOT, p.a);
        const closure = owners(tb, setupOf(tb, [])).owners.find((o) => o.kind === 'report' && o.name === p.report)!.closure;
        const diff = touches(git(ROOT, ['diff', '-U0', '--no-renames', p.a, p.b]));
        const read = (side: 'now' | 'was', f: string): string | null => {
          try {
            return (side === 'now' ? tb : ta).read(f);
          } catch {
            return null;
          }
        };
        const blind = qb.seen ? blindTo(diff, closure.files, qb.seen, qa.seen, read) : { spots: ['покрытия нет'] };
        const blindFn = qb.byFunction ? blindTo(diff, closure.files, qb.byFunction, qa.byFunction, read) : { spots: ['покрытия нет'] };
        const by = (b: { spots: string[] }): string => (b.spots.length > 0 ? `слепа (${b.spots.length} мест)` : 'ПРОПУСТИЛА МОЛЧА');
        verdict = `по блокам: ${by(blind)}; по функциям: ${by(blindFn)}${blind.spots[0] ? ` — ${blind.spots[0]}` : ''}`;
        if (blind.spots.length === 0) silent++;
        if (blindFn.spots.length === 0) silentFn++;
      }
    }
    console.log(` ${p.report.padEnd(11)}  ${`${p.a} → ${p.b}`.padEnd(18)}  ${String(p.lines).padStart(12)}  ${fast.padStart(13)}  ${verdict}`);
  }
  console.log('');
  console.log(`Пропущено молча: по блокам ${silent} из ${todo.length}, по функциям ${silentFn} из ${todo.length}. Прогонов быстрой: ${jobs.length}, ${measure(`${Math.round((performance.now() - started) / 1000)} с`)}.`);
  if (silent > 0) process.exitCode = 1;
}

await main();
