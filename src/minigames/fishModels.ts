/**
 * Модели «Рыбалки»: вода, берега, деревья, камыш, коряга и камни, поплавок и рыбы (docs/minigames.md, раздел 17).
 *
 * Тот же склад, что у остальных промыслов: набор деталей (`render/kit.ts`), цвет в вершинах на общем белом теле и
 * склейка `assemble` — одна вещь, один вызов отрисовки на материал. Всё стоит в осях правила (`fishing.ts`): игрок в
 * нуле, вода — к −Z. Сцена поворачивает берег целиком одной группой так, чтобы солнце светило сбоку-спереди
 * (`fishPlay.SHORE_YAW`), — модели об этом не знают.
 *
 * ВОДА — ОБЩАЯ ВОДА ИГРЫ (`render/water`, docs/polish.md, П-8): Ламберт со вставкой, тень и туман общие с поляной; рябь
 * по течению, круги от поплавка и рыбы, круги дождя, пена, отражение неба по Френелю, блик солнца и лунная дорожка —
 * тем же кодом, что у реки города и роликов. Нового имени `three` нет (`prologue/post.test.ts`).
 *
 * РЫБА БЛЕСТИТ. Чешуя — тот же Ламберт с цветом в вершинах, гладкий, а вставка добавляет зеркальный блик солнца и
 * перелив по углу взгляда: вытащенная из воды рыба играет на свету — ради этого её и тащили.
 */
import * as THREE from 'three';
import { KIT } from '@/render/materials';
import * as K from '@/render/kit';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { vnoise } from '@/render/terrain';
import { hash } from '@/prologue/glade';
import type { Season } from '@/game/types';
import type { Zone } from '@/render/climate';
import { Mesher, V } from './hands';
import { broadleaf, pine, scatter, spruce, willow, type Detail, type NatureMats } from './nature';
import { BANK_Z, FAR_BANK_Z, type FishId, type Shore } from './fishing';
import { SPLASHES, toneWater, waterLook, waterMesh as waterSurface, type WaterLook } from '@/render/water/material';

const tint = (hex: number): K.Paint => ({ mat: KIT.body, tint: new THREE.Color(hex) });
const _c = new THREE.Color();

/** Уровень воды, м: берег у ног — в нуле, кромка уходит под воду. */
export const WATER_Y = -0.3;

// ---------- Вода ----------

/** Сколько кругов на воде держит вставка разом: поплавок, рыба, брызги. Круги дождя — общей водой, без счёта. */
export const RINGS = SPLASHES;

/** Числа воды — общие у меша и сцены (`render/water`): сцена двигает их каждый кадр. */
export type WaterUniforms = WaterLook;

/** Числа воды берега: уровень — высокий, ступень промысла опускает его (`fishPlay`). */
export const waterUniforms = (): WaterUniforms => waterLook('river', 2);

/**
 * Зеркало воды: сетка с рядами чаще у берега. Река — от своей кромки до дальней; море — до горизонта. В вершинах —
 * глубина: мелко у берегов, глубоко посередине; у самой кромки берега вода уже непрозрачна — кромку прячет трава.
 * Вид — общая вода игры (`render/water`): та же, что у реки города и роликов.
 */
export function waterMesh(shore: Shore, u: WaterUniforms): THREE.Mesh {
  const sea = shore === 'sea';
  const near = BANK_Z + 0.7;
  const far = sea ? -620 : FAR_BANK_Z - 1.4;
  const half = sea ? 620 : 95;
  const rows: number[] = [];
  for (let z = near, step = 0.6; z > far; z -= step, step *= sea ? 1.16 : 1.1) rows.push(z);
  rows.push(far);
  const cols: number[] = [];
  const nc = sea ? 44 : 40;
  for (let i = 0; i <= nc; i++) {
    const k = (i / nc) * 2 - 1;
    cols.push(Math.sign(k) * Math.abs(k) ** 1.6 * half);
  }
  const pos: number[] = [];
  const depth: number[] = [];
  for (const z of rows) {
    for (const x of cols) {
      pos.push(x, WATER_Y, z);
      const fromNear = near - z;
      const fromFar = sea ? 1e9 : z - far;
      depth.push(0.45 + 1.6 * Math.min(1, Math.min(fromNear / (sea ? 9 : 5), fromFar / 4)));
    }
  }
  const idx: number[] = [];
  const w = cols.length;
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = j * w + i;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      // Лицом вверх: обход против часовой, если смотреть сверху (ряды идут к −Z).
      idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('wdepth', new THREE.Float32BufferAttribute(depth, 1));
  const nor = new Float32Array(pos.length);
  for (let k = 1; k < nor.length; k += 3) nor[k] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  toneWater(u, shore);
  // Лес за рекой встаёт над водой градусов на восемь: в воде у горизонта — он; у моря берега нет.
  u.wShoreY.value = sea ? 0 : 0.14;
  const m = waterSurface(g, u, 'water');
  // Вода непрозрачна и пишет глубину: дно у берега под ней не должно проступать поверх.
  const mat = m.material as THREE.MeshLambertMaterial;
  mat.transparent = false;
  mat.depthWrite = true;
  m.frustumCulled = false;
  return m;
}

// ---------- Берега ----------

