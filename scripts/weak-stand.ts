// Стенд слабого телефона (docs/perf.md): собранная игра в браузере без экрана с замедленным процессором — первая
// загрузка, плавность, память и счёт кадра на сценах игры. Это **стенд, а не отчёт**: ничем не падает, ничего не
// утверждает и в приёмку не входит; числа — одного прогона одной машины, «до» и «после» снимаются тем же заходом.
//
//   npm run weak:stand                       — город на «Низком», процессор ×4
//   SCENE=map RATE=6 npm run weak:stand      — карта Сицилии: дом и одиннадцать соседей из реестра (`world/spawn`)
//   SCENE=battle npm run weak:stand          — ролик боя: полевой бой 600 на 560, от разбега до сечи
//   SCENE=hunt npm run weak:stand            — «Охота»: вход из города теми же кнопками, что у игрока
//   QUALITY=auto|low|medium|high             — уровень адресом (`?quality=`); `auto` — выбор игры по устройству
//   DEVICE=weak                              — устройство говорит «память 2 ГБ, 4 ядра» (`navigator.deviceMemory`,
//                                              `hardwareConcurrency`): так автовыбор видит дешёвый Android
//   SECONDS=10                               — сколько мерить плавность
//   PROFILE=1 BUILT=1                        — профиль на собранной игре (имена сжаты, файлы кусков видны)
//   DIST=путь                                — другая сборка вместо `dist` (коммит «до» из второго worktree)
//   ASK="JSON.stringify(…)"                  — выражение в странице на вставшем городе (разбор: что в сцене)
//
// ЧТО МЕРЯЕТСЯ И ЧЕМ:
//   загрузка  — отметки экрана загрузки (`tribe-*`, index.html) от начала перехода; `tribe-ready` — экран снят,
//               первый кадр игры; «город встал» — `scene.ready` (мир собран целиком);
//   плавность — промежутки между кадрами браузера (пассивный наблюдатель `requestAnimationFrame` — он кадр сцены не
//               рисует и не вызывает, только смотрит на время; так же меряет `prologue:stand`): кадров в секунду,
//               доля дольше 34 мс (ниже тридцати) и дольше 50 мс (долгий кадр), 95-й процентиль;
//   процессор — занятость главного потока за окно (`Performance.getMetrics`, `TaskDuration`): доля времени, которую
//               страница считала, — то, что на слабом телефоне и есть рывок;
//   память    — куча JS (`JSHeapUsedSize`) после сборки мусора;
//   счёт      — вызовы отрисовки и треугольники последнего кадра (у карты — время кадра полотна, `__mapPerf`).
//
// ЧЕСТНОСТЬ ЧИСЕЛ. Замедление процессора (`Emulation.setCPUThrottlingRate`) замедляет поток страницы и её работников,
// но не видеокарту. В облачном контейнере видеокарты нет вовсе: кадр растрирует программная отрисовка (SwiftShader) в
// процессе видеокарты, и промежутки кадров там — цена программной отрисовки, а не телефона. Поэтому главное число для
// слабого телефона здесь — занятость главного потока и счёт кадра; цену пикселя покажет только телефон.
//
// Бюджет железа (CLAUDE.md, раздел ⛔): один заход — одна сцена на одном замедлении, не дольше `BROWSER_MAX_MS`,
// рядом с чужой тяжёлой работой не запускается, перед заходом видеокарта остывает минуту от прошлого захода стенда.
// Потолок кадров — игры (60): стенд меряет её плавность, флагов без потолка у него нет.
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite, preview } from 'vite';
import { ENTER_GAME, launchChrome, sleep, Tab } from './lib/chrome';
import { openPinnedMap, sicilyRoster, SICILY_HOME } from './lib/pinned';
import { SICILY } from '../src/world/spawn';
import { BROWSER_MAX_MS, gpuCoolDown, gpuStamp, refuseIfBusy } from './lib/budget';

