/**
 * Модели окружения: четыре породы деревьев (ближняя и дальняя форма), мелочь, пучок
 * травы, цветок, всход и пятно тени. Каждая — одна геометрия на все экземпляры.
 *
 * ЦВЕТ ВЕРШИН — НЕ ЦВЕТ, А ТРИ ЧИСЛА (материал читает их сам, `env/materials.ts`):
 *   r — затемнение: низ кроны и ствола темнее, верх светлее — объём без второй лампы;
 *   g — доля второго цвета: 0 — ствол, стебель, камень; 1 — крона, колос, мох сверху;
 *   b — сколько вершина качается на ветру: 0 у земли, 1 у макушки.
 * Цвета же приходят из палитры через сезон (`SeasonVisuals.color`): зимой крона белеет
 * без единой строки здесь.
 *
 * Бюджет треугольников — у каждой модели в заголовке; меняешь модель — перемерь
 * (`env/budget.test.ts` считает кадр по этим геометриям).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CLEAR_EDGE, CLEAR_RADIUS } from '../plan';
import { GROUND_RADIUS } from '../terrain';
import { FAR_RADIUS, envHeight, type PropKind, type Species } from './rules';

// ---------- Сборка ----------

/** Детерминированный шум для вершин: модели одинаковы при каждой сборке. */
function jit(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

interface Piece {
  geo: THREE.BufferGeometry;
  /** Затемнение от низа детали к верху. */
  ao: [number, number];
  /** Доля второго цвета: по высоте детали от и до (или постоянная). */
  tone: [number, number];
  /** Качание: по высоте во всей модели — считается после склейки. */
}

/** Деталь: геометрия уже на месте, неиндексированная, без uv. */
function piece(geo: THREE.BufferGeometry, ao: [number, number], tone: [number, number]): Piece {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  return { geo: g, ao, tone };
}

/**
 * Склеивает детали и запекает цвет вершин. `sway` — степень, в которую возводится
 * доля высоты: 2 — качается одна макушка, 1 — вся крона. `jitter` — сдвиг вершин
 * вдоль нормали сетки, в долях размера: low-poly без него читается штампом.
 */
function build(pieces: Piece[], opts: { sway: number; swayFrom?: number; jitter?: number; flat?: boolean }): THREE.BufferGeometry {
  let top = 0;
  for (const p of pieces) {
    p.geo.computeBoundingBox();
    top = Math.max(top, p.geo.boundingBox!.max.y);
  }
  for (const [pi, p] of pieces.entries()) {
    const pos = p.geo.attributes.position;
    const box = p.geo.boundingBox!;
    const h = Math.max(1e-6, box.max.y - box.min.y);
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      if (opts.jitter) {
        const k = opts.jitter;
        // Сдвиг по координатам самой вершины: у соседних граней общая вершина уезжает одинаково.
        const key = Math.round(pos.getX(i) * 97) * 31 + Math.round(pos.getY(i) * 89) * 17 + Math.round(pos.getZ(i) * 83);
        pos.setXYZ(i, pos.getX(i) + jit(key, 1 + pi) * k, pos.getY(i) + jit(key, 2 + pi) * k * 0.6, pos.getZ(i) + jit(key, 3 + pi) * k);
      }
      const t = THREE.MathUtils.clamp((pos.getY(i) - box.min.y) / h, 0, 1);
      const from = opts.swayFrom ?? 0;
      const sh = THREE.MathUtils.clamp((pos.getY(i) - from) / Math.max(1e-6, top - from), 0, 1);
      col[i * 3] = p.ao[0] + (p.ao[1] - p.ao[0]) * t;
      col[i * 3 + 1] = p.tone[0] + (p.tone[1] - p.tone[0]) * t;
      col[i * 3 + 2] = Math.pow(sh, opts.sway);
    }
    p.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    // Нормали здесь не нужны сетке с плоским затенением — их считает шейдер, — но
    // атрибут обязан быть одинаковым у всех деталей для склейки.
    p.geo.deleteAttribute('normal');
  }
  const merged = mergeGeometries(pieces.map((p) => p.geo), false);
  for (const p of pieces) p.geo.dispose();
  if (!merged) throw new Error('env: не склеились детали модели');
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

const at = (geo: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0): THREE.BufferGeometry =>
  geo.scale(sx, sy, sz).rotateY(ry).translate(x, y, z);

/**
 * Четырёхгранник — ягода. Своя сетка из четырёх граней, а не многогранник three:
 * имя нового класса дописалось бы в первую загрузку (docs/graphics_world.md, раздел 5).
 */
function tetra(r: number): THREE.BufferGeometry {
  const v = [
    [r, r, r],
    [-r, -r, r],
    [-r, r, -r],
    [r, -r, -r],
  ];
  const faces = [
    [0, 1, 2],
    [0, 3, 1],
    [0, 2, 3],
    [1, 3, 2],
  ];
  const pos: number[] = [];
  for (const f of faces) for (const i of f) pos.push(v[i][0], v[i][1], v[i][2]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

// ---------- Деревья ----------

/**
 * Ель: короткий ствол и три яруса конусов, каждый шире нижележащего и чуть сдвинут.
 * Донца конусов открыты — камера смотрит сверху, исподов не видно. ≈31 треугольник.
 */
function spruce(): THREE.BufferGeometry {
  const p: Piece[] = [piece(at(new THREE.CylinderGeometry(0.09, 0.14, 0.7, 5, 1, true), 0, 0.35, 0), [0.62, 0.9], [0, 0])];
  const tiers: [number, number, number][] = [
    [0.86, 1.25, 0.95],
    [0.66, 1.05, 1.6],
    [0.44, 0.95, 2.18],
  ];
  tiers.forEach(([r, h, y], i) => {
    p.push(piece(at(new THREE.ConeGeometry(r, h, 7, 1, true), jit(i, 7) * 0.06, y, jit(i, 8) * 0.06, 1, 1, 1, i * 0.45), [0.66, 1.04], [1, 1]));
  });
  return build(p, { sway: 2, swayFrom: 0.6, jitter: 0.07 });
}

/** Сосна: высокий голый ствол и две-три приплюснутые кроны наверху. ≈70 треугольников. */
function pine(): THREE.BufferGeometry {
  const p: Piece[] = [piece(at(new THREE.CylinderGeometry(0.07, 0.12, 2.1, 5, 1, true), 0, 1.05, 0), [0.7, 1.0], [0, 0])];
  const blobs: [number, number, number, number][] = [
    [0.0, 2.2, 0.0, 0.62],
    [0.32, 1.9, 0.12, 0.45],
    [-0.26, 2.0, -0.18, 0.42],
  ];
  blobs.forEach(([x, y, z, r], i) => {
    p.push(piece(at(new THREE.IcosahedronGeometry(r, 0), x, y, z, 1.25, 0.62, 1.25, i), [0.72, 1.05], [1, 1]));
  });
  return build(p, { sway: 2, swayFrom: 1.2, jitter: 0.05 });
}

/**
 * Дуб: толстый короткий ствол и широкая клубящаяся крона из пяти шаров — сверху она
 * читается купой, а не конусом. ≈112 треугольников: самая дорогая порода, зато
 * она и держит «лиственный» рисунок леса.
 */
function oak(): THREE.BufferGeometry {
  const p: Piece[] = [piece(at(new THREE.CylinderGeometry(0.11, 0.2, 1.0, 6, 1, true), 0, 0.5, 0), [0.62, 0.95], [0, 0])];
  const blobs: [number, number, number, number][] = [
    [0.0, 1.55, 0.0, 0.72],
    [0.5, 1.3, 0.18, 0.5],
    [-0.46, 1.35, -0.1, 0.52],
    [0.08, 1.3, -0.5, 0.48],
    [-0.1, 1.28, 0.5, 0.46],
  ];
  blobs.forEach(([x, y, z, r], i) => {
    p.push(piece(at(new THREE.IcosahedronGeometry(r, 0), x, y, z, 1, 0.82, 1, i * 0.7), [0.7, 1.05], [1, 1]));
  });
  return build(p, { sway: 1.5, swayFrom: 0.9, jitter: 0.06 });
}

/**
 * Берёза: тонкий белый ствол с тёмными поясками и узкая светлая крона из трёх
 * вытянутых шаров. Пояски — затемнением вершин: ствол из четырёх колец по высоте,
 * и чётные кольца темнее. ≈70 треугольников.
 */
function birch(): THREE.BufferGeometry {
  const trunk = at(new THREE.CylinderGeometry(0.055, 0.085, 1.6, 5, 4, true), 0, 0.8, 0);
  const tp = piece(trunk, [0.8, 1.0], [0, 0]);
  const p: Piece[] = [tp];
  const blobs: [number, number, number, number][] = [
    [0.0, 1.95, 0.0, 0.5],
    [0.2, 1.62, 0.1, 0.38],
    [-0.16, 1.7, -0.12, 0.36],
  ];
  blobs.forEach(([x, y, z, r], i) => {
    p.push(piece(at(new THREE.IcosahedronGeometry(r, 0), x, y, z, 0.85, 1.35, 0.85, i), [0.74, 1.06], [1, 1]));
  });
  const geo = build(p, { sway: 1.6, swayFrom: 0.9, jitter: 0.04 });
  // Пояски коры: вершины ствола (доля второго цвета — ноль) на нечётных кольцах темнее.
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    if (col.getY(i) > 0.01) continue;
    const ring = Math.round(pos.getY(i) / 0.4);
    if (ring % 2 === 1 && pos.getY(i) > 0.15) col.setX(i, col.getX(i) * 0.45);
  }
  return geo;
}

/**
 * Дальние формы: одна масса без ствола — на таком удалении ствол меньше пикселя,
 * а стоит дороже кроны. Ель и сосна — конус, дуб и берёза — один шар. 7–20 треугольников.
 */
function far(species: Species): THREE.BufferGeometry {
  switch (species) {
    case 'spruce':
      return build([piece(at(new THREE.ConeGeometry(0.9, 2.75, 7, 1, true), 0, 1.38, 0), [0.66, 1.04], [1, 1])], { sway: 2 });
    case 'pine':
      return build(
        [
          piece(at(new THREE.CylinderGeometry(0.08, 0.1, 1.6, 3, 1, true), 0, 0.8, 0), [0.7, 1.0], [0, 0]),
          piece(at(new THREE.IcosahedronGeometry(0.7, 0), 0, 2.05, 0, 1.3, 0.7, 1.3), [0.72, 1.05], [1, 1]),
        ],
        { sway: 2, swayFrom: 1.2 },
      );
    case 'oak':
      return build([piece(at(new THREE.IcosahedronGeometry(1.0, 0), 0, 1.35, 0, 1.08, 0.82, 1.08), [0.66, 1.05], [1, 1])], { sway: 1.5, swayFrom: 0.6 });
    case 'birch':
      return build([piece(at(new THREE.IcosahedronGeometry(0.58, 0), 0, 1.75, 0, 0.9, 1.45, 0.9), [0.72, 1.05], [1, 1])], { sway: 1.6, swayFrom: 0.8 });
  }
}

export function treeModel(species: Species, lod: 'near' | 'far'): THREE.BufferGeometry {
  if (lod === 'far') return far(species);
  switch (species) {
    case 'spruce':
      return spruce();
    case 'pine':
      return pine();
    case 'oak':
      return oak();
    case 'birch':
      return birch();
  }
}

// ---------- Мелочь ----------

/** Куст: три сплюснутых шара. Ягодный — с пятью ягодами (доля второго цвета — ноль). ≈60–100 треугольников. */
function bush(berries: boolean): THREE.BufferGeometry {
  const p: Piece[] = [];
  const blobs: [number, number, number, number][] = [
    [0, 0.3, 0, 0.42],
    [0.28, 0.24, 0.12, 0.3],
    [-0.24, 0.22, -0.14, 0.3],
  ];
  blobs.forEach(([x, y, z, r], i) => p.push(piece(at(new THREE.IcosahedronGeometry(r, 0), x, y, z, 1, 0.78, 1, i), [0.62, 1.05], [1, 1])));
  if (berries) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      p.push(piece(at(tetra(0.07), Math.cos(a) * 0.36, 0.34 + jit(i, 5) * 0.2, Math.sin(a) * 0.36), [1.05, 1.05], [0, 0]));
    }
  }
  return build(p, { sway: 1.2, jitter: 0.05 });
}

