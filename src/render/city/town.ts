// Город в ролике (docs/polish.md, П-6): тот же город, что в окне города, — план, дома, храм, ратуша, рынок, замок, лес и
// река, — под бой ролика осады и боя у города. Стена между углами — ролика (камень или частокол по уровню, проломы,
// ворота), город подводит к её угловым башням свои боковые стены; кольцо — камень или частокол по уровню; где ходят люди
// ролика, домов нет; перед стеной, где лагерь и поле, — ни леса, ни предместья. Дальние постройки — проще ближних.
//
// Чистая сборка без three и без DOM: её зовёт поток (`town.worker.ts`), стенд и тест бюджета. План — тот же, что у окна
// города (его отдаёт сцена игры, `CityBuild.plan`; нет сцены — свой, `cityPlan`): дома не переставляются, только уходят.
import type { Quality } from '../quality';
import { GROUND_H, STOREY_H, type Detail } from './kit';
import { cityPlan, distSeg, type CityPlan, type House, type P, type Tower } from './layout';
import { buildStatic } from './budget';
import { groundGrid, groundMap } from './ground';
import { landMap, placeTrees, treeModel, type Species, type TreeInst } from './nature';
import { groundWet } from './banks';
import { CITY_SPEC } from './spec';
import type { Lamp } from '../glow/lamps';
import { arraysOf, type MeshArrays } from './world';
import type { Box2, TownCut, TownHouse } from '../tw/town';

/** Что городу знать о ролике: уровень, вырез под бой, план города игры (нет — свой), нужна ли своя земля. */
export interface TownInput {
  quality: Quality;
  cut: TownCut;
  plan?: CityPlan;
  /** Земля и карты — свои: города игры нет (стенд, ролик без сцены). Иначе ролик берёт их у города игры. */
  ground: boolean;
}

/**
 * Уровни детализации города в ролике (docs/polish.md, П-6, «Скорость»), метры от середины ролика: дома подробно (`near`),
 * проще (`mid`), дальше — грубо; тень бросают здания ближе `shade`; деревья — моделями ближе `trees` (тень — ближе
 * `treeShade`), дальше — дальним комом, за `thin` — каждое второе, за `reach` — нет (там дымка и полог леса на земле).
 * Сетка земли — своя: `cells` клеток, шаг `cell` у ворот, край — в километре.
 */
export const TOWN_LOD: Record<Quality, { near: number; mid: number; shade: number; trees: number; treeShade: number; thin: number; reach: number; houses: number; cells: number; cell: number; water: boolean }> = {
  low: { near: 90, mid: 170, shade: 110, trees: 90, treeShade: 60, thin: 200, reach: 360, houses: 70, cells: 64, cell: 4.6, water: false },
  medium: { near: 130, mid: 210, shade: 115, trees: 130, treeShade: 90, thin: 210, reach: 400, houses: 90, cells: 76, cell: 3.6, water: true },
  high: { near: 180, mid: 300, shade: 170, trees: 180, treeShade: 130, thin: 290, reach: 540, houses: 110, cells: 104, cell: 2.9, water: true },
};

/** Где густа сетка земли города в ролике: между воротами и серединой южной части города — и стан, и дома у ворот. */
const GRID_REACH = 1100;

export interface TownWorld {
  buildings: MeshArrays;
  /** Треугольники зданий у ролика (бросают тень) — индексы того же меша; остальные — `far`. */
  near: Uint32Array;
  far: Uint32Array;
  buildingTris: number;
  /** Огни ночи: факелы башен и ворот, фонари у дверей, жаровня площади (docs/polish.md, П-9). */
  lamps: Lamp[];
  trees: Record<Species, TreeInst[]>;
  treeTris: number;
  /** Дома, что остались у ролика (ближе `TOWN_LOD.houses` к воротам): под огонь, дым и перелёт камня. */
  houses: TownHouse[];
  /** Места убранных домов, рядов и деревьев дворов — их закрывает земля ролика (карта покрытий у города игры их помнит). */
  cleared: Box2[];
  /** Дорога от главных ворот в долину (`layout.roadsOf`): ролик продолжает её по своей плите. */
  road: P[];
  /** Сетка земли ролика — густая у ворот, редкая к краю (своя, а не города игры: та — на весь мыс и дорога ролику). */
  grid: { positions: Float32Array; normals: Float32Array; index: Uint32Array };
  wet: Float32Array;
  /** Карты покрытий и земель — свои, когда города игры нет (`TownInput.ground`). */
  ground: { map: Uint8Array; land: Uint8Array } | null;
  ms: { plan: number; build: number; trees: number; ground: number };
}

