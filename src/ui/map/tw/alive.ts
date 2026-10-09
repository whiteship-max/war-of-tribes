// Живая карта (docs/map_tw.md, раздел 15): прибой у берегов, колонны идущих отрядов, дым над осаждённым городом и
// пепелищем, огонь осадного лагеря ночью. Всё — поверх испечённого и без выпечки в кадре: берег прибоя выводится один
// раз на регион (кусками, стоя), а в кадре только штрихи и спрайты, как облака (`clouds.ts`).
//
// Уровень решает, что живое: на «Низком» прибоя нет, дым и колонна стоят (без движения), огонь не мерцает. Стоящая
// карта рисует только по изменению (docs/perf.md, решение 9): каждая кисть здесь говорит, движется ли нарисованное само,
// и тогда карта шагает им редким шагом уровня (`QUALITY.mapStepFps`), а на «Низком» живого убранства нет вовсе.
import type { Rect } from '@/world/types';
import { type Camera, type Viewport, viewRect } from '../grid';
import { makeCanvas } from '../paint';
import { CELL_PAD, cellsFor, landAt, warpFor, warpX, warpY } from './field';
import { gridLand, type LandGrid } from './landgrid';
import { FEATURE_BITS } from './landcache';
import { twQuality } from './quality';
import type { Ground } from './prebake';

// ---------- Прибой ----------

/** Узлов берега на клетку: треть клетки — ломаная берега ближе пикселя на среднем масштабе. */
export const COAST_NODES = 3;
/**
 * Уровни суши (`landAt`), по которым идут линии: пена у самого уреза и три гребня волн дальше в море. Суша в воде у
 * берега сходит от половины к нулю примерно за клетку — гребни ложатся в десятой, трети и половине клетки от уреза.
 */
export const SURF_LEVELS = [0.46, 0.36, 0.26, 0.17] as const;
/** Корзина линий — квадрат в столько клеток: в кадр идут только видимые. */
const BUCKET = 8;
/** Узлов за шаг выпечки берега: стоя, по куску за кадр. */
const ROWS_PER_SLICE = 6;
/** Период волны, секунды: гребень проходит от дальнего к пене. */
const SURF_PERIOD = 4.2;
/** Прибой виден с этого масштаба (пикселей на клетку) и в полную силу — с этого. */
const SURF_FROM = 5;
const SURF_FULL = 12;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Отрезки изолинии `level` поля `L` (узлы `nx`×`ny`, узел (i, j) — в (x0 + i·step, y0 + j·step)): квадраты решётки,
 * края — линейно, как билинейный порог выпечки берега (`bake.shoreSteps`). Четвёрки чисел: x1, y1, x2, y2.
 */
export function isoSegments(L: Float32Array, nx: number, ny: number, x0: number, y0: number, step: number, level: number, out: number[] = []): number[] {
  const lerp = (a: number, b: number): number => (level - a) / (b - a);
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i;
      const a = L[k];
      const b = L[k + 1];
      const c = L[k + nx + 1];
      const d = L[k + nx];
      const code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const x = x0 + i * step;
      const y = y0 + j * step;
      // Соседний узел — тем же счётом, что у соседа (а не `x + step`): общая точка ребра у двух квадратов одна до бита.
      const xe = x0 + (i + 1) * step;
      const ye = y0 + (j + 1) * step;
      // Точки на рёбрах: верх (a–b), право (b–c), низ (d–c), лево (a–d).
      const top = (): [number, number] => [x + lerp(a, b) * step, y];
      const right = (): [number, number] => [xe, y + lerp(b, c) * step];
      const bottom = (): [number, number] => [x + lerp(d, c) * step, ye];
      const left = (): [number, number] => [x, y + lerp(a, d) * step];
      const seg = (p: [number, number], q: [number, number]): void => {
        out.push(p[0], p[1], q[0], q[1]);
      };
      switch (code) {
        case 1:
        case 14:
          seg(left(), top());
          break;
        case 2:
        case 13:
          seg(top(), right());
          break;
        case 3:
        case 12:
          seg(left(), right());
          break;
        case 4:
        case 11:
          seg(right(), bottom());
          break;
        case 6:
        case 9:
          seg(top(), bottom());
          break;
        case 7:
        case 8:
          seg(left(), bottom());
          break;
        case 5: {
          // Седло: по середине решает, соединены ли суши.
          const mid = (a + b + c + d) / 4;
          if (mid >= level) {
            seg(left(), bottom());
            seg(top(), right());
          } else {
            seg(left(), top());
            seg(right(), bottom());
          }
          break;
        }
        case 10: {
          const mid = (a + b + c + d) / 4;
          if (mid >= level) {
            seg(left(), top());
            seg(right(), bottom());
          } else {
            seg(top(), right());
            seg(left(), bottom());
          }
          break;
        }
      }
    }
  }
  return out;
}

