// Выбор отчётов: набор выводится из замыканий, а сомнение даёт полный прогон.
//
// Область правила — изменённые файлы, которые подсчёт умеет отнести к владельцу. Точки
// «гоняем всё» (пустой дифф, сломанный подсчёт, файл без владельца, правка самого подсчёта,
// сомнение в замыкании) проверяются на том же маленьком дереве, где частичный выбор
// заведомо возможен: первым тестом стоит утверждение, что на этом дереве выбор бывает
// частичным, — иначе «полный прогон» проходил бы зелёным при любом коде.
import { describe, expect, it } from 'vitest';
import { owners, plan, type Plan, type Setup } from './affected';
import { memoryTree, type Tree } from './tree';

const FILES: Record<string, string> = {
  'package.json': JSON.stringify({
    scripts: {
      'a:report': 'vite-node scripts/a-report.ts',
      'b:report': 'vite-node scripts/b-report.ts',
      'page:report': 'vite-node scripts/page-report.ts',
      'built:report': 'vite-node scripts/built-report.ts',
      build: 'node scripts/build.mjs',
      shots: 'vite-node scripts/shots.ts',
      test: 'vitest run',
    },
  }),
  'package-lock.json': '{}',
  'vite.config.ts': "import { defineConfig } from 'vite';\nexport default defineConfig({ resolve: { alias: { '@': './src' } } });\n",
  'tsconfig.json': '{}',
  'index.html': '<div id="root"></div>\n<script type="module" src="/src/main.ts"></script>\n',
  'src/main.ts': "import { shared } from '@/shared';\nimport './style.css';\nfetch('/assets/music/' + shared);\n",
  'src/style.css': 'body { background: url(./bg.png); }\n',
  'src/bg.png': 'png',
  'src/shared.ts': "export const shared = 'x';\n",
  'src/only-a.ts': "import type { Kind } from './kinds';\nexport const a: Kind = 1;\n",
  'src/kinds.ts': 'export type Kind = number;\n',
  'src/table.json': '{"n": 1}',
  'src/helper-for-tests.ts': 'export const h = 1;\n',
  'src/sim.test.ts': "import { h } from './helper-for-tests';\nimport { a } from './only-a';\n",
  'scripts/a-report.ts': "import { a } from '../src/only-a';\nimport table from '../src/table.json';\nconsole.log(a, table, 'см. docs/notes.md и CLAUDE.md');\n",
  'scripts/b-report.ts': "import { shared } from '@/shared';\nconsole.log(shared);\n",
  'scripts/page-report.ts': "import { createServer } from 'vite';\nconst config = new URL('../vite.config.ts', import.meta.url);\n",
  'scripts/built-report.ts': "const DIST = new URL('../dist', import.meta.url);\n",
  'scripts/build.mjs': "const STAGES = [['vite-node', 'scripts/icons.ts']];\n",
  'scripts/icons.ts': "import path from 'node:path';\nconst SRC = path.join(ROOT, 'assets-src', 'icons');\n",
  'scripts/shots.ts': "import { shared } from '../src/shared';\n",
  'scripts/reports.ts': "import { pick } from './lib/pick';\n",
  'scripts/lib/pick.ts': 'export const pick = 1;\n',
  'assets-src/icons/fire.svg': '<svg/>',
  'assets-src/unused/old.svg': '<svg/>',
  'public/assets/music/village.mp3': 'mp3',
  'docs/notes.md': '# заметки',
  'CLAUDE.md': '# правила',
  'netlify.toml': '[build]',
};

const SETUP = (tree: Tree): Setup => ({
  scripts: (JSON.parse(tree.read('package.json')) as { scripts: Record<string, string> }).scripts,
  tests: ['src/**/*.test.ts'],
  vite: { config: 'vite.config.ts', tsconfig: 'tsconfig.json', publicDir: 'public', outDir: 'dist', html: 'index.html' },
  selector: ['scripts/reports.ts'],
});

const run = (changed: string[], files = FILES): Plan => {
  const tree = memoryTree(files);
  return plan(tree, changed, SETUP(tree));
};
const names = (p: Plan): string[] => p.reports.map((r) => r.name);
const ALL = ['a', 'b', 'page', 'built'];

/** Полный прогон по названной причине — не молча и не по другой. */
function expectFull(p: Plan, reason: RegExp): void {
  expect(p.full, `ждали полный прогон (${reason}), а выбрано: ${names(p).join(' ') || 'ничего'}`).toBe(true);
  expect(names(p)).toEqual(ALL);
  expect(p.why.some((w) => reason.test(w)), `причина «${reason}» не названа; названо: ${p.why.join(' | ')}`).toBe(true);
}

