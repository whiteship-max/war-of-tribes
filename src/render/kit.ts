// Набор деталей — им собирает свои модели поляна предыстории (`prologue/models.ts`): шалаш, утварь, частокол
// поляны. Прежде он собирал и здания посёлка (стены, кровли, фахверк, крыльца, трубы, ограды); посёлок убран
// вместе с видами `now` и `next` (docs/city.md, «Город — единственный вид»), и остались примитивы, склейка и
// уборка геометрии.
//
// Деталь — это геометрия, уже поставленная на место, и «краска» (Paint): либо
// настоящий материал (кровля, пашня — то, что перекрашивает сезон), либо цвет
// палитры, запечённый в вершины на общем белом материале KIT.body — так все
// несезонные части уходят в одну группу. Готовая модель склеивается в
// ОДИН меш (assemble): группы по материалу, один вызов отрисовки на материал
// вместо одного на каждую доску.
//
// Перед склейкой в вершины запекается цвет: краска × контактное затемнение
// (низ стен и столбов темнее и синее — иначе постройка парит над травой).
// Затемнение — множитель, поэтому сезонный перелив material.color его не трогает.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { KIT, MATERIAL_KEYS, type MatKey } from './materials';
import { AO_WALL, EMISSIVE_KEYS, PALETTE, isSeasonal, type Mul } from './palette';

/** Чем красить деталь: сезонным материалом или цветом вершин на общем «теле». */
export interface Paint {
  mat: THREE.Material;
  /** Линейный цвет для вершин; отсутствует, если цвет несёт сам материал. */
  tint: THREE.Color | null;
}

const paints = new Map<MatKey, Paint>();

/**
 * Краска по имени цвета палитры. Сезонные цвета (кровли, пашня) — настоящие
 * материалы, чтобы SeasonVisuals мог их переливать; остальные — тело с цветом
 * в вершинах. setHex переводит sRGB в линейное пространство сам.
 */
export function paintOf(key: MatKey): Paint {
  let p = paints.get(key);
  if (!p) {
    p = isSeasonal(key)
      ? { mat: KIT[key], tint: null }
      : { mat: KIT.body, tint: new THREE.Color().setHex(PALETTE[key]) };
    paints.set(key, p);
  }
  return p;
}

/** Контактное затемнение детали: от base у y0 к единице у y1. */
export interface Ao {
  base: Mul;
  y0: number;
  y1: number;
}

export interface Part {
  geo: THREE.BufferGeometry;
  paint: Paint;
  ao?: Ao;
}

export interface Rot {
  x?: number;
  y?: number;
  z?: number;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

/** Ставит геометрию на место (центр в x, y, z; поворот Эйлера) и возвращает деталь. */
export function place(geo: THREE.BufferGeometry, paint: Paint, x = 0, y = 0, z = 0, rot?: Rot, ao?: Ao): Part {
  _e.set(rot?.x ?? 0, rot?.y ?? 0, rot?.z ?? 0);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _m.compose(_v, _q, _s);
  geo.applyMatrix4(_m);
  return { geo, paint, ao };
}

// ---------- Примитивы (центр — в точке постановки) ----------

export const box = (w: number, h: number, d: number, paint: Paint, x = 0, y = 0, z = 0, rot?: Rot, ao?: Ao): Part =>
  place(new THREE.BoxGeometry(w, h, d), paint, x, y, z, rot, ao);

export const cyl = (
  rt: number,
  rb: number,
  h: number,
  paint: Paint,
  seg = 8,
  x = 0,
  y = 0,
  z = 0,
  rot?: Rot,
  ao?: Ao,
): Part => place(new THREE.CylinderGeometry(rt, rb, h, seg), paint, x, y, z, rot, ao);

export const cone = (r: number, h: number, paint: Paint, seg = 8, x = 0, y = 0, z = 0, rot?: Rot): Part =>
  place(new THREE.ConeGeometry(r, h, seg), paint, x, y, z, rot);

/**
 * Пятиугольная призма: стена с фронтонами под двускатную крышу. Сечение в XY —
 * прямоугольник w×h с треугольником высотой rise сверху, вытянуто по z на d.
 * Основание в y = 0. Скаты сверху тоже есть: крыша ляжет на них с зазором.
 */
export function gablePrism(w: number, h: number, d: number, rise: number, paint: Paint, x = 0, z = 0, rot?: Rot, ao?: Ao): Part {
  const hw = w / 2;
  const hd = d / 2;
  // Средний ряд вершин: контактный градиент должен сидеть внизу, а не тянуться
  // по Гуро на всю стену (цвет вершин интерполируется по грани даже при flatShading).
  const ym = Math.min(0.55, h / 2);
  // Семь точек сечения против часовой стрелки, если смотреть с +z.
  const p: [number, number][] = [
    [-hw, 0],
    [hw, 0],
    [hw, ym],
    [hw, h],
    [0, h + rise],
    [-hw, h],
    [-hw, ym],
  ];
  const pos: number[] = [];
  const nrm: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, n: THREE.Vector3): void => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    nrm.push(n.x, n.y, n.z, n.x, n.y, n.z, n.x, n.y, n.z);
  };
  const v = (i: number, zz: number): THREE.Vector3 => new THREE.Vector3(p[i][0], p[i][1], zz);
  // Торцы: нижняя полоса (0-1-2-6) и веер фронтона из точки 6. Передний (+z) — против часовой.
  const fan: [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 6],
    [6, 2, 3],
    [6, 3, 4],
    [6, 4, 5],
  ];
  for (const [a, b, c] of fan) {
    tri(v(a, hd), v(b, hd), v(c, hd), new THREE.Vector3(0, 0, 1));
    tri(v(a, -hd), v(c, -hd), v(b, -hd), new THREE.Vector3(0, 0, -1));
  }
  // Боковые грани: по ребру сечения — четырёхугольник между z = ±hd.
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    // Наружная нормаль ребра, идущего против часовой: (ey, -ex).
    const n = new THREE.Vector3(ey, -ex, 0).normalize();
    const a0 = new THREE.Vector3(a[0], a[1], hd);
    const a1 = new THREE.Vector3(a[0], a[1], -hd);
    const b0 = new THREE.Vector3(b[0], b[1], hd);
    const b1 = new THREE.Vector3(b[0], b[1], -hd);
    tri(a0, b0, b1, n);
    tri(a0, b1, a1, n);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  return place(geo, paint, x, 0, z, rot, ao);
}

