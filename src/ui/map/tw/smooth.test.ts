// Плавность карты (К-1, docs/telemetry.md): что починено — то и держится. Кадр не заливает экран слоями, которых не видно;
// не перепекает и не пересчитывает того, что не менялось; сторож плавности опускает кадр карты, а не выпечку и не город.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CHUNK, WORLD_ORIGIN } from '@/world/data/tuning';
import { QUALITY, VILLAGE_STEADY } from '@/render/quality';
import { GFX_AUTO_KEY, noteSceneLevel, setGfx, setGfxStorage } from '@/render/gfx';
import { onSteadyDrop } from '@/render/steady';
import { DEFAULT_ARMS, armsCode, armsOr, lairArms } from '@/heraldry/arms';
import { type Camera, type Viewport, cacheFor, capacityCounted, detailAlpha, tileOrigin, tileRangeFor, viewRect } from '../grid';
import { placeArms } from '../arms';
import { fakeCanvasEnv } from '../fakecanvas';
import { setTwLook } from './bake';
import { MID_CELLS } from './bake';
import { drawGround, groundFloor, midAlpha, usedRect } from './layers';
import { drawTwPaper, dropPaperSheet, paperBakes } from './paper';
import type { Ground } from './prebake';
import { mapLevel, resetMapGuard, twQuality, watchMap } from './quality';
import { drawTwZones, dropTwZones } from './zones';
import { MARK_BAKES_STILL, type MarkLook, dropMarks, markAt, markBakesCount, markFrame, markPending } from './marks';

const VP: Viewport = { w: 390, h: 844 };

/** Холст, который помнит, что на него скопировали. */
function recorder(): { ctx: CanvasRenderingContext2D; drawn: unknown[] } {
  const drawn: unknown[] = [];
  const ctx = {
    drawImage: (pic: unknown) => void drawn.push(pic),
    fillRect: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    globalAlpha: 1,
    imageSmoothingEnabled: true,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, drawn };
}

interface Pic {
  layer: 'coarse' | 'overview' | 'mid' | 'near';
  x: number;
  y: number;
}

/** Испечённое региона без холстов: у каждого слоя всё на месте, кроме названного пропавшим. */
function ground(missing: { near?: [number, number][]; overview?: [number, number][]; mid?: [number, number][] } = {}): Ground {
  const gone = (list: [number, number][] | undefined, x: number, y: number): boolean => (list ?? []).some(([a, b]) => a === x && b === y);
  const pic = (layer: Pic['layer'], x: number, y: number): Pic => ({ layer, x, y });
  return {
    coarse: pic('coarse', 0, 0),
    dataRect: { x: WORLD_ORIGIN.x, y: WORLD_ORIGIN.y, w: 4000, h: 4000 },
    overview: (x: number, y: number) => (gone(missing.overview, x, y) ? null : pic('overview', x, y)),
    mid: (x: number, y: number) => (gone(missing.mid, x, y) ? null : pic('mid', x, y)),
    near: (x: number, y: number) => (gone(missing.near, x, y) ? null : pic('near', x, y)),
    nearWanted: () => true,
  } as unknown as Ground;
}

const layersOf = (drawn: unknown[]): string[] => [...new Set((drawn as Pic[]).map((p) => p.layer))].sort();

