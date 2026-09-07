// Low-poly модели зданий: три визуальные ступени по уровню.
// Стиль один на всю игру — позднее средневековье: штукатурка, черепица, фахверк.
import * as THREE from 'three';
import type { BuildingTypeId } from '@/game/types';
import { VISUAL_TIERS } from '@/game/constants';
import { MAT as T } from './terrain';
import { GATE_ANGLE, WALL_RADIUS } from './plan';
import { LEGACY, type MatKey } from './materials';
import * as K from './kit';
import { PALETTE } from './palette';

/** Визуальная ступень: 0 — уровни 1–3, 1 — 4–7, 2 — 8–10. */
export type Tier = 0 | 1 | 2;

/** Уровень, с которого начинается каждая ступень. */
export const TIER_START: [number, number, number] = [1, VISUAL_TIERS[0], VISUAL_TIERS[1]];

export const visualTier = (level: number): Tier =>
  level >= VISUAL_TIERS[1] ? 2 : level >= VISUAL_TIERS[0] ? 1 : 0;

/**
 * Плавный рост внутри ступени: постройка подрастает с каждым уровнем, а на пороге
 * ступени меняется целиком. Так уровень виден и между сменами модели.
 */
export const levelScale = (level: number): number =>
  1 + 0.045 * Math.max(0, level - TIER_START[visualTier(Math.max(1, level))]);

/** Материалы старых моделей — из общего набора; цвета в palette.ts. */
export const M = LEGACY;

/**
 * Из чего сложена постройка. Стиль один — позднее средневековье: штукатурка,
 * черепица, каменный цоколь, фахверк по стенам. Таблица хранит имена цветов
 * палитры, а не материалы: старые модели берут из неё LEGACY-материалы (STYLE),
 * набор деталей — KIT (stylePaint), и обе стороны читают одни и те же имена.
 */
export interface Roles {
  /** Стены и корпус. */
  wall: MatKey;
  /** Кровля. */
  roof: MatKey;
  /** Конёк, навесы, тень кровли. */
  roofDark: MatKey;
  /** Столбы, каркас, ограды. */
  post: MatKey;
  /** Отделка: краска, металл, золото. */
  accent: MatKey;
  /** Настил и основание. */
  floor: MatKey;
  /** Цоколь — каменное основание под стеной. */
  base: MatKey;
  /** Балки фахверка и косяки. */
  beam: MatKey;
}

export const ROLES: Roles = {
  wall: 'plaster',
  roof: 'tile',
  roofDark: 'stoneDark',
  post: 'stone',
  accent: 'gold',
  floor: 'stone',
  base: 'stone',
  beam: 'timber',
};

/**
 * Какие детали набора есть у построек. Здание описывает объёмы («круглая стена,
 * крыша-конус, дверь на фасаде»), а какой именно конус, есть ли цоколь и труба —
 * решает эта таблица, одна на все модели.
 */
export interface Features {
  /** Кровля: черепица. */
  roof: K.RoofKind;
  /** Цоколь под стеной. */
  plinth: boolean;
  /** Что над очагом: каменная труба. */
  chimney: 'none' | 'hood' | 'clay' | 'stone';
  /** Перемычка над дверью. */
  lintel: 'wood' | 'stone';
  /** Окна — только на широких стенах, иначе на телефоне это шум. */
  windows: boolean;
  /** Балки фахверка по стенам. */
  fachwerk: boolean;
  /** Ограда: плетень или жерди на столбах. */
  fence: 'wattle' | 'rail';
  /** Крутизна крыши: высота конуса к его радиусу. Черепица положе соломы. */
  pitch: number;
}

export const FEATURES: Features = {
  roof: 'tile',
  plinth: true,
  chimney: 'stone',
  lintel: 'stone',
  windows: true,
  fachwerk: true,
  fence: 'rail',
  pitch: 0.72,
};

export type Style = Record<keyof Roles, THREE.Material>;

const styleFrom = (set: Record<MatKey, THREE.Material>, roles: Roles): Style =>
  Object.fromEntries(Object.entries(roles).map(([role, key]) => [role, set[key as MatKey]])) as Style;

/** Материалы для старых моделей. */
export const STYLE: Style = styleFrom(LEGACY, ROLES);

/** Краски для набора деталей: по роли — краска (см. kit.paintOf). */
export type Paint = Record<keyof Roles, K.Paint> & { roofPaint: K.RoofPaint; ink: K.Paint; features: Features };

let paintCache: Paint | null = null;

export function stylePaint(): Paint {
  if (paintCache) return paintCache;
  const f = FEATURES;
  const p = Object.fromEntries(
    Object.entries(ROLES).map(([role, key]) => [role, K.paintOf(key as MatKey)]),
  ) as Record<keyof Roles, K.Paint>;
  const hard = f.roof === 'shingle' || f.roof === 'tile';
  paintCache = {
    ...p,
    roofPaint: { kind: f.roof, roof: p.roof, roofDark: p.roofDark, trim: hard ? p.accent : p.beam },
    ink: K.paintOf('dark'),
    features: f,
  };
  return paintCache;
}

const shadow = (m: THREE.Mesh): THREE.Mesh => {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

const box = (w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
  const m = shadow(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
  m.position.set(x, y, z);
  return m;
};

const cyl = (rt: number, rb: number, h: number, mat: THREE.Material, seg = 8, x = 0, y = 0, z = 0): THREE.Mesh => {
  const m = shadow(new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat));
  m.position.set(x, y, z);
  return m;
};

const cone = (r: number, h: number, mat: THREE.Material, seg = 8, x = 0, y = 0, z = 0): THREE.Mesh => {
  const m = shadow(new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat));
  m.position.set(x, y, z);
  return m;
};

function pad(radius: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.06, 12), T.dirt);
  m.position.y = 0.03;
  m.receiveShadow = true;
  return m;
}

/** Четыре столба с обвязкой: остов навеса, копра, рамы пилы. */
function frame(g: THREE.Group, w: number, d: number, h: number, mat: THREE.Material = M.woodDark): void {
  const hw = w / 2;
  const hd = d / 2;
  for (const [x, z] of [
    [-hw, -hd],
    [hw, -hd],
    [-hw, hd],
    [hw, hd],
  ]) {
    g.add(cyl(0.06, 0.07, h, mat, 5, x, h / 2, z));
  }
  g.add(box(w, 0.08, 0.08, mat, 0, h, -hd));
  g.add(box(w, 0.08, 0.08, mat, 0, h, hd));
  g.add(box(0.08, 0.08, d, mat, -hw, h, 0));
  g.add(box(0.08, 0.08, d, mat, hw, h, 0));
}

/** Двускатная кровля из двух наклонных плит — читается как настоящая крыша. */
function gable(
  g: THREE.Group,
  w: number,
  d: number,
  y: number,
  rise: number,
  mat: THREE.Material,
  x = 0,
  z = 0,
): void {
  for (const s of [-1, 1]) {
    const half = box(w, 0.09, d * 0.62, mat, x, y + rise * 0.5, z + (s * d) / 4);
    half.rotation.x = s * -0.5;
    g.add(half);
  }
}

/** Ограда по периметру: столбы и две жерди. */
function fence(g: THREE.Group, s: number, h: number, mat: THREE.Material): void {
  const step = s / 2;
  for (let x = -s; x <= s + 0.01; x += step) {
    g.add(cyl(0.05, 0.06, h, mat, 5, x, h / 2, -s));
    g.add(cyl(0.05, 0.06, h, mat, 5, x, h / 2, s));
  }
  for (let z = -s + step; z <= s - step + 0.01; z += step) {
    g.add(cyl(0.05, 0.06, h, mat, 5, -s, h / 2, z));
    g.add(cyl(0.05, 0.06, h, mat, 5, s, h / 2, z));
  }
  for (const y of [h * 0.45, h * 0.85]) {
    g.add(box(2 * s, 0.05, 0.05, mat, 0, y, -s), box(2 * s, 0.05, 0.05, mat, 0, y, s));
    g.add(box(0.05, 0.05, 2 * s, mat, -s, y, 0), box(0.05, 0.05, 2 * s, mat, s, y, 0));
  }
}

function goat(x: number, z: number, rot: number): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.5, 0.3, 0.25, M.goat, 0, 0.35, 0));
  g.add(box(0.2, 0.2, 0.18, M.goat, 0.3, 0.5, 0));
  g.position.set(x, 0, z);
  g.rotation.y = rot;
  return g;
}

// ---------- Стартовые постройки: одна ступень на всю партию ----------

function campfire(st: Style): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const s = shadow(new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), M.stoneDark));
    s.position.set(Math.cos(a) * 0.55, 0.1, Math.sin(a) * 0.55);
    g.add(s);
  }
  for (let i = 0; i < 3; i++) {
    const l = cyl(0.07, 0.07, 0.8, M.woodDark, 5, 0, 0.12, 0);
    l.rotation.z = Math.PI / 2;
    l.rotation.y = (i / 3) * Math.PI;
    g.add(l);
  }
  // Каменный обод вокруг очага: площадь мощёная.
  g.add(cyl(1.05, 1.05, 0.12, st.floor, 12, 0, 0.06, 0));
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 6), M.fire);
  flame.position.y = 0.5;
  flame.name = 'flame';
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 6), M.fireInner);
  inner.position.y = 0.4;
  inner.name = 'flameInner';
  g.add(flame, inner);
  return g;
}


// ---------- Здания: три ступени на каждое ----------

/** Ставит готовый набор деталей на новое место: сосед по улице, а не второй меш. */
function shiftParts(parts: K.Part[], x: number, z: number, rotY: number, scale: number): K.Part[] {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, 0, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)),
    new THREE.Vector3(scale, scale, scale),
  );
  for (const p of parts) p.geo.applyMatrix4(m);
  return parts;
}

