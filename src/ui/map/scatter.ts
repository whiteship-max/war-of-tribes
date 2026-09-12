// Декор нарисованной земли: где стоят деревья и какой формы вода и холмы.
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
  CONIFER_HILLS,
  CONIFER_NORTH,
  CONIFER_SOUTH,
  FIELD_LEVEL,
  GLADE_BELOW,
  GROVE_PERIOD,
  GROVE_SWING,
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
  steppe: 5087,
  desert: 6089,
  grove: 7103,
} as const;

/**
 * Своя соль на каждый вид кляксы. Без неё степь и пустыня получили бы те же
 * смещения, что холмы, и на стыке пятна легли бы одно в одно — граница между
 * ними стала бы прямой, то есть ровно тем, чего кляксы и избегают.
 */
const saltOf = (kind: Terrain): number =>
  kind === 'water' ? SALT.water : kind === 'steppe' ? SALT.steppe : kind === 'desert' ? SALT.desert : SALT.hills;

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

/**
 * Плавная ступень. Общая на весь декор земли — ею сглаживают и купу леса, и
 * высоту рельефа: без неё билинейная выборка даёт видимые грани по узлам, и
 * обеим она нужна по одной и той же причине. Второй копии быть не должно.
 */
export const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Все штампы вида, способные задеть область. Столько их и рисуют при выпечке.
 *
 * `pick` отбирает клетки внутри вида, не меняя ни формы штампов, ни их
 * координат: так из одной и той же воды получаются отмель и глубина, и край у
 * них — одна и та же линия, а не две похожие.
 */
export function stampsFor(
  seed: number,
  rect: { x: number; y: number; w: number; h: number },
  kind: Terrain,
  sample: Sample,
  pick?: Flag,
): Stamp[] {
  const out: Stamp[] = [];
  for (let y = Math.floor(rect.y) - REACH; y < rect.y + rect.h + REACH; y++) {
    for (let x = Math.floor(rect.x) - REACH; x < rect.x + rect.w + REACH; x++) {
      if (sample(x, y) !== kind) continue;
      if (pick && !pick(x, y)) continue;
      for (const s of stampsAt(seed, x, y, kind)) out.push(s);
    }
  }
  return out;
}

/**
 * Доля воды вокруг клетки в радиусе `r`. Отсюда берётся глубина: «далеко ли до
 * земли» — единственный вопрос, на который карта может ответить честно, высот
 * дна в данных нет и взяться им неоткуда.
 *
 * Считается по кругу, а не по квадрату: квадратное окно дало бы на ровном берегу
 * ступеньку в углу, и глубина пошла бы уголками.
 */
export function waterShare(x: number, y: number, sample: Sample, r: number): number {
  let sum = 0;
  let total = 0;
  const r2 = r * r;
  // Через клетку, а не подряд. Спрашивают это на каждой клетке воды в тайле, и
  // сплошной обход круга в восемь клеток стоил бы двадцати тысяч чтений мира на
  // выпечку — при том что ответ («далеко ли до земли») от пропущенной клетки не
  // меняется: берег шириной в одну клетку посреди моря карту не рисует.
  for (let dy = -r; dy <= r; dy += 2) {
    for (let dx = -r; dx <= r; dx += 2) {
      if (dx * dx + dy * dy > r2) continue;
      total++;
      const t = sample(x + dx, y + dy);
      // За краем сетки — открытое море: мир кончается берегом, а не пустотой,
      // и глубина у кромки карты обязана быть глубиной.
      if (t === null || t === 'water') sum++;
    }
  }
  return total === 0 ? 0 : sum / total;
}

// ---------- Линии местности: реки, хребты, тракты ----------

/** Есть ли в клетке признак. Тот же приём, что и `Sample`: холста здесь нет. */
export type Flag = (x: number, y: number) => boolean;

/**
 * Штампы вдоль линии клеток. Диск в середине каждой клетки линию не замыкает:
 * у клеток по диагонали центры разнесены на 1.41, и между ними остаётся дыра —
 * река на картинке рвалась бы ровно там, где на расчёте пути она сплошная.
 * Поэтому к дискам клеток добавляются диски в серединах между соседями.
 */
export function lineStamps(
  rect: { x: number; y: number; w: number; h: number },
  on: Flag,
  r: number,
): Stamp[] {
  const out: Stamp[] = [];
  const pad = Math.ceil(r) + 1;
  for (let y = Math.floor(rect.y) - pad; y < rect.y + rect.h + pad; y++) {
    for (let x = Math.floor(rect.x) - pad; x < rect.x + rect.w + pad; x++) {
      if (!on(x, y)) continue;
      out.push({ x: x + 0.5, y: y + 0.5, r });
      // Только четыре направления из восьми: обратные даёт сосед сам, и каждая
      // перемычка иначе рисовалась бы дважды.
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
      ]) {
        if (!on(x + dx, y + dy)) continue;
        out.push({ x: x + 0.5 + dx / 2, y: y + 0.5 + dy / 2, r });
      }
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
  /** Мировые координаты с дробной частью: деревья не выстраиваются по сетке. */
  x: number;
  y: number;
  /** Номер модели в атласе своей породы. */
  kind: number;
  /** Хвойное ли. Порода решается местом, а не деревом: юг не хвойный. */
  conifer: boolean;
  /** Множитель размера: одинаковые деревья читаются как узор, а не как лес. */
  size: number;
}

