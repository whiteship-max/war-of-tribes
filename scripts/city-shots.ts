// Стенд вида «город» (docs/city.md): снимки и счётчики кадра — не отчёт, в приёмку не входит.
//
//   npm run city:shots                         — ракурс игры, средний, день
//   QUALITY=high,low VIEWS=game,street SOLAR=0.2,0.75 TAG=r2 npm run city:shots
//   EXTRA="at=4,5,70&dist=30" VIEWS=street npm run city:shots   — свой ракурс поверх названного
//   TEX=1 npm run city:shots                   — слои текстур листом (без браузера)
//   BUDGET=1 npm run city:shots                — бюджет по уровням счётом (без браузера)
//
// Снимки — в `.city-shots/` (в репозиторий не входит). Бюджет железа (CLAUDE.md, раздел ⛔): один
// прогон, браузер с потолком кадров отчёта, не дольше двух минут на заход, минута остывания
// видеокарты перед заходом; рядом с чужой тяжёлой работой стенд не запускается.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite } from 'vite';
import sharp from 'sharp';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { BROWSER_MAX_MS, REPORT_FPS, gpuCoolDown, gpuStamp, refuseIfBusy } from './lib/budget';
import { QUALITY, qualityOf, type Quality } from '../src/render/quality';
import { LAYERS, paintLayer } from '../src/render/city/tex';
import { cityCounts, CITY_BUDGET } from '../src/render/city/budget';
import { QUALITIES as ALL_QUALITIES } from '../src/render/quality';

const OUT = fileURLToPath(new URL('../.city-shots', import.meta.url));
const PORT = Number(process.env.PORT ?? 4199);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9342);
const SCREEN = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const list = (s: string | undefined, d: string): string[] => (s ?? d).split(',').map((x) => x.trim()).filter(Boolean);
const QUALITIES = list(process.env.QUALITY, 'medium').map((q) => qualityOf(q) ?? 'medium') as Quality[];
const VIEWS = list(process.env.VIEWS, 'game');
const SOLARS = list(process.env.SOLAR, '0.2').map(Number);
const SEASON = process.env.SEASON ?? 'summer';
const TAG = process.env.TAG ?? 'probe';
const EXTRA = process.env.EXTRA ?? '';

function pageUrl(q: Quality, view: string, solar: number): string {
  const p = new URLSearchParams({
    showcase: 'city',
    quality: q,
    view,
    solar: String(solar),
    season: SEASON,
    clean: '1',
    dpr: String(QUALITY[q].dpr),
    fpscap: String(REPORT_FPS),
  });
  for (const [k, v] of new URLSearchParams(EXTRA)) p.set(k, v);
  return `http://127.0.0.1:${PORT}/?${p.toString()}`;
}

interface Counters {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  bytes: number;
  texBytes: number;
  counts: Record<string, number>;
}

const PROBE = `JSON.stringify((() => {
  const s = window.__stand;
  const st = s.stats();
  return { ...st, bytes: s.memory().bytes, texBytes: s.textureBytes(), counts: s.counts() };
})())`;

async function shot(q: Quality, view: string, solar: number): Promise<void> {
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
    await tab.send('Page.navigate', { url: pageUrl(q, view, solar) });
    let ok = false;
    for (let i = 0; i < 360; i++) {
      await sleep(250);
      const ready = await tab.eval<string>(`JSON.stringify(document.body?.dataset.ready ?? '')`).catch(() => '');
      if (ready === '1') {
        ok = true;
        break;
      }
    }
    if (!ok) {
      console.log(`  ${q} ${view} ${solar}: город не собрался за 90 с`);
      return;
    }
    // Тени и мипы — несколько кадров.
    await sleep(2500);
    const c = await tab.eval<Counters>(PROBE);
    const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const name = `${TAG}-${q}-${view}-${String(solar).replace('.', '')}.png`;
    await writeFile(join(OUT, name), Buffer.from(png.data, 'base64'));
    const mb = (b: number): string => (b / 1048576).toFixed(2);
    console.log(
      `  ${q.padEnd(6)} ${view.padEnd(7)} solar ${solar}: вызовов ${c.calls}, треугольников ${c.triangles}, ` +
        `вершины ${mb(c.bytes)} МБ, текстуры ${mb(c.texBytes)} МБ, программ ${c.programs} → .city-shots/${name}`,
    );
    console.log(`         ${Object.entries(c.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  } finally {
    tab.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`).catch(() => undefined);
  }
}

