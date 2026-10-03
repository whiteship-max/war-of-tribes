// Холсты выпечки нового вида — и в странице, и в рабочем потоке (docs/map_tw.md, раздел 13.4). Выпечка одна:
// в странице она печёт в `<canvas>`, в потоке — в `OffscreenCanvas`, и сама не знает, где она. Документа в
// потоке нет — по нему и решается.

export type Canvas = HTMLCanvasElement | OffscreenCanvas;
/**
 * Контекст выпечки. У `OffscreenCanvasRenderingContext2D` тот же набор вызовов, что выпечке нужен, но тип —
 * общий, `CanvasRenderingContext2D`: перегрузки `drawImage` на объединении двух контекстов TypeScript не сводит.
 */
export type Ctx = CanvasRenderingContext2D;
/** Что кадр умеет нарисовать из испечённого: холст страницы или картинка, пришедшая из потока. */
export type Picture = HTMLCanvasElement | OffscreenCanvas | ImageBitmap;

export function makeCanvas(w: number, h: number): Canvas {
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    return c;
  }
  return new OffscreenCanvas(cw, ch);
}

export function ctxOf(c: Canvas): Ctx {
  // Тот же вызов у обоих холстов; тип — страницы (см. `Ctx`).
  const ctx = (c as HTMLCanvasElement).getContext('2d');
  if (!ctx) throw new Error('Карта: 2D-контекст недоступен.');
  return ctx;
}

/** Отдать память испечённого: у холста — нулевой размер (Safari иначе держит подложку), у картинки — `close`. */
export function freePicture(p: Picture): void {
  if ('close' in p && typeof p.close === 'function') p.close();
  else (p as Canvas).width = 0;
}

/** Ширина и высота испечённого — память считается по ним: у 2D подложка ровно ш × в × 4 байта. */
export const pictureBytes = (p: Picture): number => p.width * p.height * 4;
