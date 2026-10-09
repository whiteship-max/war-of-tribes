// Бюджет кадра карты: сколько стоит нарисовать отряды и сколько их вообще бывает.
//
// Отчёт заведён под один вопрос: карта показывает движущиеся отряды, и надо
// знать, во что это обходится на телефоне. Гадать тут нечем — «пара спрайтов,
// должно быть дёшево» — это не число, а надежда.
//
// Меряется три вещи, и первые две без браузера:
//
//   отряды    сколько людей ходит по карте на самом деле. Из этого выведены
//             пороги лестницы `PARTY_STEPS` в `ui/map/party.ts`: горстка,
//             ватага, войско, орда. Числа берутся из настоящего мира, а не
//             назначаются;
//   толчея    сколько отрядов бывает видно разом — худший случай, который мир
//             вообще способен выдать. Он-то и есть бюджет: рисовать больше
//             нечего;
//   кадр      сколько миллисекунд стоит `drawFrame` в настоящем Chrome, на
//             телефонном кадре (375×812, dpr 2) и на широком (1280×800, dpr 1),
//             при нуле отрядов, при худшем случае и при заведомом перегрузе;
//   кэш       сколько тайлов кадр просит у кэша земли в худшем положении камеры и
//             сколько памяти земля может занять — по экранам, счётом из тех же
//             функций, которыми просит кадр (`grid.cacheFor`);
//   бросок    выпечка тайла, рывки при броске и кадр стоя на закреплённом мире,
//             на этой машине и на замедлении ×4 и ×6 (`lib/flight.ts`). Выпечек
//             стоя обязано быть ноль: иначе кэш перепекает то, что кадр просит.
//
// Кадр меряется изнутри страницы, а не по частоте: частота упёрта в шестьдесят
// и запаса не показывает. Часы включает флаг `?probe=1` (`src/debug.ts`), и в
// обычной игре в кадре от них остаётся одна проверка булева.
//
// **Смотреть надо на разницу, а не на медиану.** Абсолютное время кадра гуляет
// на три-четыре десятых миллисекунды от того, чем ещё занята машина, — а сам
// кадр стоит около одной. Поэтому в таблице рядом с медианой стоит столбец
// «отряды»: медиана минус медиана пустого кадра в том же прогоне. Он-то и
// повторяется от запуска к запуску, и по нему судят, подорожало рисование или
// нет. Правило то же, что у любого замера на шумной машине: сравнивают внутри
// одного прогона, а не между.
//
// Мир на время замера **замораживается**: пульс подменяется пустышкой, и отряды
// подкладываются в стор руками. Иначе мерили бы не рисование, а то, что мир
// успел сгенерировать, — а он держит один чужой отряд на деревню и один мимо
// неё, и толчеи в нём не бывает по устройству.
//
// Миллисекунды, кадры и доли длинных кадров стоят в выводе в `‹…›` (`lib/measured.ts`):
// при сверке они не сравниваются. Люди на карте, пороги лестницы, запрос кадра к кэшу,
// выпечки стоя и различимость агентов — свойства кода и обязаны совпасть.
//
// Запуск: npm run map:report   (нужен собранный dist: npm run build)
// Переменные: PORT=4191  CDP_PORT=9334  CHROME=путь\к\chrome.exe  HEAD=1  SECONDS=3
// Вид карты один — по регионам (docs/map_tw.md); прежняя карта и `MAP=old` удалены (docs/ui_audit.md, 16).
// QUALITY=low|medium|high — уровень качества адресом (`?quality=`, `tw/quality.twQuality`); без переменной — «Авто», как
// у игрока.
// MOTION=1 — только раздел «карта в движении» (docs/map_tw.md, раздел 11): цена кадра в броске, стоя, в щипке
// от ближнего масштаба к дальнему и в броске издали, ×1 и ×4 (`lib/flight.ts`). Это замер руками, а не
// приёмка: остальные разделы не гоняются, браузер — один заход до двух минут, перед ним видеокарта остывает
// минуту от прошлого захода (`budget.gpuCoolDown`). Сравнивать — прогоны с разными `QUALITY`.
// PREBAKE=page — новый вид без рабочего потока: регион печёт страница сама, по кадрам и стоя (docs/map_tw.md, 13.4).
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { launchChrome, sleep, Tab } from './lib/chrome';
import { measure as live } from './lib/measured';
import { PINNED_HOME, PINNED_SEED } from './lib/pinned';
import { FAR_SCALE, type Flight, LONG_FRAME, MOTION_SLOWS, PINCH, measureFlight, printFlight, printMotion } from './lib/flight';
import { gpuCoolDown, gpuStamp } from './lib/budget';
import { qualityOf } from '@/render/quality';
import { TILE_CEILING, cacheFor, tileMemory, worstRequest } from '@/ui/map/grid';
import { SPARE_CELLS, TILE_PROMISE } from '@/ui/map/const';
import { LocalWorld } from '@/world/local/LocalWorld';
import type { MarchView, PlayerProfile } from '@/world/types';
import { PARTY_STEPS, partyMen, sizeOf, type PartySize } from '@/ui/map/party';
import { AGENT_MIN } from '@/ui/map/agent';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const PORT = Number(process.env.PORT ?? 4191);
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9334);
/** Сколько секунд кадров снимать на каждый случай. Трёх хватает на две сотни кадров. */
const SECONDS = Number(process.env.SECONDS ?? 3);

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

