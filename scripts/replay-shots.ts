// Снимки ролика боя: стенд `?replay=1` (src/render/battle-stand.ts) на экране телефона, кадр на заданном моменте.
//
// Это **стенд, а не отчёт**, как `village:shots` и `map:shots`: он ничем не падает и ничего не утверждает — вид судят
// глазами по снимкам. Кадр стоит (`&at=` останавливает ролик на моменте): стенд рисует его по разу на открытие и
// подгонку размера, цепочки кадров нет, и видеокарта не греется.
//
// Что снимается — ракурсы `SHOTS` ниже: стая у ворот (`&beasts=1`, docs/graphics_world.md, 11.4) на сшибке, в свалке,
// на бегстве и на поле после боя, тот же бой людей для сравнения и ряд фигур витрины (`?showcase=units`) — волк,
// собака и копейщик вблизи в позах ролика, с низкой камеры крупного плана. Снимок — snaps/replay/<TAG>-<ракурс>.png;
// рядом в выводе — вызовы и треугольники кадра (стенд кладёт их в `document.body.dataset.replay`, витрина — в
// `dataset.showcase`). Ряд витрины рисуется под потолком кадров отчёта (`REPORT_FPS`) и живёт секунды.
//
// Бюджет железа (CLAUDE.md, раздел ⛔): один заход не дольше `BROWSER_MAX_MS`, рядом с чужой тяжёлой работой не
// запускается, перед заходом видеокарта остывает минуту от конца прошлого захода стенда (`gpuCoolDown`).
//
// Запуск: npm run replay:shots
// Переменные: SHOTS=wolves-clash,…,beast-guard,…  TAG=probe  PORT=4197  CDP_PORT=9340  HEAD=1
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite } from 'vite';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { BROWSER_MAX_MS, REPORT_FPS, gpuCoolDown, gpuStamp, refuseIfBusy } from './lib/budget';

const OUT = fileURLToPath(new URL('../snaps/replay', import.meta.url));
const PORT = Number(process.env.PORT ?? 4197);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9340);
const TAG = process.env.TAG ?? 'probe';
const list = (v: string | undefined, all: string[]): string[] => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : all);

/** Экран телефона: тот же, что у снимков посёлка (390×844), плотность 2. */
const SCREEN = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

/** Бой у ворот: 40 наших против стаи в 30 волков — порядок числа, с которым стая приходит к посёлку средней руки. */
const PACK = 'replay=1&beasts=1&men=40&foe=30&seed=7';
const MEN = 'replay=1&men=40&foe=30&seed=7';
/** Сцена ролика: опушка и тракт — клетка, где видны и земля, и лес; вид `now` против `next` (docs/graphics_world.md, 11.5). */
const FIELD = 'replay=1&men=60&foe=60&seed=7&place=woods,road';
/** Ряд витрины: волк, собака и копейщик для роста; низкая камера — как крупный план ролика, кадр в одну фазу. */
const ROW = 'showcase=units&units=wolf,spearman&spacing=1.4&polar=1.3&time=1.3';

interface Shot {
  name: string;
  query: string;
  why: string;
}

const SHOTS: Shot[] = [
  { name: 'wolves-clash', query: `${PACK}&at=clash`, why: 'сшибка: стая припала перед броском, наши в упоре' },
  { name: 'wolves-field', query: `${PACK}&at=field`, why: 'общий план свалки: красная стая против синего строя, знамёна только у наших' },
  { name: 'wolves-melee', query: `${PACK}&at=melee`, why: 'свалка ближе: волки бросаются, павшие лежат набок' },
  { name: 'wolves-rout', query: `${PACK}&at=rout`, why: 'бегство: стая уходит рысью спиной к строю' },
  { name: 'wolves-last', query: `${PACK}&at=last`, why: 'поле после боя: у наших брошенные щиты, после стаи — только павшие волки' },
  { name: 'men-clash', query: `${MEN}&at=clash`, why: 'тот же размер боя людьми — для сравнения' },
  { name: 'scene-noon', query: `${FIELD}&hour=12&at=field`, why: 'сцена ролика в полдень: луг, опушка, свет города' },
  { name: 'scene-dusk', query: `${FIELD}&hour=19&at=field`, why: 'сцена ролика вечером: золотой час' },
  { name: 'scene-close', query: `${FIELD}&hour=9&at=clash`, why: 'сшибка утром вблизи' },
  { name: 'scene-winter', query: `${FIELD}&hour=12&winter=1&at=field`, why: 'зимний бой: деревья окружения в снегу, травы нет' },
  { name: 'beast-stand', query: `${ROW}&action=stand`, why: 'вблизи, анфас: стойка' },
  { name: 'beast-walk', query: `${ROW}&action=walk`, why: 'вблизи, анфас: подход и бегство — рысь' },
  { name: 'beast-guard', query: `${ROW}&action=guard`, why: 'вблизи, анфас: перед сшибкой — припал' },
  { name: 'beast-strike', query: `${ROW}&action=strike`, why: 'вблизи, анфас: свалка — бросок' },
  { name: 'beast-strike-side', query: `${ROW}&action=strike&turn=90`, why: 'вблизи, сбоку: бросок' },
  { name: 'beast-fall', query: `${ROW}&action=fall`, why: 'вблизи: падение набок' },
];

