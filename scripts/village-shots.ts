// Снимки сцены игры — города — и цена её кадра по уровням качества.
//
// Это **стенд, а не отчёт**, как `map:shots`: он ничем не падает и ничего не утверждает.
// Вид судят глазами по снимкам, а цену кадра — по числам одного прогона: абсолютные
// миллисекунды видеокарты от захода к заходу гуляют (частота видеокарты под потолком
// кадров плавает), сравнивать можно только строки одного вывода.
//
// Что делает. Поднимает dev-сервер и настоящий Chrome (ANGLE), ставит экран телефона
// 390×844 @2 и открывает стенд сцены игры (`?showcase=village`, src/render/showcase.ts: настоящая
// сцена города на синтетической партии) с потолком кадров стенда. Дальше одно из двух:
//
//   снимки  — кадры «уровень × ракурс» в snaps/village/<TAG>-<уровень>-<ракурс>.png;
//   BENCH=1 — цена кадра по уровням подряд, в одном прогоне: вызовы и треугольники кадра
//             (с теневым проходом), время кадра на процессоре и на видеокарте (медиана и
//             p95, `EXT_disjoint_timer_query_webgl2`), буферы вершин и память текстур.
//
// Уровни — `low`, `medium`, `high` (город, docs/city.md); имя стенда прежнее — `village:shots`:
// посёлок игрока теперь рисуется городом. Прежние виды `now` и `next` убраны (docs/city.md,
// «Город — единственный вид»).
//
// Бюджет железа (CLAUDE.md, раздел ⛔): стенд, а не приёмка — один заход не дольше
// `BROWSER_MAX_MS`, потолок кадров стенда, рядом с чужой тяжёлой работой не запускается.
// Несколько уровней или ракурсов — отдельными короткими заходами с паузой между ними. Замер цены
// кадра — не больше трёх проходов (`PASSES`, `BENCH_PASSES_MAX`), и перед каждым проходом и
// заходом видеокарта остывает минуту от конца прошлого (`gpuCoolDown`; решение владельца,
// 01.10.2026). Уровень в `QUALITY` не повторяют: повтор — это второй проход без паузы.
//
// Запуск: npm run village:shots
// Переменные: QUALITY=low,medium,high  SHOTS=day-wide,night-wide,square-close,river-close (и другие ниже)
//             SEASON=summer  LEVELS=10  BENCH=1  PASSES=1..3  SECONDS=5  TAG=probe  PORT=4196  CDP_PORT=9339  HEAD=1
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite } from 'vite';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { qualityOf } from '../src/render/quality';
import { RACE, riverX } from '../src/render/city/layout';
import { BENCH_PASSES_MAX, BROWSER_MAX_MS, GPU_COOL_MS, REPORT_FPS, gpuCoolDown, gpuStamp, refuseIfBusy } from './lib/budget';

const OUT = fileURLToPath(new URL('../snaps/village', import.meta.url));
const PORT = Number(process.env.PORT ?? 4196);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9339);
const TAG = process.env.TAG ?? 'probe';
const SEASON = process.env.SEASON ?? 'summer';
const LEVELS = Number(process.env.LEVELS ?? 10);
const BENCH = process.env.BENCH === '1';
const SECONDS = Number(process.env.SECONDS ?? 5);
/** Проходов замера цены кадра: один, если не сказано; не больше `BENCH_PASSES_MAX` (бюджет железа). */
const PASSES = Number(process.env.PASSES ?? 1);
const list = (v: string | undefined, all: string[]): string[] => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : all);
const QUALITIES = list(process.env.QUALITY, ['low', 'medium', 'high']);

/** Экран телефона: тот, с которого владелец присылал снимки (390×844), плотность 2. */
const SCREEN = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

/**
 * Ракурсы. Общий план — кадр, с которого игра открывается; ближние — камера игры над точкой земли
 * города (метры) на полу приближения: тот же наклон и азимут, что у игрока, просто ближе.
 */
interface Shot {
  name: string;
  solar: number;
  /** Камера над точкой земли на полу приближения; без него — кадровая. */
  at?: [number, number];
  why: string;
}

/** Река у города: середина русла на высоте площади по долготе. */
const RIVER: [number, number] = [riverX(10), 10];
/** Мельничный ручей у лесопилки: середина отвода. */
const MILL: [number, number] = [RACE[3].x, RACE[3].z];

