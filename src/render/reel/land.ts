// Поле боя ролика TW: земля клетки, река с переправой, лес, тракт (docs/battle_tw.md, раздел 6).
//
// Полуреализм города и карты: тёплая палитра города (`city/palette.ts`), вода по глубине, как на карте TW, одна
// лампа с тенью и туман цвета дымки (свет и небо — у сцены, `stage.ts`). Весь цвет земли запечён в вершины, материал
// — один белый Ламберт, как у земли прежнего ролика: сцена боя не трогает общих материалов, и зимний бой не
// перекрашивает город (правило прежнего ролика, docs/battle-replay.md, «Зима»).
import * as THREE from 'three';
import { CITY } from '../city/palette';
import { PALETTE, seasonColor, type PaletteKey } from '../palette';
import { envShared, vegMaterial, type EnvShared } from './veg';
import { treeModel } from './flora';
import type { TwSpec } from './spec';
import { WATER_Y, hash, heightAt, smoothstep, vnoise, type TwField } from './terrain';
import type { Side } from '@/battle/types';

/**
 * Краски земли: город и карта TW — одна гамма (`CITY` — трава, сухая трава, земля; вода — по глубине, как
 * `map_tw.md`, раздел 3). Чистого белого и чёрного нет.
 */
const TONE = {
  // Трава поля светлее городской: город смотрят сверху на камне и черепице, поле — сплошь трава под низким
  // солнцем; на городском тоне оно выходило болотом. Сдвиг — к лугу прежнего ролика (`PALETTE.meadow`).
  grass: 0x7a8749,
  grassDry: CITY.grassDry,
  grassDark: CITY.grassDark,
  clover: CITY.clover,
  dirt: CITY.dirt,
  dirtDark: CITY.dirtDark,
  dirtLight: CITY.dirtLight,
  rock: CITY.rock,
  rockDark: CITY.rockDark,
  bank: 0x4d5f34,
  ford: 0xc9bf9e,
  water: 0x4f8592,
  waterDeep: 0x2b5b72,
  cobble: CITY.cobble,
  cobbleWarm: CITY.cobbleWarm,
  snow: CITY.snow,
  snowShade: 0xb4c0cc,
} as const;

const GROUND_FRAG = /* glsl */ `
varying vec3 vTwWorld;
uniform float uTwTime;
uniform float uTwCloud;
uniform vec4 uTwScar;
uniform float uTwBloom;
// Хеш без синуса (Хоскинс): на телефоне синус в каждом пикселе земли — заметная доля цены кадра.
float twHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float twNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(twHash(i), twHash(i + vec2(1.0, 0.0)), f.x), mix(twHash(i + vec2(0.0, 1.0)), twHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
`;

/**
 * Тень облака на земле — та же формула, что у крон (`veg.envCloud`), без расчистки посёлка: пятна плывут по полю боя
 * и по лесу одной картой, и дерево с землёй под ним темнеют вместе.
 */
const GROUND_CLOUD = /* glsl */ `
float twCloud(vec2 p, float t) {
  float a = sin(p.x * 0.083 + t * 0.021) * sin(p.y * 0.071 - t * 0.017);
  float b = sin((p.x + p.y) * 0.047 + t * 0.013 + 1.7);
  return smoothstep(0.52, 0.74, 0.5 + 0.32 * a + 0.22 * b);
}
`;

/**
 * Зерно земли вблизи, цветы, вытоптанная полоса сечи и тень облаков. Вытоптанное растёт по ходу сечи (`LandScar`): к
 * концу боя у линии соприкосновения — бурая полоса земли, где стояли и падали. Цветы — точками на траве, вблизи;
 * зимой их нет (`uTwBloom` — ноль).
 */
