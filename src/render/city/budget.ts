// Счёт бюджета вида «город» без браузера (docs/city.md, раздел 10): те же план, модели и расстановка,
// что у сборки, — вызовы отрисовки, треугольники кадра с теневым проходом и память текстур. Стенд
// (`npm run city:shots`) меряет то же на настоящем кадре; тест держит границы владельца по уровням.
import type { Quality } from '../quality';
import type { BuildingTypeId } from '@/game/types';
import { Builder, type V3 } from './geom';
import { cityPlan, MOAT_Z, type CityPlan, type Civic, type P, type TowerKind } from './layout';
import type { Detail } from './kit';
import { palisadeRing, timberTower } from './palisade';
import { ownerCode, siteOf, wallSites, type Site } from './sites';
import { millWheel, yard, yardHalls } from './outskirts';
import { house, houseStoop } from './kit';
import { cityWall, tower } from './forts';
import { churchyard, civic, civicStoop, fireBowl, gutter, marketProps, stall, statue, well } from './civic';
import { placeTrees, treeModel, type Species } from './nature';
import { LAYERS } from './tex';
import { CITY_SPEC, GATE_GUARDS, LIFE_CAP, LIFE_TRIS, SHORE_CAP, figureTris, peopleTris, shoreTris } from './spec';
import { shoreItems, waterTriangles } from './banks';
import { fixture, forge, mounted, standing, streetLamps } from './lamps';
import type { Lamp, LampKind } from '../glow/lamps';

/** Границы владельца по уровням (задание ночи 1): вызовы, треугольники, МБ текстур, МБ докачки. */
export const CITY_BUDGET: Record<Quality, { calls: number; triangles: number; textureMb: number; downloadMb: number }> = {
  high: { calls: 250, triangles: 800_000, textureMb: 128, downloadMb: 8 },
  medium: { calls: 180, triangles: 400_000, textureMb: 64, downloadMb: 3 },
  low: { calls: 140, triangles: 200_000, textureMb: 32, downloadMb: 1 },
};

