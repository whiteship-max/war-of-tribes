// География мира: из чего складывается местность и во что она обходится отряду.
//
// Земля здесь больше не шум. Мир один на всех — Европа, Магриб, Анатолия, — и
// ландшафт, русла и хребты приходят из атласа (`atlas/`), запечённого из данных
// Natural Earth. Всё остальное осталось как было: река — преграда, а не дорогая
// клетка; перейти её можно у моста или брода, и эти места редки; в горах есть
// хребет, и через него ведут перевалы.
//
// Сид в подписях остался, но **не значит здесь ничего**, и это не небрежность,
// а требование. Мир один на всех: если бы сид игрока решал, какая клетка русла
// станет мостом, у двоих на одной реке мосты стояли бы в разных местах — то есть
// карта была бы общей только на картинке. Поэтому выбор перехода солится своим
// постоянным числом (`GEO_SALT`), а сид остаётся в подписях, чтобы не переписывать
// полтора десятка мест вызова ради аргумента, который вернётся вместе с сервером.
// Держит это тест «земля одна на все сиды».
//
// Зависимость здесь односторонняя: `geo.ts` (расстояния и время пути) и `gen.ts`
// (поселения) читают этот модуль, а он не знает про них ничего.
import type { Coord, Terrain } from './types';
import { TERRAIN_ORDER, terrainCost } from './data/terrain';
import { ATLAS_RIDGE, ATLAS_RIVER, atlasCell, atlasTerrain } from './atlas/atlas';
import {
  CROSSING_BLOCK,
  CROSSING_RADIUS,
  PASS_BLOCK,
  PASS_RADIUS,
  ROAD_CORRIDOR,
  ROAD_MAX_LENGTH,
  ROAD_WOBBLE,
  WORLD_ORIGIN,
  WORLD_SIZE,
  COST_BRIDGE,
  COST_FORD,
  COST_PASS,
  COST_RIDGE,
  COST_RIVER,
  COST_ROAD,
} from './data/tuning';

/** Клетка внутри сетки мира. */
const inWorld = (x: number, y: number): boolean =>
  x >= WORLD_ORIGIN.x && y >= WORLD_ORIGIN.y && x < WORLD_ORIGIN.x + WORLD_SIZE && y < WORLD_ORIGIN.y + WORLD_SIZE;

// ---------- Шум ----------

