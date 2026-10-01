// Счёт бюджета вида «город» без браузера (docs/city.md, раздел 10): те же план, модели и расстановка,
// что у сборки, — вызовы отрисовки, треугольники кадра с теневым проходом и память текстур. Стенд
// (`npm run city:shots`) меряет то же на настоящем кадре; тест держит границы владельца по уровням.
import type { Quality } from '../quality';
import type { BuildingTypeId } from '@/game/types';
import { Builder, type V3 } from './geom';
import { cityPlan, raceRibbon, riverRibbon, type CityPlan, type Civic, type TowerKind } from './layout';
import { ownerCode, siteOf, wallSites, type Site } from './sites';
import { yard } from './outskirts';
import { house } from './kit';
import { cityWall, tower } from './forts';
import { churchyard, civic, fireBowl, gutter, marketProps, stall, statue, well } from './civic';
import { placeTrees, treeModel, type Species } from './nature';
import { LAYERS } from './tex';
import { CITY_SPEC, LIFE_CAP, LIFE_TRIS } from './spec';

/** Границы владельца по уровням (задание ночи 1): вызовы, треугольники, МБ текстур, МБ докачки. */
export const CITY_BUDGET: Record<Quality, { calls: number; triangles: number; textureMb: number; downloadMb: number }> = {
  high: { calls: 250, triangles: 800_000, textureMb: 128, downloadMb: 8 },
  medium: { calls: 180, triangles: 400_000, textureMb: 64, downloadMb: 3 },
  low: { calls: 140, triangles: 200_000, textureMb: 32, downloadMb: 1 },
};

/** Что собрано в меш зданий: построитель, огни ночи, трубы, места построек и где кончилась каждая часть. */
export interface StaticBuild {
  b: Builder;
  lights: V3[];
  chimneys: V3[];
  /** Верхушки башен — под флаги. */
  flagTops: V3[];
  /** Коробки 24 построек игры (`sites.ts`) — сняты с самих моделей. */
  sites: Site[];
  marks: { houses: number; forts: number; civic: number; outside: number };
}

/** Чья постройка — большое здание города (docs/city.md, раздел 5); палас — замок, казна в нём. */
const CIVIC_OWNER: Record<Civic['kind'], BuildingTypeId> = {
  church: 'church',
  hall: 'town_hall',
  granary: 'storage',
  guild: 'workshop',
  smithy: 'smithy',
  stable: 'stable',
  tavern: 'tavern',
  spital: 'infirmary',
  palas: 'cache',
  barracks: 'barracks',
};

/** Чья постройка — башня: Дозор, донжон-тайник, остальные — Башня игры. */
const towerOwner = (k: TowerKind): BuildingTypeId => (k === 'watch' ? 'watch' : k === 'keep' ? 'cache' : 'tower');

