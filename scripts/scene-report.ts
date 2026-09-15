/**
 * Что стоит игроку ожидание: запуск, генерация мира и вход на карту.
 *
 * Отчёт заведён под другой вопрос — «выгружать ли диораму на время карты» — и
 * ответил на него отрицательно: см. docs/loading.md, часть 2. Разделение сцен
 * откатано, а стенд остался: те же три величины надо знать и без него. Ими же
 * решилось, что занавес на первом входе на карту не нужен: вход быстрее порога
 * его показа, и занавес убран.
 *
 * Меряется:
 *
 *   мир      генерация мира по сиду — чистая функция, считается прямо здесь,
 *            без браузера, поэтому число не зависит ни от кадров, ни от GC;
 *   запуск   отметки экрана загрузки (`tribe-code`… `tribe-ready`) в настоящем
 *            Chrome: докуда доехало время и где именно оно ушло;
 *   карта    первый вход на карту и все следующие — по кадру, а не по вызову:
 *            конец перехода это момент, когда полотно нарисовано;
 *   память   куча в деревне и с открытой картой, живых диорам после кругов.
 *
 * Всё, что меряется часами и кучей, стоит в выводе в `‹…›` (`lib/measured.ts`): это плавает от
 * прогона к прогону и при сверке не сравнивается. Остальное — число диорам, холстов,
 * геометрий, кругов — свойство кода и обязано совпасть буква в букву.
 *
 * Запуск: npm run scene:report   (нужен собранный dist: npm run build)
 * Переменные: ROUNDS=10  PORT=4190  CHROME=путь\к\chrome.exe  HEAD=1 (видимое окно)
 *
 * Chrome запускается со своим профилем, --enable-precise-memory-info (иначе
 * performance.memory округлён и разницу не поймать) и --js-flags=--expose-gc
 * (иначе «улеглось» — это надежда, а не факт).
 */
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { measure as live } from './lib/measured';
import { generateWorld } from '../src/world/gen';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const PORT = Number(process.env.PORT ?? 4190);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9333);
const ROUNDS = Number(process.env.ROUNDS ?? 10);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
};

function serveDist(): Server {
  return createServer(async (req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    let file = join(DIST, path === '/' ? 'index.html' : path.slice(1));
    try {
      if ((await stat(file)).isDirectory()) throw new Error('dir');
    } catch {
      file = join(DIST, 'index.html');
    }
    try {
      res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
      res.end(await readFile(file));
    } catch {
      res.statusCode = 404;
      res.end();
    }
  }).listen(PORT);
}

/**
 * Что подкладывается в страницу. Не код игры: в бандл он не попадает ни при
 * каком раскладе, поэтому и живёт строкой.
 *
 * Страница только **отмечает время**, а шаги ей задаёт node. Так нарочно: ждать
 * конца перехода изнутри страницы нельзя — опрос в тайтовом цикле не даёт React'у
 * выполнить эффект, а из node видно только «уже случилось», с ошибкой в целый опрос.
 *
 * Конец перехода — нарисованный кадр, а не возврат из `openMap`: между вызовом и
 * картинкой лежит вся выпечка земли, ради которой и меряем.
 */
const PROBE = `
(() => {
  const g = () => window.__game.getState();
  window.__t = 0;
  window.__go = (where) => {
    const t0 = performance.now();
    window.__t = 0;
    if (where === 'map') g().openMap();
    else g().closeMap();
    // Два кадра: первый вычисляет разметку после смены состояния, рисует второй.
    requestAnimationFrame(() => requestAnimationFrame(() => { window.__t = performance.now() - t0; }));
    return JSON.stringify('ok');
  };
  window.__state = () =>
    JSON.stringify({
      took: window.__t,
      map: g().mapOpen,
      heap: performance.memory.usedJSHeapSize,
      canvases: document.querySelectorAll('canvas').length,
      marks: performance.getEntriesByType('mark').map((m) => [m.name, Math.round(m.startTime)]),
      mem: window.__scene ? window.__scene.memory() : null,
    });
  window.__gc = () => {
    if (window.gc) window.gc();
    return JSON.stringify('ok');
  };
  return JSON.stringify('ok');
})()
`;

interface PageState {
  took: number;
  map: boolean;
  heap: number;
  canvases: number;
  marks: Array<[string, number]>;
  mem: { geometries: number; textures: number; programs: number; bytes: number } | null;
}

interface Probe {
  marks: Array<[string, number]>;
  village: number;
  villageMem: PageState['mem'];
  map: number;
  firstOpen: number;
  opens: number[];
  closes: number[];
  after: number;
  scenesAlive: number;
  canvases: number;
}

const mb = (b: number): string => (b / 1048576).toFixed(2);
const ms = (v: number): string => Math.round(v).toString();
const median = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1];

