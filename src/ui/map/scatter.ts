// Декор нарисованной земли: где стоят ёлки и какой формы вода и холмы.
//
// Ландшафт приходит клетками (`RegionChunk.terrain`), а выглядеть должен
// непрерывным. Поэтому клетка здесь — не квадрат, который красят, а источник
// нескольких мягких дисков. Сумма дисков соседних клеток даёт одну гладкую
// кляксу поперёк сетки: озеро перетекает через несколько клеток, у холма мягкий
// край, и ни один шов не совпадает с координатной сеткой.
//
// Ни canvas, ни кэша здесь нет: ландшафт читается через переданную функцию, а
// значит всё это проверяется тестом под 'node'. Одинаковый сид обязан давать
// одинаковые числа — на этом держится обещание «один сид — одна картинка».
import type { Terrain } from '@/world/types';
import {
  FIELD_LEVEL,
  STAMPS_PER_CELL,
  STAMP_JITTER,
  STAMP_R_MAX,
  STAMP_R_MIN,
  TREES_PER_CELL,
  TREE_KINDS,
} from './const';

/** Откуда брать ландшафт клетки. null — клетка ещё не приехала или вне мира. */
export type Sample = (x: number, y: number) => Terrain | null;

/**
 * Хеш клетки в 0..1. Соль разводит независимые решения об одной и той же клетке:
 * без неё смещение штампа и вид ёлки оказались бы одним и тем же числом.
 */
export function hash(seed: number, x: number, y: number, salt: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Соли разнесены с запасом: соседние значения дали бы похожие числа. */
const SALT = {
  water: 1013,
  hills: 2029,
  count: 3049,
  tree: 4073,
} as const;

const saltOf = (kind: Terrain): number => (kind === 'water' ? SALT.water : SALT.hills);

// ---------- Поле метаболов ----------

/** Мягкий диск: центр в клетках, радиус в клетках. */
export interface Stamp {
  x: number;
  y: number;
  r: number;
}

/**
 * Штампы одной клетки. Ключ хеша — абсолютная координата клетки, поэтому два
 * соседних тайла порождают у пограничной клетки одни и те же диски и рисуют их
 * в одну и ту же точку мира. Шва на стыке не бывает по построению.
 */
export function stampsAt(seed: number, x: number, y: number, kind: Terrain): Stamp[] {
  const salt = saltOf(kind);
  const out: Stamp[] = [];
  for (let i = 0; i < STAMPS_PER_CELL; i++) {
    const ox = hash(seed, x, y, salt + i * 3) - 0.5;
    const oy = hash(seed, x, y, salt + i * 3 + 1) - 0.5;
    const t = hash(seed, x, y, salt + i * 3 + 2);
    out.push({
      x: x + 0.5 + ox * 2 * STAMP_JITTER,
      y: y + 0.5 + oy * 2 * STAMP_JITTER,
      r: STAMP_R_MIN + t * (STAMP_R_MAX - STAMP_R_MIN),
    });
  }
  return out;
}

/**
 * Насколько далеко штамп может дотянуться от своей клетки. Отсюда радиус обхода
 * соседей: за его пределами вклад строго нулевой, и считать нечего.
 */
const REACH = Math.ceil(STAMP_JITTER + STAMP_R_MAX);

/**
 * Сумма мягких дисков в точке. Больше `FIELD_LEVEL` — точка внутри кляксы.
 * Спад взят с ограниченным носителем (за радиусом ровно ноль), иначе далёкие
 * клетки давали бы фон и берег уползал бы в траву.
 */
export function fieldAt(seed: number, wx: number, wy: number, kind: Terrain, sample: Sample): number {
  const cx = Math.floor(wx);
  const cy = Math.floor(wy);
  let sum = 0;
  for (let y = cy - REACH; y <= cy + REACH; y++) {
    for (let x = cx - REACH; x <= cx + REACH; x++) {
      if (sample(x, y) !== kind) continue;
      for (const s of stampsAt(seed, x, y, kind)) {
        const dx = wx - s.x;
        const dy = wy - s.y;
        const d2 = dx * dx + dy * dy;
        const r2 = s.r * s.r;
        if (d2 >= r2) continue;
        const t = 1 - d2 / r2;
        sum += t * t;
      }
    }
  }
  return sum;
}

export const isInside = (field: number): boolean => field >= FIELD_LEVEL;

/** Все штампы вида, способные задеть область. Столько их и рисуют при выпечке. */
export function stampsFor(seed: number, rect: { x: number; y: number; w: number; h: number }, kind: Terrain, sample: Sample): Stamp[] {
  const out: Stamp[] = [];
  for (let y = Math.floor(rect.y) - REACH; y < rect.y + rect.h + REACH; y++) {
    for (let x = Math.floor(rect.x) - REACH; x < rect.x + rect.w + REACH; x++) {
      if (sample(x, y) !== kind) continue;
      for (const s of stampsAt(seed, x, y, kind)) out.push(s);
    }
  }
  return out;
}

// ---------- Лес ----------

/**
 * Доля леса в точке, 0..1. Считается по 3×3 с весами, а не по одной клетке:
 * иначе плотность деревьев менялась бы ступенькой ровно по границе клетки, и
 * лес читался бы клетчатым — ровно то, чего быть не должно.
 */
export function forestAt(x: number, y: number, sample: Sample): number {
  let sum = 0;
  let total = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const w = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
      total += w;
      if (sample(x + dx, y + dy) === 'forest') sum += w;
    }
  }
  return sum / total;
}