/** Жилой двор: отдельные фронтоны и трубы вместо круглых кровель. */
function residentialParts(t: Tier): K.Part[] {
  const p = stylePaint();
  const parts: K.Part[] = [];
  const home = (x: number, z: number, w: number, d: number, h: number, upper: number, rot = 0): void => {
    const a: K.Part[] = [];
    const y0 = 0.16;
    const uw = w + (upper ? 0.18 : 0);
    const ud = d + (upper ? 0.12 : 0);
    const eave = y0 + h + upper;
    const rise = uw * 0.67;
    a.push(K.plinth(w, d, p.base));
    a.push(K.box(w, h, d, p.wall, 0, y0 + h / 2, 0));
    if (upper) {
      a.push(K.wallGable(uw, upper, ud, rise, p.wall, 0, 0, undefined, y0 + h));
      a.push(K.box(uw + 0.06, 0.13, ud + 0.06, p.beam, 0, y0 + h, 0));
      for (const sx of [-1, 1]) a.push(K.box(0.1, 0.28, 0.17, p.beam, sx * w * 0.34, y0 + h - 0.13, d / 2));
    } else a.push(K.wallGable(w, 0.04, d, rise, p.wall, 0, 0, undefined, eave - 0.04));
    a.push(...K.roofGable(uw, ud, rise, eave, p.roofPaint, 0.12));
    // Широкие балки и ставни сохраняют рисунок на игровом масштабе.
    for (const side of [-1, 1]) {
      const fz = side * (ud / 2 + 0.025);
      a.push(K.box(uw, 0.085, 0.075, p.beam, 0, eave - 0.04, fz));
      for (const sx of [-1, 1]) a.push(K.box(0.085, h + upper, 0.075, p.beam, sx * (uw / 2 - 0.045), y0 + (h + upper) / 2, fz));
      a.push(K.box(0.075, rise, 0.075, p.beam, 0, eave + rise / 2, fz));
      if (upper) {
        for (const sx of [-1, 1]) {
          a.push(K.box(0.22, 0.32, 0.045, p.ink, sx * uw * 0.25, y0 + h + upper * 0.53, fz + side * 0.035));
          a.push(K.box(0.10, 0.34, 0.045, p.post, sx * uw * 0.25 + 0.15, y0 + h + upper * 0.53, fz + side * 0.05));
        }
      }
    }
    for (const sx of [-1, 1]) {
      a.push(K.box(0.075, 0.09, d, p.beam, sx * (w / 2 + 0.02), y0 + h * 0.48, 0));
      a.push(K.box(0.05, 0.3, 0.24, p.ink, sx * (w / 2 + 0.025), y0 + h * 0.66, -d * 0.18));
      a.push(K.box(0.07, 0.3, 0.1, p.post, sx * (w / 2 + 0.04), y0 + h * 0.66, -d * 0.18 + 0.18));
    }
    a.push(...K.door(0.3, h * 0.72, p.ink, p.beam, -w * 0.18, d / 2 + 0.03));
    a.push(K.stepStone(0.43, p.base, -w * 0.18, d / 2 + 0.13));
    a.push(K.box(0.075, Math.hypot(uw * 0.32, rise * 0.7), 0.08, p.beam, uw * 0.16, eave + rise * 0.35, ud / 2 + 0.03, { z: Math.atan2(uw * 0.32, rise * 0.7) }));
    a.push(...K.chimney(0.22, rise * 0.7 + 0.32, p.base, p.base, -uw * 0.24, eave + rise * 0.3, -ud * 0.23));
    parts.push(...shiftParts(a, x, z, rot, 1));
  };
  if (t === 2) {
    home(-0.98, 0.65, 1.2, 1.55, 1.05, 1.04);
    home(1.05, 0.65, 0.9, 1.4, 0.9, 0.5);
    home(-0.98, -1.3, 1.05, 1.05, 0.9, 0);
    home(0.65, -1.25, 1.1, 1.05, 0.95, 0.24, Math.PI / 2);
  } else {
    home(-0.8, 0.45, 1.2, 1.55, 0.95, t === 1 ? 0.68 : 0);
    home(0.95, -0.1, 0.85, 1.25, 0.75, 0, -0.12);
    if (t === 1) home(-0.1, -1.2, 1.1, 0.85, 0.85, 0, Math.PI / 2);
  }
  return shiftParts(parts, 0, 0, 0, [0.65, 1, 0.98][t]);
}

function houses(t: Tier): THREE.Group {
  const g = new THREE.Group();
  g.add(K.assemble(residentialParts(t)));
  return g;
}

/** Склад: амбар на сваях → амбар с пристройкой и бочками → длинный лабаз. */
/** Груз на высоком настиле — общий знак склада на всех ступенях. */
function tradeBarrel(x: number, y: number, z: number): K.Part[] {
  const wood = K.paintOf('wood'); const band = K.paintOf('woodDark');
  return [K.cyl(0.19, 0.22, 0.4, wood, 8, x, y + 0.2, z),
    K.cyl(0.205, 0.22, 0.055, band, 8, x, y + 0.08, z),
    K.cyl(0.2, 0.21, 0.055, band, 8, x, y + 0.32, z)];
}

function storage(t: Tier): THREE.Group {
  if (t >= 1) return storageDepot(t);
  const p = { ...stylePaint(), post: K.paintOf('woodDark'), floor: K.paintOf('plank'), wall: K.paintOf('stone') };
  const a: K.Part[] = [K.box(2.15, 0.3, 1.65, p.base, 0, 0.15, 0)];
  for (const x of [-0.94, 0.94]) for (const z of [-0.68, 0.68])
    a.push(K.box(0.14, 1.45, 0.14, p.post, x, 1.02, z));
  a.push(K.box(2.1, 0.14, 0.14, p.beam, 0, 1.66, 0.68));
  a.push(...K.roofGable(2.12, 1.55, 0.35, 1.72, p.roofPaint, 0.12));
  for (const x of [-0.62, -0.12, 0.38]) a.push(...tradeBarrel(x, 0.3, -0.25));
  a.push(...tradeBarrel(-0.62, 0.3, 0.28));
  a.push(K.box(0.46, 0.42, 0.46, p.floor, 0.55, 0.51, 0.42));
  a.push(K.box(0.85, 0.12, 0.4, p.base, 0, 0.06, 1.02));
  return new THREE.Group().add(K.assemble(a));
}

function storageDepot(t: Tier): THREE.Group {
  const p = { ...stylePaint(), post: K.paintOf('woodDark'), floor: K.paintOf('plank'), wall: K.paintOf('stone') };
  const w = t === 2 ? 3.05 : 2.65, d = 1.75, h = t === 2 ? 2.25 : 1.85;
  const a: K.Part[] = [K.box(w + 0.2, 0.34, d + 0.7, p.base, 0, 0.17, 0.2),
    K.box(w, h, d, t === 2 ? p.wall : p.floor, 0, 0.34 + h / 2, -0.15)];
  a.push(...K.roofGable(w, d, 0.65, h + 0.34, p.roofPaint, 0.17, 0, -0.15));
  for (const x of [-w / 2, 0, w / 2]) a.push(K.box(0.13, h, 0.1, p.beam, x, 0.34 + h / 2, 0.75));
  a.push(K.box(w, 0.12, 0.1, p.beam, 0, 1.5, 0.77));
  a.push(K.box(1.15, 1.4, 0.08, p.ink, 0, 1.04, 0.78));
  for (const x of [-0.3, 0.3]) {
    a.push(K.box(0.54, 1.32, 0.08, p.post, x, 1.02, 0.85));
    a.push(K.box(0.54, 0.07, 0.05, p.floor, x, 0.7, 0.91));
    a.push(K.box(0.54, 0.07, 0.05, p.floor, x, 1.37, 0.91));
  }
  a.push(K.box(1.25, 0.15, 0.35, p.base, 0, 0.075, 1.4));
  for (const z of [-0.5, 0.04, 0.58]) a.push(...tradeBarrel(-1.75, 0, z));
  for (const [x,y] of [[0.92,0.34],[1.39,0.34],[1.15,0.78]])
    a.push(K.box(0.43, 0.42, 0.43, p.floor, x, y + 0.21, 1.02));
  if (t === 2) {
    // Верхний грузовой люк и вынесенная балка отличают лабаз от жилья.
    a.push(K.box(0.65, 0.55, 0.08, p.ink, 0, 2.26, 0.78));
    a.push(K.box(0.75, 0.1, 0.23, p.floor, 0, 1.98, 0.89));
    a.push(K.box(0.16, 0.18, 1.35, p.beam, 0, 2.64, 1.04));
    a.push(K.cyl(0.14, 0.14, 0.1, K.paintOf('metal'), 8, 0, 2.58, 1.53, {z: Math.PI / 2}));
    a.push(K.box(0.035, 1.3, 0.035, p.post, 0, 1.9, 1.53));
    a.push(K.box(0.46, 0.43, 0.46, p.floor, 0, 1.07, 1.53));
    for (const x of [-w / 2, w / 2]) for (const y of [0.55, 1.05, 1.55, 2.05])
      a.push(K.box(0.25, 0.2, 0.14, p.base, x, y, 0.79));
    a.push(K.box(1.05, 0.13, 1.45, p.floor, 2.02, 0.38, -0.15));
    for (const z of [-0.57, 0.08]) a.push(...tradeBarrel(2.02, 0.45, z));
  }
  return new THREE.Group().add(K.assemble(a));
}

/** Навес собирателей: один навес → навес с сушилами → торговые ряды. */
function gathering(t: Tier, st: Style): THREE.Group {
  const g = new THREE.Group();
  const bays = t + 1;
  for (let b = 0; b < bays; b++) {
    const z = -0.7 * b;
    g.add(cyl(0.06, 0.06, 1.2, st.post, 5, -0.6 - b * 0.2, 0.6, z));
    g.add(cyl(0.06, 0.06, 1.2, st.post, 5, 0.6 + b * 0.2, 0.6, z));
    g.add(box(1.4 + b * 0.4, 0.07, 0.07, st.post, 0, 1.15, z));
    const awn = box(1.5 + b * 0.4, 0.06, 0.9, b === 0 ? st.roof : st.roofDark, 0, 1.2, z - 0.1);
    awn.rotation.x = 0.2;
    g.add(awn);
  }
  for (let i = 0; i < 3 + t * 2; i++) {
    g.add(cyl(0.22, 0.16, 0.3, st.roof, 7, -0.7 + (i % 4) * 0.48, 0.15, 0.55 - Math.floor(i / 4) * 0.45));
  }
  if (t >= 1) {
    // Стол и корзины на нём: место становится похоже на лавку.
    g.add(box(1.5, 0.08, 0.6, st.wall, 0, 0.6, 0.7));
    for (const x of [-0.6, 0.6]) g.add(cyl(0.05, 0.05, 0.6, st.post, 4, x, 0.3, 0.7));
  }
  if (t === 2) {
    for (let i = 0; i < 4; i++) g.add(box(0.28, 0.4, 0.06, st.accent, -0.85 + i * 0.55, 1.45, -1.45));
  }
  return g;
}

/** Ресурсные дворы имеют одну постоянную модель на всех уровнях. */
function sawmill(): THREE.Group {
  const wood = K.paintOf('woodDark'), cut = K.paintOf('cut'), metal = K.paintOf('metal');
  const a: K.Part[] = [];
  // Длинное бревно на двух козлах, ручная рамная пила вместо современного диска.
  for (const x of [-0.63, 0.63]) {
    for (const side of [-1, 1]) a.push(K.box(0.13, 0.7, 0.13, wood, x, 0.34, 0.48 + side * 0.23, {x: side * 0.42}));
    a.push(K.box(0.17, 0.12, 0.8, wood, x, 0.65, 0.48));
  }
  a.push(K.cyl(0.21, 0.24, 2.1, K.paintOf('wood'), 8, 0, 0.86, 0.48, {z: Math.PI / 2}));
  a.push(K.cyl(0.195, 0.195, 0.025, cut, 8, -1.06, 0.86, 0.48, {z: Math.PI / 2}));
  for (const x of [-0.18, 0.64]) a.push(K.box(0.09, 0.94, 0.09, wood, x, 1.02, 0.52));
  a.push(K.box(0.88, 0.08, 0.08, wood, 0.23, 1.48, 0.52));
  a.push(K.box(0.79, 0.11, 0.025, metal, 0.23, 0.8, 0.52));
  for (let i = 0; i < 7; i++) a.push(K.cone(0.042, 0.065, metal, 3, -0.1 + i * 0.105, 0.72, 0.52, {z: Math.PI}));
  // Штабель параллелен рабочему бревну; светлые торцы показывают материал.
  for (const [y,z] of [[0.2,-0.7],[0.2,-1.13],[0.55,-0.91]]) {
    a.push(K.cyl(0.2, 0.22, 1.9, wood, 7, 0.05, y, z, {z: Math.PI / 2}));
    a.push(K.cyl(0.185, 0.185, 0.025, cut, 7, 1.01, y, z, {z: Math.PI / 2}));
  }
  for (const [x,z,r] of [[-0.4,0.65,0.45],[0.5,0.85,0.34],[-0.8,0.02,0.26]])
    a.push(K.cyl(r, r * 1.18, 0.05, cut, 7, x, 0.025, z));
  a.push(K.box(1.25, 0.13, 0.25, K.paintOf('plank'), 0, 0.07, -0.25));
  return new THREE.Group().add(K.assemble(a));
}

