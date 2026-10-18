// Стенд вида «город» (docs/city.md): снимки и счётчики кадра — не отчёт, в приёмку не входит.
//
//   npm run city:shots                         — ракурс игры, средний, день
//   QUALITY=high,low VIEWS=game,street SOLAR=0.2,0.75 TAG=r2 npm run city:shots
//   EXTRA="at=4,5,70&dist=30" VIEWS=street npm run city:shots   — свой ракурс поверх названного
//   TEX=1 npm run city:shots                   — слои текстур листом (без браузера)
//   BUDGET=1 npm run city:shots                — бюджет по уровням счётом (без браузера); `BUILD_MS=1` — и цена сборки мира
//   GAME=1 QUALITY=medium npm run city:shots   — сама игра по адресу `?look=city`: стартовый кадр
//                                                (сцена города в игре, не стенд), TAG и QUALITY те же
//   GAME=1 WX=clear,rain,storm npm run city:shots — погода адресом (`?weather=`, docs/city.md, 15): кадр игры на каждую,
//                                                `WXLOOK=market:70` — вблизи постройки (тип:расстояние; `-4,10,-30:60` —
//                                                точка плана; `…:60:150` — камера повёрнута на 150°), `WXMAP=1` —
//                                                карта мира, `WXSEASON=winter` — сезон партии, `WXREGION=italy` — регион,
//                                                `WXDAY=0.8` — доля суток партии (0.8 летом — глубокая ночь, docs/polish.md, П-3)
//   GAME=1 WX=clear CHAMBERS=desk npm run city:shots — покои правителя (docs/city_v3.md, Г-4): точка интереса
//                                                (hall, desk, window, hearth, bed, arms), `:доворот:наклон:безделушка:подсветка`
//   LEGEND=1 npm run city:shots              — легенда карты листом: строки значков той же функцией, что окно легенды
//                                                (docs/city.md, 16.5); `GAME=1 WXMAP=1 LEGEND=1` — окно в самой игре
//   SIZE=540x900 VIEWS=game SOLAR=0.46 npm run city:shots — свой экран (точки CSS, плотность 2): кадры заставки
//                                                экрана загрузки (assets-src/splash/README.md — какие и какими числами)
//
// Снимки — в `.city-shots/` (в репозиторий не входит). Бюджет железа (CLAUDE.md, раздел ⛔): один
// прогон, браузер с потолком кадров отчёта, не дольше двух минут на заход, минута остывания
// видеокарты перед заходом; рядом с чужой тяжёлой работой стенд не запускается.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite } from 'vite';
import sharp from 'sharp';
import { ENTER_GAME, launchChrome, reportPage, sleep, Tab } from './lib/chrome';
import { BROWSER_MAX_MS, REPORT_FPS, gpuCoolDown, gpuStamp, refuseIfBusy } from './lib/budget';
import { QUALITY, qualityOf, type Quality } from '../src/render/quality';
import { LAYERS, paintLayer } from '../src/render/city/tex';
import { cityCounts, CITY_BUDGET } from '../src/render/city/budget';
import { buildWorld } from '../src/render/city/world';
import { QUALITIES as ALL_QUALITIES } from '../src/render/quality';
import { SEASON_SECONDS } from '../src/game/data/seasons';
import { DAY_LENGTH } from '../src/game/pace';

const OUT = fileURLToPath(new URL('../.city-shots', import.meta.url));
const PORT = Number(process.env.PORT ?? 4199);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9342);
// Экран телефона; `SIZE=ШxВ` — свой (кадр заставки шире и выше телефона: его подрежут обе ориентации).
const SIZE = /^(\d+)x(\d+)$/.exec(process.env.SIZE ?? '');
const SCREEN = { width: SIZE ? Number(SIZE[1]) : 390, height: SIZE ? Number(SIZE[2]) : 844, deviceScaleFactor: 2, mobile: true };
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

/**
 * Легенда карты листом (`LEGEND=1` без `GAME`, docs/city.md, 16.5): страница на сервере стенда тянет лист значков и
 * `tw/legend.ts` и рисует строки той же функцией, что окно легенды (`legendUrl`). Карта стендом в облаке не встаёт —
 * сторож кадров снимает её и на `master`, — а строки легенды от кадра не зависят.
 */
