// Живой город — вторая докачка жизни (docs/city.md, раздел 13): телеги с волами через главные ворота к рынку и обратно,
// утки и лодки на реке, голуби на площади, стяги на воротах и донжоне. Свой ленивый кусок (`vite.config.ts`, `LAZY_DOORS`, «город: суета»):
// сцена тянет его после первого кадра города, в первую загрузку и в кусок города он не едет.
//
// Всё — функция от времени: где телега, утка, лодка в миг `t` — считается заново каждый кадр, ничего не копится. Колёса
// катятся, ноги волов и возниц шагают, вёсла гребут — в шейдере фигур (`life.figureMaterial`, `gait`). Каждый вид — один
// экземплярный меш, один вызов отрисовки. На низком уровне ничего этого нет (`spec.LIFE_CAP`).
import * as THREE from 'three';
import type { Quality } from '../quality';
import type { V3 } from './geom';
import { RIVER_HALF, heightAt, riverLevel, riverX, type CityPlan, type P, type Tower } from './layout';
import { figure, figureMaterial, gaitOf, legs, pathOf, at, heightOnPath, LEGS, SKIN, SHAFT, type Part, type Path } from './life';
import { rnd } from './noise';
import { linear } from './palette';
import { LIFE_CAP } from './spec';
import { DEFAULT_ARMS, armsCode, armsOr, type Arms } from '@/heraldry/arms';
import { TINCTURE_HEX } from '@/heraldry/art';
import { canPaintArms, paintArms } from '@/heraldry/paint';

// ---------------------------------------------------------------------------------------------
// Модели: лицом на +x, правый бок — +z, метры.

const OX: V3 = linear(0x8a6a4c);
const HORN: V3 = linear(0xd8ccb0);
const WOOD: V3 = linear(0x6a5038);
const PLANK: V3 = linear(0x8a7050);
const IRON: V3 = linear(0x3a3632);
const CLOTH: V3 = linear(0x6a5a44);
const WHITE: V3 = [1, 1, 1];

/** Колесо: две спицы крестом и ступица, катится в шейдере (радиус — `stride` со знаком минус). */
function wheel(x: number, z: number, r: number): Part[] {
  const limb: Part['limb'] = [x, r, -r, 0];
  return [
    { x, z, y0: 0, y1: 2 * r, hw: 0.05, hd: 0.07, col: WOOD, tint: 0, limb },
    { x, z, y0: r - 0.07, y1: r + 0.07, hw: 0.05, hd: r, col: WOOD, tint: 0, limb },
    { x, z: z + Math.sign(z) * 0.04, y0: r - 0.12, y1: r + 0.12, hw: 0.07, hd: 0.12, col: IRON, tint: 0, limb },
  ];
}

/**
 * Воловья упряжка: телега с поклажей (цвет экземпляра — мешки, сено, бочки), два колеса, оглобли, вол с рогами и
 * возница слева от вола с хворостиной. Начало координат — под осью колёс.
 */
export const cartGeometry = (): THREE.BufferGeometry =>
  figure([
    // Кузов: дно и борта.
    { x: -0.45, y0: 0.62, y1: 0.78, hw: 0.72, hd: 1.15, col: PLANK, tint: 0 },
    { x: -0.45, z: 0.7, y0: 0.78, y1: 1.12, hw: 0.04, hd: 1.15, col: PLANK, tint: 0 },
    { x: -0.45, z: -0.7, y0: 0.78, y1: 1.12, hw: 0.04, hd: 1.15, col: PLANK, tint: 0 },
    { x: -1.58, y0: 0.78, y1: 1.08, hw: 0.72, hd: 0.04, col: PLANK, tint: 0 },
    // Поклажа.
    { x: -0.5, y0: 0.78, y1: 1.5, hw: 0.62, hd: 1.0, taper: 0.78, col: WHITE, tint: 1 },
    ...wheel(0, 0.86, 0.55),
    ...wheel(0, -0.86, 0.55),
    // Оглобли до ярма и ярмо на холке.
    { x: 1.55, z: 0.36, y0: 0.74, y1: 0.82, hw: 0.04, hd: 0.95, col: WOOD, tint: 0 },
    { x: 1.55, z: -0.36, y0: 0.74, y1: 0.82, hw: 0.04, hd: 0.95, col: WOOD, tint: 0 },
    { x: 2.75, y0: 1.38, y1: 1.5, hw: 0.5, hd: 0.07, col: WOOD, tint: 0 },
    // Вол: туловище, голова, рога, ноги парами.
    { x: 3.3, y0: 0.66, y1: 1.42, hw: 0.4, hd: 0.92, taper: 0.88, col: OX, tint: 0 },
    { x: 4.42, y0: 0.92, y1: 1.4, hw: 0.19, hd: 0.26, taper: 0.85, col: OX, tint: 0 },
    { x: 4.36, y0: 1.4, y1: 1.5, hw: 0.42, hd: 0.05, taper: 0.5, col: HORN, tint: 0 },
    { x: 3.98, y0: 0, y1: 0.7, hw: 0.32, hd: 0.09, col: OX, tint: 0, limb: [3.98, 0.7, 1.6, 0] },
    { x: 2.62, y0: 0, y1: 0.7, hw: 0.32, hd: 0.09, col: OX, tint: 0, limb: [2.62, 0.7, 1.6, Math.PI] },
    // Возница слева от вола: ноги, рубаха, голова, шапка, хворостина.
    ...legs(0.78, 0.17, 0.11, 1.4, 3.4).map((p) => ({ ...p, z: (p.z ?? 0) - 0.95 })),
    { x: 3.4, z: -0.95, y0: 0.62, y1: 1.42, hw: 0.26, hd: 0.15, taper: 0.8, col: CLOTH, tint: 0 },
    { x: 3.4, z: -0.95, y0: 1.42, y1: 1.68, hw: 0.1, hd: 0.1, col: SKIN, tint: 0 },
    { x: 3.4, z: -0.95, y0: 1.66, y1: 1.78, hw: 0.14, hd: 0.14, taper: 0.6, col: LEGS, tint: 0 },
    { x: 3.75, z: -0.8, y0: 0.9, y1: 2.0, hw: 0.02, hd: 0.02, col: SHAFT, tint: 0 },
  ]);