/** Хеш клетки в 0..1. Детерминирован по сиду. */
export function hash2(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Ландшафт клетки — чтение атласа, а не расчёт. Сид в подписи остался нарочно:
 * его передают из полутора десятков мест, и вычеркнуть его отсюда значило бы
 * переписать половину мира ради одного аргумента, который однажды снова
 * понадобится.
 */
export function terrainAt(_seed: number, x: number, y: number): Terrain {
  return TERRAIN_ORDER[atlasTerrain(x - WORLD_ORIGIN.x, y - WORLD_ORIGIN.y)] ?? 'water';
}

// ---------- Линии: реки и хребты ----------

/**
 * Русло. Настоящее: Дунай, Рейн, Рона, Луара, Висла, Днепр, Дон, По, Эбро, Тахо,
 * Темза, Евфрат — шесть с половиной сотен отрезков из Natural Earth. Мелкие
 * притоки в преграды не идут (`scalerank` в скрипте запекания): река, которую
 * переходят где угодно, картой не делит ничего, а прямая, случайно легшая вдоль
 * ручья, стоила бы как поход через горы.
 */
function isRiver(_seed: number, x: number, y: number): boolean {
  return (atlasCell(x - WORLD_ORIGIN.x, y - WORLD_ORIGIN.y) & ATLAS_RIVER) !== 0;
}

/**
 * Хребет — сердцевина горного пятна, линия в одну клетку. Полигон Альп в атласе
 * шириной в сорок клеток; будь хребтом весь он, перевал «один на блок» не открыл
 * бы прохода, и через горы не было бы дороги вовсе. Утоньшение делает скрипт
 * запекания, здесь — только чтение.
 */
function isRidge(_seed: number, x: number, y: number): boolean {
  return (atlasCell(x - WORLD_ORIGIN.x, y - WORLD_ORIGIN.y) & ATLAS_RIDGE) !== 0;
}

// ---------- Переходы: мосты, броды, перевалы ----------

/**
 * Переход выбирается один на блок клеток, а не разыгрывается в каждой: иначе
 * броды сыпались бы кучками и река перестала бы делить карту. Внутри блока
 * берётся та клетка линии, у которой хеш меньше всех, — правило детерминированное
 * и не зависит от того, с какой стороны к блоку подошли.
 */
interface Node {
  at: Coord;
  /** Мост или брод; у хребта — всегда перевал. */
  bridge: boolean;
}

/**
 * Постоянная соль мира. Ею солится всё, что выбирает одно из многого на общей
 * карте: какая клетка русла станет переправой и мостом это будет или бродом.
 * Сид игрока сюда попасть не может — у двоих переправы разъехались бы.
 */
const GEO_SALT = 0x7e0d;

function pickNode(
  seed: number,
  bx: number,
  by: number,
  block: number,
  on: (seed: number, x: number, y: number) => boolean,
  salt: number,
): Node | null {
  let best: Coord | null = null;
  let bestH = Infinity;
  for (let y = by; y < by + block; y++) {
    for (let x = bx; x < bx + block; x++) {
      if (!on(seed, x, y)) continue;
      const h = hash2(GEO_SALT + salt, x, y);
      if (h < bestH) {
        bestH = h;
        best = { x, y };
      }
    }
  }
  if (!best) return null;
  // Мост или брод решает тот же хеш: у брода ноги мокрые, у моста нет.
  return { at: best, bridge: hash2(GEO_SALT + salt + 31, best.x, best.y) < 0.5 };
}

const floorTo = (v: number, block: number): number => Math.floor(v / block) * block;

interface Caches {
  crossings: Map<string, Node | null>;
  passes: Map<string, Node | null>;
  natural: Map<number, number>;
  cost: Map<number, number>;
  roads: RoadNet | null;
  masses: Landmasses | null;
}

const emptyCaches = (): Caches => ({
  crossings: new Map(),
  passes: new Map(),
  natural: new Map(),
  cost: new Map(),
  roads: null,
  masses: null,
});

let caches: Caches = emptyCaches();

/** Считать заново. Нужен тестам и пересозданию мира; в игре зовётся однажды. */
export function dropGeography(): void {
  caches = emptyCaches();
}

/**
 * Кэш один на всю игру и по сиду больше не разводится: география у всех одна.
 * Прежде смена сида выбрасывала его целиком — теперь выбрасывать нечего, и
 * ключ остаётся в подписи только ради вызывающих.
 */
function cachesFor(_seed: number): Caches {
  return caches;
}

function nodeOf(seed: number, x: number, y: number, block: number, kind: 'crossing' | 'pass'): Node | null {
  const bx = floorTo(x, block);
  const by = floorTo(y, block);
  const c = cachesFor(seed);
  const store = kind === 'crossing' ? c.crossings : c.passes;
  const key = `${bx}|${by}`;
  const have = store.get(key);
  if (have !== undefined) return have;
  const node =
    kind === 'crossing'
      ? pickNode(seed, bx, by, block, isRiver, 0x77a1)
      : pickNode(seed, bx, by, block, isRidge, 0x1b93);
  store.set(key, node);
  return node;
}

/** Переход в клетке: он же накрывает соседние — река шириной в клетку не всегда. */
function nodeAt(seed: number, x: number, y: number, block: number, radius: number, kind: 'crossing' | 'pass'): Node | null {
  for (let by = -1; by <= 1; by++) {
    for (let bx = -1; bx <= 1; bx++) {
      const node = nodeOf(seed, x + bx * block, y + by * block, block, kind);
      if (!node) continue;
      if (Math.hypot(node.at.x - x, node.at.y - y) <= radius) return node;
    }
  }
  return null;
}

// ---------- Признаки клетки ----------

/**
 * Что есть в клетке, битами. Ими же кусок карты едет в интерфейс.
 *
 * `road` и `track` — не одно и то же. Тракт занимает полосу в три клетки: отряды
 * в игре ходят по прямой, а не по нашей колее, и узкая дорога давала бы выигрыш
 * только там, где сама оказалась прямой. Колея — середина этой полосы, и рисуется
 * на карте именно она: полоса в три клетки на ближнем масштабе была бы шириной в
 * пол-экрана. Обочина при этом видна тоже — светлой расчищенной каймой.
 */
export const FEATURE = {
  river: 1,
  bridge: 2,
  ford: 4,
  ridge: 8,
  pass: 16,
  road: 32,
  track: 64,
} as const;

/**
 * Ключ клетки для кэшей. Годится только внутри мира: за его краем разность
 * уходит в минус, и два разных места получили бы один ключ. Поэтому снаружи
 * кэш не трогают вовсе (`memoKey`), а не «как-нибудь» считают.
 */
const cellKey = (x: number, y: number): number => (x - WORLD_ORIGIN.x) * 4096 + (y - WORLD_ORIGIN.y);

const memoKey = (x: number, y: number): number => (inWorld(x, y) ? cellKey(x, y) : -1);

/**
 * Природные признаки — всё, кроме дорог. Отдельно от `featuresAt` они нужны по
 * одной причине: дороги прокладываются по этой самой проходимости, и если бы
 * они входили в неё, прокладка звала бы сама себя.
 */
function naturalAt(seed: number, x: number, y: number): number {
  const c = cachesFor(seed);
  const key = memoKey(x, y);
  const have = key < 0 ? undefined : c.natural.get(key);
  if (have !== undefined) return have;
  let bits = 0;
  if (isRiver(seed, x, y)) {
    bits |= FEATURE.river;
    const node = nodeAt(seed, x, y, CROSSING_BLOCK, CROSSING_RADIUS, 'crossing');
    if (node) bits |= node.bridge ? FEATURE.bridge : FEATURE.ford;
  } else if (isRidge(seed, x, y)) {
    bits |= FEATURE.ridge;
    if (nodeAt(seed, x, y, PASS_BLOCK, PASS_RADIUS, 'pass')) bits |= FEATURE.pass;
  }
  if (key >= 0) c.natural.set(key, bits);
  return bits;
}

/**
 * Признаки клетки целиком. Дорога, дошедшая до реки, ставит мост: тракт между
 * станами не может обрываться на берегу.
 */
export function featuresAt(seed: number, x: number, y: number): number {
  const bits = naturalAt(seed, x, y);
  const net = roadNet(seed);
  const key = cellKey(x, y);
  if (!net.cells.has(key)) return bits;
  const withRoad = bits | FEATURE.road | (net.track.has(key) ? FEATURE.track : 0);
  return bits & FEATURE.river ? (withRoad & ~FEATURE.ford) | FEATURE.bridge : withRoad;
}

// ---------- Проходимость ----------

/**
 * Во сколько раз клетка медленнее равнины. Порядок проверок — это и есть правила
 * местности словами: по дороге быстрее всего, мост снимает реку, брод её
 * смягчает, река без перехода — преграда, перевал снимает хребет.
 */
export function cellCost(seed: number, x: number, y: number): number {
  const c = cachesFor(seed);
  const key = memoKey(x, y);
  const have = key < 0 ? undefined : c.cost.get(key);
  if (have !== undefined) return have;
  const cost = costFrom(featuresAt(seed, x, y), terrainAt(seed, x, y));
  if (key >= 0) c.cost.set(key, cost);
  return cost;
}

function costFrom(bits: number, t: Terrain): number {
  if (bits & FEATURE.road) return COST_ROAD;
  if (bits & FEATURE.bridge) return COST_BRIDGE;
  if (bits & FEATURE.ford) return COST_FORD;
  if (bits & FEATURE.river) return COST_RIVER;
  if (bits & FEATURE.pass) return COST_PASS;
  if (bits & FEATURE.ridge) return COST_RIDGE;
  return terrainCost(t);
}

/** Проходимость без дорог — по ней дороги и прокладываются. */
const rawCost = (seed: number, x: number, y: number): number => costFrom(naturalAt(seed, x, y), terrainAt(seed, x, y));

// ---------- Станы племён ----------

/**
 * Где вообще можно поставить двор: не в воде, не в русле и не на хребте. Правило
 * одно на станы и на поселения — иначе тракт упирался бы в город, стоящий в реке.
 */
export function buildable(seed: number, x: number, y: number): boolean {
  if (terrainAt(seed, x, y) === 'water') return false;
  return (naturalAt(seed, x, y) & (FEATURE.river | FEATURE.ridge)) === 0;
}

/**
 * Станы племён. Их больше нет — и это не упущение, а следствие: мир стал общим,
 * поселений ботов на нём не будет, а тракты соединяли именно станы. Шесть
 * случайных точек на настоящей карте Европы соединять нечем и незачем: дорога
 * из ниоткуда в никуда — ложь, которую видно с первого взгляда.
 *
 * Дороги вернутся вместе с настоящими городами — и тогда это будут настоящие
 * дороги. Прокладка (`road`, `roadNet`) оставлена на месте целиком: работать ей
 * есть по чему, не хватает только концов.
 */
export function tribeCenters(_seed: number): Coord[] {
  return [];
}

// ---------- Дороги ----------

export interface RoadNet {
  /** Вся полоса тракта, ключом `cellKey`: по ней и считается проходимость. */
  cells: Set<number>;
  /** Середина полосы — та самая колея, которую рисует карта. */
  track: Set<number>;
  /** Пары станов, которые тракт соединил, — для проверок и отладки. */
  edges: [Coord, Coord][];
}

/**
 * Тракт между двумя станами. Не прямая: дорога идёт по самой дешёвой полосе
 * внутри коридора вокруг прямой, поэтому сама находит броды, перевалы и обходит
 * озёра. Отсюда и берутся узлы на карте — их никто не расставлял руками.
 */
function road(seed: number, a: Coord, b: Coord): number[] {
  const half = ROAD_CORRIDOR;
  const x0 = Math.max(WORLD_ORIGIN.x, Math.min(a.x, b.x) - half);
  const y0 = Math.max(WORLD_ORIGIN.y, Math.min(a.y, b.y) - half);
  const x1 = Math.min(WORLD_ORIGIN.x + WORLD_SIZE - 1, Math.max(a.x, b.x) + half);
  const y1 = Math.min(WORLD_ORIGIN.y + WORLD_SIZE - 1, Math.max(a.y, b.y) + half);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w <= 0 || h <= 0) return [];

  const idx = (x: number, y: number): number => (y - y0) * w + (x - x0);
  const dist = new Float64Array(w * h).fill(Infinity);
  const prev = new Int32Array(w * h).fill(-1);
  const done = new Uint8Array(w * h);
  const start = idx(a.x, a.y);
  const goal = idx(b.x, b.y);
  dist[start] = 0;

  // Куча на массиве: узлов тут тысячи, а не миллионы, и городить структуру ради
  // одной прокладки при генерации мира незачем.
  const heap: [number, number][] = [[0, start]];
  const push = (d: number, i: number): void => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop() as [number, number];
    if (heap.length > 0) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };

  while (heap.length > 0) {
    const [d, i] = pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === goal) break;
    const cx = x0 + (i % w);
    const cy = y0 + Math.floor(i / w);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < x0 || ny < y0 || nx > x1 || ny > y1) continue;
        const j = idx(nx, ny);
        if (done[j]) continue;
        // Разброс — только для выбора колеи: на настоящую проходимость клетки
        // он не влияет, иначе одна и та же равнина стоила бы разного.
        const wobble = 1 + (hash2(seed + 0x3a17, nx, ny) - 0.5) * ROAD_WOBBLE;
        const step = Math.hypot(dx, dy) * rawCost(seed, nx, ny) * wobble;
        const nd = d + step;
        if (nd >= dist[j]) continue;
        dist[j] = nd;
        prev[j] = i;
        push(nd, j);
      }
    }
  }

  if (!done[goal]) return [];
  const path: number[] = [];
  for (let i = goal; i !== -1; i = prev[i]) {
    path.push(cellKey(x0 + (i % w), y0 + Math.floor(i / w)));
    if (i === start) break;
  }
  return path;
}

