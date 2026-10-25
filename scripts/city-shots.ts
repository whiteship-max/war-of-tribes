// Стенд вида «город» (docs/city.md): снимки и счётчики кадра — не отчёт, в приёмку не входит.
//
//   npm run city:shots                         — ракурс игры, средний, день
//   QUALITY=high,low VIEWS=game,street SOLAR=0.2,0.75 TAG=r2 npm run city:shots
//   EXTRA="at=4,5,70&dist=30" VIEWS=street npm run city:shots   — свой ракурс поверх названного
//   TEX=1 npm run city:shots                   — слои текстур листом (без браузера)
//   BUDGET=1 npm run city:shots                — бюджет по уровням счётом (без браузера); `BUILD_MS=1` — и цена сборки мира
//   GAME=1 QUALITY=medium npm run city:shots   — сама игра по адресу `?look=city`: стартовый кадр
//   GAME=1 PANEL=barracks,stable npm run city:shots — окна построек: открытое и прокрученное к «Найму» (Р-3)
//                                                (сцена города в игре, не стенд), TAG и QUALITY те же;
//                                                `PANELSTATE='{"workers":{"farmer":8}}'` — поля партии поверх перед окнами,
//                                                печатает, влезает ли окно без прокрутки (ЗД-1, docs/city_v3.md);
//                                                `PANEL=tab:buildings` — раздел шторки («Здания» низа, РТ-1), `HALL=7` — уровень
//                                                ратуши, `PANELCLICK='.cn-card .kit-btn|…'` — касания по очереди, кадр после каждого
//                                                (`PANELWAIT=3000` — пауза перед кадром, мс: портреты совета рисуются очередью);
//                                                `LEVELS=market:8` — уровни построек и здесь (РТ-2: перевес сословия);
//                                                шаг `scroll:селектор` в `PANELCLICK` — прокрутка к элементу вместо касания;
//                                                `CLOCK=9.5` — часы страницы на столько часов вперёд (РН-1: ночной привоз рынка)
//   GAME=1 WX=clear,rain,storm npm run city:shots — погода адресом (`?weather=`, docs/city.md, 15): кадр игры на каждую,
//                                                `WXLOOK=market:70` — вблизи постройки (тип:расстояние; `-4,10,-30:60` —
//                                                точка плана; `…:60:150` — камера повёрнута на 150°), `WXMAP=1` —
//                                                карта мира, `WXSEASON=winter` — сезон партии, `WXREGION=italy` — регион,
//                                                `WXDAY=0.8` — доля суток партии (0.8 летом — глубокая ночь, docs/polish.md, П-3);
//                                                `MOOD=feast` — состояние города адресом (`?mood=`: feast, siege, hunger,
//                                                plague, gloom, cheer, mourn; docs/city_v3.md, ЖГ-1), `POP=150` — население партии;
//                                                `SKIT=brawl` — сценка жителей адресом (`?skit=`, ЖГ-2: у точки `WXLOOK` ближе 134 м);
//                                                `LEVELS=farm:7` — уровни построек партии перед кадром (ЗД-2: рост Фермы)
//   GAME=1 WX=clear CHAMBERS=desk npm run city:shots — покои правителя (docs/city_v3.md, Г-4): точка интереса
//                                                (hall, desk, window, hearth, bed, arms), `:доворот:наклон:безделушка:подсветка`;
//                                                `FIGHT=stance|at:…|hit:dx:dy`, `FIGHTSHOT=swing:dx:dy` — бой мечом (Г-11);
//                                                `BENCH=8` — цена кадра покоев как вошли и после `LIFE` (секунды замера)
//   GAME=1 MARCH=send npm run city:shots     — режим марша (ДР-2, docs/siege_v2.md, 25): карточка ближнего логова с выбором
//                                                режима — обычный, налегке, с обозом (кадр на каждый); `MARCH=squad` — окно
//                                                отряда полководца дома и в пути налегке (смена: стоянка и цена, второе касание)
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