/** Утка: тушка, голова (селезень — цвет экземпляра), клюв. */
export const duckGeometry = (): THREE.BufferGeometry =>
  figure([
    { x: -0.02, y0: -0.04, y1: 0.13, hw: 0.11, hd: 0.2, taper: 0.7, col: linear(0x7a6a52), tint: 0 },
    { x: 0.15, y0: 0.12, y1: 0.25, hw: 0.05, hd: 0.06, col: WHITE, tint: 1 },
    { x: 0.23, y0: 0.15, y1: 0.19, hw: 0.03, hd: 0.04, col: linear(0xc89a30), tint: 0 },
  ]);

/** Лодка: днище с развалом бортов, нос и корма уже, банка, гребец (рубаха — цвет экземпляра), два весла. */
export const boatGeometry = (): THREE.BufferGeometry => {
  // Весло ходит вокруг уключины на борту (поворот по вертикали — `phase` больше 50, `figureMaterial`), гребок — за 3 м хода.
  const oar = (z: number): Part => ({ x: -0.1, z, y0: 0.42, y1: 0.47, hw: 0.95, hd: 0.035, col: WOOD, tint: 0, limb: [-0.1, Math.sign(z) * 0.55, 3.0, 100] });
  return figure([
    { x: 0, y0: -0.18, y1: 0.32, hw: 0.5, hd: 1.7, taper: 1.25, col: WOOD, tint: 0 },
    { x: 2.05, y0: -0.1, y1: 0.4, hw: 0.28, hd: 0.36, taper: 1.2, col: WOOD, tint: 0 },
    { x: -1.95, y0: -0.12, y1: 0.36, hw: 0.36, hd: 0.26, taper: 1.2, col: WOOD, tint: 0 },
    { x: 0.1, y0: 0.3, y1: 0.36, hw: 0.6, hd: 0.14, col: PLANK, tint: 0 },
    { x: 0.1, y0: 0.36, y1: 0.98, hw: 0.24, hd: 0.15, taper: 0.8, col: WHITE, tint: 1 },
    { x: 0.1, y0: 0.98, y1: 1.22, hw: 0.1, hd: 0.1, col: SKIN, tint: 0 },
    { x: 0.1, y0: 1.2, y1: 1.3, hw: 0.13, hd: 0.13, taper: 0.6, col: LEGS, tint: 0 },
    oar(1.0),
    oar(-1.0),
  ]);
};

// ---------------------------------------------------------------------------------------------
// Телеги: путь от горизонта по дороге в долину, через главные ворота, по Главной к площади, кругом вокруг рядов рынка
// (у южной кромки рядов — разгрузка) и обратно тем же путём по другой стороне.

/**
 * Круг упряжки по площади — с конца Главной (1, 30) на восток, на север вдоль восточной кромки, на запад за рядами, на
 * юг между рядами и статуей и обратно к Главной. Обходит ряды, бочки, колодец с чашей и статую (`layout.SQUARE`,
 * `placeStalls`, `civic.marketProps`).
 */
