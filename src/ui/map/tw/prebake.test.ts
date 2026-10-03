// Карта по регионам (docs/map_tw.md, раздел 13): регион печётся заранее и вне кадра. Здесь — запасной путь
// (страница печёт сама: в vitest рабочего потока нет) и всё, что у путей общее: что печётся, когда, без дыр ли, кто
// цель и одна ли земля у страницы и потока.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chunkKey, chunkKeysIn, chunkRect, clearCache, putChunk } from '@/world/cache';
import { featuresAt, terrainAt } from '@/world/geography';
import { terrainIndex } from '@/world/geo';
import { useWorld } from '@/world/store';
import { cellOf } from '@/world/atlas/project';
import { WORLD_ORIGIN } from '@/world/data/tuning';
import type { Coord, FigureView, MarchView, RegionChunk, SettlementView } from '@/world/types';
import { fakeCanvasEnv } from '../fakecanvas';
import { type Camera, viewRect } from '../grid';
import { STILL_MS, moving, prebakeFrame, prebakeIdle, prebakeState, prebaked, resetPrebake, snapshotRect } from './prebake';
import { cacheLand, extractLand, FEATURE_BITS } from './landcache';
import { gridLand } from './landgrid';
import { knownAt } from './knowledge';
import { type Theatre, theatreAt, theatreById } from './theatre/theatre';
import { holdInTheatre } from './theatre/camera';
import { cellsFor, emptyGrid, foldsFor, heightGrid, heightRows, shade, shadowMargin, warpFor } from './field';
import { figureItems, hostItems, placeItems } from './scene';
import { aimAt, aimsOf } from './tap';

const SEED = 20260912;
const VP = { w: 375, h: 812 };
const DPR = 2;

function at(lon: number, lat: number): Coord {
  const p = cellOf(lon, lat);
  return { x: WORLD_ORIGIN.x + Math.floor(p.col), y: WORLD_ORIGIN.y + Math.floor(p.row) };
}

/** Дом — Копенгаген: Дания — малый регион, снимок её земли — три десятка кусков. */
const HOME = at(12.57, 55.68);
/** Гамбург — уже Германия, по ту сторону рубежа. */
const BEYOND = at(9.99, 53.55);

function place(id: string, c: Coord, mine = false): SettlementView {
  return {
    id,
    x: c.x,
    y: c.y,
    name: id,
    stage: 'village',
    relation: mine ? 'self' : 'barbarian',
    owner: null,
    tribeId: null,
    tribeName: null,
    color: '#a2795a',
    mine,
    castle: false,
    visible: true,
    seenAt: 0,
    stale: false,
    seenPop: 100,
    marching: false,
    ruin: false,
    sacked: false,
    besieged: null,
    fell: null,
  } as unknown as SettlementView;
}

const SETTLEMENTS = [place('home', HOME, true), place('lair', { x: HOME.x + 3, y: HOME.y - 2 }), place('far', BEYOND)];

/** Кусок карты из той же географии, из которой его собирает мир (`LocalWorld.region`): всё разведано. */
function landChunk(cx: number, cy: number): RegionChunk {
  const rect = chunkRect(cx, cy);
  const n = rect.w * rect.h;
  const terrain = new Uint8Array(n);
  const features = new Uint8Array(n);
  for (let j = 0; j < rect.h; j++) {
    for (let i = 0; i < rect.w; i++) {
      terrain[j * rect.w + i] = terrainIndex(terrainAt(SEED, rect.x + i, rect.y + j));
      features[j * rect.w + i] = featuresAt(SEED, rect.x + i, rect.y + j);
    }
  }
  const settlements = SETTLEMENTS.filter((s) => s.x >= rect.x && s.y >= rect.y && s.x < rect.x + rect.w && s.y < rect.y + rect.h);
  return { rect, terrain, features, explored: new Uint8Array(n).fill(1), influence: new Uint8Array(n), settlements };
}