/** Трава берега по сезону: три тона пятнами. */
const BANK_GRASS: Record<Season, [number, number, number]> = {
  spring: [0x6f8f50, 0x627f47, 0x80a05a],
  summer: [0x6a8748, 0x5e7a40, 0x7a9452],
  autumn: [0x9a8443, 0x80703b, 0xa9944f],
  winter: [0xb9a271, 0x9c8a62, 0xcab58a],
};
/** Мокрая кромка: у реки — ил, у моря — мокрый песок. */
const MUD_WET = 0x5e4e3a;
const SAND_WET = 0x8c7b5c;
const MUD = 0x7d6c50;
const SAND = 0xc3ae86;
const PEBBLE = 0x9b917f;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Сетка земли по рядам и колоннам: высота и цвет — функции места. Один меш, один вызов. */
function grid(xs: readonly number[], zs: readonly number[], h: (x: number, z: number) => number, color: (x: number, z: number, y: number) => number): THREE.Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  for (const z of zs) {
    for (const x of xs) {
      const y = h(x, z);
      pos.push(x, y, z);
      _c.setHex(color(x, z, y));
      col.push(_c.r, _c.g, _c.b);
    }
  }
  const idx: number[] = [];
  const w = xs.length;
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const a = j * w + i;
      const b = a + 1;
      const c = a + w;
      const d = c + 1;
      if (zs[j + 1] < zs[j]) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  const flat = g.toNonIndexed();
  g.dispose();
  flat.computeVertexNormals();
  const m = new THREE.Mesh(flat, KIT.grass);
  m.receiveShadow = true;
  return m;
}

/** Ряд чисел от `a` до `b` с шагом, растущим от `step` в `grow` раз за шаг: часто у ног, редко вдали. */
function spread(a: number, b: number, step: number, grow: number): number[] {
  const out = [a];
  const dir = Math.sign(b - a);
  let v = a;
  let s = step;
  while ((b - v) * dir > s * 0.5) {
    v += s * dir;
    out.push(v);
    s *= grow;
  }
  out[out.length - 1] = b;
  return out;
}

const sym = (half: number, step: number, grow: number): number[] => {
  const right = spread(0, half, step, grow);
  return [...right.slice(1).map((x) => -x).reverse(), ...right];
};

/**
 * Свой берег: под ногами трава в пятнах, у воды — полоса ила (у моря — песок и галька), и кромка уходит под воду.
 * Высота у ног — ноль: камера стоит на `EYE` над нулём.
 */
export function bankGround(shore: Shore, season: Season): THREE.Mesh {
  const sea = shore === 'sea';
  const grass = BANK_GRASS[season];
  const xs = sym(80, 1.1, 1.12);
  const zs = [BANK_Z - 2.2, BANK_Z - 1, BANK_Z - 0.35, BANK_Z, BANK_Z + 0.35, BANK_Z + 0.8, ...spread(BANK_Z + 1.4, 40, 0.7, 1.18)];
  const beach = sea ? 3.2 : 0.9;
  return grid(
    xs,
    zs,
    (x, z) => {
      const n = vnoise(x / 5.5, z / 5.5) * 0.12 + vnoise(x / 1.7 + 4, z / 1.7) * 0.03;
      // Кромка не по линейке: берег то выдаётся в воду, то отступает.
      const wig = vnoise(x / 3.2 + 17, 3) * 0.45 + vnoise(x / 1.1 - 5, 7) * 0.12;
      const zb = BANK_Z + wig;
      if (z <= zb) return WATER_Y + 0.05 - (zb - z) * 0.32;
      const rise = smooth(zb, zb + beach, z);
      const back = Math.max(0, z - 10) * 0.05;
      // Под ногами ровно: камера стоит на нуле, бугор у ног поднял бы траву в глаза.
      const calm = smooth(0.8, 3.5, Math.hypot(x, z));
      return WATER_Y + 0.05 + (0.2 + n * calm) * rise + back;
    },
    (x, z, y) => {
      const n = vnoise(x / 3 + 9, z / 3 - 2);
      if (y < WATER_Y + 0.07) return sea ? SAND_WET : MUD_WET;
      const t = z - BANK_Z;
      if (sea) {
        if (t < 2.2) return n > 0.2 ? PEBBLE : SAND;
        if (t < beach + 0.6) return n > 0 ? SAND : PEBBLE;
      } else if (t < 0.55) return n > 0.3 ? MUD : MUD_WET;
      return grass[n > 0.35 ? 2 : n < -0.3 ? 1 : 0];
    },
  );
}

/** Дальний берег реки: ил у воды, трава, подъём к лесу. У моря дальнего берега нет — мыс и горизонт. */
export function farBank(season: Season): THREE.Mesh {
  const grass = BANK_GRASS[season];
  const xs = sym(110, 4, 1.06);
  const zs = [FAR_BANK_Z + 2.4, FAR_BANK_Z + 0.8, FAR_BANK_Z, FAR_BANK_Z - 1, ...spread(FAR_BANK_Z - 2.2, -95, 2.2, 1.12)];
  const m = grid(
    xs,
    zs,
    (x, z) => {
      if (z >= FAR_BANK_Z) return WATER_Y + 0.05 - (z - FAR_BANK_Z) * 0.3;
      const up = FAR_BANK_Z - z;
      return WATER_Y + 0.05 + smooth(0, 1.6, up) * 0.45 + up * 0.04 + vnoise(x / 9, z / 9) * 0.5 * smooth(2, 10, up);
    },
    (x, z, y) => {
      if (y < WATER_Y + 0.08) return MUD_WET;
      if (z > FAR_BANK_Z - 1.2) return MUD;
      const n = vnoise(x / 6 - 3, z / 6 + 1);
      return grass[n > 0.3 ? 2 : n < -0.3 ? 1 : 0];
    },
  );
  m.name = 'farBank';
  m.castShadow = false;
  return m;
}

