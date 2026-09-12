// Снимки карты: один и тот же кадр до правки и после.
//
// Это **стенд, а не отчёт**: он ничем не падает и ничего не утверждает. Судить
// вид карты числом нельзя, а «стало красивее» без картинки — не довод вовсе.
// Поэтому стенд делает ровно одно: ставит камеру на названную клетку и снимает
// экран телефона. Тот же список кадров, снятый с прежнего коммита и с нового,
// и есть весь разговор о виде.
//
// Из той же причины стенд не входит в приёмку (`CLAUDE.md`, правило 9): там
// перечислены отчёты, а этот ничего не меряет — как `battle:sweep`.
//
// Места выбраны так, чтобы каждый кадр отвечал за свою болезнь: горы за рельеф,
// побережье за воду, река за русло, лес и степь за растительность, свой двор за
// объекты, край разведанного за туман. Координаты — настоящие: клетки атласа
// пересчитаны из долготы и широты, поэтому «Альпы» это Альпы, а не удачное
// пятно на карте (`world/atlas/project.ts`).
//
// Мир закреплён сохранением с постоянным сидом и постоянным домом: без этого
// «до» и «после» показывали бы разную землю и сравнивать было бы нечего.
//
// Запуск: npm run map:shots           (нужен собранный dist: npm run build)
// Переменные: TAG=before  SHOT=горы  PORT=4193  CDP_PORT=9336  CHROME=...  HEAD=1
import { createServer, type Server } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { PINNED_HOME as HOME, PINNED_SEED as SEED, cellAt as at, openPinnedMap } from './lib/pinned';
import { LocalWorld } from '@/world/local/LocalWorld';
import { SCALE_DETAIL, SCALE_OVERVIEW, SCALE_START } from '@/ui/map/const';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const OUT = fileURLToPath(new URL('../snaps/map', import.meta.url));
const PORT = Number(process.env.PORT ?? 4193);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9336);
/** Как назвать пачку. «До» снимают с прежнего коммита, «после» — с нового. */
const TAG = process.env.TAG ?? 'after';
const ONLY = process.env.SHOT ?? '';

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

// ---------- Где снимаем ----------

// Мир закреплён общей дверью (`lib/pinned.ts`): тот же сид и дом, что у замера
// выпечки в `map:report`, — снимки и числа смотрят на одну и ту же землю.

interface Spot {
  name: string;
  /**
   * Куда смотрим. `home` — на свой двор, `lair` — на ближайшее логово: обе
   * клетки решает мир, а не мы, и спрашиваются они у него же (см. `lairNear`).
   */
  place: { x: number; y: number } | 'home' | 'lair';
  scale: number;
  /** Чем кадр отвечает за себя. */
  why: string;
  /** Туман на месте: снимаем без `worldview=open`. */
  fog?: boolean;
}

const SPOTS: Spot[] = [
  { name: 'дом-вблизи', place: 'home', scale: SCALE_DETAIL, why: 'свой двор, подсветка, пашня, ёлки вплотную' },
  { name: 'дом-издали', place: 'home', scale: SCALE_START, why: 'свой двор и соседи — вид, с которого карта открывается' },
  { name: 'горы', place: at(10.5, 46.5), scale: SCALE_DETAIL, why: 'Альпы: хребты и высоты' },
  { name: 'горы-средне', place: at(10.5, 46.5), scale: SCALE_START, why: 'те же Альпы целиком' },
  { name: 'побережье', place: at(16.8, 43.4), scale: SCALE_DETAIL, why: 'Далмация: берег, отмель, острова' },
  { name: 'побережье-средне', place: at(16.8, 43.4), scale: SCALE_START, why: 'та же Адриатика целиком' },
  { name: 'река', place: at(7.6, 50.3), scale: SCALE_DETAIL, why: 'Рейн: русло в берегах' },
  { name: 'лес', place: at(14.4, 49.5), scale: SCALE_DETAIL, why: 'Богемия: сплошной лес' },
  { name: 'степь', place: at(35, 48), scale: SCALE_DETAIL, why: 'Понтийская степь' },
  { name: 'пустыня', place: { x: 1152, y: 1347 }, scale: SCALE_DETAIL, why: 'Сирийская пустыня' },
  { name: 'мелкий', place: 'home', scale: SCALE_OVERVIEW, why: 'пиксельный обзор: где чьи земли' },
  // Круг обзора у деревни — семнадцать клеток, а на ближнем масштабе в экран их
  // входит восемь: с него кромки тумана не видно вовсе. Отсюда свой масштаб.
  { name: 'край-разведанного', place: 'home', scale: 16, why: 'граница тумана вокруг дома', fog: true },
  { name: 'логово', place: 'lair', scale: SCALE_DETAIL, why: 'ближайшее логово разбойников', fog: true },
];

