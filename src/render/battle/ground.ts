// Земля боя: та клетка карты, на которой он и случился.
//
// Разнообразие даёт ощущение богатства дешевле, чем детализация: у брода, на
// гребне, у опушки, поперёк тракта — четыре разных зрелища из одного набора
// примитивов. Что именно за место, решено раньше и записано в раскадровке
// (`Cast.ground`); здесь только геометрия.
//
// Два правила, и оба структурные, а не пожелания:
//
// 1. **Материалы у сцены боя свои.** Общие KIT и LEGACY переливает сезон
//    деревни, а деревня жива и во время ролика — она рисуется теми же
//    материалами. Ролик, покрасивший общий материал в снег, перекрасил бы и её.
//    Поэтому здесь один собственный белый множитель, а весь цвет запечён в
//    вершины. Отсюда же и зима: она меняет запекаемые числа, а не материалы.
// 2. **Всё склеено.** Плита земли — один вызов, ближний декор — один, дальний
//    план — один. Тени отбрасывает только ближний: дальнему лесу тень не
//    положена, ровно как в деревне.
import * as THREE from 'three';
import type { Ground } from '@/battle/replay';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GRASS_DARK_MUL, GRASS_LIGHT_MUL, PALETTE, seasonColor, type Mul, type PaletteKey } from '../palette';

/**
 * Половина стороны подробной земли. Дальше идёт подстилка (`SKIRT_HALF`): у
 * стратегического плана верх кадра стоит ровно на горизонте, и край плиты в нём
 * виден. Подстилка уводит его за дымку, и земля кончается небом, а не обрывом.
 */
export const FIELD_HALF = 60;
export const SKIRT_HALF = 320;

/**
 * Ровная площадка, на которой стоит строй. Считать её надо не по фронту, а по
 * бегущим: сектор уходит с поля на `FLEE_DIST` от своего места, и дальше всех
 * добегает резерв (его место — `FIELD` в battle/replay.ts). Земля под ним обязана оставаться
 * плоской — фигуры стоят на y = 0, рельефа они не знают.
 */
export const CLEAR_R = 21;

/** Насколько плавно ровная площадка переходит в остальную местность. */
const CLEAR_FADE = 7;

/** Дробность плиты: 2.5 метра на грань. Крупнее — видно ступени, мельче — не за что платить. */
const PLATE_SEGMENTS = 48;

/**
 * Гребень: за расчисткой земля обрывается. Обрыв большой нарочно — на семи
 * метрах с высокой камеры он читается пологим скатом, а не гребнем: горизонт
 * почти не садится, и место выглядит тем же ровным полем. Шестнадцать метров
 * убирают из кадра всё, что за крестом, и оставляют небо и дальнюю гряду.
 */
const RIDGE_DROP = 16;
/** Холмы за расчисткой. */
const HILL_RISE = 3.4;
/** Ровное поле тоже не стол: за расчисткой лёгкая волна. */
const PLAIN_RISE = 1.1;

/**
 * Река идёт поперёк поля за дальним войском — там она видна с любого плана.
 * Дальше расчистки, и с запасом: русло вырезано в земле, а по земле бегут — на
 * двадцати трёх метрах сломанный резерв уходил бы в воду по щиколотку.
 */
const RIVER_Z = 27;
const RIVER_HALF = 3.4;
/**
 * Дно русла и уровень воды. Разница между ними мала нарочно: стоит ей вырасти,
 * из-под воды вылезает полоса голого дна — и с низкой камеры она читается не
 * берегом, а второй дорогой поперёк поля.
 */
const RIVER_BED = -0.34;
const WATER_Y = -0.22;
/** Вода заходит на берег: у неё край, а не шов. */
const WATER_OVER = 0.7;
/** Брод: светлая отмель поперёк реки — по ней её и переходят. */
const FORD_HALF = 2.9;
const FORD_Y = -0.1;

/** Тракт идёт вдоль поля, и строи сходятся поперёк него. */
const ROAD_HALF = 1.7;
const RUT = 0.85;

/** Берег: вода начинается слева за расчисткой. */
const SHORE_X = -27;