/**
 * Цена кадра покоев (`BENCH=8` к `CHAMBERS=…`, docs/characters.md, «Слияние ЛЦ-3»): столько секунд кадров, которые сцена
 * рисует сама под потолком стенда, — стенд кадр не зовёт, он только оборачивает `frame` сцены. Числа — медиана и p95:
 * процессор на весь кадр (шаг жизни покоев, кожа фигур, отрисовка), таймер видеокарты на отрисовку
 * (`EXT_disjoint_timer_query_webgl2`) и кадр до конца видеокарты (чтение пикселя после отрисовки), как у `village:shots`.
 * Меряется дважды за заход — покои без людей и после `LIFE`; абсолютные миллисекунды гуляют от захода к заходу,
 * сравнивать можно строки одного вывода.
 */
async function benchChambers(tab: Tab, label: string): Promise<void> {
  const ms = Number(process.env.BENCH) * 1000;
  const r = await tab.eval<string>(`(async () => {
    const sc = window.__scene;
    const gl = sc.renderer.getContext();
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const cpu = [], gpu = [], sync = [], pending = [];
    const px = new Uint8Array(4);
    let q = null, a0 = 0, cpuNow = 0, calls = 0, tris = 0;
    const frame = sc.frame;
    sc.frame = function () { a0 = performance.now(); cpuNow = 0; frame.call(sc); cpu.push(cpuNow || performance.now() - a0); };
    sc.beforeRender = () => { if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); } };
    sc.afterRender = () => {
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); q = null; }
      cpuNow = performance.now() - a0;
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      sync.push(performance.now() - a0);
      const st = sc.stats();
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
    delete sc.frame;
    sc.beforeRender = null;
    sc.afterRender = null;
    const at = (a, k) => { const v = a.slice().sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * k))].toFixed(2) : '—'; };
    return JSON.stringify('кадров ' + cpu.length + ', процессор ' + at(cpu, 0.5) + ' / ' + at(cpu, 0.95) + ' мс, видеокарта ' +
      (ext ? at(gpu, 0.5) + ' / ' + at(gpu, 0.95) : 'нет таймера') + ' мс, до конца видеокарты ' + at(sync, 0.5) + ' / ' + at(sync, 0.95) +
      ' мс (медиана / p95); вызовов ' + calls + ', треугольников ' + tris + ', буфер ' + gl.drawingBufferWidth + '×' + gl.drawingBufferHeight);
  })()`);
  console.log(`  цена кадра, ${label}: ${r}`);
}

