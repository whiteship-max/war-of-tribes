/**
 * Модели промыслов: кусты с ягодами, загон, стог, охапка в руках, овца, коза и корова.
 *
 * Тот же склад, что у поляны предыстории (`prologue/models.ts`): набор деталей (`render/kit.ts`), цвет в вершинах
 * на общем белом теле (`KIT.body`) и склейка `assemble` — один вызов отрисовки на материал, а не на доску. Цвета —
 * не сезонные материалы, а оттенки: ягоду, шерсть и сено сезон не переливает; снег на них кладут копии материалов
 * поляны (`prologue/surface.ts`) — по тому, что смотрит вверх.
 *
 * Имена `three` — только те, что игра уже берёт (первая загрузка, `prologue/post.test.ts`): своих классов у
 * промыслов нет. Ягоды — один `InstancedMesh` на всю поляну: сто ягод — один вызов, цвет каждой — свой.
 */
import * as THREE from 'three';
import { KIT } from '@/render/materials';
import * as K from '@/render/kit';
import { BUSH_KINDS, type Bush, type BushKind } from './berries';
import { BEASTS, HAY, PEN_R, type BeastKind } from './herd';
import { hash } from '@/prologue/glade';
import type { Season } from '@/game/types';

const tint = (hex: number): K.Paint => ({ mat: KIT.body, tint: new THREE.Color(hex) });

/** Листва кустов по виду: черника светлее и мельче, брусника тёмная и глянцевая, малина — светлая зелень на бурых стеблях. */
const LEAF: Record<BushKind, number> = { bilberry: 0x5d8f45, cowberry: 0x417a3e, raspberry: 0x6aa04d };
const CANE = 0x6f4a35;

/** Спелая ягода по виду и зелёная — от неё ягода краснеет (синеет) по ходу игры (`berries.blush`). */
export const BERRY_RIPE: Record<BushKind, number> = { bilberry: 0x26326e, cowberry: 0xbd2235, raspberry: 0xd23a52 };
export const BERRY_GREEN: Record<BushKind, number> = { bilberry: 0x8db55a, cowberry: 0xb7c76a, raspberry: 0xd4d98a };
/** Ягода — сколько в поперечнике, м. Крупнее настоящей вдвое: с трёх шагов на телефоне она должна читаться точкой цвета. */
export const BERRY_SIZE: Record<BushKind, number> = { bilberry: 0.07, cowberry: 0.065, raspberry: 0.085 };

/** Кусты всей поляны — одним мешем. Ягоды — отдельно (`berriesMesh`): у них свой цвет на каждую. */
export function bushesMesh(bushes: readonly Bush[]): THREE.Mesh {
  const parts: K.Part[] = [];
  for (const b of bushes) {
    const look = BUSH_KINDS[b.kind];
    const leaf = tint(LEAF[b.kind]);
    const ao = { base: [0.62, 0.66, 0.74] as [number, number, number], y0: 0, y1: look.h };
    if (b.kind === 'raspberry') {
      // Малина — пучок стеблей и листва шапками по высоте: высокий силуэт виден с другого края поляны.
      // Стебли — ниже верхней шапки и с пучком листьев на макушке: голая палка над кустом читалась прутом.
      for (let k = 0; k < 6; k++) {
        const a = b.yaw + k * 1.05;
        const lean = 0.18 + (k % 3) * 0.06;
        const len = look.h * (0.78 + (k % 2) * 0.08);
        const bx = b.x + Math.cos(a) * 0.12;
        const bz = b.z + Math.sin(a) * 0.12;
        parts.push(K.cyl(0.011, 0.019, len, tint(CANE), 4, bx, len / 2, bz, { x: Math.sin(a) * lean, z: -Math.cos(a) * lean }));
        // Макушка наклонённого стебля — куда увёл её тот же поворот, что у стебля (`K.place`: Эйлер X, Y, Z).
        const tip = new THREE.Vector3(0, len / 2, 0).applyEuler(new THREE.Euler(Math.sin(a) * lean, 0, -Math.cos(a) * lean));
        const g = new THREE.IcosahedronGeometry(0.11, 0);
        g.scale(1.3, 0.7, 1.3);
        parts.push(K.place(g, leaf, bx + tip.x, len / 2 + tip.y, bz + tip.z, { y: a }));
      }
      for (let k = 0; k < 5; k++) {
        const a = b.yaw + k * 1.3;
        const g = new THREE.IcosahedronGeometry(0.3 - k * 0.025, 0);
        g.scale(1.1, 0.75, 1.1);
        parts.push(K.place(g, leaf, b.x + Math.cos(a) * 0.3, 0.38 + k * 0.2, b.z + Math.sin(a) * 0.3, { y: a }, ao));
      }
    } else {
      // Низкий куст — три приплюснутые шапки: кочка, а не шар.
      for (let k = 0; k < 3; k++) {
        const a = b.yaw + k * 2.1;
        const g = new THREE.IcosahedronGeometry(look.r * (0.78 - k * 0.12), 1);
        g.scale(1.15, (look.h / look.r) * 0.95, 1.15);
        const off = k === 0 ? 0 : look.r * 0.45;
        parts.push(K.place(g, leaf, b.x + Math.cos(a) * off, look.h * 0.42, b.z + Math.sin(a) * off, { y: a }, ao));
      }
    }
  }
  const m = K.assemble(parts);
  m.name = 'bushes';
  return m;
}

