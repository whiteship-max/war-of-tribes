// Low-poly модели зданий: этапы стройки, три визуальные ступени по уровню
// и материалы эпохи. Уровень меняет форму постройки, эпоха — из чего она сложена.
import * as THREE from 'three';
import type { Building, BuildingTypeId, EraId } from '@/game/types';
import { VISUAL_TIERS } from '@/game/constants';
import { MAT as T } from './terrain';

export type Stage = 0 | 1 | 2;
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

/**
 * Этап стройки. Уже стоящее здание всегда показывается целиком: улучшение
 * не разбирает его обратно до площадки, а обносит лесами (см. scaffold).
 */
export function stageOf(b: Building): Stage {
  if (b.level > 0 || b.workRequired <= 0) return 2;
  return b.work / b.workRequired >= 0.35 ? 1 : 0;
}

/** Материалы зданий. Экспортируются, чтобы сезон мог красить крыши снегом. */
export const M = {
  wood: new THREE.MeshLambertMaterial({ color: 0x9a6a3a, flatShading: true }),
  woodDark: new THREE.MeshLambertMaterial({ color: 0x5e3b1f, flatShading: true }),
  plank: new THREE.MeshLambertMaterial({ color: 0xbb8f5e, flatShading: true }),
  timber: new THREE.MeshLambertMaterial({ color: 0x7a5330, flatShading: true }),
  thatch: new THREE.MeshLambertMaterial({ color: 0xc9a35a, flatShading: true }),
  thatchDark: new THREE.MeshLambertMaterial({ color: 0xa8843f, flatShading: true }),
  shingle: new THREE.MeshLambertMaterial({ color: 0x4a4640, flatShading: true }),
  tile: new THREE.MeshLambertMaterial({ color: 0xb4553a, flatShading: true }),
  plaster: new THREE.MeshLambertMaterial({ color: 0xe0d6c2, flatShading: true }),
  hide: new THREE.MeshLambertMaterial({ color: 0xa87b52, flatShading: true }),
  stone: new THREE.MeshLambertMaterial({ color: 0x8f8a80, flatShading: true }),
  stoneDark: new THREE.MeshLambertMaterial({ color: 0x6e6a62, flatShading: true }),
  fire: new THREE.MeshBasicMaterial({ color: 0xff7a1a }),
  fireInner: new THREE.MeshBasicMaterial({ color: 0xffd25a }),
  forge: new THREE.MeshBasicMaterial({ color: 0xff6a1a }),
  soil: new THREE.MeshLambertMaterial({ color: 0x6b4a2e, flatShading: true }),
  sprout: new THREE.MeshLambertMaterial({ color: 0x7fc24f, flatShading: true }),
  goat: new THREE.MeshLambertMaterial({ color: 0xe8e0d0, flatShading: true }),
  paintRed: new THREE.MeshLambertMaterial({ color: 0xb8402e, flatShading: true }),
  paintBlue: new THREE.MeshLambertMaterial({ color: 0x2f6f9a, flatShading: true }),
  metal: new THREE.MeshLambertMaterial({ color: 0x55565a, flatShading: true }),
  gold: new THREE.MeshLambertMaterial({ color: 0xd8a83a, flatShading: true }),
  dark: new THREE.MeshLambertMaterial({ color: 0x241a12, flatShading: true }),
  ore: new THREE.MeshLambertMaterial({ color: 0xb87333, flatShading: true }),
  bone: new THREE.MeshLambertMaterial({ color: 0xe6dfc8, flatShading: true }),
};

/**
 * Из чего сложена постройка в этой эпохе. Одна таблица на все здания: переход
 * эпохи меняет материалы разом, и деревня перестраивается на глазах —
 * шкуры и жерди → солома → тёс → камень с дранкой → штукатурка с черепицей.
 */
export interface EraStyle {
  /** Стены и корпус. */
  wall: THREE.Material;
  /** Кровля. */
  roof: THREE.Material;
  /** Конёк, навесы, тень кровли. */
  roofDark: THREE.Material;
  /** Столбы, каркас, ограды. */
  post: THREE.Material;
  /** Отделка: краска, металл, золото. */
  accent: THREE.Material;
  /** Настил и основание. */
  floor: THREE.Material;
}

