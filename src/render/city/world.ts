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
import { groundWet, rockAt, shoreItems, type Reed, type Stone } from './banks';
import { mudAt } from './roads';
import type { Site } from './sites';
import { CITY_SPEC } from './spec';
import type { Lamp } from '../glow/lamps';

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
  /** Огни ночи с видом и стеной (docs/polish.md, П-9). */
  lamps: Lamp[];
  chimneys: V3[];
  flagTops: V3[];
  sites: Site[];
  marks: { houses: number; forts: number; civic: number; outside: number };
  map: Uint8Array;
  land: Uint8Array;
  grid: { positions: Float32Array; normals: Float32Array; index: Uint32Array };
  /** Пара на вершину сетки (`world.wetAndMud`): сырость у воды (ил, сырая земля, влажная трава) и грязь у ворот и конюшен. */
  wet: Float32Array;
  trees: Record<Species, TreeInst[]>;
  /** Камыш у кромки, камни на берегу и на склонах (`banks.shoreItems`). */
  shore: { reeds: Reed[]; stones: Stone[]; rocks: Stone[] };
  /** Колесо лесопилки, что крутится (docs/city.md, 16.4): модель вокруг оси и где стоит; на «Низком» — нет. */
  wheel: { mesh: MeshArrays; at: V3; fx: number; fz: number; R: number; water: number } | null;
  /** Крылья мельницы Фермы (ЗД-2): модель вокруг оси и где ступица. */
  sails: { mesh: MeshArrays; at: V3; fx: number; fz: number; R: number } | null;
  /** Рост Фермы (ЗД-2): меш и где кончается каждая ступень индексов (`outskirts.growthCount`). */
  growth: { mesh: MeshArrays; tiers: number[] } | null;
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
  const wet = wetAndMud(grid.positions, plan);
  const shore = shoreItems(plan, q);
  const t3 = performance.now();
  const trees = placeTrees(plan, spec.treeNear, spec.nearStep, spec.farStep, spec.treeReach);
  const t4 = performance.now();
  return {
    plan,
    buildings: arraysOf(st.b),
    buildingTris: st.b.triangleCount,
    lamps: st.lamps,
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
    sails: st.sails ? { mesh: arraysOf(st.sails.b), at: st.sails.at, fx: st.sails.fx, fz: st.sails.fz, R: st.sails.R } : null,
    growth: st.growth ? { mesh: arraysOf(st.growth.b), tiers: st.growth.tiers } : null,
    ms: { plan: t1 - t0, build: t2 - t1, ground: t3 - t2, trees: t4 - t3 },
  };
}

/**
 * Вершинам сетки земли — пара на вершину: сырость берега (`banks.groundWet`) и грязь (`roads.mudAt`) — или, где грязи нет,
 * каменистая земля гряды минусом (`banks.rockAt`, ЗД-2); шейдер земли читает её атрибутом `cwet` (`material.groundMaterial`).
 */
export function wetAndMud(positions: Float32Array, plan: CityPlan): Float32Array {
  const n = positions.length / 3;
  const out = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) {
    const x = positions[k * 3];
    const z = positions[k * 3 + 2];
    out[k * 2] = groundWet(x, z);
    // Грязь — плюсом, каменистая земля гряды (ЗД-2) — минусом: где одна, там нет другой, и атрибут остаётся парой.
    const mud = mudAt(x, z, plan);
    out[k * 2 + 1] = mud > 0.01 ? mud : -rockAt(x, z);
  }
  return out;
}

/** Буферы, которые поток передаёт, а не копирует. */
export function transferables(w: CityWorld): ArrayBuffer[] {
  const b = w.buildings;
  const own = (m: MeshArrays | undefined): ArrayBufferView[] => (m ? [m.pos, m.nor, m.uv, m.col, m.cfg, m.idx] : []);
  return [b.pos, b.nor, b.uv, b.col, b.cfg, b.idx, w.map, w.land, w.grid.positions, w.grid.normals, w.grid.index, w.wet, ...own(w.wheel?.mesh), ...own(w.sails?.mesh), ...own(w.growth?.mesh)].map(
    (a) => a.buffer as ArrayBuffer,
  );
}