/**
 * Папоротник: шесть вай веером, каждая — две грани, выгнутые наружу и вниз. Рисуется
 * с обеих сторон. ≈24 треугольника.
 */
function fern(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const fronds = 6;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + jit(f, 11) * 0.4;
    const len = 0.5 + jit(f, 12) * 0.12;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const sx = -dz * 0.07;
    const sz = dx * 0.07;
    // Три точки по длине вайи: основание, середина (выше и шире), кончик (ниже).
    const pts: [number, number, number, number][] = [
      [0, 0.03, 0, 0],
      [len * 0.5, 0.32, 1.3, 0.55],
      [len, 0.14, 0, 1],
    ];
    for (let s = 0; s < 2; s++) {
      const [l0, y0, w0, t0] = pts[s];
      const [l1, y1, w1, t1] = pts[s + 1];
      const a0 = [dx * l0 + sx * w0, y0, dz * l0 + sz * w0];
      const b0 = [dx * l0 - sx * w0, y0, dz * l0 - sz * w0];
      const a1 = [dx * l1 + sx * w1, y1, dz * l1 + sz * w1];
      const b1 = [dx * l1 - sx * w1, y1, dz * l1 - sz * w1];
      for (const [v, t] of [
        [a0, t0],
        [b0, t0],
        [a1, t1],
        [b0, t0],
        [b1, t1],
        [a1, t1],
      ] as [number[], number][]) {
        pos.push(v[0], v[1], v[2]);
        col.push(0.72 + 0.34 * t, 0.35 + 0.65 * t, t);
      }
    }
  }
  return flatGeo(pos, col, true);
}