/** Поле суши над прямоугольником — той же мерой, что берег выпечки: `landAt` по искривлённой точке узла. */
export function* coastField(seed: number, g: LandGrid, rect: Rect): Generator<void, { L: Float32Array; nx: number; ny: number; x0: number; y0: number; step: number }> {
  const step = 1 / COAST_NODES;
  const nx = Math.round(rect.w * COAST_NODES) + 1;
  const ny = Math.round(rect.h * COAST_NODES) + 1;
  const x0 = rect.x;
  const y0 = rect.y;
  const cx0 = Math.floor(x0) - CELL_PAD;
  const cy0 = Math.floor(y0) - CELL_PAD;
  const cw = Math.ceil(rect.w) + 2 * CELL_PAD + 1;
  const ch = Math.ceil(rect.h) + 2 * CELL_PAD + 1;
  const src = gridLand(g, FEATURE_BITS);
  const cells = cellsFor(seed, src, cx0, cy0, cw, ch, 0);
  const warp = warpFor(seed, cx0, cy0, cw, ch);
  const L = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const py = y0 + j * step;
    for (let i = 0; i < nx; i++) {
      const px = x0 + i * step;
      L[j * nx + i] = landAt(cells, px + warpX(warp, px, py), py + warpY(warp, px, py));
    }
    if (j % ROWS_PER_SLICE === ROWS_PER_SLICE - 1) yield;
  }
  return { L, nx, ny, x0, y0, step };
}

interface Coast {
  seed: number;
  /** Снимок земли, по которому выведен: новый снимок — новый берег. */
  land: LandGrid;
  rect: Rect;
  job: Generator<void, { L: Float32Array; nx: number; ny: number; x0: number; y0: number; step: number }> | null;
  /** Линии по уровням (`SURF_LEVELS`), по корзинам: ключ — «bx:by». */
  paths: Map<string, Path2D>[] | null;
}

let coast: Coast | null = null;

const sameRect = (a: Rect, b: Rect): boolean => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** Сложить отрезки в пути по корзинам: в кадре штрих идёт только по видимым. */
function bucketPaths(seg: number[]): Map<string, Path2D> {
  const m = new Map<string, Path2D>();
  for (let k = 0; k < seg.length; k += 4) {
    const key = `${Math.floor(seg[k] / BUCKET)}:${Math.floor(seg[k + 1] / BUCKET)}`;
    let p = m.get(key);
    if (!p) {
      p = new Path2D();
      m.set(key, p);
    }
    p.moveTo(seg[k], seg[k + 1]);
    p.lineTo(seg[k + 2], seg[k + 3]);
  }
  return m;
}

/**
 * Берег прибоя региона: заводится на новый регион (или снимок), печётся кусками по `budgetMs` за кадр и только стоя —
 * как доля выпечки страницы (`prebakeIdle`). Готов — пути по уровням и корзинам.
 */
function coastOf(ground: Ground, still: boolean, budgetMs = 3): Map<string, Path2D>[] | null {
  const g = ground.land;
  if (!g || typeof Path2D === 'undefined') return null;
  const r = ground.plan.reach;
  const d = g.rect;
  const x = Math.max(r.x, d.x);
  const y = Math.max(r.y, d.y);
  const rect = { x, y, w: Math.max(0, Math.min(r.x + r.w, d.x + d.w) - x), h: Math.max(0, Math.min(r.y + r.h, d.y + d.h) - y) };
  if (rect.w <= 0 || rect.h <= 0) return null;
  if (!coast || coast.seed !== ground.seed || coast.land !== g || !sameRect(coast.rect, rect)) coast = { seed: ground.seed, land: g, rect, job: coastField(ground.seed, g, rect), paths: null };
  if (coast.paths || !still || !coast.job) return coast.paths;
  const until = performance.now() + budgetMs;
  for (;;) {
    const step = coast.job.next();
    if (step.done) {
      const f = step.value;
      coast.paths = SURF_LEVELS.map((lv) => bucketPaths(isoSegments(f.L, f.nx, f.ny, f.x0, f.y0, f.step, lv)));
      coast.job = null;
      return coast.paths;
    }
    if (performance.now() > until) return null;
  }
}