/** Ягоды всей поляны: один `InstancedMesh`, цвет и место каждой — свои. Цвет двигает игра. */
export function berriesMesh(count: number): THREE.InstancedMesh {
  // Двадцать граней на ягоду: в четыре сантиметра больше не видно, а сто ягод — уже две тысячи треугольников.
  const geo = new THREE.IcosahedronGeometry(0.5, 0);
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  m.name = 'berries';
  m.castShadow = false;
  m.receiveShadow = true;
  return m;
}

/** Загон: столбы по кругу и две жерди между ними. Одним мешем. */
export function penMesh(): THREE.Mesh {
  const parts: K.Part[] = [];
  const posts = 28;
  const post = tint(0x5e4130);
  const rail = tint(0x8a6444);
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const x = Math.cos(a) * PEN_R;
    const z = Math.sin(a) * PEN_R;
    parts.push(K.cyl(0.06, 0.075, 1.25, post, 5, x, 0.62, z, undefined, K.GROUND_AO));
    const b = ((i + 1) / posts) * Math.PI * 2;
    const len = 2 * PEN_R * Math.sin(Math.PI / posts) + 0.12;
    const mx = Math.cos((a + b) / 2) * PEN_R * Math.cos(Math.PI / posts);
    const mz = Math.sin((a + b) / 2) * PEN_R * Math.cos(Math.PI / posts);
    for (const y of [0.55, 1.0]) parts.push(K.cyl(0.035, 0.035, len, rail, 5, mx, y, mz, { z: Math.PI / 2, y: -(a + b) / 2 + Math.PI / 2 }));
  }
  const m = K.assemble(parts);
  m.name = 'pen';
  return m;
}

/** Солома: насыщенная — утреннее солнце в спину выбеливало прежний светлый тон до яичной скорлупы (снимок `b1`). */
const HAY_TINT = 0xb98d42;
const HAY_DARK = 0x8f6a33;
/** Шапка стога темнее: верх мокнет и выгорает. */
const HAY_TOP = 0x9a7a45;

/** Стог посредине загона: копна на жердях. */
export function hayMesh(): THREE.Mesh {
  const parts: K.Part[] = [];
  // Копна — низкий купол и шапка: стог, а не яйцо. Жердь торчит из макушки.
  const g = new THREE.CylinderGeometry(HAY.r * 0.8, HAY.r, 0.9, 9);
  parts.push(K.place(g, tint(HAY_TINT), HAY.x, 0.45, HAY.z, undefined, { base: [0.72, 0.68, 0.62], y0: 0, y1: 0.9 }));
  parts.push(K.cone(HAY.r * 0.82, 0.75, tint(HAY_TOP), 9, HAY.x, 0.9 + 0.37, HAY.z));
  parts.push(K.cyl(0.025, 0.025, 0.6, tint(0x5e4130), 4, HAY.x, 1.6, HAY.z));
  // Клочья у подножия: из стога берут, и он это показывает.
  for (let k = 0; k < 6; k++) {
    const a = k * 1.1 + 0.3;
    const t = new THREE.IcosahedronGeometry(0.16, 0);
    t.scale(1.4, 0.45, 1);
    parts.push(K.place(t, tint(k % 2 ? HAY_TINT : HAY_DARK), HAY.x + Math.cos(a) * (HAY.r + 0.15), 0.05, HAY.z + Math.sin(a) * (HAY.r + 0.15), { y: a }));
  }
  const m = K.assemble(parts);
  m.name = 'hay';
  return m;
}

/**
 * Охапка в руках: висит на камере внизу кадра. Пучки соломы — вытянутые и тонкие, вразнобой, светлые концы торчат: охапка
 * сена, а не глыбы (снимок `b2`).
 */
