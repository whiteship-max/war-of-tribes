// Средний слой нового вида (`tw/mid.ts`): на большом экране тайлов больше, чем потолок для телефона, — кэш
// обязан держать все видимые, иначе стоящая карта печёт тайл каждый кадр, а тайлы мигают (проверка этапа 2).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { chunkKey, chunkRect, clearCache, putChunk } from '@/world/cache';
import { useWorld } from '@/world/store';
import { CHUNK, WORLD_ORIGIN } from '@/world/data/tuning';
import type { RegionChunk } from '@/world/types';
import { fakeCanvasEnv } from '../fakecanvas';
import { type Camera, detailAlpha, viewRect } from '../grid';
import { MID_CELLS, setTwLook } from './bake';
import { startFrame } from './gate';
import { MID_HI, drawMid, dropMid, midBytes } from './mid';

const START = 1_800_000_000_000;
const MID = { cx: 12, cy: 12 };

function plainChunk(cx: number, cy: number): RegionChunk {
  const rect = chunkRect(cx, cy);
  const n = rect.w * rect.h;
  return { rect, terrain: new Uint8Array(n), features: new Uint8Array(n), explored: new Uint8Array(n).fill(1), influence: new Uint8Array(n), settlements: [] };
}

let env: ReturnType<typeof fakeCanvasEnv>;
beforeAll(() => {
  env = fakeCanvasEnv();
  vi.useFakeTimers();
  vi.setSystemTime(START);
  setTwLook({ quality: 'high' });
  useWorld.setState({
    info: { seed: 20260912, size: 800, origin: WORLD_ORIGIN, home: { x: 0, y: 0 }, homeId: 'h', createdAt: START },
    ensureRegion: () => undefined,
  } as never);
  for (let cy = MID.cy - 3; cy <= MID.cy + 3; cy++) for (let cx = MID.cx - 3; cx <= MID.cx + 3; cx++) putChunk(chunkKey(cx, cy), plainChunk(cx, cy), START);
});
afterAll(() => {
  vi.useRealTimers();
  env.restore();
  clearCache();
  dropMid();
});

describe('средний слой', () => {
  it('окно ПК: все видимые тайлы держатся, стоящая карта после заполнения не печёт ничего', () => {
    const VP = { w: 1280, h: 800 };
    const scale = MID_HI;
    const cam: Camera = { cx: WORLD_ORIGIN.x + MID.cx * CHUNK + 16, cy: WORLD_ORIGIN.y + MID.cy * CHUNK + 16, scale };
    // Точка проверки внутри области правила: слой виден целиком, тайлы ближнего масштаба не видны.
    expect(detailAlpha(scale)).toBe(0);
    const rect = viewRect(cam, VP);
    const shown = (Math.floor((rect.x + rect.w - WORLD_ORIGIN.x) / MID_CELLS) - Math.floor((rect.x - WORLD_ORIGIN.x) / MID_CELLS) + 1) *
      (Math.floor((rect.y + rect.h - WORLD_ORIGIN.y) / MID_CELLS) - Math.floor((rect.y - WORLD_ORIGIN.y) / MID_CELLS) + 1);
    // Видимых тайлов больше прежнего потолка в 60: на нём и было мигание.
    expect(shown).toBeGreaterThan(60);
    const ctx = (globalThis as unknown as { document: { createElement: () => { getContext: () => CanvasRenderingContext2D } } }).document
      .createElement()
      .getContext();
    let frame = 0;
    for (let i = 0; i < shown + 10; i++) {
      startFrame(++frame, 0);
      drawMid(ctx, cam, VP, rect);
    }
    expect(midBytes(), 'слой испёкся').toBeGreaterThan(0);
    const c0 = env.created();
    for (let i = 0; i < 40; i++) {
      startFrame(++frame, 0);
      drawMid(ctx, cam, VP, rect);
    }
    expect(env.created() - c0, 'холстов стоя после заполнения').toBe(0);
  });
});