/** Игра по адресу `?look=city`: новая партия, вход, стартовый кадр города и счётчики сцены. */
async function gameShot(q: Quality): Promise<void> {
  // Состояние города адресом (`MOOD=feast`, docs/city_v3.md, ЖГ-1): праздник, осада, голод, мор, хмуро, весело.
  // Сценка адресом (`SKIT=brawl`, docs/city_v3.md, ЖГ-2): ставится только она — у точки взгляда, при приближении ближе ~134 м.
  const mood = (process.env.MOOD ? `&mood=${process.env.MOOD}` : '') + (process.env.SKIT ? `&skit=${process.env.SKIT}` : '');
  const tab = await Tab.open(DEBUG_PORT, reportPage(PORT, `&look=${process.env.LOOK ?? 'city'}&quality=${q}${mood}`));
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
    // Касание — до перезагрузки: иначе страница не считает себя сенсорной, и касание CDP не становится
    // указателем `touch` (как у `tap:report`).
    if (process.env.TAP === '1') await tab.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} return JSON.stringify("ok"); })()');
    // Часы страницы со сдвигом (`CLOCK=9.5` — на столько часов вперёд, РН-1): привоз рынка идёт по настоящим часам, и ночной
    // привоз днём иначе не снять. Сдвиг — до загрузки страницы, одним числом на `Date.now` и `new Date()`.
    const shift = Number(process.env.CLOCK ?? 0) * 3600_000;
    if (shift) {
      await tab.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => { const D = Date; const off = ${shift}; const now = D.now.bind(D); class S extends D { constructor(...a) { super(...(a.length ? a : [now() + off])); } static now() { return now() + off; } } window.Date = S; })();`,
      });
    }
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
    if (process.env.PANEL) {
      await panelShots(tab);
      return;
    }
    if (process.env.MARCH) {
      await marchShots(tab, process.env.MARCH);
      return;
    }
    if (process.env.PORTRAITS) {
      await portraitSheet(tab);
      return;
    }
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
 * Окна построек (`PANEL=barracks,stable` к `GAME=1`, docs/ui_v2.md, Р-3): на каждое — кадр открытого окна и кадр, где окно
 * прокручено к разделу «Найм». Запасы и снаряжение подняты, чтобы «Нанять» было открыто, — это стенд, не партия.
 */
async function panelShots(tab: Tab): Promise<void> {
  await tab.eval<string>(`(() => {
    const s = window.__game.getState().s;
    s.inbox = [];
    s.winterWarning = false;
    s.nextEventAt = s.time + 1e9;
    for (const k of Object.keys(s.resources)) s.resources[k] += 500;
    for (const k of Object.keys(s.equipment)) s.equipment[k] += 20;
    Object.assign(s, ${JSON.stringify(JSON.parse(process.env.PANELSTATE ?? '{}'))});
    const lv = ${JSON.stringify(Object.fromEntries(list(process.env.LEVELS ?? '', '').map((p) => p.split(':')).map(([t, n]) => [t, Number(n)])))};
    for (const b of s.buildings) if (lv[b.type]) b.level = lv[b.type];
    const hall = s.buildings.find((x) => x.type === 'town_hall');
    if (hall && ${Number(process.env.HALL ?? 0)} > 0) hall.level = ${Number(process.env.HALL ?? 0)};
    s.tutorialDone = true;
    window.__game.setState({ s: { ...s } });
    return JSON.stringify('ok');
  })()`);
  for (const type of list(process.env.PANEL, '')) {
    const tabName = type.startsWith('tab:') ? type.slice(4) : null;
    const id = tabName ? -1 : await tab.eval<number | null>(`JSON.stringify((() => { const b = window.__game.getState().s.buildings.find((x) => x.type === '${type}'); return b ? b.id : null; })())`);
    if (id === null) {
      console.log(`  окно ${type}: постройки нет`);
      continue;
    }
    if (tabName) await tab.eval<string>(`(() => { window.__game.getState().openTab('${tabName}'); return JSON.stringify('ok'); })()`);
    else await tab.eval<string>(`(() => { window.__game.getState().openBuilding(${id}); return JSON.stringify('ok'); })()`);
    await sleep(2500);
    const snap = async (name: string): Promise<void> => {
      const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
      await writeFile(join(OUT, name), Buffer.from(png.data, 'base64'));
      console.log(`  окно ${type} → .city-shots/${name}`);
    };
    await snap(`${TAG}-${type.replace(':', '-')}-open.png`);
    // Влезает ли окно без прокрутки: тело шторки не длиннее своего окна (ЗД-1: окно двора на 390×844).
    const fit = await tab.eval<{ scroll: number; client: number }>(`JSON.stringify((() => { const b = document.querySelector('.sheet.open .sheet-body'); return { scroll: b ? b.scrollHeight : 0, client: b ? b.clientHeight : 0 }; })())`);
    console.log(`  окно ${type}: тело ${fit.scroll} px из ${fit.client} — ${fit.scroll <= fit.client + 1 ? 'без прокрутки' : 'с прокруткой'}`);
    // Касания по очереди (`PANELCLICK`): кадр после каждого — лист просителей, «Точно?» и т. п.
    let k = 0;
    for (const sel of (process.env.PANELCLICK ?? '').split('|').filter(Boolean)) {
      // `scroll:селектор` — не касание, а прокрутка к нему (РТ-2: строки ниже первого экрана).
      const scroll = sel.startsWith('scroll:');
      const q = JSON.stringify(scroll ? sel.slice(7) : sel);
      const hit = await tab.eval<boolean>(
        `JSON.stringify((() => { const e = document.querySelector(${q}); if (e) ${scroll ? "e.scrollIntoView({ block: 'center' })" : 'e.click()'}; return !!e; })())`,
      );
      await sleep(Number(process.env.PANELWAIT ?? 1800));
      k += 1;
      if (hit) await snap(`${TAG}-${type.replace(':', '-')}-c${k}.png`);
      else console.log(`  окно ${type}: нет «${sel}»`);
    }
    const found = await tab.eval<boolean>(`JSON.stringify((() => { const h = [...document.querySelectorAll('h3')].find((e) => e.textContent.trim() === 'Найм'); if (h) h.scrollIntoView({ block: 'start' }); return !!h; })())`);
    await sleep(800);
    if (found) await snap(`${TAG}-${type}-hire.png`);
    await tab.eval<string>(`(() => { window.__game.getState().closeSheet(); return JSON.stringify('ok'); })()`);
    await sleep(600);
  }
}

/**
 * Режим марша (ДР-2, `MARCH=send|squad` к `GAME=1`): войско и отряд полководцу, карта, ближнее живое логово у дома.
 * `send` — карточка логова: выбор режима таблицей (кадр на обычный, налегке, с обозом) и кнопки похода под ней; `squad` —
 * окно отряда в «Походах»: дома (смена даром) и в пути налегке к логову (смена — стоянка и энергия, кадр после первого
 * касания). Это стенд, не партия: войско дано рукой.
 */
async function marchShots(tab: Tab, what: string): Promise<void> {
  await tab.eval<string>(`(() => {
    const s = window.__game.getState().s;
    s.inbox = [];
    s.winterWarning = false;
    s.nextEventAt = s.time + 1e9;
    s.army.spearman = (s.army.spearman ?? 0) + 80;
    s.army.archer = (s.army.archer ?? 0) + 30;
    s.army.legionary = (s.army.legionary ?? 0) + 16;
    s.tutorialDone = true;
    window.__game.setState({ s: { ...s } });
    return JSON.stringify('ok');
  })()`);
  await tab.eval<string>(`(() => { window.__game.getState().openMap(); return JSON.stringify('ok'); })()`);
  await sleep(12000);
  const lair = await tab.eval<{ x: number; y: number; id: string } | string>(`(async () => {
    const w = window.__world.getState();
    await w.pulse();
    const err = await w.setGarrison({ spearman: 60, archer: 20, legionary: 16 });
    if (err) return JSON.stringify(err);
    const home = w.info && w.info.home;
    if (!home) return JSON.stringify('нет дома');
    let best = null;
    for (let r = 3; r <= 30 && !best; r++) {
      for (let dx = -r; dx <= r && !best; dx++) for (const dy of [-r, r]) {
        const v = window.__settlementAt(home.x + dx, home.y + dy) || window.__settlementAt(home.x + dy, home.y + dx);
        if (v && !v.mine && !v.castle) best = { x: v.x, y: v.y, id: v.id };
      }
    }
    return JSON.stringify(best ?? 'логова рядом нет');
  })()`);
  if (typeof lair === 'string') {
    console.log(`  марш: ${lair}`);
    return;
  }
  const snap = async (name: string): Promise<void> => {
    const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    await writeFile(join(OUT, name), Buffer.from(png.data, 'base64'));
    console.log(`  марш → .city-shots/${name}`);
  };
  const run = (js: string): Promise<string> => tab.eval<string>(`(async () => { ${js}; return JSON.stringify('ok'); })()`);
  /** Карточку — к таблице режима: шапка и кнопки похода под ней в одном кадре. */
  const toPick = (): Promise<string> => run(`document.querySelector('.gait-pick')?.scrollIntoView({ block: 'center' })`);
  if (what === 'send') {
    await run(`await window.__world.getState().select({ x: ${lair.x}, y: ${lair.y} })`);
    await sleep(3000);
    await toPick();
    await sleep(800);
    await snap(`${TAG}-send-normal.png`);
    for (const [i, g] of [[0, 'light'], [2, 'train']] as const) {
      await run(`document.querySelectorAll('.gait-pick .kit-cells.pick')[${i}]?.click()`);
      await sleep(2500);
      await toPick();
      await sleep(800);
      await snap(`${TAG}-send-${g}.png`);
    }
    return;
  }
  // Окно отряда — дома: смена даром.
  const card = async (name: string, armed = false): Promise<void> => {
    await run(`window.__game.getState().openMarches()`);
    await sleep(2000);
    await run(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Полководец'))?.click()`);
    await sleep(2000);
    await run(`[...document.querySelectorAll('h3')].find((h) => h.textContent.trim() === 'Режим марша')?.scrollIntoView({ block: 'start' })`);
    await sleep(800);
    if (armed) {
      await run(`document.querySelectorAll('.gait-opt:not(.on)')[0]?.click()`);
      await sleep(800);
    }
    await snap(name);
  };
  await card(`${TAG}-squad-home.png`);
  // В пути налегке: режим дома даром, «Дойти и ударить» по логову — и окно отряда с ценой смены.
  await run(`const w = window.__world.getState(); await w.setGait('light'); await w.errand({ agent: 'general', target: { kind: 'place', id: '${lair.id}' }, deed: 'storm', fate: 'plunder' })`);
  await sleep(2500);
  await card(`${TAG}-squad-light.png`);
  await card(`${TAG}-squad-armed.png`, true);
}

