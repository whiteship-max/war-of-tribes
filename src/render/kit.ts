// Набор деталей. Зданий шестнадцать, ступеней три, эпох шесть — по отдельной
// модели на каждую комбинацию не построить и не поддержать. Поэтому здание
// собирается из общих деталей: стена, скат крыши, столб, цоколь, балки фахверка,
// крыльцо, труба, ограда. Эпоха меняет материалы (ERA_ROLES) и состав набора
// (ERA_FEATURES в buildings.ts), а не каждую модель по отдельности.
//
// Деталь — это геометрия, уже поставленная на место, и «краска» (Paint): либо
// настоящий материал (кровля, пашня — то, что перекрашивает сезон), либо цвет
// палитры, запечённый в вершины на общем белом материале KIT.body — так все
// несезонные части здания уходят в одну группу. Готовое здание склеивается в
// ОДИН меш (assemble): группы по материалу, один вызов отрисовки на материал
// вместо одного на каждую доску.
//
// Перед склейкой в вершины запекается цвет: краска × контактное затемнение
// (низ цоколя, стены и столбов темнее и синее — иначе постройка парит над травой).
// Затемнение — множитель, поэтому сезонный перелив material.color его не трогает.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { KIT, type MatKey } from './materials';
import { AO_BASE, AO_POST, AO_WALL, PALETTE, isSeasonal, type Mul } from './palette';

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

// ---------- Стены и цоколь (основание — в y0) ----------

/** Затемнение стены: нижняя половина, не выше 0.55. */
const wallAo = (y0: number, h: number): Ao => ({ base: AO_WALL, y0, y1: y0 + Math.min(0.55, h / 2) });

/**
 * Стены собираются с двумя рядами по высоте: средний ряд вершин держит
 * контактный градиент внизу — без него цвет тянулся бы по Гуро на всю стену.
 */

/** Круглая стена: чуть шире у земли. */
export const wallRound = (r: number, h: number, paint: Paint, seg = 10, x = 0, z = 0, y0 = 0): Part =>
  place(new THREE.CylinderGeometry(r, r * 1.04, h, seg, 2), paint, x, y0 + h / 2, z, undefined, wallAo(y0, h));

/** Прямоугольная стена. */
export const wallBox = (w: number, h: number, d: number, paint: Paint, x = 0, z = 0, y0 = 0, rot?: Rot): Part =>
  place(new THREE.BoxGeometry(w, h, d, 1, 2, 1), paint, x, y0 + h / 2, z, rot, wallAo(y0, h));

/** Стена с фронтонами — под двускатную крышу. Основание в y0. */
export function wallGable(w: number, h: number, d: number, rise: number, paint: Paint, x = 0, z = 0, rot?: Rot, y0 = 0): Part {
  const p = gablePrism(w, h, d, rise, paint, x, z, rot, wallAo(y0, h));
  if (y0 !== 0) p.geo.translate(0, y0, 0);
  return p;
}

/** Высота цоколя и на сколько он уходит под землю: линия стыка с грунтом чистая. */
export const PLINTH_H = 0.22;
export const PLINTH_SINK = 0.03;
const plinthAo: Ao = { base: AO_BASE, y0: -PLINTH_SINK, y1: PLINTH_H - PLINTH_SINK };

/** Каменный цоколь под прямоугольной стеной: на 0.08 шире неё с каждой стороны. */
export const plinth = (w: number, d: number, paint: Paint, x = 0, z = 0, rot?: Rot): Part =>
  box(w + 0.16, PLINTH_H, d + 0.16, paint, x, PLINTH_H / 2 - PLINTH_SINK, z, rot, plinthAo);

/** Цоколь под круглой стеной. */
export const plinthRound = (r: number, paint: Paint, seg = 10, x = 0, z = 0): Part =>
  cyl(r + 0.08, r + 0.1, PLINTH_H, paint, seg, x, PLINTH_H / 2 - PLINTH_SINK, z, undefined, plinthAo);

/** Столб: чуть шире у земли, пятигранник. Основание в y0. */
export const post = (r: number, h: number, paint: Paint, x = 0, z = 0, y0 = 0): Part =>
  cyl(r, r * 1.15, h, paint, 5, x, y0 + h / 2, z, undefined, { base: AO_POST, y0, y1: y0 + 0.35 });

// ---------- Кровли ----------

/** Толщина кромки: солома толстая, дранка и черепица — тонкий лист. */
export type RoofKind = 'hide' | 'thatch' | 'shingle' | 'tile';

export interface RoofPaint {
  kind: RoofKind;
  roof: Paint;
  roofDark: Paint;
  /** Колпак/конёк: металл у дранки, брус у соломы. */
  trim: Paint;
}

