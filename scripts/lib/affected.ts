/**
 * Какие отчёты гнать перед пушем: набор выводится из изменённых файлов и замыканий, а не
 * пишется списком.
 *
 * ВЛАДЕЛЬЦЫ. У каждого файла дерева обязан найтись владелец — тот, кто его читает:
 *   отчёт — команда `<имя>:report` из package.json и замыкание её входного файла;
 *   тест — файлы под `test.include` из vite.config.ts и их замыкание вместе с рёбрами одних
 *     типов (их держит проверка типов, которая гоняется всегда);
 *   инструмент — прочие команды package.json, которые называют файл (`build`, `map:shots`,
 *     `world:build`…): их выход, если он едет в репозиторий, сам лежит в замыканиях;
 *   документ — белый список правила 9: `docs/`, `CLAUDE.md`, `README`.
 * Изменённый файл, у которого владельца нет, — это файл, про который подсчёт не знает,
 * что он делает, и значит гоняются все отчёты.
 *
 * ПОЛНЫЙ ПРОГОН, если хоть одно из:
 *   изменений нет вовсе — сравнивать не с чем, и вопрос «что задето» не имеет ответа;
 *   подсчёт упал или в замыкании отчёта есть сомнение (см. `deps.ts`);
 *   изменился файл из замыкания самого подсчёта — судья, которого правят, не судит;
 *   изменился файл без владельца.
 * Иначе — отчёты, в чьё замыкание попал хоть один изменённый файл. Сомнение решается
 * в пользу полного прогона всегда: лишний отчёт стоит минут, пропущенный — регрессии.
 */
import { Index, Scanner, covers, type Closure, type ViteFacts } from './deps';
import type { Tree } from './tree';

/** Документы, для которых отчёты не гоняются. Тот же белый список, что был в правиле 9. */
export const DOCS = /^(docs\/|CLAUDE\.md$|README)/;

export interface Owner {
  name: string;
  kind: 'report' | 'tool' | 'tests' | 'selector';
  roots: string[];
  closure: Closure;
}

export interface Setup {
  /** Команды package.json. */
  scripts: Record<string, string>;
  /** Шаблоны `test.include`. */
  tests: string[];
  vite: ViteFacts;
  /** Входные файлы самого подсчёта. */
  selector: string[];
}

export interface Plan {
  full: boolean;
  /** Почему всё — или пусто, если выбор частичный. */
  why: string[];
  /** Выбранные отчёты и изменённые файлы, по которым выбраны. */
  reports: Array<{ name: string; by: string[] }>;
  /** Все отчёты по порядку package.json. */
  all: string[];
  /** Изменённые файлы, для которых отчёты не нужны, и почему. */
  quiet: Array<{ file: string; owner: string }>;
  owners: Owner[];
}

const RUNNERS: Record<string, 'vite' | 'node'> = { 'vite-node': 'vite', node: 'node' };

