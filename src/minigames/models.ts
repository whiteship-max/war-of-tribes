/**
 * Модели промыслов: кусты с ягодами, загон, стог и охапка в руках. Звери — свой модуль (`beasts.ts`).
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
import { Sculpt, rigid, smooth } from './fauna';
import { mix, noise3 } from './beasts';
import { soften } from './nature';
import { HAY, PEN_R } from './herd';
import { hash } from '@/prologue/glade';
import type { Season } from '@/game/types';

const tint = (hex: number): K.Paint => ({ mat: KIT.body, tint: new THREE.Color(hex) });

/** Листва кустов по виду: черника светлее и мельче, брусника тёмная и глянцевая, малина — светлая зелень на бурых стеблях. */
const LEAF: Record<BushKind, number> = { bilberry: 0x5d8f45, cowberry: 0x417a3e, raspberry: 0x6aa04d, strawberry: 0x4c8f3a };
const CANE = 0x6f4a35;

/** Спелая ягода по виду и зелёная — от неё ягода краснеет (синеет) по ходу игры (`berries.blush`). */
// Земляника — алая, ярче брусники и малины, а зелёная — белёсая: редкий куст читается с края поляны.
export const BERRY_RIPE: Record<BushKind, number> = { bilberry: 0x26326e, cowberry: 0xbd2235, raspberry: 0xd23a52, strawberry: 0xf0301e };
export const BERRY_GREEN: Record<BushKind, number> = { bilberry: 0x8db55a, cowberry: 0xb7c76a, raspberry: 0xd4d98a, strawberry: 0xe8e4c2 };
/** Ягода — сколько в поперечнике, м. Крупнее настоящей вдвое: с трёх шагов на телефоне она должна читаться точкой цвета. */
export const BERRY_SIZE: Record<BushKind, number> = { bilberry: 0.07, cowberry: 0.065, raspberry: 0.085, strawberry: 0.08 };

/**
 * Кусты всей поляны — одним мешем, мягкими купами листвы (П-4): нормаль клонится к середине куста, и он светится
 * облаком, а не гранями. Размер — тот же, что у правила (`berries.BUSH_KINDS`): ягоды сидят поверх шапки
 * (`berries.capBerry`), купа — внутри их эллипсоида. Ягоды — отдельно (`berriesMesh`): у них свой цвет на каждую.
 */