/** Мыс у моря: скалистый, с зеленью по верху; тёплое море — охра и маквис, холодное — серый камень и вереск. */
export function headland(zone: Zone, side: number): THREE.Mesh {
  const warm = zone === 'med' || zone === 'dry';
  const rock = warm ? [0xa88b66, 0x8f7556] : [0x7c7a74, 0x66655f];
  const top = warm ? 0x5f6e3a : 0x5a6a48;
  const xs = spread(side * 18, side * 140, 3, 1.1);
  const zs = spread(-24, -260, 4, 1.1);
  const m = grid(
    side > 0 ? xs : [...xs].reverse(),
    zs,
    (x, z) => {
      const along = (-z - 24) / 236;
      const across = (Math.abs(x) - 18) / 122;
      // Гряда: выше к середине мыса, обрыв к воде, у кромки — в воду.
      const ridge = Math.sin(Math.min(1, across * 1.4) * Math.PI * 0.5) * (14 + 16 * Math.sin(Math.min(1, along * 1.6) * Math.PI));
      const edge = smooth(0, 0.08, across);
      return WATER_Y - 1.5 + (ridge + vnoise(x / 11, z / 11) * 3) * edge;
    },
    (x, z, y) => {
      const n = vnoise(x / 7, z / 7);
      if (y < WATER_Y + 0.4) return 0x4c4a44;
      if (y > 9 + n * 4) return n > 0.2 ? top : rock[1];
      return rock[n > 0 ? 0 : 1];
    },
  );
  m.name = 'headland';
  m.castShadow = false;
  return m;
}

// ---------- Деревья, камыш, коряга, камни ----------

/** Дерево у воды: ива (крона свисает к воде), ольха (круглая), ель, сосна-зонтик (у тёплого моря). */
export type TreeKind = 'willow' | 'alder' | 'spruce' | 'pine';

export interface Tree {
  kind: TreeKind;
  x: number;
  z: number;
  s: number;
  yaw: number;
}


/** Рост дерева берега на единицу `Tree.s`, м: та же высота, что у прежней лепки. */
const TREE_H: Record<TreeKind, number> = { spruce: 4.9, pine: 4.9, willow: 4.1, alder: 4.5 };

/**
 * Деревья берегов — мягкими (П-4, `nature.ts`): ива, ольха, ель и сосна-зонтик копиями по породам, кора и крона — по
 * вызову. Стоят там же, где прежние (`layTrees`), того же роста.
 */
export function treesGroup(trees: readonly Tree[], season: Season, mats: NatureMats, shadow: boolean, detail: Detail): THREE.Group {
  const g = new THREE.Group();
  g.name = 'trees';
  const make: Record<TreeKind, () => { bark: THREE.BufferGeometry; crown: THREE.BufferGeometry }> = {
    spruce: () => spruce(detail, 3),
    pine: () => pine(detail, 4),
    willow: () => willow(detail, 5, season),
    alder: () => broadleaf(detail, 6, season),
  };
  for (const kind of ['spruce', 'pine', 'willow', 'alder'] as const) {
    const at = trees.filter((t) => t.kind === kind).map((t, n) => ({ x: t.x, z: t.z, yaw: t.yaw, h: TREE_H[kind] * t.s, w: TREE_H[kind] * t.s * (kind === 'spruce' ? 0.85 : 1.05), tint: n % 2 ? 0xffffff : 0xe8f0dc }));
    if (!at.length) continue;
    const t = make[kind]();
    const bark = scatter(t.bark, mats.of('bark'), at.map((a) => ({ ...a, tint: 0xffffff })), `${kind}-bark`, shadow);
    const crown = scatter(t.crown, mats.of(kind === 'spruce' || kind === 'pine' ? 'needle' : 'leaf'), at, `${kind}-crown`, shadow);
    if (bark) g.add(bark);
    if (crown) g.add(crown);
  }
  return g;
}

/**
 * Где стоят деревья: у реки — ивы у самой воды на дальнем берегу, за ними ольха и ели; на своём — ивы и ольха по
 * краям, за спиной. У моря — сосны-зонтики (тёплое) или ели (холодное) на своём берегу по краям. Перед игроком
 * деревьев нет: они закрыли бы воду.
 */