const GROUND_GRAIN = /* glsl */ `
float twFar = smoothstep(90.0, 30.0, length(vViewPosition));
float twN = twNoise(vTwWorld.xz * 0.55) * 0.55 + twNoise(vTwWorld.xz * 2.3) * 0.45 * twFar;
diffuseColor.rgb *= mix(0.88, 1.1, twN);
// Ветвления — по месту и по числу на весь кадр: полосы нет или пиксель далеко от неё — её шум не считается вовсе.
float twScar = 0.0;
float twBand = abs(vTwWorld.z - uTwScar.x);
if (uTwScar.w > 0.0 && twBand < uTwScar.y + 0.9) {
  twScar = uTwScar.w * smoothstep(uTwScar.y, uTwScar.y * 0.35, abs(vTwWorld.z - uTwScar.x + (twNoise(vTwWorld.xz * 0.4) - 0.5) * 1.6))
    * smoothstep(uTwScar.z + 4.0, uTwScar.z - 2.0, abs(vTwWorld.x)) * (0.55 + 0.45 * twNoise(vTwWorld.xz * 1.3));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.36, 0.28, 0.19) * (0.85 + 0.3 * twN), clamp(twScar, 0.0, 0.85));
}
// Цветок — круглая точка в своей клетке (клетка ~0.2 м), на случайном месте клетки; таких клеток — каждая шестидесятая.
if (twFar * uTwBloom > 0.0) {
  vec2 twCell = floor(vTwWorld.xz * 5.0);
  float twPick = twHash(twCell);
  if (twPick > 0.984) {
    vec2 twIn = fract(vTwWorld.xz * 5.0) - 0.25 - 0.5 * vec2(twHash(twCell + 1.3), twHash(twCell + 2.9));
    float twSpeck = step(length(twIn), 0.2) * twFar * uTwBloom * (1.0 - twScar);
    float twKind = twHash(twCell + 7.1);
    vec3 twFlower = twKind < 0.5 ? vec3(0.93, 0.86, 0.42) : (twKind < 0.8 ? vec3(0.92, 0.92, 0.86) : vec3(0.62, 0.48, 0.78));
    diffuseColor.rgb = mix(diffuseColor.rgb, twFlower, twSpeck * 0.85);
  }
}
if (uTwCloud > 0.0) diffuseColor.rgb *= 1.0 - uTwCloud * twCloud(vTwWorld.xz, uTwTime);
`;

/** Подстилка за полем: земля до горизонта, грубой сеткой; под плитой она опущена и не видна. */
const SKIRT_HALF = 700;
const SKIRT_CELLS = 56;
const SKIRT_CELL = (SKIRT_HALF * 2) / SKIRT_CELLS;
/**
 * Плита шире поля на столько: её край уходит в дымку, а мелкая пестрота земли к краю гаснет до той же гладкой
 * окраски, что у подстилки, — шва между ними не видно (самопроверка, круг 4: шов читался линией горизонта).
 */
const PLATE_MARGIN = 45;
const EDGE_FADE = 32;

interface Rect {
  halfX: number;
  minZ: number;
  maxZ: number;
}

const plateRect = (f: TwField): Rect => ({ halfX: f.halfX + PLATE_MARGIN, minZ: f.minZ - PLATE_MARGIN, maxZ: f.maxZ + PLATE_MARGIN });

/** Насколько точка внутри плиты: 0 — на её краю и снаружи, 1 — дальше `EDGE_FADE` от края. */
const inside = (r: Rect, x: number, z: number): number =>
  smoothstep(0, EDGE_FADE, Math.min(r.halfX - Math.abs(x), z - r.minZ, r.maxZ - z));

/**
 * Что место боя (стена, город, лагерь, логово — план места, `tw/site.ts`) говорит земле: где утоптано и мощёно, где
 * деревьев нет, где чаща логова. У поля места нет — `null`.
 */
export interface LandSite {
  ground(x: number, z: number): { dirt: number; cobble: number };
  blocks(x: number, z: number): boolean;
  /** Логово — в лесу: чаща кольцом вокруг этого прямоугольника лагеря. */
  lair: { x0: number; x1: number; z0: number; z1: number } | null;
}

/**
 * Вытоптанная полоса сечи: где линия соприкосновения (`z`), какой ширины (`half`) и до какой полуширины фронта (`span`),
 * и сколько вытоптано к секунде ролика (`at`, 0..1) — её ведёт план места по ходу сечи.
 */
