// Ландшафт вокруг поселения: земля, лес, скалы, ягодники и граница расчистки.
//
// Главное правило здесь одно: внутри зоны расчистки (plan.CLEAR_RADIUS) не стоит
// ничего. Ни дерева, ни камня, ни куста — только само поселение, его дороги и
// стена. Раньше лес подходил вплотную к кольцу будущего частокола и местами
// заходил на него: стену там было негде замкнуть.
//
// Расстановка осталась детерминированной по сиду — позиции считаются тем же
// хешем, что и прежде. Изменилось только то, что позиция внутри запретной зоны
// не двигается «куда-нибудь рядом», а просто отбрасывается: сдвиг ломал бы
// узнаваемый рисунок угодий и всё равно мог упереться в стену.
//
// По краю расчистки стоят следы работы — пни, поваленные стволы, срезанный
// подлесок. Без них граница читалась бы дырой в лесу, а не расчищенным местом.
import * as THREE from 'three';
import { CLEAR_EDGE, CLEAR_RADIUS, inCleared } from './plan';

/** Край мира. За зоной расчистки идёт полоса угодий, а по краю — сплошной лес. */
export const WORLD_RADIUS = 30;

/**
 * Угодья вынесены за зону расчистки: внутри кольца стоят сами постройки, а лес,
 * скалы и поля — там, куда за ними ходят. Вольный сбор ведёт жителей именно сюда.
 * Направления остались прежними, изменилось только расстояние от центра.
 */
export const ZONES = {
  forest: new THREE.Vector3(17.6, 0, -16.3),
  rocks: new THREE.Vector3(-19.5, 0, -13.9),
  berries: new THREE.Vector3(21.8, 0, 10.2),
  hunting: new THREE.Vector3(0, 0, -25),
  fields: new THREE.Vector3(-20.8, 0, 11.9),
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
  /** Свежий срез: пень и торец бревна светлее коры. */
  cut: new THREE.MeshLambertMaterial({ color: 0xc7a271, flatShading: true }),
};

/**
 * Габариты объектов окружения в плане: по ним точка отбрасывается, если крона
 * или камень зашли бы за границу расчистки. Числа сняты с самих моделей ниже.
 */
const TREE_SPREAD = 0.78;
const ROCK_SPREAD = 0.55;
const BUSH_SPREAD = 0.5;

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

// ---------- Граница расчистки ----------

/** Пень: срубленное дерево со светлым срезом. */
export function makeStump(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const h = 0.28 * scale;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * scale, 0.3 * scale, h, 7), MAT.trunk);
  body.position.y = h / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * scale, 0.22 * scale, 0.05, 7), MAT.cut);
  top.position.y = h;
  g.add(top);
  return g;
}

/** Поваленный ствол: лежит там, где его свалили, со срезанной верхушкой. */
export function makeLog(len = 1.6, seed = 0): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, len, 6), MAT.trunk);
  trunk.rotation.z = Math.PI / 2;
  trunk.position.y = 0.17;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  g.add(trunk);
  const cut = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.05, 6), MAT.cut);
  cut.rotation.z = Math.PI / 2;
  cut.position.set(len / 2, 0.17, 0);
  g.add(cut);
  g.rotation.y = hash(seed) * Math.PI * 2;
  return g;
}

/** Срезанный подлесок: низкая поросль, оставшаяся от вырубки. */
export function makeBrush(scale = 1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28 * scale, 0), MAT.grassDark);
  m.position.y = 0.16 * scale;
  m.scale.y = 0.55;
  m.receiveShadow = true;
  return m;
}

/**
 * Ставит объект, если точка вне зоны расчистки. Позиция внутри зоны просто
 * пропускается — так расстановка остаётся детерминированной по сиду, а посёлок
 * получает вокруг себя чистое место.
 */
