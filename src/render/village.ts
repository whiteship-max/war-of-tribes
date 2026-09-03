// Обстановка посёлка: площадь с колодцем, дороги, размеченные пустые площадки и декор.
//
// Всё это строится из плана (plan.ts), а не из того, где оказались здания: дороги
// не переезжают, когда посёлок растёт. Меняется только покрытие — тропинка,
// утоптанная земля, мощёный камень — и то, сколько на пустых местах добра.
import * as THREE from 'three';
import type { BuildingTypeId, EraId, StageId } from '@/game/types';
import { STAGE_ORDER } from '@/game/data/stages';
import { MAT as T } from './terrain';
import { M } from './buildings';
import {
  GATE_ANGLE,
  GATE_ROAD,
  OUTER_ROAD,
  PLAN,
  PLAZA_RADIUS,
  PLAZA_ROAD,
  RING_RADIUS,
  ROAD_HALF,
  ROAD_THROUGH,
  SPARE_PLOTS,
  plotRadius,
  spotAt,
  spurFor,
} from './plan';

/** Свои материалы обстановки: земля дорог, мостовая, разметка площадки. */
export const VILLAGE_MAT = {
  /** Утоптанная земля — шире и темнее тропинки. */
  packed: new THREE.MeshLambertMaterial({ color: 0x7d6244, flatShading: true }),
  /** Мощёный камень поздних стадий. */
  paved: new THREE.MeshLambertMaterial({ color: 0x9a978f, flatShading: true }),
  /** Разметка пустого места: голая земля под будущий двор. */
  plot: new THREE.MeshLambertMaterial({ color: 0x87714f, flatShading: true }),
  /** Колышки разметки и жерди загородок. */
  stake: new THREE.MeshLambertMaterial({ color: 0x6b4426, flatShading: true }),
  barrel: new THREE.MeshLambertMaterial({ color: 0x8a6136, flatShading: true }),
  cloth: new THREE.MeshLambertMaterial({ color: 0xc7b28a, flatShading: true }),
};

/**
 * Покрытие дороги растёт вместе с поселением: тропинка в лагере, утоптанная
 * земля в деревне, мощёный камень в городе. Одно правило на все дороги сразу.
 */
function roadMaterial(stage: StageId): THREE.Material {
  const i = STAGE_ORDER.indexOf(stage);
  if (i >= 4) return VILLAGE_MAT.paved;
  if (i >= 2) return VILLAGE_MAT.packed;
  return T.dirt;
}

/** Ширина дороги растёт со стадией: тропинка → улица → мостовая. */
function roadWidth(stage: StageId): number {
  const i = STAGE_ORDER.indexOf(stage);
  return ROAD_HALF * (i <= 1 ? 1.0 : i === 2 ? 1.5 : 1.9);
}

const flat = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number): THREE.Mesh => {
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  m.receiveShadow = true;
  return m;
};

/** Кольцевая дорога. */
function roadRing(r: number, half: number, mat: THREE.Material, y: number): THREE.Mesh {
  return flat(new THREE.RingGeometry(Math.max(0.05, r - half), r + half, 64), mat, y);
}

/** Прямой отрезок дороги вдоль радиуса. */
function roadSpur(angle: number, from: number, to: number, half: number, mat: THREE.Material, y: number): THREE.Mesh {
  const len = Math.abs(to - from);
  const mid = (from + to) / 2;
  const m = flat(new THREE.PlaneGeometry(half * 2, len), mat, y);
  m.position.set(Math.cos(angle) * mid, y, Math.sin(angle) * mid);
  m.rotation.z = -angle + Math.PI / 2;
  return m;
}

/** Детерминированный шум: декор не должен прыгать при каждой пересборке. */
function hash(i: number): number {
  const x = Math.sin(i * 91.7 + 47.3) * 43758.5453;
  return x - Math.floor(x);
}

// ---------- Декор ----------

function woodpile(seed: number): THREE.Group {
  const g = new THREE.Group();
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3; i++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.85, 5), M.woodDark);
      l.rotation.z = Math.PI / 2;
      l.position.set(0, 0.09 + row * 0.17, -0.19 + i * 0.19 + (row % 2) * 0.05);
      l.castShadow = true;
      g.add(l);
    }
  }
  g.rotation.y = hash(seed) * Math.PI;
  return g;
}

function barrels(seed: number): THREE.Group {
  const g = new THREE.Group();
  const n = 2 + Math.floor(hash(seed) * 3);
  for (let i = 0; i < n; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.18, 0.45, 8), VILLAGE_MAT.barrel);
    const a = (i / n) * Math.PI * 2 + hash(seed + i);
    b.position.set(Math.cos(a) * 0.32, 0.22, Math.sin(a) * 0.32);
    b.castShadow = true;
    g.add(b);
  }
  return g;
}

