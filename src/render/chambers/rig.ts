// Живые в покоях (docs/city_v3.md, Г-7): слуга, служанка, супруга и кот — одна сетка на каждого с жёсткой «кожей». Каждая
// вершина принадлежит одной кости; кадр ставит кости (повороты суставов от позы покоя) и пересчитывает места и нормали
// вершин на процессоре — как тело правителя (`body.ts`): ни новых буферов, ни новых вызовов отрисовки, ни новых имён
// three (`SkinnedMesh` и `Skeleton` легли бы в кусок three первой загрузки, docs/city_v3.md, Г-4, решение 13).
//
// Модель пишется в позе покоя в осях персонажа: начало — между ступнями на полу, лицом к +z, y — вверх. Сустав кости —
// точка, вокруг которой она поворачивается; части тела строятся петлями колец (`loft`) — тело, голова, рукава, подол.
import * as THREE from 'three';
import type { V3 } from '../city/geom';
import { Mesher, type RoomLayer } from './geo';

/** Кость: имя, родитель (−1 — корень) и сустав в позе покоя (оси персонажа). */
export interface BoneDef {
  name: string;
  parent: number;
  j: V3;
}

/** Поворот сустава от позы покоя: наклон вперёд (x), поворот (y), крен (z), радианы; порядок — y, x, z. */
export type Turn = readonly [number, number, number];

/** Поза: где стоит персонаж в осях комнаты и куда лицом, корень над этим местом и повороты костей по именам. */
export interface RigPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Корень: сдвиг таза от покоя (присесть, качнуться в шаге) и наклон всего тела (лёжа, прыжок кота). */
  lift?: V3;
  tilt?: Turn;
  turns: Readonly<Record<string, Turn>>;
}

/** Скелет: кости по порядку (родитель раньше ребёнка). */
export class Skeleton {
  readonly bones: BoneDef[] = [];
  private byName = new Map<string, number>();

  add(name: string, parent: string | null, j: V3): this {
    const p = parent === null ? -1 : this.of(parent);
    this.byName.set(name, this.bones.length);
    this.bones.push({ name, parent: p, j });
    return this;
  }

  of(name: string): number {
    const i = this.byName.get(name);
    if (i === undefined) throw new Error(`кость ${name}`);
    return i;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }
}

/** Кольцо петли: середина, оси сечения (`u` — первая полуось, `v` — вторая) и полуоси. */
export interface Ring {
  c: V3;
  u: V3;
  v: V3;
  ru: number;
  rv: number;
}

/** Кольцо поперёк вертикали: середина на высоте `y`, полуоси по x и по z, сдвиг вперёд `fz` (лицо, грудь). */
export const ringY = (y: number, rx: number, rz: number, x = 0, fz = 0): Ring => ({ c: [x, y, fz], u: [1, 0, 0], v: [0, 0, 1], ru: rx, rv: rz });

/** Построитель модели с костями: пишет грани построителем покоев и помнит, какой кости какая вершина. */
export class SkinBuilder {
  readonly m = new Mesher();
  private cur = 0;
  private from = 0;
  private spans: { bone: number; to: number }[] = [];

  constructor(readonly sk: Skeleton) {}

  /** Дальше грани — этой кости. */
  bone(name: string): this {
    this.flush();
    this.cur = this.sk.of(name);
    return this;
  }

  private flush(): void {
    const n = this.m.b.vertexCount;
    if (n > this.from) this.spans.push({ bone: this.cur, to: n });
    this.from = n;
  }

  /** Кость каждой вершины. */
  boneOfVertices(): Uint8Array {
    this.flush();
    const out = new Uint8Array(this.m.b.vertexCount);
    let at = 0;
    for (const s of this.spans) {
      out.fill(s.bone, at, s.to);
      at = s.to;
    }
    return out;
  }

