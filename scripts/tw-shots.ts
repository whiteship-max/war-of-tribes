// Снимки ролика боя в стиле Total War: стенд `?replay=tw` (src/render/tw/stand.ts) на экране телефона, кадр на
// заданном моменте и ракурсе (docs/battle_tw.md, раздел 9).
//
// Это **стенд, а не отчёт**, как `replay:shots`: он ничем не падает и ничего не утверждает — вид судят глазами по
// снимкам, а бюджет кадра печатается рядом (вызовы, треугольники, текстуры против потолка уровня). Кадр стоит
// (`&at=` останавливает ролик): стенд рисует его по разу на открытие и подгонку размера.
//
// Снимок — .battle-shots/<TAG>-<ракурс>-<уровень>.png (не в репозиторий). В облачном контейнере (root, без видеокарты)
// браузер идёт с программной отрисовкой (SwiftShader), как `city:shots`.
//
// Бюджет железа (CLAUDE.md, раздел ⛔): один заход не дольше `BROWSER_MAX_MS`, рядом с чужой тяжёлой работой не
// запускается, перед заходом видеокарта остывает минуту от конца прошлого захода стенда (`gpuCoolDown`).
//
// Запуск: npm run tw:shots
// Переменные: SHOTS=deploy,clash,…  QUALITY=low,medium,high  TAG=probe  PORT=4198  CDP_PORT=9341  HEAD=1  WAIT=ms
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite } from 'vite';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { BROWSER_MAX_MS, REPORT_FPS, gpuCoolDown, gpuStamp, refuseIfBusy } from './lib/budget';

const OUT = fileURLToPath(new URL('../.battle-shots', import.meta.url));
const PORT = Number(process.env.PORT ?? 4198);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9341);
const TAG = process.env.TAG ?? 'probe';
const list = (v: string | undefined, all: string[]): string[] => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : all);

/** Экран телефона: портрет 390×844, плотность 2 — тот же, что у снимков города и прежнего ролика. */
const SCREEN = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

/** Полевой бой двух армий: сбалансированные составы стенда, поле с опушкой и трактом. */
const FIELD = 'replay=tw&men=600&foe=560&seed=7&place=woods,road&hour=10';
/** Переправа: нападающий переходит реку у берега обороны — штраф переправы ядра. */
const FORD = 'replay=tw&men=500&foe=500&seed=5&place=river,ford&hour=16';
const HILLS = 'replay=tw&men=500&foe=420&seed=3&place=hills,woods&hour=8';
const PACK = 'replay=tw&beasts=1&men=60&foe=45&seed=7';
const BIG = 'replay=tw&men=3000&foe=2600&seed=9&place=road&hour=13';

interface Shot {
  name: string;
  query: string;
  why: string;
}

const SHOTS: Shot[] = [
  { name: 'deploy', query: `${FIELD}&at=deploy`, why: 'построение: общий вид, отряды строем, знамёна, конница на краях' },
  { name: 'volley', query: `${FIELD}&at=volley`, why: 'залп: туча стрел по дуге от лучников' },
  { name: 'advance', query: `${FIELD}&at=advance&cam=low`, why: 'сближение шагом, ниже общего вида' },
  { name: 'charge', query: `${FIELD}&at=charge&cam=low`, why: 'бег на сшибку' },
  { name: 'clash', query: `${FIELD}&at=clash`, why: 'сшибка: линии сошлись на линии соприкосновения' },
  { name: 'clash-near', query: `${FIELD}&at=clash&cam=near`, why: 'сшибка вблизи: видны люди, щиты в цвете стороны' },
  { name: 'clash-side', query: `${FIELD}&at=clash&cam=side`, why: 'сшибка сбоку: камера повёрнута' },
  { name: 'melee', query: `${FIELD}&at=melee`, why: 'сеча: павшие лежат, передние рубятся' },
  { name: 'rout', query: `${FIELD}&at=rout`, why: 'бегство: сектор развернулся и бежит, знамя кренится' },
  { name: 'ford-advance', query: `${FORD}&at=advance&cam=low`, why: 'переправа: нападающий входит в воду, строй рыхлеет' },
  { name: 'ford-clash', query: `${FORD}&at=clash&cam=low`, why: 'переправа: бьются у берега обороны, нападающий в воде' },
  { name: 'hills', query: `${HILLS}&at=advance`, why: 'холмы: оборона на гребне, лес по флангам' },
  { name: 'pack', query: `${PACK}&at=clash&cam=low`, why: 'стая у ворот: волки в цвете стороны, без знамён' },
  { name: 'big', query: `${BIG}&at=deploy`, why: 'большое войско: k > 1, потолок фигур уровня' },
  { name: 'top', query: `${FIELD}&at=deploy&cam=top`, why: 'сверху: строй по полосам' },
];

