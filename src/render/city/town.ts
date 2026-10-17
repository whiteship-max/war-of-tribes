// Город в ролике (docs/polish.md, П-6): тот же город, что в окне города, — план, дома, храм, ратуша, рынок, замок, лес и
// река, — под бой ролика осады и боя у города. Стена между углами — ролика (камень или частокол по уровню, проломы,
// ворота), город подводит к её угловым башням свои боковые стены; кольцо — камень или частокол по уровню; где ходят люди
// ролика, домов нет; перед стеной, где лагерь и поле, — ни леса, ни предместья. Дальние постройки — проще ближних.
//
// Чистая сборка без three и без DOM: её зовёт поток (`town.worker.ts`), стенд и тест бюджета. План — тот же, что у окна
// города (его отдаёт сцена игры, `CityBuild.plan`; нет сцены — свой, `cityPlan`): дома не переставляются, только уходят.
import type { Quality } from '../quality';
import type { V3 } from './geom';
import { GROUND_H, STOREY_H, type Detail } from './kit';
import { cityPlan, distSeg, type CityPlan, type House, type P, type Tower } from './layout';
import { buildStatic } from './budget';
import { groundGrid, groundMap } from './ground';
import { landMap, placeTrees, treeModel, type Species, type TreeInst } from './nature';
import { groundWet } from './banks';
import { CITY_SPEC } from './spec';
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

/** Уровни детализации города в ролике (docs/polish.md, П-6, «Скорость»): числа — метры от середины ролика. */
export const TOWN_LOD: Record<Quality, { near: number; mid: number; trees: number; reach: number; houses: number }> = {
  low: { near: 90, mid: 180, trees: 110, reach: 420, houses: 70 },
  medium: { near: 140, mid: 260, trees: 150, reach: 560, houses: 90 },
  high: { near: 190, mid: 340, trees: 200, reach: 700, houses: 110 },
};

export interface TownWorld {
  buildings: MeshArrays;
  buildingTris: number;
  /** Огни ночи: факелы башен и ворот, фонари площади, окна дворов. */
  lights: V3[];
  trees: Record<Species, TreeInst[]>;
  treeTris: number;
  /** Дома, что остались у ролика (ближе `TOWN_LOD.houses` к воротам): под огонь, дым и перелёт камня. */
  houses: TownHouse[];
  /** Места убранных домов, рядов и деревьев дворов — их закрывает земля ролика (карта покрытий у города игры их помнит). */
  cleared: Box2[];
  /** Дорога от главных ворот в долину (`layout.roadsOf`): ролик продолжает её по своей плите. */
  road: P[];
  /** Своя земля — когда города игры нет (`TownInput.ground`). */
  ground: { map: Uint8Array; land: Uint8Array; grid: { positions: Float32Array; normals: Float32Array; index: Uint32Array }; wet: Float32Array } | null;
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
  return { plan: { ...plan, wall: townContour(plan.wall, cut), towers, houses, suburb, stalls, yardTrees, yards }, cleared };
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
  for (const sp of Object.keys(trees) as Species[]) if (trees[sp].length) treeTris += treeModel(sp, spec.detail).triangleCount * trees[sp].length;
  const t3 = performance.now();
  const houses: TownHouse[] = plan.houses
    .filter((h) => Math.hypot(h.x - focus.x, h.z - focus.z) < lod.houses)
    .map((h) => ({ x: h.x, z: h.z, fx: h.fx, fz: h.fz, w: h.w, d: h.d, floors: h.floors, top: houseTop(h), seed: h.seed }));
  let ground: TownWorld['ground'] = null;
  if (input.ground) {
    // Карта покрытий — по плану окна города, как у города игры: убранное закрывает земля ролика.
    const map = groundMap(base, spec.map);
    const land = landMap(base, spec.land);
    const grid = groundGrid(spec.groundCells, spec.groundCell, { x: 0, z: -20 }, 1400);
    const wet = new Float32Array(grid.positions.length / 3);
    for (let k = 0; k < wet.length; k++) wet[k] = groundWet(grid.positions[k * 3], grid.positions[k * 3 + 2]);
    ground = { map, land, grid: { positions: grid.positions, normals: grid.normals, index: grid.index }, wet };
  }
  const t4 = performance.now();
  return {
    buildings: arraysOf(st.b),
    buildingTris: st.b.triangleCount,
    lights: st.lights,
    trees,
    treeTris,
    houses,
    cleared,
    road: (base.roads[0]?.pts ?? []).map((p) => ({ x: p.x, z: p.z })),
    ground,
    ms: { plan: t1 - t0, build: t2 - t1, trees: t3 - t2, ground: t4 - t3 },
  };
}

/** Буферы, которые поток передаёт, а не копирует. */
export function townTransferables(w: TownWorld): ArrayBuffer[] {
  const m = (a: MeshArrays): ArrayBufferLike[] => [a.pos.buffer, a.nor.buffer, a.uv.buffer, a.col.buffer, a.cfg.buffer, a.idx.buffer];
  const out: ArrayBufferLike[] = [...m(w.buildings)];
  if (w.ground) out.push(w.ground.map.buffer, w.ground.land.buffer, w.ground.grid.positions.buffer, w.ground.grid.normals.buffer, w.ground.grid.index.buffer, w.ground.wet.buffer);
  return out as ArrayBuffer[];
}