/** Здания, стены и убранство в построитель — одна дорога для сборки сцены и для счёта бюджета. */
export function buildStatic(plan: CityPlan, q: Quality): StaticBuild {
  const d = CITY_SPEC[q].detail;
  const b = new Builder();
  const lights: V3[] = [];
  const chimneys: V3[] = [];
  const flagTops: V3[] = [];
  const sites: Site[] = [];
  /** Писать часть постройки `type` и снять её коробку в рамке (cx, cz, fx, fz). */
  const own = (type: BuildingTypeId, cx: number, cz: number, fx: number, fz: number, draw: () => void): void => {
    b.owner = ownerCode(type);
    const from = b.mark().v;
    draw();
    sites.push(siteOf(type, b.extent(from, cx, cz, fx, fz), cx, cz, fx, fz));
    b.owner = 0;
  };
  for (const h of plan.houses) own('houses', h.x, h.z, h.fx, h.fz, () => chimneys.push(...house(b, h, d).chimneys));
  const houses = b.mark().t;
  // Стена города: крытый ход — на южной и западной сторонах через пролёт.
  b.owner = ownerCode('palisade');
  cityWall(b, plan.wall, { x: 0, z: 0 }, plan.towers, d, (s, p) => (p.z > 100 || p.x < -40) && Math.floor(s / 70) % 2 === 0);
  cityWall(b, plan.castleWall, { x: -4, z: -150 }, plan.towers, d, () => false);
  sites.push(...wallSites(plan.wall), ...wallSites(plan.castleWall));
  for (const t of plan.towers) {
    own(towerOwner(t.kind), t.x, t.z, Math.cos(t.out), Math.sin(t.out), () => lights.push(...tower(b, t, d)));
    // Флаг — над верхом башни, посередине (`life.ts`).
    const s = sites[sites.length - 1];
    flagTops.push([t.x, s.y1, t.z]);
  }
  const forts = b.mark().t;
  for (const c of plan.civic) {
    own(CIVIC_OWNER[c.kind], c.x, c.z, Math.cos(c.rot), Math.sin(c.rot), () => {
      const r = civic(b, c, d);
      chimneys.push(...r.chimneys);
      lights.push(...r.lights);
    });
    // Ограда двора — храму, но коробкой не служит: двор — земля, а не здание.
    if (c.kind === 'church') {
      b.owner = ownerCode('church');
      churchyard(b, c);
      b.owner = 0;
    }
  }
  // Желоб посреди мощёных улиц — ничей: улица не постройка.
  for (const st of plan.streets) if (st.surface === 'cobble' && st.half >= 3) gutter(b, st.pts, plan.gates);
  // Ряды — одной коробкой на весь рынок: тап между прилавками — тоже рынок.
  b.owner = ownerCode('market');
  const marketFrom = b.mark().v;
  for (const s of plan.stalls) stall(b, s, d);
  marketProps(b, plan.stalls[0]?.seed ?? 0, d);
  sites.push(siteOf('market', b.extent(marketFrom, 0, 0, 1, 0), 0, 0, 1, 0));
  const bowl = { x: plan.well.x + 3.2, z: plan.well.z + 1.5 };
  own('campfire', plan.well.x, plan.well.z, 1, 0, () => {
    well(b, plan.well, d);
    lights.push(fireBowl(b, bowl));
  });
  own('statue', plan.statue.x, plan.statue.z, 1, 0, () => statue(b, plan.statue, 0));
  const civicT = b.mark().t;
  // За стеной: предместье (дома Жилищ) и семь дворов.
  for (const h of plan.suburb) own('houses', h.x, h.z, h.fx, h.fz, () => chimneys.push(...house(b, h, d).chimneys));
  for (const y of plan.yards) {
    own(y.kind, y.x, y.z, Math.cos(y.rot), Math.sin(y.rot), () => {
      const r = yard(b, y, d);
      lights.push(...r.lights);
      chimneys.push(...r.chimneys);
    });
  }
  return { b, lights, chimneys, flagTops, sites, marks: { houses, forts, civic: civicT, outside: b.mark().t } };
}

export interface CityCounts {
  calls: number;
  /** Треугольники кадра: цветной проход всего и теневой — тех, кто отбрасывает тень. */
  triangles: number;
  buildings: number;
  ground: number;
  trees: number;
  /** Вода, люди, стража, скот, птицы, флаги — потолок уровня (`spec.LIFE_CAP`). */
  life: number;
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
  // Здания, их тень, земля, огоньки ночью; вода; люди, стража, скот, дым, флаги, птицы, факелы стражи (тени у них нет).
  let calls = 1 + 1 + 1 + 1 + 1 + 7;
  for (const sp of Object.keys(trees) as Species[]) {
    const n = trees[sp].length;
    if (n === 0) continue;
    const t = treeModel(sp, spec.detail).triangleCount * n;
    treeTris += t;
    const far = FAR.includes(sp);
    calls += far ? 1 : 2;
    if (!far) treeShadow += t;
  }
  const cap = LIFE_CAP[q];
  const water = (riverRibbon().length - 1 + raceRibbon().length - 1) * 2;
  const life =
    water +
    cap.people * LIFE_TRIS.person +
    cap.guards * LIFE_TRIS.guard +
    cap.animals * LIFE_TRIS.beast +
    cap.birds * LIFE_TRIS.bird +
    plan.towers.length * LIFE_TRIS.flag;
  const layerBytes = spec.tex * spec.tex * 4 * LAYERS.length * (4 / 3);
  const mapBytes = (spec.map * spec.map + spec.land * spec.land) * 4 * (4 / 3);
  const shadowBytes = spec.shadowMap * spec.shadowMap * 8;
  return {
    calls,
    triangles: b.triangleCount * 2 + ground + treeTris + treeShadow + life,
    buildings: b.triangleCount,
    ground,
    trees: treeTris,
    life,
    textureMb: (layerBytes + mapBytes + shadowBytes) / 1048576,
  };
}
