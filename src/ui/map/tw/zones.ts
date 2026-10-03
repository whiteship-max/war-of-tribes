// Владения на карте нового вида (docs/map_tw.md, раздел 4, «Границы держав»; этап 2): цвет державы ложится
// на землю тоньше прежнего, а по краю владения идёт **черта границы** — пунктир цвета державы с тёмной
// подводкой, как на карте кампании.
//
// Данные — те же, что у прежнего слоя (`zones.ts`): влияние клетки из куска карты (`cache.influenceAt`), и
// только для разведанных клеток — в туман мир цвет не кладёт, и рисовать там нечего. Своей правды о том, чья
// земля, у вида нет: границу он не выдумывает, а обводит то, что дал мир. Сегодня влияние у мира пусто
// (племён на карте нет, живые замки владений не имеют — docs/handbook/world.md), и слой честно пуст: ни
// заливки, ни черты, и цены почти никакой — проход по клеткам раз в секунду.
//
// Цена. Заливка — растр клетка-в-пиксель, черта — изолиния (`border.contour`) по сглаженному полю каждой
// державы, испечённая в холст экрана с запасом; печётся раз в секунду, при уходе вида за запас и при смене
// масштаба больше чем на пятую часть (иначе растянутая черта мылится). В кадре — два копирования.
import { influenceAt } from '@/world/cache';
import { TRIBE_COLORS } from '@/world/data/meta';
import type { Rect } from '@/world/types';
import { type Camera, type Viewport, toScreen, viewRect } from '../grid';
import { type Segment, contour, soften } from './border';
import { drawCells } from './layers';

const TINT = 0.2;
const MARGIN = 6;
const REBAKE_MS = 1000;
/**
 * Холст черты не больше этого по стороне: на дальнем масштабе экран с запасом — сотни клеток. 1024² — 4 МБ
 * в худшем случае; черта в 2.2 px от этого чуть мягче вблизи, и это дешевле памяти телефона.
 */
const LINES_MAX_PX = 1024;

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const colors = TRIBE_COLORS.map(rgb);

export const ownerColor = (owner: number): string => TRIBE_COLORS[(owner - 1) % TRIBE_COLORS.length];

/**
 * Черта границы каждой державы в области: изолиния половины по сглаженному полю «клетка её». Сглаживание —
 * чтобы черта шла плавно, а не лесенкой клеток; изолиния замкнута (тест `tw/field.test.ts`).
 */
export function borderLines(rect: Rect, owner: (x: number, y: number) => number): Map<number, Segment[]> {
  const { x, y, w, h } = rect;
  const cells = new Int32Array(w * h);
  const owners = new Set<number>();
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const o = owner(x + i, y + j);
      cells[j * w + i] = o;
      if (o) owners.add(o);
    }
  }
  const out = new Map<number, Segment[]>();
  for (const o of owners) {
    const f = new Float32Array(w * h);
    for (let k = 0; k < w * h; k++) f[k] = cells[k] === o ? 1 : 0;
    out.set(o, contour(soften(f, w, h), w, h, x, y, 0.5));
  }
  return out;
}

interface Baked {
  tint: HTMLCanvasElement;
  lines: HTMLCanvasElement | null;
  /** Область в клетках и пикселей холста черты на клетку. */
  x: number;
  y: number;
  w: number;
  h: number;
  px: number;
  at: number;
  scale: number;
  /** Подпись данных, под которую испечён (карта по регионам); 0 — по времени, как прежде. */
  stamp: number;
}

let baked: Baked | null = null;

