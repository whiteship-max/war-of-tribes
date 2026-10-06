// Цель пальца на карте нового вида (`tw/tap.ts`, docs/map_tw.md, этап 2) и закон кадра у его объектов.
//
// Пороги владельца — «33 px и 780 мс» (как у города, `render/city/sites.test.ts`): объект открывается
// квадратом пальца 33 × 33 px целиком, а палец, пролежавший 780 мс или сошедший на 33 px, — уже не тап.
// Время и сход судит общий разбор жеста (`gestures.Gesture`), цель — коробка тела из сцены кадра.
//
// Область правила: масштабы карты от `SCALE_MIN` до `SCALE_MAX`, объект на экране телефона, палец целиком
// на экране. Каждая точка проверки утверждает, что лежит внутри неё (правило 11).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FigureView, MarchView, SettlementView, Stage } from '@/world/types';
import { CHUNK, WORLD_ORIGIN } from '@/world/data/tuning';
import { chunkKey, clearCache, putChunk } from '@/world/cache';
import { useWorld } from '@/world/store';
import { marchPosition } from '@/world/geo';
import { Gesture, TAP_MS, TAP_SLIP, TAP_TARGET } from '@/gestures';
import { SCALE_MAX, SCALE_MIN, SCALE_START } from '../const';
import type { Camera } from '../grid';
import { fakeCanvasEnv, waterChunk } from '../fakecanvas';
import { cacheFor } from '../grid';
import { dropMinis } from './mini';
import { figureItems, hostItems, MINI_HI, MINI_LO, placeItems, placeLookOf, placesRect } from './scene';
import { settlementsIn } from '../detail';
import { viewRect } from '../grid';
import { aimAt, aimsOf } from './tap';
import { drawTwFrame } from './frame';

/** Порог владельца: цель пальца не меньше 33 px; дольше 780 мс или дальше 33 px — не тап. */
const FINGER = 33;
const HOLD_MS = 780;

const VP = { w: 390, h: 844 };
const DPR = 2;
const START = 1_800_000_000_000;
const MID = { cx: 12, cy: 12 };
const AT = { x: WORLD_ORIGIN.x + MID.cx * CHUNK + 10, y: WORLD_ORIGIN.y + MID.cy * CHUNK + 10 };

/** Масштабы проверки: весь диапазон карты, с переливом миниатюр и значков. */
const SCALES = [SCALE_MIN, 5, 7, 9, MINI_LO, 12, 13, MINI_HI, 17, 24, 32, 38, SCALE_START, 56, SCALE_MAX];

const place = (o: Partial<SettlementView> & { id: string; x: number; y: number }): SettlementView => ({
  name: 'Место',
  stage: 'town',
  relation: 'neutral',
  owner: null,
  tribeId: null,
  tribeName: null,
  color: '#cbbca6',
  mine: false,
  castle: false,
  visible: true,
  seenAt: START,
  stale: false,
  seenPop: 100,
  marching: false,
  ruin: false,
  sacked: false,
  besieged: null,
  fell: null,
  ...o,
});

const march = (o: Partial<MarchView>): MarchView =>
  ({
    id: 'm1',
    own: false,
    hostile: true,
    phase: 'out',
    units: { warrior: 30 },
    from: { x: AT.x - 6, y: AT.y },
    to: { x: AT.x + 6, y: AT.y },
    // На минуте проверки отряд прошёл 47/120 пути: положение дробное (−1.3 клетки от середины), и клетка
    // по округлению (`store.marchOn`) отличается от клетки по отбрасыванию.
    departAt: START - 47_000,
    arriveAt: START + 73_000,
    targetId: 'x',
    ...o,
  }) as unknown as MarchView;

const figure = (o: Partial<FigureView>): FigureView =>
  ({
    id: 'scout',
    name: 'Разведчик',
    phase: 'field',
    place: 'map',
    from: { x: AT.x, y: AT.y },
    to: { x: AT.x, y: AT.y },
    at: { x: AT.x, y: AT.y },
    departAt: START - 1000,
    arriveAt: START - 1000,
    sight: 3,
    troops: {},
    ...o,
  }) as unknown as FigureView;

