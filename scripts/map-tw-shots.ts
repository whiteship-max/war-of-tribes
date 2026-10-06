// Стенд карты нового вида (docs/map_tw.md): снимки участка и цена выпечки — не отчёт, в приёмку не входит.
//
//   npm run map-tw:shots                                   — ракурс «start», высокий уровень, лето
//   SHOTS=start,coast,mountains QUALITY=high,medium TAG=r2 npm run map-tw:shots
//   EXTRA="season=winter&night=1" npm run map-tw:shots     — свои параметры поверх ракурса
//   SHOTS=objects EXTRA="scale=22" npm run map-tw:shots    — галерея миниатюр (места, войска, работы, значки);
//                                                            экран подгоняется под галерею (`dataset.need`)
//   GAME=1 SHOTS=44,24,7 npm run map-tw:shots              — сама игра (`FOG=1` — с туманом, как у игрока; `MARCHES=1` —
//                                                            с отрядами и лагерями у дома):
//                                                            закреплённый мир с домом в Генуе, кадр карты
//                                                            на масштабах из SHOTS
//   GAME=1 SICILY=1 SHOTS=44,24,7 npm run map-tw:shots     — тест с игроками: дом на месте острова, одиннадцать соседей
//                                                            из реестра (все четыре стадии), с MARCHES=1 — набег, поход,
//                                                            лагеря и полководец между ними; WIDTH=375 HEIGHT=812 — экран
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
import { cellAt, openPinnedMap } from './lib/pinned';
import { SICILY } from '../src/world/spawn';
import { ATLAS_HASH } from '../src/world/atlas/data';
import { BROWSER_MAX_MS, REPORT_FPS, gpuCoolDown, gpuStamp, refuseIfBusy } from './lib/budget';

const OUT = fileURLToPath(new URL('../.map-shots', import.meta.url));
const PORT = Number(process.env.PORT ?? 4197);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9344);
const SCREEN = { width: Number(process.env.WIDTH ?? 390), height: Number(process.env.HEIGHT ?? 844), deviceScaleFactor: 2, mobile: true };
const list = (s: string | undefined, d: string): string[] => (s ?? d).split(',').map((x) => x.trim()).filter(Boolean);
const SHOTS = list(process.env.SHOTS, 'start');
const QUALITIES = list(process.env.QUALITY, 'high');
const TAG = process.env.TAG ?? 'probe';
const EXTRA = process.env.EXTRA ?? '';
const GAME = process.env.GAME === '1';
/**
 * `MARCHES=1` — снимку игры отряды у дома: чужой набег на дом (бейдж «под ударом»), своё войско в походе,
 * чужой лагерь и свой лагерь у цели, полководец с войском. Пульс мира замирает, чтобы он не затёр их
 * (тот же приём, что `__parties` у `map:report`). Только для глаз — числа отсюда не берутся.
 */
