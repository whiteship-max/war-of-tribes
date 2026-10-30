// Модель лагеря бродяги (ПН-12л, docs/gdd/path_of_sword.md, 5.2, 5.3 и «Решения ПН-12л») — чистая сборка сцены из вида лагеря
// (`world/campsite.campLook`): земля клетки, ступень по людям, огонь, руины, снег и деревья. Света, камеры, кадра и погоды в движении
// здесь нет — их держит сцена (`render/camp/scene.ts`); здесь — только то, что можно собрать и сосчитать без экрана (тест бюджета).
//
// Стиль — набор деталей посёлка: примитивы набора (`render/kit`: короб, цилиндр, конус), склейка в один меш на материал, цвет —
// палитра города (`render/palette`, сезон — `seasonColor`) в вершинах, плоская заливка. Огонь — светящийся материал без света.
//
// Бюджет — треугольники на уровень качества (`CAMP_TRIS`): деревья, сетка земли и капли — по уровню; тест собирает каждый вид на
// каждом уровне и сверяет с бюджетом (`build.test.ts`).
import * as THREE from 'three';
import { assemble, box, cone, cyl, place, type Paint, type Part } from '@/render/kit';
import { PALETTE, seasonColor, type PaletteKey } from '@/render/palette';
import type { Quality } from '@/render/quality';
import type { Season } from '@/game/types';
import type { CampLook } from '@/world/campsite';

/** Потолок треугольников сцены лагеря по уровню качества (земля, лагерь, деревья, руины). */
export const CAMP_TRIS: Record<Quality, number> = { high: 6000, medium: 4200, low: 2800 };

/** Сколько деревьев вокруг лесного лагеря (у прочей земли — треть) по уровню. */
export const TREES: Record<Quality, number> = { high: 48, medium: 32, low: 18 };

/** Ячеек сетки земли на сторону по уровню: холмы и дюны лепятся вершинами. */
const GRID: Record<Quality, number> = { high: 26, medium: 18, low: 12 };

/** Капель дождя и хлопьев снега по уровню (линии и точки — не треугольники). */
export const DROPS: Record<Quality, number> = { high: 700, medium: 450, low: 260 };

/** Полуразмер площадки, м: за ней — дымка. */
export const GROUND_HALF = 30;

const BODY = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, vertexColors: true });
BODY.name = 'camp-body';
const GLOW = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, toneMapped: false });
GLOW.name = 'camp-glow';

const C = new THREE.Color();
const hexMix = (a: number, b: number, k: number): number => C.setHex(a).lerp(new THREE.Color().setHex(b), Math.max(0, Math.min(1, k))).getHex();

/** Краска цветом `hex` (sRGB палитры) на общем теле сцены лагеря. */
const tint = (hex: number): Paint => ({ mat: BODY, tint: new THREE.Color().setHex(hex) });
const glow = (hex: number): Paint => ({ mat: GLOW, tint: new THREE.Color().setHex(hex) });

/** Цвет палитры в сезоне; зима без снега — поздняя осень (снег кладёт `snow`, а не сезон). */
const tone = (season: Season, key: PaletteKey): number => seasonColor(season === 'winter' ? 'autumn' : season, key);

/** Кость сборки — из вида, чтобы тот же лагерь выглядел одинаково (без `Math.random`). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Высота земли в точке: холмы — склон к дальнему краю, пустыня — дюны, берег — сход к воде; середина лагеря ровная. */
export function groundY(look: Pick<CampLook, 'ground'>, x: number, z: number): number {
  const flat = Math.min(1, Math.hypot(x, z) / 7);
  switch (look.ground) {
    case 'hills':
      return (0.42 * -z + 0.28 * x) * (0.35 + 0.65 * flat) + 0.6 * Math.sin(x * 0.35) * flat;
    case 'desert':
      return (0.9 * Math.sin(x * 0.32 + z * 0.12) + 0.5 * Math.sin(z * 0.45)) * flat;
    case 'shore':
      return x < -8 ? -0.35 * Math.min(1, (-8 - x) / 3) : 0.12 * Math.sin(z * 0.4) * flat;
    default:
      return 0.18 * Math.sin(x * 0.4) * Math.cos(z * 0.33) * flat;
  }
}

