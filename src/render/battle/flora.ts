/**
 * Модели луга и опушки ролика о бое (docs/graphics_world.md, 11.5): ель и дуб ближней формы, пучок травы,
 * цветок. Каждая — одна геометрия на все экземпляры. Взяты из окружения посёлка вида `next` дословно, когда
 * посёлок убрали (docs/city.md, «Город — единственный вид»): луг ролика — их единственный хозяин.
 *
 * ЦВЕТ ВЕРШИН — НЕ ЦВЕТ, А ТРИ ЧИСЛА (материал читает их сам, `battle/veg.ts`):
 *   r — затемнение: низ кроны и ствола темнее, верх светлее — объём без второй лампы;
 *   g — доля второго цвета: 0 — ствол, стебель; 1 — крона, колос;
 *   b — сколько вершина качается на ветру: 0 у земли, 1 у макушки.
 * Цвета же приходят из палитры через сезон: зимой крона белеет без единой строки здесь.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

/** Ближняя модель опушки ролика: ель — на высоком месте, дуб — на низком (`ground.woodsSpots`). */
export function treeModel(species: 'spruce' | 'oak'): THREE.BufferGeometry {
  return species === 'spruce' ? spruce() : oak();
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
