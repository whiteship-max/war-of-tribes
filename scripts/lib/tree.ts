/**
 * Дерево файлов, из которого считаются замыкания отчётов: рабочая копия или коммит.
 *
 * Два вида, и оба спрашивают git, а не обходят диск. Причина одна: вселенная файлов —
 * это то, что едет в репозиторий. `snaps/` с чужими worktree внутри, `node_modules`,
 * `dist` и прочее игнорируемое в неё не входит и зависимостью по файлу быть не может
 * (`dist` и пакеты учтены иначе — см. `deps.ts`).
 *
 * У каждого файла есть отпечаток — идентификатор блоба git. Отпечаток один и тот же у
 * одинакового содержимого в коммите и в рабочей копии, и на этом держится кэш прогонов:
 * вывод отчёта кладётся под отпечатком его замыкания, а не под именем коммита, и находится
 * с любого коммита, где замыкание то же. Считать хеш самим нельзя: `core.autocrlf` на Windows
 * держит на диске CRLF при LF в коммите, и сырой sha1 файла с блобом не сходится никогда.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface Tree {
  /** Чем дерево названо в выводе: `рабочая копия` или сокращённый коммит. */
  label: string;
  /** Все файлы дерева, пути от корня через `/`. */
  files: readonly string[];
  /** Текст файла. Бросает, если файла нет. */
  read(file: string): string;
  /** Отпечаток содержимого: блоб git. Бросает, если файла нет. */
  blob(file: string): string;
}

function git(root: string, args: string[], input?: string): string {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', input, maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr.trim()}`);
  return r.stdout;
}

/** Что имеет смысл читать текстом: только такие файлы и разбираются в `deps.ts`. */
export const TEXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|css|html|json)$/;

/** Строки, разделённые NUL, без хвоста. */
const nul = (s: string): string[] => s.split('\0').filter((x) => x !== '');

/**
 * Рабочая копия: отслеживаемое плюс новое неигнорируемое, удалённое с диска — не в счёт.
 * Отпечаток чистого файла берётся из индекса, изменённого и нового — `git hash-object`,
 * то есть с теми же фильтрами, с какими файл лёг бы в коммит.
 */
export function worktree(root: string): Tree {
  const staged = new Map<string, string>();
  for (const line of nul(git(root, ['ls-files', '-s', '-z']))) {
    const m = /^\d+ ([0-9a-f]+) \d\t(.+)$/s.exec(line);
    if (m) staged.set(m[2], m[1]);
  }
  const untracked = nul(git(root, ['ls-files', '--others', '--exclude-standard', '-z']));
  const deleted = new Set(nul(git(root, ['ls-files', '--deleted', '-z'])));
  const modified = new Set(nul(git(root, ['ls-files', '--modified', '-z'])).filter((f) => !deleted.has(f)));
  // Файл, изменённый только в индексе, git-ом по диску не отличим от чистого: индекс и
  // есть его содержимое. Изменённый на диске и новый хешируются заново.
  const rehash = [...modified, ...untracked];
  const fresh = rehash.length > 0 ? git(root, ['hash-object', '--stdin-paths'], rehash.join('\n') + '\n').split('\n') : [];
  const blobs = new Map(staged);
  rehash.forEach((f, i) => blobs.set(f, fresh[i]));
  for (const f of deleted) blobs.delete(f);
  const files = [...blobs.keys()].sort();
  return {
    label: 'рабочая копия',
    files,
    read: (file) => readFileSync(path.join(root, file), 'utf8'),
    blob: (file) => {
      const b = blobs.get(file);
      if (!b) throw new Error(`нет файла ${file}`);
      return b;
    },
  };
}

/** Коммит: список и отпечатки из `ls-tree`, содержимое — одним `cat-file --batch` по запросу. */
export function commitTree(root: string, rev: string): Tree {
  const sha = git(root, ['rev-parse', '--verify', `${rev}^{commit}`]).trim();
  const blobs = new Map<string, string>();
  for (const line of nul(git(root, ['ls-tree', '-r', '-z', sha]))) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/s.exec(line);
    if (m) blobs.set(m[2], m[1]);
  }
  let texts: Map<string, string> | null = null;
  // Процесс на файл на Windows стоит десятки миллисекунд, а читать надо сотни файлов:
  // первый же запрос достаёт все текстовые блобы разом одним `cat-file --batch`.
  const load = (): Map<string, string> => {
    const wanted = [...new Set([...blobs].filter(([f]) => TEXT.test(f)).map(([, b]) => b))];
    const r = spawnSync('git', ['cat-file', '--batch'], { cwd: root, input: wanted.join('\n') + '\n', maxBuffer: 1024 * 1024 * 1024 });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error(`git cat-file --batch: ${r.stderr.toString().trim()}`);
    const out = r.stdout;
    const map = new Map<string, string>();
    let at = 0;
    while (at < out.length) {
      const eol = out.indexOf(10, at);
      const head = out.subarray(at, eol).toString('utf8').split(' ');
      const size = Number(head[2]);
      map.set(head[0], out.subarray(eol + 1, eol + 1 + size).toString('utf8'));
      at = eol + 1 + size + 1;
    }
    return map;
  };
  return {
    label: sha.slice(0, 7),
    files: [...blobs.keys()].sort(),
    read: (file) => {
      const b = blobs.get(file);
      if (!b) throw new Error(`нет файла ${file} в ${sha.slice(0, 7)}`);
      texts ??= load();
      const t = texts.get(b);
      return t ?? git(root, ['cat-file', 'blob', b]);
    },
    blob: (file) => {
      const b = blobs.get(file);
      if (!b) throw new Error(`нет файла ${file} в ${sha.slice(0, 7)}`);
      return b;
    },
  };
}

/** Дерево в памяти — для тестов правил. Отпечаток — само содержимое. */
export function memoryTree(files: Record<string, string>, label = 'память'): Tree {
  return {
    label,
    files: Object.keys(files).sort(),
    read: (file) => {
      if (!(file in files)) throw new Error(`нет файла ${file}`);
      return files[file];
    },
    blob: (file) => {
      if (!(file in files)) throw new Error(`нет файла ${file}`);
      return files[file];
    },
  };
}

export { git };