function put(
  root: THREE.Group,
  make: () => THREE.Object3D,
  x: number,
  z: number,
  radius: number,
): void {
  // Габарит объекта учитывается: за черту не должна выходить и крона.
  if (inCleared(x, z, radius)) return;
  const o = make();
  o.position.x = x;
  o.position.z = z;
  root.add(o);
}

/**
 * Всё, что стоит вокруг поселения, одной группой. Земля в неё не входит:
 * тест зоны расчистки перебирает именно окружение, а земля лежит под всем.
 */
export function buildEnvironment(): THREE.Group {
  const root = new THREE.Group();
  root.name = 'environment';

  // Лес в своей зоне.
  for (let i = 0; i < 34; i++) {
    const a = hash(i * 3) * Math.PI * 2;
    const r = 0.8 + hash(i * 7) * 6.4;
    const scale = 0.9 + hash(i * 11) * 0.5;
    put(
      root,
      () => makeTree(scale, i),
      ZONES.forest.x + Math.cos(a) * r,
      ZONES.forest.z + Math.sin(a) * r,
      TREE_SPREAD * scale,
    );
  }
  // Сплошной лес по краю мира.
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2 + hash(i) * 0.12;
    const r = WORLD_RADIUS - 0.5 + hash(i * 5) * 2.5;
    const scale = 0.8 + hash(i * 13) * 0.6;
    put(root, () => makeTree(scale, i), Math.cos(a) * r, Math.sin(a) * r, TREE_SPREAD * scale);
  }
  // Скалы.
  for (let i = 0; i < 14; i++) {
    const a = hash(i * 17) * Math.PI * 2;
    const r = hash(i * 19) * 3.6;
    const scale = 0.8 + hash(i * 23) * 1.4;
    put(
      root,
      () => makeRock(scale),
      ZONES.rocks.x + Math.cos(a) * r,
      ZONES.rocks.z + Math.sin(a) * r,
      ROCK_SPREAD * scale,
    );
  }
  // Ягодные кусты.
  for (let i = 0; i < 11; i++) {
    const a = hash(i * 29) * Math.PI * 2;
    const r = hash(i * 31) * 3.0;
    put(root, makeBush, ZONES.berries.x + Math.cos(a) * r, ZONES.berries.z + Math.sin(a) * r, BUSH_SPREAD);
  }

  // Граница расчистки: полоса вырубки шириной CLEAR_EDGE сразу за запретной зоной.
  // Здесь племя брало лес на частокол, и это видно.
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2 + hash(i * 41) * 0.06;
    const r = CLEAR_RADIUS + 0.25 + hash(i * 43) * (CLEAR_EDGE - 0.4);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const kind = hash(i * 47);
    if (kind < 0.45) {
      const scale = 0.8 + hash(i * 53) * 0.7;
      put(root, () => makeStump(scale), x, z, 0.32 * scale);
    } else if (kind < 0.62) {
      const len = 1.2 + hash(i * 59) * 1.1;
      // Бревно лежит под случайным углом — считаем его как круг по полудлине.
      put(root, () => makeLog(len, i), x, z, len / 2 + 0.2);
    } else {
      const scale = 0.8 + hash(i * 61) * 0.9;
      put(root, () => makeBrush(scale), x, z, 0.3 * scale);
    }
  }
  return root;
}

export function buildTerrain(): THREE.Group {
  const root = new THREE.Group();

  // Земля с лёгкой неровностью. Внутри зоны расчистки её ровняют: посёлок стоит
  // на утоптанной площадке, а бугры начинаются за вырубкой.
  const geo = new THREE.CircleGeometry(WORLD_RADIUS + 3, 64);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.sqrt(x * x + z * z);
    const bump = r > CLEAR_RADIUS ? (hash(i) - 0.5) * 0.25 * Math.min(1, (r - CLEAR_RADIUS) / 4) : 0;
    pos.setY(i, bump);
  }
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, MAT.grass);
  ground.name = 'ground';
  ground.receiveShadow = true;
  root.add(ground);
  root.add(buildEnvironment());
  return root;
}