async function legendShot(): Promise<void> {
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
    await tab.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/src/ui/map/tw/legend.ts` });
    await sleep(1500);
    const r = await tab.eval<string>(`(async () => {
      const sheet = await import('/src/ui/icons/sheet.ts');
      sheet.loadSheet();
      for (let i = 0; i < 100 && !sheet.sheetSymbol('stage-town'); i++) await new Promise((r) => setTimeout(r, 100));
      const L = await import('/src/ui/map/tw/legend.ts');
      document.querySelector('pre')?.remove();
      document.body.style.cssText = 'margin:0;padding:14px;background:#1d1813;color:#eadfc8;font:15px/1.3 system-ui,sans-serif';
      const box = document.createElement('div');
      for (const [title, rows] of [['Города и логова', L.PLACE_ROWS], ['Отряды и метки', L.HOST_ROWS]]) {
        const h = document.createElement('h3');
        h.textContent = title;
        h.style.cssText = 'margin:10px 0 6px;font-size:16px;color:#e0b25a';
        box.append(h);
        for (const row of rows) {
          const d = document.createElement('div');
          d.style.cssText = 'display:flex;align-items:center;gap:10px;min-height:52px';
          const img = document.createElement('img');
          img.src = L.legendUrl(row);
          img.style.cssText = 'width:52px;height:52px;object-fit:contain;flex:0 0 auto';
          const t = document.createElement('span');
          t.innerHTML = row.name + (row.note ? ' <em style="opacity:.7;font-size:13px">' + row.note + '</em>' : '');
          d.append(img, t);
          box.append(d);
        }
      }
      document.body.append(box);
      return JSON.stringify(sheet.sheetSymbol('stage-town') ? 'ok' : 'лист не пришёл');
    })()`);
    await sleep(800);
    const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const name = `${TAG}-legend.png`;
    await writeFile(join(OUT, name), Buffer.from(png.data, 'base64'));
    console.log(`  легенда карты: ${r} → .city-shots/${name}`);
  } finally {
    tab.close();
  }
}

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

/** Игра по адресу `?look=city`: новая партия, вход, стартовый кадр города и счётчики сцены. */
async function gameShot(q: Quality): Promise<void> {
  const tab = await Tab.open(DEBUG_PORT, reportPage(PORT, `&look=${process.env.LOOK ?? 'city'}&quality=${q}`));
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
    // Касание — до перезагрузки: иначе страница не считает себя сенсорной, и касание CDP не становится
    // указателем `touch` (как у `tap:report`).
    if (process.env.TAP === '1') await tab.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} return JSON.stringify("ok"); })()');
    await tab.send('Page.reload');
    let ok = false;
    for (let i = 0; i < 200; i++) {
      await sleep(300);
      if (await tab.eval<boolean>('JSON.stringify(!!(window.__scene && window.__game))').catch(() => false)) {
        ok = true;
        break;
      }
    }
    if (!ok) {
      console.log('  игра: сцена не поднялась за 60 с');
      return;
    }
    // Вход и сборка — с повтором: обещание, которое ждёт CDP, страница изредка теряет («Promise was collected»), а
    // город при этом собирается как собирался.
    const retry = async <T,>(f: () => Promise<T>): Promise<T> => {
      for (let k = 0; ; k++) {
        try {
          return await f();
        } catch (e) {
          if (k >= 2) throw e;
          await sleep(2000);
        }
      }
    };
    await retry(() => tab.eval<string>(ENTER_GAME));
    const built = await retry(() => tab.eval<string>(`new Promise((ok) => {
      const s = window.__scene;
      // Обещание сборки у сцены города — \`ready\` (прежде — \`built\`).
      const done = s && (s.ready || s.built);
      if (!done) return ok(JSON.stringify('не город: ' + (s && s.constructor && s.constructor.name)));
      const t = setTimeout(() => ok(JSON.stringify('не собрался за 90 с')), 90000);
      done.then(() => { clearTimeout(t); ok(JSON.stringify('собран')); });
    })`));
    console.log(`  игра ${q}: ${built}`);
    // Обучение снято: его затемнение — не вид города (как у `tap:report`).
    await tab.eval<string>(`(() => { const s = window.__game.getState().s; s.tutorialDone = true; window.__game.setState({ s: { ...s } }); return JSON.stringify('ok'); })()`);
    // Касание — сразу, пока сторож кадров не счёл медленные программные кадры остановкой (см. `gameTaps`).
    if (process.env.TAP === '1') await gameTaps(tab);
    if (process.env.DEEDS === '1') {
      await deedShots(tab, q);
      return;
    }
    if (process.env.WX) {
      await weatherShots(tab, q);
      return;
    }
    await sleep(3000);
    const c = await tab.eval<{ calls: number; triangles: number }>('JSON.stringify(window.__scene.stats())');
    const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const name = `${TAG}-game-${q}.png`;
    await writeFile(join(OUT, name), Buffer.from(png.data, 'base64'));
    console.log(`  игра ${q}: вызовов ${c.calls}, треугольников ${c.triangles} → .city-shots/${name}`);
  } finally {
    tab.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`).catch(() => undefined);
  }
}

