// Край старой карты вместо тумана (docs/map_tw.md, раздел 4, «Края»; этап 2). Слоя два, как у прежнего
// тумана (`fog.ts`), и сводить их к одному нельзя (docs/handbook/world.md, «Туман войны — два слоя»):
//
// - **неразведанное — пергамент**: лист с чернильным берегом и значками гор, край знания — неровный, словно
//   обгоревший. Старая карта знает землю (атлас один на всех), но не знает, что на ней: ни поселений, ни
//   владений мир в туман не кладёт, и рисовать их здесь нечем;
// - **разведанное, но не в живом обзоре — лёгкая сепия**: местность видна как есть, живые данные под ней
//   устарели (карточка клетки скажет насколько). В живом обзоре — ничего.
//
// Цена. Полутень — растр клетка-в-пиксель над экраном с запасом, как у прежнего тумана, раз в четверть
// секунды. Пергамент — по куску карты (32×32 клетки), раз за жизнь куска в кэше и не больше одного за кадр;
// печётся заново, только если сменилась разведанность куска или соседей (подпись разведанности, а не
// время приезда: куски перезапрашиваются каждые 45 с, и печь от этого заново незачем). Куска, у которого и
// сам он, и соседи разведаны целиком, нет вовсе. В кадре — копирование.
import { type CachedChunk, cachedChunk, chunkKey, chunkKeysIn, chunkRect, exploredAt, terrainAt } from '@/world/cache';
import { cellInSight, sightDiscs, useWorld, worldNow } from '@/world/store';
import type { SightDisc } from '@/world/fog';
import { type Camera, type Viewport, toScreen, viewRect } from '../grid';
import { bakeParchment } from './parchment';
import { baked, mayBake } from './gate';
import { C } from './palette';

// ---------- Полутень и глубокое незнание ----------

/** Полутень разведанного: тёплая сепия, а не серая дымка — карта старая, а не выключенный свет. */
const SHROUD: readonly [number, number, number, number] = [58, 44, 28, Math.round(0.24 * 255)];
const MARGIN = 6;
const REBAKE_MS = 250;

interface Raster {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  at: number;
}

let raster: Raster | null = null;

/**
 * Растр полутени. Неразведанная клетка, у которой все восемь соседей тоже неразведаны, — **глубокое
 * незнание**: её закрывает лист пергамента и здесь, сплошь. Это подложка под кусок пергамента, пока тот не
 * испечён (не больше одного за кадр): без неё на мгновение было бы видно землю под листом. Кромку знания
 * рисует только кусок пергамента — двух кромок, мягкой и рваной, рядом не бывает.
 */
function bakeRaster(x0: number, y0: number, w: number, h: number, discs: SightDisc[], at: number): Raster | null {
  const canvas = raster?.canvas ?? document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const known = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) known[y * w + x] = exploredAt(x0 + x, y0 + y) ? 1 : 0;
  const [pr, pg, pb] = C.parchment;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const i = k * 4;
      if (cellInSight(discs, x0 + x, y0 + y)) continue;
      if (known[k]) {
        d[i] = SHROUD[0];
        d[i + 1] = SHROUD[1];
        d[i + 2] = SHROUD[2];
        d[i + 3] = SHROUD[3];
        continue;
      }
      let deep = true;
      for (let dy = -1; dy <= 1 && deep; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (known[yy * w + xx]) {
            deep = false;
            break;
          }
        }
      }
      if (!deep) continue;
      d[i] = pr;
      d[i + 1] = pg;
      d[i + 2] = pb;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, x: x0, y: y0, w, h, at };
}

function drawRaster(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport): void {
  const rect = viewRect(cam, vp);
  const x0 = Math.floor(rect.x) - MARGIN;
  const y0 = Math.floor(rect.y) - MARGIN;
  const w = Math.ceil(rect.w) + MARGIN * 2 + 2;
  const h = Math.ceil(rect.h) + MARGIN * 2 + 2;
  const now = worldNow();
  const stale =
    !raster || now - raster.at > REBAKE_MS || x0 < raster.x || y0 < raster.y || x0 + w > raster.x + raster.w || y0 + h > raster.y + raster.h;
  if (stale) raster = bakeRaster(x0, y0, w, h, sightDiscs(now), now) ?? raster;
  if (!raster) return;
  const [sx, sy] = toScreen(cam, vp, raster.x, raster.y);
  const [ex, ey] = toScreen(cam, vp, raster.x + raster.w, raster.y + raster.h);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(raster.canvas, Math.round(sx), Math.round(sy), Math.round(ex - sx), Math.round(ey - sy));
  ctx.restore();
}

// ---------- Пергамент по кускам ----------

/** Пикселей на клетку листа в игре: кромка рвётся на треть клетки, берег — линией в полтора пикселя. */
export const SHEET_PX = 4;
/**
 * Запас листа за край куска, в клетках: берег и его штрихи считаются по сглаженной маске суши, и без
 * запаса у края куска контур обрывался бы — по стыкам кусков шли бы швы. Кадр рисует лист без запаса.
 */
export const SHEET_PAD = 2;
/** Листов в памяти: по 128 × 128 видимых пикселей (с запасом 144²) — 80 КБ, всего до 5 МБ. */
const SHEETS_MAX = 64;

/** Подпись разведанности куска: сколько открыто и чем — меняется только тогда, когда открылось новое. */
const signs = new Map<string, { at: number; sign: number; open: number }>();

