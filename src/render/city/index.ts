// Сборка вида «город» (docs/city.md, разделы 7 и 11.5): слои текстур и мир (план, модели, карты,
// расстановка) — в двух потоках; здесь — только буферы, текстуры и материалы. Ленивый кусок: грузят
// его стенд (`?showcase=city`) и сцена игры при `?look=city`. Возвращает группу и ручки (ночь, снег,
// осень) — кадр сцена рисует сама.
import * as THREE from 'three';
import type { Builder, V3 } from './geom';
import type { CityPlan } from './layout';
import { arraysOf, buildWorld, type CityWorld, type MeshArrays } from './world';
import { LAYERS, paintLayer, TEX_SEED } from './tex';
import { buildingMaterial, cityUniforms, foliageMaterial, groundMaterial, LayerTexture, MapTexture, type CityUniforms } from './material';
import { MAP_AT } from './ground';
import { LAND_AT, treeModel, type Species } from './nature';
import type { Quality } from '../quality';
import { CITY_SPEC, SHORE_CAP } from './spec';
import type { Site } from './sites';
import { buildWater } from './water';
import { buildShore } from './shore';
import { waterLights } from './banks';
import { MillWheel } from './mill';
import { LampRig, lampsToWorld } from '../glow/rig';
import { LAMP_SPEC, type Lamp } from '../glow/lamps';
export { CITY_SPEC, type CitySpec } from './spec';

/** Слои текстур в потоке: кадр не ждёт генерации. Нет потока — считаем здесь же. */
export function paintLayers(size: number): Promise<Uint8Array> {
  try {
    const w = new Worker(new URL('./tex.worker.ts', import.meta.url), { type: 'module' });
    return new Promise((resolve, reject) => {
      w.onmessage = (e: MessageEvent<{ data: Uint8Array }>): void => {
        resolve(e.data.data);
        w.terminate();
      };
      w.onerror = (e): void => {
        w.terminate();
        reject(e);
      };
      w.postMessage({ size, seed: TEX_SEED });
    }).catch(() => paintHere(size)) as Promise<Uint8Array>;
  } catch {
    return Promise.resolve(paintHere(size));
  }
}

function paintHere(size: number): Uint8Array {
  const one = size * size * 4;
  const out = new Uint8Array(one * LAYERS.length);
  LAYERS.forEach((n, k) => out.set(paintLayer(n, size), k * one));
  return out;
}

/** Меш из построителя: положение, нормаль, UV слоя, тон, `cfg`. */
export function meshOf(b: Builder, mat: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(geometryOf(b), mat);
}

export const geometryOf = (b: Builder): THREE.BufferGeometry => geometryFrom(arraysOf(b));

/** Буферы меша из плоских массивов (их отдаёт поток мира без копии). */
export function geometryFrom(a: MeshArrays): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.nor, 3));
  g.setAttribute('cuv', new THREE.BufferAttribute(a.uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(a.col, 3));
  g.setAttribute('cfg', new THREE.BufferAttribute(a.cfg, 4));
  g.setIndex(new THREE.BufferAttribute(a.idx, 1));
  g.computeBoundingSphere();
  return g;
}

export interface CityBuild {
  group: THREE.Group;
  uniforms: CityUniforms;
  plan: CityPlan;
  /** Что собрано: для подписи стенда и таблицы бюджета. */
  counts: Record<string, number>;
  /** Байты текстур города (слои с мипами и карта). */
  textureBytes: number;
  /** Где дымят трубы. */
  chimneys: V3[];
  /** Верхушки башен — под флаги. */
  flagTops: V3[];
  /** Огни ночи (docs/polish.md, П-9): факелы стены и ворот, фонари улиц и дверей, жаровня площади, горн кузницы. */
  lamps: Lamp[];
  /** Свет огней на кадр: огоньки, пятна у земли, настоящие огни в шейдерах (`glow/rig.ts`). */
  rig: LampRig;
  /** Коробки 24 построек игры (`sites.ts`). */
  sites: Site[];
  /** Отдать материалы и текстуры (геометрию отдаёт сцена обходом). */
  dispose(): void;
  /** Полные слои текстур встали (сначала город стоит на слоях 256²). */
  full: Promise<void>;
  /** Колесо лесопилки, что крутится, и брызги (docs/city.md, 16.4); на «Низком» — нет, колесо стоит в меше зданий. */
  mill: MillWheel | null;
  /**
   * Что город одалживает ролику осады и боя у города (docs/polish.md, П-6, `backdrop.ts`): уровень, план, карты покрытий и
   * земель; слои текстур — `uniforms.cityTex` (сначала мелкие, потом полные). Ролик их не освобождает.
   */
  share: CityShare;
}