/**
 * Касание в самой игре (`TAP=1` к `GAME=1`): обучение снято, каждая постройка, чья середина на экране между шапкой и
 * нижней панелью, получает настоящий тап пальцем (касание CDP, тот же путь, что у игрока: общий судья жеста →
 * `CityScene.pickAt` → окно постройки). Печатает, сколько открыли своё окно, и кто открыл чужое. Не отчёт: числа —
 * стенду, судит `sites.test.ts` по раскладке.
 */
async function gameTaps(tab: Tab): Promise<void> {
  await tab.eval<string>(`(() => {
    const g = window.__game.getState();
    const s = g.s;
    s.tutorialDone = true;
    s.inbox = [];
    s.winterWarning = false;
    s.nextEventAt = s.time + 1e9;
    window.__game.setState({ s: { ...s } });
    g.openBuilding(null);
    return JSON.stringify('ok');
  })()`);
  // Кадр города в облаке рисует программная видеокарта — около полсекунды: отпускание пальца ждало бы
  // кадра, и тап выходил бы дольше `TAP_MS` (долгое нажатие). На время тапов мир скрыт — кадр пуст и
  // быстр; касание судит коробки мест, а не пиксели, — проверяется цепочка касания, а не скорость
  // программной отрисовки.
  await tab.eval<string>(`(() => { const sc = window.__scene; sc.scene.children.forEach((o) => { if (o.type === 'Group') o.visible = false; }); return JSON.stringify('ok'); })()`);
  await sleep(1500);
  const list = await tab.eval<{ id: number; type: string; x: number; y: number }[]>(`JSON.stringify(
    window.__game.getState().s.buildings.map((b) => {
      const p = window.__scene.screenSpot(b.id);
      return p ? { id: b.id, type: b.type, x: p.x, y: p.y } : null;
    }).filter((p) => p && p.x > 8 && p.x < innerWidth - 8 && p.y > 130 && p.y < innerHeight - 90)
  )`);
  let own = 0;
  const wrong: string[] = [];
  for (const p of list) {
    await tab.eval<string>(`(() => { window.__game.getState().openBuilding(null); return JSON.stringify('ok'); })()`);
    await sleep(450);
    const free = await tab.eval<boolean>(`JSON.stringify(document.elementFromPoint(${p.x}, ${p.y}) instanceof HTMLCanvasElement)`);
    if (!free) {
      const who = await tab.eval<string>(`JSON.stringify((() => { const e = document.elementFromPoint(${p.x}, ${p.y}); return e ? e.tagName + '.' + String(e.className).slice(0, 40) : '—'; })())`);
      wrong.push(`${p.type}: точка под разметкой (${who})`);
      continue;
    }
    const pt = { x: p.x, y: p.y, radiusX: 12, radiusY: 12, force: 1 };
    await tab.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt] });
    await sleep(90);
    await tab.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(60);
    const sheet = await tab.eval<number | null>(`JSON.stringify((() => { const sh = window.__game.getState().sheet; return sh && sh.kind === 'building' ? sh.id : null; })())`);
    if (sheet === p.id) own++;
    else wrong.push(`${p.type} → ${sheet === null ? 'ничего' : (list.find((o) => o.id === sheet)?.type ?? `id ${sheet}`)}`);
  }
  console.log(`  касание в игре: тапов ${list.length}, своё окно — ${own}${wrong.length ? `; мимо: ${wrong.join(', ')}` : ''}`);
  await tab.eval<string>(`(() => { const sc = window.__scene; window.__game.getState().openBuilding(null); sc.scene.children.forEach((o) => { if (o.type === 'Group') o.visible = true; }); return JSON.stringify('ok'); })()`);
}

/**
 * Погода (`WX=` к `GAME=1`, docs/city.md, 15): одна партия, погода — адресом страницы, который сцена перечитывает; кадр
 * на каждую, по желанию — вблизи постройки (`WXLOOK=тип:расстояние`). Гроза снимается в миг вспышки.
 */