/** Дороги мира: каждый стан соединён с ближайшими соседями, но не со всеми подряд. */
function buildRoads(seed: number): RoadNet {
  const centers = tribeCenters(seed);
  const cells = new Set<number>();
  const track = new Set<number>();
  const edges: [Coord, Coord][] = [];
  // Остов по ближайшему соседу (алгоритм Прима): дороги связывают карту целиком,
  // но не превращают её в паутину из всех пар.
  const joined = new Set<number>();
  if (centers.length > 0) joined.add(0);
  while (joined.size < centers.length) {
    let bestA = -1;
    let bestB = -1;
    let best = Infinity;
    for (const i of joined) {
      for (let j = 0; j < centers.length; j++) {
        if (joined.has(j)) continue;
        const d = Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y);
        if (d < best) {
          best = d;
          bestA = i;
          bestB = j;
        }
      }
    }
    if (bestB < 0) break;
    joined.add(bestB);
    if (best <= ROAD_MAX_LENGTH) {
      edges.push([centers[bestA], centers[bestB]]);
      // Тракт шире одной клетки нарочно. Отряды в игре ходят по прямой, а не по
      // нашей колее; узкая дорога давала бы выигрыш только там, где она сама
      // оказалась прямой, и смысл её терялся бы на первом же повороте.
      for (const c of road(seed, centers[bestA], centers[bestB])) {
        track.add(c);
        const x = WORLD_ORIGIN.x + Math.floor(c / 4096);
        const y = WORLD_ORIGIN.y + (c % 4096);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (inWorld(nx, ny)) cells.add(cellKey(nx, ny));
          }
        }
      }
    }
  }
  return { cells, track, edges };
}