const PORT = Number(process.env.PORT ?? 4199);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9345);
const SCENE = process.env.SCENE ?? 'city';
const RATE = Math.max(1, Math.min(20, Number(process.env.RATE ?? 4)));
const QUALITY = process.env.QUALITY ?? 'low';
const SECONDS = Math.max(3, Math.min(30, Number(process.env.SECONDS ?? 10)));
const WEAK = process.env.DEVICE === 'weak';
/** `PROFILE=1` — профилировщик страницы на окне плавности: собственное время функций, первые пятнадцать. */
const PROFILE = process.env.PROFILE === '1';
/**
 * Экран телефона: портрет 390×844, плотность 2 — как у снимков города и ролика. `SMALL=1` — тот же портрет вчетверо
 * меньше по стороне при плотности 1: программной отрисовке достаётся в шестьдесят раз меньше пикселей, кадров в окно
 * встаёт больше, и цена кадра на процессоре меряется на сотнях кадров, а не на десятке. Камера та же (аспект тот же),
 * значит и сцена в кадре та же; буфер и цена пикселя — не телефона.
 */
const SMALL = process.env.SMALL === '1';
const SCREEN = SMALL ? { width: 98, height: 211, deviceScaleFactor: 1, mobile: true } : { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };

/**
 * Что подкладывается в страницу до её кода. Не код игры: строка, в бандл не попадает. Наблюдатель кадров только
 * пишет время своих вызовов; включает и выключает его node.
 */
const BEFORE = `
(() => {
  ${WEAK ? `try { Object.defineProperty(Navigator.prototype, 'deviceMemory', { get: () => 2 }); Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => 4 }); } catch (e) {}` : ''}
  let on = false;
  const gaps = [];
  let last = 0;
  const tick = (t) => {
    if (!on) return;
    if (last) gaps.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  // Цена кадра на процессоре: метод кадра сцены обёрнут часами (цепочка зовёт его по имени — \`() => this.frame()\`,
  // и обёртка встаёт в неё сама). Кадр рисует по-прежнему сама сцена, по одному на кадр экрана.
  // Метка \`frame\` — весь кадр; другие метки — его части (например, \`render\` — вызов three).
  const costs = {};
  const counts = {};
  window.__weakWrap = (obj, name, label = 'frame', count = false) => {
    const mark = '__weak_' + name;
    if (!obj || typeof obj[name] !== 'function' || obj[mark]) return JSON.stringify(false);
    const f = obj[name].bind(obj);
    obj[name] = (...a) => {
      const t = performance.now();
      const r = f(...a);
      if (on) {
        (costs[label] = costs[label] || []).push(performance.now() - t);
        // У рендерера, который зовут раз на кадр, — и счёт этого кадра: вызовы и треугольники вместе с теневым проходом, если он был.
        if (count && obj.info && obj.info.render) {
          (counts.calls = counts.calls || []).push(obj.info.render.calls);
          (counts.tris = counts.tris || []).push(obj.info.render.triangles);
        }
      }
      return r;
    };
    obj[mark] = true;
    return JSON.stringify(true);
  };
  window.__weakStart = () => { gaps.length = 0; for (const k in costs) delete costs[k]; for (const k in counts) delete counts[k]; last = 0; on = true; requestAnimationFrame(tick); return JSON.stringify('ok'); };
  window.__weakStop = () => { on = false; return JSON.stringify({ gaps, costs, counts }); };
})();
`;

const page = (query: string): string => `http://127.0.0.1:${PORT}/?probe=1${QUALITY === 'auto' ? '' : `&quality=${QUALITY}`}${query}`;

