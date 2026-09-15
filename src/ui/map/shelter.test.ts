// Агент, укрывшийся в своём городе, на полотне карты: не рисуется — и земле это не
// стоит ни одной выпечки.
//
// Правила места у агента (одно место, никогда в двух и никогда нигде) держит
// `world/shelter.test.ts` читателями мира и стора. Здесь — третий читатель, кадр: он
// рисует агентов по готовому `place`, и стоит ему спросить фазу — укрывшийся
// нарисуется у ворот, оставаясь в городе. Кадр настоящий (`frame.drawFrame`), холст —
// записывающая заглушка, выпечки считает `ground.tileBakes`: карта печёт землю в кэш и
// однажды уже горела на перепечке от рисовки, которая земли не касалась.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chunkKey, clearCache, putChunk } from '@/world/cache';
import { useWorld } from '@/world/store';
import { CHUNK, WORLD_ORIGIN } from '@/world/data/tuning';
import { FIGURE_BY_ID, FIGURE_IDS } from '@/world/data/figures';
import type { FigureId, FigureView } from '@/world/types';
import type { FigurePlace } from '@/world/shelter';
import { SCALE_START } from './const';
import { cacheFor } from './grid';
import { drawFrame } from './frame';
import { drawFigures } from './figures';
import { dropTiles, tileBakes } from './ground';
import { fakeCanvasEnv, waterChunk } from './fakecanvas';

const START = 1_800_000_000_000;
const MID = { cx: 12, cy: 12 };
const HOME = { x: WORLD_ORIGIN.x + MID.cx * CHUNK + 10, y: WORLD_ORIGIN.y + MID.cy * CHUNK + 10 };
const VP = { w: 375, h: 812 };

/** Агент у своих ворот: стоит на карте или укрылся в городе на той же клетке. */
const agent = (id: FigureId, place: FigurePlace): FigureView => ({
  id,
  name: FIGURE_BY_ID[id].name,
  icon: FIGURE_BY_ID[id].icon,
  phase: 'home',
  place,
  at: { ...HOME },
  from: { ...HOME },
  to: { ...HOME },
  departAt: START,
  arriveAt: START,
  sight: FIGURE_BY_ID[id].sight,
  atId: 'home',
  atName: 'Дом',
  atHome: true,
  downUntil: 0,
  held: false,
  gone: null,
  retiring: false,
  busyUntil: 0,
  watching: false,
  watchSight: 0,
  troops: {},
  power: 0,
  capacity: 0,
  besieging: null,
  readyAt: 0,
});

/** Холст кадра со счётчиком `drawImage`: агент на полотне — это ровно один такой вызов. */
function frameCtx(): { ctx: CanvasRenderingContext2D; images: () => number } {
  let images = 0;
  const ctx = (globalThis as unknown as { document: { createElement: () => { getContext: () => CanvasRenderingContext2D } } })
    .document.createElement()
    .getContext();
  (ctx as unknown as { drawImage: () => void }).drawImage = () => {
    images++;
  };
  return { ctx, images: () => images };
}