const DEFAULT_SHOTS = ['wolves-clash', 'wolves-melee', 'wolves-rout', 'wolves-last', 'men-clash'];

const pageUrl = (shot: Shot): string =>
  `http://127.0.0.1:${PORT}/?${shot.query}&clean=1&dpr=${SCREEN.deviceScaleFactor}&fpscap=${REPORT_FPS}`;

/** Счёт кадра, который стенд кладёт в `dataset.replay` (витрина — в `dataset.showcase`, без времени и фигур). */
interface Stats {
  calls: number;
  triangles: number;
  t?: number;
  figures?: Record<string, number>;
}

async function shoot(shot: Shot): Promise<void> {
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
    await tab.send('Page.navigate', { url: pageUrl(shot) });
    let stats: Stats | null = null;
    for (let i = 0; i < 120 && !stats; i++) {
      await sleep(250);
      const raw = await tab
        .eval<string>(`JSON.stringify(document.body?.dataset.replay ?? document.body?.dataset.showcase ?? '')`)
        .catch(() => '');
      if (raw) stats = JSON.parse(raw) as Stats;
    }
    if (!stats) throw new Error(`${shot.name}: стенд не отдал кадр`);
    // Кадр стоит: подгонка размера под экран телефона перерисовывает его один раз.
    await sleep(800);
    const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const name = `${TAG}-${shot.name}.png`;
    await writeFile(join(OUT, name), Buffer.from(png.data, 'base64'));
    const when = stats.t === undefined ? ''.padEnd(26) : `t=${stats.t.toFixed(1).padStart(5)} · фигур ${Object.values(stats.figures ?? {}).join('/').padEnd(7)} · `;
    console.log(
      `  ${shot.name.padEnd(17)} ${when}вызовов ${String(stats.calls).padStart(3)} · ` +
        `треугольников ${stats.triangles.toLocaleString('ru').padStart(8)} → snaps/replay/${name}`,
    );
  } finally {
    tab.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`);
  }
}

async function main(): Promise<void> {
  const wanted = list(process.env.SHOTS, DEFAULT_SHOTS);
  const unknown = wanted.filter((w) => !SHOTS.some((s) => s.name === w));
  if (unknown.length) {
    console.error(`\nНет таких ракурсов: ${unknown.join(', ')}. Есть: ${SHOTS.map((s) => s.name).join(', ')}.`);
    process.exit(2);
  }
  refuseIfBusy('Снимки ролика');
  await mkdir(OUT, { recursive: true });
  const vite = await createVite({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  try {
    console.log(`\n=== ролик боя: снимки (${wanted.join(', ')}) ===\n`);
    // Видеокарта остывает минуту после прошлого захода стенда; браузер на это время закрыт.
    await gpuCoolDown('стендом ролика');
    const chrome = await launchChrome(DEBUG_PORT, ['--use-gl=angle', '--window-size=500,900', '--force-device-scale-factor=1']);
    try {
      const began = Date.now();
      for (const shot of SHOTS.filter((s) => wanted.includes(s.name))) {
        if (Date.now() - began > BROWSER_MAX_MS) {
          console.log(`\nСрок стенда (${BROWSER_MAX_MS / 1000} с) вышел — остальное отдельным заходом.`);
          break;
        }
        await shoot(shot);
      }
    } finally {
      chrome.kill();
      gpuStamp();
    }
    console.log('\nЧто чем отвечает:');
    for (const s of SHOTS) console.log(`  ${s.name.padEnd(17)} ${s.why}`);
  } finally {
    await vite.close();
    await sleep(300);
  }
}

void main();