/** Каменоломня: уступы → выработка с воротом → большой карьер с краном. */
function quarry(t: Tier, st: Style): THREE.Group {
  const g = new THREE.Group();
  const s = [1.0, 1.25, 1.55][t];
  g.add(pad(1.6 * s));
  g.add(box(2.0 * s, 0.3, 1.7 * s, M.stone, 0, 0.15, 0));
  g.add(box(1.4 * s, 0.3, 1.2 * s, M.stone, -0.25, 0.45, -0.15));
  g.add(box(0.8 * s, 0.3, 0.8 * s, M.stoneDark, -0.5, 0.75, -0.25));
  for (let i = 0; i < 3 + t * 2; i++) {
    const r = shadow(new THREE.Mesh(new THREE.DodecahedronGeometry(0.22, 0), M.stoneDark));
    r.position.set(0.6 * s + (i % 3) * 0.3, 0.4, 0.5 * s - Math.floor(i / 3) * 0.5);
    r.rotation.set(i, i * 2, 0);
    g.add(r);
  }
  if (t === 0) {
    const handle = cyl(0.04, 0.04, 1.0, st.post, 4, 0.85, 0.55, 0.75);
    handle.rotation.z = 0.45;
    g.add(handle);
    g.add(box(0.5, 0.09, 0.09, M.metal, 0.63, 1.0, 0.75));
  } else {
    // Ворот с укосиной: тёсаные блоки поднимают, а не таскают.
    const h = t === 1 ? 2.2 : 3.2;
    g.add(cyl(0.11, 0.13, h, st.post, 6, 0.9 * s, h / 2, 0.8 * s));
    const boom = cyl(0.08, 0.08, h * 0.8, st.post, 5, 0.9 * s - h * 0.28, h * 0.9, 0.8 * s);
    boom.rotation.z = 1.15;
    g.add(boom);
    g.add(box(0.05, h * 0.45, 0.05, M.metal, 0.9 * s - h * 0.55, h * 0.72, 0.8 * s));
    g.add(box(0.42, 0.42, 0.42, M.stone, 0.9 * s - h * 0.55, 0.21, 0.8 * s));
    if (t === 2) for (let i = 0; i < 4; i++) g.add(box(0.5, 0.32, 0.5, M.stone, -1.5, 0.16 + (i % 2) * 0.32, -1.0 + Math.floor(i / 2) * 0.6));
  }
  return g;
}

/** Охотничий домик: изба со шкурами → двор с сушилами → длинная промысловая изба. */
function hunterHut(t: Tier, st: Style): THREE.Group {
  const g = new THREE.Group();
  const r = [0.7, 0.9, 1.15][t];
  g.add(pad(1.4 + t * 0.35));
  if (t < 2) {
    g.add(cyl(r, r * 1.1, 0.8 + t * 0.25, st.wall, 7, 0, (0.8 + t * 0.25) / 2, 0));
    g.add(cone(r * 1.5, 0.85 + t * 0.25, M.hide, 7, 0, 0.95 + t * 0.4, 0));
  } else {
    // Промысловая изба: длинный сруб под шкурной кровлей.
    g.add(box(2.4, 1.1, 1.5, st.wall, 0, 0.55, 0));
    gable(g, 2.7, 1.9, 1.1, 0.42, M.hide);
  }
  g.add(box(0.35, 0.55, 0.1, M.dark, 0, 0.27, (t < 2 ? r * 1.08 : 0.78)));
  // Сушила: стойки, перекладина и растянутые шкуры.
  for (let b = 0; b <= t; b++) {
    const z = 0.75 + b * 0.55;
    g.add(cyl(0.05, 0.06, 1.1, st.post, 5, -1.1, 0.55, z));
    g.add(cyl(0.05, 0.06, 1.1, st.post, 5, 0.3, 0.55, z));
    g.add(box(1.5, 0.06, 0.06, st.post, -0.4, 1.05, z));
    g.add(box(0.45, 0.55, 0.04, M.hide, -0.85, 0.75, z));
    g.add(box(0.45, 0.45, 0.04, M.hide, -0.1, 0.8, z));
  }
  const spear = cyl(0.03, 0.03, 1.2, st.post, 4, 0.95, 0.6, -0.35);
  spear.rotation.z = -0.3;
  g.add(spear);
  if (t === 2) {
    // Рога над входом: трофеи вместо вывески.
    for (const sx of [-1, 1]) {
      const horn = cyl(0.04, 0.05, 0.7, M.bone, 4, sx * 0.22, 1.65, 0.6);
      horn.rotation.z = sx * 0.6;
      g.add(horn);
    }
  }
  return g;
}

/** Рудник: штольня → штольня с копром → копёр с колесом и отвалами. */
function mine(t: Tier, st: Style): THREE.Group {
  const g = new THREE.Group();
  const s = [1.0, 1.2, 1.45][t];
  g.add(pad(1.7 * s));
  g.add(cone(1.7 * s, 1.5 * s, M.stoneDark, 6, 0, 0.75 * s, -0.35));
  g.add(box(1.0, 1.0, 0.4, M.dark, 0, 0.5, 0.55));
  g.add(cyl(0.09, 0.1, 1.1, st.post, 5, -0.55, 0.55, 0.7));
  g.add(cyl(0.09, 0.1, 1.1, st.post, 5, 0.55, 0.55, 0.7));
  g.add(box(1.35, 0.12, 0.14, st.post, 0, 1.15, 0.7));
  g.add(box(0.55, 0.35, 0.7, st.wall, 1.05 * s, 0.28, 0.95));
  for (let i = 0; i < 3 + t * 2; i++) {
    const lump = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), M.ore));
    lump.position.set(0.9 * s + (i % 3) * 0.25, 0.5, 0.8 + Math.floor(i / 3) * 0.25);
    g.add(lump);
  }
  if (t >= 1) {
    // Копёр над стволом: рудник виден издалека.
    const h = t === 1 ? 2.6 : 3.6;
    frame(g, 1.3, 1.1, h, st.post);
    g.add(box(1.5, 0.1, 1.3, st.roofDark, 0, h + 0.08, 0));
    if (t === 2) {
      const wheel = cyl(0.55, 0.55, 0.12, st.accent, 10, 0, h + 0.5, 0);
      wheel.rotation.x = Math.PI / 2;
      g.add(wheel);
      // Рельсы и вагонетка.
      for (const x of [-0.18, 0.18]) g.add(box(0.06, 0.05, 2.4, M.metal, x, 0.05, 1.6));
      g.add(box(0.6, 0.4, 0.7, st.accent, 0, 0.35, 2.1));
    }
  }
  return g;
}

/** Мастерская: открытый навес → закрытая мастерская → ремесленный двор. */
function workshop(t: Tier, st: Style): THREE.Group {
  const g = new THREE.Group();
  const w = [1.8, 2.2, 2.8][t];
  const d = [1.6, 1.9, 2.2][t];
  const h = [1.2, 1.5, 1.8][t];
  if (t === 0) {
    frame(g, w, d, h, st.post);
    const roof = box(w * 1.2, 0.08, d * 1.2, st.roofDark, 0, h + 0.1, 0);
    roof.rotation.x = 0.12;
    g.add(roof);
  } else {
    g.add(box(w, h, d, st.wall, 0, h / 2, 0));
    gable(g, w * 1.15, d * 1.25, h, 0.3 + t * 0.1, st.roof);
    g.add(box(0.45, h * 0.6, 0.1, M.dark, 0, h * 0.3, d / 2 + 0.02));
  }
  g.add(box(0.9, 0.5, 0.5, st.wall, t === 0 ? 0 : w * 0.6 + 0.2, 0.25, t === 0 ? 0 : d * 0.2));
  g.add(cyl(0.25, 0.25, 0.4, st.post, 7, w * 0.35, 0.2, d * 0.5 + 0.25));
  if (t >= 1) {
    // Труба и стойка с инструментом.
    g.add(cyl(0.14, 0.17, 0.8, st.accent, 6, -w * 0.3, h + 0.55, -d * 0.25));
    for (let i = 0; i < 3; i++) g.add(box(0.05, 0.5, 0.05, M.metal, -w * 0.55 - 0.3 + i * 0.16, 0.55, d * 0.4));
  }
  if (t === 2) {
    g.add(box(w * 0.5, h * 0.55, d * 0.5, st.wall, -w * 0.7, h * 0.28, d * 0.35));
    g.add(box(w * 0.6, 0.09, d * 0.6, st.roofDark, -w * 0.7, h * 0.6, d * 0.35));
  }
  return g;
}

/** Ферма: одна полоса → поле с оградой и пугалом → большое поле с овином. */
function farm(t: Tier, st: Style): THREE.Group {
  const g = new THREE.Group();
  // Поле держится в своей площадке плана: широкая пашня вылезала за отведённое место.
  const s = [2.2, 2.7, 3.2][t];
  g.add(box(s, 0.1, s, M.soil, 0, 0.05, 0));
  const rows = 4 + t * 2;
  const cols = 5 + t * 2;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -s / 2 + 0.35 + (r * (s - 0.7)) / (rows - 1);
      const z = -s / 2 + 0.3 + (c * (s - 0.6)) / (cols - 1);
      g.add(cone(0.1, 0.3, M.sprout, 4, x, 0.25, z));
    }
  }
  if (t >= 1) {
    fence(g, s / 2 + 0.2, 0.6, st.post);
    // Пугало: поле обжитое, за ним следят.
    g.add(cyl(0.05, 0.05, 1.3, st.post, 4, s * 0.32, 0.65, -s * 0.32));
    g.add(box(0.8, 0.06, 0.06, st.post, s * 0.32, 1.05, -s * 0.32));
    g.add(cone(0.22, 0.3, st.roof, 6, s * 0.32, 1.4, -s * 0.32));
  }
  if (t === 2) {
    // Овин вплотную к полю: урожай есть где сушить, а площадка не растёт.
    g.add(box(1.2, 1.0, 1.0, st.wall, -s * 0.5 - 0.35, 0.5, 0));
    gable(g, 1.45, 1.25, 1.0, 0.28, st.roof, -s * 0.5 - 0.35, 0);
  }
  return g;
}

/** Загон: жердевая ограда → загон с навесом → скотный двор с хлевом. */
function pen(t: Tier, st: Style): THREE.Group {
  const g = new THREE.Group();
  const s = [1.3, 1.7, 2.05][t];
  fence(g, s, 0.7 + t * 0.1, st.post);
  const herd = 2 + t * 2;
  for (let i = 0; i < herd; i++) {
    const a = (i / herd) * Math.PI * 2 + 0.6;
    g.add(goat(Math.cos(a) * s * 0.5, Math.sin(a) * s * 0.5, a + 1.5));
  }
  if (t >= 1) {
    // Навес для скота: зимой стадо стоит под крышей.
    g.add(cyl(0.07, 0.08, 1.0, st.post, 5, -s * 0.75, 0.5, -s * 0.55));
    g.add(cyl(0.07, 0.08, 1.0, st.post, 5, -s * 0.15, 0.5, -s * 0.55));
    const roof = box(1.1, 0.07, 0.95, st.roof, -s * 0.45, 1.05, -s * 0.5);
    roof.rotation.x = 0.25;
    g.add(roof);
  }
  if (t === 2) {
    // Хлев: стадо зимует под настоящей крышей.
    g.add(box(1.7, 1.1, 1.3, st.wall, s * 0.55, 0.55, -s * 0.5));
    gable(g, 2.0, 1.6, 1.1, 0.34, st.roof, s * 0.55, -s * 0.5);
    // Колода с водой.
    g.add(box(1.0, 0.25, 0.4, st.post, 0, 0.13, s * 0.6));
  }
  return g;
}

