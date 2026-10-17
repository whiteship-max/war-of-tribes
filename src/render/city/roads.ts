// Сеть дорог вида «город» (docs/city_v3.md, Г-3): дороги за стеной до края мира, тупики переулков, грязь у ворот и
// конюшен. Чистый модуль без three: его читают карта покрытий (`ground.ts`), карта земель (`nature.ts`), сетка земли
// (`world.ts`, `town.ts`) и тесты.
import { distSeg, insidePoly, type CityPlan, type P, type Street } from './layout';
import { fbm, sstep, vnoise } from './noise';

/** Отрезок дороги с полушириной и знаком стороны: левее хода — минус, правее — плюс. */
interface Seg {
  a: P;
  b: P;
  half: number;
}

/** Решётка отрезков дорог за стеной: клетка — 32 м, отрезок лежит во всех клетках своей рамки с запасом `PAD`. */
interface RoadIndex {
  cell: number;
  x0: number;
  z0: number;
  n: number;
  cells: Seg[][];
}

const CELL = 32;
/** Запас рамки отрезка: дальше этого от дороги ни поле, ни лес, ни дальняя карта о ней не спрашивают. */
const PAD = 40;
/** Сторона решётки — квадрат во весь мир сетки земли (`groundGrid`, досягаемость 1400 м). */
const SPAN = 1500;

const indexOf = new WeakMap<CityPlan, RoadIndex>();

function roadIndex(plan: CityPlan): RoadIndex {
  const had = indexOf.get(plan);
  if (had) return had;
  const n = Math.ceil((SPAN * 2) / CELL);
  const ix: RoadIndex = { cell: CELL, x0: -SPAN, z0: -SPAN, n, cells: Array.from({ length: n * n }, () => []) };
  for (const r of plan.roads) {
    for (let k = 0; k < r.pts.length - 1; k++) {
      const s: Seg = { a: r.pts[k], b: r.pts[k + 1], half: r.half };
      const i0 = Math.max(0, Math.floor((Math.min(s.a.x, s.b.x) - PAD - ix.x0) / CELL));
      const i1 = Math.min(n - 1, Math.floor((Math.max(s.a.x, s.b.x) + PAD - ix.x0) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(s.a.z, s.b.z) - PAD - ix.z0) / CELL));
      const j1 = Math.min(n - 1, Math.floor((Math.max(s.a.z, s.b.z) + PAD - ix.z0) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) ix.cells[j * n + i].push(s);
    }
  }
  indexOf.set(plan, ix);
  return ix;
}

const segsAt = (ix: RoadIndex, x: number, z: number): readonly Seg[] => {
  const i = Math.floor((x - ix.x0) / ix.cell);
  const j = Math.floor((z - ix.z0) / ix.cell);
  if (i < 0 || j < 0 || i >= ix.n || j >= ix.n) return [];
  return ix.cells[j * ix.n + i];
};

/** Есть ли дорога ближе `pad` к её краю (не дальше `PAD` м — запаса решётки). */
export function nearRoad(x: number, z: number, plan: CityPlan, pad: number): boolean {
  const p = { x, z };
  for (const s of segsAt(roadIndex(plan), x, z)) if (distSeg(p, s.a, s.b).d < s.half + pad) return true;
  return false;
}

/** Доля полуширины, дальше которой дальняя карта дорогу не помнит: 8 полуширин — 16–26 м. */
export const ROAD_U_MAX = 8;

/**
 * Расстояние до ближайшей дороги в её полуширинах со знаком стороны (слева — минус): поперёк прямой дороги оно линейно, и
 * двулинейная выборка редкой карты земель (8,6 м на клетку) восстанавливает край дороги точно (`material.groundMaterial`).
 * Дальше `ROAD_U_MAX` — `ROAD_U_MAX`.
 */
export function roadU(x: number, z: number, plan: CityPlan): number {
  const p = { x, z };
  let best = ROAD_U_MAX;
  let sign = 1;
  for (const s of segsAt(roadIndex(plan), x, z)) {
    const r = distSeg(p, s.a, s.b);
    const u = r.d / s.half;
    if (u < best) {
      best = u;
      // Сторона — по векторному произведению хода и точки: на изломе знак ровный по обе стороны угла.
      sign = (s.b.x - s.a.x) * (z - s.a.z) - (s.b.z - s.a.z) * (x - s.a.x) < 0 ? -1 : 1;
    }
  }
  return best * sign;
}

/** Конец улицы, который ни во что не упирается: переулок кончается у задних стен домов. */
export interface DeadEnd {
  x: number;
  z: number;
  /** Куда смотрит тупик: ход улицы у конца. */
  tx: number;
  tz: number;
  half: number;
}

/**
 * Тупики улиц: конец, у которого нет ни другой улицы, ни площади, ни ворот. Тупик кончается утоптанным двориком (`ground.ts`):
 * полоса земли, оборванная в траве, читалась бы обрывом дороги (docs/city_v3.md, Г-3, «Косяки»).
 */