  /**
   * Петля колец (тело, голова, рукав, подол): соседние кольца — полосой граней, нормали наружу и сглажены. Концы: `cap0`
   * и `cap1` — закрыть кольцо точкой (донце, макушка). `seg` — граней по кругу; `phase` — поворот разметки по кругу.
   */
  loft(rings: readonly Ring[], seg: number, layer: RoomLayer, tint: V3 | ((i: number, k: number) => V3), opt: { cap0?: boolean; cap1?: boolean; phase?: number; smooth?: number } = {}): void {
    const from = this.m.b.vertexCount;
    const ph = opt.phase ?? 0;
    const at = (r: Ring, k: number): V3 => {
      const a = ((k + ph) / seg) * Math.PI * 2;
      const cu = Math.cos(a) * r.ru;
      const sv = Math.sin(a) * r.rv;
      return [r.c[0] + r.u[0] * cu + r.v[0] * sv, r.c[1] + r.u[1] * cu + r.v[1] * sv, r.c[2] + r.u[2] * cu + r.v[2] * sv];
    };
    const col = (i: number, k: number): V3 => (typeof tint === 'function' ? tint(i, k) : tint);
    // Обход: грани смотрят наружу, когда кольца идут против оси `u × v`; идут по ней — грани разворачиваются.
    const ax = cross(rings[0].u, rings[0].v);
    const dir = rings.length > 1 ? sub(rings[rings.length - 1].c, rings[0].c) : ax;
    const flip = dot(ax, dir) > 0;
    for (let i = 0; i + 1 < rings.length; i++) {
      for (let k = 0; k < seg; k++) {
        const a = at(rings[i], k);
        const b = at(rings[i], k + 1);
        const c = at(rings[i + 1], k + 1);
        const d = at(rings[i + 1], k);
        const t = col(i, k);
        if (flip) this.m.quad(a, b, c, d, layer, t);
        else this.m.quad(b, a, d, c, layer, t);
      }
    }
    const capAt = (i: number, last: boolean): void => {
      const r = rings[i];
      const tip = r.c;
      for (let k = 0; k < seg; k++) {
        const a = at(r, k);
        const b = at(r, k + 1);
        const t = col(i, k);
        if (last !== flip) this.m.tri(b, a, tip, layer, t);
        else this.m.tri(a, b, tip, layer, t);
      }
    };
    if (opt.cap0) capAt(0, false);
    if (opt.cap1) capAt(rings.length - 1, true);
    this.m.smoothFrom(from, opt.smooth ?? 60);
  }

  /** Отрезок-трубка от `a` до `e` (палец, ремень, ручка): круглое сечение радиусов `r0` → `r1`. */
  rod(a: V3, e: V3, r0: number, r1: number, seg: number, layer: RoomLayer, tint: V3, caps = true): void {
    const d = norm(sub(e, a));
    const [u, v] = perp(d);
    this.loft([{ c: a, u, v, ru: r0, rv: r0 }, { c: e, u, v, ru: r1, rv: r1 }], seg, layer, tint, { cap0: caps, cap1: caps });
  }

  /** Шар (глаз, пуговица, навершие): `rings` поясов по `seg` граней. */
  ball(c: V3, r: number, seg: number, layer: RoomLayer, tint: V3, sy = 1, sz = 1): void {
    const n = Math.max(3, Math.round(seg / 2));
    const rs: Ring[] = [];
    for (let i = 1; i < n; i++) {
      const a = (i / n) * Math.PI;
      rs.push({ c: [c[0], c[1] - Math.cos(a) * r * sy, c[2]], u: [1, 0, 0], v: [0, 0, 1], ru: Math.sin(a) * r, rv: Math.sin(a) * r * sz });
    }
    this.loftTipped([c[0], c[1] - r * sy, c[2]], rs, [c[0], c[1] + r * sy, c[2]], seg, layer, tint);
  }

  /** Петля с вершинами на концах (шар, капля): кольца между двумя точками. */
  loftTipped(tip0: V3, rings: readonly Ring[], tip1: V3, seg: number, layer: RoomLayer, tint: V3 | ((i: number, k: number) => V3)): void {
    const first = { ...rings[0], c: tip0, ru: 0, rv: 0 };
    const last = { ...rings[rings.length - 1], c: tip1, ru: 0, rv: 0 };
    // Вершина — кольцо нулевого радиуса: у построителя нормаль грани — по первым трём углам, поэтому грани у вершины
    // пишутся треугольниками (`Mesher.quad` с совпавшими углами).
    const all = [first, ...rings, last];
    const from = this.m.b.vertexCount;
    const col = (i: number, k: number): V3 => (typeof tint === 'function' ? tint(i, k) : tint);
    const at = (r: Ring, k: number): V3 => {
      const a = (k / seg) * Math.PI * 2;
      return [r.c[0] + r.u[0] * Math.cos(a) * r.ru + r.v[0] * Math.sin(a) * r.rv, r.c[1] + r.u[1] * Math.cos(a) * r.ru + r.v[1] * Math.sin(a) * r.rv, r.c[2] + r.u[2] * Math.cos(a) * r.ru + r.v[2] * Math.sin(a) * r.rv];
    };
    const ax = cross(rings[0].u, rings[0].v);
    const flip = dot(ax, sub(tip1, tip0)) > 0;
    for (let i = 0; i + 1 < all.length; i++) {
      for (let k = 0; k < seg; k++) {
        const a = at(all[i], k);
        const b = at(all[i], k + 1);
        const c = at(all[i + 1], k + 1);
        const d = at(all[i + 1], k);
        const t = col(i, k);
        if (i === 0) {
          if (flip) this.m.tri(a, c, d, layer, t);
          else this.m.tri(a, d, c, layer, t);
        } else if (i === all.length - 2) {
          if (flip) this.m.tri(a, b, c, layer, t);
          else this.m.tri(b, a, c, layer, t);
        } else if (flip) this.m.quad(a, b, c, d, layer, t);
        else this.m.quad(b, a, d, c, layer, t);
      }
    }
    this.m.smoothFrom(from, 70);
  }
}