export const ERA_STYLE: Record<EraId, EraStyle> = {
  camp: { wall: M.woodDark, roof: M.hide, roofDark: M.hide, post: M.woodDark, accent: M.bone, floor: M.soil },
  stone: { wall: M.wood, roof: M.thatch, roofDark: M.thatchDark, post: M.woodDark, accent: M.stone, floor: M.soil },
  tribe: { wall: M.wood, roof: M.thatch, roofDark: M.thatchDark, post: M.timber, accent: M.paintRed, floor: M.soil },
  bronze: { wall: M.plank, roof: M.thatchDark, roofDark: M.timber, post: M.timber, accent: M.ore, floor: M.stone },
  iron: { wall: M.stone, roof: M.shingle, roofDark: M.stoneDark, post: M.timber, accent: M.metal, floor: M.stone },
  state: { wall: M.plaster, roof: M.tile, roofDark: M.stoneDark, post: M.stone, accent: M.gold, floor: M.stone },
};

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

function logsPile(g: THREE.Group): void {
  for (let i = 0; i < 3; i++) {
    const l = cyl(0.08, 0.08, 0.9, M.woodDark, 5, -0.3 + i * 0.2, 0.12 + (i === 1 ? 0.1 : 0), 0.4);
    l.rotation.z = Math.PI / 2;
    g.add(l);
  }
}

/** Четыре столба с обвязкой: и каркас стройки, и остов навеса. */
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

function campfire(st: EraStyle): THREE.Group {
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
  // Очаг обрастает вместе с посёлком: с бронзы вокруг него кладут каменный обод.
  const paved = st.floor === M.stone;
  if (paved) g.add(cyl(1.05, 1.05, 0.12, st.floor, 12, 0, 0.06, 0));
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 6), M.fire);
  flame.position.y = 0.5;
  flame.name = 'flame';
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 6), M.fireInner);
  inner.position.y = 0.4;
  inner.name = 'flameInner';
  g.add(flame, inner);
  return g;
}

function shelter(): THREE.Group {
  const g = new THREE.Group();
  // Навесы так и остались навесами: с них начинали, ими и остались.
  for (const [dx, dz, rot] of [
    [0, 0, 0],
    [1.5, 0.5, 0.7],
  ]) {
    const s = new THREE.Group();
    s.add(cyl(0.05, 0.06, 1.1, M.woodDark, 5, -0.7, 0.55, 0));
    s.add(cyl(0.05, 0.06, 1.1, M.woodDark, 5, 0.7, 0.55, 0));
    const roof = box(1.7, 0.06, 1.5, M.hide, 0, 0.75, -0.35);
    roof.rotation.x = -0.75;
    s.add(roof);
    s.position.set(dx, 0, dz);
    s.rotation.y = rot;
    g.add(s);
  }
  return g;
}

// ---------- Здания: три ступени на каждое ----------

/** Хижина: круглый сруб → сруб с пристройкой → усадьба с крыльцом и трубой. */
function hut(t: Tier, st: EraStyle): THREE.Group {
  const g = new THREE.Group();
  const r = [0.95, 1.2, 1.45][t];
  const h = [0.95, 1.3, 1.7][t];
  g.add(cyl(r, r * 1.05, h, st.wall, 8, 0, h / 2, 0));
  g.add(cone(r * 1.42, [1.1, 1.35, 1.6][t], st.roof, 8, 0, h + [0.55, 0.68, 0.8][t], 0));
  g.add(box(0.4, 0.65, 0.1, st.post, 0, 0.33, r * 1.02));
  if (t >= 1) {
    // Пристройка сбоку: дом перестаёт быть одной шайбой.
    const aw = r * 0.95;
    g.add(box(aw, h * 0.7, aw, st.wall, r * 1.05, h * 0.35, r * 0.5));
    const lean = box(aw * 1.4, 0.08, aw * 1.3, st.roofDark, r * 1.05, h * 0.78, r * 0.5);
    lean.rotation.z = -0.3;
    g.add(lean);
  }
  if (t === 2) {
    // Крыльцо и печная труба: силуэт читается как дом, а не как шалаш.
    for (const x of [-0.55, 0.55]) g.add(cyl(0.07, 0.08, 1.05, st.post, 5, x, 0.52, r * 1.45));
    g.add(box(1.6, 0.1, 1.0, st.roofDark, 0, 1.1, r * 1.5));
    g.add(cyl(0.17, 0.21, 1.0, st.accent, 6, -r * 0.55, h + 1.15, -r * 0.4));
  }
  return g;
}