let denmark: Theatre;
let env: ReturnType<typeof fakeCanvasEnv>;

beforeAll(() => {
  env = fakeCanvasEnv();
  denmark = theatreById('denmark')!;
  expect(theatreAt(HOME.x, HOME.y)?.id).toBe('denmark');
  expect(theatreAt(BEYOND.x, BEYOND.y)?.id).toBe('germany');
  // Куски — на всё, что снимет служба.
  for (const { cx, cy } of chunkKeysIn(snapshotRect(denmark))) {
    putChunk(chunkKey(cx, cy), landChunk(cx, cy), 0);
  }
  useWorld.setState({
    info: { seed: SEED, size: 800, origin: WORLD_ORIGIN, home: HOME, homeId: 'home', createdAt: 0 },
    marches: [],
    figures: [],
  } as never);
});

afterAll(() => {
  resetPrebake();
  clearCache();
  env.restore();
});

const held = (c: Camera): Camera => holdInTheatre(c, VP, denmark.box);

describe('заранее испечённый регион: когда печётся', () => {
  it('в движении страница не делает ни шага выпечки; стоя — печёт, и регион прибывает', () => {
    resetPrebake();
    let now = 10_000;
    let cam = held({ cx: HOME.x, cy: HOME.y, scale: 24 });
    prebakeFrame(cam, VP, 1, now);
    expect(prebakeState().ready, 'снимок земли снят').toBe(true);
    expect(prebakeState().exec, 'без потока — страница').toBe('page');
    const before = prebakeState().pageSteps;
    let frame = 2;
    // Движение: камера сдвигается каждый кадр, кадры — через 16 мс; внутри области правила — `moving()`.
    for (; frame < 90; frame++) {
      now += 16;
      cam = held({ ...cam, cx: cam.cx + 0.25, scale: cam.scale * (frame % 2 ? 1.01 : 0.99) });
      prebakeFrame(cam, VP, frame, now);
      expect(moving(), `кадр ${frame}: камера движется`).toBe(true);
      prebakeIdle();
    }
    expect(prebakeState().pageSteps - before, 'шагов выпечки в движении').toBe(0);
    // Стоя: после паузы `STILL_MS` страница печёт свою долю каждый кадр.
    const stillFrom = frame;
    for (; frame < stillFrom + 400; frame++) {
      now += 16;
      prebakeFrame(cam, VP, frame, now);
      prebakeIdle();
    }
    expect(now - (stillFrom * 16)).toBeGreaterThan(STILL_MS);
    const st = prebakeState();
    expect(st.pageSteps - before, 'шагов стоя').toBeGreaterThan(0);
    expect(st.have.chunk + st.have.mid + st.have.sheet + st.have.near, 'испечено стоя').toBeGreaterThan(0);
  });
});