const overlaps = (a: Box2, b: Box2): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;
const pad = (b: Box2, m: number): Box2 => ({ x0: b.x0 - m, x1: b.x1 + m, z0: b.z0 - m, z1: b.z1 + m });

/** След дома по осям: углы повёрнутого прямоугольника (фасад `fx, fz`, фронт `w` вдоль улицы, глубина `d`). */
export function houseBox(h: Pick<House, 'x' | 'z' | 'fx' | 'fz' | 'w' | 'd'>): Box2 {
  const ux = -h.fz;
  const uz = h.fx;
  const ex = Math.abs(ux) * (h.w / 2) + Math.abs(h.fx) * (h.d / 2);
  const ez = Math.abs(uz) * (h.w / 2) + Math.abs(h.fz) * (h.d / 2);
  return { x0: h.x - ex, x1: h.x + ex, z0: h.z - ez, z1: h.z + ez };
}

/** Конёк дома, высота города: пол, этажи, подъём кровли поперёк конька. */
export function houseTop(h: Pick<House, 'floor' | 'floors' | 'gable' | 'w' | 'd' | 'pitch'>): number {
  const eave = h.floor + GROUND_H + (h.floors - 1) * STOREY_H;
  return eave + Math.tan(h.pitch) * ((h.gable ? h.w : h.d) / 2);
}

/**
 * Контур стены города под ролик: южная дуга между боковыми стенами уходит, боковые стены идут к угловым башням ролика,
 * между углами — прямая стены ролика (её звенья город не рисует, `isFront`). Порядок обхода — исходный.
 */
export function townContour(wall: readonly P[], cut: TownCut): P[] {
  const n = wall.length;
  const zs = Math.min(cut.west.z, cut.east.z) - 13;
  const gone = (k: number): boolean => wall[((k % n) + n) % n].z > zs;
  // Начало обхода — первая оставшаяся точка после выпавшей дуги.
  let start = -1;
  for (let k = 0; k < n; k++) if (gone(k - 1) && !gone(k)) start = k;
  if (start < 0) return [...wall];
  const kept: P[] = [];
  for (let j = 0; j < n; j++) {
    const k = (start + j) % n;
    if (gone(k)) break;
    kept.push(wall[k]);
  }
  const head = kept[0];
  const tail = kept[kept.length - 1];
  // К хвосту обхода — ближний угол, от него по прямой ролика — к углу у головы.
  const [a, c] = Math.hypot(tail.x - cut.west.x, tail.z - cut.west.z) + Math.hypot(head.x - cut.east.x, head.z - cut.east.z) <= Math.hypot(tail.x - cut.east.x, tail.z - cut.east.z) + Math.hypot(head.x - cut.west.x, head.z - cut.west.z) ? [cut.west, cut.east] : [cut.east, cut.west];
  return [...kept, { x: a.x, z: a.z }, { x: c.x, z: c.z }];
}

/** Звено на прямой стены ролика: оба конца — на линии углов и между ними. */
export function isFront(cut: TownCut, p: P, q: P): boolean {
  const z = (cut.west.z + cut.east.z) / 2;
  const x0 = Math.min(cut.west.x, cut.east.x) - 0.5;
  const x1 = Math.max(cut.west.x, cut.east.x) + 0.5;
  const on = (r: P): boolean => Math.abs(r.z - z) < 0.6 && r.x > x0 && r.x < x1;
  return on(p) && on(q);
}

/** Башня города не нужна: стоит на прямой стены ролика или у её углов (там — башни ролика). */
function nearFront(cut: TownCut, t: Tower): boolean {
  const d = distSeg({ x: t.x, z: t.z }, cut.west, cut.east).d;
  return d < Math.max(10, t.size + 3);
}

