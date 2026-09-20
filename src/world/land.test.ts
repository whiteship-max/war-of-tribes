// Земля и расселение: два модуля, которые собирает не только игра.
//
// `land.ts` и `settle.ts` читает серверная функция расселения, а её типы
// проверяет отдельный проект (`netlify/tsconfig.json`) — без `@/`, без DOM, с
// одним только Node. Обещание «ни одного `@/`-импорта» записано в заголовках
// обоих модулей, и до сих пор его не держало ничто: нарушение проходит и
// `npm test`, и `tsc --noEmit`, и `vite build` — и падает только на второй
// ступени `npm run typecheck`, а на хостинге выглядит как функция, которая не
// собралась.
//
// Соседи при этом тянут к нарушению сами: всякий другой модуль `src/world`,
// которому нужен генератор, пишет `import { seeded } from '@/game/sim/random'`
// (`gen.ts`, `diplomacy.ts`, `letters.ts`, `spy.ts`, `local/LocalWorld.ts`), а
// эти двое обязаны писать относительный путь. «Приведу к общему виду» — ровно
// та правка, которую этот тест и ловит.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src');

/** Что серверному проекту доступно: всё, кроме `@/` и того, что тянет типы мира. */
const DOORS = ['src/world/land.ts', 'src/world/settle.ts'];

const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Все указатели на модули из файла — и обычные, и типовые. */
function importsOf(file: string): string[] {
  const src = strip(readFileSync(file, 'utf8'));
  return [...src.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g)].map((m) => m[1]);
}

/** Куда указывает относительный путь. Расширения в исходниках не пишут. */
function fileOf(from: string, spec: string): string {
  const base = resolve(dirname(from), spec.replace(/\.js$/, ''));
  for (const ext of ['.ts', '/index.ts']) {
    try {
      readFileSync(base + ext, 'utf8');
      return base + ext;
    } catch {
      /* дальше */
    }
  }
  throw new Error(`не нашёлся модуль ${spec} из ${from}`);
}

/** Замыкание импортов: файл, всё, что он тянет, и всё, что тянут они. */
function closureOf(entry: string): { files: string[]; aliased: string[] } {
  const files: string[] = [];
  const aliased: string[] = [];
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    files.push(file);
    for (const spec of importsOf(file)) {
      if (spec.startsWith('@/')) {
        aliased.push(`${file}: ${spec}`);
        continue;
      }
      if (!spec.startsWith('.')) {
        // Внешних пакетов в этом замыкании быть не должно вовсе: `node:crypto`
        // серверу доступен, но клиенту нет, а `three`/`react` — наоборот.
        aliased.push(`${file}: ${spec}`);
        continue;
      }
      walk(fileOf(file, spec));
    }
  };
  walk(entry);
  return { files, aliased };
}

describe('земля и расселение собираются серверным проектом', () => {
  /**
   * Главное обещание: из этих двух дверей нельзя дойти до `@/`. Всё, что за
   * псевдонимом, живёт в проекте игры — с DOM и своими типами, — а серверный
   * проект о нём не знает и знать не должен.
   */
  it('ни одного импорта через `@/` и ни одного внешнего пакета', () => {
    for (const door of DOORS) {
      const { aliased } = closureOf(join(process.cwd(), door));
      expect([door, aliased]).toEqual([door, []]);
    }
  });

  /**
   * Список замыкания зафиксирован нарочно. Новый файл в нём — не ошибка сама по
   * себе, но это решение: его придётся собирать обоим проектам, и он попадёт в
   * серверный бандл целиком. Пусть это будет видно в диффе.
   */
  it('замыкание — ровно те файлы, которые мы согласились везти на сервер', () => {
    const all = new Set<string>();
    for (const door of DOORS) for (const f of closureOf(join(process.cwd(), door)).files) all.add(f);
    const names = [...all].map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/')).sort();
    expect(names).toEqual([
      // Дверь времени: `tuning.ts` объявляет через неё классы своих сроков. Без импортов, как и `time.ts`.
      'game/pace.ts',
      'game/sim/random.ts',
      // Единицы времени в мс (`tuning.ts` берёт минуту и час): модуль без единого импорта.
      'game/time.ts',
      'world/atlas/atlas.ts',
      'world/atlas/data.ts',
      'world/data/tuning.ts',
      'world/land.ts',
      'world/settle.ts',
    ]);
  });

  /**
   * `world/types.ts` — граница. Он тянет `@/game` и `@/battle`, то есть
   * половину игры, и один `import type { Coord }` отсюда ломает сборку функции,
   * не уронив ни одного теста. Поэтому проверяется прямо и по имени.
   */
  it('ни один из двух не берёт типы у мира', () => {
    for (const door of DOORS) {
      const src = strip(readFileSync(join(process.cwd(), door), 'utf8'));
      expect([door, /from '\.\/types'/.test(src)]).toEqual([door, false]);
      expect([door, /from '\.\.\/types'/.test(src)]).toEqual([door, false]);
    }
  });

  /**
   * Обратная сторона: двери должны быть настоящими. Серверная функция берёт
   * землю и расселение отсюда, и если бы `geography.ts` завёл свою копию, тест
   * замыкания этого не заметил бы — он смотрит только вниз.
   */
  it('география зовёт эту землю, а не считает свою', () => {
    const geo = strip(readFileSync(join(ROOT, 'world', 'geography.ts'), 'utf8'));
    expect(geo).toMatch(/from '\.\/land'/);
    // Ни одного собственного чтения атласа: всё, что из него выводится, живёт
    // в `land.ts`, иначе «одна реализация на две стороны» перестаёт быть правдой.
    expect(geo).not.toMatch(/atlasCell|atlasTerrain|ATLAS_RIVER|ATLAS_RIDGE/);
    const gen = strip(readFileSync(join(ROOT, 'world', 'gen.ts'), 'utf8'));
    expect(gen).toMatch(/from '\.\/settle'/);
    // Своего поиска дома у генерации больше нет: правило расселения одно.
    expect(gen).not.toMatch(/landShare|firstMainland|MAINLAND_MIN/);
  });
});