/** Неф и западная колокольня растут вверх в пределах прежней площадки. */
function church(t: Tier): THREE.Group {
  const p = stylePaint();
  const stone = K.paintOf('stoneLight');
  const dark = K.paintOf('stoneDark');
  const a: K.Part[] = [];
  const w = [1.35, 1.6, 1.85][t];
  const d = [1.8, 2.15, 2.5][t];
  const h = [1.25, 1.7, 2.15][t];
  const rise = [0.7, 0.84, 0.95][t];
  const z = -0.35;
  const tw = [0.66, 0.9, 1.1][t];
  const tz = d / 2 - 0.2;
  const th = [2.25, 3.9, 6.15][t];
  const belfry = [0.55, 0.7, 0.85][t];
  a.push(K.plinth(w, d, dark, 0, z));
  a.push(K.wallGable(w, h, d, rise, stone, 0, z, undefined, 0.13));
  a.push(...K.roofGable(w, d, rise, h + 0.13, p.roofPaint, 0.12, 0, z));
  const opening = (width: number, spring: number, x: number, y: number, z: number, rot = 0): void => {
    a.push(K.arch(width - 0.1, spring, 0, 0.035, p.ink, x, y, z, { y: rot }));
    a.push(K.arch(width, spring, 0.085, 0.08, p.base, x, y - 0.025, z, { y: rot }));
  };
  for (const side of [-1, 1]) {
    opening(0.3, 0.4, side * (w / 2 + 0.025), 0.55, -0.45, side * Math.PI / 2);
    a.push(K.box(0.12, 0.13, d, dark, side * w / 2, 0.3, z));
  }
  if (t >= 1) {
    // Низкая гранёная апсида и контрфорсы выделяют церковь среди жилых домов.
    const az = z - d / 2 + 0.08;
    const ar = w * 0.37;
    a.push(K.cyl(ar, ar + 0.08, h * 0.75, stone, 8, 0, h * 0.375 + 0.08, az));
    a.push(K.cone(ar + 0.1, 0.52, p.roof, 8, 0, h * 0.75 + 0.34, az));
    for (const side of [-1, 1]) for (const bz of [-d * 0.48, d * 0.05]) {
      a.push(K.box(0.26, h * 0.8, 0.2, p.base, side * (w / 2 + 0.1), h * 0.4, bz));
      a.push(K.box(0.35, 0.2, 0.28, dark, side * (w / 2 + 0.1), 0.1, bz));
    }
    for (const y of [1.1, th - belfry - 0.7]) a.push(K.box(tw + 0.1, 0.12, tw + 0.1, p.base, 0, y, tz));
  }
  a.push(K.plinth(tw + 0.08, tw + 0.08, dark, 0, tz));
  a.push(K.wallBox(tw, th - belfry, tw, stone, 0, tz, 0.1));
  a.push(K.box(tw + 0.13, 0.13, tw + 0.13, dark, 0, th - belfry, tz));
  // Открытый ярус: четыре опоры, колокол и просветы вместо чёрных наклеек.
  for (const x of [-1, 1]) for (const dz of [-1, 1]) {
    a.push(K.box(0.12, belfry, 0.12, stone, x * (tw / 2 - 0.06), th - belfry / 2, tz + dz * (tw / 2 - 0.06)));
  }
  a.push(K.cyl(0.07, tw * 0.24, belfry * 0.46, p.accent, 8, 0, th - belfry * 0.52, tz));
  a.push(K.box(0.06, belfry * 0.3, 0.06, dark, 0, th - belfry * 0.25, tz));
  a.push(K.box(tw + 0.14, 0.14, tw + 0.14, p.base, 0, th + 0.04, tz));
  const spire = [0.65, 1.0, 1.5][t];
  a.push(K.cone((tw + 0.22) / Math.SQRT2, spire, p.roof, 4, 0, th + spire / 2 + 0.1, tz, { y: Math.PI / 4 }));
  const top = th + spire + 0.1;
  a.push(K.box(0.065, 0.46, 0.065, p.accent, 0, top + 0.18, tz));
  a.push(K.box(0.3, 0.065, 0.065, p.accent, 0, top + 0.28, tz));
  opening(tw * 0.72, 0.56, 0, 0.15, tz + tw / 2 + 0.03);
  if (t >= 1) opening(0.25, 0.65, 0, 1.5, tz + tw / 2 + 0.03);
  if (t === 2) {
    opening(0.3, 1.0, 0, 3.45, tz + tw / 2 + 0.03);
    for (const y of [3.1, 4.9]) a.push(K.box(tw + 0.1, 0.12, tw + 0.1, p.base, 0, y, tz));
    for (const side of [-1, 1]) {
      opening(0.32, 0.68, side * (w / 2 + 0.025), 0.72, 0.4, side * Math.PI / 2);
      opening(0.3, 1.0, side * (tw / 2 + 0.03), 3.45, tz, side * Math.PI / 2);
      a.push(K.arch(tw - 0.1, 0.22, 0.1, 0.14, stone, 0, th - belfry, tz + side * (tw / 2 - 0.06)));
      a.push(K.arch(tw - 0.1, 0.22, 0.1, 0.14, stone, side * (tw / 2 - 0.06), th - belfry, tz, { y: Math.PI / 2 }));
      for (const dz of [-1, 1]) a.push(K.box(0.14, th - belfry, 0.14, p.base,
        side * (tw / 2 - 0.025), (th - belfry) / 2, tz + dz * (tw / 2 - 0.025)));
    }
  }
  a.push(K.stepStone(tw * 0.85, p.base, 0, tz + tw / 2 + 0.17));
  const g = new THREE.Group();
  g.add(K.assemble(a));
  return g;
}

/** Башня: помост на сваях → рубленая вышка → каменная башня со стягом. */
function tower(t: Tier, st: Style): THREE.Group {
  const g = new THREE.Group();
  const h = [2.4, 3.2, 4.2][t];
  const w = [1.0, 1.2, 1.5][t];
  if (t >= 1) g.add(box(w * 1.4, 0.7 + t * 0.4, w * 1.4, st.wall, 0, (0.7 + t * 0.4) / 2, 0));
  const base = t >= 1 ? 0.7 + t * 0.4 : 0;
  const post = new THREE.Group();
  frame(post, w, w, h - base, st.post);
  post.position.y = base;
  g.add(post);
  g.add(box(w * 1.4, 0.1, w * 1.4, st.wall, 0, h + 0.05, 0));
  g.add(cone(w * 1.05, 0.7 + t * 0.2, st.roof, 4, 0, h + 0.45 + t * 0.1, 0));
  if (t === 2) {
    // Стяг: башня стала знаком, а не просто вышкой.
    g.add(cyl(0.04, 0.04, 1.2, st.post, 4, 0, h + 1.4, 0));
    g.add(box(0.7, 0.45, 0.03, st.accent, 0.35, h + 1.7, 0));
  }
  return g;
}

/** Открытый производственный фасад и широкая вытяжка — знак кузницы. */
function smithy(t: Tier): THREE.Group {
  const p = stylePaint();
  const stone = K.paintOf('stoneDark');
  const metal = K.paintOf('metal');
  const a: K.Part[] = [];
  const h = [1.45, 1.9, 2.2][t];
  const w = [1.4, 1.65, 1.95][t];
  const d = [1.65, 2, 2.25][t];
  const x = [-0.5, -0.75, -1][t];
  a.push(K.plinth(w, d, stone, x));
  a.push(K.box(w, h, 0.16, p.wall, x, h / 2, -d / 2 + 0.08));
  for (const sx of [-1, 1]) {
    a.push(K.box(0.14, h, 0.14, p.beam, x + sx * (w / 2 - 0.06), h / 2, d / 2 - 0.06));
    a.push(K.box(0.12, 0.56, 0.12, p.beam, x + sx * (w / 2 - 0.2), h - 0.23, d / 2 - 0.06, { z: sx * 0.65 }));
  }
  a.push(K.box(w + 0.1, 0.16, 0.16, p.beam, x, h - 0.05, d / 2 - 0.06));
  a.push(...K.roofGable(w, d, 0.48, h, p.roofPaint, 0.13, x));
  if (t >= 1) {
    // Инструментальная клеть слева; рабочий проём сохраняется справа.
    a.push(K.box(0.16, h, d, p.wall, x - w / 2 + 0.08, h / 2, 0));
    a.push(K.box(w * 0.65, h, 0.14, p.wall, x - w * 0.175, h / 2, d / 2 - 0.07));
    a.push(K.wallGable(w, 0.08, d, 0.45, p.wall, x, 0, undefined, h - 0.08));
    a.push(...K.door(0.4, 0.92, p.ink, p.beam, x - w * 0.15, d / 2 + 0.015));
    a.push(K.box(0.3, 0.3, 0.04, p.ink, x - w * 0.15, 1.5, d / 2 + 0.025));
    a.push(K.box(w, 0.12, 0.1, p.beam, x, 1.18, d / 2 + 0.04));
    // Низкий рабочий навес не скрывает массивную трубу.
    a.push(K.roofLean(1.3, 1.25, 1.77, p.roof, -0.4, 0.75, 0.18));
    a.push(K.box(0.12, 1.54, 0.12, p.beam, 1.34, 0.77, 0.79));
    a.push(K.box(0.16, 0.16, 0.9, p.beam, 1.34, 1.6, 0.28));
    // Крупные заготовки читаются лучше россыпи тонких копий оружия.
    for (const z of [-0.42, -0.18, 0.06]) a.push(K.box(0.6, 0.12, 0.14, metal, x, 0.22, z));
  }
  // Горн стоит у открытого края навеса; широкая нижняя часть вытяжки
  // сужается в квадратную трубу, поэтому это не башня и не жилая дымовая труба.
  const fx = 0.72;
  const fz = 0.12;
  a.push(K.box(1.06, 0.4, 0.92, stone, fx, 0.2, fz));
  a.push(K.box(1.14, 0.12, 1.02, p.base, fx, 0.44, fz));
  a.push(K.box(1.02, 0.7, 0.16, stone, fx, 0.83, fz - 0.38));
  for (const sx of [-1, 1]) a.push(K.box(0.17, 0.62, 0.72, p.base, fx + sx * 0.45, 0.82, fz));
  a.push(K.arch(0.9, 0.25, 0.12, 0.16, p.base, fx, 0.65, fz + 0.4));
  a.push(K.cyl(0.37, 0.79, 0.54, stone, 4, fx, 1.51, fz, { y: Math.PI / 4 }));
  const top = [2.6, 3.0, 3.5][t];
  a.push(K.box(0.51, top - 1.76, 0.51, stone, fx, (top + 1.76) / 2, fz));
  a.push(K.box(0.68, 0.14, 0.68, p.base, fx, top, fz));
  a.push(K.box(0.38, 0.025, 0.38, p.ink, fx, top + 0.078, fz));
  // Наковальня: широкая подошва, узкая шея, длинная рабочая поверхность и рог.
  const ax = -0.47;
  const az = 1.02;
  a.push(K.cyl(0.26, 0.3, 0.38, p.post, 8, ax, 0.19, az));
  a.push(K.box(0.43, 0.09, 0.3, metal, ax, 0.43, az));
  a.push(K.box(0.21, 0.18, 0.19, metal, ax, 0.55, az));
  a.push(K.box(0.56, 0.12, 0.26, metal, ax, 0.69, az));
  a.push(K.cone(0.12, 0.3, metal, 4, ax + 0.39, 0.69, az, { z: -Math.PI / 2 }));
  a.push(K.box(0.075, 0.36, 0.075, p.beam, ax - 0.18, 0.85, az + 0.02, { z: -0.65 }));
  a.push(K.box(0.22, 0.12, 0.12, metal, ax - 0.29, 0.99, az + 0.02));
  if (t === 2) {
    // Боковой пролёт остаётся низким и открытым: место длинных заготовок.
    const sx = -2.3;
    a.push(K.plinth(0.95, 1.85, stone, sx, 0.03));
    a.push(...K.roofGable(0.95, 1.85, 0.3, 1.45, p.roofPaint, 0.1, sx, 0.03));
    for (const z of [-0.8, 0.83]) a.push(K.box(0.14, 1.42, 0.14, p.beam, sx - 0.4, 0.71, z));
    a.push(K.box(0.8, 0.12, 1.45, p.beam, sx, 0.69, 0.03));
    for (const x of [sx - 0.22, sx, sx + 0.22]) a.push(K.box(0.13, 0.1, 1.3, metal, x, 0.8, 0.03));
    // Бадья с тёмной глубиной и двумя обручами, без отдельного материала воды.
    a.push(K.cyl(0.34, 0.29, 0.5, p.post, 10, 1.33, 0.25, 1.05));
    a.push(K.cyl(0.28, 0.28, 0.025, p.ink, 10, 1.33, 0.503, 1.05));
    for (const y of [0.12, 0.41]) a.push(K.cyl(0.335, 0.335, 0.07, metal, 10, 1.33, y, 1.05));
    a.push(K.box(w, 0.12, 0.1, p.beam, x, 1.7, d / 2 + 0.04));
    a.push(K.box(0.12, 0.47, 0.1, p.beam, x, 1.94, d / 2 + 0.04));
  }
  const g = new THREE.Group();
  g.add(K.assemble(a));
  const forge = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.16, 0.5), M.forge);
  forge.name = 'forge';
  forge.position.set(fx, 0.57, fz + 0.06);
  g.add(forge);
  return g;
}