function cart(seed: number): THREE.Group {
  const g = new THREE.Group();
  g.add(meshAt(new THREE.BoxGeometry(1.1, 0.3, 0.6), M.wood, 0, 0.4, 0));
  for (const x of [-0.4, 0.4]) {
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.07, 10), M.woodDark);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.26, 0.33);
    wheel.castShadow = true;
    g.add(wheel);
  }
  g.add(meshAt(new THREE.BoxGeometry(0.08, 0.08, 0.8), M.woodDark, 0, 0.42, -0.6));
  g.rotation.y = hash(seed) * Math.PI * 2;
  return g;
}

/** Сушила: жерди с растянутыми шкурами и холстом. */
function dryingRack(seed: number): THREE.Group {
  const g = new THREE.Group();
  for (const x of [-0.6, 0.6]) g.add(meshAt(new THREE.CylinderGeometry(0.05, 0.06, 1.1, 5), VILLAGE_MAT.stake, x, 0.55, 0));
  g.add(meshAt(new THREE.BoxGeometry(1.3, 0.06, 0.06), VILLAGE_MAT.stake, 0, 1.05, 0));
  g.add(meshAt(new THREE.BoxGeometry(0.5, 0.55, 0.03), hash(seed) > 0.5 ? M.hide : VILLAGE_MAT.cloth, -0.28, 0.72, 0));
  g.add(meshAt(new THREE.BoxGeometry(0.4, 0.45, 0.03), VILLAGE_MAT.cloth, 0.3, 0.77, 0));
  g.rotation.y = hash(seed + 3) * Math.PI;
  return g;
}

/** Загородка с козой: посёлок обжитой, в нём есть живность. */
function paddock(seed: number): THREE.Group {
  const g = new THREE.Group();
  const s = 0.85;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    g.add(meshAt(new THREE.CylinderGeometry(0.05, 0.06, 0.6, 4), VILLAGE_MAT.stake, Math.cos(a) * s, 0.3, Math.sin(a) * s));
  }
  for (const [w, x, z, rot] of [
    [2 * s, 0, -s, 0],
    [2 * s, 0, s, 0],
    [2 * s, -s, 0, Math.PI / 2],
    [2 * s, s, 0, Math.PI / 2],
  ] as [number, number, number, number][]) {
    const rail = meshAt(new THREE.BoxGeometry(w, 0.05, 0.05), VILLAGE_MAT.stake, x, 0.42, z);
    rail.rotation.y = rot;
    g.add(rail);
  }
  const goat = new THREE.Group();
  goat.add(meshAt(new THREE.BoxGeometry(0.4, 0.25, 0.2), M.goat, 0, 0.28, 0));
  goat.add(meshAt(new THREE.BoxGeometry(0.16, 0.16, 0.15), M.goat, 0.24, 0.4, 0));
  goat.rotation.y = hash(seed) * Math.PI * 2;
  g.add(goat);
  return g;
}

function meshAt(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Колодец на площади — вторая после костра примета обжитого центра. */
function well(era: EraId): THREE.Group {
  const g = new THREE.Group();
  const stone = era === 'iron' || era === 'state' || era === 'bronze';
  g.add(meshAt(new THREE.CylinderGeometry(0.52, 0.56, 0.5, 10), stone ? M.stone : M.woodDark, 0, 0.25, 0));
  g.add(meshAt(new THREE.CylinderGeometry(0.44, 0.44, 0.08, 10), M.dark, 0, 0.5, 0));
  for (const x of [-0.5, 0.5]) g.add(meshAt(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 5), M.woodDark, x, 0.85, 0));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.45, 4), stone ? M.shingle : M.thatch);
  roof.position.y = 1.6;
  roof.castShadow = true;
  g.add(roof);
  // Ворот и ведро.
  const drum = meshAt(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 6), M.wood, 0, 1.18, 0);
  drum.rotation.z = Math.PI / 2;
  g.add(drum);
  g.add(meshAt(new THREE.CylinderGeometry(0.13, 0.11, 0.22, 7), M.woodDark, 0, 0.72, 0));
  return g;
}

/** Что поставить на пустом месте. Чем крупнее посёлок, тем гуще обстановка. */
function decorFor(index: number, stage: StageId): THREE.Group | null {
  const step = STAGE_ORDER.indexOf(stage);
  if (step === 0 && index % 2 === 0) return null; // в лагере места ещё просто размечены
  const kinds = [woodpile, barrels, cart, dryingRack, paddock];
  const pick = kinds[Math.floor(hash(index * 7.3) * kinds.length)];
  return pick(index);
}

