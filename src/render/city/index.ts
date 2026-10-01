// Сборка вида «город» (docs/city.md, раздел 7): слои текстур в потоке, план, модели в один меш,
// земля с картой покрытий. Ленивый кусок: грузит его стенд (`?showcase=city`), позже — сцена при
// `look=city`. Возвращает группу и ручки (ночь, снег, осень) — кадр сцена рисует сама.
import * as THREE from 'three';
import { Builder } from './geom';
import { cityPlan, type CityPlan } from './layout';
import { house, type Detail } from './kit';
import { cityWall, tower } from './forts';
import { churchyard, civic, fireBowl, stall, statue, well } from './civic';
import { LAYERS, paintLayer, TEX_SEED } from './tex';
import { buildingMaterial, cityUniforms, groundMaterial, LayerTexture, MapTexture, type CityUniforms } from './material';
import { groundGrid, groundMap, MAP_AT } from './ground';
import type { Quality } from '../quality';

/** Что город берёт с уровня качества. */
export interface CitySpec {
  /** Сторона слоя текстуры. */
  tex: number;
  /** Сторона карты покрытий. */
  map: number;
  /** Ячеек сетки земли по стороне и шаг в середине. */
  groundCells: number;
  groundCell: number;
  detail: Detail;
  anisotropy: number;
  shadowMap: number;
}

export const CITY_SPEC: Record<Quality, CitySpec> = {
  high: { tex: 512, map: 1024, groundCells: 220, groundCell: 2.2, detail: 2, anisotropy: 4, shadowMap: 2048 },
  medium: { tex: 512, map: 1024, groundCells: 180, groundCell: 2.6, detail: 1, anisotropy: 2, shadowMap: 2048 },
  low: { tex: 256, map: 512, groundCells: 120, groundCell: 3.6, detail: 0, anisotropy: 1, shadowMap: 1024 },
};

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
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b.pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(b.nor), 3));
  g.setAttribute('cuv', new THREE.BufferAttribute(new Float32Array(b.uv), 2));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.col), 3));
  g.setAttribute('cfg', new THREE.BufferAttribute(new Uint8Array(b.cfg), 4));
  g.setIndex(new THREE.BufferAttribute(b.vertexCount > 65535 ? new Uint32Array(b.idx) : new Uint16Array(b.idx), 1));
  g.computeBoundingSphere();
  return new THREE.Mesh(g, mat);
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
  chimneys: [number, number, number][];
  /** Огни ночи: факелы стены и ворот, фонари площади. */
  lights: [number, number, number][];
}

export async function buildCity(q: Quality): Promise<CityBuild> {
  const spec = CITY_SPEC[q];
  const t0 = performance.now();
  const layersP = paintLayers(spec.tex);
  const plan = cityPlan();
  const tPlan = performance.now();
  const u = cityUniforms();
  const group = new THREE.Group();
  group.name = 'city';

  // Здания — один меш.
  const b = new Builder();
  const chimneys: [number, number, number][] = [];
  const lights: [number, number, number][] = [];
  for (const h of plan.houses) chimneys.push(...house(b, h, spec.detail).chimneys);
  const tHouses = b.mark();
  // Стена города: крытый ход — на южной и западной сторонах через пролёт.
  cityWall(b, plan.wall, { x: 0, z: 0 }, plan.towers, spec.detail, (s, p) => (p.z > 100 || p.x < -40) && Math.floor(s / 70) % 2 === 0);
  cityWall(b, plan.castleWall, { x: -4, z: -150 }, plan.towers, spec.detail, () => false);
  for (const t of plan.towers) lights.push(...tower(b, t, spec.detail));
  const tForts = b.mark();
  for (const c of plan.civic) {
    const r = civic(b, c, spec.detail);
    chimneys.push(...r.chimneys);
    lights.push(...r.lights);
    if (c.kind === 'church') churchyard(b, c);
  }
  for (const s of plan.stalls) stall(b, s, spec.detail);
  well(b, plan.well, spec.detail);
  lights.push(fireBowl(b, { x: plan.well.x + 3.2, z: plan.well.z + 1.5 }));
  statue(b, plan.statue, 0);
  const tCivic = b.mark();
  const bMat = buildingMaterial(u);
  const bMesh = meshOf(b, bMat);
  bMesh.name = 'city-buildings';
  bMesh.castShadow = true;
  bMesh.receiveShadow = true;
  group.add(bMesh);
  const tBuild = performance.now();

  // Земля.
  const map = groundMap(plan, spec.map);
  const mapTex = new MapTexture(map, spec.map);
  const grid = groundGrid(spec.groundCells, spec.groundCell, { x: 0, z: -20 }, 1400);
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(grid.positions, 3));
  gg.setAttribute('normal', new THREE.BufferAttribute(grid.normals, 3));
  const nv = grid.positions.length / 3;
  gg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nv * 3).fill(1), 3));
  gg.setAttribute('cuv', new THREE.BufferAttribute(new Float32Array(nv * 2), 2));
  gg.setAttribute('cfg', new THREE.BufferAttribute(new Uint8Array(nv * 4), 4));
  gg.setIndex(new THREE.BufferAttribute(grid.index, 1));
  gg.computeBoundingSphere();
  const gMesh = new THREE.Mesh(gg, groundMaterial(u, mapTex, MAP_AT));
  gMesh.name = 'city-ground';
  gMesh.receiveShadow = true;
  group.add(gMesh);
  const tGround = performance.now();

  const layers = await layersP;
  const tex = new LayerTexture(layers, spec.tex, LAYERS.length, spec.anisotropy);
  u.cityTex.value = tex;
  const tTex = performance.now();
  const texBytes = Math.round(layers.length * (4 / 3)) + Math.round(map.length * (4 / 3));
  return {
    group,
    uniforms: u,
    plan,
    counts: {
      houses: plan.houses.length,
      houseTris: tHouses.t,
      fortTris: tForts.t - tHouses.t,
      civicTris: tCivic.t - tForts.t,
      lights: lights.length,
      buildingTris: b.triangleCount,
      buildingVerts: b.vertexCount,
      groundTris: grid.index.length / 3,
      planMs: Math.round(tPlan - t0),
      buildMs: Math.round(tBuild - tPlan),
      groundMs: Math.round(tGround - tBuild),
      texWaitMs: Math.round(tTex - tGround),
      totalMs: Math.round(tTex - t0),
    },
    textureBytes: texBytes,
    chimneys,
    lights,
  };
}
