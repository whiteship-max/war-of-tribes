// Стенд снимков интерфейса для карты экранов (docs/ui_v2.md, раздел 1) — не отчёт, в приёмку не входит.
//
//   npx vite-node docs/ui_v2/shots.ts                 — список заходов
//   GROUP=city npx vite-node docs/ui_v2/shots.ts      — один заход: город, верх, подсказки, низ
//   GROUP=bld1 | bld2 | realm | map | misc            — постройки (две половины), держава, карта, прочее
//   GROUP=hall TAG=after npx vite-node docs/ui_v2/shots.ts — ратуша «Стройка» (UI-2): шторка во всю высоту, группы, лист
//                                                     постройки, стройка; `TAG` — приписка к имени снимка («до» и «после»)
//   GROUP=army TAG=after npx vite-node docs/ui_v2/shots.ts — «Дружина» (UI-4): гарнизон и отряд, шаг передачи, итог
//   GROUP=top TAG=after npx vite-node docs/ui_v2/shots.ts — подсказки верха и запасов (UI-3): разбор и двери
//   GROUP=people TAG=after npx vite-node docs/ui_v2/shots.ts — «Жители» (UI-5): сводка, места работы, невольники в «Порядке»
//   GROUP=decrees | mail | market | profile | siege TAG=after … — UI-7: указы ратуши и державы, вести с письмами, рынок с
//                                                     телегой, профиль, окна осады, вылазки и лагеря (вид мира вложен
//                                                     стендом: в новой партии осады нет); карта — заход `map`
//   GROUP=ui8a | ui8b | ui8c TAG=after …            — UI-8: верх, ратуша, ярлык у лесов, подсказка новичку; окна построек
//                                                     с дублями; «Мораль», «Порядок» вкладками, полководец без отряда
//   DIR=polish GROUP=p7 TAG=before|after …          — П-7 (docs/polish.md): тревоги войны значками справа снизу — осада
//                                                     тихая и срочная, набеги, свой лагерь, карта, вход в окно, город без осады
//
// Снимки — 390×844 @2, JPEG, в `docs/ui_v2/` (имя — номер и экран). Кроме снимка стенд печатает высоту прокрутки
// окна в экранах: `экранов 2.4` — содержимое окна выше экрана телефона в 2.4 раза (правило «окно — один экран»,
// docs/ui_v2.md, раздел 2). Это вывод стенда, а не отчёта: число для глаз и для карты экранов, сверки с базой нет.
//
// Живёт в `docs/`, а не в `scripts/`, как щуп строк прежней описи (`docs/ui_audit_drafts/tools`): он ничего не
// меряет для приёмки, а команда в `package.json` погнала бы приёмку целиком (правило 9, «изменился сам подсчёт»).
//
// Бюджет железа (CLAUDE.md, раздел ⛔): один заход — один браузер, с потолком кадров (город рисуется раз в секунду:
// интерфейсу частота не нужна), не дольше двух минут (`BROWSER_MAX_MS`) — остальное следующим заходом; минута
// остывания между заходами (`gpuCoolDown`); рядом с чужой тяжёлой работой стенд не запускается (`refuseIfBusy`).
// Партия каждый раз новая (`localStorage` чистится), обучение снято — его затемнение не вид экрана.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createServer as createVite } from 'vite';
import sharp from 'sharp';
import { ENTER_GAME, launchChrome, sleep, Tab } from '../../scripts/lib/chrome';
import { BROWSER_MAX_MS, gpuCoolDown, gpuStamp, refuseIfBusy } from '../../scripts/lib/budget';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** Папка снимков: по умолчанию `docs/ui_v2/`; `DIR=polish` — `docs/polish/` (заходы полировки, docs/polish.md). */
const OUT = process.env.DIR ? join(ROOT, 'docs', process.env.DIR) : fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 4198);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9343);
const SCREEN = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
/** Город рисуется раз в секунду: снимкам интерфейса кадры не нужны, а программная отрисовка в облаке дорога. */
const FPS = 1;

/** Шаг захода: что сделать на странице, сколько подождать и снять ли. */
interface Step {
  name: string;
  /** Выражение на странице (может вернуть обещание); вернуло строку — она печатается. */
  run?: string;
  wait?: number;
  /** Снять; по умолчанию — да. */
  shot?: boolean;
  /** Снять и вкладки окна (`[role=tab]` внутри шторки или державы) — каждую своим снимком. */
  tabs?: boolean;
  /** Поднять шторку во всю высоту (85 %) — рывком за хэндл вверх, как пальцем: снимок видит окно целиком. */
  full?: boolean;
}

/** Приписка к имени снимка: `TAG=before` — «до», `TAG=after` — «после» (UI-2 и дальше). */
const TAG = process.env.TAG ?? '';

// ---------- помощники на странице ----------