describe('заранее испечённый регион: без дыр', () => {
  it('грубый растр есть сразу со снимком земли и накрывает всё, куда пускают камеру', () => {
    resetPrebake();
    const cam = held({ cx: HOME.x, cy: HOME.y, scale: 44 });
    prebakeFrame(cam, VP, 1, 0);
    const g = prebaked();
    expect(g, 'регион есть').not.toBe(null);
    // Ни одной работы ещё не сделано — а растр уже есть: под всем, что печётся, лежит он.
    expect(prebakeState().have).toEqual({ chunk: 0, mid: 0, sheet: 0, near: 0 });
    expect(g!.coarse, 'грубый растр').not.toBe(null);
    const d = g!.dataRect;
    let k = 0;
    for (const scale of [3.5, 6, 12, 24, 44, 80]) {
      for (const [fx, fy] of [[0, 0], [1, 1], [0, 1], [1, 0], [0.5, 0.5]]) {
        const c = held({ cx: denmark.box.x - 50 + fx * (denmark.box.w + 100), cy: denmark.box.y - 50 + fy * (denmark.box.h + 100), scale });
        const r = viewRect(c, VP);
        expect(r.x, `×${scale}`).toBeGreaterThanOrEqual(d.x);
        expect(r.y, `×${scale}`).toBeGreaterThanOrEqual(d.y);
        expect(r.x + r.w, `×${scale}`).toBeLessThanOrEqual(d.x + d.w);
        expect(r.y + r.h, `×${scale}`).toBeLessThanOrEqual(d.y + d.h);
        k++;
      }
    }
    expect(k).toBe(30);
  });

  it('за границей региона — лист: чужая разведанная земля игроку незнакома; своё и открытое море — знакомы', () => {
    const g = prebaked()!;
    expect(g.knowledge).not.toBe(null);
    const known = knownAt(g.knowledge!);
    // Все клетки разведаны (куски теста открыты целиком) — разница только в том, чья клетка.
    expect(known(HOME.x + 0.5, HOME.y + 0.5)).toBe(1);
    const r = g.plan.reach;
    let foreign: Coord | null = null;
    let openSea: Coord | null = null;
    for (let y = r.y + 2; y < r.y + r.h - 2 && !(foreign && openSea); y++) {
      for (let x = r.x + 2; x < r.x + r.w - 2; x++) {
        const t = theatreAt(x, y);
        const sea = terrainAt(SEED, x, y) === 'water';
        // Середина квадрата 3×3 одного рода: билинейная мерка в середине клетки берёт только её саму.
        let same = true;
        for (let dy = -1; dy <= 1 && same; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (theatreAt(x + dx, y + dy) !== t || (terrainAt(SEED, x + dx, y + dy) === 'water') !== sea) same = false;
          }
        }
        if (!same) continue;
        if (!foreign && t && t !== denmark && !sea) foreign = { x, y };
        if (!openSea && !t && sea) openSea = { x, y };
      }
    }
    expect(foreign, 'чужая суша в рамке').not.toBe(null);
    expect(known(foreign!.x + 0.5, foreign!.y + 0.5), 'чужая суша').toBe(0);
    expect(openSea, 'открытое море в рамке').not.toBe(null);
    expect(known(openSea!.x + 0.5, openSea!.y + 0.5), 'открытое море').toBe(1);
  });
});

