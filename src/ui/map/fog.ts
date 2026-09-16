// Туман войны на полотне. Слоя два, и они выглядят по-разному нарочно.
//
// Тёмная дымка — неразведанное. Не чёрная дыра: сквозь неё угадывается рельеф,
// иначе игрок решит, что карта не догрузилась. Серая полутень — разведанное, но
// сейчас никем не просматриваемое: местность видно как есть, а живые данные под
// ней устарели, и карточка клетки скажет, насколько.
//
// Растр строится по клетке на пиксель и растягивается на экран с billinear-
// сглаживанием: край дымки получается мягким сам собой, без единого градиента.
import { exploredAt } from '@/world/cache';
import { cellInSight, sightDiscs, worldNow } from '@/world/store';
import type { SightDisc } from '@/world/fog';
import { PALETTE } from './const';
import { type Camera, type Viewport, toScreen, viewRect } from './grid';

/**
 * Насколько темно. Ноль — открыто и просматривается прямо сейчас.
 *
 * Неразведанное — не выключенный свет, а **незаполненная часть чертежа**, и
 * держится это тремя вещами разом. Цвет тёплый и не чёрный: чёрное читается
 * дыркой, тёплое — бумагой в тени. Поверх фона ложится зерно пергамента
 * (`frame.drawPaper` рисуется после тумана), и оно на неразведанном ровно то
 * же, что на разведанном, — лист один. И у самой границы знания дымка чуть
 * светлее (`EDGE`): чернила не обрываются стеной, они сходят на нет.
 */
const SHROUD = 0.3;
const UNKNOWN = 0.84;
/** Насколько светлее дымка у самой кромки знания. */
const EDGE = 0.16;

/**
 * Запас клеток вокруг экрана. Растр переживает мелкие сдвиги пальцем: пока
 * видимое лежит внутри испечённого прямоугольника, он только копируется.
 */
const MARGIN = 6;

/**
 * Как часто растр пересобирается. Обзор ползёт вместе с фигурами, а клетку они
 * проходят за секунды (`speed` в `world/data/figures.ts`) — четверти секунды хватает
 * с большим запасом, зато
 * не приходится опрашивать кэш кусков по клетке каждый кадр.
 */
const REBAKE_MS = 250;

interface Baked {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  at: number;
}

let baked: Baked | null = null;

export function dropFog(): void {
  baked = null;
}

const rgba = (hex: string, a: number): [number, number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
  Math.round(a * 255),
];

/** Пекёт растр тумана на область в клетках. */
function bake(x0: number, y0: number, w: number, h: number, discs: SightDisc[], at: number): Baked | null {
  const canvas = baked?.canvas ?? document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const data = img.data;
  const [r, g, b] = rgba(PALETTE.edge, 1);
  const shroud = Math.round(SHROUD * 255);
  const unknown = Math.round(UNKNOWN * 255);
  const edge = Math.round((UNKNOWN - EDGE) * 255);
  // Разведанность читается один раз на клетку: у кромки её спрашивают и у
  // соседей, и второе чтение того же `exploredAt` стоило бы вчетверо дороже.
  const known = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) known[y * w + x] = exploredAt(x0 + x, y0 + y) ? 1 : 0;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const i = k * 4;
      const wx = x0 + x;
      const wy = y0 + y;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      // Порядок важен. Клетка в обзоре открыта по определению — мир открыл её в
      // тот же миг, — и ждать подтверждения от куска карты нечего: куски едут с
      // задержкой, а нарисованная земля печётся из сида сразу, и на этой
      // разнице по экрану шла бы бурая волна при каждом заходе на карту.
      if (cellInSight(discs, wx, wy)) {
        data[i + 3] = 0;
        continue;
      }
      if (known[k]) {
        data[i + 3] = shroud;
        continue;
      }
      // Кромка знания: неразведанная клетка, у которой разведанный сосед. Здесь
      // дымка светлее — рисунок сходит на нет, а не упирается в стену.
      const near =
        (x > 0 && known[k - 1]) ||
        (x < w - 1 && known[k + 1]) ||
        (y > 0 && known[k - w]) ||
        (y < h - 1 && known[k + w]);
      data[i + 3] = near ? edge : unknown;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, x: x0, y: y0, w, h, at };
}

/**
 * Кладёт туман поверх земли и поселений, но под походы и подписи: таймер чужой
 * армии важнее любой дымки, а вот крыша под дымкой — это и есть смысл слоя.
 */
export function drawFog(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport): void {
  const rect = viewRect(cam, vp);
  const x0 = Math.floor(rect.x) - MARGIN;
  const y0 = Math.floor(rect.y) - MARGIN;
  const w = Math.ceil(rect.w) + MARGIN * 2 + 2;
  const h = Math.ceil(rect.h) + MARGIN * 2 + 2;
  const now = worldNow();
  const stale =
    !baked ||
    now - baked.at > REBAKE_MS ||
    x0 < baked.x ||
    y0 < baked.y ||
    x0 + w > baked.x + baked.w ||
    y0 + h > baked.y + baked.h;
  if (stale) baked = bake(x0, y0, w, h, sightDiscs(now), now) ?? baked;
  if (!baked) return;

  const [sx, sy] = toScreen(cam, vp, baked.x, baked.y);
  const [ex, ey] = toScreen(cam, vp, baked.x + baked.w, baked.y + baked.h);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(baked.canvas, Math.round(sx), Math.round(sy), Math.round(ex - sx), Math.round(ey - sy));
  ctx.restore();
}