async function waitFor(tab: Tab, expr: string, ms: number): Promise<boolean> {
  for (let t = 0; t < ms; t += 250) {
    if (await tab.eval<boolean>(`JSON.stringify(!!(${expr}))`).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

const press = (text: string): string =>
  `(() => { const e = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled); if (!e) return JSON.stringify('нет кнопки ' + ${JSON.stringify(text)}); e.click(); return JSON.stringify('ok'); })()`;
const click = (selector: string): string =>
  `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return JSON.stringify('нет ' + ${JSON.stringify(selector)}); e.click(); return JSON.stringify('ok'); })()`;

type Metrics = Record<string, number>;
async function metrics(tab: Tab): Promise<Metrics> {
  const r = await tab.send<{ metrics: { name: string; value: number }[] }>('Performance.getMetrics');
  return Object.fromEntries(r.metrics.map((m) => [m.name, m.value]));
}

const mb = (b: number): string => (b / 1048576).toFixed(1);
const pct = (v: number): string => `${Math.round(v * 100)} %`;
const quant = (a: number[], q: number): number => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))] : 0);

/** Плавность и процессор за окно: наблюдатель кадров и занятость главного потока. */
async function smooth(tab: Tab, what: string, during?: (stop: () => boolean) => Promise<void>): Promise<void> {
  if (PROFILE) {
    await tab.send('Profiler.enable');
    await tab.send('Profiler.setSamplingInterval', { interval: 500 });
    await tab.send('Profiler.start');
  }
  await tab.eval<string>('window.__weakStart()');
  const m0 = await metrics(tab);
  const t0 = Date.now();
  const until = t0 + SECONDS * 1000;
  if (during) await during(() => Date.now() >= until);
  while (Date.now() < until) await sleep(200);
  const m1 = await metrics(tab);
  const { gaps, costs: parts, counts } = await tab.eval<{ gaps: number[]; costs: Record<string, number[]>; counts: Record<string, number[]> }>(
    'window.__weakStop()',
  );
  const costs = parts.frame ?? [];
  if (PROFILE) hot(await tab.send<{ profile: Profile }>('Profiler.stop'));
  const wall = (Date.now() - t0) / 1000;
  const busy = (m1.TaskDuration - m0.TaskDuration) / wall;
  const script = (m1.ScriptDuration - m0.ScriptDuration) / wall;
  const n = gaps.length;
  const share = (ms: number): number => (n ? gaps.filter((g) => g > ms).length / n : 0);
  console.log(
    `  ${what}: ${(n / wall).toFixed(1)} к/с · дольше 34 мс ${pct(share(34))} · дольше 50 мс ${pct(share(50))} · p95 ${quant(gaps, 0.95).toFixed(0)} мс` +
      ` · главный поток занят ${pct(busy)} (скрипт ${pct(script)})`,
  );
  if (costs.length) {
    const over = (ms: number): number => costs.filter((c) => c > ms).length / costs.length;
    console.log(
      `    кадр на процессоре: ${costs.length} кадров, медиана ${quant(costs, 0.5).toFixed(1)} мс, p95 ${quant(costs, 0.95).toFixed(1)} мс` +
        ` · дольше 16.7 мс ${pct(over(16.7))} · дольше 33 мс ${pct(over(33.3))}`,
    );
    for (const [k, v] of Object.entries(parts)) {
      if (k !== 'frame' && v.length) console.log(`      из него ${k}: медиана ${quant(v, 0.5).toFixed(1)} мс, p95 ${quant(v, 0.95).toFixed(1)} мс`);
    }
  }
  if (counts.tris?.length) {
    const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
    console.log(
      `    в среднем за кадр (с теневым проходом, когда он есть): вызовов ${mean(counts.calls).toFixed(1)}, треугольников ${Math.round(mean(counts.tris)).toLocaleString('ru')}` +
        ` (меньше ${Math.min(...counts.tris).toLocaleString('ru')}, больше ${Math.max(...counts.tris).toLocaleString('ru')})`,
    );
  }
}

interface Profile {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number }[];
  samples?: number[];
}