const SHOTS: Shot[] = [
  { name: 'day-wide', solar: 0.2, why: 'день, общий план — кадр, с которого открывается игра' },
  { name: 'night-wide', solar: 0.75, why: 'глубокая ночь, общий план' },
  { name: 'dusk-wide', solar: 0.47, why: 'золотой час перед закатом, общий план' },
  { name: 'dawn-wide', solar: 0.03, why: 'рассвет, общий план' },
  { name: 'square-close', solar: 0.2, at: [0, -2], why: 'площадь вблизи, день: рынок, колодец, ратуша, храм' },
  { name: 'street-close', solar: 0.2, at: [4, 70], why: 'Главная улица у южных ворот, день' },
  { name: 'gate-close', solar: 0.2, at: [0, 118], why: 'главные ворота, день' },
  { name: 'river-close', solar: 0.2, at: RIVER, why: 'река у города, день: вода, берега, камыш' },
  { name: 'river-night', solar: 0.75, at: RIVER, why: 'река у города, ночь: луна и огни в воде' },
  { name: 'mill-close', solar: 0.2, at: MILL, why: 'мельничный ручей у лесопилки, день' },
];

/** Ракурсы захода по умолчанию — общий план днём и ночью и два ближних. */
const DEFAULT_SHOTS = ['day-wide', 'night-wide', 'square-close', 'river-close'];

function pageUrl(quality: string, solar: number, at?: [number, number]): string {
  const q = new URLSearchParams({
    showcase: 'village',
    levels: String(LEVELS),
    season: SEASON,
    solar: String(solar),
    clean: '1',
    dpr: String(SCREEN.deviceScaleFactor),
    fpscap: String(REPORT_FPS),
    quality,
  });
  if (at) {
    q.set('at', `${at[0].toFixed(2)},${at[1].toFixed(2)}`);
    q.set('dist', 'min');
  }
  return `http://127.0.0.1:${PORT}/?${q.toString()}`;
}

/** Открыть страницу на экране телефона и дождаться, пока сцена скажет «готова» (город встал на полных слоях). */
async function open(url: string): Promise<Tab> {
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
  await tab.send('Page.navigate', { url });
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    const ready = await tab.eval<string>(`JSON.stringify(document.body?.dataset.ready ?? '')`).catch(() => '');
    if (ready === '1') break;
  }
  // Сезон и тени устаиваются за несколько кадров.
  await sleep(1500);
  return tab;
}