// ---------- Сборка ----------

const smooth = (t: number): number => {
  const k = THREE.MathUtils.clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
};

/**
 * Запекает цвет вершин: краска × контактное затемнение. Затемнение — от ao.base
 * у ao.y0 до единицы у ao.y1; без ao вершины получают чистую краску.
 */
function bakeColors(geo: THREE.BufferGeometry, tint: THREE.Color | null, ao?: Ao): void {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const r = tint?.r ?? 1;
  const g = tint?.g ?? 1;
  const b = tint?.b ?? 1;
  for (let i = 0; i < pos.count; i++) {
    let kr = 1;
    let kg = 1;
    let kb = 1;
    if (ao) {
      const t = smooth((pos.getY(i) - ao.y0) / Math.max(1e-6, ao.y1 - ao.y0));
      kr = ao.base[0] + (1 - ao.base[0]) * t;
      kg = ao.base[1] + (1 - ao.base[1]) * t;
      kb = ao.base[2] + (1 - ao.base[2]) * t;
    }
    col[i * 3] = r * kr;
    col[i * 3 + 1] = g * kg;
    col[i * 3 + 2] = b * kb;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

/**
 * Склеивает детали в один меш: группы по материалу, один вызов отрисовки на
 * материал. Геометрия деталей после склейки не нужна и освобождается.
 */
export function assemble(parts: Part[]): THREE.Mesh {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const p of parts) {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    if (g !== p.geo) p.geo.dispose();
    // Текстур нет: uv только мешает склейке разных примитивов.
    g.deleteAttribute('uv');
    bakeColors(g, p.paint.tint, p.ao);
    let list = byMat.get(p.paint.mat);
    if (!list) byMat.set(p.paint.mat, (list = []));
    list.push(g);
  }
  const mats: THREE.Material[] = [];
  const merged: THREE.BufferGeometry[] = [];
  for (const [mat, geos] of byMat) {
    const m = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!m) throw new Error(`kit: не склеились детали материала ${mat.name}`);
    mats.push(mat);
    merged.push(m);
  }
  const geo = mergeGeometries(merged, true);
  for (const g of merged) g.dispose();
  if (!geo) throw new Error('kit: не склеились группы');
  const mesh = new THREE.Mesh(geo, mats);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Контактное затемнение у самой земли — для склейки старых моделей целиком. */
export const GROUND_AO: Ao = { base: AO_WALL, y0: 0.02, y1: 0.45 };

/**
 * Склеивает готовую группу старых мешей в один меш по правилам набора. Каждый
 * меш с материалом из общего набора (по имени — ключу палитры) становится деталью
 * с краской paintOf, его мировая матрица запекается в геометрию. Вызовов
 * отрисовки после этого столько, сколько материалов, а не мешей: старая модель
 * фермы из ста досок стоила две сотни вызовов с теневым проходом — теперь три.
 *
 * Отдельными остаются меши, которые нельзя склеивать: именованные (пламя костра —
 * его крутит сцена), светящиеся (огонь и горн — они не освещаются, а светятся),
 * уже склеенные (массив материалов) и с материалом не из набора. Они переезжают
 * в ту же группу со своей мировой матрицей.
 *
 * ao — контактное затемнение по мировой высоте (GROUND_AO для того, что стоит на
 * земле; для плоских дорог его не задают). Группа меняется на месте: её имя и
 * трансформация сохраняются.
 */
export function collapse(root: THREE.Group, ao?: Ao, shadows = true): THREE.Group {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const parts: Part[] = [];
  const kept: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const mat = mesh.material;
    const key = Array.isArray(mat) ? null : (mat.name as MatKey);
    const mergeable =
      key !== null && !mesh.name && (MATERIAL_KEYS as readonly string[]).includes(key) && !EMISSIVE_KEYS.includes(key);
    if (!mergeable) {
      kept.push(mesh);
      return;
    }
    const geo = mesh.geometry.clone().applyMatrix4(_m.copy(inv).multiply(mesh.matrixWorld));
    mesh.geometry.dispose();
    parts.push({ geo, paint: paintOf(key), ao });
  });
  for (const mesh of kept) {
    _m.copy(inv).multiply(mesh.matrixWorld);
    mesh.removeFromParent();
    _m.decompose(mesh.position, mesh.quaternion, mesh.scale);
  }
  root.clear();
  if (parts.length > 0) {
    const merged = assemble(parts);
    merged.castShadow = shadows;
    root.add(merged);
  }
  for (const mesh of kept) root.add(mesh);
  return root;
}

/** Все меши группы, у которых своя (не общая) геометрия, — для освобождения. */
export function disposeGeometries(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
  });
}