export interface LandScar {
  z: number;
  half: number;
  span: number;
  at(t: number): number;
}

/** Земля боя: поле плана места, где стоят строи на построении, и место боя. Её собирает план места. */
export interface LandInput {
  field: TwField;
  /** Где стоит передняя шеренга стороны на построении: земля там чуть вытоптана. */
  deployZ: Record<Side, number>;
  /** Строй на построении: деревья леса-штрафа между отрядами не встают. */
  units: readonly { x: number; z: number; width: number; depth: number; ours: boolean }[];
  site: LandSite | null;
  /** Вытоптанная полоса сечи; нет — земля не меняется. */
  scar?: LandScar | null;
  /** Густота тени облаков, 0..1 (`light.cloudShade`: днём гуще, в сумерки и зимой — реже). */
  cloud?: number;
}

export interface FieldView {
  group: THREE.Group;
  /** Треугольников земли, воды и деревьев — сверке бюджета. */
  triangles: number;
  update(t: number): void;
  dispose(): void;
}

const C = new THREE.Color();
const C2 = new THREE.Color();
const NO_SITE = { dirt: 0, cobble: 0 };

/** Цвет земли в точке: трава пятнами, вытоптанное там, где стоят и сходятся строи, ил у воды, снег зимой. */
function groundColor(f: TwField, plan: LandInput, x: number, z: number, y: number, out: THREE.Color, detail = 1): THREE.Color {
  // Вся пестрота плиты гаснет к её краю до крупных пятен, которые грубая подстилка держит так же: шва нет.
  const far = vnoise(x / 70, z / 70, f.seed + 20);
  const n1 = far + (vnoise(x / 9, z / 9, f.seed + 21) - far) * detail;
  // Мелкая пестрота гаснет к краю плиты: подстилка её не держит, и на шве они сходятся одной гладкой окраской.
  const n2 = 0.5 + (vnoise(x / 3.1, z / 3.1, f.seed + 22) - 0.5) * detail;
  out.set(TONE.grass);
  out.lerp(C2.set(TONE.grassDry), smoothstep(0.45, 0.8, n1) * 0.75);
  out.lerp(C2.set(TONE.grassDark), smoothstep(0.55, 0.15, n1) * 0.5);
  out.lerp(C2.set(TONE.clover), smoothstep(0.7, 0.95, n2) * 0.35);
  // Вытоптанное — слегка: бой ещё не начался, а земля между строями — та, по которой пойдут. Сильнее — читалось
  // грязной полосой поперёк поля (самопроверка, круг 4).
  const contact = smoothstep(6, 1.5, Math.abs(z)) * (0.2 + 0.15 * n2);
  let deploy = 0;
  for (const side of ['attacker', 'defender'] as const) deploy = Math.max(deploy, smoothstep(4.5, 1, Math.abs(z - plan.deployZ[side])) * 0.15);
  const across = smoothstep(plan.field.halfX - 20, plan.field.halfX - 40, Math.abs(x));
  const tramp = Math.max(contact, deploy) * across * smoothstep(0.25, 0.6, n1 + n2 * 0.4) * detail;
  out.lerp(C2.set(TONE.dirt), tramp * 0.7);
  // Место боя: утоптанная земля города и лагеря, мостовая улицы и площади.
  const g = plan.site?.ground(x, z) ?? NO_SITE;
  if (g.dirt > 0) out.lerp(C2.set(TONE.dirt), g.dirt * (0.55 + 0.25 * n2));
  if (g.cobble > 0) out.lerp(C2.set(n1 > 0.5 ? TONE.cobbleWarm : TONE.cobble), g.cobble * 0.7);
  if (f.road) {
    const rx = 7 + Math.sin(z / 30 + f.seed) * 5;
    const k = smoothstep(2.2, 1.1, Math.abs(x - rx));
    out.lerp(C2.set(TONE.dirtLight), k * 0.85);
  }
  if (f.river) {
    const r = f.river;
    const d = Math.abs(z - r.z + Math.sin(x / 17 + f.seed) * 0.6);
    out.lerp(C2.set(TONE.bank), smoothstep(r.half + 4, r.half + 0.6, d) * 0.7);
    out.lerp(C2.set(TONE.dirtDark), smoothstep(r.half + 1.2, r.half - 0.2, d));
    if (r.ford) {
      const fk = smoothstep(r.fordHalf + 2, r.fordHalf - 1, Math.abs(x - r.fordX)) * smoothstep(r.half + 0.5, r.half - 0.6, d);
      out.lerp(C2.set(TONE.ford), fk);
    }
  }
  // Откос гребня и холмы — камень там, где круто.
  const steep = Math.abs(heightAt(f, x, z + 0.8) - heightAt(f, x, z - 0.8)) + Math.abs(heightAt(f, x + 0.8, z) - heightAt(f, x - 0.8, z));
  out.lerp(C2.set(n2 > 0.5 ? TONE.rock : TONE.rockDark), smoothstep(0.9, 2.2, steep));
  if (f.winter) {
    // Снег своим ключом поля, а не сезоном общих материалов: вытоптанное и откосы проступают.
    const snow = 1 - Math.max(tramp * 0.8, smoothstep(1.2, 2.4, steep));
    out.lerp(C2.set(n1 > 0.5 ? TONE.snow : TONE.snowShade), snow * 0.92);
  }
  if (y < WATER_Y - 0.05) out.multiplyScalar(0.85);
  return out;
}

