// Снимок земли региона массивами (docs/map_tw.md, раздел 13.4): класс и признаки клеток над прямоугольником,
// клетки дворов. Его собирает страница из кэша мира (`landcache.extractLand`) один раз на регион и отдаёт
// рабочему потоку — поток мира не знает и в кэш не ходит. Модуль чистый: едет в поток.
import type { Rect, Terrain } from '@/world/types';
import { TERRAIN_ORDER } from '@/world/data/terrain';
import type { LandSource } from './land';

/** Биты признаков клетки (`world/geography.FEATURE`): страница передаёт их потоку, чтобы тот не тянул мир. */
export interface FeatureBits {
  river: number;
  ridge: number;
  road: number;
  track: number;
  ford: number;
  bridge: number;
}

export interface LandGrid {
  /** Прямоугольник снимка в клетках мира. */
  rect: Rect;
  /** Мир целиком: за ним — открытое море, и данных там не ждут. */
  world: Rect;
  /** Индексы `TERRAIN_ORDER`, построчно по `rect`. */
  terrain: Uint8Array;
  /** Биты признаков, построчно по `rect`. */
  features: Uint8Array;
  /** Клетки дворов парами x, y. */
  homes: Int32Array;
}

export function gridLand(g: LandGrid, bits: FeatureBits): LandSource {
  const { rect, world } = g;
  const index = (x: number, y: number): number => {
    const i = x - rect.x;
    const j = y - rect.y;
    return i < 0 || j < 0 || i >= rect.w || j >= rect.h ? -1 : j * rect.w + i;
  };
  const has = (bit: number) => (x: number, y: number): boolean => {
    const k = index(x, y);
    return k >= 0 && (g.features[k] & bit) !== 0;
  };
  const roads = bits.road | bits.track;
  return {
    sample(x: number, y: number): Terrain | null {
      const k = index(x, y);
      return k < 0 ? null : (TERRAIN_ORDER[g.terrain[k]] ?? null);
    },
    river: has(bits.river),
    ridge: has(bits.ridge),
    road: has(roads),
    ford: has(bits.ford),
    bridge: has(bits.bridge),
    homes(r: Rect): { x: number; y: number }[] {
      const out: { x: number; y: number }[] = [];
      for (let k = 0; k + 1 < g.homes.length; k += 2) {
        const x = g.homes[k];
        const y = g.homes[k + 1];
        if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) out.push({ x, y });
      }
      return out;
    },
    ready(r: Rect): boolean {
      const x0 = Math.max(world.x, r.x);
      const y0 = Math.max(world.y, r.y);
      const x1 = Math.min(world.x + world.w, r.x + r.w);
      const y1 = Math.min(world.y + world.h, r.y + r.h);
      if (x1 <= x0 || y1 <= y0) return true;
      return x0 >= rect.x && y0 >= rect.y && x1 <= rect.x + rect.w && y1 <= rect.y + rect.h;
    },
  };
}