/** Город игры для ролика: тот же план, те же текстуры и карты — ни памяти сверх, ни второй сборки плана. */
export interface CityShare {
  quality: Quality;
  plan: CityPlan;
  uniforms: CityUniforms;
  map: THREE.Texture;
  land: THREE.Texture;
}

/** Сетка земли города в буферы: положение, нормаль, сырость берега и грязь (`world.wetAndMud`); тон, UV и `cfg` — пустые (их берёт карта). */
export function groundGeometry(grid: { positions: Float32Array; normals: Float32Array; index: Uint32Array }, wet: Float32Array): THREE.BufferGeometry {
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(grid.positions, 3));
  gg.setAttribute('normal', new THREE.BufferAttribute(grid.normals, 3));
  const nv = grid.positions.length / 3;
  gg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3).fill(1), 3));
  gg.setAttribute('cuv', new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
  gg.setAttribute('cfg', new THREE.BufferAttribute(new Uint8Array(nv * 4), 4));
  gg.setAttribute('cwet', new THREE.BufferAttribute(wet, 2));
  gg.setIndex(new THREE.BufferAttribute(grid.index, 1));
  gg.computeBoundingSphere();
  return gg;
}

/** Мир города в потоке: план, меш зданий, карты, расстановка. Нет потока — здесь же. */
export function worldOf(q: Quality): Promise<CityWorld> {
  try {
    const w = new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module' });
    return new Promise<CityWorld>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<CityWorld>): void => {
        resolve(e.data);
        w.terminate();
      };
      w.onerror = (e): void => {
        w.terminate();
        reject(e);
      };
      w.postMessage({ quality: q });
    }).catch(() => buildWorld(q));
  } catch {
    return Promise.resolve(buildWorld(q));
  }
}