/** Городской зал с башней: каменный низ → открытая аркада → каменные палаты. */
function townHall(t: Tier): THREE.Group {
  const p = stylePaint();
  const stone = K.paintOf('stoneLight');
  const darkStone = K.paintOf('stoneDark');
  const parts: K.Part[] = [];
  const w = [1.65, 1.9, 2.1][t];
  const d = [1.75, 2.0, 2.2][t];
  const cx = 0.38;
  const baseH = [0.82, 1.02, 1.22][t];
  const upperH = [0.58, 0.85, 1.02][t];
  const roofY = 0.16 + baseH + upperH;
  const rise = [0.78, 0.9, 1.02][t];
  const front = d / 2;
  const towerX = -0.91;
  const towerZ = 0.1;
  const tw = [0.72, 0.84, 0.94][t];
  const towerH = [2.25, 3.1, 3.95][t];
  // Каменный зал и неизменная ось входа. Верхний этаж выступает над цоколем.
  parts.push(K.plinth(w, d, darkStone, cx));
  parts.push(K.wallBox(w, baseH, d - (t ? 0.44 : 0), p.base, cx, t ? -0.22 : 0, 0.16));
  parts.push(K.wallGable(w + 0.08, upperH, d + 0.04, rise, t === 2 ? stone : p.wall, cx, 0, undefined, 0.16 + baseH));
  parts.push(...K.roofGable(w + 0.08, d + 0.04, rise, roofY, p.roofPaint, 0.16, cx));
  // Тёмная вставка повторяет арочный контур, поэтому углы не торчат из свода.
  const opening = (x: number, y: number, z: number, width: number, spring: number, rot?: K.Rot): void => {
    parts.push(K.arch(width, spring, 0, 0.035, p.ink, x, y, z, rot));
    parts.push(K.arch(width + 0.16, spring, 0.085, 0.13, stone, x, y, z + (rot ? 0 : 0.04), rot));
  };
  opening(cx, 0.18, front + 0.035 - (t ? 0.44 : 0), 0.57, 0.44);
  parts.push(K.box(0.76, 0.1, 0.36, stone, cx, 0.08, front + 0.12));
  if (t >= 1) {
    // Настоящая глубина аркады: зал отступает назад, между опорами есть просвет.
    parts.push(K.box(w + 0.16, 0.12, 0.64, stone, cx, 0.14, front - 0.08));
    for (const s of (t === 2 ? [-1, 0, 1] : [-1, 1])) {
      const bay = t === 2 ? w / 3 : w / 2;
      parts.push(K.arch(bay + 0.04, baseH - bay / 2, 0.12, 0.22, stone,
        cx + s * (t === 2 ? bay : w * 0.25), 0.19, front - 0.03));
    }
    parts.push(K.box(w + 0.16, 0.12, d + 0.14, darkStone, cx, baseH + 0.13, 0));
    for (const s of [-1, 1]) {
      opening(cx + s * w * 0.25, baseH + 0.29, front + 0.055, 0.3, 0.25);
    }
    // Опорные каменные лопатки собирают высокий ствол башни.
    for (const s of [-1, 1]) parts.push(K.box(0.12, towerH * 0.65, tw + 0.08, stone,
      towerX + s * tw * 0.46, towerH * 0.325 + 0.14, towerZ));
  }
  // Фахверк крупными полосами: читается на телефоне без россыпи тонких досок.
  const upperY = 0.16 + baseH;
  for (const z of [-front - 0.04, front + 0.04]) {
    for (const y of [upperY + 0.05, roofY - 0.04]) parts.push(K.box(w + 0.14, 0.095, 0.09, p.beam, cx, y, z));
    for (const x of [cx - w * 0.43, cx, cx + w * 0.43]) parts.push(K.box(0.085, upperH, 0.09, p.beam, x, upperY + upperH / 2, z));
    for (const s of [-1, 1]) parts.push(K.box(0.075, Math.hypot(w * 0.35, upperH * 0.8), 0.08, p.beam,
      cx + s * w * 0.23, upperY + upperH / 2, z, { z: s * Math.atan2(w * 0.35, upperH * 0.8) }));
  }
  // Фронтон и коньковая стойка объединяют силуэт трёх поколений ратуши.
  parts.push(K.box(0.1, rise, 0.09, p.beam, cx, roofY + rise / 2, front + 0.055));
  // Башня опирается на землю, а не на крышу. Каменные пояса и широкий венец.
  parts.push(K.plinth(tw, tw, darkStone, towerX, towerZ));
  parts.push(K.wallBox(tw, towerH, tw, p.base, towerX, towerZ, 0.12));
  for (const y of [0.4, baseH + 0.16, towerH - 0.18]) parts.push(K.box(tw + 0.09, 0.12, tw + 0.09, stone, towerX, y, towerZ));
  opening(towerX, towerH - 0.82, towerZ + tw / 2 + 0.025, tw * 0.33, 0.26);
  parts.push(K.box(tw + 0.22, 0.14, tw + 0.22, darkStone, towerX, towerH + 0.08, towerZ));
  const crown = tw + 0.12;
  for (const x of [-1, 0, 1]) for (const z of [-1, 1]) {
    parts.push(K.box(0.19, 0.29, 0.19, stone, towerX + x * crown / 2, towerH + 0.29, towerZ + z * crown / 2));
  }
  for (const x of [-1, 1]) parts.push(K.box(0.19, 0.29, 0.19, stone, towerX + x * crown / 2, towerH + 0.29, towerZ));
  if (t === 2) {
    // Ступенчатые каменные щипцы: фронтон виден над черепицей, не нарисован на ней.
    for (const z of [-front - 0.09, front + 0.09]) {
      for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
        const x = (i + 0.5) * w / 8;
        parts.push(K.box(w / 4 + 0.025, 0.18, 0.17, stone, cx + s * x,
          roofY + rise * (1 - x / (w / 2)) + 0.17, z));
      }
      parts.push(K.box(0.22, 0.34, 0.2, stone, cx, roofY + rise + 0.08, z));
    }
    // Окно на боковой грани башни раскрывает объём при повороте камеры.
    opening(towerX - tw / 2 - 0.05, towerH - 0.82, towerZ, 0.34, 0.3, { y: -Math.PI / 2 });
    parts.push(K.box(0.29, 0.67, 0.055, K.paintOf('paintRed'), towerX, towerH - 1.35, towerZ + tw / 2 + 0.06));
    parts.push(K.box(0.06, 0.45, 0.065, p.accent, towerX, towerH - 1.3, towerZ + tw / 2 + 0.095));
    // Поперечная слуховая кровля: верхний этаж теперь не один огромный скат.
    const dx = cx + w * 0.38;
    parts.push(K.wallGable(0.64, 0.26, 0.65, 0.4, stone, dx, -0.12, { y: Math.PI / 2 }, roofY + 0.3));
    parts.push(...K.roofGable(0.64, 0.65, 0.4, roofY + 0.56, p.roofPaint, 0.07, dx, -0.12, { y: Math.PI / 2 }));
  }
  const g = new THREE.Group();
  g.add(K.assemble(parts));
  return g;
}

/** Общий деревянный каркас военных построек; материал кровли сохраняет снег. */
function militaryShed(w: number, d: number, h: number, x: number, z: number, crossRoof = false): K.Part[] {
  const p = stylePaint();
  const roof = { ...p.roofPaint, roof: K.paintOf('shingle'), trim: p.beam };
  const a = [K.plinth(w, d, p.base, x, z)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) a.push(K.box(0.13, h, 0.13, p.post, x + sx * (w / 2 - 0.06), h / 2, z + sz * (d / 2 - 0.06)));
  for (const sz of [-1, 1]) a.push(K.box(w, 0.13, 0.13, p.beam, x, h - 0.05, z + sz * (d / 2 - 0.06)));
  a.push(...K.roofGable(crossRoof ? d : w, crossRoof ? w : d, 0.38, h, roof, 0.12, x, z,
    crossRoof ? { y: Math.PI / 2 } : undefined));
  return a;
}

function barracks(t: Tier): THREE.Group {
  const p = stylePaint();
  const metal = K.paintOf('metal');
  const w = [1.75, 2.55, 3.05][t];
  const d = [1.05, 1.3, 1.35][t];
  const z = [-0.4, -0.65, -1.05][t];
  const h = [1.15, 1.35, 1.55][t];
  const a = militaryShed(w, d, h, 0, z);
  if (t >= 1) {
    a.push(K.box(w, h, 0.15, p.post, 0, h / 2, z - d / 2 + 0.07));
    for (const side of [-1, 1]) {
      a.push(K.box(0.15, h, d, p.post, side * (w / 2 - 0.07), h / 2, z));
      a.push(K.box(w * 0.29, h * 0.7, 0.13, p.post, side * w * 0.355, h * 0.35, z + d / 2));
      // Нары за открытым центральным пролётом, два уровня с торцами одеял.
      for (const y of [0.32, 0.78]) {
        a.push(K.box(0.72, 0.1, 0.72, p.beam, side * w * 0.28, y, z));
        a.push(K.box(0.62, 0.08, 0.54, K.paintOf('cloth'), side * w * 0.28, y + 0.08, z + 0.09));
      }
    }
    a.push(K.box(w, 0.12, 0.14, p.beam, 0, h * 0.78, z + d / 2));
  }
  // Стойка с длинными копьями и круглыми щитами узнаётся даже без бойцов.
  for (const x of [-0.68, 0.68]) a.push(K.box(0.1, 0.92, 0.12, p.beam, x, 0.46, 0.72));
  a.push(K.box(1.45, 0.13, 0.12, p.beam, 0, 0.77, 0.72));
  for (let i = 0; i < 4; i++) {
    const x = -0.52 + i * 0.34;
    a.push(K.cyl(0.035, 0.035, 1.35, p.post, 4, x, 0.68, 0.67));
    a.push(K.cone(0.09, 0.29, metal, 4, x, 1.48, 0.67));
  }
  for (const x of [-0.43, 0.43]) {
    a.push(K.cyl(0.24, 0.24, 0.07, p.accent, 8, x, 0.6, 0.83, { x: Math.PI / 2 }));
    a.push(K.cyl(0.07, 0.07, 0.085, metal, 6, x, 0.6, 0.875, { x: Math.PI / 2 }));
  }
  if (t === 2) {
    a.push(...militaryShed(0.95, 1.75, 1.1, -1.62, 0.4));
    a.push(K.box(0.12, 1.03, 1.6, p.post, -2.02, 0.52, 0.4));
    // Учебные мишени и свободная середина — плац, а не жилой двор.
    for (const x of [0.55, 1.35]) {
      a.push(K.box(0.1, 1.1, 0.12, p.beam, x, 0.55, -0.1));
      a.push(K.cyl(0.28, 0.28, 0.1, p.post, 8, x, 1.08, -0.04, { x: Math.PI / 2 }));
      a.push(K.cyl(0.13, 0.13, 0.11, K.paintOf('cloth'), 8, x, 1.08, 0.015, { x: Math.PI / 2 }));
    }
    for (const side of [-1, 1]) a.push(...K.fenceRun(side * 0.65, 1.55, side * 1.8, 1.55, 0.66, p.post, p.beam));
  }
  const g = new THREE.Group();
  g.add(K.assemble(a));
  return g;
}

