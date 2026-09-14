// Холст и земля для кадра карты в vitest (среда `node`, холста нет).
//
// Не тест, а его обвязка: настоящий `frame.drawFrame` гоняется на записывающей
// заглушке холста, а под ним лежат куски открытой воды — тайл печётся быстрым путём,
// и счётчик выпечек (`ground.tileBakes`) показывает, что кадр на самом деле печёт.
// Общая у двух тестов, которые мерят «новая рисовка не прибавляет выпечек земли»:
// рогатки и знаки участи (`siegemark.test.ts`) и агенты, укрывшиеся в городе
// (`shelter.test.ts`). В игру не попадает: её не импортирует ничто, кроме тестов.
import { chunkRect } from '@/world/cache';
import { TERRAIN_ORDER } from '@/world/data/terrain';
import type { RegionChunk, SettlementView } from '@/world/types';

/**
 * Холст-заглушка. Всё, что кадр зовёт, принимается и запоминается ровно настолько,
 * насколько кадр это читает: размеры, `createImageData` с настоящим буфером,
 * `measureText` с шириной. Рисования нет — считается не картинка, а выпечки.
 */
export function fakeCanvasEnv(): { created: () => number; restore: () => void } {
  let created = 0;
  const ctx = (): unknown => {
    const store: Record<string | symbol, unknown> = {};
    const special: Record<string, unknown> = {
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }),
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) }),
      measureText: (s: string) => ({ width: String(s).length * 6 }),
      createPattern: () => ({}),
      createLinearGradient: () => ({ addColorStop: () => {} }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    };
    return new Proxy(store, {
      get: (t, k) => (k in t ? t[k] : typeof k === 'string' && k in special ? special[k] : () => {}),
      set: (t, k, v) => {
        t[k] = v;
        return true;
      },
    });
  };
  const doc = {
    createElement: () => {
      created++;
      const c = ctx();
      return { width: 1, height: 1, getContext: () => c, toDataURL: () => 'data:' };
    },
  };
  const had = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = doc;
  return {
    created: () => created,
    restore: () => {
      (globalThis as { document?: unknown }).document = had;
    },
  };
}

/** Кусок карты: открытая вода (тайл печётся быстрым путём), всё разведано. */
export function waterChunk(cx: number, cy: number, settlements: SettlementView[]): RegionChunk {
  const rect = chunkRect(cx, cy);
  const n = rect.w * rect.h;
  const inside = settlements.filter((s) => s.x >= rect.x && s.y >= rect.y && s.x < rect.x + rect.w && s.y < rect.y + rect.h);
  return {
    rect,
    terrain: new Uint8Array(n).fill(TERRAIN_ORDER.indexOf('water')),
    explored: new Uint8Array(n).fill(1),
    features: new Uint8Array(n),
    influence: new Uint8Array(n),
    settlements: inside,
  };
}
