// Снимки посёлка и цена его кадра: нынешний вид против пробы окружения.
//
// Это **стенд, а не отчёт**, как `map:shots`: он ничем не падает и ничего не утверждает.
// Вид судят глазами по снимкам, а цену кадра — по числам одного прогона: абсолютные
// миллисекунды видеокарты от захода к заходу гуляют (частота видеокарты под потолком
// кадров плавает), сравнивать можно только строки одного вывода.
//
// Что делает. Поднимает dev-сервер и настоящий Chrome (ANGLE), ставит экран телефона
// 390×844 @2 и открывает стенд-витрину посёлка (`?showcase=village`, src/render/showcase.ts)
// с потолком кадров стенда. Дальше одно из двух:
//
//   снимки  — кадры «вид × ракурс» в snaps/village/<TAG>-<вид>-<ракурс>.png;
//   BENCH=1 — цена кадра по видам подряд, в одном прогоне: вызовы и треугольники кадра
//             (с теневым проходом), время кадра на процессоре и на видеокарте (медиана и
//             p95, `EXT_disjoint_timer_query_webgl2`), буферы вершин и память текстур.
//
// Виды: `now` — нынешний (его видит игрок), `next:<уровень>` — проба окружения
// (docs/graphics_world.md) на уровне качества high | medium | low.
//
// Бюджет железа (CLAUDE.md, раздел ⛔): стенд, а не приёмка — один заход не дольше
// `BROWSER_MAX_MS`, потолок кадров стенда, рядом с чужой тяжёлой работой не запускается.
// Несколько видов или ракурсов — отдельными короткими заходами с паузой между ними. Замер цены
// кадра — не больше трёх проходов (`PASSES`, `BENCH_PASSES_MAX`), и перед каждым проходом и
// заходом видеокарта остывает минуту от конца прошлого (`gpuCoolDown`; решение владельца,
// 01.10.2026). Вид в `LOOKS` не повторяют: повтор — это второй проход без паузы.
//
// Запуск: npm run village:shots
// Переменные: LOOKS=now,next:high,next:low  SHOTS=day-wide,night-wide,day-close,night-close (и dusk-wide, dawn-wide)
//             SEASON=summer  LEVELS=10  BENCH=1  PASSES=1..3  SECONDS=5  TAG=probe  PORT=4196  CDP_PORT=9339  HEAD=1
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite } from 'vite';
import { launchChrome, sleep, Tab } from './lib/chrome';
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
const LOOKS = list(process.env.LOOKS, ['now', 'next:high', 'next:low']);

/** Экран телефона: тот, с которого владелец присылал снимки (390×844), плотность 2. */
const SCREEN = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

/**
 * Ракурсы. Общий план — кадр, с которого игра открывается; ближний — участок за
 * частоколом на пустом лугу между воротами и фермой (угол 95°, радиус 21: там нет
 * дворов — видна земля, трава, опушка и полоса вырубки), на полу приближения.
 */
interface Shot {
  name: string;
  solar: number;
  /** Камера над точкой земли на полу приближения; без него — кадровая. */
  at?: [number, number];
  why: string;
}

const CLOSE: [number, number] = [Math.cos((95 * Math.PI) / 180) * 21, Math.sin((95 * Math.PI) / 180) * 21];

const SHOTS: Shot[] = [
  { name: 'day-wide', solar: 0.2, why: 'день, общий план — кадр, с которого открывается игра' },
  { name: 'night-wide', solar: 0.75, why: 'глубокая ночь, общий план' },
  { name: 'day-close', solar: 0.2, at: CLOSE, why: 'день, участок за частоколом на полу приближения' },
  { name: 'night-close', solar: 0.75, at: CLOSE, why: 'ночь, тот же участок' },
  // Только по имени (`SHOTS=dusk-wide`): в заход по умолчанию не входят — стенд короче двух минут.
  { name: 'dusk-wide', solar: 0.47, why: 'золотой час перед закатом, общий план (вид next, 9.9)' },
  { name: 'dawn-wide', solar: 0.03, why: 'рассвет, общий план' },
];

/** Ракурсы захода по умолчанию — прежние четыре. */
const DEFAULT_SHOTS = ['day-wide', 'night-wide', 'day-close', 'night-close'];

function pageUrl(look: string, solar: number, at?: [number, number]): string {
  const [kind, quality] = look.split(':');
  const q = new URLSearchParams({
    showcase: 'village',
    levels: String(LEVELS),
    season: SEASON,
    solar: String(solar),
    clean: '1',
    dpr: String(SCREEN.deviceScaleFactor),
    fpscap: String(REPORT_FPS),
  });
  if (kind === 'next') q.set('look', 'next');
  if (quality) q.set('quality', quality);
  if (at) {
    q.set('at', `${at[0].toFixed(2)},${at[1].toFixed(2)}`);
    q.set('dist', 'min');
  }
  return `http://127.0.0.1:${PORT}/?${q.toString()}`;
}

