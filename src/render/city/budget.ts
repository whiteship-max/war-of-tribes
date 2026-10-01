// Счёт бюджета вида «город» без браузера (docs/city.md, раздел 10): те же план, модели и расстановка,
// что у сборки, — вызовы отрисовки, треугольники кадра с теневым проходом и память текстур. Стенд
// (`npm run city:shots`) меряет то же на настоящем кадре; тест держит границы владельца по уровням.
import type { Quality } from '../quality';
import { Builder, type V3 } from './geom';
import { cityPlan, type CityPlan } from './layout';
import { house } from './kit';
import { cityWall, tower } from './forts';
import { churchyard, civic, fireBowl, stall, statue, well } from './civic';
import { placeTrees, treeModel, type Species } from './nature';
import { LAYERS } from './tex';
import { CITY_SPEC } from './spec';

/** Границы владельца по уровням (задание ночи 1): вызовы, треугольники, МБ текстур, МБ докачки. */
export const CITY_BUDGET: Record<Quality, { calls: number; triangles: number; textureMb: number; downloadMb: number }> = {
  high: { calls: 250, triangles: 800_000, textureMb: 128, downloadMb: 8 },
  medium: { calls: 180, triangles: 400_000, textureMb: 64, downloadMb: 3 },
  low: { calls: 140, triangles: 200_000, textureMb: 32, downloadMb: 1 },
};

/** Что собрано в меш зданий: построитель, огни ночи, трубы и где кончилась каждая часть. */
export interface StaticBuild {
  b: Builder;
  lights: V3[];
  chimneys: V3[];
  marks: { houses: number; forts: number; civic: number };
}

/** Здания, стены и убранство в построитель — одна дорога для сборки сцены и для счёта бюджета. */
export function buildStatic(plan: CityPlan, q: Quality): StaticBuild {
  const d = CITY_SPEC[q].detail;
  const b = new Builder();
  const lights: V3[] = [];
  const chimneys: V3[] = [];
  for (const h of plan.houses) chimneys.push(...house(b, h, d).chimneys);
  const houses = b.mark().t;
  // Стена города: крытый ход — на южной и западной сторонах через пролёт.
  cityWall(b, plan.wall, { x: 0, z: 0 }, plan.towers, d, (s, p) => (p.z > 100 || p.x < -40) && Math.floor(s / 70) % 2 === 0);
  cityWall(b, plan.castleWall, { x: -4, z: -150 }, plan.towers, d, () => false);
  for (const t of plan.towers) lights.push(...tower(b, t, d));
  const forts = b.mark().t;
  for (const c of plan.civic) {
    const r = civic(b, c, d);
    chimneys.push(...r.chimneys);
    lights.push(...r.lights);
    if (c.kind === 'church') churchyard(b, c);
  }
  for (const s of plan.stalls) stall(b, s, d);
  well(b, plan.well, d);
  lights.push(fireBowl(b, { x: plan.well.x + 3.2, z: plan.well.z + 1.5 }));
  statue(b, plan.statue, 0);
  return { b, lights, chimneys, marks: { houses, forts, civic: b.mark().t } };
}

export interface CityCounts {
  calls: number;
  /** Треугольники кадра: цветной проход всего и теневой — тех, кто отбрасывает тень. */
  triangles: number;
  buildings: number;
  ground: number;
  trees: number;
  textureMb: number;
}

const FAR: readonly Species[] = ['broadFar', 'spruceFar'];

export function cityCounts(q: Quality, plan: CityPlan = cityPlan()): CityCounts {
  const spec = CITY_SPEC[q];
  const { b } = buildStatic(plan, q);
  const ground = spec.groundCells * spec.groundCells * 2;
  const trees = placeTrees(plan, spec.treeNear, spec.nearStep, spec.farStep, spec.treeReach);
  let treeTris = 0;
  let treeShadow = 0;
  let calls = 1 + 1 + 1 + 1; // здания, их тень, земля, огоньки ночью
  for (const sp of Object.keys(trees) as Species[]) {
    const n = trees[sp].length;
    if (n === 0) continue;
    const t = treeModel(sp, spec.detail).triangleCount * n;
    treeTris += t;
    const far = FAR.includes(sp);
    calls += far ? 1 : 2;
    if (!far) treeShadow += t;
  }
  const layerBytes = spec.tex * spec.tex * 4 * LAYERS.length * (4 / 3);
  const mapBytes = (spec.map * spec.map + spec.land * spec.land) * 4 * (4 / 3);
  const shadowBytes = spec.shadowMap * spec.shadowMap * 8;
  return {
    calls,
    triangles: b.triangleCount * 2 + ground + treeTris + treeShadow,
    buildings: b.triangleCount,
    ground,
    trees: treeTris,
    textureMb: (layerBytes + mapBytes + shadowBytes) / 1048576,
  };
}
