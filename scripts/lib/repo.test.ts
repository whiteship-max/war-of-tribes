// Подсчёт на настоящем репозитории: у каждого отчёта есть замыкание без сомнений, и в нём
// лежит то, что отчёт на самом деле читает. Проверка «прочитал ли прогон что-то мимо
// замыкания» живёт в самом прогоне (`scripts/reports.ts`); здесь — то, что видно без него.
import { describe, expect, it } from 'vitest';
import { owners } from './affected';
import { ROOT, setupOf } from './setup';
import { worktree } from './tree';

describe('замыкания отчётов на этом репозитории', () => {
  const tree = worktree(ROOT);
  const setup = setupOf(tree, ['scripts/reports.ts']);
  const found = owners(tree, setup).owners;
  const report = (name: string) => {
    const o = found.find((x) => x.kind === 'report' && x.name === name);
    if (!o) throw new Error(`нет отчёта ${name}`);
    return o;
  };

  it('отчёты — это команды `*:report`, и их семнадцать', () => {
    const scripts = Object.keys(setup.scripts).filter((s) => s.endsWith(':report'));
    expect(found.filter((o) => o.kind === 'report').map((o) => `${o.name}:report`)).toEqual(scripts);
    expect(scripts).toHaveLength(17);
  });

  it('ни у одного отчёта и у самого подсчёта нет сомнений — иначе выбор всегда был бы полным', () => {
    const doubts = found.filter((o) => o.kind === 'report' || o.kind === 'selector').flatMap((o) => o.closure.doubts.map((d) => `${o.name}: ${d}`));
    expect(doubts).toEqual([]);
  });

  it('узловой отчёт тянет модули, данные и пакеты', () => {
    const world = report('world').closure;
    expect([...world.files]).toEqual(expect.arrayContaining(['scripts/world-report.ts', 'src/world/atlas/data.ts', 'package-lock.json', 'vite.config.ts']));
    expect(world.built).toBe(false);
  });

  it('отчёт со страницей тянет разметку, вход, стили и публичную папку', () => {
    const tap = report('tap').closure;
    expect([...tap.files]).toEqual(expect.arrayContaining(['index.html', 'src/main.tsx', 'src/ui/styles.css', 'src/prologue/prologue.css']));
    expect([...tap.dirs]).toContain('public/');
  });

  it('отчёт по собранному тянет сборку и то, из чего она собирает значки', () => {
    const scene = report('scene').closure;
    expect(scene.built).toBe(true);
    expect([...scene.files]).toEqual(expect.arrayContaining(['scripts/build.mjs', 'scripts/build-icons.ts', 'index.html']));
    expect([...scene.files].some((f) => f.startsWith('assets-src/icons/'))).toBe(true);
  });

  it('выбор не вырождается: ядро боя не тянет интерфейс, а подсчёт — игру', () => {
    expect([...report('battle').closure.files].some((f) => f.startsWith('src/ui/'))).toBe(false);
    expect([...found.find((o) => o.kind === 'selector')!.closure.files].some((f) => f.startsWith('src/'))).toBe(false);
  });
});