/** Плита поля: сетка высот с цветом в вершинах. */
function plate(f: TwField, plan: LandInput, cells: number): THREE.BufferGeometry {
  const r = plateRect(f);
  const w = r.halfX * 2;
  const d = r.maxZ - r.minZ;
  const nx = cells;
  const nz = Math.max(8, Math.round((cells * d) / w));
  const geo = new THREE.PlaneGeometry(w, d, nx, nz);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, (r.minZ + r.maxZ) / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = heightAt(f, x, z);
    pos.setY(i, y);
    groundColor(f, plan, x, z, y, C, inside(r, x, z));
    col[i * 3] = C.r;
    col[i * 3 + 1] = C.g;
    col[i * 3 + 2] = C.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return geo;
}

/** Подстилка до горизонта. Внутри поля она уходит вниз — плита закрывает её без зазора и без мерцания. */
function skirt(f: TwField, plan: LandInput): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(SKIRT_HALF * 2, SKIRT_HALF * 2, SKIRT_CELLS, SKIRT_CELLS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // Под плитой (с запасом в клетку подстилки) подстилка опущена: её грубые треугольники не протыкают плиту.
    const r = plateRect(f);
    const under = Math.abs(x) < r.halfX - SKIRT_CELL && z > r.minZ + SKIRT_CELL && z < r.maxZ - SKIRT_CELL;
    // Дальние холмы: подстилка поднимается к горизонту, чтобы край земли не читался диском.
    const far = Math.max(Math.abs(x) - r.halfX, z - r.maxZ, r.minZ - z, 0);
    const y = under ? heightAt(f, x, z) - 2.5 : heightAt(f, x, z) - 0.12 + smoothstep(40, 400, far) * (vnoise(x / 90, z / 90, f.seed + 5) * 26);
    pos.setY(i, y);
    groundColor(f, plan, x, z, y, C, 0);
    C.lerp(C2.set(f.winter ? TONE.snowShade : TONE.grassDark), smoothstep(60, 500, far) * 0.4);
    col[i * 3] = C.r;
    col[i * 3 + 1] = C.g;
    col[i * 3 + 2] = C.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return geo;
}

