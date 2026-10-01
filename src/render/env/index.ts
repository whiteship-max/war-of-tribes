/**
 * Окружение посёлка пробы: земля, трава, лес, мелочь, пятна тени — одним куском.
 *
 * ЕДЕТ СВОИМ КУСКОМ ПОСЛЕ ПЕРВОГО КАДРА. Сцена зовёт `import('./env')` только у вида
 * `next` (`lighting.Look`), и в первую загрузку игры этот модуль не входит — это держит
 * сборка (`vite.config.ts`, `LAZY_DOORS`). Текстур по сети у него нет вовсе: карты земли
 * и шум считаются на устройстве, по сети — ноль байт.
 *
 * СОБИРАЕТСЯ ПО ЧАСТЯМ МЕЖДУ КАДРАМИ, А НЕ РАЗОМ. Разом сборка стоила 0.3–0.8 с на ПК
 * (docs/graphics_world.md, раздел 4) — на телефоне это секунды стоящей картинки. Теперь
 * `startEnv` только заводит работу, а ведёт её сцена кусками (`EnvWorld.work`) под
 * бюджет времени кадра (`quality.BUILD_SLICE_MS`): карта земли — по рядам, лес и
 * мелочь — по рядам решётки, экземпляры — пачками, программы шейдеров — по одной на
 * кусок. Пока идёт работа, в кадре стоит прежняя земля; мир встаёт целиком, когда
 * готов, — без выскакивающих по частям лесов. Смена построек пересчитывает карту и
 * покров так же, кусками, и подменяет их разом.
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
  CROPS_CAP,
  CROWN,
  FLOWER_COLORS,
  HAY_SPREAD,
  MAP_HALF,
  PROP_KINDS,
  PROP_SPREAD,
  SHEEP_SPREAD,
  SPECIES,
  groundMapJob,
  layoutOf,
  scatterCrops,
  scatterFlowersJob,
  scatterGrassJob,
  scatterPropsJob,
  scatterTreesJob,
  type Crop,
  type EnvVillage,
  type Flower,
  type GroundMap,
  type Job,
  type Layout,
  type Panel,
  type Prop,
  type PropKind,
  type Species,
  type Tree,
  type Tuft,
} from './rules';
import { blobModel, fenceModel, flowerModel, groundModelJob, hayModel, propModel, sheepModel, tuftModel, treeModel } from './models';
import { envShared, groundMaterial, shadeMaterial, vegMaterial, type EnvShared, type ShadeUniforms } from './materials';
import { makeLife, type Life } from './life';

export type { EnvVillage } from './rules';
// Фактура построек вида `next` (этап 2, пункт 2) едет тем же ленивым куском: сцена одевает здания, когда он пришёл.
export { FACADE_SNOW, dressFacade } from './facade';

export interface EnvOptions {
  quality: Quality;
  /** Сезон сцены: цвета окружения — его живые цвета, доли покрова — его доли. */
  season: SeasonVisuals;
  /** Посёлок, если он уже пришёл: трава не заходит под дома и на дороги. */
  village: EnvVillage | null;
  /**
   * Собрать программу шейдера меша заранее — по мешу на кусок работы. Без этого все
   * программы окружения собирались бы в первом кадре с ним, и рывок сборки вернулся бы
   * рывком сборки шейдеров. Сцена даёт `renderer.compile` со своим светом и туманом;
   * тест и стенд без сцены — ничего.
   */
  compile?: (o: THREE.Object3D) => void;
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

/** Цена сборки на этом устройстве — стенду (`npm run village:shots`). */
export interface EnvBuild {
  /** Миллисекунд работы всего (сумма кусков). */
  ms: number;
  /** Сколько кусков — сколько кадров шла работа. */
  slices: number;
  /** Самый долгий кусок, мс: столько сборка отняла у худшего кадра. */
  longest: number;
  /** Самый долгий шаг, мс, — неделимая часть работы, — и в какой части сборки он был. */
  step: number;
  stepIn: string;
}