function bake(x0: number, y0: number, w: number, h: number, scale: number, at: number, stamp = 0): Baked | null {
  const tint = baked?.tint ?? document.createElement('canvas');
  tint.width = w;
  tint.height = h;
  const ctx = tint.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const alpha = Math.round(TINT * 255);
  let any = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const owner = influenceAt(x0 + x, y0 + y);
      if (owner === 0) continue;
      any = true;
      const [r, g, b] = colors[(owner - 1) % colors.length];
      const i = (y * w + x) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (baked?.lines) baked.lines.width = 0;
  if (!any) return { tint, lines: null, x: x0, y: y0, w, h, px: 1, at, scale, stamp };
  const px = Math.max(1, Math.min(scale, LINES_MAX_PX / Math.max(w, h)));
  const lines = document.createElement('canvas');
  lines.width = Math.ceil(w * px);
  lines.height = Math.ceil(h * px);
  const lc = lines.getContext('2d');
  if (lc) {
    lc.lineCap = 'round';
    lc.lineJoin = 'round';
    for (const [owner, segs] of borderLines({ x: x0, y: y0, w, h }, influenceAt)) {
      lc.beginPath();
      for (const [ax, ay, bx, by] of segs) {
        lc.moveTo((ax - x0) * px, (ay - y0) * px);
        lc.lineTo((bx - x0) * px, (by - y0) * px);
      }
      // Подводка — тёмная и шире, по ней пунктир цвета державы: читается и на снегу, и на лугу.
      lc.setLineDash([]);
      lc.strokeStyle = 'rgba(34, 22, 12, 0.5)';
      lc.lineWidth = 4;
      lc.stroke();
      lc.setLineDash([9, 4]);
      lc.strokeStyle = ownerColor(owner);
      lc.lineWidth = 2.2;
      lc.stroke();
    }
  }
  return { tint, lines, x: x0, y: y0, w, h, px, at, scale, stamp };
}

/**
 * Рамка региона (docs/map_tw.md, раздел 13.4): растр — над ней целиком, и движение камеры его не старит. Печётся
 * заново, только когда сменились данные (`stamp` — когда приезжали куски под рамкой) или масштаб у черты, и только
 * если можно печь (`may` — камера стоит); первый — сразу.
 */
export interface ZonesArea {
  rect: Rect;
  stamp: number;
  may: boolean;
}

export function drawTwZones(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, now: number, area?: ZonesArea): void {
  let x0: number;
  let y0: number;
  let w: number;
  let h: number;
  let stale: boolean;
  if (area) {
    x0 = Math.floor(area.rect.x);
    y0 = Math.floor(area.rect.y);
    w = Math.ceil(area.rect.w);
    h = Math.ceil(area.rect.h);
    const same = baked !== null && baked.x === x0 && baked.y === y0 && baked.w === w && baked.h === h;
    stale =
      !same ||
      baked!.stamp !== area.stamp ||
      (baked!.lines !== null && Math.abs(cam.scale / baked!.scale - 1) > 0.2);
    if (stale && (!same || area.may)) baked = bake(x0, y0, w, h, cam.scale, now, area.stamp) ?? baked;
  } else {
    const rect = viewRect(cam, vp);
    x0 = Math.floor(rect.x) - MARGIN;
    y0 = Math.floor(rect.y) - MARGIN;
    w = Math.ceil(rect.w) + MARGIN * 2 + 2;
    h = Math.ceil(rect.h) + MARGIN * 2 + 2;
    stale =
      !baked ||
      now - baked.at > REBAKE_MS ||
      x0 < baked.x ||
      y0 < baked.y ||
      x0 + w > baked.x + baked.w ||
      y0 + h > baked.y + baked.h ||
      // Масштаб важен только черте (холст в пикселях экрана); заливка — клетка в пиксель, и щипок её не старит.
      (baked.lines !== null && Math.abs(cam.scale / baked.scale - 1) > 0.2);
    if (stale) baked = bake(x0, y0, w, h, cam.scale, now) ?? baked;
  }
  if (!baked) return;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  if (area) {
    // Растр над рамкой региона — только видимая часть (`layers.drawCells`).
    const r = { x: baked.x, y: baked.y, w: baked.w, h: baked.h };
    drawCells(ctx, cam, vp, baked.tint, r);
    if (baked.lines) drawCells(ctx, cam, vp, baked.lines, r, baked.px);
  } else {
    const [sx, sy] = toScreen(cam, vp, baked.x, baked.y);
    const [ex, ey] = toScreen(cam, vp, baked.x + baked.w, baked.y + baked.h);
    ctx.drawImage(baked.tint, Math.round(sx), Math.round(sy), Math.round(ex - sx), Math.round(ey - sy));
    if (baked.lines) ctx.drawImage(baked.lines, sx, sy, ex - sx, ey - sy);
  }
  ctx.restore();
}

export function dropTwZones(): void {
  if (baked?.lines) baked.lines.width = 0;
  baked = null;
}