/**
 * Персонаж на сцене: сетка с неизменной раскладкой, кости и поза. `pose` ставит кости, `write` пересчитывает вершины —
 * только когда персонаж виден (за кадром и за дверью — нет).
 */
export class Rig {
  readonly mesh: THREE.Mesh;
  readonly sk: Skeleton;
  private geo: THREE.BufferGeometry;
  private rest: Float32Array;
  private restN: Float32Array;
  private bone: Uint8Array;
  private pos: Float32Array;
  private nor: Float32Array;
  /** Мир кости: поворот 3×3 по столбцам и место — на кадр. */
  private R: Float64Array;
  private T: Float64Array;
  /** Где сустав кости в мире этого кадра — рукам, головам и тому, что держат в руках. */
  private J: Float64Array;
  readonly triangles: number;

  constructor(sb: SkinBuilder, material: THREE.Material, name: string) {
    this.sk = sb.sk;
    const b = sb.m.b;
    const bones = sb.boneOfVertices();
    const n = b.vertexCount;
    this.rest = new Float32Array(n * 3);
    this.restN = new Float32Array(b.nor);
    this.bone = bones;
    // Вершины — от своего сустава: поворот кости вертит их вокруг него.
    for (let i = 0; i < n; i++) {
      const j = this.sk.bones[bones[i]].j;
      this.rest[i * 3] = b.pos[i * 3] - j[0];
      this.rest[i * 3 + 1] = b.pos[i * 3 + 1] - j[1];
      this.rest[i * 3 + 2] = b.pos[i * 3 + 2] - j[2];
    }
    this.pos = new Float32Array(b.pos);
    this.nor = new Float32Array(b.nor);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setAttribute('cuv', new THREE.BufferAttribute(new Float32Array(b.uv), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(b.col), 3));
    g.setAttribute('cfg', new THREE.BufferAttribute(new Uint8Array(b.cfg), 4));
    g.setIndex(b.vertexCount > 65535 ? new THREE.BufferAttribute(new Uint32Array(b.idx), 1) : new THREE.BufferAttribute(new Uint16Array(b.idx), 1));
    this.geo = g;
    this.triangles = b.idx.length / 3;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    const nb = this.sk.bones.length;
    this.R = new Float64Array(nb * 9);
    this.T = new Float64Array(nb * 3);
    this.J = new Float64Array(nb * 3);
  }

