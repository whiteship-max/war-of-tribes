// Стенд карты нового вида (docs/map_tw.md): снимки участка и цена выпечки — не отчёт, в приёмку не входит.
//
//   npm run map-tw:shots                                   — ракурс «start», высокий уровень, лето
//   SHOTS=start,coast,mountains QUALITY=high,medium TAG=r2 npm run map-tw:shots
//   OLD=1 SHOTS=start npm run map-tw:shots                 — тот же участок прежней картой («до»)
//   EXTRA="season=winter&night=1" npm run map-tw:shots     — свои параметры поверх ракурса
//
// Снимки — в `.map-shots/` (в репозиторий не входит). Страница печёт кадр один раз и стоит: цепочки
// кадров нет, видеокарту стенд не гонит. Числа выпечки — из самой страницы (`dataset.showcase`): тот же
// участок, тот же браузер, до и после; настоящую цену на телефоне покажет только дом.
// Бюджет железа (CLAUDE.md, раздел ⛔): один прогон, рядом с чужой тяжёлой работой стенд не запускается,
// не дольше двух минут на заход, минута остывания перед заходом.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite } from 'vite';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { BROWSER_MAX_MS, REPORT_FPS, gpuCoolDown, gpuStamp, refuseIfBusy } from './lib/budget';

const OUT = fileURLToPath(new URL('../.map-shots', import.meta.url));
const PORT = Number(process.env.PORT ?? 4197);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9344);
const SCREEN = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const list = (s: string | undefined, d: string): string[] => (s ?? d).split(',').map((x) => x.trim()).filter(Boolean);
const SHOTS = list(process.env.SHOTS, 'start');
const QUALITIES = list(process.env.QUALITY, 'high');
const TAG = process.env.TAG ?? 'probe';
const EXTRA = process.env.EXTRA ?? '';
const OLD = process.env.OLD === '1';

function pageUrl(view: string, quality: string, old: boolean): string {
  const p = new URLSearchParams({ showcase: 'map-tw', view, quality, clean: '1', fpscap: String(REPORT_FPS) });
  if (old) p.set('old', '1');
  for (const [k, v] of new URLSearchParams(EXTRA)) p.set(k, v);
  return `http://127.0.0.1:${PORT}/?${p.toString()}`;
}

interface Shown {
  tiles: number;
  bakeMedianMs: number;
  bakeMaxMs: number;
  parts: Record<string, number>;
  chunks: number;
  chunkMedianMs: number;
}

async function shot(view: string, quality: string, old: boolean): Promise<void> {
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
    await tab.send('Page.navigate', { url: pageUrl(view, quality, old) });
    let ok = false;
    for (let i = 0; i < 240; i++) {
      await sleep(250);
      const ready = await tab.eval<string>(`JSON.stringify(document.body?.dataset.ready ?? '')`).catch(() => '');
      if (ready === '1') {
        ok = true;
        break;
      }
    }
    const label = `${old ? 'old' : quality} ${view}`;
    if (!ok) {
      console.log(`  ${label}: стенд не встал за 60 с`);
      return;
    }
    await sleep(300);
    const s = await tab.eval<Shown>(`document.body.dataset.showcase`);
    const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const name = `${TAG}-${old ? 'old' : quality}-${view}.png`;
    await writeFile(join(OUT, name), Buffer.from(png.data, 'base64'));
    const parts = Object.entries(s.parts ?? {})
      .map(([k, v]) => `${k} ${v}`)
      .join(', ');
    console.log(
      `  ${label.padEnd(16)} тайлов ${s.tiles}, выпечка: медиана ${s.bakeMedianMs} мс, худшая ${s.bakeMaxMs} мс` +
        `${parts ? ` (${parts})` : ''}; обзор: кусков ${s.chunks}, медиана ${s.chunkMedianMs} мс → .map-shots/${name}`,
    );
  } finally {
    tab.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  refuseIfBusy('Снимки карты');
  const vite = await createVite({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  try {
    console.log(`\n=== карта нового вида: снимки (${SHOTS.join(', ')}; ${QUALITIES.join(', ')}${OLD ? '; и прежняя' : ''}) ===\n`);
    await gpuCoolDown('стендом карты');
    // В облачном контейнере браузер идёт от root: песочница Chrome там не поднимается.
    const root = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
    const chrome = await launchChrome(DEBUG_PORT, ['--window-size=500,900', '--force-device-scale-factor=1', ...root]);
    try {
      const began = Date.now();
      outer: for (const view of SHOTS) {
        for (const q of OLD ? [...QUALITIES, 'old'] : QUALITIES) {
          if (Date.now() - began > BROWSER_MAX_MS) {
            console.log(`\nСрок стенда (${BROWSER_MAX_MS / 1000} с) вышел — остальное отдельным заходом.`);
            break outer;
          }
          await shot(view, q === 'old' ? 'high' : q, q === 'old');
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