async function weatherShots(tab: Tab, q: Quality): Promise<void> {
  await tab.eval<string>(`(() => {
    const st = document.createElement('style');
    st.textContent = '.trouble { display: none !important; }';
    document.head.appendChild(st);
    const s = window.__game.getState().s;
    s.inbox = [];
    s.winterWarning = false;
    s.nextEventAt = s.time + 1e9;
    s.hints = { seen: [], off: true };
    window.__game.setState({ s: { ...s } });
    return JSON.stringify('ok');
  })()`);
  // Регион (`WXREGION=italy`): климат пояса — снег на кровлях, лёд на реке. Мир в облаке ставит город, где придётся.
  const region = process.env.WXREGION;
  if (region) await tab.eval<string>(`(() => { window.__scene.setRegion(${JSON.stringify(region)}); return JSON.stringify('ok'); })()`);
  // Сезон партии (`WXSEASON=winter`): снег над снежным городом, а не над летним.
  const season = process.env.WXSEASON;
  if (season) {
    const k = ['spring', 'summer', 'autumn', 'winter'].indexOf(season);
    await tab.eval<string>(`(() => {
      const s = window.__game.getState().s;
      s.time = ${Math.max(0, k) * SEASON_SECONDS + Math.round((SEASON_SECONDS * 0.3) / DAY_LENGTH) * DAY_LENGTH} + (s.time % ${DAY_LENGTH});
      window.__game.setState({ s: { ...s } });
      // Палитра сезона переливается секундами, а программный кадр облака — секунда: ставим сразу.
      window.__scene.seasonVis.jump(${JSON.stringify(season)});
      return JSON.stringify('ok');
    })()`);
  }
  // Час партии (`WXDAY=0.8`): доля суток — ночь, утро, вечер; дождь ночью у фонарей.
  const day = process.env.WXDAY;
  if (day) {
    await tab.eval<string>(`(() => {
      const s = window.__game.getState().s;
      s.time = s.time - (s.time % ${DAY_LENGTH}) + ${Number(day)} * ${DAY_LENGTH};
      window.__game.setState({ s: { ...s } });
      return JSON.stringify('ok');
    })()`);
  }
  // Карта мира (`WXMAP=1`): облака и их тени над регионом — та же погода.
  const map = process.env.WXMAP === '1';
  if (map) {
    await tab.eval<string>(`(() => { window.__game.getState().openMap(); return JSON.stringify('ok'); })()`);
    await sleep(15000);
    // Легенда карты (`LEGEND=1`, docs/city.md, 16.5): кнопка «Легенда» внизу карты; значки — ленивым куском.
    if (process.env.LEGEND === '1') {
      await tab.eval<string>(`(() => {
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim().endsWith('Легенда'));
        b?.click();
        return JSON.stringify(b ? 'ok' : 'нет кнопки');
      })()`);
      await sleep(3000);
      // Строки значков — ниже рельефа и тумана: прокрутить окно легенды к ним.
      await tab.eval<string>(`(() => {
        const l = document.querySelector('.wm-legend');
        const h = [...(l?.querySelectorAll('h3') ?? [])].find((x) => x.textContent === 'Города и логова');
        if (l && h) l.scrollTop = h.offsetTop - 8;
        return JSON.stringify('ok');
      })()`);
      await sleep(1500);
    }
  }
  const near = process.env.WXLOOK;
  if (near && !map) {
    const [type, dist, yaw] = near.split(':');
    // `WXLOOK=x,y,z:расстояние` — точка плана вместо постройки (паперть храма, docs/city_v3.md).
    const at = type.includes(',') ? type.split(',').map(Number) : null;
    await tab.eval<string>(`(() => {
      const sc = window.__scene;
      const at = ${JSON.stringify(at)};
      const own = sc.sites.filter((x) => x.type === ${JSON.stringify(type)});
      const m = at ? null : own.reduce((a, b) => (a.hf * a.hr >= b.hf * b.hr ? a : b));
      if (at) sc.target.set(at[0], at[1], at[2]);
      else sc.target.set(m.x, m.y0 + 3, m.z);
      sc.dist = ${Number(dist) || 60};
      // Третье число — поворот камеры вокруг цели, градусы (…:220:150 — ворота с дорогой вдаль, docs/city_v3.md, Г-3).
      sc.spinTurn = ${(Number(yaw) || 0) * Math.PI / 180};
      sc.userMoved = true;
      sc.place();
      return JSON.stringify('ok');
    })()`);
  }
  // Покои правителя (`CHAMBERS=desk` к `GAME=1 WX=…`, docs/city_v3.md, Г-4): точка интереса, поворот головы от её
  // взгляда (`:доворот:наклон`, радианы) и безделушка в руке (`:…:…:goblet`) — глаз встаёт сразу, без перехода;
  // `at:x:z:поворот:наклон` — встать стоя в точку пола (Г-6: подписи вблизи).
  const ch = process.env.CHAMBERS;
  if (ch) {
    const [poi, dy, dp, hold, hover] = ch.split(':');
    // Подписи-указатели первого входа на снимках не нужны (`COACH=1` — снять и их).
    const coach = process.env.COACH ? '' : "try { localStorage.setItem('tribe.chambers.coach', '1'); } catch {}";
    // `RULER=Бертран` — имя правителя до входа (Г-9): дом и нрав супруги — из имени, разговор повторяется от прогона к прогону.
    const ruler = process.env.RULER ? `(() => { const g = window.__game.getState(); g.s.realm.ruler.name = ${JSON.stringify(process.env.RULER)}; window.__game.setState({ s: { ...g.s } }); })();` : '';
    const said = await tab.eval<string>(`new Promise((ok) => {
      ${coach}
      ${ruler}
      window.__chambersOpen.getState().show();
      let n = 0;
      const t = setInterval(() => {
        const r = window.__chambers;
        if (r) {
          clearInterval(t);
          if (${JSON.stringify(poi)} === 'at') r.standAtPoint(${Number(dy) || 0}, ${Number(dp) || 0}, ${Number(hold) || 0}, ${Number(hover) || 0});
          else r.snap(${JSON.stringify(poi)}, ${Number(dy) || 0}, ${Number(dp) || 0}, ${JSON.stringify(hold || null)}, ${JSON.stringify(hover || null)});
          ok(JSON.stringify('покои: ' + ${JSON.stringify(poi)} + ', треугольников ' + r.counts().triangles));
        } else if (++n > 300) {
          clearInterval(t);
          ok(JSON.stringify('покои не поднялись'));
        }
      }, 200);
    })`);
    console.log(`  ${said}`);
    // Жизнь покоев (Г-7): `LIFE='{"who":"servant","at":{"x":3.75,"z":-4.6,"yaw":3.1},"talk":true}'` — поставить людей и кота
    // сразу (`ChambersLife.stage`); списком — несколько (`LIFE='[{"who":"maid"},{"cat":"floor"}]'`).
    if (process.env.LIFE) {
      const r = await tab.eval<string>(`JSON.stringify((() => { const l = window.__chambers.life; for (const s of [].concat(${process.env.LIFE})) l.stage(s); return 'жизнь: ' + JSON.stringify(l.view()); })())`);
      console.log(`  ${r}`);
    }
    // Ответ в окне разговора (Г-9): `TALKPICK=Останься` — коснуться ответа с этими словами, когда реплика проступила
    // (через «|» — несколько подряд); `LIFE_AFTER='{"night":{"k":0.95,"who":"wife"}}'` — что поставить после ответа (утро
    // после ночи — без ожидания сцены).
    for (const pick of (process.env.TALKPICK ?? '').split('|').filter(Boolean)) {
      const said = await tab.eval<string>(`new Promise((ok) => {
        let n = 0;
        const t = setInterval(() => {
          const line = document.querySelector('.ch-talk-line');
          if (line) line.click();
          const b = [...document.querySelectorAll('.ch-talk-opts button')].find((x) => x.textContent.includes(${JSON.stringify(pick)}) && !x.disabled);
          if (b) {
            clearInterval(t);
            b.click();
            setTimeout(() => ok(JSON.stringify('ответ: ' + b.textContent + ' → ' + (document.querySelector('.ch-talk-line')?.textContent ?? '—'))), 600);
          } else if (++n > 60) {
            clearInterval(t);
            ok(JSON.stringify('ответа «' + ${JSON.stringify(pick)} + '» нет'));
          }
        }, 250);
      })`);
      console.log(`  ${said}`);
    }
    if (process.env.LIFE_AFTER) {
      const r = await tab.eval<string>(`JSON.stringify((() => { const l = window.__chambers.life; for (const s of [].concat(${process.env.LIFE_AFTER})) l.stage(s); return 'жизнь после: ' + JSON.stringify(l.view()); })())`);
      console.log(`  ${r}`);
    }
    await sleep(2500);
    const diag = await tab.eval<string>(`JSON.stringify((() => {
      const r = window.__scene.renderer;
      const out = (r.info.programs || []).filter((p) => p.diagnostics && !p.diagnostics.runnable).map((p) => p.name + ': ' + (p.diagnostics.fragmentShader.log || '') + (p.diagnostics.vertexShader.log || '') + p.diagnostics.programLog);
      const room = window.__chambers;
      out.push('cam ' + room.camera.position.toArray().map((x) => x.toFixed(1)).join(',') + ' origin ' + room.origin.toArray().map((x) => x.toFixed(1)).join(','));
      out.push('meshes ' + room.scene.children.length);
      const st = window.__scene.stats();
      out.push('кадр: вызовов ' + st.calls + ', треугольников ' + st.triangles);
      const u = room.u;
      const c3 = (c) => [c.r, c.g, c.b].map((x) => x.toFixed(2)).join(',');
      out.push('небо ' + c3(u.uSky.value) + ' солнце ' + c3(u.uSun.value) + ' к солнцу ' + u.uSunDir.value.toArray().map((x) => x.toFixed(2)).join(','));
      return out.join(' | ');
    })())`);
    console.log(`  диагностика: ${diag}`);
    // Затемнение входа гаснет за 0.7 с настоящего времени, а программный кадр облака — около секунды.
    await sleep(5000);
  }
  for (const wx of list(process.env.WX, 'clear')) {
    await tab.eval<string>(`(() => {
      const u = new URL(location.href);
      u.searchParams.set('weather', ${JSON.stringify(wx)});
      history.replaceState(null, '', u.toString());
      // Погода кадра переливается секундами (П-3), а программный кадр облака — секунда: ставим сразу.
      window.__scene.jumpWeather?.();
      return JSON.stringify('ok');
    })()`);
    // Программный кадр в облаке — около секунды: ждём несколько кадров с новой погодой и докачку осадков.
    await sleep(4000);
    if (wx === 'storm') {
      for (let i = 0; i < 80; i++) {
        if (await tab.eval<boolean>('JSON.stringify(window.__scene.flash > 0.35 && (window.__scene.pause(), true))').catch(() => false)) break;
        await sleep(150);
      }
    }
    const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    const name = `${TAG}-wx-${wx}${day ? '-d' + day : ''}${region ? '-' + region : ''}${map ? '-map' : near ? '-' + near.replace(/:/g, '') : ''}${ch ? '-ch-' + ch.replace(/:/g, '_') : ''}-${q}.png`;
    await writeFile(join(OUT, name), Buffer.from(png.data, 'base64'));
    if (wx === 'storm') await tab.eval<string>(`(() => { window.__scene.resume(); return JSON.stringify('ok'); })()`);
    // Ровен ли свет между кадрами (Г-9, мерцание у окна): `BURST=12 BURSTBOX=0.05,0.76,0.3,0.82` — столько снимков подряд,
    // средняя яркость прямоугольника кадра (доли ширины и высоты) по каждому и наибольший скачок между соседними.
    const burst = Number(process.env.BURST ?? 0);
    if (burst > 0) {
      const [bx0, by0, bx1, by1] = (process.env.BURSTBOX ?? '0.05,0.76,0.3,0.82').split(',').map(Number);
      const lum: number[] = [];
      for (let i = 0; i < burst; i++) {
        const shot = Buffer.from((await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })).data, 'base64');
        const img = sharp(shot);
        const { width = 1, height = 1 } = await img.metadata();
        const left = Math.round(bx0 * width);
        const top = Math.round(by0 * height);
        const { channels } = await img
          .extract({ left, top, width: Math.max(1, Math.round((bx1 - bx0) * width)), height: Math.max(1, Math.round((by1 - by0) * height)) })
          .stats();
        lum.push(0.2126 * channels[0].mean + 0.7152 * channels[1].mean + 0.0722 * channels[2].mean);
        if (process.env.BURSTU) console.log('    ' + (await tab.eval<string>(`JSON.stringify((() => { const r = window.__chambers; if (!r) return ''; const u = r.u; const l = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b).toFixed(3); return 'солнце ' + l(u.uSun.value) + ' небо ' + l(u.uSky.value) + ' рассеянный ' + l(u.uAmb.value) + ' к солнцу ' + u.uSunDir.value.toArray().map((x) => x.toFixed(3)).join(',') + ' кадр ' + window.__scene.frameNo; })())`)));
        await sleep(120);
      }
      const jumps = lum.slice(1).map((v, i) => Math.abs(v - lum[i]));
      console.log(`  ровность ${q}: яркость ${lum.map((v) => v.toFixed(1)).join(' ')}; наибольший скачок ${Math.max(0, ...jumps).toFixed(1)}`);
    }
    const pc = await tab.eval<string>('JSON.stringify(JSON.stringify(window.__scene.precip ? { поле: window.__scene.precip.grounded, ...window.__scene.precip.counts() } : null))').catch(() => '?');
    console.log(`  погода ${q}: ${wx} → .city-shots/${name}; осадки ${pc}`);
  }
}

