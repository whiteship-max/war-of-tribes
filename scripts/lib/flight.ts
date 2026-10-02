/**
 * Бросок карты и стоянка на закреплённом мире: что стоит выпечка тайла, что от
 * неё видно в кадре и печёт ли карта, когда её никто не трогает.
 *
 * Живёт в `lib/`, а не в `map-report.ts`, по одной причине: одним и тем же
 * замером меряют и отчёт, и сравнение «до и после» на других сборках. Две копии
 * одного замера разошлись бы ровно так же, как расходились число в кэше и запрос
 * кадра, — а сравнивать тогда было бы нечего.
 *
 * Меряется три вещи, и все три — в одном прогоне:
 *
 *   бросок   камера ползёт по спирали вокруг дома, путь ведётся часами, а не
 *            счётом кадров (иначе медленный прогон проходит меньше земли, а
 *            земля разная). Снимаются цена выпечки, интервалы кадров и сколько
 *            тайлов экрана ещё не испечено — сквозь них виден обзор;
 *   стоянка  камера дома и стоит. Карта обязана не печь ничего: кадр просит то,
 *            что уже в кэше. Выпечки стоя — это перепечка, и она видна числом;
 *   кэш      сколько тайлов кадр просит и сколько кэш держит (`__mapTiles`).
 *
 * Телефон изображается замедлением процессора (`Emulation.setCPUThrottlingRate`):
 * ×4 — обычная мерка DevTools под телефон средней руки, ×6 — под слабый. Это не
 * телефон. Растеризацию холста в процессе GPU замедление не тормозит, и таймер
 * выпечки её не видит (docs/world-map.md): эти числа про работу процессора.
 *
 * Карта в движении (`motion`, docs/map_tw.md, раздел 11) — тот же прогон и вдобавок
 * цена самого кадра (`drawFrame`, `__mapPerf`): в броске и стоя, в щипке от ближнего
 * масштаба к дальнему и обратно и в броске на среднем масштабе. Щипок и бросок издали
 * идут с карты, открытой заново: игра выбрасывает испечённое, когда карту закрывают,
 * и так проходы при разных замедлениях не наследуют кэш друг друга. Замедления — ×1 и
 * ×4: заход стенда держится двух минут (CLAUDE.md, «Бюджет железа»).
 */
import { sleep, Tab } from './chrome';
import { measure as live } from './measured';
import { openPinnedMap } from './pinned';

/** Замедления процессора: эта машина, телефон средней руки, слабый телефон. */
export const SLOWS = [1, 4, 6];

/** Замедления карты в движении: эта машина и телефон средней руки. */
export const MOTION_SLOWS = [1, 4];

/**
 * Щипок: от ближнего масштаба к дальнему и обратно за бросок (`FLY_SECONDS`), масштаб — по
 * логарифму (палец разводится равномерно), середина дрейфует к востоку — под щипком
 * подъезжает свежая земля, как у игрока, который ищет место издали.
 */
export const PINCH = { near: 56, far: 6, drift: 3 } as const;

/** Масштаб броска издали: средний слой (docs/map_tw.md, раздел 5) — тот же путь, что вблизи. */
export const FAR_SCALE = 24;

/** Секунд броска на каждый случай. Шести хватает на три с половиной сотни кадров. */
const FLY_SECONDS = Number(process.env.FLY_SECONDS ?? 6);

export interface Flight {
  slow: number;
  /** Цена выпечки одного тайла за бросок, мс. */
  bakes: number[];
  /** Интервалы между кадрами при броске, мс. */
  fly: number[];
  /** Сколько тайлов экрана не испечено, по кадрам броска. null — сборка счёта не ведёт. */
  gaps: number[] | null;
  /** Интервалы между кадрами, когда камера стоит, мс. */
  still: number[];
  /** Сколько тайлов испеклось стоя. Не ноль — перепечка. */
  stillBakes: number;
  /** Кэш стоя: сколько держит, сколько кадр просил, ёмкость. null — сборка не отдаёт. */
  cache: { size: number; want: number; capacity: number; pool: number } | null;
  /** Карта в движении (`motion`): цена кадра (`drawFrame`, мс) в броске и стоя. */
  flyCost?: number[];
  stillCost?: number[];
  /** Карта в движении: щипок и бросок издали, каждый — с карты, открытой заново. */
  zoom?: Motion;
  far?: Motion;
}

