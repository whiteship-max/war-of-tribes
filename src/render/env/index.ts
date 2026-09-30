/**
 * Окружение посёлка пробы: земля, трава, лес, мелочь, пятна тени — одним куском.
 *
 * ЕДЕТ СВОИМ КУСКОМ ПОСЛЕ ПЕРВОГО КАДРА. Сцена зовёт `import('./env')` только у вида
 * `next` (`lighting.Look`), и в первую загрузку игры этот модуль не входит — это держит
 * сборка (`vite.config.ts`, `LAZY_DOORS`). Текстур по сети у него нет вовсе: карты земли
 * и шум считаются на устройстве, по сети — ноль байт.
 *
 * ВЫЗОВОВ ОТРИСОВКИ — ПО ОДНОМУ НА ВИД, А НЕ НА ПРЕДМЕТ: каждый вид — один
 * `InstancedMesh` на все свои экземпляры. Деревьев по два меша на породу: ближняя
 * модель и дальняя; делит их глубина от камеры (`QualitySpec.treeNear`), и пересчёт
 * идёт, только когда камера сдвинулась. Теней от лампы окружение не отбрасывает (как и
 * прежний лес) — под деревьями и мелочью лежат пятна тени одним мешем.
 */
import * as THREE from 'three';
import { BLOB_SHADE, PALETTE, type PaletteKey } from '../palette';
import { QUALITY, type Quality } from '../quality';
import type { SeasonVisuals } from '../season';
import type { DayLight } from '../lighting';
import {
  CROWN,
  FLOWER_COLORS,
  MAP_HALF,
  PROP_KINDS,
  PROP_SPREAD,
  SPECIES,
  groundMap,
  layoutOf,
  scatterCrops,
  scatterFlowers,
  scatterGrass,
  scatterProps,
  scatterTrees,
  type EnvVillage,
  type GroundMap,
  type Layout,
  type PropKind,
  type Species,
  type Tree,
  type Tuft,
} from './rules';
import { blobModel, flowerModel, groundModel, propModel, tuftModel, treeModel } from './models';
import { envShared, groundMaterial, shadeMaterial, vegMaterial, type EnvShared, type ShadeUniforms } from './materials';

export type { EnvVillage } from './rules';

export interface EnvOptions {
  quality: Quality;
  /** Сезон сцены: цвета окружения — его живые цвета, доли покрова — его доли. */
  season: SeasonVisuals;
  /** Посёлок, если он уже пришёл: трава не заходит под дома и на дороги. */
  village: EnvVillage | null;
}

/** Что окружению нужно от кадра. */
export interface EnvFrame {
  t: number;
  camera: THREE.PerspectiveCamera;
  /** Положение лампы (солнца или луны) относительно середины посёлка. */
  sun: THREE.Vector3;
  light: DayLight;
  /** Дальность тумана: от неё — дальность травы и граница ближних деревьев. */
  fogFar: number;
}

/** Сколько чего стоит — стенду и тесту бюджета. */
export interface EnvCounts {
  trees: Record<Species, number>;
  props: Record<PropKind, number>;
  grass: number;
  crops: number;
  flowers: number;
  blobs: number;
  /** Сторона карты земли, текселей. */
  map: number;
  /** Сколько миллисекунд заняла сборка на этом устройстве: карта земли, расстановка, меши. */
  buildMs: number;
}

export interface EnvWorld {
  group: THREE.Group;
  update(f: EnvFrame): void;
  setVillage(v: EnvVillage): void;
  textureBytes(): number;
  counts(): EnvCounts;
  dispose(): void;
}

export type BuildEnv = (o: EnvOptions) => EnvWorld;

/** Кроны пород — ключи палитры, ствол каждой — свой. */
const CROWN_KEY: Record<Species, PaletteKey> = { spruce: 'spruce', pine: 'pine', oak: 'oak', birch: 'birch' };
const BARK_KEY: Record<Species, PaletteKey> = { spruce: 'trunk', pine: 'pineBark', oak: 'trunk', birch: 'birchBark' };
/** Качание макушки по породам: берёза гнётся сильнее всех, дуб — меньше всех. */
const SWAY: Record<Species, number> = { spruce: 0.9, pine: 1.1, oak: 0.7, birch: 1.5 };