async function run(): Promise<Probe> {
  const chrome = await launchChrome(DEBUG_PORT, [
    '--enable-precise-memory-info',
    '--js-flags=--expose-gc',
    '--window-size=390,844',
    '--use-gl=angle',
  ]);
  try {
    return await measure();
  } finally {
    chrome.kill();
    await sleep(500);
  }
}

async function measure(): Promise<Probe> {
  const tab = await Tab.open(DEBUG_PORT, `http://127.0.0.1:${PORT}/?probe=1`);
  // Первый вход на карту бывает раз за сессию: сохранение и мир чистим, иначе
  // мерили бы вторую попытку.
  await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} return JSON.stringify("ok"); })()');
  await tab.send('Page.reload');
  await sleep(3500);
  await tab.eval<string>(PROBE);

  const state = (): Promise<PageState> => tab.eval<PageState>('window.__state()');
  const settled = async (): Promise<number> => {
    let min = Infinity;
    for (let i = 0; i < 8; i++) {
      await tab.eval<string>('window.__gc()');
      await sleep(220);
      min = Math.min(min, (await state()).heap);
    }
    return min;
  };
  const go = async (where: 'map' | 'home'): Promise<number> => {
    await tab.eval<string>(`window.__go('${where}')`);
    for (let i = 0; i < 400; i++) {
      await sleep(20);
      const s = await state();
      if (s.took > 0) return s.took;
    }
    throw new Error(`переход не кончился: ${JSON.stringify(await state())}`);
  };

  const out = {} as Probe;
  out.marks = (await state()).marks;
  out.village = await settled();
  out.villageMem = (await state()).mem;

  out.firstOpen = await go('map');
  await sleep(1200);
  out.map = await settled();
  await go('home');

  const opens: number[] = [];
  const closes: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    await sleep(250);
    opens.push(await go('map'));
    await sleep(250);
    closes.push(await go('home'));
  }
  out.opens = opens;
  out.closes = closes;
  out.after = await settled();
  out.scenesAlive = await tab.alive('window.__scene');
  out.canvases = (await state()).canvases;

  tab.close();
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`);
  return out;
}

/** Генерация мира — чистая функция от сида, браузер для неё не нужен. */
function worldTiming(): { first: number; median: number } {
  const times: number[] = [];
  for (let i = 0; i < 12; i++) {
    const t0 = performance.now();
    generateWorld(1000 + i);
    times.push(performance.now() - t0);
  }
  return { first: times[0], median: median(times) };
}

async function main(): Promise<void> {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('нет dist/ — сначала npm run build');
  const server = serveDist();
  try {
    const world = worldTiming();
    const p = await run();

    const at = (name: string): number | null => p.marks.find((m) => m[0] === name)?.[1] ?? null;
    const stage = (name: string): string => {
      const v = at(name);
      return v === null ? '—' : `${live(v)} мс`;
    };

    console.log('\nОЖИДАНИЕ: ЗАПУСК, МИР, КАРТА');
    console.log(`  кругов на карту и обратно: ${ROUNDS}\n`);

    console.log('  Запуск (отметки экрана загрузки, от открытия страницы)');
    console.log(`    код на месте, экран живой   ${stage('tribe-code')}`);
    console.log(`    читаем сохранение           ${stage('tribe-save')}`);
    console.log(`    считаем офлайн              ${stage('tribe-offline')}`);
    console.log(`    собираем диораму            ${stage('tribe-scene')}`);
    console.log(`    готово                      ${stage('tribe-ready')}`);

    console.log('\n  Генерация мира (чистая функция, без браузера)');
    console.log(`    первый вызов                ${live(world.first.toFixed(1))} мс`);
    console.log(`    медиана из двенадцати       ${live(world.median.toFixed(1))} мс`);

    console.log('\n  Вход на карту и возврат (до нарисованного кадра)');
    console.log(`    первый вход за сессию       ${live(ms(p.firstOpen))} мс`);
    console.log(`    следующие входы, медиана    ${live(ms(median(p.opens)))} мс   (${live(p.opens.map(ms).join(' '))})`);
    console.log(`    возврат домой, медиана      ${live(ms(median(p.closes)))} мс   (${live(p.closes.map(ms).join(' '))})`);

    console.log('\n  Память');
    console.log(`    куча в деревне              ${live(mb(p.village))} МБ`);
    console.log(`    куча с открытой картой      ${live(mb(p.map))} МБ`);
    console.log(`    куча после кругов           ${live(mb(p.after))} МБ`);
    console.log(`    живых диорам                ${p.scenesAlive}   (обязана быть одна)`);
    console.log(`    холстов                     ${p.canvases}`);
    if (p.villageMem) {
      const m = p.villageMem;
      console.log(`    вершинные буферы диорамы    ${mb(m.bytes)} МБ (${m.geometries} геометрий, ${m.textures} текстур)`);
    }
    console.log('');
  } finally {
    server.close();
  }
}

await main();
