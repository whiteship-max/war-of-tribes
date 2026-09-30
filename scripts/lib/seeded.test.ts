// Отчёт повторим, только если всё случайное в нём — от закреплённого сида. Игра берёт корень сида у устройства
// законно: новая партия и новый мир — `sim/random.freshSeed` (CLAUDE.md, «Правила»). В `scripts/` новой партии нет,
// и тот же корень делает два прогона одного кода разными: `createInitialState()` без довода даёт партии сид из
// `crypto`, от него — отметки полководца (`sim/agents.pipsAt`), и совместный удар в `siege:report` на одном коде
// давал 95 / 71 / 29 %, 95 / 67 / 33 % и 86 / 43 / 10 % (docs/remeasure.md, «Пауза»). До этого теста находку чинили
// по месту пять раз — `autopilot`, `log`, `pop`, `pop-upkeep`, `time`, — и она возвращалась в следующем отчёте.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './setup';

const SCRIPTS = path.join(ROOT, 'scripts');

/** Исходники `scripts/`, кроме тестов: тест вправе звать корень сида, чтобы проверить его. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...sources(abs));
    else if (/\.(ts|mts|mjs|js)$/.test(name) && !/\.test\.(ts|mts|mjs|js)$/.test(name)) out.push(abs);
  }
  return out;
}

/** Текст без комментариев, с сохранёнными переводами строк — чтобы номер строки находки был настоящим. */
const code = (abs: string): string =>
  readFileSync(abs, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

/** Корни случайности устройства: партия без сида, сам корень, `Math.random`. */
const ROOTS: [string, RegExp][] = [
  ['createInitialState() без сида', /\bcreateInitialState\(\s*\)/g],
  ['freshSeed()', /\bfreshSeed\s*\(/g],
  ['Math.random', /\bMath\.random\b/g],
];

function findings(): string[] {
  const out: string[] = [];
  for (const abs of sources(SCRIPTS)) {
    const src = code(abs);
    const file = path.relative(ROOT, abs).split(path.sep).join('/');
    for (const [what, re] of ROOTS) {
      for (const m of src.matchAll(re)) out.push(`${file}:${src.slice(0, m.index).split('\n').length} — ${what}`);
    }
  }
  return out;
}

describe('отчёты повторимы: в scripts/ нет корня случайности устройства', () => {
  it('партия создаётся с явным сидом, freshSeed и Math.random не зовутся', () => {
    // Точка внутри области: партий в scripts/ создаётся много, иначе правило не спрашивается.
    const made = sources(SCRIPTS).reduce((n, f) => n + [...code(f).matchAll(/\bcreateInitialState\(/g)].length, 0);
    expect(made, 'в scripts/ создаются партии').toBeGreaterThan(10);
    expect(findings()).toEqual([]);
  });
});