/** Проход карты в движении: цена кадра, интервалы между кадрами и выпечки тайлов ближнего масштаба. */
export interface Motion {
  cost: number[];
  dts: number[];
  bakes: number[];
}

/**
 * Щуп броска. Обратных кавычек и подстановок в нём быть не может: строка сама
 * шаблонная, и любая из них рвёт файл.
 */
const FLIGHT_PROBE = `
(() => {
  const W = () => window.__world;
  window.__fly = (on, scale) => {
    if (window.__flyRaf) cancelAnimationFrame(window.__flyRaf);
    window.__flyRaf = 0;
    if (!on) return JSON.stringify('off');
    const home = W().getState().info.home;
    const sc = scale || 44;
    window.__dts = [];
    const t0 = performance.now();
    let prev = t0;
    const step = () => {
      const now = performance.now();
      window.__dts.push(now - prev);
      prev = now;
      const s = (now - t0) / 1000;
      const a = s * 1.8;
      window.__mapCam(home.x + Math.cos(a) * (3 + s * 3.6), home.y + Math.sin(a) * (3 + s * 3.6), sc);
      window.__flyRaf = requestAnimationFrame(step);
    };
    window.__flyRaf = requestAnimationFrame(step);
    return JSON.stringify('on');
  };
  window.__zoom = (on, near, far, period, drift) => {
    if (window.__flyRaf) cancelAnimationFrame(window.__flyRaf);
    window.__flyRaf = 0;
    if (!on) return JSON.stringify('off');
    const home = W().getState().info.home;
    const ln = Math.log(near);
    const lf = Math.log(far);
    window.__dts = [];
    const t0 = performance.now();
    let prev = t0;
    const step = () => {
      const now = performance.now();
      window.__dts.push(now - prev);
      prev = now;
      const s = (now - t0) / 1000;
      const k = (1 + Math.cos((s / period) * Math.PI * 2)) / 2;
      window.__mapCam(home.x + 3 + s * drift, home.y, Math.exp(lf + (ln - lf) * k));
      window.__flyRaf = requestAnimationFrame(step);
    };
    window.__flyRaf = requestAnimationFrame(step);
    return JSON.stringify('on');
  };
  window.__still = (on) => {
    if (window.__stillRaf) cancelAnimationFrame(window.__stillRaf);
    window.__stillRaf = 0;
    if (!on) return JSON.stringify('off');
    window.__dts = [];
    let prev = performance.now();
    const step = () => {
      const now = performance.now();
      window.__dts.push(now - prev);
      prev = now;
      window.__stillRaf = requestAnimationFrame(step);
    };
    window.__stillRaf = requestAnimationFrame(step);
    return JSON.stringify('on');
  };
  window.__athome = (scale) => {
    const home = W().getState().info.home;
    window.__mapCam(home.x + 3, home.y, scale || 44);
    return JSON.stringify('ok');
  };
  window.__dtsTake = () => JSON.stringify(window.__dts || []);
  window.__flightBakes = () => JSON.stringify(window.__mapBakes());
  window.__flightGaps = () => JSON.stringify(window.__mapGaps ? window.__mapGaps() : null);
  window.__flightCache = () => JSON.stringify(window.__mapTiles ? window.__mapTiles() : null);
  window.__flightCost = () => JSON.stringify(window.__mapPerf ? window.__mapPerf() : []);
  window.__mapShut = () => {
    window.__game.getState().closeMap();
    return JSON.stringify('ok');
  };
  window.__mapAgain = () => {
    window.__game.getState().openMap();
    return JSON.stringify(window.__game.getState().mapOpen);
  };
  return JSON.stringify('ok');
})()
`;

/**
 * Проход карты в движении с карты, открытой заново: закрытая карта выбрасывает испечённое (тайлы, у нового
 * вида — и обзор, средний слой, миниатюры), открытая печёт первый экран на масштабе начала прохода, и только
 * потом камера идёт. Закрыть и открыть — двумя шагами: в одном такте React не успел бы снять полотно.
 */
