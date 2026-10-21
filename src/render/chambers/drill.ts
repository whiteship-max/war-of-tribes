// Покои правителя (docs/city_v3.md, Г-11): отработка меча — соломенное чучело у восточной стены, след клинка, искры по
// камню и железу, щепа и пыль по дереву, солома из чучела, зарубки на нём. Чучело качается от удара на крестовине.
// Строится при входе в покои вместе с ними (`room.ts`); числа удара — `sword.ts`, место — `plan.DUMMY`.
import * as THREE from 'three';
import { geometryOf } from '../city/index';
import { tint, type V3 } from '../city/geom';
import { Mesher } from './geo';
import { DUMMY } from './plan';
import type { Surface } from './sword';

/** Сколько живёт след клинка, с: короткая полоса за острием, не шлейф. */
export const TRAIL_LIFE = 0.13;
const TRAIL_N = 12;
/** Зарубок на чучеле — не больше (новая занимает место самой старой). */
export const DENTS = 10;
/** Искр и соломин на уровень качества. */
export const SPARKS: Record<0 | 1 | 2, number> = { 0: 24, 1: 40, 2: 64 };

const STRAW = 0xc8a165;
const STRAW_DARK = 0x8a6a3a;
const ROPE = 0x5b4127;
const OAK = 0x5e3f28;
const T = (hex: number, k = 1): V3 => tint(hex, k);

/** Модель чучела: крестовина (стоит) и тело на столбе (качается вокруг низа столба). Свои оси: перед — +z, к покоям. */
export function dummyModel(detail: 0 | 1 | 2): { base: Mesher; body: Mesher } {
  const base = new Mesher();
  const body = new Mesher();
  const seg = [8, 10, 12][detail];
  // Крестовина — два бруса накрест.
  const b = DUMMY.base;
  base.cuboid(-b, 0, -0.045, b, 0.07, 0.045, 'wood', T(OAK, 0.8), { skip: '-y' });
  base.cuboid(-0.045, 0, -b, 0.045, 0.07, b, 'wood', T(OAK, 0.75), { skip: '-y' });
  // Столб — от крестовины до верха над головой; перекладина рук.
  const p = DUMMY.post;
  body.cuboid(-p, 0, -p, p, DUMMY.top - 0.07, p, 'wood', T(OAK, 0.9), { skip: '-y' });
  const y0 = DUMMY.y0 - 0.07;
  const y1 = DUMMY.y1 - 0.07;
  const r = DUMMY.r;
  // Тело — сноп соломы, перетянутый в поясе.
  body.lathe(
    [
      [0, y0 - 0.02],
      [r * 0.72, y0],
      [r * 0.98, y0 + 0.12],
      [r * 0.9, (y0 + y1) / 2],
      [r, y1 - 0.18],
      [r * 0.55, y1 - 0.03],
      [0, y1],
    ],
    seg,
    'plain',
    T(STRAW),
  );
  // Подол — солома торчит из-под нижней перевязи, топорщится наружу.
  body.lathe(
    [
      [r * 0.74, y0 + 0.02],
      [r * 1.12, y0 - 0.09],
      [r * 0.62, y0 - 0.05],
    ],
    seg,
    'plain',
    T(STRAW_DARK, 1.15),
  );
  // Голова — узел соломы.
  const hy = DUMMY.head.y - 0.07;
  const hr = DUMMY.head.r;
  body.lathe(
    [
      [0, hy - hr],
      [hr * 0.7, hy - hr * 0.8],
      [hr, hy - hr * 0.1],
      [hr * 0.86, hy + hr * 0.6],
      [0, hy + hr],
    ],
    detail === 2 ? 10 : 8,
    'plain',
    T(STRAW, 1.05),
  );
  // Хохол — вихор соломы на макушке.
  body.lathe(
    [
      [hr * 0.55, hy + hr * 0.75],
      [hr * 0.75, hy + hr * 1.25],
      [0, hy + hr * 1.05],
    ],
    6,
    'plain',
    T(STRAW_DARK, 1.2),
  );
  // Перевязи: пояс, грудь, шея — верёвка.
  for (const [y, rr] of [
    [y0 + 0.26, r * 0.93],
    [y1 - 0.24, r * 1.01],
    [hy - hr * 0.95, hr * 0.62],
  ] as const)
    body.lathe(
      [
        [rr + 0.01, y - 0.017],
        [rr + 0.01, y + 0.017],
      ],
      seg,
      'plain',
      T(ROPE),
    );
  // Руки — перекладина в соломенных пучках.
  const ay = DUMMY.arms.y - 0.07;
  const ah = DUMMY.arms.half;
  const t = DUMMY.arms.t;
  body.cuboid(-ah, ay - t / 2, -t / 2, ah, ay + t / 2, t / 2, 'plain', T(STRAW, 0.92));
  for (const s of [1, -1]) body.cuboid(s > 0 ? ah - 0.02 : -ah - 0.04, ay - 0.05, -0.05, s > 0 ? ah + 0.04 : -ah + 0.02, ay + 0.05, 0.05, 'plain', T(STRAW_DARK));
  return { base, body };
}

