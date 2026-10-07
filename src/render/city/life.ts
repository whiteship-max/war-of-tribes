// Жизнь вида «город» (docs/city.md, раздел 11.4): прохожие по улицам и площади, стража на стене, дым из
// труб, флаги на башнях, птицы над крышами, овцы в загоне и коровы у хутора. Всё — экземплярами или одним
// мешем на вид: вызовов отрисовки столько, сколько видов, а не фигур; на низком уровне фигур меньше.
//
// Сколько людей на улицах и стражи на стене — от партии (`set`): население и войско. Ночью улицы
// пустеют, стража остаётся.
//
// **Всё — функция от времени** (docs/city.md, 13): положение прохожего, стража, клуба дыма — f(t), без накопления шагов.
// Вошёл в город, вернулся из фона, переждал медленный кадр — каждый уже там, где ему быть, рывков нет. Шаг ног, колёса
// и вёсла — в шейдере фигур (`gait`): кадр кладёт пройденный путь, вершинный шейдер качает ноги.
import * as THREE from 'three';
import type { Quality } from '../quality';
import { HEARTH_LOOK, type SmokeLook, type SmokeSource } from '../weather';
import type { V3 } from './geom';
import { distSeg, heightAt, insidePoly, type CityPlan, type P } from './layout';
import { wallTops } from './forts';
import { hash3, rnd } from './noise';
import { linear } from './palette';
import { LIFE_CAP } from './spec';
export { LIFE_CAP } from './spec';

// ---------------------------------------------------------------------------------------------
// Модели: фигура стоит в начале координат лицом на +x; масштаб — метры.

export interface Part {
  /** Середина низа, полуразмеры и сужение кверху. */
  x: number;
  /** Сдвиг вбок (по z): левая и правая нога. */
  z?: number;
  y0: number;
  y1: number;
  hw: number;
  hd: number;
  taper?: number;
  col: V3;
  /** 1 — красится цветом экземпляра (одежда), 0 — свой цвет (лицо, ноги, древко). */
  tint: number;
  /**
   * Качание в шейдере (`figureMaterial`): ось — поперёк хода (z) через точку (px, py). `stride` > 0 — нога: полный
   * мах за `stride` метров пути, `phase` — левая или правая; `stride` < 0 — колесо радиусом −stride: катится по пути;
   * `phase` больше 50 — весло: поворот по вертикали вокруг уключины (px, pz = py).
   */
  limb?: [px: number, py: number, stride: number, phase: number];
}