/** Коновязь и повторяющиеся денники: конюшня не похожа на пустую ограду загона. */
function stable(t: Tier): THREE.Group {
  const p = stylePaint();
  const w = [1.65, 2.5, 2.9][t];
  const z = [-0.3, -0.6, -0.8][t];
  const a = militaryShed(w, 1.25, 1.35, 0, z, true);
  // Статичная лошадь из существующих деталей, склеенная с постройкой.
  // Поза боком к фасаду показывает длинную шею, голову и четыре ноги.
  const horse = (x: number, z: number, scale = 1): void => {
    const coat: K.Paint = { ...K.paintOf('wood'), tint: new THREE.Color(PALETTE.horseCoat) };
    const q: K.Part[] = [K.box(0.76, 0.32, 0.28, coat, 0, 0.64, 0)];
    for (const dx of [-0.27, 0.27]) for (const dz of [-0.1, 0.1]) q.push(K.box(0.085, 0.48, 0.085, coat, dx, 0.25, dz));
    q.push(K.box(0.22, 0.53, 0.23, coat, 0.37, 0.91, 0, { z: -0.38 }));
    q.push(K.box(0.36, 0.18, 0.2, coat, 0.52, 1.17, 0));
    q.push(K.box(0.06, 0.17, 0.17, p.ink, 0.4, 1.31, 0));
    q.push(K.box(0.07, 0.39, 0.13, p.ink, -0.4, 0.55, 0, { z: -0.2 }));
    q.push(K.box(0.35, 0.07, 0.32, p.beam, -0.05, 0.83, 0));
    a.push(...shiftParts(q, x, z, 0, scale));
  };
  if (t === 0) horse(0, 0.35, 0.83);
  else {
    a.push(K.box(w, 1.25, 0.13, p.post, 0, 0.63, z - 0.56));
    for (let i = 0; i <= 3; i++) {
      const x = -w / 2 + i * w / 3;
      a.push(K.box(0.09, 1.2, 1.08, p.beam, x, 0.6, z));
      a.push(K.box(0.12, 1.32, 0.14, p.post, x, 0.66, z + 0.58));
    }
    for (let i = 0; i < 3; i++) a.push(K.box(w / 3 - 0.12, 0.35, 0.08, p.post, -w / 3 + i * w / 3, 0.25, z + 0.6));
    horse(-0.68, 0.28, 0.66);
    horse(0.65, 0.28, 0.66);
    a.push(K.box(w * 0.85, 0.2, 0.29, p.post, 0, 0.15, 0.92));
    a.push(K.box(w * 0.8, 0.025, 0.2, p.ink, 0, 0.26, 0.92));
  }
  for (const x of [-0.7, 0.7]) a.push(K.box(0.14, 0.85, 0.14, p.beam, x, 0.42, 0.98));
  a.push(K.box(1.6, 0.14, 0.14, p.post, 0, 0.7, 0.98));
  if (t === 2) {
    a.push(...militaryShed(0.75, 1.45, 1.05, -1.47, 0.55));
    a.push(K.box(0.12, 0.92, 1.3, p.post, -1.76, 0.46, 0.55));
    // Ограда выгула ниже коновязи, вход остаётся свободным посередине.
    a.push(...K.fenceRun(1.6, -0.2, 1.6, 1.48, 0.65, p.post, p.beam));
    a.push(...K.fenceRun(-1.6, 1.48, -0.55, 1.48, 0.65, p.post, p.beam));
    a.push(...K.fenceRun(0.55, 1.48, 1.6, 1.48, 0.65, p.post, p.beam));
    a.push(K.box(0.55, 0.37, 0.5, K.paintOf('cut'), -1.43, 0.25, 0.5));
  }
  const g = new THREE.Group();
  g.add(K.assemble(a));
  return g;
}


/**
 * Рынок: два торговых ряда по обе стороны проезда. Он единственный стоит прямо
 * на воротной улице (см. plan.ROAD_THROUGH), поэтому середина модели обязана
 * оставаться пустой: между рядами идёт дорога, и по ней выезжает караван.
 * Ряды начинаются от |x| = 2 в местных единицах — этот просвет проверяет тест.
 *
 * Ступени: навесы из холста → ряды под крышей → каменные лавки со стягами.
 */
/** Открытые прилавки по краям воротной улицы; середину не занимать. */
function market(t: Tier): THREE.Group {
  if (t >= 1) {
    const a: K.Part[] = [];
    for (const x of [-2.45, 2.45]) for (const z of [-0.73, 0.73]) a.push(...tradeStall(x, z, 1.22));
    if (t === 2) {
      const p = { ...stylePaint(), post: K.paintOf('woodDark'), floor: K.paintOf('plank'), wall: K.paintOf('stone') };
      // Весы подняты над товаром, коновязь снаружи ряда, не на дороге.
      a.push(K.box(0.13, 2.05, 0.13, p.beam, -2.45, 1.025, -1.67));
      a.push(K.box(0.82, 0.09, 0.09, p.accent, -2.45, 2.04, -1.67));
      for (const x of [-2.77, -2.13]) {
        a.push(K.box(0.025, 0.38, 0.025, p.post, x, 1.8, -1.67));
        a.push(K.cyl(0.14, 0.06, 0.08, K.paintOf('metal'), 8, x, 1.59, -1.67));
      }
      for (const z of [-0.88, 0.88]) a.push(K.box(0.13, 0.84, 0.13, p.post, 3.15, 0.42, z));
      a.push(K.box(0.12, 0.12, 1.88, p.beam, 3.15, 0.7, 0));
      a.push(K.box(0.35, 0.23, 1.0, p.floor, 3.03, 0.15, 0));
      a.push(...tradeBarrel(-3.05, 0, 0.55), ...tradeBarrel(-3.05, 0, -0.1));
      for (const x of [-2.45, 2.45]) {
        a.push(K.box(1.1, 0.1, 2.8, p.base, x, 0.05, 0));
        a.push(K.box(0.08, 1.92, 0.08, p.post, x, 0.96, 1.55));
        a.push(K.box(0.035, 0.35, 0.34, p.accent, x, 1.68, 1.42));
      }
    }
    return new THREE.Group().add(K.assemble(a));
  }
  return new THREE.Group().add(K.assemble(tradeStall(-2.45, 0, 1.65)));
}

function tradeStall(x: number, z: number, length: number): K.Part[] {
  const p = { ...stylePaint(), post: K.paintOf('woodDark'), floor: K.paintOf('plank'), wall: K.paintOf('stone') }; const a: K.Part[] = [];
  const side = Math.sign(x);
  a.push(K.box(0.82, 0.52, length, p.post, x, 0.26, z));
  a.push(K.box(0.94, 0.1, length + 0.08, p.floor, x, 0.57, z));
  for (const dz of [-length / 2, length / 2]) {
    a.push(K.box(0.09, 1.5, 0.09, p.beam, x + side * 0.35, 0.75, z + dz));
    a.push(K.box(0.09, 1.26, 0.09, p.beam, x - side * 0.35, 0.63, z + dz));
  }
  // Полосы — цвет вершин существующих скатов, без текстуры и нового материала.
  for (let i = 0; i < 5; i++) {
    const dz = z - length / 2 + (i + 0.5) * length / 5;
    const paint = i % 2 ? p.roof : { ...p.roof, tint: K.paintOf('cut').tint };
    a.push(K.box(1.08, 0.055, length / 5, paint, x, 1.4, dz, {z: side * 0.22}));
    a.push(K.box(0.04, 0.16, length / 5, paint, x - side * 0.52, 1.23, dz));
  }
  for (const dz of [-0.43, 0, 0.43]) {
    a.push(K.box(0.42, 0.14, 0.32, p.beam, x, 0.69, z + dz));
    a.push(K.cyl(0.12, 0.15, 0.17, K.paintOf('cut'), 6, x, 0.79, z + dz));
  }
  return a;
}

/**
 * Леса вокруг готового здания: так выглядит улучшение. Здание продолжает работать,
 * поэтому разбирать его до площадки нельзя — обозначаем стройку снаружи.
 */
export function scaffold(w: number, d: number, h = 1.5): THREE.Group {
  const g = new THREE.Group();
  const hw = w / 2 + 0.25;
  const hd = d / 2 + 0.25;
  for (const [x, z] of [
    [-hw, -hd],
    [hw, -hd],
    [-hw, hd],
    [hw, hd],
  ])
    g.add(cyl(0.05, 0.06, h, M.woodDark, 4, x, h / 2, z));
  g.add(box(2 * hw, 0.07, 0.07, M.wood, 0, h * 0.6, -hd));
  g.add(box(2 * hw, 0.07, 0.07, M.wood, 0, h * 0.6, hd));
  g.add(box(0.07, 0.07, 2 * hd, M.wood, -hw, h * 0.85, 0));
  g.add(box(0.07, 0.07, 2 * hd, M.wood, hw, h * 0.85, 0));
  // Настил и лестница: леса читаются как стройка, а не как решётка.
  g.add(box(2 * hw, 0.05, 0.35, M.wood, 0, h * 0.62, hd - 0.2));
  const ladder = box(0.32, 0.05, h * 1.15, M.woodDark, hw - 0.3, h * 0.35, hd);
  ladder.rotation.x = 1.15;
  g.add(ladder);
  return K.collapse(g);
}

/**
 * Стена вокруг поселения. Радиус берётся из плана и не меняется никогда: под него
 * рассчитаны все площадки, поэтому стена не может наехать на постройки. Ворота
 * всегда в одном месте — там же, куда смотрит камера при стартовом ракурсе.
 *
 * Ступени: частокол из жердей → каменная стена с зубцами и башнями → высокая
 * стена со стягами. Со второй ступени поселение и выглядит укреплённым.
 */
