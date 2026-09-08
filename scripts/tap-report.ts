/**
 * След пальца по постройкам: попадает ли тап туда, куда целились.
 *
 * Это стенд, а не тест. Он ничего не утверждает и ничем не падает — он печатает
 * таблицы, по которым видно глазом: у какой постройки силуэт в пол-пальца, какая
 * область попадания получилась после раздутия до `TAP_TARGET`, что открывается от
 * чистого тапа, при каком сходе пальца тап перестаёт быть тапом и на сколько
 * уезжает деревня под пальцем. Юнит-тесты на разбор жеста (`gestures`, `pick`)
 * стоят отдельно и проверяют правила; здесь — настоящая сцена с настоящей
 * планировкой, настоящей камерой и настоящими моделями, то есть ровно те числа,
 * которых из правил не выведешь.
 *
 * ПАЛЕЦ ЗДЕСЬ НАСТОЯЩИЙ, И ЭТО ГЛАВНОЕ.
 *
 * Прежний стенд подавал в канву `new PointerEvent(...)` и подменял часы, чтобы
 * след шёл мгновенно. Оба приёма выглядели безобидной экономией, а на деле
 * прятали ровно ту болезнь, на которую пришла жалоба:
 *
 *   — синтетическому событию неизвестен захват указателя, и стенду приходилось
 *     глушить `setPointerCapture`, то есть выключать кусок настоящего пути;
 *   — события шли ровно тогда, когда их посылали, а живые `pointermove` браузер
 *     собирает и отдаёт кадрами, склеивая по несколько шагов пальца в один;
 *   — а главное, след моделировал сход **только перед снятием**. Живой палец
 *     ведёт себя иначе: ложась на экран, он проезжает 14–20 px в первые 60–80 мс
 *     (пятно контакта растекается, пока подушечка садится), а потом лежит
 *     неподвижно, пока игрок целится. По прежнему правилу такой тап отбрасывался
 *     молча — и стенд показывал 21 из 21, пока телефон терял каждый второй тап.
 *
 * Поэтому теперь ввод идёт `Input.dispatchTouchEvent` — через тот же путь, что и
 * палец: тач-эмуляция браузера, настоящие `pointerId`, настоящий захват,
 * настоящая склейка движений. Часы тоже настоящие: весь прогон идёт минуты, и это
 * не потеря, а условие — виртуальные часы и были второй половиной обмана.
 *
 * ЧЕМ МЕРЯЕТ. Настоящая игра в настоящем Chrome, но **без WebGL**: контекст
 * канвы подделан заглушкой (её отдаёт dev-серверу плагин ниже), поэтому three
 * поднимается целиком, сцена собирается, камера кадрируется, области попадания
 * считаются — а рисования нет. Отсюда и правило: **картинки с этого стенда
 * чёрные**, скриншот доказывать им ничего не может.
 *
 * ЧЕГО НЕ МЕРЯЕТ:
 *   рисунок      кадра нет вовсе — за внешним видом на `?showcase=` и в snaps/;
 *   разметку     двумерный слой сюда не входит: касания идут в точку экрана, а
 *                поверх канвы в игре только «дырка» обучения с pointer-events:none;
 *   быстродействие  кадров нет, мерить нечего — бюджет кадра на стенде витрины;
 *   вебвью Телеграма  это Chrome, а не он: перехват жеста клиентом здесь не
 *                воспроизводится, и на такой случай в игре стоит журнал касаний
 *                («Задания» → «Служебное» → «Что было под пальцем»).
 *
 * Запуск: npm run tap:report
 * Переменные: LEVEL=10 (поднять посёлок — у моделей другая ступень и другой
 *             силуэт), WIDTH=390 HEIGHT=844 DPR=3, HEAD=1 (видимое окно),
 *             PORT / CDP_PORT, CHROME=путь\к\chrome.exe
 */
