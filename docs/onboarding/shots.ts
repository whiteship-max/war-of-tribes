// Стенд прохода новичком (docs/onboarding.md, раздел 1) — не отчёт, в приёмку не входит, код игры не трогает.
//
//   GROUP=a npx vite-node docs/onboarding/shots.ts   — старт, имя города, обучение до заказа копий (минуты 0–3)
//   GROUP=b npx vite-node docs/onboarding/shots.ts   — ратуша, казармы, шаг «Найми копейщика» ждёт копья
//   GROUP=c npx vite-node docs/onboarding/shots.ts   — минута ≈15: копьё всё ещё куётся; что новичку делать в городе
//   GROUP=d npx vite-node docs/onboarding/shots.ts   — минута ≈30: копьё готово — найм, карта, разведка, конец обучения
//   GROUP=e npx vite-node docs/onboarding/shots.ts   — после обучения: первая подсказка, тревоги, задания, вести
//   GROUP=start npx vite-node docs/onboarding/shots.ts — без браузера: что лежит перед новичком в новой партии
//                                                     (постройки, их метки, запасы, виды войска, задания, ход обучения)
//
// Минуты между заходами проходят сдвигом часов устройства (`SKIP` у захода, копится в `STATE_DIR/offset.json`):
// `Date` страницы идёт впереди настоящего на сумму сдвигов. Партия, открытая «позже», догоняет отлучку своим шагом
// (`sim/tick.absence`), мир считает всё от отметок времени — по правилу проекта это та же игра, что непрерывная
// (docs/time.md). Ускорение часов партии (`net/clock.hurry`) стенду недоступно: оно живёт под `CHEATS_ON`. Окно
// «С возвращением», которое встаёт после сдвига, стенд закрывает: у игрока, не выходившего из игры, его нет.
//
// Отличие от стенда карты экранов (`docs/ui_v2/shots.ts`): **обучение и подсказки не сняты** — снимаем ровно то, что
// видит новичок, — и касания идут настоящим пальцем (`Input.dispatchTouchEvent` по середине цели, как `tap`-отчёт), а не
// вызовом стора: так видно, попадает ли «дырка» обучения туда, куда игрок нажмёт. Кнопка «Предыстория» стартового
// экрана с ПН-00 видна и игроку (`ui/start.prologueShown`) — стенд её не прячет.
//
// Заходы идут по очереди и продолжают друг друга: в конце захода партия (весь `localStorage`) пишется в файл
// `STATE_DIR` (по умолчанию — `/tmp/tribe-onboard`), следующий заход кладёт её обратно перед загрузкой.
//
// Бюджет железа (CLAUDE.md, раздел ⛔): один заход — один браузер с потолком кадров (город — 2 кадра в секунду), не дольше
// двух минут (`BROWSER_MAX_MS`), минута остывания между заходами (`gpuCoolDown`), рядом с чужой тяжёлой работой не
// запускается (`refuseIfBusy`). Снимки — 390×844 @2, JPEG, в `docs/onboarding/`.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite } from 'vite';
import sharp from 'sharp';
import { launchChrome, sleep, Tab } from '../../scripts/lib/chrome';
import { BROWSER_MAX_MS, gpuCoolDown, gpuStamp, refuseIfBusy } from '../../scripts/lib/budget';

const OUT = fileURLToPath(new URL('.', import.meta.url));
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.PORT ?? 4199);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9344);
const SCREEN = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const FPS = 2;
const STATE_DIR = process.env.STATE_DIR ?? '/tmp/tribe-onboard';
/** Радиус пятна пальца, px — как у отчёта `tap`. */
const FINGER_R = 9;

// ---------- на странице ----------