/**
 * Ближайшее к дому логово. Спрашивается у настоящего мира с теми же сидом и
 * домом, что закреплены в сохранении, — то есть у того же кода, что нарисует его
 * в браузере. Своего мнения о том, где логова, у стенда нет и быть не должно.
 */
async function lairNear(): Promise<{ x: number; y: number }> {
  const world = new LocalWorld({ seed: SEED, home: HOME, storage: null, reveal: true });
  const r = 40;
  const region = await world.region({ x: HOME.x - r, y: HOME.y - r, w: r * 2, h: r * 2 });
  let best: { x: number; y: number; d: number } | null = null;
  for (const s of region.settlements) {
    if (s.relation !== 'barbarian') continue;
    const d = Math.hypot(s.x - HOME.x, s.y - HOME.y);
    if (!best || d < best.d) best = { x: s.x, y: s.y, d };
  }
  return best ?? HOME;
}

// ---------- Что подкладывается странице ----------

/**
 * Мир закрепляет и пульс замораживает общая дверь (`lib/pinned.ts`): отряды и
 * фигуры перестают ползти между кадрами, и снимки одного места в двух прогонах
 * совпадают до пикселя там, где ничего не правили. Своё у стенда одно — где дом.
 */
const PROBE = `
(() => {
  window.__home = () => JSON.stringify(window.__world.getState().info.home);
  return JSON.stringify('ok');
})()
`;

// ---------- Снимок ----------

async function shoot(tab: Tab, name: string): Promise<void> {
  const shot = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  const file = join(OUT, `${TAG}-${name}.png`);
  await writeFile(file, Buffer.from(shot.data, 'base64'));
  console.log(`  ${name.padEnd(20)} → snaps/map/${TAG}-${name}.png`);
}

/**
 * Ждём, пока земля уляжется. Тайл печётся по одному за кадр (закон кадра), а на
 * экран их идёт до дюжины — без ожидания в снимок попала бы недопечённая карта,
 * и разница «до/после» читалась бы там, где её нет.
 */
const SETTLE_MS = 3000;

async function open(server: Server, url: string): Promise<Tab> {
  void server;
  const tab = await Tab.open(DEBUG_PORT, url);
  await openPinnedMap(tab, { onLog: (line) => console.log(line) });
  await tab.eval<string>(PROBE);
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await sleep(SETTLE_MS);
  return tab;
}

async function closeTab(tab: Tab): Promise<void> {
  tab.close();
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`);
}

async function run(server: Server, fog: boolean, spots: Spot[], lair: { x: number; y: number }): Promise<void> {
  if (spots.length === 0) return;
  const url = `http://127.0.0.1:${PORT}/?probe=1${fog ? '' : '&worldview=open'}`;
  const tab = await open(server, url);
  const home = await tab.eval<{ x: number; y: number }>('window.__home()');
  try {
    for (const s of spots) {
      const p = s.place === 'home' ? home : s.place === 'lair' ? lair : s.place;
      await tab.eval<string>(
        `(() => { window.__mapCam(${p.x}, ${p.y}, ${s.scale}); return JSON.stringify('ok'); })()`,
      );
      await sleep(SETTLE_MS);
      await shoot(tab, s.name);
    }
  } finally {
    await closeTab(tab);
  }
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });
  const wanted = SPOTS.filter((s) => !ONLY || s.name === ONLY);
  if (wanted.length === 0) {
    console.log(`Нет кадра «${ONLY}». Есть: ${SPOTS.map((s) => s.name).join(', ')}`);
    return;
  }
  console.log(`\n=== снимки карты (${TAG}) ===\n`);
  const lair = await lairNear();
  console.log(`Дом закреплён: ${HOME.x}|${HOME.y}, сид ${SEED}. Логово: ${lair.x}|${lair.y}. Экран 375×812, dpr 2.\n`);
  const server = serveDist();
  const chrome = await launchChrome(DEBUG_PORT, ['--window-size=500,900', '--force-device-scale-factor=1']);
  try {
    await run(server, false, wanted.filter((s) => !s.fog), lair);
    await run(server, true, wanted.filter((s) => s.fog), lair);
  } finally {
    chrome.kill();
    server.close();
    await sleep(300);
  }
  console.log('\nЧто чем отвечает:\n');
  for (const s of wanted) console.log(`  ${s.name.padEnd(20)} ${s.why}`);
  console.log('\nСудить — глазами. Стенд ничего не утверждает и ничем не падает.\n');
}

void main();
