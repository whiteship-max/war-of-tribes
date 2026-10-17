// Город в ролике — сборка three (docs/polish.md, П-6): меши из потока (`town.worker.ts`) с материалами окна города. Земля,
// карты покрытий и слои текстур — у города игры (`CityShare`: одни на оба вида — ни памяти сверх, ни второй сборки) или
// свои (стенд, ролик без сцены). Город стоит в своих метрах внутри группы с переходом в ролик (`tw/town.ts`), а шейдер
// считает места в метрах города (`CityUniforms.cFrame`) — пятна, окна, факелы и карта покрытий те же, что в окне города.
import * as THREE from 'three';
import type { Quality } from '../quality';
import type { Builder } from './geom';
import { arraysOf } from './world';
import { geometryFrom, geometryOf, groundGeometry, paintLayers, type CityShare } from './index';
import { buildingMaterial, cityUniforms, foliageMaterial, groundMaterial, LayerTexture, MapTexture, type CityUniforms } from './material';
import { MAP_AT } from './ground';
import { LAND_AT, treeModel, type Species } from './nature';
import { CITY_SPEC, SHORE_CAP } from './spec';
import { LAYERS } from './tex';
import { buildWater } from './water';
import { waterLights } from './banks';
import { TOWN_LOD, townFocus, townWorld, type TownInput, type TownWorld } from './town';
import { CITY_M } from '../tw/site';
import { TOWN_H0, toReel, type Box2, type TownCut, type TownFrame, type TownHouse } from '../tw/town';
import { glowUniforms, lampsToWorld, type GlowUniforms, type WorldLamp } from '../glow/rig';
import type { V3 } from './geom';

export interface TownBackdrop {
  /** Город в единицах ролика: ставится в сцену ролика как есть. */
  group: THREE.Group;
  /** Дома у ворот, что остались под бой (метры города): ролику — под огонь и дым. */
  houses: TownHouse[];
  /** Где были убранные дома (метры города): их места закрывает земля ролика. */
  cleared: Box2[];
  /** Дорога от ворот в долину (метры города). */
  road: { x: number; z: number }[];
  /** Камень и дерево места ролика — тем же материалом, что город (стена спереди не беднее стен по кругу). */
  skin: { material: THREE.Material; geometry: (b: Builder) => THREE.BufferGeometry };
  /**
   * Огни города в мире ролика (docs/polish.md, П-9) и униформы, по которым их свет ложится на камень города: сцена ролика
   * зажигает их вместе с кострами своего лагеря одной сборкой (`glow/rig.LampRig`).
   */
  lamps: WorldLamp[];
  glow: GlowUniforms;
  /** Свет кадра ролика: доля ночи, снег, направление на солнце, цвет неба. */
  light(night: number, sunDir: THREE.Vector3, sky: THREE.Color): void;
  /** Треугольники кадра (без тени) и байты своих текстур — сверке бюджета. */
  triangles: number;
  textureBytes: number;
  dispose(): void;
}

/** На столько (м) земля города в ролике ниже рельефа: плита ролика — сверху. */
const GROUND_SINK = 0.18;

/** Мир города под ролик — в потоке; нет потока — здесь же. */
function townWorldOf(input: TownInput): Promise<TownWorld> {
  try {
    const w = new Worker(new URL('./town.worker.ts', import.meta.url), { type: 'module' });
    return new Promise<TownWorld>((resolve, reject) => {
      w.onmessage = (e: MessageEvent<TownWorld>): void => {
        resolve(e.data);
        w.terminate();
      };
      w.onerror = (e): void => {
        w.terminate();
        reject(e);
      };
      w.postMessage(input);
    }).catch(() => townWorld(input));
  } catch {
    return Promise.resolve(townWorld(input));
  }
}

/** Камень и дерево набора в единицах ролика (`tw/fort.ts` строит в метрах): положения — масштабом, всё прочее — как есть. */
function skinGeometry(b: Builder): THREE.BufferGeometry {
  const a = arraysOf(b);
  for (let i = 0; i < a.pos.length; i++) a.pos[i] *= CITY_M;
  return geometryFrom(a);
}

/**
 * Собрать город под ролик. `frame` — где он стоит у стены ролика, `cut` — что убрать под бой, `share` — город игры (нет —
 * свой). Ждёт поток сборки и, без города игры, слои текстур.
 */