// ---------- Часть первая: сколько людей ходит по карте ----------

/**
 * Три точки дуги партии. Силу набега решают жители города и возраст логова
 * (`lairs.lairPower`), а с малого города логово не выходит вовсе (`lairShield`);
 * поэтому у этапов разный не только профиль, но и горизонт прогона.
 */
const STAGES = [
  { name: 'начало', pop: 60, defense: 46, hours: 5 },
  { name: 'середина', pop: 300, defense: 220, hours: 5 },
  { name: 'потолок', pop: 755, defense: 720, hours: 15 },
];

/** Шаг прогона: двадцать секунд — мельче мир всё равно ничего не решает. */
const STEP = 20_000;
const SEEDS = [11, 42, 77, 101, 202, 303];

const profileFor = (st: (typeof STAGES)[number]): PlayerProfile => ({
  name: 'Стенд',
  pop: st.pop,
  defense: st.defense,
  units: { warrior: Math.round(st.defense / 4), scout: 6 },
  army: { legionary: Math.round(st.defense / 6) },
  warning: 120,
  stock: { food: 400, wood: 300 },
  stash: 0,
});

interface Crowd {
  stage: string;
  /** Сколько **разных** чужих отрядов встретилось. Не по пульсам: тот же отряд
   *  виден десятки раз подряд, и счёт по пульсам мерил бы длину дороги. */
  seen: number;
  /** Людей в отряде: наименьший, срединный, наибольший. */
  men: [number, number, number];
  /** Как эти отряды раскладываются по ступеням лестницы. */
  steps: Record<PartySize, number>;
  /** Больше всего отрядов, видных разом. Это и есть бюджет: больше не бывает. */
  peak: number;
}

const median = (a: number[]): number => (a.length === 0 ? 0 : [...a].sort((x, y) => x - y)[a.length >> 1]);

/**
 * Прогон мира: набеги, войны соседей, осады и выручка. Толчея набирается именно
 * тут — одиночный набег её не даёт, а верхнюю границу надо знать настоящую.
 */
async function crowdOf(stage: (typeof STAGES)[number]): Promise<Crowd> {
  const p = profileFor(stage);
  const steps: Record<PartySize, number> = { rumor: 0, small: 0, band: 0, host: 0, horde: 0 };
  const men: number[] = [];
  let peak = 0;
  const rounds = Math.round((stage.hours * 3600_000) / STEP);
  for (const seed of SEEDS) {
    let now = 1_700_000_000_000;
    const world = new LocalWorld({ seed, now: () => now, storage: null });
    const counted = new Set<string>();
    for (let i = 0; i < rounds; i++) {
      now += STEP;
      const pulse = await world.sync(p);
      peak = Math.max(peak, pulse.marches.length);
      for (const m of pulse.marches as MarchView[]) {
        if (m.own || counted.has(m.id)) continue;
        counted.add(m.id);
        const n = partyMen(m.units);
        men.push(n);
        steps[sizeOf(n)]++;
      }
    }
  }
  const sorted = [...men].sort((a, b) => a - b);
  return {
    stage: stage.name,
    seen: men.length,
    men: [sorted[0] ?? 0, median(men), sorted[sorted.length - 1] ?? 0],
    steps,
    peak,
  };
}