/** Где на сцене стоят предметы-кнопки: шатёр, костёр, обоз — точки в мире для подписей поверх холста. */
export interface CampAnchors {
  tent: THREE.Vector3;
  fire: THREE.Vector3;
  cargo: THREE.Vector3;
  banner: THREE.Vector3 | null;
}

/** Собранный лагерь: группа сцены, подвижные части и точки предметов. */
export interface CampModel {
  root: THREE.Group;
  /** Пламя (крутит и качает сцена); огня нет — `null`. */
  flame: THREE.Mesh | null;
  /** Полотнище знамени (качает ветер); знамени нет — `null`. */
  flag: THREE.Mesh | null;
  /** Откуда идёт дым; огня нет — `null`. */
  smokeFrom: THREE.Vector3 | null;
  anchors: CampAnchors;
  /** Треугольников в собранном (без капель и дыма). */
  tris: number;
}

/** Ровно опустить деталь на землю в точке `x`, `z`. */
const onGround = (look: CampLook, x: number, z: number): number => groundY(look, x, z);

function groundMesh(look: CampLook, q: Quality): THREE.Mesh {
  const n = GRID[q];
  const g = new THREE.PlaneGeometry(GROUND_HALF * 2, GROUND_HALF * 2, n, n);
  g.rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const base = look.ground === 'desert' ? PALETTE.cut : look.ground === 'ruin' ? tone(look.season, 'trample') : tone(look.season, 'grass');
  const dark = look.ground === 'desert' ? PALETTE.dirt : tone(look.season, 'grassDark');
  const r = rng(0x5eed + n);
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, groundY(look, x, z));
    // Утоптанная середина у костра, по краю — трава; снег ложится поверх всего.
    const mid = Math.max(0, 1 - Math.hypot(x, z) / 4.5);
    let hex = hexMix(base, dark, r() * 0.5);
    if (look.ground !== 'desert') hex = hexMix(hex, tone(look.season, 'trample'), mid * 0.75);
    hex = hexMix(hex, PALETTE.fieldSnow, look.snow * (0.85 + 0.15 * r()));
    C.setHex(hex);
    col[i * 3] = C.r;
    col[i * 3 + 1] = C.g;
    col[i * 3 + 2] = C.b;
  }
  const flat = g.toNonIndexed();
  g.dispose();
  // Цвет — по вершинам исходной сетки: у развёрнутой геометрии его ставим заново по ближайшей вершине.
  flat.setAttribute('color', new THREE.BufferAttribute(spreadColor(flat, col, n), 3));
  flat.computeVertexNormals();
  const mesh = new THREE.Mesh(flat, BODY);
  mesh.name = 'ground';
  return mesh;
}

/** Цвета вершин сетки земли — на развёрнутую геометрию (у каждой её вершины — цвет ближайшего узла сетки). */
function spreadColor(flat: THREE.BufferGeometry, col: Float32Array, n: number): Float32Array {
  const pos = flat.getAttribute('position') as THREE.BufferAttribute;
  const out = new Float32Array(pos.count * 3);
  const step = (GROUND_HALF * 2) / n;
  for (let i = 0; i < pos.count; i++) {
    const ix = Math.round((pos.getX(i) + GROUND_HALF) / step);
    const iz = Math.round((pos.getZ(i) + GROUND_HALF) / step);
    const k = Math.max(0, Math.min((n + 1) * (n + 1) - 1, iz * (n + 1) + ix));
    out[i * 3] = col[k * 3];
    out[i * 3 + 1] = col[k * 3 + 1];
    out[i * 3 + 2] = col[k * 3 + 2];
  }
  return out;
}

/** Палатка: четырёхскатный конус полотна с тёмным входом. */
function tent(parts: Part[], look: CampLook, x: number, z: number, s: number, cloth: number, turn = 0): THREE.Vector3 {
  const y = onGround(look, x, z);
  parts.push(cone(1.1 * s, 1.5 * s, tint(cloth), 4, x, y + 0.75 * s, z, { y: Math.PI / 4 + turn }));
  parts.push(box(0.5 * s, 0.7 * s, 0.05, tint(PALETTE.dark), x + Math.sin(turn) * 0.78 * s, y + 0.35 * s, z + Math.cos(turn) * 0.78 * s, { y: turn }));
  if (look.snow > 0.4) parts.push(cone(0.7 * s, 0.5 * s, tint(PALETTE.fieldSnow), 4, x, y + 1.27 * s, z, { y: Math.PI / 4 + turn }));
  return new THREE.Vector3(x, y + 1.6 * s, z);
}

