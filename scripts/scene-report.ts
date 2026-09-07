/**
 * Что стоит игроку ожидание: запуск, генерация мира и вход на карту.
 *
 * Отчёт заведён под другой вопрос — «выгружать ли диораму на время карты» — и
 * ответил на него отрицательно: см. docs/loading.md, часть 2. Разделение сцен
 * откатано, а стенд остался: те же три величины надо знать и без него, и ровно
 * ими решается, нужен ли занавес на первом входе на карту.
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
 * Запуск: npm run scene:report   (нужен собранный dist: npm run build)
 * Переменные: ROUNDS=10  PORT=4190  CHROME=путь\к\chrome.exe  HEAD=1 (видимое окно)
 *
 * Chrome запускается со своим профилем, --enable-precise-memory-info (иначе
 * performance.memory округлён и разницу не поймать) и --js-flags=--expose-gc
 * (иначе «улеглось» — это надежда, а не факт).
 */
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
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

function chromePath(): string {
  if (process.env.CHROME) return process.env.CHROME;
  const guesses = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  const found = guesses.find((p) => p && existsSync(p));
  if (!found) throw new Error('не нашёл Chrome — укажи путь в CHROME=');
  return found;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Тонкий клиент CDP: одного соединения с вкладкой хватает на весь замер. */
class Tab {
  private id = 0;
  private waiting = new Map<number, { ok: (v: unknown) => void; bad: (e: Error) => void }>();

  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(String(e.data)) as {
        id?: number;
        method?: string;
        params?: { exceptionDetails?: { text: string; exception?: { description?: string } } };
        result?: unknown;
        error?: { message: string };
      };
      // Упавшее в странице обязано быть видно: молча падающая сцена выглядит как
      // «переход не кончился», и причину пришлось бы искать вслепую.
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params?.exceptionDetails;
        console.error('  в странице:', d?.exception?.description ?? d?.text);
      }
      if (msg.id === undefined) return;
      const slot = this.waiting.get(msg.id);
      if (!slot) return;
      this.waiting.delete(msg.id);
      if (msg.error) slot.bad(new Error(msg.error.message));
      else slot.ok(msg.result);
    });
  }

  static async open(wsUrl: string): Promise<Tab> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true });
      ws.addEventListener('error', () => reject(new Error('не открылось соединение с вкладкой')), { once: true });
    });
    return new Tab(ws);
  }

  send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = ++this.id;
    return new Promise<T>((ok, bad) => {
      this.waiting.set(id, { ok: ok as (v: unknown) => void, bad });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Выполняет выражение на странице и отдаёт разобранный JSON. */
  async eval<T>(expression: string): Promise<T> {
    const r = await this.send<{
      result: { value?: string };
      exceptionDetails?: { text: string; exception?: { description?: string } };
    }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    }
    return JSON.parse(r.result.value ?? 'null') as T;
  }

  /**
   * Сколько объектов этого класса ещё живо. Единственный честный ответ на вопрос
   * «утекает ли»: куча растёт и от кэшей, а вот вторая живая диорама — это уже
   * утечка и ничто другое. Так и нашлась та, что жила в игре всё время.
   */
  async alive(expression: string): Promise<number> {
    const proto = await this.send<{ result: { objectId?: string } }>('Runtime.evaluate', {
      expression: `${expression}.constructor.prototype`,
    });
    if (!proto.result.objectId) return -1;
    const found = await this.send<{ objects: { objectId: string } }>('Runtime.queryObjects', {
      prototypeObjectId: proto.result.objectId,
    });
    const n = await this.send<{ result: { value?: number } }>('Runtime.callFunctionOn', {
      objectId: found.objects.objectId,
      functionDeclaration: 'function () { return this.length; }',
      returnByValue: true,
    });
    return n.result.value ?? -1;
  }

  close(): void {
    this.ws.close();
  }
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
      curtain: g().curtain,
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
  curtain: string | null;
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
  const profile = join(process.env.TEMP ?? '/tmp', `tribe-scene-probe-${Date.now()}`);
  const chrome = spawn(
    chromePath(),
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profile}`,
      ...(process.env.HEAD === '1' ? [] : ['--headless=new']),
      '--enable-precise-memory-info',
      '--js-flags=--expose-gc',
      '--window-size=390,844',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--use-gl=angle',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  for (let i = 0; i < 80; i++) {
    try {
      await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      break;
    } catch {
      await sleep(250);
    }
  }
  try {
    return await measure();
  } finally {
    chrome.kill();
    await sleep(500);
  }
}

async function measure(): Promise<Probe> {
  const created = (await (
    await fetch(
      `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(`http://127.0.0.1:${PORT}/?probe=1`)}`,
      { method: 'PUT' },
    )
  ).json()) as { webSocketDebuggerUrl: string; id: string };
  const tab = await Tab.open(created.webSocketDebuggerUrl);
  await tab.send('Runtime.enable');
  await tab.send('Page.enable');
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
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${created.id}`);
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
      return v === null ? '—' : `${v} мс`;
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
    console.log(`    первый вызов                ${world.first.toFixed(1)} мс`);
    console.log(`    медиана из двенадцати       ${world.median.toFixed(1)} мс`);

    console.log('\n  Вход на карту и возврат (до нарисованного кадра)');
    console.log(`    первый вход за сессию       ${ms(p.firstOpen)} мс`);
    console.log(`    следующие входы, медиана    ${ms(median(p.opens))} мс   (${p.opens.map(ms).join(' ')})`);
    console.log(`    возврат домой, медиана      ${ms(median(p.closes))} мс   (${p.closes.map(ms).join(' ')})`);

    console.log('\n  Память');
    console.log(`    куча в деревне              ${mb(p.village)} МБ`);
    console.log(`    куча с открытой картой      ${mb(p.map)} МБ`);
    console.log(`    куча после кругов           ${mb(p.after)} МБ`);
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