/** Шаблон `src/**\/*.test.ts` в регулярное выражение. */
export function globRe(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += glob[i + 2] === '/' ? '(?:.*/)?' : '.*';
      i += glob[i + 2] === '/' ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/**
 * Разбор команды: чем запускается и какой файл — вход. Команда без файла (`vitest run`,
 * `tsc --noEmit`) владельцем быть не может и возвращает `null`; команда с файлом, но
 * незнакомым запускателем — сомнение.
 */
export function commandOf(cmd: string, tree: Index): { runner: 'vite' | 'node' | null; entry: string } | null {
  const words = cmd.trim().split(/\s+/);
  const entry = words.find((w) => /\.(ts|tsx|mts|mjs|js|cjs)$/.test(w) && tree.files.has(w.replace(/^\.\//, '')));
  if (!entry) return null;
  return { runner: RUNNERS[words[0]] ?? null, entry: entry.replace(/^\.\//, '') };
}

/** Владельцы дерева: отчёты, инструменты, тесты и сам подсчёт. */
export function owners(tree: Tree, setup: Setup): { owners: Owner[]; scanner: Scanner } {
  const index = new Index(tree);
  const scanner = new Scanner(index, setup.vite);
  const packages = ['package.json', 'package-lock.json'].filter((f) => index.files.has(f));
  const viteRoots = scanner.viteReads();
  const build = commandOf(setup.scripts.build ?? '', index);
  const buildRoots = build ? [build.entry, ...packages, ...(build.runner === 'vite' ? viteRoots : [])] : [];
  const list: Owner[] = [];
  const own = (name: string, kind: Owner['kind'], roots: string[], extra: string[] = []): void => {
    const closure = scanner.closure(roots, buildRoots, kind === 'selector', kind === 'tests' || kind === 'selector');
    closure.doubts.unshift(...extra);
    list.push({ name, kind, roots, closure });
  };

  for (const [script, cmd] of Object.entries(setup.scripts)) {
    const report = /^([\w-]+):report$/.exec(script);
    const c = commandOf(cmd, index);
    if (!c) {
      if (report) own(report[1], 'report', packages, [`команда ${script} без входного файла: «${cmd}»`]);
      continue;
    }
    // Команда самого подсчёта инструментом не считается: его замыкание берётся по импортам
    // (см. `closure`), а упомянутые им пути — предмет разбора, и владеть ими он не должен.
    if (!report && setup.selector.includes(c.entry)) continue;
    const roots = [c.entry, ...packages, ...(c.runner === 'vite' ? viteRoots : [])];
    const unknown = c.runner === null ? [`команда ${script}: незнакомый запускатель «${cmd.split(/\s+/)[0]}»`] : [];
    own(report ? report[1] : script, report ? 'report' : 'tool', roots, unknown);
  }
  const tests = setup.tests.map(globRe);
  own('тесты', 'tests', [...tree.files.filter((f) => tests.some((re) => re.test(f))), ...packages, ...viteRoots]);
  own('подсчёт', 'selector', [...setup.selector, ...packages, ...viteRoots]);
  return { owners: list, scanner };
}

/**
 * План прогона. `changed` — изменённые файлы, включая удалённые. Любой сбой подсчёта
 * превращается в полный прогон с причиной, а не в исключение: приёмка без ответа хуже
 * приёмки с лишними отчётами.
 */
export function plan(tree: Tree, changed: readonly string[], setup: Setup): Plan {
  const reportNames = Object.keys(setup.scripts)
    .map((s) => /^([\w-]+):report$/.exec(s)?.[1])
    .filter((x): x is string => !!x);
  const full = (why: string[], found: Owner[] = []): Plan => ({
    full: true,
    why,
    reports: reportNames.map((name) => ({ name, by: [] })),
    all: reportNames,
    quiet: [],
    owners: found,
  });
  if (changed.length === 0) return full(['изменений нет — сравнивать не с чем']);

  let found: Owner[];
  try {
    found = owners(tree, setup).owners;
  } catch (e) {
    return full([`подсчёт замыканий упал: ${(e as Error).message}`]);
  }
  const reports = found.filter((o) => o.kind === 'report');
  if (reports.length !== reportNames.length || reports.length === 0) return full(['отчёты в package.json и в подсчёте не сошлись'], found);

  const why: string[] = [];
  for (const r of reports) for (const d of r.closure.doubts) why.push(`${r.name}: ${d}`);
  const selector = found.find((o) => o.kind === 'selector')!;
  why.push(...selector.closure.doubts.map((d) => `подсчёт: ${d}`));
  const self = changed.filter((f) => covers(selector.closure, f));
  if (self.length > 0) why.push(`изменился сам подсчёт: ${self.join(', ')}`);

  const picked = new Map<string, string[]>();
  const quiet: Plan['quiet'] = [];
  for (const file of changed) {
    const hit = reports.filter((r) => covers(r.closure, file));
    for (const r of hit) picked.set(r.name, [...(picked.get(r.name) ?? []), file]);
    if (hit.length > 0) continue;
    // Тесты спрашиваются раньше инструментов: у тестового файла владелец — тесты, даже если
    // его заодно цепляет папка, упомянутая инструментом.
    const other = [...found].sort((a, b) => Number(b.kind === 'tests') - Number(a.kind === 'tests')).find((o) => (o.kind === 'tests' || o.kind === 'tool') && covers(o.closure, file));
    if (other) quiet.push({ file, owner: other.kind === 'tests' ? 'тесты' : `команда ${other.name}` });
    else if (DOCS.test(file)) quiet.push({ file, owner: 'документ' });
    else why.push(`у файла ${file} нет владельца — неизвестно, что он делает`);
  }
  if (why.length > 0) return full(why, found);
  return {
    full: false,
    why: [],
    reports: reportNames.filter((n) => picked.has(n)).map((name) => ({ name, by: picked.get(name)! })),
    all: reportNames,
    quiet,
    owners: found,
  };
}