describe('пол земли: под сплошным непрозрачным слоем нижние не рисуются (К-1)', () => {
  beforeEach(() => setTwLook({ quality: 'medium' }));

  // Середина экрана — далеко от края мира (у края тайлов меньше, и тест мерил бы край) и у угла четырёх кусков обзора:
  // «только кусок под дырой» значит что-то, лишь когда кусков на экране больше одного.
  const at = (scale: number): Camera => ({ cx: WORLD_ORIGIN.x + 13 * CHUNK + 0.3, cy: WORLD_ORIGIN.y + 13 * CHUNK + 0.7, scale });

  it('вблизи все тайлы на месте — только тайлы, без обзора, среднего слоя и грубого растра', () => {
    const cam = at(46);
    // Точка внутри области правила: ближний масштаб виден целиком.
    expect(detailAlpha(cam.scale)).toBe(1);
    const rect = viewRect(cam, VP);
    const g = ground();
    expect(groundFloor(cam, VP, rect, g)).toBe(4);
    const { ctx, drawn } = recorder();
    drawGround(ctx, cam, VP, rect, g);
    expect(layersOf(drawn)).toEqual(['near']);
    const r = tileRangeFor(rect);
    expect(drawn).toHaveLength((r.tx1 - r.tx0 + 1) * (r.ty1 - r.ty0 + 1));
  });

  it('вблизи недостаёт тайла — под ним средний слой, только его тайл; недостаёт и среднего — обзор, только его кусок', () => {
    const cam = at(46);
    expect(detailAlpha(cam.scale)).toBe(1);
    expect(midAlpha(cam.scale)).toBe(1);
    const rect = viewRect(cam, VP);
    const r = tileRangeFor(rect);
    const hole: [number, number] = [r.tx0 + 1, r.ty0 + 1];
    // Что лежит под дырой: средние тайлы и куски обзора, которые задевает тайл (6 клеток на 8 и на 32 — не кратно).
    const o = tileOrigin(hole[0], hole[1]);
    const under = (step: number): { x: number; y: number }[] => {
      const out: { x: number; y: number }[] = [];
      for (let y = Math.floor((o.y - WORLD_ORIGIN.y) / step); y <= Math.floor((o.y + 5.999 - WORLD_ORIGIN.y) / step); y++)
        for (let x = Math.floor((o.x - WORLD_ORIGIN.x) / step); x <= Math.floor((o.x + 5.999 - WORLD_ORIGIN.x) / step); x++) out.push({ x, y });
      return out;
    };
    const mids = under(MID_CELLS);
    const chunks = under(CHUNK);
    const pick = (drawn: unknown[], layer: Pic['layer']): { x: number; y: number }[] =>
      (drawn as Pic[]).filter((p) => p.layer === layer).map(({ x, y }) => ({ x, y }));

    // Дыра закрыта землёй, а не прежним кадром: средние тайлы под ней — и только они.
    const a = recorder();
    drawGround(a.ctx, cam, VP, rect, ground({ near: [hole] }));
    expect(layersOf(a.drawn)).toEqual(['mid', 'near']);
    expect(pick(a.drawn, 'mid')).toEqual(mids);

    // Нет и среднего — обзор, только куски под дырой; обзор целиком на месте — грубый растр не нужен.
    const b = recorder();
    drawGround(b.ctx, cam, VP, rect, ground({ near: [hole], mid: mids.map(({ x, y }) => [x, y] as [number, number]) }));
    expect(layersOf(b.drawn)).toEqual(['near', 'overview']);
    expect(pick(b.drawn, 'overview')).toEqual(chunks);
    const onScreen =
      (Math.floor((rect.x + rect.w - WORLD_ORIGIN.x) / CHUNK) - Math.floor((rect.x - WORLD_ORIGIN.x) / CHUNK) + 1) *
      (Math.floor((rect.y + rect.h - WORLD_ORIGIN.y) / CHUNK) - Math.floor((rect.y - WORLD_ORIGIN.y) / CHUNK) + 1);
    expect(onScreen).toBeGreaterThan(chunks.length);
  });

  it('на среднем масштабе средний слой на месте — без обзора и грубого растра; недостаёт его тайла — обзор под ним', () => {
    const cam = at(24);
    // Внутри области правила: средний слой без прозрачности, ближнего ещё нет.
    expect(midAlpha(cam.scale)).toBe(1);
    expect(detailAlpha(cam.scale)).toBe(0);
    const rect = viewRect(cam, VP);
    const full = recorder();
    drawGround(full.ctx, cam, VP, rect, ground());
    expect(layersOf(full.drawn)).toEqual(['mid']);
    const tx = Math.floor((rect.x - WORLD_ORIGIN.x) / MID_CELLS) + 1;
    const ty = Math.floor((rect.y - WORLD_ORIGIN.y) / MID_CELLS) + 1;
    const holed = recorder();
    drawGround(holed.ctx, cam, VP, rect, ground({ mid: [[tx, ty]] }));
    expect(layersOf(holed.drawn)).toEqual(['mid', 'overview']);
  });

  it('издали: обзор целиком — без грубого растра; недостаёт куска — грубый растр под всем', () => {
    const cam = at(8);
    expect(midAlpha(cam.scale)).toBe(0);
    const rect = viewRect(cam, VP);
    const full = recorder();
    drawGround(full.ctx, cam, VP, rect, ground());
    expect(layersOf(full.drawn)).toEqual(['overview']);
    const cx = Math.floor((rect.x - WORLD_ORIGIN.x) / CHUNK) + 1;
    const cy = Math.floor((rect.y - WORLD_ORIGIN.y) / CHUNK) + 1;
    const holed = recorder();
    drawGround(holed.ctx, cam, VP, rect, ground({ overview: [[cx, cy]] }));
    expect(layersOf(holed.drawn)).toEqual(['coarse', 'overview']);
  });
});