/** Открыть страницу на экране телефона и дождаться, пока сцена скажет «готова». */
async function open(url: string): Promise<Tab> {
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
  await tab.send('Page.navigate', { url });
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    const ready = await tab.eval<string>(`JSON.stringify(document.body?.dataset.ready ?? '')`).catch(() => '');
    if (ready === '1') break;
  }
  // Сезон и тени устаиваются за несколько кадров; окружение стоит.
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
  for (const look of LOOKS) {
    for (const shot of SHOTS.filter((s) => wanted.includes(s.name))) {
      if (Date.now() - began > BROWSER_MAX_MS) {
        console.log(`\nСрок стенда (${BROWSER_MAX_MS / 1000} с) вышел — остальное отдельным заходом.`);
        return;
      }
      const tab = await open(pageUrl(look, shot.solar, shot.at));
      try {
        const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
        const name = `${TAG}-${look.replace(':', '-')}-${shot.name}.png`;
        await writeFile(join(OUT, name), Buffer.from(png.data, 'base64'));
        console.log(`  ${look.padEnd(12)} ${shot.name.padEnd(12)} → snaps/village/${name}`);
      } finally {
        await close(tab);
      }
    }
  }
  console.log('\nЧто чем отвечает:');
  for (const s of SHOTS) console.log(`  ${s.name.padEnd(12)} ${s.why}`);
}

// ---------- Цена кадра ----------

/**
 * Замер в странице. Кадры рисует сама сцена своей цепочкой под потолком стенда — стенд
 * не зовёт кадр ни разу, он только оборачивает его: процессорное время всего кадра и
 * время видеокарты на `render` (запросы времени копятся и снимаются по готовности, кадр
 * с «разрывом» видеокарты в счёт не идёт — как у стенда предыстории).
 */
const PROBE = (ms: number): string => `
(async () => {
  const s = window.__stand;
  const gl = s.renderer.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const cpu = [];
  const gpu = [];
  const pending = [];
  let calls = 0;
  let tris = 0;
  let q = null;
  const frame = s.frame;
  s.frame = function () { const a = performance.now(); frame.call(s); cpu.push(performance.now() - a); };
  s.beforeRender = () => { if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); } };
  s.afterRender = () => {
    if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); q = null; }
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
    calls,
    tris,
    geoMb: mem.bytes / 1048576,
    texMb: s.textureBytes() / 1048576,
    programs: mem.programs,
    buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
    env: s.env ? s.env.counts() : null,
    gpuName: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
  });
})()
`;

interface Bench {
  frames: number;
  cpu: [number, number];
  gpu: [number, number] | null;
  calls: number;
  tris: number;
  geoMb: number;
  texMb: number;
  programs: number;
  buffer: [number, number];
  env: {
    trees: Record<string, number>;
    props: Record<string, number>;
    grass: number;
    flowers: number;
    crops: number;
    blobs: number;
    map: number;
    buildMs: number;
    /** Сборка кусками между кадрами (`env/index.startEnv`): всего, сколько кусков, самый долгий. */
    build: { ms: number; slices: number; longest: number; step: number; stepIn: string };
  } | null;
  gpuName: string;
}

type Row = { look: string; b: Bench };

