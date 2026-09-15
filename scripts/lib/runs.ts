/**
 * Выводы прогонов отчётов: где лежат, под каким ключом, как прогон записывает прочитанное.
 *
 * КЛЮЧ — отпечаток замыкания отчёта: имя отчёта и блобы git всех файлов, от которых он
 * зависит. Вывод отчёта — функция этих файлов (и шума замеров, который отчёт помечает сам,
 * см. `measured.ts`), поэтому прогон, снятый с любого коммита, годится для любого другого с
 * тем же замыканием. Прогон «до» перестаёт быть вторым прогоном: если с тех пор, как базу
 * гоняли, замыкание отчёта не менялось, вывод уже лежит.
 *
 * ГДЕ — в общей папке git (`git rev-parse --git-common-dir`)/`tribe-reports`. В репозиторий
 * это не попадает никогда (папка git не отслеживается), и видно это всем worktree одного
 * репозитория: прогон «до», снятый во втором worktree, лежит там же, где его ищет первый.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Closure } from './deps';
import { hook as ownHook } from './trace-fs.mjs';
import { git, type Tree } from './tree';

export interface RunMeta {
  report: string;
  key: string;
  commit: string;
  /** Рабочая копия отличалась от коммита в файлах замыкания. */
  dirty: boolean;
  exit: number;
  seconds: number;
  at: string;
  node: string;
}

export interface Stored {
  meta: RunMeta;
  output: string;
}

/** Отпечаток замыкания: одинаковое содержимое — одинаковый ключ с любого коммита. */
export function closureKey(report: string, tree: Tree, closure: Closure): string {
  const h = createHash('sha256').update(`отчёт ${report}\n`);
  for (const f of [...closure.files].sort()) h.update(`${f} ${tree.blob(f)}\n`);
  return h.digest('hex').slice(0, 24);
}

export function storeDir(root: string): string {
  const common = git(root, ['rev-parse', '--git-common-dir']).trim();
  return path.join(path.resolve(root, common), 'tribe-reports');
}

export function load(root: string, report: string, key: string): Stored | null {
  const base = path.join(storeDir(root), report, key);
  if (!existsSync(`${base}.json`) || !existsSync(`${base}.txt`)) return null;
  try {
    return { meta: JSON.parse(readFileSync(`${base}.json`, 'utf8')) as RunMeta, output: readFileSync(`${base}.txt`, 'utf8') };
  } catch {
    return null;
  }
}

export function save(root: string, run: Stored): void {
  const dir = path.join(storeDir(root), run.meta.report);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${run.meta.key}.txt`), run.output);
  writeFileSync(path.join(dir, `${run.meta.key}.json`), JSON.stringify(run.meta, null, 2));
}

export interface Ran {
  exit: number;
  seconds: number;
  output: string;
  /** Файлы репозитория, которые прогон прочитал, от корня; папки — с `/` на конце. */
  read: string[];
}

/**
 * Прогон одной команды с записью прочитанного. Вывод идёт в терминал как есть и
 * одновременно собирается: смотреть на отчёт глазами по ходу прогона по-прежнему можно.
 */
export function runTraced(cwd: string, command: string, traceFile: string, quiet = false): Promise<Ran> {
  rmSync(traceFile, { force: true });
  // Запись прочитанного — всегда нынешняя, в том числе для базы во втором worktree: в базе её
  // может не быть, а о коде игры она не знает ничего.
  const hook = ownHook;
  const env = {
    ...process.env,
    TRIBE_TRACE: traceFile,
    TRIBE_TRACE_ROOT: cwd,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${hook}`.trim(),
    FORCE_COLOR: '0',
  };
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    const take = (b: Buffer, to: NodeJS.WriteStream): void => {
      chunks.push(b);
      if (!quiet) to.write(b);
    };
    child.stdout.on('data', (b: Buffer) => take(b, process.stdout));
    child.stderr.on('data', (b: Buffer) => take(b, process.stderr));
    child.on('close', (code) => {
      const read = existsSync(traceFile) ? [...new Set(readFileSync(traceFile, 'utf8').split('\n').filter(Boolean))].sort() : [];
      resolve({ exit: code ?? 1, seconds: (performance.now() - started) / 1000, output: Buffer.concat(chunks).toString('utf8'), read });
    });
  });
}

/**
 * Что прогон прочитал мимо замыкания. Пакеты, папка git и выход сборки сюда не входят:
 * пакеты стоят в замыкании своим `package-lock.json`, выход сборки — командой `build`,
 * которую замыкание отчёта, читающего его, уже содержит.
 *
 * Список папки тоже не входит: vite обходит всё дерево в поисках `tsconfig.json`, и
 * `docs/`, прочитанная списком, не делает отчёт зависимым от документов. На вывод список
 * влияет только тем, что потом из найденного читают, — а прочитанный файл проверяется.
 */
export function unexplained(read: readonly string[], closure: Closure, outDir: string, tree: Tree): string[] {
  const ignored = /^(node_modules\/|\.git\/)/;
  const out: string[] = [];
  const known = new Set(tree.files);
  for (const f of read) {
    if (ignored.test(f) || f === '' || f === `${outDir}/` || f.startsWith(`${outDir}/`)) continue;
    if (f.endsWith('/')) continue;
    // Неотслеживаемое и игнорируемое (кэш vite, снимки) — не часть дерева и не зависимость.
    if (!known.has(f)) continue;
    if (closure.files.has(f) || [...closure.dirs].some((d) => f.startsWith(d))) continue;
    out.push(f);
  }
  return out;
}