const MARCHES = process.env.MARCHES === '1';
/** `SICILY=1` — двенадцать мест острова (`world/spawn.SICILY`): дом в середине кучки, соседи — строками реестра. */
const SICILY_MODE = process.env.SICILY === '1';
/** Дом — седьмое место (769|1337), в середине кучки: соседи со всех сторон. */
const SICILY_HOME = 6;
/** Соседи всех четырёх стадий (`meta.stageOf` по мощи и людям): стоянка, деревня, острог, крепость. */
const SICILY_STATS: readonly (readonly [number, number])[] = [
  [12, 8], [45, 16], [130, 40], [320, 90], [60, 20], [24, 10], [210, 70], [95, 31], [500, 140], [35, 13], [150, 45],
];
const SICILY_CITIES = ['Энна', 'Катания', 'Рагуза', 'Ното', 'Джела', 'Модика', 'Лентини', 'Пьяцца', 'Сиракузы', 'Калатины', 'Авола'];
const SICILY_ROSTER = (): string => {
  const others = SICILY.filter((_, i) => i !== SICILY_HOME);
  const castles = others.map((c, i) => ({
    id: `p${i + 1}`,
    x: c.x,
    y: c.y,
    name: `Вождь ${i + 1}`,
    city: SICILY_CITIES[i],
    power: SICILY_STATS[i][0],
    pop: SICILY_STATS[i][1],
    seenAt: Date.now(),
  }));
  return JSON.stringify({ at: Date.now(), epoch: ATLAS_HASH, mine: SICILY[SICILY_HOME], castles });
};
/** Отряды Сицилии: набег соседа на дом, свой поход к соседу, чужой и свой лагеря у соседских стен. */
const SICILY_MARCHES_JS = `(() => {
  const W = window.__world;
  W.setState({ pulse: async () => {} });
  const g = W.getState();
  const h = g.info.home;
  const now = Date.now();
  const m = (id, own, phase, from, to, men, targetId) => ({
    id, mission: 'raid', units: { warrior: men }, own, hostile: !own, phase, from, to,
    fromName: 'Стенд', toName: 'Стенд', targetId, departAt: now - 600000, arriveAt: now + 600000, loot: null, recallable: false,
  });
  const at = (dx, dy) => ({ x: h.x + dx, y: h.y + dy });
  W.setState({
    marches: [
      m('raid', false, 'out', at(5, -3), at(0, 0), 40, g.info.homeId),
      m('host', true, 'out', at(0, 0), at(-5, 3), 200, 'p4'),
      m('camp', false, 'stay', at(5, 9), at(5, 3), 12, 'p10'),
      m('ours', true, 'stay', at(0, 0), at(-5, -3), 30, 'p3'),
    ],
    figures: g.figures.map((f) => (f.id === 'general' ? { ...f, troops: { legionary: 60 } } : f)),
  });
  // Стая у ворот своего города — вызов, который мир ещё не посчитал (пульс заморожен): метка «волки» у значка.
  const G = window.__game.getState();
  G.s.gate = [{ id: 'stand', foe: 'wolves', power: 10, seed: 1, spoils: {} }];
  return JSON.stringify('ok');
})()`;
const MARCHES_JS = `(() => {
  const W = window.__world;
  W.setState({ pulse: async () => {} });
  const g = W.getState();
  const h = g.info.home;
  const now = Date.now();
  const m = (id, own, phase, from, to, men, targetId) => ({
    id, mission: 'raid', units: { warrior: men }, own, hostile: !own, phase, from, to,
    fromName: 'Стенд', toName: 'Стенд', targetId, departAt: now - 600000, arriveAt: now + 600000, loot: null, recallable: false,
  });
  const at = (dx, dy) => ({ x: h.x + dx, y: h.y + dy });
  W.setState({
    marches: [
      m('raid', false, 'out', at(-7, -6), at(0, 0), 40, g.info.homeId),
      m('host', true, 'out', at(1, 0), at(6, -6), 200, 'x1'),
      m('camp', false, 'stay', at(-6, -2), at(-4, -3), 12, 'x2'),
      m('ours', true, 'stay', at(0, 0), at(3, -4), 30, 'x3'),
    ],
    figures: g.figures.map((f) => (f.id === 'general' ? { ...f, troops: { legionary: 60 } } : f)),
  });
  return JSON.stringify('ok');
})()`;

/** Дом закреплённого мира для снимков игры — Генуя, тот же берег, что у стенда. */
const GAME_HOME = cellAt(8.95, 44.47);

