// Рельеф: высота земли и свет по ней.
//
// Это самое сильное, что можно сделать с картой, и держится оно на одной мысли:
// **земля обязана иметь высоту**. Пока она плоская заливка, ни ёлки, ни берег,
// ни значки её не спасут — глаз читает такую картинку как схему, а не как
// местность.
//
// Высоты в данных нет: атлас везёт класс клетки и два бита, река и хребет
// (`world/atlas/atlas.ts`). Поэтому высота здесь **выводится** из того, что
// есть, и это честная подделка, а не восстановленный рельеф: холмы высоко,
// хребет выше всех, вода ниже нуля, равнина у нуля. Ни на один расчёт игры эта
// величина не влияет и влиять не должна — проходимость считает `cellCost` по
// своим правилам, а здесь рисуют.
//
// Свет один на всю карту и падает слева-сверху — тот же, что в диораме посёлка,
// у ёлок на этой же карте и у теней фигур (`village.shadow`). Второго света на
// карте быть не может: две тени в разные стороны читаются не объёмом, а браком.
//
// Ни canvas, ни кэша здесь нет: землю модуль читает через переданные функции, а
// значит всё проверяется тестом под 'node'. Одинаковый вход обязан давать
// одинаковый выход — на этом держится и обещание «шва между тайлами нет», и
// само право печь тайл один раз.
import type { Terrain } from '@/world/types';
import {
  RELIEF_GAIN,
  RELIEF_LIGHT,
  RELIEF_PER_CELL,
  RELIEF_ROCK,
  RELIEF_ROUGH,
  RELIEF_SHADE,
  ROCK_FROM,
  ROCK_FULL,
} from './const';
import { hash, smooth } from './scatter';
import type { Flag, Sample } from './scatter';

/**
 * Высота класса клетки, в условных «клетках высоты». Числа подобраны так, чтобы
 * перепад равнина → хребет был заметен светом, а не превращал холмы в стену.
 *
 * Вода ниже нуля нарочно: без этого берег выходил бы обрывом с одной стороны и
 * ничем с другой. Дно нам никто не покажет — поверх ляжет сама вода, — но
 * склон, ныряющий в море, на границе виден и читается берегом.
 */
export const CELL_HEIGHT: Record<Terrain, number> = {
  water: -0.34,
  plain: 0.07,
  forest: 0.09,
  steppe: 0.05,
  desert: 0.1,
  hills: 0.62,
};

/** Насколько поднимает хребет. Хребет всегда лежит на холмах — отсюда и сумма. */
export const RIDGE_LIFT = 0.5;

/** Высота клетки целиком. Клетки нет (за краем мира) — считаем морем. */
export const cellHeight = (t: Terrain | null, ridge: boolean): number =>
  (t === null ? CELL_HEIGHT.water : CELL_HEIGHT[t]) + (ridge ? RIDGE_LIFT : 0);

/**
 * Шероховатость: насколько сильно на этой высоте играет мелкая рябь. Горы
 * изрезаны, равнина почти гладкая, вода гладкая совсем — рябь на дне выдала бы
 * себя сквозь отмель.
 *
 * «Почти» здесь важнее «гладкой»: равнина без ряби выходит пластиком, и это
 * ровно та плоскость, от которой уходит весь этот модуль. Поэтому у неё
 * `PLAIN_ROUGH` от горной — дальний холм виден, а рельефа не изображает.
 */
const PLAIN_ROUGH = 0.14;
const roughAt = (h: number): number =>
  h <= 0 ? 0 : (PLAIN_ROUGH + (1 - PLAIN_ROUGH) * Math.min(1, h / CELL_HEIGHT.hills)) * RELIEF_ROUGH;

/**
 * Решётчатый шум на том же `hash`, что и весь декор земли: ключ — абсолютный
 * узел, поэтому два соседних тайла считают в общей точке одно и то же число.
 * Шва не бывает по построению — ровно как у клякс.
 *
 * Узлы октавы считаются **заранее и по её собственному шагу**, а не на каждой
 * пробе. Это не оптимизация впрок, а разница в разы: у крупной октавы шаг больше
 * двух клеток, и на неё приходится сотня проб решётки высот — считать под каждую
 * четыре хеша значило бы посчитать одно и то же число сто раз. На выпечке тайла
 * это мерено: шестнадцать тысяч узлов против восьми сотен хешей.
 */