/** Свои помощники в окне страницы: найти кнопку по подписи, открыть постройку, закрыть всё. */
const HELPERS = `(() => {
  const g = () => window.__game.getState();
  const txt = (el) => (el.getAttribute('aria-label') || '') + ' ' + (el.textContent || '');
  window.__ui = {
    btn(label, scope) {
      const root = scope ? document.querySelector(scope) : document;
      if (!root) return null;
      const all = [...root.querySelectorAll('button, [role=tab], a')];
      return all.find((b) => b.getAttribute('aria-label') === label) || all.find((b) => txt(b).trim().startsWith(label)) || all.find((b) => txt(b).includes(label)) || null;
    },
    click(label, scope) {
      const b = window.__ui.btn(label, scope);
      if (!b) return 'нет кнопки «' + label + '»';
      b.click();
      return 'ok';
    },
    clickSel(sel) {
      const b = document.querySelector(sel);
      if (!b) return 'нет ' + sel;
      b.click();
      return 'ok';
    },
    building(type) {
      const b = g().s.buildings.find((x) => x.type === type);
      if (!b) return 'нет постройки ' + type;
      g().openBuilding(b.id);
      return 'ok';
    },
    reset() {
      if (document.querySelector('.nx-tip-catch')) document.querySelector('.nx-tip-catch').click();
      if (g().mapOpen) g().closeMap();
      // Закрыть шторку любого вида: \`openBuilding(null)\` закрывает только окно постройки, а \`openTab\` — переключатель.
      if (g().sheet) g().closeSheet();
      const x = document.querySelector('.nx-realm .nx-ibtn[aria-label="Закрыть"]');
      if (x) x.click();
      // Сокровищница — своё окно поверх города: шторкой не закрывается.
      const t = document.querySelector('.nx-treasury .nx-bclose');
      if (t) t.click();
      return 'ok';
    },
    /** Прокрутка открытого окна: шторка, держава или окно поверх. */
    scroller() {
      const cands = [...document.querySelectorAll('.sheet.open .sheet-body, .nx-realm .nx-rbody, .modal, .nx-am, .nx-am-body, .wm-legend, .wm-rating')];
      return cands.find((e) => e.scrollHeight > e.clientHeight + 2) || cands[0] || null;
    },
    measure() {
      const e = window.__ui.scroller();
      if (!e) return null;
      return { h: e.scrollHeight, box: e.clientHeight, screens: Math.round((e.scrollHeight / innerHeight) * 10) / 10 };
    },
  };
  return JSON.stringify('ok');
})()`;

const ui = (call: string): string => `JSON.stringify(window.__ui.${call})`;
/**
 * Выбрать на карте ближайшее к дому место, подходящее под условие над `s` (`SettlementView`), — тем же `select`, что тап
 * по клетке. Стор мира и кэш кусков — те же модули, что у игры: сервер разработки отдаёт их по одному адресу.
 */
const place = (cond: string): string => `(async () => {
  const W = (await import('/src/world/store.ts')).useWorld;
  const C = await import('/src/world/cache.ts');
  const h = W.getState().info && W.getState().info.home;
  if (!h) return JSON.stringify('нет клетки дома');
  const all = C.loadedIn({ x: h.x - 30, y: h.y - 30, w: 60, h: 60 }).flatMap((c) => c.settlements);
  const fit = all.filter((s) => ${cond}).sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y));
  if (!fit.length) return JSON.stringify('места нет среди ' + all.length);
  await W.getState().select({ x: fit[0].x, y: fit[0].y });
  return JSON.stringify('ok');
})()`;
/** Два касания подряд с паузой между ними: второе — по тому, что первое перерисовало. */
const then = (a: string, b: string): string =>
  `(async () => { const r1 = ${a}; await new Promise((r) => setTimeout(r, 300)); const r2 = ${b}; return JSON.stringify(r1 === 'ok' ? r2 : r1); })()`;
const tab = (t: string): string => `(() => { window.__ui.reset(); window.__game.getState().openTab('${t}'); return JSON.stringify('ok'); })()`;
/** Конец открытого окна: прокрутка до низа (UI-8; прежние заходы пишут то же выражение у себя). */
const END = `(() => { const e = window.__ui.scroller(); if (!e) return JSON.stringify('нет окна'); e.scrollTop = e.scrollHeight; return JSON.stringify('ok'); })()`;
const building = (type: string, name: string): Step => ({ name, run: ui(`reset(), window.__ui.building('${type}')`), wait: 900, tabs: true });

// ---------- заходы ----------

/**
 * П-7: вид мира для значков тревог. `calm` — одна осада без срочного; `urgent` — осада с проломом, готовым тараном и
 * предложением условий, два набега и свой лагерь под чужими стенами с выручкой на подходе: четыре тревоги — больше трёх
 * мест столбца. `camp` — класть ли свой лагерь (карте его не дают: окно лагеря стенду не нужно).
 */
function P7_BODY(kind: 'calm' | 'urgent', camp = true): string {
  return `
    window.__ui.reset();
    const S = await import('/src/world/store.ts');
    const now = S.worldNow();
    const H = 3600000;
    const homeId = S.useWorld.getState().info?.homeId ?? 'home';
    const urgent = ${kind === 'urgent'};
    const raid = (id, from, at) => ({ id, mission: 'raid', units: {}, own: false, hostile: true, phase: 'out', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, fromName: from, toName: '', targetId: homeId, departAt: now - H, arriveAt: now + at * H, loot: null, recallable: false });
    S.useWorld.setState({
      pulse: async () => {},
      loadCamp: async () => {},
      marches: urgent ? [raid('m-p7-1', 'Чёрный брод', 0.3), raid('m-p7-2', 'Сухая балка', 0.9)] : [],
      camp: urgent && ${camp} ? { targetId: 'l-2', targetName: 'Каменный яр', starvesAt: now + 9 * H, since: now - 3 * H, campMen: 80, builders: 80, fate: 'plunder', relief: { from: 'Соседи', men: 40, at: now + 0.5 * H, joint: false } } : null,
      siege: {
        byId: 'l-1', byName: 'Волчья падь', since: now - 5 * H, starvesAt: now + 14 * H, garrison: 50, foodAtStart: 900,
        campMen: 120, builders: 120, fate: 'plunder', palisade: 2,
        fall: { goods: 640, gold: 80, hidden: 60, ledBonded: 0, ledPop: 0, scatterPop: 0, scatterBonded: 0, buildings: 3, levels: 1, burnsWorks: false, routed: 0 },
        phases: { journal: urgent ? ['Фаза 2: кость 9 + 1 — пролом.'] : ['Фаза 1: кость 5 — стена держит.'], next: '', nextAt: now + 1.5 * H, nextK: urgent ? 3 : 2, breaches: urgent ? 1 : 0, progress: urgent ? 2 : 0 },
        answers: { repair: { cost: { wood: 80, stone: 40 }, reason: null, doneAt: null }, ration: { on: false, starvesAt: now + 20 * H }, surrender: 'captives', burn: [{ machine: 'ram', name: 'Таран', ready: urgent, guard: 40 }], reliefs: [] },
        parley: { side: 'def', share: 0.32, fair: 210, block: null, bot: true, ...(urgent ? { incoming: { kind: 'terms', fate: 'captives', until: now + H } } : {}) },
      },
    });
  `;
}
const P7 = (kind: 'calm' | 'urgent'): string => `(async () => { ${P7_BODY(kind)} return JSON.stringify('ok'); })()`;

