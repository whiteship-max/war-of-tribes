// Ландшафт куска карты рисуется один раз в маленькую картинку 32×32 (пиксель на клетку),
// а на экран попадает одним растянутым drawImage. Иначе на обзорном масштабе пришлось бы
// заливать по тридцать тысяч прямоугольников за кадр.
import type { CachedChunk } from '@/world/cache';
import { FEATURE } from '@/world/geography';
import { TERRAIN_META, TERRAIN_ORDER } from '@/world/data/terrain';
import { PALETTE } from './const';

const bitmaps = new Map<string, HTMLCanvasElement>();

/**
 * Цвет клетки на дальнем масштабе. Признаки местности перебивают ландшафт: на
 * пиксель клетку издали видно только одним цветом, и важнее показать, что здесь
 * река или тракт, чем то, что под ними равнина. Порядок тот же, что у
 * проходимости в `geography.cellCost`, — картинка и расчёт пути не должны
 * рассказывать о клетке разное.
 */
function colorOf(bits: number, terrain: number): string {
  if (bits & FEATURE.track) return PALETTE.road;
  if (bits & FEATURE.bridge) return PALETTE.bridge;
  if (bits & FEATURE.ford) return PALETTE.ford;
  if (bits & FEATURE.river) return PALETTE.river;
  if (bits & FEATURE.pass) return PALETTE.pass;
  if (bits & FEATURE.ridge) return PALETTE.ridge;
  return TERRAIN_META[TERRAIN_ORDER[terrain] ?? 'plain'].color;
}

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
        const i = y * chunk.rect.w + x;
        ctx.fillStyle = colorOf(chunk.features[i] ?? 0, chunk.terrain[i]);
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