// ---------- Часть вторая: кадр в настоящем Chrome ----------

/**
 * Что подкладывается странице. Не код игры — в бандл он не попадает ни при каком
 * раскладе, поэтому и живёт строкой.
 *
 * `__freeze` подменяет пульс пустышкой: zustand берёт действие из состояния при
 * каждом вызове, поэтому подмена работает и таймер перестаёт затирать отряды.
 */
const PROBE = `
(() => {
  const W = () => window.__world;
  window.__freeze = () => {
    W().setState({ pulse: async () => {} });
    return JSON.stringify('ok');
  };
  /**
   * Отряды сеткой вокруг деревни, шагом в клетку: худший случай — это когда все
   * они на экране, а не когда половина за кромкой. Размеры идут по кругу через
   * всю лестницу, стороны чередуются: так в кадре оказываются все виды спрайта.
   */
  window.__parties = (n) => {
    const home = W().getState().info.home;
    const now = Date.now();
    const marches = [];
    const side = Math.max(1, Math.ceil(Math.sqrt(n)));
    for (let i = 0; i < n; i++) {
      const gx = (i % side) - (side - 1) / 2;
      const gy = Math.floor(i / side) - (side - 1) / 2;
      const at = { x: Math.round(home.x + gx), y: Math.round(home.y + gy) };
      const hostile = i % 2 === 1;
      marches.push({
        id: 'perf' + i,
        mission: 'raid',
        units: { warrior: [4, 12, 40, 200][i % 4] },
        own: !hostile,
        hostile,
        phase: i % 7 === 6 ? 'stay' : 'out',
        from: { x: at.x - 6, y: at.y - 4 },
        to: { x: at.x + 6, y: at.y + 4 },
        fromName: 'Стенд',
        toName: 'Стенд',
        targetId: 'perf' + i,
        departAt: now - 120000,
        arriveAt: now + 120000,
        loot: null,
        recallable: false,
      });
    }
    W().setState({ marches });
    return JSON.stringify(marches.length);
  };
  window.__army = (men) => {
    const g = W().getState();
    W().setState({
      figures: g.figures.map((f) =>
        f.id === 'general' ? { ...f, troops: { legionary: men }, phase: 'moving' } : f,
      ),
    });
    return JSON.stringify('ok');
  };
  /**
   * Насколько силуэты агентов похожи друг на друга. Подписей под фигурами нет,
   * и опознание держится только на форме — а «держится» это или нет, вопрос
   * числа, а не мнения.
   *
   * Меряется двумя мерками сразу, и обе нужны.
   *
   *   пятно     совпадение залитых силуэтов (IoU) по всем шести парам. Порог
   *             тот же, что у видов бойцов в трёхмерной сцене (SAME = 0.85,
   *             render/units.test.ts): выше него две фигуры — одно пятно;
   *   признак   то, чем они разведены по замыслу: полководец выше всех,
   *             лазутчик уже всех, разведчик шире всего в шляпе (доля высоты,
   *             на которой лежит самая широкая строка, у него близка к
   *             единице), дипломат — у ног. Признак, ставший меньше двух
   *             пикселей, — это не признак: столько съедает сглаживание.
   *
   * Печём напрямую (window.__bakeAgent), мимо корзин: надо видеть и то, что
   * было бы ниже пола agentUnit, — иначе запас не назвать числом. Обратных
   * кавычек в этой строке быть не может: она сама шаблонная, и любая из них
   * рвёт файл (ошибка вылезет за сотни строк отсюда).
   */
  window.__silhouettes = (sizes) => {
    const KINDS = ['scout', 'diplomat', 'spy', 'general'];
    const grab = (kind, px) => {
      const sp = window.__bakeAgent({ kind, west: false }, px, 1);
      const cv = sp.canvas;
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      const W = cv.width;
      const H = cv.height;
      const m = new Uint8Array(W * H);
      const rowW = new Array(H).fill(0);
      let top = -1;
      for (let y = 0; y < H; y++) {
        let l = W;
        let r = -1;
        for (let x = 0; x < W; x++) {
          if (d[(y * W + x) * 4 + 3] > 100) {
            m[y * W + x] = 1;
            if (x < l) l = x;
            if (x > r) r = x;
          }
        }
        rowW[y] = r < 0 ? 0 : r - l + 1;
        if (r >= 0 && top < 0) top = y;
      }
      // Ниже линии земли лежит тень: в силуэт фигуры она не входит.
      const g = Math.round(sp.ay);
      let wide = 0;
      let wideY = top;
      for (let y = top; y < g - 1; y++) if (rowW[y] > wide) { wide = rowW[y]; wideY = y; }
      return { m, h: g - top, wide, at: (g - wideY) / Math.max(1, g - top) };
    };
    const iou = (a, b) => {
      let i = 0;
      let u = 0;
      for (let k = 0; k < a.m.length; k++) {
        const x = a.m[k];
        const y = b.m[k];
        if (x | y) u++;
        if (x & y) i++;
      }
      return u ? i / u : 1;
    };
    const rows = sizes.map((px) => {
      const f = {};
      for (const k of KINDS) f[k] = grab(k, px);
      let worst = 0;
      let pair = '';
      for (let i = 0; i < KINDS.length; i++) {
        for (let j = i + 1; j < KINDS.length; j++) {
          const v = iou(f[KINDS[i]], f[KINDS[j]]);
          if (v > worst) { worst = v; pair = KINDS[i] + '/' + KINDS[j]; }
        }
      }
      const others = KINDS.filter((k) => k !== 'general');
      return {
        px,
        iou: worst,
        pair,
        // Полководец выше следующего за ним — на сколько пикселей.
        taller: f.general.h - Math.max(...others.map((k) => f[k].h)),
        // Лазутчик уже следующего за ним.
        thinner: Math.min(...KINDS.filter((k) => k !== 'spy').map((k) => f[k].wide)) - f.spy.wide,
        // Доля высоты, на которой у разведчика лежит самая широкая строка:
        // единица — макушка, ноль — земля. Шляпа обязана держать её у верха.
        hat: f.scout.at,
        // У дипломата та же доля обязана лежать у самой земли: он колокол.
        hem: f.diplomat.at,
      };
    });
    return JSON.stringify(rows);
  };
  // Цена кадра — на сотнях кадров: стоящая карта рисует только по изменению, и отчёт просит её рисовать каждый кадр
  // (WorldMap.probeAlways, docs/perf.md, решение 9).
  window.__mapAlways = true;
  window.__take = () => JSON.stringify(window.__mapPerf());
  window.__ready = () => JSON.stringify({ map: window.__game.getState().mapOpen, world: !!window.__world });
  return JSON.stringify('ok');
})()
`;