const GROUPS: Record<string, Step[]> = {
  city: [
    { name: '01-city', run: ui('reset()'), wait: 1500 },
    { name: '02-tip-gold', run: ui(`click('Золото', '.nx-top')`), wait: 400 },
    { name: '03-tip-pop', run: ui(`reset(), window.__ui.click('Жители', '.nx-top')`), wait: 400 },
    { name: '04-tip-morale', run: ui(`reset(), window.__ui.click('Мораль', '.nx-top')`), wait: 400 },
    { name: '05-tip-army', run: ui(`reset(), window.__ui.click('Дружина', '.nx-top')`), wait: 400 },
    { name: '06-tip-energy', run: ui(`reset(), window.__ui.click('Энергия', '.nx-top')`), wait: 400 },
    { name: '07-tip-season', run: ui(`reset(), window.__ui.clickSel('.nx-season')`), wait: 400 },
    { name: '08-tip-food', run: ui(`reset(), window.__ui.click('Еда', '.nx-res')`), wait: 400 },
    { name: '09-alert', run: ui(`reset(), window.__ui.clickSel('.nx-alerts button')`), wait: 400 },
    { name: '10-nav-townhall', run: ui(`reset(), window.__ui.click('Ратуша', '.nx-nav')`), wait: 900, tabs: true },
    { name: '11-nav-people', run: ui(`reset(), window.__ui.click('Жители', '.nx-nav')`), wait: 900 },
    { name: '12-nav-army', run: ui(`reset(), window.__ui.click('Дружина', '.nx-nav')`), wait: 900 },
    { name: '13-nav-mail', run: ui(`reset(), window.__ui.click('Вести', '.nx-nav')`), wait: 1200 },
  ],
  bld1: [
    building('campfire', '20-campfire'),
    building('houses', '21-houses'),
    building('storage', '22-storage'),
    building('gathering', '23-gathering'),
    building('sawmill', '24-sawmill'),
    building('quarry', '25-quarry'),
    building('hunter_hut', '26-hunter_hut'),
    building('mine', '27-mine'),
    building('workshop', '28-workshop'),
    building('farm', '29-farm'),
    building('pen', '30-pen'),
    building('church', '31-church'),
  ],
  bld2: [
    building('statue', '32-statue'),
    building('infirmary', '33-infirmary'),
    building('watch', '34-watch'),
    building('stable', '35-stable'),
    building('cache', '36-cache'),
    building('tavern', '37-tavern'),
    building('palisade', '38-palisade'),
    building('tower', '39-tower'),
    building('smithy', '40-smithy'),
    building('market', '41-market'),
    building('barracks', '42-barracks'),
  ],
  realm: [
    { name: '50-realm', run: ui(`reset(), window.__ui.clickSel('.coat-btn')`), wait: 1500, tabs: true },
    { name: '51-realm-settings', run: ui(`click('Профиль и настройки', '.nx-realm')`), wait: 800 },
  ],
  map: [
    { name: '60-map', run: `(() => { window.__ui.reset(); window.__game.getState().openMap(); return JSON.stringify('ok'); })()`, wait: 6000 },
    // С UI-7 у легенды вкладки «Места · Метки · Земля» — каждая своим снимком.
    { name: '61-map-legend', run: ui(`click('Легенда', '.nx-mapnav')`), wait: 900, tabs: true },
    { name: '62-map-marches', run: ui(`click('Легенда', '.nx-mapnav'), window.__ui.click('Походы', '.nx-mapnav')`), wait: 1200 },
    { name: '63-map-cell-own', run: place('s.mine'), wait: 2000 },
    { name: '64-map-cell-lair', run: place('!s.mine && !s.castle'), wait: 2000 },
    {
      name: '65-map-orders',
      run: `(async () => {
        const W = (await import('/src/world/store.ts')).useWorld.getState();
        const c = W.selected;
        if (!c) return JSON.stringify('клетка не выбрана');
        await W.openMenu('general', c);
        return JSON.stringify('ok');
      })()`,
      wait: 2000,
    },
  ],
  // UI-2 (docs/ui_v2.md, 5.1): ратуша «Стройка». Перед снимками одна постройка ставится в стройку — у сетки есть срок.
  hall: [
    {
      name: '80-hall',
      run: `(async () => {
        window.__ui.reset();
        const A = await import('/src/game/sim/actions.ts');
        const g = window.__game.getState();
        const b = g.s.buildings.find((x) => x.type === 'houses');
        g.act((st) => A.startUpgrade(st, b.id));
        return JSON.stringify(window.__ui.click('Ратуша', '.nx-nav'));
      })()`,
      wait: 1200,
      full: true,
    },
    { name: '81-hall-groups', run: ui(`click('Порядок: Готовность', '.sheet.open')`), wait: 700 },
    { name: '82-hall-war', run: ui(`click('Война', '.sheet.open .kit-tabs')`), wait: 700 },
    // Касание плитки — после того, как вкладка «Все» перерисовала сетку: React кладёт её не в тот же миг.
    { name: '83-hall-card', run: then(`window.__ui.click('Все', '.sheet.open .kit-tabs')`, `window.__ui.clickSel('.sheet.open [data-tut="list-farm"]')`), wait: 900 },
    { name: '84-hall-site', run: then(`window.__ui.clickSel('.hall-veil')`, `window.__ui.clickSel('.sheet.open [data-tut="list-houses"]')`), wait: 900 },
  ],
  // UI-3 (docs/ui_v2.md, 5.2): подсказки верха и запасов — разбор «в день» и двери к постройкам, «Склад» и окна.
  top: [
    { name: '90-top-gold', run: ui(`reset(), window.__ui.click('Золото', '.nx-top')`), wait: 500 },
    { name: '91-top-pop', run: ui(`reset(), window.__ui.click('Жители', '.nx-top')`), wait: 500 },
    { name: '92-top-morale', run: ui(`reset(), window.__ui.click('Мораль', '.nx-top')`), wait: 500 },
    { name: '93-top-army', run: ui(`reset(), window.__ui.click('Дружина', '.nx-top')`), wait: 500 },
    { name: '94-top-energy', run: ui(`reset(), window.__ui.click('Энергия', '.nx-top')`), wait: 500 },
    { name: '95-res-food', run: ui(`reset(), window.__ui.click('Еда', '.nx-res')`), wait: 500 },
    { name: '96-res-wood', run: ui(`reset(), window.__ui.click('Древесина', '.nx-res')`), wait: 500 },
    { name: '97-res-charcoal', run: ui(`reset(), window.__ui.click('Уголь', '.nx-res')`), wait: 500 },
    { name: '98-res-iron', run: ui(`reset(), window.__ui.click('Железо', '.nx-res')`), wait: 500 },
    { name: '99-top-gems', run: ui(`reset(), window.__ui.clickSel('.nx-gems')`), wait: 900 },
  ],
  // UI-4 (docs/ui_v2.md, 5.3): «Дружина» — передача между гарнизоном и отрядом полководца. Перед снимками у города 74
  // бойца четырёх видов, при полководце — 10 дубинщиков и 4 лучника (приказ мира, тот же, что у кнопки окна); затем
  // шаг «+10 к полководцу» у первого вида — итог «было → станет» до приказа.
  army: [
    {
      name: '100-army',
      run: `(async () => {
        window.__ui.reset();
        const g = window.__game.getState();
        g.act((st) => { st.army.clubman = 40; st.army.archer = 16; st.army.spearman = 12; st.army.rider = 6; });
        const W = (await import('/src/world/store.ts')).useWorld.getState();
        await W.pulse();
        const err = await W.setGarrison({ clubman: 10, archer: 4 });
        await W.pulse();
        window.__game.getState().openTab('army');
        return JSON.stringify(err ?? 'ok');
      })()`,
      wait: 1200,
      full: true,
    },
    // До UI-4 передача — окно «Раскладка» за строкой; с UI-4 строки нет, шаги — в самой «Дружине».
    { name: '101-army-step', run: `(() => { const r = window.__ui.btn('Раскладка', '.sheet.open'); if (r) r.click(); return JSON.stringify('ok'); })()`, wait: 900 },
    { name: '102-army-moved', run: ui(`clickSel('.sheet.open [aria-label="К полководцу 10"]')`), wait: 700 },
    // Конец окна: «Всех в гарнизон / в отряд», виды без бойцов, мораль между боями.
    { name: '103-army-end', run: `(() => { const e = window.__ui.scroller(); if (!e) return JSON.stringify('нет окна'); e.scrollTop = e.scrollHeight; return JSON.stringify('ok'); })()`, wait: 600 },
    // Подсказка итога: мощь отряда по видам — до приказа и после.
    { name: '104-army-tip', run: `(() => { const e = window.__ui.scroller(); if (e) e.scrollTop = 0; return JSON.stringify(window.__ui.click('Мощь отряда', '.sheet.open')); })()`, wait: 600 },
    // Касание вида — его карточка (прежде её открывал список «Состав»).
    { name: '105-army-card', run: `(() => { window.__ui.clickSel('.nx-tip-catch'); return JSON.stringify(window.__ui.clickSel('.sheet.open .ms-kind')); })()`, wait: 900 },
  ],
  // UI-5 (docs/ui_v2.md, 5.4): «Жители». Новая партия — 7 свободных рук без стройки: окно открывается на «Работах», как
  // велит счётчик низа; затем «Сводка» (до UI-5 вкладок нет — конец того же окна), разбор строки «Оборона» и «Порядок» с
  // невольниками (12, из них 5 на ферме): где стоят и отпуск.
  people: [
    { name: '110-people', run: ui(`reset(), window.__ui.click('Жители', '.nx-nav')`), wait: 900, full: true },
    {
      name: '111-people-sum',
      run: `(() => {
        const b = window.__ui.btn('Сводка', '.sheet.open .kit-tabs');
        if (b) { b.click(); return JSON.stringify('ok'); }
        const e = window.__ui.scroller();
        if (e) e.scrollTop = e.scrollHeight;
        return JSON.stringify('вкладок нет — конец окна');
      })()`,
      wait: 700,
    },
    { name: '112-people-tip', run: ui(`clickSel('.sheet.open .kit-table .kit-trow:last-child .kit-cells.tip')`), wait: 600 },
    {
      name: '113-order-bonded',
      run: `(() => {
        window.__ui.reset();
        const g = window.__game.getState();
        g.act((st) => { st.bonded = 12; st.bondedWork[st.buildings.find((b) => b.type === 'farm').id] = 5; });
        window.__game.getState().openTab('order');
        return JSON.stringify('ok');
      })()`,
      wait: 900,
      full: true,
    },
    { name: '114-order-release', run: `(() => { const e = window.__ui.scroller(); if (!e) return JSON.stringify('нет окна'); e.scrollTop = e.scrollHeight; return JSON.stringify('ok'); })()`, wait: 600 },
  ],
  // UI-7 (docs/ui_v2.md, 5.6): указы. До UI-7 — вкладка ратуши «Указы» и держава «Указы» двумя копиями; после — одна.
  decrees: [
    {
      name: '120-hall-decrees',
      run: `(() => {
        window.__ui.reset();
        const g = window.__game.getState();
        g.setTownTab('manage');
        g.openBuilding(g.s.buildings.find((x) => x.type === 'town_hall').id);
        return JSON.stringify('ok');
      })()`,
      wait: 1200,
      full: true,
    },
    { name: '121-realm-decrees', run: `(async () => { window.__ui.reset(); (await import('/src/ui/realm/open.ts')).useRealm.getState().show('government'); return JSON.stringify('ok'); })()`, wait: 1500 },
  ],
  // UI-7: «Вести» — четыре вести города и два письма мира (дань и набег; вне Telegram соседей нет — письма вложены стендом,
  // пульс мира остановлен, чтобы не снял их), затем открытая весть набега.
  mail: [
    {
      name: '130-mail',
      run: `(async () => {
        window.__ui.reset();
        const W = (await import('/src/world/store.ts')).useWorld;
        const M = await import('/src/game/sim/mail.ts');
        const now = (await import('/src/world/store.ts')).worldNow();
        W.setState({ pulse: async () => {} });
        window.__game.getState().act((st) => { for (const id of ['refugees', 'trade', 'festival', 'wanderers']) M.raiseEvent(st, id); });
        const letter = (id, kind, title, body, choices, mins) => ({ id, kind, at: now, until: now + mins * 60000, fromId: 'l-' + id, fromName: 'Волчья падь', cost: kind === 'tribute' ? { food: 120, wood: 60 } : {}, title, icon: kind === 'raid' ? '⚔️' : '💰', body, from: null, choices, seconds: mins * 60, silence: kind === 'raid' ? 'Без ответа: отряд дойдёт до стен.' : 'Без ответа: откажем.', marchId: kind === 'raid' ? 'm-1' : undefined });
        W.setState({ letters: [
          letter('t1', 'tribute', 'Дань', 'Требуют припасов за мир.', [{ id: 'yes', label: 'Отдать', hint: 'Мир на сезон.', can: true, reason: null }, { id: 'no', label: 'Отказать', hint: 'Будет набег.', can: true, reason: null }], 90),
          letter('r1', 'raid', 'Набег', 'Отряд логова идёт на город.', [], 25),
        ] });
        return JSON.stringify(window.__ui.click('Вести', '.nx-nav'));
      })()`,
      wait: 1500,
      tabs: true,
    },
    { name: '131-mail-raid', run: `(async () => { (await import('/src/ui/realm/open.ts')).useRealm.getState().openMail('letter:r1'); return JSON.stringify('ok'); })()`, wait: 900 },
  ],
  // UI-7: рынок — золото на складе и одна телега в пути; прилавок целиком.
  market: [
    {
      name: '140-market',
      run: `(async () => {
        window.__ui.reset();
        const A = await import('/src/game/sim/actions.ts');
        const D = await import('/src/game/derived.ts');
        const g = window.__game.getState();
        g.act((st) => { st.gold = 600; const o = D.marketOffer(st).find((x) => x.kind !== 'bonded'); if (o) A.buyGoods(st, o.id, 2); });
        return JSON.stringify(window.__ui.building('market'));
      })()`,
      wait: 1200,
      full: true,
    },
    { name: '141-market-end', run: `(() => { const e = window.__ui.scroller(); if (!e) return JSON.stringify('нет окна'); e.scrollTop = e.scrollHeight; return JSON.stringify('ok'); })()`, wait: 600 },
  ],
  // UI-7: профиль и настройки (держава, 👤) — шапка с именем города и 🐞, строки настроек, числа партии.
  profile: [
    { name: '150-profile', run: `(async () => { window.__ui.reset(); (await import('/src/ui/realm/open.ts')).useRealm.getState().show('settings'); return JSON.stringify('ok'); })()`, wait: 1500 },
    { name: '151-profile-end', run: `(() => { const e = window.__ui.scroller(); if (!e) return JSON.stringify('нет окна'); e.scrollTop = e.scrollHeight; return JSON.stringify('ok'); })()`, wait: 600 },
  ],
  // UI-7: окна осады (обороняющийся), вылазки и лагеря (осаждающий). В новой партии осады нет — вид мира вкладывает стенд
  // теми полями, что отдаёт пульс (`SiegeView`, `CampView`), а пульс и подгрузка лагеря остановлены, чтобы его не сняли.
  siege: [
    {
      name: '160-siege',
      run: `(async () => {
        window.__ui.reset();
        const S = await import('/src/world/store.ts');
        const now = S.worldNow();
        const H = 3600000;
        window.__game.getState().act((st) => { st.army.clubman = 30; st.army.archer = 12; st.army.spearman = 8; });
        S.useWorld.setState({
          pulse: async () => {},
          loadCamp: async () => {},
          siege: {
            byId: 'l-1', byName: 'Волчья падь', since: now - 5 * H, starvesAt: now + 14 * H, garrison: 50, foodAtStart: 900,
            campMen: 120, builders: 120, fate: 'plunder', palisade: 2,
            fall: { goods: 640, gold: 80, hidden: 60, ledBonded: 0, ledPop: 0, scatterPop: 0, scatterBonded: 0, buildings: 3, levels: 1, burnsWorks: false, routed: 0 },
            fire: { thin: 0.06, cap: 0.2, slow: 0.15 },
            phases: { journal: ['Фаза 2: кость 9 + 1 — пролом.', 'Фаза 1: кость 5 — стена держит.'], next: '+1 пролом, −2 стена', nextAt: now + 1.5 * H, nextK: 3, breaches: 1, progress: 2 },
            answers: { repair: { cost: { wood: 80, stone: 40 }, reason: null, doneAt: null }, ration: { on: false, starvesAt: now + 20 * H }, surrender: 'captives', burn: [{ machine: 'ram', name: 'Таран', ready: true, guard: 40 }], reliefs: [], defend: { repair: true } },
            parley: { side: 'def', share: 0.32, fair: 210, block: null, bot: true },
          },
        });
        window.__game.getState().openSiege();
        return JSON.stringify('ok');
      })()`,
      wait: 1200,
      full: true,
      tabs: true,
    },
    { name: '161-siege-end', run: `(() => { const e = window.__ui.scroller(); if (!e) return JSON.stringify('нет окна'); e.scrollTop = e.scrollHeight; return JSON.stringify('ok'); })()`, wait: 600 },
    { name: '162-sortie', run: `(() => { window.__game.getState().openSortie(); return JSON.stringify('ok'); })()`, wait: 1000, full: true },
    {
      name: '163-camp',
      run: `(async () => {
        const S = await import('/src/world/store.ts');
        const now = S.worldNow();
        const H = 3600000;
        S.useWorld.setState({
          camp: {
            byId: 'home', byName: 'Наша дружина', since: now - 6 * H, starvesAt: now + 11 * H, foodAtStart: 700, campMen: 90, builders: 90,
            fate: 'plunder', targetId: 'l-2', targetName: 'Чёрный яр', castle: false, lair: true, stage: 'stronghold',
            garrison: { value: 60, min: 50, max: 70, precision: 'rough' }, power: { value: 5000, min: 4200, max: 5800, precision: 'rough' },
            fates: [
              { id: 'plunder', can: true, reason: null, led: { min: 0, max: 0 }, less: { min: 0, max: 0 } },
              { id: 'captives', can: true, reason: null, led: { min: 4, max: 8 }, less: { min: 30, max: 60 } },
              { id: 'burn', can: true, reason: null, led: { min: 0, max: 0 }, less: { min: 0, max: 0 } },
            ],
            men: 90, storm: { price: 30, block: null },
            phases: { journal: ['Фаза 1: кость 8 — пролом.'], next: '+1 пролом', nextAt: now + 2 * H, nextK: 2, breaches: 1, progress: 1, orders: { volley: true, storm: 2 } },
            crafts: [
              { act: 'fortify', name: 'укрепить лагерь', done: 1, max: 3, gain: 'Вылазка из города слабее на грань.', energy: { price: 10, block: null }, can: true, reason: null },
              { act: 'bombard', name: 'обстрел города', done: 0, max: 4, gain: 'Гарнизон слабее на 5 %.', energy: { price: 10, block: null }, can: true, reason: null },
            ],
            machines: {
              share: 0.25, walls: true, breaches: 1,
              list: [
                { id: 'ladders', name: 'Лестницы', use: 'Треть стены без пролома.', wood: 0.2, state: 'ready', can: false, reason: 'Уже стоят' },
                { id: 'ram', name: 'Таран', use: 'Ворота в первую минуту штурма.', wood: 0.5, state: 'building', readyAt: now + 3 * H, can: false, reason: 'Строится' },
              ],
              methods: [{ machine: 'ladders', words: 'Лестницы — треть стены без пролома' }],
            },
            parley: { side: 'atk', share: 0.4, terms: ['captives'], block: null, bot: true },
          },
        });
        window.__game.getState().openCamp();
        return JSON.stringify('ok');
      })()`,
      wait: 1200,
      full: true,
      tabs: true,
    },
    { name: '164-camp-end', run: `(() => { const e = window.__ui.scroller(); if (!e) return JSON.stringify('нет окна'); e.scrollTop = e.scrollHeight; return JSON.stringify('ok'); })()`, wait: 600 },
  ],
  // UI-8 (docs/ui_v2.md, 5.7): решения владельца по 6.1–6.23 и оставшиеся дубли. Город — ячейки запасов (6.3); ратуша —
  // группы порядком «Группы» («Город», мастерская — «Сырьё»), лист самой ратуши в её окне (Д4) и лист стройки (Д5);
  // ярлык у лесов (Д5); подсказка новичку «Найми дружину» на кнопке «Дружина» (Д1).
  ui8a: [
    { name: '170-city', run: ui('reset()'), wait: 1500 },
    {
      name: '171-hall-groups',
      run: `(async () => {
        window.__ui.reset();
        const A = await import('/src/game/sim/actions.ts');
        const g = window.__game.getState();
        g.act((st) => A.startUpgrade(st, st.buildings.find((x) => x.type === 'houses').id));
        (await import('/src/ui/next/HallBuild.tsx')).useHallView.getState().setSort('group');
        return JSON.stringify(window.__ui.click('Ратуша', '.nx-nav'));
      })()`,
      wait: 1200,
      full: true,
    },
    { name: '172-hall-own', run: ui(`clickSel('.sheet.open [data-tut="list-town_hall"]')`), wait: 900 },
    { name: '173-hall-site', run: then(`window.__ui.clickSel('.hall-veil')`, `window.__ui.clickSel('.sheet.open [data-tut="list-houses"]')`), wait: 900 },
    { name: '174-site-tag', run: ui('reset()'), wait: 2500 },
    {
      name: '175-hint-army',
      run: `(async () => {
        window.__ui.reset();
        const H = await import('/src/ui/next/Hints.tsx');
        const D = await import('/src/game/data/hints.ts');
        const T = await import('/src/ui/next/tip.ts');
        const el = document.querySelector('[data-tut="nav-army"]');
        if (!el) return JSON.stringify('нет кнопки «Дружина»');
        T.useTip.getState().show(T.rectOf(el), H.hintTip(D.HINTS.find((h) => h.id === 'army')));
        return JSON.stringify('ok');
      })()`,
      wait: 700,
    },
  ],
  // UI-8: окна построек с дублями — двор с промыслом (Д6), Статуя (Д7), казармы (Д8), храм (Д10), Дозор (Д11) — и
  // «Что даёт городу» у построек без своего раздела (дома, кузница).
  ui8b: [
    { ...building('gathering', '180-gathering'), full: true, tabs: false },
    { ...building('statue', '181-statue'), full: true, tabs: false },
    { ...building('barracks', '182-barracks'), full: true, tabs: false },
    { name: '182-barracks-end', run: END, wait: 600 },
    { ...building('church', '183-church'), full: true, tabs: false },
    { name: '183-church-end', run: END, wait: 600 },
    { ...building('watch', '184-watch'), full: true, tabs: false },
    { name: '184-watch-end', run: END, wait: 600 },
    { ...building('houses', '185-houses'), full: true, tabs: false },
    { ...building('smithy', '186-smithy'), full: true, tabs: false },
  ],
  // UI-8: «Мораль» (Д13), «Порядок» с невольниками — вкладками «Надзор | Невольники» (6.13), строка полководца без отряда в
  // «Дружине» и её подсказка (6.10).
  ui8c: [
    { name: '190-morale', run: tab('morale'), wait: 900, full: true },
    { name: '191-morale-end', run: END, wait: 600 },
    {
      name: '192-order',
      run: `(() => {
        window.__ui.reset();
        const g = window.__game.getState();
        g.act((st) => { st.bonded = 12; st.bondedWork[st.buildings.find((b) => b.type === 'farm').id] = 5; });
        window.__game.getState().openTab('order');
        return JSON.stringify('ok');
      })()`,
      wait: 900,
      full: true,
      tabs: true,
    },
    { name: '193-order-end', run: END, wait: 600 },
    {
      name: '194-army-general',
      run: `(async () => {
        window.__ui.reset();
        window.__game.getState().act((st) => { st.army.clubman = 30; st.army.archer = 10; });
        await (await import('/src/world/store.ts')).useWorld.getState().pulse();
        window.__game.getState().openTab('army');
        return JSON.stringify('ok');
      })()`,
      wait: 1200,
      full: true,
    },
    { name: '195-army-general-tip', run: ui(`clickSel('.sheet.open .ms > .kit-row.tip, .sheet.open .ms > .kit-row .kit-row-tip')`), wait: 600 },
  ],
  // П-7 (docs/polish.md): тревоги войны — значки справа снизу вместо плашки осады. Вид мира вкладывает стенд, как в заходе
  // `siege`: пульс остановлен, осада, набеги и свой лагерь — полями пульса. `DIR=polish TAG=before|after`.
  p7: [
    { name: 'p7-01-city-siege', run: P7('calm'), wait: 1500 },
    { name: 'p7-02-city-urgent', run: P7('urgent'), wait: 1500 },
    { name: 'p7-03-map-siege', run: `(async () => { ${P7_BODY('urgent', false)} window.__game.getState().openMap(); return JSON.stringify('ok'); })()`, wait: 6000 },
    {
      name: 'p7-04-siege-window',
      run: `(async () => { ${P7_BODY('calm', false)} await new Promise((r) => setTimeout(r, 600)); const b = document.querySelector('.nx-sign.siege, .siege-open'); if (!b) return JSON.stringify('нет входа в осаду'); b.click(); return JSON.stringify('ok'); })()`,
      wait: 1200,
    },
    { name: 'p7-05-city-free', run: `(async () => { window.__ui.reset(); const S = await import('/src/world/store.ts'); S.useWorld.setState({ siege: null, camp: null, marches: [] }); return JSON.stringify('ok'); })()`, wait: 1200 },
  ],
  misc: [
    // Плашка алмазов с UI-3 открывает подсказку, а не окно (docs/ui_v2.md, 5.2): окно — его хранилищем.
    { name: '70-treasury', run: `(async () => { window.__ui.reset(); (await import('/src/ui/treasury.ts')).useTreasury.getState().show(); return JSON.stringify('ok'); })()`, wait: 1200, tabs: true },
    { name: '71-trades', run: `(async () => { window.__ui.reset(); (await import('/src/ui/trades.ts')).useTrades.getState().show(); return JSON.stringify('ok'); })()`, wait: 1200 },
    { name: '72-season', run: tab('season'), wait: 900 },
    { name: '73-pop', run: tab('pop'), wait: 900 },
    { name: '74-morale', run: tab('morale'), wait: 900 },
    { name: '75-troop-card', run: `(async () => { window.__ui.reset(); window.__game.getState().openTab('army'); await new Promise((r) => setTimeout(r, 700)); const c = document.querySelector('.sheet.open button[aria-label$=": карточка вида"]'); if (!c) return JSON.stringify('нет карточки вида'); c.click(); return JSON.stringify('ok'); })()`, wait: 900 },
    // С UI-4 передача — в самой «Дружине» (заход `army`); прежнее окно «Раскладка» за строкой снято.
    { name: '76-muster', run: `(async () => { window.__ui.reset(); await new Promise((r) => setTimeout(r, 500)); window.__game.getState().openTab('army'); return JSON.stringify('ok'); })()`, wait: 1200 },
  ],
};

