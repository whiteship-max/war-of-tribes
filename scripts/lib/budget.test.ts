/**
 * Бюджет железа (CLAUDE.md): машина владельца — не сервер. Здесь — то, что правило держит кодом:
 * сколько ядер берёт прогон, что потолок кадров не снимает ни один скрипт и что ядра берут из
 * одного места, а не каждый себе.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { BROWSER_MAX_MS, CORE_SHARE, FREE_LOAD, HEAVY_PAUSE_MS, REPORT_DPR, REPORT_FPS, UNCAPPED, budgetCores, foreignRuns, heavyWork } from './budget';
import { FPS_CAP } from '../../src/render/loop';

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
  it('прогон берёт не больше половины ядер и хотя бы одно', () => {
    // Решение владельца 29.09.2026: 6 из 12 — после выключения машины от перегрева под 8 из 12.
    expect(CORE_SHARE).toBeCloseTo(1 / 2, 12);
    for (let n = 1; n <= 64; n++) {
      const k = budgetCores(n);
      expect(k).toBeGreaterThanOrEqual(1);
      if (n >= 2) expect(k).toBeLessThanOrEqual(n / 2);
    }
    expect(budgetCores(12)).toBe(6);
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
    expect(src).toMatch(/await waitUntilFree\(/);
  });

  it('страница отчёта рисует с потолком отчёта — кроме того, кто меряет сам кадр', () => {
    // Потолок отчёта ниже игры, плотность — единица; нужно больше — сказано у чисел (`budget.ts`). Кадр игры меряет один
    // `map`, и только у него адрес без потолка — с объяснением рядом.
    expect(REPORT_FPS).toBeLessThan(FPS_CAP);
    expect(REPORT_DPR).toBe(1);
    const chrome = strip(readFileSync(join(ROOT, 'scripts', 'lib', 'chrome.ts'), 'utf8'));
    expect(chrome).toMatch(/fpscap=\$\{REPORT_FPS\}/);
    for (const name of ['tap', 'scene', 'revive']) {
      const src = strip(readFileSync(join(ROOT, 'scripts', `${name}-report.ts`), 'utf8'));
      expect(src, `${name}: адрес игры без потолка отчёта`).not.toMatch(/\/\?probe=1/);
      expect(src, `${name}: адрес игры не через reportPage`).toMatch(/Tab\.open\(DEBUG_PORT, reportPage\(/);
    }
  });

  it('тяжёлая чужая работа узнаётся: рендер, ffmpeg, сборка, прогон, браузер для замеров', () => {
    const p = (name: string, cmd: string) => ({ pid: 7, ppid: 1, name, cmd });
    expect(heavyWork(p('ffmpeg.exe', 'ffmpeg -i frames/%05d.png out.mp4'))).toMatch(/ffmpeg/);
    // Рендер ролика другой сессии шёл ровно так — `node render.mjs` в своей папке, — и рядом с ним машина перегрелась.
    expect(heavyWork(p('node.exe', '"C:/Program Files/nodejs/node.exe" render.mjs --out reel'))).toMatch(/рендер/);
    expect(heavyWork(p('node.exe', 'node C:/work/reel/render-frames.mjs'))).toMatch(/рендер/);
    expect(heavyWork(p('node.exe', 'node scripts/prerender.mjs'))).toBeNull();
    expect(heavyWork(p('node.exe', 'node node_modules/vite/bin/vite.js build'))).toMatch(/сборка/);
    expect(heavyWork(p('node.exe', 'node scripts/build.mjs'))).toMatch(/сборка/);
    expect(heavyWork(p('node.exe', 'node node_modules/typescript/bin/tsc --noEmit'))).toMatch(/сборка/);
    expect(heavyWork(p('node.exe', 'node node_modules/vite-node/vite-node.mjs scripts/pop-report.ts'))).toMatch(/прогон/);
    expect(heavyWork(p('chrome.exe', 'chrome.exe --headless=new --user-data-dir=x about:blank'))).toMatch(/браузер/);
    expect(heavyWork(p('chrome.exe', 'chrome.exe --remote-debugging-port=9333 about:blank'))).toMatch(/браузер/);
    // Своё и чужое повседневное — не тяжёлая работа: браузер владельца, его вкладки, дев-сервер.
    expect(heavyWork(p('chrome.exe', 'chrome.exe --type=renderer --remote-debugging-port=9333'))).toBeNull();
    expect(heavyWork(p('chrome.exe', '"C:/Program Files/Google/Chrome/Application/chrome.exe"'))).toBeNull();
    expect(heavyWork(p('node.exe', 'node node_modules/vite/bin/vite.js --host'))).toBeNull();
    expect(FREE_LOAD).toBeLessThanOrEqual(1 - CORE_SHARE);
  });

  it('свой прогон себе не чужой: потомки процесса не мешают ему начать', async () => {
    // Приёмка проверяет машину и посреди прогона — перед каждым новым отчётом, — и её собственные отчёты при этом идут:
    // их она обязана не видеть. Потомок назван так, что будь он чужим, его узнали бы прогоном.
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)', 'vite-node'], { stdio: 'ignore' });
    try {
      await new Promise((r) => setTimeout(r, 300));
      const found = foreignRuns();
      expect(found.some((f) => f.includes(`${child.pid}`)), found.join('; ')).toBe(false);
    } finally {
      child.kill();
    }
  }, 30_000);

  it('прогон стенда сцены — не дольше двух минут подряд', () => {
    expect(BROWSER_MAX_MS).toBe(2 * 60_000);
  });

  it('браузерные отчёты приёмки — по одному и с паузой перед каждым, и на базе тоже', () => {
    const src = strip(readFileSync(join(ROOT, 'scripts', 'reports.ts'), 'utf8'));
    expect(HEAVY_PAUSE_MS).toBeGreaterThan(0);
    // Свой прогон: цикл по браузерным с паузой, а не Promise.all.
    expect(src).toMatch(/for \(const \[i, o\] of selected\.filter\(browser\)\.entries\(\)\) \{\s*if \(i > 0 \|\| counting\.length > 0\) await coolDown\(/);
    // База во втором worktree: пауза перед браузерным и веер в бюджете ядер.
    expect(src).toMatch(/await coolDown\(`базой/);
    expect(src).toMatch(/TRIBE_FAN: String\(budgetCores\(\)\)/);
  });
});
