// Жизнь вида «город» (docs/city.md, раздел 11.4): прохожие по улицам и площади, стража на стене, дым из
// труб, флаги на башнях, птицы над крышами, овцы в загоне и коровы у хутора. Всё — экземплярами или одним
// мешем на вид: вызовов отрисовки столько, сколько видов, а не фигур; на низком уровне фигур меньше.
//
// Сколько людей на улицах и стражи на стене — от партии (`set`): население и войско. Ночью улицы
// пустеют, стража остаётся.
import * as THREE from 'three';
import type { Quality } from '../quality';
import { Smoke, type SmokeSource } from '../weather';
import type { V3 } from './geom';
import { heightAt, insidePoly, type CityPlan, type P } from './layout';
import { wallTops } from './forts';
import { hash3, rnd } from './noise';
import { linear } from './palette';
import { LIFE_CAP } from './spec';
export { LIFE_CAP } from './spec';

// ---------------------------------------------------------------------------------------------
// Модели: фигура стоит в начале координат лицом на +x; масштаб — метры.

interface Part {
  /** Середина низа, полуразмеры и сужение кверху. */
  x: number;
  y0: number;
  y1: number;
  hw: number;
  hd: number;
  taper?: number;
  col: V3;
  /** 1 — красится цветом экземпляра (одежда), 0 — свой цвет (лицо, ноги, древко). */
  tint: number;
}

