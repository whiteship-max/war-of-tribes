// Луг и опушка ролика боя в виде `next` (docs/graphics_world.md, 11.5): трава, цветы и деревья окружения посёлка
// на земле клетки боя. Модели и материал — окружения (`env/models`, `env/materials`): своих растений у ролика нет, и
// стиль у посёлка и боя один. Земля, её приметы и строй — прежние: трава и цветы ложатся на сухой луг
// (`ground.meadowAt`), деревья — на места прежней опушки (`ground.woodsSpots`).
//
// Всё раскладывается от сида записи боя (`Ground.seed`): тот же журнал — тот же луг до травинки. Ветер идёт от
// времени ролика, а не от часов: повтор качает траву так же.
//
// Цена — вызов на траву, вызов на цветы и по два на породу деревьев (сам меш и его тень).
import * as THREE from 'three';
import type { Ground } from '@/battle/replay';
import { envShared, vegMaterial, type EnvShared } from './veg';
import { flowerModel, treeModel, tuftModel } from './flora';
import { PALETTE, seasonColor, type PaletteKey } from '../palette';
import { hash, meadowAt, woodsSpots, groundHeight } from './ground';

/** Сколько травы и цветов и докуда: луг под строем и вокруг него, до дымки. */
export const MEADOW = { tufts: 3000, flowers: 300, radius: 46 };

/**
 * Породы опушки: высокое место прежней опушки — ель, низкое — дуб. Две породы, а не четыре, как у посёлка: у
 * ролика на опушку — четыре вызова (два меша и их тени), а не восемь.
 */
export const WOODS_SPECIES = { tall: 'spruce', low: 'oak' } as const;

/** Во сколько раз дерево окружения крупнее своей модели: прежний конус был 2.5–3.4 м, модель — около двух. */
const TREE_SCALE = 1.35;

/** Дальность травы: за ней пучки гаснут (`ENV_FADE`), как у посёлка за его дальностью. */
const GRASS_FAR = 64;

/** Цвета цветов — те же виды, что на лугу посёлка. */
const FLOWER_KEYS: readonly PaletteKey[] = ['flowerWhite', 'flowerYellow', 'flowerBlue', 'flowerPink', 'flowerRed'];

/** Что построил луг: группа на сцену, ход времени и одна судьба у геометрий и материалов. */
export interface MeadowView {
  group: THREE.Group;
  /** Свои числа кадра окружения (время, ветер, дальность, снег) — общие с посёлком они не бывают. */
  readonly shared: EnvShared;
  /** Время ролика: по нему качаются трава и кроны. */
  update(t: number): void;
  dispose(): void;
}

const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const V = new THREE.Vector3();
const S = new THREE.Vector3();
const C = new THREE.Color();

/** Меш экземпляров с цветом экземпляра: его читает материал окружения (оттенок, лепесток). */
function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count) * 3).fill(1), 3);
  mesh.count = count;
  mesh.name = name;
  // Экземпляры разбросаны по всему полю: коробка одной модели у нуля отсекала бы их неверно.
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return mesh;
}

function place(mesh: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rot: number, scale: number): void {
  E.set(0, rot, 0);
  M.compose(V.set(x, y, z), Q.setFromEuler(E), S.set(scale, scale, scale));
  mesh.setMatrixAt(i, M);
}

/**
 * Точки сухого луга от сида: равномерно по кругу `MEADOW.radius`, мимо воды и тракта. Попыток втрое больше
 * нужного: у реки и тракта часть отпадает, а сколько — решает клетка.
 */
function meadowSpots(g: Ground, salt: number, want: number): { x: number; z: number; r1: number; r2: number }[] {
  const out: { x: number; z: number; r1: number; r2: number }[] = [];
  const R = MEADOW.radius;
  for (let i = 0; i < want * 3 && out.length < want; i++) {
    const k = g.seed + salt + i * 7;
    const x = (hash(k + 1) * 2 - 1) * R;
    const z = (hash(k + 2) * 2 - 1) * R;
    if (Math.hypot(x, z) > R || !meadowAt(g, x, z)) continue;
    out.push({ x, z, r1: hash(k + 3), r2: hash(k + 4) });
  }
  return out;
}