export function layTrees(shore: Shore, zone: Zone, seed: number): Tree[] {
  const out: Tree[] = [];
  const h = (i: number, k: number): number => hash(i * 13 + seed, k * 7 + 3);
  if (shore === 'river') {
    for (let i = 0; i < 26; i++) {
      const x = -95 + i * 7.4 + (h(i, 1) - 0.5) * 4;
      out.push({ kind: h(i, 2) < 0.55 ? 'willow' : 'alder', x, z: FAR_BANK_Z - 2.2 - h(i, 3) * 3, s: 1.5 + h(i, 4) * 0.9, yaw: h(i, 5) * 6.28 });
    }
    for (let i = 0; i < 22; i++) {
      const x = -100 + i * 9.5 + (h(i, 6) - 0.5) * 5;
      out.push({ kind: zone === 'north' || zone === 'land' || h(i, 7) < 0.4 ? 'spruce' : 'alder', x, z: FAR_BANK_Z - 9 - h(i, 8) * 7, s: 2.2 + h(i, 9) * 1.2, yaw: h(i, 10) * 6.28 });
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) {
        const x = side * (9 + i * 7 + h(i, 11 + side) * 3);
        out.push({ kind: i % 2 ? 'alder' : 'willow', x, z: BANK_Z + 1.6 + h(i, 13 + side) * 5 + i * 1.2, s: 1.3 + h(i, 15 + side) * 0.7, yaw: h(i, 17 + side) * 6.28 });
      }
    }
  } else {
    const warm = zone === 'med' || zone === 'dry';
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const x = side * (10 + i * 6.5 + h(i, 21 + side) * 3);
        out.push({ kind: warm ? 'pine' : i % 3 ? 'spruce' : 'alder', x, z: BANK_Z + 5 + h(i, 23 + side) * 6 + i * 1.5, s: (warm ? 1.4 : 1.2) + h(i, 25 + side) * 0.6, yaw: h(i, 27 + side) * 6.28 });
      }
    }
  }
  for (let i = 0; i < 9; i++) {
    const a = 0.6 + (i / 8) * 1.9;
    out.push({ kind: shore === 'sea' && (zone === 'med' || zone === 'dry') ? 'pine' : 'alder', x: Math.cos(a) * (14 + h(i, 31) * 8), z: Math.sin(a) * (14 + h(i, 31) * 8), s: 1.4 + h(i, 33) * 0.8, yaw: h(i, 35) * 6.28 });
  }
  return out;
}

/** Дальний лес — гребёнкой вдоль дальнего берега реки: силуэт, которому треугольники ни к чему. */
export function forestBand(): THREE.Mesh {
  const pos: number[] = [];
  const teeth = 120;
  const z = FAR_BANK_Z - 22;
  for (let i = 0; i < teeth; i++) {
    const x0 = -130 + (i / teeth) * 260;
    const x1 = -130 + ((i + 1) / teeth) * 260;
    // Сплошная часть — до трёх четвертей роста: просвет неба между зубцами — выше крон ив и ольхи, а не под ними,
    // где он читался белой «сосулькой» (снимок П-4).
    const h = 9 + hash(i, 91) * 6;
    const y0 = 0.8;
    const sh = y0 + h * 0.8;
    const xm = (x0 + x1) / 2;
    pos.push(x0, y0, z, x1, y0, z, x1, sh, z, x0, y0, z, x1, sh, z, x0, sh, z, x0, sh, z, x1, sh, z, xm, y0 + h, z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const m = K.assemble([{ geo: g, paint: tint(0x2a4430) }]);
  m.name = 'forestBand';
  m.castShadow = false;
  return m;
}

/** Камыш: стебли пучком и бурые початки — по кругу вокруг места; качается ветром как трава (`tuft`). */
export function reedsMesh(spots: readonly { x: number; z: number; r: number; n: number }[], season: Season): THREE.Mesh {
  const parts: K.Part[] = [];
  const stem = season === 'winter' ? [0xc9b27a, 0xb39a62] : season === 'autumn' ? [0xb39a52, 0x9a8a48] : [0x6f9a45, 0x84a852];
  let i = 0;
  for (const s of spots) {
    for (let k = 0; k < s.n; k++, i++) {
      const a = hash(i, 51) * Math.PI * 2;
      const r = Math.sqrt(hash(i, 53)) * s.r;
      const x = s.x + Math.cos(a) * r;
      const z = s.z + Math.sin(a) * r;
      const h = 1.1 + hash(i, 55) * 0.9;
      const lean = (hash(i, 57) - 0.5) * 0.25;
      const w = 0.025;
      const dx = Math.cos(a + 1.3);
      const dz = Math.sin(a + 1.3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-dx * w, 0, -dz * w, dx * w, 0, dz * w, lean * h, h, lean * h * 0.5], 3));
      g.computeVertexNormals();
      parts.push(K.place(g, tint(stem[k % 2]), x, WATER_Y - 0.05, z));
      if (k % 3 === 0) {
        // Початок рогоза: бурый цилиндр у макушки.
        parts.push(K.cyl(0.022, 0.022, 0.16, tint(0x5a3a24), 5, x + lean * h * 0.86, WATER_Y + h * 0.86, z + lean * h * 0.43));
      }
    }
  }
  const m = K.assemble(parts);
  m.name = 'reeds';
  m.castShadow = false;
  return m;
}

