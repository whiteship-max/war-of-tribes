// Сборка мира города без three и без DOM (docs/city.md, раздел 11.5): план, меш зданий, карта покрытий
// и карта земель, сетка земли, расстановка деревьев — всё, что считает процессор. Её зовёт поток
// (`world.worker.ts`), чтобы кадр игры не ждал секунды-другой; нет потока — та же функция здесь же.
// Сцене остаётся завернуть готовые массивы в буферы и текстуры.
import type { Quality } from '../quality';
import type { Builder, V3 } from './geom';
import { cityPlan, type CityPlan } from './layout';
import { buildStatic } from './budget';
import { groundGrid, groundMap } from './ground';
import { landMap, placeTrees, type Species, type TreeInst } from './nature';
import { groundWet, shoreItems, type Reed, type Stone } from './banks';
import type { Site } from './sites';
import { CITY_SPEC } from './spec';

/** Меш из построителя — плоскими массивами, которые поток отдаёт без копии. */
export interface MeshArrays {
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  col: Float32Array;
  cfg: Uint8Array;
  idx: Uint32Array | Uint16Array;
}

export const arraysOf = (b: Builder): MeshArrays => ({
  pos: new Float32Array(b.pos),
  nor: new Float32Array(b.nor),
  uv: new Float32Array(b.uv),
  col: new Float32Array(b.col),
  cfg: new Uint8Array(b.cfg),
  idx: b.vertexCount > 65535 ? new Uint32Array(b.idx) : new Uint16Array(b.idx),
});

export interface CityWorld {
  plan: CityPlan;
  buildings: MeshArrays;
  buildingTris: number;
  lights: V3[];
  chimneys: V3[];
  flagTops: V3[];
  sites: Site[];
  marks: { houses: number; forts: number; civic: number; outside: number };
  map: Uint8Array;
  land: Uint8Array;
  grid: { positions: Float32Array; normals: Float32Array; index: Uint32Array };
  /** Сырость земли у воды в каждой вершине сетки (`banks.groundWet`): ил, сырая земля, влажная трава. */
  wet: Float32Array;
  trees: Record<Species, TreeInst[]>;
  /** Камыш у кромки и камни на берегу (`banks.shoreItems`). */
  shore: { reeds: Reed[]; stones: Stone[] };
  /** Колесо лесопилки, что крутится (docs/city.md, 16.4): модель вокруг оси и где стоит; на «Низком» — нет. */
  wheel: { mesh: MeshArrays; at: V3; fx: number; fz: number; R: number; water: number } | null;
  /** Сколько стоила каждая часть, мс — подписи стенда и таблице бюджета. */
  ms: { plan: number; build: number; ground: number; trees: number };
}

export function buildWorld(q: Quality): CityWorld {
  const spec = CITY_SPEC[q];
  const t0 = performance.now();
  const plan = cityPlan();
  const t1 = performance.now();
  const st = buildStatic(plan, q);
  const t2 = performance.now();
  const map = groundMap(plan, spec.map);
  const land = landMap(plan, spec.land);
  const grid = groundGrid(spec.groundCells, spec.groundCell, { x: 0, z: -20 }, 1400);
  const wet = new Float32Array(grid.positions.length / 3);
  for (let k = 0; k < wet.length; k++) wet[k] = groundWet(grid.positions[k * 3], grid.positions[k * 3 + 2]);
  const shore = shoreItems(plan, q);
  const t3 = performance.now();
  const trees = placeTrees(plan, spec.treeNear, spec.nearStep, spec.farStep, spec.treeReach);
  const t4 = performance.now();
  return {
    plan,
    buildings: arraysOf(st.b),
    buildingTris: st.b.triangleCount,
    lights: st.lights,
    chimneys: st.chimneys,
    flagTops: st.flagTops,
    sites: st.sites,
    marks: st.marks,
    map,
    land,
    grid: { positions: grid.positions, normals: grid.normals, index: grid.index },
    wet,
    trees,
    shore,
    wheel: st.wheel ? { mesh: arraysOf(st.wheel.b), at: st.wheel.at, fx: st.wheel.fx, fz: st.wheel.fz, R: st.wheel.R, water: st.wheel.water } : null,
    ms: { plan: t1 - t0, build: t2 - t1, ground: t3 - t2, trees: t4 - t3 },
  };
}

/** Буферы, которые поток передаёт, а не копирует. */
export function transferables(w: CityWorld): ArrayBuffer[] {
  const b = w.buildings;
  const wh = w.wheel?.mesh;
  const wheel = wh ? [wh.pos, wh.nor, wh.uv, wh.col, wh.cfg, wh.idx] : [];
  return [b.pos, b.nor, b.uv, b.col, b.cfg, b.idx, w.map, w.land, w.grid.positions, w.grid.normals, w.grid.index, w.wet, ...wheel].map((a) => a.buffer as ArrayBuffer);
}
