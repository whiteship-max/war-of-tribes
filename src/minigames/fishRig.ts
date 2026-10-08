/**
 * Рыболов от первого лица: удилище, катушка, руки в перчатках (docs/minigames.md, раздел 17).
 *
 * ВСЁ ЗДЕСЬ — ВЕЩЬ ВЗГЛЯДА, как лук «Охоты» (`archer.ts`). Риг висит на камере и считается в её осях. Правило рыбалки
 * (`fishing.ts`) о руках не знает: риг читает у него фазу, силу замаха, натяжение и то, тянут ли катушку, — и из этого
 * рисует жест. Палец тянет вниз — удилище уходит за плечо; отпустил — хлёст вперёд; на вываживании удилище гнётся туда,
 * куда тянет леска, тем круче, чем сильнее натяжение, и уходит вбок за пальцем; левая крутит ручку катушки, пока
 * подтягивают, и держит удилище, пока леску отдают.
 *
 * УДИЛИЩЕ ГНЁТСЯ ПО-НАСТОЯЩЕМУ: шестнадцать колен трубкой, каждое повёрнуто к леске на свою долю (комель — почти никак,
 * хлыст — сильнее всего). Вершины перекладываются каждый кадр — сто вершин, как тетива лука.
 *
 * ЦЕНА. Удилище, катушка, ручка катушки и две руки — пять вызовов. Тени риг не отбрасывает.
 */
import * as THREE from 'three';
import { Mesher, V, fist, viewMaterial, type FistSpec } from './hands';

/** Длина удилища, м: орешник в три метра — с берега дальше не забросишь, короче — не вываживаешь. */
export const ROD_L = 3.0;
/** Колен удилища: столько точек гнётся. */
const SEG = 16;
/** Сторон у кольца трубки. */
const SIDES = 6;
/** Толщина: комель, хлыст. */
const R_BUTT = 0.017;
const R_TIP = 0.0035;

/** Цвета: орешник светлый с тёмными узлами, комель обмотан кожей, кончик хлыста тёмный. */
const HAZEL = 0xb08a5a;
const HAZEL_NODE = 0x6e5236;
const WRAP = 0x3d2a1c;
const TIP = 0x2a2420;
/** Катушка — дубовая, ручка — рог. */
const OAK = 0x7a5634;
const OAK_DARK = 0x4e3622;
const KNOB = 0xd9ccb0;

/** Поза удилища: угол над горизонтом (больше π/2 — за плечом) и рыскание влево, рад; где комель — в осях камеры. */
export interface RodPose {
  elev: number;
  yaw: number;
  butt: readonly [number, number, number];
}

/** Покой: удилище вперёд и вверх из правой у бедра, хлыст — в верхней трети кадра. */
export const REST: RodPose = { elev: 0.38, yaw: 0.1, butt: [0.22, -0.4, -0.32] };
/** Вываживание: удилище выше — его держат против рыбы. */
export const FIGHT: RodPose = { elev: 0.66, yaw: 0.06, butt: [0.2, -0.36, -0.34] };
/** Замах в полную силу: за плечо. */
export const CHARGED: RodPose = { elev: 0.38 + 1.75, yaw: 0.12, butt: [0.24, -0.3, -0.26] };
/** Рыба в руке: удилище задрано, рыба висит перед глазами. */
export const SHOW: RodPose = { elev: 1.0, yaw: 0.22, butt: [0.2, -0.3, -0.3] };

/** Хлёст: за столько удилище проходит от замаха вперёд, и за столько возвращается в покой. */
export const WHIP_S = 0.13;
export const SETTLE_S = 0.4;
/** Насколько дальше покоя уходит хлыст на хлёсте, рад. */
const WHIP_OVER = 0.42;
/** Удилище вбок за пальцем на вываживании: столько рыскания на полное «вбок». */
export const ROD_SIDE = 0.45;

/** Направление удилища в осях камеры. */
export function rodDir(elev: number, yaw: number, out = new THREE.Vector3()): THREE.Vector3 {
  const c = Math.cos(elev);
  return out.set(-Math.sin(yaw) * c, Math.sin(elev), -Math.cos(yaw) * c);
}

const _q = new THREE.Quaternion();
const _a = new THREE.Vector3();
const _t = new THREE.Vector3();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _u = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/** Что риг читает у правила и у сцены. */
export interface RigInput {
  /** Секунды кадра (часы рига): качание, хлёст, ручка катушки. */
  now: number;
  dt: number;
  /** Фаза правила. */
  phase: 'idle' | 'charge' | 'flight' | 'wait' | 'hang' | 'back' | 'fight' | 'show';
  /** Сила замаха, 0..1. */
  power: number;
  /** Натяжение лески, 0..1. */
  tension: number;
  /** Тянут ли катушку. */
  reeling: boolean;
  /** Удилище вбок, −1..1. */
  rod: number;
  /** Куда тянет леска от хлыста — в осях камеры (единичный); нет — висит вниз. */
  pull: THREE.Vector3 | null;
  /** Сколько метров лески ушло с катушки за кадр (плюс) или пришло (минус): ручка крутится по нему. */
  paid: number;
}

