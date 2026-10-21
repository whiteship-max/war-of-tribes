// Супруга правителя (ЛЦ-2, docs/characters.md): сетка с кожей в два веса, как модели классического Warcraft III. Вершина
// принадлежит одной или двум костям (вес второй — остаток), кадр ставит кости и пересчитывает места и нормали вершин на
// процессоре — как люди покоев (`rig.ts`): ни `SkinnedMesh`, ни новых имён three, вызов отрисовки один на всю фигуру.
//
// Две текстуры по 512 × 512: тело (`sheet` 0) и лицо (`sheet` 1). Белок глаза двигает взгляд сдвигом своих UV (`gaze`),
// веки и челюсть — кости.
import * as THREE from 'three';
import type { V3 } from '../../city/geom';
import { Skeleton, rotYXZ, type RigPose, type Turn } from '../rig';

/** Кость вершины: одна (вес 1) или две — первая с весом `w`, вторая с остатком. */
export type Weights = string | readonly [string, string, number];

/** Не больше двух весов на вершину — так у моделей WC3 и так считает кадр. */
export const MAX_WEIGHTS = 2;

/** Построитель сетки: вершины в позе покоя (оси персонажа: пол между ступнями, лицом к +z), грани — против часовой снаружи. */
export class SkinMesh {
  readonly pos: number[] = [];
  readonly uv: number[] = [];
  readonly sheet: number[] = [];
  readonly shade: number[] = [];
  readonly b0: number[] = [];
  readonly b1: number[] = [];
  readonly w0: number[] = [];
  readonly idx: number[] = [];
  /** Вершины белка — взгляд сдвигает их UV. */
  readonly eye: number[] = [];

  constructor(readonly sk: Skeleton) {}

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  get triangles(): number {
    return this.idx.length / 3;
  }

  /** Вершина: место, UV (доли листа, v — вниз от верха картинки), лист, тень вершины (1 — без тени), кости. */
  v(p: V3, uv: readonly [number, number], sheet: 0 | 1, bones: Weights, shade = 1): number {
    const [a, b, w] = typeof bones === 'string' ? [bones, bones, 1] : bones;
    this.pos.push(p[0], p[1], p[2]);
    this.uv.push(uv[0], uv[1]);
    this.sheet.push(sheet);
    this.shade.push(shade);
    this.b0.push(this.sk.of(a));
    this.b1.push(this.sk.of(b));
    this.w0.push(Math.max(0, Math.min(1, w)));
    return this.vertexCount - 1;
  }

  at(i: number): V3 {
    return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]];
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  /**
   * Четырёхугольник a-b-c-d; обход — так, чтобы нормаль смотрела от точки `inside` (ось части тела). Вырожденный угол
   * (совпали две вершины) пишется одним треугольником.
   */
  quad(a: number, b: number, c: number, d: number, inside: V3): void {
    const pa = this.at(a);
    const n = cross(sub(this.at(b), pa), sub(this.at(d), pa));
    const mid = scale(add(add(pa, this.at(b)), add(this.at(c), this.at(d))), 0.25);
    const flip = dot(n, sub(mid, inside)) < 0;
    // Диагональ — короче из двух: у зеркальных половин выбор зеркальный, и неплоский четырёхугольник не складывается
    // изнанкой наружу по-разному слева и справа.
    const ac = len2(sub(this.at(a), this.at(c)));
    const bd = len2(sub(this.at(b), this.at(d)));
    const [p, q, r, t] = bd + 1e-12 < ac ? [b, c, d, a] : [a, b, c, d];
    const tris: [number, number, number][] = flip
      ? [
          [p, t, r],
          [p, r, q],
        ]
      : [
          [p, q, r],
          [p, r, t],
        ];
    for (const [x, y, z] of tris) if (x !== y && y !== z && x !== z && area2(this.at(x), this.at(y), this.at(z)) > 1e-14) this.tri(x, y, z);
  }

  /** Полоса граней между рядами вершин одной длины (`closed` — ряд замкнут в кольцо). */
  strip(rows: readonly (readonly number[])[], closed: boolean, inside: (p: V3) => V3): void {
    for (let i = 0; i + 1 < rows.length; i++) {
      const r0 = rows[i];
      const r1 = rows[i + 1];
      const n = closed ? r0.length : r0.length - 1;
      for (let k = 0; k < n; k++) {
        const k1 = (k + 1) % r0.length;
        const a = r0[k];
        const b = r0[k1];
        const c = r1[k1];
        const d = r1[k];
        const mid = scale(add(add(this.at(a), this.at(b)), add(this.at(c), this.at(d))), 0.25);
        this.quad(a, b, c, d, inside(mid));
      }
    }
  }
}