export function roadNet(seed: number): RoadNet {
  const c = cachesFor(seed);
  if (!c.roads) c.roads = buildRoads(seed);
  return c.roads;
}

// ---------- Материки ----------

/**
 * Связные куски суши. В игре по ним никто не ходит — отряд идёт по прямой и
 * при нужде плывёт, — но именно они отвечают на вопрос «а не отрезано ли это
 * поселение водой»: клетка знает свой кусок, кусок знает свой размер.
 *
 * Держится это ради одного обещания, и обещание проверяется тестом: дом игрока
 * стоит на главном материке, у него всегда есть сухопутные соседи, а поселения
 * на островах допустимы — до них добираются вплавь, и это интересная цель, а не
 * сломанная генерация. Отсюда же берётся раздел «вода» в `npm run world:report`.
 */
export interface Landmasses {
  /** Номер куска суши в клетке. -1 — вода или за краем мира. */
  at(x: number, y: number): number;
  /** Сколько клеток в куске. */
  sizeOf(id: number): number;
  /** Размеры всех кусков по их номерам. */
  sizes: number[];
}

function buildLandmasses(seed: number): Landmasses {
  const n = WORLD_SIZE;
  const id = new Int32Array(n * n).fill(-1);
  const water = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      water[y * n + x] = terrainAt(seed, WORLD_ORIGIN.x + x, WORLD_ORIGIN.y + y) === 'water' ? 1 : 0;
    }
  }
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < n * n; start++) {
    if (water[start] || id[start] >= 0) continue;
    const mass = sizes.length;
    let size = 0;
    id[start] = mass;
    stack.push(start);
    while (stack.length > 0) {
      const i = stack.pop() as number;
      size++;
      const ix = i % n;
      const iy = (i - ix) / n;
      // Связность по восьми соседям: по диагонали между двумя озёрами суша
      // всё-таки проходима, и разрывать её там было бы неправдой.
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = ix + dx;
          const ny = iy + dy;
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const j = ny * n + nx;
          if (water[j] || id[j] >= 0) continue;
          id[j] = mass;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
  }
  return {
    sizes,
    at: (x, y) => (inWorld(x, y) ? id[(y - WORLD_ORIGIN.y) * n + (x - WORLD_ORIGIN.x)] : -1),
    sizeOf: (mass) => sizes[mass] ?? 0,
  };
}