/** Цвета цветов — по номеру вида (`rules.Flower.color`). */
const FLOWER_KEYS: PaletteKey[] = ['flowerWhite', 'flowerYellow', 'flowerBlue', 'flowerPink', 'flowerRed'];

/** Сторона плитки шума, текселей. Плитка бесшовная — ложится на землю повтором. */
const NOISE = 128;

// ---------- Текстуры с устройства ----------

/**
 * Карта из трёх каналов в текстуру. `ImageData` вместо холста нарочно: холст умножает
 * цвет на альфу, и каналы данных съехали бы; альфа здесь всегда полная и не читается.
 * Строка данных — ряд по z: `flipY` выключен, чтобы v = z карты, а не перевёрнутая.
 */
function mapTexture(size: number, r: Float32Array, g: Float32Array, b: Float32Array, tex?: THREE.Texture): THREE.Texture {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let k = 0; k < size * size; k++) {
    px[k * 4] = r[k] * 255;
    px[k * 4 + 1] = g[k] * 255;
    px[k * 4 + 2] = b[k] * 255;
    px[k * 4 + 3] = 255;
  }
  const img = new ImageData(px, size, size);
  const t = tex ?? new THREE.Texture();
  t.image = img;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
}

/**
 * Бесшовная плитка шума: три канала, у каждого свой масштаб и свои октавы. Шум
 * значений на решётке с периодом, делящим сторону, — края плитки совпадают.
 */
function noiseTexture(): THREE.Texture {
  const lattice = (period: number, salt: number) => {
    const v = new Float32Array(period * period);
    for (let i = 0; i < v.length; i++) {
      const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
      v[i] = x - Math.floor(x);
    }
    return (u: number, w: number): number => {
      const fx = u * period;
      const fz = w * period;
      const ix = Math.floor(fx);
      const iz = Math.floor(fz);
      const tx = fx - ix;
      const tz = fz - iz;
      const sx = tx * tx * (3 - 2 * tx);
      const sz = tz * tz * (3 - 2 * tz);
      const at = (a: number, b: number): number => v[(((b % period) + period) % period) * period + (((a % period) + period) % period)];
      const a0 = at(ix, iz) + (at(ix + 1, iz) - at(ix, iz)) * sx;
      const a1 = at(ix, iz + 1) + (at(ix + 1, iz + 1) - at(ix, iz + 1)) * sx;
      return a0 + (a1 - a0) * sz;
    };
  };
  const octaves = [lattice(4, 1), lattice(8, 2), lattice(16, 3), lattice(32, 4), lattice(64, 5)];
  const r = new Float32Array(NOISE * NOISE);
  const g = new Float32Array(NOISE * NOISE);
  const b = new Float32Array(NOISE * NOISE);
  for (let j = 0; j < NOISE; j++) {
    for (let i = 0; i < NOISE; i++) {
      const u = i / NOISE;
      const w = j / NOISE;
      const k = j * NOISE + i;
      // r — крупные пятна, g — средние, b — мелкая рябь.
      r[k] = octaves[0](u, w) * 0.6 + octaves[1](u, w) * 0.3 + octaves[2](u, w) * 0.1;
      g[k] = octaves[1](u + 0.31, w + 0.17) * 0.55 + octaves[2](u, w) * 0.3 + octaves[3](u, w) * 0.15;
      b[k] = octaves[3](u + 0.53, w + 0.11) * 0.6 + octaves[4](u, w) * 0.4;
    }
  }
  const t = mapTexture(NOISE, r, g, b);
  // 1000 — RepeatWrapping: числом, а не именем three (имя дописалось бы в первую загрузку).
  t.wrapS = 1000;
  t.wrapT = 1000;
  return t;
}

// ---------- Экземпляры ----------

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const V = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();

/** Матрица экземпляра: место, поворот вокруг вертикали, масштаб. */
function matrixOf(x: number, y: number, z: number, rot: number, scale: number, sy = scale): THREE.Matrix4 {
  E.set(0, rot, 0);
  Q.setFromEuler(E);
  return M.compose(V.set(x, y, z), Q, S.set(scale, sy, scale));
}

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, capacity: number, name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, capacity));
  mesh.name = name;
  mesh.count = 0;
  // Экземпляры разбросаны по всему миру: коробка одной модели у нуля отсекала бы их
  // неверно, а мир целиком всё равно в кадре.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/** Заполнить меш списком: матрица и разброс цвета у каждого. */
