// Ландшафт: земля, лес, скалы, кусты, слоты под здания.
import * as THREE from 'three';

/** Край мира. Стена посёлка — 15.6, а за ней ещё полоса угодий и лес. */
export const WORLD_RADIUS = 24;

/**
 * Угодья вынесены за стену: внутри кольца теперь стоят сами постройки, а лес,
 * скалы и поля — там, куда за ними ходят. Вольный сбор ведёт жителей именно сюда.
 */
export const ZONES = {
  forest: new THREE.Vector3(13, 0, -12),
  rocks: new THREE.Vector3(-14, 0, -10),
  berries: new THREE.Vector3(15, 0, 7),
  hunting: new THREE.Vector3(0, 0, -19),
  fields: new THREE.Vector3(-14, 0, 8),
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

  // Лес.
  for (let i = 0; i < 26; i++) {
    const a = hash(i * 3) * Math.PI * 2;
    const r = 0.8 + hash(i * 7) * 5.2;
    const t = makeTree(0.9 + hash(i * 11) * 0.5, i);
    t.position.set(ZONES.forest.x + Math.cos(a) * r, 0, ZONES.forest.z + Math.sin(a) * r);
    root.add(t);
  }
  // Деревья по краю мира.
  for (let i = 0; i < 54; i++) {
    const a = (i / 54) * Math.PI * 2 + hash(i) * 0.15;
    const r = WORLD_RADIUS - 0.5 + hash(i * 5) * 2.5;
    const t = makeTree(0.8 + hash(i * 13) * 0.6, i);
    t.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    root.add(t);
  }
  // Скалы.
  for (let i = 0; i < 11; i++) {
    const a = hash(i * 17) * Math.PI * 2;
    const r = hash(i * 19) * 3.2;
    const rock = makeRock(0.8 + hash(i * 23) * 1.4);
    rock.position.x = ZONES.rocks.x + Math.cos(a) * r;
    rock.position.z = ZONES.rocks.z + Math.sin(a) * r;
    root.add(rock);
  }
  // Ягодные кусты.
  for (let i = 0; i < 9; i++) {
    const a = hash(i * 29) * Math.PI * 2;
    const r = hash(i * 31) * 2.6;
    const b = makeBush();
    b.position.set(ZONES.berries.x + Math.cos(a) * r, 0, ZONES.berries.z + Math.sin(a) * r);
    root.add(b);
  }
  return root;
}