/** Что собрано в меш зданий: построитель, огни ночи, трубы, места построек и где кончилась каждая часть. */
export interface StaticBuild {
  b: Builder;
  /** Огни ночи (docs/polish.md, П-9): у каждого — железо в меше (факел, фонарь, жаровня, горн). */
  lamps: Lamp[];
  chimneys: V3[];
  /** Верхушки башен — под флаги. */
  flagTops: V3[];
  /** Коробки 24 построек игры (`sites.ts`) — сняты с самих моделей. */
  sites: Site[];
  marks: { houses: number; forts: number; civic: number; outside: number };
  /** Колесо лесопилки, что крутится, — своим мешем (docs/city.md, 16.4); на «Низком» его нет: колесо стоит в общем. */
  wheel: ReturnType<typeof millWheel> | null;
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

/**
 * Как строить город в ролике (docs/polish.md, П-6); вид «город» зовёт без них. Кольцо стены — камень или частокол по уровню
 * стены, звенья перед роликом пропущены (там стена ролика), дальние дома — проще ближних.
 */
export interface StaticOpts {
  ring: 'stone' | 'wood';
  /** Звенья стены города, которых нет: их место — стена ролика. */
  skip: (p: P, q: P) => boolean;
  /** Подробность здания по месту: дальше от ролика — проще (уровни детализации города в ролике). */
  detailAt: (x: number, z: number) => Detail;
  /** Середина ролика: у неё частокол — бревно к бревну. */
  near: P;
}

/** Здания, стены и убранство в построитель — одна дорога для сборки сцены и для счёта бюджета. */
export function buildStatic(plan: CityPlan, q: Quality, opts?: StaticOpts): StaticBuild {
  const d = CITY_SPEC[q].detail;
  const dAt = opts?.detailAt ?? ((): Detail => d);
  const b = new Builder();
  const lamps: Lamp[] = [];
  /** Огни постройки, только что нарисованной `own`: вид и стена — по её коробке; железо — ничьё, как ступени. */
  const lit = (pts: readonly V3[], kind: LampKind, floor?: number): void => {
    const s = sites[sites.length - 1] ?? null;
    for (const p of pts) lamps.push(mounted(p, kind, s, floor));
  };
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
  for (const h of plan.houses) own('houses', h.x, h.z, h.fx, h.fz, () => chimneys.push(...house(b, h, dAt(h.x, h.z)).chimneys));
  // Ступени домов на склоне — ничьи: они на улице, коробка касания дома ими не растёт.
  for (const h of plan.houses) houseStoop(b, h);
  const houses = b.mark().t;
  // Стена города: крытый ход — на южной и западной сторонах через пролёт.
  b.owner = ownerCode('palisade');
  const covered = (s: number, p: P): boolean => (p.z > 100 || p.x < -40) && Math.floor(s / 70) % 2 === 0;
  // Частокол — кольцо города в ролике, когда стена ниже четвёртого уровня; замок — камень всегда (docs/polish.md, П-6).
  const wood = opts?.ring === 'wood';
  if (wood) palisadeRing(b, plan.wall, { x: 0, z: 0 }, plan.towers, d, opts.skip, opts.near);
  else cityWall(b, plan.wall, { x: 0, z: 0 }, plan.towers, d, covered, opts?.skip);
  cityWall(b, plan.castleWall, { x: -4, z: -150 }, plan.towers, d, () => false);
  sites.push(...wallSites(plan.wall), ...wallSites(plan.castleWall));
  for (const t of plan.towers) {
    const td = dAt(t.x, t.z);
    // Башни кольца частокола — срубы; башни замка (за рвом) — камень.
    const timber = wood && t.z > MOAT_Z[1];
    let pts: V3[] = [];
    own(towerOwner(t.kind), t.x, t.z, Math.cos(t.out), Math.sin(t.out), () => (pts = timber ? timberTower(b, t, td) : tower(b, t, td)));
    // Дозор — фонарь под шатром; прочие башни — факелы на стене.
    if (t.kind === 'watch' && !timber) lamps.push(...pts.map((p) => standing(p, 'lantern')));
    // У ворот земля под факелом — пол проезда (мост над рвом), а не рельеф.
    else lit(pts, 'torch', t.kind === 'gate' || t.kind === 'castleGate' ? (t.floor ?? t.base) : undefined);
    // Флаг — над верхом башни, посередине (`life.ts`).
    const s = sites[sites.length - 1];
    flagTops.push([t.x, s.y1, t.z]);
  }
  const forts = b.mark().t;
  for (const c of plan.civic) {
    let pts: V3[] = [];
    own(CIVIC_OWNER[c.kind], c.x, c.z, Math.cos(c.rot), Math.sin(c.rot), () => {
      const r = civic(b, c, dAt(c.x, c.z));
      chimneys.push(...r.chimneys);
      pts = r.lights;
    });
    // У храма — факел у входа, у прочих — фонарь над дверью; у кузницы ещё и горн у входа.
    lit(pts, c.kind === 'church' ? 'torch' : 'lantern');
    if (c.kind === 'smithy') {
      const fx = Math.cos(c.rot);
      const fz = Math.sin(c.rot);
      lamps.push(forge(b, c.x + fx * (c.d / 2 + 1.3) + fz * (c.w / 4), c.z + fz * (c.d / 2 + 1.3) - fx * (c.w / 4), fx, fz));
    }
    // Ступени — ничьи, как у домов; у храма вход — в башне и с площади через двор.
    if (c.kind !== 'church') civicStoop(b, c);
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
    lamps.push(standing(fireBowl(b, bowl), 'brazier'));
  });
  own('statue', plan.statue.x, plan.statue.z, 1, 0, () => statue(b, plan.statue, 0));
  const civicT = b.mark().t;
  // За стеной: предместье (дома Жилищ) и семь дворов.
  for (const h of plan.suburb) own('houses', h.x, h.z, h.fx, h.fz, () => chimneys.push(...house(b, h, dAt(h.x, h.z)).chimneys));
  for (const h of plan.suburb) houseStoop(b, h);
  for (const y of plan.yards) {
    let pts: V3[] = [];
    own(y.kind, y.x, y.z, Math.cos(y.rot), Math.sin(y.rot), () => {
      const r = yard(b, y, dAt(y.x, y.z));
      pts = r.lights;
      chimneys.push(...r.chimneys);
    });
    // Каменоломня и рудник — факел у входа, прочие дворы — фонарь у двери.
    lit(pts, y.kind === 'quarry' || y.kind === 'mine' ? 'torch' : 'lantern');
    for (const h of yardHalls(y)) civicStoop(b, h);
  }
  // Фонари улиц и площади — в городе; ролику у стены их не нужно (его улицы — за стеной ролика, вдали).
  if (!opts) lamps.push(...streetLamps(b, plan, lamps));
  // Железо огней — ничьё: тап по факелу — не тап по башне.
  b.owner = 0;
  for (const l of lamps) fixture(b, l);
  const mill = d > 0 ? plan.yards.find((y) => y.kind === 'sawmill') : undefined;
  const wheel = mill ? millWheel(mill, d) : null;
  return { b, lamps, chimneys, flagTops, sites, marks: { houses, forts, civic: civicT, outside: b.mark().t }, wheel };
}