function signOf(c: CachedChunk): { sign: number; open: number } {
  const have = signs.get(c.key);
  if (have && have.at === c.fetchedAt) return have;
  let h = 2166136261;
  let open = 0;
  for (let i = 0; i < c.explored.length; i++) {
    const v = c.explored[i];
    open += v;
    h = Math.imul(h ^ (v + i * 3), 16777619);
  }
  const out = { at: c.fetchedAt, sign: h >>> 0, open };
  signs.set(c.key, out);
  return out;
}

interface Sheet {
  canvas: HTMLCanvasElement | null;
  version: string;
}

const sheets = new Map<string, Sheet>();
let sheetsSeed = 0;

/**
 * Версия листа: подписи куска и восьми соседей (кромка заходит к соседу на клетку). Кусок, которого ещё
 * нет, — «нет»; лист с таким соседом всё равно печётся: край мира и ещё не приехавшие соседи — незнание.
 * Null — листа не нужно: кусок и все соседи разведаны целиком.
 */
function versionOf(cx: number, cy: number): string | null {
  const parts: string[] = [];
  let unknown = false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = cachedChunk(chunkKey(cx + dx, cy + dy));
      if (!c) {
        parts.push('-');
        unknown = true;
        continue;
      }
      const s = signOf(c);
      if (s.open < c.explored.length) unknown = true;
      parts.push(`${s.sign}`);
    }
  }
  return unknown ? parts.join('.') : null;
}

/** Разведанность в мировой точке: билинейно между серединами клеток — кромка без ступенек сетки. */
function knownAt(wx: number, wy: number): number {
  const fx = wx - 0.5;
  const fy = wy - 0.5;
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  const tx = fx - x;
  const ty = fy - y;
  const a = exploredAt(x, y) ? 1 : 0;
  const b = exploredAt(x + 1, y) ? 1 : 0;
  const c = exploredAt(x, y + 1) ? 1 : 0;
  const d = exploredAt(x + 1, y + 1) ? 1 : 0;
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** Лист куска: испечённый — сразу; устаревший или новый печётся только при `bake` и открытой очереди. */
function sheetFor(seed: number, cx: number, cy: number, now: number, bake: boolean): HTMLCanvasElement | null {
  const key = chunkKey(cx, cy);
  // Кусок ещё не приехал — земли под листом не знает и сам лист: его клетки закрыты подложкой растра.
  if (!cachedChunk(key)) return null;
  const version = versionOf(cx, cy);
  if (version === null) return null;
  const have = sheets.get(key);
  if (have && have.version === version) {
    sheets.delete(key);
    sheets.set(key, have);
    return have.canvas;
  }
  // Новый лист — общей очередью выпечки (`gate.ts`); пока не испечён, под ним лежит подложка растра
  // (глубокое незнание) или прежний лист.
  if (!bake || !mayBake(now)) return have?.canvas ?? null;
  baked(now);
  const r = chunkRect(cx, cy);
  const area = { x: r.x - SHEET_PAD, y: r.y - SHEET_PAD, w: r.w + SHEET_PAD * 2, h: r.h + SHEET_PAD * 2 };
  const canvas = bakeParchment(seed, area, terrainAt, knownAt, SHEET_PX);
  if (have?.canvas) have.canvas.width = 0;
  sheets.set(key, { canvas, version });
  while (sheets.size > SHEETS_MAX) {
    const first = sheets.keys().next().value as string;
    const gone = sheets.get(first);
    if (gone?.canvas) gone.canvas.width = 0;
    sheets.delete(first);
  }
  return canvas;
}

function seedNow(): number {
  const seed = useWorld.getState().info?.seed ?? 0;
  if (seed && seed !== sheetsSeed) {
    dropTwFog();
    sheetsSeed = seed;
  }
  return seed;
}

/**
 * Выпечка листа — в начале кадра, раньше обзора и среднего слоя: лист закрывает землю, которую игрок не
 * открыл, и в общей очереди (`gate.ts`) он первый. Печётся не больше одного.
 */
export function prepareTwFog(cam: Camera, vp: Viewport): void {
  const seed = seedNow();
  if (!seed) return;
  const now = performance.now();
  if (!mayBake(now)) return;
  for (const { cx, cy } of chunkKeysIn(viewRect(cam, vp))) {
    sheetFor(seed, cx, cy, now, true);
    if (!mayBake(now)) return;
  }
}

function drawSheets(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport): void {
  const seed = seedNow();
  if (!seed) return;
  const now = performance.now();
  const pad = SHEET_PAD * SHEET_PX;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  for (const { cx, cy } of chunkKeysIn(viewRect(cam, vp))) {
    const r = chunkRect(cx, cy);
    const sheet = sheetFor(seed, cx, cy, now, false);
    if (!sheet) continue;
    const [sx, sy] = toScreen(cam, vp, r.x, r.y);
    ctx.drawImage(sheet, pad, pad, r.w * SHEET_PX, r.h * SHEET_PX, sx, sy, r.w * cam.scale, r.h * cam.scale);
  }
  ctx.restore();
}

/** Туман нового вида: полутень разведанного и лист над неразведанным. */
export function drawTwFog(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport): void {
  drawRaster(ctx, cam, vp);
  drawSheets(ctx, cam, vp);
}

/** Сколько байт держат листы — бюджету (`docs/map_tw.md`, раздел 8). */
export function sheetBytes(): number {
  let n = 0;
  for (const s of sheets.values()) if (s.canvas) n += s.canvas.width * s.canvas.height * 4;
  return n;
}

export function dropTwFog(): void {
  for (const s of sheets.values()) if (s.canvas) s.canvas.width = 0;
  sheets.clear();
  signs.clear();
  raster = null;
}