interface Bit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  age: number;
  /** Солома: медленно, с сопротивлением воздуха и порхая. */
  drag: number;
  c: V3;
}

/** Отработка меча: чучело, след, искры и солома (в осях комнаты, группа — в начале покоев). */
export class Drill {
  readonly group = new THREE.Group();
  private sway = new THREE.Group();
  private baseMesh: THREE.Mesh;
  private bodyMesh: THREE.Mesh;
  /** Качание чучела: наклон к северу-югу и к востоку-западу, скорость. */
  private tilt = { a: 0, b: 0, va: 0, vb: 0 };
  private dents: THREE.Mesh;
  private dentN = 0;
  private trailMesh: THREE.Mesh;
  private trailPts: { a: V3; b: V3; age: number; k: number }[] = [];
  private sparks: THREE.Points;
  private bits: THREE.Points;
  private sparkList: Bit[] = [];
  private bitList: Bit[] = [];
  private max: number;
  /** Кость искр и соломы — своя (картинка, не игра). */
  private seed = 2711;

  constructor(material: THREE.Material, origin: THREE.Vector3, detail: 0 | 1 | 2) {
    this.max = SPARKS[detail];
    this.group.position.copy(origin);
    this.group.name = 'chambers-drill';
    const m = dummyModel(detail);
    this.baseMesh = new THREE.Mesh(geometryOf(m.base.b), material);
    this.bodyMesh = new THREE.Mesh(geometryOf(m.body.b), material);
    this.baseMesh.name = 'chambers-dummy-base';
    this.bodyMesh.name = 'chambers-dummy';
    // Лицом к покоям (на запад): своё +z — к −x комнаты.
    this.baseMesh.position.set(DUMMY.x, 0, DUMMY.z);
    this.baseMesh.rotation.y = -Math.PI / 2;
    this.sway.position.set(DUMMY.x, 0.07, DUMMY.z);
    this.sway.rotation.y = -Math.PI / 2;
    this.sway.add(this.bodyMesh);
    this.group.add(this.baseMesh, this.sway);
    // Зарубки — тёмные щели на соломе, в осях тела.
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DENTS * 4 * 3), 3));
    const di: number[] = [];
    for (let i = 0; i < DENTS; i++) di.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    dg.setIndex(di);
    this.dents = new THREE.Mesh(dg, new THREE.MeshBasicMaterial({ color: 0x2c1c0c, transparent: true, opacity: 0.78, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    this.dents.name = 'chambers-dummy-dents';
    this.dents.frustumCulled = false;
    this.sway.add(this.dents);
    // След клинка — лента от середины клинка к острию, гаснет к хвосту; светлым поверх (сложением).
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
    const ti: number[] = [];
    for (let i = 0; i + 1 < TRAIL_N; i++) ti.push(i * 2, i * 2 + 1, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 2);
    tg.setIndex(ti);
    this.trailMesh = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.trailMesh.name = 'chambers-trail';
    this.trailMesh.frustumCulled = false;
    this.trailMesh.visible = false;
    this.group.add(this.trailMesh);
    this.sparks = points(this.max, 0.014, true);
    this.sparks.name = 'chambers-sparks';
    this.bits = points(this.max, 0.018, false);
    this.bits.name = 'chambers-straw';
    this.group.add(this.sparks, this.bits);
  }

  private rnd(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  /** Точка следа этого кадра (оси комнаты): середина клинка и острие; `k` — яркость (сильный удар — ярче), 0 — не рубит. */
  trail(a: V3, b: V3, k: number): void {
    if (k > 0) this.trailPts.unshift({ a, b, age: 0, k });
    if (this.trailPts.length > TRAIL_N) this.trailPts.length = TRAIL_N;
  }

  /** Клинок встретил `surface` в точке `at` (оси комнаты), удар шёл по `dir` (оси комнаты), сила `force`. */
  hit(surface: Surface, at: V3, dir: V3, force: number): void {
    const r = (): number => this.rnd();
    const spray = (n: number, list: Bit[], speed: number, up: number, life: number, drag: number, c: () => V3): void => {
      for (let i = 0; i < n; i++) {
        if (list.length >= this.max) list.shift();
        // Назад от удара и вверх, с разбросом.
        const vx = -dir[0] * speed * (0.3 + r()) + (r() - 0.5) * speed * 1.4;
        const vz = -dir[2] * speed * (0.3 + r()) + (r() - 0.5) * speed * 1.4;
        const vy = up * (0.3 + r()) + (r() - 0.3) * speed * 0.6;
        list.push({ x: at[0], y: at[1], z: at[2], vx, vy, vz, life: life * (0.6 + r() * 0.6), age: 0, drag, c: c() });
      }
    };
    const k = Math.min(1.6, force);
    switch (surface) {
      case 'stone':
      case 'iron':
        spray(Math.round(14 + 10 * k), this.sparkList, 2.6 * k + 1, 1.6, 0.38, 0.6, () => [1, 0.62 + r() * 0.3, 0.22 + r() * 0.2]);
        spray(4, this.bitList, 0.5, 0.4, 0.5, 3, () => T(0x9a948c, 0.7 + r() * 0.3));
        break;
      case 'wood':
        spray(Math.round(6 + 5 * k), this.bitList, 1.1 * k + 0.4, 1.0, 0.7, 1.2, () => T(0x8d6a45, 0.7 + r() * 0.4));
        break;
      case 'cloth':
        spray(5, this.bitList, 0.4, 0.4, 0.8, 4, () => T(0xd8ccb5, 0.8 + r() * 0.2));
        break;
      case 'straw': {
        spray(Math.round(18 + 12 * k), this.bitList, 1.3 * k + 0.5, 1.4, 1.5, 4.5, () => T(STRAW, 0.75 + r() * 0.45));
        this.dent(at, dir);
        // Чучело качается от удара: наклон по направлению удара, сильнее — дальше.
        const s = 0.9 * k;
        this.tilt.va += dir[0] * s;
        this.tilt.vb += dir[2] * s;
        break;
      }
    }
  }

  /** Зарубка на соломе: щель вдоль кромки удара, на поверхности тела. */
  private dent(at: V3, dir: V3): void {
    this.group.updateMatrixWorld(true);
    const p = this.sway.worldToLocal(new THREE.Vector3(at[0], at[1], at[2]).add(this.group.position));
    const d = new THREE.Vector3(dir[0], dir[1], dir[2]).transformDirection(new THREE.Matrix4().copy(this.sway.matrixWorld).invert());
    const n = new THREE.Vector3(p.x, 0, p.z);
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
    n.normalize();
    // На поверхность: тело — `DUMMY.r`, голова и руки — где встретил.
    const body = p.y + 0.07 >= DUMMY.y0 && p.y + 0.07 <= DUMMY.y1;
    const c = body ? new THREE.Vector3(n.x * (DUMMY.r * 0.97 + 0.004), p.y, n.z * (DUMMY.r * 0.97 + 0.004)) : p.clone().addScaledVector(n, 0.004);
    const e = d.clone().addScaledVector(n, -d.dot(n));
    if (e.lengthSq() < 1e-6) e.set(0, 1, 0);
    e.normalize();
    const w = new THREE.Vector3().crossVectors(n, e).normalize();
    const pos = (this.dents.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const i = (this.dentN++ % DENTS) * 12;
    const L = 0.055 + this.rnd() * 0.025;
    const H = 0.008 + this.rnd() * 0.006;
    const corners = [c.clone().addScaledVector(e, -L).addScaledVector(w, -H), c.clone().addScaledVector(e, L).addScaledVector(w, -H * 0.4), c.clone().addScaledVector(e, L).addScaledVector(w, H * 0.4), c.clone().addScaledVector(e, -L).addScaledVector(w, H)];
    corners.forEach((v, j) => {
      pos[i + j * 3] = v.x;
      pos[i + j * 3 + 1] = v.y;
      pos[i + j * 3 + 2] = v.z;
    });
    this.dents.geometry.getAttribute('position').needsUpdate = true;
    this.dents.geometry.computeBoundingSphere();
  }

  /** Сколько зарубок на чучеле — стенду и тестам. */
  get dented(): number {
    return Math.min(DENTS, this.dentN);
  }

  /** Сколько искр и соломин в воздухе — тестам. */
  get flying(): { sparks: number; bits: number } {
    return { sparks: this.sparkList.length, bits: this.bitList.length };
  }

  /** Наклон чучела сейчас, радианы. */
  get lean(): number {
    return Math.hypot(this.tilt.a, this.tilt.b);
  }

  step(dt: number): void {
    // Качание: пружина на крестовине, гаснет за секунду с небольшим.
    const t = this.tilt;
    const w2 = 70;
    const damp = 5;
    t.va += (-w2 * t.a - damp * t.va) * dt;
    t.vb += (-w2 * t.b - damp * t.vb) * dt;
    t.a = clampAbs(t.a + t.va * dt, 0.14);
    t.b = clampAbs(t.b + t.vb * dt, 0.14);
    // Своё +z чучела — к −x покоев: наклон по x покоев — вокруг его оси z, по z покоев — вокруг его x.
    this.sway.rotation.set(0, 0, 0);
    this.sway.rotateY(-Math.PI / 2);
    this.sway.rotateX(t.b);
    this.sway.rotateZ(t.a);
    this.stepBits(this.sparkList, this.sparks, dt, true);
    this.stepBits(this.bitList, this.bits, dt, false);
    this.stepTrail(dt);
  }

  private stepBits(list: Bit[], pts: THREE.Points, dt: number, glow: boolean): void {
    const g = 9.8;
    for (const b of list) {
      b.age += dt;
      const dragK = Math.exp(-b.drag * dt);
      b.vx *= dragK;
      b.vz *= dragK;
      b.vy = b.vy * dragK - g * dt * (b.drag > 3 ? 0.35 : 1);
      // Солома порхает: качается поперёк падения.
      if (b.drag > 3) {
        b.vx += Math.sin(b.age * 11 + b.c[1] * 40) * 0.6 * dt;
        b.vz += Math.cos(b.age * 9 + b.c[0] * 40) * 0.6 * dt;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      // Пол: искра гаснет, солома ложится.
      if (b.y < 0.005) {
        b.y = 0.005;
        b.vx = b.vy = b.vz = 0;
        if (glow) b.age = b.life;
      }
    }
    for (let i = list.length - 1; i >= 0; i--) if (list[i].age >= list[i].life) list.splice(i, 1);
    const pos = (pts.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const col = (pts.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < this.max; i++) {
      const b = list[i];
      if (!b) {
        pos[i * 3 + 1] = -50;
        col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = 0;
        continue;
      }
      pos[i * 3] = b.x;
      pos[i * 3 + 1] = b.y;
      pos[i * 3 + 2] = b.z;
      // Искра остывает: белое → оранжевое → тьма; солома — к концу жизни тускнеет на полу.
      const k = 1 - b.age / b.life;
      const f = glow ? k * k : Math.min(1, k * 3);
      col[i * 3] = b.c[0] * f;
      col[i * 3 + 1] = b.c[1] * (glow ? k : f);
      col[i * 3 + 2] = b.c[2] * (glow ? k * k * k : f);
    }
    pts.geometry.getAttribute('position').needsUpdate = true;
    pts.geometry.getAttribute('color').needsUpdate = true;
    pts.visible = list.length > 0;
  }

  private stepTrail(dt: number): void {
    for (const p of this.trailPts) p.age += dt;
    while (this.trailPts.length && this.trailPts[this.trailPts.length - 1].age > TRAIL_LIFE) this.trailPts.pop();
    const pts = this.trailPts;
    this.trailMesh.visible = pts.length >= 2;
    if (!this.trailMesh.visible) return;
    const pos = (this.trailMesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const col = (this.trailMesh.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < TRAIL_N; i++) {
      const p = pts[Math.min(i, pts.length - 1)];
      const fade = i < pts.length ? Math.pow(1 - p.age / TRAIL_LIFE, 1.6) * p.k : 0;
      // У середины клинка след бледнее, у острия — ярче: дуга видна, а клинок не тонет.
      pos.set(p.a, i * 6);
      pos.set(p.b, i * 6 + 3);
      col.set([0.3 * fade, 0.31 * fade, 0.34 * fade], i * 6);
      col.set([0.95 * fade, 0.96 * fade, 1.0 * fade], i * 6 + 3);
    }
    this.trailMesh.geometry.getAttribute('position').needsUpdate = true;
    this.trailMesh.geometry.getAttribute('color').needsUpdate = true;
  }

  /** Треугольников чучела, следа и зарубок — бюджет отработки. */
  counts(): number {
    const tri = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    return tri(this.baseMesh.geometry) + tri(this.bodyMesh.geometry) + tri(this.dents.geometry) + tri(this.trailMesh.geometry);
  }

  dispose(): void {
    for (const o of [this.baseMesh, this.bodyMesh, this.dents, this.trailMesh]) o.geometry.dispose();
    for (const o of [this.dents, this.trailMesh]) (o.material as THREE.Material).dispose();
    for (const p of [this.sparks, this.bits]) {
      p.geometry.dispose();
      (p.material as THREE.Material).dispose();
    }
    this.group.removeFromParent();
  }
}

function points(n: number, size: number, glow: boolean): THREE.Points {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) pos[i * 3 + 1] = -50;
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const m = new THREE.PointsMaterial({ size, vertexColors: true, sizeAttenuation: true, transparent: true, depthWrite: false, blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.visible = false;
  return p;
}

const clampAbs = (v: number, m: number): number => Math.max(-m, Math.min(m, v));
