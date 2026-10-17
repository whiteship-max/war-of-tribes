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
import { CHURCH, PARVIS, distSeg, heightAt, insidePoly, type CityPlan, type P } from './layout';
import { wallTops } from './forts';
import { hash3, rnd } from './noise';
import { headOf } from './roads';
import { linear } from './palette';
import { armsCode, armsOr } from '@/heraldry/arms';
import { TINCTURE_HEX } from '@/heraldry/art';
import { LIFE_CAP } from './spec';
export { LIFE_CAP } from './spec';

/** Места стражи в кадре (`CityLife.guardsInto`): плоскими массивами, без мусора. */
export interface GuardSpots {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  yaw: Float32Array;
  moving: Uint8Array;
}

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
  /** Размах качания ноги или руки, рад (по умолчанию 0.5 — прежние фигуры). */
  amp?: number;
  /**
   * Точёная часть вместо коробки (docs/city.md, 16.2): кольца снизу вверх с эллиптическим сечением, `n` граней по кругу,
   * нормали сглажены — фигура круглая, а не кубик. Цвет и маска окраски — у каждого кольца свои (между кольцами —
   * переход); `front` — свой цвет спереди (передник), без лишних граней. `cap` — закрыть верх (1), низ (2) или оба (3).
   */
  ring?: Ring[];
  n?: number;
  /** Граней на «Среднем» (`figure(…, coarse)`): та же фигура, грубее по кругу. */
  nLow?: number;
  cap?: number;
  /** Цвет и маска торца (низа и верха), если не те, что у кольца: кисть — кожей из рукава. */
  capCol?: { col: V3; tint: number };
}

/** Кольцо точёной части: высота, полуширина поперёк хода (z), полутолщина вдоль хода (x), сдвиг вперёд. */
export interface Ring {
  y: number;
  hw: number;
  hd: number;
  x?: number;
  /** Сдвиг вбок (по z): кисть ближе к бедру, чем плечо. */
  z?: number;
  col: V3;
  /** Маска окраски: 0 — свой цвет, 1 — одежда экземпляра, 2 — вторая ткань, 3 — кожа экземпляра. */
  tint: number;
  /** Спереди (косинус угла от хода больше `from`) — свой цвет и маска: передник. */
  front?: { col: V3; tint: number; from: number };
}