describe('растры с пустыми краями копируются только там, где не пусты (К-1)', () => {
  it('рамка непустого — с запасом в клетку, в пределах растра; пустой растр — null', () => {
    const area = { x: 100, y: 200, w: 10, h: 8 };
    const d = new Uint8ClampedArray(area.w * area.h * 4);
    expect(usedRect(d, area)).toBeNull();
    d[(3 * area.w + 4) * 4 + 3] = 40;
    d[(5 * area.w + 6) * 4 + 3] = 255;
    expect(usedRect(d, area)).toEqual({ x: 103, y: 202, w: 5, h: 5 });
    d[(0 * area.w + 0) * 4 + 3] = 1;
    expect(usedRect(d, area)).toEqual({ x: 100, y: 200, w: 8, h: 7 });
  });

  it('владений нет нигде — кадр не копирует растр владений вовсе', () => {
    const env = fakeCanvasEnv();
    try {
      dropTwZones();
      const { ctx, drawn } = recorder();
      const cam: Camera = { cx: WORLD_ORIGIN.x + 500, cy: WORLD_ORIGIN.y + 500, scale: 24 };
      for (let i = 0; i < 5; i++) drawTwZones(ctx, cam, VP, 0, { rect: { x: WORLD_ORIGIN.x + 400, y: WORLD_ORIGIN.y + 400, w: 200, h: 200 }, stamp: 1, may: true });
      expect(drawn).toHaveLength(0);
    } finally {
      dropTwZones();
      env.restore();
    }
  });
});

describe('бумага: зерно и затемнение — одним листом, испечённым раз на размер окна (К-1)', () => {
  it('десять кадров — одна выпечка и по одному копированию на кадр; новый размер окна — новая выпечка', () => {
    const env = fakeCanvasEnv();
    try {
      dropPaperSheet();
      const from = paperBakes();
      const { ctx, drawn } = recorder();
      for (let i = 0; i < 10; i++) drawTwPaper(ctx, VP);
      expect(paperBakes() - from).toBe(1);
      expect(drawn).toHaveLength(10);
      drawTwPaper(ctx, { w: 400, h: 844 });
      expect(paperBakes() - from).toBe(2);
    } finally {
      dropPaperSheet();
      env.restore();
    }
  });
});

describe('уровень карты читается при перемене, а не на каждом вопросе (К-1)', () => {
  let reads = 0;
  let writes: string[] = [];
  const mem = new Map<string, string>();
  beforeEach(() => {
    reads = 0;
    writes = [];
    mem.clear();
    setGfxStorage({
      read: (k) => {
        reads++;
        return mem.get(k) ?? null;
      },
      write: (k, v) => {
        writes.push(k);
        mem.set(k, v);
      },
    });
    noteSceneLevel(null);
    resetMapGuard();
  });
  afterEach(() => {
    onSteadyDrop(null);
    noteSceneLevel(null);
    setGfxStorage({ read: () => null, write: () => undefined });
    resetMapGuard();
  });

  it('сотня вопросов за кадр — хранилище читается раз; выбор игрока сменился — читается снова', () => {
    for (let i = 0; i < 100; i++) {
      twQuality('');
      mapLevel('');
    }
    const once = reads;
    expect(once).toBeGreaterThan(0);
    expect(once).toBeLessThanOrEqual(3);
    setGfx({ quality: 'low' });
    expect(twQuality('')).toBe('low');
    expect(mapLevel('')).toBe('low');
  });

  it('сторож опускает кадр карты, а не выпечку и не город; ровный ход не опускает ничего', () => {
    noteSceneLevel('medium');
    const rule = VILLAGE_STEADY('medium');
    const drops: [string, string][] = [];
    onSteadyDrop((a, b) => drops.push([a, b]));
    // Ровный ход: шестьдесят кадров в секунду, пять секунд — ни одного понижения.
    for (let i = 0; i < 300; i++) watchMap(1000 / 60, '');
    expect(mapLevel('')).toBe('medium');
    // Рывки: промежуток длиннее порога медленного кадра и короче паузы — внутри области правила сторожа.
    const slow = 50;
    expect(slow).toBeGreaterThan(rule.slowMs);
    expect(slow).toBeLessThan(rule.gapMs);
    for (let i = 0; i < 200 && mapLevel('') === 'medium'; i++) watchMap(slow, '');
    expect(mapLevel('')).toBe('low');
    expect(drops).toEqual([['medium', 'low']]);
    // Кадр карты — плотнее не стал, земля печётся прежним уровнем, город своего не потерял.
    expect(QUALITY[mapLevel('')].mapDpr).toBeLessThan(QUALITY.medium.mapDpr);
    expect(twQuality('')).toBe('medium');
    expect(writes).not.toContain(GFX_AUTO_KEY);
  });

  it('уровень выбран игроком — сторожа нет, как у города', () => {
    setGfx({ quality: 'medium' });
    for (let i = 0; i < 400; i++) watchMap(50, '');
    expect(mapLevel('')).toBe('medium');
  });

  it('первый кадр хода (промежуток 0) не судится', () => {
    noteSceneLevel('medium');
    for (let i = 0; i < 400; i++) watchMap(0, '');
    expect(mapLevel('')).toBe('medium');
  });
});