/**
 * Луг и опушка клетки боя. Зимой травы и цветов нет — земля под снегом, — а деревья стоят в снегу
 * (`EnvShared.snow`), как у посёлка.
 */
export function buildMeadow(g: Ground): MeadowView {
  const group = new THREE.Group();
  group.name = 'meadow';
  const shared = envShared();
  shared.far.value = GRASS_FAR;
  shared.snow.value = g.winter ? 1 : 0;
  shared.snowColor.value.setHex(PALETTE.snow);
  const color = (key: PaletteKey): THREE.Color => new THREE.Color(g.winter ? seasonColor('winter', key) : PALETTE[key]);
  const meshes: THREE.InstancedMesh[] = [];

  if (!g.winter) {
    const tufts = meadowSpots(g, 101, MEADOW.tufts);
    const grassMat = vegMaterial('grass', { a: color('meadow'), b: color('grassTip'), sway: 1, twoSided: true, fade: true }, shared);
    const grass = instanced(tuftModel(false), grassMat, tufts.length, 'meadow-grass');
    tufts.forEach((p, i) => {
      place(grass, i, p.x, groundHeight(g, p.x, p.z), p.z, p.r1 * Math.PI * 2, 0.8 + p.r2 * 0.5);
      const hue = 0.86 + p.r2 * 0.28;
      grass.setColorAt(i, C.setRGB(hue, hue, 0.95 + (hue - 1) * 0.3));
    });
    meshes.push(grass);

    const blooms = meadowSpots(g, 211, MEADOW.flowers);
    const flowerMat = vegMaterial('flower', { a: color('meadow'), b: color('grassTip'), sway: 0.9, twoSided: true, fade: true, petal: true }, shared);
    const flowers = instanced(flowerModel(), flowerMat, blooms.length, 'meadow-flowers');
    blooms.forEach((p, i) => {
      place(flowers, i, p.x, groundHeight(g, p.x, p.z), p.z, p.r1 * Math.PI * 2, 0.9 + p.r2 * 0.3);
      flowers.setColorAt(i, C.setHex(PALETTE[FLOWER_KEYS[Math.floor(p.r1 * FLOWER_KEYS.length) % FLOWER_KEYS.length]]));
    });
    meshes.push(flowers);
  }

  // Опушка: те же места, что у прежней, — ель на высоком, дуб на низком. Тень отбрасывают все: коробка теней
  // накрывает ближние, а дальние за ней ничего не стоят.
  const spots = woodsSpots(g);
  for (const [kind, species] of Object.entries(WOODS_SPECIES) as ['tall' | 'low', 'spruce' | 'oak'][]) {
    const list = spots.filter((t) => t.tall === (kind === 'tall'));
    if (list.length === 0) continue;
    const mat = vegMaterial(
      `tree-${species}`,
      { a: color('trunk'), b: color(species), sway: species === 'spruce' ? 0.9 : 0.7, flat: true, snowy: true },
      shared,
    );
    const trees = instanced(treeModel(species), mat, list.length, `meadow-${species}`);
    trees.castShadow = true;
    list.forEach((t, i) => {
      place(trees, i, t.x, t.y, t.z, hash(Math.round(t.x * 31 + t.z * 17)) * Math.PI * 2, t.scale * TREE_SCALE);
      const hue = 0.9 + hash(Math.round(t.x * 13 - t.z * 7)) * 0.2;
      trees.setColorAt(i, C.setRGB(hue, 0.96 + (hue - 1) * 0.5, 1));
    });
    meshes.push(trees);
  }

  for (const m of meshes) group.add(m);
  return {
    group,
    shared,
    update(t: number): void {
      shared.time.value = t;
      // Ветер порывами, как у посёлка: два медленных синуса, никогда не ноль.
      shared.wind.value = 0.05 * (0.75 + 0.25 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1));
    },
    dispose(): void {
      for (const m of meshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        m.dispose();
      }
      group.clear();
    },
  };
}