export async function townBackdrop(frame: TownFrame, cut: TownCut, quality: Quality, share: CityShare | null, winter: boolean): Promise<TownBackdrop> {
  const spec = CITY_SPEC[quality];
  const own = !share;
  const layersP = own ? paintLayers(spec.tex) : null;
  const w = await townWorldOf({ quality, cut, ...(share ? { plan: share.plan } : {}), ground: own });
  const disposables: { dispose(): void }[] = [];

  const glow = glowUniforms();
  const u: CityUniforms = cityUniforms(glow);
  let layers: THREE.Texture;
  let map: THREE.Texture;
  let land: THREE.Texture;
  let textureBytes = 0;
  if (share) {
    layers = share.uniforms.cityTex.value as THREE.Texture;
    map = share.map;
    land = share.land;
  } else {
    const g = w.ground!;
    const data = await layersP!;
    layers = new LayerTexture(data, spec.tex, LAYERS.length, spec.anisotropy);
    map = new MapTexture(g.map, spec.map);
    land = new MapTexture(g.land, spec.land);
    disposables.push(layers, map, land);
    textureBytes = Math.round(spec.tex * spec.tex * 4 * LAYERS.length * (4 / 3) + (spec.map * spec.map + spec.land * spec.land) * 4 * (4 / 3));
  }
  // Сетка земли — своя (густая у ворот): сетка города игры — на весь мыс, ролику она дорога.
  const ground = groundGeometry(w.grid, w.wet);
  disposables.push(ground);
  u.cityTex.value = layers;
  if (winter) {
    u.cSnow.value = 1;
    u.cWinter.value = 1;
  }

  // Переход город → ролик: поворот на полоборота (город за стеной у +Z ролика) или без него, масштаб, сдвиг к воротам.
  const group = new THREE.Group();
  group.name = 'town';
  const inner = new THREE.Group();
  inner.name = 'town-city';
  const o = toReel(frame, 0, 0);
  inner.position.set(o.x, -TOWN_H0 * CITY_M, o.z);
  inner.rotation.y = frame.s > 0 ? Math.PI : 0;
  inner.scale.setScalar(CITY_M);
  inner.updateMatrix();
  group.add(inner);
  u.cFrame.value.copy(inner.matrix).invert();

  const focus = townFocus(cut);
  // Огни ночи — в мир ролика: светит их сцена ролика (`LampRig`), камень города берёт свет по общим униформам.
  inner.updateMatrixWorld(true);
  const lamps = lampsToWorld(w.lamps, inner.matrixWorld, CITY_M);

  const bMat = buildingMaterial(u);
  const gMat = groundMaterial(u, map, MAP_AT, land, LAND_AT);
  const fMat = foliageMaterial(u, spec.detail === 2);
  disposables.push(bMat, gMat, fMat);
  let triangles = 0;

  // Здания — одни вершины, два списка треугольников: у ролика — с тенью, дальше — без (`TOWN_LOD.shade`).
  const bGeo = geometryFrom(w.buildings);
  for (const [idx, near] of [
    [w.near, true],
    [w.far, false],
  ] as const) {
    if (idx.length === 0) continue;
    const g = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(bGeo.attributes)) g.setAttribute(name, attr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    disposables.push(g);
    const mesh = new THREE.Mesh(g, bMat);
    mesh.name = near ? 'town-buildings' : 'town-buildings-far';
    mesh.castShadow = near;
    mesh.receiveShadow = true;
    inner.add(mesh);
  }
  triangles += w.buildingTris;

  const gMesh = new THREE.Mesh(ground, gMat);
  gMesh.name = 'town-ground';
  gMesh.receiveShadow = true;
  // Земля города — под плитой ролика: рисуется после неё и отсекается глубиной. Сетка у неё реже плиты, и между узлами
  // она выходит выше рельефа — опущена на ладонь, чтобы плита (по рельефу точно) лежала сверху без полос.
  gMesh.renderOrder = 1;
  gMesh.position.y = -GROUND_SINK;
  inner.add(gMesh);
  triangles += (ground.index ? ground.index.count : 0) / 3;

  if (TOWN_LOD[quality].water) {
    // Река в ролике — даль за полем: лента в семь столбцов (как у «Низкого» окна города), рябь — уровня.
    const water = buildWater(u, SHORE_CAP.low.cols, spec.detail, waterLights(w.lamps.map((l): V3 => [l.x, l.y, l.z])));
    water.name = 'town-water';
    inner.add(water);
    disposables.push(water.geometry, water.material as THREE.Material);
  }

  // Деревья: тот же лес, что у окна города; ближние к ролику — моделями с тенью, дальние — проще и без тени.
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const col = new THREE.Color();
  const shadeR = TOWN_LOD[quality].treeShade;
  for (const sp of ['broad', 'broadFar', 'spruce', 'spruceFar', 'fruit'] as Species[]) {
    const all = w.trees[sp];
    if (all.length === 0) continue;
    const model = treeModel(sp, spec.detail, true);
    const geo = geometryOf(model);
    disposables.push(geo);
    const far = sp === 'broadFar' || sp === 'spruceFar';
    // Ближние модели — с тенью только у самого ролика (коробка теней — вокруг кадра); дальше — без.
    const near = far ? [] : all.filter((t) => Math.hypot(t.x - focus.x, t.z - focus.z) < shadeR);
    const rest = far ? all : all.filter((t) => Math.hypot(t.x - focus.x, t.z - focus.z) >= shadeR);
    for (const [list, shade] of [
      [near, true],
      [rest, false],
    ] as const) {
      if (list.length === 0) continue;
      const im = new THREE.InstancedMesh(geo, fMat, list.length);
      list.forEach((t, k) => {
        const wide = 0.9 + ((k * 7919) % 100) / 500;
        q4.setFromAxisAngle(up, t.rot);
        m4.compose(pos.set(t.x, t.y, t.z), q4, scl.set(t.h * wide, t.h, t.h * wide));
        im.setMatrixAt(k, m4);
        im.setColorAt(k, col.setRGB(t.t[0], t.t[1], t.t[2]));
      });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = shade;
      im.receiveShadow = !far;
      im.name = `town-trees-${sp}${shade ? '' : '-flat'}`;
      inner.add(im);
      disposables.push(im);
      triangles += model.triangleCount * list.length;
    }
  }

  return {
    group,
    houses: w.houses,
    cleared: w.cleared,
    road: w.road,
    skin: { material: bMat, geometry: skinGeometry },
    lamps,
    glow,
    light(night: number, sunDir: THREE.Vector3, sky: THREE.Color): void {
      u.cNight.value = night;
      u.cBlue.value = night;
      u.cSunDir.value.copy(sunDir);
      u.cSky.value.copy(sky);
    },
    triangles,
    textureBytes,
    dispose(): void {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}