import { createServer as createVite, type Plugin } from 'vite';
import { fileURLToPath, URL } from 'node:url';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { TAP_FORGIVE, TAP_MOVE, TAP_MS, TAP_SLIP, TAP_TARGET, WHEEL_STEP } from '../src/gestures';
import { pickBox, type HitBox } from '../src/render/pick';
import { WALL_RADIUS } from '../src/render/plan';
import { BUILDINGS } from '../src/game/data/buildings';

const PORT = Number(process.env.PORT ?? 4192);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9335);
const WIDTH = Number(process.env.WIDTH ?? 375);
const HEIGHT = Number(process.env.HEIGHT ?? 812);
const DPR = Number(process.env.DPR ?? 2);
const LEVEL = Number(process.env.LEVEL ?? 1);

/** Сколько ждём, пока точка касания освободится от шторки. */
const CLEAR_WAIT_MS = 800;

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
      // успеет спросить настоящий контекст и упадёт.
      return [{ tag: 'script', children: WEBGL_STUB, injectTo: 'head-prepend' as const }];
    },
  };
}

/**
 * Что подкладывается в страницу.
 *
 * Только чтение и сброс. Самих касаний здесь больше нет — их подаёт браузер по
 * команде снаружи, и в этом весь смысл переделки: путь события от стенда до
 * сцены обязан совпадать с путём от пальца до сцены.
 *
 * Ничего своего про геометрию тут тоже нет: где здание на экране, спрашивается
 * у самой сцены (`hitBoxOf`, `screenSpot`), а точка мира переводится в пиксели
 * тем же `projectHitBox`, которым сцена считает области попадания. Второй правды
 * о том, где что на экране, быть не должно — иначе стенд начнёт доказывать себя.
 */
