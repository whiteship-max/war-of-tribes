// Имена файлов без учёта регистра (docs/city_v3.md, Г-8, 5): дома на Windows файловая система не различает регистр, и импорт
// без расширения `./Talk` находил `talk.ts` рядом с `Talk.tsx` — typecheck и сборка падали дома, а в облаке (Linux) всё было
// зелёным (слияние Г-5…Г-7, `22b0de3`). Тест держит это в `src/` и `scripts/`: в одной папке нет двух записей, которые импорт
// без расширения найдёт под одним именем без учёта регистра.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');

/** Имя без последнего расширения — то, что пишут в импорте (`./Talk` — и `Talk.tsx`, и `talk.ts`). */
export const stemOf = (name: string): string => name.replace(/\.[^.]+$/, '');

/**
 * Что импорт находит без расширения: модули, что сборщик и TypeScript подставляют сами (`resolve.extensions` Vite), и папки
 * (`./icons` — `icons/index.ts`). Стиль и картинку импортируют с расширением — `Prologue.tsx` рядом с `prologue.css` не спор.
 */
const IMPLICIT = /\.(m?[jt]sx?|mts|json)$/;

/** Пары записей одной папки, которые на Windows — одно имя: имена без расширения равны без учёта регистра, а с ним — нет. */
export function caseClashes(names: readonly string[], dirs: ReadonlySet<string> = new Set()): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const [x, y] = [names[i], names[j]];
      // Одинаковые до буквы с разным регистром целиком (`a.ts` и `A.ts`, `a.css` и `A.css`) — одно на Windows всегда.
      if (x !== y && x.toLowerCase() === y.toLowerCase()) {
        out.push([x, y]);
        continue;
      }
      const lookup = (n: string): boolean => dirs.has(n) || IMPLICIT.test(n);
      if (!lookup(x) || !lookup(y)) continue;
      const a = dirs.has(x) ? x : stemOf(x);
      const b = dirs.has(y) ? y : stemOf(y);
      if (a !== b && a.toLowerCase() === b.toLowerCase()) out.push([x, y]);
    }
  }
  return out;
}

/** Все папки дерева с их записями (файлы и подпапки), без `node_modules` и скрытых. */
function walk(dir: string, into: Map<string, { names: string[]; dirs: Set<string> }>): void {
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules');
  into.set(dir, { names: entries.map((e) => e.name), dirs: new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name)) });
  for (const e of entries) if (e.isDirectory()) walk(join(dir, e.name), into);
}

describe('имена файлов — одни и на Windows', () => {
  it('пара «Talk.tsx / talk.ts» — столкновение, «tex.ts / tex.worker.ts» и «Prologue.tsx / prologue.css» — нет', () => {
    expect(caseClashes(['Talk.tsx', 'talk.ts'])).toEqual([['Talk.tsx', 'talk.ts']]);
    expect(caseClashes(['Icons', 'icons.ts'], new Set(['Icons']))).toEqual([['Icons', 'icons.ts']]);
    expect(caseClashes(['a.ts', 'A.ts'])).toEqual([['a.ts', 'A.ts']]);
    expect(caseClashes(['tex.ts', 'tex.worker.ts', 'deeds.ts', 'deeds.css', 'deeds.test.ts', 'Prologue.tsx', 'prologue.css'])).toEqual([]);
  });

  it('в src/ и scripts/ нет двух записей одной папки, чьи имена совпадают без учёта регистра', () => {
    const dirs = new Map<string, { names: string[]; dirs: Set<string> }>();
    for (const top of ['src', 'scripts']) walk(join(ROOT, top), dirs);
    // Граница области: обойдены обе папки и в них сотни записей.
    expect(dirs.size).toBeGreaterThan(40);
    expect([...dirs.values()].reduce((n, l) => n + l.names.length, 0)).toBeGreaterThan(500);
    const found: string[] = [];
    for (const [dir, e] of dirs) for (const [a, b] of caseClashes(e.names, e.dirs)) found.push(`${dir.slice(ROOT.length + 1)}: ${a} / ${b}`);
    expect(found).toEqual([]);
  });
});