// ---------- съёмка ----------

async function snap(tab: Tab, name: string): Promise<void> {
  const png = await tab.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  const jpg = await sharp(Buffer.from(png.data, 'base64')).jpeg({ quality: 70, mozjpeg: true }).toBuffer();
  await writeFile(join(OUT, `${name}${TAG ? `-${TAG}` : ''}.jpg`), jpg);
}

/**
 * Шторку — во всю высоту: рывок за хэндл вверх событиями указателя на самой странице (`ui/Sheet`: скорость вверх больше
 * порога — ступень 85 %). Рывок мышью отладчика (`Input.dispatchMouseEvent`) шторку в виде телефона не поднял.
 */
async function pullUp(tab: Tab): Promise<void> {
  await tab
    .eval<string>(
      `(async () => {
        const grab = document.querySelector('.sheet.open .sheet-grab');
        if (!grab) return JSON.stringify('нет шторки');
        const r = grab.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        const ev = (type, dy) => grab.dispatchEvent(new PointerEvent(type, { pointerId: 7, isPrimary: true, bubbles: true, clientX: x, clientY: y - dy }));
        ev('pointerdown', 0);
        for (const dy of [40, 120, 240]) {
          await new Promise((res) => setTimeout(res, 16));
          ev('pointermove', dy);
        }
        ev('pointerup', 240);
        return JSON.stringify('ok');
      })()`,
    )
    .catch(() => 'нет');
  await sleep(700);
}