const PROBE = `
(async () => {
  const game = window.__game;
  if (!window.__scene || !game) throw new Error('нет window.__scene — страница открыта без ?probe=1?');

  /*
   * СЦЕНУ И КАНВУ СПРАШИВАЮТ КАЖДЫЙ РАЗ, А НЕ ЗАПОМИНАЮТ.
   *
   * У игры правило «новая сцена — новая канва»: экран игры пересобирает сцену
   * при потере контекста и заводит под неё новый элемент. Запомненная ссылка
   * после этого указывает на мёртвую сцену — и стенд начинал врать сразу двумя
   * концами: «свободна ли точка» сравнивалось с канвой, которой на экране уже
   * нет (все следы шли как «под разметкой»), а сброс возвращал домой камеру
   * мёртвой сцены, пока живая уезжала от следа к следу. В таблице это выглядело
   * как потерянный тап при любом сходе пальца — то есть как поломка игры.
   */
  const live = () => window.__scene;
  const canvasOf = () => live().canvas;
  const scene0 = live();
  if (!canvasOf() || !scene0.buildings || typeof scene0.hitBoxOf !== 'function' || typeof scene0.place !== 'function') {
    throw new Error('сцена не та: нет canvas/buildings/hitBoxOf/place — поля переименовали, стенд надо чинить');
  }

  const pick = await import('/src/render/pick.ts');
  const IDENT = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
  const rect = () => canvasOf().getBoundingClientRect();
  const state = () => game.getState();
  // Домашний кадр камеры: между следами она возвращается сюда, иначе сдвиг от
  // прошлого следа уехал бы в таблицу следующего. Ставится он на подъёме
  // посёлка, когда кадр уже сложился.
  let home = { t: live().target.toArray(), d: live().dist };
  // Сколько раз сцена пересобиралась под нами. Ноль — норма; больше нуля стенд
  // обязан сказать вслух: числа при этом сняты с разных сцен.
  let seen = live();
  let rebuilt = 0;
  const watch = () => {
    if (live() === seen) return;
    seen = live();
    rebuilt++;
  };

  window.__tap = {
    ready: () => JSON.stringify({ w: rect().width, h: rect().height, dpr: window.devicePixelRatio, fake: !!window.__noWebGL }),

    /**
     * Поднять весь посёлок до уровня и снять обучение.
     *
     * Обучение снимается не для удобства: его слой закрывает панель здания на
     * каждом своём шаге (TutorialOverlay), и без этого стенд мерил бы не тап,
     * а проводку первых шагов. Найдено этим же прогоном — прежний стенд ловил
     * панель синхронно и до слоя.
     */
    level: (max) => {
      const s = state().s;
      for (const b of s.buildings) b.level = Math.max(1, Math.min(max[b.type] || 1, LEVEL_WANTED));
      s.tutorialDone = true;
      game.setState({ s: { ...s } });
      home = { t: live().target.toArray(), d: live().dist };
      return JSON.stringify('ok');
    },

    /** Сколько раз сцена пересобралась за прогон. */
    rebuilds: () => JSON.stringify(rebuilt),

    /**
     * Камера на исходную, панель закрыта, окна сняты: след не должен зависеть от
     * предыдущего.
     *
     * Окна снимаются не для красоты. Прогон идёт минуты, то есть игровые сутки, и
     * за это время симуляция поднимает случайные события — а окно события накрывает
     * весь экран и глотает касание. В прежних прогонах из-за этого целые строки
     * таблицы уходили в ноль, и выглядело это как поломка тапа. Зимнее
     * предупреждение снимается тем же ходом и по той же причине.
     */
    reset: () => {
      watch();
      const g = state();
      g.openBuilding(null);
      if (g.eventResult) g.dismissResult();
      const s = g.s;
      s.activeEvent = null;
      s.winterWarning = false;
      // Следующее событие отодвигается за горизонт прогона: снять уже открытое
      // мало — новое поднимется посреди следующего следа и накроет экран ровно
      // тогда, когда палец уже лежит.
      s.nextEventAt = s.time + 1e9;
      game.setState({ s: { ...s } });
      live().target.fromArray(home.t);
      live().dist = home.d;
      live().place();
      return JSON.stringify('ok');
    },

    /**
     * Свободна ли точка экрана — то есть достанется ли касание канве.
     *
     * Спрашивается у самой страницы, а не выводится из наших представлений о
     * раскладке: над канвой живёт двумерный слой, и когда шторка уезжает вниз,
     * она ещё несколько кадров стоит между пальцем и деревней.
     */
    free: (x, y) => JSON.stringify(document.elementFromPoint(x, y) === canvasOf()),

    /**
     * Кто занял точку, если она не свободна. Без этого «в N следах точка
     * осталась под разметкой» — жалоба без имени виноватого: окно события,
     * уезжающая шторка и экран поломки сцены выглядят в таблице одинаково
     * (нулями), а лечатся по-разному.
     *
     * Обратных кавычек и типов здесь быть не может: код едет в страницу строкой
     * внутри шаблонного литерала и выполняется как есть.
     */
    who: (x, y) => {
      const el = document.elementFromPoint(x, y);
      if (!el || el === canvasOf()) return JSON.stringify('канва');
      const chain = [];
      for (let n = el; n && chain.length < 4; n = n.parentElement) {
        chain.push(n.tagName.toLowerCase() + (n.className ? '.' + String(n.className).split(' ')[0] : ''));
      }
      return JSON.stringify(chain.join(' < ') + ' — «' + (el.textContent || '').trim().slice(0, 40) + '»');
    },

    /**
     * Камера деревни числами: расстояние до цели, его пол и потолок, сама цель.
     * Своих чисел о приближении у стенда нет — пол и потолок он спрашивает у
     * сцены, а та берёт их из zoomRange.
     */
    cam: () => JSON.stringify({ dist: live().dist, min: live().zoom.min, max: live().zoom.max, tx: live().target.x, tz: live().target.z }),

    /** Точка земли под точкой экрана — ею меряется «наезд идёт к курсору». */
    ground: (x, y) => {
      const g = live().groundAt(x, y);
      return JSON.stringify(g ? { x: g.x, z: g.z } : null);
    },

    /** Что открыто сейчас. null — ничего. */
    sheet: () => {
      const sh = state().sheet;
      return JSON.stringify(sh && sh.kind === 'building' ? sh.id : null);
    },

    /** Точка мира в пикселях страницы — тем же переводом, что у областей попадания. */
    at: (x, y, z) => {
      const b = pick.projectHitBox(0, { min: { x, y, z }, max: { x, y, z } }, IDENT, live().camera, rect(), 0);
      return b && { x: b.x, y: b.y };
    },

    /** Где сейчас середина области попадания постройки — этим мерится сдвиг деревни. */
    spot: (id) => {
      const b = live().hitBoxOf(id);
      return JSON.stringify(b ? { x: b.x, y: b.y } : null);
    },

    /** Постройки: силуэт как есть и область попадания, какой её видит тап. */
    boxes: () => {
      const r = rect();
      const out = [];
      for (const b of state().s.buildings) {
        const view = live().buildings.get(b.id);
        if (!view) continue;
        view.group.updateWorldMatrix(true, false);
        const raw = view.type === 'palisade' ? null : pick.projectHitBox(b.id, view.box, view.group.matrixWorld, live().camera, r, 0);
        const area = live().hitBoxOf(b.id);
        const spot = live().screenSpot(b.id);
        out.push({ id: b.id, type: view.type, tier: view.tier, level: b.level, raw, area, spot });
      }
      return JSON.stringify(out);
    },
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

/**
 * Форма следа во времени: когда палец сходит с точки и насколько.
 *
 * Ось «когда» и есть то, чего стенду не хватало. У живого касания сход бывает
 * трёх разных пород, и правило обязано разбирать их по-разному:
 *   `сразу`   палец садится и растекается — это тап, каким бы долгим он ни был;
 *   `середина` палец повёл и остановился — это ведение;
 *   `сход`     пятно схлопывается на снятии — это тап.
 */
type When = 'сразу' | 'середина' | 'сход';

interface Shape {
  slip: number;
  when: When;
  /** Сколько всего лежит палец, мс. */
  ms: number;
}

/** Шаги следа: время от нажатия и доля схода к этому времени. */
function stepsOf(s: Shape): Array<{ at: number; k: number }> {
  if (s.slip === 0) return [];
  if (s.when === 'сразу') return [{ at: 40, k: 0.5 }, { at: 80, k: 1 }];
  if (s.when === 'середина') return [{ at: 160, k: 0.5 }, { at: 220, k: 1 }];
  return [{ at: Math.max(40, s.ms - 20), k: 1 }];
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
  // Без этого страница не считает себя сенсорной, а `dispatchTouchEvent` не
  // превращается в указатель с `pointerType: touch` — то есть идёт не тем путём.
  await tab.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
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

  // ---------- Настоящий палец ----------

  /** Сколько раз точка касания так и не освободилась — стенд об этом скажет. */
  let blocked = 0;
  /** И кто её занял в первый раз: без имени жалоба ничего не лечит. */
  let blockedBy = '';

  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Array<{ x: number; y: number }>): Promise<unknown> =>
    tab.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ ...p, radiusX: 12, radiusY: 12, force: 1 })),
    });

  /** Один след. Возвращает, что открылось, и на сколько деревня уехала под пальцем. */
  const trace = async (
    p: { id: number; x: number; y: number },
    s: Shape,
    fingers = 1,
  ): Promise<{ hit: number | null; slip: number | null }> => {
    await tab.eval<string>('window.__tap.reset()');
    // Панель от прошлого следа закрывается не мгновенно: шторка уезжает вниз
    // анимацией и, пока едет, перехватывает касания нижней половины экрана —
    // они достаются ей, а не канве, и след мерит не то. Спрашиваем прямо у
    // страницы, свободна ли точка, а не спим наугад: слепая пауза то коротка,
    // то напрасна, и таблица от неё начинала зависеть от предыдущей строки.
    let free = false;
    for (let i = 0; i < CLEAR_WAIT_MS / 20 && !free; i++) {
      free = await tab.eval<boolean>(`window.__tap.free(${p.x}, ${p.y})`);
      if (!free) await sleep(20);
    }
    if (!free) {
      blocked++;
      if (!blockedBy) blockedBy = await tab.eval<string>(`window.__tap.who(${p.x}, ${p.y})`);
    }
    const before = await tab.eval<{ x: number; y: number } | null>(`window.__tap.spot(${p.id})`);
    const dx = 0.78;
    const dy = 0.62;
    const at = (k: number): { x: number; y: number } => ({ x: p.x + s.slip * k * dx, y: p.y + s.slip * k * dy });
    const second = { x: Math.min(view.w - 6, p.x + 70), y: Math.min(view.h - 6, p.y + 70) };
    let t = 0;
    let last = at(0);
    await send('touchStart', [last]);
    if (fingers > 1) {
      await sleep(20);
      t = 20;
      await send('touchStart', [last, second]);
    }
    for (const step of stepsOf(s)) {
      await sleep(Math.max(1, step.at - t));
      t = step.at;
      last = at(step.k);
      await send('touchMove', fingers > 1 ? [last, second] : [last]);
    }
    await sleep(Math.max(1, s.ms - t));
    if (fingers > 1) await send('touchEnd', [last]);
    await send('touchEnd', []);
    await sleep(60);
    const hit = await tab.eval<number | null>('window.__tap.sheet()');
    const after = await tab.eval<{ x: number; y: number } | null>(`window.__tap.spot(${p.id})`);
    // Сдвиг деревни ОТНОСИТЕЛЬНО пальца: панорама один к одному означает ноль.
    // Прежняя панорама `OrbitControls` давала здесь единицы пикселей на тап и
    // почти треть хода на ведении по вертикали.
    const slip =
      before && after
        ? Math.hypot(after.x - before.x - (last.x - p.x), after.y - before.y - (last.y - p.y))
        : null;
    return { hit, slip };
  };

  /**
   * Один и тот же след по всем постройкам: сколько из них открыли свою панель и
   * насколько деревня разошлась с пальцем.
   *
   * Расхождение берётся серединой, а не худшим: браузер склеивает движения
   * пальца и изредка роняет порцию целиком, и по максимуму одна такая потеря
   * дала бы весь ход пальца — таблица врала бы про панораму целой строкой.
   */
  const sweep = async (s: Shape, fingers = 1): Promise<{ ok: number; slip: number }> => {
    let ok = 0;
    const slips: number[] = [];
    for (const p of points) {
      const r = await trace(p, s, fingers);
      if (r.hit === p.id) ok++;
      if (r.slip !== null) slips.push(r.slip);
    }
    slips.sort((x, y) => x - y);
    return { ok, slip: slips.length ? slips[slips.length >> 1] : 0 };
  };

  // Разогрев: самое первое касание после включения эмуляции браузер съедает.
  await send('touchStart', [{ x: 5, y: 5 }]);
  await send('touchEnd', []);
  await sleep(150);

  const cleanRuns: Array<number | null> = [];
  for (const p of points) cleanRuns.push((await trace(p, { slip: 0, when: 'сход', ms: 200 })).hit);

  const slips = [TAP_MOVE - 1, TAP_MOVE + 1, (TAP_MOVE + TAP_SLIP) >> 1, TAP_SLIP - 1, TAP_SLIP + 1];
  const whens: When[] = ['сразу', 'середина', 'сход'];
  const grid: Array<Array<{ ok: number; slip: number }>> = [];
  for (const slip of slips) {
    const row: Array<{ ok: number; slip: number }> = [];
    for (const when of whens) row.push(await sweep({ slip, when, ms: 380 }));
    grid.push(row);
  }

  // Границу `TAP_MS` щупаем с запасом в обе стороны: часы настоящие, и `sleep`
  // на десять миллисекунд точнее не бывает — проба вплотную к порогу мерила бы
  // не правило, а разброс таймера.
  const durations = [200, 420, TAP_MS - 80, TAP_MS + 80];
  const held: number[] = [];
  for (const ms of durations) held.push((await sweep({ slip: 0, when: 'сход', ms })).ok);

  const drag = await sweep({ slip: 90, when: 'середина', ms: 420 });
  const pinch = await sweep({ slip: 0, when: 'сход', ms: 240 }, 2);

  // Кладка стены и чистое поле: точки берутся из настоящей проекции кольца, а
  // «пустое место» ищется настоящим `pickBox` по тем же областям, что у сцены.
  // Камеру перед этим обязательно вернуть домой: следы выше её панорамировали, а
  // кольцо и пустое место считаются от текущего ракурса — на уехавшей камере
  // «пустая» точка оказывалась посреди двора, и стенд ловил там ферму.
  await tab.eval<string>('window.__tap.reset()');
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
  const emptyHit = empty ? (await trace({ id: -1, ...empty }, { slip: 0, when: 'сход', ms: 200 })).hit : null;
  const ringHit = onRing ? (await trace({ id: -1, ...onRing }, { slip: 0, when: 'сход', ms: 200 })).hit : null;

  const after = await tab.eval<Box[]>('window.__tap.boxes()');
  const rebuilt = await tab.eval<number>('window.__tap.rebuilds()');
  const drift = boxes.reduce((m, b) => {
    const now = after.find((x) => x.id === b.id);
    return b.area && now?.area ? Math.max(m, Math.hypot(b.area.x - now.area.x, b.area.y - now.area.y)) : m;
  }, 0);

  // ---------- Мышь ----------
  //
  // Колесо и кнопку мыши стенд щупает отдельно и последними, и это не прихоть:
  // на телефоне их нет вовсе, а на ПК ими и играют. Проверка появилась после
  // того, как вместе с OrbitControls из деревни молча пропало колесо — касания
  // при этом работали, и стенд был зелёным.
  //
  // Тач-эмуляция на время этого раздела снимается: с ней Chrome отдаёт мышь
  // странице не тем путём, и мы мерили бы не то, чем играют за столом.
  await tab.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await tab.eval<string>('window.__tap.reset()');

  interface Cam {
    dist: number;
    min: number;
    max: number;
    tx: number;
    tz: number;
  }
  const camNow = (): Promise<Cam> => tab.eval<Cam>('window.__tap.cam()');
  const groundAt = (x: number, y: number): Promise<{ x: number; z: number } | null> =>
    tab.eval<{ x: number; z: number } | null>(`window.__tap.ground(${x}, ${y})`);
  const wheel = (x: number, y: number, deltaY: number): Promise<unknown> =>
    tab.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY, button: 'none', clickCount: 0 });
  const mouse = (type: 'mousePressed' | 'mouseReleased' | 'mouseMoved', x: number, y: number, held: boolean): Promise<unknown> =>
    tab.send('Input.dispatchMouseEvent', {
      type,
      x,
      y,
      button: 'left',
      buttons: held ? 1 : 0,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });

  // Целимся туда же, куда целился палец: в постройку, а не в пустое место.
  const aim = points[0] ?? { x: Math.round(view.w / 2), y: Math.round(view.h / 2), id: -1 };
  const camBefore = await camNow();
  const groundBefore = await groundAt(aim.x, aim.y);
  await wheel(aim.x, aim.y, -120);
  await sleep(60);
  const camIn = await camNow();
  const groundAfter = await groundAt(aim.x, aim.y);
  const cursorSlip =
    groundBefore && groundAfter ? Math.hypot(groundBefore.x - groundAfter.x, groundBefore.z - groundAfter.z) : null;

  for (let i = 0; i < 40; i++) await wheel(aim.x, aim.y, -120);
  await sleep(60);
  const camFloor = await camNow();
  for (let i = 0; i < 60; i++) await wheel(aim.x, aim.y, 120);
  await sleep(60);
  const camCeil = await camNow();

  // Ведение мышью с зажатой кнопкой: деревня едет, панель не открывается.
  await tab.eval<string>('window.__tap.reset()');
  const camDragFrom = await camNow();
  await mouse('mousePressed', aim.x, aim.y, false);
  for (let i = 1; i <= 8; i++) {
    await mouse('mouseMoved', aim.x - i * 10, aim.y - i * 8, true);
    await sleep(12);
  }
  await mouse('mouseReleased', aim.x - 80, aim.y - 64, false);
  await sleep(80);
  const camDragTo = await camNow();
  const dragMoved = Math.hypot(camDragTo.tx - camDragFrom.tx, camDragTo.tz - camDragFrom.tz);
  const dragOpened = await tab.eval<number | null>('window.__tap.sheet()');

  // Клик мышью по постройке: открывается её панель.
  await tab.eval<string>('window.__tap.reset()');
  await mouse('mousePressed', aim.x, aim.y, false);
  await sleep(40);
  await mouse('mouseReleased', aim.x, aim.y, false);
  await sleep(80);
  const clickOpened = await tab.eval<number | null>('window.__tap.sheet()');

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
  console.log(`  палец настоящий: Input.dispatchTouchEvent, тач-эмуляция, часы не подменены`);
  console.log(`  WebGL нет: контекст подделан${view.fake ? '' : ' — НО ЗАГЛУШКА НЕ ВСТАЛА'}, кадр не рисуется, снимок отсюда чёрный`);
  console.log(
    `  пороги: камера с ${TAP_MOVE} px, тап живёт до ${TAP_SLIP} px и ${TAP_MS} мс, цель ${TAP_TARGET} px, прощение ${TAP_FORGIVE} px`,
  );
  // Камера обязана возвращаться на место после каждого следа: уехавшая панорама
  // тихо сдвинула бы все области, и таблица начала бы зависеть от порядка строк.
  if (drift > 0.5) console.log(`  ВНИМАНИЕ: за все следы камера уехала на ${drift.toFixed(1)} px — числа ниже поплыли`);
  // Точка под пальцем обязана принадлежать канве: иначе след достался разметке,
  // а не деревне, и клетка ниже означает не «не открылось», а «не докоснулись».
  if (blocked > 0) {
    console.log(`  ВНИМАНИЕ: в ${blocked} следах точка касания осталась под разметкой — эти следы не в счёт`);
    console.log(`  первым её занял: ${blockedBy}`);
  }
  // Пересборка сцены посреди прогона — не мелочь: числа сняты с разных сцен, а
  // «новая сцена — новая канва», то есть след мог уйти не туда, куда смотрел стенд.
  if (rebuilt > 0) console.log(`  ВНИМАНИЕ: сцена пересобиралась ${rebuilt} раз(а) за прогон — числа ниже сняты не с одной сцены`);
  console.log('');

  console.log(`  ${pad('Постройка', 22)}${padL('силуэт', 9)}${padL('область', 9)}${padL('центр', 12)}   чистый тап`);
  for (const b of [...aimed].sort((a, c) => (a.raw?.hw ?? 0) * (a.raw?.hh ?? 0) - (c.raw?.hw ?? 0) * (c.raw?.hh ?? 0))) {
    const at = `${px(b.area!.x)},${px(b.area!.y)}`;
    const got = cleanRuns[points.findIndex((p) => p.id === b.id)];
    console.log(
      `  ${pad(nameOf(b.type) + (LEVEL > 1 ? ` ${b.level}` : ''), 22)}${padL(size(b.raw), 9)}${padL(size(b.area), 9)}${padL(at, 12)}   ${label(got, b.id)}`,
    );
  }
  if (wall) console.log(`  ${pad(nameOf(wall.type), 22)}${padL('кольцо', 9)}${padL('кольцо', 9)}${padL('—', 12)}   ниже, отдельной строкой`);
  if (offscreen.length) {
    console.log(`\n  за кадром (центр вне канвы — до них надо довести камеру): ${offscreen.map((b) => nameOf(b.type)).join(', ')}`);
  }

  console.log(`\n  Сход пальца: сколько построек из ${points.length} открыли свою панель`);
  console.log(`  Столбцы — КОГДА палец сошёл с точки. Этой оси стенду и не хватало:`);
  console.log(`  живой палец растекается в первые 80 мс, и это тап, а не ведение.`);
  console.log(`  ${pad('сход \\ когда', 22)}${whens.map((w) => padL(w, 12)).join('')}`);
  for (let i = 0; i < slips.length; i++) {
    const cells = grid[i].map((c) => padL(String(c.ok), 12)).join('');
    console.log(`  ${pad(`${slips[i]} px`, 22)}${cells}`);
  }
  console.log(`  (палец лежит 380 мс во всех клетках; «сразу» — 0–80 мс, «середина» — 160–220 мс, «сход» — за 20 мс до снятия)`);

  console.log(`\n  Деревня под пальцем: на сколько она разошлась с пальцем, px — середина по постройкам`);
  console.log(`  Панорама один к одному даёт ноль; мёртвая зона в ${TAP_MOVE} px даёт столько же и не больше.`);
  console.log(`  ${pad('сход \\ когда', 22)}${whens.map((w) => padL(w, 12)).join('')}`);
  for (let i = 0; i < slips.length; i++) {
    const cells = grid[i].map((c) => padL(c.slip.toFixed(0), 12)).join('');
    console.log(`  ${pad(`${slips[i]} px`, 22)}${cells}`);
  }

  console.log(`\n  Сколько палец лежит (без схода)`);
  console.log(`  ${pad('', 22)}${durations.map((d) => padL(`${d} мс`, 9)).join('')}`);
  console.log(`  ${pad('открылось', 22)}${held.map((n) => padL(String(n), 9)).join('')}`);

  console.log(`\n  Прочее`);
  console.log(`  ${pad('ведение 90 px ровным ходом', 52)}${padL(`${drag.ok} из ${points.length}`, 10)}`);
  console.log(`  ${pad('  оно же: деревня разошлась с пальцем', 52)}${padL(`${drag.slip.toFixed(0)} px`, 10)}`);
  console.log(`  ${pad('щипок вторым пальцем', 52)}${padL(`${pinch.ok} из ${points.length}`, 10)}`);
  if (empty) {
    console.log(`  ${pad(`тап в чистое поле (${px(empty.x)},${px(empty.y)})`, 52)}${padL(label(emptyHit, -1), 10)}`);
  }
  if (onRing) {
    const b = ringHit === null ? null : boxes.find((x) => x.id === ringHit);
    console.log(
      `  ${pad(`тап по кладке стены (${px(onRing.x)},${px(onRing.y)})`, 52)}${padL(b ? nameOf(b.type) : '— ничего', 10)}`,
    );
  }

  console.log(`
  МЫШЬ (ПК): Input.dispatchMouseEvent, тач-эмуляция снята`);
  console.log(`  Колесо и кнопка — то, чего у телефона нет: их отсутствие стенд без этого раздела не заметил бы.`);
  const ratio = camIn.dist > 0 ? camBefore.dist / camIn.dist : 0;
  console.log(
    `  ${pad('колесо на себя (один щелчок)', 52)}${padL(`${camBefore.dist.toFixed(1)} → ${camIn.dist.toFixed(1)} = ×${ratio.toFixed(3)}`, 22)}   ждали ×${WHEEL_STEP.toFixed(3)}`,
  );
  console.log(
    `  ${pad('земля под курсором на месте', 52)}${padL(cursorSlip === null ? 'не знаю' : `${cursorSlip.toFixed(2)} мира`, 22)}   ждали 0`,
  );
  console.log(
    `  ${pad('колесо до упора: пол и потолок', 52)}${padL(`${camFloor.dist.toFixed(2)} и ${camCeil.dist.toFixed(2)}`, 22)}   ждали ${camFloor.min.toFixed(2)} и ${camCeil.max.toFixed(2)}`,
  );
  console.log(
    `  ${pad('ведение с зажатой кнопкой', 52)}${padL(`деревня на ${dragMoved.toFixed(1)}`, 22)}   панель: ${dragOpened === null ? 'не открылась' : label(dragOpened, aim.id)}`,
  );
  console.log(`  ${pad('клик по постройке', 52)}${padL(label(clickOpened, aim.id), 22)}`);
  console.log('');
}

await main();