/** Коробки фигуры в один буфер: положение, нормаль, цвет, маска окраски, качание. */
export function figure(parts: Part[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const msk: number[] = [];
  const limb: number[] = [];
  const idx: number[] = [];
  for (const p of parts) {
    const t = p.taper ?? 1;
    const lo = [p.hw, p.hd];
    const hi = [p.hw * t, p.hd * t];
    const pz = p.z ?? 0;
    const c = (sx: number, sy: number, sz: number): V3 => {
      const h = sy > 0 ? hi : lo;
      return [p.x + sx * h[1], sy > 0 ? p.y1 : p.y0, pz + sz * h[0]];
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
        limb.push(...(p.limb ?? [0, 0, 0, 0]));
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('tintMask', new THREE.BufferAttribute(new Float32Array(msk), 1));
  g.setAttribute('limb', new THREE.BufferAttribute(new Float32Array(limb), 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/**
 * Шаг экземпляра для шейдера: (пройденный путь, метры; размах 0..1). Каждому экземплярному мешу фигур — свой буфер; кадр
 * пишет его вместе с матрицами.
 */
export function gaitOf(im: THREE.InstancedMesh): THREE.InstancedBufferAttribute {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(im.instanceMatrix.count * 2), 2);
  a.setUsage(THREE.DynamicDrawUsage);
  im.geometry.setAttribute('gait', a);
  return a;
}

export const SKIN: V3 = linear(0xc79a7a);
export const LEGS: V3 = linear(0x4a3b2e);
export const WHITE: V3 = [1, 1, 1];
export const STEEL: V3 = linear(0x8a8e92);
export const SHAFT: V3 = linear(0x5a4632);

/** Две ноги от бедра на высоте `hip`: мах за `stride` метров, левая и правая — в противофазе. */
export const legs = (hip: number, hw: number, hd: number, stride: number, x = 0): Part[] =>
  [-1, 1].map((side) => ({ x, z: side * hw * 0.55, y0: 0, y1: hip, hw: hw * 0.45, hd, col: LEGS, tint: 0, limb: [x, hip, stride, side > 0 ? 0 : Math.PI] as Part['limb'] }));

/** Горожанин: две ноги (шаг в шейдере), рубаха до колен (цвет экземпляра), голова. */
export const personGeometry = (): THREE.BufferGeometry =>
  figure([
    ...legs(0.78, 0.17, 0.11, 1.4),
    { x: 0, y0: 0.62, y1: 1.42, hw: 0.27, hd: 0.16, taper: 0.78, col: WHITE, tint: 1 },
    { x: 0, y0: 1.42, y1: 1.7, hw: 0.11, hd: 0.11, col: SKIN, tint: 0 },
  ]);

/** Стражник: то же и шлем, древко копья выше головы. */
export const guardGeometry = (): THREE.BufferGeometry =>
  figure([
    ...legs(0.8, 0.17, 0.12, 1.5),
    { x: 0, y0: 0.65, y1: 1.45, hw: 0.29, hd: 0.18, taper: 0.8, col: WHITE, tint: 1 },
    { x: 0, y0: 1.45, y1: 1.7, hw: 0.11, hd: 0.11, col: SKIN, tint: 0 },
    { x: 0, y0: 1.66, y1: 1.84, hw: 0.13, hd: 0.13, taper: 0.6, col: STEEL, tint: 0 },
    { x: 0.05, y0: 0.2, y1: 2.6, hw: 0.03, hd: 0.03, col: SHAFT, tint: 0 },
    { x: 0.05, y0: 2.6, y1: 2.85, hw: 0.04, hd: 0.04, taper: 0.2, col: STEEL, tint: 0 },
  ]);

/** Овца (корова — та же, крупнее и в своём цвете): туловище, голова, ноги парами — передние и задние. */
export const beastGeometry = (): THREE.BufferGeometry =>
  figure([
    { x: 0.3, y0: 0, y1: 0.35, hw: 0.2, hd: 0.07, col: LEGS, tint: 0, limb: [0.3, 0.35, 0.9, 0] },
    { x: -0.3, y0: 0, y1: 0.35, hw: 0.2, hd: 0.07, col: LEGS, tint: 0, limb: [-0.3, 0.35, 0.9, Math.PI] },
    { x: 0, y0: 0.3, y1: 0.85, hw: 0.28, hd: 0.55, taper: 0.9, col: WHITE, tint: 1 },
    { x: 0.62, y0: 0.55, y1: 0.95, hw: 0.13, hd: 0.15, col: LEGS, tint: 0 },
  ]);

/**
 * Ламберт с краской экземпляра только по маске: одежда своя у каждого, лицо — у всех лицо. Ноги, колёса и вёсла
 * качаются в шейдере по пройденному пути экземпляра (`gait`): идёт — шагает, стоит — ноги вместе, колесо катится ровно
 * на свой путь.
 */
export function figureMaterial(): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float tintMask;\nattribute vec4 limb;\nattribute vec2 gait;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      if (limb.z != 0.0) {
        float ang = limb.z > 0.0 ? sin(gait.x * 6.2832 / limb.z + limb.w) * 0.5 * gait.y : gait.x / limb.z;
        float ca = cos(ang);
        float sa = sin(ang);
        if (limb.w > 50.0) {
          // Весло: поворот по вертикали вокруг уключины (x, z) = limb.xy.
          vec2 d = transformed.xz - limb.xy;
          transformed.xz = limb.xy + vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
        } else {
          vec2 d = transformed.xy - limb.xy;
          transformed.xy = limb.xy + vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca);
        }
      }`,
    ).replace(
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

export interface Path {
  pts: P[];
  acc: number[];
  len: number;
  /** Высота пути через метр (по земле или по боевому ходу стены). */
  h: Float32Array;
  /** Полуширина: прохожие держатся сторон улицы. */
  half: number;
}

export function pathOf(pts: P[], half: number, height: (p: P, k: number, f: number) => number): Path {
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
export function at(path: Path, s: number): typeof AT {
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

export const heightOnPath = (path: Path, s: number): number => {
  const i = Math.min(path.h.length - 2, Math.max(0, Math.floor(s)));
  const f = Math.min(1, Math.max(0, s - i));
  return path.h[i] + (path.h[i + 1] - path.h[i]) * f;
};

/** Ближайшая точка ломаной пути: расстояние и место на пути (метры от начала). */
function nearestOn(path: Path, p: P): { d: number; s: number } {
  let d = Infinity;
  let s = 0;
  for (let k = 1; k < path.pts.length; k++) {
    const r = distSeg(p, path.pts[k - 1], path.pts[k]);
    if (r.d < d) {
      d = r.d;
      s = path.acc[k - 1] + r.t * (path.acc[k] - path.acc[k - 1]);
    }
  }
  return { d, s };
}

/** Перекрёсток на пути: на месте `s` можно свернуть на путь `q` в его место `sq`. */
interface Junction {
  s: number;
  q: number;
  sq: number;
}

/** Пересечение отрезков ab и cd: доли вдоль каждого или null. */
function cross(a: P, b: P, c: P, d: P): [number, number] | null {
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const sx = d.x - c.x;
  const sz = d.z - c.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const u = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
  const v = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [u, v] : null;
}

/**
 * Перекрёстки графа улиц — узлы обоих путей: конец пути, лежащий на другом пути (ближе `tol`), — переулки у улиц,
 * улицы у площади, Главная у ворот и дороги; и пересечение серединами — улица вдоль стены поперёк переулков и улиц,
 * идущих к воротам. Отрезки — по клеткам 16 м: каждый сверяется только с соседями.
 */
export function junctionsOf(paths: readonly Path[], tol = 4): Junction[][] {
  const out: Junction[][] = paths.map(() => []);
  const CELL = 16;
  const grid = new Map<string, [number, number][]>();
  paths.forEach((pa, ia) => {
    for (let k = 1; k < pa.pts.length; k++) {
      const a = pa.pts[k - 1];
      const b = pa.pts[k];
      for (let cx = Math.floor(Math.min(a.x, b.x) / CELL); cx <= Math.floor(Math.max(a.x, b.x) / CELL); cx++) {
        for (let cz = Math.floor(Math.min(a.z, b.z) / CELL); cz <= Math.floor(Math.max(a.z, b.z) / CELL); cz++) {
          const key = `${cx},${cz}`;
          const list = grid.get(key);
          for (const [ib, kb] of list ?? []) {
            if (ib === ia) continue;
            const pb = paths[ib];
            const r = cross(a, b, pb.pts[kb - 1], pb.pts[kb]);
            if (!r) continue;
            const sa = pa.acc[k - 1] + r[0] * (pa.acc[k] - pa.acc[k - 1]);
            const sb = pb.acc[kb - 1] + r[1] * (pb.acc[kb] - pb.acc[kb - 1]);
            if (out[ia].some((j) => j.q === ib && Math.abs(j.s - sa) < 1)) continue;
            out[ia].push({ s: sa, q: ib, sq: sb });
            out[ib].push({ s: sb, q: ia, sq: sa });
          }
          if (list) list.push([ia, k]);
          else grid.set(key, [[ia, k]]);
        }
      }
    }
  });
  paths.forEach((a, ia) => {
    for (const end of [0, a.len]) {
      const pe = at(a, end).p;
      const p = { x: pe.x, z: pe.z };
      paths.forEach((b, ib) => {
        if (ib === ia) return;
        const n = nearestOn(b, p);
        if (n.d > tol) return;
        out[ia].push({ s: end, q: ib, sq: n.s });
        out[ib].push({ s: n.s, q: ia, sq: end });
      });
    }
  });
  for (const j of out) j.sort((x, y) => x.s - y.s);
  return out;
}

/**
 * Колено маршрута: кусок пути (`path` ≥ 0, от `s0` к `s1`) или прямая перемычка между путями на перекрёстке
 * (`path` −1, от a к b): перемычка снимает скачок — точка на одном пути и на другом не совпадают.
 */
interface Leg {
  path: number;
  s0: number;
  s1: number;
  /** Сдвиг от середины пути вбок от хода маршрута, метры. */
  off: number;
  a: V3;
  b: V3;
  len: number;
}

/** Маршрут прохожего — цепь колен по графу улиц; идёт по нему туда и обратно. */
export interface Route {
  legs: Leg[];
  acc: number[];
  len: number;
  /** Скорость, м/с, и где он был в нулевой миг (метры пройденного пути). */
  v: number;
  phase: number;
}

/** Длина маршрута прохожего: от сотни метров до полукилометра — квартал, рынок, ворота. */
const ROUTE_MIN = 140;
export const ROUTE_MAX = 520;

/**
 * Маршрут от зерна: начало — на пути по весу (длина × `weight`), дальше по графу; на перекрёстке сворачивает с долей
 * 0.55, в тупике (конец пути без перекрёстка — ворота, двор) маршрут кончается: там прохожий и повернёт обратно.
 */
export function routeOf(paths: readonly Path[], junctions: readonly Junction[][], weight: readonly number[], k: number, salt: number): Route {
  const r = (j: number): number => rnd(k, j, salt);
  const sum = weight.reduce((a, b) => a + b, 0);
  let pick = r(1) * sum;
  let p = 0;
  while (p < weight.length - 1 && pick > weight[p]) pick -= weight[p++];
  let s = r(2) * paths[p].len;
  let dir = r(3) < 0.5 ? 1 : -1;
  const side = (r(4) - 0.5) * 1.5;
  const target = ROUTE_MIN + r(5) * (ROUTE_MAX - ROUTE_MIN);
  const raw: { path: number; s0: number; s1: number }[] = [];
  let total = 0;
  for (let step = 0; step < 40 && total < target; step++) {
    const path = paths[p];
    const next = junctions[p].filter((j) => (j.s - s) * dir > 0.5).sort((a, b) => (a.s - b.s) * dir)[0];
    let end = next ? next.s : dir > 0 ? path.len : 0;
    // Не длиннее своей меры: последнее колено обрезается — там прохожий и повернёт (улица вдоль стены — 690 м).
    const cut = Math.abs(end - s) > target - total;
    if (cut) end = s + dir * (target - total);
    if (Math.abs(end - s) > 0.01) raw.push({ path: p, s0: s, s1: end });
    total += Math.abs(end - s);
    if (!next || cut) break;
    s = end;
    if (r(10 + step) < 0.55) {
      const q = paths[next.q];
      p = next.q;
      s = next.sq;
      // С конца пути — внутрь; с середины — куда выпадет.
      dir = s < 1 ? 1 : s > q.len - 1 ? -1 : r(60 + step) < 0.5 ? 1 : -1;
    }
  }
  const legs: Leg[] = [];
  const point = (l: { path: number; s0: number; s1: number }, s1: boolean, off: number): V3 => {
    const path = paths[l.path];
    const s = s1 ? l.s1 : l.s0;
    const { tx, tz } = tangentAt(path, s);
    const a = at(path, s);
    const sg = Math.sign(l.s1 - l.s0) || 1;
    return [a.p.x - tz * sg * off, heightOnPath(path, s), a.p.z + tx * sg * off];
  };
  for (const l of raw) {
    const half = paths[l.path].half;
    const off = side * Math.max(0.6, half - 0.8) * 0.6;
    const a = point(l, false, off);
    const prev = legs[legs.length - 1];
    if (prev) {
      // Перемычка — от конца прежнего колена к началу этого.
      const pb = prev.b;
      const len = Math.hypot(a[0] - pb[0], a[2] - pb[2]);
      if (len > 0.05) legs.push({ path: -1, s0: 0, s1: len, off: 0, a: pb, b: a, len });
    }
    legs.push({ ...l, off, a, b: point(l, true, off), len: Math.abs(l.s1 - l.s0) });
  }
  const acc = [0];
  for (const l of legs) acc.push(acc[acc.length - 1] + l.len);
  return { legs, acc, len: acc[acc.length - 1], v: 0.9 + r(6) * 0.6, phase: r(7) * 2 * Math.max(1, acc[acc.length - 1]) };
}

/** Где прохожий в миг `t`: туда по маршруту, обратно тем же путём, без остановок. */
export const POSE = { x: 0, y: 0, z: 0, yaw: 0, dist: 0 };
export function poseAt(paths: readonly Path[], r: Route, t: number): typeof POSE {
  const u = r.phase + r.v * t;
  POSE.dist = u;
  const period = 2 * r.len;
  const m = ((u % period) + period) % period;
  const fwd = m < r.len;
  const d = fwd ? m : period - m;
  let lo = 0;
  let hi = r.legs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (r.acc[mid] <= d) lo = mid;
    else hi = mid - 1;
  }
  const leg = r.legs[lo];
  const local = Math.min(leg.len, Math.max(0, d - r.acc[lo]));
  const go = fwd ? 1 : -1;
  if (leg.path < 0) {
    const f = local / (leg.len || 1);
    POSE.x = leg.a[0] + (leg.b[0] - leg.a[0]) * f;
    POSE.y = leg.a[1] + (leg.b[1] - leg.a[1]) * f;
    POSE.z = leg.a[2] + (leg.b[2] - leg.a[2]) * f;
    POSE.yaw = Math.atan2(-(leg.b[2] - leg.a[2]) * go, (leg.b[0] - leg.a[0]) * go);
    return POSE;
  }
  const path = paths[leg.path];
  const sg = Math.sign(leg.s1 - leg.s0) || 1;
  const s = leg.s0 + sg * local;
  const { tx, tz } = tangentAt(path, s);
  const a = at(path, s);
  POSE.x = a.p.x - tz * sg * leg.off;
  POSE.z = a.p.z + tx * sg * leg.off;
  POSE.y = heightOnPath(path, s);
  POSE.yaw = Math.atan2(-tz * sg * go, tx * sg * go);
  return POSE;
}

/**
 * Касательная пути — по точкам за два метра до и после: на изломе ломаной она поворачивает плавно, и сдвиг вбок не прыгает
 * (касательная отрезка повернула бы его разом).
 */
const TAN = { tx: 1, tz: 0 };
export function tangentAt(path: Path, s: number): typeof TAN {
  const b = at(path, Math.max(0, s - 2)).p;
  const bx = b.x;
  const bz = b.z;
  const f = at(path, Math.min(path.len, s + 2)).p;
  const l = Math.hypot(f.x - bx, f.z - bz) || 1;
  TAN.tx = (f.x - bx) / l;
  TAN.tz = (f.z - bz) / l;
  return TAN;
}

/**
 * Пути через площадь и меж рядов рынка (docs/city.md, 13.1): улицы кончаются у краёв площади, и без этих путей прохожие
 * поворачивали бы назад у её кромки. Обходят ряды, колодец с чашей, бочки и статую; к паперти — сквозь проход ограды.
 */
export const SQUARE_PATHS: readonly { name: string; pts: P[]; half: number; weight: number }[] = [
  { name: 'от Главной к Верхней', pts: [{ x: 1, z: 30 }, { x: 14, z: 25.8 }, { x: 26, z: 23.5 }, { x: 28.5, z: 12 }, { x: 27, z: -4 }, { x: 25, z: -24 }], half: 2.5, weight: 2 },
  { name: 'от Восточной к Западной', pts: [{ x: 31, z: 0 }, { x: 12, z: -1 }, { x: -10, z: -2 }, { x: -23, z: -10 }, { x: -27, z: -24 }], half: 2.5, weight: 2 },
  { name: 'к паперти', pts: [{ x: -2, z: -1.8 }, { x: -6, z: -14 }, { x: -9, z: -24 }, { x: -9, z: -31 }], half: 2, weight: 2.5 },
  { name: 'меж рядов, южный проход', pts: [{ x: -15, z: 8.25 }, { x: 28.3, z: 8.25 }], half: 1.2, weight: 4 },
  { name: 'меж рядов, северный проход', pts: [{ x: -15, z: 14.75 }, { x: 28.2, z: 14.75 }], half: 1.2, weight: 3 },
];

// ---------------------------------------------------------------------------------------------

/**
 * Ветер — один на посёлок и город: направление сноса дыма очагов посёлка (`weather.HEARTH_LOOK`), с
 * запада-юго-запада на восток-северо-восток. По нему вьются флаги и идёт дым труб города. Выводится здесь,
 * в куске города, а не в `weather.ts`: первая загрузка не прибавляет ни байта.
 */
export const CITY_WIND: { readonly x: number; readonly z: number } = (() => {
  const d = HEARTH_LOOK.drift ?? { x: 1, z: 0 };
  const l = Math.hypot(d.x, d.z) || 1;
  return { x: d.x / l, z: d.z / l };
})();

/** Дым труб города — в метрах: клуб 3.4 м, снос по ветру (`CITY_WIND`) на полметра за метр подъёма. */
export const CITY_SMOKE: SmokeLook = { size: 3.4, opacity: 0.17, drift: { x: CITY_WIND.x * 0.49, z: CITY_WIND.z * 0.49 } };

/** Мягкое пятно для клубов дыма: круглый край вместо квадрата точки. */
export function softDot(): THREE.CanvasTexture | null {
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

/** Огоньки без своего света: точки с мягким пятном, складываются с картинкой; видны в сумерках и ночью. */
export function glowPoints(n: number, size: number, color: number, name: string): THREE.Points {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const p = new THREE.Points(
    g,
    new THREE.PointsMaterial({ size, map: softDot(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }),
  );
  p.name = name;
  p.frustumCulled = false;
  p.visible = false;
  return p;
}

const DRESS = [0x7a4a3a, 0x5a6a7a, 0x8a7a5a, 0x6a5a4a, 0x9a8a6a, 0x4a5a3a, 0x8a5a5a, 0x5a4a6a, 0xa09070, 0x6a6a5a].map(linear);
const TABARD = [0x8a2f2a, 0x7a3a2c, 0x6a2a28].map(linear);

/** Стоит, а не идёт: у рядов, у колодца, у паперти, у ратуши — кружком по двое-четверо, лицом друг к другу. */
interface Idle {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Ночью на улицах редкие прохожие: доля дневных (docs/city.md, 13.1). */
export const NIGHT_SHARE = 0.18;
/** Зимой на улицах на четверть меньше. */
export const WINTER_SHARE = 0.75;

/**
 * Дозор стража в миг `t`: свой отрезок хода ±`reach` метров от места, туда и обратно; на концах стоит `pause` секунд —
 * смотрит со стены. Положение — функция времени: пришёл из фона — страж там, где ему быть.
 */
export function patrolAt(t: number, v: number, reach: number, pause: number, phase: number): { s: number; dir: number; moving: number; dist: number } {
  const run = (2 * reach) / v;
  const cycle = 2 * run + 2 * pause;
  const m = (((t + phase * cycle) % cycle) + cycle) % cycle;
  if (m < run) return { s: -reach + v * m, dir: 1, moving: 1, dist: v * m };
  if (m < run + pause) return { s: reach, dir: 1, moving: 0, dist: 2 * reach };
  if (m < 2 * run + pause) return { s: reach - v * (m - run - pause), dir: -1, moving: 1, dist: 2 * reach + v * (m - run - pause) };
  return { s: -reach, dir: -1, moving: 0, dist: 4 * reach };
}

/**
 * Дым труб: каждый клуб — функция времени в вершинном шейдере (возраст — дробная часть времени со своим сдвигом):
 * поднимается, сносится ветром, растёт и тает. Топят не все: у трубы порог, дым идёт, пока доля топящих (`share`) выше
 * порога, — зимой топят больше, ночью меньше; порог переходит плавно, без вспышки. Дым работы (кузница) — гуще и темнее.
 */
export class CitySmoke {
  readonly points: THREE.Points;
  private material: THREE.PointsMaterial;
  readonly u = { cTime: { value: 0 }, cShare: { value: 0.5 }, cSnow: { value: 0 }, cNight: { value: 0 } };

  constructor(private look: SmokeLook) {
    this.material = new THREE.PointsMaterial({ color: 0xdcd8d0, size: look.size, transparent: true, opacity: 1, depthWrite: false });
    const dot = softDot();
    if (dot) {
      this.material.map = dot;
      this.material.alphaTest = 0.01;
    }
    const u = this.u;
    const drift = look.drift ?? { x: 0, z: 0 };
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader =
        'attribute vec4 puff;\nuniform float cTime;\nuniform float cShare;\nuniform float cSnow;\nuniform float cNight;\nvarying float vAlpha;\nvarying vec3 vTint;\n' +
        shader.vertexShader
          .replace(
            '#include <begin_vertex>',
            /* glsl */ `
            // puff: x — сдвиг возраста (место клуба в струе и труба), y — высота подъёма, z — порог трубы, w — 1 у дыма работы.
            float age = fract(cTime * (0.075 + 0.02 * cSnow) * (0.85 + 0.3 * fract(puff.x * 7.31)) + puff.x);
            float rise = age * puff.y;
            float sw = puff.x * 41.0;
            vec3 transformed = position;
            transformed.x += ${drift.x.toFixed(4)} * rise + sin(sw + age * 3.1) * (0.25 + age * 1.4);
            transformed.z += ${drift.z.toFixed(4)} * rise + cos(sw * 1.3 + age * 2.7) * (0.25 + age * 1.4);
            transformed.y += rise;
            float on = puff.w > 0.5 ? 1.0 : clamp((cShare - puff.z) * 12.0, 0.0, 1.0);
            vAlpha = on * smoothstep(0.0, 0.08, age) * pow(1.0 - age, 1.2) * (puff.w > 0.5 ? 0.85 : 0.6 + 0.25 * cSnow);
            float lit = 1.0 - 0.72 * cNight;
            // У дыма работы ночью снизу — отсвет горна.
            vTint = puff.w > 0.5 ? mix(vec3(0.42) * lit + vec3(0.55, 0.22, 0.05) * cNight * (1.0 - smoothstep(0.0, 0.25, age)), vec3(0.6) * lit, age) : vec3(lit);
            float grow = (0.5 + age * 2.1) * (puff.w > 0.5 ? 1.4 : 1.0 + 0.2 * cSnow);`,
          )
          .replace('gl_PointSize = size;', 'gl_PointSize = size * grow;');
      shader.fragmentShader = 'varying float vAlpha;\nvarying vec3 vTint;\n' + shader.fragmentShader.replace(
        '#include <color_fragment>',
        '#include <color_fragment>\n  diffuseColor.rgb *= vTint;\n  diffuseColor.a *= vAlpha;',
      );
    };
    this.material.customProgramCacheKey = () => 'city-smoke';
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.name = 'city-smoke';
  }

  /** Трубы домов (с порогом) и трубы работы — пересборка буфера; зовётся, когда меняется партия, а не каждый кадр. */
  setSources(houses: (SmokeSource & { thr: number })[], work: SmokeSource[]): void {
    const pos: number[] = [];
    const puff: number[] = [];
    const add = (s: SmokeSource, thr: number, w: number, j: number): void => {
      for (let i = 0; i < s.puffs; i++) {
        pos.push(s.x, s.y, s.z);
        puff.push(i / s.puffs + rnd(j, 7, 67) * 0.999, s.top, thr, w);
      }
    };
    houses.forEach((s, j) => add(s, s.thr, 0, j));
    work.forEach((s, j) => add(s, -1, 1, 1000 + j));
    this.points.geometry.dispose();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('puff', new THREE.BufferAttribute(new Float32Array(puff), 4));
    this.points.geometry = geo;
    this.points.visible = pos.length > 0;
  }

  /** Доля топящих: днём летом меньше половины, зимой — три четверти, ночью огонь прикрыт. */
  static share(night: number, snow: number): number {
    return Math.min(1, Math.max(0, 0.42 + 0.3 * snow - 0.14 * night));
  }

  update(t: number, night: number, snow: number): void {
    this.u.cTime.value = t;
    this.u.cSnow.value = snow;
    this.u.cNight.value = night;
    this.u.cShare.value = CitySmoke.share(night, snow);
    this.material.size = this.look.size;
  }

  dispose(): void {
    this.material.map?.dispose();
    this.material.dispose();
    this.points.geometry.dispose();
  }
}

export class CityLife {
  readonly group = new THREE.Group();
  private paths: Path[] = [];
  private wall: Path;
  /** Маршруты идущих и места стоящих; порядок экземпляров перемешан — ночью пустеет равномерно. */
  private routes: (Route | null)[] = [];
  private idle: (Idle | null)[] = [];
  private people: THREE.InstancedMesh;
  private sentries: THREE.InstancedMesh;
  private beasts: THREE.InstancedMesh;
  private peopleGait: THREE.InstancedBufferAttribute;
  private guardGait: THREE.InstancedBufferAttribute;
  private beastGait: THREE.InstancedBufferAttribute;
  /** Факелы стражи: огонёк над плечом каждого — ночью идут по стене вместе с ним. */
  private torches: THREE.Points;
  /** Фонари редких ночных прохожих — в руке, идут с ним. */
  private lanterns: THREE.Points | null = null;
  private beastAt: { x: number; z: number; y: number; yaw: number; r: number; seed: number }[] = [];
  private smoke: CitySmoke;
  private smokeOn: (SmokeSource & { thr: number })[] = [];
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
    // Граф улиц: улицы, переулки, дороги у ворот и пути через площадь и меж рядов.
    const weight: number[] = [];
    // Богатая улица людная: Главная и Верхняя — вдвое против переулков, улица вдоль стены — пустынна.
    for (const st of plan.streets) {
      this.paths.push(pathOf(st.pts, st.half, ground));
      weight.push(this.paths[this.paths.length - 1].len * (0.25 + st.rich * 1.5));
    }
    for (const r of plan.roads.slice(0, 2)) {
      this.paths.push(pathOf(r.pts.slice(0, Math.min(r.pts.length, 18)), r.half, ground));
      weight.push(this.paths[this.paths.length - 1].len * 0.5);
    }
    for (const sq of SQUARE_PATHS) {
      this.paths.push(pathOf(sq.pts, sq.half, ground));
      weight.push(this.paths[this.paths.length - 1].len * sq.weight);
    }
    this.junctions = junctionsOf(this.paths);
    this.weight = weight;
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
    this.peopleGait = gaitOf(this.people);
    this.guardGait = gaitOf(this.sentries);
    this.beastGait = gaitOf(this.beasts);
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
    this.seedPeople();
    this.seedBeasts();

    this.smoke = new CitySmoke(CITY_SMOKE);
    // Факелы стражи — точки с мягким пятном, как огоньки стены (`index.flames`), видны в сумерках и ночью.
    this.torches = glowPoints(this.cap.guards, 2.4, 0xffa040, 'city-torches');
    this.group.add(this.torches);
    if (this.cap.lanterns > 0) {
      this.lanterns = glowPoints(this.cap.lanterns, 1.7, 0xffb860, 'city-lanterns');
      this.group.add(this.lanterns);
    }
    this.group.add(this.smoke.points);
    // Дым идёт не из каждой трубы: у трубы порог, топят те, чей порог ниже доли (`CitySmoke.share`). Труб с
    // порогом выше 0.8 нет вовсе: доля в мороз — 0.72, все не топят никогда.
    this.smokeOn = input.chimneys
      .map((c) => ({ c, thr: rnd(Math.round(c[0] * 3), Math.round(c[2] * 3), 61) }))
      .filter((o) => o.thr < 0.8)
      .slice(0, this.cap.smoke)
      .map(({ c, thr }) => ({ x: c[0], y: c[1], z: c[2], puffs: 5, top: 10, thr }));
    this.smoke.setSources(this.smokeOn, []);

    this.flags = this.buildFlags(input.flagTops);
    this.group.add(this.flags);
    this.birds = this.buildBirds(plan);
    this.group.add(this.birds);
  }

  private junctions: Junction[][] = [];
  private weight: number[] = [];

  /**
   * Прохожие: идущие — по маршрутам графа улиц, стоящие — кружками у рядов, колодца, паперти и ратуши. Раскладка от
   * зерна — одна на город; порядок перемешан, чтобы при малом населении и ночью стояли и шли в той же доле.
   */
  private seedPeople(): void {
    const total = this.cap.people;
    const spots = [
      { x: 4, z: 8.3, rx: 15, rz: 0.4, w: 4 },
      { x: 4, z: 14.8, rx: 15, rz: 0.4, w: 3 },
      { x: 2, z: -7, rx: 5, rz: 4.5, w: 3 },
      { x: -9, z: -29.5, rx: 8, rz: 1.6, w: 2 },
      { x: -23, z: -2, rx: 1.6, rz: 9, w: 2 },
      { x: -19, z: 9, rx: 2, rz: 2, w: 1 },
    ];
    const wsum = spots.reduce((a, b) => a + b.w, 0);
    let group: { x: number; z: number; left: number; k: number } | null = null;
    for (let k = 0; k < total; k++) {
      if (rnd(k, 6, 72) >= 0.32) {
        this.routes.push(routeOf(this.paths, this.junctions, this.weight, k, 71));
        this.idle.push(null);
        continue;
      }
      // Кружок: середина у места, двое-четверо вокруг неё лицом внутрь.
      if (!group || group.left <= 0) {
        let r = rnd(k, 7, 73) * wsum;
        let i = 0;
        while (i < spots.length - 1 && r > spots[i].w) r -= spots[i++].w;
        const c = spots[i];
        group = { x: c.x + (rnd(k, 8, 73) - 0.5) * 2 * c.rx, z: c.z + (rnd(k, 9, 73) - 0.5) * 2 * c.rz, left: 2 + Math.floor(rnd(k, 10, 73) * 3), k: 0 };
      }
      const a = rnd(k, 11, 73) * 0.6 + (group.k * Math.PI * 2) / 3.2;
      const rr = 0.55 + rnd(k, 12, 73) * 0.25;
      const x = group.x + Math.cos(a) * rr;
      const z = group.z + Math.sin(a) * rr;
      // Лицом к середине кружка: фигура смотрит по +x, поворот — вокруг вертикали.
      this.idle.push({ x, z, y: heightAt(x, z), yaw: Math.atan2(-(group.z - z), group.x - x) });
      this.routes.push(null);
      group.left--;
      group.k++;
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
    // Полотнища смотрят по ветру — тому же, что сносит дым (`CITY_WIND`).
    const wx = CITY_WIND.x;
    const wz = CITY_WIND.z;
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
    this.smoke.setSources(this.smokeOn, working);
  }

  /**
   * Кадр: всё — от времени `t` (секунды сцены), `dt` не копится нигде. `night` — доля ночи окон, `snow` — доля зимы.
   */
  update(dt: number, t: number, night: number, snow: number): void {
    void dt;
    this.time.value = t;
    // Ночью на улицах редкие прохожие, зимой — на четверть меньше; стража стоит всегда.
    const shown = Math.round(this.want.people * (1 - (1 - NIGHT_SHARE) * night) * (1 - (1 - WINTER_SHARE) * snow));
    this.people.count = Math.min(shown, this.routes.length);
    const pg = this.peopleGait.array as Float32Array;
    // Фонарь — у каждого второго идущего, пока темно.
    const lamps = this.lanterns;
    const lampOn = lamps !== null && night > 0.3;
    let lit = 0;
    const lp = lamps ? (lamps.geometry.attributes.position as THREE.BufferAttribute) : null;
    for (let k = 0; k < this.people.count; k++) {
      const r = this.routes[k];
      if (r) {
        const p = poseAt(this.paths, r, t);
        // Шаг: лёгкое подпрыгивание в такт ног.
        this.place(this.people, k, p.x, p.y + Math.abs(Math.sin(p.dist * 4.488)) * 0.04, p.z, p.yaw, 1);
        pg[k * 2] = p.dist;
        pg[k * 2 + 1] = 1;
        if (lampOn && lp && lit < lp.count && hash3(k, 13, 97) % 2 === 0) {
          const v = this.v3.set(0.12, 0.92, 0.3).applyMatrix4(this.m4);
          lp.setXYZ(lit++, v.x, v.y, v.z);
        }
      } else {
        const w = this.idle[k]!;
        this.place(this.people, k, w.x, w.y + Math.abs(Math.sin(t * 1.3 + k)) * 0.02, w.z, w.yaw + Math.sin(t * 0.3 + k) * 0.25, 1);
        pg[k * 2] = 0;
        pg[k * 2 + 1] = 0;
      }
    }
    this.people.instanceMatrix.needsUpdate = true;
    this.peopleGait.needsUpdate = true;
    if (lamps && lp) {
      const lm = lamps.material as THREE.PointsMaterial;
      lamps.visible = lit > 0;
      lm.opacity = Math.min(1, (night - 0.3) * 2.5);
      lm.size = 1.7 * (1 + Math.sin(t * 9) * 0.06);
      lamps.geometry.setDrawRange(0, lit);
      lp.needsUpdate = lit > 0;
    }
    // Стража: у каждого свой отрезок хода ±22 м, туда и обратно; на концах стоит, смотрит со стены.
    this.sentries.count = Math.min(this.want.guards, this.cap.guards);
    const L = this.wall.len;
    const gg = this.guardGait.array as Float32Array;
    for (let i = 0; i < this.sentries.count; i++) {
      const home = ((i + 0.5 + rnd(i, 1, 79) * 0.3) / this.cap.guards) * L;
      const g = patrolAt(t, 0.7, 22, 4 + rnd(i, 2, 79) * 5, rnd(i, 3, 79));
      const s = (((home + g.s) % L) + L) % L;
      const a = at(this.wall, s);
      const yaw = Math.atan2(-a.tz * g.dir, a.tx * g.dir);
      this.place(this.sentries, i, a.p.x, heightOnPath(this.wall, s), a.p.z, yaw, 1);
      gg[i * 2] = g.dist;
      gg[i * 2 + 1] = g.moving;
    }
    this.sentries.instanceMatrix.needsUpdate = true;
    this.guardGait.needsUpdate = true;
    // Факел — над правым плечом стража, мерцает; ночью виден, днём погашен.
    const tm = this.torches.material as THREE.PointsMaterial;
    tm.opacity = night;
    this.torches.visible = night > 0.02 && this.sentries.count > 0;
    if (this.torches.visible) {
      const tp = this.torches.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < this.sentries.count; i++) {
        this.sentries.getMatrixAt(i, this.m4);
        const v = this.v3.set(0.15, 2.05, 0.32).applyMatrix4(this.m4);
        tp.setXYZ(i, v.x, v.y, v.z);
      }
      tp.needsUpdate = true;
      this.torches.geometry.setDrawRange(0, this.sentries.count);
      tm.size = 2.4 * (1 + Math.sin(t * 13) * 0.1);
    }
    // Скот бродит медленно: круг в пару метров у своего места, ноги — по пройденной дуге.
    this.beasts.count = this.beastAt.length;
    const bg = this.beastGait.array as Float32Array;
    this.beastAt.forEach((b, i) => {
      const a = t * 0.05 + (b.seed % 100) * 0.06;
      const x = b.x + Math.cos(a) * 1.5;
      const z = b.z + Math.sin(a) * 1.5;
      this.place(this.beasts, i, x, b.y, z, -a - Math.PI / 2 + Math.sin(t * 0.5 + i) * 0.3, b.r);
      bg[i * 2] = (a * 1.5) / b.r;
      bg[i * 2 + 1] = 0.6;
    });
    this.beasts.instanceMatrix.needsUpdate = true;
    this.beastGait.needsUpdate = true;
    this.smoke.update(t, night, snow);
  }

  private place(im: THREE.InstancedMesh, k: number, x: number, y: number, z: number, yaw: number, scale: number): void {
    this.q4.setFromAxisAngle(this.up, yaw);
    this.m4.compose(this.v3.set(x, y, z), this.q4, this.s3.set(scale, scale, scale));
    im.setMatrixAt(k, this.m4);
  }

  dispose(): void {
    this.smoke.dispose();
    for (const p of [this.torches, this.lanterns]) {
      if (!p) continue;
      const m = p.material as THREE.PointsMaterial;
      m.map?.dispose();
      m.dispose();
    }
    (this.people.material as THREE.Material).dispose();
    (this.flags.material as THREE.Material).dispose();
    (this.birds.material as THREE.Material).dispose();
  }
}