const HELPERS = `(() => {
  const g = () => window.__game.getState();
  const txt = (el) => ((el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '')).trim();
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight; };
  window.__nb = {
    center(el) { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; },
    /** Цель не закрыта ничем: касание в её середину достанется ей. Закрыта или за краем — прокрутить её окно, как пальцем. */
    sel(sel) {
      const els = [...document.querySelectorAll(sel)];
      const free = (el) => { if (!vis(el)) return false; const c = window.__nb.center(el); const top = document.elementFromPoint(c.x, c.y); return !!top && (top === el || el.contains(top)); };
      let el = els.find(free);
      if (!el) {
        const e = els.find((x) => { const r = x.getBoundingClientRect(); return r.width > 1 && r.height > 1; });
        let p = e ? e.parentElement : null;
        while (p) { const st = getComputedStyle(p); if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && p.scrollHeight > p.clientHeight) break; p = p.parentElement; }
        if (e && p) {
          const r = e.getBoundingClientRect(), b = p.getBoundingClientRect();
          p.scrollTop += r.top + r.height / 2 - (b.top + b.height / 2);
          window.__nb.scrolled = (window.__nb.scrolled || 0) + 1;
          if (free(e)) el = e;
        }
      }
      return el ? window.__nb.center(el) : null;
    },
    text(label, scope) {
      const root = scope ? document.querySelector(scope) : document;
      if (!root) return null;
      const all = [...root.querySelectorAll('button, [role=tab], [role=button], a')].filter(vis);
      const el = all.find((b) => b.getAttribute('aria-label') === label) || all.find((b) => txt(b).startsWith(label)) || all.find((b) => txt(b).includes(label));
      return el ? window.__nb.center(el) : null;
    },
    hole() { const h = document.querySelector('.tut-hole'); return h ? window.__nb.center(h) : null; },
    who(x, y) { const el = document.elementFromPoint(x, y); if (!el) return '—'; return (el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : '') + ' «' + txt(el).slice(0, 30) + '»'); },
    tut() {
      const s = g().s;
      const bar = document.querySelector('.tut-bar .txt');
      const hole = document.querySelector('.tut-hole');
      return {
        step: s.tutorialDone ? 'конец' : s.tutorialStep,
        bar: bar ? bar.textContent : null,
        hole: hole ? window.__nb.center(hole) : null,
        sheet: g().sheet ? (g().sheet.kind || JSON.stringify(g().sheet).slice(0, 40)) : null,
        map: g().mapOpen,
        tip: (document.querySelector('.nx-tip') || {}).textContent || null,
      };
    },
    state() {
      const s = g().s;
      return {
        time: Math.round(s.time * 10) / 10, pop: Math.round(s.pop ?? 0), morale: Math.round(s.morale ?? 0), gold: Math.round(s.gold ?? 0), inbox: (s.inbox || []).map((e) => e.defId),
        spear: s.equipment.spear || 0, forge: s.forge.length, army: Object.values(s.army || {}).reduce((a, b) => a + b, 0),
        recruits: (s.recruits || []).length, scouts: s.scoutsAway, hints: (s.hints && s.hints.seen) || [], site: (s.buildings.find((b) => b.workRequired > 0) || {}).type || null,
        alerts: [...document.querySelectorAll('.nx-alerts button')].map((b) => b.getAttribute('aria-label') || b.textContent).slice(0, 8),
      };
    },
    save() { try { g().save(); } catch (e) {} const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; },
  };
  return JSON.stringify('ok');
})()`;

const nb = (call: string): string => `JSON.stringify(window.__nb.${call})`;

// ---------- шаги ----------

type Pt = { x: number; y: number } | null;

interface Ctx {
  tab: Tab;
  taps: number;
}

interface Step {
  name: string;
  act?: (c: Ctx) => Promise<string>;
  wait?: number;
  shot?: boolean;
}

async function touch(c: Ctx, p: { x: number; y: number }): Promise<void> {
  const pt = [{ x: p.x, y: p.y, radiusX: FINGER_R, radiusY: FINGER_R, force: 1 }];
  // Без паузы между нажатием и отпусканием: в облаке кадр программной отрисовки держит поток страницы секунду и больше,
  // и касание с паузой сцена судит «долгим» (журнал касаний: 2,4 с при `TAP_MS` 700) — у игрока такого кадра нет.
  await Promise.all([
    c.tab.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt }),
    c.tab.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
  ]);
  c.taps++;
}

