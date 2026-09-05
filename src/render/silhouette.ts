// Обмер силуэта. Главный критерий формы фигуры — её чёрное пятно: на боевом
// масштабе виды бойцов обязаны различаться без подписей. Глазами это смотрят
// на стенде (?showcase=units&silhouette=1), а здесь то же самое считается
// числами — чтобы правка оружия или пропорций не свела два вида в одно пятно
// молча. Пользуются этим тест (units.test.ts) и отчёт (npm run figure:report).
//
// Пятно строится из тех же матриц, что пишет пул (`forEachPart`): считать позу
// для показа одним кодом, а для проверки другим — верный способ развести их.
// В игру этот модуль не попадает: на него никто из неё не ссылается.
import * as THREE from 'three';
import { Figure, forEachPart, type PartName } from './figures';

/** Ракурс игры: камера стоит в (9, 10, 12) и смотрит в центр. */
const DIR = new THREE.Vector3(-9, -10, -12).normalize();
const RIGHT = new THREE.Vector3().crossVectors(DIR, new THREE.Vector3(0, 1, 0)).normalize();
const UP = new THREE.Vector3().crossVectors(RIGHT, DIR).normalize();

/** Фигура смотрит в камеру — как боец у ворот смотрит в поле. */
export const FACING = Math.atan2(9, 12);

/** Все стороны: в бою фигура повёрнута к игроку как придётся. */
export const TURNS: number[] = [0, 1, 2, 3, 4, 5].map((k) => (k * Math.PI) / 3);

/** Окно растра в метрах сцены и его шаг. Всадник с копьём влезает целиком. */
export const WIN = { u0: -1.2, u1: 1.2, v0: -0.15, v1: 1.75, cell: 0.02 } as const;
export const COLS = Math.round((WIN.u1 - WIN.u0) / WIN.cell);
export const ROWS = Math.round((WIN.v1 - WIN.v0) / WIN.cell);

/**
 * Высота сцены в высоту на картинке. Камера смотрит сверху под углом, поэтому
 * метр по вертикали занимает на экране меньше метра, и пороги «выше головы»
 * надо задавать в тех же единицах, что и растр.
 */
export const projY = (y: number): number => y * UP.y;

/**
 * Точки, по которым обводится деталь. Коробка примитива годится не всем: у щита
 * она превратила бы диск в квадрат, у косо поднятого клинка — тонкую полосу в
 * большой квадрат, и два разных силуэта сошлись бы на бумаге.
 */
function samples(part: PartName): readonly (readonly [number, number, number])[] {
  const box = (lo: number, hi: number): [number, number, number][] =>
    Array.from({ length: 8 }, (_, i) => [(i & 1) - 0.5, (i >> 1) & 1 ? hi : lo, ((i >> 2) & 1) - 0.5]);
  const ring = (n: number, r: number, fn: (a: number, b: number) => [number, number, number]): [number, number, number][] =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return fn(Math.cos(a) * r, Math.sin(a) * r);
    });
  switch (part) {
    case 'limb':
      return box(-1, 0);
    case 'plate':
      return box(-0.5, 0.5);
    case 'shaft':
      return box(0, 1);
    case 'head':
      // Сфера: экватор и полюса, а не углы описанной коробки.
      return [...ring(8, 0.5, (x, z) => [x, 0, z]), [0, 0.5, 0], [0, -0.5, 0]];
    case 'cap':
      // Конус: обод основания и вершина.
      return [...ring(6, 0.5, (x, z) => [x, 0, z]), [0, 1, 0]];
    case 'body':
      // Призма, сужающаяся книзу.
      return [...ring(6, 0.5, (x, z) => [x, 1, z]), ...ring(6, 0.39, (x, z) => [x, 0, z])];
    case 'shield':
      // Диск лицом вперёд: обод по обеим сторонам.
      return [...ring(8, 0.5, (x, y) => [x, y, 0.5]), ...ring(8, 0.5, (x, y) => [x, y, -0.5])];
  }
}

/** Выпуклая оболочка проекции — монотонная цепь Эндрю. */
function hull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (src: [number, number][]): [number, number][] => {
    const out: [number, number][] = [];
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
      out.push(q);
    }
    out.pop();
    return out;
  };
  return [...half(p), ...half([...p].reverse())];
}

const _p = new THREE.Vector3();

/** Чёрное пятно фигуры, повёрнутой на `turn` от взгляда в камеру. */
export function silhouette(f: Figure, turn = 0): Uint8Array {
  const mask = new Uint8Array(COLS * ROWS);
  f.rotationY = FACING + turn;
  forEachPart(f, (slot, m) => {
    const flat: [number, number][] = samples(slot.part).map((v) => {
      _p.set(v[0], v[1], v[2]).applyMatrix4(m);
      return [_p.dot(RIGHT), _p.dot(UP)];
    });
    const h = hull(flat);
    if (h.length < 3) return;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const q of h) {
      if (q[1] < v0) v0 = q[1];
      if (q[1] > v1) v1 = q[1];
    }
    const r0 = Math.max(0, Math.floor((v0 - WIN.v0) / WIN.cell));
    const r1 = Math.min(ROWS - 1, Math.ceil((v1 - WIN.v0) / WIN.cell));
    for (let r = r0; r <= r1; r++) {
      const v = WIN.v0 + (r + 0.5) * WIN.cell;
      let u0 = Infinity;
      let u1 = -Infinity;
      for (let i = 0; i < h.length; i++) {
        const a = h[i];
        const b = h[(i + 1) % h.length];
        if (a[1] === b[1]) continue;
        const t = (v - a[1]) / (b[1] - a[1]);
        if (t < 0 || t > 1) continue;
        const u = a[0] + (b[0] - a[0]) * t;
        if (u < u0) u0 = u;
        if (u > u1) u1 = u;
      }
      if (u0 > u1) continue;
      const c0 = Math.max(0, Math.floor((u0 - WIN.u0) / WIN.cell));
      const c1 = Math.min(COLS - 1, Math.ceil((u1 - WIN.u0) / WIN.cell));
      for (let c = c0; c <= c1; c++) mask[r * COLS + c] = 1;
    }
  });
  return mask;
}

/** Доля общего в объединении: 1 — пятна совпали, 0 — не пересекаются вовсе. */
export function overlap(a: Uint8Array, b: Uint8Array): number {
  let both = 0;
  let any = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) any++;
    if (a[i] && b[i]) both++;
  }
  return any === 0 ? 1 : both / any;
}

/** Площадь пятна в клетках. */
export function area(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

/** Клеток выше этой высоты (высота — уже в единицах растра, см. projY). */
export function above(mask: Uint8Array, y: number): number {
  const r0 = Math.max(0, Math.ceil((y - WIN.v0) / WIN.cell));
  let n = 0;
  for (let r = r0; r < ROWS; r++) for (let c = 0; c < COLS; c++) n += mask[r * COLS + c];
  return n;
}

/** Ширина пятна на этой высоте, в метрах сцены. */
export function widthAt(mask: Uint8Array, y: number): number {
  const r = Math.max(0, Math.min(ROWS - 1, Math.round((y - WIN.v0) / WIN.cell)));
  let lo = -1;
  let hi = -1;
  for (let c = 0; c < COLS; c++) {
    if (!mask[r * COLS + c]) continue;
    if (lo < 0) lo = c;
    hi = c;
  }
  return lo < 0 ? 0 : (hi - lo + 1) * WIN.cell;
}