export function landmasses(seed: number): Landmasses {
  const c = cachesFor(seed);
  if (!c.masses) c.masses = buildLandmasses(seed);
  return c.masses;
}

/**
 * Сколько суши связано с этой клеткой, но не больше потолка. Дешёвый ответ на
 * единственный вопрос, который задают при расстановке: материк это или остров.
 *
 * Полная разметка (`landmasses`) стоит около ста шестидесяти миллисекунд —
 * шестьсот сорок тысяч клеток, — и платить их на каждой генерации мира не за
 * что. Здесь обход останавливается, как только набралось достаточно: на
 * материке это происходит сразу, на острове обход кончается сам.
 *
 * Числа для мерки: материк 365 926 клеток, следующая по величине земля —
 * Британия, 5 695. Потолок между ними и стоит.
 */
export function reachableLand(seed: number, x: number, y: number, cap: number): number {
  if (!inWorld(x, y) || terrainAt(seed, x, y) === 'water') return 0;
  const n = WORLD_SIZE;
  // Отметки — байтовым полем, а не множеством: на двадцати тысячах клеток
  // `Set<number>` стоит вдесятеро дороже самого обхода. Поле выделяется на
  // вызов и обнуляется системой — держать его между вызовами не за чем.
  const seen = new Uint8Array(n * n);
  const stack = new Int32Array(cap * 2 + 16);
  let top = 0;
  const push = (px: number, py: number): void => {
    if (top + 2 > stack.length) return;
    stack[top++] = px;
    stack[top++] = py;
  };
  seen[(y - WORLD_ORIGIN.y) * n + (x - WORLD_ORIGIN.x)] = 1;
  push(x, y);
  let count = 0;
  while (top > 0 && count < cap) {
    const cy = stack[--top];
    const cx = stack[--top];
    count++;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!inWorld(nx, ny)) continue;
        const i = (ny - WORLD_ORIGIN.y) * n + (nx - WORLD_ORIGIN.x);
        if (seen[i]) continue;
        if (terrainAt(seed, nx, ny) === 'water') continue;
        seen[i] = 1;
        push(nx, ny);
      }
    }
  }
  return count;
}