describe('цель вне региона', () => {
  it('объекты вне региона в сцену не попадают — палец их не находит', () => {
    resetPrebake();
    const cam = held({ cx: HOME.x, cy: HOME.y, scale: 9 });
    prebakeFrame(cam, VP, 1, 0);
    // Камера над Гамбургом — сколько пускает рамка — и все три места в списке: в сцене только свои.
    const wide = { cx: BEYOND.x, cy: BEYOND.y, scale: 4 };
    const items = placeItems(wide, VP, SETTLEMENTS, DPR);
    expect(items.map((i) => i.s.id).sort()).toEqual(['home', 'lair']);
    // Отряд и агент за границей — тоже нет; у себя — есть.
    const march = (id: string, to: Coord): MarchView =>
      ({ id, mission: 'raid', units: { warrior: 10 }, own: false, hostile: true, phase: 'stay', from: to, to, fromName: '', toName: '', targetId: 't', departAt: 0, arriveAt: 0, loot: null, recallable: false }) as MarchView;
    const hosts = hostItems(wide, VP, [march('in', HOME), march('out', BEYOND)], [], 0, DPR);
    expect(hosts.map((h) => h.m.id)).toEqual(['in']);
    const fig = (id: string, c: Coord): FigureView =>
      ({ id, name: id, phase: 'field', place: 'map', from: c, to: c, at: c, departAt: -1000, arriveAt: -1000, sight: 3, troops: {} }) as unknown as FigureView;
    const figs = figureItems(wide, VP, [fig('scout', HOME), fig('spy', BEYOND)], 0, DPR);
    expect(figs.every((f) => f.spot.f.id !== 'spy')).toBe(true);
    // Палец по точке, где нарисовался бы Гамбург, его клетку не получает.
    const [bx, by] = [(BEYOND.x + 0.5 - wide.cx) * wide.scale + VP.w / 2, (BEYOND.y + 0.5 - wide.cy) * wide.scale + VP.h / 2];
    const aim = aimAt(aimsOf(items, hosts, figs), bx, by, false);
    expect(aim === null || aim.x !== BEYOND.x || aim.y !== BEYOND.y).toBe(true);
  });

  it('тап, правая кнопка, меню приказов и карточка клетки спрашивают регион раньше, чем открыть цель', () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const map = strip(readFileSync(join(process.cwd(), 'src/ui/map/WorldMap.tsx'), 'utf8'));
    // Тап: проверка региона стоит между «клетка в мире» и `openAt`.
    expect(map).toMatch(/if \(!inside \|\| !c\) return;[\s\S]*?if \(!reachable\(c\)\) \{[\s\S]*?return;\s*\}\s*openAt\(c\);/);
    // Правая кнопка: до `openMenu`.
    expect(map).toMatch(/if \(!reachable\(c\)\) \{[\s\S]*?return;\s*\}\s*const g = useWorld\.getState\(\);\s*const agent[\s\S]*?openMenu\(agent, c\)/);
    const menu = strip(readFileSync(join(process.cwd(), 'src/ui/map/ActionMenu.tsx'), 'utf8'));
    // Меню приказов: за краем — только шапка и строка, до первого приказа.
    const gate = menu.indexOf('if (!reachable(menu.cell))');
    expect(gate).toBeGreaterThan(0);
    for (const order of ['void lead()', 'void give(', 'attack(', 'besiege(', 'intercept(']) {
      const i = menu.indexOf(order);
      if (i >= 0) expect(i, order).toBeGreaterThan(gate);
    }
    const panel = strip(readFileSync(join(process.cwd(), 'src/ui/panels/WorldPanel.tsx'), 'utf8'));
    const pgate = panel.indexOf('if (!reachable(here))');
    expect(pgate).toBeGreaterThan(0);
    // Карточка: первый `return (` с приказами — после проверки (вести сюда, набег, удар, осада).
    expect(panel.indexOf('if (!card) {')).toBeGreaterThan(pgate);
  });

  it('дверь вида: клетка своего региона доступна, чужого — нет; камера — в рамке своего', async () => {
    await import('./hook');
    const { reachable, twSlot } = await import('../twslot');
    expect(twSlot()).not.toBe(null);
    expect(reachable(HOME)).toBe(true);
    expect(reachable({ x: HOME.x + 3, y: HOME.y - 2 })).toBe(true);
    expect(reachable(BEYOND)).toBe(false);
    const c = twSlot()!.hold({ cx: BEYOND.x, cy: BEYOND.y, scale: 4 }, VP);
    const r = viewRect(c, VP);
    expect(r.x + r.w).toBeLessThanOrEqual(denmark.box.x + denmark.box.w + 6 + 1e-6);
    expect(r.y + r.h).toBeLessThanOrEqual(denmark.box.y + denmark.box.h + 6 + 1e-6);
  });

  it('прежний вид, выбранный в настройках, глушит приехавший кусок: ни кадра, ни рамки, ни края региона', async () => {
    await import('./hook');
    const { reachable, twSlot } = await import('../twslot');
    const { setMapLook, setMapStorage, mapLook } = await import('../look');
    const data: Record<string, string> = {};
    setMapStorage({ read: (k) => data[k] ?? null, write: (k, v) => (data[k] = v) });
    try {
      // Точки внутри области правила: кусок приехал (ячейка занята), а клетка за краем региона новым видом закрыта.
      expect(mapLook()).toBe('tw');
      expect(twSlot()).not.toBe(null);
      expect(reachable(BEYOND)).toBe(false);
      setMapLook('old');
      expect(twSlot(), 'прежний вид ячейки не видит').toBe(null);
      expect(reachable(BEYOND), 'прежняя карта рамки не знает').toBe(true);
      setMapLook('tw');
      expect(twSlot()).not.toBe(null);
      expect(reachable(BEYOND)).toBe(false);
    } finally {
      setMapStorage({ read: () => null, write: () => {} });
    }
  });
});