/** Палец в точку, которую вернуло выражение на странице; ответ — кто стоял под пальцем. */
async function tapAt(c: Ctx, expr: string, what: string): Promise<string> {
  const p = await c.tab.eval<Pt>(expr).catch(() => null);
  if (!p) return `нет цели: ${what}`;
  const who = await c.tab.eval<string>(nb(`who(${p.x}, ${p.y})`));
  await touch(c, p);
  return `палец ${p.x},${p.y} → ${who}`;
}

const tapSel = (sel: string) => (c: Ctx) => tapAt(c, nb(`sel(${JSON.stringify(sel)})`), sel);
const tapText = (label: string, scope?: string) => (c: Ctx) =>
  tapAt(c, nb(`text(${JSON.stringify(label)}${scope ? `, ${JSON.stringify(scope)}` : ''})`), `«${label}»`);
const tapHole = (c: Ctx): Promise<string> => tapAt(c, nb('hole()'), 'дырка обучения');

/**
 * Палец в середину «дырки» над постройкой (нет дырки — в середину постройки на экране, `screenSpot`) — так нажмёт новичок.
 * Стенд пишет, что тот же судья, что у пальца (`Scene.pickAt`), открыл бы в этой точке, и журнал касаний сцены. Судья
 * видит не ту постройку — это находка (дырка стоит не там, где постройка принимает палец), и стенд печатает ближайшую
 * точку, где судья видит нужную.
 */
const tapBuilding = (type: string) => async (c: Ctx): Promise<string> => {
  const info = await c.tab.eval<{ id: number; hole: Pt; pick: number | null; near: Pt }>(`(() => {
    const s = window.__game.getState().s;
    const b = s.buildings.find((x) => x.type === '${type}');
    const sc = window.__scene;
    const sp0 = sc && b ? sc.screenSpot(b.id) : null;
    const h = window.__nb.hole() || (sp0 ? { x: Math.round(sp0.x), y: Math.round(sp0.y) } : null);
    const pick = h && sc ? sc.pickAt(h.x, h.y) : null;
    let near = null;
    if (sc && b) {
      const sp = sc.screenSpot(b.id);
      outer: for (let r = 0; r <= 80; r += 6) for (let a = 0; a < 16; a++) {
        const x = Math.round(sp.x + r * Math.cos(a * Math.PI / 8)), y = Math.round(sp.y + r * Math.sin(a * Math.PI / 8));
        if (sc.pickAt(x, y) === b.id) { near = { x, y }; break outer; }
      }
    }
    return JSON.stringify({ id: b ? b.id : -1, hole: h, pick, near });
  })()`);
  const first = info.hole ? await tapAt(c, `JSON.stringify(${JSON.stringify(info.hole)})`, 'постройка') : 'нет цели';
  await sleep(1200);
  const log = await c.tab
    .eval<unknown>(`(async () => JSON.stringify((await import('/src/gestlog.ts')).gestLog.list().slice(-2)))()`)
    .catch((e: Error) => e.message);
  console.log(`      журнал касаний: ${JSON.stringify(log)}`);
  const opened = await c.tab.eval<boolean>(`JSON.stringify((window.__game.getState().sheet || {}).id === ${info.id})`);
  if (opened) return `${first}; судья в дырке: ${info.pick} (нужна ${info.id}) — открылась`;
  // Не открылась — смотрим журнал: «долгое» значит, что облако растянуло касание; тогда открываем тем же, что тап
  // (`openBuilding`), — судья в дырке уже сказал, что палец игрока попал бы.
  await c.tab.eval<string>(`(() => { window.__game.getState().openBuilding(${info.id}); return JSON.stringify('ok'); })()`);
  return `${first}; судья в дырке: ${info.pick} (нужна ${info.id}) — касание не открыло (журнал выше), открыто стором; точка судьи рядом: ${JSON.stringify(info.near)}`;
};
const tapPoint = (x: number, y: number) => (c: Ctx) => tapAt(c, `JSON.stringify({x:${x},y:${y}})`, `${x},${y}`);