/** Опушка: где стоит стена леса. Ближние деревья отбрасывают тень, дальние — нет. */
const WOODS_FROM = 25;
const WOODS_TO = 52;
const WOODS_NEAR = 33;
const WOODS_COUNT = 130;

/**
 * Дальний план: гряда у самого края видимого. Она не деталь, а глубина: без неё
 * горизонт пуст, и поле читается зелёным диском. Стоит она за дымкой нарочно —
 * силуэт, а не предмет.
 */
const FAR_HILLS = { from: 74, to: 108, height: 13, count: 44 };
/** Насколько гряда уже уведена к дымке краской: остальное доделает туман. */
const FAR_HAZE = 0.4;

/** Детерминированный шум: та же запись боя — то же поле до кустика. */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const hash2 = (seed: number, x: number, y: number): number =>
  hash(Math.imul(Math.round(x * 137), 0x27d4eb2d) ^ Math.imul(Math.round(y * 149), 0x165667b1) ^ seed);

/** Гладкий шум по сетке: билинейка по узлам, потому что земля не должна дрожать. */
function noise(seed: number, x: number, z: number, scale: number): number {
  const u = x / scale;
  const v = z / scale;
  const x0 = Math.floor(u);
  const z0 = Math.floor(v);
  const fx = smooth(u - x0);
  const fz = smooth(v - z0);
  const a = hash2(seed, x0, z0);
  const b = hash2(seed, x0 + 1, z0);
  const c = hash2(seed, x0, z0 + 1);
  const d = hash2(seed, x0 + 1, z0 + 1);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}

const smooth = (t: number): number => {
  const k = t < 0 ? 0 : t > 1 ? 1 : t;
  return k * k * (3 - 2 * k);
};

/** Плавный переход от a к b: 0 у a, 1 у b. */
const step = (a: number, b: number, v: number): number => smooth((v - a) / (b - a || 1e-6));

/**
 * Цвет палитры на этом поле. Зима — единственное место, где сцена боя решает за
 * себя сама: у ключа `field` сезонного переопределения нет нарочно (иначе зима
 * красила бы деревню), поэтому снег на поле ставится явно, отдельным ключом.
 */
function colorOf(g: Ground, key: PaletteKey): number {
  if (key === 'field') return g.winter ? PALETTE.fieldSnow : PALETTE.field;
  return g.winter ? seasonColor('winter', key) : PALETTE[key];
}

const C = new THREE.Color();
const C2 = new THREE.Color();

/** Высота земли в точке. Внутри расчистки строго ноль: на ней стоит строй. */
export function groundHeight(g: Ground, x: number, z: number): number {
  const out = step(CLEAR_R, CLEAR_R + CLEAR_FADE, Math.hypot(x, z));
  let y = 0;
  if (out > 0) {
    const n = noise(g.seed, x, z, 13);
    // Гребень: земля уходит вниз, и горизонт садится к самому строю. Холмы —
    // наоборот вверх. Ровное поле тоже не стол: лёгкая волна, чтобы край жил.
    if (g.ridge) y = -RIDGE_DROP * out * (0.7 + n * 0.5);
    else if (g.land === 'hills') y = HILL_RISE * out * (0.3 + n * 1.15);
    else y = PLAIN_RISE * out * (n - 0.35);
  }
  if (g.land === 'shore') {
    const w = step(SHORE_X + 6, SHORE_X - 2, x);
    y = y * (1 - w) + RIVER_BED * w;
  }
  if (g.river) {
    const d = Math.abs(z - RIVER_Z);
    const k = step(RIVER_HALF + 2.6, RIVER_HALF - 0.4, d);
    y = y * (1 - k) + RIVER_BED * k;
  }
  // У края плита приводится к нулю: за ней лежит ровная подстилка, и ступеньки
  // между ними быть не должно — она пришлась бы ровно на линию горизонта.
  return y * (1 - step(FIELD_HALF - 16, FIELD_HALF - 1, Math.max(Math.abs(x), Math.abs(z))));
}

/**
 * Насколько земля здесь мокрая, 0..1. Не признак, а доля: у берега трава
 * переходит в ил постепенно. Резкая полоса ила читалась поперечной дорогой —
 * ровно этим она и выглядела, пока была признаком.
 */