/** План города под бой: контур, башни, дома, ряды, дворы и деревья дворов, что не мешают ролику. */
export function townPlan(plan: CityPlan, cut: TownCut): { plan: CityPlan; cleared: Box2[] } {
  const cleared: Box2[] = [];
  const zones = cut.clear.map((b) => pad(b, 1.2));
  const blocked = (b: Box2): boolean => zones.some((z) => overlaps(z, b));
  const field = pad(cut.field, 2);
  const keepHouse = (h: House, out: boolean): boolean => {
    const b = houseBox(h);
    if (blocked(b) || (out && overlaps(field, b))) {
      cleared.push(pad(b, 1.5));
      return false;
    }
    return true;
  };
  const houses = plan.houses.filter((h) => keepHouse(h, false));
  const suburb = plan.suburb.filter((h) => keepHouse(h, true));
  const stalls = plan.stalls.filter((s) => {
    const b = { x0: s.x - s.w / 2 - 1, x1: s.x + s.w / 2 + 1, z0: s.z - s.w / 2 - 1, z1: s.z + s.w / 2 + 1 };
    if (!blocked(b)) return true;
    cleared.push(b);
    return false;
  });
  const yardTrees = plan.yardTrees.filter((t) => {
    const b = { x0: t.x - t.r, x1: t.x + t.r, z0: t.z - t.r, z1: t.z + t.r };
    return !blocked(b);
  });
  const yards = plan.yards.filter((y) => !(y.x > field.x0 && y.x < field.x1 && y.z > field.z0 && y.z < field.z1));
  const towers = plan.towers.filter((t) => !(t.kind !== 'keep' && t.kind !== 'castleGate' && t.z > 0 && nearFront(cut, t)));
  // Желоб мощёной улицы (`civic.gutter`) — не через расчищенное: там земля ролика, а не мостовая.
  const inZone = (p: P): boolean => zones.some((z) => p.x > z.x0 && p.x < z.x1 && p.z > z.z0 && p.z < z.z1);
  const streets: CityPlan['streets'] = [];
  for (const st of plan.streets) {
    if (st.surface !== 'cobble' || st.half < 3) {
      streets.push(st);
      continue;
    }
    let run: P[] = [];
    for (const p of st.pts) {
      if (!inZone(p)) {
        run.push(p);
        continue;
      }
      if (run.length > 1) streets.push({ ...st, pts: run });
      run = [];
    }
    if (run.length > 1) streets.push({ ...st, pts: run });
  }
  return { plan: { ...plan, wall: townContour(plan.wall, cut), towers, houses, suburb, stalls, yardTrees, yards, streets }, cleared };
}

/** Деревья под ролик: тот же лес, что у окна города, — ближние моделями у середины ролика, дальние проще, за дымкой — нет. */
function townTrees(plan: CityPlan, q: Quality, cut: TownCut, focus: P): Record<Species, TreeInst[]> {
  const spec = CITY_SPEC[q];
  const lod = TOWN_LOD[q];
  const all = placeTrees(plan, spec.treeNear, spec.nearStep, spec.farStep, spec.treeReach);
  const out: Record<Species, TreeInst[]> = { broad: [], broadFar: [], spruce: [], spruceFar: [], fruit: [] };
  const zones = [pad(cut.field, 3), ...cut.clear.map((b) => pad(b, 2))];
  const free = (t: TreeInst): boolean => !zones.some((z) => t.x > z.x0 && t.x < z.x1 && t.z > z.z0 && t.z < z.z1);
  for (const sp of Object.keys(all) as Species[]) {
    for (const t of all[sp]) {
      if (!free(t)) continue;
      const d = Math.hypot(t.x - focus.x, t.z - focus.z);
      if (d > lod.reach) continue;
      // Дальше `thin` — каждое второе: лес вдали держат полог на земле (`landMap`) и дымка.
      if (d > lod.thin && (Math.round(t.x * 7 + t.z * 13) & 1) === 1) continue;
      if (sp === 'fruit') out.fruit.push(t);
      else if (sp === 'broad' || sp === 'broadFar') (d < lod.trees ? out.broad : out.broadFar).push(t);
      else (d < lod.trees ? out.spruce : out.spruceFar).push(t);
    }
  }
  return out;
}

/** Середина ролика в метрах города — у ворот, чуть наружу: там лагерь и бой. */
export const townFocus = (cut: TownCut): P => ({ x: (cut.west.x + cut.east.x) / 2, z: (cut.west.z + cut.east.z) / 2 + 25 });