/** Пауза, потом действие: второе касание — по тому, что первое перерисовало. */
const sleepThen = (ms: number, act: (c: Ctx) => Promise<string>) => async (c: Ctx): Promise<string> => {
  await sleep(ms);
  return act(c);
};

/** Ждать, пока выражение на странице не станет истинным (не дольше `ms`). */
const until = (cond: string, ms: number, label: string) => async (c: Ctx): Promise<string> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await c.tab.eval<boolean>(`JSON.stringify(!!(${cond}))`).catch(() => false)) return `${label}: ${Date.now() - t0} мс`;
    await sleep(400);
  }
  return `${label}: не дождался за ${ms} мс`;
};

/** Ближайшее к дому место на карте — тем же `select`, что тап по клетке (как стенд карты экранов). */
const pickPlace = (cond: string) => async (c: Ctx): Promise<string> =>
  c.tab.eval<string>(`(async () => {
    const W = (await import('/src/world/store.ts')).useWorld;
    const C = await import('/src/world/cache.ts');
    const h = W.getState().info && W.getState().info.home;
    if (!h) return JSON.stringify('нет клетки дома');
    const all = C.loadedIn({ x: h.x - 30, y: h.y - 30, w: 60, h: 60 }).flatMap((c) => c.settlements);
    const fit = all.filter((s) => ${cond}).sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y));
    if (!fit.length) return JSON.stringify('места нет среди ' + all.length);
    await W.getState().select({ x: fit[0].x, y: fit[0].y });
    return JSON.stringify('выбрано: ' + (fit[0].name || fit[0].id) + ' (' + (fit[0].castle ? 'город' : 'логово') + '), мест рядом ' + all.length + ', городов ' + all.filter((s) => s.castle && !s.mine).length);
  })()`);

/** Сколько настоящих минут до конца первого заказа кузницы — той же `forgeInfo`, что считает окно кузницы. */
const forgeEta = async (c: Ctx): Promise<string> =>
  c.tab.eval<string>(`(async () => {
    const D = await import('/src/game/derived.ts');
    const P = await import('/src/game/pace.ts');
    const f = D.forgeInfo(window.__game.getState().s);
    return JSON.stringify(f.eta === null ? 'кузница стоит' : 'до копья ' + (P.realMs(f.eta) / 60000).toFixed(1) + ' настоящих мин, кузнецов ' + D.forgeHands(window.__game.getState().s));
  })()`);