export function deadEnds(plan: CityPlan): DeadEnd[] {
  const out: DeadEnd[] = [];
  const all: Street[] = [...plan.streets, ...plan.roads];
  for (const s of plan.streets) {
    const n = s.pts.length;
    if (n < 2) continue;
    const closed = Math.hypot(s.pts[0].x - s.pts[n - 1].x, s.pts[0].z - s.pts[n - 1].z) < 1;
    if (closed) continue;
    for (const [e, f] of [
      [s.pts[0], s.pts[1]],
      [s.pts[n - 1], s.pts[n - 2]],
    ] as const) {
      if (joins(e, s, all, plan)) continue;
      const l = Math.hypot(e.x - f.x, e.z - f.z) || 1;
      out.push({ x: e.x, z: e.z, tx: (e.x - f.x) / l, tz: (e.z - f.z) / l, half: s.half });
    }
  }
  return out;
}

/** Упирается ли конец `e` улицы `s` в сеть: в другую улицу или дорогу, на площадь или в ворота. */
export function joins(e: P, s: Street, all: readonly Street[], plan: CityPlan): boolean {
  if (insidePoly(e, plan.square)) return true;
  // Конец у края площади: улица заходит на мостовую своей шириной.
  for (let k = 0; k < plan.square.length; k++) {
    if (distSeg(e, plan.square[k], plan.square[(k + 1) % plan.square.length]).d < s.half + 1) return true;
  }
  if (plan.gates.some((g) => Math.hypot(g.x - e.x, g.z - e.z) < 12)) return true;
  for (const o of all) {
    if (o === s) continue;
    for (let k = 0; k < o.pts.length - 1; k++) if (distSeg(e, o.pts[k], o.pts[k + 1]).d < o.half + 2) return true;
  }
  return false;
}

/**
 * Грязь, 0..1: у ворот (по обе стороны проезда, вдоль дороги), у конюшни, кузницы и трактира, у коновязи и поилки двора
 * храма, у загона и хутора. Пятнами по шуму — не кругом. Красит сетка земли (вершины, `cwet.y`), а карта покрытий кладёт
 * там землю (`ground.ts`): шейдер делает её тёмной, сырой и в лужах (`material.groundMaterial`).
 */
export function mudAt(x: number, z: number, plan: CityPlan): number {
  let m = 0;
  for (const [cx, cz, r, k] of mudBlobs(plan)) {
    const dx = x - cx;
    const dz = z - cz;
    if (Math.abs(dx) > r * 1.3 || Math.abs(dz) > r * 1.3) continue;
    const d = Math.hypot(dx, dz) / r;
    if (d >= 1.3) continue;
    const w = (1 - sstep(0.35, 1.05, d + (vnoise(x / 2.6, z / 2.6, 1e6, 61) - 0.5) * 0.55)) * k;
    if (w > m) m = w;
  }
  // Низины грунтовых дорог за стеной держат воду: колеи — сырее, чем обочина.
  if (m < 0.5 && nearRoad(x, z, plan, 0)) {
    const low = sstep(0.55, 0.8, fbm(x / 23 + 4, z / 23 + 4, 1e6, 3, 67));
    if (low * 0.5 > m) m = low * 0.5;
  }
  return Math.min(1, m);
}

const blobsOf = new WeakMap<CityPlan, (readonly [number, number, number, number])[]>();

/** Пятна грязи плана: середина, радиус и сила (`mudAt`). */
function mudBlobs(plan: CityPlan): (readonly [number, number, number, number])[] {
  const had = blobsOf.get(plan);
  if (had) return had;
  const out: (readonly [number, number, number, number])[] = [];
  for (const g of plan.gates) {
    const ox = Math.cos(g.out);
    const oz = Math.sin(g.out);
    // По обе стороны проезда: внутри — у начала улицы, снаружи — дальше, вдоль дороги.
    for (const [f, r, k] of [
      [-7, 9, 0.75],
      [9, 11, 0.9],
      [22, 9, 0.6],
    ] as const) out.push([g.x + ox * f, g.z + oz * f, r, k]);
  }
  for (const c of plan.civic) {
    const k = c.kind === 'stable' ? 0.95 : c.kind === 'smithy' ? 0.7 : c.kind === 'tavern' ? 0.5 : 0;
    if (k === 0) continue;
    // Перед фасадом: двор, где держат коней и телеги.
    const fx = Math.cos(c.rot);
    const fz = Math.sin(c.rot);
    out.push([c.x + fx * (c.d / 2 + 4), c.z + fz * (c.d / 2 + 4), Math.max(c.w, c.d) * 0.55 + 3, k]);
  }
  for (const y of plan.yards) {
    const k = y.kind === 'pen' ? 0.85 : y.kind === 'farm' ? 0.6 : 0;
    if (k > 0) out.push([y.x, y.z, y.r * 0.75, k]);
  }
  // Коновязь и поилка у Верхней улицы (`precinct.churchSquare`): копыта и пролитая вода.
  out.push([20.6, -44, 3.6, 0.8], [21, -50, 3, 0.9]);
  // Колодец площади: отмостку мочит расплёсканное.
  out.push([plan.well.x + 0.6, plan.well.z + 0.8, 4.2, 0.45]);
  blobsOf.set(plan, out);
  return out;
}

/** Начало ломаной длиной `len` метров (конец — на самой ломаной): ближняя к воротам часть дороги, уходящей за край мира. */
export function headOf(pts: readonly P[], len: number): P[] {
  const out: P[] = [pts[0]];
  let rest = len;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l >= rest) {
      out.push({ x: a.x + ((b.x - a.x) * rest) / l, z: a.z + ((b.z - a.z) * rest) / l });
      return out;
    }
    out.push(b);
    rest -= l;
  }
  return out;
}