async function motionPass(tab: Tab, slow: number, at: number, start: string, stop: string): Promise<Motion> {
  await tab.eval<string>('window.__mapShut()');
  await sleep(400);
  await tab.eval<boolean>('window.__mapAgain()');
  await sleep(400);
  await tab.eval<string>(`window.__athome(${at})`);
  await sleep(slow === 1 ? 2500 : 6000);
  await tab.eval<number[]>('window.__flightBakes()');
  await tab.eval<number[]>('window.__flightCost()');
  await tab.eval<string>(start);
  await sleep(FLY_SECONDS * 1000);
  const dts = await tab.eval<number[]>('window.__dtsTake()');
  const cost = await tab.eval<number[]>('window.__flightCost()');
  const bakes = await tab.eval<number[]>('window.__flightBakes()');
  await tab.eval<string>(stop);
  return { cost, dts, bakes };
}

/**
 * Бросок и стоянка на каждом замедлении. Страница открывается с отпущенной
 * камерой (`worldview=open`): под поводком камера уходит от дома на полэкрана и
 * свежих тайлов почти не просит. Земля от флага не меняется.
 */
export async function measureFlight(
  port: number,
  url: string,
  onLog: (s: string) => void,
  /**
   * Готовое сохранение мира (`openPinnedMap`): замер на мире с осадой и взятым городом. `motion` — карта в
   * движении: замедления ×1 и ×4, цена кадра в каждом проходе, щипок и бросок издали.
   */
  opts: { world?: string; motion?: boolean } = {},
): Promise<Flight[]> {
  const motion = opts.motion === true;
  const tab = await Tab.open(port, url);
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await openPinnedMap(tab, { onLog, world: opts.world });
  await tab.eval<string>(FLIGHT_PROBE);
  // Первый экран земли печётся сразу после входа: это разовая работа, и мешать
  // её с броском нельзя — мерить надо установившийся ход.
  await sleep(2500);
  const out: Flight[] = [];
  for (const slow of motion ? MOTION_SLOWS : SLOWS) {
    await tab.send('Emulation.setCPUThrottlingRate', { rate: slow });
    await tab.eval<string>('window.__athome()');
    await sleep(1500);
    await tab.eval<number[]>('window.__flightBakes()');
    await tab.eval<number[] | null>('window.__flightGaps()');
    if (motion) await tab.eval<number[]>('window.__flightCost()');
    await tab.eval<string>('window.__fly(true)');
    await sleep(FLY_SECONDS * 1000);
    const fly = await tab.eval<number[]>('window.__dtsTake()');
    const bakes = await tab.eval<number[]>('window.__flightBakes()');
    const gaps = await tab.eval<number[] | null>('window.__flightGaps()');
    const flyCost = motion ? await tab.eval<number[]>('window.__flightCost()') : undefined;
    await tab.eval<string>('window.__fly(false)');
    // Домой и пауза: после броска вокруг камеры допекается свежий экран, и без
    // паузы «стоя» мерило бы его, а не стоянку. Бросок перед стоянкой нужен и
    // сам по себе: он подгружает куски вокруг, а без них запас не печётся вовсе
    // — ровно как у игрока, который уже поводил карту.
    await tab.eval<string>('window.__athome()');
    await sleep(slow === 1 ? 4000 : 9000);
    await tab.eval<number[]>('window.__flightBakes()');
    if (motion) await tab.eval<number[]>('window.__flightCost()');
    await tab.eval<string>('window.__still(true)');
    await sleep(3000);
    const still = await tab.eval<number[]>('window.__dtsTake()');
    const stillCost = motion ? await tab.eval<number[]>('window.__flightCost()') : undefined;
    await tab.eval<string>('window.__still(false)');
    const stillBakes = (await tab.eval<number[]>('window.__flightBakes()')).length;
    const cache = await tab.eval<Flight['cache']>('window.__flightCache()');
    if (!motion) {
      out.push({ slow, bakes, fly, gaps, still, stillBakes, cache });
      continue;
    }
    const zoom = await motionPass(tab, slow, PINCH.near, `window.__zoom(true, ${PINCH.near}, ${PINCH.far}, ${FLY_SECONDS}, ${PINCH.drift})`, 'window.__zoom(false)');
    const far = await motionPass(tab, slow, FAR_SCALE, `window.__fly(true, ${FAR_SCALE})`, 'window.__fly(false)');
    out.push({ slow, bakes, fly, gaps, still, stillBakes, cache, flyCost, stillCost, zoom, far });
  }
  await tab.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  tab.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${tab.target}`);
  return out;
}

const median = (a: number[]): number => (a.length === 0 ? 0 : [...a].sort((x, y) => x - y)[a.length >> 1]);
const pct = (a: number[], q: number): number =>
  a.length === 0 ? 0 : [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * q))];
const pad = (s: string, n: number): string => s.padEnd(n);
const num = (v: number, n: number, d = 2): string => v.toFixed(d).padStart(n);

/** «Длинный» кадр — дольше 25 мс, то есть хотя бы один пропущенный при шестидесяти. */
export const LONG_FRAME = 25;

export function printFlight(flown: Flight[], log: (s: string) => void = console.log): void {
  log(`${pad('×', 3)} ${pad('что', 14)} ${pad('штук', 6)} ${pad('медиана', 8)} ${pad('p95', 8)} ${pad('макс', 8)} прочее`);
  for (const f of flown) {
    const row = (name: string, a: number[], tail: string): void =>
      log(
        `${pad(String(f.slow), 3)} ${pad(name, 14)} ${live(String(a.length).padStart(5))} ${live(num(median(a), 8))} ${live(num(pct(a, 0.95), 8))} ${live(num(Math.max(0, ...a), 8))} ${tail}`,
      );
    const long = f.fly.length ? Math.round((100 * f.fly.filter((d) => d > LONG_FRAME).length) / f.fly.length) : 0;
    const holes = f.gaps ? f.gaps.filter((g) => g > 0).length : null;
    const holeShare = f.gaps && f.gaps.length ? Math.round((100 * (holes ?? 0)) / f.gaps.length) : null;
    row('выпечка тайла', f.bakes, '');
    row(
      'кадр в броске',
      f.fly,
      `длинных ${live(long)}%` + (holeShare === null ? '' : `, кадров с обзором на экране ${live(holeShare)}%`),
    );
    const stillLong = f.still.length ? Math.round((100 * f.still.filter((d) => d > LONG_FRAME).length) / f.still.length) : 0;
    const cache = f.cache ? `; кадр просит ${f.cache.want}, кэш держит ${f.cache.size} из ${f.cache.capacity}` : '';
    row('кадр стоя', f.still, `длинных ${live(stillLong)}%, выпечек стоя ${f.stillBakes}${cache}`);
  }
}

/**
 * Карта в движении: цена кадра (`drawFrame`, мс) по проходам; «длинных» — доля интервалов между кадрами
 * дольше `LONG_FRAME` в том же проходе. Выпечка тайла — ближнего масштаба, в броске вблизи.
 */
export function printMotion(flown: Flight[], log: (s: string) => void = console.log): void {
  log(`${pad('×', 3)} ${pad('что', 16)} ${pad('штук', 6)} ${pad('медиана', 8)} ${pad('p95', 8)} ${pad('макс', 8)} прочее`);
  const longOf = (d: number[]): number => (d.length ? Math.round((100 * d.filter((x) => x > LONG_FRAME).length) / d.length) : 0);
  for (const f of flown) {
    const row = (name: string, a: number[], tail: string): void =>
      log(
        `${pad(String(f.slow), 3)} ${pad(name, 16)} ${live(String(a.length).padStart(5))} ${live(num(median(a), 8))} ${live(num(pct(a, 0.95), 8))} ${live(num(Math.max(0, ...a), 8))} ${tail}`,
      );
    row('выпечка тайла', f.bakes, '');
    if (f.flyCost) row('кадр: бросок', f.flyCost, `длинных ${live(longOf(f.fly))}%`);
    if (f.stillCost) row('кадр: стоя', f.stillCost, `длинных ${live(longOf(f.still))}%, выпечек стоя ${f.stillBakes}`);
    if (f.zoom) row(`кадр: щипок`, f.zoom.cost, `длинных ${live(longOf(f.zoom.dts))}%, тайлов испечено ${live(f.zoom.bakes.length)}`);
    if (f.far) row(`кадр: издали`, f.far.cost, `длинных ${live(longOf(f.far.dts))}%`);
  }
}
