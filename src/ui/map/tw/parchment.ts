// Край старой карты (docs/map_tw.md, раздел 4, «Края»): неразведанное — не тёмное пятно, а пергамент с
// чернильным берегом, край знания — неровный, словно обгоревший. Терра инкогнита — **без рельефа и без точек**
// (docs/gdd/path_of_sword.md, 3.5.7; ПН-00): старая карта знает очертания суши и моря, но не горы и не то, что на
// земле; места в незнакомом мир и не отдаёт (`LocalWorld.region`). Прежние значки гор сняты ПН-00. В игре нового вида он
// заменяет тёмную дымку прежнего тумана (`tw/fog.ts`, этап 2): печётся по кускам карты, в кадре — копирование.
//
// Печётся один раз на область холстом «клетка — несколько пикселей»: в кадре — копирование. Печётся шагами,
// как и земля (`bake.ts`): полосами строк — в рабочем потоке подряд, в странице без потока — по кадрам стоя.
import type { Terrain } from '@/world/types';
import { hash } from '../scatter';
import { type Canvas, ctxOf, makeCanvas } from './canvas';
import { type Steps, drain } from './bake';
import { contour, soften } from './border';
import { at, octave } from './noise';
import { TW } from './palette';

export interface ParchmentArea {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Пикселей на клетку холста пергамента: стенд — 6; игра печёт по кускам карты мельче (`tw/fog.ts`). */
export const PARCHMENT_PX = 6;
/** Пикселей на клетку листа в игре: кромка рвётся на треть клетки, берег — линией в полтора пикселя. */
export const SHEET_PX = 4;
/**
 * Запас листа за край куска, в клетках: берег и его штрихи считаются по сглаженной маске суши, и без
 * запаса у края куска контур обрывался бы — по стыкам кусков шли бы швы. Кадр рисует лист без запаса.
 */
export const SHEET_PAD = 2;

/**
 * Пергамент над областью: `known(x, y)` — разведана ли точка мира (дробные координаты), `sample` —
 * класс клетки. От класса лист знает только «суша или вода» (берег и холодный тон моря) — рельефа на нём нет:
 * старая карта знает очертания земли, но не знает, что на ней. Держит `parchment.test.ts`.
 */
export function* parchmentSteps(
  seed: number,
  area: ParchmentArea,
  sample: (x: number, y: number) => Terrain | null,
  known: (x: number, y: number) => number,
  PX = PARCHMENT_PX,
): Steps<Canvas> {
  const W = area.w * PX;
  const H = area.h * PX;
  const canvas = makeCanvas(W, H);
  const ctx = ctxOf(canvas);
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const rag = octave(seed, area.x - 1, area.y - 1, area.w + 2, area.h + 2, 1.7, 17011);
  const rag2 = octave(seed, area.x - 1, area.y - 1, area.w + 2, area.h + 2, 1.7, 17019);
  const grain = octave(seed, area.x - 1, area.y - 1, area.w + 2, area.h + 2, 0.45, 17033);
  const [pr, pg, pb] = [217, 196, 155];
  const [dr, dg, db] = [184, 159, 116];
  for (let j = 0; j < H; j++) {
    const wy = area.y + (j + 0.5) / PX;
    for (let i = 0; i < W; i++) {
      const wx = area.x + (i + 0.5) / PX;
      // Неровный край: знание сходит на нет не по кругу, а рваной кромкой.
      const k = known(wx + (at(rag, wx, wy) - 0.5) * 2.2, wy + (at(rag2, wx, wy) - 0.5) * 2.2);
      const u = 1 - k;
      const p = (j * W + i) * 4;
      if (u <= 0.001) continue;
      const g = at(grain, wx, wy) * 0.7 + hash(seed, i, j, 17051) * 0.3;
      let r = pr + (dr - pr) * g;
      let gg = pg + (dg - pg) * g;
      let b = pb + (db - pb) * g;
      // Море на старой карте — тот же лист, чуть холоднее: вода читается, но не красится.
      const t = sample(Math.floor(wx), Math.floor(wy));
      if (t === null || t === 'water') {
        r = r * 0.86 + 170 * 0.14;
        gg = gg * 0.86 + 182 * 0.14;
        b = b * 0.86 + 178 * 0.14;
      }
      // Обгоревшая кромка: тёмно-бурая полоса там, где знание переходит в незнание.
      const burn = Math.max(0, 1 - Math.abs(u - 0.5) / 0.22);
      r = r + (74 - r) * burn * 0.75;
      gg = gg + (48 - gg) * burn * 0.75;
      b = b + (26 - b) * burn * 0.75;
      d[p] = r;
      d[p + 1] = gg;
      d[p + 2] = b;
      d[p + 3] = Math.min(1, u * 1.6) * 255;
    }
    if (j % 24 === 23) yield;
  }
  ctx.putImageData(img, 0, 0);
  yield;

  // Чернила — только по пергаменту: `source-atop`.
  ctx.globalCompositeOperation = 'source-atop';
  const land = new Float32Array(area.w * area.h);
  for (let j = 0; j < area.h; j++) {
    for (let i = 0; i < area.w; i++) {
      const t = sample(area.x + i, area.y + j);
      land[j * area.w + i] = t !== null && t !== 'water' ? 1 : 0;
    }
  }
  const segs = contour(soften(land, area.w, area.h), area.w, area.h, 0, 0, 0.5);
  ctx.strokeStyle = TW.ink;
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.6;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  for (const [ax, ay, bx, by] of segs) {
    ctx.moveTo(ax * PX, ay * PX);
    ctx.lineTo(bx * PX, by * PX);
  }
  ctx.stroke();
  // Штрихи по воде вдоль берега — как гравёр отбивал море.
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1;
  for (const off of [0.35, 0.7]) {
    const ring = contour(soften(soften(land, area.w, area.h), area.w, area.h), area.w, area.h, 0, 0, 0.5 - off * 0.45);
    ctx.beginPath();
    for (const [ax, ay, bx, by] of ring) {
      ctx.moveTo(ax * PX, ay * PX);
      ctx.lineTo(bx * PX, by * PX);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}

/** Пергамент целиком, разом: стенд и проверки. */
export const bakeParchment = (
  seed: number,
  area: ParchmentArea,
  sample: (x: number, y: number) => Terrain | null,
  known: (x: number, y: number) => number,
  PX = PARCHMENT_PX,
): Canvas => drain(parchmentSteps(seed, area, sample, known, PX));