/** Лента реки поперёк поля до горизонта: тёмная середина, светлые отмели у берегов. */
function riverRibbon(f: TwField): THREE.BufferGeometry | null {
  const r = f.river;
  if (!r) return null;
  const segs = 220;
  const across = 6;
  const half = r.half + 0.9;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const x = -SKIRT_HALF + (i / segs) * SKIRT_HALF * 2;
    const zc = r.z - Math.sin(x / 17 + f.seed) * 0.6;
    for (let j = 0; j <= across; j++) {
      const v = j / across;
      const z = zc - half + v * half * 2;
      pos.push(x, WATER_Y, z);
      const edge = Math.abs(v - 0.5) * 2;
      C.set(TONE.waterDeep).lerp(C2.set(TONE.water), smoothstep(0.2, 0.95, edge));
      if (r.ford) C.lerp(C2.set(TONE.ford), smoothstep(r.fordHalf + 3, r.fordHalf - 1, Math.abs(x - r.fordX)) * 0.35);
      if (f.winter) C.lerp(C2.set(TONE.snowShade), 0.35);
      col.push(C.r, C.g, C.b);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < across; j++) {
      const a = i * (across + 1) + j;
      const b = a + across + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

interface TreeSpot {
  x: number;
  z: number;
  s: number;
  rot: number;
  tall: boolean;
}

/**
 * Где стоят деревья. Лес (`woods`) — стеной по флангам и перелеском за обороной; без леса — редкие купы у края,
 * чтобы горизонт не был пуст. Строй, путь сближения и река — чистые.
 */
function treeSpots(f: TwField, plan: LandInput, cap: number): TreeSpot[] {
  const out: TreeSpot[] = [];
  const armyHalf = f.halfX - 34;
  const want = f.woods ? cap : Math.round(cap * 0.35);
  for (let i = 0; out.length < want && i < want * 12; i++) {
    const h1 = hash(f.seed, i, 31);
    const h2 = hash(f.seed, i, 32);
    const x = (h1 * 2 - 1) * (f.halfX + 90);
    const z = f.minZ - 40 + h2 * (f.maxZ - f.minZ + 80);
    const flank = Math.abs(x) - armyHalf;
    // Лес по флангам гуще к краю; за дальней стороной — опушка: камера смотрит из-за наших, и горизонт поля — лес
    // за чужим строем. Без леса — редкие купы там же.
    const dense = f.woods ? smoothstep(6, 26, flank) : smoothstep(50, 90, flank) * 0.8;
    const beyond = z - f.maxZ + 22;
    const behind = f.woods ? smoothstep(0, 10, beyond) : smoothstep(5, 30, beyond) * 0.3;
    const clump = vnoise(x / 14, z / 14, f.seed + 41);
    const p = Math.max(dense, behind) * smoothstep(0.3, 0.6, clump);
    if (hash(f.seed, i, 33) > p) continue;
    if (f.river && Math.abs(z - f.river.z) < f.river.half + 2.5) continue;
    if (f.road && Math.abs(x - (7 + Math.sin(z / 30 + f.seed) * 5)) < 3) continue;
    // Город за стеной и лагерь — без деревьев.
    if (plan.site?.blocks(x, z)) continue;
    out.push({ x, z, s: 2.2 + hash(f.seed, i, 34) * 1.4, rot: hash(f.seed, i, 35) * Math.PI * 2, tall: clump > 0.5 });
  }
  // Штраф за лес: нападающий стоит в лесу — деревья за его строем, между отрядами и по флангам, не на людях.
  const fo = f.forest;
  if (fo) {
    const want = Math.round(cap * 0.5);
    const rects = plan.units.map((u) => {
      const back = u.ours ? -1 : 1;
      return { x0: u.x - u.width / 2 - 2.6, x1: u.x + u.width / 2 + 2.6, z0: Math.min(u.z, u.z + back * u.depth) - 2.6, z1: Math.max(u.z, u.z + back * u.depth) + 2.6 };
    });
    for (let i = 0, n = 0; n < want && i < want * 12; i++) {
      const x = (hash(f.seed, i, 96) * 2 - 1) * (f.halfX + 10);
      const z = fo.from + fo.side * hash(f.seed, i, 97) * 70;
      if (rects.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1)) continue;
      // Опушка — реже у строя, гуще в глубине леса.
      if (hash(f.seed, i, 98) > 0.35 + 0.65 * smoothstep(0, 18, (z - fo.from) * fo.side)) continue;
      n++;
      out.push({ x, z, s: 2.3 + hash(f.seed, i, 99) * 1.5, rot: hash(f.seed, i, 100) * Math.PI * 2, tall: hash(f.seed, i, 101) < 0.55 });
    }
  }
  // Логово — в лесу: чаща кольцом за частоколом и по бокам, к полю — опушка (docs/battle_tw.md, раздел 13).
  const c = plan.site?.lair ?? null;
  if (c) {
    const front = Math.abs(c.z0) < Math.abs(c.z1) ? c.z0 : c.z1;
    const dir = Math.sign(c.z1 + c.z0) || 1;
    const ring = Math.round(cap * 0.45);
    for (let i = 0, n = 0; n < ring && i < ring * 10; i++) {
      const x = c.x0 - 16 + hash(f.seed, i, 91) * (c.x1 - c.x0 + 32);
      const z = front + dir * (-2 + hash(f.seed, i, 92) * (Math.abs(c.z1 - c.z0) + 20));
      const inCamp = x > c.x0 - 4 && x < c.x1 + 4 && z > c.z0 - 4 && z < c.z1 + 4;
      if (inCamp || (z - front) * dir < 3 && Math.abs(x) < c.x1 + 4) continue;
      n++;
      out.push({ x, z, s: 2.4 + hash(f.seed, i, 93) * 1.6, rot: hash(f.seed, i, 94) * Math.PI * 2, tall: hash(f.seed, i, 95) < 0.7 });
    }
  }
  return out;
}

export function buildField(plan: LandInput, spec: TwSpec): FieldView {
  const f = plan.field;
  const group = new THREE.Group();
  group.name = 'tw-field';
  // Один белый Ламберт, весь цвет — в вершинах: общие материалы игры сцена боя не трогает.
  const groundMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  groundMat.name = 'tw-ground';
  // Мелкая зернистость земли шумом в шейдере: без текстуры поле вблизи читалось бы ровной заливкой. Гаснет с
  // расстоянием — вдали она рябила бы.
  const uni = {
    uTwTime: { value: 0 },
    // На низком уровне ни облаков, ни цветов: пиксель земли — без лишнего шума (`spec.clouds`, `spec.tufts`).
    uTwCloud: { value: spec.clouds ? (plan.cloud ?? 0) : 0 },
    uTwScar: { value: new THREE.Vector4(plan.scar?.z ?? 0, plan.scar?.half ?? 1, plan.scar?.span ?? 0, 0) },
    uTwBloom: { value: f.winter || spec.tufts === 0 ? 0 : 1 },
  };
  groundMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni);
    sh.vertexShader = 'varying vec3 vTwWorld;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTwWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = GROUND_FRAG + GROUND_CLOUD + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + GROUND_GRAIN);
  };
  groundMat.customProgramCacheKey = () => 'tw-ground';
  const meshes: THREE.Mesh[] = [];
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string, receive = true): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.receiveShadow = receive;
    group.add(m);
    meshes.push(m);
    return m;
  };
  add(plate(f, plan, spec.grid), groundMat, 'tw-plate');
  add(skirt(f, plan), groundMat, 'tw-skirt', false);

  const water = riverRibbon(f);
  let waterMat: THREE.MeshLambertMaterial | null = null;
  if (water) {
    waterMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false });
    waterMat.name = 'tw-water';
    const m = add(water, waterMat, 'tw-river');
    m.renderOrder = 2;
  }

  // Камыш по берегам реки: пучки тонких листьев, цвет в вершинах, без тени; у брода — нет (там переходят).
  let reedTris = 0;
  const extra: THREE.InstancedMesh[] = [];
  if (f.river) {
    const r = f.river;
    const blades: number[] = [];
    const bc: number[] = [];
    const leaf = new THREE.Color(f.winter ? 0xa89a78 : 0x6f7a3a);
    const tip = new THREE.Color(f.winter ? 0xcfc4a4 : 0xa59a52);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const lean = 0.18 + 0.1 * (k % 2);
      const x0 = Math.cos(a) * 0.05;
      const z0 = Math.sin(a) * 0.05;
      blades.push(x0 - 0.03, 0, z0, x0 + 0.03, 0, z0, x0 + Math.cos(a) * lean, 1.15 + 0.25 * (k % 3), z0 + Math.sin(a) * lean);
      for (const c of [leaf, leaf, tip]) bc.push(c.r, c.g, c.b);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3));
    rg.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
    rg.computeVertexNormals();
    const reedMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
    reedMat.name = 'tw-reeds';
    const spotsR: { x: number; z: number; s: number; rot: number }[] = [];
    for (let i = 0; spotsR.length < spec.reeds && i < spec.reeds * 6; i++) {
      const x = (hash(f.seed, i, 111) * 2 - 1) * (f.halfX + 30);
      if (r.ford && Math.abs(x - r.fordX) < r.fordHalf + 1.5) continue;
      if (vnoise(x / 9, r.z, f.seed + 113) < 0.38) continue;
      const bank = hash(f.seed, i, 112) < 0.5 ? -1 : 1;
      const zc = r.z - Math.sin(x / 17 + f.seed) * 0.6;
      const z = zc + bank * (r.half - 0.2 + hash(f.seed, i, 114) * 1.3);
      spotsR.push({ x, z, s: 0.7 + hash(f.seed, i, 115) * 0.6, rot: hash(f.seed, i, 116) * Math.PI * 2 });
    }
    if (spotsR.length) {
      const reeds = new THREE.InstancedMesh(rg, reedMat, spotsR.length);
      reeds.name = 'tw-reeds';
      reeds.receiveShadow = true;
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      spotsR.forEach((p, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
        v.set(p.x, Math.max(heightAt(f, p.x, p.z), WATER_Y - 0.1), p.z);
        sc.setScalar(p.s);
        reeds.setMatrixAt(i, m4.compose(v, q, sc));
      });
      reeds.computeBoundingSphere();
      group.add(reeds);
      // Камыш снимается вместе с деревьями: свой материал, своя геометрия, инстансы.
      extra.push(reeds);
      reedTris = 5 * spotsR.length;
    }
  }

  // Трава кустиками (`spec.tufts`): пятнами по шуму, не на тракте, не в воде и не в городе; цвет — в вершинах, у каждого
  // кустика свой тон. Тени не дают: их много, а тень от травы на этом расстоянии не видна.
  let tuftTris = 0;
  if (spec.tufts > 0) {
    const blades: number[] = [];
    const bc: number[] = [];
    const base = new THREE.Color(f.winter ? 0x9a9478 : 0x5d6e2f);
    const tip = new THREE.Color(f.winter ? 0xd9d6c6 : 0x9fae55);
    const BLADES = 5;
    for (let k = 0; k < BLADES; k++) {
      const a = (k / BLADES) * Math.PI * 2 + 0.4;
      const lean = 0.08 + 0.05 * (k % 2);
      const x0 = Math.cos(a) * 0.04;
      const z0 = Math.sin(a) * 0.04;
      blades.push(x0 - 0.025, 0, z0, x0 + 0.025, 0, z0, x0 + Math.cos(a) * lean, 0.28 + 0.12 * ((k * 7) % 3), z0 + Math.sin(a) * lean);
      for (const c of [base, base, tip]) bc.push(c.r, c.g, c.b);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(blades, 3));
    tg.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
    tg.computeVertexNormals();
    const tuftMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
    tuftMat.name = 'tw-tufts';
    const spots: { x: number; z: number; s: number; rot: number }[] = [];
    const r = plateRect(f);
    for (let i = 0; spots.length < spec.tufts && i < spec.tufts * 5; i++) {
      const x = (hash(f.seed, i, 121) * 2 - 1) * (f.halfX + 20);
      const z = f.minZ - 20 + hash(f.seed, i, 122) * (f.maxZ - f.minZ + 40);
      if (vnoise(x / 6, z / 6, f.seed + 123) < 0.42 || inside(r, x, z) < 0.5) continue;
      if (f.road && Math.abs(x - (7 + Math.sin(z / 30 + f.seed) * 5)) < 1.6) continue;
      if (f.river && Math.abs(z - f.river.z) < f.river.half + 0.4) continue;
      if (plan.site?.blocks(x, z) || (plan.site?.ground(x, z).cobble ?? 0) > 0.2) continue;
      spots.push({ x, z, s: 0.7 + hash(f.seed, i, 124) * 0.8, rot: hash(f.seed, i, 125) * Math.PI * 2 });
    }
    if (spots.length) {
      const tufts = new THREE.InstancedMesh(tg, tuftMat, spots.length);
      tufts.name = 'tw-tufts';
      tufts.receiveShadow = true;
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      spots.forEach((p, i) => {
        q.setFromAxisAngle(up, p.rot);
        v.set(p.x, heightAt(f, p.x, p.z) - 0.02, p.z);
        sc.set(p.s, p.s * (0.8 + hash(f.seed, i, 126) * 0.5), p.s);
        tufts.setMatrixAt(i, m4.compose(v, q, sc));
        const tone = 0.82 + hash(f.seed, i, 127) * 0.3;
        tufts.setColorAt(i, C.setRGB(tone * (0.95 + hash(f.seed, i, 128) * 0.1), tone, tone * 0.9));
      });
      tufts.computeBoundingSphere();
      group.add(tufts);
      extra.push(tufts);
      tuftTris = BLADES * spots.length;
    }
  }

  // Деревья — модели прежнего ролика (`reel/flora.ts`) и его материал листвы (ветер, снег), инстансами.
  const shared: EnvShared = envShared();
  shared.snow.value = f.winter ? 1 : 0;
  shared.cloud.value = spec.clouds ? (plan.cloud ?? 0) : 0;
  const color = (key: PaletteKey): THREE.Color => new THREE.Color(f.winter ? seasonColor('winter', key) : PALETTE[key]);
  const spots = treeSpots(f, plan, spec.trees);
  const trees: THREE.InstancedMesh[] = [];
  let treeTris = 0;
  for (const species of ['spruce', 'oak'] as const) {
    const list = spots.filter((s) => s.tall === (species === 'spruce'));
    if (list.length === 0) continue;
    const mat = vegMaterial(`tw-${species}`, { a: color('trunk'), b: color(species), sway: species === 'spruce' ? 0.9 : 0.7, flat: true, snowy: true }, shared);
    const geo = treeModel(species);
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    mesh.name = `tw-${species}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    list.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      v.set(t.x, heightAt(f, t.x, t.z) - 0.05, t.z);
      s.setScalar(t.s);
      mesh.setMatrixAt(i, m4.compose(v, q, s));
      const hue = 0.88 + hash(f.seed, i, 36) * 0.22;
      mesh.setColorAt(i, C.setRGB(hue, 0.95 + (hue - 1) * 0.5, 1));
    });
    mesh.computeBoundingSphere();
    group.add(mesh);
    trees.push(mesh);
    const idx = geo.getIndex();
    treeTris += ((idx ? idx.count : geo.attributes.position.count) / 3) * list.length;
  }

  const tris = meshes.reduce((n, m) => {
    const idx = m.geometry.getIndex();
    return n + (idx ? idx.count : m.geometry.attributes.position.count) / 3;
  }, 0);
  return {
    group,
    triangles: tris + treeTris + reedTris + tuftTris,
    update(t: number): void {
      shared.time.value = t;
      uni.uTwTime.value = t;
      uni.uTwScar.value.w = plan.scar ? plan.scar.at(t) : 0;
      shared.wind.value = 0.05 * (0.75 + 0.25 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1));
    },
    dispose(): void {
      for (const m of meshes) m.geometry.dispose();
      for (const m of [...trees, ...extra]) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        m.dispose();
      }
      groundMat.dispose();
      waterMat?.dispose();
      group.clear();
    },
  };
}

/** Небо и земля до горизонта: туман от расстояния камеры, как у города (`city/scene.cityFog`). */
export function fogFor(dist: number): { near: number; far: number } {
  return { near: dist * 0.9 + 30, far: dist * 2.6 + 220 };
}