const GROUPS: Record<string, { fresh: boolean; skip?: number; steps: Step[] }> = {
  a: {
    fresh: true,
    steps: [
      { name: '00-start', wait: 800 },
      { name: '01-name', act: tapSel('.start-go'), wait: 1500 },
      { name: '02-intro', act: tapSel('.nx-cname .start-go'), wait: 4000 },
      { name: '03-smithy-hole', act: tapPoint(195, 420), wait: 1500 },
      { name: '04-smithy', act: tapBuilding('smithy'), wait: 1800 },
      { name: '05-tech-step', act: tapSel('[data-tut="slot-add"]'), wait: 1200 },
      { name: '06-realm', act: tapSel('[data-tut="coat"]'), wait: 1800 },
      { name: '07-study', act: tapSel('[data-tut^="tech-"]'), wait: 1200 },
      { name: '08-realm-closed', act: tapSel('.nx-realm .nx-ibtn[aria-label="Закрыть"]'), wait: 1500 },
      { name: '09-smithy-again', act: tapBuilding('smithy'), wait: 1800 },
      { name: '10-forge', act: async (c) => `${await tapSel('[data-tut="forge-spear"]')(c)}; ${await forgeEta(c)}`, wait: 1500 },
    ],
  },
  b: {
    fresh: false,
    steps: [
      { name: '11-city-back', act: forgeEta, wait: 1200 },
      { name: '12-hall', act: tapSel('[data-tut="nav-townhall"]'), wait: 1800 },
      { name: '13-hall-pick', act: tapSel('[data-tut="list-barracks"]'), wait: 1200 },
      { name: '14-barracks', act: async (c) => `${await tapSel('[data-tut="list-barracks"]')(c)}; ${await forgeEta(c)}`, wait: 1800 },
      { name: '15-recruit-wait', act: tapSel('[data-tut="recruit-spearman"]'), wait: 1200 },
    ],
  },
  c: {
    fresh: false,
    skip: 10,
    steps: [
      { name: '16-minute15', act: forgeEta, wait: 1500 },
      // Тревог на минуте 15 нет (кольца у верха не стоят) — снимок 17 был бы копией 16.
      { name: '17-minute15-alert', act: tapSel('.nx-alerts button'), wait: 900, shot: false },
      { name: '18-minute15-people', act: tapSel('[data-tut="nav-people"]'), wait: 1500 },
      { name: '19-minute15-army', act: tapSel('[data-tut="nav-army"]'), wait: 1500 },
      { name: '20-minute15-mail', act: tapText('Вести', '.nx-nav'), wait: 1500 },
    ],
  },
  d: {
    fresh: false,
    skip: 15,
    steps: [
      { name: '21-spear-ready', act: forgeEta, wait: 1200 },
      // Подсветки нет: окно казарм закрыто, и новичок ищет казармы сам — тем же путём, что в шаге 6 (Ратуша → плитка → «Открыть»).
      { name: '22-barracks-again', act: async (c) => `${await tapSel('[data-tut="nav-townhall"]')(c)}`, wait: 1500 },
      { name: '23-barracks-found', act: async (c) => `${await tapSel('[data-tut="list-barracks"]')(c)}; ${await sleepThen(1200, tapSel('[data-tut="list-barracks"]'))(c)}`, wait: 1500 },
      { name: '23b-recruit', act: tapSel('[data-tut="recruit-spearman"]'), wait: 1500 },
      { name: '24-map', act: tapSel('[data-tut="nav-map"]'), wait: 6000 },
      { name: '25-cell', act: pickPlace('!s.mine'), wait: 2200 },
      { name: '26-scout', act: tapSel('[data-tut="scout"]'), wait: 1500 },
      { name: '27-scout-2', act: tapSel('[data-tut="scout"]'), wait: 1800 },
      { name: '28-outro', act: tapPoint(195, 300), wait: 1200 },
    ],
  },
  e: {
    fresh: false,
    steps: [
      { name: '29-city-after', act: tapSel('[data-tut="nav-city"]'), wait: 2000 },
      { name: '30-first-hint', act: until('document.querySelector(".nx-tip")', 40000, 'первая подсказка'), wait: 800 },
      { name: '31-tasks', act: async (c) => `${await tapSel('.nx-tip-catch')(c)}; ${await tapSel('[data-tut="coat"]')(c)}; ${await sleepThen(1500, tapText('Задания', '.nx-realm'))(c)}`, wait: 1500 },
      { name: '32-rating-points', act: tapText('Правитель', '.nx-realm'), wait: 1200 },
    ],
  },
};

// ---------- съёмка ----------

async function snap(tab: Tab, name: string): Promise<void> {
  const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  const jpg = await sharp(Buffer.from(png.data, 'base64')).jpeg({ quality: 70, mozjpeg: true }).toBuffer();
  await writeFile(join(OUT, `${name}.jpg`), jpg);
}