describe('детерминизм', () => {
  it('снимок земли для потока — та же земля, что в кэше мира: класс, признаки, дворы', () => {
    const rect = { x: denmark.box.x - 4, y: denmark.box.y - 4, w: denmark.box.w + 8, h: denmark.box.h + 8 };
    const grid = extractLand(rect);
    expect(grid).not.toBe(null);
    const g = gridLand(grid!, FEATURE_BITS);
    let checked = 0;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        expect(g.sample(x, y)).toBe(cacheLand.sample(x, y));
        for (const k of ['river', 'ridge', 'road', 'ford', 'bridge'] as const) expect(g[k](x, y), `${k} ${x}|${y}`).toBe(cacheLand[k](x, y));
        checked++;
      }
    }
    expect(checked).toBe(rect.w * rect.h);
    expect(g.homes(rect)).toEqual(cacheLand.homes(rect));
    expect(g.ready(rect)).toBe(true);
    expect(g.ready({ ...rect, w: rect.w + 1 })).toBe(false);
  });

  it('выпечка полосами даёт ту же решётку и тот же свет, что разом', () => {
    const x0 = HOME.x - 4;
    const y0 = HOME.y - 4;
    const cells = cellsFor(SEED, { sample: (x, y) => cacheLand.sample(x, y), river: cacheLand.river, ridge: cacheLand.ridge }, x0 - 12, y0 - 12, 34, 34, 0);
    const warp = warpFor(SEED, x0 - 12, y0 - 12, 34, 34);
    const n = 40;
    const step = 1 / 12;
    const ml = shadowMargin(12) + 1;
    const nx = n + ml + 1;
    const whole = heightGrid(SEED, cells, warp, x0, y0, nx, nx, step);
    const bands = emptyGrid(x0, y0, nx, nx, step);
    const folds = foldsFor(SEED, x0, y0, nx * step);
    for (let j = 0; j < nx; j += 7) heightRows(cells, warp, folds, bands, j, Math.min(nx, j + 7));
    expect(bands.top).toBe(whole.top);
    expect([...bands.h]).toEqual([...whole.h]);
    const look = { season: 0, castShadow: true };
    const a = { land: new Uint8ClampedArray(n * n * 4), water: new Uint8ClampedArray(n * n * 4) };
    const b = { land: new Uint8ClampedArray(n * n * 4), water: new Uint8ClampedArray(n * n * 4) };
    shade(SEED, cells, whole, { i0: ml, j0: ml, w: n, h: n }, look, a.land, a.water);
    for (let j = 0; j < n; j += 9) {
      const h = Math.min(9, n - j);
      shade(SEED, cells, bands, { i0: ml, j0: ml + j, w: n, h }, look, b.land.subarray(j * n * 4), b.water.subarray(j * n * 4));
    }
    expect([...b.land]).toEqual([...a.land]);
    expect([...b.water]).toEqual([...a.water]);
  });

  it('порядок работ — тот же при той же камере: регион прибывает одинаково у всех', () => {
    const run = (): string[] => {
      resetPrebake();
      const cam = held({ cx: HOME.x, cy: HOME.y, scale: 24 });
      prebakeFrame(cam, VP, 1, 0);
      for (let f = 2; f < 200 && prebakeState().dispatched.length < 24; f++) {
        prebakeFrame(cam, VP, f, f * 16);
        prebakeIdle(50);
      }
      return prebakeState().dispatched.slice(0, 24);
    };
    const a = run();
    expect(a.length).toBe(24);
    // Работы разных видов: видимое — раньше, и среди первых есть и обзор, и средний слой.
    expect(a.some((k) => k.startsWith('chunk:')) && a.some((k) => k.startsWith('mid:'))).toBe(true);
    expect(run()).toEqual(a);
  });
});