interface Shot {
  view: string;
  parties: number;
  frames: number;
  median: number;
  p95: number;
  max: number;
  /** Медиана минус медиана пустого кадра того же прогона. Это и есть цена отрядов. */
  cost: number;
}

const pct = (a: number[], q: number): number => (a.length === 0 ? 0 : [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))]);

const VIEWS = [
  { name: 'телефон 375×812', w: 375, h: 812, dpr: 2, mobile: true },
  { name: 'широкий 1280×800', w: 1280, h: 800, dpr: 1, mobile: false },
];

async function frames(tab: Tab, view: (typeof VIEWS)[number], counts: number[]): Promise<Shot[]> {
  await tab.send('Emulation.setDeviceMetricsOverride', {
    width: view.w,
    height: view.h,
    deviceScaleFactor: view.dpr,
    mobile: view.mobile,
  });
  // Земля печётся по тайлу за кадр: пока она не улеглась, кадр меряет выпечку,
  // а не отряды. Полторы секунды на два десятка тайлов хватает с запасом.
  await sleep(2500);
  const out: Shot[] = [];
  let base = 0;
  for (const n of counts) {
    await tab.eval<number>(`window.__parties(${n})`);
    await tab.eval<string>(`window.__army(${n > 0 ? 120 : 0})`);
    // Первые кадры после подкладки печут спрайты новых видов: это разовая
    // работа, и мешать её с ценой кадра нельзя.
    await sleep(600);
    await tab.eval<number[]>('window.__take()');
    await sleep(SECONDS * 1000);
    const costs = await tab.eval<number[]>('window.__take()');
    const mid = median(costs);
    if (n === counts[0]) base = mid;
    out.push({
      view: view.name,
      parties: n,
      frames: costs.length,
      median: mid,
      p95: pct(costs, 0.95),
      max: Math.max(0, ...costs),
      cost: mid - base,
    });
  }
  return out;
}

