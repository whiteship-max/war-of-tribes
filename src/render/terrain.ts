// Ландшафт: земля, лес, скалы, кусты, слоты под здания.
import * as THREE from 'three';

export const WORLD_RADIUS = 15.5;

export const ZONES = {
  forest: new THREE.Vector3(9, 0, -8),
  rocks: new THREE.Vector3(-9.5, 0, -7),
  berries: new THREE.Vector3(10, 0, 5),
  hunting: new THREE.Vector3(0, 0, -13),
  fields: new THREE.Vector3(-9.2, 0, 5.2),
};

export const MAT = {
  grass: new THREE.MeshLambertMaterial({ color: 0x6f9548, flatShading: true }),
  grassDark: new THREE.MeshLambertMaterial({ color: 0x5b7f3c, flatShading: true }),
  dirt: new THREE.MeshLambertMaterial({ color: 0x8a6a45, flatShading: true }),
  trunk: new THREE.MeshLambertMaterial({ color: 0x6b4426, flatShading: true }),
  leaves: new THREE.MeshLambertMaterial({ color: 0x3f7a3a, flatShading: true }),
  leaves2: new THREE.MeshLambertMaterial({ color: 0x4f8f40, flatShading: true }),
  rock: new THREE.MeshLambertMaterial({ color: 0x8f8a80, flatShading: true }),
  bush: new THREE.MeshLambertMaterial({ color: 0x4c8a45, flatShading: true }),
  berry: new THREE.MeshLambertMaterial({ color: 0xc23a5a, flatShading: true }),
};

/** Детерминированный шум для расстановки деревьев. */
function hash(i: number): number {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function makeTree(scale = 1, variant = 0): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * scale, 0.18 * scale, 0.8 * scale, 5), MAT.trunk);
  trunk.position.y = 0.4 * scale;
  trunk.castShadow = true;
  g.add(trunk);
  const mat = variant % 2 === 0 ? MAT.leaves : MAT.leaves2;
  const c1 = new THREE.Mesh(new THREE.ConeGeometry(0.75 * scale, 1.3 * scale, 6), mat);
  c1.position.y = 1.3 * scale;
  c1.castShadow = true;
  g.add(c1);
  const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.55 * scale, 1.0 * scale, 6), mat);
  c2.position.y = 2.0 * scale;
  c2.castShadow = true;
  g.add(c2);
  return g;
}

export function makeRock(scale = 1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.5 * scale, 0), MAT.rock);
  m.position.y = 0.3 * scale;
  m.rotation.set(hash(scale * 10) * 3, hash(scale * 20) * 3, 0);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function makeBush(): THREE.Group {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), MAT.bush);
  b.position.y = 0.35;
  b.castShadow = true;
  g.add(b);
  for (let i = 0; i < 4; i++) {
    const berry = new THREE.Mesh(new THREE.SphereGeometry(0.07, 5, 4), MAT.berry);
    const a = (i / 4) * Math.PI * 2;
    berry.position.set(Math.cos(a) * 0.35, 0.4 + hash(i) * 0.3, Math.sin(a) * 0.35);
    g.add(berry);
  }
  return g;
}

