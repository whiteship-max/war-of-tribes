// Край старой карты вместо тумана (`tw/fog.ts`): лист печётся по куску раз за жизнь и заново — только когда
// сменилась разведанность, а не время приезда куска; стоящая карта не печёт ничего.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chunkKey, chunkRect, clearCache, putChunk } from '@/world/cache';
import { useWorld } from '@/world/store';
import { CHUNK, WORLD_ORIGIN } from '@/world/data/tuning';
import type { RegionChunk } from '@/world/types';
import { fakeCanvasEnv } from '../fakecanvas';
import type { Camera } from '../grid';
import { drawTwFog, dropTwFog, prepareTwFog, sheetBytes } from './fog';

const START = 1_800_000_000_000;
const MID = { cx: 12, cy: 12 };
const VP = { w: 390, h: 844 };

/** Кусок суши; разведано всё левее `openTo` (мировой x), правее — незнание. */
function landChunk(cx: number, cy: number, openTo: number): RegionChunk {
  const rect = chunkRect(cx, cy);
  const n = rect.w * rect.h;
  const explored = new Uint8Array(n);
  for (let j = 0; j < rect.h; j++) for (let i = 0; i < rect.w; i++) explored[j * rect.w + i] = rect.x + i < openTo ? 1 : 0;
  return { rect, terrain: new Uint8Array(n), features: new Uint8Array(n), explored, influence: new Uint8Array(n), settlements: [] };
}

function lay(openTo: number, at: number): void {
  for (let cy = MID.cy - 2; cy <= MID.cy + 2; cy++) {
    for (let cx = MID.cx - 2; cx <= MID.cx + 2; cx++) putChunk(chunkKey(cx, cy), landChunk(cx, cy, openTo), at);
  }
}

let env: ReturnType<typeof fakeCanvasEnv>;
let clock = 0;
beforeAll(() => {
  env = fakeCanvasEnv();
  vi.useFakeTimers();
  vi.setSystemTime(START);
  // Не больше листа за кадр — по часам кадра: каждый кадр здесь на 20 мс позже прежнего.
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  useWorld.setState({ info: { seed: 20260912, size: 800, origin: WORLD_ORIGIN, home: { x: 0, y: 0 }, homeId: 'h', createdAt: START }, figures: [] } as never);
});
afterAll(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  env.restore();
  clearCache();
});

let screen: CanvasRenderingContext2D | null = null;
const ctx = (): CanvasRenderingContext2D =>
  (screen ??= (globalThis as unknown as { document: { createElement: () => { getContext: () => CanvasRenderingContext2D } } }).document
    .createElement()
    .getContext());

/** Кадры тумана на неподвижной камере; вернёт, сколько холстов заведено. Холст экрана — один, до счёта. */
function frames(cam: Camera, n: number): number {
  const c = ctx();
  const c0 = env.created();
  for (let f = 0; f < n; f++) {
    clock += 20;
    prepareTwFog(cam, VP);
    drawTwFog(c, cam, VP);
  }
  return env.created() - c0;
}

describe('лист старой карты', () => {
  // Камера над стыком кусков: кромка знания идёт посреди среднего куска.
  const edgeX = WORLD_ORIGIN.x + MID.cx * CHUNK + 16;
  const cam: Camera = { cx: edgeX, cy: WORLD_ORIGIN.y + MID.cy * CHUNK + 16, scale: 12 };

  it('печётся по куску один раз; стоящая карта не печёт ничего', () => {
    clearCache();
    dropTwFog();
    lay(edgeX, START);
    const warm = frames(cam, 40);
    expect(warm, 'листы и растр пеклись').toBeGreaterThan(0);
    expect(sheetBytes()).toBeGreaterThan(0);
    expect(frames(cam, 120), "холстов стоя после прогрева").toBe(0);
  });

  it('кусок приехал заново с той же разведанностью — листы те же', () => {
    lay(edgeX, START + 60_000);
    expect(frames(cam, 60)).toBe(0);
  });

  it('открылось новое — листы у кромки печётся заново', () => {
    const bytes = sheetBytes();
    lay(edgeX + 6, START + 120_000);
    expect(frames(cam, 60)).toBeGreaterThan(0);
    expect(sheetBytes()).toBeGreaterThanOrEqual(bytes * 0.5);
  });

  it('разведано всё вокруг — листа нет вовсе', () => {
    clearCache();
    dropTwFog();
    lay(WORLD_ORIGIN.x + 10_000, START);
    frames(cam, 40);
    expect(sheetBytes()).toBe(0);
  });
});
