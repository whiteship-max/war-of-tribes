// Подсчёт на настоящем репозитории: у каждого отчёта есть замыкание без сомнений, и в нём
// лежит то, что отчёт на самом деле читает. Проверка «прочитал ли прогон что-то мимо
// замыкания» живёт в самом прогоне (`scripts/reports.ts`); здесь — то, что видно без него.
import { spawnSync } from 'node:child_process';
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

  it('отчёты — это команды `*:report`, и их двадцать один', () => {
    const scripts = Object.keys(setup.scripts).filter((s) => s.endsWith(':report'));
    expect(found.filter((o) => o.kind === 'report').map((o) => `${o.name}:report`)).toEqual(scripts);
    expect(scripts).toHaveLength(21);
    // Стенд предыстории — не отчёт приёмки: он выведен из списка суффиксом (CLAUDE.md, правило 9).
    expect(Object.keys(setup.scripts)).toContain('prologue:stand');
  });

  it('ни у одного отчёта и у самого подсчёта нет сомнений — иначе выбор всегда был бы полным', () => {
    const doubts = found.filter((o) => o.kind === 'report' || o.kind === 'selector').flatMap((o) => o.closure.doubts.map((d) => `${o.name}: ${d}`));
    expect(doubts).toEqual([]);
  });

  it('разделы бывшего raid:report разведены: правка одного раздела не гонит чужой', () => {
    // Затем и разведены (docs/realm.md, раздел 8): замыкание — единственное, по чему подсчёт выбирает.
    const entry: Record<string, string> = {
      raid: 'scripts/raid-report.ts',
      'raid-growth': 'scripts/raid-growth-report.ts',
      'raid-hiring': 'scripts/raid-hiring-report.ts',
      'raid-mix': 'scripts/raid-mix-report.ts',
      'raid-stable': 'scripts/raid-stable-report.ts',
    };
    const sections: [string, string][] = [
      ['raid-growth', 'scripts/raid-lair-growth.ts'],
      ['raid-hiring', 'scripts/raid-hiring.ts'],
      ['raid-hiring', 'scripts/raid-infirmary.ts'],
      ['raid-mix', 'scripts/raid-defense-mix.ts'],
      ['raid-stable', 'scripts/raid-stable.ts'],
    ];
    for (const [name, file] of Object.entries(entry)) expect([...report(name).closure.files], name).toContain(file);
    for (const [name, file] of sections) {
      const pulled = Object.keys(entry).filter((other) => [...report(other).closure.files].includes(file));
      expect(pulled, file).toEqual([name]);
    }
    // Перехват — свой отчёт в полминуты: ни одного раздела и автопилота в нём нет.
    expect([...report('raid').closure.files].filter((f) => f.startsWith('scripts/raid-') || f === 'scripts/autopilot.ts')).toEqual(['scripts/raid-report.ts']);
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
    // Рисунки набора ЗН-1 — код (`scripts/icons/`, docs/icons.md): сборка значков тянет их импортом.
    expect([...scene.files]).toEqual(expect.arrayContaining(['scripts/icons/set.ts', 'scripts/icons/motifs.ts', 'scripts/icons/kit.ts']));
  });

  it('временный конфиг Vite не входит в дерево: его стирают раньше, чем git его прочтёт', () => {
    // Каждый процесс vite, vite-node и vitest кладёт рядом с конфигом собранный файл с таким именем (Vite 5,
    // `loadConfigFromBundledFile`) и стирает через миллисекунды. Неигнорируемый, он попадал в неотслеживаемые, исчезал
    // до `git hash-object`, и `worktree` падал, если рядом стартовал vite-node — дочерний процесс веера или отчёт.
    const name = 'vite.config.ts.timestamp-1790771323946-3ebad02853b9c.mjs';
    const r = spawnSync('git', ['check-ignore', '--no-index', '-q', name], { cwd: ROOT });
    expect(r.status, `${name} не игнорируется: подсчёт замыканий увидит его и упадёт`).toBe(0);
  });

  it('выбор не вырождается: ядро боя не тянет интерфейс, а подсчёт — игру', () => {
    expect([...report('battle').closure.files].some((f) => f.startsWith('src/ui/'))).toBe(false);
    expect([...found.find((o) => o.kind === 'selector')!.closure.files].some((f) => f.startsWith('src/'))).toBe(false);
  });
});