/** Строка таблицы силуэтов: сколько пикселей на единицу и что из этого вышло. */
interface Look {
  px: number;
  iou: number;
  pair: string;
  taller: number;
  thinner: number;
  hat: number;
  hem: number;
}

/**
 * Порог слияния — тот же, что у видов бойцов в трёхмерной сцене (`SAME` в
 * `render/units.test.ts`). Одна мерка на два разных силуэта в одной игре:
 * второй порог означал бы и второе мнение о том, что такое «одно пятно».
 */
const SAME = 0.85;
/** Признак мельче двух пикселей — это не признак: столько съедает сглаживание. */
const FEATURE_MIN = 2;

/** Размеры, на которых меряются силуэты. Ниже пола `agentUnit` — нарочно. */
const LOOK_SIZES = [10, 14, 18, 22, 26, 30, 38, 48, 60];

/** Вид словами — шапкам разделов. Вид один: прежняя карта удалена вместе с переключателем (docs/ui_audit.md, 16). */
const LOOK_NAME = 'карта по регионам (вид один)';

/** Уровень качества адресом (`QUALITY=`); пусто — «Авто». Неизвестное слово — ошибка, а не молчаливое «Авто». */
const QUALITY = ((): string => {
  const asked = process.env.QUALITY;
  if (!asked) return '';
  const q = qualityOf(asked);
  if (!q) throw new Error(`QUALITY=${asked}: уровни — low, medium, high`);
  return q;
})();

/**
 * `PREBAKE=page` — карта по регионам без рабочего потока (docs/map_tw.md, раздел 13.4): страница печёт регион сама,
 * по кадрам и только стоя, — так, как на Safari до 16.4, где `OffscreenCanvas` в потоке нет.
 */
const PREBAKE = process.env.PREBAKE === 'page' ? '&prebake=page' : '';

/** Хвост адреса страницы: уровень и путь выпечки. Без переменных — пусто. */
const VIEW = (QUALITY ? `&quality=${QUALITY}` : '') + PREBAKE;

/** Карта в движении (`MOTION=1`): только этот раздел. */
const MOTION = process.env.MOTION === '1';

