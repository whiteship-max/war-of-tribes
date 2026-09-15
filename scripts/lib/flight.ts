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
 */
import { sleep, Tab } from './chrome';
import { measure as live } from './measured';
import { openPinnedMap } from './pinned';

/** Замедления процессора: эта машина, телефон средней руки, слабый телефон. */
export const SLOWS = [1, 4, 6];

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
}

/**
 * Щуп броска. Обратных кавычек и подстановок в нём быть не может: строка сама
 * шаблонная, и любая из них рвёт файл.
 */
const FLIGHT_PROBE = `
(() => {
  const W = () => window.__world;
  window.__fly = (on) => {
    if (window.__flyRaf) cancelAnimationFrame(window.__flyRaf);
    window.__flyRaf = 0;
    if (!on) return JSON.stringify('off');
    const home = W().getState().info.home;
    window.__dts = [];
    const t0 = performance.now();
    let prev = t0;
    const step = () => {
      const now = performance.now();
      window.__dts.push(now - prev);
      prev = now;
      const s = (now - t0) / 1000;
      const a = s * 1.8;
      window.__mapCam(home.x + Math.cos(a) * (3 + s * 3.6), home.y + Math.sin(a) * (3 + s * 3.6), 44);
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
  window.__athome = () => {
    const home = W().getState().info.home;
    window.__mapCam(home.x + 3, home.y, 44);
    return JSON.stringify('ok');
  };
  window.__dtsTake = () => JSON.stringify(window.__dts || []);
  window.__flightBakes = () => JSON.stringify(window.__mapBakes());
  window.__flightGaps = () => JSON.stringify(window.__mapGaps ? window.__mapGaps() : null);
  window.__flightCache = () => JSON.stringify(window.__mapTiles ? window.__mapTiles() : null);
  return JSON.stringify('ok');
})()
`;

/**
 * Бросок и стоянка на каждом замедлении. Страница открывается с отпущенной
 * камерой (`worldview=open`): под поводком камера уходит от дома на полэкрана и
 * свежих тайлов почти не просит. Земля от флага не меняется.
 */
export async function measureFlight(
  port: number,
  url: string,
  onLog: (s: string) => void,
  /** Готовое сохранение мира (`openPinnedMap`): замер на мире с осадой и взятым городом. */
  opts: { world?: string } = {},
): Promise<Flight[]> {
  const tab = await Tab.open(port, url);
  await tab.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await openPinnedMap(tab, { onLog, world: opts.world });
  await tab.eval<string>(FLIGHT_PROBE);
  // Первый экран земли печётся сразу после входа: это разовая работа, и мешать
  // её с броском нельзя — мерить надо установившийся ход.
  await sleep(2500);
  const out: Flight[] = [];
  for (const slow of SLOWS) {
    await tab.send('Emulation.setCPUThrottlingRate', { rate: slow });
    await tab.eval<string>('window.__athome()');
    await sleep(1500);
    await tab.eval<number[]>('window.__flightBakes()');
    await tab.eval<number[] | null>('window.__flightGaps()');
    await tab.eval<string>('window.__fly(true)');
    await sleep(FLY_SECONDS * 1000);
    const fly = await tab.eval<number[]>('window.__dtsTake()');
    const bakes = await tab.eval<number[]>('window.__flightBakes()');
    const gaps = await tab.eval<number[] | null>('window.__flightGaps()');
    await tab.eval<string>('window.__fly(false)');
    // Домой и пауза: после броска вокруг камеры допекается свежий экран, и без
    // паузы «стоя» мерило бы его, а не стоянку. Бросок перед стоянкой нужен и
    // сам по себе: он подгружает куски вокруг, а без них запас не печётся вовсе
    // — ровно как у игрока, который уже поводил карту.
    await tab.eval<string>('window.__athome()');
    await sleep(slow === 1 ? 4000 : 9000);
    await tab.eval<number[]>('window.__flightBakes()');
    await tab.eval<string>('window.__still(true)');
    await sleep(3000);
    const still = await tab.eval<number[]>('window.__dtsTake()');
    await tab.eval<string>('window.__still(false)');
    const stillBakes = (await tab.eval<number[]>('window.__flightBakes()')).length;
    const cache = await tab.eval<Flight['cache']>('window.__flightCache()');
    out.push({ slow, bakes, fly, gaps, still, stillBakes, cache });
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
