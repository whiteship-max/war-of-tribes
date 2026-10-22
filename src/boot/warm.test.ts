// РТ-2б (docs/stability.md, «РТ-2б»): карта мира, «Рейтинг», «Молва края» и окно зимы подтягиваются в фоне — только когда
// замок встал целиком (первый кадр диорамы и лист значков), только в простое, по одному и не на медленной сети.
// Подтягивается код, а окно рисует лишь его кнопка или его час: это держат исходники `App.tsx`, `WorldMap.tsx` и
// `WinterModal.tsx`.
//
// Область правила — после готовности замка: каждый тест, что ждёт загрузки, сначала утверждает, что замок встал (или ворота
// открыты с начала); до неё — что не встал.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { NetInfo, WarmEnv } from './warm';

const sheet = vi.hoisted(() => ({ ready: false, fns: new Set<() => void>() }));
vi.mock('@/ui/icons/sheet', () => ({
  sheetReady: () => sheet.ready,
  onSheet: (fn: () => void) => {
    sheet.fns.add(fn);
    return () => sheet.fns.delete(fn);
  },
}));

/** Свежая дверь: готовность замка — состояние модуля, у каждого теста своё. */
async function door() {
  vi.resetModules();
  sheet.ready = false;
  sheet.fns.clear();
  return import('./warm');
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Подменный браузер: простои и таймеры копятся очередью и зовутся тестом по одному. */
function browser(net?: NetInfo, idle = true) {
  const idles: (() => void)[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const env: WarmEnv = {
    idle: idle ? (fn) => void idles.push(fn) : undefined,
    later: (fn, ms) => void timers.push({ fn, ms }),
    net,
  };
  const quiet = async (): Promise<void> => {
    idles.shift()?.();
    await settle();
  };
  return { env, idles, timers, quiet };
}

const chunks = () => [vi.fn(() => Promise.resolve('карта')), vi.fn(() => Promise.resolve('рейтинг')), vi.fn(() => Promise.resolve('молва'))];
const calls = (loads: ReturnType<typeof chunks>) => loads.map((l) => l.mock.calls.length);

/** Ворота, открытые с начала, — для правил сети и простоя, где замок уже встал. */
const open = Promise.resolve();

/** Встал ли замок: обещание читается флагом после очереди микрозадач. */
async function up(castle: Promise<unknown>): Promise<boolean> {
  let yes = false;
  void castle.then(() => (yes = true));
  await settle();
  return yes;
}

/** Лист значков приехал (`ui/icons/sheet`). */
function sheetArrives(): void {
  sheet.ready = true;
  for (const fn of [...sheet.fns]) fn();
}

describe('фон — только после готовности замка', () => {
  it('до первого кадра и до листа значков не качает ни простоем, ни таймером; после обоих — в простое, по одному', async () => {
    const m = await door();
    const b = browser();
    const loads = chunks();
    m.warmAfter(loads, m.castle, b.env);
    expect(await up(m.castle), 'точка до готовности').toBe(false);
    expect(b.idles.length + b.timers.length).toBe(0);

    m.castlePainted();
    expect(await up(m.castle), 'кадр есть, листа нет — ещё не встал').toBe(false);
    expect(b.idles.length + b.timers.length, 'кадр без листа').toBe(0);

    sheetArrives();
    expect(await up(m.castle), 'точка внутри области').toBe(true);
    expect(b.idles.length, 'замок встал — ждём простоя').toBe(1);
    expect(calls(loads), 'до простоя код не тронут').toEqual([0, 0, 0]);

    await b.quiet();
    expect(calls(loads)).toEqual([1, 0, 0]);
    await b.quiet();
    expect(calls(loads)).toEqual([1, 1, 0]);
    await b.quiet();
    expect(calls(loads)).toEqual([1, 1, 1]);
    await b.quiet();
    expect(calls(loads), 'каждый кусок — один раз').toEqual([1, 1, 1]);
    expect(b.idles.length).toBe(0);
  });

  it('лист раньше кадра — то же: замок встаёт по второму из двух', async () => {
    const m = await door();
    const b = browser();
    const loads = chunks();
    m.warmAfter(loads, m.castle, b.env);
    sheetArrives();
    expect(await up(m.castle), 'лист есть, кадра нет').toBe(false);
    expect(b.idles.length).toBe(0);
    m.castlePainted();
    expect(await up(m.castle), 'точка внутри области').toBe(true);
    expect(b.idles.length).toBe(1);
  });

  it('замок, вставший раньше входа в партию, открывает ворота сразу — но качать всё равно в простое', async () => {
    const m = await door();
    sheetArrives();
    m.castlePainted();
    expect(await up(m.castle), 'точка внутри области').toBe(true);
    const b = browser();
    const loads = chunks();
    m.warmAfter(loads, m.castle, b.env);
    await settle();
    expect(calls(loads)).toEqual([0, 0, 0]);
    expect(b.idles.length).toBe(1);
  });

  it('кусок, не приехавший по сети, игру не роняет и очередь не держит: следующий — в следующем простое', async () => {
    const m = await door();
    const b = browser();
    const loads = chunks();
    loads[0].mockImplementation(() => Promise.reject(new Error('сеть')));
    m.warmAfter(loads, open, b.env);
    await settle();
    await b.quiet();
    await b.quiet();
    expect(calls(loads)).toEqual([1, 1, 0]);
  });

  it('отмена (разобранный `App`): после неё ничего не качается — ни ждущее ворот, ни ждущее простоя', async () => {
    const m = await door();
    const b = browser();
    const loads = chunks();
    const stop = m.warmAfter(loads, m.castle, b.env);
    stop();
    m.castlePainted();
    sheetArrives();
    expect(await up(m.castle), 'точка внутри области').toBe(true);
    expect(b.idles.length, 'снятое не ждёт простоя').toBe(0);

    const b2 = browser();
    const stop2 = m.warmAfter(loads, open, b2.env);
    await settle();
    expect(b2.idles.length, 'точка внутри области: простоя ждут').toBe(1);
    stop2();
    await b2.quiet();
    expect(calls(loads)).toEqual([0, 0, 0]);
  });
});

describe('медленная сеть — по касанию', () => {
  it('экономия трафика, 2g и slow-2g: заранее ничего; 3g, 4g и неизвестная сеть — качают', async () => {
    const m = await door();
    for (const net of [{ saveData: true, effectiveType: '4g' }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }]) {
      expect(m.slowNet(net), JSON.stringify(net)).toBe(true);
      const b = browser(net);
      const loads = chunks();
      m.warmAfter(loads, open, b.env);
      await settle();
      await b.quiet();
      expect(b.idles.length + b.timers.length, JSON.stringify(net)).toBe(0);
      expect(calls(loads), JSON.stringify(net)).toEqual([0, 0, 0]);
    }
    for (const net of [{ effectiveType: '3g' }, { effectiveType: '4g', saveData: false }, undefined]) {
      expect(m.slowNet(net), JSON.stringify(net)).toBe(false);
      const b = browser(net);
      const loads = chunks();
      m.warmAfter(loads, open, b.env);
      await settle();
      await b.quiet();
      expect(calls(loads), JSON.stringify(net)).toEqual([1, 0, 0]);
    }
  });

  it('сеть стала медленной посреди подкачки — остальное ждёт касания', async () => {
    const m = await door();
    const net: NetInfo = { effectiveType: '4g' };
    const b = browser(net);
    const loads = chunks();
    m.warmAfter(loads, open, b.env);
    await settle();
    await b.quiet();
    expect(calls(loads)).toEqual([1, 0, 0]);
    net.effectiveType = '2g';
    await b.quiet();
    expect(calls(loads)).toEqual([1, 0, 0]);
  });
});

describe('без requestIdleCallback', () => {
  it('простой ждётся таймером в IDLE_FALLBACK_MS, по одному куску за срок', async () => {
    const m = await door();
    const b = browser(undefined, false);
    const loads = chunks();
    m.warmAfter(loads, open, b.env);
    await settle();
    expect(b.timers.map((t) => t.ms)).toEqual([m.IDLE_FALLBACK_MS]);
    expect(calls(loads)).toEqual([0, 0, 0]);
    b.timers.shift()?.fn();
    await settle();
    expect(calls(loads)).toEqual([1, 0, 0]);
    expect(b.timers.map((t) => t.ms)).toEqual([m.IDLE_FALLBACK_MS]);
  });
});

describe('отрисовки до касания нет: фон кладёт код, окно рисует кнопка', () => {
  const read = (rel: string): string => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

  /** `<Имя` стоит внутри `{условие && (` и ни один блок между ними не закрыт. */
  const behind = (src: string, tag: string, gate: string): boolean => {
    const at = src.indexOf(`<${tag}`);
    const from = src.slice(0, at).lastIndexOf(`{${gate} && (`);
    return at > 0 && src.indexOf(`<${tag}`, at + 1) < 0 && from >= 0 && !src.slice(from, at).includes(')}');
  };

  it('куски — только `import()`; карта открывается кнопкой низа, «Рейтинг» и «Молва» — кнопками карты, зима — своим часом', () => {
    const list = read('ui/map/chunks.ts');
    expect(list.match(/=> import\('\.\/\w+'\)/g)).toEqual([`=> import('./WorldMap')`, `=> import('./Rating')`, `=> import('./Feed')`]);
    expect(list).not.toMatch(/from 'react'|<\w/);

    const app = read('App.tsx');
    expect(app).toContain('warmAfter([...MAP_CHUNKS, winterUi])');
    expect(app).toContain('lazy(() => mapUi()');
    expect(behind(app, 'WorldMap', 'mapOpen'), 'карта — только по `mapOpen`').toBe(true);

    const map = read('ui/map/WorldMap.tsx');
    expect(map).toContain('lazy(() => ratingUi()');
    expect(map).toContain('lazy(() => feedUi()');
    expect(behind(map, 'Rating', 'ratingOpen'), '«Рейтинг» — только по своей кнопке').toBe(true);
    expect(behind(map, 'Feed ', 'feedOpen'), '«Молва» — только по своей кнопке').toBe(true);

    const winter = read('ui/WinterModal.tsx');
    expect(winter).toContain(`winterUi = () => import('./WinterBody')`);
    expect(winter).toContain('lazy(() => winterUi()');
    expect(behind(winter, 'WinterBody', 'open'), 'зима — только открытым окном').toBe(true);
  });
});