function pageUrl(view: string, quality: string): string {
  const p = new URLSearchParams({ showcase: 'map-tw', view, quality, clean: '1', fpscap: String(REPORT_FPS) });
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

/** Ждёт `dataset.ready` страницы стенда; не встала за минуту — `false`. */
async function ready(tab: Tab): Promise<boolean> {
  for (let i = 0; i < 240; i++) {
    await sleep(250);
    const r = await tab.eval<string>(`JSON.stringify(document.body?.dataset.ready ?? '')`).catch(() => '');
    if (r === '1') return true;
  }
  return false;
}

/** Галерея миниатюр не помещается в телефон: экран — по её мере, в пределах разумного. */
const GALLERY_MAX = { width: 1400, height: 4200 };

async function shot(view: string, quality: string): Promise<void> {
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  try {
    const gallery = view.startsWith('objects');
    let screen = gallery ? { ...SCREEN, width: 640, height: 900 } : SCREEN;
    await tab.send('Emulation.setDeviceMetricsOverride', screen);
    await tab.send('Page.navigate', { url: pageUrl(view, quality) });
    let ok = await ready(tab);
    // Галерея пишет, сколько места ей нужно; экран подгоняется и страница печётся заново (раскладка
    // зависит от ширины — второй круг выравнивает высоту под новую ширину).
    for (let round = 0; gallery && ok && round < 3; round++) {
      const need = await tab.eval<string>(`JSON.stringify(document.body.dataset.need ?? '')`).catch(() => '');
      const [w, h] = need.split(',').map(Number);
      if (!(w > 0 && h > 0)) break;
      const next = { ...SCREEN, width: Math.min(GALLERY_MAX.width, Math.max(360, w)), height: Math.min(GALLERY_MAX.height, Math.max(400, h)) };
      if (next.width === screen.width && next.height === screen.height) break;
      screen = next;
      // Старая готовность не должна сойти за новую: флаг снимается до перехода.
      await tab.eval<string>(`(() => { delete document.body.dataset.ready; return JSON.stringify('ok'); })()`).catch(() => '');
      await tab.send('Emulation.setDeviceMetricsOverride', screen);
      await tab.send('Page.navigate', { url: pageUrl(view, quality) });
      ok = await ready(tab);
    }
    const label = `${quality} ${view}`;
    if (!ok) {
      console.log(`  ${label}: стенд не встал за 60 с`);
      return;
    }
    await sleep(300);
    const s = await tab.eval<Shown>(`document.body.dataset.showcase`);
    const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const scale = new URLSearchParams(EXTRA).get('scale');
    const name = `${TAG}-${quality}-${view}${gallery && scale ? `-${scale}` : ''}.png`;
    await writeFile(join(OUT, name), Buffer.from(png.data, 'base64'));
    if (gallery) {
      console.log(`  ${label.padEnd(16)} экран ${screen.width}×${screen.height} → .map-shots/${name}`);
      return;
    }
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

/**
 * Сама игра: закреплённый мир, карта открыта, камера над домом на масштабе из SHOTS. Вид карты один (прежняя удалена,
 * docs/ui_audit.md, 16). Регион печёт игра сама, вне кадра, — снимок ждёт, пока испечётся экран.
 */
async function gameShot(): Promise<void> {
  // Обзор мира открыт целиком — видно всю землю; `FOG=1` — как у игрока: туман и край старой карты.
  const q = new URLSearchParams({ probe: '1', fpscap: String(REPORT_FPS) });
  if (process.env.FOG !== '1') q.set('worldview', 'open');
  if (QUALITIES[0]) q.set('quality', QUALITIES[0]);
  // Свои параметры и игре: `EXTRA="night=1"` — ночь без ожидания ночи.
  for (const [k, v] of new URLSearchParams(EXTRA)) q.set(k, v);
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
    await tab.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?${q.toString()}` });
    await sleep(2500);
    const home = SICILY_MODE ? SICILY[SICILY_HOME] : GAME_HOME;
    const store = SICILY_MODE ? { 'tribe.castles.v1': SICILY_ROSTER() } : undefined;
    await openPinnedMap(tab, { home, store, onLog: (m) => console.log(m) });
    if (MARCHES) await tab.eval<string>(SICILY_MODE ? SICILY_MARCHES_JS : MARCHES_JS);
    await prebakeReport(tab);
    // Сицилия: камера на середине кучки — на дальнем масштабе видны все двенадцать.
    const look = SICILY_MODE ? { x: home.x - 3, y: home.y + 3 } : { x: home.x, y: home.y - 2 };
    for (const scale of SHOTS.map(Number).filter((v) => v > 0)) {
      await tab.eval<string>(`(() => { window.__mapCam(${look.x}, ${look.y}, ${scale}); return JSON.stringify('ok'); })()`);
      await sleep(5000);
      const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      const name = `${TAG}-game${SICILY_MODE ? `-sicily-${SCREEN.width}` : ''}-${scale}.png`;
      await writeFile(join(OUT, name), Buffer.from(png.data, 'base64'));
      const bakes = await tab.eval<string>('JSON.stringify(window.__mapPerf ? window.__mapPerf() : null)').catch(() => 'null');
      console.log(`  игра ×${scale}: → .map-shots/${name}${bakes && bakes !== 'null' ? ` · ${String(bakes).slice(0, 160)}` : ''}`);
    }
  } finally {
    tab.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`).catch(() => undefined);
  }
}

/**
 * Регион нового вида печётся заранее (docs/map_tw.md, раздел 13.4): снимок ждёт, пока регион прибудет (обзор
 * целиком, не дольше 30 с), и печатает, чем пёкся, сколько и почём — числа раздела 13.6 смотрят здесь глазами,
 * а мерит их `map:report` (`MOTION=1`).
 */
async function prebakeReport(tab: Tab): Promise<void> {
  type St = {
    exec: string | null;
    ready: boolean;
    plan: { chunks: number; mids: number; sheets: number } | null;
    have: Record<string, number>;
    inFlight: number;
    spent: Record<string, Record<string, number[]>>;
    memory: Record<string, number>;
  };
  const t0 = Date.now();
  let st: St | null = null;
  while (Date.now() - t0 < 30_000) {
    await sleep(500);
    st = await tab.eval<St>('JSON.stringify(window.__twPrebake ? window.__twPrebake() : null)').catch(() => null);
    if (st?.plan && st.have.chunk >= st.plan.chunks && (st.have.mid >= st.plan.mids || st.have.mid === 0) && st.inFlight === 0) break;
  }
  if (!st) {
    console.log('  регион: службы нет (`__twPrebake`)');
    return;
  }
  const med = (a: number[]): string => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1].toFixed(1) : '—');
  const MB = (b: number): string => (b / 1048576).toFixed(1);
  console.log(`  регион за ${((Date.now() - t0) / 1000).toFixed(1)} с: печёт ${st.exec}; план ${JSON.stringify(st.plan)}, есть ${JSON.stringify(st.have)}`);
  for (const where of ['worker', 'page']) {
    const parts = Object.entries(st.spent[where] ?? {})
      .filter(([, v]) => v.length)
      .map(([k, v]) => `${k} ${v.length} × ${med(v)} мс`);
    if (parts.length) console.log(`  ${where === 'worker' ? 'поток' : 'страница'}: ${parts.join(', ')}`);
  }
  console.log(`  память, МБ: ${Object.entries(st.memory).map(([k, v]) => `${k} ${MB(v)}`).join(', ')}`);
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
    console.log(`\n=== карта нового вида: снимки (${SHOTS.join(', ')}; ${QUALITIES.join(', ')}) ===\n`);
    await gpuCoolDown('стендом карты');
    // В облачном контейнере браузер идёт от root: песочница Chrome там не поднимается.
    const root = process.getuid?.() === 0 ? ['--no-sandbox'] : [];
    const chrome = await launchChrome(DEBUG_PORT, ['--window-size=500,900', '--force-device-scale-factor=1', ...root]);
    try {
      const began = Date.now();
      if (GAME) {
        await gameShot();
        return;
      }
      outer: for (const view of SHOTS) {
        for (const q of QUALITIES) {
          if (Date.now() - began > BROWSER_MAX_MS) {
            console.log(`\nСрок стенда (${BROWSER_MAX_MS / 1000} с) вышел — остальное отдельным заходом.`);
            break outer;
          }
          await shot(view, q);
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