function groveNoise(seed: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const tx = smooth(x - ix);
  const ty = smooth(y - iy);
  const a = hash(seed, ix, iy, SALT.grove);
  const b = hash(seed, ix + 1, iy, SALT.grove);
  const c = hash(seed, ix, iy + 1, SALT.grove);
  const d = hash(seed, ix + 1, iy + 1, SALT.grove);
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/**
 * Насколько густо стоит лес в этой точке, 0..1. Это и есть разница между лесом и
 * посадкой: доля леса из данных говорит «здесь лес», а купа говорит, где он
 * гуще, где реже и где прогалина. Период крупнее клетки нарочно — купа обязана
 * переходить через границу клетки, иначе рисунок снова разложится по сетке.
 */
export const groveAt = (seed: number, x: number, y: number): number =>
  groveNoise(seed, x / GROVE_PERIOD, y / GROVE_PERIOD);

/**
 * Хвойное ли дерево в этой точке. Порода — свойство места: север хвойный, юг
 * лиственный, между ними пояс, в котором она разыгрывается хешем; в горах хвоя
 * растёт и на юге. Прямой порог по широте читался бы границей государства, а не
 * сменой леса, — отсюда и пояс, и розыгрыш внутри него.
 */
export function coniferAt(x: number, y: number, sample: Sample, roll: number): boolean {
  const south = Math.min(1, Math.max(0, (y - CONIFER_NORTH) / (CONIFER_SOUTH - CONIFER_NORTH)));
  const hills = sample(x, y) === 'hills' ? CONIFER_HILLS : 0;
  // Сравнение нестрогое: на самом севере `south` равен нулю, и строгое «больше»
  // оставило бы там лиственным ровно нулевой розыгрыш. Полшага на краю шкалы
  // ничего не решают, а дыра в правиле — решает.
  return roll >= south - hills;
}

/**
 * Деревья одной клетки. Число берётся из сглаженной доли леса, умноженной на
 * купу, а дробная часть разыгрывается хешем: без этого плотность росла бы
 * ступенями и граница леса снова стала бы видна клетками.
 */
export function treesInCell(
  seed: number,
  x: number,
  y: number,
  sample: Sample,
  clearings: Clearing[],
  blocked?: Flag,
): Tree[] {
  const density = forestAt(x, y, sample);
  if (density <= 0) return [];
  const out: Tree[] = [];
  for (let i = 0; i < TREES_PER_CELL; i++) {
    const salt = SALT.tree + i * 11;
    const px = x + hash(seed, x, y, salt);
    const py = y + hash(seed, x, y, salt + 1);
    // Купа решается в точке самого дерева, а не в середине клетки: иначе гуща
    // обрывалась бы по клеткам — ровно то, от чего лес и уводят.
    const grove = groveAt(seed, px, py);
    if (grove < GLADE_BELOW) continue;
    const thick = density * (1 - GROVE_SWING / 2 + GROVE_SWING * grove);
    if (i >= thick * TREES_PER_CELL + hash(seed, x, y, SALT.count)) continue;
    // Дерево в воде — грубая ошибка: клякса накрывает часть соседней клетки,
    // а лес в ней остаётся лесом. Отбраковка идёт по тому же полю, что и берег.
    if (isInside(fieldAt(seed, px, py, 'water', sample))) continue;
    if (inClearing(px, py, clearings)) continue;
    // Дерево посреди тракта или в русле — такая же грубая ошибка, как в озере.
    if (blocked?.(Math.floor(px), Math.floor(py))) continue;
    out.push({
      x: px,
      y: py,
      kind: Math.floor(hash(seed, x, y, salt + 2) * TREE_KINDS) % TREE_KINDS,
      conifer: coniferAt(x, y, sample, hash(seed, x, y, salt + 4)),
      // На опушке дерево крупнее, в гуще мельче: так купа читается массой, а не
      // россыпью одинаковых значков.
      size: (0.62 + hash(seed, x, y, salt + 3) * 0.42) * (1.14 - grove * 0.28),
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
  blocked?: Flag,
): Tree[] {
  const out: Tree[] = [];
  for (let y = Math.floor(rect.y); y < rect.y + rect.h; y++) {
    for (let x = Math.floor(rect.x); x < rect.x + rect.w; x++) {
      for (const t of treesInCell(seed, x, y, sample, clearings, blocked)) out.push(t);
    }
  }
  // Дальние рисуются раньше ближних, иначе кроны наложатся не в том порядке.
  out.sort((a, b) => a.y - b.y);
  return out;
}