interface Octave {
  period: number;
  weight: number;
  i0: number;
  j0: number;
  w: number;
  h: number;
  g: Float32Array;
}

function octaveGrid(
  seed: number,
  rect: { x: number; y: number; w: number; h: number },
  period: number,
  weight: number,
  salt: number,
): Octave {
  const i0 = Math.floor(rect.x / period) - 1;
  const j0 = Math.floor(rect.y / period) - 1;
  const w = Math.ceil(rect.w / period) + 3;
  const h = Math.ceil(rect.h / period) + 3;
  const g = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) g[j * w + i] = hash(seed, i0 + i, j0 + j, salt);
  }
  return { period, weight, i0, j0, w, h, g };
}

function octaveAt(o: Octave, wx: number, wy: number): number {
  const fx = wx / o.period - o.i0;
  const fy = wy / o.period - o.j0;
  const ix = Math.min(o.w - 2, Math.max(0, Math.floor(fx)));
  const iy = Math.min(o.h - 2, Math.max(0, Math.floor(fy)));
  const tx = smooth(fx - ix);
  const ty = smooth(fy - iy);
  const k = iy * o.w + ix;
  const a = o.g[k];
  const b = o.g[k + 1];
  const c = o.g[k + o.w];
  const d = o.g[k + o.w + 1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/**
 * Гребневый шум: `1 - |2n - 1|`. Обычный решётчатый шум даёт круглые бугры, и
 * свет по ним читается пятнистостью, а не горами — на первой же пробе вышел
 * камуфляж. Складка получается там, где шум переходит середину, и сумма
 * нескольких октав таких складок даёт то, чего и надо: **хребты с отрогами**, а
 * не поле кочек.
 */
const ridged = (n: number): number => 1 - Math.abs(2 * n - 1);

/**
 * Октавы ряби: период в клетках и вес. Периоды разнесены не вдвое, а грубее —
 * иначе складки трёх октав ложатся друг на друга в правильную решётку, и горы
 * снова читаются узором. Соли разнесены с запасом: соседние дали бы похожие
 * числа.
 */
const OCTAVES: [number, number, number][] = [
  [2.3, 1, 8101],
  [0.95, 0.42, 9127],
  [0.41, 0.17, 10151],
];
/** Сумма весов: рябь нормируется, чтобы её силу задавало одно число. */
const OCTAVE_SUM = OCTAVES.reduce((a, o) => a + o[1], 0);

/**
 * Решётка высот на область. Считается один раз на выпечку тайла: сначала высоты
 * клеток в маленький массив, потом сглаживание между ними — иначе на каждый узел
 * пришлось бы по четыре обращения к миру, а узлов тысячи.
 */
export interface Lattice {
  /** Узлов по стороне. */
  n: number;
  /** Мировые координаты левого верхнего узла. */
  x0: number;
  y0: number;
  /** Шаг решётки в клетках. */
  step: number;
  h: Float32Array;
}

/**
 * Высоты по решётке над областью в клетках. Область берётся с запасом в клетку
 * с каждой стороны: свет считается разностью соседних узлов, и без запаса по
 * кромке тайла шла бы полоса без света.
 */
export function lattice(
  seed: number,
  rect: { x: number; y: number; w: number; h: number },
  sample: Sample,
  ridge: Flag,
): Lattice {
  const step = 1 / RELIEF_PER_CELL;
  const x0 = rect.x;
  const y0 = rect.y;
  const n = Math.round(rect.w * RELIEF_PER_CELL) + 1;

  // Высоты клеток с запасом: сглаживание смотрит на клетку вперёд и назад.
  const c0x = Math.floor(x0) - 1;
  const c0y = Math.floor(y0) - 1;
  const cw = Math.ceil(rect.w) + 3;
  const ch = Math.ceil(rect.h) + 3;
  const cells = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      cells[j * cw + i] = cellHeight(sample(c0x + i, c0y + j), ridge(c0x + i, c0y + j));
    }
  }
  const cellAt = (i: number, j: number): number =>
    cells[Math.min(ch - 1, Math.max(0, j)) * cw + Math.min(cw - 1, Math.max(0, i))];

  const octaves = OCTAVES.map(([period, weight, salt]) => octaveGrid(seed, rect, period, weight, salt));
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const wy = y0 + j * step;
    // Середина клетки — её высота; между серединами идёт плавный переход.
    const fy = wy - 0.5 - c0y;
    const jy = Math.floor(fy);
    const ty = smooth(fy - jy);
    for (let i = 0; i < n; i++) {
      const wx = x0 + i * step;
      const fx = wx - 0.5 - c0x;
      const ix = Math.floor(fx);
      const tx = smooth(fx - ix);
      const a = cellAt(ix, jy);
      const b = cellAt(ix + 1, jy);
      const c = cellAt(ix, jy + 1);
      const d = cellAt(ix + 1, jy + 1);
      const base = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
      const r = roughAt(base);
      // Рябь только там, где ей есть на чём играть: множитель считается от самой
      // высоты, поэтому равнина остаётся почти равниной, а горы получают складки.
      let wobble = 0;
      if (r > 0) {
        let sum = 0;
        for (const o of octaves) sum += o.weight * ridged(octaveAt(o, wx, wy));
        wobble = r * (sum / OCTAVE_SUM - 0.5);
      }
      out[j * n + i] = base + wobble;
    }
  }
  return { n, x0, y0, step, h: out };
}