/** Единый ритм укреплений в прежнем радиальном поясе и с прежним проездом. */
function palisade(t: Tier): THREE.Group {
  const p = stylePaint();
  const parts: K.Part[] = [];
  const R = WALL_RADIUS;
  const gap = 0.105;
  const span = Math.PI * 2 - 2 * gap;
  const h = [1.7, 2.1, 2.65][t];
  const at = (a: number, r: number): [number, number] => [Math.cos(a) * r, Math.sin(a) * r];
  const radialBox = (a: number, r: number, w: number, height: number, depth: number, y: number, paint: K.Paint): void => {
    const [x, z] = at(a, r);
    parts.push(K.box(w, height, depth, paint, x, y, z, { y: -a - Math.PI / 2 }));
  };
  if (t === 0) {
    const n = 224;
    for (let i = 0; i < n; i++) {
      const a = GATE_ANGLE + gap + span * (i + 0.5) / n;
      const [x, z] = at(a, R);
      parts.push(K.cyl(0.215, 0.23, h, p.post, 4, x, h / 2 - 0.06, z, { y: -a + Math.PI / 4 }));
      parts.push(K.cone(0.215, 0.38, p.post, 4, x, h + 0.13, z, { y: -a + Math.PI / 4 }));
    }
    for (let i = 0; i < 48; i++) {
      const a = GATE_ANGLE + gap + span * (i + 0.5) / 48;
      for (const y of [0.55, 1.25]) radialBox(a, R - 0.2, span * R / 48 + 0.03, 0.15, 0.14, y, p.beam);
    }
    for (const s of [-1, 1]) radialBox(GATE_ANGLE + s * 0.119, R, 0.28, 2.45, 0.3, 1.16, p.beam);
    radialBox(GATE_ANGLE, R - 0.02, 3.92, 0.24, 0.32, 2.34, p.beam);
  } else {
    const stone = K.paintOf('stone');
    const dark = K.paintOf('stoneDark');
    const light = K.paintOf('stoneLight');
    const n = 96;
    const step = span / n;
    for (let i = 0; i < n; i++) {
      const a = GATE_ANGLE + gap + step * (i + 0.5);
      const width = 2 * R * Math.tan(step / 2) + 0.025;
      radialBox(a, R, width, h, 0.82, h / 2 - 0.05, stone);
      // Трапециевидный цоколь из существующего box: низ шире верха.
      const base = K.box(width, 0.58, 0.82, dark);
      const pos = base.geo.attributes.position;
      for (let v = 0; v < pos.count; v++) if (pos.getY(v) < 0) pos.setZ(v, pos.getZ(v) * 1.32);
      base.geo.computeVertexNormals();
      base.geo.rotateY(-a - Math.PI / 2);
      const [bx, bz] = at(a, R);
      base.geo.translate(bx, 0.18, bz);
      parts.push(base);
      radialBox(a, R - 0.02, width, 0.12, 0.88, h, dark);
      radialBox(a, R + 0.3, width, 0.43, 0.24, h + 0.25, light);
      radialBox(a, R + 0.3, 0.53, 0.5, 0.29, h + 0.7, stone);
    }
    const [gx, gz] = at(GATE_ANGLE, R);
    parts.push(K.arch(3.5, 1.5, 0.18, 0.68, light, gx, 0, gz, { y: -GATE_ANGLE - Math.PI / 2 }));
    // Открытые створки вдоль проезда: свободный просвет не меняется.
    for (const side of [-1, 1]) {
      const a = GATE_ANGLE + side * 0.105;
      radialBox(a, R - 0.1, 0.12, 1.95, 0.9, 0.98, p.beam);
      for (const y of [0.45, 1.5]) radialBox(a, R - 0.1, 0.15, 0.13, 0.92, y, dark);
    }
    if (t === 2) {
      const tower = (a: number, th: number): void => {
        const r = R + 0.12;
        radialBox(a, r, 1.3, th, 1.0, th / 2 - 0.04, stone);
        radialBox(a, r, 1.43, 0.36, 1.16, 0.1, dark);
        radialBox(a, r, 1.43, 0.18, 1.12, th, dark);
        // Местные координаты площадки башни: x по касательной, z внутрь.
        const [tx, tz] = at(a, r);
        const local = (x: number, z: number, w: number, ht: number, d: number, y: number): void => {
          parts.push(K.box(w, ht, d, light, tx - Math.sin(a) * x - Math.cos(a) * z,
            y, tz + Math.cos(a) * x - Math.sin(a) * z, { y: -a - Math.PI / 2 }));
        };
        for (const s of [-1, 1]) {
          local(0, s * 0.44, 1.3, 0.3, 0.2, th + 0.22);
          local(s * 0.56, 0, 0.2, 0.9, 0.74, th + 0.22);
          for (const x of [-0.5, 0, 0.5]) local(x, s * 0.44, 0.28, 0.4, 0.24, th + 0.57);
        }
      };
      for (let i = 0; i < 8; i++) tower(GATE_ANGLE + Math.PI / 8 + i * Math.PI / 4, 3.65);
      for (const s of [-1, 1]) tower(GATE_ANGLE + s * 0.145, 4.05);
      // Надвратный зал опирается на две башни и арку, проезд под ним открыт.
      // Заполнение над сводом: нижние края блоков скрыты каменным архивольтом.
      for (let i = 0; i < 16; i++) {
        const x = -1.75 + (i + 0.5) * 3.5 / 16;
        const bottom = 1.5 + Math.sqrt(1.75 * 1.75 - x * x);
        parts.push(K.box(3.5 / 16 + 0.01, 3.5 - bottom, 0.64, stone,
          gx - Math.sin(GATE_ANGLE) * x, (3.5 + bottom) / 2,
          gz + Math.cos(GATE_ANGLE) * x, { y: -GATE_ANGLE - Math.PI / 2 }));
      }
      radialBox(GATE_ANGLE, R, 3.6, 0.63, 0.74, 3.55, stone);
      radialBox(GATE_ANGLE, R, 3.74, 0.14, 0.84, 3.94, dark);
      for (const s of [-1, 1]) radialBox(GATE_ANGLE, R + s * 0.31, 3.7, 0.3, 0.2, 4.1, light);
      for (let i = -2; i <= 2; i++) {
        const a = GATE_ANGLE + i * 0.045;
        radialBox(a, R + 0.31, 0.38, 0.43, 0.24, 4.43, stone);
      }
    }
  }
  const g = new THREE.Group();
  g.add(K.assemble(parts));
  return g;
}


// ---------- Заглушки под будущие модели ----------
//
// Пять служб посёлка ждут настоящих моделей: их делают отдельно и не здесь.
// Заглушка нужна ровно для одного — **габарит**. Он выбран сразу настоящим и
// записан в `MODEL_RADIUS`, поэтому, когда придут готовые модели, переставлять
// посёлок и пересчитывать план не придётся: место под каждое здание уже
// зарезервировано по его третьей ступени на десятом уровне.
//
// Форма нарочно простая: клеть с двускатной кровлей, пристройка со ступени и
// одна примета, по которой здание узнаётся в сцене. Фасад — +z, как требует
// `facingCenter`; всё остальное соберёт `K.collapse`.

/** Во сколько раз заглушка растёт со ступенью — как TIER_SPREAD у площадок. */
const STUB_GROW: [number, number, number] = [1, 1.2, 1.42];

interface Stub {
  /** Ширина, глубина и высота стен первой ступени. */
  size: [number, number, number];
  /** Примета здания: её ставят поверх коробки. `h` — высота конька. */
  mark: (g: THREE.Group, st: Style, w: number, d: number, h: number, t: Tier) => void;
}

function stubModel(t: Tier, st: Style, def: Stub): THREE.Group {
  const g = new THREE.Group();
  const k = STUB_GROW[t];
  const w = def.size[0] * k;
  const d = def.size[1] * k;
  const h = def.size[2] * k;
  // Цоколь, клеть, кровля — тот же порядок, что у старых моделей посёлка.
  g.add(box(w * 1.06, 0.18, d * 1.06, st.base, 0, 0.09, 0));
  g.add(box(w, h, d, st.wall, 0, 0.18 + h / 2, 0));
  const roofY = 0.18 + h;
  gable(g, w * 1.18, d * 1.16, roofY, 0.28 + 0.09 * t, st.roof);
  g.add(box(0.46, 0.7, 0.08, M.woodDark, 0, 0.53, d / 2 + 0.04));
  if (t >= 1) {
    // Пристройка сбоку: ступень видно и без примет.
    const aw = w * 0.5;
    const ad = d * 0.62;
    const ah = h * 0.72;
    g.add(box(aw, ah, ad, st.wall, w * 0.7, 0.18 + ah / 2, -d * 0.12));
    gable(g, aw * 1.18, ad * 1.16, 0.18 + ah, 0.22, st.roof, w * 0.7, -d * 0.12);
  }
  def.mark(g, st, w, d, roofY + 0.28 + 0.09 * t, t);
  return g;
}

/** Бочки — общая примета трактира и тайника: их ставят у стены. */
function barrels(g: THREE.Group, st: Style, x: number, z: number, n: number): void {
  for (let i = 0; i < n; i++) {
    g.add(cyl(0.22, 0.2, 0.46, st.post, 8, x + i * 0.5, 0.23, z + (i % 2) * 0.28));
  }
}

const STUBS: Record<string, Stub> = {
  // Лазарет: длинная палата под низкой кровлей, на щипце — крест.
  infirmary: {
    size: [1.8, 1.3, 1.0],
    mark: (g, st, w, d, h) => {
      g.add(box(0.12, 0.62, 0.06, st.accent, 0, h - 0.18, d / 2 + 0.06));
      g.add(box(0.42, 0.12, 0.06, st.accent, 0, h - 0.02, d / 2 + 0.06));
    },
  },
  // Дозор: изба с мачтой и площадкой наверху — оттуда и смотрят.
  watch: {
    size: [1.5, 1.4, 1.0],
    mark: (g, st, w, d, h, t) => {
      const mast = 1.1 + 0.45 * t;
      g.add(cyl(0.1, 0.12, mast, M.woodDark, 6, 0, h + mast / 2 - 0.15, -d * 0.18));
      g.add(box(0.86, 0.12, 0.86, st.floor, 0, h + mast - 0.2, -d * 0.18));
      g.add(box(0.5, 0.34, 0.04, st.accent, 0.42, h + mast + 0.05, -d * 0.18));
    },
  },
  // Конюшня: длинный денник, у стены поилка и загородка для коней.
  stable: {
    size: [1.9, 1.35, 1.05],
    mark: (g, st, w, d) => {
      g.add(box(1.1, 0.24, 0.34, st.post, -w * 0.2, 0.12, d / 2 + 0.5));
      for (const x of [-w * 0.5, -w * 0.05, w * 0.4]) {
        g.add(cyl(0.07, 0.08, 0.72, M.woodDark, 5, x, 0.36, d / 2 + 0.8));
      }
      g.add(box(w * 1.05, 0.08, 0.08, M.woodDark, -w * 0.05, 0.6, d / 2 + 0.8));
    },
  },
  // Тайник: приземистый сруб с лазом в подпол и бочками у стены.
  cache: {
    size: [1.4, 1.3, 0.8],
    mark: (g, st, w, d) => {
      g.add(box(0.7, 0.1, 0.7, M.woodDark, -w * 0.75, 0.05, d * 0.3));
      g.add(box(0.5, 0.06, 0.5, st.base, -w * 0.75, 0.13, d * 0.3));
      barrels(g, st, w * 0.62, -d * 0.5, 2);
    },
  },
  // Трактир: изба пошире, вывеска на столбе и бочки у крыльца.
  tavern: {
    size: [1.75, 1.5, 1.15],
    mark: (g, st, w, d) => {
      g.add(cyl(0.09, 0.1, 1.6, M.woodDark, 6, w * 0.62, 0.8, d / 2 + 0.34));
      g.add(box(0.06, 0.36, 0.62, st.accent, w * 0.62, 1.36, d / 2 + 0.62));
      barrels(g, st, -w * 0.72, d * 0.42, 3);
    },
  },
};

/**
 * Статуя Героя: постамент, на нём каменный витязь. Модель тоже заглушка — героя
 * и статую переделают отдельно, — но габарит настоящий: место под неё на первом
 * кольце зарезервировано по третьей ступени десятого уровня.
 */
/** Дозор: открытая галерея и лёгкая крыша вместо зубцов крепостной башни. */
function watch(t: Tier): THREE.Group {
  if (t >= 1) return watchTower(t);
  const p = stylePaint(); const wood = K.paintOf('woodDark');
  const a: K.Part[] = [];
  for (const x of [-0.64, 0.64]) for (const z of [-0.64, 0.64])
    a.push(K.box(0.18, 2.0, 0.18, wood, x, 1, z));
  for (const x of [-0.64, 0.64]) {
    a.push(K.box(0.1, 1.96, 0.12, p.beam, x, 1.05, 0, {x: 0.65}));
    a.push(K.box(0.1, 1.96, 0.12, p.beam, x, 1.05, 0, {x: -0.65}));
  }
  a.push(K.box(1.7, 0.18, 1.7, K.paintOf('plank'), 0, 2.0, 0));
  a.push(...watchRail(1.6, 2.08));
  for (const x of [-0.25, 0.25]) a.push(K.box(0.07, 2.4, 0.09, wood, x, 1.13, 1.0, {x: -0.22}));
  for (let i = 0; i < 8; i++) a.push(K.box(0.56, 0.07, 0.09, K.paintOf('plank'), 0, 0.25 + i * 0.24, 1.2 - i * 0.053));
  return new THREE.Group().add(K.assemble(a));
}