/** Шатёр героя: круглая стена, полосатая кровля, золотое навершие. */
function pavilion(parts: Part[], look: CampLook, x: number, z: number): THREE.Vector3 {
  const y = onGround(look, x, z);
  parts.push(cyl(1.7, 1.75, 1.3, tint(PALETTE.cloth), 10, x, y + 0.65, z));
  parts.push(cone(2.1, 1.7, tint(PALETTE.paintRed), 10, x, y + 2.15, z));
  parts.push(cyl(2.05, 2.1, 0.18, tint(PALETTE.gold), 10, x, y + 1.36, z));
  parts.push(cyl(0.04, 0.04, 0.6, tint(PALETTE.woodDark), 4, x, y + 3.2, z));
  parts.push(cone(0.12, 0.25, tint(PALETTE.gold), 4, x, y + 3.55, z));
  parts.push(box(0.9, 1.0, 0.06, tint(PALETTE.dark), x, y + 0.5, z + 1.72));
  if (look.snow > 0.4) parts.push(cone(1.3, 0.7, tint(PALETTE.fieldSnow), 10, x, y + 2.65, z));
  return new THREE.Vector3(x, y + 3.4, z);
}

/** Кострище: кольцо камней и поленья; огонь — отдельным мешем (`flame`). */
function hearth(parts: Part[], look: CampLook, x: number, z: number): THREE.Vector3 {
  const y = onGround(look, x, z);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    parts.push(box(0.26, 0.18, 0.2, tint(PALETTE.stoneDark), x + Math.cos(a) * 0.55, y + 0.09, z + Math.sin(a) * 0.55, { y: a }));
  }
  parts.push(box(0.9, 0.12, 0.14, tint(PALETTE.woodDark), x, y + 0.1, z, { y: 0.6 }));
  parts.push(box(0.9, 0.12, 0.14, tint(PALETTE.woodDark), x, y + 0.16, z, { y: -0.7 }));
  return new THREE.Vector3(x, y + 0.2, z);
}

/** Обоз: телега с кузовом под полотном и колёсами. */
function wagon(parts: Part[], look: CampLook, x: number, z: number): THREE.Vector3 {
  const y = onGround(look, x, z);
  parts.push(box(1.0, 0.45, 2.0, tint(PALETTE.wood), x, y + 0.7, z));
  parts.push(place(new THREE.CylinderGeometry(0.55, 0.55, 2.0, 6, 1, false, 0, Math.PI), tint(PALETTE.cloth), x, y + 0.92, z, { x: Math.PI / 2, y: Math.PI / 2 }));
  for (const [dx, dz] of [
    [-0.55, -0.65],
    [0.55, -0.65],
    [-0.55, 0.65],
    [0.55, 0.65],
  ]) {
    parts.push(cyl(0.34, 0.34, 0.1, tint(PALETTE.woodDark), 8, x + dx, y + 0.34, z + dz, { z: Math.PI / 2 }));
  }
  parts.push(box(0.08, 0.08, 1.4, tint(PALETTE.woodDark), x, y + 0.5, z + 1.6));
  return new THREE.Vector3(x, y + 1.6, z);
}

/** Мешки и бочонок — обоз малого лагеря. */
function sacks(parts: Part[], look: CampLook, x: number, z: number): THREE.Vector3 {
  const y = onGround(look, x, z);
  parts.push(box(0.55, 0.4, 0.4, tint(PALETTE.cloth), x, y + 0.2, z, { y: 0.3 }));
  parts.push(box(0.5, 0.36, 0.38, tint(PALETTE.cloth), x + 0.45, y + 0.18, z + 0.2, { y: -0.4 }));
  parts.push(cyl(0.24, 0.24, 0.5, tint(PALETTE.barrel), 7, x - 0.2, y + 0.25, z + 0.55));
  return new THREE.Vector3(x, y + 0.8, z);
}