/** Камера, у которой точка объекта — посередине экрана. */
const camAt = (x: number, y: number, scale: number): Camera => ({ cx: x + 0.5, cy: y + 0.5, scale });

/** Середина тела и все точки квадрата пальца вокруг неё, через 3 px. */
function fingerPoints(cx: number, cy: number): [number, number][] {
  const out: [number, number][] = [];
  const h = FINGER / 2;
  for (let dy = -h; dy <= h + 1e-9; dy += 3) for (let dx = -h; dx <= h + 1e-9; dx += 3) out.push([cx + dx, cy + dy]);
  for (const [dx, dy] of [
    [-h, -h],
    [h, -h],
    [-h, h],
    [h, h],
  ])
    out.push([cx + dx, cy + dy]);
  return out;
}

const inScreen = ([x, y]: [number, number]): boolean => x >= 0 && y >= 0 && x <= VP.w && y <= VP.h;

let env: ReturnType<typeof fakeCanvasEnv>;
beforeAll(() => {
  env = fakeCanvasEnv();
  vi.useFakeTimers();
  vi.setSystemTime(START);
});
afterAll(() => {
  vi.useRealTimers();
  env.restore();
  clearCache();
});

describe('палец по карте нового вида: судья жеста — общий, пороги владельца', () => {
  it('тап короче 780 мс и ближе 33 px; цель не меньше 33 px', () => {
    expect(TAP_MS).toBeLessThan(HOLD_MS);
    expect(TAP_SLIP).toBeLessThan(FINGER);
    expect(TAP_TARGET).toBeGreaterThanOrEqual(FINGER);
  });

  it('жест на границах: 700 мс — тап, 780 мс — нет; сход на 33 px — нет', () => {
    const g = new Gesture();
    g.down(1, 100, 100, 0);
    expect(g.up(1, TAP_MS), 'тап на пределе длительности').toBe(true);
    g.down(1, 100, 100, 1000);
    expect(g.up(1, 1000 + HOLD_MS), 'палец, пролежавший 780 мс').toBe(false);
    g.down(1, 100, 100, 3000);
    g.move(1, 100 + FINGER, 100, 3100);
    expect(g.up(1, 3200), 'палец, сошедший на 33 px').toBe(false);
  });

  it('карта судит тап тем же жестом: клетку цели ищут только после `Gesture.up`', () => {
    const src = readFileSync(join(process.cwd(), 'src/ui/map/WorldMap.tsx'), 'utf8');
    const up = src.indexOf('const tapped = touch.current.up(e.pointerId, now);');
    const aim = src.indexOf('twSlot()?.tap(cam.current, vp(), p.x, p.y');
    expect(up).toBeGreaterThan(0);
    expect(aim).toBeGreaterThan(up);
    expect(src).toMatch(/const aimed = p && tapped \? twSlot\(\)\?\.tap\(/);
  });
});

describe('цель пальца: каждый объект открывается квадратом 33 × 33 px на любом масштабе', () => {
  const stages: Stage[] = ['camp', 'village', 'stronghold', 'town'];
  const places: [string, Partial<SettlementView>][] = [
    ['свой город', { mine: true, relation: 'self', color: '#e8a43c' }],
    ['замок соседа', { castle: true }],
    ['логово', { relation: 'barbarian', color: '#a2795a' }],
    ['пепелище', { relation: 'barbarian', ruin: true, stage: 'camp' }],
  ];

  it('места: все виды и размеры', () => {
    let checked = 0;
    for (const scale of SCALES) {
      expect(scale).toBeGreaterThanOrEqual(SCALE_MIN);
      expect(scale).toBeLessThanOrEqual(SCALE_MAX);
      for (const [what, o] of places) {
        for (const stage of stages) {
          const s = place({ id: 'p', x: AT.x, y: AT.y, stage, ...o });
          const cam = camAt(AT.x, AT.y, scale);
          const items = placeItems(cam, VP, [s], DPR);
          expect(items, `${what} ×${scale}: на экране`).toHaveLength(1);
          const b = items[0].body;
          const aims = aimsOf(items, [], []);
          const pts = fingerPoints((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
          for (const p of pts) {
            expect(inScreen(p), `${what} ×${scale}: палец на экране`).toBe(true);
            expect(aimAt(aims, p[0], p[1], false), `${what} ${stage} ×${scale}: точка ${p.map(Math.round)}`).toEqual({ x: AT.x, y: AT.y });
            expect(aimAt(aims, p[0], p[1], true), `${what} ${stage} ×${scale}, агент в руке`).toEqual({ x: AT.x, y: AT.y });
          }
          checked++;
        }
      }
    }
    expect(checked).toBe(SCALES.length * places.length * stages.length);
  });

  it('чужой отряд в пути, лагерь у цели и агент: свои клетки', () => {
    const discs = [{ x: AT.x, y: AT.y, r: 30 }];
    for (const scale of SCALES) {
      const cam = camAt(AT.x, AT.y, scale);
      // Чужой идущий: клетка — его округлённое положение, та же, что ищет `store.marchOn`.
      const going = march({});
      const hosts = hostItems(cam, VP, [going], discs, START, DPR);
      const pos = marchPosition(going, START);
      const want = { x: Math.round(pos.x), y: Math.round(pos.y) };
      expect(Math.round(pos.x)).not.toBe(Math.floor(pos.x));
      const b = hosts[0].body;
      for (const p of fingerPoints((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)) {
        expect(inScreen(p)).toBe(true);
        expect(aimAt(aimsOf([], hosts, []), p[0], p[1], false), `отряд ×${scale}`).toEqual(want);
      }
      // Лагерь у цели стоит сбоку от неё, а тап по нему — тап по цели.
      const camp = march({ phase: 'stay', units: { warrior: 30 }, to: { x: AT.x, y: AT.y } });
      const ch = hostItems(cam, VP, [camp], discs, START, DPR);
      const cb = ch[0].body;
      for (const p of fingerPoints((cb.x0 + cb.x1) / 2, (cb.y0 + cb.y1) / 2)) {
        expect(inScreen(p)).toBe(true);
        expect(aimAt(aimsOf([], ch, []), p[0], p[1], false), `лагерь ×${scale}`).toEqual(camp.to);
      }
      // Агент: клетка — его округлённое положение (`store.figuresOn`).
      const f = figure({});
      const fi = figureItems(cam, VP, [f], START, DPR);
      const fb = fi[0].body;
      for (const p of fingerPoints((fb.x0 + fb.x1) / 2, (fb.y0 + fb.y1) / 2)) {
        expect(inScreen(p)).toBe(true);
        expect(aimAt(aimsOf([], [], fi), p[0], p[1], false), `агент ×${scale}`).toEqual({ x: AT.x, y: AT.y });
      }
    }
  });

  it('свой поход пальцу не цель — как и прежде (`store.marchOn` ищет только чужой идущий)', () => {
    const cam = camAt(AT.x, AT.y, SCALE_START);
    const own = march({ own: true, hostile: false });
    const hosts = hostItems(cam, VP, [own], [], START, DPR);
    const b = hosts[0].body;
    expect(aimAt(aimsOf([], hosts, []), (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, false)).toBeNull();
  });

  it('промах рядом прощается, но не с агентом в руке: там это приказ идти', () => {
    const cam = camAt(AT.x, AT.y, 7);
    const items = placeItems(cam, VP, [place({ id: 'p', x: AT.x, y: AT.y })], DPR);
    const b = items[0].body;
    const cy = (b.y0 + b.y1) / 2;
    const half = Math.max((b.x1 - b.x0) / 2, TAP_TARGET / 2);
    const x = (b.x0 + b.x1) / 2 + half + 10;
    // Точка вне раздутой коробки, но в полупальце от неё.
    expect(aimAt(aimsOf(items, [], []), x, cy, false)).toEqual({ x: AT.x, y: AT.y });
    expect(aimAt(aimsOf(items, [], []), x, cy, true)).toBeNull();
  });

  it('соседние места на дальнем масштабе: палец в значке берёт свой, а не соседа', () => {
    const scale = SCALE_MIN;
    const a = place({ id: 'a', x: AT.x, y: AT.y });
    const b = place({ id: 'b', x: AT.x + 4, y: AT.y });
    const cam = camAt(AT.x + 2, AT.y, scale);
    const items = placeItems(cam, VP, [a, b], DPR);
    const aims = aimsOf(items, [], []);
    for (const it of items) {
      const cx = (it.body.x0 + it.body.x1) / 2;
      const cy = (it.body.y0 + it.body.y1) / 2;
      expect(aimAt(aims, cx, cy, false)).toEqual({ x: it.s.x, y: it.s.y });
    }
  });
});

describe('находки проверки этапа 2', () => {
  it('с агентом в руке агенты — не цели: тап рядом с ним — клетка под пальцем (приказ идти)', () => {
    const cam = camAt(AT.x, AT.y, 7);
    const fi = figureItems(cam, VP, [figure({})], START, DPR);
    const b = fi[0].body;
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    expect(aimAt(aimsOf([], [], fi), cx, cy, false), 'без руки — агент').toEqual({ x: AT.x, y: AT.y });
    // Две клетки вбок на 7 px на клетку — внутри раздутой до пальца коробки агента.
    expect(cx + 14).toBeLessThan(cx + TAP_TARGET / 2);
    expect(aimAt(aimsOf([], [], fi), cx + 14, cy, true), 'с рукой — не агент').toBeNull();
  });

  it('круг обзора — от настоящей клетки агента, а не от точки рисунка у ворот', () => {
    clearCache();
    const home = place({ id: 'h', x: AT.x, y: AT.y, mine: true, relation: 'self', color: '#e8a43c' });
    for (let cy = MID.cy - 1; cy <= MID.cy + 1; cy++) {
      for (let cx = MID.cx - 1; cx <= MID.cx + 1; cx++) putChunk(chunkKey(cx, cy), waterChunk(cx, cy, [home]), START);
    }
    const cam = camAt(AT.x, AT.y, SCALE_START);
    const [f] = figureItems(cam, VP, [figure({})], START, DPR);
    // Точка рисунка сдвинута к воротам, настоящая — середина клетки дома (середина экрана).
    expect(f.spot.px).toBeGreaterThan(VP.w / 2 + 20);
    expect(f.at[0]).toBeCloseTo(VP.w / 2, 6);
    expect(f.at[1]).toBeCloseTo(VP.h / 2, 6);
    clearCache();
  });

  it('город из соседнего куска за краем экрана рисуется и ловит палец', () => {
    clearCache();
    // Значок места — с клетку на ближнем масштабе (`tw/marks.ts`), и за краем экрана на полклетки он целиком за краем;
    // на 20 px на клетку диск шире половины клетки и заходит на экран — точка внутри области правила (тело на экране
    // проверено ниже).
    const scale = 20;
    // Правый край экрана — за долю клетки до начала следующего куска; город — в первом столбце того куска.
    const nextX = WORLD_ORIGIN.x + (MID.cx + 1) * CHUNK;
    const cam: Camera = { cx: nextX - 0.01 - VP.w / 2 / scale, cy: AT.y + 0.5, scale };
    const town = place({ id: 't', x: nextX, y: AT.y });
    for (let cy = MID.cy - 1; cy <= MID.cy + 1; cy++) {
      for (let cx = MID.cx - 1; cx <= MID.cx + 2; cx++) putChunk(chunkKey(cx, cy), waterChunk(cx, cy, cx === MID.cx + 1 ? [town] : []), START);
    }
    const rect = viewRect(cam, VP);
    // Точка проверки внутри области правила: город за экраном, его кусок экран не задевает.
    expect(rect.x + rect.w).toBeLessThan(nextX);
    expect(settlementsIn(rect)).toHaveLength(0);
    const items = placeItems(cam, VP, settlementsIn(placesRect(rect)), DPR);
    expect(items.map((i) => i.s.id)).toEqual(['t']);
    // Тело города заходит на экран — и палец у края экрана его берёт.
    expect(items[0].body.x0).toBeLessThan(VP.w);
    expect(aimAt(aimsOf(items, [], []), VP.w - 4, items[0].sy, false)).toEqual({ x: nextX, y: AT.y });
    clearCache();
  });

  it('ночь — до меток: бейджи и сроки кадр откладывает и рисует после ночной заливки', () => {
    const strip = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const src = strip(readFileSync(join(process.cwd(), 'src/ui/map/tw/frame.ts'), 'utf8'));
    const night = src.indexOf('drawNight(ctx, vp.w');
    const flush = src.indexOf('for (const draw of marks) draw();');
    expect(night).toBeGreaterThan(0);
    expect(flush).toBeGreaterThan(night);
    // Срок и бейдж нигде не рисуются мимо очереди меток.
    expect([...src.matchAll(/drawTimer\(ctx, /g)].length).toBe([...src.matchAll(/marks\.push\(\(\) => drawTimer\(ctx, /g)].length);
    expect(src).toMatch(/marks\.push\(\(\) => \{\s*ctx\.globalAlpha = blink/);
  });

  it('сезон и уровень сверяются в каждом кадре нового вида, а не только при выпечке тайлов', () => {
    const src = readFileSync(join(process.cwd(), 'src/ui/map/tw/hook.ts'), 'utf8');
    expect(src).toMatch(/frame\(ctx, cam, vp, dpr, frame\) \{[\s\S]*?if \(syncLook\(\)\) prebakeLook\(\);[\s\S]*?drawTwFrame\(ctx, cam, vp, dpr, frame\);/);
  });
});

describe('вид места из полей мира', () => {
  it('своё — всегда каменный город, чужое — по своей стадии; живой игрок — замок, логово, пепелище', () => {
    for (const stage of ['camp', 'village', 'stronghold', 'town'] as Stage[]) {
      const own = placeLookOf(place({ id: 'h', x: 0, y: 0, mine: true, relation: 'self', stage }));
      expect(own).toMatchObject({ kind: 'city', stage: 'town', own: true });
      expect(placeLookOf(place({ id: 'n', x: 0, y: 0, stage })).stage).toBe(stage);
      expect(placeLookOf(place({ id: 'c', x: 0, y: 0, castle: true, stage }))).toMatchObject({ kind: 'castle', stage });
      expect(placeLookOf(place({ id: 'l', x: 0, y: 0, relation: 'barbarian', stage }))).toMatchObject({ kind: 'lair', stage });
    }
    expect(placeLookOf(place({ id: 'r', x: 0, y: 0, relation: 'barbarian', ruin: true, stage: 'camp' })).kind).toBe('ruin');
  });
});

describe('агенты у ворот своего места', () => {
  it('четверо дома стоят справа от города, не на крышах; тап по ним — клетка дома', () => {
    clearCache();
    const home = place({ id: 'h', x: AT.x, y: AT.y, mine: true, relation: 'self', color: '#e8a43c' });
    for (let cy = MID.cy - 1; cy <= MID.cy + 1; cy++) {
      for (let cx = MID.cx - 1; cx <= MID.cx + 1; cx++) putChunk(chunkKey(cx, cy), waterChunk(cx, cy, [home]), START);
    }
    const four = (['scout', 'diplomat', 'general', 'spy'] as const).map((id) => figure({ id }));
    // Масштабы, на которых город с четырьмя у ворот целиком на экране телефона (на 80 px веер уходит за край —
    // туда камера доезжает панорамой).
    for (const scale of [SCALE_MIN, 9, MINI_HI, 24, SCALE_START]) {
      const cam = camAt(AT.x, AT.y, scale);
      const places = placeItems(cam, VP, [home], DPR);
      const body = places[0].body;
      const figs = figureItems(cam, VP, four, START, DPR);
      expect(figs).toHaveLength(4);
      for (const f of figs) {
        // Тело агента — правее тела города: ни один силуэт не лежит на крышах.
        expect(f.body.x0, `×${scale}: агент правее города`).toBeGreaterThanOrEqual(body.x1);
        expect(f.cell).toEqual({ x: AT.x, y: AT.y });
        const cx = (f.body.x0 + f.body.x1) / 2;
        const cy = (f.body.y0 + f.body.y1) / 2;
        expect(inScreen([cx, cy])).toBe(true);
        expect(aimAt(aimsOf(places, [], figs), cx, cy, false)).toEqual({ x: AT.x, y: AT.y });
      }
    }
    clearCache();
  });
});

describe('кадр нового вида стоя не печёт ничего', () => {
  it('места, отряды, агенты и подписи: после прогрева ни холста', () => {
    clearCache();
    dropMinis();
    const list = [
      place({ id: 'h', x: AT.x, y: AT.y, mine: true, relation: 'self', color: '#e8a43c', name: 'Генуя' }),
      place({ id: 'l', x: AT.x + 3, y: AT.y - 2, relation: 'barbarian', color: '#a2795a', stage: 'village', name: 'Логово' }),
      place({ id: 'r', x: AT.x - 3, y: AT.y + 2, relation: 'barbarian', ruin: true, stage: 'camp', name: 'Пепелище' }),
      place({ id: 'c', x: AT.x + 2, y: AT.y + 3, castle: true, name: 'Замок', besieged: { since: START - 60_000 } }),
    ];
    for (let cy = MID.cy - 1; cy <= MID.cy + 1; cy++) {
      for (let cx = MID.cx - 1; cx <= MID.cx + 1; cx++) putChunk(chunkKey(cx, cy), waterChunk(cx, cy, list), START);
    }
    useWorld.setState({
      info: { seed: 20260912, size: 800, origin: WORLD_ORIGIN, home: AT, homeId: 'h', createdAt: START },
      marches: [march({ targetId: 'h' }), march({ id: 'm2', phase: 'stay', own: true, hostile: false, to: { x: AT.x + 2, y: AT.y + 3 } })],
      figures: [figure({}), figure({ id: 'general', troops: { spearman: 25 } })],
      selected: { x: AT.x, y: AT.y },
      spotlight: null,
      picked: 'scout',
    } as never);
    const ctx = (globalThis as unknown as { document: { createElement: () => { getContext: () => CanvasRenderingContext2D } } })
      .document.createElement()
      .getContext();
    const capacity = cacheFor(VP);
    for (const scale of [SCALE_START, 24, 9]) {
      const cam = camAt(AT.x, AT.y, scale);
      const frames = capacity + 30;
      let late = 0;
      for (let f = 1; f <= frames; f++) {
        vi.setSystemTime(START + f * 50);
        const c0 = env.created();
        drawTwFrame(ctx, cam, VP, DPR, f);
        if (f > capacity) {
          late += env.created() - c0;
        }
      }
      expect(late, `×${scale}: холстов стоя после прогрева`).toBe(0);
    }
  });
});

describe('размер чужого отряда — только в живом обзоре, одним правилом с миром', () => {
  it('сцена нового вида зовёт тот же вызов, что прежний кадр', () => {
    const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const scene = strip(readFileSync(join(process.cwd(), 'src/ui/map/tw/scene.ts'), 'utf8'));
    // Строка правила целиком (`…pos.y)`) или `true` своего войска: третьего правила в сцене нет.
    const seen = [...scene.matchAll(/seen: (m\.own \|\| inSight\([^)]*\)|[^,}\s]+)/g)].map((m) => m[1]).sort();
    expect(seen).toEqual(['m.own || inSight(discs, pos.x, pos.y)', 'true']);
    expect(scene).not.toMatch(/HOME_SIGHT|watchSight|liveSight/);
    const frame = strip(readFileSync(join(process.cwd(), 'src/ui/map/tw/frame.ts'), 'utf8'));
    expect(frame).toMatch(/const discs = sightDiscs\(now\)/);
  });

  it('неувиденный чужой отряд — слух без фигур, увиденный — с ними', () => {
    const cam = camAt(AT.x, AT.y, SCALE_START);
    const m = march({ units: { warrior: 40 } });
    expect(hostItems(cam, VP, [m], [], START, DPR)[0].look.size).toBe(0);
    expect(hostItems(cam, VP, [m], [{ x: AT.x, y: AT.y, r: 30 }], START, DPR)[0].look.size).toBeGreaterThan(0);
  });
});
