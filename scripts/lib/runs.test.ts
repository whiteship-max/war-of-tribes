// Прогон: ключ вывода и проверка прочитанного.
import { describe, expect, it } from 'vitest';
import type { Closure } from './deps';
import { closureKey, unexplained } from './runs';
import { memoryTree } from './tree';

const closure = (files: string[], dirs: string[] = []): Closure => ({ files: new Set(files), dirs: new Set(dirs), built: false, doubts: [] });

describe('ключ вывода — отпечаток замыкания', () => {
  const a = memoryTree({ 'src/a.ts': '1', 'src/b.ts': '2', 'docs/x.md': 'x' });
  const c = closure(['src/a.ts', 'src/b.ts']);

  it('то же содержимое с любого дерева — тот же ключ, а файл вне замыкания ключа не трогает', () => {
    const other = memoryTree({ 'src/a.ts': '1', 'src/b.ts': '2', 'docs/x.md': 'другое' }, 'другой коммит');
    expect(closureKey('pop', other, c)).toBe(closureKey('pop', a, c));
  });

  it('правка файла из замыкания и другой отчёт — другой ключ', () => {
    const edited = memoryTree({ 'src/a.ts': '1', 'src/b.ts': '3', 'docs/x.md': 'x' });
    expect(closureKey('pop', edited, c)).not.toBe(closureKey('pop', a, c));
    expect(closureKey('log', a, c)).not.toBe(closureKey('pop', a, c));
  });
});

describe('прочитанное мимо замыкания', () => {
  const tree = memoryTree({ 'src/a.ts': '', 'src/b.ts': '', 'public/m/1.mp3': '', 'netlify/tsconfig.json': '' });

  it('файл дерева, которого нет в замыкании, — находка', () => {
    expect(unexplained(['src/a.ts', 'src/b.ts'], closure(['src/a.ts']), 'dist', tree)).toEqual(['src/b.ts']);
  });

  it('файл под упомянутой папкой, пакеты, git, сборка, списки папок и неотслеживаемое — не находка', () => {
    const read = ['src/a.ts', 'public/m/1.mp3', 'node_modules/three/index.js', '.git/HEAD', 'dist/index.html', 'docs/', '.vite/cache.json'];
    expect(unexplained(read, closure(['src/a.ts'], ['public/']), 'dist', tree)).toEqual([]);
  });
});
