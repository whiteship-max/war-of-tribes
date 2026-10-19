// Бумага кадра карты нового вида (К-1, docs/telemetry.md): зерно пергамента и затемнение к краям — одним копированием.
//
// Прежде лист стоил кадру двух заливок на весь экран (`ui/map/frame.drawPaper`: узор зерна и растянутое затемнение). На телефоне
// 2D-холст рисует видеокарта, и каждый полный экран — её работа на каждом кадре движения. Оба слоя от камеры не зависят:
// узор привязан к углу экрана, затемнение растянуто на экран. Значит их наложение одно на размер окна — печётся раз на
// размер, в точках CSS, а кадр кладёт его одним `drawImage`. Наложение «поверх» сочетательно, и лист — тот же: (кадр ⊕
// зерно) ⊕ затемнение = кадр ⊕ (зерно ⊕ затемнение); зерно и раньше растягивалось на плотность экрана со сглаживанием.
import type { Viewport } from '../grid';
import { makeCanvas } from '../paint';

function ctxOf(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Карта: 2D-контекст недоступен.');
  return ctx;
}

// ---------- Зерно и затемнение (из `ui/map/paint.ts`, К-1: в первой загрузке их больше не рисует никто) ----------

/**
 * Зерно пергамента. Это карта, а не поле: у неё есть бумага, и её должно быть
 * немного видно. Пятно нарочно слабое и **двустороннее** — и светлые крупинки, и
 * тёмные: односторонний крап читался бы грязью на стекле, а не фактурой листа.
 *
 * Узор печётся один раз и живёт вечно; в лист (`paperSheet`) он ложится заливкой.
 */
const GRAIN_PX = 96;
let grainSprite: HTMLCanvasElement | null = null;

export function grainTile(): HTMLCanvasElement {
  if (grainSprite) return grainSprite;
  const c = makeCanvas(GRAIN_PX, GRAIN_PX);
  const ctx = ctxOf(c);
  const img = ctx.createImageData(GRAIN_PX, GRAIN_PX);
  const d = img.data;
  // Свой генератор, а не `Math.random`: зерно обязано быть одним и тем же от
  // запуска к запуску — иначе снимок «до» и снимок «после» разойдутся на шуме.
  let s = 0x9e3779b1;
  for (let i = 0; i < GRAIN_PX * GRAIN_PX; i++) {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x9e3779b1) >>> 0;
    const v = (s >>> 8) & 255;
    const up = v > 127;
    d[i * 4] = up ? 236 : 24;
    d[i * 4 + 1] = up ? 226 : 20;
    d[i * 4 + 2] = up ? 200 : 14;
    // Слабое и неровное: часть крупинок не видна вовсе, и узор не читается сеткой.
    d[i * 4 + 3] = (v % 7) * 3;
  }
  ctx.putImageData(img, 0, 0);
  grainSprite = c;
  return c;
}

/**
 * Затемнение к краям кадра. Оно делает из экрана **лист**: середина освещена,
 * края уходят в тень. Печётся квадратом и растягивается на экран — от этого
 * круг становится эллипсом по форме экрана, что и нужно.
 */
const VIGNETTE_PX = 256;
let vignetteSprite: HTMLCanvasElement | null = null;

export function vignette(): HTMLCanvasElement {
  if (vignetteSprite) return vignetteSprite;
  const c = makeCanvas(VIGNETTE_PX, VIGNETTE_PX);
  const ctx = ctxOf(c);
  const r = VIGNETTE_PX / 2;
  const g = ctx.createRadialGradient(r, r, r * 0.42, r, r, r * 0.96);
  g.addColorStop(0, 'rgba(14, 10, 7, 0)');
  g.addColorStop(0.62, 'rgba(14, 10, 7, 0.07)');
  g.addColorStop(1, 'rgba(14, 10, 7, 0.33)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VIGNETTE_PX, VIGNETTE_PX);
  vignetteSprite = c;
  return c;
}

// ---------- Лист на размер окна ----------

let sheet: { canvas: HTMLCanvasElement; w: number; h: number } | null = null;
/** Сколько раз лист пекся — тесту кэша. */
let bakes = 0;
export const paperBakes = (): number => bakes;

/** Лист на размер окна: тот же, пока окно того же размера. */
export function paperSheet(vp: Viewport): HTMLCanvasElement | null {
  const w = Math.max(1, Math.ceil(vp.w));
  const h = Math.max(1, Math.ceil(vp.h));
  if (sheet && sheet.w === w && sheet.h === h) return sheet.canvas;
  const canvas = sheet?.canvas ?? document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const grain = ctx.createPattern(grainTile(), 'repeat');
  if (grain) {
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(vignette(), 0, 0, w, h);
  sheet = { canvas, w, h };
  bakes++;
  return canvas;
}

/** Лист поверх тумана и под всем движущимся — одно копирование. */
export function drawTwPaper(ctx: CanvasRenderingContext2D, vp: Viewport): void {
  const c = paperSheet(vp);
  if (c) ctx.drawImage(c, 0, 0, Math.max(1, Math.ceil(vp.w)), Math.max(1, Math.ceil(vp.h)));
}

export function dropPaperSheet(): void {
  if (sheet) sheet.canvas.width = 0;
  sheet = null;
}