async function measure(counts: number[]): Promise<{ shots: Shot[]; looks: Look[]; flown: Flight[] }> {
  // Без потолка кадров отчёта (`budget.REPORT_FPS`): этот отчёт меряет цену кадра карты на потолке самой игры.
  const tab = await Tab.open(DEBUG_PORT, `http://127.0.0.1:${PORT}/?probe=1${VIEW}`);
  await tab.eval<string>('(() => { try { localStorage.clear(); } catch (e) {} return JSON.stringify("ok"); })()');
  await tab.send('Page.reload');
  await sleep(4000);
  await tab.eval<string>(PROBE);
  await tab.eval<string>('(() => { window.__game.getState().openMap(); return JSON.stringify("ok"); })()');
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    const r = await tab.eval<{ map: boolean; world: boolean }>('window.__ready()');
    if (r.map && r.world) break;
  }
  await tab.eval<string>('window.__freeze()');

  // Силуэты меряются до кадров: они ничего не двигают и не зависят от вида
  // экрана — это чистая выпечка, — а после прогонов вкладка уже закрыта.
  const looks = await tab.eval<Look[]>(`window.__silhouettes(${JSON.stringify(LOOK_SIZES)})`);

  const out: Shot[] = [];
  for (const view of VIEWS) out.push(...(await frames(tab, view, counts)));
  tab.close();
  await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/close/${tab.target}`);
  // Бросок и стоянка — своей вкладкой и общим замером (`lib/flight.ts`): им же меряют
  // сборки «до и после», и копии замера расходиться не с чем.
  const flown = await measureFlight(DEBUG_PORT, `http://127.0.0.1:${PORT}/?probe=1&worldview=open${VIEW}`, (line) =>
    console.log(line),
  );
  return { shots: out, looks, flown };
}

/**
 * Карта в движении (`MOTION=1`): один заход браузера, только бросок, стоянка, щипок и бросок издали — цена
 * кадра карты в каждом проходе. Заход руками, поэтому по правилам стенда: перед ним видеокарта остывает
 * минуту от конца прошлого захода, после — отметка конца (`budget.gpuCoolDown`, `gpuStamp`).
 */
async function motionMain(): Promise<void> {
  console.log('\n=== карта в движении ===\n');
  console.log(`Вид: ${LOOK_NAME}; уровень качества: ${QUALITY || 'Авто'}${PREBAKE ? '; регион печёт страница (без потока)' : ''}.`);
  console.log(`Мир закреплён (дом ${PINNED_HOME.x}|${PINNED_HOME.y}, сид ${PINNED_SEED}), экран телефона 375×812 @2, потолок игры — 60 кадров.`);
  console.log('Кадр — время drawFrame, мс: вся карта за кадр, с выпечкой, если она пришлась на этот кадр.');
  console.log(`Бросок — спираль у дома на 44 px на клетку; стоя — дома после броска; щипок — ${PINCH.near} → ${PINCH.far} → ${PINCH.near} px`);
  console.log(`на клетку за бросок, середина дрейфует к востоку на ${PINCH.drift} клетки в секунду; издали — та же спираль на`);
  console.log(`${FAR_SCALE} px на клетку. Щипок и бросок издали — с карты, открытой заново: испечённое закрытая карта выбросила.`);
  console.log(`«Длинных» — интервалов между кадрами дольше ${LONG_FRAME} мс. ×${MOTION_SLOWS.join(', ×')} — замедление процессора; растр на GPU`);
  console.log('оно не тормозит. Выпечка тайла — ближнего масштаба, в броске.\n');
  await gpuCoolDown('замером карты в движении');
  const server = serveDist();
  const chrome = await launchChrome(DEBUG_PORT, ['--window-size=1400,900', '--force-device-scale-factor=1']);
  let flown: Flight[] = [];
  try {
    flown = await measureFlight(DEBUG_PORT, `http://127.0.0.1:${PORT}/?probe=1&worldview=open${VIEW}`, (line) => console.log(line), {
      motion: true,
    });
  } finally {
    chrome.kill();
    gpuStamp();
    server.close();
    await sleep(300);
  }
  printMotion(flown);
}

// ---------- Печать ----------

const pad = (s: string, n: number): string => s.padEnd(n);
const num = (v: number, n: number, d = 2): string => v.toFixed(d).padStart(n);

