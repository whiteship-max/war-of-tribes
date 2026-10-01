/**
 * Приёмка отчётами: какие гнать, прогон, сверка с прежним выводом.
 *
 *   npm run reports                  план от origin/master, прогон выбранных, сверка с базой
 *   npm run reports -- --plan        только план: что выбрано и почему, ничего не гоняет
 *   npm run reports -- --all         все отчёты, без выбора
 *   npm run reports -- --only a,b    только названные (к выбору не прибавляет и не сверяет план)
 *   npm run reports -- --base <rev>  от чего считать изменения (по умолчанию origin/master)
 *   npm run reports -- --before      прогнать базу во втором worktree, если её вывода нет
 *   npm run reports -- --at <rev>    план для коммита против родителя (проверка на истории)
 *
 * Как выбирается набор — `lib/affected.ts`; как считается замыкание — `lib/deps.ts`; где
 * лежат выводы и как прогон записывает прочитанное — `lib/runs.ts`; что в выводе замер,
 * а что обязано совпасть, — `lib/measured.ts`.
 *
 * Код возврата ненулевой, если хоть один отчёт упал или прочитал файл мимо своего
 * замыкания: второе значит, что подсчёт ошибся, и выбору на нём больше верить нельзя.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import os, { availableParallelism } from 'node:os';
import path from 'node:path';
import { owners, plan, type Owner, type Plan } from './lib/affected';
import { measure, shifts, stableLines } from './lib/measured';
import { closureKey, lastSeconds, load, runTraced, save, unexplained } from './lib/runs';
import { serveSlots, takeSlot } from './lib/slots';
import { budgetCores, coolDown, holdMachine, waitUntilFree } from './lib/budget';
import { ROOT, changedSince, lines, own, setupOf } from './lib/setup';
import { commitTree, git, worktree, type Tree } from './lib/tree';

/** Входы самого подсчёта: этот файл, а через его импорты — всё, чем он считает. */
const SELECTOR = [own(import.meta.url)];

/** Веер прогонов: отчёт, в чьём замыкании он лежит, считает дочерними процессами (`lib/fan.ts`). */
const FAN = own(new URL('./lib/fan.ts', import.meta.url).href);

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(name);
const arg = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

export function printPlan(p: Plan, head: string): void {
  console.log(head);
  if (p.full) {
    const shown = p.why.slice(0, 12);
    console.log(`  ВСЕ ${p.all.length} — ${shown.join('\n    ')}${p.why.length > 12 ? `\n    …и ещё ${p.why.length - 12}` : ''}`);
  } else if (p.reports.length === 0) {
    console.log('  отчёты не нужны');
  } else {
    for (const r of p.reports) console.log(`  ${r.name.padEnd(9)} ← ${r.by.slice(0, 4).join(', ')}${r.by.length > 4 ? ` и ещё ${r.by.length - 4}` : ''}`);
    console.log(`  пропущены: ${p.all.filter((n) => !p.reports.some((r) => r.name === n)).join(' ') || '—'}`);
  }
  if (!p.full && p.quiet.length > 0) console.log(`  без отчётов: ${p.quiet.map((q) => `${q.file} (${q.owner})`).join(', ')}`);
}

/**
 * Собрано ли то, что лежит в папке сборки, из нынешних файлов. Проверка по времени правки:
 * файл из замыкания сборки, правленный после неё, — и отчёт мерил бы вчерашний `dist`.
 */
function staleBuild(tree: Tree, build: Owner | undefined, outDir: string): string | null {
  const index = path.join(ROOT, outDir, 'index.html');
  if (!existsSync(index)) return `нет ${outDir}/ — сначала npm run build`;
  if (!build) return 'в package.json нет команды build';
  const built = statSync(index).mtimeMs;
  const known = new Set(tree.files);
  const newer = [...build.closure.files].filter((f) => known.has(f) && statSync(path.join(ROOT, f)).mtimeMs > built);
  if (newer.length === 0) return null;
  return `${outDir}/ собран раньше, чем правились ${newer.slice(0, 3).join(', ')}${newer.length > 3 ? ` и ещё ${newer.length - 3}` : ''} — сначала npm run build`;
}