/** Хват рукояти: четыре пальца кругом удилища, большой — поверх, вдоль. */
function rodGrip(side: number, grip: number): FistSpec {
  const s = side;
  return {
    side,
    grip,
    fingers: [
      { y: 0.027, r: 0.0094, from: 110, to: 320 },
      { y: 0.0085, r: 0.0098, from: 106, to: 324 },
      { y: -0.0098, r: 0.0094, from: 108, to: 320 },
      { y: -0.0272, r: 0.0081, from: 114, to: 308 },
    ],
    thumb: {
      path: [V(-s * 0.012, 0.016, 0.05), V(-s * 0.02, 0.03, 0.026), V(-s * 0.019, 0.04, 0.0), V(-s * 0.008, 0.047, -0.016)],
      r: [0.0125, 0.011, 0.0101, 0.009],
    },
    bracer: false,
  };
}

export class FishRig {
  readonly root = new THREE.Group();
  private rod: THREE.Mesh;
  private rodPos: Float32Array;
  private rodGeo: THREE.BufferGeometry;
  private reel: THREE.Mesh;
  private crank: THREE.Mesh;
  private right: THREE.Mesh;
  private left: THREE.Mesh;
  private mat = viewMaterial();
  /** Поза сейчас — тянется к цели с постоянной; хлёст ведёт её сам. */
  private elev = REST.elev;
  private yaw = REST.yaw;
  private butt = new THREE.Vector3(...REST.butt);
  /** Изгиб сейчас, рад на всю длину. */
  private bend = 0.05;
  private bendDir = new THREE.Vector3(0, -1, 0);
  /** Когда отпустили замах, с часов рига, и с какой позы. */
  private whipAt = -1e9;
  private whipFrom = REST.elev;
  private lastPhase: RigInput['phase'] = 'idle';
  /** Угол ручки катушки. */
  private crankA = 0;
  /** Где кончик хлыста — в осях камеры, после последнего `update`. */
  readonly tip = new THREE.Vector3();
  /** Сторона, с которой ложится поклёвка: хлыст вздрагивает. */
  private twitch = 0;
  /** Колена удилища — точки по оси. */
  private pts: THREE.Vector3[] = Array.from({ length: SEG + 1 }, () => new THREE.Vector3());

