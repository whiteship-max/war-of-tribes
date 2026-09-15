/**
 * Настройки подсчёта из самого репозитория: команды package.json, `test.include` и папки
 * vite. Своих чисел здесь нет — только чтение и умолчания vite.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import viteConfig from '../../vite.config';
import type { Setup } from './affected';
import { git, type Tree } from './tree';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Путь модуля от корня — так подсчёт узнаёт собственные входы. */
export const own = (url: string): string => path.relative(ROOT, fileURLToPath(url)).split(path.sep).join('/');

/** Всё, что подсчёт берёт из настроек, — из самих настроек и умолчаний vite. */
export function setupOf(tree: Tree, selector: string[]): Setup {
  const pkg = JSON.parse(tree.read('package.json')) as { scripts: Record<string, string> };
  const cfg = viteConfig as { publicDir?: string | false; build?: { outDir?: string }; test?: { include?: string[] } };
  return {
    scripts: pkg.scripts,
    tests: cfg.test?.include ?? [],
    vite: {
      config: 'vite.config.ts',
      tsconfig: 'tsconfig.json',
      publicDir: cfg.publicDir === false ? '' : (cfg.publicDir ?? 'public'),
      outDir: cfg.build?.outDir ?? 'dist',
      html: 'index.html',
    },
    selector,
  };
}

export const lines = (s: string): string[] =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

/** Изменённые файлы от базы до рабочей копии: коммиты, индекс, диск и новые файлы. */
export function changedSince(base: string): string[] {
  const committed = lines(git(ROOT, ['diff', '--name-only', '--no-renames', base, 'HEAD']));
  const dirty = lines(git(ROOT, ['diff', '--name-only', '--no-renames', 'HEAD']));
  const fresh = lines(git(ROOT, ['ls-files', '--others', '--exclude-standard']));
  return [...new Set([...committed, ...dirty, ...fresh])].sort();
}