/**
 * Коническая кровля. База конуса на y (на 0.12 ниже верха стены — кровля надета,
 * щели нет). У соломы под главным конусом широкий тёмный свес и шапка на вершине —
 * ступенька в силуэте читается «солома»; у дранки один чистый конус с колпаком.
 */
export function roofCone(r: number, h: number, y: number, rp: RoofPaint, seg = 10, x = 0, z = 0): Part[] {
  const out: Part[] = [];
  if (rp.kind === 'thatch' || rp.kind === 'hide') {
    // Свес: усечённый конус той же крутизны, на 0.12 шире.
    const eave = 0.42;
    const rTop = r + 0.12 - (eave * (r + 0.12)) / h;
    out.push(cyl(Math.max(0.1, rTop), r + 0.12, eave, rp.roofDark, seg, x, y + eave / 2, z));
    out.push(cone(r, h, rp.roof, seg, x, y + h / 2, z));
    if (rp.kind === 'thatch') out.push(cyl(0.12, 0.16, 0.2, rp.roofDark, 6, x, y + h - 0.02, z));
  } else {
    out.push(cone(r, h, rp.roof, seg, x, y + h / 2, z));
    out.push(cyl(0.05, 0.11, 0.22, rp.trim, 6, x, y + h + 0.06, z));
  }
  return out;
}

/**
 * Двускатная кровля: две плиты сходятся на коньке, конёк накрыт брусом. Плиты
 * выступают за стену на overhang по всем сторонам. Кромка (нижний край ската)
 * на высоте y, конёк на y + rise. Ось конька — z (в местных осях до поворота rot).
 * У соломы кромка толстая и по ней идёт тёмный свес.
 */
export function roofGable(
  w: number,
  d: number,
  rise: number,
  y: number,
  rp: RoofPaint,
  overhang = 0.3,
  x = 0,
  z = 0,
  rot?: Rot,
): Part[] {
  const thick = rp.kind === 'thatch' || rp.kind === 'hide' ? 0.2 : 0.11;
  const hw = w / 2 + overhang;
  // Кромка опускается ниже стены пропорционально выносу: скат продолжается.
  const drop = (rise * overhang) / (w / 2);
  const rise2 = rise + drop;
  const len = Math.hypot(hw, rise2) + thick * 0.4;
  const ang = Math.atan2(rise2, hw);
  const dd = d + overhang * 2;
  const ry = rot?.y ?? 0;
  const cosR = Math.cos(ry);
  const sinR = Math.sin(ry);
  // Локальный сдвиг (lx, lz) → мировой с учётом поворота вокруг y.
  const at = (lx: number, lz: number): [number, number] => [x + lx * cosR + lz * sinR, z - lx * sinR + lz * cosR];
  const out: Part[] = [];
  for (const s of [-1, 1]) {
    const mx = (s * hw) / 2;
    const my = y - drop + rise2 / 2;
    const nx = s * Math.sin(ang);
    const ny = Math.cos(ang);
    const [px, pz] = at(mx + (nx * thick) / 2, 0);
    out.push(box(len, thick, dd, rp.roof, px, my + (ny * thick) / 2, pz, { y: ry, z: -s * ang }));
    if (rp.kind === 'thatch') {
      // Тёмный свес вдоль кромки.
      const [ex, ez] = at(s * (hw - 0.05), 0);
      out.push(box(0.3, thick * 1.5, dd + 0.02, rp.roofDark, ex, y - drop + thick * 0.25, ez, { y: ry, z: -s * ang }));
    }
  }
  // Брус конька — ромбом, чтобы закрыть стык плит.
  const [cx, cz] = at(0, 0);
  const rt = rp.kind === 'thatch' ? 0.16 : 0.13;
  out.push(box(rt, rt, dd + 0.04, rp.trim, cx, y + rise + thick * 0.45, cz, { y: ry, z: Math.PI / 4 }));
  return out;
}

/** Односкатный навес: плита с наклоном, кромка выше у стены (z0) и ниже на выносе. */
export const roofLean = (w: number, d: number, y: number, paint: Paint, z0: number, x = 0, drop = 0.28): Part => {
  const len = Math.hypot(d, drop);
  return box(w, 0.1, len, paint, x, y - drop / 2, z0 + d / 2, { x: Math.atan2(drop, d) });
};

// ---------- Мелкие детали ----------

/** Труба: короб с широкой шапкой (без неё в силуэте — палка). Основание в y. */
export function chimney(s: number, h: number, paint: Paint, cap: Paint, x: number, y: number, z: number): Part[] {
  return [box(s, h, s, paint, x, y + h / 2, z), box(s * 1.35, s * 0.3, s * 1.35, cap, x, y + h + s * 0.15, z)];
}

/**
 * Дымник каменного века: колпак на четырёх столбиках над вершиной — та же
 * «шишка» в силуэте, что и труба, но без трубы, которой ещё нет.
 */