/**
 * Камень: додекаэдр с разъехавшимися вершинами и мхом (или снегом) сверху — доля
 * второго цвета растёт с высотой. ≈36 треугольников.
 */
function rock(): THREE.BufferGeometry {
  const geo = build([piece(at(new THREE.DodecahedronGeometry(0.5, 0), 0, 0.22, 0, 1, 0.72, 1), [0.64, 1.06], [0, 0])], { sway: 1, jitter: 0.1 });
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    col.setY(i, THREE.MathUtils.smoothstep(pos.getY(i), 0.28, 0.52));
    col.setZ(i, 0);
  }
  return geo;
}

/** Пень: срез светлый — доля второго цвета у верхнего донца. ≈21 треугольник. */
function stump(): THREE.BufferGeometry {
  const side = piece(at(new THREE.CylinderGeometry(0.22, 0.3, 0.3, 7, 1, true), 0, 0.15, 0), [0.62, 0.92], [0, 0]);
  const top = piece(new THREE.CircleGeometry(0.22, 7).rotateX(-Math.PI / 2).translate(0, 0.3, 0), [1, 1], [1, 1]);
  const geo = build([side, top], { sway: 1, jitter: 0.02 });
  const col = geo.attributes.color;
  for (let i = 0; i < col.count; i++) col.setZ(i, 0);
  return geo;
}

