/**
 * Места «Ягод» и «Скота»: лесная поляна и загон на лугу (docs/polish.md, П-4).
 *
 * Обставляет одна функция на место (`gladeLand`, `penLand`) — и сцена, и тест бюджета (`world.furnish` → `Play.land`).
 * Всё — копиями (`nature.scatter`): роща одной породы — вызов на кору и вызов на крону, трава — один вызов на всю
 * поляну. Подробность — по ступени входа (`Play.dress`): на телефоне травы и деревьев меньше, на полу — ещё меньше.
 *
 *   поляна  — подстилка леса к опушке, мох, листва, свет середины; кольцо ели с липой и берёзой, дальний ельник;
 *             трава пучками и цветы пятнами, камни во мху, папоротник у опушки, валежина, пень, грибы;
 *   загон   — луг вокруг, внутри выбито копытами: тропа вдоль жердей и грязь у стога; трава снаружи густая и
 *             высокая, внутри — съеденная; за загоном — колода с водой и навес.
 */
import * as THREE from 'three';
import type { Season } from '@/game/types';
import type { Tier } from '@/prologue/look';
import type { Shade } from '@/prologue/models';
import { Sculpt, rigid, smooth } from './fauna';
import { mix, noise3 } from './beasts';
import { NatureMats, bloomSpots, flower, grassClump, grassSpots, grove, groundDisk, groundY, rnd, rock, scatter, treeSpots, SOIL, type Detail, type Keep, type Spot, type TreeKind } from './nature';

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Сколько всего на ступени: пучков травы, цветов и подробность лепки деревьев. */
export interface Density {
  grass: number;
  bloom: number;
  /** Лепка ближних деревьев и камней, дальних деревьев и земли. */
  near: Detail;
  far: Detail;
  ground: Detail;
}

export const DENSITY: Record<Tier, Density> = {
  full: { grass: 2600, bloom: 260, near: 'hi', far: 'lo', ground: 'hi' },
  lite: { grass: 1150, bloom: 150, near: 'hi', far: 'lo', ground: 'lo' },
  base: { grass: 650, bloom: 90, near: 'lo', far: 'lo', ground: 'lo' },
};

// ---------- Мелочи леса ----------