/** Что прибой сделал в кадре: ничего, волны (идут сами — шаг живого) или берег ещё печётся (нужен следующий кадр). */
export type Surf = 'none' | 'waves' | 'baking';

/**
 * Прибой кадра: гребни волн идут к берегу и разбиваются пеной у уреза. Над землёй, под владениями, туманом и ночью —
 * незнакомое лист закроет, ночь притушит. На «Низком» — нет (испечённая кайма прибоя остаётся).
 */
export function drawSurf(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, ground: Ground | null, still: boolean): Surf {
  if (!ground || twQuality() === 'low') return 'none';
  const paths = coastOf(ground, still);
  // Берег ещё выводится — стоящей карте нужен следующий кадр, а не сон (`still.ts`).
  if (!paths) return coast?.job ? 'baking' : 'none';
  const vis = smooth(SURF_FROM, SURF_FULL, cam.scale);
  if (vis <= 0.01) return 'none';
  const r = viewRect(cam, vp);
  const bx0 = Math.floor(r.x / BUCKET);
  const by0 = Math.floor(r.y / BUCKET);
  const bx1 = Math.floor((r.x + r.w) / BUCKET);
  const by1 = Math.floor((r.y + r.h) / BUCKET);
  const t = (performance.now() / 1000) % 1e5;
  const s = cam.scale;
  ctx.save();
  ctx.translate(vp.w / 2 - cam.cx * s, vp.h / 2 - cam.cy * s);
  ctx.scale(s, s);
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgb(236, 242, 238)';
  for (let lv = SURF_LEVELS.length - 1; lv >= 0; lv--) {
    // Гребень `lv` загорается раньше того, что ближе к берегу: волна бежит к урезу; пена вспыхивает, когда она дошла.
    const phase = t / SURF_PERIOD - (SURF_LEVELS.length - 1 - lv) * 0.17;
    const crest = Math.pow(0.5 + 0.5 * Math.sin(phase * Math.PI * 2), 3);
    const a = lv === 0 ? 0.28 + 0.42 * crest : 0.05 + 0.4 * crest * (1 - lv * 0.18);
    if (a * vis < 0.02) continue;
    // Сила — прозрачностью кисти, а не строкой цвета: строка на каждый кадр и уровень была бы мусором (и дробью в тексте).
    ctx.globalAlpha = a * vis;
    // Ширина — в пикселях экрана: пена шире гребня, вблизи — немного толще.
    ctx.lineWidth = ((lv === 0 ? 1.6 : 1.1) + Math.min(1.2, s / 60)) / s;
    const m = paths[lv];
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const p = m.get(`${bx}:${by}`);
        if (p) ctx.stroke(p);
      }
    }
  }
  ctx.restore();
  return 'waves';
}

/** Уборка: берег прибоя отпускается вместе с кадром карты. */
export function dropAlive(): void {
  coast = null;
  sprites.clear();
}

// ---------- Спрайты: клуб дыма, огонь, человечек колонны ----------

const sprites = new Map<string, HTMLCanvasElement>();

function sprite(key: string, w: number, h: number, paint: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const have = sprites.get(key);
  if (have) return have;
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  if (ctx) paint(ctx);
  sprites.set(key, c);
  return c;
}