async function measure(tab: Tab): Promise<string> {
  const m = await tab.eval<{ h: number; box: number; screens: number } | null>(ui('measure()')).catch(() => null);
  return m ? `экранов ${m.screens} (прокрутка ${m.h} из ${m.box} px)` : 'окна нет';
}

/** Вкладки открытого окна — шторки, державы или сокровищницы, — кроме выбранной: она уже на снимке шага. */
const TAB_SEL = `.sheet.open [role=tab], .nx-realm [role=tab], .sheet.open .tabs button, .sheet.open .nx-tabs button, .wm-legend [role=tab]`;
const TABS = `JSON.stringify([...document.querySelectorAll('${TAB_SEL}')].map((b, i) => (b.getAttribute('aria-selected') === 'true' || b.classList.contains('on') || b.classList.contains('active') ? -1 : i)).filter((i) => i >= 0))`;
const TAB_CLICK = (i: number): string =>
  `(() => { const b = [...document.querySelectorAll('${TAB_SEL}')][${i}]; if (!b) return JSON.stringify('нет'); b.click(); return JSON.stringify((b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 24)); })()`;

async function group(name: string, steps: Step[]): Promise<void> {
  const tab = await Tab.open(DEBUG_PORT, 'about:blank');
  const began = Date.now();
  try {
    await tab.send('Emulation.setDeviceMetricsOverride', SCREEN);
    await tab.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?probe=1&fpscap=${FPS}&quality=low` });
    await sleep(1500);
    await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} return JSON.stringify("ok"); })()');
    await tab.send('Page.reload');
    let up = false;
    for (let i = 0; i < 150 && !up; i++) {
      await sleep(300);
      up = await tab.eval<boolean>('JSON.stringify(!!(window.__game && document.querySelector(".start-go, .start")))').catch(() => false);
    }
    if (!up) throw new Error('стартовый экран не встал за 45 с');
    if (name === 'city') {
      await sleep(1200);
      await snap(tab, '00-start');
      console.log('  00-start');
    }
    console.log(`  вход: ${await tab.eval<string>(ENTER_GAME)}`);
    await sleep(2500);
    // Обучение снято и вести не приходят: затемнение обучения и окно вести — не вид экрана, который снимаем.
    await tab.eval<string>(`(() => {
      const st = document.createElement('style');
      st.textContent = '.trouble { display: none !important; }';
      document.head.appendChild(st);
      const s = window.__game.getState().s;
      s.tutorialDone = true;
      s.winterWarning = false;
      window.__game.setState({ s: { ...s } });
      return JSON.stringify('ok');
    })()`);
    await tab.eval<string>(HELPERS);
    for (const step of steps) {
      if (Date.now() - began > BROWSER_MAX_MS - 8000) {
        console.log(`  срок захода (${BROWSER_MAX_MS / 1000} с) вышел — не сняты: ${steps.slice(steps.indexOf(step)).map((s) => s.name).join(', ')}`);
        break;
      }
      const said = step.run ? await tab.eval<unknown>(step.run).catch((e: Error) => `ошибка: ${e.message}`) : 'ok';
      await sleep(step.wait ?? 600);
      if (step.full) await pullUp(tab);
      if (step.shot === false) continue;
      await snap(tab, step.name);
      console.log(`  ${step.name}: ${said === 'ok' ? '' : `${String(said)}; `}${await measure(tab)}`);
      if (!step.tabs) continue;
      const tabs = await tab.eval<number[]>(TABS).catch(() => []);
      for (const i of tabs) {
        const label = await tab.eval<string>(TAB_CLICK(i));
        await sleep(700);
        const shot = `${step.name}-t${i}`;
        await snap(tab, shot);
        console.log(`  ${shot} «${label}»: ${await measure(tab)}`);
      }
    }
  } finally {
    tab.close();
    await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const name = process.env.GROUP;
  if (!name || !GROUPS[name]) {
    console.log(`Заходы: ${Object.keys(GROUPS).join(', ')}. Один заход — GROUP=<имя>.`);
    return;
  }
  refuseIfBusy('Снимки интерфейса');
  await mkdir(OUT, { recursive: true });
  const vite = await createVite({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  try {
    console.log(`\n=== интерфейс: заход ${name} (390×844 @2, потолок ${FPS} кадр/с) ===\n`);
    await gpuCoolDown('снимками интерфейса');
    const root = process.getuid?.() === 0 ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [];
    const chrome = await launchChrome(DEBUG_PORT, ['--use-gl=angle', '--window-size=500,900', ...root]);
    try {
      await group(name, GROUPS[name]);
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