export function armful(): THREE.Mesh {
  const parts: K.Part[] = [];
  for (let k = 0; k < 11; k++) {
    const g = new THREE.IcosahedronGeometry(0.1, 0);
    g.scale(2.6, 0.32, 0.7);
    const x = ((k % 5) - 2) * 0.055;
    const y = (k % 3) * 0.028 - 0.01;
    const z = ((k * 3) % 4) * 0.025 - 0.035;
    parts.push(K.place(g, tint(k % 3 === 0 ? HAY_DARK : k % 3 === 1 ? HAY_TINT : 0xd2ad62), x, y, z, { y: (k - 5) * 0.23, z: ((k % 4) - 1.5) * 0.12 }));
  }
  const m = K.assemble(parts);
  m.name = 'armful';
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/** Масти: шерсть, голова и ноги, рога. */
interface Coat {
  body: number;
  belly: number;
  head: number;
  legs: number;
  horn: number;
  patch?: number;
}

const COATS: Record<BeastKind, Coat> = {
  sheep: { body: 0xe4dccb, belly: 0xcfc5b0, head: 0x2f2a2c, legs: 0x2f2a2c, horn: 0xcdbf9f },
  goat: { body: 0x8b6a4c, belly: 0xd8cfbf, head: 0x7a5a40, legs: 0x4a3a2c, horn: 0xbfb08c },
  cow: { body: 0x7a4f33, belly: 0xe6dfd0, head: 0x6c452c, legs: 0x5a3b26, horn: 0xe0d6bc, patch: 0xe9e3d6 },
};

/** Высота спины — от неё стоит зверь; ноги — ниже. */
export const BACK: Record<BeastKind, number> = { sheep: 0.72, goat: 0.74, cow: 1.3 };
/** Длина ног: столько опускается лёгшее. */
export const LEGS: Record<BeastKind, number> = { sheep: 0.36, goat: 0.42, cow: 0.68 };

/**
 * Животное: туловище с головой — один меш, ноги — второй. Двух хватает: идущее качается туловищем, лёгшее опускает
 * его на длину ног, а ноги прячет. Голова смотрит вдоль +Z — сцена поворачивает зверя по ходу (`herd.roamYaw`).
 */
export function beast(kind: BeastKind): THREE.Group {
  const c = COATS[kind];
  const back = BACK[kind];
  const leg = LEGS[kind];
  const body: K.Part[] = [];
  const legs: K.Part[] = [];
  const wool = tint(c.body);
  if (kind === 'sheep') {
    const g = new THREE.IcosahedronGeometry(0.36, 1);
    g.scale(0.95, 0.85, 1.35);
    body.push(K.place(g, wool, 0, back - 0.26, 0));
    const tuft = new THREE.IcosahedronGeometry(0.17, 0);
    body.push(K.place(tuft, wool, 0, back - 0.02, 0.32));
    body.push(K.box(0.16, 0.2, 0.26, tint(c.head), 0, back - 0.12, 0.55, { x: 0.35 }));
    for (const sx of [-1, 1]) body.push(K.box(0.12, 0.04, 0.06, tint(c.head), sx * 0.12, back - 0.04, 0.5, { z: sx * 0.4 }));
  } else if (kind === 'goat') {
    body.push(K.box(0.3, 0.32, 0.72, wool, 0, back - 0.18, 0));
    body.push(K.box(0.26, 0.1, 0.62, tint(c.belly), 0, back - 0.36, 0.02));
    body.push(K.cyl(0.08, 0.1, 0.36, wool, 5, 0, back - 0.02, 0.4, { x: -0.6 }));
    body.push(K.box(0.15, 0.17, 0.3, tint(c.head), 0, back + 0.12, 0.56, { x: 0.5 }));
    body.push(K.cone(0.04, 0.14, tint(0x3a2e24), 4, 0, back - 0.03, 0.66, { x: Math.PI }));
    for (const sx of [-1, 1]) {
      body.push(K.cyl(0.012, 0.028, 0.26, tint(c.horn), 4, sx * 0.05, back + 0.3, 0.48, { x: -0.7, z: sx * 0.15 }));
      body.push(K.box(0.1, 0.035, 0.05, tint(c.head), sx * 0.11, back + 0.14, 0.5, { z: sx * 0.5 }));
    }
    body.push(K.box(0.05, 0.14, 0.05, wool, 0, back - 0.02, -0.38, { x: -0.6 }));
  } else {
    body.push(K.box(0.62, 0.62, 1.4, wool, 0, back - 0.32, 0));
    body.push(K.box(0.5, 0.16, 1.1, tint(c.belly), 0, back - 0.62, 0.05));
    // Пятна — белые доски поверх бока: пёстрая корова читается коровой с любого края загона.
    if (c.patch !== undefined)
      for (const [x, y, z, w, h, d] of [
        [0.32, back - 0.25, 0.25, 0.02, 0.32, 0.42],
        [-0.32, back - 0.35, -0.3, 0.02, 0.28, 0.36],
        [0, back + 0.005, -0.15, 0.4, 0.02, 0.4],
      ] as const)
        body.push(K.box(w, h, d, tint(c.patch), x, y, z));
    body.push(K.box(0.3, 0.34, 0.46, tint(c.head), 0, back - 0.2, 0.86, { x: 0.25 }));
    body.push(K.box(0.24, 0.16, 0.12, tint(0xb9908a), 0, back - 0.34, 1.07, { x: 0.25 }));
    for (const sx of [-1, 1]) {
      body.push(K.cyl(0.02, 0.035, 0.24, tint(c.horn), 4, sx * 0.2, back - 0.02, 0.8, { z: sx * 1.2 }));
      body.push(K.box(0.14, 0.05, 0.08, tint(c.head), sx * 0.21, back - 0.12, 0.78, { z: sx * 0.3 }));
    }
    body.push(K.cyl(0.02, 0.025, 0.7, wool, 4, 0, back - 0.5, -0.72, { x: 0.2 }));
    body.push(K.box(0.2, 0.12, 0.2, tint(0xd4a6a0), 0, back - 0.7, -0.3));
  }
  const spread = kind === 'cow' ? 0.2 : 0.1;
  const front = kind === 'cow' ? 0.5 : 0.26;
  const rear = kind === 'cow' ? -0.5 : -0.24;
  const thick = kind === 'cow' ? 0.065 : 0.032;
  for (const sx of [-1, 1]) for (const z of [front, rear]) legs.push(K.cyl(thick, thick * 0.8, leg + 0.06, tint(c.legs), 5, sx * spread, leg / 2, z, undefined, K.GROUND_AO));
  const g = new THREE.Group();
  g.name = kind;
  const torso = K.assemble(body);
  torso.name = 'torso';
  const feet = K.assemble(legs);
  feet.name = 'legs';
  feet.castShadow = false;
  g.add(torso, feet);
  g.userData.r = BEASTS[kind].r;
  return g;
}

/** Где растут пучки: сколько их и в каком кольце вокруг какой точки. Поляна — до тринадцати метров от середины. */
export interface TuftArea {
  count: number;
  from: number;
  to: number;
  x: number;
  z: number;
}

const GLADE_TUFTS: TuftArea = { count: 300, from: 1, to: 13.2, x: 0, z: 0 };

/**
 * Трава пучками — по сезону города: летом зелёная, осенью бурая, зимой солома из-под снега. Своя, а не подлесок
 * поляны (`prologue/models.undergrowth`): у той трава всегда зимняя, и летом читалась чёрными иглами. Поле «Охоты»
 * шире поляны — у него своё кольцо (`area`), вокруг охотника.
 */
export function tufts(season: Season, keep: readonly { x: number; z: number; r: number }[], area: TuftArea = GLADE_TUFTS): THREE.Mesh {
  const parts: K.Part[] = [];
  const hue = GRASS[season];
  for (let i = 0; i < area.count; i++) {
    const a = hash(i, 401) * Math.PI * 2;
    const r = area.from + Math.sqrt(hash(i, 403)) * (area.to - area.from);
    const x = area.x + Math.cos(a) * r;
    const z = area.z + Math.sin(a) * r;
    if (keep.some((k) => Math.hypot(x - k.x, z - k.z) < k.r)) continue;
    const h = 0.16 + hash(i, 405) * 0.18;
    const paint = tint(hue[Math.floor(hash(i, 407) * hue.length)]);
    for (let b = 0; b < 3; b++) {
      const ba = hash(i, 409 + b) * Math.PI * 2;
      const w = 0.04;
      const dx = Math.cos(ba);
      const dz = Math.sin(ba);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([-dz * w, 0, dx * w, dz * w, 0, -dx * w, dx * 0.12 * h, h, dz * 0.12 * h], 3));
      geo.computeVertexNormals();
      parts.push(K.place(geo, paint, x, 0, z, undefined, { base: [0.8, 0.84, 0.88], y0: 0, y1: h }));
    }
  }
  const m = K.assemble(parts);
  m.name = 'grass';
  m.castShadow = false;
  return m;
}

/** Цвета травы по сезону: три оттенка на пучки. */
const GRASS: Record<Season, readonly number[]> = {
  spring: [0x7db04f, 0x6a9e45, 0x8fbf5a],
  summer: [0x6f9f45, 0x5e8f3c, 0x84ad4e],
  autumn: [0xa98a45, 0x8f7a3e, 0xb89a52],
  winter: [0xcfa85e, 0xb08a4c, 0xd9c08a],
};

/** Кольцо под тем, что тронет тап: видно, к чему подошёл. Цвет действия (`--accent`). */
export function aimRing(): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.93, 1, 40),
    new THREE.MeshBasicMaterial({ color: 0xe0a040, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false, fog: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.name = 'aim';
  m.renderOrder = 2;
  m.visible = false;
  return m;
}