async function main(): Promise<void> {
  console.log('\n=== сколько людей ходит по карте ===\n');
  console.log('Пороги лестницы отрядов:', PARTY_STEPS.join(' / '), '— горстка / ватага / войско / орда\n');
  console.log(
    `${pad('этап', 10)} ${pad('часов', 6)} ${pad('отрядов', 8)} ${pad('людей мин/сред/макс', 20)} ${pad('горстка/ватага/войско/орда', 27)} разом`,
  );
  const crowds: Crowd[] = [];
  for (const st of STAGES) {
    const c = await crowdOf(st);
    crowds.push(c);
    const by = `${c.steps.small}/${c.steps.band}/${c.steps.host}/${c.steps.horde}`;
    console.log(
      `${pad(c.stage, 10)} ${String(st.hours).padStart(5)} ${String(c.seen).padStart(8)} ${`${c.men[0]}/${c.men[1]}/${c.men[2]}`.padStart(20)} ${pad(by, 27)} ${c.peak}`,
    );
  }
  const peak = Math.max(...crowds.map((c) => c.peak));
  console.log(`\nХудший случай мира: ${peak} отрядов разом плюс четыре фигуры игрока.`);
  console.log('Мир держит один чужой отряд на деревню, один мимо неё и по одному на выручку');
  console.log('каждому осаждённому — толчеи в нём не бывает по устройству, и это не догадка,');
  console.log('а верхняя граница шести сидов на двадцати пяти игровых часах.');
  console.log('Своё войско в эту таблицу не входит: его размер задаёт Статуя, и он идёт на');
  console.log('сотни — верхняя ступень лестницы заведена под него.');

  console.log('\n=== кадр карты ===\n');
  console.log(`Вид карты: ${LOOK_NAME}.`);
  const counts = [0, Math.max(10, peak + 4), 40];
  console.log(`Случаи: пусто / ${counts[1]} (худший случай мира с запасом) / 40 (заведомый перегруз).\n`);
  const server = serveDist();
  const chrome = await launchChrome(DEBUG_PORT, ['--window-size=1400,900', '--force-device-scale-factor=1']);
  let shots: Shot[] = [];
  let looks: Look[] = [];
  let flown: Flight[] = [];
  try {
    ({ shots, looks, flown } = await measure(counts));
  } finally {
    chrome.kill();
    server.close();
    await sleep(300);
  }

  console.log(
    `${pad('вид', 18)} ${pad('отрядов', 8)} ${pad('кадров', 7)} ${pad('медиана', 8)} ${pad('p95', 8)} ${pad('макс', 8)} ${pad('отряды', 8)} на отряд, мс`,
  );
  for (const s of shots) {
    const per = s.parties > 0 ? (s.cost / s.parties).toFixed(3).padStart(12) : ''.padStart(12);
    console.log(
      `${pad(s.view, 18)} ${String(s.parties).padStart(7)} ${live(String(s.frames).padStart(7))} ${live(num(s.median, 8))} ${live(num(s.p95, 8))} ${live(num(s.max, 8))} ${live(num(s.cost, 8))} ${per.trim() ? live(per) : per}`,
    );
  }
  const worst = shots.filter((s) => s.parties === counts[1]);
  console.log('\nСмотреть надо на столбец «отряды» — медиану минус медиану пустого кадра того же');
  console.log('прогона. Абсолютное время гуляет на три-четыре десятых от того, чем занята машина,');
  console.log('а весь кадр стоит около миллисекунды; разница же внутри прогона повторяется.');
  console.log('Худший случай мира стоит:', worst.map((s) => `${s.view.split(' ')[0]} ${live(s.cost.toFixed(2))} мс`).join(', ') + '.');
  console.log('Бюджет кадра при шестидесяти в секунду — 16.7 мс, и в нём лежит не только карта.');
  console.log('Кадров нет вовсе — значит страница не рисовалась: см. docs/handbook/deploy.md, «Стенд в проде».');

  console.log('\n=== кэш земли: сколько кадр просит ===\n');
  console.log(`Кадр просит экран и запас в ${SPARE_CELLS} клетки вокруг; ёмкость кэша выводится из худшего`);
  console.log('положения камеры у нижнего края полосы перехода (grid.worstRequest) и не больше, чем');
  console.log(`на обещанном экране ${TILE_PROMISE.w}×${TILE_PROMISE.h} (потолок ${TILE_CEILING} тайлов).`);
  console.log('Память — ёмкость, пул и черновик: у холста 2D подложка ровно ш×в×4 байта, это счёт.\n');
  console.log(`${pad('экран', 12)} ${pad('кадр просит', 12)} ${pad('ёмкость', 8)} память, МБ`);
  for (const vp of [{ w: 360, h: 640 }, { w: 375, h: 812 }, { w: 390, h: 844 }, TILE_PROMISE, { w: 768, h: 1024 }, { w: 1280, h: 800 }]) {
    console.log(
      `${pad(`${vp.w}×${vp.h}`, 12)} ${String(worstRequest(vp)).padStart(11)} ${String(cacheFor(vp)).padStart(8)} ${(tileMemory(vp) / 1048576).toFixed(1).padStart(10)}`,
    );
  }

  console.log('\n=== бросок карты и стоянка ===\n');
  console.log(`Мир закреплён (дом ${PINNED_HOME.x}|${PINNED_HOME.y}, сид ${PINNED_SEED}): прогоны разных коммитов летают над одной землёй.`);
  console.log('Земля печётся по тайлу за кадр, и в медиану кадра выпечка не попадает вовсе — поэтому');
  console.log('меряется отдельно: камера ползёт по спирали, под неё подъезжают свежие тайлы. «Длинный»');
  console.log('кадр — дольше 25 мс. «Кадров с обзором» — где хоть один тайл экрана ещё не испечён: цена');
  console.log('тонкого запаса. ×4 и ×6 — замедление процессора под телефон; растр на GPU оно не тормозит.\n');
  printFlight(flown);
  console.log('\nВыпечек стоя обязано быть ноль: кадр просит то, что уже в кэше. Не ноль — перепечка,');
  console.log('и держит её от возврата тест «неподвижная камера … не печёт больше ничего» (map.test.ts).');

  console.log('\n=== агенты: различимы ли четверо без подписей ===\n');
  console.log('Подписи под фигурами убраны, и опознание держится только на форме. Пятно —');
  console.log(`совпадение залитых силуэтов по худшей паре (порог ${SAME}, тот же, что у видов`);
  console.log('бойцов в трёхмерной сцене). Признак — то, чем они разведены по замыслу, в');
  console.log(`пикселях; меньше ${FEATURE_MIN} px признаком считать нельзя, столько съедает сглаживание.\n`);
  console.log(
    `${pad('px/ед.', 7)} ${pad('пятно', 7)} ${pad('худшая пара', 20)} ${pad('вождь выше', 11)} ${pad('шпион уже', 10)} ${pad('шляпа@', 7)} подол@`,
  );
  for (const l of looks) {
    const flag = l.iou >= SAME || l.taller < FEATURE_MIN || l.thinner < FEATURE_MIN ? '  ←' : '';
    console.log(
      `${String(l.px).padStart(6)} ${num(l.iou, 7, 3)} ${pad(l.pair, 20)} ${String(l.taller).padStart(9)} ${String(l.thinner).padStart(10)} ${num(l.hat, 7)} ${num(l.hem, 6)}${flag}`,
    );
  }
  // Где кончается различимость. Пол `agentUnit` — то, ниже чего карта фигуру не
  // рисует никогда; запас между ним и этой границей и есть ответ на вопрос
  // «на каком приближении четверо сливаются».
  const bad = looks.filter((l) => l.iou >= SAME || l.taller < FEATURE_MIN || l.thinner < FEATURE_MIN);
  const edge = bad.length > 0 ? Math.max(...bad.map((l) => l.px)) : 0;
  console.log(`\nШляпа@ — доля высоты, на которой у разведчика лежит самая широкая строка (1 —`);
  console.log('макушка, 0 — земля): у него она обязана быть у верха, у дипломата — у самой земли.');
  console.log(
    edge > 0
      ? `Различие пропадает на ${edge} px на единицу и ниже.`
      : 'Ни на одном из мерянных размеров признаки не пропали.',
  );
  console.log(`Карта не рисует агента мельче ${AGENT_MIN} px на единицу (agentUnit), а это ${edge > 0 ? (AGENT_MIN / edge).toFixed(1) : '—'}-кратный запас:`);
  console.log('при любом отдалении фигура остаётся своего размера, тает под ней только земля.');
}

void (MOTION ? motionMain() : main());