/** Конь коновязи: корпус, шея, голова, ноги. */
function horse(parts: Part[], look: CampLook, x: number, z: number, coat: number, turn: number): void {
  const y = onGround(look, x, z);
  const fx = Math.sin(turn);
  const fz = Math.cos(turn);
  parts.push(box(0.42, 0.5, 1.2, tint(coat), x, y + 1.0, z, { y: turn }));
  parts.push(box(0.28, 0.6, 0.3, tint(coat), x + fx * 0.6, y + 1.35, z + fz * 0.6, { y: turn, x: -0.5 }));
  parts.push(box(0.24, 0.24, 0.5, tint(coat), x + fx * 0.85, y + 1.6, z + fz * 0.85, { y: turn }));
  for (const [sx, sz] of [
    [-0.14, -0.45],
    [0.14, -0.45],
    [-0.14, 0.45],
    [0.14, 0.45],
  ]) {
    parts.push(box(0.12, 0.75, 0.12, tint(PALETTE.hair), x + sx * Math.cos(turn) + sz * fx, y + 0.38, z - sx * Math.sin(turn) + sz * fz));
  }
}

/** Коновязь: два столба, жердь и два коня. */
function hitch(parts: Part[], look: CampLook, x: number, z: number): void {
  const y = onGround(look, x, z);
  parts.push(box(0.12, 1.1, 0.12, tint(PALETTE.stake), x, y + 0.55, z - 1.0));
  parts.push(box(0.12, 1.1, 0.12, tint(PALETTE.stake), x, y + 0.55, z + 1.0));
  parts.push(box(0.08, 0.08, 2.2, tint(PALETTE.woodDark), x, y + 1.0, z));
  horse(parts, look, x + 0.9, z - 0.5, PALETTE.hide, -Math.PI / 2);
  horse(parts, look, x + 0.9, z + 0.6, PALETTE.woodDark, -Math.PI / 2);
}

/** Сосна (три яруса конусов) или лиственное (шар-многогранник) — по кости. */
function tree(parts: Part[], look: CampLook, x: number, z: number, r: () => number): void {
  const y = onGround(look, x, z);
  const s = 0.8 + r() * 0.6;
  const snowy = look.snow > 0.4;
  parts.push(cyl(0.12 * s, 0.16 * s, 1.0 * s, tint(PALETTE.trunk), 5, x, y + 0.5 * s, z));
  if (r() < 0.6) {
    const leaf = hexMix(tone(look.season, 'leaves'), PALETTE.fieldSnow, snowy ? 0.55 : 0);
    for (let k = 0; k < 3; k++) parts.push(cone((1.0 - k * 0.25) * s, 1.1 * s, tint(leaf), 7, x, y + (1.2 + k * 0.6) * s, z));
  } else {
    const leaf = hexMix(tone(look.season, 'leaves2'), PALETTE.fieldSnow, snowy ? 0.5 : 0);
    parts.push(place(new THREE.IcosahedronGeometry(0.95 * s, 0), tint(leaf), x, y + 1.6 * s, z));
  }
}

/** Камень. */
const rock = (parts: Part[], look: CampLook, x: number, z: number, s: number): void => {
  parts.push(place(new THREE.DodecahedronGeometry(s, 0), tint(hexMix(PALETTE.rock, PALETTE.fieldSnow, look.snow * 0.5)), x, onGround(look, x, z) + s * 0.4, z));
};

/** Руины — обломки крепостной стены полукольцом за лагерем, с проломом и аркой (один вид руин, ПН-12л). */
function ruins(parts: Part[], look: CampLook): void {
  const segs: [number, number, number, number][] = [
    // x, z, длина, высота
    [-5.4, -2.0, 3.2, 2.6],
    [-3.2, -5.2, 3.6, 3.4],
    [1.0, -6.0, 3.0, 2.2],
    [4.6, -4.4, 3.0, 3.0],
    [6.0, -0.8, 2.6, 1.6],
  ];
  for (const [x, z, len, h] of segs) {
    const y = onGround(look, x, z);
    const turn = Math.atan2(x, z) + Math.PI / 2;
    parts.push(box(len, h, 0.7, tint(PALETTE.stone), x, y + h / 2, z, { y: turn }));
    // Неровный верх: зубцы разной высоты.
    parts.push(box(len * 0.35, 0.5, 0.72, tint(PALETTE.stoneLight), x + Math.cos(turn) * len * 0.25, y + h + 0.2, z - Math.sin(turn) * len * 0.25, { y: turn }));
    parts.push(box(len * 1.02, 0.25, 0.74, tint(PALETTE.stoneDark), x, y + 0.12, z, { y: turn }));
    if (look.snow > 0.4) parts.push(box(len, 0.12, 0.72, tint(PALETTE.fieldSnow), x, y + h + 0.06, z, { y: turn }));
  }
  // Арка ворот — два столба и перемычка.
  const ax = -0.8;
  const az = -6.4;
  const y = onGround(look, ax, az);
  parts.push(box(0.7, 3.6, 0.8, tint(PALETTE.stone), ax - 1.1, y + 1.8, az));
  parts.push(box(0.7, 3.6, 0.8, tint(PALETTE.stone), ax + 1.1, y + 1.8, az));
  parts.push(box(2.9, 0.6, 0.85, tint(PALETTE.stoneDark), ax, y + 3.8, az));
  for (let i = 0; i < 6; i++) rock(parts, look, -4 + i * 1.6, -3.4 + (i % 2) * 0.8, 0.25);
}

