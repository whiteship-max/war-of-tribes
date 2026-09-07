/**
 * Замер разделения посёлка и карты.
 *
 * Отвечает на один вопрос, и отвечает числами: **стоило ли выгружать диораму на
 * время карты**. Это размен, а не улучшение — память освобождается, переход
 * замедляется, — и решать его надо замером, а не догадкой.
 *
 * Меряет обе стороны в одной сборке, на одной машине, в одну минуту:
 *
 *   было   — `?keepscene=1`: обе сцены живут разом (ровно прежнее поведение);
 *   стало  — без флага: диорама выгружается, на возврате собирается заново.
 *
 * Сравнение со старым коммитом ничего не доказало бы: между ними менялась не
 * только эта правка. Флаг `keepscene` заведён ради этого и остаётся в игре,
 * чтобы замер можно было повторить, когда сменятся телефоны.
 *
 * Что печатается:
 *
 *   память     куча после того, как всё улеглось (с настоящим GC, не «на глаз»),
 *              и байты вершинных буферов диорамы;
 *   переход    сколько идёт уход на карту и возврат — первый раз и потом;
 *   утечка     куча после десятка кругов туда-обратно.
 *
 * Запуск: npm run scene:report   (нужен собранный dist: npm run build)
 * Переменные: ROUNDS=10  PORT=4190  CHROME=путь\к\chrome.exe  HEAD=1 (видимое окно)
 *
 * Chrome запускается со своим профилем, --enable-precise-memory-info (иначе
 * performance.memory округлён до мегабайтов и разницу не поймать) и
 * --js-flags=--expose-gc (иначе «улеглось» — это надежда, а не факт).
 */
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

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
      // Упавшее в странице обязано быть видно: молча падающая сцена выглядит
      // как «занавес не поднялся», и искать причину пришлось бы вслепую.
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
   * Сколько объектов этого класса ещё живо. Единственный честный ответ на
   * вопрос «утекает ли»: куча растёт и от кэшей, а вот вторая живая диорама —
   * это уже утечка и ничто другое.
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
 * Тело замера. Живёт строкой, потому что выполняется в странице: это не код
 * игры и в бандл он не попадает ни при каком раскладе.
 */
/**
 * Что подкладывается в страницу. Не код игры: в бандл он не попадает ни при
 * каком раскладе, поэтому и живёт строкой.
 *
 * Страница только **отмечает время и меряет кучу**, а шаги ей задаёт node.
 * Так нарочно: ждать конца перехода изнутри страницы нельзя — опрос в тайтовом
 * цикле не даёт React'у выполнить эффект, которым новая сцена и поднимает
 * занавес, и замер вешает сам себя. Отметки при этом всё равно ставит страница:
 * из node видно только «уже поднялся», с ошибкой в целый опрос.
 */
const PROBE = `
(() => {
  const g = () => window.__game.getState();
  window.__t = { start: 0, end: 0 };
  window.__wraps = 0;
  new MutationObserver((recs) => {
    for (const r of recs) {
      for (const n of r.addedNodes) if (n.classList && n.classList.contains('canvas-wrap')) window.__wraps++;
    }
  }).observe(document.body, { childList: true, subtree: true });
  // Занавес поднимает тот, кто нарисовал первый кадр новой сцены. Обёртка вокруг
  // стора ловит этот момент точно, а не «когда мы в следующий раз посмотрели».
  const up = g().curtainUp;
  window.__game.setState({
    curtainUp: () => {
      if (g().curtain !== null) window.__t.end = performance.now();
      up();
    },
  });
  window.__go = (where) => {
    window.__t = { start: performance.now(), end: 0 };
    if (where === 'map') g().openMap();
    else g().closeMap();
    return JSON.stringify('ok');
  };
  window.__state = () =>
    JSON.stringify({
      curtain: g().curtain,
      map: g().mapOpen,
      took: window.__t.end ? window.__t.end - window.__t.start : 0,
      heap: performance.memory.usedJSHeapSize,
      wrap: !!document.querySelector('.canvas-wrap'),
      canvases: document.querySelectorAll('canvas').length,
      mem: window.__scene ? window.__scene.memory() : null,
      scenes: performance.getEntriesByType('mark').filter((m) => m.name === 'tribe-scene').length,
      wraps: window.__wraps,
    });
  // Настоящий GC, а не пауза в надежде: Chrome запущен с --expose-gc.
  window.__gc = () => {
    if (window.gc) window.gc();
    return JSON.stringify('ok');
  };
  return JSON.stringify('ok');
})()
`;

