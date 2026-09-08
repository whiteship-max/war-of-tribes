/**
 * След пальца по постройкам: попадает ли тап туда, куда целились.
 *
 * Это стенд, а не тест. Он ничего не утверждает и ничем не падает — он печатает
 * таблицу, по которой видно глазом: у какой постройки силуэт в пол-пальца, какая
 * область попадания получилась после раздутия до `TAP_TARGET`, что открывается от
 * чистого тапа и при каком сходе пальца тап перестаёт быть тапом. Юнит-тесты на
 * разбор жеста (`gestures`, `pick`) стоят отдельно и проверяют правила; здесь —
 * настоящая сцена с настоящей планировкой, настоящей камерой и настоящими
 * моделями, то есть ровно те числа, которых из правил не выведешь.
 *
 * Заведён после того, как тап по зданию не открывал панель на телефоне, а на
 * мыши работал: причина оказалась в двух числах сразу (`TAP_MOVE` и `TAP_MS`), и
 * доказательством были не рассуждения, а вот эта матрица — «21 из 21 при сдвиге
 * 9 px и ноль из 21 при 11 px».
 *
 * ЧЕМ МЕРЯЕТ. Настоящая игра в настоящем Chrome, но **без WebGL**: контекст
 * канвы подделан заглушкой (её отдаёт dev-серверу плагин ниже), поэтому three
 * поднимается целиком, сцена собирается, камера кадрируется, области попадания
 * считаются — а рисования нет. Отсюда и правило: **картинки с этого стенда
 * чёрные**, скриншот доказывать им ничего не может.
 *
 * ЧЕГО НЕ МЕРЯЕТ:
 *   рисунок      кадра нет вовсе — за внешним видом на `?showcase=` и в snaps/;
 *   разметку     двумерный слой сюда не входит: события идут прямо на канву,
 *                поверх неё в игре только «дырка» обучения с pointer-events:none;
 *   быстродействие  часы на время следа подменены (иначе след в 700 мс, взятый
 *                по всем постройкам и всем сдвигам, стоил бы минут, а браузер в
 *                фоне ещё и душит таймеры). Кадры за бюджетом — на стенде.
 *
 * Запуск: npm run tap:report
 * Переменные: LEVEL=10 (поднять посёлок — у моделей другая ступень и другой
 *             силуэт), WIDTH=390 HEIGHT=844 DPR=3, HEAD=1 (видимое окно),
 *             PORT / CDP_PORT, CHROME=путь\к\chrome.exe
 */
import { createServer as createVite, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { TAP_FORGIVE, TAP_MOVE, TAP_MS, TAP_SETTLE, TAP_SLIP, TAP_TARGET } from '../src/gestures';
import { pickBox, type HitBox } from '../src/render/pick';
import { WALL_RADIUS } from '../src/render/plan';
import { BUILDINGS } from '../src/game/data/buildings';

const PORT = Number(process.env.PORT ?? 4192);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9335);
const WIDTH = Number(process.env.WIDTH ?? 375);
const HEIGHT = Number(process.env.HEIGHT ?? 812);
const DPR = Number(process.env.DPR ?? 2);
const LEVEL = Number(process.env.LEVEL ?? 1);

/**
 * Подделка контекста канвы: WebGL нет, а сцена нужна настоящая.
 *
 * Заглушке хватает нескольких ответов — остальное синтезируется по имени:
 * ЗАГЛАВНЫЕ имена это константы (каждой свой номер, чтобы их можно было
 * различать), `create*` отдаёт объект, прочее — ничего. Два ответа обязательны
 * и найдены падениями three: точность шейдера иначе читается у `null`, а число
 * активных атрибутов и униформ обязано быть нулём — иначе three пойдёт за
 * `getActiveAttrib` и упадёт на `.name`.
 *
 * Прототип у заглушки настоящий (`WebGL2RenderingContext`), чтобы проверки
 * `instanceof` внутри three видели то, что ожидают; методы с него не берутся
 * никогда — своё ищется раньше.
 */