interface Row {
  name: string;
  seconds: number;
  exit: number;
  missed: string[];
  verdict: string;
}

/** База во втором worktree: те отчёты, чьего вывода «до» нет, гонятся на ней и ложатся в кэш. */
async function runBase(base: string, names: string[]): Promise<void> {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tribe-base-'));
  rmSync(dir, { recursive: true, force: true });
  console.log(`\nбаза ${base}: второй worktree ${dir}`);
  git(ROOT, ['worktree', 'add', '--detach', dir, base]);
  const modules = path.join(dir, 'node_modules');
  try {
    // Пакеты общие: ссылка на папку, а не установка. На Windows — junction, ему не нужны права.
    if (process.platform === 'win32') spawnSync('cmd', ['/c', 'mklink', '/J', modules, path.join(ROOT, 'node_modules')], { stdio: 'ignore' });
    else spawnSync('ln', ['-s', path.join(ROOT, 'node_modules'), modules]);
    const tree = commitTree(ROOT, base);
    const baseSetup = setupOf(tree, []);
    const found = owners(tree, baseSetup).owners;
    // Бюджет железа и на базе: код базы может быть старше правила, и веер без `TRIBE_FAN` взял бы там
    // все ядра; браузерные — с паузой, как в своём прогоне.
    const baseEnv = { TRIBE_FAN: String(budgetCores()) };
    let ranBefore = false;
    const needsBuild = names.some((n) => found.find((o) => o.name === n)?.closure.built);
    if (needsBuild) {
      console.log('база: сборка');
      const b = await runTraced(dir, 'npm run --silent build', path.join(dir, '.build.trace'), true, { VIPS_CONCURRENCY: String(budgetCores()) });
      if (b.exit !== 0) throw new Error(`сборка базы упала:\n${b.output.slice(-2000)}`);
    }
    for (const name of names) {
      const o = found.find((x) => x.name === name);
      if (!o) continue;
      if (ranBefore && o.closure.files.has(baseSetup.vite.html)) await coolDown(`базой ${name}`);
      ranBefore = true;
      process.stdout.write(`база: ${name}…`);
      const r = await runTraced(dir, `npm run --silent ${name}:report`, path.join(dir, `.${name}.trace`), true, baseEnv);
      console.log(` ${r.exit === 0 ? 'ок' : `код ${r.exit}`}, ${r.seconds.toFixed(0)} с`);
      save(ROOT, {
        meta: { report: name, key: closureKey(name, tree, o.closure), commit: tree.label, dirty: false, exit: r.exit, seconds: r.seconds, at: new Date().toISOString(), node: process.version },
        output: r.output,
      });
    }
  } finally {
    if (process.platform === 'win32') spawnSync('cmd', ['/c', 'rmdir', modules], { stdio: 'ignore' });
    else rmSync(modules, { force: true });
    git(ROOT, ['worktree', 'remove', '--force', dir]);
  }
}