/** Поваленный ствол: лежит вдоль x, торцы светлые. ≈24 треугольника. */
function log(): THREE.BufferGeometry {
  const body = new THREE.CylinderGeometry(0.15, 0.18, 1.5, 6, 1, false);
  body.rotateZ(Math.PI / 2).translate(0, 0.16, 0);
  const g = piece(body, [0.7, 0.95], [0, 0]);
  const geo = build([g], { sway: 1, jitter: 0.02 });
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    // Торцы — грани, смотрящие вдоль ствола.
    col.setY(i, Math.abs(nrm.getX(i)) > 0.9 ? 1 : 0);
    col.setZ(i, 0);
  }
  return geo;
}

export function propModel(kind: PropKind): THREE.BufferGeometry {
  switch (kind) {
    case 'bush':
      return bush(false);
    case 'berry':
      return bush(true);
    case 'fern':
      return fern();
    case 'rock':
      return rock();
    case 'stump':
      return stump();
    case 'log':
      return log();
  }
}

// ---------- Покров ----------

/**
 * Плоская геометрия из списка вершин. `up` — нормали вверх: трава и листья освещаются
 * как земля под ними, а не по граням, иначе половина пучка смотрела бы в тень.
 */
function flatGeo(pos: number[], col: number[], up: boolean): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (up) {
    const n = new Float32Array(pos.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 1;
    geo.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  } else {
    geo.computeVertexNormals();
  }
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Пучок травы: пять травинок веером, каждая — один узкий треугольник с наклоном
 * наружу. Пять треугольников на пучок: травы много, и считать её надо в пучках.
 * `tall` — всход на пашне: выше, прямее, с колосом.
 */
export function tuftModel(tall = false): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const blades = tall ? 4 : 5;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + jit(b, tall ? 21 : 22) * 0.9;
    const lean = tall ? 0.05 : 0.12 + jit(b, 23) * 0.06;
    const h = (tall ? 0.42 : 0.26) * (0.8 + jit(b, 24) * 0.4);
    const w = tall ? 0.035 : 0.05;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const ox = dx * 0.04;
    const oz = dz * 0.04;
    pos.push(ox - dz * w, 0, oz + dx * w, ox + dz * w, 0, oz - dx * w, ox + dx * lean, h, oz + dz * lean);
    col.push(0.86, 0, 0, 0.86, 0, 0, 1.05, 1, 1);
  }
  return flatGeo(pos, col, true);
}