/** Вода у берега — полоса слева за краем лагеря, тростник у кромки. */
function water(look: CampLook): THREE.Mesh {
  const g = new THREE.PlaneGeometry(14, GROUND_HALF * 2.4, 1, 1);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshLambertMaterial({ color: look.snow > 0.6 ? PALETTE.shallow : PALETTE.water, flatShading: true });
  const mesh = new THREE.Mesh(g, m);
  mesh.position.set(-16, -0.2, 0);
  mesh.name = 'water';
  return mesh;
}

/** Знамя с гербом: древко и полотнище (герб кладёт сцена текстурой; без документа — красное). */
function banner(look: CampLook, x: number, z: number): { pole: Part; flag: THREE.Mesh; top: THREE.Vector3 } {
  const y = onGround(look, x, z);
  const pole = cyl(0.05, 0.06, 3.6, tint(PALETTE.woodDark), 5, x, y + 1.8, z);
  const geo = new THREE.PlaneGeometry(1.1, 1.3, 4, 1);
  geo.translate(0.58, 0, 0);
  const flag = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: PALETTE.paintRed, side: THREE.DoubleSide }));
  flag.position.set(x + 0.03, y + 2.9, z);
  flag.name = 'flag';
  return { pole, flag, top: new THREE.Vector3(x, y + 3.7, z) };
}

/** Огонь: два вложенных светящихся конуса. */
function flameMesh(): THREE.Mesh {
  const outer = new THREE.ConeGeometry(0.34, 0.9, 6);
  outer.translate(0, 0.45, 0);
  const inner = new THREE.ConeGeometry(0.18, 0.55, 5);
  inner.translate(0, 0.28, 0.02);
  const parts: Part[] = [
    { geo: outer, paint: glow(PALETTE.fire) },
    { geo: inner, paint: glow(PALETTE.fireInner) },
  ];
  const mesh = assemble(parts);
  mesh.castShadow = false;
  mesh.name = 'flame';
  return mesh;
}

/** Треугольников в группе (развёрнутые и индексные сетки). */
export function trisOf(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const idx = m.geometry.getIndex();
    n += idx ? idx.count / 3 : (m.geometry.getAttribute('position')?.count ?? 0) / 3;
  });
  return Math.round(n);
}

/**
 * Собрать лагерь вида `look` на уровне `q`. Ступени (ГДД 5.2, решение владельца): малый — костёр и две палатки, мешки; большой —
 * шатёр героя, две палатки, обоз, коновязь, знамя с гербом. Скрытый — без огня и дыма (кострище холодное). Стоит без лагеря — знамя
 * и мешки на земле. В руинах — лагерь внутри стен.
 */