describe('выбор отчётов по замыканиям', () => {
  it('на этом дереве выбор бывает частичным — иначе проверки полного прогона ничего не значат', () => {
    const p = run(['src/only-a.ts']);
    expect(p.full).toBe(false);
    expect(names(p).length).toBeLessThan(ALL.length);
  });

  it('файл, который импортирует один отчёт, выбирает ровно его', () => {
    expect(names(run(['src/only-a.ts']))).toEqual(['a']);
  });

  it('файл, из которого отчёт берёт одни типы, отчёта не зовёт — его держат типы и тесты', () => {
    const p = run(['src/kinds.ts']);
    expect(p.full).toBe(false);
    expect(names(p)).toEqual([]);
    expect(p.quiet).toEqual([{ file: 'src/kinds.ts', owner: 'тесты' }]);
  });

  it('данные, прочитанные импортом, лежат в замыкании', () => {
    expect(names(run(['src/table.json']))).toEqual(['a']);
  });

  it('общий модуль выбирает всех, кто до него дотягивается: импортом, страницей и сборкой', () => {
    expect(names(run(['src/shared.ts']))).toEqual(['b', 'page', 'built']);
  });

  it('страница тянет стили, картинку из стилей и публичную папку — и файл, которого ещё нет', () => {
    expect(names(run(['src/bg.png']))).toEqual(['page', 'built']);
    expect(names(run(['public/assets/music/village.mp3']))).toEqual(['page', 'built']);
    expect(names(run(['public/assets/music/new-track.mp3']))).toEqual(['page', 'built']);
  });

  it('собранное тянет исходники сборки, упомянутые путём по кускам', () => {
    expect(names(run(['assets-src/icons/fire.svg']))).toEqual(['built']);
  });

  it('фраза в выводе отчёта путём не считается', () => {
    const p = run(['docs/notes.md', 'CLAUDE.md']);
    expect(p.full).toBe(false);
    expect(names(p)).toEqual([]);
    expect(p.quiet.map((q) => q.owner)).toEqual(['документ', 'документ']);
  });

  it('тест и то, что нужно только тестам, отчётов не зовут', () => {
    const p = run(['src/sim.test.ts', 'src/helper-for-tests.ts']);
    expect(p.full).toBe(false);
    expect(names(p)).toEqual([]);
    expect(p.quiet.every((q) => q.owner === 'тесты')).toBe(true);
  });

  it('файл инструмента, не отчёта, отчётов не зовёт', () => {
    const p = run(['scripts/shots.ts']);
    expect(p.full).toBe(false);
    expect(names(p)).toEqual([]);
  });
});

describe('сомнение решается полным прогоном', () => {
  it('пустой дифф', () => {
    expectFull(run([]), /изменений нет/);
  });

  it('файл без владельца', () => {
    expectFull(run(['netlify.toml']), /netlify\.toml нет владельца/);
    expectFull(run(['assets-src/unused/old.svg']), /нет владельца/);
  });

  it('удалённый файл, которого нет ни в одном замыкании', () => {
    expectFull(run(['src/removed.ts']), /src\/removed\.ts нет владельца/);
  });

  it('правка самого подсчёта — его входа и того, что он импортирует', () => {
    expectFull(run(['scripts/reports.ts']), /сам подсчёт/);
    expectFull(run(['scripts/lib/pick.ts']), /сам подсчёт/);
  });

  it('правка настроек сборки и пакетов', () => {
    for (const f of ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json']) expectFull(run([f]), /сам подсчёт/);
  });

  it('подсчёт упал', () => {
    const tree = memoryTree(FILES);
    const broken: Tree = {
      ...tree,
      get files(): readonly string[] {
        throw new Error('git не ответил');
      },
    };
    expectFull(plan(broken, ['src/only-a.ts'], SETUP(tree)), /подсчёт замыканий упал: git не ответил/);
  });

  it('файл из замыкания отчёта не читается', () => {
    const tree = memoryTree(FILES);
    const broken: Tree = { ...tree, read: (f) => (f === 'src/only-a.ts' ? (() => { throw new Error('нет доступа'); })() : tree.read(f)) };
    expectFull(plan(broken, ['src/kinds.ts'], SETUP(tree)), /a: src\/only-a\.ts не разобран/);
  });

  it('импорт, который не разрешился', () => {
    const files = { ...FILES, 'src/only-a.ts': "import { gone } from './gone';\n" };
    expectFull(run(['src/only-a.ts'], files), /импорт «\.\/gone» не разрешился/);
  });

  it('import() не строкой и import.meta.glob', () => {
    expectFull(run(['src/only-a.ts'], { ...FILES, 'src/only-a.ts': 'const n = "x";\nimport(`./${n}`);\n' }), /import\(\) не строкой/);
    expectFull(run(['src/only-a.ts'], { ...FILES, 'src/only-a.ts': "const all = import.meta.glob('./*.ts');\n" }), /import\.meta\.glob/);
  });

  it('команда отчёта без входного файла или с незнакомым запускателем', () => {
    const pkg = (scripts: Record<string, string>): Record<string, string> => ({ ...FILES, 'package.json': JSON.stringify({ scripts }) });
    expectFull(run(['src/only-a.ts'], pkg({ ...JSON.parse(FILES['package.json']).scripts, 'a:report': 'vite-node' })), /без входного файла/);
    expectFull(run(['src/only-a.ts'], pkg({ ...JSON.parse(FILES['package.json']).scripts, 'a:report': 'bun scripts/a-report.ts' })), /незнакомый запускатель/);
  });
});

describe('замыкания на настоящем дереве', () => {
  it('выводятся, и владельцы названы по командам', () => {
    const tree = memoryTree(FILES);
    const found = owners(tree, SETUP(tree)).owners;
    expect(found.map((o) => `${o.kind}:${o.name}`)).toEqual([
      'report:a',
      'report:b',
      'report:page',
      'report:built',
      'tool:build',
      'tool:shots',
      'tests:тесты',
      'selector:подсчёт',
    ]);
    const built = found.find((o) => o.name === 'built')!;
    expect(built.closure.built).toBe(true);
    expect([...built.closure.files]).toEqual(expect.arrayContaining(['index.html', 'src/main.ts', 'scripts/build.mjs', 'scripts/icons.ts', 'assets-src/icons/fire.svg']));
    expect(found.find((o) => o.name === 'a')!.closure.built).toBe(false);
  });
});
