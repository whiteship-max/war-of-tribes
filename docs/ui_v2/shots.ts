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
//   DIR=city_v3 GROUP=g5 TAG=before|after …       — Г-5 (docs/city_v3.md): подсказка с разбором над окном ратуши и её крестик
//   DIR=feedback GROUP=fb1 TAG=before|after …       — ОТ-1 (docs/feedback.md): «Дружина», найм из карточки, ряд рабочих,
//                                                     шаг разведчика, полководец на дороге набега
//   GROUP=or1 WEATHER=clear TAG=before|after …     — ОР-1: подписи построек, «Показать в городе», метки и «Домой»;
//                                                     `WEATHER` — погода адресом (`?weather=`), чтобы туман не съел подписи
//   DIR=icons GROUP=zn4 WEATHER=clear TAG=after …  — ЗН-4: подписи у середины приближения, рычаг, окно «Профиль», держава
//   GROUP=dp1 …                                    — ДП-1 (docs/AGENTS.md, 17): «Соседи» — поход на нас, предложение
//                                                   с «Принять/Отклонить», наше ждущее, итог; карточка; летопись.
//   GROUP=st1 TAG=after …                          — СТ-1 (docs/ui_v2.md, 5.13): очередь стройки — сетка с номерами, полоса,
//                                                    дела места, отмена ждущего и строящегося с возвратом, сдвиг
//   GROUP=sb1 …                                    — СБ-1 (docs/stability.md): «Стабильность» — спокойно, шатко, мятеж близок
//                                                    (верх и низ), мятеж
//   GROUP=sb2 …                                    — СБ-2 (docs/stability.md, «СБ-2»): вести державы — заставка, текст,
//                                                    ответы и «что изменится» у раскрытого ответа; итог ответа
//   GROUP=sb2b …                                   — СБ-2б: ряд державы со «Стабильностью» на месте «Заданий», ячейка
//                                                    «Задания» в строке очков, раздел стабильности, раздел заданий
//   GROUP=k2 …                                     — К-2 (docs/AGENTS.md, 18): кольцо над логовом, дела, окно войска,
//                                                    подтверждение, погашенный с причиной
//   GROUP=r4 …                                     — Р-4 (docs/AGENTS.md, 16): «Походы», цель, дела, подтверждение,
//                                                    донесение, знак павшего города словами
//   GROUP=os1 …                                    — ОС-1 (docs/siege_v2.md, 23): окно осады защитника при трёх
//                                                    соотношениях сил — штраф к добыче с причиной и «хлеба хватит на ~N ч»
//   GROUP=au3 …                                    — АУ-3, ECO-1 (docs/audit/OWNER-DECISIONS.md, п. 1): окно «Склад
//                                                    заполнен» — отмена стройки, ответ на весть, «Начать» промысла;
//                                                    строка «Склад повреждён» в летописи
//   GROUP=pn1 WEATHER=clear NIGHT=0 …              — ПН-00 (docs/gdd/path_of_sword.md, 3.5.7): карта — вид открытия, весь
//                                                    регион (дальний вид ограничителя), кромка знания и пергамент;
//                                                    `NIGHT` — ночь карты адресом (`?night=`), 0 — день
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

/**
 * ОС-1: окно осады защитника при соотношении `ratio` (лагерь к гарнизону). Штраф кладётся партии полем осады (как мост), срок
 * хлеба — прогноз племени под ним (`derived.siegeDryIn`), строки пишет окно дверью хлеба (`siegewords`).
 */
function os1(ratio: number): string {
  return `(async () => {
    window.__ui.reset();
    const S = await import('/src/world/store.ts');
    const F = await import('/src/world/siegefood.ts');
    const D = await import('/src/game/derived.ts');
    const P = await import('/src/game/pace.ts');
    const now = S.worldNow();
    const H = 3600000;
    const ratio = ${ratio};
    const cut = F.siegeCut(ratio);
    window.__game.getState().act((st) => {
      st.army.clubman = 30; st.army.archer = 12; st.army.spearman = 8;
      st.siege = { byName: 'Волчья падь', until: Number.MAX_SAFE_INTEGER, cut };
      return null;
    });
    const s = window.__game.getState().s;
    const ahead = D.siegeDryIn(s);
    const dryAt = Number.isFinite(ahead) ? now + P.realMs(ahead) : undefined;
    S.useWorld.setState({
      pulse: async () => {},
      loadCamp: async () => {},
      siege: {
        byId: 'l-1', byName: 'Волчья падь', since: now - 5 * H, starvesAt: dryAt ?? now + 2 * H, garrison: 50, foodAtStart: Math.floor(s.resources.food),
        bread: Math.floor(s.resources.food), cut, ratio, ...(dryAt !== undefined ? { dryAt } : {}),
        campMen: Math.round(50 * ratio), builders: Math.round(50 * ratio), fate: 'plunder', palisade: 2,
        fall: { goods: 640, gold: 80, hidden: 60, ledBonded: 0, ledPop: 0, scatterPop: 0, scatterBonded: 0, buildings: 3, levels: 1, burnsWorks: false, routed: 0 },
        phases: { journal: ['Ф1 · кость 5 − 1 стена = 4 · без перемен · из лагеря ушло 3 %'], next: '−1 стена', nextAt: now + 1.5 * H, nextK: 2, breaches: 0, progress: 0 },
        answers: { repair: { cost: { wood: 80, stone: 40 }, reason: 'Проломов нет, заделывать нечего.', doneAt: null }, ration: { on: false, starvesAt: dryAt ?? now + 2 * H }, surrender: 'captives', burn: [], reliefs: [] },
        parley: { side: 'def', share: 0.12, fair: 120, block: null, bot: true },
      },
    });
    window.__game.getState().openSiege();
    return JSON.stringify('штраф ' + cut.toFixed(3) + ', хлеба на ' + (Number.isFinite(ahead) ? (P.realMs(ahead) / H).toFixed(1) + ' ч' : 'не кончится'));
  })()`;
}

/**
 * К-2: ближайшее живое логово у дома — к середине экрана (`__mapCam`), дружине — бойцы в гарнизоне, и касание клетки
 * тем же путём, что у пальца (`__mapTap` → `WorldMap.openAt`).
 */
const K2_TAP_BODY = `
  const S = await import('/src/world/store.ts');
  const st = window.__game.getState();
  if (!st.s.army || !Object.values(st.s.army).some((n) => n > 0)) {
    st.s.army = { spearman: 60, archer: 30, legionary: 20 };
    window.__game.setState({ s: { ...st.s } });
  }
  if (!document.querySelector('.worldmap')) {
    st.openMap();
    await new Promise((r) => setTimeout(r, 3000));
  }
  await S.useWorld.getState().pulse();
  const C = await import('/src/world/cache.ts');
  const home = S.useWorld.getState().info.home;
  const d = (a) => Math.hypot(a.x - home.x, a.y - home.y);
  const lair = C.loadedIn({ x: home.x - 30, y: home.y - 30, w: 60, h: 60 }).flatMap((c) => c.settlements)
    .filter((x) => !x.mine && !x.castle && !x.ruin && x.id !== S.useWorld.getState().info.homeId).sort((a, b) => d(a) - d(b))[0];
  window.__mapCam(lair.x, lair.y, 56);
  await new Promise((r) => setTimeout(r, 900));
  window.__mapTap(lair.x, lair.y);
  await new Promise((r) => setTimeout(r, 1200));
`;
const K2_TAP = `(async () => {
  window.__ui.reset();
  ${K2_TAP_BODY}
  const ring = (await import('/src/world/store.ts')).useWorld.getState().ring;
  return JSON.stringify(ring ? 'кольцо: ' + ring.name : 'кольца нет');
})()`;