export const CART_LOOP: readonly P[] = [
  { x: 1, z: 30 },
  { x: 12, z: 26 },
  { x: 22, z: 24.6 },
  { x: 27.5, z: 19 },
  { x: 28, z: 8 },
  { x: 26, z: 1 },
  { x: 14, z: 0.6 },
  { x: 0, z: 0.4 },
  { x: -14, z: 1.2 },
  { x: -16.8, z: 5 },
  { x: -17.5, z: 12 },
  { x: -19.5, z: 19 },
  { x: -15, z: 25.5 },
  { x: -6, z: 28.5 },
  { x: 1, z: 30 },
];
/** Сдвиг упряжки вправо от хода, метры: встречные расходятся и в проезде ворот (арка 4 м). */
export const CART_KEEP_RIGHT = 1.0;
/** Скорость вола, м/с; стоянка у рядов и пауза за горизонтом, с. */
export const CART_SPEED = 1.0;
export const CART_DWELL = 45;
export const CART_AWAY = 20;

/** Путь упряжки: дорога (с горизонта), Главная, круг по площади, обратно — ломаной, сдвинутой вправо от хода. */
export function cartRoute(plan: CityPlan): { path: Path; stop: number } | null {
  const road = plan.roads.find((r) => r.name === 'Дорога в долину');
  const main = plan.streets.find((s) => s.name === 'Главная');
  if (!road || !main) return null;
  const inbound = [...[...road.pts].reverse(), ...main.pts];
  const center: P[] = [...inbound, ...CART_LOOP.slice(1), ...[...inbound].reverse().slice(1)];
  // Сдвиг вправо от хода по биссектрисе соседних отрезков: на изломе без скачка.
  const pts: P[] = center.map((p, k) => {
    const a = center[Math.max(0, k - 1)];
    const b = center[Math.min(center.length - 1, k + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    // Правый бок хода — +z фигуры: лицом по (dx, dz), справа — (−dz, dx).
    return { x: p.x - (dz / l) * CART_KEEP_RIGHT, z: p.z + (dx / l) * CART_KEEP_RIGHT };
  });
  const path = pathOf(pts, 0, (p) => heightAt(p.x, p.z));
  // Стоянка — на круге у южной кромки рядов: ближайшая к (17, 25) точка пути после въезда.
  let stop = 0;
  let bd = Infinity;
  const inLen = path.acc[inbound.length - 1];
  for (let s = inLen; s < inLen + 120; s += 0.5) {
    const p = at(path, s).p;
    const d = Math.hypot(p.x - 17, p.z - 25.3);
    if (d < bd) {
      bd = d;
      stop = s;
    }
  }
  return { path, stop };
}

/**
 * Где упряжка в миг `t`: едет до стоянки, стоит `CART_DWELL`, едет обратно до горизонта и пережидает `CART_AWAY` за ним.
 * `s` — место на пути, `moving` — идёт ли вол, `away` — за горизонтом (не рисуется), `dist` — пройденное для колёс.
 */
export function cartAt(len: number, stop: number, t: number, phase: number): { s: number; moving: number; away: boolean; dist: number } {
  const go1 = stop / CART_SPEED;
  const go2 = (len - stop) / CART_SPEED;
  const cycle = go1 + CART_DWELL + go2 + CART_AWAY;
  const m = (((t + phase * cycle) % cycle) + cycle) % cycle;
  if (m < go1) return { s: m * CART_SPEED, moving: 1, away: false, dist: m * CART_SPEED };
  if (m < go1 + CART_DWELL) return { s: stop, moving: 0, away: false, dist: stop };
  if (m < go1 + CART_DWELL + go2) {
    const s = stop + (m - go1 - CART_DWELL) * CART_SPEED;
    return { s, moving: 1, away: false, dist: s };
  }
  return { s: len, moving: 0, away: true, dist: len };
}

// ---------------------------------------------------------------------------------------------
// Река: уровень воды по z через 2 м — кадру не считать шум рельефа.

const RIVER_Z0 = -460;
const RIVER_Z1 = 460;

function riverTable(): Float32Array {
  const n = Math.ceil((RIVER_Z1 - RIVER_Z0) / 2) + 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = riverLevel(RIVER_Z0 + i * 2);
  return out;
}

/** Утиные стайки: середина по z; вожак плавает петлёй, остальные — гуськом за ним. */
export const DUCK_FLOCKS: readonly number[] = [-64, 76, 142, -150];

/** Утка `i` стайки в миг `t`: вожак — петля поперёк и вдоль русла, ведомые — по его следу с отставанием. */
export function duckAt(z0: number, i: number, t: number, seed: number): { x: number; z: number } {
  const tt = t - i * 1.6;
  const w = (Math.PI * 2) / (260 + seed * 80);
  const z = z0 + 24 * Math.sin(w * tt + seed * 6.3);
  // Поперёк русла — не ближе 2.5 м к кромке воды.
  const x = riverX(z) + (RIVER_HALF - 2.5) * 0.8 * Math.sin(w * 2.3 * tt + seed * 3.1) + (i % 2 ? 0.35 : -0.35) * Math.min(1, i);
  return { x, z };
}

/** Лодка в пути: вдоль всей реки туда и обратно, правее середины по ходу; на концах — за горизонтом. */
export const BOAT_SPEED = 1.2;
export function boatAt(t: number, phase: number): { x: number; z: number; dir: number; dist: number } {
  const L = RIVER_Z1 - RIVER_Z0 - 40;
  const u = phase * 2 * L + t * BOAT_SPEED;
  const m = ((u % (2 * L)) + 2 * L) % (2 * L);
  const dir = m < L ? 1 : -1;
  const z = RIVER_Z0 + 20 + (m < L ? m : 2 * L - m);
  // Правее середины по ходу: на юг (dir 1) — к западному берегу (−x), на север — к восточному.
  const x = riverX(z) - dir * 3.2;
  return { x, z, dir, dist: u };
}

/** Лодка рыбака на привязи у восточного берега, ниже лесопилки. */
export const MOORED_Z = 64;

// ---------------------------------------------------------------------------------------------
// Стяги: длинные полотнища на воротах и донжоне, лицом к городу и дороге, колышутся в шейдере.

/**
 * Где висят стяги: середина верха, направление наружу от стены, ширина и длина, чья башня. Грань, упёртая в соседнюю
 * башню, — без стягов: северные ворота города и ворота замка стоят вплотную через ров.
 */
export function bannerSpots(towers: readonly Tower[]): { x: number; y: number; z: number; nx: number; nz: number; w: number; h: number; tower: number }[] {
  const out: { x: number; y: number; z: number; nx: number; nz: number; w: number; h: number; tower: number }[] = [];
  towers.forEach((t, ti) => {
    const gate = t.kind === 'gate' || t.kind === 'castleGate';
    if (!gate && t.kind !== 'keep') return;
    // У ворот — наружу, к дороге; у донжона — к городу (камера игры смотрит с юга).
    const f = t.kind === 'keep' ? -1 : 1;
    const nx = Math.cos(t.out) * f;
    const nz = Math.sin(t.out) * f;
    const rx = -nz;
    const rz = nx;
    const topY = t.base + t.height;
    const w = t.kind === 'keep' ? 2.2 : t.size > 10 ? 1.9 : 1.5;
    const h = t.kind === 'keep' ? 9 : t.size > 10 ? 7.5 : 6;
    const top = t.kind === 'keep' ? topY - 4 : topY - 1.6;
    const lat = t.size * 0.25;
    const fx = t.x + nx * (t.size / 2 + 0.14);
    const fz = t.z + nz * (t.size / 2 + 0.14);
    if (towers.some((o, oi) => oi !== ti && Math.abs(fx - o.x) < o.size / 2 + 1 && Math.abs(fz - o.z) < o.size / 2 + 1)) return;
    for (const side of [-1, 1]) out.push({ x: fx + rx * lat * side, y: top, z: fz + rz * lat * side, nx, nz, w, h, tower: ti });
  });
  return out;
}

/**
 * Полотнище стяга на холсте (П-2, docs/polish.md): поле — первая краска герба державы со складками, золотая кайма и пояс под
 * верхом, посередине — щит герба (`heraldry/paint`, тот же рисунок, что в шапке игры). Без документа (тест) — нет: стяг
 * красится цветом вершин. Герб сменился — холст перерисовывается на месте (`paintBanner`), текстура та же.
 */
function bannerTexture(arms: Arms): THREE.CanvasTexture | null {
  if (typeof document === 'undefined' || !canPaintArms()) return null;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 320;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  paintBanner(t, arms);
  return t;
}

function paintBanner(t: THREE.CanvasTexture, arms: Arms): void {
  const c = t.image as HTMLCanvasElement;
  const x = c.getContext('2d');
  if (!x) return;
  x.fillStyle = TINCTURE_HEX[arms.field[0]];
  x.fillRect(0, 0, 128, 320);
  // Складки: полосы светлее и темнее вдоль.
  const g = x.createLinearGradient(0, 0, 128, 0);
  for (let i = 0; i <= 8; i++) g.addColorStop(i / 8, i % 2 ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.22)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 320);
  x.strokeStyle = '#b8903a';
  x.lineWidth = 8;
  x.strokeRect(10, 10, 108, 300);
  x.fillStyle = '#b8903a';
  x.fillRect(10, 52, 108, 6);
  paintArms(x, arms, 22, 92, 84);
  t.needsUpdate = true;
}

function bannerMesh(towers: readonly Tower[], time: { value: number }, map: THREE.CanvasTexture | null): THREE.Mesh {
  const NX = 4;
  const NY = 8;
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const drape: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const red = map ? WHITE : linear(0x7e1e1a);
  const gold = map ? WHITE : linear(0xb8903a);
  for (const b of bannerSpots(towers)) {
    const rx = -b.nz;
    const rz = b.nx;
    const base = pos.length / 3;
    for (let j = 0; j <= NY; j++) {
      for (let i = 0; i <= NX; i++) {
        const u = i / NX;
        const v = j / NY;
        // Ласточкин хвост: середина низа подрезана вверх.
        const cut = j === NY ? (1 - Math.abs(u - 0.5) * 2) * 0.12 * b.h : 0;
        const y = b.y - v * b.h + cut;
        pos.push(b.x + rx * (u - 0.5) * b.w, y, b.z + rz * (u - 0.5) * b.w);
        nor.push(b.nx, 0, b.nz);
        // Красное поле, золотая кайма по краям и золотой пояс под верхом.
        const edge = i === 0 || i === NX || j === 0 || j === 2;
        col.push(...(edge ? gold : red));
        drape.push(v, u);
        uv.push(u, 1 - v + cut / b.h);
      }
    }
    for (let j = 0; j < NY; j++) {
      for (let i = 0; i < NX; i++) {
        const a = base + j * (NX + 1) + i;
        const c = a + NX + 1;
        idx.push(a, a + 1, c, a + 1, c + 1, c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('drape', new THREE.BufferAttribute(new Float32Array(drape), 2));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, map });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.cTime = time;
    shader.vertexShader = 'attribute vec2 drape;\nuniform float cTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      // Полотнище висит от верха: внизу колышется сильнее, волна бежит вниз; только от стены — в камень не уходит.
      float ph = position.x * 0.31 + position.z * 0.17;
      float w = (0.55 + 0.45 * sin(cTime * 1.9 - drape.x * 3.4 + ph)) * 0.22 * drape.x + 0.05 * sin(cTime * 3.3 + drape.y * 4.0 + ph) * drape.x;
      transformed += normal * w;
      transformed.y += 0.06 * drape.x * sin(cTime * 1.3 + ph);`,
    );
  };
  m.customProgramCacheKey = () => 'city-banner';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'city-banners';
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------------------------
// Голуби: две стайки на площади — у паперти и у колодца. Клюют, переходя с места на место, раз в три четверти минуты
// стайка разом взлетает кругом над площадью и садится, где сидела. Всё в шейдере: середина круга, фаза — атрибуты.

/** Середины стаек, период взлёта (с) и доля периода в воздухе. */
export const PIGEON_FLOCKS: readonly P[] = [
  { x: -7, z: -17 },
  { x: 14, z: -11 },
];
export const PIGEON_PERIOD = 46;
export const PIGEON_AIR = 0.26;

/**
 * Голубь стайки в миг `t` — то же, что считает шейдер (`pigeonMesh`), для теста: на земле — у своего места, в воздухе —
 * на круге, который начинается и кончается в его месте.
 */
export function pigeonAt(home: P, seed: number, flock: number, t: number): { x: number; z: number; up: number } {
  const ga = seed * 40 + t * 0.15;
  const x = home.x + Math.cos(ga) * 0.4;
  const z = home.z + Math.sin(ga) * 0.4;
  const f = (((t / PIGEON_PERIOD + flock * 0.43) % 1) + 1) % 1;
  if (f < 1 - PIGEON_AIR) return { x, z, up: 0 };
  // Круг взлёта начинается и кончается там, где голубь клюёт: ни взлёт, ни посадка не прыгают.
  // Разгон и торможение: доля круга — плавной ступенью, у земли голубь медленный.
  const u0 = (f - (1 - PIGEON_AIR)) / PIGEON_AIR;
  const u = u0 * u0 * (3 - 2 * u0);
  const r = 6 + seed * 3;
  const a0 = seed * 6.2832;
  const a = a0 + u * 6.2832;
  return { x: x + Math.cos(a0) * r - Math.cos(a) * r, z: z + Math.sin(a0) * r - Math.sin(a) * r, up: Math.sin(u * Math.PI) * (6 + seed * 4) };
}

function pigeonMesh(n: number, time: { value: number }, light: { value: number }): THREE.Mesh {
  const pos: number[] = [];
  const home: number[] = [];
  const bird: number[] = [];
  const wing: number[] = [];
  for (let k = 0; k < n; k++) {
    const f = k % PIGEON_FLOCKS.length;
    const c = PIGEON_FLOCKS[f];
    const hx = c.x + (rnd(k, 1, 91) - 0.5) * 9;
    const hz = c.z + (rnd(k, 2, 91) - 0.5) * 6;
    const hy = heightAt(hx, hz);
    const seed = rnd(k, 3, 91);
    // Тело и два крыла: на земле крылья сложены вдоль тела, в воздухе — машут.
    const tri: [number, number, number][] = [
      [0.17, 0, 0],
      [-0.15, 0, 0.05],
      [-0.15, 0, -0.05],
      [0.04, 0, 0],
      [-0.08, 0, 0.3],
      [-0.1, 0, 0],
      [0.04, 0, 0],
      [-0.1, 0, 0],
      [-0.08, 0, -0.3],
    ];
    tri.forEach(([x, y, z], i) => {
      pos.push(x, y, z);
      home.push(hx, hy, hz);
      bird.push(seed, f, 0);
      wing.push(i >= 3 ? Math.sign(z) : 0);
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('home', new THREE.BufferAttribute(new Float32Array(home), 3));
  g.setAttribute('bird', new THREE.BufferAttribute(new Float32Array(bird), 3));
  g.setAttribute('wing', new THREE.BufferAttribute(new Float32Array(wing), 1));
  const m = new THREE.MeshBasicMaterial({ color: 0x6e727c, side: THREE.DoubleSide });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.cTime = time;
    shader.uniforms.cLight = light;
    shader.vertexShader = 'attribute vec3 home;\nattribute vec3 bird;\nattribute float wing;\nuniform float cTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `
      float seed = bird.x;
      float f = fract(cTime / ${PIGEON_PERIOD.toFixed(1)} + bird.y * 0.43);
      float air = step(${(1 - PIGEON_AIR).toFixed(3)}, f);
      float u = smoothstep(0.0, 1.0, (f - ${(1 - PIGEON_AIR).toFixed(3)}) / ${PIGEON_AIR.toFixed(3)});
      float r = 6.0 + seed * 3.0;
      float a0 = seed * 6.2832;
      float a = a0 + u * 6.2832;
      float ga = seed * 40.0 + cTime * 0.15;
      vec3 g = home + vec3(cos(ga) * 0.4, 0.0, sin(ga) * 0.4);
      vec3 c = g + air * vec3(cos(a0) * r - cos(a) * r, sin(u * 3.1416) * (6.0 + seed * 4.0), sin(a0) * r - sin(a) * r);
      // Курс: на земле — бродит, клюёт (голова вниз-вверх); в воздухе — по касательной к кругу.
      vec2 dir = air > 0.5 ? normalize(vec2(sin(a), -cos(a))) : normalize(vec2(-sin(ga), cos(ga)) + vec2(0.001));
      float peck = (1.0 - air) * step(0.0, position.x - 0.1) * max(0.0, sin(cTime * 7.0 + seed * 30.0)) * 0.06;
      vec3 p = position * (1.0 - 0.5 * (1.0 - air) * abs(wing));
      p.y += air * abs(wing) * (sin(cTime * 16.0 + seed * 9.0) * 0.22 + 0.05) - peck + 0.06;
      vec3 transformed = c + vec3(p.x * dir.x - p.z * dir.y, p.y, p.x * dir.y + p.z * dir.x);`,
    );
    shader.fragmentShader = 'uniform float cLight;\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= cLight;');
  };
  m.customProgramCacheKey = () => 'city-pigeons';
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'city-pigeons';
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------------------------

export interface BustleInput {
  plan: CityPlan;
  quality: Quality;
}

/** Поклажа телег: мешки, сено, бочки, холст. */
const LOAD = [0xb8a47a, 0xc8b060, 0x7a5a3a, 0xd8d0b8, 0x9a8a6a].map(linear);
/** Головы уток: селезни зелёные, утки бурые. */
const DUCK_HEAD = [0x2e5a3a, 0x6a5a44, 0x2a4a34, 0x7a6a50].map(linear);

/**
 * Суета города: телеги, утки, лодки, стяги. Сколько — потолок уровня (`LIFE_CAP`); ночью ворота закрыты — новых телег нет,
 * лодка не выходит; зимой река подо льдом — уток нет, лодка рыбака вмёрзла у берега.
 */
export class CityBustle {
  readonly group = new THREE.Group();
  private cap: (typeof LIFE_CAP)[Quality];
  private time = { value: 0 };
  private carts: THREE.InstancedMesh | null = null;
  private cartGait: THREE.InstancedBufferAttribute | null = null;
  private route: { path: Path; stop: number } | null = null;
  /** Телега выходит в путь, только если ворота открыты, когда она за горизонтом: днём не исчезает посреди дороги. */
  private cartOut: boolean[] = [];
  private ducks: THREE.InstancedMesh | null = null;
  private boats: THREE.InstancedMesh | null = null;
  private boatGait: THREE.InstancedBufferAttribute | null = null;
  private boatOut: boolean[] = [];
  private banners: THREE.Mesh | null = null;
  /** Холст стягов и чей герб на нём (`setArms`). */
  private bannerMap: THREE.CanvasTexture | null = null;
  private armsKey = '';
  private pigeons: THREE.Mesh | null = null;
  private light = { value: 1 };
  private river = riverTable();
  private m4 = new THREE.Matrix4();
  private q4 = new THREE.Quaternion();
  private q5 = new THREE.Quaternion();
  private v3 = new THREE.Vector3();
  private s3 = new THREE.Vector3(1, 1, 1);
  private up = new THREE.Vector3(0, 1, 0);
  private side = new THREE.Vector3(0, 0, 1);
  private first = true;

  constructor(input: BustleInput) {
    const { plan, quality } = input;
    this.cap = LIFE_CAP[quality];
    const mat = figureMaterial();
    const col = new THREE.Color();
    if (this.cap.carts > 0) {
      this.route = cartRoute(plan);
      this.carts = new THREE.InstancedMesh(cartGeometry(), mat, this.cap.carts);
      this.cartGait = gaitOf(this.carts);
      this.carts.name = 'city-carts';
      for (let i = 0; i < this.cap.carts; i++) {
        const c = LOAD[i % LOAD.length];
        this.carts.setColorAt(i, col.setRGB(c[0], c[1], c[2]));
      }
    }
    if (this.cap.ducks > 0) {
      this.ducks = new THREE.InstancedMesh(duckGeometry(), mat, this.cap.ducks);
      this.ducks.name = 'city-ducks';
      gaitOf(this.ducks);
      for (let i = 0; i < this.cap.ducks; i++) {
        const c = DUCK_HEAD[i % DUCK_HEAD.length];
        this.ducks.setColorAt(i, col.setRGB(c[0], c[1], c[2]));
      }
    }
    if (this.cap.boats > 0) {
      this.boats = new THREE.InstancedMesh(boatGeometry(), mat, this.cap.boats);
      this.boatGait = gaitOf(this.boats);
      this.boats.name = 'city-boats';
      for (let i = 0; i < this.cap.boats; i++) {
        const c = LOAD[(i + 3) % LOAD.length];
        this.boats.setColorAt(i, col.setRGB(c[0] * 0.8, c[1] * 0.7, c[2] * 0.7));
      }
    }
    for (const im of [this.carts, this.ducks, this.boats]) {
      if (!im) continue;
      im.frustumCulled = false;
      im.count = 0;
      this.group.add(im);
    }
    if (this.cap.pigeons > 0) {
      this.pigeons = pigeonMesh(this.cap.pigeons, this.time, this.light);
      this.group.add(this.pigeons);
    }
    if (this.cap.banners > 0) {
      this.armsKey = armsCode(DEFAULT_ARMS);
      this.bannerMap = bannerTexture(DEFAULT_ARMS);
      this.banners = bannerMesh(plan.towers, this.time, this.bannerMap);
      this.group.add(this.banners);
    }
  }

  private riverY(z: number): number {
    const f = Math.min(this.river.length - 1.001, Math.max(0, (z - RIVER_Z0) / 2));
    const i = Math.floor(f);
    return this.river[i] + (this.river[i + 1] - this.river[i]) * (f - i);
  }

  private place(im: THREE.InstancedMesh, k: number, x: number, y: number, z: number, yaw: number, pitch: number, scale: number): void {
    this.q4.setFromAxisAngle(this.up, yaw);
    if (pitch !== 0) this.q4.multiply(this.q5.setFromAxisAngle(this.side, pitch));
    this.m4.compose(this.v3.set(x, y, z), this.q4, this.s3.set(scale, scale, scale));
    im.setMatrixAt(k, this.m4);
  }

  /** Кадр: всё от времени `t`. `night` — доля ночи окон (ворота закрыты с половины), `snow` — доля зимы (лёд с трети). */
  update(t: number, night: number, snow: number): void {
    this.time.value = t;
    const open = night < 0.5;
    const ice = snow > 0.35;
    // Голуби ночуют под стрехой: с сумерек их на площади нет; свет на них — доля дня.
    this.light.value = 1 - 0.8 * night;
    if (this.pigeons) this.pigeons.visible = night < 0.6;
    if (this.carts && this.cartGait && this.route) {
      const { path, stop } = this.route;
      const g = this.cartGait.array as Float32Array;
      // Зимой — вдвое реже: дорога тяжела.
      const n = ice ? Math.ceil(this.cap.carts / 2) : this.cap.carts;
      let k = 0;
      for (let i = 0; i < this.cap.carts; i++) {
        const c = cartAt(path.len, stop, t, i / this.cap.carts);
        if (c.away || this.first) this.cartOut[i] = open && i < n;
        if (c.away || !this.cartOut[i]) continue;
        const a = at(path, c.s);
        // Путь упряжки — в одну сторону: вперёд по нему и есть ход.
        const yaw = Math.atan2(-a.tz, a.tx);
        const hb = heightOnPath(path, Math.max(0, c.s - 0.4));
        const hf = heightOnPath(path, Math.min(path.len, c.s + 3.6));
        const y = heightOnPath(path, c.s);
        this.place(this.carts, k, a.p.x, y, a.p.z, yaw, Math.atan2(hf - hb, 4), 1);
        g[k * 2] = c.dist;
        g[k * 2 + 1] = c.moving;
        // Цвет поклажи — за телегой, а не за местом в буфере.
        const lc = LOAD[i % LOAD.length];
        this.carts.setColorAt(k, COL.setRGB(lc[0], lc[1], lc[2]));
        k++;
      }
      this.carts.count = k;
      this.carts.instanceMatrix.needsUpdate = true;
      if (this.carts.instanceColor) this.carts.instanceColor.needsUpdate = true;
      this.cartGait.needsUpdate = true;
    }
    if (this.ducks) {
      let k = 0;
      if (!ice) {
        const per = Math.ceil(this.cap.ducks / DUCK_FLOCKS.length);
        for (let i = 0; i < this.cap.ducks; i++) {
          const f = Math.floor(i / per);
          const j = i % per;
          const z0 = DUCK_FLOCKS[f];
          const p = duckAt(z0, j, t, f * 0.37);
          const q = duckAt(z0, j, t + 0.6, f * 0.37);
          const yaw = Math.atan2(-(q.z - p.z), q.x - p.x);
          this.place(this.ducks, k++, p.x, this.riverY(p.z) + Math.sin(t * 1.7 + i) * 0.015, p.z, yaw, 0, 1);
        }
      }
      this.ducks.count = k;
      this.ducks.instanceMatrix.needsUpdate = true;
    }
    if (this.boats && this.boatGait) {
      const g = this.boatGait.array as Float32Array;
      let k = 0;
      for (let i = 0; i < this.cap.boats; i++) {
        if (i === this.cap.boats - 1) {
          // Рыбак на привязи: стоит у берега носом против течения (на север), покачивается; зимой вмёрз.
          const x = riverX(MOORED_Z) + RIVER_HALF - 3;
          this.place(this.boats, k, x, this.riverY(MOORED_Z) + (ice ? -0.05 : Math.sin(t * 1.1) * 0.03), MOORED_Z, Math.PI / 2 + 0.15 + (ice ? 0 : Math.sin(t * 0.21) * 0.18), ice ? 0 : Math.sin(t * 0.9) * 0.02, 1);
          g[k * 2] = 0;
          g[k * 2 + 1] = 0;
          k++;
          continue;
        }
        const b = boatAt(t, i * 0.37 + 0.11);
        const far = b.z < RIVER_Z0 + 40 || b.z > RIVER_Z1 - 40;
        if (far || this.first) this.boatOut[i] = open;
        // Лёд встал — лодка на берегу сразу: зима приходит раз в сезон, а лодка на льду видна всю зиму.
        if (!this.boatOut[i] || ice) continue;
        const dx = riverX(b.z + b.dir) - riverX(b.z);
        // Ход — (dx, dir) в плане: вниз по течению на юг, обратно на север.
        const yaw = Math.atan2(-b.dir, dx);
        this.place(this.boats, k, b.x, this.riverY(b.z) + Math.sin(t * 1.3 + i) * 0.03, b.z, yaw, Math.sin(t * 0.8 + i) * 0.015, 1);
        g[k * 2] = b.dist;
        g[k * 2 + 1] = 1;
        k++;
      }
      this.boats.count = k;
      this.boats.instanceMatrix.needsUpdate = true;
      this.boatGait.needsUpdate = true;
    }
    this.first = false;
  }

  /** Герб державы на стягах (строка `ProfileState.arms`): сменился — холст перерисовывается, текстура та же. */
  setArms(code: string | null | undefined): void {
    const arms = armsOr(code);
    const key = armsCode(arms);
    if (key === this.armsKey || !this.bannerMap) return;
    this.armsKey = key;
    paintBanner(this.bannerMap, arms);
  }

  dispose(): void {
    const seen = new Set<THREE.Material>();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material as THREE.MeshLambertMaterial;
      if (!seen.has(mat)) {
        seen.add(mat);
        mat.map?.dispose();
        mat.dispose();
      }
    });
  }
}

const COL = new THREE.Color();