export interface CityCounts {
  calls: number;
  /** Треугольники кадра: цветной проход всего и теневой — тех, кто отбрасывает тень. */
  triangles: number;
  buildings: number;
  ground: number;
  trees: number;
  /** Люди, стража, скот, птицы, флаги, телеги, утки, лодки, стяги — потолок уровня (`spec.LIFE_CAP`). */
  life: number;
  /** Вода до кромки и берег: лента реки и ручья, камыш и камни (`spec.SHORE_CAP`, `banks.shoreItems`). */
  shore: number;
  textureMb: number;
}

const FAR: readonly Species[] = ['broadFar', 'spruceFar'];

export function cityCounts(q: Quality, plan: CityPlan = cityPlan()): CityCounts {
  const spec = CITY_SPEC[q];
  const { b, wheel } = buildStatic(plan, q);
  const ground = spec.groundCells * spec.groundCells * 2;
  const trees = placeTrees(plan, spec.treeNear, spec.nearStep, spec.farStep, spec.treeReach);
  let treeTris = 0;
  let treeShadow = 0;
  // Здания, их тень, земля, огоньки ночью; вода; люди, стража, скот, дым, флаги, птицы, факелы стражи (тени у них нет).
  let calls = 1 + 1 + 1 + 1 + 1 + 7;
  // Берег: камыш и камни — по вызову, тени не бросают.
  const sc = SHORE_CAP[q];
  const items = shoreItems(plan, q);
  const st = shoreTris(sc.reedBlades);
  if (items.reeds.length > 0) calls += 1;
  if (items.stones.length > 0) calls += 1;
  const shore = waterTriangles(sc.cols) + items.reeds.length * st.reed + items.stones.length * st.stone;
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
  // Суета (`alive.ts`): телеги, утки, лодки, голуби, стяги — по вызову на вид, если уровень их показывает; фонари ночных прохожих
  // — вызов жизни (`life.ts`). Стягов — по два на воротах и донжоне (`alive.bannerSpots`).
  const banners = cap.banners > 0 ? plan.towers.filter((t) => t.kind === 'gate' || t.kind === 'castleGate' || t.kind === 'keep').length * 2 : 0;
  calls += [cap.lanterns, cap.carts, cap.ducks, cap.boats, cap.pigeons, banners].filter((n) => n > 0).length;
  // Колесо лесопилки крутится своим мешем (с тенью) и брызжет точками — три вызова (docs/city.md, 16.4).
  if (wheel) calls += 3;
  // Горожане — по вызову на вид (на низком — один), копейщики у ворот — вызов (docs/city.md, 16.2).
  const gates = plan.towers.filter((t) => t.kind === 'gate' || t.kind === 'castleGate').length;
  calls += (q === 'low' ? 0 : 2) + 1;
  const ft = figureTris(q);
  const life =
    peopleTris(q, cap.people) +
    cap.guards * ft.archer +
    gates * GATE_GUARDS * ft.guard +
    cap.animals * ft.beast +
    cap.birds * LIFE_TRIS.bird +
    plan.towers.length * LIFE_TRIS.flag +
    cap.carts * LIFE_TRIS.cart +
    cap.ducks * LIFE_TRIS.duck +
    cap.boats * LIFE_TRIS.boat +
    cap.pigeons * LIFE_TRIS.pigeon +
    banners * LIFE_TRIS.banner;
  const layerBytes = spec.tex * spec.tex * 4 * LAYERS.length * (4 / 3);
  const mapBytes = (spec.map * spec.map + spec.land * spec.land) * 4 * (4 / 3);
  const shadowBytes = spec.shadowMap * spec.shadowMap * 8;
  return {
    calls,
    triangles: (b.triangleCount + (wheel?.b.triangleCount ?? 0)) * 2 + ground + treeTris + treeShadow + life + shore,
    buildings: b.triangleCount,
    ground,
    trees: treeTris,
    life,
    shore,
    textureMb: (layerBytes + mapBytes + shadowBytes) / 1048576,
  };
}