/** Коробки фигуры в один буфер: положение, нормаль, цвет, маска окраски. */
function figure(parts: Part[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const msk: number[] = [];
  const idx: number[] = [];
  for (const p of parts) {
    const t = p.taper ?? 1;
    const lo = [p.hw, p.hd];
    const hi = [p.hw * t, p.hd * t];
    const c = (sx: number, sy: number, sz: number): V3 => {
      const h = sy > 0 ? hi : lo;
      return [p.x + sx * h[1], sy > 0 ? p.y1 : p.y0, sz * h[0]];
    };
    // Шесть граней: обход против часовой, если смотреть снаружи (нормаль — наружу).
    const faces: [V3, V3, V3, V3, V3][] = [
      [c(1, -1, 1), c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), [1, 0, 0]],
      [c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1), [-1, 0, 0]],
      [c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1), [0, 0, 1]],
      [c(1, -1, -1), c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1), [0, 0, -1]],
      [c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1), [0, 1, 0]],
      [c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1), [0, -1, 0]],
    ];
    for (const [a, b, cc, d, n] of faces) {
      const base = pos.length / 3;
      for (const v of [a, b, cc, d]) {
        pos.push(...v);
        nor.push(...n);
        // Затенение снизу: фигура «стоит», а не висит.
        const k = 0.75 + 0.25 * Math.min(1, v[1] / 1.6);
        col.push(p.col[0] * k, p.col[1] * k, p.col[2] * k);
        msk.push(p.tint);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('tintMask', new THREE.BufferAttribute(new Float32Array(msk), 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const SKIN: V3 = linear(0xc79a7a);
const LEGS: V3 = linear(0x4a3b2e);
const WHITE: V3 = [1, 1, 1];
const STEEL: V3 = linear(0x8a8e92);
const SHAFT: V3 = linear(0x5a4632);

/** Горожанин: ноги, рубаха до колен (цвет экземпляра), голова. */
export const personGeometry = (): THREE.BufferGeometry =>
  figure([
    { x: 0, y0: 0, y1: 0.78, hw: 0.17, hd: 0.11, col: LEGS, tint: 0 },
    { x: 0, y0: 0.62, y1: 1.42, hw: 0.27, hd: 0.16, taper: 0.78, col: WHITE, tint: 1 },
    { x: 0, y0: 1.42, y1: 1.7, hw: 0.11, hd: 0.11, col: SKIN, tint: 0 },
  ]);

/** Стражник: то же и шлем, древко копья выше головы. */
export const guardGeometry = (): THREE.BufferGeometry =>
  figure([
    { x: 0, y0: 0, y1: 0.8, hw: 0.17, hd: 0.12, col: LEGS, tint: 0 },
    { x: 0, y0: 0.65, y1: 1.45, hw: 0.29, hd: 0.18, taper: 0.8, col: WHITE, tint: 1 },
    { x: 0, y0: 1.45, y1: 1.7, hw: 0.11, hd: 0.11, col: SKIN, tint: 0 },
    { x: 0, y0: 1.66, y1: 1.84, hw: 0.13, hd: 0.13, taper: 0.6, col: STEEL, tint: 0 },
    { x: 0.05, y0: 0.2, y1: 2.6, hw: 0.03, hd: 0.03, col: SHAFT, tint: 0 },
    { x: 0.05, y0: 2.6, y1: 2.85, hw: 0.04, hd: 0.04, taper: 0.2, col: STEEL, tint: 0 },
  ]);

/** Овца (корова — та же, крупнее и в своём цвете): туловище, голова, четыре ноги одной коробкой. */
export const beastGeometry = (): THREE.BufferGeometry =>
  figure([
    { x: 0, y0: 0, y1: 0.35, hw: 0.2, hd: 0.36, col: LEGS, tint: 0 },
    { x: 0, y0: 0.3, y1: 0.85, hw: 0.28, hd: 0.55, taper: 0.9, col: WHITE, tint: 1 },
    { x: 0.62, y0: 0.55, y1: 0.95, hw: 0.13, hd: 0.15, col: LEGS, tint: 0 },
  ]);

/** Ламберт с краской экземпляра только по маске: одежда своя у каждого, лицо — у всех лицо. */
function figureMaterial(): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float tintMask;\n' + shader.vertexShader.replace(
      '#include <color_vertex>',
      /* glsl */ `#if defined( USE_COLOR_ALPHA )
        vColor = vec4( 1.0 );
      #elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
        vColor = vec3( 1.0 );
      #endif
      #ifdef USE_COLOR
        vColor *= color;
      #endif
      #ifdef USE_INSTANCING_COLOR
        vColor.xyz *= mix( vec3( 1.0 ), instanceColor.xyz, tintMask );
      #endif`,
    );
  };
  m.customProgramCacheKey = () => 'city-figure';
  return m;
}

// ---------------------------------------------------------------------------------------------
// Пути: ломаная с накопленной длиной и высотами земли через метр — кадру не считать шум рельефа.

interface Path {
  pts: P[];
  acc: number[];
  len: number;
  /** Высота пути через метр (по земле или по боевому ходу стены). */
  h: Float32Array;
  /** Полуширина: прохожие держатся сторон улицы. */
  half: number;
}

function pathOf(pts: P[], half: number, height: (p: P, k: number, f: number) => number): Path {
  const acc = [0];
  for (let k = 1; k < pts.length; k++) acc.push(acc[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].z - pts[k - 1].z));
  const len = acc[acc.length - 1];
  const path: Path = { pts, acc, len, h: new Float32Array(Math.ceil(len) + 2), half };
  for (let i = 0; i < path.h.length; i++) {
    const { p, k, f } = at(path, i);
    path.h[i] = height(p, k, f);
  }
  return path;
}

const AT = { p: { x: 0, z: 0 }, k: 0, f: 0, tx: 1, tz: 0 };
function at(path: Path, s: number): typeof AT {
  const { pts, acc } = path;
  const ss = Math.min(Math.max(s, 0), path.len);
  let lo = 0;
  let hi = acc.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (acc[m] <= ss) lo = m;
    else hi = m;
  }
  const a = pts[lo];
  const b = pts[hi];
  const l = acc[hi] - acc[lo] || 1;
  const f = (ss - acc[lo]) / l;
  AT.p = { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
  AT.k = lo;
  AT.f = f;
  AT.tx = (b.x - a.x) / l;
  AT.tz = (b.z - a.z) / l;
  return AT;
}

const heightOnPath = (path: Path, s: number): number => {
  const i = Math.min(path.h.length - 2, Math.max(0, Math.floor(s)));
  const f = Math.min(1, Math.max(0, s - i));
  return path.h[i] + (path.h[i + 1] - path.h[i]) * f;
};

interface Walker {
  path: number;
  s: number;
  v: number;
  side: number;
  /** Стоит (на площади, у колодца): покачивается на месте. */
  idle?: { x: number; z: number; y: number; yaw: number };
}