function watchTower(t: Tier): THREE.Group {
  const p = stylePaint(); const wood = K.paintOf('woodDark');
  const h = t === 2 ? 5.6 : 3.45;
  const a: K.Part[] = [K.box(1.72, 0.25, 1.72, p.base, 0, 0.125, 0)];
  if (t === 1) for (let i = 0; i < 12; i++) {
    const y = 0.25 + (i + 0.5) * (h - 0.25) / 12;
    for (const side of [-1, 1]) {
      a.push(K.box(1.65, (h - 0.25) / 12 - 0.018, 0.19, i % 2 ? wood : K.paintOf('wood'), 0, y, side * 0.64));
      a.push(K.box(0.19, (h - 0.25) / 12 - 0.018, 1.65, i % 2 ? wood : K.paintOf('wood'), side * 0.64, y, 0));
    }
  }
  if (t === 2) {
    a.push(K.box(1.48, h - 0.25, 1.48, K.paintOf('stone'), 0, (h + 0.25) / 2, 0));
    for (const y of [0.5, 1.5, 2.5, 3.5, 4.5, 5.3]) {
      for (const x of [-0.69, 0.69]) for (const z of [-0.69, 0.69])
        a.push(K.box(0.22, 0.2, 0.22, K.paintOf('stoneDark'), x, y, z));
    }
    for (const y of [2.1, 3.65]) {
      a.push(K.box(0.12, 0.56, 0.035, p.ink, 0, y, 0.75));
      a.push(K.box(0.035, 0.56, 0.12, p.ink, 0.75, y, 0));
    }
    // Сигнальная корзина вне кровли, без отдельного источника света и материала.
    a.push(K.box(1.2, 0.15, 0.15, wood, 1.05, h + 0.28, 0));
    a.push(K.cyl(0.3, 0.18, 0.22, K.paintOf('metal'), 8, 1.63, h + 0.44, 0));
    a.push(K.cone(0.23, 0.58, K.paintOf('gold'), 6, 1.63, h + 0.82, 0));
    a.push(K.cone(0.12, 0.34, K.paintOf('cut'), 5, 1.63, h + 0.72, 0.12));
  }
  a.push(K.box(0.5, 0.95, 0.05, p.ink, 0, 0.7, 0.75));
  a.push(K.box(2.15, 0.2, 2.15, K.paintOf('plank'), 0, h, 0));
  a.push(...watchRail(2.0, h + 0.1));
  for (const x of [-0.87, 0.87]) for (const z of [-0.87, 0.87]) {
    a.push(K.box(0.13, 1.35, 0.13, wood, x, h + 0.7, z));
    a.push(K.box(0.14, 0.85, 0.14, p.beam, x * 0.95, h - 0.3, z * 0.95, {z: x > 0 ? -0.48 : 0.48}));
  }
  a.push(...K.roofGable(2.15, 2.15, 0.48, h + 1.32, { ...p.roofPaint, roof: K.paintOf('shingle'), trim: wood }, 0.12));
  return new THREE.Group().add(K.assemble(a));
}

function watchRail(w: number, y: number): K.Part[] {
  const wood = K.paintOf('woodDark'); const a: K.Part[] = [];
  for (const x of [-w / 2, w / 2]) for (const z of [-w / 2, w / 2])
    a.push(K.box(0.1, 0.65, 0.1, wood, x, y + 0.325, z));
  for (const x of [-w / 2, w / 2]) a.push(K.box(0.1, 0.1, w, wood, x, y + 0.58, 0));
  a.push(K.box(w, 0.1, 0.1, wood, 0, y + 0.58, -w / 2));
  for (const x of [-w * 0.33, w * 0.33]) a.push(K.box(w * 0.34, 0.1, 0.1, wood, x, y + 0.58, w / 2));
  return a;
}

/** Памятник — самостоятельная каменная скульптура, не экземпляр бойца. */
function statue(t: Tier): THREE.Group {
  if (t === 2) return heroMonument();
  if (t === 1) {
    const stone = K.paintOf('stone'); const dark = K.paintOf('stoneDark');
    const a: K.Part[] = [K.box(1.65, 0.2, 1.65, dark, 0, 0.1, 0),
      K.box(1.28, 0.18, 1.28, stone, 0, 0.29, 0),
      K.box(0.68, 1.72, 0.62, stone, 0, 1.24, 0),
      K.box(0.9, 0.19, 0.84, dark, 0, 2.16, 0)];
    a.push(...monumentShield(0, 1.32, 0.4, 0.43));
    for (const x of [-0.24, 0, 0.24]) a.push(K.box(0.035, 0.17, 0.025, dark, x, 0.58, 0.32));
    return new THREE.Group().add(K.assemble(a));
  }
  const stone = K.paintOf('stone'); const dark = K.paintOf('stoneDark');
  const a: K.Part[] = [K.cyl(0.65, 0.82, 0.24, dark, 7, 0, 0.12, 0),
    K.cyl(0.38, 0.54, 1.27, stone, 5, 0, 0.84, 0),
    K.box(0.36, 0.14, 0.29, stone, -0.08, 1.48, 0, {z: -0.12})];
  for (let i = 0; i < 3; i++) a.push(K.box(0.3, 0.045, 0.12, dark, 0, 0.7 + i * 0.16, 0.49 - i * 0.02, {z: 0.22}));
  return new THREE.Group().add(K.assemble(a));
}

function monumentShield(x: number, y: number, z: number, r: number): K.Part[] {
  const stone = K.paintOf('stoneDark'); const gold = K.paintOf('gold');
  return [K.cyl(r, r, 0.13, stone, 8, x, y, z, {x: Math.PI / 2}),
    K.cyl(r * 0.84, r * 0.84, 0.035, gold, 8, x, y, z + 0.085, {x: Math.PI / 2}),
    K.box(0.075, r * 1.1, 0.04, stone, x, y, z + 0.12),
    K.box(r * 0.9, 0.075, 0.04, stone, x, y + r * 0.12, z + 0.12)];
}

function heroMonument(): THREE.Group {
  const stone = K.paintOf('stone'); const dark = K.paintOf('stoneDark');
  const gold = K.paintOf('gold'); const a: K.Part[] = [];
  for (let i = 0; i < 3; i++) a.push(K.box(2.48 - i * 0.37, 0.18, 2.48 - i * 0.37, i % 2 ? stone : dark, 0, 0.09 + i * 0.18, 0));
  a.push(K.box(1.1, 0.7, 1.03, stone, 0, 0.89, 0));
  a.push(K.box(1.3, 0.14, 1.22, dark, 0, 1.31, 0));
  // Высеченная фигура: широкие массы, голова около четверти роста, без деталей бойца.
  for (const x of [-0.23, 0.23]) {
    a.push(K.box(0.3, 0.16, 0.48, stone, x, 1.46, 0.13));
    a.push(K.box(0.26, 0.76, 0.3, stone, x, 1.89, 0));
  }
  a.push(K.cyl(0.32, 0.48, 0.58, stone, 6, 0, 2.21, 0));
  a.push(K.box(0.81, 0.58, 0.4, stone, 0, 2.66, 0));
  a.push(K.box(0.21, 0.17, 0.23, stone, 0, 3.0, 0));
  a.push(K.cyl(0.235, 0.22, 0.4, stone, 6, 0, 3.24, 0.035));
  a.push(K.box(0.1, 0.17, 0.13, stone, 0, 3.24, 0.24));
  a.push(K.box(0.95, 0.16, 0.43, dark, 0, 2.91, -0.04));
  // Три сходящихся каменных складки, а не прямоугольная доска плаща.
  for (const x of [-0.3, 0, 0.3]) a.push(K.box(0.31, 1.22, 0.15, dark, x, 2.25, -0.3, {x: -0.14, z: -x * 0.22}));
  a.push(K.box(0.23, 0.55, 0.25, stone, -0.5, 2.54, 0.08, {z: -0.24}));
  a.push(...monumentShield(-0.42, 2.26, 0.4, 0.43));
  a.push(K.box(0.25, 0.48, 0.25, stone, 0.5, 2.65, 0.04, {z: 0.55}));
  a.push(K.box(0.12, 1.23, 0.11, dark, 0.7, 2.44, 0.09));
  a.push(K.box(0.4, 0.09, 0.12, gold, 0.7, 2.82, 0.09));
  for (const x of [-1.05, 1.05]) {
    a.push(K.box(0.07, 2.2, 0.07, dark, x, 1.28, -0.62));
    a.push(K.box(0.38, 0.63, 0.055, gold, x - Math.sign(x) * 0.17, 2.02, -0.62));
    a.push(K.cone(0.08, 0.19, gold, 4, x, 2.47, -0.62));
  }
  return new THREE.Group().add(K.assemble(a));
}

/** Основание здания на первой ступени. Растёт вместе с ступенью — см. footprintOf. */
export const FOOTPRINT: Partial<Record<BuildingTypeId, [number, number]>> = {
  houses: [2.4, 2.0],
  storage: [1.5, 1.3],
  gathering: [1.4, 1.0],
  sawmill: [1.8, 1.4],
  quarry: [2.0, 1.7],
  hunter_hut: [1.6, 1.4],
  mine: [1.8, 1.6],
  workshop: [1.8, 1.6],
  farm: [2.6, 2.6],
  pen: [2.6, 2.6],
  church: [1.9, 2.9],
  tower: [1.0, 1.0],
  smithy: [2.0, 1.6],
  town_hall: [1.8, 1.6],
  barracks: [2.4, 2.4],
  // Рынок широк поперёк улицы и узок вдоль неё: два ряда по сторонам проезда.
  market: [4.6, 2.8],
  statue: [1.1, 1.1],
  infirmary: [2.1, 1.5],
  watch: [1.5, 1.4],
  stable: [2.4, 1.5],
  cache: [1.4, 1.3],
  tavern: [1.9, 1.6],
};

/** Во сколько раз ступень раздаёт основание — им меряются мишень тапа и леса. */
const TIER_SPREAD: [number, number, number] = [1, 1.22, 1.45];

export const footprintOf = (type: BuildingTypeId, tier: Tier = 0): [number, number] => {
  const [w, d] = FOOTPRINT[type] ?? [1.4, 1.4];
  const k = TIER_SPREAD[tier];
  return [w * k, d * k];
};

/**
 * Модель здания. Хижина собрана из набора деталей и уже один меш; остальные —
 * старые модели из отдельных мешей, и их склеивает `K.collapse`: один вызов
 * отрисовки на материал вместо одного на каждую доску. Визуально модель та же,
 * добавляется только контактное затемнение у земли.
 */
export function createBuildingGroup(type: BuildingTypeId, tier: Tier): THREE.Group {
  return K.collapse(legacyModel(type, tier), K.GROUND_AO);
}

function legacyModel(type: BuildingTypeId, tier: Tier): THREE.Group {
  const st = STYLE;
  switch (type) {
    case 'campfire':
      return campfire(st);
    case 'palisade':
      return palisade(tier);
    case 'houses':
      return houses(tier);
    case 'storage':
      return storage(tier);
    case 'gathering':
      return gathering(tier, st);
    case 'sawmill':
      return sawmill();
    case 'quarry':
      return quarry(tier, st);
    case 'hunter_hut':
      return hunterHut(tier, st);
    case 'mine':
      return mine(tier, st);
    case 'workshop':
      return workshop(tier, st);
    case 'farm':
      return farm(tier, st);
    case 'pen':
      return pen(tier, st);
    case 'church':
      return church(tier);
    case 'tower':
      return tower(tier, st);
    case 'smithy':
      return smithy(tier);
    case 'town_hall':
      return townHall(tier);
    case 'barracks':
      return barracks(tier);
    case 'market':
      return market(tier);
    case 'statue':
      return statue(tier);
    case 'stable':
      return stable(tier);
    case 'watch':
      return watch(tier);
    case 'infirmary':
    case 'cache':
    case 'tavern':
      return stubModel(tier, st, STUBS[type]);
    default:
      return new THREE.Group();
  }
}