/**
 * Положение стабильности для снимков СБ-1: ступень, сдвиг, полосы, смены ступени (игровые дни от сейчас) и рычаги партии
 * (налог, указ, паёк, хлеб, весть на стол) — затем раздел «Стабильность». `seen` — подсказка первого открытия уже показана;
 * `scroll` — прокрутить раздел вниз на столько пикселей.
 */
function sb1(level: number, drift: number, st: Record<string, unknown>, set: Record<string, unknown>, seen = true, scroll = 0): string {
  return `(async () => {
    window.__ui.reset();
    const set = ${JSON.stringify(set)};
    const st = ${JSON.stringify(st)};
    window.__game.getState().act((s) => {
      if (set.tax) s.tax = set.tax;
      if (set.decree) s.decree = set.decree;
      if (set.ration) s.ration = set.ration;
      if (set.food !== undefined) s.resources.food = set.food;
      if (set.pop !== undefined) s.pop = set.pop;
      s.stab = { level: ${level}, drift: ${drift}, folk: st.folk, hungry: st.hungry, past: (st.past ?? []).map(([d, l]) => [s.time + d * 60, l]),
        bought: 0, spent: 0, revolts: st.revolts ?? 0, held: 0, ...(st.revolt ? { revolt: st.revolt } : {}) };
      s.hints = { seen: ${seen} ? ['stability', 'revolt', 'upgrade', 'army', 'neighbors', 'march', 'games'] : ['revolt', 'upgrade', 'army', 'neighbors', 'march', 'games'] };
      if (set.raise) s.inbox = [{ defId: set.raise, at: s.time, until: Date.now() + 20 * 3600 * 1000 }];
      // Строки летописи стабильности — по сменам ступени, теми словами, что пишет шаг (\`data/stability.STAB_LOG\`).
      const names = { '-3': 'Смута', '-2': 'Раздор', '-1': 'Шатко', '0': 'Мир', '1': 'Лад', '2': 'Достаток', '3': 'Благоденствие' };
      const up = (i, a) => a[i][1] > (i > 0 ? a[i - 1][1] : 0);
      const lines = (st.past ?? []).map(([d, l], i, a) => ({ at: s.time + d * 60, text: 'Стабильность: ' + names[l] + '. ' + (up(i, a) ? 'Тихие дни сделали своё.' : 'Недовольство взяло своё.'), kind: up(i, a) ? 'good' : 'bad', topic: 'stab' }));
      s.log = [...lines.reverse(), ...s.log.filter((e) => e.topic !== 'stab')];
      return null;
    });
    (await import('/src/ui/realm/open.ts')).useRealm.getState().show('stability');
    await new Promise((r) => setTimeout(r, 700));
    document.querySelector('.nx-rbody')?.scrollTo(0, ${scroll});
    return JSON.stringify('ok');
  })()`;
}

/**
 * Весть державы на столе (СБ-2): партия под условие вести (`set` — вера, святыня, налог, люди, золото), весть ложится на стол
 * и открывается в «Вестях»; `pick` — номер ответа, который раскрыт («что изменится»), прокрученный к середине экрана.
 */
/** Окно «Игра открыта дважды» стенда (свой же прошлый шаг под потолком кадров): вести партию здесь. */
const STAY = `[...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('Продолжить здесь'))?.click();`;

function sb2(defId: string, set: Record<string, unknown>, pick: number | null): string {
  return `(async () => {
    ${STAY}
    window.__ui.reset();
    const set = ${JSON.stringify(set)};
    let ev = null;
    window.__game.getState().act((s) => {
      if (set.faith) s.faith.id = set.faith;
      if (set.relic) s.faith.relic = set.faith;
      if (set.tax) s.tax = set.tax;
      if (set.pop !== undefined) s.pop = set.pop;
      if (set.gold !== undefined) s.gold = set.gold;
      if (set.stab) s.stab = { level: set.stab[0], drift: set.stab[1], folk: 20, hungry: 0, past: [], bought: 0, spent: 0, revolts: 0, held: 0 };
      s.hints = { seen: ['stability', 'revolt', 'upgrade', 'army', 'neighbors', 'march', 'games'] };
      ev = { defId: ${JSON.stringify(defId)}, at: s.time, until: Date.now() + 20 * 3600 * 1000 };
      s.inbox = [ev];
      return null;
    });
    const R = (await import('/src/ui/realm/open.ts')).useRealm;
    R.getState().show('decisions');
    await new Promise((r) => setTimeout(r, 300));
    R.getState().openMail((await import('/src/ui/realm/unread.ts')).eventKey(ev));
    await new Promise((r) => setTimeout(r, 500));
    const pick = ${JSON.stringify(pick)};
    if (pick !== null) {
      document.querySelectorAll('.cr-pick')[pick]?.click();
      await new Promise((r) => setTimeout(r, 300));
      document.querySelector('.cr-opt.on')?.scrollIntoView({ block: 'center' });
    }
    return JSON.stringify('ok');
  })()`;
}

/**
 * Держава на разделе `view` (СБ-2б): печатает, какие подписи ряда обрезаны (ширина подписи больше ячейки) — «все видны», если
 * ни одной. `cell` — открыть раздел касанием ячейки «Задания».
 */
function sb2b(view: string, cell = false): string {
  return `(async () => {
    ${STAY}
    window.__ui.reset();
    window.__game.getState().act((s) => {
      s.hints = { seen: ['stability', 'revolt', 'upgrade', 'army', 'neighbors', 'march', 'games'] };
      s.stab = { level: 1, drift: 30, folk: 36, hungry: 0, past: [[s.time - 3000, 1]], bought: 0, spent: 0, revolts: 0, held: 0 };
      return null;
    });
    const R = (await import('/src/ui/realm/open.ts')).useRealm;
    R.getState().show(${JSON.stringify(cell ? 'lineage' : view)});
    await new Promise((r) => setTimeout(r, 500));
    if (${cell}) {
      document.querySelector('[data-tut="realm-quests"]')?.click();
      await new Promise((r) => setTimeout(r, 400));
    }
    const cut = [...document.querySelectorAll('.nx-rtabs button > span:last-child')].filter((e) => e.scrollWidth > e.clientWidth + 0.5).map((e) => e.textContent);
    const w = [...document.querySelectorAll('.nx-rtabs button')].map((b) => Math.round(b.getBoundingClientRect().width)).join('/');
    return JSON.stringify(cut.length ? 'обрезаны: ' + cut.join(', ') + ' (' + w + ')' : 'подписи все видны (' + w + ')');
  })()`;
}

/**
 * ПН-00: карта на масштабе `scale` над своим домом (`__mapCam`, тот же `hold`, что у пальца); null — вид открытия карты.
 * Печатает, дальний ли вид у кадра (`tw/far.farFrame`) и масштаб, до которого пустила рамка региона.
 */
function mapAt(scale: number | null): string {
  return `(async () => {
    // Окно «Игра открыта дважды» (свой прошлый шаг стенда): «Оставить там» прячет его без перезагрузки — «Продолжить здесь»
    // перезагрузил бы страницу посреди захода, и помощники стенда пропали бы.
    [...document.querySelectorAll('.modal button')].find((b) => b.textContent.includes('Оставить там'))?.click();
    window.__ui.reset();
    window.__game.getState().openMap();
    await new Promise((r) => setTimeout(r, 2500));
    const home = (await import('/src/world/store.ts')).useWorld.getState().info?.home;
    if (!home) return JSON.stringify('мира нет');
    if (${scale !== null}) window.__mapCam(home.x, home.y, ${scale ?? 0});
    await new Promise((r) => setTimeout(r, 600));
    const far = (await import('/src/ui/map/tw/far.ts')).farFrame();
    return JSON.stringify('дом ' + home.x + '|' + home.y + (far ? ', дальний вид' : ', подробный вид'));
  })()`;
}

