// Сборка вида «город» (docs/city.md, разделы 7 и 11.5): слои текстур и мир (план, модели, карты,
// расстановка) — в двух потоках; здесь — только буферы, текстуры и материалы. Ленивый кусок: грузят
// его стенд (`?showcase=city`) и сцена игры при `?look=city`. Возвращает группу и ручки (ночь, снег,
// осень) — кадр сцена рисует сама.
import * as THREE from 'three';
import type { Builder, V3 } from './geom';
import type { CityPlan } from './layout';
import { arraysOf, buildWorld, type CityWorld, type MeshArrays } from './world';
import { LAYERS, paintLayer, TEX_SEED } from './tex';
import { buildingMaterial, cityUniforms, CITY_LIGHTS, foliageMaterial, groundMaterial, LayerTexture, MapTexture, type CityUniforms } from './material';
import { CITY } from './palette';
import { MAP_AT } from './ground';
import { LAND_AT, treeModel, type Species } from './nature';
import type { Quality } from '../quality';
import { CITY_SPEC } from './spec';
import type { Site } from './sites';
import { buildWater } from './water';
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
  /** Огни ночи: факелы стены и ворот, фонари площади. */
  lights: V3[];
  /** Коробки 24 построек игры (`sites.ts`). */
  sites: Site[];
  /** Отдать материалы и текстуры (геометрию отдаёт сцена обходом). */
  dispose(): void;
}

/** Огоньки факелов: точки с мягким пятном, видны ночью (прозрачность — доля ночи). */
function flames(lights: V3[]): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lights.flat()), 3));
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const x = c.getContext('2d');
  if (x) {
    const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,240,200,1)');
    grd.addColorStop(0.25, 'rgba(255,170,80,0.85)');
    grd.addColorStop(1, 'rgba(255,120,40,0)');
    x.fillStyle = grd;
    x.fillRect(0, 0, 64, 64);
  }
  const m = new THREE.PointsMaterial({
    size: 3.6,
    map: new THREE.CanvasTexture(c),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: CITY.torch,
    opacity: 0,
  });
  const p = new THREE.Points(g, m);
  p.name = 'city-flames';
  p.frustumCulled = false;
  return p;
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
  // Два потока разом: слои текстур и мир; кадр ждёт только заворачивания готового в буферы.
  const layersP = paintLayers(spec.tex);
  const w = await worldOf(q);
  const tWorld = performance.now();
  const { plan, lights, chimneys, flagTops, marks, sites, map, land, grid, trees } = w;
  const u = cityUniforms();
  const group = new THREE.Group();
  group.name = 'city';

  // Здания — один меш; та же дорога, что у счёта бюджета (`budget.buildStatic`, в потоке).
  // Огни ночи: ближние к середине города — в шейдер пятнами, все — огоньками.
  const center = { x: 0, z: -10 };
  const lit = [...lights].sort((a, c) => Math.hypot(a[0] - center.x, a[2] - center.z) - Math.hypot(c[0] - center.x, c[2] - center.z));
  lit.slice(0, CITY_LIGHTS).forEach((p, k) => u.cLights.value[k].set(p[0], p[1] - 0.8, p[2], 9.5 * 9.5));
  const bMat = buildingMaterial(u);
  const bMesh = new THREE.Mesh(geometryFrom(w.buildings), bMat);
  bMesh.name = 'city-buildings';
  bMesh.castShadow = true;
  bMesh.receiveShadow = true;
  group.add(bMesh);
  group.add(flames(lights));

  // Земля.
  const mapTex = new MapTexture(map, spec.map);
  const landTex = new MapTexture(land, spec.land);
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(grid.positions, 3));
  gg.setAttribute('normal', new THREE.BufferAttribute(grid.normals, 3));
  const nv = grid.positions.length / 3;
  gg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3).fill(1), 3));
  gg.setAttribute('cuv', new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
  gg.setAttribute('cfg', new THREE.BufferAttribute(new Uint8Array(nv * 4), 4));
  gg.setIndex(new THREE.BufferAttribute(grid.index, 1));
  gg.computeBoundingSphere();
  const gMesh = new THREE.Mesh(gg, groundMaterial(u, mapTex, MAP_AT, landTex, LAND_AT));
  gMesh.name = 'city-ground';
  gMesh.receiveShadow = true;
  group.add(gMesh);
  // Вода: река и мельничный ручей — одна лента.
  const water = buildWater(u);
  group.add(water);

  // Деревья: экземплярами по видам; ближние отбрасывают тень, дальние — нет.
  const fMat = foliageMaterial(u);
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
  const tex = new LayerTexture(layers, spec.tex, LAYERS.length, spec.anisotropy);
  u.cityTex.value = tex;
  const tTex = performance.now();
  const texBytes = Math.round(layers.length * (4 / 3)) + Math.round(map.length * (4 / 3)) + Math.round(land.length * (4 / 3));
  return {
    group,
    uniforms: u,
    plan,
    counts: {
      houses: plan.houses.length,
      suburb: plan.suburb.length,
      houseTris: marks.houses,
      fortTris: marks.forts - marks.houses,
      civicTris: marks.civic - marks.forts,
      outsideTris: marks.outside - marks.civic,
      lights: lights.length,
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
    lights,
    sites,
    dispose(): void {
      for (const m of [bMat, fMat, gMesh.material as THREE.Material, water.material as THREE.Material, (group.getObjectByName('city-flames') as THREE.Points).material as THREE.PointsMaterial]) {
        const map = (m as THREE.PointsMaterial).map;
        map?.dispose();
        m.dispose();
      }
      tex.dispose();
      mapTex.dispose();
      landTex.dispose();
    },
  };
}