/**
 * Размеченная площадка: обод вытоптанной земли и колышки по углам. Именно обод,
 * а не залитый круг — иначе пустой посёлок читается как поле воронок, а не как
 * размеченное под застройку место.
 */
function markedPlot(r: number, seed: number): THREE.Group {
  const g = new THREE.Group();
  g.add(flat(new THREE.RingGeometry(r * 0.78, r, 20), VILLAGE_MAT.plot, 0.035));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4 + hash(seed) * 0.3;
    g.add(meshAt(new THREE.CylinderGeometry(0.05, 0.06, 0.42, 4), VILLAGE_MAT.stake, Math.cos(a) * r * 0.89, 0.21, Math.sin(a) * r * 0.89));
  }
  return g;
}

export interface VillageOptions {
  stage: StageId;
  era: EraId;
  /** Типы зданий, которые уже стоят (или строятся) — к ним ведут дороги. */
  present: BuildingTypeId[];
}

/**
 * Собирает всю обстановку разом. Пересобирается редко — только когда меняется
 * стадия, эпоха или набор построек, — поэтому дешевле держать её одной группой,
 * чем следить за каждой дорожкой по отдельности.
 */
export function buildVillage({ stage, era, present }: VillageOptions): THREE.Group {
  const root = new THREE.Group();
  // Всё объёмное — колодец, разметка площадок, поленницы и телеги — лежит в своей
  // группе. Дороги и мостовая остаются в корне: они плоские и под стену заходить
  // им можно, а декору — нет (это проверяет тест зоны расчистки).
  const decor = new THREE.Group();
  decor.name = 'decor';
  root.add(decor);
  const mat = roadMaterial(stage);
  const half = roadWidth(stage);
  const has = new Set(present);

  // Площадь: утоптанный круг под костром, к поздним стадиям — мощёный.
  root.add(flat(new THREE.CircleGeometry(PLAZA_RADIUS + 0.5, 32), mat, 0.03));
  const wellSpot = spotAt(1.55, GATE_ANGLE + Math.PI * 0.62);
  const w = well(era);
  w.position.set(wellSpot.x, 0, wellSpot.z);
  decor.add(w);

  // Дороги плана. Окружная появляется, когда есть кому по ней ходить.
  root.add(roadRing(PLAZA_ROAD, half, mat, 0.045));
  const outerNeeded = [...has].some((type) => PLAN[type]?.ring === 3);
  if (outerNeeded) root.add(roadRing(OUTER_ROAD, half, mat, 0.045));
  // Пока стены нет, улице некуда вести: доводим её до окружной, а не в чистое поле.
  const gateTo = has.has('palisade') ? GATE_ROAD.to : OUTER_ROAD;
  root.add(roadSpur(GATE_ROAD.angle, GATE_ROAD.from, gateTo, half, mat, 0.05));
  for (const type of present) {
    const spur = spurFor(type);
    if (spur) root.add(roadSpur(spur.angle, spur.from, spur.to, half * 0.8, mat, 0.05));
  }

  // Пустые места: размеченные площадки, которые обрастают добром.
  let seed = 0;
  const empty: { r: number; angle: number; plot: number; onRoad: boolean }[] = [];
  for (const [type, place] of Object.entries(PLAN) as [BuildingTypeId, { ring: 1 | 2 | 3; angle: number }][]) {
    if (has.has(type)) continue;
    empty.push({
      r: RING_RADIUS[place.ring],
      angle: place.angle,
      plot: plotRadius(type),
      onRoad: ROAD_THROUGH.includes(type),
    });
  }
  for (const place of SPARE_PLOTS) {
    empty.push({ r: RING_RADIUS[place.ring], angle: place.angle, plot: 1.5, onRoad: false });
  }
  for (const e of empty) {
    seed++;
    const spot = spotAt(e.r, e.angle);
    const g = markedPlot(Math.min(2.2, e.plot * 0.85), seed);
    g.position.set(spot.x, 0, spot.z);
    decor.add(g);
    const d = decorFor(seed, stage);
    if (!d) continue;
    if (e.onRoad) {
      // Место рынка стоит на воротной улице: добро сдвигаем на обочину, иначе
      // телега поедет сквозь бочки, а загон встанет поперёк проезда.
      const side = hash(seed * 5.9) > 0.5 ? 1 : -1;
      const off = side * (ROAD_HALF * 2 + 0.7 + hash(seed * 3.1) * 0.5);
      d.position.set(spot.x - Math.sin(e.angle) * off, 0, spot.z + Math.cos(e.angle) * off);
    } else {
      const off = hash(seed * 3.1) * 0.6 - 0.3;
      d.position.set(spot.x + off, 0, spot.z + off * 0.7);
    }
    decor.add(d);
  }

  return root;
}