const WEBGL_STUB = `
(() => {
  const real = HTMLCanvasElement.prototype.getContext;
  const codes = new Map();
  let next = 0x8000;
  const code = (name) => {
    if (!codes.has(name)) codes.set(name, next++);
    return codes.get(name);
  };
  const fake = (canvas) => {
    const base = Object.create(typeof WebGL2RenderingContext === 'undefined' ? Object.prototype : WebGL2RenderingContext.prototype);
    // Именно defineProperty, а не Object.assign: у настоящего прототипа половина
    // имён — геттеры без сеттера, и присваивание по ним падает.
    const own = {
      canvas,
      drawingBufferWidth: canvas.width || 1,
      drawingBufferHeight: canvas.height || 1,
      getExtension: () => null,
      getSupportedExtensions: () => [],
      getContextAttributes: () => ({ alpha: true, antialias: false, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false }),
      getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
      getShaderParameter: () => true,
      getProgramParameter: (p, name) => (name === code('ACTIVE_ATTRIBUTES') || name === code('ACTIVE_UNIFORMS') ? 0 : true),
      getShaderInfoLog: () => '',
      getProgramInfoLog: () => '',
      getError: () => 0,
      isContextLost: () => false,
      getParameter: (name) => {
        if (name === code('VERSION')) return 'WebGL 2.0 (заглушка)';
        if (name === code('SHADING_LANGUAGE_VERSION')) return 'WebGL GLSL ES 3.00 (заглушка)';
        if (name === code('VENDOR') || name === code('RENDERER')) return 'tribe tap-report';
        return 4096;
      },
      checkFramebufferStatus: () => code('FRAMEBUFFER_COMPLETE'),
    };
    for (const key of Object.keys(own)) {
      Object.defineProperty(base, key, { value: own[key], writable: true, configurable: true, enumerable: true });
    }
    return new Proxy(base, {
      get(target, prop) {
        if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
        const name = String(prop);
        if (/^[A-Z][A-Z0-9_]*$/.test(name)) return code(name);
        if (name.startsWith('create')) return () => ({});
        if (name.startsWith('get')) return () => null;
        return () => undefined;
      },
      // Запись тоже своя: у настоящего прототипа есть сеттеры
      // (drawingBufferColorSpace и прочие), и они бьются об «чужой получатель».
      set(target, prop, value) {
        Object.defineProperty(target, prop, { value, writable: true, configurable: true, enumerable: true });
        return true;
      },
    });
  };
  HTMLCanvasElement.prototype.getContext = function (kind, opts) {
    if (String(kind).indexOf('webgl') !== 0) return real.call(this, kind, opts);
    return fake(this);
  };
  window.__noWebGL = true;
})();
`;

/** Тот же dev-сервер, что у игры, только страница отдаётся с подделанным контекстом. */
function stubPlugin(): Plugin {
  return {
    name: 'tribe-tap-report-no-webgl',
    apply: 'serve',
    transformIndexHtml() {
      // head-prepend: заглушка обязана лечь до всякого модуля, иначе рендерер
      // успеет спросить настоящий контекст и упасть.
      return [{ tag: 'script', children: WEBGL_STUB, injectTo: 'head-prepend' as const }];
    },
  };
}

/**
 * Что подкладывается в страницу.
 *
 * Ничего своего про геометрию здесь нет: где здание на экране, спрашивается у
 * самой сцены (`hitBoxOf`, `screenSpot`), а точка мира переводится в пиксели тем
 * же `projectHitBox`, которым сцена считает области попадания. Второй правды о
 * том, где что на экране, быть не должно — иначе стенд начнёт доказывать себя.
 *
 * Часы на время следа подменены. Жест судится по времени (`TAP_MS`,
 * `TAP_SETTLE`), и настоящее ожидание означало бы минуты на матрицу и веру в то,
 * что браузер не придушил таймеры в фоне. Виртуальные часы точны и мгновенны, а
 * весь след идёт синхронно — кадров между событиями всё равно не бывает.
 */