/** Коряга: топляк с сучьями над водой — у реки; у моря на её месте скала в пене. */
export function snagMesh(shore: Shore, at: { x: number; z: number }, season: Season): THREE.Mesh {
  const parts: K.Part[] = [];
  if (shore === 'river') {
    const wood = tint(0x4a3c30);
    const pale = tint(0x7a6a58);
    parts.push(K.cyl(0.14, 0.2, 3.2, wood, 6, at.x, WATER_Y + 0.05, at.z, { z: Math.PI / 2 - 0.2, y: 0.5 }));
    for (const [dx, dz, len, rx, rz] of [
      [0.6, 0.2, 1.3, 0.5, 0.4],
      [-0.5, -0.1, 1.0, -0.6, 0.2],
      [0.1, 0.4, 0.8, 0.2, -0.7],
      [-1.1, 0.3, 0.9, -0.3, 0.5],
    ] as const) {
      parts.push(K.cyl(0.03, 0.07, len, pale, 5, at.x + dx, WATER_Y + len * 0.4, at.z + dz, { x: rx, z: rz }));
    }
    // Тина на топляке летом — зелёный налёт у воды.
    if (season !== 'winter') parts.push(K.cyl(0.21, 0.22, 1.2, tint(0x4f5a2e), 6, at.x - 0.3, WATER_Y + 0.02, at.z + 0.1, { z: Math.PI / 2 - 0.2, y: 0.5 }));
  } else {
    // Скала — в ядре зацепа (`fishing.Spot.r`): поплавок, упавший за ней, не прячется за нарисованным камнем.
    rockParts(parts, at.x, at.z, 0.85, 77, 0x6d6a62);
    rockParts(parts, at.x + 0.5, at.z - 0.3, 0.5, 79, 0x77746b);
  }
  const m = K.assemble(parts);
  m.name = 'snag';
  return m;
}

function rockParts(parts: K.Part[], x: number, z: number, r: number, seed: number, hex: number): void {
  const g = new THREE.DodecahedronGeometry(r, 0);
  g.scale(1.2, 0.7, 1);
  parts.push(K.place(g, tint(hex), x, WATER_Y + r * 0.25, z, { y: hash(seed, 1) * 6, x: 0.2 }));
}

/** Трава у моря — камни в водорослях: россыпь валунов с бурой бахромой. */
export function weedRocksMesh(at: { x: number; z: number; r: number }): THREE.Mesh {
  const parts: K.Part[] = [];
  for (let i = 0; i < 6; i++) {
    const a = hash(i, 61) * Math.PI * 2;
    const s = 0.3 + hash(i, 65) * 0.4;
    // Камни — внутри ядра травы: край нарисованного — край зацепа.
    const rr = Math.sqrt(hash(i, 63)) * Math.max(0, at.r - s * 1.2);
    rockParts(parts, at.x + Math.cos(a) * rr, at.z + Math.sin(a) * rr, s, 81 + i, i % 2 ? 0x6f6c63 : 0x5f5d56);
    const g = new THREE.IcosahedronGeometry(s * 0.9, 0);
    g.scale(1.3, 0.25, 1.3);
    parts.push(K.place(g, tint(0x5a5a2a), at.x + Math.cos(a) * rr, WATER_Y + 0.02, at.z + Math.sin(a) * rr, { y: a }));
  }
  const m = K.assemble(parts);
  m.name = 'weedRocks';
  return m;
}

/** Камни на своём берегу у воды — у моря больше: галечный пляж с валунами. */
export function shoreRocks(shore: Shore, seed: number): THREE.Mesh {
  const parts: K.Part[] = [];
  const n = shore === 'sea' ? 16 : 7;
  for (let i = 0; i < n; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side * (2.5 + hash(i + seed, 71) * 20);
    const z = BANK_Z + (hash(i, 73) - 0.3) * (shore === 'sea' ? 3 : 1.4);
    const r = 0.18 + hash(i, 75) * (shore === 'sea' ? 0.5 : 0.3);
    rockParts(parts, x, z, r, 90 + i, i % 3 ? 0x8a8478 : 0x6f6a60);
  }
  const m = K.assemble(parts);
  m.name = 'rocks';
  return m;
}

// ---------- Поплавок ----------