/** Клуб дыма: мягкое серое пятно, светлее к верху. */
function puffSprite(): HTMLCanvasElement {
  return sprite('puff', 48, 48, (c) => {
    const g = c.createRadialGradient(24, 20, 2, 24, 24, 23);
    g.addColorStop(0, 'rgba(66, 62, 58, 0.92)');
    g.addColorStop(0.55, 'rgba(58, 54, 50, 0.55)');
    g.addColorStop(1, 'rgba(50, 47, 44, 0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 48, 48);
  });
}

/** Огонь ночью: тёплое пятно, ярче к середине (кладётся «светом» — поверх ночи). */
function glowSprite(): HTMLCanvasElement {
  return sprite('glow', 48, 48, (c) => {
    const g = c.createRadialGradient(24, 24, 0, 24, 24, 24);
    g.addColorStop(0, 'rgba(255, 214, 120, 0.95)');
    g.addColorStop(0.25, 'rgba(255, 150, 50, 0.6)');
    g.addColorStop(1, 'rgba(200, 70, 20, 0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 48, 48);
  });
}

/**
 * Человечек колонны: голова, тело в цвете стороны, ноги шагом (`frame` 0/1), копьё на плече. Рисуется в
 * `hPx` пикселей экрана с плотностью `dpr`.
 */
function walkerSprite(color: string, frame: number, hPx: number, dpr: number): HTMLCanvasElement {
  const h = Math.max(6, Math.round(hPx * dpr));
  const w = Math.round(h * 0.75);
  return sprite(`walker:${color}:${frame}:${h}`, w, h, (c) => {
    const u = h / 16;
    c.lineCap = 'round';
    // Тень-подложка: тёмная кайма, чтобы человечек читался и на пашне, и на снегу.
    c.strokeStyle = 'rgba(30, 22, 14, 0.75)';
    c.lineWidth = 2.6 * u;
    const legs = frame === 0 ? [[-1.6, 2.2], [1.6, -1.0]] : [[-0.6, 0.4], [0.6, -0.4]];
    const cx = w / 2;
    const draw = (): void => {
      c.beginPath();
      for (const [a, b] of legs) {
        c.moveTo(cx, 10 * u);
        c.lineTo(cx + a * u + b * u * 0.3, 15.2 * u);
      }
      c.moveTo(cx, 5 * u);
      c.lineTo(cx, 10.5 * u);
      // Копьё на плече.
      c.moveTo(cx - 2.4 * u, 12.5 * u);
      c.lineTo(cx + 3.2 * u, 0.8 * u);
      c.stroke();
    };
    draw();
    c.strokeStyle = color;
    c.lineWidth = 1.5 * u;
    draw();
    c.fillStyle = 'rgba(30, 22, 14, 0.85)';
    c.beginPath();
    c.arc(cx, 3.4 * u, 2.1 * u, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#e8cfae';
    c.beginPath();
    c.arc(cx, 3.4 * u, 1.4 * u, 0, Math.PI * 2);
    c.fill();
  });
}

/** Знамя колонны: древко и полотнище в цвете стороны. */
function bannerSprite(color: string, hPx: number, dpr: number): HTMLCanvasElement {
  const h = Math.max(10, Math.round(hPx * dpr));
  const w = Math.round(h * 0.7);
  return sprite(`banner:${color}:${h}`, w, h, (c) => {
    const u = h / 20;
    c.strokeStyle = 'rgba(40, 28, 18, 0.95)';
    c.lineWidth = 1.6 * u;
    c.beginPath();
    c.moveTo(3 * u, 1 * u);
    c.lineTo(3 * u, 19.5 * u);
    c.stroke();
    c.fillStyle = 'rgba(40, 28, 18, 0.85)';
    c.fillRect(3 * u, 1.2 * u, 10.6 * u, 8.2 * u);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(3.6 * u, 1.8 * u);
    c.lineTo(13 * u, 1.8 * u);
    c.lineTo(11 * u, 5.2 * u);
    c.lineTo(13 * u, 8.6 * u);
    c.lineTo(3.6 * u, 8.6 * u);
    c.closePath();
    c.fill();
  });
}

// ---------- Колонна идущего отряда ----------

/** Колонна видна с этого масштаба и вместо значка — с этого. */
export const COLUMN_FROM = 18;
const COLUMN_FULL = 26;
/** Человечков в колонне по размеру войска (`HostLook.size` 0..4) и потолок по уровню. */
const COLUMN_MAX = { low: 5, medium: 9, high: 12 } as const;

/** Доля колонны на масштабе: 0 — значок, 1 — колонна; между — перетекают. */
export const columnAlpha = (scale: number): number => smooth(COLUMN_FROM, COLUMN_FULL, scale);

/**
 * Колонна похода: знамя впереди, за ним — люди по дороге назад, к месту выхода (`angle` — куда идут). Вернёт, шагает ли
 * она сама (шаг живого стоящей карты, `still.ts`). Шаг — по часам
 * страницы; на «Низком» колонна стоит. Цель пальца — прежнее тело значка: колонна его не меняет.
 */
export function drawColumn(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, size: number, color: string, scale: number, dpr: number, alpha: number, seed: number): boolean {
  if (alpha <= 0.01) return false;
  const q = twQuality();
  const n = Math.min(COLUMN_MAX[q], 3 + size * 2);
  const hPx = Math.max(8, Math.min(20, scale * 0.26));
  const gap = hPx * 0.62;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // Две шеренги у войска побольше: колонна по двое.
  const files = size >= 2 ? 2 : 1;
  const t = q === 'low' ? 0 : performance.now() / 1000;
  ctx.save();
  ctx.globalAlpha = alpha;
  const draw = (img: HTMLCanvasElement, px: number, py: number): void => {
    const w = img.width / dpr;
    const h = img.height / dpr;
    ctx.drawImage(img, px - w / 2, py - h, w, h);
  };
  // Сзади вперёд: передние ложатся поверх задних.
  const rows = Math.ceil(n / files);
  for (let r = rows; r >= 1; r--) {
    for (let f = 0; f < files; f++) {
      if ((r - 1) * files + f >= n) continue;
      const side = files === 2 ? (f === 0 ? -0.36 : 0.36) * gap : 0;
      const px = x - dx * gap * r - dy * side;
      const py = y - dy * gap * r * 0.75 + dx * side * 0.75;
      // Шаг: два кадра ног и лёгкий подскок, у каждого — своя доля такта.
      const ph = t * 3.2 + ((seed + r * 3 + f) % 7) * 0.37;
      const frame = q === 'low' ? 0 : Math.floor(ph) % 2;
      const bob = q === 'low' ? 0 : Math.abs(Math.sin(ph * Math.PI)) * hPx * 0.06;
      draw(walkerSprite(color, frame, hPx, dpr), px, py - bob);
    }
  }
  draw(bannerSprite(color, hPx * 1.45, dpr), x + dx * gap * 0.2, y + dy * gap * 0.15);
  ctx.restore();
  // Шагает колонна сама — кроме «Низкого», где она стоит.
  return q !== 'low';
}

// ---------- Дым и огонь ----------

/** Дым виден с этого масштаба; клубов в столбе по уровню. */
const SMOKE_FROM = 6;
const SMOKE_FULL = 12;
const SMOKE_PUFFS = { low: 3, medium: 6, high: 8 } as const;
const SMOKE_LIFE = 5;

/**
 * Столб дыма над местом: клубы поднимаются и тают, сносимые ветром вправо; вернёт, движется ли он. `weight` — густота:
 * осада — 1, пепелище — тоньше. На «Низком» столб стоит (клубы на своих местах, без движения).
 */
export function drawSmoke(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, weight: number, seed: number): boolean {
  const vis = smooth(SMOKE_FROM, SMOKE_FULL, scale) * weight;
  if (vis <= 0.02) return false;
  const q = twQuality();
  const n = SMOKE_PUFFS[q];
  const t = q === 'low' ? 0 : performance.now() / 1000;
  const rise = Math.min(130, scale * 2);
  const base = Math.max(6, Math.min(30, scale * 0.3));
  // Столб встаёт над значком места, а не на нём: значок остаётся читаемым.
  const y0 = y - Math.min(40, scale * 0.45);
  const img = puffSprite();
  ctx.save();
  for (let i = 0; i < n; i++) {
    const u = (((t + (seed % 13)) / SMOKE_LIFE + i / n) % 1 + 1) % 1;
    const r = base * (0.6 + 1.5 * u);
    const px = x + u * u * rise * 0.45 + Math.sin(u * 5 + i + seed) * base * 0.25;
    const py = y0 - u * rise;
    ctx.globalAlpha = vis * (u < 0.12 ? u / 0.12 : 1 - (u - 0.12) / 0.88) * 0.8;
    ctx.drawImage(img, px - r, py - r, r * 2, r * 2);
  }
  ctx.restore();
  return q !== 'low';
}

/**
 * Огни осадного лагеря ночью: костры по кольцу рогаток, мерцают (на «Низком» — ровно); вернёт, мерцают ли. Кладутся
 * поверх ночи.
 */
export function drawCampFires(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, night: number, seed: number): boolean {
  const vis = smooth(0.2, 0.6, night) * smooth(4, 10, scale);
  if (vis <= 0.02) return false;
  const q = twQuality();
  const t = q === 'low' ? 0 : performance.now() / 1000;
  const ring = scale * 1.25;
  const r = Math.max(4, Math.min(18, scale * 0.16));
  const img = glowSprite();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const fires = 5;
  for (let i = 0; i < fires; i++) {
    const a = ((seed * 0.37 + i / fires) % 1) * Math.PI * 2;
    const fl = q === 'low' ? 1 : 0.75 + 0.25 * Math.sin(t * (7 + i * 1.3) + i * 2) * Math.sin(t * 3.1 + i);
    const rr = r * fl;
    ctx.globalAlpha = vis * (0.65 + 0.35 * fl);
    ctx.drawImage(img, x + Math.cos(a) * ring - rr, y + Math.sin(a) * ring * 0.6 - rr, rr * 2, rr * 2);
  }
  ctx.restore();
  return q !== 'low';
}