describe('что не меняется от кадра к кадру, не считается заново (К-1)', () => {
  it('ёмкость кэша земли — раз на размер экрана, а не на кадр', () => {
    const vp: Viewport = { w: 377, h: 811 };
    const from = capacityCounted();
    const n = cacheFor(vp);
    for (let i = 0; i < 50; i++) expect(cacheFor(vp)).toBe(n);
    expect(capacityCounted() - from).toBe(1);
    cacheFor({ w: 378, h: 811 });
    expect(capacityCounted() - from).toBe(2);
  });

  it('герб места — тот же, что выводит набор, и при повторном вопросе', () => {
    const lair = { id: 'L7', mine: false, relation: 'barbarian' as const, arms: null };
    const own = { id: 'C1', mine: true, relation: 'neutral' as const, arms: null };
    const plain = { id: 'C2', mine: false, relation: 'neutral' as const, arms: null };
    for (let i = 0; i < 2; i++) {
      expect(placeArms(lair as never, null)).toBe(armsCode(lairArms('L7')));
      expect(placeArms(own as never, 'nonsense')).toBe(armsCode(armsOr('nonsense')));
      expect(placeArms(own as never, null)).toBe(armsCode(DEFAULT_ARMS));
      expect(placeArms(plain as never, null)).toBe(armsCode(DEFAULT_ARMS));
    }
  });
});

describe('значки мест на щипке: новый размер не печётся на ходу (К-1)', () => {
  const look = (i: number): MarkLook => ({ glyph: 'stage-town', ring: '#aa3322', pips: 2, own: false, dim: false, corner: null, arms: `heater-plain-gules-gules-tower-or-${i}` });
  let env: ReturnType<typeof fakeCanvasEnv>;
  beforeEach(() => {
    env = fakeCanvasEnv();
    dropMarks();
  });
  afterEach(() => {
    dropMarks();
    markFrame(false);
    env.restore();
  });

  it('на ходу — испечённый соседнего размера, растянутый; камера встала — точные пекутся по нескольку за кадр', () => {
    const places = 12;
    expect(places).toBeGreaterThan(MARK_BAKES_STILL);
    // Вход на карту: камера стоит, значков нет ни одного — пекутся все (взять их не из чего).
    markFrame(false);
    let from = markBakesCount();
    for (let i = 0; i < places; i++) expect(markAt(look(i), 30, 2).k).toBe(1);
    expect(markBakesCount() - from).toBe(places);
    // Щипок: диаметр 32 — ни одной выпечки, каждый значок — тридцатый, растянутый до тридцать второго.
    markFrame(true);
    from = markBakesCount();
    for (let i = 0; i < places; i++) {
      const { m, k } = markAt(look(i), 32, 2);
      expect(k).toBeCloseTo(32 / 30, 9);
      expect(m.w).toBeGreaterThan(0);
    }
    expect(markBakesCount() - from).toBe(0);
    expect(markPending()).toBe(true);
    // Камера встала: точные — не больше MARK_BAKES_STILL за кадр, пока не испекутся все; потом кадр чист.
    let frames = 0;
    for (; frames < 10; frames++) {
      markFrame(false);
      const before = markBakesCount();
      for (let i = 0; i < places; i++) markAt(look(i), 32, 2);
      expect(markBakesCount() - before).toBeLessThanOrEqual(MARK_BAKES_STILL);
      if (!markPending()) break;
    }
    // Кадров с выпечкой — ровно столько, сколько нужно по MARK_BAKES_STILL (номер последнего — с нуля).
    expect(frames + 1).toBe(Math.ceil(places / MARK_BAKES_STILL));
    for (let i = 0; i < places; i++) expect(markAt(look(i), 32, 2).k).toBe(1);
  });
});