function wet(g: Ground, x: number, z: number): number {
  let w = 0;
  if (g.land === 'shore') w = step(SHORE_X + 5, SHORE_X - 1, x);
  if (g.river) w = Math.max(w, step(RIVER_HALF + 2.4, RIVER_HALF - 0.4, Math.abs(z - RIVER_Z)));
  return w;
}

/** Стоять здесь дереву или камню нельзя: под ним вода. */
const flooded = (g: Ground, x: number, z: number): boolean => wet(g, x, z) > 0.45;

/** Насколько цвет дна уведён от травы к илу: ил чистым цветом слишком шоколадный. */
const BED_MIX = 0.62;

/** Умножитель цвета травы: от сырой низины к выгоревшему бугру. */
function grassMul(g: Ground, x: number, z: number, out: THREE.Color): THREE.Color {
  const n = noise(g.seed + 11, x, z, 9);
  const mix = (a: Mul, b: Mul, k: number): void => {
    out.setRGB(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k);
  };
  mix(GRASS_DARK_MUL, GRASS_LIGHT_MUL, n);
  return out;
}

/**
 * Плита земли: рельеф и цвет запечены в вершины. Один вызов отрисовки на всю
 * землю, сколько бы примет у места ни было.
 */
function buildPlate(g: Ground): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(FIELD_HALF * 2, FIELD_HALF * 2, PLATE_SEGMENTS, PLATE_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const grass = colorOf(g, 'field');
  const bed = new THREE.Color(colorOf(g, 'field')).lerp(new THREE.Color(colorOf(g, 'soil')), BED_MIX).getHex();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = groundHeight(g, x, z);
    pos.setY(i, y);
    // Трава уходит в ил долей, а не полосой: у воды она просто темнеет.
    C.setHex(grass).multiply(grassMul(g, x, z, C2)).lerp(C2.setHex(bed), wet(g, x, z));
    col[i * 3] = C.r;
    col[i * 3 + 1] = C.g;
    col[i * 3 + 2] = C.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  geo.computeVertexNormals();
  return geo;
}

/** Плоская накладка на землю: вода, отмель, тракт, колея. */
function slab(w: number, d: number, x: number, y: number, z: number, color: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  geo.translate(x, y, z);
  return paint(geo, color);
}