  /** Поставить кости по позе (оси комнаты; начало комнаты — `origin` у сетки). */
  pose(p: RigPose): void {
    const bones = this.sk.bones;
    const R = this.R;
    const T = this.T;
    const M = new Float64Array(9);
    const L = new Float64Array(9);
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      const t = p.turns[b.name] ?? ZERO;
      if (b.parent < 0) {
        // Корень: место на полу, поворот лицом, наклон всего тела вокруг сустава корня, сдвиг таза.
        rotYXZ(p.yaw, 0, 0, M);
        const tl = p.tilt ?? ZERO;
        rotYXZ(tl[1], tl[0], tl[2], L);
        mul3(M, L, M);
        rotYXZ(t[1], t[0], t[2], L);
        mul3(M, L, R.subarray(i * 9, i * 9 + 9));
        const lift = p.lift ?? [0, 0, 0];
        const jx = b.j[0] + lift[0];
        const jy = b.j[1] + lift[1];
        const jz = b.j[2] + lift[2];
        // Сустав корня — над местом персонажа, повёрнутый с ним.
        const c = Math.cos(p.yaw);
        const s = Math.sin(p.yaw);
        T[i * 3] = p.x + jx * c + jz * s;
        T[i * 3 + 1] = p.y + jy;
        T[i * 3 + 2] = p.z - jx * s + jz * c;
      } else {
        const q = b.parent;
        const pj = bones[q].j;
        const off: V3 = [b.j[0] - pj[0], b.j[1] - pj[1], b.j[2] - pj[2]];
        const PR = R.subarray(q * 9, q * 9 + 9);
        T[i * 3] = T[q * 3] + PR[0] * off[0] + PR[3] * off[1] + PR[6] * off[2];
        T[i * 3 + 1] = T[q * 3 + 1] + PR[1] * off[0] + PR[4] * off[1] + PR[7] * off[2];
        T[i * 3 + 2] = T[q * 3 + 2] + PR[2] * off[0] + PR[5] * off[1] + PR[8] * off[2];
        rotYXZ(t[1], t[0], t[2], L);
        mul3(PR, L, R.subarray(i * 9, i * 9 + 9));
      }
      this.J[i * 3] = T[i * 3];
      this.J[i * 3 + 1] = T[i * 3 + 1];
      this.J[i * 3 + 2] = T[i * 3 + 2];
    }
  }

  /** Пересчитать вершины по костям этого кадра. */
  write(): void {
    const { rest, restN, bone, pos, nor, R, T } = this;
    const n = bone.length;
    for (let i = 0; i < n; i++) {
      const b = bone[i] * 9;
      const t = bone[i] * 3;
      const x = rest[i * 3];
      const y = rest[i * 3 + 1];
      const z = rest[i * 3 + 2];
      pos[i * 3] = T[t] + R[b] * x + R[b + 3] * y + R[b + 6] * z;
      pos[i * 3 + 1] = T[t + 1] + R[b + 1] * x + R[b + 4] * y + R[b + 7] * z;
      pos[i * 3 + 2] = T[t + 2] + R[b + 2] * x + R[b + 5] * y + R[b + 8] * z;
      const nx = restN[i * 3];
      const ny = restN[i * 3 + 1];
      const nz = restN[i * 3 + 2];
      nor[i * 3] = R[b] * nx + R[b + 3] * ny + R[b + 6] * nz;
      nor[i * 3 + 1] = R[b + 1] * nx + R[b + 4] * ny + R[b + 7] * nz;
      nor[i * 3 + 2] = R[b + 2] * nx + R[b + 5] * ny + R[b + 8] * nz;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Точка в осях кости (от её сустава в позе покоя, оси персонажа) — в осях комнаты этого кадра. */
  at(name: string, local: V3 = [0, 0, 0]): V3 {
    const i = this.sk.of(name);
    const R = this.R;
    const b = i * 9;
    const x = local[0];
    const y = local[1];
    const z = local[2];
    return [this.T[i * 3] + R[b] * x + R[b + 3] * y + R[b + 6] * z, this.T[i * 3 + 1] + R[b + 1] * x + R[b + 4] * y + R[b + 7] * z, this.T[i * 3 + 2] + R[b + 2] * x + R[b + 5] * y + R[b + 8] * z];
  }

  /** Поворот кости этого кадра (столбцы — её оси x, y, z в осях комнаты). */
  axes(name: string): Float64Array {
    const i = this.sk.of(name);
    return this.R.subarray(i * 9, i * 9 + 9);
  }

  /** Вершины этого кадра — тестам (где кот, не в стене ли слуга). */
  positions(): Float32Array {
    return this.pos;
  }

  dispose(): void {
    this.geo.dispose();
  }
}

const ZERO: Turn = [0, 0, 0];

/** Поворот y, потом x, потом z — матрица 3×3 по столбцам. */
export function rotYXZ(y: number, x: number, z: number, out: Float64Array): Float64Array {
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  const cx = Math.cos(x);
  const sx = Math.sin(x);
  const cz = Math.cos(z);
  const sz = Math.sin(z);
  // Ry · Rx · Rz.
  const m00 = cy * cz + sy * sx * sz;
  const m01 = -cy * sz + sy * sx * cz;
  const m02 = sy * cx;
  const m10 = cx * sz;
  const m11 = cx * cz;
  const m12 = -sx;
  const m20 = -sy * cz + cy * sx * sz;
  const m21 = sy * sz + cy * sx * cz;
  const m22 = cy * cx;
  out[0] = m00;
  out[1] = m10;
  out[2] = m20;
  out[3] = m01;
  out[4] = m11;
  out[5] = m21;
  out[6] = m02;
  out[7] = m12;
  out[8] = m22;
  return out;
}

/** a · b → out (3×3 по столбцам; `out` может быть `a`). */
function mul3(a: Float64Array, b: Float64Array, out: Float64Array): void {
  const r = new Float64Array(9);
  for (let c = 0; c < 3; c++)
    for (let rr = 0; rr < 3; rr++) r[c * 3 + rr] = a[rr] * b[c * 3] + a[3 + rr] * b[c * 3 + 1] + a[6 + rr] * b[c * 3 + 2];
  out.set(r);
}

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** Две оси поперёк `d`. */
export function perp(d: V3): [V3, V3] {
  const h: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(h, d));
  return [u, cross(d, u)];
}