/** Поплавок: пробка, крашенная красным сверху и белым снизу, гусиное перо антенной и петля. Начало — у воды. */
export function floatMesh(): THREE.Mesh {
  const m = new Mesher();
  m.blob(V(0, 0.02, 0), V(0.028, 0.045, 0.028), new THREE.Euler(), 0xe8e2d4, 8, 6);
  m.blob(V(0, 0.06, 0), V(0.026, 0.03, 0.026), new THREE.Euler(), 0xc8261f, 8, 5);
  m.tube([V(0, 0.07, 0), V(0, 0.16, 0)], [0.007, 0.0045], (u) => (u > 0.6 ? 0xd8301f : 0xf2eee4), 5);
  m.tube([V(0, -0.02, 0), V(0, -0.07, 0)], [0.005, 0.003], 0x8a6a48, 4);
  const mesh = new THREE.Mesh(m.geometry(), new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'float';
  mesh.castShadow = false;
  return mesh;
}

// ---------- Рыбы ----------

/** Как выглядит рыба: спина, бока, брюхо, плавники, полосы и пятна, форма тела и хвоста, плотность (вес к длине). */
interface FishLook {
  back: number;
  flank: number;
  belly: number;
  fin: number;
  /** Поперечные полосы (окунь) — цвет. */
  bars?: number;
  /** Пятна (щука, форель, треска) — цвет. */
  spots?: number;
  /** Высота тела к длине и толщина к высоте. */
  depth: number;
  width: number;
  /** Плотность, кг на куб длины: из веса — длина модели. */
  k: number;
  /** Хвост вилкой (сельдь, скумбрия) или лопатой (налим, сом). */
  fork: number;
  /** Камбала — плоская, глазами вверх. */
  flat?: boolean;
}

export const FISH_LOOK: Record<FishId, FishLook> = {
  roach: { back: 0x34444e, flank: 0xc9cfd2, belly: 0xeef0ea, fin: 0xc8452e, depth: 0.3, width: 0.42, k: 11.5, fork: 0.6 },
  perch: { back: 0x3c5a2c, flank: 0x9fae5c, belly: 0xe7dfb8, fin: 0xd2552a, bars: 0x223018, depth: 0.31, width: 0.45, k: 14, fork: 0.35 },
  bream: { back: 0x4a4636, flank: 0xa69a72, belly: 0xd9d0b0, fin: 0x5a5448, depth: 0.42, width: 0.28, k: 13, fork: 0.7 },
  pike: { back: 0x37482a, flank: 0x7d8f4c, belly: 0xe6e2c4, fin: 0x8a6a3a, spots: 0xd9d8a4, depth: 0.17, width: 0.6, k: 7.5, fork: 0.2 },
  burbot: { back: 0x4a4430, flank: 0x7d7048, belly: 0xc9c09a, fin: 0x5a5236, spots: 0x3a3424, depth: 0.17, width: 0.75, k: 7, fork: -0.4 },
  trout: { back: 0x4d5a3a, flank: 0xb6b08a, belly: 0xeae4cc, fin: 0x8a7a5a, spots: 0x2e2a28, depth: 0.24, width: 0.5, k: 10, fork: 0.25 },
  carp: { back: 0x5a4a28, flank: 0xbf9440, belly: 0xe8d29a, fin: 0x8a5a2e, depth: 0.33, width: 0.5, k: 15, fork: 0.5 },
  mullet: { back: 0x40505c, flank: 0xb3bec4, belly: 0xeef0ee, fin: 0x7a8288, bars: 0x7f8a92, depth: 0.22, width: 0.55, k: 10, fork: 0.55 },
  sargo: { back: 0x8a8a76, flank: 0xd8d6c6, belly: 0xf2f0e6, fin: 0xd8c46a, bars: 0x3a3a34, depth: 0.42, width: 0.32, k: 16, fork: 0.6 },
  bass: { back: 0x4e5a64, flank: 0xc4cccf, belly: 0xf0f2f0, fin: 0x7c868c, depth: 0.25, width: 0.45, k: 10.5, fork: 0.4 },
  mackerel: { back: 0x1f5a5e, flank: 0xb8c8c4, belly: 0xf2f2ec, fin: 0x3a5a5a, bars: 0x10302e, depth: 0.2, width: 0.62, k: 9, fork: 0.85 },
  dentex: { back: 0x8a6a5e, flank: 0xd4b8a8, belly: 0xf0e2d8, fin: 0xb88a7a, spots: 0x5a6a9a, depth: 0.34, width: 0.4, k: 14, fork: 0.55 },
  herring: { back: 0x2c4a5e, flank: 0xc8d4d8, belly: 0xf2f4f2, fin: 0x8a9aa0, depth: 0.22, width: 0.45, k: 9, fork: 0.8 },
  cod: { back: 0x6a6448, flank: 0xb3a87e, belly: 0xece6d0, fin: 0x7a7050, spots: 0x4a442e, depth: 0.22, width: 0.6, k: 9, fork: 0 },
  flounder: { back: 0x6a5a40, flank: 0x8a7652, belly: 0xece6d8, fin: 0x7a6848, spots: 0xc86a2a, depth: 0.5, width: 0.12, k: 18, fork: -0.2, flat: true },
  pollock: { back: 0x3a4a48, flank: 0x8a9a92, belly: 0xdfe4dc, fin: 0x5a6a66, depth: 0.22, width: 0.55, k: 9.5, fork: 0.45 },
};

/** Длина рыбы, м, по весу: вес растёт кубом длины, плотность — своя у вида. */
export const fishLength = (id: FishId, grams: number): number => Math.cbrt(grams / 1000 / FISH_LOOK[id].k);

/**
 * Чешуя: ряды чешуек со сдвигом через ряд в осях покоя рыбы (`vFishP`), край каждой — темнее, середина ловит блик.
 * Рисунок — по месту на теле, а не по экрану: рыба в руке крупная, и чешуя на ней видна; вдали гаснет, а не рябит.
 * Плавники и глаза чешуи не несут (`skin` вершины — 0).
 */
const FISH_SCALES = /* glsl */ `#include <color_fragment>
float fishEdge = 0.0;
{
  vec2 q = vec2( vFishP.x * 46.0, ( vFishP.y + vFishP.z ) * 46.0 );
  float row = floor( q.x );
  q.y += mod( row, 2.0 ) * 0.5;
  vec2 f = fract( q ) - vec2( 0.15, 0.5 );
  float d = length( f * vec2( 1.0, 1.25 ) );
  float fade = 1.0 - smoothstep( 2.5, 9.0, length( vViewPosition ) );
  fishEdge = smoothstep( 0.42, 0.62, d ) * fade * vFishSkin;
  diffuseColor.rgb *= 1.0 - 0.16 * fishEdge;
}`;

const FISH_SHINE = /* glsl */ `
#if NUM_DIR_LIGHTS > 0
{
  vec3 Ls = directionalLights[0].direction;
  vec3 Vv = normalize(vViewPosition);
  vec3 Hs = normalize(Ls + Vv);
  float ndh = max(dot(normal, Hs), 0.0);
  float ndv = max(dot(normal, Vv), 0.0);
  // Чешуя: узкий блик солнца, перелив к краю силуэта и мелкая искра там, где грань смотрит на солнце; край чешуйки
  // блестит меньше середины — блик рассыпается по рядам.
  vec3 shine = directionalLights[0].color * (pow(ndh, 48.0) * 0.9 + pow(ndh, 220.0) * 2.4) * (1.0 - 0.6 * fishEdge);
  vec3 sheen = vec3(0.55, 0.75, 0.9) * pow(1.0 - ndv, 3.0) * 0.35;
  outgoingLight += (shine + sheen) * fishShine;
}
#endif
#include <opaque_fragment>
`;

/**
 * Изгиб тела: хвост ходит волной от головы к хвосту — рыба плывёт, бьётся на крючке и в руке. Ось изгиба — вбок
 * (`fishAxis`; у камбалы, лежащей плашмя, — вверх-вниз). Голова почти не ходит: волна растёт к хвосту квадратом.
 */
const FISH_BEND = /* glsl */ `#include <begin_vertex>
vFishP = position;
vFishSkin = skin;
{
  float fishK = smoothstep( 0.32, -0.55, position.x );
  transformed += fishAxis * ( fishBend * fishK * fishK * 0.22 * sin( fishPhase - position.x * 5.5 ) );
}`;

const FISH_VERT_HEAD = /* glsl */ `#include <common>
uniform float fishBend;
uniform float fishPhase;
uniform vec3 fishAxis;
attribute float skin;
varying vec3 vFishP;
varying float vFishSkin;`;

const FISH_FRAG_HEAD = /* glsl */ `#include <common>
uniform float fishShine;
varying vec3 vFishP;
varying float vFishSkin;`;

/** Числа изгиба, общие на всех рыб берега: видна одна, и ведёт её сцена. */
export interface FishMotion {
  bend: { value: number };
  phase: { value: number };
  axis: { value: THREE.Vector3 };
}

export const fishMotion = (): FishMotion => ({ bend: { value: 0 }, phase: { value: 0 }, axis: { value: new THREE.Vector3(0, 0, 1) } });

/** Материал рыбы: гладкий Ламберт с цветом в вершинах, чешуёй, блеском (`fishShine` — мокрая ярче) и изгибом тела. */
export function fishMaterial(shine: { value: number }, motion: FishMotion = fishMotion()): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.name = 'fishSkin';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.fishShine = shine;
    shader.uniforms.fishBend = motion.bend;
    shader.uniforms.fishPhase = motion.phase;
    shader.uniforms.fishAxis = motion.axis;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', FISH_VERT_HEAD).replace('#include <begin_vertex>', FISH_BEND);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', FISH_FRAG_HEAD)
      .replace('#include <color_fragment>', FISH_SCALES)
      .replace('#include <opaque_fragment>', FISH_SHINE);
  };
  mat.customProgramCacheKey = () => 'fish-skin-2';
  return mat;
}