/**
 * Фигура на сцене: сетка с неизменной раскладкой, кости и поза. Тот же договор, что у `rig.Rig` (люди покоев зовут
 * `pose`, `write`, `at`, `axes`), — `folk.Person` водит её так же.
 */
export class SkinBody {
  readonly mesh: THREE.Mesh;
  readonly sk: Skeleton;
  readonly triangles: number;
  private geo: THREE.BufferGeometry;
  private r0: Float32Array;
  private r1: Float32Array;
  private restN: Float32Array;
  private b0: Uint8Array;
  private b1: Uint8Array;
  private w0: Float32Array;
  private pos: Float32Array;
  private nor: Float32Array;
  private uv: Float32Array;
  private eye: Uint16Array;
  private eyeUv: Float32Array;
  private gazeAt: [number, number] = [0, 0];
  private R: Float64Array;
  private T: Float64Array;
  /** Сдвиг UV белка на метр взгляда: листы глаз — свои (`shape.EYE_SHEET`). */
  constructor(
    m: SkinMesh,
    material: THREE.Material,
    name: string,
    private gazeScale: readonly [number, number] = [1, 1],
  ) {
    this.sk = m.sk;
    const n = m.vertexCount;
    const bones = this.sk.bones;
    this.b0 = Uint8Array.from(m.b0);
    this.b1 = Uint8Array.from(m.b1);
    this.w0 = Float32Array.from(m.w0);
    this.r0 = new Float32Array(n * 3);
    this.r1 = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const j0 = bones[m.b0[i]].j;
      const j1 = bones[m.b1[i]].j;
      for (let a = 0; a < 3; a++) {
        this.r0[i * 3 + a] = m.pos[i * 3 + a] - j0[a];
        this.r1[i * 3 + a] = m.pos[i * 3 + a] - j1[a];
      }
    }
    this.restN = normalsOf(m);
    this.pos = Float32Array.from(m.pos);
    this.nor = Float32Array.from(this.restN);
    this.uv = Float32Array.from(m.uv);
    this.eye = Uint16Array.from(m.eye);
    this.eyeUv = Float32Array.from(m.eye.flatMap((i) => [m.uv[i * 2], m.uv[i * 2 + 1]]));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    g.setAttribute('sheet', new THREE.BufferAttribute(Float32Array.from(m.sheet), 1));
    g.setAttribute('shade', new THREE.BufferAttribute(Float32Array.from(m.shade), 1));
    g.setIndex(new THREE.BufferAttribute(Uint16Array.from(m.idx), 1));
    this.geo = g;
    this.triangles = m.triangles;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.R = new Float64Array(bones.length * 9);
    this.T = new Float64Array(bones.length * 3);
  }

  /** Поставить кости по позе — как `rig.Rig.pose`: корень над местом персонажа, дети — от суставов родителя. */
  pose(p: RigPose): void {
    const bones = this.sk.bones;
    const { R, T } = this;
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      const t = p.turns[b.name] ?? ZERO;
      if (b.parent < 0) {
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
        const c = Math.cos(p.yaw);
        const s = Math.sin(p.yaw);
        T[i * 3] = p.x + jx * c + jz * s;
        T[i * 3 + 1] = p.y + jy;
        T[i * 3 + 2] = p.z - jx * s + jz * c;
      } else {
        const q = b.parent;
        const pj = bones[q].j;
        const ox = b.j[0] - pj[0];
        const oy = b.j[1] - pj[1];
        const oz = b.j[2] - pj[2];
        const PR = R.subarray(q * 9, q * 9 + 9);
        T[i * 3] = T[q * 3] + PR[0] * ox + PR[3] * oy + PR[6] * oz;
        T[i * 3 + 1] = T[q * 3 + 1] + PR[1] * ox + PR[4] * oy + PR[7] * oz;
        T[i * 3 + 2] = T[q * 3 + 2] + PR[2] * ox + PR[5] * oy + PR[8] * oz;
        rotYXZ(t[1], t[0], t[2], L);
        mul3(PR, L, R.subarray(i * 9, i * 9 + 9));
      }
    }
  }

  /** Взгляд: сдвиг радужки по белку, метры по горизонтали и вверх (листы глаз сдвигаются обратно). */
  gaze(dx: number, dy: number): void {
    if (Math.abs(dx - this.gazeAt[0]) < 1e-5 && Math.abs(dy - this.gazeAt[1]) < 1e-5) return;
    this.gazeAt = [dx, dy];
    const su = -dx * this.gazeScale[0];
    const sv = dy * this.gazeScale[1];
    for (let k = 0; k < this.eye.length; k++) {
      const i = this.eye[k];
      this.uv[i * 2] = this.eyeUv[k * 2] + su;
      this.uv[i * 2 + 1] = this.eyeUv[k * 2 + 1] + sv;
    }
    (this.geo.getAttribute('uv') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Пересчитать вершины: смесь двух костей по весу. */
  write(): void {
    const { r0, r1, restN, b0, b1, w0, pos, nor, R, T } = this;
    const n = b0.length;
    for (let i = 0; i < n; i++) {
      const w = w0[i];
      const k = i * 3;
      let px = 0;
      let py = 0;
      let pz = 0;
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let s = 0; s < 2; s++) {
        const ws = s === 0 ? w : 1 - w;
        if (ws <= 0) continue;
        const bi = s === 0 ? b0[i] : b1[i];
        const r = s === 0 ? r0 : r1;
        const b = bi * 9;
        const t = bi * 3;
        const x = r[k];
        const y = r[k + 1];
        const z = r[k + 2];
        px += ws * (T[t] + R[b] * x + R[b + 3] * y + R[b + 6] * z);
        py += ws * (T[t + 1] + R[b + 1] * x + R[b + 4] * y + R[b + 7] * z);
        pz += ws * (T[t + 2] + R[b + 2] * x + R[b + 5] * y + R[b + 8] * z);
        const ax = restN[k];
        const ay = restN[k + 1];
        const az = restN[k + 2];
        nx += ws * (R[b] * ax + R[b + 3] * ay + R[b + 6] * az);
        ny += ws * (R[b + 1] * ax + R[b + 4] * ay + R[b + 7] * az);
        nz += ws * (R[b + 2] * ax + R[b + 5] * ay + R[b + 8] * az);
      }
      pos[k] = px;
      pos[k + 1] = py;
      pos[k + 2] = pz;
      const l = Math.hypot(nx, ny, nz) || 1;
      nor[k] = nx / l;
      nor[k + 1] = ny / l;
      nor[k + 2] = nz / l;
    }
    (this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
  }

  /** Точка в осях кости (от её сустава в позе покоя) — в осях комнаты этого кадра. */
  at(name: string, local: V3 = [0, 0, 0]): V3 {
    const i = this.sk.of(name);
    const R = this.R;
    const b = i * 9;
    const [x, y, z] = local;
    return [this.T[i * 3] + R[b] * x + R[b + 3] * y + R[b + 6] * z, this.T[i * 3 + 1] + R[b + 1] * x + R[b + 4] * y + R[b + 7] * z, this.T[i * 3 + 2] + R[b + 2] * x + R[b + 5] * y + R[b + 8] * z];
  }

  axes(name: string): Float64Array {
    const i = this.sk.of(name);
    return this.R.subarray(i * 9, i * 9 + 9);
  }

  positions(): Float32Array {
    return this.pos;
  }

  uvs(): Float32Array {
    return this.uv;
  }

  dispose(): void {
    this.geo.dispose();
  }
}

const ZERO: Turn = [0, 0, 0];
const M = new Float64Array(9);
const L = new Float64Array(9);
const TMP = new Float64Array(9);

/** a · b → out (3×3 по столбцам; `out` может быть `a`). */
function mul3(a: Float64Array, b: Float64Array, out: Float64Array): void {
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) TMP[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
  out.set(TMP);
}

/** Нормали вершин: сумма нормалей граней (по площади), каждая часть гладкая внутри себя. */
export function normalsOf(m: SkinMesh): Float32Array {
  const n = new Float32Array(m.pos.length);
  for (let i = 0; i < m.idx.length; i += 3) {
    const a = m.idx[i];
    const b = m.idx[i + 1];
    const c = m.idx[i + 2];
    const f = cross(sub(m.at(b), m.at(a)), sub(m.at(c), m.at(a)));
    for (const v of [a, b, c]) {
      n[v * 3] += f[0];
      n[v * 3 + 1] += f[1];
      n[v * 3 + 2] += f[2];
    }
  }
  for (let v = 0; v < n.length; v += 3) {
    const l = Math.hypot(n[v], n[v + 1], n[v + 2]) || 1;
    n[v] /= l;
    n[v + 1] /= l;
    n[v + 2] /= l;
  }
  return n;
}

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const lerp3 = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const len2 = (a: V3): number => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
const area2 = (a: V3, b: V3, c: V3): number => {
  const f = cross(sub(b, a), sub(c, a));
  return f[0] * f[0] + f[1] * f[1] + f[2] * f[2];
};
