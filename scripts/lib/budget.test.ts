/**
 * Бюджет железа (CLAUDE.md): машина владельца — не сервер. Здесь — то, что правило держит кодом:
 * сколько ядер берёт прогон, что потолок кадров не снимает ни один скрипт и что ядра берут из
 * одного места, а не каждый себе.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BROWSER_MAX_MS, CORE_SHARE, UNCAPPED, budgetCores } from './budget';

const ROOT = join(__dirname, '..', '..');

const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js)$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p);
  }
  return out;
};

describe('ядра', () => {
  it('прогон берёт не больше двух третей ядер и хотя бы одно', () => {
    expect(CORE_SHARE).toBeCloseTo(2 / 3, 12);
    for (let n = 1; n <= 64; n++) {
      const k = budgetCores(n);
      expect(k).toBeGreaterThanOrEqual(1);
      if (n >= 2) expect(k).toBeLessThanOrEqual((n * 2) / 3);
    }
    expect(budgetCores(12)).toBe(8);
  });

  it('все ядра себе не берёт никто: ни тесты, ни веер, ни приёмка', () => {
    // Счёт ядер в обход бюджета — `availableParallelism()` или `cpus()`, за которыми не стоит
    // `budgetCores`, — и есть «сколько ядер, столько и работников», запрещённое правилом.
    const files = [...walk(join(ROOT, 'scripts')), join(ROOT, 'vite.config.ts')];
    const bad: string[] = [];
    for (const f of files) {
      if (f.endsWith(join('lib', 'budget.ts'))) continue;
      const src = strip(readFileSync(f, 'utf8'));
      for (const m of src.matchAll(/availableParallelism\(\)|cpus\(\)/g)) {
        const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index));
        if (!/budgetCores\(|const cores = availableParallelism\(\);/.test(line)) bad.push(`${f}: ${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
    expect(strip(readFileSync(join(ROOT, 'vite.config.ts'), 'utf8'))).toMatch(/maxWorkers:\s*budgetCores\(\)/);
    expect(strip(readFileSync(join(ROOT, 'scripts', 'reports.ts'), 'utf8'))).toMatch(/const width = budgetCores\(cores\)/);
  });
});

describe('браузер', () => {
  it('ни один скрипт не снимает потолок кадров', () => {
    const bad: string[] = [];
    for (const f of walk(join(ROOT, 'scripts'))) {
      if (f.endsWith(join('lib', 'budget.ts'))) continue;
      const src = strip(readFileSync(f, 'utf8'));
      for (const flag of UNCAPPED) if (src.includes(flag)) bad.push(`${f}: ${flag}`);
    }
    expect(bad).toEqual([]);
  });

  it('стендовый браузер поднимается только через проверку потолка и чужих прогонов', () => {
    const src = strip(readFileSync(join(ROOT, 'scripts', 'lib', 'chrome.ts'), 'utf8'));
    expect(src).toMatch(/UNCAPPED\.includes/);
    expect(src).toMatch(/refuseIfBusy\(/);
  });

  it('прогон стенда — не дольше двух минут подряд', () => {
    expect(BROWSER_MAX_MS).toBe(2 * 60_000);
  });
});