export async function buildCity(q: Quality): Promise<CityBuild> {
  const spec = CITY_SPEC[q];
  const t0 = performance.now();
  // Два потока разом: слои текстур и мир; кадр ждёт только заворачивания готового в буферы. Слои — сначала
  // мелкие (256², ~четверть времени): город встаёт с ними, а полные подменяют их, когда готовы.
  const FIRST = 256;
  const progressive = spec.tex > FIRST;
  const layersP = paintLayers(progressive ? FIRST : spec.tex);
  const w = await worldOf(q);
  const tWorld = performance.now();
  const { plan, lamps, chimneys, flagTops, marks, sites, map, land, grid, trees, wet, shore } = w;
  const u = cityUniforms();
  const group = new THREE.Group();
  group.name = 'city';

  // Здания — один меш; та же дорога, что у счёта бюджета (`budget.buildStatic`, в потоке).
  const bMat = buildingMaterial(u);
  const bMesh = new THREE.Mesh(geometryFrom(w.buildings), bMat);
  bMesh.name = 'city-buildings';
  bMesh.castShadow = true;
  bMesh.receiveShadow = true;
  group.add(bMesh);
  // Огни ночи: ближние к взгляду — настоящим светом в шейдерах, все — огоньками, низкие — ещё и пятном на земле.
  const rig = new LampRig(lampsToWorld(lamps, null), LAMP_SPEC[q].real, u);
  group.add(rig.group);
  const mill = w.wheel ? new MillWheel(w.wheel, new THREE.Mesh(geometryFrom(w.wheel.mesh), bMat)) : null;
  if (mill) group.add(mill.group);

  // Земля.
  const mapTex = new MapTexture(map, spec.map);
  const landTex = new MapTexture(land, spec.land);
  const gg = groundGeometry(grid, wet);
  const gMesh = new THREE.Mesh(gg, groundMaterial(u, mapTex, MAP_AT, landTex, LAND_AT, spec.detail));
  gMesh.name = 'city-ground';
  gMesh.receiveShadow = true;
  group.add(gMesh);
  // Вода: река и мельничный ручей — одна лента до кромки; огни у воды отражаются в ней ночью. Берег — камыш и камни.
  const cap = SHORE_CAP[q];
  const water = buildWater(u, cap.cols, spec.detail, waterLights(lamps.map((l): V3 => [l.x, l.y, l.z])));
  group.add(water);
  const shoreGroup = buildShore(u, shore.reeds, [...shore.stones, ...shore.rocks], cap.reedBlades);
  group.add(shoreGroup);

  // Деревья: экземплярами по видам; ближние отбрасывают тень, дальние — нет.
  const fMat = foliageMaterial(u, spec.detail === 2);
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const treeCounts: Record<string, number> = {};
  let treeTris = 0;
  for (const sp of ['broad', 'broadFar', 'spruce', 'spruceFar', 'fruit'] as Species[]) {
    const list = trees[sp];
    treeCounts[sp] = list.length;
    if (list.length === 0) continue;
    const model = treeModel(sp, spec.detail);
    const im = new THREE.InstancedMesh(geometryOf(model), fMat, list.length);
    list.forEach((t, k) => {
      const wide = 0.9 + ((k * 7919) % 100) / 500;
      q4.setFromAxisAngle(up, t.rot);
      m4.compose(pos.set(t.x, t.y, t.z), q4, scl.set(t.h * wide, t.h, t.h * wide));
      im.setMatrixAt(k, m4);
      im.setColorAt(k, col.setRGB(t.t[0], t.t[1], t.t[2]));
    });
    im.instanceMatrix.needsUpdate = true;
    im.computeBoundingSphere();
    const far = sp === 'broadFar' || sp === 'spruceFar';
    im.castShadow = !far;
    im.receiveShadow = !far;
    im.name = `city-trees-${sp}`;
    group.add(im);
    treeTris += model.triangleCount * list.length;
  }
  const tMain = performance.now();

  const layers = await layersP;
  let tex = new LayerTexture(layers, progressive ? FIRST : spec.tex, LAYERS.length, spec.anisotropy);
  u.cityTex.value = tex;
  let gone = false;
  // Полные слои — следом, в том же потоке слоёв: подмена одной заливкой, город уже стоит.
  const full = progressive
    ? paintLayers(spec.tex).then((data) => {
        if (gone) return;
        const next = new LayerTexture(data, spec.tex, LAYERS.length, spec.anisotropy);
        u.cityTex.value = next;
        tex.dispose();
        tex = next;
      })
    : Promise.resolve();
  const tTex = performance.now();
  // Память — по полным слоям: мелкие живут, пока те не пришли.
  const fullBytes = spec.tex * spec.tex * 4 * LAYERS.length;
  const texBytes = Math.round(fullBytes * (4 / 3)) + Math.round(map.length * (4 / 3)) + Math.round(land.length * (4 / 3));
  return {
    group,
    uniforms: u,
    plan,
    counts: {
      reeds: shore.reeds.length,
      stones: shore.stones.length + shore.rocks.length,
      houses: plan.houses.length,
      suburb: plan.suburb.length,
      houseTris: marks.houses,
      fortTris: marks.forts - marks.houses,
      civicTris: marks.civic - marks.forts,
      outsideTris: marks.outside - marks.civic,
      lights: lamps.length,
      buildingTris: w.buildingTris,
      buildingVerts: w.buildings.pos.length / 3,
      groundTris: grid.index.length / 3,
      planMs: Math.round(w.ms.plan),
      buildMs: Math.round(w.ms.build),
      groundMs: Math.round(w.ms.ground),
      treeMs: Math.round(w.ms.trees),
      worldWaitMs: Math.round(tWorld - t0),
      mainMs: Math.round(tMain - tWorld),
      treeTris,
      ...treeCounts,
      texWaitMs: Math.round(tTex - tMain),
      totalMs: Math.round(tTex - t0),
    },
    textureBytes: texBytes,
    chimneys,
    flagTops,
    lamps,
    rig,
    sites,
    dispose(): void {
      const shoreMats = shoreGroup.children.map((c) => (c as THREE.Mesh).material as THREE.Material);
      for (const m of [bMat, fMat, gMesh.material as THREE.Material, water.material as THREE.Material, ...shoreMats]) m.dispose();
      rig.dispose();
      gone = true;
      mill?.dispose();
      tex.dispose();
      mapTex.dispose();
      landTex.dispose();
    },
    full,
    mill,
    share: { quality: q, plan, uniforms: u, map: mapTex, land: landTex },
  };
}