  constructor() {
    this.root.name = 'angler';
    // Удилище: трубка, вершины которой перекладываются каждый кадр. Индексы и цвета — один раз.
    const verts = (SEG + 1) * SIDES;
    this.rodPos = new Float32Array(verts * 3);
    const col = new Float32Array(verts * 3);
    const c = new THREE.Color();
    for (let i = 0; i <= SEG; i++) {
      const u = i / SEG;
      const node = Math.abs(((u * 9) % 1) - 0.5) < 0.04;
      c.setHex(u < 0.11 ? WRAP : u > 0.93 ? TIP : node ? HAZEL_NODE : HAZEL);
      for (let j = 0; j < SIDES; j++) col.set([c.r, c.g, c.b], (i * SIDES + j) * 3);
    }
    const idx: number[] = [];
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < SIDES; j++) {
        const a = i * SIDES + j;
        const b = i * SIDES + ((j + 1) % SIDES);
        const d = a + SIDES;
        const e = b + SIDES;
        idx.push(a, b, d, b, e, d);
      }
    }
    this.rodGeo = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.rodPos, 3);
    pa.setUsage(THREE.DynamicDrawUsage);
    this.rodGeo.setAttribute('position', pa);
    this.rodGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.rodGeo.setIndex(idx);
    this.rod = new THREE.Mesh(this.rodGeo, this.mat);
    this.rod.frustumCulled = false;
    this.rod.name = 'rod';

    // Катушка: барабан с намотанной леской, две щеки; ось — по X своего узла.
    const r = new Mesher();
    r.tube([V(-0.018, 0, 0), V(0.018, 0, 0)], [0.022, 0.022], (u, d) => (Math.abs(d.y) > 0.9 ? 0xd8d0bc : 0xc9bfa6), 10);
    for (const x of [-0.02, 0.02]) r.tube([V(x - 0.0025, 0, 0), V(x + 0.0025, 0, 0)], [0.036, 0.036], OAK, 12);
    r.tube([V(0, 0.022, 0), V(0, 0.045, 0)], [0.006, 0.008], OAK_DARK, 6);
    this.reel = new THREE.Mesh(r.geometry(), this.mat);
    this.reel.name = 'reel';
    // Ручка: плечо от оси наружу и роговая рукоять.
    const k = new Mesher();
    k.tube([V(0.023, 0, 0), V(0.026, 0.034, 0)], [0.005, 0.005], OAK_DARK, 5);
    k.tube([V(0.026, 0.034, 0), V(0.056, 0.034, 0)], [0.0075, 0.007], KNOB, 7);
    this.crank = new THREE.Mesh(k.geometry(), this.mat);
    this.crank.name = 'crank';
    this.right = new THREE.Mesh(fist(rodGrip(1, R_BUTT * 0.95)), this.mat);
    this.left = new THREE.Mesh(fist(rodGrip(-1, 0.009)), this.mat);
    for (const m of [this.rod, this.reel, this.crank, this.right, this.left]) {
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = false;
      this.root.add(m);
    }
    // Ручка крутится на оси катушки: её узел — внутри катушки.
    this.reel.add(this.crank);
  }

  /** Поклёвка: хлыст вздрагивает. */
  nod(k: number): void {
    this.twitch = Math.max(this.twitch, k);
  }

  update(i: RigInput): void {
    const dt = Math.max(0, i.dt);
    if (i.phase !== this.lastPhase) {
      if (this.lastPhase === 'charge' && i.phase === 'flight') {
        this.whipAt = i.now;
        this.whipFrom = this.elev;
      }
      this.lastPhase = i.phase;
    }
    // Цель позы по фазе.
    let target: RodPose = REST;
    if (i.phase === 'charge') target = { elev: REST.elev + (CHARGED.elev - REST.elev) * i.power, yaw: CHARGED.yaw, butt: lerp3(REST.butt, CHARGED.butt, i.power) };
    else if (i.phase === 'fight') target = { elev: FIGHT.elev, yaw: FIGHT.yaw - ROD_SIDE * i.rod, butt: FIGHT.butt };
    else if (i.phase === 'show') target = SHOW;
    else if (i.phase === 'back' || i.phase === 'hang') target = { elev: FIGHT.elev, yaw: REST.yaw, butt: FIGHT.butt };
    const since = i.now - this.whipAt;
    const k = 1 - Math.exp(-dt / (i.phase === 'charge' ? 0.05 : 0.12));
    if (since < WHIP_S + SETTLE_S) {
      // Хлёст: от замаха вперёд за `WHIP_S` (разгон к концу), потом пружиной в покой.
      const low = REST.elev - WHIP_OVER;
      if (since < WHIP_S) {
        const u = since / WHIP_S;
        this.elev = this.whipFrom + (low - this.whipFrom) * u * u;
      } else {
        const u = (since - WHIP_S) / SETTLE_S;
        this.elev = low + (target.elev - low) * (1 - Math.exp(-4 * u) * Math.cos(u * 7));
      }
    } else this.elev += (target.elev - this.elev) * k;
    this.yaw += (target.yaw - this.yaw) * k;
    _p.set(target.butt[0], target.butt[1], target.butt[2]);
    this.butt.lerp(_p, k);
    // Изгиб: на вываживании — натяжением, на хлёсте — инерцией хлыста, иначе — весом поплавка.
    const whipBend = since < WHIP_S + SETTLE_S ? 0.35 * Math.exp(-since / 0.15) : 0;
    const want = i.phase === 'fight' ? 0.12 + 1.15 * i.tension : i.phase === 'show' ? 0.55 : i.phase === 'hang' ? 0.7 : 0.06;
    this.bend += (want + whipBend - this.bend) * (1 - Math.exp(-dt / 0.06));
    if (i.pull) this.bendDir.lerp(i.pull, 1 - Math.exp(-dt / 0.05)).normalize();
    else this.bendDir.lerp(_p.set(0, -1, 0), 1 - Math.exp(-dt / 0.2)).normalize();
    this.twitch *= Math.exp(-dt / 0.12);
    this.build(i.now);
    this.hands(i, dt);
  }

  /** Колена: каждое повёрнуто к леске на свою долю изгиба. */
  private build(now: number): void {
    const dir = rodDir(this.elev, this.yaw, _d);
    // Дрожь хлыста от поклёвки — малым поворотом вниз.
    const shiver = this.twitch * Math.sin(now * 55) * 0.05;
    _a.crossVectors(dir, this.bendDir);
    const sinA = _a.length();
    const full = Math.atan2(sinA, dir.dot(this.bendDir));
    if (sinA > 1e-5) _a.divideScalar(sinA);
    else _a.set(1, 0, 0);
    const pts = this.pts;
    pts[0].copy(this.butt).addScaledVector(dir, -0.28);
    const step = ROD_L / SEG;
    for (let i = 0; i < SEG; i++) {
      const u = (i + 0.5) / SEG;
      const ang = Math.min(full, this.bend * u ** 1.7) + shiver * u * u;
      _q.setFromAxisAngle(_a, ang);
      _t.copy(dir).applyQuaternion(_q);
      pts[i + 1].copy(pts[i]).addScaledVector(_t, step);
    }
    this.tip.copy(pts[SEG]);
    // Кольца: рамка — по направлению колена, вторая ось — к «верху» удилища.
    let k = 0;
    for (let i = 0; i <= SEG; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(SEG, i + 1)];
      _t.subVectors(b, a).normalize();
      _s.crossVectors(_t, _y.set(0, 1, 0));
      if (_s.lengthSq() < 1e-6) _s.set(1, 0, 0);
      _s.normalize();
      _u.crossVectors(_s, _t).normalize();
      const r = R_BUTT + (R_TIP - R_BUTT) * (i / SEG) ** 0.8;
      for (let j = 0; j < SIDES; j++) {
        const f = (j / SIDES) * Math.PI * 2;
        _p.copy(pts[i]).addScaledVector(_s, Math.cos(f) * r).addScaledVector(_u, Math.sin(f) * r);
        this.rodPos[k++] = _p.x;
        this.rodPos[k++] = _p.y;
        this.rodPos[k++] = _p.z;
      }
    }
    this.rodGeo.attributes.position.needsUpdate = true;
    this.rodGeo.computeVertexNormals();
  }

  /** Руки и катушка: правая на рукояти, катушка под удилищем перед ней, левая — на ручке или на удилище. */
  private hands(i: RigInput, dt: number): void {
    const p0 = this.pts[1];
    const p1 = this.pts[3];
    _z.subVectors(p1, p0).normalize();
    // Правая: кулак кругом рукояти, предплечье — вниз-вправо-назад, к краю кадра.
    basis(_z, [0.35, -0.75, 0.55], this.right.quaternion);
    this.right.position.copy(this.butt);
    // Катушка: под удилищем, на ладонь впереди правой; ось — поперёк удилища.
    _x.crossVectors(_z, _y.set(0, 1, 0)).normalize();
    if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
    _u.crossVectors(_x, _z).normalize();
    this.reel.position.copy(this.butt).addScaledVector(_z, 0.15).addScaledVector(_u, -0.042);
    _m.makeBasis(_x, _u, _y.copy(_z).negate());
    this.reel.quaternion.setFromRotationMatrix(_m);
    // Ручка: крутится, пока подтягивают; трещит назад, пока рыба забирает леску.
    // Оборот ручки — оборот барабана (19 см лески); глазу — не быстрее четырёх оборотов в секунду.
    const spin = dt > 0 ? Math.max(-25, Math.min(25, (-i.paid / dt / 0.19) * Math.PI * 2)) : 0;
    this.crankA += spin * dt;
    this.crank.rotation.set(this.crankA, 0, 0);
    // Левая: на рукояти ручки, пока крутит; иначе держит удилище над катушкой.
    if (i.phase === 'fight' && i.reeling) {
      this.crank.updateMatrixWorld();
      _p.set(0.042, 0.034, 0);
      this.crank.localToWorld(_p);
      this.root.worldToLocal(_p);
      this.left.position.lerp(_p, 1 - Math.exp(-dt / 0.04));
      basis(_x, [-0.25, -0.9, 0.3], this.left.quaternion);
    } else {
      // Держит удилище над катушкой, предплечье — вниз, за нижний край кадра: рука не загораживает воду.
      _p.copy(this.butt).addScaledVector(_z, 0.3);
      this.left.position.lerp(_p, 1 - Math.exp(-dt / 0.06));
      basis(_z, [-0.12, -0.95, 0.25], _q);
      this.left.quaternion.slerp(_q, 1 - Math.exp(-dt / 0.06));
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.rodGeo.dispose();
    for (const m of [this.reel, this.crank, this.right, this.left]) m.geometry.dispose();
    this.mat.dispose();
  }
}

const lerp3 = (a: readonly number[], b: readonly number[], k: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];

const _bx = new THREE.Vector3();
const _by = new THREE.Vector3();
const _bz = new THREE.Vector3();

/** Кисть по оси хвата и предплечью — `hands.handBasis` без новых векторов на кадр. */
function basis(along: THREE.Vector3, elbow: readonly number[], out: THREE.Quaternion): THREE.Quaternion {
  _by.copy(along).normalize();
  _bz.set(elbow[0], elbow[1], elbow[2]);
  _bz.addScaledVector(_by, -_bz.dot(_by)).normalize();
  _bx.crossVectors(_by, _bz).normalize();
  return out.setFromRotationMatrix(_m.makeBasis(_bx, _by, _bz));
}