/**
 * Отклик игры на действия (`DEEDS=1` к `GAME=1`, docs/city.md, 14): шесть снимков одной партии — стройка лесами,
 * её конец, волна добычи «пока тебя не было», найм строем, шторка на ходу и нажатая кнопка. Состояние правится
 * через стор игры, как у `gameTaps`; события и почта сняты, чтобы окно не закрыло город.
 */
async function deedShots(tab: Tab, q: Quality): Promise<void> {
  const snap = async (name: string): Promise<void> => {
    const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(OUT, `${TAG}-deeds-${q}-${name}.png`), Buffer.from(png.data, 'base64'));
    console.log(`  отклик ${q}: ${name} → .city-shots/${TAG}-deeds-${q}-${name}.png`);
  };
  // Ждать условия на странице (не дольше 30 с): часы сцены, надписи, строй.
  const until = async (cond: string): Promise<void> => {
    for (let i = 0; i < 120; i++) {
      if (await tab.eval<boolean>(`JSON.stringify(!!(${cond}))`).catch(() => false)) return;
      await sleep(250);
    }
    console.log(`  отклик ${q}: не дождался ${cond.slice(0, 60)}`);
  };
  // Снимок мига: дождались — сцена встаёт на этом кадре (тот же \`pause\`, что у карты), снимок, и сцена идёт дальше.
  // Программный кадр длится секунду: без остановки снимок ловил бы кадр, когда праздник уже кончился.
  const still = async (cond: string, name: string, after = 0): Promise<void> => {
    await until(`(${cond}) && (window.__scene.pause(), true)`);
    if (after) await sleep(after);
    await snap(name);
    await tab.eval<string>(`(() => { window.__scene.resume(); return JSON.stringify('ok'); })()`);
  };
  // Камера — к месту постройки (`look`): цель, расстояние; мимо `place` сцены — те же числа, что у пальца.
  const look = (type: string, dist: number): Promise<string> =>
    tab.eval<string>(`(() => {
      const sc = window.__scene;
      const own = sc.sites.filter((x) => x.type === ${JSON.stringify(type)});
      const m = own.reduce((a, b) => (a.hf * a.hr >= b.hf * b.hr ? a : b));
      sc.target.set(m.x, m.y0 + 3, m.z);
      sc.dist = ${dist};
      sc.userMoved = true;
      sc.place();
      return JSON.stringify(m.type);
    })()`);
  const pick = await tab.eval<{ id: number; type: string }>(`JSON.stringify((() => {
    // Программная видеокарта облака рисует кадр за полсекунды — сторож кадров зовёт это остановкой и кладёт поверх
    // города экран восстановления; на снимках его нет, город под ним рисуется как рисовался.
    const st = document.createElement('style');
    st.textContent = '.trouble { display: none !important; }';
    document.head.appendChild(st);
    const g = window.__game.getState();
    const s = g.s;
    s.inbox = [];
    s.winterWarning = false;
    s.nextEventAt = s.time + 1e9;
    s.hints = { seen: [], off: true };
    const b = s.buildings.find((x) => x.type === 'tavern') || s.buildings[1];
    b.workRequired = 400;
    b.work = 120;
    window.__game.setState({ s: { ...s } });
    return { id: b.id, type: b.type };
  })())`);
  await look(pick.type, 120);
  await sleep(3500);
  await snap('1-build');
  await tab.eval<string>(`(() => {
    const s = window.__game.getState().s;
    const b = s.buildings.find((x) => x.id === ${pick.id});
    b.level += 1;
    b.work = 0;
    b.workRequired = 0;
    window.__game.setState({ s: { ...s } });
    return JSON.stringify('ok');
  })()`);
  // Вспышка — первые 0.7 с праздника, стяг на крыше — с секунды до шести. Ждём по часам сцены: программная отрисовка
  // облака кладёт кадр за секунду и больше, настоящие секунды тут не мерка.
  const age = (a: number): string => `(() => { const f = window.__scene.deeds?.feasts?.[0]; return !!f && window.__scene.clock.elapsedTime - f.t0 > ${a}; })()`;
  await still(age(0.05), '2-done');
  await still(age(1.6), '2b-banner');
  // Волна «пока тебя не было»: окно «С возвращением» закрыто кнопкой «Посмотреть» — сцена показывает добычу отлучки.
  await tab.eval<string>(`(() => {
    const sc = window.__scene;
    sc.userMoved = false;
    sc.resize();
    // Склад не полон: у потолка добыча пропадает и над двором не всплывает (\`pops.YieldTally\`).
    const s = window.__game.getState().s;
    for (const r of Object.keys(s.resources)) s.resources[r] = Math.floor(s.resources[r] * 0.4);
    window.__game.setState({ s: { ...s }, offlineSeconds: 3 * 3600 });
    window.__game.getState().dismissOffline();
    return JSON.stringify('ok');
  })()`);
  // Надписи поднимаются анимацией CSS по настоящим часам: снимок ставит каждую на её полсекунды — всплыла и видна.
  await until(`document.querySelectorAll('.city-pop.go').length > 2 && (window.__scene.pause(), true)`);
  await tab.eval<string>(`(() => { for (const a of document.getAnimations()) if (a.animationName === 'city-pop') { a.pause(); a.currentTime = 450; } return JSON.stringify('ok'); })()`);
  await snap('3-yield');
  await tab.eval<string>(`(() => { for (const a of document.getAnimations()) if (a.animationName === 'city-pop') a.play(); window.__scene.resume(); return JSON.stringify('ok'); })()`);
  // Найм: заказ в казармах, потом он обучен целиком — заказ снят, бойцы в войске (как кончается настоящий найм).
  await tab.eval<string>(`(() => {
    const s = window.__game.getState().s;
    const troop = Object.keys(s.army)[0];
    s.recruits = [{ id: 990001, troop, count: 10, done: 0, work: 0, people: 10 }];
    window.__game.setState({ s: { ...s } });
    return JSON.stringify(troop);
  })()`);
  await sleep(400);
  await tab.eval<string>(`(() => {
    const s = window.__game.getState().s;
    const troop = Object.keys(s.army)[0];
    s.recruits = [];
    s.army[troop] += 10;
    window.__game.setState({ s: { ...s } });
    return JSON.stringify('ok');
  })()`);
  await look('barracks', 140);
  await still(`(window.__scene.deeds?.soldiers?.count ?? 0) >= ${q === 'low' ? 6 : 8}`, '4-muster');
  await tab.eval<string>(`(() => { window.__game.getState().openBuilding(${pick.id}); return JSON.stringify('ok'); })()`);
  await sleep(110);
  await snap('5-sheet');
  await sleep(1200);
  // Нажатая кнопка: палец лёг на главное действие шторки и держится — снимок до отпускания.
  const btn = await tab.eval<{ x: number; y: number } | null>(`JSON.stringify((() => {
    const b = [...document.querySelectorAll('.sheet.open button:not(:disabled)')].find((e) => e.getBoundingClientRect().height >= 40 && e.getBoundingClientRect().width > 120);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })())`);
  if (btn) {
    await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: btn.x, y: btn.y });
    await tab.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: btn.x, y: btn.y, button: 'left', clickCount: 1 });
    await sleep(250);
    await snap('6-press');
    // Отпускание за краем кнопки: щелчка нет — снимок не меняет партию.
    await tab.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2, button: 'left' });
    await tab.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 2, y: 2, button: 'left', clickCount: 1 });
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
          `земля ${c.ground}, деревья ${c.trees}, жизнь ${c.life}, вода и берег ${c.shore}), текстуры ${c.textureMb.toFixed(1)} МБ (≤ ${lim.textureMb})`,
      );
      // `BUILD_MS=1` — сколько стоит сборка мира в потоке (`world.buildWorld`): план, здания, земля (карты покрытий и
      // земель, сетка, сырость и грязь, берег) и деревья — в node, одним прогоном; телефон медленнее (docs/city_v3.md, Г-3).
      if (process.env.BUILD_MS === '1') {
        const ms = buildWorld(q).ms;
        console.log(`         сборка мира, мс: план ${ms.plan.toFixed(0)}, здания ${ms.build.toFixed(0)}, земля ${ms.ground.toFixed(0)}, деревья ${ms.trees.toFixed(0)}`);
      }
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
      if (process.env.GAME === '1') {
        for (const q of QUALITIES) await gameShot(q);
        return;
      }
      if (process.env.LEGEND === '1') {
        await legendShot();
        return;
      }
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
