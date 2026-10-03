// Земля под выпечкой из кэша мира (docs/map_tw.md, раздел 13.4) — только в странице: стенд кладёт куски в
// кэш сам и печёт по нему (`cacheLand`), игра снимает с кэша снимок региона массивами (`extractLand`) и отдаёт
// его выпечке — в потоке и в странице одним и тем же `landgrid.gridLand`.
import type { Rect } from '@/world/types';
import { cachedChunk, chunkKeysIn, featuresAt, loadedIn, terrainAt } from '@/world/cache';
import { FEATURE } from '@/world/geography';
import { WORLD_ORIGIN, WORLD_SIZE } from '@/world/data/tuning';
import type { LandSource } from './land';
import type { FeatureBits, LandGrid } from './landgrid';

export const FEATURE_BITS: FeatureBits = {
  river: FEATURE.river,
  ridge: FEATURE.ridge,
  road: FEATURE.road,
  track: FEATURE.track,
  ford: FEATURE.ford,
  bridge: FEATURE.bridge,
};

export const WORLD_RECT: Rect = { x: WORLD_ORIGIN.x, y: WORLD_ORIGIN.y, w: WORLD_SIZE, h: WORLD_SIZE };

const has = (bits: number) => (x: number, y: number): boolean => (featuresAt(x, y) & bits) !== 0;

/** Земля прямо из кэша мира: так печёт стенд (`?showcase=map-tw`), положив куски в кэш сам. */
export const cacheLand: LandSource = {
  sample: terrainAt,
  river: has(FEATURE.river),
  ridge: has(FEATURE.ridge),
  road: has(FEATURE.road | FEATURE.track),
  ford: has(FEATURE.ford),
  bridge: has(FEATURE.bridge),
  homes(rect: Rect): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    for (const chunk of loadedIn(rect)) {
      for (const s of chunk.settlements) {
        if (s.x >= rect.x && s.y >= rect.y && s.x < rect.x + rect.w && s.y < rect.y + rect.h) out.push({ x: s.x, y: s.y });
      }
    }
    return out;
  },
  ready(rect: Rect): boolean {
    for (const { key } of chunkKeysIn(rect)) if (!cachedChunk(key)) return false;
    return true;
  },
};

/**
 * Снимок земли над прямоугольником (обрезанным по миру): класс и признаки клеток — копией массивов кусков, дворы —
 * клетками поселений. Null — какой-то кусок ещё не приехал. Клеток в снимке региона — десятки тысяч, и копия по
 * кускам, а не по клетке через `terrainAt`, — на порядок дешевле.
 */
export function extractLand(want: Rect): LandGrid | null {
  const x0 = Math.max(WORLD_RECT.x, Math.floor(want.x));
  const y0 = Math.max(WORLD_RECT.y, Math.floor(want.y));
  const x1 = Math.min(WORLD_RECT.x + WORLD_RECT.w, Math.ceil(want.x + want.w));
  const y1 = Math.min(WORLD_RECT.y + WORLD_RECT.h, Math.ceil(want.y + want.h));
  const rect: Rect = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  const terrain = new Uint8Array(rect.w * rect.h);
  const features = new Uint8Array(rect.w * rect.h);
  const homes: number[] = [];
  for (const { key } of chunkKeysIn(rect)) {
    const c = cachedChunk(key);
    if (!c) return null;
    const cr = c.rect;
    const ix0 = Math.max(cr.x, rect.x);
    const iy0 = Math.max(cr.y, rect.y);
    const ix1 = Math.min(cr.x + cr.w, rect.x + rect.w);
    const iy1 = Math.min(cr.y + cr.h, rect.y + rect.h);
    for (let y = iy0; y < iy1; y++) {
      const from = (y - cr.y) * cr.w + (ix0 - cr.x);
      const to = (y - rect.y) * rect.w + (ix0 - rect.x);
      terrain.set(c.terrain.subarray(from, from + (ix1 - ix0)), to);
      features.set(c.features.subarray(from, from + (ix1 - ix0)), to);
    }
    for (const s of c.settlements) {
      if (s.x >= rect.x && s.y >= rect.y && s.x < rect.x + rect.w && s.y < rect.y + rect.h) homes.push(s.x, s.y);
    }
  }
  return { rect, world: WORLD_RECT, terrain, features, homes: Int32Array.from(homes) };
}
