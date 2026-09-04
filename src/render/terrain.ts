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
//
// Земля — не плоский круг, а полярная сетка с мягким рельефом за расчисткой и
// пятнами травы в цвете вершин. Внутри расчистки она ровная (y = 0): здания,
// дороги, стена и бойцы стоят как стояли. Всё, что ставится снаружи, берёт
// высоту из groundHeight — чистой функции от координат, детерминированной по сиду.
import * as THREE from 'three';
import { CLEAR_EDGE, CLEAR_RADIUS, PLAZA_RADIUS, WALL_RADIUS, inCleared } from './plan';
import { KIT, LEGACY } from './materials';
import { GRASS_DARK_MUL, GRASS_LIGHT_MUL, WALL_TRAMPLE_MUL } from './palette';

/** Край мира. За зоной расчистки идёт полоса угодий, а по краю — сплошной лес. */
export const WORLD_RADIUS = 30;

/** Радиус диска земли: край уходит под туман и опускается вниз. */
export const GROUND_RADIUS = WORLD_RADIUS + 6;

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

/** Материалы окружения — из общего набора; цвета в palette.ts. */
export const MAT = LEGACY;

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

// ---------- Рельеф ----------

const smooth = (t: number): number => {
  const k = THREE.MathUtils.clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
};

/** Хеш по позиции, а не по индексу вершины: рельеф не зависит от сетки. */
function vhash(ix: number, iz: number): number {
  const x = Math.sin(ix * 127.1 + iz * 311.7 + 74.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Value-noise на целочисленной решётке, −1..1, сглаженная интерполяция. */
export function vnoise(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = vhash(ix, iz);
  const b = vhash(ix + 1, iz);
  const c = vhash(ix, iz + 1);
  const d = vhash(ix + 1, iz + 1);
  const v = a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  return v * 2 - 1;
}

/**
 * Высота земли. Внутри расчистки — ровно 0. За вырубкой — две октавы шума,
 * амплитуда растёт от края расчистки к поясу угодий; у края мира земля
 * приподнимается чашей, чтобы опушка закрывала горизонт.
 */
export function groundHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const d = r - CLEAR_RADIUS;
  if (d <= 0.5) return 0;
  const amp = smooth((d - 0.5) / (CLEAR_EDGE - 0.5)) * 0.35 + smooth((d - CLEAR_EDGE) / 3) * 0.15;
  const n = vnoise(x / 5.5, z / 5.5) + 0.4 * vnoise(x / 2.3 + 7, z / 2.3 + 3);
  const rim = smooth((r - (WORLD_RADIUS - 3)) / 7) * 1.4;
  return amp * n + rim;
}

/** Множитель цвета травы в точке: пятна, мелкий разброс, вытоптанность внутри стены. */
function groundTint(x: number, z: number, r: number): [number, number, number] {
  const w = 0.6 * vnoise(x / 3.2, z / 3.2) + 0.4 * vnoise(x / 1.4 + 11, z / 1.4 + 5);
  const t = THREE.MathUtils.clamp((w + 1) / 2, 0, 1);
  const j = 1 + 0.035 * (vhash(Math.round(x * 3), Math.round(z * 3)) - 0.5);
  const k = smooth((WALL_RADIUS + 1 - r) / (WALL_RADIUS + 1 - PLAZA_RADIUS));
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const patch = GRASS_DARK_MUL[i] + (GRASS_LIGHT_MUL[i] - GRASS_DARK_MUL[i]) * t;
    const trample = 1 + (WALL_TRAMPLE_MUL[i] - 1) * k;
    out[i] = patch * j * trample;
  }
  return out;
}

/** Радиусы колец сетки: внутри реже, на вырубке гуще (там рельеф), дальше опять реже. */
function ringRadii(): number[] {
  const out = [0];
  let r = 0;
  while (r < CLEAR_RADIUS) out.push((r += 1.4));
  while (r < CLEAR_RADIUS + CLEAR_EDGE + 3) out.push((r += 0.65));
  while (r < GROUND_RADIUS) out.push((r += 0.9));
  return out;
}

const SEGMENTS = 144;

/**
 * Полярная сетка земли, неиндексированная: цвет — по вершинам, свет — плоский по
 * граням (flatShading считает нормали производными, computeVertexNormals не нужен).
 * Вершины слегка сдвинуты по хешу, чтобы сетка не читалась как мишень.
 */
export function groundGeometry(): THREE.BufferGeometry {
  const radii = ringRadii();
  const rings = radii.length;
  const px = new Float32Array(rings * SEGMENTS);
  const pz = new Float32Array(rings * SEGMENTS);
  const py = new Float32Array(rings * SEGMENTS);
  const pc = new Float32Array(rings * SEGMENTS * 3);
  for (let i = 0; i < rings; i++) {
    const step = i === 0 ? 0 : radii[i] - radii[i - 1];
    for (let j = 0; j < SEGMENTS; j++) {
      const idx = i * SEGMENTS + j;
      const ja = i === 0 ? 0 : (vhash(i * 7, j * 13) - 0.5) * 0.35;
      const jr = i === 0 ? 0 : (vhash(i * 11, j * 17) - 0.5) * 0.3 * step;
      const a = ((j + ja) / SEGMENTS) * Math.PI * 2;
      const r = Math.max(0, radii[i] + jr);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      px[idx] = x;
      pz[idx] = z;
      // Последние кольца опускаются: край диска прячется в тумане, горизонтальной линии нет.
      py[idx] = groundHeight(x, z) - 2 * smooth((r - (GROUND_RADIUS - 2)) / 2);
      const [cr, cg, cb] = groundTint(x, z, r);
      pc[idx * 3] = cr;
      pc[idx * 3 + 1] = cg;
      pc[idx * 3 + 2] = cb;
    }
  }
  const pos: number[] = [];
  const col: number[] = [];
  const emit = (a: number, b: number, c: number): void => {
    for (const v of [a, b, c]) {
      pos.push(px[v], py[v], pz[v]);
      col.push(pc[v * 3], pc[v * 3 + 1], pc[v * 3 + 2]);
    }
  };
  // Центр — веер к первому кольцу (все вершины кольца 0 стоят в нуле, берём одну).
  for (let j = 0; j < SEGMENTS; j++) {
    const n = (j + 1) % SEGMENTS;
    emit(0, SEGMENTS + n, SEGMENTS + j);
  }
  for (let i = 1; i < rings - 1; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const n = (j + 1) % SEGMENTS;
      const a = i * SEGMENTS + j;
      const b = i * SEGMENTS + n;
      const c = (i + 1) * SEGMENTS + n;
      const d = (i + 1) * SEGMENTS + j;
      // Диагональ квада — по хешу: регулярная штриховка граней не должна читаться.
      if (vhash(i * 3, j * 5) < 0.5) {
        emit(a, c, d);
        emit(a, b, c);
      } else {
        emit(a, b, d);
        emit(b, c, d);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Только земля, без окружения: стенд-витрина ставит на неё одно здание. */
export function buildGround(): THREE.Mesh {
  const ground = new THREE.Mesh(groundGeometry(), KIT.grass);
  ground.name = 'ground';
  ground.receiveShadow = true;
  return ground;
}

// ---------- Окружение ----------

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
 * получает вокруг себя чистое место. Объект садится на рельеф, чуть утопая.
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
  o.position.set(x, groundHeight(x, z) - 0.05, z);
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
  root.add(buildGround());
  root.add(buildEnvironment());
  return root;
}