/** Красит геометрию одним цветом в вершины: цвет несёт только вершина. */
function paint(geo: THREE.BufferGeometry, color: number, mul: Mul = [1, 1, 1]): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  C.setHex(color);
  for (let i = 0; i < n; i++) {
    col[i * 3] = C.r * mul[0];
    col[i * 3 + 1] = C.g * mul[1];
    col[i * 3 + 2] = C.b * mul[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Дерево: ствол и две кроны. Пропорции те же, что у леса вокруг деревни. */
function tree(g: Ground, scale: number, tall: boolean): THREE.BufferGeometry[] {
  const leaves = colorOf(g, tall ? 'leaves' : 'leaves2');
  const trunk = new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, 0.8 * scale, 5).translate(0, 0.4 * scale, 0);
  const c1 = new THREE.ConeGeometry(0.75 * scale, 1.3 * scale, 6).translate(0, 1.3 * scale, 0);
  const c2 = new THREE.ConeGeometry(0.55 * scale, 1.0 * scale, 6).translate(0, 2.0 * scale, 0);
  return [paint(trunk, colorOf(g, 'trunk')), paint(c1, leaves), paint(c2, leaves)];
}

/**
 * Дальнее дерево: один конус без ствола и без донца — один веер боковых граней
 * против ствола и двух крон с донцами (`tree`). У края поля силуэт всё равно один и тот же.
 */
function farTree(g: Ground, scale: number, tall: boolean): THREE.BufferGeometry {
  const h = 2.9 * scale;
  const geo = new THREE.ConeGeometry(0.86 * scale, h, 5, 1, true).translate(0, h / 2, 0);
  return paint(geo, colorOf(g, tall ? 'leaves' : 'leaves2'));
}

function rock(g: Ground, scale: number, seed: number): THREE.BufferGeometry {
  const geo = new THREE.DodecahedronGeometry(0.5 * scale, 0);
  geo.rotateX(hash(seed) * 3);
  geo.rotateY(hash(seed + 1) * 3);
  geo.translate(0, 0.3 * scale, 0);
  return paint(geo, colorOf(g, 'rock'));
}

/** Всё, что построила земля: три меша и одна судьба у их геометрий. */
export interface GroundView {
  group: THREE.Group;
  dispose(): void;
}

/**
 * Земля клетки целиком. Три меша: плита (принимает тени), ближний декор
 * (отбрасывает) и дальний план (ни того, ни другого).
 */
export function buildGround(g: Ground): GroundView {
  // Один белый множитель на всю землю: цвет живёт в вершинах, а материал —
  // свой, не общий. Сезон деревни до него не дотягивается по построению.
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, vertexColors: true });
  mat.name = 'battle-ground';

  const plate: THREE.BufferGeometry[] = [buildPlate(g)];
  const near: THREE.BufferGeometry[] = [];
  const far: THREE.BufferGeometry[] = [];

  if (g.river) {
    // Вода лежит выше дна: у берега поэтому видна полоса мокрой земли.
    plate.push(slab(SKIRT_HALF * 2, (RIVER_HALF + WATER_OVER) * 2, 0, WATER_Y, RIVER_Z, colorOf(g, 'water')));
    if (g.ford) {
      plate.push(slab(FORD_HALF * 2, (RIVER_HALF + 0.7) * 2, 0, FORD_Y, RIVER_Z, colorOf(g, 'shallow')));
      // Камни брода: по ним и видно, что реку здесь переходят, а не переплывают.
      for (let i = 0; i < 7; i++) {
        const s = 0.4 + hash(g.seed + i * 13) * 0.4;
        const geo = rock(g, s, g.seed + i);
        geo.translate((hash(g.seed + i * 7) - 0.5) * FORD_HALF * 2.2, WATER_Y, RIVER_Z + (hash(g.seed + i * 3) - 0.5) * RIVER_HALF * 1.8);
        near.push(geo);
      }
    }
  }

  if (g.land === 'shore') {
    const w = SHORE_X + WATER_OVER + SKIRT_HALF;
    plate.push(slab(w, SKIRT_HALF * 2, SHORE_X + WATER_OVER - w / 2, WATER_Y, 0, colorOf(g, 'water')));
  }

  if (g.road) {
    // Тракт идёт вдоль поля: строи сошлись поперёк него, и это видно с отъезда.
    plate.push(slab(ROAD_HALF * 2, FIELD_HALF * 2, 0, 0.012, 0, colorOf(g, 'packed')));
    for (const side of [-1, 1]) {
      plate.push(slab(0.34, FIELD_HALF * 2, side * RUT, 0.022, 0, colorOf(g, 'trample')));
    }
  }

  // Опушка. Ближние деревья отбрасывают тень — на низком солнце она ложится
  // через полполя и стоит дороже любой детали; дальним тень не положена.
  if (g.woods) {
    for (let i = 0; i < WOODS_COUNT; i++) {
      const a = hash(g.seed + i * 17) * Math.PI * 2;
      const r = WOODS_FROM + hash(g.seed + i * 29) * (WOODS_TO - WOODS_FROM);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      // Вид на дальнее войско лес не загораживает: перед строем он расступается.
      if (flooded(g, x, z)) continue;
      const y = groundHeight(g, x, z);
      const scale = 0.85 + hash(g.seed + i * 41) * 0.5;
      const tall = hash(g.seed + i * 53) > 0.5;
      if (r < WOODS_NEAR) {
        for (const geo of tree(g, scale, tall)) near.push(geo.translate(x, y, z));
      } else {
        far.push(farTree(g, scale, tall).translate(x, y, z));
      }
    }
  }

  // Камни. На гребне они стоят по самому краю обрыва и рисуют его линию: без
  // них земля просто кончается, и обрыв читается краем модели. В холмах они
  // разбросаны и объясняют, почему земля тут ломаная.
  if (g.ridge || g.land === 'hills') {
    const count = g.ridge ? 30 : 24;
    for (let i = 0; i < count; i++) {
      const a = g.ridge
        ? (i / count) * Math.PI * 2 + (hash(g.seed + i * 61) - 0.5) * 0.14
        : hash(g.seed + i * 61) * Math.PI * 2;
      // На гребне камни стоят ПЕРЕД обрывом, а не на скате: со ската их не
      // видно вовсе — их закрывает сам гребень.
      const r = g.ridge ? CLEAR_R - 3 + hash(g.seed + i * 71) * 5 : CLEAR_R - 3 + hash(g.seed + i * 71) * 14;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (flooded(g, x, z)) continue;
      const scale = (g.ridge ? 0.9 : 0.7) + hash(g.seed + i * 83) * 1.5;
      near.push(rock(g, scale, g.seed + i * 5).translate(x, groundHeight(g, x, z), z));
    }
  }

  // Подстилка: земля за подробной плитой. У стратегического плана верх кадра
  // стоит на горизонте, и без неё видно, где плита кончается. Кладётся рамкой
  // из восьми полос, потому что середина у неё уже есть.
  for (const s of skirt(g)) plate.push(s);

  // Дальний план: гряда за дымкой. Она никогда не в фокусе — и не должна быть:
  // без неё горизонт пуст и поле читается зелёным диском, с ней у кадра
  // появляется глубина. Цвет уже уведён к дымке краской, остальное доделает туман.
  const haze = new THREE.Color(colorOf(g, g.winter ? 'rock' : 'leaves')).lerp(
    new THREE.Color(colorOf(g, 'fog')),
    FAR_HAZE,
  );
  for (let i = 0; i < FAR_HILLS.count; i++) {
    const a = (i / FAR_HILLS.count) * Math.PI * 2 + hash(g.seed + i) * 0.12;
    const r = FAR_HILLS.from + hash(g.seed + i * 19) * (FAR_HILLS.to - FAR_HILLS.from);
    const h = FAR_HILLS.height * (0.4 + hash(g.seed + i * 23) * 0.9);
    const geo = new THREE.ConeGeometry(h * 2.1, h, 5, 1, true).translate(0, h / 2 - 2, 0);
    far.push(paint(geo, haze.getHex()).translate(Math.cos(a) * r, 0, Math.sin(a) * r));
  }

  const group = new THREE.Group();
  group.name = 'ground';
  const meshes: THREE.Mesh[] = [];
  const add = (parts: THREE.BufferGeometry[], cast: boolean, receive: boolean): void => {
    if (parts.length === 0) return;
    // Без групп: группа — это отдельный вызов отрисовки, а материал здесь один
    // на всё, и цвет живёт в вершинах именно ради этого.
    const geo = parts.length === 1 ? parts[0] : mergeGeometries(parts.map(nonIndexed), false);
    if (!geo) throw new Error('земля боя: не склеилась');
    if (parts.length > 1) for (const p of parts) p.dispose();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    // Земля и лес неподвижны и заведомо в кадре: сфера по каждому только мешает.
    mesh.frustumCulled = false;
    meshes.push(mesh);
    group.add(mesh);
  };
  add(plate, false, true);
  add(near, true, true);
  add(far, false, false);

  return {
    group,
    dispose(): void {
      for (const m of meshes) m.geometry.dispose();
      mat.dispose();
    },
  };
}

/**
 * Подстилка вокруг подробной плиты: рамка из восьми полос от `FIELD_HALF` до
 * `SKIRT_HALF`. Ровная и на нуле — плита у своего края тоже приведена к нулю
 * (`groundHeight`), поэтому шва между ними нет.
 */
function skirt(g: Ground): THREE.BufferGeometry[] {
  const a = FIELD_HALF;
  const b = SKIRT_HALF;
  const side = b - a;
  const mid = (a + b) / 2;
  const color = new THREE.Color(colorOf(g, 'field')).multiply(
    C2.setRGB(GRASS_DARK_MUL[0], GRASS_DARK_MUL[1], GRASS_DARK_MUL[2]),
  );
  const out: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 0, 1]) {
    for (const sz of [-1, 0, 1]) {
      if (sx === 0 && sz === 0) continue;
      const w = sx === 0 ? a * 2 : side;
      const d = sz === 0 ? a * 2 : side;
      out.push(slab(w, d, sx * mid, 0, sz * mid, color.getHex()));
    }
  }
  return out;
}

/** Склейка требует одинакового набора атрибутов и отсутствия индекса. */
function nonIndexed(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}