const DEFAULT_SHOTS = ['deploy', 'volley', 'clash', 'clash-near', 'ford-clash'];

const pageUrl = (shot: Shot, quality: string): string =>
  `http://127.0.0.1:${PORT}/?${shot.query}&quality=${quality}&clean=1&dpr=${SCREEN.deviceScaleFactor}&fpscap=${REPORT_FPS}`;

interface Stats {
  calls: number;
  triangles: number;
  crowdTriangles: number;
  textureMB: number;
  t: number;
  k: number;
  figures: Record<string, number>;
  budget: { calls: number; triangles: number; textureMB: number };
}

async function shoot(shot: Shot, quality: string): Promise<void> {
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
    await tab.send('Page.navigate', { url: pageUrl(shot, quality) });
    let stats: Stats | null = null;
    for (let i = 0; i < 240 && !stats; i++) {
      await sleep(250);
      // `eval` разбирает возвращённую строку как JSON сам: стенд кладёт в `dataset.replay` ровно JSON.
      const parsed = await tab.eval<Stats | null>(`document.body?.dataset.replay ?? 'null'`).catch(() => null);
      if (parsed && parsed.calls !== undefined) stats = parsed;
    }
    if (!stats) throw new Error(`${shot.name}: стенд не отдал кадр`);
    // Кадр стоит: подгонка размера под экран телефона перерисовывает его; программной отрисовке нужно время.
    await sleep(Number(process.env.WAIT ?? 2500));
    stats = (await tab.eval<Stats | null>(`document.body.dataset.replay ?? 'null'`)) ?? stats;
    const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const name = `${TAG}-${shot.name}-${quality}.png`;
    await writeFile(join(OUT, name), Buffer.from(png.data, 'base64'));
    const b = stats.budget;
    const mark = (v: number, cap: number): string => (v <= cap ? '' : ' ⚠');
    console.log(
      `  ${shot.name.padEnd(13)} ${quality.padEnd(6)} t=${stats.t.toFixed(1).padStart(5)} · k ${stats.k} · фигур ${Object.values(stats.figures).join('/').padEnd(8)} · ` +
        `вызовов ${String(stats.calls).padStart(3)}/${b.calls}${mark(stats.calls, b.calls)} · ` +
        `треугольников ${stats.triangles.toLocaleString('ru').padStart(9)}/${b.triangles.toLocaleString('ru')}${mark(stats.triangles, b.triangles)} ` +
        `(бойцы ${stats.crowdTriangles.toLocaleString('ru')}) · текстуры ${stats.textureMB}/${b.textureMB} МБ → .battle-shots/${name}`,
    );
  } finally {
    tab.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const wanted = list(process.env.SHOTS, DEFAULT_SHOTS);
  const qualities = list(process.env.QUALITY, ['medium']);
  const unknown = wanted.filter((w) => !SHOTS.some((s) => s.name === w));
  if (unknown.length) {
    console.error(`\nНет таких ракурсов: ${unknown.join(', ')}. Есть: ${SHOTS.map((s) => s.name).join(', ')}.`);
    process.exit(2);
  }
  refuseIfBusy('Снимки ролика TW');
  await mkdir(OUT, { recursive: true });
  const vite = await createVite({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  try {
    console.log(`\n=== ролик TW: снимки (${wanted.join(', ')}; ${qualities.join(', ')}) ===\n`);
    await gpuCoolDown('стендом ролика TW');
    // В облачном контейнере браузер идёт от root без видеокарты: песочница там не поднимается, а WebGL даёт только
    // программная отрисовка (SwiftShader) — как у `city:shots`.
    const root = process.getuid?.() === 0 ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
    const chrome = await launchChrome(DEBUG_PORT, ['--use-gl=angle', '--window-size=500,900', '--force-device-scale-factor=1', ...root]);
    try {
      const began = Date.now();
      outer: for (const q of qualities) {
        for (const shot of SHOTS.filter((s) => wanted.includes(s.name))) {
          if (Date.now() - began > BROWSER_MAX_MS) {
            console.log(`\nСрок стенда (${BROWSER_MAX_MS / 1000} с) вышел — остальное отдельным заходом.`);
            break outer;
          }
          await shoot(shot, q);
        }
      }
    } finally {
      chrome.kill();
      gpuStamp();
    }
    console.log('\nЧто чем отвечает:');
    for (const s of SHOTS.filter((x) => wanted.includes(x.name))) console.log(`  ${s.name.padEnd(13)} ${s.why}`);
  } finally {
    await vite.close();
    await sleep(300);
  }
}

void main();