async function close(tab: Tab): Promise<void> {
  tab.close();
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`);
}

// ---------- Снимки ----------

async function shots(began: number): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const wanted = list(process.env.SHOTS, DEFAULT_SHOTS);
  for (const quality of QUALITIES) {
    for (const shot of SHOTS.filter((s) => wanted.includes(s.name))) {
      if (Date.now() - began > BROWSER_MAX_MS) {
        console.log(`\nСрок стенда (${BROWSER_MAX_MS / 1000} с) вышел — остальное отдельным заходом.`);
        return;
      }
      const tab = await open(pageUrl(quality, shot.solar, shot.at));
      try {
        const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
        const name = `${TAG}-${quality}-${shot.name}.png`;
        await writeFile(join(OUT, name), Buffer.from(png.data, 'base64'));
        console.log(`  ${quality.padEnd(8)} ${shot.name.padEnd(13)} → snaps/village/${name}`);
      } finally {
        await close(tab);
      }
    }
  }
  console.log('\nЧто чем отвечает:');
  for (const s of SHOTS) console.log(`  ${s.name.padEnd(13)} ${s.why}`);
}

// ---------- Цена кадра ----------

/**
 * Замер в странице. Кадры рисует сама сцена своей цепочкой под потолком стенда — стенд
 * не зовёт кадр ни разу, он только оборачивает его: процессорное время всего кадра и
 * время видеокарты на `render` (запросы времени копятся и снимаются по готовности, кадр
 * с «разрывом» видеокарты в счёт не идёт — как у стенда предыстории).
 *
 * Третье число — **кадр до конца видеокарты** (`sync`): после отрисовки стенд читает один пиксель
 * кадра (`readPixels` обязан дождаться конца отрисовки; `gl.finish` в Chrome видеокарту не ждёт —
 * проверено) и засекает время от начала кадра. Оно идёт за таймером видеокарты плюс около 3 мс:
 * таймер меряет настоящую работу, но при той частоте, на которой карта стоит сейчас, а частота у
 * GTX 1060 под потолком кадров прыгает от вида к виду (docs/graphics_world.md, 11.0 и 11.2).
 * Потолок кадров тот же, лишней работы нет — только ожидание.
 */
const PROBE = (ms: number): string => `
(async () => {
  const s = window.__stand;
  const gl = s.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const cpu = [];
  const gpu = [];
  const sync = [];
  const px = new Uint8Array(4);
  const pending = [];
  let calls = 0;
  let tris = 0;
  let q = null;
  let a0 = 0;
  let cpuNow = 0;
  const frame = s.frame;
  s.frame = function () { a0 = performance.now(); cpuNow = 0; frame.call(s); cpu.push(cpuNow || performance.now() - a0); };
  s.beforeRender = () => { if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); } };
  s.afterRender = () => {
    if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); q = null; }
    cpuNow = performance.now() - a0;
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    sync.push(performance.now() - a0);
    const st = s.stats();
    calls = Math.max(calls, st.calls);
    tris = Math.max(tris, st.triangles);
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      if (!gl.getQueryParameter(p, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(p);
      pending.splice(i, 1);
    }
  };
  await new Promise((r) => setTimeout(r, ${ms}));
  s.frame = frame;
  s.beforeRender = null;
  s.afterRender = null;
  const at = (a, k) => { const v = a.slice().sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * k))] : null; };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const mem = s.memory();
  return JSON.stringify({
    frames: cpu.length,
    cpu: [at(cpu, 0.5), at(cpu, 0.95)],
    gpu: ext ? [at(gpu, 0.5), at(gpu, 0.95)] : null,
    sync: [at(sync, 0.5), at(sync, 0.95)],
    calls,
    tris,
    geoMb: mem.bytes / 1048576,
    texMb: s.textureBytes() / 1048576,
    programs: mem.programs,
    buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    gpuName: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  });
})()
`;

interface Bench {
  frames: number;
  cpu: [number, number];
  gpu: [number, number] | null;
  /** Кадр до конца видеокарты: от начала кадра до чтения пикселя после отрисовки, медиана и p95. */
  sync: [number, number];
  calls: number;
  tris: number;
  geoMb: number;
  texMb: number;
  programs: number;
  buffer: [number, number];
  gpuName: string;
}

type Row = { quality: string; b: Bench };

/**
 * Прогрев перед замером прохода, секунды: самый тяжёлый уровень (`high`, если он в `QUALITY`) без замера.
 * Без прогрева уровень, мерянный первым после запуска браузера, выходил впятеро дешевле тех же чисел позже в
 * проходе (замер 01.10.2026, docs/graphics_world.md, 11.0). Прогрев убирает этот рывок, но не прыжки
 * частоты: разницу меньше десятков процентов способ не различает (11.0, 11.2).
 */
const WARMUP = Number(process.env.WARMUP ?? 8);

/**
 * Один проход замера: каждый уровень по разу. Порядок сдвигается от прохода к проходу (`pass`): остаток дрейфа
 * частоты ложится на разные уровни и гасится медианой сводки, а не копится на первом.
 */
async function benchPass(began: number, pass: number): Promise<Row[]> {
  const shift = pass % QUALITIES.length;
  const order = QUALITIES.slice(shift).concat(QUALITIES.slice(0, shift));
  const warm = await open(pageUrl(QUALITIES.includes('high') ? 'high' : order[0], 0.2));
  try {
    await sleep(WARMUP * 1000);
  } finally {
    await close(warm);
  }
  const rows: Row[] = [];
  for (const quality of order) {
    if (Date.now() - began > BROWSER_MAX_MS) {
      console.log(`\nСрок прохода (${BROWSER_MAX_MS / 1000} с) вышел — остальное отдельным заходом.`);
      break;
    }
    const tab = await open(pageUrl(quality, 0.2));
    try {
      rows.push({ quality, b: await tab.eval<Bench>(PROBE(SECONDS * 1000)) });
    } finally {
      await close(tab);
    }
  }
  return rows;
}

const f = (v: number | null | undefined, d = 2): string => (v === null || v === undefined ? '—' : v.toFixed(d));

const median = (a: number[]): number | null => {
  if (a.length === 0) return null;
  const s = a.slice().sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * Таблица каждого прохода и — если проходов больше одного — сводка: время кадра медианой по проходам и
 * отношение к среднему уровню **внутри прохода**, медианой. Частота видеокарты под потолком кадров гуляет от
 * прохода к проходу, и миллисекунды разных проходов не сравнимы, а отношение к среднему того же прохода —
 * сравнимо: средний в нём и мерка, и контроль (телефонный уровень).
 */
function printBench(passes: Row[][]): void {
  const first = passes.find((p) => p.length > 0);
  if (!first) return;
  console.log(
    `\nВидеокарта: ${first[0].b.gpuName}. Экран ${SCREEN.width}×${SCREEN.height} @${SCREEN.deviceScaleFactor}, потолок ${REPORT_FPS} кадров, ` +
      `${SECONDS} с на уровень, прогрев ${WARMUP} с; проходов ${passes.length}, порядок уровней сдвигается от прохода к проходу, между ними видеокарта остывает ${GPU_COOL_MS / 1000} с.`,
  );
  passes.forEach((rows, i) => {
    console.log(`\n${passes.length > 1 ? `проход ${i + 1}` : ''}`);
    console.log(
      `${'уровень'.padEnd(8)} ${'буфер'.padEnd(10)} ${'вызовов'.padStart(8)} ${'треуг.'.padStart(8)} ${'кадров'.padStart(7)} ` +
        `${'ЦП мед'.padStart(7)} ${'ЦП p95'.padStart(7)} ${'ВК мед'.padStart(7)} ${'ВК p95'.padStart(7)} ${'кадр мед'.padStart(8)} ${'кадр p95'.padStart(8)} ${'верш. МБ'.padStart(9)} ${'текст. МБ'.padStart(9)}`,
    );
    for (const { quality, b } of rows) {
      console.log(
        `${quality.padEnd(8)} ${`${b.buffer[0]}×${b.buffer[1]}`.padEnd(10)} ${String(b.calls).padStart(8)} ${String(b.tris).padStart(8)} ${String(b.frames).padStart(7)} ` +
          `${f(b.cpu[0]).padStart(7)} ${f(b.cpu[1]).padStart(7)} ${f(b.gpu?.[0]).padStart(7)} ${f(b.gpu?.[1]).padStart(7)} ${f(b.sync[0]).padStart(8)} ${f(b.sync[1]).padStart(8)} ${f(b.geoMb).padStart(9)} ${f(b.texMb).padStart(9)}`,
      );
    }
  });
  if (passes.length > 1) {
    console.log('\nСводка: медиана по проходам; к среднему — отношение внутри прохода, медиана (по проходам — через «/»).');
    const pick = (b: Bench, what: 'gpu' | 'sync'): number | null | undefined => (what === 'gpu' ? b.gpu?.[0] : b.sync[0]);
    for (const what of ['sync', 'gpu'] as const) {
      console.log(what === 'sync' ? 'кадр до конца видеокарты:' : 'таймер видеокарты:');
      for (const quality of QUALITIES) {
        const ms: number[] = [];
        const ratio: number[] = [];
        for (const rows of passes) {
          const row = rows.find((x) => x.quality === quality);
          const ref = rows.find((x) => x.quality === 'medium');
          const r = row && pick(row.b, what);
          const n = ref && pick(ref.b, what);
          if (r === undefined || r === null) continue;
          ms.push(r);
          if (n) ratio.push(r / n);
        }
        console.log(`  ${quality.padEnd(8)} мед ${f(median(ms)).padStart(6)}   к среднему ${f(median(ratio)).padStart(5)}   (${ratio.map((x) => f(x)).join(' / ')})`);
      }
    }
  }
  console.log('\nМиллисекунды сравнимы внутри прохода; между проходами — только отношением к среднему (шапка файла).');
}

async function main(): Promise<void> {
  // Бюджет железа (решение владельца, 01.10.2026): замер цены кадра — не больше трёх проходов, и между ними
  // видеокарта остывает. Повтор уровня в одном проходе — это второй проход без паузы.
  if (new Set(QUALITIES).size !== QUALITIES.length) {
    console.error(`\nУровень повторён в QUALITY — это второй проход без паузы. Проходы — PASSES=2 или 3: между ними видеокарта остывает ${GPU_COOL_MS / 1000} с.`);
    process.exit(2);
  }
  const bad = QUALITIES.filter((q) => qualityOf(q) === null);
  if (bad.length > 0) {
    console.error(`\nQUALITY=${process.env.QUALITY}: уровни — low, medium, high (не уровень: ${bad.join(', ')}).`);
    process.exit(2);
  }
  if (!Number.isInteger(PASSES) || PASSES < 1 || PASSES > BENCH_PASSES_MAX) {
    console.error(`\nPASSES=${process.env.PASSES}: проходов замера — от 1 до ${BENCH_PASSES_MAX} (бюджет железа).`);
    process.exit(2);
  }
  refuseIfBusy('Снимки города');
  const vite = await createVite({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  const passes: Row[][] = [];
  try {
    console.log(`\n=== город: ${BENCH ? 'цена кадра' : 'снимки'} (${QUALITIES.join(', ')}; ${SEASON}, уровень построек ${LEVELS}) ===\n`);
    for (let pass = 1; pass <= (BENCH ? PASSES : 1); pass++) {
      // Видеокарта остывает минуту после прошлого захода стенда и между проходами; браузер на это время закрыт.
      await gpuCoolDown(pass === 1 ? 'стендом города' : `проходом ${pass}`);
      const chrome = await launchChrome(DEBUG_PORT, ['--use-gl=angle', '--window-size=500,900', '--force-device-scale-factor=1']);
      try {
        const began = Date.now();
        if (BENCH) passes.push(await benchPass(began, pass - 1));
        else await shots(began);
      } finally {
        chrome.kill();
        gpuStamp();
      }
    }
    if (BENCH) printBench(passes);
  } finally {
    await vite.close();
    await sleep(300);
  }
}

void main();