/** Коробки фигуры в один буфер: положение, нормаль, цвет, маска окраски, качание. */
export function figure(parts: Part[], coarse = false): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const msk: number[] = [];
  const limb: number[] = [];
  const idx: number[] = [];
  for (const p of parts) {
    if (p.ring) {
      lathe(coarse && p.nLow ? { ...p, n: p.nLow } : p, pos, nor, col, msk, limb, idx);
      continue;
    }
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
        limb.push(...(p.limb ?? [0, 0, 0, 0]), p.amp ?? 0.5);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setAttribute('tintMask', new THREE.BufferAttribute(new Float32Array(msk), 1));
  // Качание — пять чисел на вершину: ось (x, y), шаг, фаза — `limb`, размах — `limbAmp`.
  const l5 = new Float32Array(limb);
  const l4 = new Float32Array((l5.length / 5) * 4);
  const amp = new Float32Array(l5.length / 5);
  for (let k = 0; k < amp.length; k++) {
    l4.set(l5.subarray(k * 5, k * 5 + 4), k * 4);
    amp[k] = l5[k * 5 + 4];
  }
  g.setAttribute('limb', new THREE.BufferAttribute(l4, 4));
  g.setAttribute('limbAmp', new THREE.BufferAttribute(amp, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Затенение снизу: фигура «стоит», а не висит. */
const footShade = (y: number): number => 0.75 + 0.25 * Math.min(1, y / 1.6);

/**
 * Точёная часть (`Part.ring`): кольца по `n` вершин делят вершины с соседними гранями — нормали сглажены, тень
 * ложится по кругу. Треугольников — 2·n на пояс между кольцами и n − 2 на закрытый торец.
 */
function lathe(p: Part, pos: number[], nor: number[], col: number[], msk: number[], limb: number[], idx: number[]): void {
  const rings = p.ring!;
  const n = p.n ?? 6;
  const pz = p.z ?? 0;
  const lb = [...(p.limb ?? [0, 0, 0, 0]), p.amp ?? 0.5];
  const start = pos.length / 3;
  // Грань смотрит вперёд: первая вершина — на полграни от оси хода.
  const ang = (k: number): number => ((k + 0.5) / n) * Math.PI * 2;
  rings.forEach((r, j) => {
    const lo = rings[Math.max(0, j - 1)];
    const hi = rings[Math.min(rings.length - 1, j + 1)];
    const dy = hi.y - lo.y || 1;
    for (let k = 0; k < n; k++) {
      const a = ang(k);
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const x = p.x + (r.x ?? 0) + ca * r.hd;
      const z = pz + (r.z ?? 0) + sa * r.hw;
      pos.push(x, r.y, z);
      // Нормаль эллипса и наклон пояса: на сужении кверху смотрит вверх.
      const ex = ca / Math.max(r.hd, 1e-3);
      const ez = sa / Math.max(r.hw, 1e-3);
      const el = Math.hypot(ex, ez) || 1;
      const slope = ((lo.hd + lo.hw - hi.hd - hi.hw) / 2) / dy;
      const nl = Math.hypot(1, slope);
      nor.push(ex / el / nl, slope / nl, ez / el / nl);
      const f = r.front && ca > r.front.from ? r.front : null;
      const c = f ? f.col : r.col;
      const sh = footShade(r.y);
      col.push(c[0] * sh, c[1] * sh, c[2] * sh);
      msk.push(f ? f.tint : r.tint);
      limb.push(...lb);
    }
  });
  for (let j = 0; j + 1 < rings.length; j++) {
    for (let k = 0; k < n; k++) {
      const a = start + j * n + k;
      const b = start + j * n + ((k + 1) % n);
      const c = a + n;
      const d = b + n;
      // Обход против часовой снаружи: низ a → низ b → верх d → верх c.
      idx.push(a, d, b, a, c, d);
    }
  }
  const cap = (r: Ring, up: boolean): void => {
    const base = pos.length / 3;
    for (let k = 0; k < n; k++) {
      const a = ang(k);
      pos.push(p.x + (r.x ?? 0) + Math.cos(a) * r.hd, r.y, pz + (r.z ?? 0) + Math.sin(a) * r.hw);
      nor.push(0, up ? 1 : -1, 0);
      const sh = footShade(r.y);
      const cc = p.capCol?.col ?? r.col;
      col.push(cc[0] * sh, cc[1] * sh, cc[2] * sh);
      msk.push(p.capCol?.tint ?? r.tint);
      limb.push(...lb);
    }
    for (let k = 1; k + 1 < n; k++) {
      if (up) idx.push(base, base + k + 1, base + k);
      else idx.push(base, base + k, base + k + 1);
    }
  };
  if ((p.cap ?? 0) & 1) cap(rings[rings.length - 1], true);
  if ((p.cap ?? 0) & 2) cap(rings[0], false);
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

/** Руки от плеча на высоте `shoulder`: машут в противофазе ногам своей стороны, рукав — цвета одежды. */
export const arms = (shoulder: number, span: number, stride: number): Part[] =>
  [-1, 1].map((side) => ({ x: 0, z: side * span, y0: shoulder - 0.62, y1: shoulder, hw: 0.055, hd: 0.06, col: WHITE, tint: 1, limb: [0, shoulder, stride, side > 0 ? Math.PI : 0] as Part['limb'] }));

/** Ноги одной коробкой, без шага, — низкому уровню: там нового нет, фигура прежняя (`LIFE_TRIS.*Low`). */
const stiff = (hip: number, hw: number, hd: number): Part[] => [{ x: 0, y0: 0, y1: hip, hw, hd, col: LEGS, tint: 0 }];

/** Старый горожанин коробками — низкому уровню: там нового нет (`LIFE_TRIS.personLow`). */
const boxPerson = (): THREE.BufferGeometry =>
  figure([
    ...stiff(0.78, 0.17, 0.11),
    { x: 0, y0: 0.62, y1: 1.42, hw: 0.27, hd: 0.16, taper: 0.78, col: WHITE, tint: 1 },
    { x: 0, y0: 1.42, y1: 1.7, hw: 0.11, hd: 0.11, col: SKIN, tint: 0 },
  ]);

/** Старый стражник коробками — низкому уровню: копьё выше головы, шлем. */
const boxGuard = (): THREE.BufferGeometry =>
  figure([
    ...stiff(0.8, 0.17, 0.12),
    { x: 0, y0: 0.65, y1: 1.45, hw: 0.29, hd: 0.18, taper: 0.8, col: WHITE, tint: 1 },
    { x: 0, y0: 1.45, y1: 1.7, hw: 0.11, hd: 0.11, col: SKIN, tint: 0 },
    { x: 0, y0: 1.66, y1: 1.84, hw: 0.13, hd: 0.13, taper: 0.6, col: STEEL, tint: 0 },
    { x: 0.05, y0: 0.2, y1: 2.6, hw: 0.03, hd: 0.03, col: SHAFT, tint: 0 },
    { x: 0.05, y0: 2.6, y1: 2.85, hw: 0.04, hd: 0.04, taper: 0.2, col: STEEL, tint: 0 },
  ]);

// Люди 1200 года (docs/city.md, 16.2): точёные части, пропорции взрослого 1.7 м — голова седьмая часть роста, плечи
// на 1.38, бёдра на 0.82. Одежда — цвет экземпляра (туника, юбка), вторая ткань — капюшон с оплечьем, шапка, платок,
// щит; кожа — своя у каждого. Ноги и руки качаются в шейдере (`gait`), руки — мягче ног.
const HOSE: V3 = linear(0x4a3e34);
const SHOE: V3 = linear(0x2a2018);
const BELT: V3 = linear(0x3a2a1c);
const HAIR: V3 = linear(0x4a3424);
const LINEN: V3 = linear(0xd8cfb8);
const LEATHER: V3 = linear(0x6a4a2e);
const WOOD: V3 = linear(0x7a5a38);

/** Плечи, бёдра и шаг взрослого. */
const SHOULDER = 1.38;
const HIP = 0.82;
const STRIDE = 1.4;
/** Размах ног и рук, рад: руки мягче — идут в противофазе ногам и не машут. */
const LEG_AMP = 0.42;
const ARM_AMP = 0.3;

/** Ноги в шоссах до башмака: одна грань-кольцо от пола до бедра, башмак — цветом низа. */
const roundLegs = (): Part[] =>
  [-1, 1].map((side) => ({
    x: 0,
    z: side * 0.085,
    y0: 0,
    y1: HIP,
    hw: 0,
    hd: 0,
    col: HOSE,
    tint: 0,
    n: 5,
    nLow: 4,
    ring: [
      { y: 0, hw: 0.055, hd: 0.08, x: 0.03, col: SHOE, tint: 0 },
      { y: HIP, hw: 0.08, hd: 0.085, col: HOSE, tint: 0 },
    ],
    limb: [0, HIP, STRIDE, side > 0 ? 0 : Math.PI] as Part['limb'],
    amp: LEG_AMP,
  }));

/** Руки от плеча: рукав — цветом одежды (или `tint`), кисть — кожей. `swing` — размах (0 — держит что-то). */
const roundArms = (tint = 1, swing: number = ARM_AMP): Part[] =>
  [-1, 1].map((side) => ({
    x: 0,
    z: side * 0.235,
    y0: 0,
    y1: 0,
    hw: 0,
    hd: 0,
    col: WHITE,
    tint,
    n: 4,
    nLow: 3,
    cap: 2,
    capCol: { col: WHITE, tint: 3 },
    ring: [
      { y: SHOULDER - 0.6, hw: 0.04, hd: 0.045, x: 0.03, z: -side * 0.035, col: WHITE, tint },
      { y: SHOULDER, hw: 0.06, hd: 0.065, col: WHITE, tint },
    ],
    limb: [0, SHOULDER, STRIDE, side > 0 ? Math.PI : 0] as Part['limb'],
    amp: swing === 0 ? 0.05 : swing,
  }));

/** Голова: шея, скулы, темя — кожей, макушка — волосами (`hair` — цвет; под шапкой не видна). */
const roundHead = (hair: V3 = HAIR, hairTint = 0): Part => ({
  x: 0.02,
  y0: 0,
  y1: 0,
  hw: 0,
  hd: 0,
  col: SKIN,
  tint: 3,
  n: 6,
  nLow: 5,
  cap: 1,
  ring: [
    { y: 1.43, hw: 0.05, hd: 0.055, col: WHITE, tint: 3 },
    { y: 1.56, hw: 0.095, hd: 0.105, col: WHITE, tint: 3 },
    { y: 1.7, hw: 0.055, hd: 0.06, x: -0.01, col: hair, tint: hairTint },
  ],
});

/** Туника до колен с поясом: подол, пояс (тёмный), плечи; `upper` — маска верха (1 — та же, 2 — котта второй ткани). */
const tunic = (upper = 1): Part => ({
  x: 0,
  y0: 0,
  y1: 0,
  hw: 0,
  hd: 0,
  col: WHITE,
  tint: 1,
  n: 6,
  nLow: 5,
  ring: [
    { y: 0.48, hw: 0.2, hd: 0.17, col: WHITE, tint: 1 },
    { y: 0.95, hw: 0.165, hd: 0.135, col: BELT, tint: 0 },
    { y: SHOULDER, hw: 0.215, hd: 0.125, col: WHITE, tint: upper },
    { y: 1.45, hw: 0.06, hd: 0.06, col: WHITE, tint: 3 },
  ],
});

/** Мужчина в тунике и капюшоне с оплечьем (шаперон) — второй тканью; лицо выглядывает из капюшона. */
const manHood = (): Part[] => [
  ...roundLegs(),
  tunic(),
  ...roundArms(),
  roundHead(),
  {
    x: -0.035,
    y0: 0,
    y1: 0,
    hw: 0,
    hd: 0,
    col: WHITE,
    tint: 2,
    n: 6,
    nLow: 5,
    cap: 1,
    ring: [
      { y: 1.22, hw: 0.28, hd: 0.2, col: WHITE, tint: 2 },
      { y: 1.42, hw: 0.15, hd: 0.13, col: WHITE, tint: 2 },
      { y: 1.6, hw: 0.135, hd: 0.13, col: WHITE, tint: 2 },
      { y: 1.75, hw: 0.075, hd: 0.08, x: -0.02, col: WHITE, tint: 2 },
    ],
  },
];

/** Мужчина в тунике и котте (верх — второй тканью) и в шапке-валенке. */
const manCap = (): Part[] => [
  ...roundLegs(),
  tunic(2),
  ...roundArms(),
  roundHead(),
  {
    x: 0.01,
    y0: 0,
    y1: 0,
    hw: 0,
    hd: 0,
    col: WHITE,
    tint: 2,
    n: 6,
    nLow: 5,
    ring: [
      { y: 1.58, hw: 0.11, hd: 0.118, col: WHITE, tint: 2 },
      { y: 1.69, hw: 0.1, hd: 0.108, col: WHITE, tint: 2 },
      { y: 1.76, hw: 0.02, hd: 0.02, col: WHITE, tint: 2 },
    ],
  },
];

/** Женщина: юбка до земли с передником спереди, лиф, рукава, платок (вимпл) — второй тканью или льном; башмаки шагают. */
const woman = (): Part[] => [
  ...[-1, 1].map((side) => ({
    x: 0,
    z: side * 0.08,
    y0: 0,
    y1: 0,
    hw: 0,
    hd: 0,
    col: SHOE,
    tint: 0,
    n: 4,
    ring: [
      { y: 0, hw: 0.045, hd: 0.08, x: 0.06, col: SHOE, tint: 0 },
      { y: 0.14, hw: 0.04, hd: 0.05, col: SHOE, tint: 0 },
    ],
    limb: [0, 0.6, STRIDE * 0.85, side > 0 ? 0 : Math.PI] as Part['limb'],
    amp: 0.3,
  })),
  {
    x: 0,
    y0: 0,
    y1: 0,
    hw: 0,
    hd: 0,
    col: WHITE,
    tint: 1,
    n: 7,
    nLow: 6,
    ring: [
      { y: 0.03, hw: 0.26, hd: 0.25, col: WHITE, tint: 1, front: { col: LINEN, tint: 0, from: 0.55 } },
      { y: 0.95, hw: 0.15, hd: 0.125, col: WHITE, tint: 1, front: { col: LINEN, tint: 0, from: 0.55 } },
      { y: 1.36, hw: 0.19, hd: 0.115, col: WHITE, tint: 1 },
      { y: 1.44, hw: 0.05, hd: 0.05, col: WHITE, tint: 3 },
    ],
  },
  ...roundArms().map((a) => ({ ...a, z: (a.z ?? 0) * 0.92 })),
  roundHead(),
  {
    x: -0.03,
    y0: 0,
    y1: 0,
    hw: 0,
    hd: 0,
    col: WHITE,
    tint: 2,
    n: 6,
    nLow: 5,
    cap: 1,
    ring: [
      { y: 1.26, hw: 0.21, hd: 0.16, col: WHITE, tint: 2 },
      { y: 1.44, hw: 0.13, hd: 0.12, col: WHITE, tint: 2 },
      { y: 1.62, hw: 0.126, hd: 0.124, col: WHITE, tint: 2 },
      { y: 1.75, hw: 0.07, hd: 0.075, x: -0.01, col: WHITE, tint: 2 },
    ],
  },
];

/** Виды горожан: мужчина в капюшоне, мужчина в шапке, женщина. Порядок — `TOWNSFOLK`, доли — `townsfolkOf`. */
export type Townsfolk = 'hood' | 'cap' | 'woman';
export const TOWNSFOLK: readonly Townsfolk[] = ['hood', 'woman', 'cap'];
/** Вид горожанина по номеру: женщины — треть, мужчины в капюшоне и в шапке — поровну. */
export const townsfolkOf = (k: number): Townsfolk => TOWNSFOLK[k % TOWNSFOLK.length];

/**
 * Подробность фигур по уровню: 0 — «Низкое», прежние коробки без шага; 1 — «Среднее», точёные, грубее по кругу;
 * 2 — «Высокое», точёные полностью.
 */
export type FigureLod = 0 | 1 | 2;
export const figureLod = (q: Quality): FigureLod => (q === 'low' ? 0 : q === 'medium' ? 1 : 2);

/** Горожанин вида `kind` на подробности `lod`; на «Низком» — прежняя фигура коробками без шага, одна на всех. */
export const townsGeometry = (kind: Townsfolk, lod: FigureLod = 2): THREE.BufferGeometry =>
  lod === 0 ? boxPerson() : figure(kind === 'hood' ? manHood() : kind === 'cap' ? manCap() : woman(), lod === 1);

/** Горожанин (строитель, прохожий) — мужчина в капюшоне. */
export const personGeometry = (lod: FigureLod = 2): THREE.BufferGeometry => townsGeometry('hood', lod);

/** Стёганка стражи: туника цвета экземпляра (сюрко города) поверх, пояс, — и железный шлем. */
const helmet = (kettle: boolean): Part => ({
  x: 0.01,
  y0: 0,
  y1: 0,
  hw: 0,
  hd: 0,
  col: STEEL,
  tint: 0,
  n: 6,
  nLow: 5,
  ring: kettle
    ? [
        { y: 1.6, hw: 0.19, hd: 0.2, col: STEEL, tint: 0 },
        { y: 1.64, hw: 0.115, hd: 0.12, col: STEEL, tint: 0 },
        { y: 1.78, hw: 0.03, hd: 0.03, col: STEEL, tint: 0 },
      ]
    : [
        { y: 1.57, hw: 0.112, hd: 0.12, col: STEEL, tint: 0 },
        { y: 1.67, hw: 0.105, hd: 0.112, col: STEEL, tint: 0 },
        { y: 1.82, hw: 0.01, hd: 0.01, col: STEEL, tint: 0 },
      ],
});

/**
 * Копейщик у ворот: стёганка цвета стражи, конический шлем, копьё в правой руке выше головы, миндалевидный щит на
 * левой — второй тканью (цвет города). Стоит — шейдер его не качает (шаг 0); в строю найма — идёт.
 */
export const guardGeometry = (lod: FigureLod = 2): THREE.BufferGeometry =>
  lod === 0
    ? boxGuard()
    : figure([
        ...roundLegs(),
        tunic(),
        ...roundArms(1, 0),
        roundHead(),
        helmet(false),
        // Копьё: древко у правой руки и наконечник.
        {
          x: 0.12,
          z: 0.27,
          y0: 0,
          y1: 0,
          hw: 0,
          hd: 0,
          col: SHAFT,
          tint: 0,
          n: 3,
          ring: [
            { y: 0.02, hw: 0.018, hd: 0.018, col: SHAFT, tint: 0 },
            { y: 2.55, hw: 0.018, hd: 0.018, col: SHAFT, tint: 0 },
            { y: 2.56, hw: 0.035, hd: 0.035, col: STEEL, tint: 0 },
            { y: 2.8, hw: 0.002, hd: 0.002, col: STEEL, tint: 0 },
          ],
        },
        // Щит на левой руке: сверху широкий, книзу клином.
        {
          x: 0.08,
          z: -0.31,
          y0: 0,
          y1: 0,
          hw: 0,
          hd: 0,
          col: WHITE,
          tint: 2,
          n: 4,
          cap: 1,
          ring: [
            { y: 0.62, hw: 0.02, hd: 0.02, col: WHITE, tint: 2 },
            { y: 1.02, hw: 0.03, hd: 0.2, col: WHITE, tint: 2 },
            { y: 1.36, hw: 0.03, hd: 0.21, col: WHITE, tint: 2 },
          ],
        },
      ], lod === 1);

/**
 * Лучник на стене: стёганка цвета стражи, шапель (шлем с полями), колчан за спиной, лук в левой руке — качается вместе
 * с ней, мягко. Ходит дозором; ночью над правым плечом факел (`torches`).
 */
export const archerGeometry = (lod: FigureLod = 2): THREE.BufferGeometry => {
  if (lod === 0) return boxGuard();
  const arms = roundArms(1, ARM_AMP * 0.6);
  const left = arms.find((a) => (a.z ?? 0) < 0)!;
  return figure([
    ...roundLegs(),
    tunic(),
    ...arms,
    roundHead(),
    helmet(true),
    // Колчан: кожаный ствол за правым плечом наискось вверх, стрелы — светлыми перьями.
    {
      x: -0.17,
      z: 0.07,
      y0: 0,
      y1: 0,
      hw: 0,
      hd: 0,
      col: LEATHER,
      tint: 0,
      n: 4,
      ring: [
        { y: 0.9, hw: 0.05, hd: 0.05, col: LEATHER, tint: 0 },
        { y: 1.42, hw: 0.055, hd: 0.055, x: -0.03, col: LEATHER, tint: 0 },
        { y: 1.55, hw: 0.04, hd: 0.04, x: -0.04, col: LINEN, tint: 0 },
      ],
    },
    // Лук: длинный, дугой вперёд — у левой кисти, качается с рукой.
    {
      x: 0.06,
      z: -0.27,
      y0: 0,
      y1: 0,
      hw: 0,
      hd: 0,
      col: WOOD,
      tint: 0,
      n: 3,
      ring: [
        { y: 0.15, hw: 0.012, hd: 0.012, x: -0.04, col: WOOD, tint: 0 },
        { y: 0.78, hw: 0.022, hd: 0.022, x: 0.06, col: WOOD, tint: 0 },
        { y: 1.45, hw: 0.012, hd: 0.012, x: -0.04, col: WOOD, tint: 0 },
      ],
      limb: left.limb,
      amp: left.amp,
    },
  ], lod === 1);
};

/** Овца (корова — та же, крупнее и в своём цвете): туловище, голова, ноги парами — передние и задние. */
export const beastGeometry = (simple = false): THREE.BufferGeometry =>
  figure([
    ...(simple
      ? stiff(0.35, 0.2, 0.36)
      : ([
          { x: 0.3, y0: 0, y1: 0.35, hw: 0.2, hd: 0.07, col: LEGS, tint: 0, limb: [0.3, 0.35, 0.9, 0] },
          { x: -0.3, y0: 0, y1: 0.35, hw: 0.2, hd: 0.07, col: LEGS, tint: 0, limb: [-0.3, 0.35, 0.9, Math.PI] },
        ] as Part[])),
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
    shader.vertexShader =
      'attribute float tintMask;\nattribute vec4 limb;\nattribute float limbAmp;\nattribute vec2 gait;\nattribute vec3 cloth2;\nattribute vec3 skinTone;\n' +
      shader.vertexShader.replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
      if (limb.z != 0.0) {
        float ang = limb.z > 0.0 ? sin(gait.x * 6.2832 / limb.z + limb.w) * limbAmp * gait.y : gait.x / limb.z;
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
        // Маска: 0 — свой цвет, 1 — одежда экземпляра, 2 — вторая ткань (капюшон, платок, щит), 3 — кожа.
        vColor.xyz *= tintMask < 0.5 ? vec3( 1.0 ) : tintMask < 1.5 ? instanceColor.xyz : tintMask < 2.5 ? cloth2 : skinTone;
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
export function nearestOn(path: Path, p: P): { d: number; s: number } {
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
export interface Junction {
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
/** Сколько дороги от ворот ходят люди, метры: дальше — дымка (`camera.cityFog`). */
export const TRAVEL_REACH = 760;
/** Людная часть дороги у ворот, метры; дальше вес пути на метр — `TRAVEL_FAR`: редкие путники. */
const TRAVEL_BUSY = 170;
const TRAVEL_FAR = 0.05;

export const SQUARE_PATHS: readonly { name: string; pts: P[]; half: number; weight: number }[] = [
  { name: 'от Главной к Верхней', pts: [{ x: 1, z: 30 }, { x: 14, z: 25.8 }, { x: 26, z: 23.5 }, { x: 28.5, z: 12 }, { x: 27, z: -4 }, { x: 25, z: -24 }], half: 2.5, weight: 2 },
  { name: 'от Восточной к Западной', pts: [{ x: 31, z: 0 }, { x: 12, z: -1 }, { x: -10, z: -2 }, { x: -23, z: -10 }, { x: -27, z: -24 }], half: 2.5, weight: 2 },
  { name: 'к паперти', pts: [{ x: -2, z: -1.8 }, { x: -4, z: -14 }, { x: -4, z: -24 }, { x: -4, z: PARVIS.foot + 0.6 }], half: 2, weight: 2.5 },
  { name: 'меж рядов, южный проход', pts: [{ x: -15, z: 8.25 }, { x: 28.3, z: 8.25 }], half: 1.2, weight: 4 },
  { name: 'меж рядов, северный проход', pts: [{ x: -15, z: 14.75 }, { x: 28.2, z: 14.75 }], half: 1.2, weight: 3 },
];

/**
 * Прихожанин (docs/city_v3.md, Г-2): стоит на площадке перед храмом, идёт к лестнице, поднимается на паперть, входит в
 * открытую створку портала и пропадает внутри; выходит тем же путём и снова стоит на своём месте лицом к храму. Положение
 * — функция времени, как у прохожих: пришёл из фона — прихожанин там, где ему быть.
 */
export interface Visit {
  /** Путь от места на площадке до порога: точки с высотой. */
  pts: V3[];
  acc: number[];
  len: number;
  v: number;
  /** Сколько стоит в храме и на своём месте, с. */
  inside: number;
  stay: number;
  phase: number;
}

/** Где прихожанин в миг `t`; `hidden` — он в храме (фигура не рисуется), `moving` — идёт. */
export const VISIT = { x: 0, y: 0, z: 0, yaw: 0, dist: 0, moving: 0, hidden: false };

export function visitOf(plan: CityPlan, k: number, salt: number): Visit {
  const r = (j: number): number => rnd(k, j, salt);
  const ch = plan.civic.find((c) => c.kind === 'church');
  const base = ch ? ch.base : heightAt(CHURCH.x, CHURCH.front);
  // Место — на площадке перед лестницей; ход по лестнице — своей полосой; порог — в открытой (правой) створке.
  const sx = CHURCH.x + (r(1) - 0.5) * 26;
  const sz = PARVIS.foot + 1.6 + r(2) * 3.6;
  const lane = CHURCH.x + (r(3) - 0.5) * 2 * (PARVIS.half - 1.4);
  const doorX = CHURCH.x + 0.45 + r(4) * 0.7;
  const doorZ = CHURCH.front + 0.75;
  const pts: V3[] = [
    [sx, heightAt(sx, sz), sz],
    [lane, heightAt(lane, PARVIS.foot + 0.4), PARVIS.foot + 0.4],
    [lane, base, PARVIS.top - 0.3],
    [doorX, base, doorZ + 0.6],
    [doorX, base, doorZ],
  ];
  const acc = [0];
  for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
  const len = acc[acc.length - 1];
  const v = 0.8 + r(5) * 0.4;
  const inside = 18 + r(6) * 40;
  const stay = 10 + r(7) * 30;
  return { pts, acc, len, v, inside, stay, phase: r(8) * (2 * len / v + inside + stay) };
}

export function visitAt(w: Visit, t: number): typeof VISIT {
  const walk = w.len / w.v;
  const period = 2 * walk + w.inside + w.stay;
  const m = (((t + w.phase) % period) + period) % period;
  const P = w.pts;
  // Стоит на месте лицом к храму (храм смотрит на юг: лицом — на север).
  const standYaw = Math.atan2(1, 0);
  if (m < w.stay) {
    VISIT.x = P[0][0];
    VISIT.y = P[0][1];
    VISIT.z = P[0][2];
    VISIT.yaw = standYaw;
    VISIT.moving = 0;
    VISIT.hidden = false;
    VISIT.dist = 0;
    return VISIT;
  }
  const inTo = m < w.stay + walk;
  const inChurch = !inTo && m < w.stay + walk + w.inside;
  if (inChurch) {
    const e = P[P.length - 1];
    VISIT.x = e[0];
    VISIT.y = e[1];
    VISIT.z = e[2] - 1.5;
    VISIT.yaw = standYaw;
    VISIT.moving = 0;
    VISIT.hidden = true;
    VISIT.dist = 0;
    return VISIT;
  }
  const d = inTo ? (m - w.stay) * w.v : w.len - (m - w.stay - walk - w.inside) * w.v;
  let i = 0;
  while (i < w.acc.length - 2 && w.acc[i + 1] <= d) i++;
  const a = P[i];
  const e = P[i + 1];
  const f = Math.min(1, Math.max(0, (d - w.acc[i]) / (w.acc[i + 1] - w.acc[i] || 1)));
  VISIT.x = a[0] + (e[0] - a[0]) * f;
  VISIT.y = a[1] + (e[1] - a[1]) * f;
  VISIT.z = a[2] + (e[2] - a[2]) * f;
  const go = inTo ? 1 : -1;
  // Фигура смотрит по +x, поворот — вокруг вертикали (как у прохожих).
  VISIT.yaw = Math.atan2(-(e[2] - a[2]) * go, (e[0] - a[0]) * go);
  VISIT.moving = 1;
  VISIT.hidden = false;
  VISIT.dist = inTo ? d : 2 * w.len - d;
  return VISIT;
}

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
/** Сила ветра без погоды (стенд): дым сносит, как прежде, — на полметра за метр подъёма. */
export const WIND_CALM = 0.4;

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
/** Кожа горожан — от светлой до смуглой (Сицилия 1200 года — и норманны, и греки, и арабы). */
const SKINS = [0xe0b494, 0xd4a07e, 0xc79a7a, 0xb88462, 0xa87252, 0x8e5e40].map(linear);
/** Вторая ткань мужчин — капюшон с оплечьем, котта, шапка: некрашеная шерсть, вайда, марена, ореховая, зелень. */
const CLOTH2 = [0x6a5a48, 0x4a5a72, 0x7a3a30, 0x5a4a38, 0x4a5a3a, 0x8a7a60, 0x3a3a3a, 0x6a4a5a].map(linear);
/** Платок женщин: лён, беленый, синий, охра. */
const KERCHIEF = [0xe8e0cc, 0xd8cfb8, 0xf0ece0, 0x8a9ab0, 0xb89a60].map(linear);
/** Щиты стражи — цвета города: червлень с золотом, синь. */
const SHIELD = [0x9a2a24, 0xb08a3a, 0x2a3a6a].map(linear);

/**
 * Экземплярный меш фигур: цвет одежды — `instanceColor`, вторая ткань и кожа — свои атрибуты экземпляра
 * (`figureMaterial`, маски 2 и 3). Цвета — от номера экземпляра (`hash3`), до первого кадра.
 */
export function figureMesh(g: THREE.BufferGeometry, mat: THREE.Material, n: number, name: string, dress: readonly V3[], second: readonly V3[], salt: number): THREE.InstancedMesh {
  const im = new THREE.InstancedMesh(g, mat, Math.max(1, n));
  const c2 = new Float32Array(im.count * 3);
  const sk = new Float32Array(im.count * 3);
  const col = new THREE.Color();
  for (let i = 0; i < im.count; i++) {
    const d = dress[hash3(i, 3, salt) % dress.length];
    im.setColorAt(i, col.setRGB(d[0], d[1], d[2]));
    c2.set(second[hash3(i, 5, salt) % second.length], i * 3);
    sk.set(SKINS[hash3(i, 7, salt) % SKINS.length], i * 3);
  }
  g.setAttribute('cloth2', new THREE.InstancedBufferAttribute(c2, 3));
  g.setAttribute('skinTone', new THREE.InstancedBufferAttribute(sk, 3));
  im.name = name;
  im.frustumCulled = false;
  return im;
}

/** Стоит, а не идёт: у рядов, у колодца, у паперти, у ратуши — кружком по двое-четверо, лицом друг к другу. */
interface Idle {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Копейщики у ворот: с каждой стороны проезда (арка 6 м) двое — у столба арки и на шаг дальше, м от оси. */
export const GATE_POSTS = [3.5, 4.4] as const;

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
/** Клубов на трубу дома: струя сплошная и с полукилометра (пять читались точками). */
export const SMOKE_PUFFS = 8;

export class CitySmoke {
  readonly points: THREE.Points;
  private material: THREE.PointsMaterial;
  /** `cDrift` — снос клуба на метр подъёма по осям мира: погода правит его ветром (`CityLife.setWind`). */
  readonly u = { cTime: { value: 0 }, cShare: { value: 0.5 }, cSnow: { value: 0 }, cNight: { value: 0 }, cDrift: { value: new THREE.Vector2() } };

  constructor(private look: SmokeLook) {
    this.material = new THREE.PointsMaterial({ color: 0xc8cacc, size: look.size, transparent: true, opacity: 1, depthWrite: false });
    const dot = softDot();
    if (dot) {
      this.material.map = dot;
      this.material.alphaTest = 0.01;
    }
    const u = this.u;
    u.cDrift.value.set(look.drift?.x ?? 0, look.drift?.z ?? 0);
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader =
        'attribute vec4 puff;\nuniform float cTime;\nuniform float cShare;\nuniform float cSnow;\nuniform float cNight;\nuniform vec2 cDrift;\nvarying float vAlpha;\nvarying vec3 vTint;\n' +
        shader.vertexShader
          .replace(
            '#include <begin_vertex>',
            /* glsl */ `
            // puff: x — сдвиг возраста (место клуба в струе и труба), y — высота подъёма, z — порог трубы, w — 1 у дыма работы.
            float age = fract(cTime * (0.075 + 0.02 * cSnow) * (0.85 + 0.3 * fract(puff.x * 7.31)) + puff.x);
            float rise = age * puff.y;
            float sw = puff.x * 41.0;
            vec3 transformed = position;
            transformed.x += cDrift.x * rise + sin(sw + age * 3.1) * (0.25 + age * 1.4);
            transformed.z += cDrift.y * rise + cos(sw * 1.3 + age * 2.7) * (0.25 + age * 1.4);
            transformed.y += rise;
            float on = puff.w > 0.5 ? 1.0 : clamp((cShare - puff.z) * 12.0, 0.0, 1.0);
            vAlpha = on * smoothstep(0.0, 0.08, age) * pow(1.0 - age, 1.2) * (puff.w > 0.5 ? 0.85 : 0.6 + 0.25 * cSnow);
            // Зимой дым темнее: светлый клуб над снежной кровлей не видно.
            float lit = (1.0 - 0.72 * cNight) * (1.0 - 0.3 * cSnow);
            // У дыма работы ночью снизу — отсвет горна.
            vTint = puff.w > 0.5 ? mix(vec3(0.42) * lit + vec3(0.55, 0.22, 0.05) * cNight * (1.0 - smoothstep(0.0, 0.25, age)), vec3(0.6) * lit, age) : vec3(lit);
            float grow = (0.7 + age * 1.9) * (puff.w > 0.5 ? 1.4 : 1.0 + 0.2 * cSnow);`,
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
  /** Прихожане храма: у кого есть — тот не прохожий и не стоящий (`visitAt`). */
  private visits: (Visit | null)[] = [];
  /** Горожане — по мешу на вид (`TOWNSFOLK`; на низком — один прежний); прохожий `k` — в меше `k % видов`. */
  private crowd: THREE.InstancedMesh[] = [];
  private crowdGait: THREE.InstancedBufferAttribute[] = [];
  /** Лучники на стене. */
  private sentries: THREE.InstancedMesh;
  /** Копейщики у ворот: по двое с каждой стороны проезда, стоят. */
  private gateGuards: THREE.InstancedMesh;
  private gatePosts: { x: number; y: number; z: number; yaw: number }[] = [];
  /** Посты стражи у ворот: место и разворот — стенду, чтобы снять стражу вблизи (`?showcase=city&guard=N`). */
  get posts(): readonly { x: number; y: number; z: number; yaw: number }[] {
    return this.gatePosts;
  }
  private beatStops: { s: number; half: number }[] = [];
  private beasts: THREE.InstancedMesh;
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
  /** Вершины полотнищ флагов: номер и доля длины (`setLivery` перекрашивает их в ливрею герба). */
  private flagCloth: { i: number; u: number }[] = [];
  private livery = '';
  private birds: THREE.Mesh;
  private time = { value: 0 };
  /** Ветер погоды: куда дует (оси мира) и сила — флагам; дыму — его снос (`setWind`). */
  private windDir = { value: new THREE.Vector2(CITY_WIND.x, CITY_WIND.z) };
  private windK = { value: WIND_CALM };
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
    // Дороги от ворот — до дымки (`TRAVEL_REACH`): у ворот людно, дальше — редкие путники (docs/city_v3.md, Г-3); лесная
    // дорога на север — путники к деревне за лесом. Число людей уровня не растёт: путники — из тех же идущих.
    for (const r of plan.roads) {
      const main = r.name === 'Дорога в долину' || r.name === 'Восточная дорога';
      if (!main && r.name !== 'Лесная дорога') continue;
      this.paths.push(pathOf(headOf(r.pts, TRAVEL_REACH), r.half, ground));
      const len = this.paths[this.paths.length - 1].len;
      weight.push(main ? Math.min(len, TRAVEL_BUSY) * 0.5 + Math.max(0, len - TRAVEL_BUSY) * TRAVEL_FAR : len * TRAVEL_FAR);
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
    const simple = quality === 'low';
    const lod = figureLod(quality);
    const kinds: readonly Townsfolk[] = simple ? ['hood'] : TOWNSFOLK;
    kinds.forEach((kind, m) => {
      const n = Math.ceil((this.cap.people - m) / kinds.length);
      const im = figureMesh(townsGeometry(kind, lod), mat, n, m === 0 ? 'city-people' : `city-people-${kind}`, DRESS, kind === 'woman' ? KERCHIEF : CLOTH2, 97 + m);
      this.crowd.push(im);
      this.crowdGait.push(gaitOf(im));
    });
    this.sentries = figureMesh(archerGeometry(lod), mat, this.cap.guards, 'city-guards', TABARD, SHIELD, 79);
    // Ворота: по двое копейщиков с каждой стороны проезда, перед башней, лицом от неё. Снаружи — если там есть место:
    // северные ворота города и ворота замка стоят через ров вплотную, и их стража — каждая со своей, внутренней стороны.
    const gates = plan.towers.filter((t) => t.kind === 'gate' || t.kind === 'castleGate');
    for (const t of gates) {
      let fx = Math.cos(t.out);
      let fz = Math.sin(t.out);
      const blocked = gates.some((o) => o !== t && (o.x - t.x) * fx + (o.z - t.z) * fz > 0 && Math.hypot(o.x - t.x, o.z - t.z) < (t.size + o.size) / 2 + 4);
      if (blocked) {
        fx = -fx;
        fz = -fz;
      }
      for (const side of [-1, 1]) {
        for (const r of GATE_POSTS) {
          const x = t.x + fx * (t.size / 2 + 0.9) + fz * side * r;
          const z = t.z + fz * (t.size / 2 + 0.9) - fx * side * r;
          this.gatePosts.push({ x, y: heightAt(x, z), z, yaw: Math.atan2(-fz, fx) });
        }
      }
    }
    this.gateGuards = figureMesh(guardGeometry(lod), mat, this.gatePosts.length, 'city-gate-guards', TABARD, SHIELD, 83);
    this.beasts = new THREE.InstancedMesh(beastGeometry(simple), mat, this.cap.animals);
    for (const im of [...this.crowd, this.sentries, this.gateGuards, this.beasts]) {
      im.frustumCulled = false;
      im.count = 0;
      this.group.add(im);
    }
    // Копейщики стоят: матрицы — один раз.
    this.gatePosts.forEach((g, i) => this.place(this.gateGuards, i, g.x, g.y, g.z, g.yaw, 1));
    this.gateGuards.count = this.gatePosts.length;
    gaitOf(this.gateGuards);
    this.guardGait = gaitOf(this.sentries);
    this.beastGait = gaitOf(this.beasts);
    this.beasts.name = 'city-beasts';
    // Цвет шкур — до первого кадра: без него программа собралась бы без цвета экземпляров.
    const col = new THREE.Color();
    for (let i = 0; i < this.cap.animals; i++) this.beasts.setColorAt(i, col.setRGB(1, 1, 1));
    // Дозор лучника — между соседними башнями, не сквозь них: башни на ходу стены — по их проекции на ход.
    const stops = plan.towers
      .map((t) => ({ t, n: nearestOn(this.wall, t) }))
      .filter((o) => o.n.d < o.t.size)
      .map((o) => ({ s: o.n.s, half: o.t.size / 2 + 1.2 }))
      .sort((a, b) => a.s - b.s);
    this.beatStops = stops;
    this.seedPeople();
    this.seedBeasts();

    this.smoke = new CitySmoke(CITY_SMOKE);
    // Факелы стражи — точки с мягким пятном, как огоньки стены (`index.flames`), видны в сумерках и ночью.
    this.torches = glowPoints(this.cap.guards + this.gatePosts.length, 2.4, 0xffa040, 'city-torches');
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
      .map(({ c, thr }) => ({ x: c[0], y: c[1], z: c[2], puffs: SMOKE_PUFFS, top: 10, thr }));
    this.smoke.setSources(this.smokeOn, []);

    this.flags = this.buildFlags(input.flagTops);
    this.group.add(this.flags);
    this.birds = this.buildBirds(plan);
    this.group.add(this.birds);
  }

  private junctions: Junction[][] = [];
  private weight: number[] = [];

  /** Граф улиц — тем, кто ходит по городу по делу: найм идёт из казарм на площадь (`deeds.marchRoute`). */
  street(): { paths: readonly Path[]; junctions: readonly Junction[][] } {
    return { paths: this.paths, junctions: this.junctions };
  }

  /**
   * Прохожие: идущие — по маршрутам графа улиц, прихожане — от площадки перед храмом в храм и обратно (`visitAt`),
   * стоящие — кружками у рядов, паперти и ратуши и лицом к колодцу вокруг него. Раскладка от зерна — одна на город; порядок перемешан, чтобы при малом населении и ночью стояли и шли в той же доле.
   */
  private seedPeople(): void {
    const total = this.cap.people;
    const well = this.input.plan.well;
    // `ring` — кружок вокруг колодца лицом к нему: берут воду, крутят ворот; места — мимо колоды, ведра и огненной чаши.
    const spots: { x: number; z: number; rx: number; rz: number; w: number; ring?: number }[] = [
      { x: 4, z: 8.3, rx: 15, rz: 0.4, w: 4 },
      { x: 4, z: 14.8, rx: 15, rz: 0.4, w: 3 },
      { x: well.x, z: well.z, rx: 0, rz: 0, w: 3, ring: 2.05 },
      { x: CHURCH.x, z: PARVIS.foot + 2.7, rx: 11, rz: 1.5, w: 3 },
      { x: -23, z: -2, rx: 1.6, rz: 9, w: 2 },
      { x: -19, z: 9, rx: 2, rz: 2, w: 1 },
    ];
    const WELL_ARC = [-1.85, -1.25, -0.2, 1.75, 2.35, -2.5];
    const wsum = spots.reduce((a, b) => a + b.w, 0);
    let group: { x: number; z: number; left: number; k: number; ring?: number; arc: number } | null = null;
    for (let k = 0; k < total; k++) {
      if (rnd(k, 6, 72) >= 0.32) {
        // Каждый седьмой из идущих — прихожанин храма: ходит от площадки в храм и обратно.
        const visit = rnd(k, 14, 72) < 0.14;
        this.visits.push(visit ? visitOf(this.input.plan, k, 74) : null);
        this.routes.push(visit ? null : routeOf(this.paths, this.junctions, this.weight, k, 71));
        this.idle.push(null);
        continue;
      }
      // Кружок: середина у места, двое-четверо вокруг неё лицом внутрь.
      if (!group || group.left <= 0) {
        let r = rnd(k, 7, 73) * wsum;
        let i = 0;
        while (i < spots.length - 1 && r > spots[i].w) r -= spots[i++].w;
        const c = spots[i];
        group = {
          x: c.x + (rnd(k, 8, 73) - 0.5) * 2 * c.rx,
          z: c.z + (rnd(k, 9, 73) - 0.5) * 2 * c.rz,
          left: 2 + Math.floor(rnd(k, 10, 73) * 3),
          k: 0,
          ring: c.ring,
          arc: Math.floor(rnd(k, 15, 73) * WELL_ARC.length),
        };
      }
      const a = group.ring ? WELL_ARC[(group.arc + group.k) % WELL_ARC.length] + (rnd(k, 11, 73) - 0.5) * 0.25 : rnd(k, 11, 73) * 0.6 + (group.k * Math.PI * 2) / 3.2;
      const rr = group.ring ? group.ring + rnd(k, 12, 73) * 0.3 : 0.55 + rnd(k, 12, 73) * 0.25;
      const x = group.x + Math.cos(a) * rr;
      const z = group.z + Math.sin(a) * rr;
      // Лицом к середине кружка: фигура смотрит по +x, поворот — вокруг вертикали.
      this.idle.push({ x, z, y: heightAt(x, z), yaw: Math.atan2(-(group.z - z), group.x - x) });
      this.routes.push(null);
      this.visits.push(null);
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
   * все флаги; цвет — красное поле города с золотой бахромой, пока не приехал герб: дальше — ливрея герба (`setLivery`).
   */
  /**
   * Ливрея герба на флагах башен (П-2): полотнище — первой краской поля, бахрома — краской фигуры (металл к цвету, правило
   * герба держит контраст). Герб тот же — ничего не делает.
   */
  setLivery(code: string | null | undefined): void {
    const arms = armsOr(code);
    const key = armsCode(arms);
    if (key === this.livery) return;
    this.livery = key;
    const body = linear(parseInt(TINCTURE_HEX[arms.field[0]].slice(1), 16));
    const fringe = linear(parseInt(TINCTURE_HEX[arms.tint].slice(1), 16));
    const col = this.flags.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (const v of this.flagCloth) {
      const c = v.u > 0.84 ? fringe : body;
      col.setXYZ(v.i, c[0], c[1], c[2]);
    }
    col.needsUpdate = true;
  }

  private buildFlags(tops: V3[]): THREE.Mesh {
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const flap: number[] = [];
    const idx: number[] = [];
    const red = linear(0x9a2a24);
    const gold = linear(0xc8a040);
    const pole = linear(0x3a3028);
    // Полотнища построены по ветру по умолчанию (`CITY_WIND`); куда дует сейчас, их поворачивает шейдер (`setWind`).
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
          this.flagCloth.push({ i: pos.length / 3 - 1, u });
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
    const windDir = this.windDir;
    const windK = this.windK;
    m.onBeforeCompile = (shader) => {
      shader.uniforms.cTime = time;
      shader.uniforms.cWindDir = windDir;
      shader.uniforms.cWind = windK;
      shader.vertexShader = 'attribute float flap;\nuniform float cTime;\nuniform vec2 cWindDir;\nuniform float cWind;\n' + shader.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `#include <beginnormal_vertex>
          if (flap > 0.0) objectNormal = vec3(-cWindDir.y, 0.0, cWindDir.x);`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
        // Полотнище — от древка туда, куда дует сейчас: древко — там, откуда полотнище построено по ветру по умолчанию.
        vec2 pole = transformed.xz - vec2(${wx.toFixed(4)}, ${wz.toFixed(4)}) * flap * 2.4;
        transformed.xz = pole + cWindDir * flap * 2.4;
        // Волна от древка: чем дальше от древка, тем сильнее; фаза — от места флага; размах — от силы ветра (частота одна:
        // меняйся она с ветром, фаза прыгала бы). В тишь полотнище обвисает.
        float ph = position.x * 0.37 + position.z * 0.23;
        float w = (sin(cTime * 4.2 - flap * 5.0 + ph) * 0.32 + sin(cTime * 7.1 - flap * 9.0 + ph * 1.7) * 0.08) * (0.35 + 1.4 * cWind);
        transformed.xz += vec2(-cWindDir.y, cWindDir.x) * w * flap;
        transformed.y -= flap * flap * (0.12 + 0.6 * (1.0 - smoothstep(0.1, 0.5, cWind)));`,
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
  /** Ветер погоды: куда дует (`x`, `z` — единичный, оси мира) и сила `k` 0..1 — флагам и дыму. */
  setWind(x: number, z: number, k: number): void {
    this.windDir.value.set(x, z);
    this.windK.value = k;
    this.smoke.u.cDrift.value.set(x, z).multiplyScalar(0.12 + 0.95 * k);
  }

  update(dt: number, t: number, night: number, snow: number): void {
    void dt;
    this.time.value = t;
    // Ночью на улицах редкие прохожие, зимой — на четверть меньше; стража стоит всегда.
    const shown = Math.round(this.want.people * (1 - (1 - NIGHT_SHARE) * night) * (1 - (1 - WINTER_SHARE) * snow));
    const n = Math.min(shown, this.routes.length);
    const kinds = this.crowd.length;
    this.crowd.forEach((im, m) => (im.count = n > m ? Math.ceil((n - m) / kinds) : 0));
    // Фонарь — у каждого второго идущего, пока темно.
    const lamps = this.lanterns;
    const lampOn = lamps !== null && night > 0.3;
    let lit = 0;
    const lp = lamps ? (lamps.geometry.attributes.position as THREE.BufferAttribute) : null;
    for (let k = 0; k < n; k++) {
      const im = this.crowd[k % kinds];
      const i = Math.floor(k / kinds);
      const pg = this.crowdGait[k % kinds].array as Float32Array;
      const r = this.routes[k];
      const vis = this.visits[k];
      if (vis) {
        const p = visitAt(vis, t);
        // В храме фигуры нет: она стоит за порогом в нулевом масштабе.
        this.place(im, i, p.x, p.y + p.moving * (1 - Math.cos(p.dist * 8.976)) * 0.018, p.z, p.yaw, p.hidden ? 0 : 1);
        pg[i * 2] = p.dist;
        pg[i * 2 + 1] = p.moving;
      } else if (r) {
        const p = poseAt(this.paths, r, t);
        // Шаг: лёгкое подпрыгивание в такт ног — дважды за шаг, мягко.
        this.place(im, i, p.x, p.y + (1 - Math.cos(p.dist * 8.976)) * 0.018, p.z, p.yaw, 1);
        pg[i * 2] = p.dist;
        pg[i * 2 + 1] = 1;
        if (lampOn && lp && lit < lp.count && hash3(k, 13, 97) % 2 === 0) {
          const v = this.v3.set(0.12, 0.92, 0.3).applyMatrix4(this.m4);
          lp.setXYZ(lit++, v.x, v.y, v.z);
        }
      } else {
        const w = this.idle[k]!;
        this.place(im, i, w.x, w.y + Math.abs(Math.sin(t * 1.3 + k)) * 0.02, w.z, w.yaw + Math.sin(t * 0.3 + k) * 0.25, 1);
        pg[i * 2] = 0;
        pg[i * 2 + 1] = 0;
      }
    }
    for (const im of this.crowd) im.instanceMatrix.needsUpdate = true;
    for (const g of this.crowdGait) g.needsUpdate = true;
    if (lamps && lp) {
      const lm = lamps.material as THREE.PointsMaterial;
      lamps.visible = lit > 0;
      lm.opacity = Math.min(1, (night - 0.3) * 2.5);
      lm.size = 1.7 * (1 + Math.sin(t * 9) * 0.06);
      lamps.geometry.setDrawRange(0, lit);
      lp.needsUpdate = lit > 0;
    }
    // Лучники: по всем сторонам стены поровну, у каждого свой отрезок между башнями — туда и обратно, на концах
    // стоит, смотрит со стены. Сквозь башни не ходит.
    const c = Math.min(this.want.guards, this.cap.guards);
    this.sentries.count = c;
    const L = this.wall.len;
    const gg = this.guardGait.array as Float32Array;
    for (let i = 0; i < c; i++) {
      const home = ((i + 0.5 + rnd(i, 1, 79) * 0.3) / c) * L;
      const beat = this.beatOf(home);
      const g = patrolAt(t, 0.7, beat.reach, 4 + rnd(i, 2, 79) * 5, rnd(i, 3, 79));
      const s = (((beat.mid + g.s) % L) + L) % L;
      const a = at(this.wall, s);
      const yaw = Math.atan2(-a.tz * g.dir, a.tx * g.dir);
      this.place(this.sentries, i, a.p.x, heightOnPath(this.wall, s), a.p.z, yaw, 1);
      gg[i * 2] = g.dist;
      gg[i * 2 + 1] = g.moving;
    }
    this.sentries.instanceMatrix.needsUpdate = true;
    this.guardGait.needsUpdate = true;
    // Факел — над правым плечом лучника и у копья копейщика, мерцает; ночью виден, днём погашен.
    const tm = this.torches.material as THREE.PointsMaterial;
    tm.opacity = night;
    const posts = this.gateGuards.count;
    this.torches.visible = night > 0.02 && c + posts > 0;
    if (this.torches.visible) {
      const tp = this.torches.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < c; i++) {
        this.sentries.getMatrixAt(i, this.m4);
        const v = this.v3.set(0.15, 2.05, 0.32).applyMatrix4(this.m4);
        tp.setXYZ(i, v.x, v.y, v.z);
      }
      for (let i = 0; i < posts; i++) {
        this.gateGuards.getMatrixAt(i, this.m4);
        const v = this.v3.set(0.2, 1.95, 0.42).applyMatrix4(this.m4);
        tp.setXYZ(c + i, v.x, v.y, v.z);
      }
      tp.needsUpdate = true;
      this.torches.geometry.setDrawRange(0, c + posts);
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

  /** Отрезок дозора между башнями, в котором дом лучника: середина и полудлина (не больше 22 м). */
  private beatOf(home: number): { mid: number; reach: number } {
    const st = this.beatStops;
    const L = this.wall.len;
    const m = st.length;
    if (m === 0) return { mid: home, reach: 22 };
    let j = -1;
    for (let k = 0; k < m; k++) if (st[k].s <= home) j = k;
    // Башня до дома и башня после — по кругу хода.
    const a = j === -1 ? { s: st[m - 1].s - L, half: st[m - 1].half } : st[j];
    const b = j === -1 ? st[0] : j + 1 < m ? st[j + 1] : { s: st[0].s + L, half: st[0].half };
    const from = a.s + a.half;
    const to = b.s - b.half;
    return { mid: (from + to) / 2, reach: Math.max(0.3, Math.min(22, (to - from) / 2)) };
  }

  /**
   * Стража — бойцами роликов (`city/garrison.ts`, docs/polish.md, П-5): здесь остаются места и дозор, а рисует их толпа
   * роликов, когда её кусок приехал. До того — прежние фигуры стражи; после — гаснут (факелы остаются здесь).
   */
  hideGuards(): void {
    this.sentries.visible = false;
    this.gateGuards.visible = false;
  }

  /**
   * Где стоит стража в этом кадре: лучники на стене, потом копейщики у ворот. Разворот — как у фигур города (лицом на +x
   * при нуле), `moving` — идёт ли дозорный. Возвращает, сколько записано; `wall` — сколько из них на стене.
   */
  guardsInto(out: GuardSpots): { count: number; wall: number } {
    const wall = this.sentries.count;
    const gate = this.gateGuards.count;
    const gait = this.guardGait.array as Float32Array;
    let n = 0;
    const put = (im: THREE.InstancedMesh, i: number, moving: number): void => {
      if (n >= out.x.length) return;
      im.getMatrixAt(i, this.m4);
      const e = this.m4.elements;
      out.x[n] = e[12];
      out.y[n] = e[13];
      out.z[n] = e[14];
      out.yaw[n] = Math.atan2(-e[2], e[0]);
      out.moving[n] = moving;
      n++;
    };
    for (let i = 0; i < wall; i++) put(this.sentries, i, gait[i * 2 + 1] > 0.5 ? 1 : 0);
    for (let i = 0; i < gate; i++) put(this.gateGuards, i, 0);
    return { count: n, wall };
  }

  /** Сколько мест стражи может понадобиться: лучники на стене и посты у ворот. */
  get guardCap(): { wall: number; gate: number } {
    return { wall: this.cap.guards, gate: this.gatePosts.length };
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
    (this.crowd[0].material as THREE.Material).dispose();
    (this.flags.material as THREE.Material).dispose();
    (this.birds.material as THREE.Material).dispose();
  }
}