/** Слои текстур листом — без браузера: самопроверка материала. */
async function texSheet(): Promise<void> {
  const S = Number(process.env.S ?? 256);
  const cols = 6;
  const tiles: { input: Buffer; left: number; top: number }[] = [];
  for (const [k, n] of LAYERS.entries()) {
    const t0 = performance.now();
    const px = paintLayer(n, S);
    const ms = performance.now() - t0;
    const flip = Buffer.alloc(px.length);
    for (let y = 0; y < S; y++) flip.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
    const png = await sharp(flip, { raw: { width: S, height: S, channels: 4 } }).removeAlpha().png().toBuffer();
    tiles.push({ input: png, left: (k % cols) * S, top: Math.floor(k / cols) * S });
    console.log(`  ${n.padEnd(11)} ${ms.toFixed(0)} мс`);
  }
  const rows = Math.ceil(LAYERS.length / cols);
  await sharp({ create: { width: cols * S, height: rows * S, channels: 3, background: '#101010' } })
    .composite(tiles)
    .png()
    .toFile(join(OUT, `${TAG}-tex-${S}.png`));
  console.log(`  → .city-shots/${TAG}-tex-${S}.png`);
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  if (process.env.TEX === '1') {
    await texSheet();
    return;
  }
  if (process.env.BUDGET === '1') {
    // Бюджет без браузера: те же план, модели и расстановка, что у сборки (`render/city/budget.ts`).
    console.log('\n=== город: бюджет по уровням (счёт без браузера) ===\n');
    for (const q of ALL_QUALITIES) {
      const c = cityCounts(q);
      const lim = CITY_BUDGET[q];
      console.log(
        `  ${q.padEnd(6)} вызовов ${c.calls} (≤ ${lim.calls}), треугольников ${c.triangles} (≤ ${lim.triangles}; здания ${c.buildings}, ` +
          `земля ${c.ground}, деревья ${c.trees}), текстуры ${c.textureMb.toFixed(1)} МБ (≤ ${lim.textureMb})`,
      );
    }
    return;
  }
  refuseIfBusy('Снимки города');
  const vite = await createVite({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  try {
    console.log(`\n=== город: снимки (${QUALITIES.join(', ')}; ${VIEWS.join(', ')}; ${SEASON}) ===\n`);
    await gpuCoolDown('стендом города');
    // В облачном контейнере браузер идёт от root без видеокарты: песочница Chrome там не поднимается,
    // а WebGL даёт только программная отрисовка (SwiftShader).
    const root = process.getuid?.() === 0 ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
    const chrome = await launchChrome(DEBUG_PORT, ['--use-gl=angle', '--window-size=500,900', '--force-device-scale-factor=1', ...root]);
    try {
      const began = Date.now();
      outer: for (const q of QUALITIES) {
        for (const view of VIEWS) {
          for (const solar of SOLARS) {
            if (Date.now() - began > BROWSER_MAX_MS) {
              console.log(`\nСрок стенда (${BROWSER_MAX_MS / 1000} с) вышел — остальное отдельным заходом.`);
              break outer;
            }
            await shot(q, view, solar);
          }
        }
      }
    } finally {
      chrome.kill();
      gpuStamp();
    }
  } finally {
    await vite.close();
    await sleep(300);
  }
}

void main();
