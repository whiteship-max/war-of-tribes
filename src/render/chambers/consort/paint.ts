// Кисть листов супруги (ЛЦ-2, docs/characters.md): рисует кодом в массив точек — без холста браузера, поэтому листы одни и
// те же в игре, на стенде и в тестах (тесты проверяют шов зеркала и палитру по самим точкам). Фигура — поле расстояний:
// точка внутри — закрашена, край — мягкий на `soft` точек. Цвет — в sRGB, доли 0…1.
//
// Случайность — сеяная (`Math.random` в игре нет нигде): узор у всех одинаковый.

export type RGB = readonly [number, number, number];
/** Поле расстояний (точки листа): < 0 — внутри. */
export type Sdf = (x: number, y: number) => number;
export type Paint = RGB | ((x: number, y: number) => RGB);
export type Mode = 'normal' | 'multiply' | 'screen';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class Img {
  readonly d: Float32Array;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.d = new Float32Array(w * h * 3);
  }

  fill(c: RGB, box: Box = { x0: 0, y0: 0, x1: this.w, y1: this.h }): void {
    for (let y = Math.max(0, box.y0 | 0); y < Math.min(this.h, Math.ceil(box.y1)); y++)
      for (let x = Math.max(0, box.x0 | 0); x < Math.min(this.w, Math.ceil(box.x1)); x++) this.set(x, y, c);
  }

  get(x: number, y: number): RGB {
    const i = (y * this.w + x) * 3;
    return [this.d[i], this.d[i + 1], this.d[i + 2]];
  }

  set(x: number, y: number, c: RGB): void {
    const i = (y * this.w + x) * 3;
    this.d[i] = c[0];
    this.d[i + 1] = c[1];
    this.d[i + 2] = c[2];
  }

  /**
   * Закрасить фигуру: поле `sdf` внутри коробки `box` (с краем), цвет `paint`, сила `alpha` (или функция места), край
   * мягкий на `soft` точек, смешение — обычное, умножение или осветление.
   */
  shape(sdf: Sdf, box: Box, paint: Paint, opt: { alpha?: number | ((x: number, y: number) => number); soft?: number; mode?: Mode; clip?: Box } = {}): void {
    const soft = Math.max(0.35, opt.soft ?? 1);
    const pad = soft + 1;
    const c = opt.clip ?? { x0: 0, y0: 0, x1: this.w, y1: this.h };
    const x0 = Math.max(c.x0, Math.floor(box.x0 - pad), 0);
    const y0 = Math.max(c.y0, Math.floor(box.y0 - pad), 0);
    const x1 = Math.min(c.x1, Math.ceil(box.x1 + pad), this.w);
    const y1 = Math.min(c.y1, Math.ceil(box.y1 + pad), this.h);
    const mode = opt.mode ?? 'normal';
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const d = sdf(px, py);
        let k = Math.max(0, Math.min(1, 0.5 - d / soft));
        if (k <= 0) continue;
        k = k * k * (3 - 2 * k);
        const a = typeof opt.alpha === 'function' ? opt.alpha(px, py) : (opt.alpha ?? 1);
        k *= a;
        if (k <= 0) continue;
        const col = typeof paint === 'function' ? paint(px, py) : paint;
        const i = (y * this.w + x) * 3;
        for (let ch = 0; ch < 3; ch++) {
          const b = this.d[i + ch];
          const s = col[ch];
          const mixed = mode === 'multiply' ? b * s : mode === 'screen' ? 1 - (1 - b) * (1 - s) : s;
          this.d[i + ch] = b + (mixed - b) * k;
        }
      }
  }

  /** Размыть прямоугольник (коробочное размытие в два прохода) — мягкая светотень. */
  blur(box: Box, r: number): void {
    const x0 = Math.max(0, box.x0 | 0);
    const y0 = Math.max(0, box.y0 | 0);
    const x1 = Math.min(this.w, Math.ceil(box.x1));
    const y1 = Math.min(this.h, Math.ceil(box.y1));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0 || r < 1) return;
    const tmp = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let ch = 0; ch < 3; ch++) {
          let s = 0;
          let n = 0;
          for (let k = -r; k <= r; k++) {
            const xx = Math.max(0, Math.min(w - 1, x + k));
            s += this.d[((y0 + y) * this.w + x0 + xx) * 3 + ch];
            n++;
          }
          tmp[(y * w + x) * 3 + ch] = s / n;
        }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let ch = 0; ch < 3; ch++) {
          let s = 0;
          let n = 0;
          for (let k = -r; k <= r; k++) {
            const yy = Math.max(0, Math.min(h - 1, y + k));
            s += tmp[(yy * w + x) * 3 + ch];
            n++;
          }
          this.d[((y0 + y) * this.w + x0 + x) * 3 + ch] = s / n;
        }
  }

  /** Точки в байты RGBA (альфа — 255). */
  rgba(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.w * this.h * 4);
    for (let i = 0, j = 0; i < this.d.length; i += 3, j += 4) {
      out[j] = Math.round(Math.max(0, Math.min(1, this.d[i])) * 255);
      out[j + 1] = Math.round(Math.max(0, Math.min(1, this.d[i + 1])) * 255);
      out[j + 2] = Math.round(Math.max(0, Math.min(1, this.d[i + 2])) * 255);
      out[j + 3] = 255;
    }
    return out;
  }
}

// ---------- Поля расстояний ----------

export const circle = (cx: number, cy: number, r: number): Sdf => (x, y) => Math.hypot(x - cx, y - cy) - r;

