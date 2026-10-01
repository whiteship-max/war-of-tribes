// Шум вида «город»: хеш, сеточный шум, ячейки — чистые функции от зерна, без Math.random.
// Всё тайлится: решётка берётся по модулю периода, и слой текстуры, посчитанный на [0, period),
// стыкуется сам с собой без шва. Работает и в node (тесты, выгрузка слоёв), и в потоке генерации.

/** 32-битный хеш трёх целых: решётка и зерно. */
export function hash3(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Случайное в [0, 1) от решётки и зерна. */
export const rnd = (x: number, y: number, s: number): number => hash3(x, y, s) / 4294967296;

const mod = (a: number, p: number): number => ((a % p) + p) % p;
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Сеточный шум [0, 1), период `p` клеток по обеим осям: координаты — в клетках. */
export function vnoise(x: number, y: number, p: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  const x0 = mod(xi, p);
  const y0 = mod(yi, p);
  const x1 = mod(xi + 1, p);
  const y1 = mod(yi + 1, p);
  const a = rnd(x0, y0, s);
  const b = rnd(x1, y0, s);
  const c = rnd(x0, y1, s);
  const d = rnd(x1, y1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Дробный шум [0, 1): `oct` октав, первая — `p` клеток на плитку. `u`, `v` — доли плитки [0, 1),
 * поэтому каждая октава тайлится с той же плиткой.
 */
export function fbm(u: number, v: number, p: number, oct: number, s: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let per = p;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(u * per, v * per, per, s + o * 101);
    norm += amp;
    amp *= 0.5;
    per *= 2;
  }
  return sum / norm;
}

/** Ответ ячеек: ближайшая и вторая дистанции (в клетках) и номер ближайшей ячейки. */
export interface Cell {
  f1: number;
  f2: number;
  id: number;
  /** Смещение точки ячейки от точки выборки, в клетках. */
  dx: number;
  dy: number;
}

/**
 * Ячейки Вороного с периодом `px` × `py` клеток; `jit` — разброс точки в клетке (0..1).
 * `out` переиспользуется — выборка без выделения памяти.
 */
export function cells(x: number, y: number, px: number, py: number, jit: number, s: number, out: Cell): Cell {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 1e9;
  let f2 = 1e9;
  let id = 0;
  let bdx = 0;
  let bdy = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const mx = mod(cx, px);
      const my = mod(cy, py);
      const h = hash3(mx, my, s);
      const ox = cx + 0.5 + (((h & 0xffff) / 65536) - 0.5) * jit;
      const oy = cy + 0.5 + (((h >>> 16) / 65536) - 0.5) * jit;
      const dx = ox - x;
      const dy = oy - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash3(mx, my, s + 7);
        bdx = dx;
        bdy = dy;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  out.f1 = f1;
  out.f2 = f2;
  out.id = id;
  out.dx = bdx;
  out.dy = bdy;
  return out;
}

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
export const sstep = (a: number, b: number, t: number): number => smooth(clamp01((t - a) / (b - a)));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Сеяный генератор последовательности [0, 1) — для раскладки (mulberry32). */
export function stream(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