/** Папоротник: вайи дугой из середины, перья — зубцами по краю; высота 1. */
function fern(seed: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const _c = new THREE.Color();
  const put = (p: THREE.Vector3, hex: number): void => {
    pos.push(p.x, p.y, p.z);
    _c.setHex(hex);
    col.push(_c.r, _c.g, _c.b);
    nor.push(0, 1, 0);
  };
  const fronds = 7;
  for (let k = 0; k < fronds; k++) {
    const a = (k / fronds) * Math.PI * 2 + rnd(seed, k) * 0.6;
    const len = 0.75 + 0.3 * rnd(k, seed);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const at = (t: number): THREE.Vector3 => V(ca * t * len, Math.sin(t * Math.PI * 0.8) * 0.55 * len + 0.02, sa * t * len);
    const N = 6;
    for (let i = 0; i < N; i++) {
      const t0 = i / N;
      const t1 = (i + 1) / N;
      const p0 = at(t0);
      const p1 = at(t1);
      const w = 0.12 * (1 - t0 * 0.8);
      // Перо — ромбом поперёк вайи: зубцы по краю, а не лента.
      const sx = -sa * w;
      const sz = ca * w;
      const m = p0.clone().lerp(p1, 0.5);
      const c0 = mix(0x2e5426, 0x6a9a3e, t0);
      const c1 = mix(0x2e5426, 0x6a9a3e, t1);
      put(p0, c0);
      put(V(m.x + sx, m.y - 0.02, m.z + sz), c1);
      put(p1, c1);
      put(p0, c0);
      put(p1, c1);
      put(V(m.x - sx, m.y - 0.02, m.z - sz), c1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Валежина: ствол на земле, мох сверху, торец светлый с кольцами; длина 1 вдоль X. */
function log(): THREE.BufferGeometry {
  const s = new Sculpt();
  s.tube([V(-0.5, 0.11, 0), V(0, 0.12, 0.02), V(0.5, 0.1, 0)], [0.12, 0.115, 0.1], {
    seg: 10,
    up: V(0, 1, 0),
    color: (_u, a, p) => mix(mix(0x4a3628, 0x6a5240, noise3(p.x * 9, p.y * 9, p.z * 9)), 0x4a6a2a, smooth(0.5, 0.9, Math.cos(a)) * smooth(0.4, 0.7, noise3(p.x * 3, 0, p.z * 3))),
    skin: rigid(0),
    caps: [0, 0],
  });
  return s.geometry({ under: 0.5, ground: 0.6, groundUp: 0.15 });
}

/** Пень: короткий ствол с корнями и светлым спилом. */
function stump(): THREE.BufferGeometry {
  const s = new Sculpt();
  s.tube([V(0, -0.02, 0), V(0, 0.18, 0), V(0, 0.32, 0)], [0.24, 0.17, 0.16], { seg: 10, color: (u) => mix(0x3a2a20, 0x5a4232, u), skin: rigid(0), caps: [null, 0] });
  s.blob(V(0, 0.33, 0), V(0.155, 0.012, 0.155), new THREE.Euler(), (p) => mix(0xc9a77a, 0x8a6a48, Math.abs(Math.sin(Math.hypot(p.x, p.z) * 60))), rigid(0), 10, 4);
  for (let k = 0; k < 4; k++) {
    const a = k * 1.6 + 0.4;
    s.tube([V(Math.cos(a) * 0.12, 0.1, Math.sin(a) * 0.12), V(Math.cos(a) * 0.3, 0.02, Math.sin(a) * 0.3)], [0.06, 0.025], { seg: 5, color: 0x3a2a20, skin: rigid(0), caps: [null, 0.4] });
  }
  return s.geometry({ under: 0.5, ground: 0.55, groundUp: 0.2 });
}

/** Гриб: ножка и шляпка; мухомор — красный в белых точках, боровик — бурый. */
function mushroom(red: boolean): THREE.BufferGeometry {
  const s = new Sculpt();
  s.tube([V(0, 0, 0), V(0, 0.07, 0), V(0, 0.12, 0)], [0.018, 0.015, 0.014], { seg: 6, color: 0xeee6d6, skin: rigid(0), caps: [null, 0.3] });
  s.blob(V(0, 0.125, 0), V(0.055, 0.032, 0.055), new THREE.Euler(), (p) => (red ? (noise3(p.x * 90, p.y * 90, p.z * 90) > 0.72 && p.y > 0.13 ? 0xf4efe4 : 0xc8261c) : mix(0x6a4022, 0x8a5a32, noise3(p.x * 40, 0, p.z * 40))), rigid(0), 8, 5);
  return s.geometry({ under: 0.7, ground: 0.8, groundUp: 0.05 });
}

/** Копии мелочи по местам. */
function things(geo: THREE.BufferGeometry, mats: NatureMats, kind: 'leaf' | 'bark' | 'rock' | 'grass', spots: Spot[], name: string, shadow: boolean): THREE.InstancedMesh | null {
  return scatter(geo, mats.of(kind), spots, name, shadow);
}

/** Места кольцом между `from` и `to`, мимо `keep`. */
function ringSpots(n: number, from: number, to: number, keep: readonly Keep[], seed: number, h0: number, h1: number): Spot[] {
  const out: Spot[] = [];
  for (let i = 0; i < n * 3 && out.length < n; i++) {
    const a = rnd(i, seed) * Math.PI * 2;
    const r = from + (to - from) * rnd(i, seed + 1);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (keep.some((k) => Math.hypot(x - k.x, z - k.z) < k.r)) continue;
    out.push({ x, z, yaw: rnd(i, seed + 2) * Math.PI * 2, h: h0 + (h1 - h0) * rnd(i, seed + 3) });
  }
  return out;
}

/** Дальний ельник: зубцы силуэтом по кругу — лесу за лесом хватает силуэта, треугольники там не видны. */
function farBand(R: number, season: Season): THREE.BufferGeometry {
  const teeth = 160;
  const pos: number[] = [];
  const col: number[] = [];
  const _c = new THREE.Color();
  const deep = season === 'winter' ? 0x2a3a30 : 0x1e3424;
  const top = season === 'winter' ? 0x4a5a50 : 0x2e4a32;
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 1) / teeth) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    // Сплошная часть — до трёх четвертей роста: просвет неба между зубцами начинается выше крон ближнего леса, а не
    // под ними (там он читался белой «сосулькой» — находка снимка П-4).
    const h = 12 + rnd(i, 77) * 8;
    const sh = h * 0.78;
    const put = (a: number, y: number, hex: number): void => {
      pos.push(Math.cos(a) * R, y, Math.sin(a) * R);
      _c.setHex(hex);
      col.push(_c.r, _c.g, _c.b);
    };
    // Изнутри: лицо к середине.
    put(a0, -1, deep);
    put(a1, -1, deep);
    put(a1, sh, deep);
    put(a0, -1, deep);
    put(a1, sh, deep);
    put(a0, sh, deep);
    put(a0, sh, deep);
    put(a1, sh, deep);
    put(am, h, top);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

// ---------- Обстановка ----------

/** Что положить на место и чем: материалы, ступень, сезон, зерно и то, где ничему не расти. */
export interface Lay {
  scene: THREE.Scene;
  mats: NatureMats;
  shade: Shade;
  season: Season;
  density: Density;
  seed: number;
  keep: readonly Keep[];
}

function add(scene: THREE.Scene, ...xs: (THREE.Object3D | null)[]): void {
  for (const x of xs) if (x) scene.add(x);
}

/** Лес кругом: ближнее кольцо — подробно, дальнее — проще, за ним — силуэт. Пятна тени — под ближними. */
/** Поставить деревья на землю: ствол чуть утоплен — на холме дерево не висит. */
function onGround(spots: Record<TreeKind, Spot[]>, y: (x: number, z: number) => number): Record<TreeKind, Spot[]> {
  for (const k of ['spruce', 'broadleaf', 'birch'] as const) for (const s of spots[k]) s.y = y(s.x, s.z) - 0.12;
  return spots;
}

function forest(l: Lay, from: number, mix3: readonly [number, number, number], flat: number): void {
  const y = groundY(flat, l.seed);
  // Опушка — два редких ряда подробно, за ней — ряд проще; дальше лес — силуэтом (`farBand`).
  const near = onGround(treeSpots({ from, to: from + 5.5, step: 4.3, mix: mix3, h0: 7.5, h1: 11.5 }, 0, 0, l.keep, l.seed), y);
  const far = onGround(treeSpots({ from: from + 8, to: from + 12, step: 5.2, mix: [0.8, 0.12, 0.08], h0: 9, h1: 13 }, 0, 0, l.keep, l.seed + 50), y);
  for (const k of ['spruce', 'broadleaf', 'birch'] as const)
    for (const s of near[k]) l.shade.add(s.x, s.z, 0.28 * (s.w ?? s.h), 0.28 * (s.w ?? s.h), s.yaw);
  add(l.scene, grove(near, l.mats, l.season, l.density.near, l.seed, false), grove(far, l.mats, l.season, l.density.far, l.seed + 7, false));
  const band = new THREE.Mesh(farBand(from + 20, l.season), l.mats.of('needle'));
  band.name = 'band';
  l.scene.add(band);
}

/** Трава и цветы в кругу `R`: трава — ростом `h0..h1`, цветы пятнами. */
function meadow(l: Lay, from: number, R: number, h0: number, h1: number, count = l.density.grass, seed = l.seed): void {
  const g = scatter(grassClump(9, l.season, seed), l.mats.of('grass'), grassSpots(count, 0, 0, from, R, h0, h1, l.keep, seed), 'grass');
  const b = scatter(flower(), l.mats.of('grass'), bloomSpots(l.density.bloom, 0, 0, from + 0.5, R, l.season, l.keep, seed + 9), 'bloom');
  add(l.scene, g, b);
}

/**
 * Лесная поляна «Ягод»: светлая середина, к опушке — мох и листва; лес кругом; трава, цветы, папоротник, камни,
 * валежина, пень и грибы. Кусты с ягодами ставит игра.
 */
export function gladeLand(l: Lay): void {
  const s = SOIL[l.season];
  const paint = (x: number, z: number): number => {
    const r = Math.hypot(x, z);
    const n = noise3(x * 0.22, 0, z * 0.22);
    const m = noise3(x * 0.9 + 4, 0, z * 0.9);
    // Середина — трава на солнце; к опушке — мох и прошлогодний лист.
    const edge = smooth(9, 15, r + (n - 0.5) * 4);
    const grass = mix(s.lush, s.dry, smooth(0.55, 0.8, m) * 0.6);
    const floor = mix(s.moss, s.litter, smooth(0.4, 0.7, n));
    return mix(grass, floor, edge);
  };
  const ground = new THREE.Mesh(groundDisk(70, 14, paint, l.density.ground, l.seed), l.mats.of('ground'));
  ground.name = 'ground';
  ground.receiveShadow = true;
  l.scene.add(ground);
  forest(l, 15, [0.55, 0.27, 0.18], 14);
  meadow(l, 0.8, 14.5, 0.22, 0.48);
  const edge = [{ x: 0, z: 0, r: 13.2 }];
  add(
    l.scene,
    things(fern(l.seed), l.mats, 'leaf', ringSpots(26, 12.6, 16, l.keep, l.seed + 3, 0.55, 0.9), 'ferns', false),
    things(rock(l.seed, l.density.near), l.mats, 'rock', ringSpots(5, 11.5, 15, [...l.keep, ...edge.filter(() => false)], l.seed + 4, 0.5, 1.1), 'rocks', true),
    things(log(), l.mats, 'bark', ringSpots(1, 12.8, 14, l.keep, l.seed + 5, 3.2, 3.8), 'log', true),
    things(stump(), l.mats, 'bark', ringSpots(2, 12.5, 14.5, l.keep, l.seed + 6, 0.9, 1.2), 'stumps', true),
    things(mushroom(true), l.mats, 'bark', ringSpots(7, 12, 15, l.keep, l.seed + 7, 0.8, 1.3), 'amanita', false),
    things(mushroom(false), l.mats, 'bark', ringSpots(6, 11, 15, l.keep, l.seed + 8, 0.9, 1.4), 'boletus', false),
  );
}

/** Где в загоне выбито копытами: тропа вдоль жердей и круг у стога, пятнами. */
export function trodden(x: number, z: number, penR: number, hayR: number): number {
  const r = Math.hypot(x, z);
  const n = noise3(x * 0.6, 0, z * 0.6);
  const fence = smooth(1.6, 0.4, Math.abs(r - (penR - 0.9)) + (n - 0.5) * 0.8);
  const hay = smooth(hayR + 1.4, hayR + 0.3, r + (n - 0.5) * 0.6);
  const inside = r < penR ? 0.35 * smooth(0.45, 0.8, n) : 0;
  return Math.min(1, Math.max(fence, hay, inside));
}

/** Колода с водой и навес за жердями: двор живёт, а не стоит загон посреди пустого луга. */
function yard(at: { x: number; z: number; yaw: number }): THREE.BufferGeometry {
  const s = new Sculpt();
  const wood = (_u: number, _a: number, p: THREE.Vector3): number => mix(0x5a4430, 0x7a5e40, noise3(p.x * 8, p.y * 8, p.z * 8));
  // Колода: долблёное корыто на двух чурках, вода — тёмная гладь в нём.
  s.loft(
    [
      { c: V(-0.9, 0.42, 0), rx: 0.3, ry: 0.2 },
      { c: V(-0.85, 0.42, 0), rx: 0.32, ry: 0.22 },
      { c: V(0.85, 0.42, 0), rx: 0.32, ry: 0.22 },
      { c: V(0.9, 0.42, 0), rx: 0.3, ry: 0.2 },
    ],
    { seg: 10, up: V(0, 1, 0), box: 2.6, color: wood, skin: rigid(0), caps: [0, 0] },
  );
  s.blob(V(0, 0.6, 0), V(0.82, 0.02, 0.22), new THREE.Euler(), 0x2e3e44, rigid(0), 10, 3);
  for (const x of [-0.6, 0.6]) s.tube([V(x, 0, 0), V(x, 0.26, 0)], [0.16, 0.15], { seg: 8, color: wood, skin: rigid(0), caps: [null, 0] });
  // Навес: четыре столба и скат из жердей с соломой.
  const nx = 2.4;
  for (const [x, z, h] of [
    [nx - 1, -1.8, 1.9],
    [nx + 1.2, -1.8, 1.9],
    [nx - 1, -3.6, 1.4],
    [nx + 1.2, -3.6, 1.4],
  ] as const)
    s.tube([V(x, 0, z), V(x, h, z)], [0.07, 0.06], { seg: 6, color: wood, skin: rigid(0), caps: [null, 0.3] });
  s.loft(
    [
      { c: V(nx - 1.3, 1.95, -2.7), rx: 0.08, ry: 1.25 },
      { c: V(nx + 1.5, 1.95, -2.7), rx: 0.08, ry: 1.25 },
    ],
    { seg: 4, up: V(0, 0.28, -1).normalize(), box: 8, color: (_u, _a, p) => mix(0x9a7a42, 0xc8a45a, noise3(p.x * 6, p.y * 6, p.z * 6)), skin: rigid(0), caps: [0, 0] },
  );
  const g = s.geometry({ under: 0.6, ground: 0.6, groundUp: 0.3 });
  g.rotateY(at.yaw);
  g.translate(at.x, 0, at.z);
  return g;
}

/**
 * Загон «Скота» на лугу: внутри выбито, снаружи — луг с цветами; лес — дальше, чем у ягод: вокруг выпас. За жердями
 * — колода и навес. Жерди и стог ставит игра.
 */
export function penLand(l: Lay, penR: number, hayR: number): void {
  const s = SOIL[l.season];
  const paint = (x: number, z: number): number => {
    const n = noise3(x * 0.25, 0, z * 0.25);
    const m = noise3(x * 1.1 + 3, 0, z * 1.1);
    const field = mix(s.lush, s.dry, smooth(0.5, 0.85, n) * 0.7);
    const t = trodden(x, z, penR, hayR);
    return mix(field, mix(s.trodden, s.mud, smooth(0.5, 0.8, m)), t);
  };
  const ground = new THREE.Mesh(groundDisk(70, penR + 6, paint, l.density.ground, l.seed), l.mats.of('ground'));
  ground.name = 'ground';
  ground.receiveShadow = true;
  l.scene.add(ground);
  forest(l, 18, [0.5, 0.3, 0.2], penR + 6);
  // Внутри — съеденная трава, реже и ниже; снаружи — луг по колено.
  const inside = Math.round(l.density.grass * 0.35);
  const keepIn = [...l.keep, { x: 0, z: 0, r: hayR + 1.2 }];
  const gIn = scatter(grassClump(7, l.season, l.seed + 1), l.mats.of('grass'), grassSpots(inside, 0, 0, hayR + 1, penR - 0.6, 0.12, 0.24, keepIn, l.seed + 1).filter((p) => trodden(p.x, p.z, penR, hayR) < 0.5), 'grass-in');
  add(l.scene, gIn);
  meadow(l, penR + 0.4, 17.5, 0.3, 0.62, l.density.grass - inside, l.seed + 2);
  const yaw = rnd(l.seed, 5) * Math.PI * 2;
  const at = { x: Math.cos(yaw) * (penR + 2.2), z: Math.sin(yaw) * (penR + 2.2), yaw: -yaw + Math.PI / 2 };
  const y = new THREE.Mesh(yard(at), l.mats.of('bark'));
  y.name = 'yard';
  y.castShadow = true;
  y.receiveShadow = true;
  l.scene.add(y);
  l.shade.add(at.x, at.z, 1.2, 1.2);
  add(l.scene, things(rock(l.seed + 2, l.density.near), l.mats, 'rock', ringSpots(4, penR + 3, 16, l.keep, l.seed + 4, 0.5, 1.2), 'rocks', true));
}

/**
 * Поле «Охоты»: луг до опушки — ровный, где ходят олени и летят стрелы (`hunt.FIELD_R`, `ESCAPE_R`); за ним — лес от
 * той черты, где в стволы втыкается стрела (`hunt.FOREST_IN`), и силуэт ельника. Трава — вокруг охотника, цветы —
 * пятнами по всему полю. Укрытия (ели, берёзы, кусты) ставит игра — по числам попадания (`huntModels.coverGroup`).
 */
export function meadowLand(l: Lay, flat: number, wall: number, near: { x: number; z: number }): void {
  const s = SOIL[l.season];
  const paint = (x: number, z: number): number => {
    const n = noise3(x * 0.08, 0, z * 0.08);
    const m = noise3(x * 0.3 + 7, 0, z * 0.3);
    const r = Math.hypot(x, z);
    const field = mix(mix(s.lush, s.dry, smooth(0.45, 0.8, n) * 0.75), mix(s.lush, 0x3e6a28, 0.4), smooth(0.6, 0.85, m) * 0.5);
    return mix(field, s.moss, smooth(wall - 4, wall + 2, r + (m - 0.5) * 5));
  };
  const ground = new THREE.Mesh(groundDisk(72, flat, paint, l.density.ground, l.seed), l.mats.of('ground'));
  ground.name = 'ground';
  ground.receiveShadow = true;
  l.scene.add(ground);
  // Опушка поля — один ряд: на пятидесяти метрах дерево — силуэт, второй ряд закрывает гребёнка (`farBand`).
  const spots = onGround(treeSpots({ from: wall + 1, to: wall + 3, step: 4.6, mix: [0.74, 0.16, 0.1], h0: 9.5, h1: 14 }, 0, 0, l.keep, l.seed), groundY(flat, l.seed));
  add(l.scene, grove(spots, l.mats, l.season, l.density.near === 'hi' && l.density.ground === 'hi' ? 'hi' : 'lo', l.seed, false));
  const band = new THREE.Mesh(farBand(wall + 16, l.season), l.mats.of('needle'));
  band.name = 'band';
  l.scene.add(band);
  // Трава — вокруг охотника, гуще у ног; дальше поле читается землёй и цветами.
  const g = scatter(grassClump(9, l.season, l.seed), l.mats.of('grass'), grassSpots(l.density.grass, near.x, near.z, 0.6, 26, 0.28, 0.62, l.keep, l.seed), 'grass');
  const b = scatter(flower(), l.mats.of('grass'), bloomSpots(Math.round(l.density.bloom * 1.6), 0, 0, 2, flat - 4, l.season, l.keep, l.seed + 9), 'bloom');
  add(l.scene, g, b, things(rock(l.seed + 2, 'lo'), l.mats, 'rock', ringSpots(6, wall - 3, wall + 1, l.keep, l.seed + 4, 0.7, 1.5), 'rocks', false));
}