/** Сколько чего стоит — стенду и тесту бюджета. */
export interface EnvCounts {
  trees: Record<Species, number>;
  props: Record<PropKind, number>;
  grass: number;
  crops: number;
  flowers: number;
  blobs: number;
  /** Угодья: стога, звенья изгороди, овцы. */
  hay: number;
  fences: number;
  sheep: number;
  /** Полосы пашни у ворот и огороды внутри стены (этап 2, пункт 1). */
  fields: number;
  gardens: number;
  /** Сторона карты земли, текселей. */
  map: number;
  /** Сколько миллисекунд заняла сборка на этом устройстве: карта земли, расстановка, меши. */
  buildMs: number;
  /** Та же сборка по кускам. */
  build: EnvBuild;
}

export interface EnvWorld {
  group: THREE.Group;
  /**
   * Вести работу — первую сборку или пересчёт под новые постройки — до `until`
   * (`performance.now()`), но не меньше одного шага. `true` — работы не осталось.
   */
  work(until: number): boolean;
  /** Первая сборка окончена: мир можно ставить в сцену. */
  built(): boolean;
  update(f: EnvFrame): void;
  setVillage(v: EnvVillage): void;
  textureBytes(): number;
  counts(): EnvCounts;
  dispose(): void;
}

export type StartEnv = (o: EnvOptions) => EnvWorld;

/** Кроны пород — ключи палитры, ствол каждой — свой. */
const CROWN_KEY: Record<Species, PaletteKey> = { spruce: 'spruce', pine: 'pine', oak: 'oak', birch: 'birch' };
const BARK_KEY: Record<Species, PaletteKey> = { spruce: 'trunk', pine: 'pineBark', oak: 'trunk', birch: 'birchBark' };
/** Качание макушки по породам: берёза гнётся сильнее всех, дуб — меньше всех. */
const SWAY: Record<Species, number> = { spruce: 0.9, pine: 1.1, oak: 0.7, birch: 1.5 };
/** Второй осенний цвет кроны: хвоя осенью не меняется. */
const TURN_KEY: Record<Species, PaletteKey | null> = { spruce: null, pine: null, oak: 'oakRust', birch: 'birchLate' };

/** Цвета цветов — по номеру вида (`rules.Flower.color`). */
const FLOWER_KEYS: PaletteKey[] = ['flowerWhite', 'flowerYellow', 'flowerBlue', 'flowerPink', 'flowerRed'];

/** Сторона плитки шума, текселей. Плитка бесшовная — ложится на землю повтором. */
const NOISE = 128;

/**
 * Сколько экземпляров заполнять за шаг работы. Матрица экземпляра — около микросекунды
 * на ПК и нескольких на телефоне: тысяча — миллисекунды, кусок короче кадра.
 */
const FILL_STEP = 1000;

/** Сколько рядов карты перекладывать в пиксели за шаг: 64 ряда по 512 — 32 тысячи текселей. */
const PIXEL_ROWS = 64;

// ---------- Текстуры с устройства ----------

/**
 * Карта из трёх каналов в пиксели. `ImageData` вместо холста нарочно: холст умножает
 * цвет на альфу, и каналы данных съехали бы; альфа здесь всегда полная и не читается.
 * `b` — `null`: третий канал пуст.
 */
function* pixelsJob(size: number, r: Float32Array, g: Float32Array, b: Float32Array | null): Job<ImageData> {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let j0 = 0; j0 < size; j0 += PIXEL_ROWS) {
    const end = Math.min(size, j0 + PIXEL_ROWS) * size;
    for (let k = j0 * size; k < end; k++) {
      px[k * 4] = r[k] * 255;
      px[k * 4 + 1] = g[k] * 255;
      px[k * 4 + 2] = b ? b[k] * 255 : 0;
      px[k * 4 + 3] = 255;
    }
    yield;
  }
  return new ImageData(px, size, size);
}