/** Склад: амбар на сваях → амбар с пристройкой и бочками → длинный лабаз. */
function storage(t: Tier, st: EraStyle): THREE.Group {
  const g = new THREE.Group();
  const w = [1.5, 2.0, 2.7][t];
  const d = [1.3, 1.6, 1.9][t];
  const h = [0.9, 1.15, 1.4][t];
  for (const [x, z] of [
    [-w * 0.4, -d * 0.38],
    [w * 0.4, -d * 0.38],
    [-w * 0.4, d * 0.38],
    [w * 0.4, d * 0.38],
  ])
    g.add(cyl(0.06, 0.07, 0.5, st.post, 5, x, 0.25, z));
  g.add(box(w, h, d, st.wall, 0, 0.5 + h / 2, 0));
  gable(g, w * 1.2, d * 1.25, 0.5 + h, [0.16, 0.24, 0.3][t], st.roof);
  // Лестница ко входу — сразу видно, что амбар поднят над землёй.
  const ladder = box(0.4, 0.06, 0.9, st.post, 0, 0.32, d * 0.62);
  ladder.rotation.x = 0.55;
  g.add(ladder);
  if (t >= 1) {
    for (let i = 0; i < 3; i++) g.add(cyl(0.22, 0.2, 0.44, st.post, 8, -w * 0.55 - 0.25, 0.22, -0.5 + i * 0.5));
  }
  if (t === 2) {
    // Второй сруб и штабель ящиков: склад стал двором.
    g.add(box(w * 0.55, h * 0.75, d * 0.8, st.wall, w * 0.75, 0.4 + h * 0.37, -d * 0.15));
    g.add(box(w * 0.7, 0.09, d * 0.95, st.roofDark, w * 0.75, 0.4 + h * 0.78, -d * 0.15));
    for (let i = 0; i < 3; i++) g.add(box(0.42, 0.34, 0.42, st.post, 0.3 - i * 0.45, 0.17 + (i === 1 ? 0.34 : 0), d * 0.85));
  }
  return g;
}

/** Хранилище знаний: плиты под навесом → крытая палата → малый храм с колоннами. */
function knowledge(t: Tier, st: EraStyle): THREE.Group {
  const g = new THREE.Group();
  const r = [1.4, 1.7, 2.1][t];
  g.add(pad(r));
  g.add(cyl(r * 0.6, r * 0.68, [0.35, 0.5, 0.65][t], st.floor, 8, 0, [0.17, 0.25, 0.32][t], 0));
  g.add(box(0.22, 1.2, 0.7, M.stoneDark, -0.6, 0.95, -0.1));
  g.add(box(0.22, 1.0, 0.6, M.stoneDark, 0.55, 0.85, 0.2));
  if (t === 0) {
    g.add(cyl(0.06, 0.07, 1.5, st.post, 5, -0.85, 0.75, 0.75));
    g.add(cyl(0.06, 0.07, 1.5, st.post, 5, 0.85, 0.75, 0.75));
    const canopy = box(2.0, 0.06, 1.5, st.roof, 0, 1.55, 0.2);
    canopy.rotation.x = -0.14;
    g.add(canopy);
    for (let i = 0; i < 3; i++) g.add(box(0.3, 0.5, 0.05, st.roofDark, -0.3 + i * 0.3, 0.55, 0.35));
  } else {
    // Колоннада: чем дальше, тем больше здание похоже на палату, а не на навес.
    const n = t === 1 ? 4 : 6;
    const cr = t === 1 ? 1.15 : 1.45;
    const ch = t === 1 ? 1.8 : 2.4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4;
      g.add(cyl(0.11, 0.13, ch, st.post, 7, Math.cos(a) * cr, ch / 2 + 0.25, Math.sin(a) * cr));
    }
    g.add(box(cr * 2.4, 0.14, cr * 2.4, st.roofDark, 0, ch + 0.34, 0));
    if (t === 2) {
      g.add(cone(cr * 1.5, 0.9, st.roof, 6, 0, ch + 0.85, 0));
      // Стела с зарубками: у знания появился свой памятник.
      g.add(box(0.35, 1.8, 0.3, st.accent, 0, 1.15, 0));
    } else {
      gable(g, cr * 2.5, cr * 2.5, ch + 0.4, 0.35, st.roof);
    }
    for (let i = 0; i < 4; i++) g.add(box(0.28, 0.46, 0.05, M.bone, -0.5 + i * 0.34, 0.72, cr * 0.55));
  }
  return g;
}

