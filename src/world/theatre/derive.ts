// Разметка регионов из атласа (docs/map_tw.md, раздел 13): чей каждый квадрат карты. Зовут её двое —
// сборщик данных (`npm run theatres:build`) и тест, сверяющий запечённое с выводом; в игру она не едет
// (игра читает `data.ts`): на телефоне такой разлив по 640 тысячам клеток стоил бы секунд.
//
// Три прохода, и порядок у них по силе рубежа:
//
//  1. **Суша.** Разлив от центров (`list.ts`) по цене местности, вода непроходима. Граница ложится там, где
//     цены от двух центров сравнялись, — а горы, хребты и реки поднимают цену, и потому она садится на гребень
//     и на реку. Регион связан по суше: через пролив разлив не идёт.
//  2. **Море и острова.** От всей размеченной суши — по воде и по островам без центра: остров уходит региону
//     ближнего берега целиком (по острову шаг даром), вода — тоже. Остров дальше `THEATRE_ISLAND_REACH` — ничей.
//  3. **Обрезка.** Вода дальше `THEATRE_BAND` от своей суши и пустыня дальше `THEATRE_DESERT` от непустынной
//     суши — ничьи: регион кончается морем и песком, а не идёт за горизонт.
//
// Всё детерминировано: куча сравнивает (цена, номер клетки), сложения — в Float64 одним порядком.
import { ATLAS_CLASS, ATLAS_RIDGE, ATLAS_RIVER, ATLAS_WATER, atlasCell, atlasSize } from '../atlas/atlas';
import { ATLAS_TERRAIN } from '../atlas/data';
import { cellOf } from '../atlas/project';
import { THEATRE_BAND, THEATRE_COST, THEATRE_DESERT, THEATRE_ISLAND_REACH, THEATRE_LIST, type TheatreDef } from './list';

/** Двоичная куча (цена, клетка): при равной цене раньше клетка с меньшим номером — порядок постоянный. */
class Heap {
  private ids = new Int32Array(1 << 16);
  private keys = new Float64Array(1 << 16);
  size = 0;

  private less(a: number, b: number): boolean {
    return this.keys[a] < this.keys[b] || (this.keys[a] === this.keys[b] && this.ids[a] < this.ids[b]);
  }

  private swap(a: number, b: number): void {
    const i = this.ids[a];
    this.ids[a] = this.ids[b];
    this.ids[b] = i;
    const k = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = k;
  }

  push(id: number, key: number): void {
    if (this.size === this.ids.length) {
      const ids = new Int32Array(this.ids.length * 2);
      ids.set(this.ids);
      const keys = new Float64Array(this.keys.length * 2);
      keys.set(this.keys);
      this.ids = ids;
      this.keys = keys;
    }
    let k = this.size++;
    this.ids[k] = id;
    this.keys[k] = key;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (!this.less(k, p)) break;
      this.swap(k, p);
      k = p;
    }
  }

  /** Вынуть вершину; её клетка и цена — в `top`. */
  pop(top: { id: number; key: number }): void {
    top.id = this.ids[0];
    top.key = this.keys[0];
    this.size--;
    this.ids[0] = this.ids[this.size];
    this.keys[0] = this.keys[this.size];
    let k = 0;
    for (;;) {
      const l = 2 * k + 1;
      const r = l + 1;
      let m = k;
      if (l < this.size && this.less(l, m)) m = l;
      if (r < this.size && this.less(r, m)) m = r;
      if (m === k) break;
      this.swap(k, m);
      k = m;
    }
  }
}

/** Восемь соседей: шаг и его длина. */
const STEPS: readonly (readonly [number, number, number])[] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Клетка центра: под точкой, а если она в воде — первая суша кольцами вокруг (порядок обхода постоянный). */
function seedCell(def: TheatreDef, lon: number, lat: number, cls: Uint8Array, n: number): number {
  const p = cellOf(lon, lat);
  const c0 = Math.floor(p.col);
  const r0 = Math.floor(p.row);
  for (let r = 0; r <= 12; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const c = c0 + dx;
        const row = r0 + dy;
        if (c < 0 || row < 0 || c >= n || row >= n) continue;
        const i = row * n + c;
        if (cls[i] !== ATLAS_WATER) return i;
      }
    }
  }
  throw new Error(`Регион ${def.id}: центр ${lon},${lat} в открытом море.`);
}

/**
 * Номер региона каждой клетки атласа (построчно, `row * size + col`): 1..N по `list` (номер — место в списке
 * плюс один), 0 — ничья земля: открытое море, песчаное море, дальний остров.
 */