export function smokeHood(r: number, paint: Paint, postPaint: Paint, x: number, y: number, z: number): Part[] {
  const out: Part[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    out.push(cyl(0.05, 0.05, 0.3, postPaint, 4, x + Math.cos(a) * r * 0.5, y + 0.15, z + Math.sin(a) * r * 0.5));
  }
  out.push(cone(r, 0.36, paint, 6, x, y + 0.3 + 0.18, z));
  return out;
}

/** Дверной проём с перемычкой: тёмная плита чуть выступает из стены (фасад +z). */
export function door(w: number, h: number, ink: Paint, lintel: Paint, x: number, z: number, rot?: Rot): Part[] {
  return [box(w, h, 0.08, ink, x, h / 2 + 0.01, z, rot), box(w + 0.18, 0.1, 0.12, lintel, x, h + 0.05, z, rot)];
}

/** Окно: маленькая тёмная плита; только на стенах, где оно не превращается в шум. */
export const window_ = (s: number, ink: Paint, x: number, y: number, z: number, rot?: Rot): Part =>
  box(s, s, 0.06, ink, x, y, z, rot);

/**
 * Крыльцо перед фасадом (+z): два столба, односкатный навес от стены и настил.
 * z0 — плоскость стены, d — вынос, h — высота столбов.
 */
export function porch(w: number, d: number, h: number, postPaint: Paint, roofPaint: Paint, floorPaint: Paint, z0: number, x = 0): Part[] {
  const out: Part[] = [];
  for (const sx of [-1, 1]) out.push(post(0.08, h - 0.08, postPaint, x + (sx * w) / 2, z0 + d - 0.14));
  out.push(roofLean(w + 0.36, d + 0.2, h + 0.1, roofPaint, z0 - 0.05, x));
  out.push(box(w + 0.2, 0.08, d, floorPaint, x, 0.1, z0 + d / 2));
  return out;
}

/** Балки фахверка на четырёх стенах короба: угловые стойки, обвязка, диагонали. */
export function halfTimber(w: number, h: number, d: number, paint: Paint, t = 0.1, y0 = 0, x = 0, z = 0): Part[] {
  const out: Part[] = [];
  const hw = w / 2;
  const hd = d / 2;
  const o = t * 0.4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box(t, h, t, paint, x + sx * hw, y0 + h / 2, z + sz * hd));
  for (const yy of [y0 + t / 2 + 0.02, y0 + h - t / 2]) {
    for (const sz of [-1, 1]) out.push(box(w, t, t, paint, x, yy, z + sz * (hd + o)));
    for (const sx of [-1, 1]) out.push(box(t, t, d, paint, x + sx * (hw + o), yy, z));
  }
  // Одна диагональ на длинную грань.
  const diag = Math.hypot(w * 0.45, h * 0.7);
  for (const sz of [-1, 1]) out.push(box(diag, t, t * 0.9, paint, x, y0 + h / 2, z + sz * (hd + o), { z: sz * Math.atan2(h * 0.7, w * 0.45) }));
  return out;
}

/** Ограда отрезком от (x0, z0) до (x1, z1): столбики и две жерди. */
export function fenceRun(x0: number, z0: number, x1: number, z1: number, h: number, postPaint: Paint, railPaint: Paint): Part[] {
  const out: Part[] = [];
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ang = Math.atan2(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.round(len / 0.6));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    out.push(post(0.05, h, postPaint, x0 + (x1 - x0) * k, z0 + (z1 - z0) * k));
  }
  for (const yy of [h * 0.45, h * 0.85]) {
    out.push(box(0.06, 0.06, len, railPaint, (x0 + x1) / 2, yy, (z0 + z1) / 2, { y: ang }));
  }
  return out;
}

/** Плита перед дверью: дешёвая «посадка» входа. */
export const stepStone = (w: number, paint: Paint, x: number, z: number): Part =>
  box(w, 0.08, 0.4, paint, x, 0.04, z + 0.2, undefined, { base: AO_POST, y0: 0, y1: 0.08 });

/** Поленница у стены. */
export function woodpile(paint: Paint, x: number, z: number, rot = 0): Part[] {
  const out: Part[] = [];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3 - (row === 2 ? 1 : 0); i++) {
      const lx = -0.19 + i * 0.19 + (row % 2) * 0.05;
      out.push(
        cyl(0.09, 0.09, 0.85, paint, 5, x + lx * Math.cos(rot), 0.09 + row * 0.17, z - lx * Math.sin(rot), {
          y: rot,
          z: Math.PI / 2,
        }),
      );
    }
  }
  return out;
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
export function bakeColors(geo: THREE.BufferGeometry, tint: THREE.Color | null, ao?: Ao): void {
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

/** Все меши группы, у которых своя (не общая) геометрия, — для освобождения. */
export function disposeGeometries(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) mesh.geometry.dispose();
  });
}