/** Навес собирателей: один навес → навес с сушилами → торговые ряды. */
function gathering(t: Tier, st: EraStyle): THREE.Group {
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

/** Лесопилка: козлы под навесом → двойная пила → пильный двор со штабелями. */
function sawmill(t: Tier, st: EraStyle): THREE.Group {
  const g = new THREE.Group();
  const w = [1.8, 2.3, 2.9][t];
  g.add(pad(w * 0.85));
  for (const [x, z, h] of [
    [-w / 2.4, -0.9, 1.2 + t * 0.2],
    [w / 2.4, -0.9, 1.2 + t * 0.2],
    [-w / 2.4, -0.15, 1.0 + t * 0.2],
    [w / 2.4, -0.15, 1.0 + t * 0.2],
  ])
    g.add(cyl(0.06, 0.07, h, st.post, 5, x, h / 2, z));
  const roof = box(w, 0.08, 1.1 + t * 0.3, st.roof, 0, 1.15 + t * 0.2, -0.55);
  roof.rotation.x = 0.22;
  g.add(roof);
  // Козлы с бревном и диском: силуэт лесопилки узнаётся сверху.
  for (const bench of t === 2 ? [-0.55, 0.65] : [0]) {
    g.add(cyl(0.07, 0.08, 0.45, st.post, 5, bench - 0.45, 0.22, 0.6));
    g.add(cyl(0.07, 0.08, 0.45, st.post, 5, bench + 0.45, 0.22, 0.6));
    const log = cyl(0.18, 0.18, 1.4, M.wood, 6, bench, 0.52, 0.6);
    log.rotation.z = Math.PI / 2;
    g.add(log);
    const blade = cyl(0.32, 0.32, 0.04, M.metal, 12, bench + 0.2, 0.72, 0.6);
    blade.rotation.x = Math.PI / 2;
    g.add(blade);
  }
  for (let i = 0; i < 3 + t * 3; i++) {
    const l = cyl(0.09, 0.09, 0.8, M.woodDark, 5, -w / 2 - 0.15, 0.1 + Math.floor(i / 3) * 0.19, -0.6 + (i % 3) * 0.22);
    l.rotation.x = Math.PI / 2;
    g.add(l);
  }
  if (t === 2) {
    // Рама большой пилы: вертикаль, которую видно через всю деревню.
    frame(g, 0.9, 0.7, 2.4, st.post);
    g.add(box(0.8, 0.06, 0.1, M.metal, 0, 1.5, 0));
  }
  return g;
}

/** Каменоломня: уступы → выработка с воротом → большой карьер с краном. */
function quarry(t: Tier, st: EraStyle): THREE.Group {
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
function hunterHut(t: Tier, st: EraStyle): THREE.Group {
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
function mine(t: Tier, st: EraStyle): THREE.Group {
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
function workshop(t: Tier, st: EraStyle): THREE.Group {
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
function farm(t: Tier, st: EraStyle): THREE.Group {
  const g = new THREE.Group();
  const s = [2.6, 3.3, 4.0][t];
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
    // Овин у края поля: урожай теперь есть где сушить.
    g.add(box(1.5, 1.0, 1.1, st.wall, -s * 0.5 - 0.9, 0.5, s * 0.3));
    gable(g, 1.8, 1.4, 1.0, 0.3, st.roof, -s * 0.5 - 0.9, s * 0.3);
  }
  return g;
}

/** Загон: жердевая ограда → загон с навесом → скотный двор с хлевом. */
function pen(t: Tier, st: EraStyle): THREE.Group {
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

/** Тотем: столб → столб с обкладкой → капище из трёх столбов на помосте. */
function totem(t: Tier, st: EraStyle): THREE.Group {
  const g = new THREE.Group();
  const h = [1, 1.35, 1.7][t];
  const pole = (x: number, z: number, k: number): void => {
    g.add(cyl(0.3 * k, 0.35 * k, 0.8 * h, M.woodDark, 7, x, 0.4 * h, z));
    g.add(cyl(0.3 * k, 0.3 * k, 0.6 * h, M.paintRed, 7, x, 1.1 * h, z));
    g.add(cyl(0.3 * k, 0.3 * k, 0.6 * h, M.paintBlue, 7, x, 1.7 * h, z));
    g.add(cyl(0.3 * k, 0.3 * k, 0.5 * h, st.accent, 7, x, 2.25 * h, z));
    g.add(box(1.4 * k, 0.12, 0.3, M.paintRed, x, 2.4 * h, z));
  };
  if (t === 2) {
    g.add(cyl(1.9, 2.0, 0.25, st.floor, 10, 0, 0.12, 0));
    pole(0, -0.2, 1);
    pole(-1.0, 0.6, 0.65);
    pole(1.0, 0.6, 0.65);
    // Чаши с огнём по краям помоста.
    for (const x of [-1.5, 1.5]) {
      g.add(cyl(0.2, 0.14, 0.5, st.accent, 7, x, 0.5, -0.9));
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 5), M.fire);
      flame.position.set(x, 0.95, -0.9);
      g.add(flame);
    }
  } else {
    if (t === 1) {
      g.add(cyl(1.2, 1.3, 0.2, st.floor, 9, 0, 0.1, 0));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        g.add(cyl(0.09, 0.11, 0.6, M.woodDark, 5, Math.cos(a) * 1.05, 0.3, Math.sin(a) * 1.05));
      }
    }
    pole(0, 0, 1);
  }
  return g;
}

/** Башня: помост на сваях → рубленая вышка → каменная башня со стягом. */
function tower(t: Tier, st: EraStyle): THREE.Group {
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

/** Кузница: горн под навесом → кузница с трубой → кузнечный двор. */
function smithy(t: Tier, st: EraStyle): THREE.Group {
  const g = new THREE.Group();
  const w = [2.0, 2.5, 3.1][t];
  const d = [1.6, 1.9, 2.3][t];
  const h = [1.0, 1.25, 1.55][t];
  g.add(box(w, h, d, t === 0 ? M.stone : st.wall, 0, h / 2, 0));
  gable(g, w * 1.2, d * 1.3, h, 0.34 + t * 0.1, t === 0 ? M.thatchDark : st.roof);
  g.add(cyl(0.2, 0.25, 1.0 + t * 0.3, M.stoneDark, 6, w * 0.3, h + 0.5 + t * 0.15, -d * 0.2));
  // Горн светится: кузница видна и ночью.
  const forge = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.3), M.forge);
  forge.position.set(0, 0.15, d / 2 + 0.05);
  g.add(forge);
  g.add(box(0.55, 0.35, 0.35, M.metal, -w * 0.3, 0.18, d / 2 + 0.4));
  if (t >= 1) {
    // Наковальня на колоде и стойка с оружием.
    g.add(cyl(0.22, 0.24, 0.4, M.woodDark, 7, w * 0.4, 0.2, d / 2 + 0.5));
    g.add(box(0.42, 0.16, 0.2, M.metal, w * 0.4, 0.48, d / 2 + 0.5));
    for (let i = 0; i < 3; i++) g.add(cyl(0.03, 0.03, 1.0, st.accent, 4, -w * 0.5 + i * 0.17, 0.5, -d / 2 - 0.25));
  }
  if (t === 2) {
    g.add(cyl(0.2, 0.25, 1.5, M.stoneDark, 6, -w * 0.32, h + 0.75, -d * 0.2));
    g.add(box(w * 0.5, h * 0.6, d * 0.55, st.wall, -w * 0.72, h * 0.3, d * 0.3));
    g.add(box(w * 0.6, 0.09, d * 0.65, st.roofDark, -w * 0.72, h * 0.63, d * 0.3));
    // Закалочная колода.
    g.add(cyl(0.3, 0.32, 0.45, st.post, 8, w * 0.5, 0.22, -d * 0.45));
  }
  return g;
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
  return g;
}

/** Частокол — кольцо столбов вокруг поселения с воротами на юге. */
function palisade(stage: Stage, t: Tier, st: EraStyle): THREE.Group {
  const g = new THREE.Group();
  const R = 12.8;
  const n = 72;
  const frac = stage === 0 ? 0.15 : stage === 1 ? 0.55 : 1;
  const h = [1.6, 2.1, 2.6][t];
  for (let i = 0; i < n * frac; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 2 + 0.2; // ворота на юге (+z)
    if (Math.abs(((a - Math.PI / 2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.14) continue;
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    // Со второй ступени стену ставят на каменный цоколь — она читается как укрепление.
    if (t >= 1) g.add(box(1.15, 0.45, 0.5, M.stone, x, 0.22, z));
    const p = cyl(0.12, 0.14, h + (i % 3) * 0.15, st.post, 5, x, h / 2 + (t >= 1 ? 0.4 : 0), z);
    g.add(p);
  }
  if (stage === 2) {
    // Ворота: две башенки и перекладина, а на верхних ступенях — крыши и стяги.
    for (const x of [-0.9, 0.9]) {
      g.add(cyl(0.16, 0.18, h + 0.8, st.post, 6, x, (h + 0.8) / 2, R));
      if (t >= 1) {
        g.add(box(0.9, 0.9, 0.9, st.wall, x, h + 1.2, R));
        g.add(cone(0.8, 0.6, st.roof, 4, x, h + 1.95, R));
      }
    }
    g.add(box(2.2, 0.15, 0.2, M.wood, 0, h + 0.8, R));
    if (t === 2) g.add(box(1.0, 0.6, 0.04, st.accent, 0, h + 0.35, R + 0.12));
  }
  return g;
}

/** Основание здания на первой ступени. Растёт вместе с ступенью — см. footprintOf. */
export const FOOTPRINT: Partial<Record<BuildingTypeId, [number, number]>> = {
  hut: [1.6, 1.6],
  storage: [1.5, 1.3],
  knowledge: [1.8, 1.4],
  gathering: [1.4, 1.0],
  sawmill: [1.8, 1.4],
  quarry: [2.0, 1.7],
  hunter_hut: [1.6, 1.4],
  mine: [1.8, 1.6],
  workshop: [1.8, 1.6],
  farm: [2.6, 2.6],
  pen: [2.6, 2.6],
  totem: [0.8, 0.8],
  tower: [1.0, 1.0],
  smithy: [2.0, 1.6],
  shelter: [2.6, 1.4],
};

/** Во сколько раз ступень раздаёт основание — им меряются мишень тапа и леса. */
const TIER_SPREAD: [number, number, number] = [1, 1.22, 1.45];

export const footprintOf = (type: BuildingTypeId, tier: Tier = 0): [number, number] => {
  const [w, d] = FOOTPRINT[type] ?? [1.4, 1.4];
  const k = TIER_SPREAD[tier];
  return [w * k, d * k];
};

export function createBuildingGroup(type: BuildingTypeId, stage: Stage, tier: Tier, era: EraId): THREE.Group {
  const st = ERA_STYLE[era];
  if (type === 'campfire') return campfire(st);
  if (type === 'shelter') return shelter();
  if (type === 'palisade') return palisade(stage, tier, st);

  const g = new THREE.Group();
  const [w, d] = footprintOf(type, tier);
  if (stage === 0) {
    g.add(pad(Math.max(w, d) * 0.75));
    logsPile(g);
    return g;
  }
  if (stage === 1) {
    g.add(pad(Math.max(w, d) * 0.75));
    if (type === 'farm') g.add(box(w, 0.08, d, M.soil, 0, 0.04, 0));
    else frame(g, w, d, type === 'tower' ? 2.4 : 1.0, st.post);
    return g;
  }
  switch (type) {
    case 'hut':
      return hut(tier, st);
    case 'storage':
      return storage(tier, st);
    case 'knowledge':
      return knowledge(tier, st);
    case 'gathering':
      return gathering(tier, st);
    case 'sawmill':
      return sawmill(tier, st);
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
    case 'totem':
      return totem(tier, st);
    case 'tower':
      return tower(tier, st);
    case 'smithy':
      return smithy(tier, st);
    default:
      return g;
  }
}