function fill(mesh: THREE.InstancedMesh, items: readonly Tuft[], tint: (i: number) => THREE.Color, sy?: (t: Tuft) => number): void {
  const n = Math.min(items.length, mesh.instanceMatrix.count);
  for (let i = 0; i < n; i++) {
    const t = items[i];
    mesh.setMatrixAt(i, matrixOf(t.x, t.y, t.z, t.rot, t.scale, sy ? sy(t) : t.scale));
    mesh.setColorAt(i, tint(i));
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// ---------- Сборка ----------

export function buildEnv(o: EnvOptions): EnvWorld {
  const t0 = performance.now();
  const spec = QUALITY[o.quality];
  const season = o.season;
  const color = (key: PaletteKey): THREE.Color => season.color(key);
  const shared: EnvShared = envShared();
  const group = new THREE.Group();
  group.name = 'environment';

  let layout: Layout = layoutOf(o.village);
  let map: GroundMap = groundMap(layout, spec.groundMap);

  // Земля: прежняя полярная сетка с рельефом, новая краска.
  const texA = mapTexture(map.size, map.soil, map.litter, map.stone);
  const texB = mapTexture(map.size, map.field, map.lush, new Float32Array(map.size * map.size));
  const noise = noiseTexture();
  const ground = new THREE.Mesh(
    groundModel(),
    groundMaterial(
      { a: texA, b: texB, noise, scale: 1 / (2 * MAP_HALF), furrow: new THREE.Vector2(layout.furrow.x, layout.furrow.z) },
      {
        grassDark: color('swardDark'),
        grassLight: color('swardLight'),
        lush: color('meadow'),
        litter: color('litter'),
        dirt: color('dirt'),
        trample: color('trample'),
        soil: color('soil'),
        stone: color('rock'),
      },
      shared,
    ),
  );
  ground.name = 'ground';
  ground.receiveShadow = true;
  group.add(ground);

  const materials: THREE.Material[] = [ground.material as THREE.Material];
  const mat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };

  // Деревья: по породе ближний и дальний меш с общим материалом.
  const trees = scatterTrees(layout);
  const bySpecies = new Map<Species, Tree[]>(SPECIES.map((s) => [s, trees.filter((t) => t.species === s)]));
  interface Stand {
    list: Tree[];
    matrices: Float32Array;
    tints: Float32Array;
    near: THREE.InstancedMesh;
    far: THREE.InstancedMesh;
  }
  const stands: Stand[] = [];
  for (const species of SPECIES) {
    const list = bySpecies.get(species) ?? [];
    const m = mat(vegMaterial(`tree-${species}`, { a: color(BARK_KEY[species]), b: color(CROWN_KEY[species]), sway: SWAY[species], flat: true }, shared));
    const near = instanced(treeModel(species, 'near'), m, list.length, `trees-${species}`);
    const far = instanced(treeModel(species, 'far'), m, list.length, `trees-${species}-far`);
    const matrices = new Float32Array(list.length * 16);
    const tints = new Float32Array(list.length * 3);
    list.forEach((t, i) => {
      matrixOf(t.x, t.y, t.z, t.rot, t.scale).toArray(matrices, i * 16);
      C.setRGB(t.hue, 0.96 + (t.hue - 1) * 0.5, 1).toArray(tints, i * 3);
    });
    group.add(near, far);
    stands.push({ list, matrices, tints, near, far });
  }

  // Мелочь: меш на вид. Куст с ягодами и без — один материал: у простого нет вершин с
  // долей второго цвета ноль, а у ягодного так покрашены ягоды.
  const props = scatterProps(layout, spec.props);
  const bushMat = mat(vegMaterial('bush', { a: color('berry'), b: color('bush'), sway: 0.5, flat: true }, shared));
  // Пень и бревно — одно дерево: кора и светлый срез.
  const woodMat = mat(vegMaterial('wood', { a: color('trunk'), b: color('cut'), sway: 0, flat: true }, shared));
  const propMat: Record<PropKind, THREE.Material> = {
    bush: bushMat,
    berry: bushMat,
    fern: mat(vegMaterial('fern', { a: color('swardDark'), b: color('fern'), sway: 0.8, twoSided: true }, shared)),
    rock: mat(vegMaterial('rock', { a: color('rock'), b: color('moss'), sway: 0, flat: true }, shared)),
    stump: woodMat,
    log: woodMat,
  };
  const propCount = {} as Record<PropKind, number>;
  for (const kind of PROP_KINDS) {
    const list = props.filter((p) => p.kind === kind);
    propCount[kind] = list.length;
    const mesh = instanced(propModel(kind), propMat[kind], list.length, `props-${kind}`);
    // Камни мельче по высоте, чем в плане: плоские валуны сидят в земле, а не висят шаром.
    fill(mesh, list, (i) => C.setScalar(list[i].hue), (p) => (kind === 'rock' ? p.scale * 0.85 : p.scale));
    group.add(mesh);
  }

  // Покров: трава, всходы, цветы — угасают вдаль и уходят по сезону.
  const sward = { value: season.sward };
  const bloom = { value: season.bloom };
  // Основание пучка — цвета луга под ним, кончик — светлее и желтее: трава читается
  // светлыми штрихами на земле, а не тёмными галочками.
  const grassMat = mat(vegMaterial('grass', { a: color('meadow'), b: color('grassTip'), sway: 1, twoSided: true, fade: true, show: sward }, shared));
  const grass = instanced(tuftModel(false), grassMat, spec.grass, 'grass');
  grass.receiveShadow = true;
  const cropMat = mat(vegMaterial('crop', { a: color('meadow'), b: color('crop'), sway: 1.2, twoSided: true, fade: true }, shared));
  const crops = instanced(tuftModel(true), cropMat, 400, 'crops');
  const flowerMat = mat(vegMaterial('flower', { a: color('meadow'), b: color('grassTip'), sway: 0.9, twoSided: true, fade: true, petal: true, show: bloom }, shared));
  const flowers = instanced(flowerModel(), flowerMat, spec.flowers, 'flowers');
  flowers.receiveShadow = true;
  group.add(grass, crops, flowers);
  const petal = FLOWER_KEYS.map((k) => new THREE.Color().setHex(PALETTE[k]));
  let tuftCount = 0;
  let flowerCount = 0;
  let cropCount = 0;
  const cover = (): void => {
    const tufts = scatterGrass(layout, map, spec.grass);
    fill(grass, tufts, (i) => C.setRGB(tufts[i].hue, tufts[i].hue, 0.95 + (tufts[i].hue - 1) * 0.3));
    tuftCount = tufts.length;
    const fl = scatterFlowers(layout, map, spec.flowers);
    fill(flowers, fl, (i) => C.copy(petal[fl[i].color % FLOWER_COLORS]));
    flowerCount = fl.length;
    const cr = scatterCrops(layout, spec.grass > 0 ? 1 : 0.5);
    fill(crops, cr, (i) => C.setScalar(cr[i].hue));
    cropCount = cr.length;
  };
  cover();

  // Пятна тени: под каждым деревом и под всем, что выше щиколотки.
  const shadeU: ShadeUniforms = {
    away: { value: new THREE.Vector2(1, 0) },
    stretch: { value: 1 },
    shift: { value: 0 },
    dark: { value: 1 },
  };
  const casters: { x: number; y: number; z: number; r: number }[] = [];
  // Дальний лес без пятен: его и так съедает дымка.
  for (const t of trees) if (!t.far) casters.push({ x: t.x, y: t.y, z: t.z, r: CROWN[t.species] * t.scale * 0.9 });
  for (const p of props) if (p.kind !== 'fern') casters.push({ x: p.x, y: p.y, z: p.z, r: PROP_SPREAD[p.kind] * p.scale * (p.kind === 'log' ? 0.8 : 1) });
  const blobs = instanced(blobModel(), mat(shadeMaterial(new THREE.Color(...BLOB_SHADE), shadeU)), casters.length, 'blobs');
  blobs.renderOrder = 2;
  casters.forEach((c, i) => blobs.setMatrixAt(i, matrixOf(c.x, c.y, c.z, 0, c.r)));
  blobs.count = casters.length;
  blobs.instanceMatrix.needsUpdate = true;
  group.add(blobs);

  const textures = [texA, texB, noise];
  const buildMs = performance.now() - t0;

  // ---------- Кадр ----------

  const lastCam = new THREE.Vector3(Infinity, 0, 0);
  let lastFar = 0;
  /** Ближние и дальние деревья: делим по глубине от камеры, только если она сдвинулась. */
  const split = (camera: THREE.PerspectiveCamera, fogFar: number): void => {
    if (camera.position.distanceToSquared(lastCam) < 0.09 && Math.abs(fogFar - lastFar) < 0.5) return;
    lastCam.copy(camera.position);
    lastFar = fogFar;
    const edge = spec.treeNear * fogFar;
    const edge2 = edge * edge;
    for (const st of stands) {
      let n = 0;
      let f = 0;
      const near = st.near.instanceMatrix.array as Float32Array;
      const far = st.far.instanceMatrix.array as Float32Array;
      const nearTint = st.near.instanceColor;
      const farTint = st.far.instanceColor;
      for (let i = 0; i < st.list.length; i++) {
        const t = st.list[i];
        const dx = t.x - camera.position.x;
        const dy = t.y - camera.position.y;
        const dz = t.z - camera.position.z;
        const isNear = !t.far && dx * dx + dy * dy + dz * dz < edge2;
        const into = isNear ? near : far;
        const k = isNear ? n++ : f++;
        into.set(st.matrices.subarray(i * 16, i * 16 + 16), k * 16);
        C.fromArray(st.tints, i * 3);
        if (isNear) st.near.setColorAt(k, C);
        else st.far.setColorAt(k, C);
      }
      st.near.count = n;
      st.far.count = f;
      st.near.instanceMatrix.needsUpdate = true;
      st.far.instanceMatrix.needsUpdate = true;
      if (nearTint) nearTint.needsUpdate = true;
      if (farTint) farTint.needsUpdate = true;
    }
  };

  const away = new THREE.Vector2();
  const update = (f: EnvFrame): void => {
    shared.time.value = f.t;
    // Ветер порывами: два медленных синуса, никогда не ноль.
    shared.wind.value = spec.wind ? 0.05 * (0.75 + 0.25 * Math.sin(f.t * 0.37) * Math.sin(f.t * 0.13 + 1)) : 0;
    shared.far.value = f.fogFar * spec.grassFar;
    shared.night.value = 0.62 * f.light.nightK;
    sward.value = season.sward;
    bloom.value = season.bloom;
    split(f.camera, f.fogFar);

    // Пятна тени смотрят от лампы: чем ниже она, тем длиннее и дальше от основания.
    const horiz = Math.hypot(f.sun.x, f.sun.z);
    away.set(-f.sun.x, -f.sun.z).divideScalar(Math.max(1e-6, horiz));
    shadeU.away.value.copy(away);
    const cot = Math.min(2.4, horiz / Math.max(1e-3, f.sun.y));
    shadeU.stretch.value = 1 + 0.45 * cot;
    shadeU.shift.value = 0.35 * cot;
    // Под луной пятно слабее, в сумерках — почти никакого: лампа у горизонта тени не кладёт.
    shadeU.dark.value = (0.45 + 0.55 * f.light.daylight) * (1 - 0.6 * f.light.dusk * (1 - f.light.nightK));
  };

  const setVillage = (v: EnvVillage): void => {
    layout = layoutOf(v);
    map = groundMap(layout, spec.groundMap);
    mapTexture(map.size, map.soil, map.litter, map.stone, texA);
    mapTexture(map.size, map.field, map.lush, new Float32Array(map.size * map.size), texB);
    cover();
  };

  const trCount = {} as Record<Species, number>;
  for (const s of SPECIES) trCount[s] = bySpecies.get(s)?.length ?? 0;

  return {
    group,
    update,
    setVillage,
    // Три карты по четыре байта на тексель и треть сверху на мипы.
    textureBytes: () => textures.reduce((n, t) => n + (t.image as ImageData).width * (t.image as ImageData).height * 4 * (4 / 3), 0),
    counts: () => ({ trees: trCount, props: propCount, grass: tuftCount, crops: cropCount, flowers: flowerCount, blobs: casters.length, map: map.size, buildMs }),
    dispose: () => {
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
    },
  };
}