async function main(): Promise<void> {
  const at = arg('--at');
  if (at) {
    const tree = commitTree(ROOT, at);
    const changed = lines(git(ROOT, ['diff', '--name-only', '--no-renames', `${at}^`, at]));
    // Подсчёта в прошлых коммитах не было, и спрашивать «не изменился ли он» там не о чем.
    printPlan(plan(tree, changed, setupOf(tree, [])), `${tree.label} против родителя`);
    return;
  }

  const base = arg('--base') ?? 'origin/master';
  const tree = worktree(ROOT);
  const setup = setupOf(tree, SELECTOR);
  let changed: string[] = [];
  let baseOk = true;
  try {
    changed = changedSince(base);
  } catch (e) {
    baseOk = false;
    console.log(`база ${base} не читается: ${(e as Error).message}`);
  }
  let p = plan(tree, changed, setup);
  if (flag('--all') || !baseOk) {
    p = { ...p, full: true, why: [flag('--all') ? 'попросили все' : `база ${base} не читается`], reports: p.all.map((name) => ({ name, by: [] })) };
  }
  const only = arg('--only');
  if (only) {
    const want = only.split(',').map((x) => x.trim());
    const unknown = want.filter((n) => !p.all.includes(n));
    if (unknown.length > 0) throw new Error(`нет таких отчётов: ${unknown.join(', ')}`);
    p = { ...p, full: false, why: [], reports: p.all.filter((n) => want.includes(n)).map((name) => ({ name, by: ['попросили'] })) };
  }
  printPlan(p, `рабочая копия против ${base}`);
  if (flag('--plan') || p.reports.length === 0) return;

  const found = p.owners.length > 0 ? p.owners : owners(tree, setup).owners;
  const byName = new Map(found.filter((o) => o.kind !== 'tests' && o.kind !== 'selector').map((o) => [o.name, o]));
  const selected = p.reports.map((r) => found.find((o) => o.kind === 'report' && o.name === r.name)).filter((o): o is Owner => !!o);
  if (selected.length !== p.reports.length) {
    console.error('\nзамыкания отчётов не посчитались — гнать нечем');
    process.exitCode = 1;
    return;
  }

  if (selected.some((o) => o.closure.built)) {
    const stale = staleBuild(tree, byName.get('build'), setup.vite.outDir);
    if (stale) {
      console.error(`\n${stale}`);
      process.exitCode = 1;
      return;
    }
  }

  // Бюджет железа (CLAUDE.md): приёмка — прогон, и прогоны идут по одному и только на свободной машине. Чужой рендер,
  // ffmpeg, сборка, прогон отчётов или тестов, стендовый браузер, чужой замок машины или чужая загрузка выше четверти
  // машины — приёмка ждёт, а не начинается и не падает (решение владельца, 29.09.2026): ни база, ни своё. Дождалась —
  // берёт замок машины (`~/.heavy-job.lock`, общий с другими проектами) и держит его до конца: отчёты, веер, сборка
  // базы и браузер — её потомки, замок им свой.
  await holdMachine('Приёмка отчётами', { load: true });

  // Вывод «до» ищется под отпечатком замыкания отчёта на базе.
  let baseKeys = new Map<string, string>();
  if (baseOk) {
    try {
      const bt = commitTree(ROOT, base);
      const bo = owners(bt, setupOf(bt, [])).owners;
      baseKeys = new Map(bo.filter((o) => o.kind === 'report').map((o) => [o.name, closureKey(o.name, bt, o.closure)]));
      if (flag('--before')) {
        const missing = selected.map((o) => o.name).filter((n) => baseKeys.has(n) && !load(ROOT, n, baseKeys.get(n)!));
        if (missing.length > 0) await runBase(base, missing);
      }
    } catch (e) {
      console.log(`вывод базы искать не по чему: ${(e as Error).message}`);
    }
  }

  const head = git(ROOT, ['rev-parse', '--short', 'HEAD']).trim();
  const dirtyFiles = new Set([...lines(git(ROOT, ['diff', '--name-only', 'HEAD'])), ...lines(git(ROOT, ['ls-files', '--others', '--exclude-standard']))]);
  const rows: Row[] = [];
  const started = performance.now();

  /** Прогон одного отчёта, запись в кэш и сверка. `quiet` — вывод печатается целиком по окончании, а не по ходу. */
  const job = async (o: Owner, quiet: boolean, env: Record<string, string>): Promise<void> => {
    const title = `━━━ ${o.name}:report ━━━`;
    if (!quiet) console.log(`\n${title}`);
    const key = closureKey(o.name, tree, o.closure);
    // Прошлый прогон того же замыкания — если он есть, это повтор, и совпасть он обязан. И вывод базы, и он
    // читаются ДО записи нынешнего: у отчёта, чьё замыкание с базы не менялось, ключ базы — тот же, и прочитанная
    // после записи «база» была бы этим же прогоном — сверка с собой. Так было до 25.09.2026: «совпал с базой
    // (замыкание то же — это повтор)» печаталось, не сравнив ничего.
    const prev = load(ROOT, o.name, key);
    const bk = baseKeys.get(o.name);
    const before = bk ? load(ROOT, o.name, bk) : null;
    const r = await runTraced(ROOT, `npm run --silent ${o.name}:report`, path.join(os.tmpdir(), `tribe-${o.name}.trace`), quiet, env);
    if (quiet) process.stdout.write(`\n${title}\n${r.output}`);
    const missed = unexplained(r.read, o.closure, setup.vite.outDir, tree);
    save(ROOT, {
      meta: {
        report: o.name,
        key,
        commit: head,
        dirty: [...o.closure.files].some((f) => dirtyFiles.has(f)),
        exit: r.exit,
        seconds: r.seconds,
        at: new Date().toISOString(),
        node: process.version,
      },
      output: r.output,
    });

    let verdict: string;
    if (!bk) verdict = 'в базе отчёта нет';
    else if (!before) verdict = 'вывода базы нет (--before)';
    else if (stableLines(before.output).length === 0) verdict = `у базы ${before.meta.commit} пустой вывод`;
    else {
      const d = shifts(before.output, r.output);
      const same = bk === key ? ' (замыкание то же — это повтор)' : '';
      verdict = d.length === 0 ? `совпал с ${before.meta.commit}${same}` : `СДВИНУЛСЯ против ${before.meta.commit}: ${d.length} стр.${same}`;
      if (d.length > 0) {
        const out = [`\n  ${o.name}: сдвиг против ${before.meta.commit} (строки без замеров; «−» было, «+» стало):`];
        for (const s of d.slice(0, 40)) out.push(s.before ? `  − ${s.was}` : `  + ${s.now}`);
        if (d.length > 40) out.push(`  …и ещё ${d.length - 40}`);
        console.log(out.join('\n'));
      }
    }
    if (prev && bk !== key) {
      const d = shifts(prev.output, r.output);
      verdict += d.length === 0 ? `; повтор ${prev.meta.commit} совпал` : `; ПОВТОР ${prev.meta.commit} РАЗОШЁЛСЯ: ${d.length} стр.`;
      if (d.length > 0) {
        const out = [`\n  ${o.name}: расхождение с прошлым прогоном того же замыкания (${prev.meta.at}):`];
        for (const x of d.slice(0, 20)) out.push(x.before ? `  − ${x.was}` : `  + ${x.now}`);
        console.log(out.join('\n'));
      }
    }
    rows.push({ name: o.name, seconds: r.seconds, exit: r.exit, missed, verdict });
    if (missed.length > 0) console.log(`\n  ${o.name}: ПРОЧИТАНО МИМО ЗАМЫКАНИЯ: ${missed.join(', ')}`);
  };

  // РАСПИСАНИЕ. Браузерные отчёты — те, кто отдаёт страницу (`index.html` в замыкании), — идут по одному и
  // последними, когда машина уже стоит: они меряют настоящим временем, и чужая нагрузка исказила бы не только
  // замеры в ‹…›, но и то, успел ли палец. Счётные идут разом: выводы их — функция кода и сида, и нагрузка их не
  // трогает (проверено приёмкой: вывод совпал с последовательным). Ядра делит один счётчик жетонов (`lib/slots.ts`):
  // жетон берёт каждый счётный отчёт без веера и каждый дочерний процесс веера; у отчёта с веером
  // (`lib/fan.ts` в замыкании) главный процесс берёт свой жетон сам, пока считает сам, и отдаёт его на время веера —
  // такие начинаются все сразу, и в общую очередь жетонов встают и они, и их дочерние; мимо жетонов не считает никто.
  // Тяжёлые — первыми: хвост приёмки — самый долгий отчёт. Сколько ядер в среднем было занято, итог печатает замером.
  // Ядер у жетонов — доля машины из бюджета (`lib/budget.ts`, `budgetCores`): машина владельца — не сервер, и прогон не
  // занимает её целиком. Пока идёт
  // приёмка, чужая тяжёлая работа могла начаться рядом: новый отчёт перед стартом ждёт, пока она кончится
  // (`nextFree`), — начатые идут до конца.
  const cores = availableParallelism();
  const width = budgetCores(cores);
  const browser = (o: Owner): boolean => o.closure.files.has(setup.vite.html);
  const fans = (o: Owner): boolean => o.closure.files.has(FAN);
  const cost = new Map(selected.map((o) => [o.name, lastSeconds(ROOT, o.name)]));
  const counting = selected.filter((o) => !browser(o)).sort((a, b) => cost.get(b.name)! - cost.get(a.name)!);
  const slots = await serveSlots(width);
  const env = { ...slots.env, TRIBE_FAN: String(width) };
  // Одна проверка на всех, не чаще раза в полминуты: список процессов стоит секунды процессора.
  let checked = -Infinity;
  let checking: Promise<void> | null = null;
  const nextFree = async (): Promise<void> => {
    if (performance.now() - checked < 30_000) return;
    checking ??= waitUntilFree('Следующий отчёт приёмки').then(() => {
      checked = performance.now();
      checking = null;
    });
    await checking;
  };
  const pool = async (list: Owner[], width: number, token: boolean): Promise<void> => {
    let i = 0;
    await Promise.all(
      Array.from({ length: Math.min(width, list.length) }, async () => {
        while (i < list.length) {
          await nextFree();
          if (i >= list.length) break;
          const o = list[i++];
          const slot = token ? await takeSlot(slots.env) : null;
          try {
            await job(o, true, env);
          } finally {
            slot?.release();
          }
        }
      }),
    );
  };
  let busy = '';
  const countingFrom = performance.now();
  try {
    await Promise.all([pool(counting.filter(fans), counting.length, false), pool(counting.filter((o) => !fans(o)), width, true)]);
  } finally {
    if (counting.length > 0) busy = `счётные ${measure(`${Math.round((performance.now() - countingFrom) / 1000)} с`)}, заняты в среднем ${measure(slots.busy().toFixed(1))} ядра из ${width}; `;
    await slots.close();
  }
  // Браузерные — тяжёлые: строго по одному, и перед каждым пауза и проверка свободной машины (бюджет железа).
  // Двухминутный потолок стенда сцены к ним не относится: штатный отчёт идёт столько, сколько идёт.
  for (const [i, o] of selected.filter(browser).entries()) {
    if (i > 0 || counting.length > 0) await coolDown(o.name);
    // Свои счётные кончились — машина обязана быть свободной и по загрузке: браузерные меряют настоящим временем.
    await waitUntilFree(o.name, { load: true });
    await job(o, false, { TRIBE_FAN: '1' });
  }
  const order = selected.map((o) => o.name);
  rows.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

  console.log('\n━━━ итог ━━━');
  for (const row of rows) {
    const code = row.exit === 0 ? 'ок' : `КОД ${row.exit}`;
    const trace = row.missed.length === 0 ? 'чтение в замыкании' : `МИМО ЗАМЫКАНИЯ: ${row.missed.length}`;
    console.log(`  ${row.name.padEnd(9)} ${code.padEnd(7)} ${row.seconds.toFixed(0).padStart(4)} с   ${trace.padEnd(20)} ${row.verdict}`);
  }
  const total = rows.reduce((a, r) => a + r.seconds, 0);
  const wall = (performance.now() - started) / 1000;
  console.log(`  всего ${Math.round(wall)} с настоящего времени (${busy}порознь — ${Math.round(total)} с), отчётов ${rows.length} из ${p.all.length}`);
  if (rows.some((r) => r.exit !== 0 || r.missed.length > 0)) process.exitCode = 1;
}

await main();