/** Пиксели в текстуру. Строка данных — ряд по z: `flipY` выключен, чтобы v = z карты, а не перевёрнутая. */
function toTexture(img: ImageData, tex?: THREE.Texture): THREE.Texture {
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
function* noiseJob(): Job<THREE.Texture> {
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
    if ((j & 31) === 31) yield;
  }
  const t = toTexture(yield* pixelsJob(NOISE, r, g, b));
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

/**
 * Меш экземпляров. Цвет экземпляра заводится сразу, а не первым `setColorAt`: от него
 * зависит программа шейдера, и программа, собранная заранее без него, в кадре
 * собиралась бы второй раз — тем самым рывком.
 */
function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, capacity: number, name: string, tinted = true): THREE.InstancedMesh {
  const cap = Math.max(1, capacity);
  // Конструктор three ставит каждому месту единичную матрицу — у травы высокого уровня
  // это десять миллисекунд одним куском. Места заполнит `fillJob`: массив заводится пустым.
  const mesh = new THREE.InstancedMesh(geo, mat, 1);
  mesh.instanceMatrix = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
  mesh.name = name;
  mesh.count = 0;
  if (tinted) mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
  // Экземпляры разбросаны по всему миру: коробка одной модели у нуля отсекала бы их
  // неверно, а мир целиком всё равно в кадре.
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * Заполнить меш списком пачками: матрица и разброс цвета у каждого. Число экземпляров
 * и отметку «выгрузить» ставит возвращённая «подмена», а не сама раскладка: в видеокарте
 * до подмены лежит прежнее заполнение, и пересчёт под новые постройки подменяет траву,
 * цветы, всходы и карты земли одним шагом — не мигает полупустым лугом.
 */
function* fillJob(mesh: THREE.InstancedMesh, items: readonly Tuft[], tint: (i: number) => THREE.Color, sy?: (t: Tuft) => number): Job<() => void> {
  const n = Math.min(items.length, mesh.instanceMatrix.count);
  for (let i = 0; i < n; i++) {
    const t = items[i];
    mesh.setMatrixAt(i, matrixOf(t.x, t.y, t.z, t.rot, t.scale, sy ? sy(t) : t.scale));
    mesh.setColorAt(i, tint(i));
    if (i % FILL_STEP === FILL_STEP - 1) yield;
  }
  return (): void => {
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
}

/** Звенья изгороди: длина звена — масштаб по x, высота и толщина — прежние. */
function* fillPanels(mesh: THREE.InstancedMesh, items: readonly Panel[]): Job<void> {
  const n = Math.min(items.length, mesh.instanceMatrix.count);
  for (let i = 0; i < n; i++) {
    const p = items[i];
    E.set(0, p.rot, 0);
    Q.setFromEuler(E);
    mesh.setMatrixAt(i, M.compose(V.set(p.x, p.y, p.z), Q, S.set(p.length, 1, 1)));
    mesh.setColorAt(i, C.setScalar(0.92 + (i % 5) * 0.03));
    if (i % FILL_STEP === FILL_STEP - 1) yield;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// ---------- Сборка ----------

/** Собрать окружение разом — тесту и стенду без кадров. Сцена ведёт его кусками (`startEnv`). */
export function buildEnv(o: EnvOptions): EnvWorld {
  const w = startEnv(o);
  w.work(Infinity);
  return w;
}

/** Порода дерева и её меши. */
interface Stand {
  list: Tree[];
  matrices: Float32Array;
  tints: Float32Array;
  near: THREE.InstancedMesh;
  far: THREE.InstancedMesh;
  /** Какие деревья сейчас ближние — чтобы не перезаливать буферы, когда состав тот же. */
  isNear: Uint8Array;
}

/** Покров под раскладку: списки, ещё не разложенные по мешам. */
interface Cover {
  tufts: Tuft[];
  flowers: Flower[];
  crops: Crop[];
}

/**
 * Завести окружение. Возвращает сразу: мир пуст, пока сцена не проведёт работу
 * (`work`) до конца, — см. шапку модуля.
 */
export function startEnv(o: EnvOptions): EnvWorld {
  const spec = QUALITY[o.quality];
  const season = o.season;
  const color = (key: PaletteKey): THREE.Color => season.color(key);
  const compile = o.compile ?? ((): void => undefined);
  const shared: EnvShared = envShared();
  // Цвет снега — живой цвет сезона: зимой палитра его и держит.
  shared.snowColor.value = color('snow');
  const group = new THREE.Group();
  group.name = 'environment';

  const materials: THREE.Material[] = [];
  const mat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const textures: THREE.Texture[] = [];

  // Живое состояние мира — заполняет первая сборка.
  let layout: Layout = layoutOf(o.village);
  let map: GroundMap | null = null;
  let texA: THREE.Texture | null = null;
  let texB: THREE.Texture | null = null;
  const stands: Stand[] = [];
  const trCount = {} as Record<Species, number>;
  const propCount = {} as Record<PropKind, number>;
  let casters = 0;
  let grass: THREE.InstancedMesh | null = null;
  let flowers: THREE.InstancedMesh | null = null;
  let crops: THREE.InstancedMesh | null = null;
  let tuftCount = 0;
  let flowerCount = 0;
  let cropCount = 0;
  let done = false;

  const sward = { value: season.sward };
  const bloom = { value: season.bloom };
  const cropShow = { value: season.crop };
  let life: Life | null = null;
  let hayCount = 0;
  let fenceCount = 0;
  let sheepCount = 0;
  const petal = FLOWER_KEYS.map((k) => new THREE.Color().setHex(PALETTE[k]));
  const shadeU: ShadeUniforms = {
    away: { value: new THREE.Vector2(1, 0) },
    stretch: { value: 1 },
    shift: { value: 0 },
    dark: { value: 1 },
  };

  /** Покров под раскладку и карту: трава, цветы, всходы — только списки. */
  function* coverJob(l: Layout, m: GroundMap): Job<Cover> {
    yield 'трава: места';
    const tufts = yield* scatterGrassJob(l, m, spec.grass);
    yield 'цветы: места';
    const fl = yield* scatterFlowersJob(l, m, spec.flowers);
    yield 'всходы';
    const cr = scatterCrops(l, spec.grass > 0 ? 1 : 0.5);
    yield;
    return { tufts, flowers: fl, crops: cr };
  }

  /** Разложить покров по мешам; подменить в кадре — возвращённой подменой, одним шагом. */
  function* placeCover(c: Cover): Job<() => void> {
    const g = grass;
    const f = flowers;
    const k = crops;
    if (!g || !f || !k) return (): void => undefined;
    const { tufts, flowers: fl, crops: cr } = c;
    yield 'покров: раскладка';
    const commits = [
      yield* fillJob(g, tufts, (i) => C.setRGB(tufts[i].hue, tufts[i].hue, 0.95 + (tufts[i].hue - 1) * 0.3)),
      yield* fillJob(f, fl, (i) => C.copy(petal[fl[i].color % FLOWER_COLORS])),
      // Озимая рожь — цвета пашни сезона, яровые (овёс, ячмень) и грядки — зелёные: так же их
      // красит земля под ними (`env/materials`, зелень луга с долей цвета пашни).
      yield* fillJob(k, cr, (i) => (cr[i].sowing === 'spring' ? C.setRGB(cr[i].hue * 0.72, cr[i].hue * 1.0, cr[i].hue * 0.55) : C.setScalar(cr[i].hue))),
    ];
    return (): void => {
      for (const commit of commits) commit();
      tuftCount = Math.min(tufts.length, g.instanceMatrix.count);
      flowerCount = Math.min(fl.length, f.instanceMatrix.count);
      cropCount = Math.min(cr.length, k.instanceMatrix.count);
    };
  }

  /** Первая сборка: шаг за шагом, каждый короче кадра. */
  function* first(): Job<void> {
    // Земля: карта по рядам, пиксели пачками рядов, шум плитки.
    yield 'карта земли';
    const m = yield* groundMapJob(layout, spec.groundMap);
    yield 'текстуры земли';
    map = m;
    // Текстура — в список отдачи сразу, как заведена: сцену могут выгрузить посреди сборки.
    texA = toTexture(yield* pixelsJob(m.size, m.soil, m.litter, m.stone));
    textures.push(texA);
    texB = toTexture(yield* pixelsJob(m.size, m.field, m.lush, m.graze));
    textures.push(texB);
    const noise = yield* noiseJob();
    textures.push(noise);
    yield 'сетка земли';
    const ground = new THREE.Mesh(
      yield* groundModelJob(),
      mat(
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
            graze: color('graze'),
            crop: color('crop'),
          },
          shared,
          cropShow,
        ),
      ),
    );
    ground.name = 'ground';
    ground.receiveShadow = true;
    group.add(ground);
    yield;
    compile(ground);
    yield;

    // Деревья: по породе ближний и дальний меш с общим материалом.
    yield 'лес';
    const trees = yield* scatterTreesJob(layout);
    yield 'породы';
    for (const species of SPECIES) {
      const list = trees.filter((t) => t.species === species);
      trCount[species] = list.length;
      const m2 = mat(
        vegMaterial(`tree-${species}`, { a: color(BARK_KEY[species]), b: color(CROWN_KEY[species]), sway: SWAY[species], flat: true, snowy: true, turnTo: TURN_KEY[species] ? color(TURN_KEY[species]) : undefined }, shared),
      );
      // Модель дерева сливается из кусков — миллисекунды: ближняя и дальняя — по шагу.
      const near = instanced(treeModel(species, 'near'), m2, list.length, `trees-${species}`);
      yield;
      const far = instanced(treeModel(species, 'far'), m2, list.length, `trees-${species}-far`);
      yield;
      const matrices = new Float32Array(list.length * 16);
      const tints = new Float32Array(list.length * 3);
      list.forEach((t, i) => {
        matrixOf(t.x, t.y, t.z, t.rot, t.scale).toArray(matrices, i * 16);
        C.setRGB(t.hue, 0.96 + (t.hue - 1) * 0.5, 1).toArray(tints, i * 3);
      });
      group.add(near, far);
      // 2 — «ещё не делили»: первый же кадр разложит всех.
      stands.push({ list, matrices, tints, near, far, isNear: new Uint8Array(list.length).fill(2) });
      yield;
      // Ближняя и дальняя модели — одна программа (материал общий): собрать хватит одну.
      compile(near);
      yield;
    }

    // Мелочь: меш на вид. Куст с ягодами и без — один материал: у простого нет вершин с
    // долей второго цвета ноль, а у ягодного так покрашены ягоды.
    yield 'мелочь';
    const props = yield* scatterPropsJob(layout, spec.props);
    yield 'меши мелочи';
    const bushMat = mat(vegMaterial('bush', { a: color('berry'), b: color('bush'), sway: 0.5, flat: true, snowy: true }, shared));
    // Пень и бревно — одно дерево: кора и светлый срез.
    const woodMat = mat(vegMaterial('wood', { a: color('trunk'), b: color('cut'), sway: 0, flat: true, snowy: true }, shared));
    const propMat: Record<PropKind, THREE.Material> = {
      bush: bushMat,
      berry: bushMat,
      fern: mat(vegMaterial('fern', { a: color('swardDark'), b: color('fern'), sway: 0.8, twoSided: true }, shared)),
      rock: mat(vegMaterial('rock', { a: color('rock'), b: color('moss'), sway: 0, flat: true, snowy: true }, shared)),
      stump: woodMat,
      log: woodMat,
    };
    for (const kind of PROP_KINDS) {
      const list: Prop[] = props.filter((p) => p.kind === kind);
      propCount[kind] = list.length;
      const mesh = instanced(propModel(kind), propMat[kind], list.length, `props-${kind}`);
      yield;
      // Камни мельче по высоте, чем в плане: плоские валуны сидят в земле, а не висят шаром.
      (yield* fillJob(mesh, list, (i) => C.setScalar(list[i].hue), (p) => (kind === 'rock' ? p.scale * 0.85 : p.scale)))();
      group.add(mesh);
      compile(mesh);
      yield;
    }

    // Угодья: стога, изгороди, овцы — по мешу на вид. Овцы — от среднего уровня: у
    // низкого бюджет вызовов самый тесный (`quality.BUDGET`), а стадо на выгоне — мелочь.
    yield 'угодья';
    const farm = layout.farm;
    const hay = instanced(hayModel(), mat(vegMaterial('hay', { a: color('hay'), b: color('hayTop'), sway: 0, flat: true, snowy: true }, shared)), farm.hay.length, 'hay');
    (yield* fillJob(hay, farm.hay, (i) => C.setScalar(farm.hay[i].hue)))();
    hayCount = hay.count;
    group.add(hay);
    compile(hay);
    yield;
    const fences = instanced(fenceModel(), mat(vegMaterial('fence', { a: color('railDark'), b: color('rail'), sway: 0, flat: true, snowy: true }, shared)), farm.fences.length, 'fences');
    yield* fillPanels(fences, farm.fences);
    fenceCount = fences.count;
    group.add(fences);
    compile(fences);
    yield;
    const flock = spec.props >= 0.7 ? farm.flock : [];
    const sheep = instanced(sheepModel(), mat(vegMaterial('sheep', { a: color('wool'), b: color('woolDark'), sway: 0, flat: true }, shared)), flock.length, 'sheep');
    (yield* fillJob(sheep, flock, (i) => C.setScalar(flock[i].hue)))();
    sheepCount = sheep.count;
    group.add(sheep);
    if (flock.length) compile(sheep);
    yield;

    // Покров: трава, всходы, цветы — угасают вдаль и уходят по сезону.
    // Основание пучка — цвета луга под ним, кончик — светлее и желтее: трава читается
    // светлыми штрихами на земле, а не тёмными галочками.
    yield 'покров';
    const grassMat = mat(vegMaterial('grass', { a: color('meadow'), b: color('grassTip'), sway: 1, twoSided: true, fade: true, show: sward }, shared));
    grass = instanced(tuftModel(false), grassMat, spec.grass, 'grass');
    grass.receiveShadow = true;
    yield;
    const cropMat = mat(vegMaterial('crop', { a: color('meadow'), b: color('crop'), sway: 1.2, twoSided: true, fade: true, show: cropShow }, shared));
    crops = instanced(tuftModel(true), cropMat, CROPS_CAP, 'crops');
    const flowerMat = mat(vegMaterial('flower', { a: color('meadow'), b: color('grassTip'), sway: 0.9, twoSided: true, fade: true, petal: true, show: bloom }, shared));
    flowers = instanced(flowerModel(), flowerMat, spec.flowers, 'flowers');
    flowers.receiveShadow = true;
    group.add(grass, crops, flowers);
    (yield* placeCover(yield* coverJob(layout, m)))();
    for (const mesh of [grass, crops, flowers]) {
      compile(mesh);
      yield;
    }

    // Пятна тени: под каждым деревом и под всем, что выше щиколотки.
    yield 'пятна тени';
    const spots: { x: number; y: number; z: number; r: number }[] = [];
    // Дальний лес без пятен: его и так съедает дымка.
    for (const t of trees) if (!t.far) spots.push({ x: t.x, y: t.y, z: t.z, r: CROWN[t.species] * t.scale * 0.9 });
    for (const p of props) if (p.kind !== 'fern') spots.push({ x: p.x, y: p.y, z: p.z, r: PROP_SPREAD[p.kind] * p.scale * (p.kind === 'log' ? 0.8 : 1) });
    for (const h of farm.hay) spots.push({ x: h.x, y: h.y, z: h.z, r: HAY_SPREAD * h.scale * 1.15 });
    for (const o of flock) spots.push({ x: o.x, y: o.y, z: o.z, r: SHEEP_SPREAD * o.scale * 1.2 });
    const blobs = instanced(blobModel(), mat(shadeMaterial(new THREE.Color(...BLOB_SHADE), shadeU)), spots.length, 'blobs', false);
    blobs.renderOrder = 2;
    for (let i = 0; i < spots.length; i++) {
      const c = spots[i];
      blobs.setMatrixAt(i, matrixOf(c.x, c.y, c.z, 0, c.r));
      if (i % FILL_STEP === FILL_STEP - 1) yield;
    }
    blobs.count = spots.length;
    blobs.instanceMatrix.needsUpdate = true;
    casters = spots.length;
    group.add(blobs);
    yield;
    compile(blobs);

    // Живность: птицы и светлячки (9.8) — не на низком уровне.
    if (spec.life) {
      yield 'живность';
      life = makeLife();
      group.add(life.birds, life.fireflies);
      compile(life.birds);
      yield;
      compile(life.fireflies);
      yield;
    }
    done = true;
  }

  /**
   * Пересчёт под новые постройки: карта и покров считаются кусками в стороне, а
   * подменяются разом — в кадре до конца стоит прежняя земля.
   */
  function* remap(v: EnvVillage): Job<void> {
    yield 'пересчёт под постройки';
    const l = layoutOf(v);
    const m = yield* groundMapJob(l, spec.groundMap);
    const a = yield* pixelsJob(m.size, m.soil, m.litter, m.stone);
    const b = yield* pixelsJob(m.size, m.field, m.lush, m.graze);
    const c = yield* coverJob(l, m);
    // Покров раскладывается пачками, а подменяется одним шагом вместе с картами земли.
    const commit = yield* placeCover(c);
    layout = l;
    map = m;
    if (texA) toTexture(a, texA);
    if (texB) toTexture(b, texB);
    commit();
  }

  const queue: Job<void>[] = [first()];
  /** Ждущий пересчёт под постройки: новый заменяет его, а не встаёт в очередь вторым. */
  let pending: Job<void> | null = null;
  const build: EnvBuild = { ms: 0, slices: 0, longest: 0, step: 0, stepIn: '' };
  let part = '';

  const work = (until: number): boolean => {
    if (!queue.length) return true;
    const t0 = performance.now();
    let now = t0;
    do {
      const job = queue[0];
      const r = job.next();
      if (r.done) {
        queue.shift();
        if (job === pending) pending = null;
      } else if (typeof r.value === 'string') part = r.value;
      const at = performance.now();
      if (at - now > build.step) {
        build.step = at - now;
        build.stepIn = part;
      }
      now = at;
    } while (queue.length && now < until);
    const ms = now - t0;
    build.ms += ms;
    build.slices++;
    build.longest = Math.max(build.longest, ms);
    return queue.length === 0;
  };

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
      // Камера сдвинулась, а граница ближних не пересекла ни одного дерева — буферы те же:
      // перезаливка всех матриц породы на каждом кадре панорамы стоила бы выгрузки зря.
      let same = true;
      for (let i = 0; i < st.list.length; i++) {
        const t = st.list[i];
        const dx = t.x - camera.position.x;
        const dy = t.y - camera.position.y;
        const dz = t.z - camera.position.z;
        const isNear = !t.far && dx * dx + dy * dy + dz * dz < edge2 ? 1 : 0;
        if (st.isNear[i] !== isNear) same = false;
        st.isNear[i] = isNear;
      }
      if (same) continue;
      let n = 0;
      let f = 0;
      const near = st.near.instanceMatrix.array as Float32Array;
      const far = st.far.instanceMatrix.array as Float32Array;
      const nearTint = st.near.instanceColor;
      const farTint = st.far.instanceColor;
      for (let i = 0; i < st.list.length; i++) {
        const isNear = st.isNear[i] === 1;
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
    if (!done) return;
    shared.time.value = f.t;
    // Ветер порывами: два медленных синуса, никогда не ноль.
    shared.wind.value = spec.wind ? 0.05 * (0.75 + 0.25 * Math.sin(f.t * 0.37) * Math.sin(f.t * 0.13 + 1)) : 0;
    shared.far.value = f.fogFar * spec.grassFar;
    shared.night.value = 0.62 * f.light.nightK;
    // Тени облаков — днём и не в сумерках: у низкого солнца пятна легли бы полосами.
    shared.cloud.value = spec.life ? 0.2 * f.light.daylight * (1 - f.light.dusk) * (1 - season.snow * 0.5) : 0;
    life?.update(f.t, f.light.daylight, f.light.nightK, season.bloom, season.snow);
    sward.value = season.sward;
    bloom.value = season.bloom;
    cropShow.value = season.crop;
    shared.snow.value = season.snow;
    shared.turn.value = season.turn;
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
    const job = remap(v);
    const at = pending ? queue.indexOf(pending) : -1;
    // Начатый пересчёт бросается целиком: он пишет только в свои массивы, а покров
    // выгружает в самом конце, — брошенный не оставляет в кадре ничего.
    if (at >= 0) {
      pending?.return();
      queue[at] = job;
    } else queue.push(job);
    pending = job;
  };

  return {
    group,
    work,
    built: () => done,
    update,
    setVillage,
    // Три карты по четыре байта на тексель и треть сверху на мипы.
    textureBytes: () => textures.reduce((n, t) => n + (t.image as ImageData).width * (t.image as ImageData).height * 4 * (4 / 3), 0),
    counts: () => ({
      trees: trCount,
      props: propCount,
      grass: tuftCount,
      crops: cropCount,
      flowers: flowerCount,
      blobs: casters,
      hay: hayCount,
      fences: fenceCount,
      sheep: sheepCount,
      fields: layout.fields.length,
      gardens: layout.gardens.length,
      map: map?.size ?? 0,
      buildMs: build.ms,
      build: { ...build },
    }),
    dispose: () => {
      for (const job of queue) job.return();
      queue.length = 0;
      life?.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
    },
  };
}