export function buildCamp(look: CampLook, q: Quality): CampModel {
  const root = new THREE.Group();
  root.name = 'camp';
  root.add(groundMesh(look, q));
  if (look.ground === 'shore') root.add(water(look));
  const parts: Part[] = [];
  const r = rng(0xca5e ^ (look.ground.length * 131) ^ (look.tier === 'large' ? 7 : 3));
  const large = look.tier === 'large';
  const camped = look.kind !== null;
  // Лагерь в руинах тесней: палатки меньше (ГДД 5.3).
  const s = look.ground === 'ruin' ? 0.85 : 1;
  let tentAt = new THREE.Vector3(0, 1.5, -2);
  let cargoAt: THREE.Vector3;
  let fireAt = new THREE.Vector3(0, 0.2, 0.6);
  if (camped) {
    fireAt = hearth(parts, look, 0, 0.6);
    if (large) {
      tentAt = pavilion(parts, look, 0, -2.6);
      tent(parts, look, -3.2, -1.2, s, PALETTE.cloth, 0.5);
      tent(parts, look, 3.0, -1.6, s, PALETTE.hide, -0.4);
      cargoAt = wagon(parts, look, 3.4, 2.0);
      hitch(parts, look, -4.2, 2.0);
    } else {
      tentAt = tent(parts, look, -1.9, -1.4, s, PALETTE.cloth, 0.35);
      tent(parts, look, 2.0, -1.2, s, PALETTE.hide, -0.3);
      cargoAt = sacks(parts, look, 1.9, 1.8);
    }
  } else cargoAt = sacks(parts, look, 1.2, 0.8);
  // Знамя с гербом — у большого лагеря и у стоящего без лагеря (знамя отряда видно всегда, когда лагеря нет).
  let flag: THREE.Mesh | null = null;
  let bannerTop: THREE.Vector3 | null = null;
  if (large || !camped) {
    const b = banner(look, large ? -1.6 : -0.6, large ? -0.6 : 0.2);
    parts.push(b.pole);
    flag = b.flag;
    bannerTop = b.top;
    if (!camped) tentAt = b.top.clone();
  }
  if (look.ground === 'ruin') ruins(parts, look);
  // Деревья: лес — кольцом гуще, прочая земля — редкие; пустыня — без деревьев, камни.
  const count = look.ground === 'desert' ? 0 : look.ground === 'forest' ? TREES[q] : Math.round(TREES[q] / 3);
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2;
    const d = (look.ground === 'forest' ? 5.5 : 9) + r() * (look.ground === 'forest' ? 7 : 8);
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d - 2;
    if (look.ground === 'shore' && x < -6) continue;
    // Перед лагерем деревьев нет: камера смотрит на него поверх поляны; лес обступает с боков и сзади — палатки между деревьями.
    if (Math.abs(x) < 4.6 && z > -3.6) continue;
    tree(parts, look, x, z, r);
  }
  // Кусты на открытой земле — поле не голый лист.
  if (look.ground !== 'desert' && look.ground !== 'ruin') {
    const bush = hexMix(tone(look.season, 'bush'), PALETTE.fieldSnow, look.snow * 0.6);
    for (let i = 0; i < 10; i++) {
      const a = r() * Math.PI * 2;
      const d = 4.5 + r() * 8;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      parts.push(place(new THREE.IcosahedronGeometry(0.35 + r() * 0.3, 0), tint(bush), x, onGround(look, x, z) + 0.2, z));
    }
  }
  const stones = look.ground === 'hills' || look.ground === 'desert' ? 8 : 3;
  for (let i = 0; i < stones; i++) {
    const a = r() * Math.PI * 2;
    const d = 5 + r() * 9;
    rock(parts, look, Math.cos(a) * d, Math.sin(a) * d, 0.25 + r() * 0.45);
  }
  if (look.ground === 'shore') {
    for (let i = 0; i < 9; i++) parts.push(cyl(0.02, 0.03, 0.9, tint(tone(look.season, 'bush')), 3, -8.4 - r() * 0.6, 0.3, -6 + i * 1.5 + r()));
  }
  if (parts.length > 0) {
    const mesh = assemble(parts);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    root.add(mesh);
  }
  if (flag) root.add(flag);
  const lit = camped && look.fire;
  let flame: THREE.Mesh | null = null;
  if (lit) {
    flame = flameMesh();
    flame.position.set(fireAt.x, fireAt.y - 0.05, fireAt.z);
    root.add(flame);
  }
  return {
    root,
    flame,
    flag,
    smokeFrom: lit ? new THREE.Vector3(fireAt.x, fireAt.y + 0.9, fireAt.z) : null,
    // Подпись костра — над пламенем, а не на нём.
    anchors: { tent: tentAt, fire: new THREE.Vector3(fireAt.x, fireAt.y + 1.3, fireAt.z), cargo: cargoAt, banner: bannerTop },
    tris: trisOf(root),
  };
}

/** Освободить геометрию и свои материалы собранного лагеря (общие тела остаются). */
export function disposeCamp(m: CampModel): void {
  m.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) if (mat !== BODY && mat !== GLOW) (mat as THREE.Material).dispose();
  });
}