/**
 * Рыба длиной 1 по +X (голова — к +X), спина — к +Y. Тело — трубка с профилем, приплюснутая с боков; хвост, спинной и
 * брюшные плавники — тонкие эллипсоиды; глаз — тёмный с ободком. Цвет — спина, бока, брюхо по стороне кольца, полосы и
 * пятна по доле длины.
 */
export function fishGeometry(id: FishId): THREE.BufferGeometry {
  const L = FISH_LOOK[id];
  // Тело — своей лепкой (несёт чешую), плавники, глаза и рот — своей (`skin` 0): чешуя на плавнике читалась бы сеткой.
  const m = new Mesher();
  const fins = new Mesher();
  const N = 16;
  const path: THREE.Vector3[] = [];
  const radii: number[] = [];
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const x = -0.5 + u * 0.92;
    path.push(V(x, 0, 0));
    // Профиль: тонкий хвостовой стебель, широкое тело в передней трети, тупая голова.
    const body = Math.sin(Math.min(1, (u * 0.95 + 0.05) ** 0.8) * Math.PI) ** 0.9;
    radii.push(Math.max(0.012, (L.depth / 2) * (0.22 + 0.78 * body)));
  }
  const spotAt = (u: number, d: THREE.Vector3): boolean => {
    const a = Math.atan2(d.y, d.z);
    return Math.sin(u * 61 + a * 5.3) * Math.sin(u * 37 - a * 3.1) > 0.55;
  };
  const back = new THREE.Color(L.back);
  const flank = new THREE.Color(L.flank);
  const belly = new THREE.Color(L.belly);
  const dark = new THREE.Color(L.back).multiplyScalar(0.55);
  m.tube(
    path,
    radii,
    (u, d) => {
      const y = L.flat ? d.z : d.y;
      // Спина — бока — брюхо плавно, а не полосами: рыба круглая, свет по ней течёт.
      if (y > 0) _c.copy(flank).lerp(back, Math.min(1, Math.max(0, (y - 0.05) / 0.55)) ** 0.8);
      else _c.copy(flank).lerp(belly, Math.min(1, Math.max(0, (-y - 0.25) / 0.45)));
      // Боковая линия — тонкая тёмная черта вдоль бока; жаберная крышка — тёмная дуга за головой; голова сверху темнее.
      if (Math.abs(y - 0.04) < 0.05 && u > 0.12 && u < 0.72) _c.lerp(dark, 0.35);
      if (Math.abs(u - 0.74) < 0.018 && y < 0.6) _c.lerp(dark, 0.55);
      if (u > 0.76 && y > 0.2) _c.lerp(dark, 0.25);
      let hex = _c.getHex();
      if (L.bars && y > -0.35 && Math.sin(u * 38) > 0.55 && u > 0.2 && u < 0.72) hex = L.bars;
      if (L.spots && y > -0.3 && spotAt(u, d)) hex = L.spots;
      return hex;
    },
    12,
    L.width,
  );
  // Лучи плавника: тёмные струны по длине, перепонка между ними светлее — плавник читается плавником, а не листом.
  const fin = new THREE.Color(L.fin);
  const ray = new THREE.Color(L.fin).multiplyScalar(0.6);
  const web = new THREE.Color(L.fin).lerp(new THREE.Color(0xf0ece0), 0.3);
  // Струны идут поперёк оси `axis` плавника (в его осях до поворота): у спинного — стоймя, у хвоста — вдоль лопасти.
  const rays = (axis: 'x' | 'y' | 'z') => (p: THREE.Vector3): number => (Math.sin(p[axis] * 150) > 0.35 ? ray.getHex() : _c.copy(web).lerp(fin, 0.5).getHex());
  // Хвост: две лопасти вилкой от хвостового стебля назад и в стороны — длинные и узкие; у лопаты — шире и короче.
  const forkA = 0.32 + 0.38 * L.fork;
  const lobe = 0.11 + 0.04 * Math.max(0, L.fork);
  for (const s of [-1, 1]) {
    const a = s * forkA;
    fins.blob(V(-0.5 - Math.cos(a) * lobe * 0.8, Math.sin(a) * lobe * 0.8, 0), V(lobe, 0.024 + 0.02 * Math.max(0, -L.fork), 0.005), new THREE.Euler(0, 0, -a), rays('y'), 10, 5);
  }
  // Спинной плавник, анальный, брюшные и грудные.
  fins.blob(V(-0.02, L.depth * 0.5, 0), V(0.15, 0.055, 0.005), new THREE.Euler(0, 0, -0.15), rays('x'), 10, 5);
  fins.blob(V(-0.24, -L.depth * 0.42, 0), V(0.075, 0.032, 0.005), new THREE.Euler(0, 0, 0.3), rays('x'), 8, 4);
  for (const s of [-1, 1]) {
    fins.blob(V(0.04, -L.depth * 0.44, s * L.depth * L.width * 0.2), V(0.05, 0.022, 0.005), new THREE.Euler(0.4 * s, 0, 0.35), rays('x'), 7, 4);
    fins.blob(V(0.2, -L.depth * 0.2, s * L.depth * L.width * 0.45), V(0.06, 0.012, 0.03), new THREE.Euler(0.3 * s, 0.4 * s, 0.2), rays('z'), 7, 4);
  }
  // Глаза: золотистая радужка в ободке, тёмный зрачок с бликом.
  for (const s of [-1, 1]) {
    const z = s * L.depth * L.width * 0.42;
    fins.blob(V(0.33, L.depth * 0.08, z), V(0.03, 0.03, 0.012), new THREE.Euler(), 0xd8c070, 8, 5);
    fins.blob(V(0.335, L.depth * 0.08, z + s * 0.007), V(0.017, 0.017, 0.008), new THREE.Euler(), 0x0e0c0a, 7, 4);
    fins.blob(V(0.342, L.depth * 0.08 + 0.008, z + s * 0.012), V(0.005, 0.005, 0.003), new THREE.Euler(), 0xf4f2ea, 4, 3);
  }
  // Рот — тёмная щель на конце морды.
  fins.blob(V(0.41, -L.depth * 0.03, 0), V(0.012, 0.006, L.depth * L.width * 0.18), new THREE.Euler(0, 0, -0.2), 0x2a1c18, 6, 4);
  const body = m.geometry();
  const rest = fins.geometry();
  body.setAttribute('skin', new THREE.Float32BufferAttribute(new Float32Array(body.attributes.position.count).fill(1), 1));
  rest.setAttribute('skin', new THREE.Float32BufferAttribute(new Float32Array(rest.attributes.position.count), 1));
  const g = mergeGeometries([body, rest]);
  body.dispose();
  rest.dispose();
  if (L.flat) g.rotateX(Math.PI / 2);
  return g;
}