/**
 * Цветок: стебель — узкий треугольник, головка — венчик плашмя: сверху камеры головка
 * и видна. Цвет головки — цвет экземпляра. 7 треугольников.
 */
export function flowerModel(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const h = 0.24;
  pos.push(-0.012, 0, 0, 0.012, 0, 0, 0, h, 0);
  col.push(0.8, 0, 0, 0.8, 0, 0, 0.95, 0, 1);
  // Головка — шестигранный венчик с тёмной серединкой: сверху читается цветком, а не
  // квадратиком. Середина — доля второго цвета 0.55, то есть наполовину к стеблю.
  const r = 0.075;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const b = ((k + 1) / 6) * Math.PI * 2;
    pos.push(0, h + 0.01, 0, Math.cos(b) * r, h + 0.025, Math.sin(b) * r, Math.cos(a) * r, h + 0.025, Math.sin(a) * r);
    col.push(0.9, 0.55, 1, 1.05, 1, 1, 1.05, 1, 1);
  }
  return flatGeo(pos, col, true);
}

/**
 * Пятно тени: квадрат в плоскости земли, от −1 до 1. Круг и мягкий край рисует шейдер
 * (`env/materials.shadeMaterial`), там же пятно вытягивается от солнца.
 */
export function blobModel(): THREE.BufferGeometry {
  const pos = [-1, 0, -1, -1, 0, 1, 1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0, -1];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Земля пробы: полярная сетка, как у прежней (`terrain.groundGeometry`), — те же кольца
 * внутри прежнего мира, чтобы дома и дороги стояли на той же земле, — и дальше до
 * `FAR_RADIUS` реже и крупнее: там холмы, и их всё равно съедает дымка. Край не
 * опускается обрывом — последнее кольцо уходит под туман. Цвет земли — в шейдере
 * (`env/materials.groundMaterial`), вершинам цвет не нужен.
 */
export function groundModel(): THREE.BufferGeometry {
  const radii = [0];
  let r = 0;
  while (r < CLEAR_RADIUS) radii.push((r += 1.4));
  while (r < CLEAR_RADIUS + CLEAR_EDGE + 3) radii.push((r += 0.65));
  while (r < GROUND_RADIUS) radii.push((r += 0.9));
  let step = 1.4;
  while (r < FAR_RADIUS) {
    radii.push((r += step));
    step = Math.min(5.5, step * 1.14);
  }
  const SEG = 144;
  const rings = radii.length;
  const px = new Float32Array(rings * SEG);
  const py = new Float32Array(rings * SEG);
  const pz = new Float32Array(rings * SEG);
  for (let i = 0; i < rings; i++) {
    const stepR = i === 0 ? 0 : radii[i] - radii[i - 1];
    for (let j = 0; j < SEG; j++) {
      const k = i * SEG + j;
      // Вершины чуть сдвинуты хешем — сетка не читается мишенью.
      const a = ((j + (i === 0 ? 0 : jit(i * 7 + j * 13, 31) * 0.35)) / SEG) * Math.PI * 2;
      const rr = Math.max(0, radii[i] + (i === 0 ? 0 : jit(i * 11 + j * 17, 32) * 0.3 * stepR));
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      px[k] = x;
      pz[k] = z;
      py[k] = envHeight(x, z) - (i === rings - 1 ? 3 : 0);
    }
  }
  const pos: number[] = [];
  const emit = (...ids: number[]): void => {
    for (const v of ids) pos.push(px[v], py[v], pz[v]);
  };
  for (let j = 0; j < SEG; j++) emit(0, SEG + ((j + 1) % SEG), SEG + j);
  for (let i = 1; i < rings - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const n = (j + 1) % SEG;
      const a = i * SEG + j;
      const b = i * SEG + n;
      const c = (i + 1) * SEG + n;
      const d = (i + 1) * SEG + j;
      if (jit(i * 3 + j * 5, 33) < 0) emit(a, c, d, a, b, c);
      else emit(a, b, d, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** Сколько треугольников в геометрии — для бюджета кадра. */
export const trianglesOf = (geo: THREE.BufferGeometry): number => (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