/** Расчищенное под поселение пятно: центр клетки и радиус в клетках. */
export interface Clearing {
  x: number;
  y: number;
  r: number;
}

const inClearing = (px: number, py: number, clearings: Clearing[]): boolean =>
  clearings.some((c) => {
    const dx = px - (c.x + 0.5);
    const dy = py - (c.y + 0.5);
    return dx * dx + dy * dy < c.r * c.r;
  });

export interface Tree {
  /** Мировые координаты с дробной частью: ёлки не выстраиваются по сетке. */
  x: number;
  y: number;
  /** Номер модели в атласе. */
  kind: number;
  /** Множитель размера: одинаковые ёлки читаются как узор, а не как лес. */
  size: number;
}

/**
 * Ёлки одной клетки. Число берётся из сглаженной доли леса, а дробная часть
 * разыгрывается хешем: без этого плотность росла бы ступенями и граница леса
 * снова стала бы видна клетками.
 */
export function treesInCell(seed: number, x: number, y: number, sample: Sample, clearings: Clearing[]): Tree[] {
  const density = forestAt(x, y, sample);
  if (density <= 0) return [];
  const n = Math.floor(density * TREES_PER_CELL + hash(seed, x, y, SALT.count));
  const out: Tree[] = [];
  for (let i = 0; i < n; i++) {
    const salt = SALT.tree + i * 11;
    const px = x + hash(seed, x, y, salt);
    const py = y + hash(seed, x, y, salt + 1);
    // Ёлка в воде — грубая ошибка: клякса накрывает часть соседней клетки,
    // а лес в ней остаётся лесом. Отбраковка идёт по тому же полю, что и берег.
    if (isInside(fieldAt(seed, px, py, 'water', sample))) continue;
    if (inClearing(px, py, clearings)) continue;
    out.push({
      x: px,
      y: py,
      kind: Math.floor(hash(seed, x, y, salt + 2) * TREE_KINDS) % TREE_KINDS,
      size: 0.85 + hash(seed, x, y, salt + 3) * 0.3,
    });
  }
  return out;
}

/** Ёлки во всей области. Порядок обхода фиксирован — от него зависит и порядок отрисовки. */
export function treesIn(
  seed: number,
  rect: { x: number; y: number; w: number; h: number },
  sample: Sample,
  clearings: Clearing[] = [],
): Tree[] {
  const out: Tree[] = [];
  for (let y = Math.floor(rect.y); y < rect.y + rect.h; y++) {
    for (let x = Math.floor(rect.x); x < rect.x + rect.w; x++) {
      for (const t of treesInCell(seed, x, y, sample, clearings)) out.push(t);
    }
  }
  // Дальние рисуются раньше ближних, иначе кроны наложатся не в том порядке.
  out.sort((a, b) => a.y - b.y);
  return out;
}