/** Где ушло время страницы: собственное время функций по выборкам профилировщика, первые пятнадцать. */
function hot({ profile }: { profile: Profile }): void {
  const self = new Map<string, number>();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const hits = new Map<number, number>();
  for (const id of profile.samples ?? []) hits.set(id, (hits.get(id) ?? 0) + 1);
  let total = 0;
  for (const [id, n] of hits) {
    const node = byId.get(id);
    if (!node) continue;
    const f = node.callFrame;
    const file = f.url.split('/').pop() ?? '';
    const key = `${f.functionName || '(анонимная)'} ${file}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + n);
    total += n;
  }
  const idle = [...self].filter(([k]) => /^\((idle|program|garbage collector)\)/.test(k)).reduce((a, [, v]) => a + v, 0);
  const busy = Math.max(1, total - idle);
  console.log(`    профиль: выборок ${total}, занятых ${busy}; доли — от занятых (простой и служебное не в счёт)`);
  for (const [k, v] of [...self].filter(([k]) => !/^\((idle|program)\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`      ${((v / busy) * 100).toFixed(1).padStart(5)} %  ${k}`);
  }
}

async function heap(tab: Tab): Promise<string> {
  await tab.send('HeapProfiler.collectGarbage').catch(() => undefined);
  await sleep(300);
  return mb((await metrics(tab)).JSHeapUsedSize);
}

/** Отметки экрана загрузки от начала перехода. */
async function marks(tab: Tab): Promise<string> {
  const list = await tab.eval<[string, number][]>(
    `JSON.stringify(performance.getEntriesByType('mark').filter((m) => m.name.startsWith('tribe-')).map((m) => [m.name.slice(6), Math.round(m.startTime)]))`,
  );
  return list.map(([n, t]) => `${n} ${(t / 1000).toFixed(2)}`).join(' · ');
}

async function freshGame(tab: Tab, query = ''): Promise<void> {
  // Чистое устройство: первая загрузка — первая и для партии (новая игра, стартовый экран).
  await tab.send('Page.navigate', { url: page(query) });
  await sleep(500);
  await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} return JSON.stringify("ok"); })()');
  await tab.send('Network.clearBrowserCache').catch(() => undefined);
  await tab.send('Page.navigate', { url: page(query) });
}

async function enterCity(tab: Tab): Promise<void> {
  if (!(await waitFor(tab, 'window.__game', 90_000))) throw new Error('игра не поднялась за 90 с');
  console.log(`  вход: ${await tab.eval<string>(ENTER_GAME)}`);
  await tab.eval<string>(`(() => {
    const g = window.__game.getState();
    const s = g.s;
    s.tutorialDone = true;
    s.inbox = [];
    s.winterWarning = false;
    s.nextEventAt = s.time + 1e9;
    window.__game.setState({ s: { ...s } });
    return JSON.stringify('ok');
  })()`);
}

async function city(tab: Tab): Promise<void> {
  const t0 = Date.now();
  await freshGame(tab);
  if (!(await waitFor(tab, `performance.getEntriesByName('tribe-ready').length`, 90_000))) console.log('  экран загрузки не снялся за 90 с');
  console.log(`  загрузка, с от перехода: ${await marks(tab)}`);
  await enterCity(tab);
  const built = await tab.eval<string>(`new Promise((ok) => {
    const s = window.__scene;
    if (!s || !s.ready) return ok(JSON.stringify('нет сцены'));
    const t = setTimeout(() => ok(JSON.stringify('не встал')), 60000);
    s.ready.then(() => { clearTimeout(t); ok(JSON.stringify('встал')); });
  })`);
  console.log(`  город ${built} через ${((Date.now() - t0) / 1000).toFixed(1)} с от перехода`);
  const lvl = await tab.eval<{ q: string; dpr: string; buf: string }>(
    `JSON.stringify({ q: window.__scene.quality, dpr: window.__scene.dprLevel, buf: window.__scene.renderer.domElement.width + '×' + window.__scene.renderer.domElement.height })`,
  );
  console.log(`  уровень ${lvl.q} (плотность уровня ${lvl.dpr}), буфер ${lvl.buf}`);
  await sleep(2000);
  if (process.env.ASK) console.log(`  вопрос: ${JSON.stringify(await tab.eval<unknown>(process.env.ASK))}`);
  await tab.eval<boolean>(`window.__weakWrap(window.__scene, 'frame')`);
  await tab.eval<boolean>(`window.__weakWrap(window.__scene.renderer, 'render', 'render', true)`);
  await tab.eval<boolean>(`window.__weakWrap(window.__scene, 'animate', 'animate')`);
  await smooth(tab, `город ×${RATE}`);
  const st = await tab.eval<{ calls: number; triangles: number; textures: number; programs: number }>('JSON.stringify(window.__scene.stats())');
  const mem = await tab.eval<{ bytes: number }>('JSON.stringify(window.__scene.memory())');
  const tex = await tab.eval<number>('JSON.stringify(window.__scene.textureBytes())');
  console.log(
    `  счёт: вызовов ${st.calls}, треугольников ${st.triangles.toLocaleString('ru')}, программ ${st.programs}; геометрия ${mb(mem.bytes)} МБ, текстуры ${mb(tex)} МБ; куча ${await heap(tab)} МБ`,
  );
}

async function map(tab: Tab): Promise<void> {
  await tab.send('Page.navigate', { url: page('&worldview=open') });
  await sleep(1500);
  const home = SICILY[SICILY_HOME];
  const t0 = Date.now();
  await openPinnedMap(tab, { home, store: { 'tribe.castles.v1': sicilyRoster() }, onLog: (m) => console.log(m) });
  console.log(`  карта открыта через ${((Date.now() - t0) / 1000).toFixed(1)} с (с перезагрузкой и входом)`);
  // Регион печётся заранее (docs/map_tw.md, 13.4): ждём, пока испечётся, не дольше 40 с.
  const t1 = Date.now();
  for (; Date.now() - t1 < 40_000; ) {
    const st = await tab
      .eval<{ plan: { chunks: number; mids: number } | null; have: Record<string, number>; inFlight: number } | null>(
        'JSON.stringify(window.__twPrebake ? window.__twPrebake() : null)',
      )
      .catch(() => null);
    if (st?.plan && st.have.chunk >= st.plan.chunks && (st.have.mid >= st.plan.mids || st.have.mid === 0) && st.inFlight === 0) break;
    await sleep(500);
  }
  console.log(`  регион испечён через ${((Date.now() - t1) / 1000).toFixed(1)} с`);
  const buf = await tab.eval<string>(`JSON.stringify((() => { const c = document.querySelector('.worldmap canvas'); return c ? c.width + '×' + c.height : '—'; })())`);
  console.log(`  буфер полотна ${buf}`);
  const look = { x: home.x - 3, y: home.y + 3 };
  await tab.eval<string>(`(() => { window.__mapCam(${look.x}, ${look.y}, 24); return JSON.stringify('ok'); })()`);
  await sleep(2000);
  await tab.eval<string>('JSON.stringify(window.__mapPerf())');
  await smooth(tab, `карта стоит ×${RATE}`);
  const still = await tab.eval<number[]>('JSON.stringify(window.__mapPerf())');
  // Карту водят: камера идёт по кругу над островом — как палец, но без разбора жеста (стенд меряет кадр, не палец).
  await smooth(tab, `карту ведут ×${RATE}`, async (stop) => {
    for (let i = 0; !stop(); i++) {
      const a = i / 20;
      await tab.eval<string>(`(() => { window.__mapCam(${look.x} + ${4} * Math.cos(${a}), ${look.y} + ${3} * Math.sin(${a}), 24); return JSON.stringify('ok'); })()`);
      await sleep(50);
    }
  });
  const moving = await tab.eval<number[]>('JSON.stringify(window.__mapPerf())');
  const f = (a: number[]): string => `${a.length} кадров, медиана ${quant(a, 0.5).toFixed(1)} мс, p95 ${quant(a, 0.95).toFixed(1)} мс`;
  console.log(`  кадр полотна: стоит — ${f(still)}; ведут — ${f(moving)}; куча ${await heap(tab)} МБ`);
}

/** Полевой бой стенда ролика (`tw:shots`, FIELD): тот же проигрыватель, что в игре. */
const FIELD = 'replay=tw&men=600&foe=560&seed=7&place=woods,road&hour=10';

async function battle(tab: Tab): Promise<void> {
  // Плотность — уровня, как у холста игры (ролик берёт холст города, `quality.qualityDpr`); у «Авто» — средний.
  const q = QUALITY === 'auto' ? 'medium' : QUALITY;
  const dpr = q === 'low' ? 1.25 : q === 'medium' ? 1.5 : 2;
  const t0 = Date.now();
  await tab.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?${FIELD}&quality=${q}&dpr=${dpr}` });
  if (!(await waitFor(tab, 'window.twStand && document.body.dataset.replay', 90_000))) throw new Error('ролик не встал за 90 с');
  console.log(`  ролик встал через ${((Date.now() - t0) / 1000).toFixed(1)} с от перехода`);
  // С разбега: самый тяжёлый кусок — сшибка и сеча, когда все фигуры в движении.
  await tab.eval<string>(`(() => { const s = window.twStand; s.player.seek(s.plan.clashAt - 3); s.player.start(); return JSON.stringify('ok'); })()`);
  await sleep(1000);
  // Подпись стенда (`tw/stand.publish`: строка и \`dataset\` на каждый кадр) — пятая часть кадра на процессоре, а в игре
  // её нет: на окно замера она снимается, счёт кадра стенд берёт у проигрывателя после окна.
  await tab.eval<string>(`(() => { window.twStand.player.opts.onFrame = undefined; return JSON.stringify('ok'); })()`);
  await tab.eval<boolean>(`window.__weakWrap(window.twStand.player, 'loop')`);
  await tab.eval<boolean>(`window.__weakWrap(window.twStand.player.renderer, 'render', 'render', true)`);
  await smooth(tab, `бой ×${RATE}`);
  const r = await tab.eval<{ calls: number; triangles: number; textureMB: number; dpr: number; quality: string; figures: { attacker: number; defender: number } }>(
    `JSON.stringify((() => { const s = window.twStand; const d = JSON.parse(document.body.dataset.replay); return { ...d, ...s.player.stats() }; })())`,
  );
  console.log(
    `  счёт: ${r.quality}, фигур ${r.figures.attacker}/${r.figures.defender}, вызовов ${r.calls}, треугольников ${r.triangles.toLocaleString('ru')}, текстуры ${r.textureMB} МБ, плотность ${r.dpr}; куча ${await heap(tab)} МБ`,
  );
}