/**
 * Лист портретов совета Ратуши (`PORTRAITS=24` к `GAME=1`, РТ-1): столько обликов подряд — зерно, возраст от 30 до 60 и
 * должность по кругу, — тем же рисовальщиком, что окно совета (`render/chambers/advisor/portrait`), в `.city-shots/`.
 * Видно разброс лиц, седины и бород.
 */
async function portraitSheet(tab: Tab): Promise<void> {
  const n = Math.max(1, Math.min(48, Number(process.env.PORTRAITS) || 12));
  const urls = await tab.eval<string[]>(`(async () => {
    const m = await import('/src/render/chambers/advisor/portrait.ts');
    const posts = ['steward', 'treasurer', 'marshal'];
    const out = [];
    for (let i = 0; i < ${n}; i++) out.push(m.paintPortrait(1000 + i * 7919, 30 + (i * 37) % 31, posts[i % 3]));
    return JSON.stringify(out);
  })()`);
  const cell = { w: 112, h: 140 };
  const cols = 8;
  const rows = Math.ceil(urls.length / cols);
  const parts = await Promise.all(
    urls.map(async (u, i) => ({
      input: await sharp(Buffer.from(u.split(',')[1], 'base64')).resize(cell.w, cell.h).png().toBuffer(),
      left: (i % cols) * cell.w,
      top: Math.floor(i / cols) * cell.h,
    })),
  );
  const png = await sharp({ create: { width: cols * cell.w, height: rows * cell.h, channels: 4, background: '#2a1e14' } }).composite(parts).png().toBuffer();
  await writeFile(join(OUT, `${TAG}-portraits.png`), png);
  console.log(`  портреты: ${urls.length} → .city-shots/${TAG}-portraits.png`);
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
  // Население партии (`POP=150`, docs/city_v3.md, ЖГ-1): город середины игры — людей на улицах до потолка уровня.
  const pop = process.env.POP;
  if (pop) {
    await tab.eval<string>(`(() => {
      const s = window.__game.getState().s;
      s.pop = ${Number(pop)};
      window.__game.setState({ s: { ...s } });
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
  // `LEVELS=farm:7,mine:4` — уровни построек партии перед кадром (ЗД-2: рост Фермы с уровнем виден).
  if (process.env.LEVELS) {
    const levels = Object.fromEntries(list(process.env.LEVELS, '').map((p) => p.split(':')).map(([t, n]) => [t, Number(n)]));
    await tab.eval<string>(`(() => {
      const g = window.__game.getState();
      const lv = ${JSON.stringify(levels)};
      for (const b of g.s.buildings) if (lv[b.type]) b.level = lv[b.type];
      window.__game.setState({ s: { ...g.s } });
      return JSON.stringify('ok');
    })()`);
    await sleep(800);
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
    // «Вдаль» у окна (Г-12): `ZOOM=4` — столько касаний кнопки «Вдаль» (`room.zoomBy(1.6)`), как пальцем.
    for (let k = 0; k < Number(process.env.ZOOM ?? 0); k++) await tab.eval(`window.__chambers.zoomBy(1.6)`);
    // Ходьба (Г-12): `WALK=1` — палец движения лёг в левой половине и ушёл вверх на полный ход; снимок — с пальцем на экране
    // (кружок в углу один, его ручка у обода).
    if (process.env.WALK) {
      await tab.eval(`(() => { const r = window.__chambers; r.down(1, 150, 600, { left: 0, top: 0, width: innerWidth, height: innerHeight }); r.move(1, 150, 520); })()`);
      await sleep(700);
    }
    // Цена кадра покоев (`BENCH=8`): прогрев, покои как вошли — и ещё раз после `LIFE`.
    if (process.env.BENCH) {
      await sleep(3000);
      await benchChambers(tab, 'как вошли');
    }
    // Жизнь покоев (Г-7): `LIFE='{"who":"servant","at":{"x":3.75,"z":-4.6,"yaw":3.1},"talk":true}'` — поставить людей и кота
    // сразу (`ChambersLife.stage`); списком — несколько (`LIFE='[{"who":"maid"},{"cat":"floor"}]'`).
    if (process.env.LIFE) {
      // Супруга и гонец — своими ленивыми кусками (ЛЦ-2, ЛЦ-3): ставим, когда они приехали, иначе в кадре — запасная сетка.
      const r = await tab.eval<string>(`(async () => { const l = window.__chambers.life; await l.consortReady; await l.heraldReady; await l.advisorReady; await l.maidReady; await l.catReady; for (const s of [].concat(${process.env.LIFE})) l.stage(s); return JSON.stringify('жизнь: ' + JSON.stringify(l.view())); })()`);
      console.log(`  ${r}`);
      if (process.env.BENCH) {
        await sleep(1500);
        await benchChambers(tab, 'после LIFE');
      }
    }
    // Гонец и советник (ПК-1): `COURT='{"knock":[<весть>]}'` — стук и «Впустить»/«Позже»; `COURT='{"herald":[<рассказ>]}'` —
    // гонец перед правителем с этими словами; `COURT='{"report":[<рассказ>]}'` — советник у стола с докладом (`Court.stage`),
    // без сцен. Весть — `{"id":"a","kind":"siege","clock":"world","at":0,"ref":"0"}`, рассказ — `{"t":<весть>,"text":"…",
    // "door":{"to":"siege"},"outcome":false}`.
    if (process.env.COURT) {
      await tab.eval<string>(`(async () => { await window.__chambers.life.heraldReady; await window.__chambers.life.advisorReady; return '""'; })()`);
      const r = await tab.eval<string>(`JSON.stringify((() => { window.__court.stage(${process.env.COURT}); return 'двор: ' + JSON.stringify(window.__chambers.life.view()); })())`);
      console.log('  ' + r);
      await sleep(900);
    }
    // Глаз к гостю (Р-1): `GUEST=1` — глаз сразу на госте, поставленном `LIFE='{…,"guest":true}'`, как его держит вход.
    if (process.env.GUEST) {
      const r = await tab.eval<string>(`JSON.stringify((() => { const room = window.__chambers; room.attendNow(); return 'гость: ' + JSON.stringify(room.life.attention()?.who ?? null); })())`);
      console.log('  ' + r);
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
    // Бой мечом (Г-11, к `CHAMBERS=arms`): `FIGHT='stance|at:3.5:0.35:1.571:-0.06|hit:-250:10|hit:250:0'` — в стойку, встать
    // в точку пола с мечом, удары взмахом (сдвиг пальца, px) — по одному, с паузой на удар; `coach` — до стойки забыть, что
    // подсказки первой стойки уже видели. Снимок посреди удара или блока — `FIGHTSHOT=swing:-250:10` или `block:left`;
    // `straw:-250:10` — удар и снимок, когда из чучела полетела солома (или из камня — искры).
    if (process.env.FIGHT) {
      for (const cmd of process.env.FIGHT.split('|').filter(Boolean)) {
        const [op, a1, a2, a3, a4] = cmd.split(':');
        const r = await tab.eval<string>(`JSON.stringify((() => {
          const room = window.__chambers;
          room.setRect({ left: 0, top: 0, width: innerWidth, height: innerHeight });
          const op = ${JSON.stringify(op)};
          if (op === 'coach') { try { localStorage.removeItem('tribe.chambers.sword'); } catch {} return 'подсказки — снова'; }
          if (op === 'stance') { try { if (!${JSON.stringify(process.env.FIGHT.includes('coach'))}) localStorage.setItem('tribe.chambers.sword', '1'); } catch {} room.stance(); return 'стойка: ' + !!room.fightNow(); }
          if (op === 'at') { room.standAtPoint(${Number(a1) || 0}, ${Number(a2) || 0}, ${Number(a3) || 0}, ${Number(a4) || 0}); return 'встал'; }
          if (op === 'hit') { const cx = innerWidth / 2, cy = innerHeight * 0.56, dx = ${Number(a1) || 0}, dy = ${Number(a2) || 0}; room.swipe(cx - dx / 2, cy - dy / 2, cx + dx / 2, cy + dy / 2, 64); return 'взмах'; }
          return 'не знаю ' + op;
        })())`);
        // Программный кадр облака — около секунды, а шаг сцены — не больше 0,1 с: удар ждём до стойки, а не по часам.
        const until = (cond: string): Promise<string> =>
          tab.eval<string>(`new Promise((ok) => { let n = 0; const t = setInterval(() => { const f = window.__chambers.fightNow(); if (!f || (${cond}) || ++n > 300) { clearInterval(t); ok(JSON.stringify('ok')); } }, 100); })`);
        if (op === 'stance') await until('f.stance >= 1');
        else if (op === 'hit') await until("f.state.kind === 'guard' && f.swings > 0 && f.time > (window.__g11 = window.__g11 ?? f.time) + 0.7");
        else await sleep(900);
        if (op === 'hit') await tab.eval<string>(`(() => { window.__g11 = undefined; return JSON.stringify('ok'); })()`);
        const f = await tab.eval<string>(`JSON.stringify((() => { const f = window.__chambers.fightNow(); return f ? 'попаданий ' + f.hits + ', выносливость ' + f.stamina.toFixed(2) : 'боя нет'; })())`);
        console.log(`  бой: ${cmd} → ${r}; ${f}`);
      }
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
    // Сценки жителей (`SKIT=`, ЖГ-2): что стоит, где и сколько фигур в кадре.
    if (process.env.SKIT) {
      const sk = await tab.eval<string>(`JSON.stringify((() => {
        const v = window.__scene.skits;
        if (!v) return 'сценки не приехали';
        const d = v.director;
        return d.active.filter(Boolean).map((a) => a.def.id + ' на «' + a.stage.kind + '» ' + a.stage.x.toFixed(1) + ',' + a.stage.z.toFixed(1)).join('; ') + ' | фигур ' + v.drawn();
      })())`);
      console.log(`  сценки: ${sk}`);
    }
    // Снимок посреди удара или блока (Г-11): сцена встаёт на кадре, где клинок на середине дуги (или блок стоит).
    const fs = process.env.FIGHTSHOT;
    if (fs) {
      const [op, a1, a2] = fs.split(':');
      const r = await tab.eval<string>(`new Promise((ok) => {
        const room = window.__chambers;
        room.setRect({ left: 0, top: 0, width: innerWidth, height: innerHeight });
        const f = room.fightNow();
        if (!f) return ok(JSON.stringify('боя нет'));
        if (${JSON.stringify(op)} === 'block') f.block(${JSON.stringify(a1 ?? 'left')});
        else { const cx = innerWidth / 2, cy = innerHeight * 0.56, dx = ${Number(a1) || 0}, dy = ${Number(a2) || 0}; room.swipe(cx - dx / 2, cy - dy / 2, cx + dx / 2, cy + dy / 2, 64); }
        let n = 0;
        let seen = -1;
        const t = setInterval(() => {
          const st = f.state;
          const fly = room.drillNow().flying;
          // Солома и искры — двумя кадрами после того, как полетели: успели разлететься от места встречи.
          if (fly.bits + fly.sparks > 12 && seen < 0) seen = window.__scene.frameNo;
          const hit = ${JSON.stringify(op)} === 'straw' ? seen >= 0 && window.__scene.frameNo >= seen + 2 : (st.kind === 'strike' && st.u >= 0.5) || (st.kind === 'block' && st.t >= 0.12);
          if (hit || ++n > 6000) { clearInterval(t); window.__scene.pause(); ok(JSON.stringify(hit ? 'стоп: ' + st.kind : 'не поймал: ' + st.kind + ' ' + (st.u ?? st.t) + ', кадр ' + window.__scene.frameNo)); }
        }, 4);
      })`);
      console.log(`  бой, снимок: ${fs} → ${r}`);
      await sleep(400);
    }
    const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
    if (fs) await tab.eval<string>(`(() => { window.__scene.resume(); return JSON.stringify('ok'); })()`);
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