describe('укрывшийся агент на полотне', () => {
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

  it('стоящий у ворот рисуется, укрывшийся на той же клетке — нет', () => {
    const cam = { cx: HOME.x + 0.5, cy: HOME.y + 0.5, scale: SCALE_START };
    const draw = (places: Record<FigureId, FigurePlace>): number => {
      const { ctx, images } = frameCtx();
      drawFigures(ctx, cam, VP, FIGURE_IDS.map((id) => agent(id, places[id])), null, START, 2);
      return images();
    };
    const all = Object.fromEntries(FIGURE_IDS.map((id) => [id, 'map'])) as Record<FigureId, FigurePlace>;
    // Проверка не пустая: четверо стоящих — четыре фигуры на полотне.
    expect(draw(all)).toBe(FIGURE_IDS.length);
    for (const id of FIGURE_IDS) {
      expect(draw({ ...all, [id]: 'city' }), `${id} укрылся, а нарисован`).toBe(FIGURE_IDS.length - 1);
    }
    const hidden = Object.fromEntries(FIGURE_IDS.map((id) => [id, 'city'])) as Record<FigureId, FigurePlace>;
    expect(draw(hidden)).toBe(0);
  });

  /**
   * Кадры карты над домом: камера по пути `camAt`; агенты по кадру `placesAt` —
   * одни стоят, другие входят в город и выходят, как это делает игрок пульсами.
   */
  function run(frames: number, camAt: (f: number) => { cx: number; cy: number }, placesAt: (f: number) => FigurePlace[]) {
    clearCache();
    for (let cy = MID.cy - 1; cy <= MID.cy + 1; cy++) {
      for (let cx = MID.cx - 1; cx <= MID.cx + 1; cx++) putChunk(chunkKey(cx, cy), waterChunk(cx, cy, []), START);
    }
    useWorld.setState({
      info: { seed: 20260912, size: 800, origin: WORLD_ORIGIN, home: HOME, homeId: 'home', createdAt: START },
      marches: [],
      figures: [],
      picked: null,
      selected: null,
      spotlight: null,
    });
    dropTiles();
    const { ctx, images } = frameCtx();
    const bakes: number[] = [];
    for (let f = 1; f <= frames; f++) {
      vi.setSystemTime(START + f * 500);
      const places = placesAt(f);
      useWorld.setState({ figures: FIGURE_IDS.map((id, i) => agent(id, places[i])) });
      const before = tileBakes();
      drawFrame(ctx, { ...camAt(f), scale: SCALE_START }, VP, 2, f);
      bakes.push(tileBakes() - before);
    }
    return { bakes, images: images() };
  }

  const total = (a: number[]): number => a.reduce((x, y) => x + y, 0);
  const standing = (): FigurePlace[] => FIGURE_IDS.map(() => 'map');
  // Каждые десять кадров кто-то входит или выходит: двое по очереди, всё время прогона.
  const shuffling = (f: number): FigurePlace[] =>
    FIGURE_IDS.map((_, i) => (i < 2 && Math.floor(f / 10 + i) % 2 === 1 ? 'city' : 'map'));

  it('неподвижная камера: входы и выходы агентов не печут земли — ни одной выпечки сверх запроса', () => {
    const capacity = cacheFor(VP);
    const frames = capacity + 120;
    const still = () => ({ cx: HOME.x + 0.5, cy: HOME.y + 0.5 });
    const calm = run(frames, still, standing);
    const busy = run(frames, still, shuffling);
    expect(total(calm.bakes.slice(capacity)), 'выпечек стоя, агенты стоят').toBe(0);
    expect(total(busy.bakes.slice(capacity)), 'выпечек стоя, агенты входят и выходят').toBe(0);
    expect(total(busy.bakes)).toBe(total(calm.bakes));
    // Проверка не пустая: земля в начале пеклась, и входы в город на полотне были
    // видны — фигур нарисовано меньше, чем у стоящих.
    expect(total(calm.bakes)).toBeGreaterThan(0);
    expect(busy.images).toBeLessThan(calm.images);
  });

  it('камера в движении печёт с укрывающимися агентами ровно столько же, сколько без них', () => {
    const path = (f: number) => ({ cx: HOME.x + 0.5 + f * 0.09, cy: HOME.y + 0.5 + f * 0.05 });
    const frames = 400;
    const calm = run(frames, path, standing);
    const busy = run(frames, path, shuffling);
    expect(total(calm.bakes), 'проверка не пустая: движущаяся камера печёт').toBeGreaterThan(cacheFor(VP));
    expect(total(busy.bakes)).toBe(total(calm.bakes));
    // Агенты у дома уходят за край кадра, пока камера едет: разница в фигурах есть
    // только в начале пути — но она есть.
    expect(busy.images).toBeLessThan(calm.images);
  });
});