export function deriveTheatres(list: readonly TheatreDef[] = THEATRE_LIST): Uint8Array {
  if (list.length > 254) throw new Error('Регионов больше, чем вмещает байт.');
  const n = atlasSize();
  const total = n * n;
  const desert = ATLAS_TERRAIN.indexOf('desert');
  const cls = new Uint8Array(total);
  const cost = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    const v = atlasCell(i % n, (i / n) | 0);
    const c = v & ATLAS_CLASS;
    cls[i] = c;
    if (c === ATLAS_WATER) continue;
    let k = THEATRE_COST[ATLAS_TERRAIN[c] as keyof typeof THEATRE_COST] ?? 1;
    if (v & ATLAS_RIDGE) k += THEATRE_COST.ridge;
    if (v & ATLAS_RIVER) k += THEATRE_COST.river;
    cost[i] = k;
  }

  const own = new Uint8Array(total);
  const heap = new Heap();
  const top = { id: 0, key: 0 };

  // 1. Суша: разлив по цене, вода непроходима.
  const dist = new Float64Array(total).fill(Infinity);
  const settled = new Uint8Array(total);
  list.forEach((def, k) => {
    for (const [lon, lat] of def.at) {
      const i = seedCell(def, lon, lat, cls, n);
      if (dist[i] === 0) throw new Error(`Регион ${def.id}: центр ${lon},${lat} совпал с чужим центром.`);
      dist[i] = 0;
      own[i] = k + 1;
      heap.push(i, 0);
    }
  });
  while (heap.size > 0) {
    heap.pop(top);
    const i = top.id;
    if (settled[i] || top.key > dist[i]) continue;
    settled[i] = 1;
    const x = i % n;
    const y = (i / n) | 0;
    for (const [dx, dy, len] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (settled[j] || cls[j] === ATLAS_WATER) continue;
      const d = top.key + len * (cost[i] + cost[j]) * 0.5;
      if (d < dist[j]) {
        dist[j] = d;
        own[j] = own[i];
        heap.push(j, d);
      }
    }
  }

  // 2. Море и острова без центра: от размеченной суши, по воде шаг — его длина, по острову — даром.
  const sea = new Float64Array(total).fill(Infinity);
  const sailed = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (!settled[i]) continue;
    sea[i] = 0;
    heap.push(i, 0);
  }
  while (heap.size > 0) {
    heap.pop(top);
    const i = top.id;
    if (sailed[i] || top.key > sea[i]) continue;
    sailed[i] = 1;
    const x = i % n;
    const y = (i / n) | 0;
    for (const [dx, dy, len] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (sailed[j] || settled[j]) continue;
      const d = top.key + (cls[j] === ATLAS_WATER ? len : 0);
      if (d < sea[j]) {
        sea[j] = d;
        own[j] = own[i];
        heap.push(j, d);
      }
    }
  }
  for (let i = 0; i < total; i++) {
    if (cls[i] !== ATLAS_WATER && !settled[i] && sea[i] > THEATRE_ISLAND_REACH) own[i] = 0;
  }

  // 3а. Своя вода — не дальше полосы от своей суши (по своей же воде).
  const shore = new Float64Array(total).fill(Infinity);
  const reached = new Uint8Array(total);
  for (let i = 0; i < total; i++) {
    if (cls[i] === ATLAS_WATER || !own[i]) continue;
    shore[i] = 0;
    heap.push(i, 0);
  }
  while (heap.size > 0) {
    heap.pop(top);
    const i = top.id;
    if (reached[i] || top.key > shore[i]) continue;
    reached[i] = 1;
    if (top.key >= THEATRE_BAND) continue;
    const x = i % n;
    const y = (i / n) | 0;
    for (const [dx, dy, len] of STEPS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (reached[j] || cls[j] !== ATLAS_WATER || own[j] !== own[i]) continue;
      const d = top.key + len;
      if (d < shore[j]) {
        shore[j] = d;
        heap.push(j, d);
      }
    }
  }
  for (let i = 0; i < total; i++) if (cls[i] === ATLAS_WATER && !(shore[i] <= THEATRE_BAND)) own[i] = 0;

  // 3б. Песчаное море: пустыня дальше полосы от непустынной суши (по пустыне, четырьмя соседями).
  const sand = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i++) {
    if (cls[i] === ATLAS_WATER || cls[i] === desert) continue;
    sand[i] = 0;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    if (sand[i] >= THEATRE_DESERT) continue;
    const x = i % n;
    const y = (i / n) | 0;
    for (const [dx, dy] of STEPS) {
      if (dx !== 0 && dy !== 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (sand[j] >= 0 || cls[j] !== desert) continue;
      sand[j] = sand[i] + 1;
      queue[tail++] = j;
    }
  }
  for (let i = 0; i < total; i++) if (cls[i] === desert && sand[i] < 0) own[i] = 0;
  return own;
}