// ---------------------------------------------------------------------------------------------

/** Мягкое пятно для клубов дыма: круглый край вместо квадрата точки. */
function softDot(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const x = c.getContext('2d');
  if (!x) return null;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Что жизни нужно от собранного города. */
export interface LifeInput {
  plan: CityPlan;
  /** Верхушки труб: из них идёт дым. */
  chimneys: V3[];
  /** Верхушки башен: на них флаги. */
  flagTops: V3[];
  quality: Quality;
}

const DRESS = [0x7a4a3a, 0x5a6a7a, 0x8a7a5a, 0x6a5a4a, 0x9a8a6a, 0x4a5a3a, 0x8a5a5a, 0x5a4a6a, 0xa09070, 0x6a6a5a].map(linear);
const TABARD = [0x8a2f2a, 0x7a3a2c, 0x6a2a28].map(linear);

export class CityLife {
  readonly group = new THREE.Group();
  private paths: Path[] = [];
  private wall: Path;
  private walkers: Walker[] = [];
  private guards: Walker[] = [];
  private people: THREE.InstancedMesh;
  private sentries: THREE.InstancedMesh;
  private beasts: THREE.InstancedMesh;
  private beastAt: { x: number; z: number; y: number; yaw: number; r: number; seed: number }[] = [];
  private smoke: Smoke;
  private smokeOn: SmokeSource[] = [];
  private work: SmokeSource[] = [];
  private flags: THREE.Mesh;
  private birds: THREE.Mesh;
  private time = { value: 0 };
  private want = { people: 0, guards: 0 };
  private cap: (typeof LIFE_CAP)[Quality];
  private m4 = new THREE.Matrix4();
  private q4 = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private v3 = new THREE.Vector3();
  private s3 = new THREE.Vector3(1, 1, 1);

  constructor(private input: LifeInput) {
    const { plan, quality } = input;
    this.cap = LIFE_CAP[quality];
    const ground = (p: P): number => heightAt(p.x, p.z);
    // Улицы и площадь — прохожим; переулки и вдоль стены — реже (по длине доля и так меньше).
    for (const st of plan.streets) this.paths.push(pathOf(st.pts, st.half, ground));
    for (const r of plan.roads.slice(0, 2)) this.paths.push(pathOf(r.pts.slice(0, Math.min(r.pts.length, 18)), r.half, ground));
    // Боевой ход: контур стены, сдвинутый внутрь на метр, высота — верх хода.
    const tops = wallTops(plan.wall);
    const n = plan.wall.length;
    const inner: P[] = plan.wall.map((p, k) => {
      const a = plan.wall[(k - 1 + n) % n];
      const b = plan.wall[(k + 1) % n];
      let nx = -(b.z - a.z);
      let nz = b.x - a.x;
      const l = Math.hypot(nx, nz) || 1;
      nx /= l;
      nz /= l;
      if (!insidePoly({ x: p.x + nx * 2, z: p.z + nz * 2 }, plan.wall)) {
        nx = -nx;
        nz = -nz;
      }
      return { x: p.x + nx * 0.4, z: p.z + nz * 0.4 };
    });
    inner.push(inner[0]);
    const topsClosed = [...tops, tops[0]];
    this.wall = pathOf(inner, 0, (_p, k, f) => topsClosed[k] + (topsClosed[k + 1] - topsClosed[k]) * f);

    const mat = figureMaterial();
    this.people = new THREE.InstancedMesh(personGeometry(), mat, this.cap.people);
    this.sentries = new THREE.InstancedMesh(guardGeometry(), mat, this.cap.guards);
    this.beasts = new THREE.InstancedMesh(beastGeometry(), mat, this.cap.animals);
    for (const im of [this.people, this.sentries, this.beasts]) {
      im.frustumCulled = false;
      im.count = 0;
      this.group.add(im);
    }
    this.people.name = 'city-people';
    this.sentries.name = 'city-guards';
    this.beasts.name = 'city-beasts';
    // Цвет одежды — до первого кадра: без него программа собралась бы без цвета экземпляров.
    const col = new THREE.Color();
    for (let i = 0; i < this.cap.people; i++) {
      const c = DRESS[hash3(i, 3, 97) % DRESS.length];
      this.people.setColorAt(i, col.setRGB(c[0], c[1], c[2]));
    }
    for (let i = 0; i < this.cap.guards; i++) {
      const c = TABARD[i % TABARD.length];
      this.sentries.setColorAt(i, col.setRGB(c[0], c[1], c[2]));
    }
    this.seedWalkers();
    this.seedBeasts();

    this.smoke = new Smoke({ size: 3.4, opacity: 0.17, drift: { x: 0.45, z: -0.2 } }, []);
    const dot = softDot();
    const sm = this.smoke.points.material as THREE.PointsMaterial;
    if (dot) {
      sm.map = dot;
      sm.alphaTest = 0.01;
    }
    this.smoke.points.name = 'city-smoke';
    this.group.add(this.smoke.points);
    // Дым идёт не из каждой трубы: топят там, где сейчас готовят, — доля от зерна.
    this.smokeOn = input.chimneys
      .filter((c, k) => rnd(Math.round(c[0] * 3), Math.round(c[2] * 3), 61) < 0.5 && k < this.cap.smoke * 3)
      .slice(0, this.cap.smoke)
      .map((c) => ({ x: c[0], y: c[1], z: c[2], puffs: 5, top: 10 }));
    this.smoke.setSources(this.smokeOn);

    this.flags = this.buildFlags(input.flagTops);
    this.group.add(this.flags);
    this.birds = this.buildBirds(plan);
    this.group.add(this.birds);
  }

  /** Прохожие: кто идёт по какой улице, кто стоит на площади. Раскладка от зерна — одна на город. */
  private seedWalkers(): void {
    const total = this.cap.people;
    const lens = this.paths.map((p) => p.len);
    const sum = lens.reduce((a, b) => a + b, 0);
    const idle = Math.round(total * 0.3);
    for (let k = 0; k < total - idle; k++) {
      // Улица — по длине: на длинной больше народу.
      let r = rnd(k, 1, 71) * sum;
      let path = 0;
      while (path < lens.length - 1 && r > lens[path]) r -= lens[path++];
      const v = (0.9 + rnd(k, 2, 71) * 0.6) * (rnd(k, 3, 71) < 0.5 ? 1 : -1);
      this.walkers.push({ path, s: rnd(k, 4, 71) * this.paths[path].len, v, side: (rnd(k, 5, 71) - 0.5) * 1.5 });
    }
    // Стоят: у рядов рынка, у колодца, у паперти храма.
    const sq = this.input.plan;
    for (let k = 0; k < idle; k++) {
      const kind = rnd(k, 6, 73);
      const c = kind < 0.6 ? { x: 4, z: 11, rx: 17, rz: 9 } : kind < 0.85 ? { x: sq.well.x, z: sq.well.z, rx: 5, rz: 4 } : { x: -9, z: -29, rx: 12, rz: 4 };
      const x = c.x + (rnd(k, 7, 73) - 0.5) * 2 * c.rx;
      const z = c.z + (rnd(k, 8, 73) - 0.5) * 2 * c.rz;
      this.walkers.push({ path: -1, s: 0, v: 0, side: 0, idle: { x, z, y: heightAt(x, z), yaw: rnd(k, 9, 73) * Math.PI * 2 } });
    }
    // Стража: на своём отрезке боевого хода, ходит взад-вперёд.
    for (let k = 0; k < this.cap.guards; k++) {
      this.guards.push({ path: 0, s: ((k + rnd(k, 1, 79) * 0.6) / this.cap.guards) * this.wall.len, v: 0.7 * (k % 2 ? 1 : -1), side: 0 });
    }
  }

  /** Скот: овцы в загоне, коровы у хутора — разбросом, медленно бродят по кругу. */
  private seedBeasts(): void {
    const pen = this.input.plan.yards.find((y) => y.kind === 'pen');
    const farm = this.input.plan.yards.find((y) => y.kind === 'farm');
    const sheep = Math.round(this.cap.animals * 0.7);
    for (let k = 0; k < this.cap.animals; k++) {
      const y = k < sheep ? pen : farm;
      if (!y) continue;
      const fx = Math.cos(y.rot);
      const fz = Math.sin(y.rot);
      // В рамке двора: загон — 20 × 30 м, выгон хутора — за изгородью сбоку.
      const f = k < sheep ? (rnd(k, 1, 83) - 0.5) * 14 : -20 + rnd(k, 1, 83) * 6;
      const r = k < sheep ? (rnd(k, 2, 83) - 0.5) * 22 : -22 + rnd(k, 2, 83) * 10;
      const x = y.x + fx * f + fz * r;
      const z = y.z + fz * f - fx * r;
      this.beastAt.push({ x, z, y: heightAt(x, z), yaw: rnd(k, 3, 83) * Math.PI * 2, r: k < sheep ? 1 : 1.7, seed: hash3(k, 5, 83) });
    }
    const col = new THREE.Color();
    this.beastAt.forEach((b, k) => {
      const sheepTone = linear(rnd(k, 4, 83) < 0.15 ? 0x4a4038 : 0xe8e2d4);
      const cowTone = linear(rnd(k, 4, 83) < 0.5 ? 0x7a5236 : 0x3e342c);
      const t = b.r > 1.2 ? cowTone : sheepTone;
      this.beasts.setColorAt(k, col.setRGB(t[0], t[1], t[2]));
    });
    if (this.beasts.instanceColor) this.beasts.instanceColor.needsUpdate = true;
  }

  /**
   * Флаги на башнях: древко и полотнище, полотнище вьётся в шейдере (ветер один на всех). Один меш на
   * все флаги; цвет — красное поле города с золотой бахромой.
   */
  private buildFlags(tops: V3[]): THREE.Mesh {
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const flap: number[] = [];
    const idx: number[] = [];
    const red = linear(0x9a2a24);
    const gold = linear(0xc8a040);
    const pole = linear(0x3a3028);
    // Ветер — с запада на восток, чуть к югу: полотнища смотрят по ветру.
    const wx = 0.92;
    const wz = 0.38;
    const NX = 6;
    const NY = 3;
    for (const [x, y, z] of tops) {
      // Древко: тонкий четырёхгранник.
      const b0 = pos.length / 3;
      const ph = 3.2;
      const pr = 0.06;
      // Обход по часовой, если смотреть сверху: грань древка смотрит наружу (с двусторонним материалом
      // иначе three перевернул бы нормаль внутрь, и древко светилось бы с теневой стороны).
      const ring = [
        [pr, pr],
        [pr, -pr],
        [-pr, -pr],
        [-pr, pr],
      ];
      for (let k = 0; k < 4; k++) {
        const [ax, az] = ring[k];
        const [bx, bz] = ring[(k + 1) % 4];
        const base = pos.length / 3;
        pos.push(x + ax, y, z + az, x + bx, y, z + bz, x + bx, y + ph, z + bz, x + ax, y + ph, z + az);
        const nx = (ax + bx) / 2;
        const nz = (az + bz) / 2;
        const l = Math.hypot(nx, nz) || 1;
        for (let j = 0; j < 4; j++) {
          nor.push(nx / l, 0, nz / l);
          col.push(...pole);
          flap.push(0);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      void b0;
      // Полотнище: сетка NX × NY от древка по ветру, 2.4 × 1.4 м.
      const base = pos.length / 3;
      for (let j = 0; j <= NY; j++) {
        for (let i = 0; i <= NX; i++) {
          const u = i / NX;
          const v = j / NY;
          pos.push(x + wx * u * 2.4, y + ph - 0.1 - v * 1.4, z + wz * u * 2.4);
          nor.push(-wz, 0, wx);
          // Красное полотнище с золотой бахромой на конце: одно поле, без полос (полосы читались чужим флагом).
          const c = u > 0.84 ? gold : red;
          col.push(...c);
          flap.push(u);
        }
      }
      for (let j = 0; j < NY; j++) {
        for (let i = 0; i < NX; i++) {
          const a = base + j * (NX + 1) + i;
          const b = a + 1;
          const c = a + NX + 1;
          const d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.setAttribute('flap', new THREE.BufferAttribute(new Float32Array(flap), 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const time = this.time;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.cTime = time;
      shader.vertexShader = 'attribute float flap;\nuniform float cTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        // Полотнище волной от древка: чем дальше от древка, тем сильнее; фаза — от места флага.
        float ph = position.x * 0.37 + position.z * 0.23;
        float w = sin(cTime * 4.2 - flap * 5.0 + ph) * 0.32 + sin(cTime * 7.1 - flap * 9.0 + ph * 1.7) * 0.08;
        transformed.x += ${(-wz).toFixed(3)} * w * flap;
        transformed.z += ${wx.toFixed(3)} * w * flap;
        transformed.y -= flap * flap * 0.25;`,
      );
    };
    m.customProgramCacheKey = () => 'city-flag';
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'city-flags';
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * Птицы: стаи кругами над городом — галки над крышами, грачи над полями. Движение целиком в шейдере
   * (середина круга, радиус, скорость, фаза — атрибуты вершин): кадру считать нечего.
   */
  private buildBirds(plan: CityPlan): THREE.Mesh {
    const n = this.cap.birds;
    const pos: number[] = [];
    const center: number[] = [];
    const orbit: number[] = [];
    const wing: number[] = [];
    const flocks: [number, number, number][] = [
      [-8, 34, -38],
      [40, 30, 60],
      [-30, 40, -140],
      [180, 24, 80],
    ];
    void plan;
    for (let k = 0; k < n; k++) {
      const f = flocks[k % flocks.length];
      const r = 18 + rnd(k, 1, 89) * 26;
      const speed = (0.18 + rnd(k, 2, 89) * 0.12) * (k % 3 === 0 ? -1 : 1);
      const phase = rnd(k, 3, 89) * Math.PI * 2;
      const h = f[1] + (rnd(k, 4, 89) - 0.5) * 10;
      // Птица — два треугольника: крыло влево и вправо от тела вдоль хода.
      const tri: [number, number, number][] = [
        [0, 0, 0.35],
        [0, 0, -0.2],
        [-0.55, 0, 0],
        [0, 0, 0.35],
        [0.55, 0, 0],
        [0, 0, -0.2],
      ];
      for (const [x, y, z] of tri) {
        pos.push(x, y, z);
        center.push(f[0], h, f[2]);
        orbit.push(r, speed, phase);
        wing.push(Math.abs(x) > 0 ? Math.sign(x) : 0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('center', new THREE.BufferAttribute(new Float32Array(center), 3));
    g.setAttribute('orbit', new THREE.BufferAttribute(new Float32Array(orbit), 3));
    g.setAttribute('wing', new THREE.BufferAttribute(new Float32Array(wing), 1));
    const m = new THREE.MeshBasicMaterial({ color: 0x2a2624, side: THREE.DoubleSide });
    const time = this.time;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.cTime = time;
      shader.vertexShader = 'attribute vec3 center;\nattribute vec3 orbit;\nattribute float wing;\nuniform float cTime;\n' + shader.vertexShader.replace(
        '#include <begin_vertex>',
        /* glsl */ `
        float ang = orbit.z + cTime * orbit.y;
        // Круг чуть вытянут и с покачиванием по высоте; крылья машут, иногда — парение.
        vec3 c = center + vec3(cos(ang) * orbit.x, sin(ang * 2.0 + orbit.z) * 2.0, sin(ang) * orbit.x * 0.8);
        float glide = step(0.6, fract(cTime * 0.13 + orbit.z));
        float beat = sin(cTime * 9.0 + orbit.z * 5.0) * (1.0 - glide) * 0.6 + 0.12;
        vec3 p = position * 1.6;
        p.y += abs(wing) * beat;
        // Тело — по касательной к кругу.
        vec2 t = normalize(vec2(-sin(ang), cos(ang) * 0.8)) * sign(orbit.y);
        vec3 transformed = c + vec3(p.z * t.x + p.x * t.y, p.y, p.z * t.y - p.x * t.x);`,
      );
    };
    m.customProgramCacheKey = () => 'city-birds';
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'city-birds';
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * Сколько людей на улицах и стражи на стене (от партии) и какие дворы работают (дым работы). Зовётся
   * из `sync` — когда меняется партия, а не каждый кадр.
   */
  set(people: number, guards: number, working: SmokeSource[]): void {
    this.want.people = Math.min(this.cap.people, Math.max(0, Math.round(people)));
    this.want.guards = Math.min(this.cap.guards, Math.max(0, Math.round(guards)));
    const same = working.length === this.work.length && working.every((w, k) => w.x === this.work[k].x && w.z === this.work[k].z);
    if (same) return;
    this.work = working;
    this.smoke.setSources([...this.smokeOn, ...working]);
  }

  update(dt: number, t: number, night: number, snow: number): void {
    this.time.value = t;
    // Ночью улицы пустеют до трети, зимой — на четверть; стража стоит всегда.
    const shown = Math.round(this.want.people * (1 - 0.68 * night) * (1 - 0.25 * snow));
    this.people.count = Math.min(shown, this.walkers.length);
    let k = 0;
    for (const w of this.walkers) {
      if (k >= this.people.count) break;
      let x: number;
      let y: number;
      let z: number;
      let yaw: number;
      if (w.idle) {
        x = w.idle.x;
        z = w.idle.z;
        y = w.idle.y + Math.abs(Math.sin(t * 1.3 + k)) * 0.03;
        yaw = w.idle.yaw + Math.sin(t * 0.3 + k) * 0.4;
      } else {
        const path = this.paths[w.path];
        w.s += w.v * dt;
        if (w.s < 0 || w.s > path.len) {
          w.v = -w.v;
          w.s = Math.min(Math.max(w.s, 0), path.len);
        }
        const a = at(path, w.s);
        const off = w.side * Math.max(0.6, path.half - 0.8) * 0.6;
        x = a.p.x - a.tz * off;
        z = a.p.z + a.tx * off;
        // Шаг: лёгкое подпрыгивание.
        y = heightOnPath(path, w.s) + Math.abs(Math.sin(w.s * 3.2)) * 0.05;
        yaw = Math.atan2(-a.tz * Math.sign(w.v), a.tx * Math.sign(w.v));
      }
      this.place(this.people, k++, x, y, z, yaw, 1);
    }
    this.people.instanceMatrix.needsUpdate = true;
    // Стража: у каждого свой отрезок хода в два пролёта, туда и обратно.
    this.sentries.count = Math.min(this.want.guards, this.guards.length);
    const L = this.wall.len;
    for (let i = 0; i < this.sentries.count; i++) {
      const g = this.guards[i];
      const home = ((i + 0.5) / this.guards.length) * L;
      g.s += g.v * dt;
      if (Math.abs(g.s - home) > 22) g.v = -Math.sign(g.s - home) * Math.abs(g.v);
      const s = ((g.s % L) + L) % L;
      const a = at(this.wall, s);
      const yaw = Math.atan2(-a.tz * Math.sign(g.v), a.tx * Math.sign(g.v));
      this.place(this.sentries, i, a.p.x, heightOnPath(this.wall, s), a.p.z, yaw, 1);
    }
    this.sentries.instanceMatrix.needsUpdate = true;
    // Скот бродит медленно: круг в пару метров у своего места.
    this.beasts.count = this.beastAt.length;
    this.beastAt.forEach((b, i) => {
      const a = t * 0.05 + (b.seed % 100) * 0.06;
      const x = b.x + Math.cos(a) * 1.5;
      const z = b.z + Math.sin(a) * 1.5;
      this.place(this.beasts, i, x, b.y, z, -a - Math.PI / 2 + Math.sin(t * 0.5 + i) * 0.3, b.r);
    });
    this.beasts.instanceMatrix.needsUpdate = true;
    this.smoke.update(dt, snow);
  }

  private place(im: THREE.InstancedMesh, k: number, x: number, y: number, z: number, yaw: number, scale: number): void {
    this.q4.setFromAxisAngle(this.up, yaw);
    this.m4.compose(this.v3.set(x, y, z), this.q4, this.s3.set(scale, scale, scale));
    im.setMatrixAt(k, this.m4);
  }

  dispose(): void {
    const sm = this.smoke.points.material as THREE.PointsMaterial;
    sm.map?.dispose();
    sm.dispose();
    (this.people.material as THREE.Material).dispose();
    (this.flags.material as THREE.Material).dispose();
    (this.birds.material as THREE.Material).dispose();
  }
}