async function hunt(tab: Tab): Promise<void> {
  await freshGame(tab);
  await enterCity(tab);
  await sleep(2000);
  console.log(`  ${await tab.eval<string>(click('button[aria-label="Энергия"]'))} — энергия`);
  await sleep(400);
  console.log(`  ${await tab.eval<string>(click('.nx-tip-go'))} — «Промыслы»`);
  await waitFor(tab, `document.querySelector('.nx-trade')`, 8000);
  const t0 = Date.now();
  console.log(`  ${await tab.eval<string>(press('На охоту'))} — «На охоту»`);
  if (!(await waitFor(tab, 'window.__mini', 60_000))) throw new Error('сцена охоты не поднялась за 60 с');
  console.log(`  сцена охоты встала через ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  await sleep(1500);
  console.log(`  ${await tab.eval<string>(press('Начать'))} — «Начать»`);
  await sleep(1500);
  await tab.eval<boolean>(`window.__weakWrap(window.__mini, 'loop')`);
  await tab.eval<boolean>(`window.__weakWrap(window.__mini.renderer, 'render', 'render')`);
  // Игрок оглядывается: взгляд идёт по кругу — олени, лес и небо в кадре по очереди.
  await smooth(tab, `охота ×${RATE}`, async (stop) => {
    for (let i = 0; !stop(); i++) {
      await tab.eval<string>(`(() => { const st = window.__mini; st.place(st.px, st.pz, ${i} * 0.05, -0.05); return JSON.stringify('ok'); })()`).catch(() => '');
      await sleep(100);
    }
  });
  const i = await tab.eval<{ calls: number; triangles: number; tier: string }>('JSON.stringify(window.__mini.info())');
  const buf = await tab.eval<string>(`JSON.stringify(window.__mini.renderer.domElement.width + '×' + window.__mini.renderer.domElement.height)`);
  console.log(`  счёт: ступень ${i.tier}, вызовов ${i.calls}, треугольников ${i.triangles.toLocaleString('ru')}, буфер ${buf}; куча ${await heap(tab)} МБ`);
}

const SCENES: Record<string, (tab: Tab) => Promise<void>> = { city, map, battle, hunt };

async function main(): Promise<void> {
  const run = SCENES[SCENE];
  if (!run) throw new Error(`сцены «${SCENE}» нет: ${Object.keys(SCENES).join(', ')}`);
  refuseIfBusy('Стенд слабого телефона');
  // Собранная игра (`dist`, как `npm run preview`) — её загрузку и меряем. Профилю нужны имена функций, а в сборке
  // они сжаты: под `PROFILE=1` страница идёт с сервера разработки — цена кадра там та же, загрузка — нет.
  const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
  const listen = { port: PORT, strictPort: true, host: '127.0.0.1' };
  let close: () => Promise<void>;
  if (PROFILE && process.env.BUILT !== '1') {
    const dev = await createVite({ configFile, server: listen, logLevel: 'warn' });
    await dev.listen();
    close = () => dev.close();
  } else {
    // `DIST=путь` — другая сборка (например, коммита «до» из второго worktree): тот же стенд меряет обе.
    const built = await preview({ configFile, preview: listen, logLevel: 'warn', ...(process.env.DIST ? { build: { outDir: process.env.DIST } } : {}) });
    close = async () => void built.httpServer.close();
  }
  try {
    console.log(`\n=== слабый телефон: ${SCENE}, процессор ×${RATE}, уровень ${QUALITY}${WEAK ? ', устройство «2 ГБ, 4 ядра»' : ''}${SMALL ? ', экран мал' : ''} ===\n`);
    await gpuCoolDown('стендом слабого телефона');
    // В облачном контейнере браузер идёт от root без видеокарты: песочница не поднимается, WebGL — программный.
    const root = process.getuid?.() === 0 ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
    const chrome = await launchChrome(DEBUG_PORT, ['--use-gl=angle', '--window-size=500,900', ...root]);
    const tab = await Tab.open(DEBUG_PORT, 'about:blank');
    const watchdog = setTimeout(() => {
      console.log(`\nСрок стенда (${BROWSER_MAX_MS / 1000} с) вышел — заход брошен.`);
      chrome.kill();
      gpuStamp();
      process.exit(3);
    }, BROWSER_MAX_MS);
    try {
      await tab.send('Performance.enable');
      await tab.send('Network.enable');
      await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
      await tab.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await tab.send('Page.addScriptToEvaluateOnNewDocument', { source: BEFORE });
      await tab.send('Emulation.setCPUThrottlingRate', { rate: RATE });
      const gpu = await tab.eval<string>(
        `JSON.stringify((() => { const gl = document.createElement('canvas').getContext('webgl'); const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '—'; })())`,
      );
      console.log(`  видеокарта: ${gpu}`);
      await run(tab);
    } catch (e) {
      console.log(`  ${(e as Error).message}`);
    } finally {
      clearTimeout(watchdog);
      tab.close();
      chrome.kill();
      gpuStamp();
    }
  } finally {
    await close();
    await sleep(300);
  }
}

void main();