export function bushesMesh(bushes: readonly Bush[], mat: THREE.Material): THREE.Mesh {
  const s = new Sculpt();
  const soft: [number, number, THREE.Vector3][] = [];
  const leafOf = (kind: BushKind) => {
    const base = LEAF[kind];
    const deep = mix(base, 0x1a2a14, 0.45);
    const light = mix(base, 0xd8e8a0, 0.3);
    return (p: THREE.Vector3, y0: number, h: number): number => mix(deep, mix(base, light, noise3(p.x * 9, p.y * 9, p.z * 9)), Math.min(1, Math.max(0, (p.y - y0) / h)));
  };
  for (const b of bushes) {
    const look = BUSH_KINDS[b.kind];
    const leaf = leafOf(b.kind);
    const center = new THREE.Vector3(b.x, look.h * 0.45, b.z);
    const from = s.skins.length;
    if (b.kind === 'raspberry') {
      // Малина — пучок стеблей и листва купами по высоте: высокий силуэт виден с другого края поляны.
      for (let k = 0; k < 6; k++) {
        const a = b.yaw + k * 1.05;
        const lean = 0.18 + (k % 3) * 0.06;
        const len = look.h * (0.78 + (k % 2) * 0.08);
        const bx = b.x + Math.cos(a) * 0.12;
        const bz = b.z + Math.sin(a) * 0.12;
        const top = new THREE.Vector3(bx + Math.cos(a) * lean * len * 0.6, len, bz + Math.sin(a) * lean * len * 0.6);
        s.tube([new THREE.Vector3(bx, 0, bz), new THREE.Vector3((bx + top.x) / 2, len * 0.52, (bz + top.z) / 2), top], [0.016, 0.013, 0.008], { seg: 5, color: CANE, skin: rigid(0), caps: [null, 0.4] });
        s.blob(top, new THREE.Vector3(0.12, 0.08, 0.12), new THREE.Euler(0, a, 0), (p) => leaf(p, 0, look.h), rigid(0), 7, 5, (p) => (noise3(p.x * 14, p.y * 14, p.z * 14) - 0.5) * 0.05);
      }
      for (let k = 0; k < 5; k++) {
        const a = b.yaw + k * 1.3;
        const r = 0.3 - k * 0.025;
        s.blob(new THREE.Vector3(b.x + Math.cos(a) * 0.3, 0.38 + k * 0.2, b.z + Math.sin(a) * 0.3), new THREE.Vector3(r * 1.1, r * 0.75, r * 1.1), new THREE.Euler(0, a, 0), (p) => leaf(p, 0, look.h), rigid(0), 9, 6, (p) => (noise3(p.x * 6 + k, p.y * 6, p.z * 6) - 0.5) * r * 0.4);
      }
    } else {
      // Низкий куст — кочка из трёх-четырёх куп внутри эллипсоида ягод: шапка, а не шар.
      for (let k = 0; k < 4; k++) {
        const a = b.yaw + k * 1.7;
        const off = k === 0 ? 0 : look.r * 0.45;
        const rr = look.r * (k === 0 ? 0.8 : 0.58);
        s.blob(new THREE.Vector3(b.x + Math.cos(a) * off, look.h * (k === 0 ? 0.46 : 0.36), b.z + Math.sin(a) * off), new THREE.Vector3(rr, look.h * (k === 0 ? 0.5 : 0.4), rr), new THREE.Euler(0, a, 0), (p) => leaf(p, 0, look.h), rigid(0), 10, 6, (p) => (noise3(p.x * 9 + k, p.y * 9, p.z * 9) - 0.5) * look.r * 0.22);
      }
    }
    soft.push([from, s.skins.length, center]);
  }
  const g = s.geometry({ under: 0.55, ground: 0.6, groundUp: 0.2 });
  for (const [from, to, c] of soft) soften(g, from, to, c, 0.55, 1.3);
  const m = new THREE.Mesh(g, mat);
  m.name = 'bushes';
  m.castShadow = true;
  m.receiveShadow = true;
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

/**
 * Загон: тёсаные столбы по кругу и две жерди между ними — одним мешем (П-4: мягко, а не гранями). Столб не свечка:
 * чуть наклонён и разной высоты, низ темнее — мокнет; жердь — колотое бревно с провисом и обвязкой у столба.
 */
export function penMesh(mat: THREE.Material): THREE.Mesh {
  const s = new Sculpt();
  const posts = 28;
  const wood = (dark: number, light: number) => (_u: number, _a: number, p: THREE.Vector3): number => mix(dark, light, noise3(p.x * 7, p.y * 3, p.z * 7));
  const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const tops: THREE.Vector3[] = [];
  for (let i = 0; i < posts; i++) {
    const a = (i / posts) * Math.PI * 2;
    const x = Math.cos(a) * PEN_R;
    const z = Math.sin(a) * PEN_R;
    const h = 1.18 + 0.14 * hash(i, 31);
    const lx = (hash(i, 33) - 0.5) * 0.06;
    const lz = (hash(i, 35) - 0.5) * 0.06;
    s.tube([V(x, -0.05, z), V(x + lx * 0.5, h * 0.5, z + lz * 0.5), V(x + lx, h, z + lz)], [0.075, 0.066, 0.058], {
      seg: 6,
      color: (u, a2, p) => mix(0x3a2a20, wood(0x5a4434, 0x7a6450)(u, a2, p), smooth(0, 0.25, u)),
      skin: rigid(0),
      caps: [null, 0.5],
    });
    tops.push(V(x, 0, z));
  }
  for (let i = 0; i < posts; i++) {
    const a0 = tops[i];
    const a1 = tops[(i + 1) % posts];
    for (const y of [0.55, 1.0]) {
      const m = a0.clone().lerp(a1, 0.5);
      const sag = 0.025 + 0.02 * hash(i, y * 10);
      s.tube([V(a0.x, y, a0.z), V(m.x, y - sag, m.z), V(a1.x, y, a1.z)], [0.038, 0.036, 0.038], { seg: 5, up: V(0, 1, 0), color: wood(0x6a523c, 0x9a7e5c), skin: rigid(0), caps: [0.3, 0.3] });
    }
  }
  const g = s.geometry({ under: 0.6, ground: 0.55, groundUp: 0.5 });
  const m = new THREE.Mesh(g, mat);
  m.name = 'pen';
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Солома: насыщенная — утреннее солнце в спину выбеливало прежний светлый тон до яичной скорлупы (снимок `b1`). */
const HAY_TINT = 0xb98d42;
const HAY_DARK = 0x8f6a33;
/** Шапка стога темнее: верх мокнет и выгорает. */
const HAY_TOP = 0x9a7a45;

/** Стог посредине загона: копна с торчащей соломой, шапка темнее, жердь из макушки, клочья у подножия. */
export function hayMesh(mat: THREE.Material): THREE.Mesh {
  const s = new Sculpt();
  const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  // Копна — кольцами: широкий низ, покатые бока, шапка; солома — шумом по нормали, пучками.
  const rings = [
    [0.0, 0.95],
    [0.3, 1.0],
    [0.65, 0.92],
    [0.95, 0.72],
    [1.2, 0.45],
    [1.38, 0.18],
    [1.45, 0.04],
  ].map(([y, r]) => ({ c: V(HAY.x, y, HAY.z), rx: r * HAY.r, ry: r * HAY.r }));
  s.loft(rings, {
    seg: 16,
    up: V(1, 0, 0),
    color: (u, _a, p) => mix(mix(HAY_DARK, HAY_TINT, smooth(0, 0.3, u) * (0.6 + 0.4 * noise3(p.x * 8, p.y * 8, p.z * 8))), HAY_TOP, smooth(0.55, 0.8, u)),
    skin: rigid(0),
    bump: (_u, _a, p) => (noise3(p.x * 11, p.y * 4, p.z * 11) - 0.45) * 0.07,
    caps: [0, 0.3],
  });
  s.tube([V(HAY.x, 1.2, HAY.z), V(HAY.x + 0.02, 1.9, HAY.z)], [0.028, 0.022], { seg: 5, color: 0x5e4130, skin: rigid(0), caps: [null, 0.4] });
  // Клочья у подножия: из стога берут, и он это показывает.
  for (let k = 0; k < 7; k++) {
    const a = k * 0.95 + 0.3;
    const at = V(HAY.x + Math.cos(a) * (HAY.r + 0.2), 0.04, HAY.z + Math.sin(a) * (HAY.r + 0.2));
    s.blob(at, V(0.24, 0.05, 0.14), new THREE.Euler(0, a, 0), k % 2 ? HAY_TINT : HAY_DARK, rigid(0), 7, 4, (p) => (noise3(p.x * 20, p.y * 20, p.z * 20) - 0.5) * 0.04);
  }
  const g = s.geometry({ under: 0.6, ground: 0.65, groundUp: 0.4 });
  const m = new THREE.Mesh(g, mat);
  m.name = 'hay';
  m.castShadow = true;
  m.receiveShadow = true;
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