async function run(name: string, plan: { fresh: boolean; skip?: number; steps: Step[] }): Promise<void> {
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  const began = Date.now();
  const c: Ctx = { tab, taps: 0 };
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
    await tab.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    // Сдвиг часов устройства: сумма `SKIP` прошлых заходов и этого (минуты, прожитые новичком между заходами).
    const before = plan.fresh ? 0 : Number(JSON.parse(await readFile(join(STATE_DIR, 'offset.json'), 'utf8').catch(() => '0')));
    const offset = before + Number(process.env.SKIP ?? plan.skip ?? 0) * 60_000;
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(join(STATE_DIR, 'offset.json'), JSON.stringify(offset));
    if (offset > 0) {
      await tab.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `(() => { const R = Date, off = ${offset}; class D extends R { constructor(...a) { if (a.length === 0) super(R.now() + off); else super(...a); } static now() { return R.now() + off; } } window.Date = D; })();`,
      });
    }
    console.log(`  часы устройства впереди на ${Math.round(offset / 60000)} мин`);
    await tab.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?probe=1&fpscap=${FPS}&quality=low` });
    await sleep(1500);
    const saved = plan.fresh ? null : (JSON.parse(await readFile(join(STATE_DIR, 'save.json'), 'utf8')) as Record<string, string>);
    await tab.eval<string>(`(() => { try { localStorage.clear(); const o = ${JSON.stringify(saved ?? {})}; for (const k in o) localStorage.setItem(k, o[k]); } catch (e) {} return JSON.stringify("ok"); })()`);
    await tab.send('Page.reload');
    let up = false;
    for (let i = 0; i < 150 && !up; i++) {
      await sleep(300);
      up = await tab.eval<boolean>('JSON.stringify(!!(window.__game && document.querySelector(".start-go")))').catch(() => false);
    }
    if (!up) throw new Error('стартовый экран не встал за 45 с');
    // Кнопка «Предыстория» видна и игроку (`ui/start.prologueShown`, ПН-00) — её не прячем. Окно «Город не рисуется»
    // (`SceneTrouble`) в облаке встаёт от программной отрисовки на 2 кадрах в секунду и перехватывает палец — это
    // свойство стенда, а не игры; стенд карты экранов прячет его так же.
    await tab.eval<string>(`(() => { const st = document.createElement('style'); st.textContent = '.trouble { display: none !important; }'; document.head.appendChild(st); return JSON.stringify('ok'); })()`);
    await tab.eval<string>(HELPERS);
    if (!plan.fresh) {
      console.log(`  вход: ${await tapSel('.start-go')(c)}`);
      await sleep(3000);
      const away = await c.tab.eval<string | null>(`JSON.stringify((document.querySelector('.modal h2') || {}).textContent || null)`);
      if (away) console.log(`  окно «${away}»: ${await tapSel('.modal .btn')(c)}`);
      c.taps = 0;
      await sleep(800);
    }
    for (const step of plan.steps) {
      if (Date.now() - began > BROWSER_MAX_MS - 10000) {
        console.log(`  срок захода вышел — не сняты: ${plan.steps.slice(plan.steps.indexOf(step)).map((s) => s.name).join(', ')}`);
        break;
      }
      const t0 = Date.now();
      const said = step.act ? await step.act(c).catch((e: Error) => `ошибка: ${e.message}`) : '—';
      await sleep(step.wait ?? 800);
      if (step.shot !== false) await snap(tab, step.name);
      const tut = await tab.eval<unknown>(nb('tut()')).catch(() => null);
      console.log(`  ${step.name} (${Date.now() - t0} мс): ${said}\n      обучение: ${JSON.stringify(tut)}`);
    }
    console.log(`  прокруток к цели: ${await tab.eval<number>('JSON.stringify(window.__nb.scrolled || 0)').catch(() => 0)}`);
    const mins = await tab.eval<string>(`(async () => { const P = await import('/src/game/pace.ts'); return JSON.stringify((P.realMs(window.__game.getState().s.time) / 60000).toFixed(1)); })()`).catch(() => '?');
    console.log(`  касаний за заход: ${c.taps}; партия прожила ${mins} настоящих мин; состояние: ${JSON.stringify(await tab.eval<unknown>(nb('state()')).catch(() => null))}`);
    const save = await tab.eval<Record<string, string>>(nb('save()'));
    await mkdir(STATE_DIR, { recursive: true });
    await writeFile(join(STATE_DIR, 'save.json'), JSON.stringify(save));
  } finally {
    tab.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`).catch(() => undefined);
  }
}

/**
 * Новая партия глазами данных — без браузера (docs/onboarding.md, раздел 4): сколько всего лежит перед новичком в первую
 * минуту и сколько настоящих минут стоит путь обучения до первого бойца. Те же функции, что у игры.
 */