export function townWorld(input: TownInput): TownWorld {
  const { quality: q, cut } = input;
  const spec = CITY_SPEC[q];
  const lod = TOWN_LOD[q];
  const t0 = performance.now();
  const base = input.plan ?? cityPlan();
  const t1 = performance.now();
  const { plan, cleared } = townPlan(base, cut);
  const focus = townFocus(cut);
  const d = spec.detail;
  const detailAt = (x: number, z: number): Detail => {
    const r = Math.hypot(x - focus.x, z - focus.z);
    return r < lod.near ? d : r < lod.mid ? (Math.max(0, d - 1) as Detail) : 0;
  };
  const st = buildStatic(plan, q, { ring: cut.wood ? 'wood' : 'stone', skip: (p, r) => isFront(cut, p, r), detailAt, near: focus });
  const t2 = performance.now();
  const trees = townTrees(plan, q, cut, focus);
  let treeTris = 0;
  for (const sp of Object.keys(trees) as Species[]) if (trees[sp].length) treeTris += treeModel(sp, spec.detail, true).triangleCount * trees[sp].length;
  const t3 = performance.now();
  const houses: TownHouse[] = plan.houses
    .filter((h) => Math.hypot(h.x - focus.x, h.z - focus.z) < lod.houses)
    .map((h) => ({ x: h.x, z: h.z, fx: h.fx, fz: h.fz, w: h.w, d: h.d, floors: h.floors, top: houseTop(h), seed: h.seed }));
  // Тень бросают только здания у ролика: коробка теней — вокруг кадра, дальние в неё не попадают, а проход теней их
  // всё равно рисовал бы (меш один).
  const near: number[] = [];
  const far: number[] = [];
  const P = st.b.pos;
  const I = st.b.idx;
  for (let k = 0; k < I.length; k += 3) {
    const cx = (P[I[k] * 3] + P[I[k + 1] * 3] + P[I[k + 2] * 3]) / 3;
    const cz = (P[I[k] * 3 + 2] + P[I[k + 1] * 3 + 2] + P[I[k + 2] * 3 + 2]) / 3;
    (Math.hypot(cx - focus.x, cz - focus.z) < lod.shade ? near : far).push(I[k], I[k + 1], I[k + 2]);
  }
  const gc = { x: (cut.west.x + cut.east.x) / 2, z: (cut.west.z + cut.east.z) / 2 - 60 };
  const grid = groundGrid(lod.cells, lod.cell, gc, GRID_REACH);
  const wet = new Float32Array(grid.positions.length / 3);
  for (let k = 0; k < wet.length; k++) wet[k] = groundWet(grid.positions[k * 3], grid.positions[k * 3 + 2]);
  // Карта покрытий — по плану окна города, как у города игры: убранное закрывает земля ролика.
  const ground: TownWorld['ground'] = input.ground ? { map: groundMap(base, spec.map), land: landMap(base, spec.land) } : null;
  const t4 = performance.now();
  return {
    buildings: arraysOf(st.b),
    near: new Uint32Array(near),
    far: new Uint32Array(far),
    buildingTris: st.b.triangleCount,
    lamps: st.lamps,
    trees,
    treeTris,
    houses,
    cleared,
    road: (base.roads[0]?.pts ?? []).map((p) => ({ x: p.x, z: p.z })),
    grid: { positions: grid.positions, normals: grid.normals, index: grid.index },
    wet,
    ground,
    ms: { plan: t1 - t0, build: t2 - t1, trees: t3 - t2, ground: t4 - t3 },
  };
}

/** Буферы, которые поток передаёт, а не копирует. */
export function townTransferables(w: TownWorld): ArrayBuffer[] {
  const m = (a: MeshArrays): ArrayBufferLike[] => [a.pos.buffer, a.nor.buffer, a.uv.buffer, a.col.buffer, a.cfg.buffer, a.idx.buffer];
  const out: ArrayBufferLike[] = [...m(w.buildings), w.near.buffer, w.far.buffer, w.grid.positions.buffer, w.grid.normals.buffer, w.grid.index.buffer, w.wet.buffer];
  if (w.ground) out.push(w.ground.map.buffer, w.ground.land.buffer);
  return out as ArrayBuffer[];
}
