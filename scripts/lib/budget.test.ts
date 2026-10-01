/**
 * Бюджет железа (CLAUDE.md): машина владельца — не сервер. Здесь — то, что правило держит кодом:
 * сколько ядер берёт прогон, что потолок кадров не снимает ни один скрипт и что ядра берут из
 * одного места, а не каждый себе.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import {
  BENCH_PASSES_MAX,
  BROWSER_MAX_MS,
  CORE_SHARE,
  FREE_LOAD,
  GPU_COOL_MS,
  HEAVY_PAUSE_MS,
  REPORT_DPR,
  REPORT_FPS,
  UNCAPPED,
  budgetCores,
  busyWords,
  foreignRuns,
  gpuRest,
  heavyWork,
} from './budget';
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
  it('прогон берёт не больше трети ядер и хотя бы одно', () => {
    // Решение владельца 01.10.2026: 4 из 12, «не 6» — машина уже выключалась от перегрева (29.09.2026 — под 8 из 12;
    // после того была половина).
    expect(CORE_SHARE).toBeCloseTo(1 / 3, 12);
    for (let n = 1; n <= 64; n++) {
      const k = budgetCores(n);
      expect(k).toBeGreaterThanOrEqual(1);
      if (n >= 3) expect(k).toBeLessThanOrEqual(n / 3);
    }
    expect(budgetCores(12)).toBe(4);
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
    expect(src).toMatch(/await holdMachine\(/);
    // `holdMachine` — проверка машины и замок, а не одно из двух.
    const budget = strip(readFileSync(join(ROOT, 'scripts', 'lib', 'budget.ts'), 'utf8'));
    expect(budget).toMatch(/export async function holdMachine\([^)]*\)[^{]*\{\s*await waitUntilFree\(what, options\);\s*return lockMachine\(/);
  });

  it('тяжёлая работа берёт замок машины: приёмка, веер, браузер, сборка, тесты', () => {
    // Замок один на все проекты владельца (`machinelock.mjs`): 29.09.2026 машина выключилась, пока приёмка шла рядом с
    // рендером другого проекта, которого бюджет этого проекта не видел.
    const src = (f: string): string => strip(readFileSync(join(ROOT, f), 'utf8'));
    expect(src('scripts/reports.ts')).toMatch(/await holdMachine\('Приёмка отчётами'/);
    expect(src('scripts/lib/fan.ts')).toMatch(/if \(!process\.env\[CHILD\]\) await lockMachine\(/);
    expect(src('scripts/lib/chrome.ts')).toMatch(/await holdMachine\('Стендовый браузер'/);
    expect(src('scripts/build.mjs')).toMatch(/await takeLock\('war-of-tribes', 'сборка'\)/);
    expect(src('vite.config.ts')).toMatch(/globalSetup:\s*\['\.\/scripts\/lib\/testlock\.ts'\]/);
    expect(src('scripts/lib/testlock.ts')).toMatch(/return lockMachine\('тесты'\)/);
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

  it('«сними руками» — только когда машину держит чужой процесс, а не одна её загрузка', () => {
    // Снять руками можно процесс, висящий от прерванного прогона; загрузку машины снимать нечем, и совет там — неправда
    // (docs/battle_eu4.md, 14.35). Граница области: ожидание есть в обоих случаях — строка «ждёт» печатается.
    const hint = /сними его руками/;
    const byLoad = busyWords('Приёмка', [], 'машина занята на 40 % (свободна — ниже 25 %)');
    expect(byLoad[0], 'ожидание есть').toMatch(/ждёт/);
    expect(byLoad.some((l) => hint.test(l)), 'держит одна загрузка — совета нет').toBe(false);
    const byRun = busyWords('Приёмка', ['ffmpeg 7 — рендер видео'], null);
    expect(byRun[0], 'ожидание есть').toMatch(/ждёт/);
    expect(byRun.some((l) => hint.test(l)), 'держит чужой процесс — совет есть').toBe(true);
  });

  it('прогон стенда сцены — не дольше двух минут подряд', () => {
    expect(BROWSER_MAX_MS).toBe(2 * 60_000);
  });

  it('замер цены кадра: не больше трёх проходов, и видеокарта остывает минуту после прошлого захода', () => {
    // Решение владельца 01.10.2026. Граница области: внутри минуты от конца прошлого захода — ждать остаток, за ней —
    // не ждать; отметки нет — не ждать.
    expect(BENCH_PASSES_MAX).toBe(3);
    expect(GPU_COOL_MS).toBe(60_000);
    const end = 1_000_000;
    expect(gpuRest(end, end), 'сразу после захода — вся минута').toBe(GPU_COOL_MS);
    expect(gpuRest(end, end + 45_000), 'через 45 с — остаток').toBe(15_000);
    expect(gpuRest(end, end + GPU_COOL_MS), 'через минуту — не ждать').toBe(0);
    expect(gpuRest(null, end), 'стенд не шёл — не ждать').toBe(0);
    // Часы ушли назад (отметка из будущего) — ждать не больше минуты, а не вечно.
    expect(gpuRest(end + 10 * GPU_COOL_MS, end)).toBe(GPU_COOL_MS);
    // Стенд посёлка держит правило сам: пауза перед заходом и между проходами, проходов не больше трёх, повтор вида в
    // одном проходе — запрещён (это второй проход без паузы).
    const shots = strip(readFileSync(join(ROOT, 'scripts', 'village-shots.ts'), 'utf8'));
    expect(shots).toMatch(/await gpuCoolDown\(/);
    expect(shots).toMatch(/gpuStamp\(\)/);
    expect(shots).toMatch(/BENCH_PASSES_MAX/);
    expect(shots).toMatch(/new Set\(LOOKS\)\.size !== LOOKS\.length/);
    // Стенд ролика (`replay:shots`) — тот же порядок: отказ рядом с чужим, пауза перед заходом, отметка конца, срок захода.
    const replay = strip(readFileSync(join(ROOT, 'scripts', 'replay-shots.ts'), 'utf8'));
    expect(replay).toMatch(/refuseIfBusy\(/);
    expect(replay).toMatch(/await gpuCoolDown\(/);
    expect(replay).toMatch(/gpuStamp\(\)/);
    expect(replay).toMatch(/Date\.now\(\) - began > BROWSER_MAX_MS/);
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