/** Эллипс (приближённое поле: точно на крае, верно по знаку). */
export const ellipse = (cx: number, cy: number, rx: number, ry: number, rot = 0): Sdf => {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const m = Math.min(rx, ry);
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const u = (dx * c + dy * s) / rx;
    const v = (-dx * s + dy * c) / ry;
    return (Math.hypot(u, v) - 1) * m;
  };
};

/** Многоугольник: точное поле до края, внутри — с минусом. */
export const poly = (pts: readonly (readonly [number, number])[]): Sdf => (x, y) => {
  let d = Infinity;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    d = Math.min(d, segDist(x, y, xj, yj, xi, yi));
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? -d : d;
};

/** Ломаная с шириной, меняющейся вдоль неё (`width(t)`, t — 0…1 по длине): мазок кисти, линия века, прядь. */
export const stroke = (pts: readonly (readonly [number, number])[], width: number | ((t: number) => number)): Sdf => {
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = len[len.length - 1] || 1;
  const wf = typeof width === 'number' ? () => width : width;
  return (x, y) => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      const d = Math.hypot(x - ax - dx * t, y - ay - dy * t) - wf((len[i - 1] + (len[i] - len[i - 1]) * t) / total) / 2;
      best = Math.min(best, d);
    }
    return best;
  };
};

export const boxOf = (pts: readonly (readonly [number, number])[], pad = 0): Box => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of pts) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
};

export const around = (cx: number, cy: number, rx: number, ry = rx): Box => ({ x0: cx - rx, y0: cy - ry, x1: cx + rx, y1: cy + ry });

function segDist(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
}

/** Сглаженная ломаная Катмулла — Рома через точки (по `n` точек на отрезок). */
export function spline(pts: readonly (readonly [number, number])[], n = 6): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

// ---------- Цвет ----------

export const hex = (v: number): RGB => [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
export const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
export const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

/** Холодная тень и тёплый свет (сдвиг тона, а не только яркости): k < 0 — в тень, k > 0 — к свету. */
const COOL: RGB = [0.2, 0.17, 0.3];
const WARM: RGB = [1.0, 0.94, 0.8];
export function tone(base: RGB, k: number): RGB {
  if (k < 0) {
    const s = Math.min(1, -k);
    return mix(mul(base, 1 - 0.5 * s), COOL, 0.26 * s);
  }
  return mix(base, WARM, Math.min(1, k) * 0.62);
}

/**
 * Кожа как на образце: тёплый свет к персику и тёмная тень плоскостями — бурая, к глубине чуть холоднее (не серая и не
 * розовая).
 */
const UMBER: RGB = [0.48, 0.2, 0.13];
const DUSK: RGB = [0.32, 0.15, 0.15];
const PEACH: RGB = [1.0, 0.84, 0.62];
export function flesh(base: RGB, k: number): RGB {
  if (k < 0) {
    const s = Math.min(1, -k);
    return mix(mix(mul(base, 1 - 0.34 * s), UMBER, 0.4 * s), DUSK, 0.12 * s * s);
  }
  return mix(base, PEACH, Math.min(1, k) * 0.6);
}

/** Сеяный шум значений: гладкий, 0…1. */
export function noise(seed: number): (x: number, y: number) => number {
  const hash = (i: number, j: number): number => {
    let h = (i * 374761393 + j * 668265263 + seed * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = hash(i, j);
    const b = hash(i + 1, j);
    const c = hash(i, j + 1);
    const d = hash(i + 1, j + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

/** Сеяная кость: 0…1. */
export function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

/**
 * Плоскость мазками кисти: многоугольник `pts` (точки листа) закрашивается полупрозрачной подложкой с мягким краем и
 * поверх — штрихами вдоль `angle` (рад, 0 — вправо, π/2 — вниз): штрих — короткая дуга с сужением к концам, концы
 * выходят за край неровно. Так светотень читается писаной, а не вырезанной.
 */
export function brushPlane(img: Img, pts: readonly (readonly [number, number])[], c: RGB, o: { angle: number; len: number; width: number; count: number; alpha?: number; soft?: number; seed?: number; jitter?: number }): void {
  const box = boxOf(pts, 0);
  const inside = poly(pts);
  const a = o.alpha ?? 1;
  img.shape(inside, boxOf(pts, (o.soft ?? 6) * 2), c, { soft: o.soft ?? 6, alpha: 0.5 * a });
  const r = rng(o.seed ?? 5);
  const jit = o.jitter ?? 0.1;
  for (let i = 0; i < o.count; i++) {
    let x = 0;
    let y = 0;
    let ok = false;
    for (let k = 0; k < 12 && !ok; k++) {
      x = box.x0 + r() * (box.x1 - box.x0);
      y = box.y0 + r() * (box.y1 - box.y0);
      ok = inside(x, y) < -1;
    }
    if (!ok) continue;
    const ang = o.angle + (r() - 0.5) * 0.35;
    const len = o.len * (0.6 + r() * 0.8);
    const bend = (r() - 0.5) * len * 0.2;
    const dx = Math.cos(ang) * len * 0.5;
    const dy = Math.sin(ang) * len * 0.5;
    const nx = -Math.sin(ang) * bend;
    const ny = Math.cos(ang) * bend;
    const line: [number, number][] = [
      [x - dx, y - dy],
      [x + nx, y + ny],
      [x + dx, y + dy],
    ];
    const k = 1 + (r() - 0.5) * jit * 2;
    img.shape(stroke(line, (t) => o.width * (0.35 + 0.65 * Math.sin(Math.PI * t))), boxOf(line, o.width), [c[0] * k, c[1] * k, c[2] * k], { soft: o.width * 0.45, alpha: 0.42 * a });
  }
}