interface PageState {
  curtain: string | null;
  map: boolean;
  took: number;
  heap: number;
  wrap: boolean;
  canvases: number;
  mem: { geometries: number; textures: number; programs: number; bytes: number } | null;
  scenes: number;
  wraps: number;
}

interface Probe {
  keepscene: boolean;
  village: number;
  villageMem: PageState['mem'];
  map: number;
  sceneAlive: boolean;
  first: { to: number; back: number };
  to: number;
  back: number;
  toAll: number[];
  backAll: number[];
  after: number;
  canvases: number;
  scenesAlive: number;
  /** Все процессы Chrome вместе: куча, отрисовка и видеокарта. null — не Windows. */
  rssVillage: number | null;
  rssMap: number | null;
  gpuVillage: number | null;
  gpuMap: number | null;
}

/**
 * Сколько памяти занимают все процессы этого Chrome.
 *
 * Куча JavaScript отвечает только за половину вопроса: контекст WebGL живёт не в
 * ней. Буферы, кадровые буферы и драйверная обвязка лежат в процессе отрисовки и
 * в процессе видеокарты, а именно их и освобождает выгрузка диорамы. Считаем по
 * дереву процессов, отобранному по своему профилю: чужой Chrome сюда не попадёт.
 *
 * Только Windows; на других системах строка не печатается, а не врёт нулём.
 */
async function processBytes(profile: string, kind: 'all' | 'gpu' = 'all'): Promise<number | null> {
  if (process.platform !== 'win32') return null;
  // Подставляется в строку PowerShell в одинарных кавычках: там экранируется
  // только сам апостроф, обратный слэш — обычный символ.
  const escaped = profile.split("'").join("''");
  const also = kind === 'gpu' ? " -and $_.CommandLine -like '*--type=gpu-process*'" : '';
  const script = `(Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${escaped}*'${also} } | Measure-Object -Property WorkingSetSize -Sum).Sum`;
  return await new Promise((resolve) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    ps.stdout.on('data', (c) => (out += String(c)));
    ps.on('close', () => {
      const n = Number(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : null);
    });
    ps.on('error', () => resolve(null));
  });
}

const mb = (b: number): string => (b / 1048576).toFixed(2);
const ms = (v: number): string => Math.round(v).toString();
const median = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1];

/**
 * Один заход: свой Chrome, свой профиль, своя вкладка.
 *
 * Общий браузер на оба захода не годится: память первой вкладки не возвращается
 * мгновенно и второй заход меряет её остатки. Первые прогоны этого отчёта именно
 * так и скакали — «на карте 11 МБ» и «на карте 17 МБ» в соседних запусках.
 */