const PROBE = `
(async () => {
  const scene = window.__scene;
  const game = window.__game;
  if (!scene || !game) throw new Error('нет window.__scene — страница открыта без ?probe=1?');
  const canvas = scene.canvas;
  if (!canvas || !scene.buildings || typeof scene.hitBoxOf !== 'function') {
    throw new Error('сцена не та: нет canvas/buildings/hitBoxOf — поля переименовали, стенд надо чинить');
  }
  // Захват указателя: синтетический pointerId браузеру неизвестен,
  // setPointerCapture бросает NotFoundError и обрывает слушателя OrbitControls.
  // Доставку событий захват не меняет — глушим его на канве.
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.hasPointerCapture = () => false;

  const pick = await import('/src/render/pick.ts');
  const IDENT = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
  const rect = () => canvas.getBoundingClientRect();
  const state = () => game.getState();

  const ev = (type, id, x, y) =>
    canvas.dispatchEvent(
      new PointerEvent(type, {
        pointerId: id,
        pointerType: 'touch',
        isPrimary: id === 1,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        bubbles: true,
        cancelable: true,
      }),
    );

  /** Один след пальца. Возвращает id открытой постройки или null. */
  const trace = (o) => {
    state().openBuilding(null);
    const camera = scene.camera.position.clone();
    const target = scene.controls.target.clone();
    const own = Object.getOwnPropertyDescriptor(performance, 'now');
    const real = performance.now.bind(performance);
    const t0 = real();
    let t = t0;
    performance.now = () => t;
    try {
      const a = Math.PI / 5;
      const dx = Math.cos(a) * o.slip;
      const dy = Math.sin(a) * o.slip;
      const slipAt = t0 + Math.max(0, o.ms - o.lead);
      const shiver = t0 + o.ms * 0.4;
      ev('pointerdown', 1, o.x, o.y);
      if (o.fingers > 1) {
        t = t0 + 20;
        ev('pointerdown', 2, o.x + 70, o.y + 70);
      }
      // Дрожь внутри порога: палец лежит и чуть ползёт, тапом быть не перестаёт.
      if (shiver < slipAt) {
        t = shiver;
        ev('pointermove', 1, o.x + 1.4, o.y + 1.4);
      }
      // Сход: пятно контакта схлопывается, и центр прыгает. lead — за сколько
      // до снятия это случилось; большой lead — это уже не сход, а ведение.
      t = slipAt;
      ev('pointermove', 1, o.x + dx, o.y + dy);
      t = t0 + o.ms;
      if (o.fingers > 1) ev('pointerup', 2, o.x + 70, o.y + 70);
      ev('pointerup', 1, o.x + dx, o.y + dy);
    } finally {
      if (own) Object.defineProperty(performance, 'now', own);
      else delete performance.now;
    }
    const sheet = state().sheet;
    const hit = sheet && sheet.kind === 'building' ? sheet.id : null;
    state().openBuilding(null);
    // Камера возвращается на место: панорама от ведения не должна утечь в
    // следующий след, иначе таблица зависела бы от порядка строк.
    //
    // Затухание на это время выключено, и без этого не обойтись: с ним
    // OrbitControls отдаёт накопленный сдвиг долями, остаток живёт в контролах и
    // после возврата камеры доезжает уже в следующем следе. По сотой доле на
    // след — и к концу матрицы посёлок уезжал на пиксель с лишним (стенд это
    // видит сам и говорит «камера уехала»).
    const damping = scene.controls.enableDamping;
    scene.controls.enableDamping = false;
    scene.controls.update();
    scene.camera.position.copy(camera);
    scene.controls.target.copy(target);
    scene.controls.update();
    scene.controls.enableDamping = damping;
    return hit;
  };

  window.__tap = {
    ready: () => JSON.stringify({ w: rect().width, h: rect().height, dpr: window.devicePixelRatio, fake: !!window.__noWebGL }),

    /** Поднять весь посёлок до уровня — у моделей другая ступень и другой силуэт. */
    level: (max) => {
      const s = state().s;
      for (const b of s.buildings) b.level = Math.max(1, Math.min(max[b.type] || 1, LEVEL_WANTED));
      s.tutorialDone = true;
      game.setState({ s: { ...s } });
      return JSON.stringify('ok');
    },

    /** Точка мира в пикселях страницы — тем же переводом, что у областей попадания. */
    at: (x, y, z) => {
      const b = pick.projectHitBox(0, { min: { x, y, z }, max: { x, y, z } }, IDENT, scene.camera, rect(), 0);
      return b && { x: b.x, y: b.y };
    },

    /** Постройки: силуэт как есть и область попадания, какой её видит тап. */
    boxes: () => {
      const r = rect();
      const out = [];
      for (const b of state().s.buildings) {
        const view = scene.buildings.get(b.id);
        if (!view) continue;
        view.group.updateWorldMatrix(true, false);
        const raw = view.type === 'palisade' ? null : pick.projectHitBox(b.id, view.box, view.group.matrixWorld, scene.camera, r, 0);
        const area = scene.hitBoxOf(b.id);
        const spot = scene.screenSpot(b.id);
        out.push({ id: b.id, type: view.type, tier: view.tier, level: b.level, raw, area, spot });
      }
      return JSON.stringify(out);
    },

    /** Матрица «сдвиг × длительность»: по следу на каждую постройку в каждой клетке. */
    matrix: (plan) => {
      const rows = [];
      for (const slip of plan.slips) {
        const row = [];
        for (const ms of plan.durations) {
          row.push(plan.points.map((p) => trace({ x: p.x, y: p.y, slip, ms, lead: plan.lead, fingers: 1 })));
        }
        rows.push(row);
      }
      return JSON.stringify(rows);
    },

    /** Одиночные следы: ведение, щипок, пустое поле, кладка. */
    each: (list) => JSON.stringify(list.map((o) => trace(o))),
  };
  return JSON.stringify('ok');
})()
`;