const GROUPS: Record<string, Step[]> = {
  // ПН-00 (docs/gdd/path_of_sword.md, 3.5.7): камера без поводка — вид открытия, карта, отдалённая до всего региона (дальний
  // вид ограничителя `tw/far.ts`), и терра инкогнита — пергамент без рельефа за кромкой круга обзора дома.
  pn1: [
    { name: 'pn1-map-start', run: mapAt(null), wait: 5000 },
    { name: 'pn1-map-far', run: mapAt(3.5), wait: 5000 },
    { name: 'pn1-terra', run: mapAt(18), wait: 5000 },
  ],
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
  // СТ-1 (docs/ui_v2.md, 5.13): очередь стройки. Склад наполняется, в очередь встают четыре улучшения; первое начинается
  // само с ходом партии. Снимки: сетка с номерами и полосой, выбранное ждущее с делами (отмена — вся цена), строящееся
  // (отмена — половина), сдвиг.
  st1: [
    {
      name: 'st1-01-grid',
      run: `(async () => {
        window.__ui.reset();
        const A = await import('/src/game/sim/actions.ts');
        const D = await import('/src/game/derived.ts');
        const g = window.__game.getState();
        g.act((st) => {
          const cap = D.storageCap(st);
          for (const r of Object.keys(st.resources)) st.resources[r] = cap;
          for (const t of ['houses', 'farm', 'barracks', 'sawmill']) A.startUpgrade(st, st.buildings.find((x) => x.type === t).id);
          return null;
        });
        await new Promise((r) => setTimeout(r, 1500));
        return JSON.stringify(window.__ui.click('Ратуша', '.nx-nav'));
      })()`,
      wait: 1200,
      full: true,
    },
    { name: 'st1-02-pick', run: ui(`clickSel('.sheet.open .hall-qcell:nth-child(2)')`), wait: 700, full: true },
    // Отмена строящегося — половина цены; у ждущего (снимок выше) — вся.
    { name: 'st1-03-cancel', run: ui(`clickSel('.sheet.open .hall-qcell:nth-child(1)')`), wait: 700 },
    {
      name: 'st1-04-moved',
      run: then(`window.__ui.clickSel('.sheet.open .hall-qcell:nth-child(4)')`, `window.__ui.click('Выше', '.sheet.open .hall-qacts')`),
      wait: 700,
      full: true,
    },
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
  // Г-5 (docs/city_v3.md): подсказка с разбором числа над открытым окном — у плашки свой крестик в углу, окно под ней своё.
  g5: [{ name: '110-g5-tip', run: then(`(window.__ui.reset(), window.__ui.click('Ратуша', '.nx-nav'))`, `window.__ui.click('Еда', '.nx-res')`), wait: 900 }],
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
  // ДП-1 (docs/AGENTS.md, 17): предложения соседей в «Вестях» → «Соседи». Мир соседей — подставной (сервера войны у стенда
  // нет): поход на нас, предложение нам, наше ждущее и итог; ответ — подменённой дверью, которая кладёт итог, как сервер.
  dp1: [
    {
      name: 'dp1-01-neighbours',
      run: `(async () => {
        window.__ui.reset();
        const S = await import('/src/world/store.ts');
        const now = S.worldNow();
        const H = 3600000;
        const rivals = {
          marching: [{ id: 'w-dp1', castle: 'c-3', city: 'Сухая балка', mode: 'siege', arriveAt: now + 2.5 * H }],
          proposals: [
            { id: 'c-1.dp1', kind: 'pact', side: 'in', castle: 'c-1', city: 'НиСы', at: now - 0.5 * H, until: now + 23.5 * H },
            { id: 'c-me.dp1', kind: 'pact', side: 'out', castle: 'c-2', city: 'Каменный яр', at: now - 2 * H, until: now + 22 * H },
            { id: 'c-4.dp1', kind: 'pact', side: 'in', castle: 'c-4', city: 'Ольховка', at: now - 30 * H, until: now - 6 * H, end: 'expired', endAt: now - 6 * H },
          ],
        };
        S.useWorld.setState({
          pulse: async () => {},
          loadRivals: async () => {},
          rivals,
          letters: [],
          answerProposal: async (id, act) => {
            const r = S.useWorld.getState().rivals;
            const end = act === 'yes' ? 'yes' : act === 'no' ? 'no' : 'withdrawn';
            S.useWorld.setState({ rivals: { ...r, proposals: r.proposals.map((p) => (p.id === id ? { ...p, end, endAt: S.worldNow(), endBy: 'us' } : p)) } });
            return null;
          },
        });
        const R = (await import('/src/ui/realm/open.ts')).useRealm;
        R.getState().setMailTab('letter');
        R.getState().show('decisions');
        return JSON.stringify('ok');
      })()`,
      wait: 1200,
    },
    { name: 'dp1-02-card', run: `(async () => { (await import('/src/ui/realm/open.ts')).useRealm.getState().openMail('deal:c-1.dp1'); return JSON.stringify('ok'); })()`, wait: 900 },
    {
      name: 'dp1-03-declined',
      run: `(async () => { (await import('/src/ui/realm/open.ts')).useRealm.getState().openMail(null); await new Promise((r) => setTimeout(r, 300)); return JSON.stringify(window.__ui.click('Отклонить', '.mail-quick')); })()`,
      wait: 900,
    },
    {
      name: 'dp1-04-chronicle',
      run: `(async () => {
        const g = window.__game.getState();
        const at = g.s.time;
        g.act((st) => {
          st.log.unshift(
            { at, text: 'Мы отклонили предложение союза от «НиСы».', kind: 'info', ref: 'dip-c-1.dp1-no' },
            { at, text: 'Предложение союза от «Ольховка» осталось без ответа: срок вышел.', kind: 'info', ref: 'dip-c-4.dp1-expired' },
            { at, text: '«Сухая балка» идёт на нас походом — осадой.', kind: 'bad', ref: 'dip-war-w-dp1' },
          );
          return null;
        });
        (await import('/src/ui/realm/open.ts')).useRealm.getState().openChronicle();
        await new Promise((r) => setTimeout(r, 300));
        return JSON.stringify(window.__ui.click('Соседи', '.chron-chips'));
      })()`,
      wait: 900,
    },
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
        const B = await import('/src/world/blockade.ts');
        const Sh = await import('/src/world/shelling.ts');
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
            answers: {
              repair: { cost: { wood: 80, stone: 40 }, reason: null, doneAt: null }, ration: { on: false, starvesAt: now + 20 * H }, surrender: 'captives', burn: [{ machine: 'ram', name: 'Таран', ready: true, guard: 40 }], reliefs: [], defend: { repair: true },
              // Р-5: требушет на стене (строится) и вылазка на пост кольца — словами дверей обстрела и кольца.
              gun: { state: 'building', readyAt: now + 2 * H, cost: { wood: 80, stone: 40 }, span: 5 * H, can: false, reason: 'Требушет на стене уже строят.', aim: 'machines', options: [{ aim: 'camp', name: Sh.GUN_AIM_NAME.camp, gives: Sh.gunAimWords('camp') }, { aim: 'machines', name: Sh.GUN_AIM_NAME.machines, gives: Sh.gunAimWords('machines') }] },
              breakout: { guard: 30, gives: B.BREAKOUT_GIVES },
            },
            parley: { side: 'def', share: 0.32, fair: 210, block: null, bot: true },
            blockade: { on: true, since: now - 4 * H, ratio: '×5,2', need: 4, can: false, reason: null, gives: B.BLOCKADE_GIVES, breaks: B.BLOCKADE_BREAKS },
            idle: ['smithy'],
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
    // Р-5: «Ответы» до конца — требушет на стене (цена, срок, куда бьёт) и вылазка на пост кольца.
    {
      name: '166-answers-end',
      run: `(async () => { const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.includes('Ответы')); if (!t) return JSON.stringify('нет вкладки'); t.click(); await new Promise((r) => setTimeout(r, 400)); const e = window.__ui.scroller(); if (!e) return JSON.stringify('нет окна'); e.scrollTop = e.scrollHeight; return JSON.stringify('ok'); })()`,
      wait: 700,
    },
    { name: '162-sortie', run: `(() => { window.__game.getState().openSortie(); return JSON.stringify('ok'); })()`, wait: 1000, full: true },
    // Р-5: вылазка на пост кольца — тем же экраном вылазки.
    { name: '165-ring-sortie', run: `(() => { window.__game.getState().openSortie('ring'); return JSON.stringify('ok'); })()`, wait: 1000, full: true },
    {
      name: '163-camp',
      run: `(async () => {
        const S = await import('/src/world/store.ts');
        const B = await import('/src/world/blockade.ts');
        const Sh = await import('/src/world/shelling.ts');
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
                { id: 'trebuchet', name: 'Требушет', use: 'кость фазы +2 или два выстрела за фазу', wood: 0.5, state: 'ready', can: false, reason: 'Уже стоит' },
              ],
              methods: [{ machine: 'ladders', words: 'Лестницы — треть стены без пролома' }],
            },
            parley: { side: 'atk', share: 0.4, terms: ['captives'], block: null, bot: true },
            // Р-5: цель машин и кольцо — словами дверей обстрела и кольца; лагерю мощи на кольцо мало.
            aim: {
              now: 'wall',
              artillery: [{ id: 'trebuchet', name: 'Требушет', weight: 2 }],
              options: [
                { aim: 'wall', name: Sh.AIM_NAME.wall, gives: Sh.aimWords('wall', 2), can: false, reason: null },
                { aim: 'town', name: Sh.AIM_NAME.town, gives: Sh.aimWords('town', 2), can: false, reason: 'Построек у них нет — по городу бить нечего.' },
                { aim: 'engines', name: Sh.AIM_NAME.engines, gives: Sh.aimWords('engines', 2), can: false, reason: 'Стены у них нет — и машин на ней нет.' },
              ],
            },
            blockade: { on: false, ratio: '≈×3,1', need: 4, can: false, reason: 'Для кольца лагерь должен быть вчетверо сильнее гарнизона: сейчас ≈×3,1.', gives: B.BLOCKADE_GIVES, breaks: B.BLOCKADE_BREAKS },
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
    // Р-5: «Машины» до конца — цена в лесе и «Куда бьют машины».
    {
      name: '167-camp-machines-end',
      run: `(async () => { const t = [...document.querySelectorAll('[role=tab]')].find((x) => x.textContent.includes('Машины')); if (!t) return JSON.stringify('нет вкладки'); t.click(); await new Promise((r) => setTimeout(r, 400)); const e = window.__ui.scroller(); if (!e) return JSON.stringify('нет окна'); e.scrollTop = e.scrollHeight; return JSON.stringify('ok'); })()`,
      wait: 700,
    },
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
  // ОР-1 (docs/ui_v2.md, 5.9): ориентация в городе — метки того, что ждёт игрока, подписи ближних при приближении, рычаг
  // «Подписи», «Показать в городе» из ратуши и из подсказки, «Домой». На «до» кнопок ещё нет — шаги печатают «нет кнопки».
  or1: [
    { name: 'or1-01-city', run: ui('reset()'), wait: 2500 },
    { name: 'or1-02-near', run: `(() => { window.__ui.reset(); window.__scene.standView(0, -30, 150); return JSON.stringify('ok'); })()`, wait: 2500 },
    { name: 'or1-03-labels', run: ui(`reset(), window.__ui.click('Домой', '.nx-cam'), window.__ui.click('Подписи', '.nx-cam')`), wait: 2500 },
    {
      name: 'or1-04-hall-card',
      run: then(ui(`click('Подписи', '.nx-cam'), window.__ui.click('Ратуша', '.nx-nav')`), ui(`clickSel('.hall-tile[data-tut="list-farm"]')`)),
      wait: 1200,
    },
    { name: 'or1-05-show-farm', run: ui(`click('Показать в городе', '.hall-card')`), wait: 2000 },
    { name: 'or1-06-tip-food', run: ui(`reset(), window.__ui.click('Еда', '.nx-res')`), wait: 600 },
    { name: 'or1-07-show-tip', run: ui(`clickSel('.nx-tip-show')`), wait: 2000 },
    { name: 'or1-08-home', run: ui(`click('Домой', '.nx-cam')`), wait: 4000 },
  ],
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
  // ОТ-1 (docs/feedback.md): правки по отзывам тестеров — «до» и «после» на одной партии. Касание карты стенд повторяет
  // тем же, что делает `WorldMap.openAt` своей версии: у кода «до» (нет `raidAcross`) человек в руке по земле идёт сразу —
  // приказ и тост; у кода «после» разведчик и полководец на дороге набега открывают меню.
  fb1: [
    {
      name: '01-army',
      run: `(async () => {
        window.__ui.reset();
        const g = window.__game.getState();
        g.act((st) => { st.army.clubman = 40; st.army.archer = 16; st.army.spearman = 12; st.army.rider = 6; });
        const W = (await import('/src/world/store.ts')).useWorld.getState();
        await W.pulse();
        const err = await W.setGarrison({});
        await W.pulse();
        window.__game.getState().openTab('army');
        return JSON.stringify(err ?? 'ok');
      })()`,
      wait: 1200,
      full: true,
    },
    {
      name: '02-hire',
      run: `(async () => {
        window.__ui.reset();
        const T = await import('/src/game/data/troops.ts');
        window.__game.getState().openTab('army');
        await new Promise((r) => setTimeout(r, 700));
        const c = document.querySelector('.sheet.open button[aria-label="' + T.TROOP_BY_ID.spearman.name + ': карточка вида"]');
        if (!c) return JSON.stringify('нет карточки копейщиков');
        c.click();
        await new Promise((r) => setTimeout(r, 700));
        const r = window.__ui.click('⚔️ Нанять', '.sheet.open');
        // Найм — ниже окна казарм: прокрутить к выбранной строке вида (её и проверяем).
        await new Promise((res) => setTimeout(res, 1200));
        const on = document.querySelector('.sheet.open .nx-grow-row.on');
        if (on) on.scrollIntoView({ block: 'center' });
        return JSON.stringify(r === 'ok' ? 'выбран: ' + (on ? on.textContent.trim().slice(0, 24) : 'нет') : r);
      })()`,
      wait: 1500,
    },
    { name: '03-farm', run: ui(`reset(), window.__ui.building('farm')`), wait: 900 },
    {
      name: '04-scout',
      run: `(async () => {
        window.__ui.reset();
        window.__game.getState().openMap();
        await new Promise((r) => setTimeout(r, 4000));
        const S = await import('/src/world/store.ts');
        const C = await import('/src/world/cache.ts');
        const W = S.useWorld.getState();
        const h = W.info.home;
        let c = null;
        for (let d = 3; d < 9 && !c; d++) if (!C.settlementAt(h.x + d, h.y - 2)) c = { x: h.x + d, y: h.y - 2 };
        if (!c) return JSON.stringify('нет пустой клетки');
        if (typeof S.raidAcross === 'function') { await W.openMenu('scout', c); return JSON.stringify('меню'); }
        const err = await W.moveFigure('scout', c);
        window.__game.getState().showToast(err ?? 'Разведчик пошёл к ' + c.x + ':' + c.y + '.');
        return JSON.stringify('шаг сразу');
      })()`,
      wait: 1500,
    },
    {
      name: '05-raid-path',
      run: `(async () => {
        const S = await import('/src/world/store.ts');
        const A = await import('/src/world/api.ts');
        const W = S.useWorld.getState();
        W.closeMenu();
        const g = window.__game.getState();
        g.act((st) => { st.army.clubman = 40; st.army.archer = 16; st.army.spearman = 12; st.army.rider = 6; });
        await W.pulse();
        await W.setGarrison({ clubman: 20, archer: 8, spearman: 6 });
        const info = W.info;
        const now = S.worldNow();
        const h = info.home;
        A.worldApi().save.marches.push({
          id: 'raid-fb1', seed: 5, mission: 'raid', units: { warrior: 12 }, own: false, fromId: 'lair-fb1', targetId: info.homeId,
          from: { x: h.x + 9, y: h.y }, to: { x: h.x, y: h.y }, fromName: 'Волчья падь', toName: 'дом',
          departAt: now - 600000, arriveAt: now + 3000000, phase: 'out', power: 40, loot: null,
        });
        await W.pulse();
        const c = { x: h.x + 4, y: h.y };
        if (typeof S.raidAcross === 'function') { await W.openMenu('general', c); return JSON.stringify('меню, набегов на карте: ' + S.useWorld.getState().marches.length); }
        const err = await W.moveFigure('general', c);
        window.__game.getState().showToast(err ?? 'Полководец пошёл к ' + c.x + ':' + c.y + '.');
        return JSON.stringify('шаг сразу');
      })()`,
      wait: 2000,
    },
  ],
  // К-2 (docs/AGENTS.md, раздел 18): касание логова на карте — кольцо значков; меч — дела полководца; дело — окно войска;
  // глаз — дела разведчика и подтверждение; погашенный дипломат — причина касанием. Касание клетки — `openAt` пальца
  // (`__mapTap`, только под `?probe=1`).
  k2: [
    { name: 'k2-01-ring', run: K2_TAP, wait: 900 },
    {
      name: 'k2-02-deeds',
      run: `(async () => {
        const b = document.querySelector('.rg-btn[data-slot="general"]');
        if (!b) return JSON.stringify('нет меча');
        b.click();
        await new Promise((r) => setTimeout(r, 900));
        return JSON.stringify('дел ' + (((await import('/src/world/store.ts')).useWorld.getState().menu || {}).errands || []).length);
      })()`,
      wait: 700,
    },
    {
      name: 'k2-03-army',
      run: `(async () => {
        const b = [...document.querySelectorAll('.nx-am .nx-obtn')].find((x) => x.textContent.includes('Ударить'));
        if (!b) return JSON.stringify('нет дела «Ударить»');
        b.click();
        await new Promise((r) => setTimeout(r, 1500));
        if (!document.querySelector('.nx-am .ms')) return JSON.stringify('окна войска нет');
        // По десятку первых двух видов — к полководцу: итог «уходит» и оборона остающихся не пустые.
        [...document.querySelectorAll('.nx-am button[aria-label="К полководцу 10"]')].slice(0, 2).forEach((x) => x.click());
        return JSON.stringify('окно войска');
      })()`,
      wait: 900,
    },
    {
      name: 'k2-03b-army-troops',
      run: `(() => {
        const t = document.querySelector('.nx-am .ms');
        if (!t) return JSON.stringify('окна войска нет');
        t.scrollIntoView({ block: 'start' });
        return JSON.stringify('ok');
      })()`,
      wait: 600,
    },
    {
      name: 'k2-04-confirm',
      run: `(async () => {
        (await import('/src/world/store.ts')).useWorld.getState().closeMenu();
        await new Promise((r) => setTimeout(r, 300));
        ${K2_TAP_BODY}
        const eye = document.querySelector('.rg-btn[data-slot="eye"]');
        if (!eye) return JSON.stringify('нет глаза');
        eye.click();
        await new Promise((r) => setTimeout(r, 900));
        const b = [...document.querySelectorAll('.nx-am .nx-obtn')].find((x) => x.textContent.includes('Разведать'));
        if (!b) return JSON.stringify('нет дела «Разведать»');
        b.click();
        return JSON.stringify('ok');
      })()`,
      wait: 700,
    },
    {
      name: 'k2-05-off',
      run: `(async () => {
        (await import('/src/world/store.ts')).useWorld.getState().closeMenu();
        await new Promise((r) => setTimeout(r, 300));
        ${K2_TAP_BODY}
        const b = document.querySelector('.rg-btn[data-slot="diplomat"]');
        if (!b) return JSON.stringify('нет письма');
        b.click();
        return JSON.stringify(b.getAttribute('aria-label'));
      })()`,
      wait: 700,
    },
  ],
  // Р-4 (docs/AGENTS.md, раздел 16): походы агентов — «Походы», цель на карте, дела, подтверждение, донесение; пометка
  // павшего города словами. Мир настоящий; время прихода лазутчика сдвинуто руками стенда, чтобы донесение легло сразу.
  r4: [
    {
      name: 'r4-01-marches',
      run: `(async () => {
        window.__ui.reset();
        await (await import('/src/world/store.ts')).useWorld.getState().pulse();
        window.__game.getState().openMarches();
        return JSON.stringify('ok');
      })()`,
      wait: 1200,
    },
    {
      name: 'r4-02-target',
      run: `(async () => {
        const b = document.querySelector('.sheet.open button[aria-label="Разведчик: послать"]');
        if (!b) return JSON.stringify('нет кнопки «послать»');
        b.click();
        await new Promise((r) => setTimeout(r, 4000));
        return JSON.stringify('в руке: ' + (await import('/src/world/store.ts')).useWorld.getState().picked);
      })()`,
      wait: 1200,
    },
    {
      name: 'r4-03-deeds',
      run: `(async () => {
        const S = await import('/src/world/store.ts');
        const A = await import('/src/world/api.ts');
        const W = S.useWorld.getState();
        const info = W.info;
        const h = info.home;
        const now = S.worldNow();
        A.worldApi().save.marches.push({
          id: 'raid-r4', seed: 5, mission: 'raid', units: { warrior: 12 }, own: false, fromId: 'lair-r4', targetId: info.homeId,
          from: { x: h.x + 9, y: h.y }, to: { x: h.x, y: h.y }, fromName: 'Волчья падь', toName: 'дом',
          departAt: now - 600000, arriveAt: now + 3000000, phase: 'out', power: 40, loot: null,
        });
        await W.pulse();
        const m = S.useWorld.getState().marches.find((x) => x.id === 'raid-r4');
        if (!m) return JSON.stringify('набега не видно');
        await S.useWorld.getState().openChase(m, 'scout');
        await new Promise((r) => setTimeout(r, 700));
        return JSON.stringify('дел ' + (S.useWorld.getState().menu?.errands || []).length);
      })()`,
      wait: 900,
    },
    {
      name: 'r4-04-confirm',
      run: `(async () => {
        const b = [...document.querySelectorAll('.nx-am .nx-obtn')].find((x) => x.textContent.includes('Следить за отрядом'));
        if (!b) return JSON.stringify('нет дела «Следить за отрядом»');
        b.click();
        return JSON.stringify('ok');
      })()`,
      wait: 700,
    },
    {
      name: 'r4-05-report',
      run: `(async () => {
        const go = [...document.querySelectorAll('.nx-am .nx-go')].find((x) => x.textContent.trim() === 'Отправить');
        if (!go) return JSON.stringify('нет «Отправить»');
        go.click();
        await new Promise((r) => setTimeout(r, 900));
        const S = await import('/src/world/store.ts');
        const A = await import('/src/world/api.ts');
        const save = A.worldApi().save;
        const f = save.figures.scout;
        // Стенд: встреча — сейчас. Разведчик и набег сдвинуты на одну и ту же разницу, дальше мир сам: донесение и путь домой.
        const now = S.worldNow();
        const d = f.arriveAt - now + 1;
        f.departAt -= d;
        f.arriveAt -= d;
        const m = save.marches.find((x) => x.id === 'raid-r4');
        if (m) { m.departAt -= d; m.arriveAt -= d; }
        await S.useWorld.getState().pulse();
        await S.useWorld.getState().loadReports();
        const r = S.useWorld.getState().reports[0];
        if (!r) return JSON.stringify('донесения нет');
        window.__game.getState().openReport(r.id);
        return JSON.stringify(r.title);
      })()`,
      wait: 1200,
    },
    {
      name: 'r4-06-marches-after',
      run: `(async () => {
        window.__game.getState().openMarches();
        return JSON.stringify('ok');
      })()`,
      wait: 1200,
    },
    {
      name: 'r4-07-fell',
      run: `(async () => {
        window.__ui.reset();
        const S = await import('/src/world/store.ts');
        const A = await import('/src/world/api.ts');
        A.worldApi().markFall('home', 'plunder', S.worldNow() - 3 * 3600000);
        window.__game.getState().openMap();
        await new Promise((r) => setTimeout(r, 3000));
        await S.useWorld.getState().select(S.useWorld.getState().info.home);
        await new Promise((r) => setTimeout(r, 900));
        const row = [...document.querySelectorAll('.sheet.open button, .sheet.open .nx-crow')].find((x) => x.textContent.includes('Город взяли'));
        if (row) row.click();
        return JSON.stringify(row ? 'подсказка' : 'нет строки');
      })()`,
      wait: 900,
    },
  ],
  // ВС-2 (docs/ui_v2.md, 5.8): вести и летопись. Бой у ворот — настоящий: волки зовут гарнизон, мир бьётся на пульсе и
  // кладёт донесение с журналом боя; в «до» летопись живёт в «Заданиях», в «после» — вкладкой «Вестей».
  vs2: [
    {
      name: '180-vs2-mail',
      run: `(async () => {
        window.__ui.reset();
        const W = (await import('/src/world/store.ts')).useWorld;
        const M = await import('/src/game/sim/mail.ts');
        const g = window.__game.getState();
        const G = await import('/src/game/sim/gate.ts');
        const E = await import('/src/game/data/events.ts');
        g.act((st) => { st.army.clubman = 30; st.army.archer = 10; G.callGate(st, 'wolves', E.gatePower(st, 'wolves'), { hides: 20 }); });
        for (let i = 0; i < 3; i++) { await W.getState().pulse(); await new Promise((r) => setTimeout(r, 300)); }
        await W.getState().loadReports();
        g.act((st) => { for (const id of ['refugees', 'trade']) M.raiseEvent(st, id); });
        return JSON.stringify(window.__ui.click('Вести', '.nx-nav') + ', донесений ' + W.getState().reports.length);
      })()`,
      wait: 1500,
    },
    {
      name: '181-vs2-chron',
      run: `(async () => {
        const t = window.__ui.btn('Летопись', '.nx-realm [role=tablist]');
        if (t) { t.click(); return JSON.stringify('ok'); }
        (await import('/src/ui/realm/open.ts')).useRealm.getState().show('quests');
        await new Promise((r) => setTimeout(r, 600));
        const r1 = window.__ui.click('Показать за сутки', '.nx-realm');
        await new Promise((r) => setTimeout(r, 300));
        const e = window.__ui.scroller(); if (e) e.scrollTop = e.scrollHeight;
        return JSON.stringify(r1 === 'ok' ? 'до: летопись в «Заданиях»' : r1);
      })()`,
      wait: 900,
    },
    {
      name: '182-vs2-report',
      run: `(() => {
        const row = document.querySelector('.nx-realm .chron button.kit-tgo');
        if (!row) return JSON.stringify('строки с донесением нет');
        row.click();
        return JSON.stringify('ok');
      })()`,
      wait: 1500,
    },
    {
      name: '184-vs2-replay',
      run: `(async () => {
        const R = (await import('/src/ui/realm/open.ts')).useRealm.getState();
        const W = (await import('/src/world/store.ts')).useWorld.getState();
        if (!W.reports[0]) return JSON.stringify('донесения нет');
        R.openChronicle(W.reports[0].id);
        await new Promise((r) => setTimeout(r, 800));
        const r1 = window.__ui.click('▶️ Смотреть бой', '.nx-realm');
        await new Promise((r) => setTimeout(r, 2500));
        return JSON.stringify(r1 + (document.body.classList.contains('replaying') ? ', ролик идёт' : ', ролика нет'));
      })()`,
      wait: 1000,
    },
    {
      name: '185-vs2-mail-row',
      run: `(async () => {
        const btn = [...document.querySelectorAll('.replay button')].find((b) => /Пропустить|Закрыть|К донесению/.test(b.textContent || ''));
        if (btn) btn.click();
        await new Promise((r) => setTimeout(r, 600));
        const R = (await import('/src/ui/realm/open.ts')).useRealm.getState();
        R.setMailTab('all');
        await new Promise((r) => setTimeout(r, 500));
        // Касание по имени вести, не по «›»: строка целиком — кнопка.
        const cell = document.querySelector('.nx-realm .mail-group .kit-tgo .kit-c');
        if (!cell) return JSON.stringify('строки-двери нет');
        cell.click();
        return JSON.stringify((await import('/src/ui/realm/open.ts')).useRealm.getState().mail ? 'ok: весть открыта касанием по плашке' : 'весть не открылась');
      })()`,
      wait: 900,
    },
    {
      name: '183-vs2-quests',
      run: `(async () => {
        (await import('/src/ui/realm/open.ts')).useRealm.getState().show('quests');
        await new Promise((r) => setTimeout(r, 600));
        const e = window.__ui.scroller(); if (e) e.scrollTop = e.scrollHeight / 2;
        return JSON.stringify('ok');
      })()`,
      wait: 900,
    },
  ],
  // СБ-1 (docs/stability.md): раздел «Стабильность» в четырёх положениях — спокойно (первое открытие, с подсказкой), шатко,
  // мятеж близок, мятеж; положение кладётся в партию стендом (`window.__game`), раздел открывается дверью державы. В положении
  // «мятеж близок» — ещё середина (полосы с причинами и сроком мятежа) и низ (укрепление и летопись).
  sb1: [
    { name: 'sb1-calm', run: sb1(1, 0, { folk: 36, hungry: 0, past: [[-60, 1]] }, { tax: 'high' }, false), wait: 1500 },
    { name: 'sb1-shaky', run: sb1(-1, -45, { folk: 64, hungry: 12, past: [[-120, 1], [-70, 0], [-25, -1]] }, { tax: 'high', decree: 'order', ration: 'lean' }), wait: 1500 },
    { name: 'sb1-near', run: sb1(-2, -30, { folk: 86, hungry: 64, past: [[-130, 1], [-90, 0], [-40, -1], [-12, -2]] }, { tax: 'high', decree: 'order', ration: 'lean', pop: 80 }), wait: 1500 },
    { name: 'sb1-near-groups', run: sb1(-2, -30, { folk: 86, hungry: 64, past: [[-130, 1], [-90, 0], [-40, -1], [-12, -2]] }, { tax: 'high', decree: 'order', ration: 'lean', pop: 80 }, true, 400), wait: 1500 },
    { name: 'sb1-near-low', run: sb1(-2, -30, { folk: 86, hungry: 64, past: [[-130, 1], [-90, 0], [-40, -1], [-12, -2]] }, { tax: 'high', decree: 'order', ration: 'lean', pop: 80 }, true, 1000), wait: 1500 },
    { name: 'sb1-revolt', run: sb1(-3, 0, { folk: 100, hungry: 70, past: [[-140, 0], [-60, -1], [-20, -2], [-2, -3]], revolt: { group: 'folk', rebels: 40 }, revolts: 1 }, { tax: 'high', ration: 'lean', food: 0, raise: 'revolt_folk' }), wait: 1500 },
  ],
  sb2: [
    { name: 'sb2-comet', run: sb2('cr_comet', {}, null), wait: 1500 },
    { name: 'sb2-legate', run: sb2('cr_legate', { faith: 'catholic', gold: 400 }, 2), wait: 1500 },
    { name: 'sb2-fire', run: sb2('cr_lower_fire', { gold: 400 }, 2), wait: 1500 },
    { name: 'sb2-tournament', run: sb2('cr_tournament', { gold: 400 }, 0), wait: 1500 },
    { name: 'sb2-ruler', run: sb2('cr_ruler_ill', { stab: [1, 0] }, 1), wait: 1500 },
    { name: 'sb2-miracle', run: sb2('cr_miracle', { faith: 'orthodox', relic: true, stab: [-1, 60] }, 0), wait: 1500 },
    {
      name: 'sb2-done',
      run: `(async () => { ${STAY} document.querySelectorAll('.cr-pick')[1]?.click(); await new Promise((r) => setTimeout(r, 200)); document.querySelector('.cr-go')?.click(); await new Promise((r) => setTimeout(r, 500)); return JSON.stringify('ok'); })()`,
      wait: 1200,
    },
  ],
  // ОС-1 (docs/siege_v2.md, 23): окно осады у защитника при трёх соотношениях сил — слабый лагерь (×0,67), вровень (×1),
  // сильнее на 60 % (×1,6). Штраф, причина и «хлеба хватит» — дверями мира и племени (`world/siegefood`, `derived.siegeDryIn`)
  // по нашей партии под этим штрафом; пульс остановлен, вид мира вложен стендом, как у захода `siege`.
  os1: [
    { name: 'os1-weak', run: os1(0.67), wait: 1200, full: true },
    { name: 'os1-even', run: os1(1), wait: 1200, full: true },
    { name: 'os1-strong', run: os1(1.6), wait: 1200, full: true },
  ],
  sb2b: [
    { name: 'sb2b-ruler', run: sb2b('lineage'), wait: 1200 },
    { name: 'sb2b-stability', run: sb2b('stability'), wait: 1500 },
    { name: 'sb2b-quests', run: sb2b('quests', true), wait: 1500 },
  ],
  // АУ-3, ECO-1 (docs/audit/OWNER-DECISIONS.md, п. 1): окно «Склад заполнен» — отмена стройки на почти полном складе (два
  // вида), ответ на весть, «Начать» промысла поверх его сцены; строка «Склад повреждён» в летописи после потери уровня склада.
  au3: [
    {
      name: 'au3-01-cancel',
      run: `(async () => {
        window.__ui.reset();
        const A = await import('/src/game/sim/actions.ts');
        const D = await import('/src/game/derived.ts');
        window.__game.getState().act((st) => {
          const cap = D.storageCap(st);
          for (const r of Object.keys(st.resources)) st.resources[r] = cap;
          A.startUpgrade(st, st.buildings.find((x) => x.type === 'houses').id);
          for (const r of Object.keys(st.resources)) st.resources[r] = cap - 40;
          return null;
        });
        await new Promise((r) => setTimeout(r, 1500));
        const n = window.__ui.click('Здания', '.nx-nav');
        await new Promise((r) => setTimeout(r, 1200));
        const c = window.__ui.clickSel('.sheet.open .hall-qcell:nth-child(1)');
        if (n !== 'ok' || c !== 'ok') return JSON.stringify(n + ' / ' + c);
        await new Promise((r) => setTimeout(r, 500));
        const a = window.__ui.click('Отменить', '.sheet.open');
        await new Promise((r) => setTimeout(r, 200));
        const b = window.__ui.click('Точно?', '.sheet.open');
        await new Promise((r) => setTimeout(r, 400));
        return JSON.stringify(document.querySelector('.modal.room') ? 'ok' : 'нет окна: ' + a + ' / ' + b);
      })()`,
      wait: 600,
    },
    {
      name: 'au3-02-event',
      run: `(async () => {
        document.querySelector('.room-act .kit-btn:not(.main)')?.click();
        await new Promise((r) => setTimeout(r, 300));
        window.__ui.reset();
        const M = await import('/src/game/sim/mail.ts');
        const D = await import('/src/game/derived.ts');
        (await import('/src/world/store.ts')).useWorld.setState({ pulse: async () => {} });
        window.__game.getState().act((st) => {
          M.raiseEvent(st, 'berries');
          st.resources.food = D.storageCap(st) - 7;
          return null;
        });
        const ev = window.__game.getState().s.inbox.find((e) => e.defId === 'berries');
        if (!ev) return JSON.stringify('нет вести');
        window.__ui.click('Вести', '.nx-nav');
        await new Promise((r) => setTimeout(r, 1000));
        (await import('/src/ui/realm/open.ts')).useRealm.getState().openMail('event:berries:' + ev.at);
        await new Promise((r) => setTimeout(r, 700));
        const a = window.__ui.click('Послать людей', '.nx-realm');
        await new Promise((r) => setTimeout(r, 400));
        return JSON.stringify(document.querySelector('.modal.room') ? 'ok' : 'нет окна: ' + a);
      })()`,
      wait: 600,
    },
    {
      name: 'au3-03-minigame',
      run: `(async () => {
        document.querySelector('.room-act .kit-btn:not(.main)')?.click();
        await new Promise((r) => setTimeout(r, 300));
        window.__ui.reset();
        const D = await import('/src/game/derived.ts');
        window.__game.getState().act((st) => {
          for (const r of Object.keys(st.resources)) st.resources[r] = D.storageCap(st) - 2;
          return null;
        });
        (await import('/src/ui/trades.ts')).useTrades.getState().show();
        await new Promise((r) => setTimeout(r, 1000));
        const a = window.__ui.clickSel('.nx-trade-go');
        await new Promise((r) => setTimeout(r, 4000));
        const b = window.__ui.clickSel('.mg-go');
        await new Promise((r) => setTimeout(r, 500));
        return JSON.stringify(document.querySelector('.modal.room') ? 'ok' : 'нет окна: ' + a + ' / ' + b);
      })()`,
      wait: 600,
    },
    {
      name: 'au3-04-chronicle',
      run: `(async () => {
        document.querySelector('.room-act .kit-btn:not(.main)')?.click();
        await new Promise((r) => setTimeout(r, 300));
        (await import('/src/ui/trades.ts')).useTrades.getState().stop();
        await new Promise((r) => setTimeout(r, 500));
        window.__ui.reset();
        const E = await import('/src/game/sim/expedition.ts');
        const D = await import('/src/game/derived.ts');
        window.__game.getState().act((st) => {
          const b = st.buildings.find((x) => x.type === 'storage');
          b.level = 3;
          for (const r of Object.keys(st.resources)) st.resources[r] = D.storageCap(st);
          E.applyExpedition(st, { warriorsLost: 0, scoutsLost: 0, morale: 0, resources: {}, fallen: [{ id: 'storage', from: 3, to: 2 }] });
          return null;
        });
        window.__ui.click('Вести', '.nx-nav');
        await new Promise((r) => setTimeout(r, 900));
        (await import('/src/ui/realm/open.ts')).useRealm.getState().openChronicle();
        await new Promise((r) => setTimeout(r, 700));
        return JSON.stringify([...document.querySelectorAll('.nx-realm *')].some((e) => e.children.length === 0 && (e.textContent || '').includes('Склад повреждён')) ? 'ok' : 'нет строки');
      })()`,
      wait: 600,
    },
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

/**
 * ЗН-1 (docs/icons.md): значки целиком — верх с запасами и низ, «Дружина», «Вести», ратуша и карта, тот же вид «до» и
 * «после». `DIR=icons GROUP=zn1 TAG=before|after`. Шаги — те же, что у заходов `city`, `army`, `mail`, `hall` и `map`.
 */
GROUPS.zn1 = [
  { ...GROUPS.city[0], name: '01-city' },
  { ...GROUPS.army[0], name: '02-army' },
  { ...GROUPS.mail[0], name: '03-mail', tabs: false },
  { ...GROUPS.hall[0], name: '04-hall' },
  { ...GROUPS.map[0], name: '05-map' },
  { ...GROUPS.map[3], name: '06-map-cell' },
];

/**
 * ЗН-2 (docs/icons.md, «ЗН-2»): корпус интерфейса — кнопки, листы, вкладки, плашки, полосы, тревоги, реплики покоев и
 * низ, — тот же вид «до» и «после» во всех главных окнах. Два захода по двум минутам: город и его окна (`zn2a`), лавки,
 * сокровищница, тревоги, покои и карта (`zn2b`). `DIR=icons GROUP=zn2a|zn2b TAG=before|after`.
 */
GROUPS.zn2a = [
  { ...GROUPS.city[0], name: 'zn2-01-city' },
  { ...GROUPS.city[7], name: 'zn2-02-tip' },
  { ...GROUPS.hall[0], name: 'zn2-03-hall', full: false },
  { ...GROUPS.people[0], name: 'zn2-04-people', full: false },
  { ...GROUPS.army[0], name: 'zn2-05-army' },
  { ...GROUPS.mail[0], name: 'zn2-06-mail', tabs: false },
  { ...GROUPS.realm[0], name: 'zn2-07-realm', tabs: false },
  { ...building('smithy', 'zn2-08-smithy'), tabs: false },
];
GROUPS.zn2b = [
  { ...building('market', 'zn2-09-market'), tabs: false },
  { ...GROUPS.misc[0], name: 'zn2-10-treasury', tabs: false },
  { name: 'zn2-11-alerts', run: P7('urgent'), wait: 1500 },
  { name: 'zn2-12-chambers', run: `(async () => { window.__ui.reset(); (await import('/src/ui/chambers/open.ts')).useChambers.getState().show(); return JSON.stringify('ok'); })()`, wait: 2500 },
  { name: 'zn2-13-map', run: `(async () => { (await import('/src/ui/chambers/open.ts')).useChambers.getState().hide(); const S = await import('/src/world/store.ts'); S.useWorld.setState({ siege: null, camp: null, marches: [] }); window.__ui.reset(); window.__game.getState().openMap(); return JSON.stringify('ok'); })()`, wait: 6000 },
  { ...GROUPS.map[3], name: 'zn2-14-map-cell' },
];

/**
 * ЗН-3 (docs/ui_v2.md, 5.10): экран чище — верх города со значком профиля справа, профиль свёрнутым и с раскрытым разделом
 * («до» — прокрутка к концу: разделов ещё нет), покои у окна. `DIR=icons GROUP=zn3 WEATHER=clear TAG=before|after`.
 */
GROUPS.zn3 = [
  { ...GROUPS.city[0], name: 'zn3-01-city' },
  { ...GROUPS.profile[0], name: 'zn3-02-profile' },
  {
    name: 'zn3-03-profile-open',
    run: `(() => { const b = window.__ui.btn('Потери', '.pf-folds'); if (b) { b.click(); return JSON.stringify('ok'); } const e = window.__ui.scroller(); if (!e) return JSON.stringify('нет окна'); e.scrollTop = e.scrollHeight; return JSON.stringify('разделов нет — конец прокрутки'); })()`,
    wait: 700,
  },
  {
    name: 'zn3-04-chambers-window',
    run: `(async () => { window.__ui.reset(); (await import('/src/ui/realm/open.ts')).useRealm.getState().hide(); (await import('/src/ui/chambers/open.ts')).useChambers.getState().show(); for (let i = 0; i < 40 && !window.__chambers; i++) await new Promise((r) => setTimeout(r, 150)); if (!window.__chambers) return JSON.stringify('покоев нет'); window.__chambers.snap('window'); return JSON.stringify('ok'); })()`,
    wait: 2500,
  },
];

/**
 * ЗН-4 (docs/ui_v2.md, 5.11): подписи — все разом около середины приближения, рычаг выключен — нет; профиль — своё окно из
 * фигурки справа, держава — без профиля. Камера — над площадью (`standView`), расстояние — от стартового кадра (520 м, доля
 * приближения 0,20) через 400 м (0,40, ниже полосы) до 300 м (0,57, выше). `DIR=icons GROUP=zn4 WEATHER=clear TAG=after`.
 */
const LABELS = `(await import('/src/ui/next/labels.ts')).useLabels`;
const view = (dist: number): string => `window.__ui.reset(); window.__scene.standView(0, -16, ${dist});`;
GROUPS.zn4 = [
  { name: 'zn4-01-city-520', run: `(async () => { if (!${LABELS}.getState().on) ${LABELS}.getState().toggle(); ${view(520)} return JSON.stringify('ok'); })()`, wait: 2500 },
  { name: 'zn4-02-city-400', run: `(() => { ${view(400)} return JSON.stringify('ok'); })()`, wait: 2500 },
  { name: 'zn4-03-city-300', run: `(() => { ${view(300)} return JSON.stringify('ok'); })()`, wait: 2500 },
  { name: 'zn4-04-city-300-off', run: `(async () => { ${LABELS}.getState().toggle(); return JSON.stringify(${LABELS}.getState().on ? 'включён' : 'выключен'); })()`, wait: 1500 },
  {
    name: 'zn4-05-profile',
    run: `(async () => { ${LABELS}.getState().toggle(); ${view(520)} const b = document.querySelector('.nx-me'); if (!b) return JSON.stringify('нет значка'); b.click(); return JSON.stringify('ok'); })()`,
    wait: 1500,
  },
  { name: 'zn4-06-realm', run: `(() => { window.__ui.reset(); const b = document.querySelector('.coat-btn'); if (!b) return JSON.stringify('нет герба'); b.click(); return JSON.stringify('ok'); })()`, wait: 1500 },
];

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
    await tab.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?probe=1&fpscap=${FPS}&quality=low${process.env.WEATHER ? `&weather=${process.env.WEATHER}` : ''}${process.env.NIGHT ? `&night=${process.env.NIGHT}` : ''}` });
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