/** Один проход замера: каждый вид по разу, в порядке `LOOKS`. */
async function benchPass(began: number): Promise<Row[]> {
  const rows: Row[] = [];
  for (const look of LOOKS) {
    if (Date.now() - began > BROWSER_MAX_MS) {
      console.log(`\nСрок прохода (${BROWSER_MAX_MS / 1000} с) вышел — остальное отдельным заходом.`);
      break;
    }
    const tab = await open(pageUrl(look, 0.2));
    try {
      rows.push({ look, b: await tab.eval<Bench>(PROBE(SECONDS * 1000)) });
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
 * Таблица каждого прохода, состав окружения и — если проходов больше одного — сводка: время видеокарты
 * медианой по проходам и отношение к прежнему виду (`now`) **внутри прохода**, медианой. Частота видеокарты
 * под потолком кадров гуляет от прохода к проходу, и миллисекунды разных проходов не сравнимы, а отношение
 * к `now` того же прохода — сравнимо: `now` в нём и мерка, и контроль.
 */
function printBench(passes: Row[][]): void {
  const first = passes.find((p) => p.length > 0);
  if (!first) return;
  console.log(
    `\nВидеокарта: ${first[0].b.gpuName}. Экран ${SCREEN.width}×${SCREEN.height} @${SCREEN.deviceScaleFactor}, потолок ${REPORT_FPS} кадров, ` +
      `${SECONDS} с на вид; проходов ${passes.length}, между ними видеокарта остывает ${GPU_COOL_MS / 1000} с.`,
  );
  passes.forEach((rows, i) => {
    console.log(`\n${passes.length > 1 ? `проход ${i + 1}` : ''}`);
    console.log(
      `${'вид'.padEnd(12)} ${'буфер'.padEnd(10)} ${'вызовов'.padStart(8)} ${'треуг.'.padStart(8)} ${'кадров'.padStart(7)} ` +
        `${'ЦП мед'.padStart(7)} ${'ЦП p95'.padStart(7)} ${'ВК мед'.padStart(7)} ${'ВК p95'.padStart(7)} ${'верш. МБ'.padStart(9)} ${'текст. МБ'.padStart(9)}`,
    );
    for (const { look, b } of rows) {
      console.log(
        `${look.padEnd(12)} ${`${b.buffer[0]}×${b.buffer[1]}`.padEnd(10)} ${String(b.calls).padStart(8)} ${String(b.tris).padStart(8)} ${String(b.frames).padStart(7)} ` +
          `${f(b.cpu[0]).padStart(7)} ${f(b.cpu[1]).padStart(7)} ${f(b.gpu?.[0]).padStart(7)} ${f(b.gpu?.[1]).padStart(7)} ${f(b.geoMb).padStart(9)} ${f(b.texMb).padStart(9)}`,
      );
    }
  });
  for (const { look, b } of first) {
    if (!b.env) continue;
    const e = b.env;
    const builds = passes.map((p) => p.find((r) => r.look === look)?.b.env?.build).filter((x) => !!x);
    console.log(
      `\n${look}: деревьев ${Object.entries(e.trees).map(([k, v]) => `${k} ${v}`).join(', ')}; мелочи ${Object.entries(e.props).map(([k, v]) => `${k} ${v}`).join(', ')};` +
        ` травы ${e.grass}, цветов ${e.flowers}, всходов ${e.crops}, пятен ${e.blobs}; карта земли ${e.map}²; сборка ` +
        builds.map((x) => `${f(x!.ms, 0)} мс за ${x!.slices} кусков, самый долгий ${f(x!.longest, 1)} мс`).join(' / '),
    );
  }
  if (passes.length > 1) {
    console.log('\nСводка: ВК мед — медиана по проходам; к now — отношение внутри прохода, медиана (по проходам — через «/»).');
    for (const look of LOOKS) {
      const gpu: number[] = [];
      const ratio: number[] = [];
      for (const rows of passes) {
        const r = rows.find((x) => x.look === look)?.b.gpu?.[0];
        const n = rows.find((x) => x.look === 'now')?.b.gpu?.[0];
        if (r === undefined || r === null) continue;
        gpu.push(r);
        if (n) ratio.push(r / n);
      }
      console.log(`${look.padEnd(12)} ВК мед ${f(median(gpu)).padStart(6)}   к now ${f(median(ratio)).padStart(5)}   (${ratio.map((x) => f(x)).join(' / ')})`);
    }
  }
  console.log('\nМиллисекунды сравнимы внутри прохода; между проходами — только отношением к now (шапка файла).');
}

async function main(): Promise<void> {
  // Бюджет железа (решение владельца, 01.10.2026): замер цены кадра — не больше трёх проходов, и между ними
  // видеокарта остывает. Повтор вида в одном проходе — это второй проход без паузы.
  if (new Set(LOOKS).size !== LOOKS.length) {
    console.error(`\nВид повторён в LOOKS — это второй проход без паузы. Проходы — PASSES=2 или 3: между ними видеокарта остывает ${GPU_COOL_MS / 1000} с.`);
    process.exit(2);
  }
  if (!Number.isInteger(PASSES) || PASSES < 1 || PASSES > BENCH_PASSES_MAX) {
    console.error(`\nPASSES=${process.env.PASSES}: проходов замера — от 1 до ${BENCH_PASSES_MAX} (бюджет железа).`);
    process.exit(2);
  }
  refuseIfBusy('Снимки посёлка');
  const vite = await createVite({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  const passes: Row[][] = [];
  try {
    console.log(`\n=== посёлок: ${BENCH ? 'цена кадра' : 'снимки'} (${LOOKS.join(', ')}; ${SEASON}, уровень ${LEVELS}) ===\n`);
    for (let pass = 1; pass <= (BENCH ? PASSES : 1); pass++) {
      // Видеокарта остывает минуту после прошлого захода стенда и между проходами; браузер на это время закрыт.
      await gpuCoolDown(pass === 1 ? 'стендом посёлка' : `проходом ${pass}`);
      const chrome = await launchChrome(DEBUG_PORT, ['--use-gl=angle', '--window-size=500,900', '--force-device-scale-factor=1']);
      try {
        const began = Date.now();
        if (BENCH) passes.push(await benchPass(began));
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
