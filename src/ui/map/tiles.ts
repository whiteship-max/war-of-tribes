// Ландшафт куска карты рисуется один раз в маленькую картинку 32×32 (пиксель на клетку),
// а на экран попадает одним растянутым drawImage. Иначе на обзорном масштабе пришлось бы
// заливать по тридцать тысяч прямоугольников за кадр.
import type { CachedChunk } from '@/world/cache';
import { TERRAIN_META, TERRAIN_ORDER } from '@/world/data/terrain';

const bitmaps = new Map<string, HTMLCanvasElement>();

export function chunkBitmap(chunk: CachedChunk): HTMLCanvasElement {
  const have = bitmaps.get(chunk.key);
  // Ландшафт не меняется, поэтому перерисовывать при повторной загрузке куска незачем.
  if (have) return have;
  const c = document.createElement('canvas');
  c.width = Math.max(1, chunk.rect.w);
  c.height = Math.max(1, chunk.rect.h);
  const ctx = c.getContext('2d');
  if (ctx) {
    for (let y = 0; y < chunk.rect.h; y++) {
      for (let x = 0; x < chunk.rect.w; x++) {
        const t = TERRAIN_ORDER[chunk.terrain[y * chunk.rect.w + x]] ?? 'plain';
        ctx.fillStyle = TERRAIN_META[t].color;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  bitmaps.set(chunk.key, c);
  return c;
}

export function dropBitmaps(): void {
  bitmaps.clear();
}