async function run(query: string): Promise<Probe> {
  const profile = join(process.env.TEMP ?? '/tmp', `tribe-scene-probe-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
    return await measure(query, profile);
  } finally {
    chrome.kill();
    await sleep(700);
  }
}

async function measure(query: string, profile: string): Promise<Probe> {
  const created = (await (
    await fetch(
      `http://127.0.0.1:${DEBUG_PORT}/json/new?${encodeURIComponent(`http://127.0.0.1:${PORT}/${query}`)}`,
      { method: 'PUT' },
    )
  ).json()) as { webSocketDebuggerUrl: string; id: string };
  const tab = await Tab.open(created.webSocketDebuggerUrl);
  await tab.send('Runtime.enable');
  await tab.send('Page.enable');
  // Сохранение общее на оба захода: без чистки второй играл бы другую партию,
  // а сравнивать надо одинаковые.
  await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} return JSON.stringify("ok"); })()');
  await tab.send('Page.reload');
  await sleep(3000);
  await tab.eval<string>(PROBE);

  const state = (): Promise<PageState> => tab.eval<PageState>('window.__state()');
  /** Куча, когда всё улеглось: несколько настоящих GC подряд, берём минимум. */
  const settled = async (): Promise<number> => {
    let min = Infinity;
    for (let i = 0; i < 8; i++) {
      await tab.eval<string>('window.__gc()');
      await sleep(220);
      min = Math.min(min, (await state()).heap);
    }
    return min;
  };
  /** Шаг перехода: даём команду и ждём, пока страница не отметит конец. */
  const go = async (where: 'map' | 'home'): Promise<number> => {
    await tab.eval<string>(`window.__go('${where}')`);
    for (let i = 0; i < 400; i++) {
      await sleep(25);
      const s = await state();
      if (s.curtain === null) return s.took;
    }
    throw new Error(`занавес не поднялся: ${JSON.stringify(await state())}`);
  };

  await sleep(1200);
  const out = {} as Probe;
  out.keepscene = query.includes('keepscene=1');
  out.village = await settled();
  out.villageMem = (await state()).mem;
  out.rssVillage = await processBytes(profile);
  out.gpuVillage = await processBytes(profile, 'gpu');

  // Первый переход дороже прочих: качается арт занавеса, пекутся куски карты,
  // компилируются шейдеры. Игрок его тоже видит, поэтому он в отчёте отдельно.
  const firstTo = await go('map');
  await sleep(1200);
  out.map = await settled();
  out.rssMap = await processBytes(profile);
  out.gpuMap = await processBytes(profile, 'gpu');
  out.sceneAlive = (await state()).wrap;
  const firstBack = await go('home');
  out.first = { to: firstTo, back: firstBack };

  const to: number[] = [];
  const back: number[] = [];
  for (let i = 0; i < ROUNDS; i++) {
    await sleep(300);
    to.push(await go('map'));
    await sleep(300);
    back.push(await go('home'));
  }
  out.to = median(to);
  out.back = median(back);
  out.toAll = to;
  out.backAll = back;

  out.after = await settled();
  out.canvases = (await state()).canvases;
  // Живых диорам обязана остаться ровно одна, сколько кругов ни сделай.
  out.scenesAlive = await tab.alive('window.__scene');

  tab.close();
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${created.id}`);
  return out;
}

async function main(): Promise<void> {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('нет dist/ — сначала npm run build');
  const server = serveDist();

  try {
    const split = await run('?probe=1');
    const both = await run('?probe=1&keepscene=1');

    const line = (name: string, a: string, b: string): void =>
      console.log(`  ${name.padEnd(34)} ${a.padStart(12)} ${b.padStart(12)}`);

    console.log('\nРАЗДЕЛЕНИЕ ПОСЁЛКА И КАРТЫ');
    console.log(`  кругов туда-обратно: ${ROUNDS}\n`);
    console.log(`  ${''.padEnd(34)} ${'было'.padStart(12)} ${'стало'.padStart(12)}`);
    console.log(`  ${''.padEnd(34)} ${'(обе сцены)'.padStart(12)} ${'(выгрузка)'.padStart(12)}`);
    console.log('  ' + '-'.repeat(60));
    line('куча в деревне, МБ', mb(both.village), mb(split.village));
    line('куча на карте, МБ', mb(both.map), mb(split.map));
    line('карта дороже деревни на, МБ', mb(both.map - both.village), mb(split.map - split.village));
    if (both.gpuVillage && split.gpuVillage && both.gpuMap && split.gpuMap) {
      // Процесс видеокарты: буферы вершин, теневая карта и кадровые буферы живут
      // здесь, а не в куче. Их-то и отдаёт выгрузка контекста WebGL.
      line('процесс видеокарты, деревня, МБ', mb(both.gpuVillage), mb(split.gpuVillage));
      line('процесс видеокарты, карта, МБ', mb(both.gpuMap), mb(split.gpuMap));
    }
    if (both.rssVillage && split.rssVillage && both.rssMap && split.rssMap) {
      line('весь Chrome в деревне, МБ', mb(both.rssVillage), mb(split.rssVillage));
      line('весь Chrome на карте, МБ', mb(both.rssMap), mb(split.rssMap));
    }
    line('диорама жива на карте', String(both.sceneAlive), String(split.sceneAlive));
    line('холстов на карте', '—', String(split.canvases));
    console.log('  ' + '-'.repeat(60));
    line('первый уход на карту, мс', ms(both.first.to), ms(split.first.to));
    line('первый возврат домой, мс', ms(both.first.back), ms(split.first.back));
    line('уход, медиана, мс', ms(both.to), ms(split.to));
    line('возврат, медиана, мс', ms(both.back), ms(split.back));
    console.log('  ' + '-'.repeat(60));
    line(`куча после ${ROUNDS} кругов, МБ`, mb(both.after), mb(split.after));
    line('живых диорам после кругов', String(both.scenesAlive), String(split.scenesAlive));
    line('прирост за круг, КБ', ((both.after - both.village) / ROUNDS / 1024).toFixed(0), ((split.after - split.village) / ROUNDS / 1024).toFixed(0));
    console.log('');
    if (split.villageMem) {
      const p = split.villageMem;
      console.log(`  вершинные буферы диорамы: ${mb(p.bytes)} МБ (${p.geometries} геометрий, ${p.textures} текстур, ${p.programs} программ)`);
    }
    console.log(`  уход, все замеры: ${split.toAll.map(ms).join(' ')}`);
    console.log(`  возврат, все замеры: ${split.backAll.map(ms).join(' ')}`);
    console.log('');
  } finally {
    server.close();
  }
}

await main();
