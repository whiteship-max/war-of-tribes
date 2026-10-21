// Стенд супруги правителя (docs/characters.md, ЛЦ-2): снимки — не отчёт, в приёмку не входит.
//
//   npm run consort:shots                      — три облика рядом спереди, три четверти и сбоку (390 × 844) и лицо каждого
//                                                крупно (512 × 512) — в `.consort-shots/`
//   SHOTS=face LOOKS=b npm run consort:shots   — только лицо облика b; `SHOTS=front,three,side` — только листы обликов
//   ASK='{"view":"face","clip":2,"at":1.4}'    — свой кадр стенда (`stand.ShotAsk`), имя — `TAG`
//   LIGHT=night npm run consort:shots          — ночной свет фигуры
//   OUT=docs/characters TAG=lc2 …              — куда и с какой приставкой (снимки задания — `docs/characters/lc2-*.jpg`)
//
// Бюджет железа (CLAUDE.md, раздел ⛔): один прогон, кадры — по просьбе стенда (цепочки кадров нет), не дольше двух минут
// на заход, минута остывания видеокарты перед заходом; рядом с чужой тяжёлой работой стенд не запускается.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite } from 'vite';
import sharp from 'sharp';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { BROWSER_MAX_MS, gpuCoolDown, gpuStamp, refuseIfBusy } from './lib/budget';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, process.env.OUT ?? '.consort-shots');
const TAG = process.env.TAG ?? 'probe';
const PORT = Number(process.env.PORT ?? 4197);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9344);
const list = (s: string | undefined, d: string): string[] => (s ?? d).split(',').map((x) => x.trim()).filter(Boolean);
const SHOTS = list(process.env.SHOTS, 'front,three,side,face');
const LOOKS = list(process.env.LOOKS, 'a,b,c');
const LIGHT = process.env.LIGHT === 'night' ? 'night' : 'day';
const JPG = process.env.PNG !== '1';

async function snap(tab: Tab, name: string, w: number, h: number, ask: Record<string, unknown>): Promise<void> {
  await tab.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(150);
  const stats = await tab.eval<{ triangles: number; calls: number }>(`JSON.stringify(window.__consort.shot(${JSON.stringify(ask)}))`);
  await sleep(100);
  const shot = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  const file = join(OUT, `${TAG}-${name}.${JPG ? 'jpg' : 'png'}`);
  const img = sharp(Buffer.from(shot.data, 'base64'));
  await (JPG ? img.jpeg({ quality: 88 }) : img.png()).toFile(file);
  console.log(`  ${file.slice(ROOT.length)} — треугольников ${stats.triangles}, вызовов ${stats.calls}`);
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  refuseIfBusy('Стенд супруги');
  const vite = await createVite({ configFile: join(ROOT, 'vite.config.ts'), server: { port: PORT, strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
  await vite.listen();
  try {
    await gpuCoolDown('стендом супруги');
    const root = process.getuid?.() === 0 ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
    const chrome = await launchChrome(DEBUG_PORT, ['--use-gl=angle', '--window-size=600,900', '--force-device-scale-factor=1', ...root]);
    const began = Date.now();
    try {
      const tab = await Tab.open(DEBUG_PORT, `http://127.0.0.1:${PORT}/?showcase=consort&probe=1`);
      try {
        for (let i = 0; i < 300 && !(await tab.eval<boolean>('JSON.stringify(!!window.__consortReady)')); i++) await sleep(200);
        if (process.env.ASK) await snap(tab, 'ask', Number(process.env.W ?? 512), Number(process.env.H ?? 512), JSON.parse(process.env.ASK));
        else
          for (const s of SHOTS) {
            if (Date.now() - began > BROWSER_MAX_MS) {
              console.log('  две минуты вышли — остальное следующим заходом');
              break;
            }
            if (s === 'face') for (const id of LOOKS) await snap(tab, `face-${id}`, 512, 512, { view: 'face', looks: [id], light: LIGHT });
            else await snap(tab, s, 390, 844, { view: 'sheet', angle: s, looks: LOOKS, light: LIGHT });
          }
      } finally {
        tab.close();
        await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`).catch(() => undefined);
      }
    } finally {
      chrome.kill();
      gpuStamp();
    }
  } finally {
    await vite.close();
  }
}

void main().then(
  () => process.exit(0),
  (e: unknown) => {
    console.error(e);
    process.exit(1);
  },
);