interface Box {
  id: number;
  type: string;
  tier: number;
  level: number;
  raw: HitBox | null;
  area: HitBox | null;
  spot: { x: number; y: number; r: number } | null;
}

const nameOf = (type: string): string => BUILDINGS.find((b) => b.id === type)?.name ?? type;
const px = (v: number): string => Math.round(v).toString();
const size = (b: HitBox | null): string => (b ? `${px(b.hw * 2)}×${px(b.hh * 2)}` : '—');
const pad = (s: string, n: number): string => s + ' '.repeat(Math.max(0, n - [...s].length));
const padL = (s: string, n: number): string => ' '.repeat(Math.max(0, n - [...s].length)) + s;

async function main(): Promise<void> {
  const vite = await createVite({
    configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
    plugins: [stubPlugin()],
    server: { port: PORT, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  const chrome = await launchChrome(DEBUG_PORT, ['--disable-gpu', '--use-gl=disabled', `--window-size=${WIDTH},${HEIGHT}`]);
  try {
    await report();
  } finally {
    chrome.kill();
    await vite.close();
    await sleep(300);
  }
}

async function report(): Promise<void> {
  const tab = await Tab.open(DEBUG_PORT, `http://127.0.0.1:${PORT}/?probe=1`);
  await tab.send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: DPR,
    mobile: true,
  });
  // Партия начинается заново: иначе стенд мерил бы чужой посёлок из localStorage.
  await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} return JSON.stringify("ok"); })()');
  await tab.send('Page.reload');

  for (let i = 0; ; i++) {
    await sleep(300);
    if (await tab.eval<boolean>('JSON.stringify(!!(window.__scene && window.__game))')) break;
    if (i > 100) throw new Error('сцена не поднялась за 30 с — смотри вывод «в странице:» выше');
  }
  await tab.eval<string>(PROBE.replace('LEVEL_WANTED', String(LEVEL)));
  const maxLevel: Record<string, number> = {};
  for (const def of BUILDINGS) maxLevel[def.id] = def.maxLevel ?? 10;
  await tab.eval<string>(`window.__tap.level(${JSON.stringify(maxLevel)})`);
  await sleep(400);
  const view = await tab.eval<{ w: number; h: number; dpr: number; fake: boolean }>('window.__tap.ready()');
  const boxes = await tab.eval<Box[]>('window.__tap.boxes()');

  // Целятся в середину постройки. Точка за краем канвы — не промах игрока, а
  // здание, до которого пальцем не дотянуться при стартовом ракурсе: такие
  // считаются отдельно, иначе они портили бы матрицу как «не открылось».
  const inside = (p: { x: number; y: number }): boolean => p.x > 2 && p.y > 2 && p.x < view.w - 2 && p.y < view.h - 2;
  const aimed = boxes.filter((b) => b.area && inside(b.area));
  const offscreen = boxes.filter((b) => b.area && !inside(b.area));
  const wall = boxes.find((b) => !b.area && b.spot);
  const points = aimed.map((b) => ({ id: b.id, x: b.area!.x, y: b.area!.y }));

  const slips = [0, TAP_MOVE - 1, TAP_MOVE + 1, (TAP_MOVE + TAP_SLIP) >> 1, TAP_SLIP - 1, TAP_SLIP + 1];
  const durations = [200, 340, 420, TAP_MS - 10, TAP_MS + 10];
  const matrix = await tab.eval<Array<Array<Array<number | null>>>>(
    `window.__tap.matrix(${JSON.stringify({ slips, durations, lead: 15, points })})`,
  );
  const clean = matrix[0][0];

  // Кладка стены и чистое поле: точки берутся из настоящей проекции кольца, а
  // «пустое место» ищется настоящим `pickBox` по тем же областям, что у сцены.
  const ring: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const p = await tab.eval<{ x: number; y: number } | null>(
      `JSON.stringify(window.__tap.at(${Math.cos(a) * WALL_RADIUS}, 1.2, ${Math.sin(a) * WALL_RADIUS}))`,
    );
    if (p && inside(p)) ring.push(p);
  }
  const areas = boxes.map((b) => b.area).filter((b): b is HitBox => !!b);
  const farFromRing = (p: { x: number; y: number }): number =>
    ring.reduce((m, r) => Math.min(m, Math.hypot(p.x - r.x, p.y - r.y)), Infinity);
  const onRing = ring.find((p) => pickBox(areas, p.x, p.y) === null) ?? ring[0] ?? null;

  // Чистое поле — не дальний угол кадра, а самое тесное пустое место: точка, где
  // ближе всего до домов, но всё-таки мимо всех областей и не на кладке. Угол
  // доказывал бы только то, что за краем посёлка пусто, а вопрос в другом —
  // не открывается ли что-нибудь от тапа между домами.
  let empty: { x: number; y: number } | null = null;
  let emptyRoom = Infinity;
  for (let y = 8; y < view.h - 8; y += 6) {
    for (let x = 8; x < view.w - 8; x += 6) {
      if (pickBox(areas, x, y) !== null || farFromRing({ x, y }) <= TAP_TARGET) continue;
      const room = areas.reduce((m, b) => Math.min(m, Math.hypot(x - b.x, y - b.y) - Math.hypot(b.hw, b.hh)), Infinity);
      // Запас за прощением: точка на самой границе ничего не докажет — она
      // качнётся в другую сторону от любой мелочи.
      if (room > TAP_FORGIVE + 6 && room < emptyRoom) {
        emptyRoom = room;
        empty = { x, y };
      }
    }
  }

  const extra = [
    { what: `ведение ${TAP_SLIP + 8} px с самого начала`, o: { slip: TAP_SLIP + 8, ms: 400, lead: 380, fingers: 1 } },
    {
      what: `медленное ведение ${(TAP_MOVE + TAP_SLIP) >> 1} px (сдвиг за ${TAP_SETTLE + 110} мс до снятия)`,
      o: { slip: (TAP_MOVE + TAP_SLIP) >> 1, ms: 400, lead: TAP_SETTLE + 110, fingers: 1 },
    },
    { what: 'щипок вторым пальцем', o: { slip: 0, ms: 200, lead: 15, fingers: 2 } },
  ];
  const extraRuns: Array<Array<number | null>> = [];
  for (const e of extra) {
    extraRuns.push(await tab.eval<Array<number | null>>(`window.__tap.each(${JSON.stringify(points.map((p) => ({ ...e.o, x: p.x, y: p.y })))})`));
  }
  const spot = await tab.eval<Array<number | null>>(
    `window.__tap.each(${JSON.stringify(
      [
        ...(empty ? [{ ...empty, slip: 0, ms: 200, lead: 15, fingers: 1 }] : []),
        ...(onRing ? [{ ...onRing, slip: 0, ms: 200, lead: 15, fingers: 1 }] : []),
      ],
    )})`,
  );

  const after = await tab.eval<Box[]>('window.__tap.boxes()');
  const drift = boxes.reduce((m, b) => {
    const now = after.find((x) => x.id === b.id);
    return b.area && now?.area ? Math.max(m, Math.hypot(b.area.x - now.area.x, b.area.y - now.area.y)) : m;
  }, 0);

  tab.close();
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`);

  const label = (id: number | null, own: number): string => {
    if (id === own) return '✓';
    if (id === null) return '— ничего';
    const b = boxes.find((x) => x.id === id);
    return b ? nameOf(b.type) : `id ${id}`;
  };

  console.log('\nСЛЕД ПАЛЬЦА ПО ПОСТРОЙКАМ');
  console.log(`  экран ${WIDTH}×${HEIGHT}, dpr ${view.dpr}, канва ${px(view.w)}×${px(view.h)} px, уровень зданий ${LEVEL}`);
  console.log(`  WebGL нет: контекст подделан${view.fake ? '' : ' — НО ЗАГЛУШКА НЕ ВСТАЛА'}, кадр не рисуется, снимок отсюда чёрный`);
  console.log(
    `  пороги: путь ${TAP_MOVE}/${TAP_SLIP} px, выдержка ${TAP_SETTLE} мс, длительность ${TAP_MS} мс, цель ${TAP_TARGET} px, прощение ${TAP_FORGIVE} px`,
  );
  // Камера обязана возвращаться на место после каждого следа: уехавшая панорама
  // тихо сдвинула бы все области, и таблица начала бы зависеть от порядка строк.
  if (drift > 0.5) console.log(`  ВНИМАНИЕ: за все следы камера уехала на ${drift.toFixed(1)} px — числа ниже поплыли`);
  console.log('');

  console.log(`  ${pad('Постройка', 22)}${padL('силуэт', 9)}${padL('область', 9)}${padL('центр', 12)}   чистый тап`);
  for (const b of [...aimed].sort((a, c) => (a.raw?.hw ?? 0) * (a.raw?.hh ?? 0) - (c.raw?.hw ?? 0) * (c.raw?.hh ?? 0))) {
    const at = `${px(b.area!.x)},${px(b.area!.y)}`;
    const got = clean[points.findIndex((p) => p.id === b.id)];
    console.log(
      `  ${pad(nameOf(b.type) + (LEVEL > 1 ? ` ${b.level}` : ''), 22)}${padL(size(b.raw), 9)}${padL(size(b.area), 9)}${padL(at, 12)}   ${label(got, b.id)}`,
    );
  }
  if (wall) console.log(`  ${pad(nameOf(wall.type), 22)}${padL('кольцо', 9)}${padL('кольцо', 9)}${padL('—', 12)}   ниже, отдельной строкой`);
  if (offscreen.length) {
    console.log(`\n  за кадром (центр вне канвы — до них надо довести камеру): ${offscreen.map((b) => nameOf(b.type)).join(', ')}`);
  }

  console.log(`\n  След с прыжком на сходе — сколько построек из ${points.length} открыли свою панель`);
  console.log(`  ${pad('сдвиг \\ длительность', 22)}${durations.map((d) => padL(`${d} мс`, 8)).join('')}`);
  for (let i = 0; i < slips.length; i++) {
    const cells = matrix[i].map((run) => padL(String(run.filter((got, k) => got === points[k].id).length), 8)).join('');
    console.log(`  ${pad(`${slips[i]} px`, 22)}${cells}`);
  }
  console.log(`  (сдвиг приходит за 15 мс до снятия — так и ведёт себя палец на сходе)`);

  console.log(`\n  Прочее`);
  for (let i = 0; i < extra.length; i++) {
    const hit = extraRuns[i].filter((got, k) => got === points[k].id).length;
    console.log(`  ${pad(extra[i].what, 52)}${padL(`${hit} из ${points.length}`, 10)}`);
  }
  if (empty) {
    console.log(`  ${pad(`тап в чистое поле (${px(empty.x)},${px(empty.y)})`, 52)}${padL(label(spot[0], -1), 10)}`);
  }
  if (onRing) {
    const got = spot[empty ? 1 : 0];
    const b = got === null ? null : boxes.find((x) => x.id === got);
    console.log(
      `  ${pad(`тап по кладке стены (${px(onRing.x)},${px(onRing.y)})`, 52)}${padL(b ? nameOf(b.type) : '— ничего', 10)}`,
    );
  }
  console.log('');
}

await main();