export function buildTerrain(): THREE.Group {
  const root = new THREE.Group();

  // Земля с лёгкой неровностью.
  const geo = new THREE.CircleGeometry(WORLD_RADIUS + 3, 64);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.sqrt(x * x + z * z);
    const bump = r > 3 ? (hash(i) - 0.5) * 0.25 * Math.min(1, (r - 3) / 4) : 0;
    pos.setY(i, bump);
  }
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, MAT.grass);
  ground.receiveShadow = true;
  root.add(ground);

  // Утоптанная площадка у костра.
  const pad = new THREE.Mesh(new THREE.CircleGeometry(3.2, 24), MAT.dirt);
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = 0.02;
  pad.receiveShadow = true;
  root.add(pad);

  // Лес.
  for (let i = 0; i < 16; i++) {
    const a = hash(i * 3) * Math.PI * 2;
    const r = 0.8 + hash(i * 7) * 3.6;
    const t = makeTree(0.9 + hash(i * 11) * 0.5, i);
    t.position.set(ZONES.forest.x + Math.cos(a) * r, 0, ZONES.forest.z + Math.sin(a) * r);
    root.add(t);
  }
  // Деревья по краю мира.
  for (let i = 0; i < 34; i++) {
    const a = (i / 34) * Math.PI * 2 + hash(i) * 0.15;
    const r = WORLD_RADIUS - 0.5 + hash(i * 5) * 2.5;
    const t = makeTree(0.8 + hash(i * 13) * 0.6, i);
    t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    root.add(t);
  }
  // Скалы.
  for (let i = 0; i < 7; i++) {
    const a = hash(i * 17) * Math.PI * 2;
    const r = hash(i * 19) * 2.2;
    const rock = makeRock(0.8 + hash(i * 23) * 1.4);
    rock.position.x = ZONES.rocks.x + Math.cos(a) * r;
    rock.position.z = ZONES.rocks.z + Math.sin(a) * r;
    root.add(rock);
  }
  // Ягодные кусты.
  for (let i = 0; i < 6; i++) {
    const a = hash(i * 29) * Math.PI * 2;
    const r = hash(i * 31) * 1.8;
    const b = makeBush();
    b.position.set(ZONES.berries.x + Math.cos(a) * r, 0, ZONES.berries.z + Math.sin(a) * r);
    root.add(b);
  }
  return root;
}

export interface Slot {
  x: number;
  z: number;
  rot: number;
}

/**
 * Кольца рассчитаны на самую крупную визуальную ступень: к десятому уровню
 * постройка вырастает почти вдвое, и хорда между соседними слотами должна её вмещать.
 */
const RINGS = [
  { r: 5.4, n: 6, offset: 0.4 },
  { r: 8.4, n: 8, offset: 0.1 },
  { r: 11.2, n: 10, offset: 0.25 },
];

/** Слоты для зданий: кольца вокруг костра. Ближнее кольцо всегда в кадре телефона. */
export function ringSlot(i: number): Slot {
  let idx = i;
  for (const ring of RINGS) {
    if (idx < ring.n) {
      const a = (idx / ring.n) * Math.PI * 2 + ring.offset;
      return { x: Math.cos(a) * ring.r, z: Math.sin(a) * ring.r, rot: -a + Math.PI / 2 };
    }
    idx -= ring.n;
  }
  const a = idx * 0.9;
  return { x: Math.cos(a) * 12, z: Math.sin(a) * 12, rot: -a + Math.PI / 2 };
}

/**
 * Слот ближнего кольца, смотрящий на ресурсную зону: лесопилка встаёт со стороны леса,
 * каменоломня — со стороны скал. Своего радиуса у зданий добычи нет специально —
 * иначе они уезжали бы за кадр, а панель здания открывается тапом по нему.
 */
export function ringIndexToward(zone: THREE.Vector3): number {
  const target = Math.atan2(zone.z, zone.x);
  const { n, offset } = RINGS[0];
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + offset;
    const d = Math.abs(Math.atan2(Math.sin(target - a), Math.cos(target - a)));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Ресурсная зона здания добычи: там оно и стоит, туда же ходят его рабочие. */
export const BUILDING_ZONE: Record<string, THREE.Vector3> = {
  sawmill: ZONES.forest,
  quarry: ZONES.rocks,
  mine: ZONES.rocks,
  gathering: ZONES.berries,
  hunter_hut: ZONES.hunting,
};

/** Слот укрытия — рядом с костром. Укрытие в посёлке одно, и оно двойное. */
export function shelterSlot(i: number): Slot {
  const a = i === 0 ? 3.8 : 5.4;
  return { x: Math.cos(a) * 3.1, z: Math.sin(a) * 3.1, rot: -a + Math.PI / 2 };
}

/** Слот под поле — пашня на западе, за кольцами застройки. */
export function farmSlot(i: number): Slot {
  return { x: ZONES.fields.x - (i % 2) * 3.6, z: ZONES.fields.z + Math.floor(i / 2) * 3.6, rot: 0 };
}