async function startCounts(): Promise<void> {
  const { BUILDINGS } = await import('../../src/game/data/buildings');
  const { TROOPS } = await import('../../src/game/data/troops');
  const { EQUIPMENT } = await import('../../src/game/data/equipment');
  const { RESOURCE_META } = await import('../../src/game/constants');
  const { QUESTS } = await import('../../src/game/data/quests');
  const { TUTORIAL } = await import('../../src/game/data/tutorial');
  const { HINTS } = await import('../../src/game/data/hints');
  const { createInitialState } = await import('../../src/game/state');
  const D = await import('../../src/game/derived');
  const P = await import('../../src/game/pace');
  const s = createInitialState();
  const marks: Record<string, string[]> = {};
  for (const b of s.buildings) (marks[D.buildingAttention(s, b) ?? 'нет'] ??= []).push(b.type);
  console.log(`\n=== новая партия: что перед новичком ===\n`);
  console.log(`  построек: ${s.buildings.length} из ${BUILDINGS.length}; можно улучшить сразу: ${s.buildings.filter((b) => D.upgradeInfo(s, b).blocked === null).length}`);
  const { onRoof } = await import('../../src/render/Scene');
  for (const [k, v] of Object.entries(marks)) {
    const roof = k !== 'нет' && onRoof(k as Parameters<typeof onRoof>[0]);
    console.log(`  забота «${k}»${roof ? ' (кольцо над крышей)' : ' (над крышей не рисуется)'}: ${v.length} — ${v.join(', ')}`);
  }
  console.log(`  запасов: ${Object.keys(RESOURCE_META).length}; видов войска: ${TROOPS.length}; снаряжения: ${EQUIPMENT.length}; заданий: ${QUESTS.length}`);
  console.log(`  шагов обучения: ${TUTORIAL.length}; подсказок после него: ${HINTS.length}`);
  // Путь обучения до первого бойца: один кузнец (шаг «Поставь кузнеца»), одно копьё, один копейщик.
  const smithy = D.buildingOfType(s, 'smithy');
  if (smithy) {
    const spear = EQUIPMENT.find((e) => e.id === 'spear');
    const mins = (n: number): string => {
      s.workers = { ...s.workers, [smithy.id]: n };
      const rate = D.forgeRate(s);
      return spear && rate > 0 ? (P.realMs(spear.work / rate) / 60000).toFixed(1) : '—';
    };
    console.log(`  копьё у одного кузнеца: ${mins(1)} настоящих мин; у четырёх (все места 1-го уровня): ${mins(4)}`);
  }
  // Найм головы в казармах 1-го уровня: дубинщик снаряжения не просит, копейщику нужно копьё.
  for (const id of ['clubman', 'spearman'] as const) {
    const t = TROOPS.find((x) => x.id === id);
    const rate = D.recruitRate(s, id);
    if (t && rate > 0) console.log(`  найм одного «${t.id}»: ${(P.realMs(t.work / rate) / 60000).toFixed(1)} настоящих мин, снаряжение: ${JSON.stringify(t.gear)}`);
  }
  console.log(`  первый поход разведки до логова и сроки — снимки заходов b–d.`);
}

async function main(): Promise<void> {
  const name = process.env.GROUP;
  if (name === 'start') {
    await startCounts();
    return;
  }
  if (!name || !GROUPS[name]) {
    console.log(`Заходы: ${Object.keys(GROUPS).join(', ')} — по очереди, GROUP=<имя>.`);
    return;
  }
  refuseIfBusy('Снимки прохода новичком');
  await mkdir(OUT, { recursive: true });
  const vite = await createVite({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  try {
    console.log(`\n=== проход новичком: заход ${name} (390×844 @2, потолок ${FPS} кадр/с) ===\n`);
    await gpuCoolDown('снимками прохода');
    const root = process.getuid?.() === 0 ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
    const chrome = await launchChrome(DEBUG_PORT, ['--use-gl=angle', '--window-size=500,900', ...root]);
    try {
      await run(name, GROUPS[name]);
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