/** Разбор цвета «#rrggbb» один раз при запуске: в узлах решётки его не парсят. */
const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * Краска рельефа по решётке: RGBA по узлу, готовая лечь на землю одним
 * `putImageData` и одним растянутым `drawImage`.
 *
 * В одном слое сходятся две вещи, и обе про высоту:
 *
 *   свет      склон, обращённый к свету, теплеет; отвёрнутый — стынет и темнеет.
 *             Считается разностью соседних узлов, то есть настоящим уклоном, а
 *             не «покрасим холмы посветлее»;
 *   порода    выше `ROCK_FROM` земля перестаёт быть лугом и становится камнем.
 *             Без этого хребет читается зелёным валом.
 *
 * Складываются они обычным «поверх» в один цвет с одной прозрачностью: слоёв на
 * тайле и так много, а платить лишним `drawImage` за то, что укладывается в одну
 * арифметику, незачем.
 */
export function shadePixels(lat: Lattice, out: Uint8ClampedArray, m: number, size: number): void {
  const [lr, lg, lb] = rgb(RELIEF_LIGHT.color);
  const [sr, sg, sb] = rgb(RELIEF_SHADE.color);
  const [kr, kg, kb] = rgb(RELIEF_ROCK.color);
  const { n, h, step } = lat;
  // Уклон нормируется шагом решётки: иначе мельче решётка — слабее свет.
  const scale = RELIEF_GAIN / (2 * step);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = (j + m) * n + (i + m);
      const here = h[k];
      // Слева-сверху: склон, растущий вправо и вниз, обращён к свету.
      const slope = (h[k + 1] - h[k - 1] + h[k + n] - h[k - n]) * scale;

      // Порода. Идёт первой: свет ложится уже на камень, а не наоборот.
      let a = RELIEF_ROCK.alpha * Math.min(1, Math.max(0, (here - ROCK_FROM) / (ROCK_FULL - ROCK_FROM)));
      let r = kr * a;
      let g = kg * a;
      let b = kb * a;

      const lit = slope > 0;
      const t = Math.min(1, Math.abs(slope));
      const la = lit ? RELIEF_LIGHT.alpha * t : RELIEF_SHADE.alpha * t;
      if (la > 0) {
        const cr = lit ? lr : sr;
        const cg = lit ? lg : sg;
        const cb = lit ? lb : sb;
        r = cr * la + r * (1 - la);
        g = cg * la + g * (1 - la);
        b = cb * la + b * (1 - la);
        a = la + a * (1 - la);
      }

      const p = (j * size + i) * 4;
      if (a <= 0.002) {
        out[p + 3] = 0;
        continue;
      }
      // Обратно из премножённой: canvas ждёт обычную RGBA.
      out[p] = r / a;
      out[p + 1] = g / a;
      out[p + 2] = b / a;
      out[p + 3] = a * 255;
    }
  }
}
