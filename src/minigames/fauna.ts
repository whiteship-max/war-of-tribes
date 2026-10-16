/**
 * Звери промыслов: лепка мягких тел, скелет, позы, запечённые в морфы, и стадо одним вызовом (docs/polish.md, П-4).
 *
 * ЛЕПКА — ТРУБКИ СЕЧЕНИЙ, А НЕ БРУСЫ. Тело, шея, голова и ноги — кольца эллипсов (или скруглённых коробок) по оси;
 * шерсть клоками — сдвиг вершин вдоль нормали сечения (`LoftOpts.bump`), мелкий ворс — уже в материале (`fur.ts`).
 * У каждой вершины — две кости и доля второй (`Skin`): у сустава вершина гнётся вместе с обеими.
 *
 * ПОЗА — НЕ СКЕЛЕТ В КАДРЕ, А ЗАПЕЧЁННАЯ РАЗНИЦА. Скелетной сетки у three в первой загрузке нет, и брать её имя ради
 * промыслов — дописать её в общий кусок (`prologue/post.test.ts`). Поэтому скелет живёт только здесь, на ЦП, один раз:
 * каждая поза (шаг ходьбы, скачок, лёжка, падение) считается костями и ложится разницей от покоя в морф геометрии.
 * В кадре видеокарта смешивает несколько морфов с долями — так же, как смешивала бы кости.
 *
 * ПОВОРОТ — ДВУМЯ МОРФАМИ, И ОН ТОЧНЫЙ. Голова, шея и хвост поворачиваются на любой угол: поворот точки вокруг оси —
 * `p + (cos θ − 1)·d⊥ + sin θ·(e × d)`, то есть два морфа с долями `1 − cos θ` и `sin θ` (`Channel.turn`). Голова
 * оленя ходит ровно на тот угол, который решает правило охоты (`hunt.poseAt`), — и ровно вокруг той оси, вокруг
 * которой правило поворачивает шары попадания (`hunt.DEER_NECK`).
 *
 * СТАДО — ОДНИМ ВЫЗОВОМ НА ПОРОДУ. Копии одной сетки (`InstancedMesh`) с долями морфов на каждую копию
 * (`setMorphAt`): четыре овцы — один вызов, тень — второй. Своих имён `three` у модуля нет.
 */
import * as THREE from 'three';

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));
export const smooth = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// ---------- Скелет ----------

export interface BoneDef {
  name: string;
  /** Номер родителя в списке, −1 — корень. Родитель всегда раньше ребёнка. */
  parent: number;
  /** Шарнир в покое — в осях модели. */
  at: readonly [number, number, number];
}

/** Чья вершина: доля `1 − w` кости `a` и доля `w` кости `b`. */
export interface Skin {
  a: number;
  b: number;
  w: number;
}

export const rigid = (a: number): Skin => ({ a, b: a, w: 0 });
export const blend = (a: number, b: number, w: number): Skin => ({ a, b, w: clamp01(w) });

/** Поза: поворот кости в её шарнире, Эйлер `YXZ`, рад. Нет кости — она в покое. */
export type Pose = Readonly<Record<string, readonly [number, number, number]>>;

const _m = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _e = new THREE.Euler();

export class Rig {
  private names = new Map<string, number>();

  constructor(readonly bones: readonly BoneDef[]) {
    bones.forEach((b, i) => {
      if (b.parent >= i) throw new Error(`кость ${b.name}: родитель обязан стоять раньше`);
      this.names.set(b.name, i);
    });
  }

  index(name: string): number {
    const i = this.names.get(name);
    if (i === undefined) throw new Error(`нет кости ${name}`);
    return i;
  }

  has(name: string): boolean {
    return this.names.has(name);
  }

  /** Матрица каждой кости в позе: поворот вокруг своего шарнира, поверх — матрица родителя. */
  matrices(pose: Pose): THREE.Matrix4[] {
    const out: THREE.Matrix4[] = [];
    for (let i = 0; i < this.bones.length; i++) {
      const b = this.bones[i];
      const r = pose[b.name];
      const local = new THREE.Matrix4();
      if (r) {
        _e.set(r[0], r[1], r[2], 'YXZ');
        local.makeTranslation(b.at[0], b.at[1], b.at[2]);
        local.multiply(_m.makeRotationFromEuler(_e));
        local.multiply(_t.makeTranslation(-b.at[0], -b.at[1], -b.at[2]));
      }
      out.push(b.parent >= 0 ? out[b.parent].clone().multiply(local) : local);
    }
    return out;
  }

  /** Лежит ли кость `i` под костью `root` (или она сама). */
  under(i: number, root: number): boolean {
    for (let k = i; k >= 0; k = this.bones[k].parent) if (k === root) return true;
    return false;
  }

  /** Какая доля вершины ходит вместе с костью `root` и её потомками. */
  share(s: Skin, root: number): number {
    return (this.under(s.a, root) ? 1 - s.w : 0) + (this.under(s.b, root) ? s.w : 0);
  }
}

// ---------- Лепка ----------

/** Кольцо сечения: середина и полуоси — вбок (`rx`) и по «верху» сечения (`ry`). */
export interface Ring {
  c: THREE.Vector3;
  rx: number;
  ry: number;
}

/** Цвет и кость вершины трубки: по доле длины `u`, углу кольца `a` (0 — «верх», π — низ) и точке. */
export type RingFn<T> = (u: number, a: number, p: THREE.Vector3) => T;

export interface LoftOpts {
  /** Вершин в кольце. */
  seg: number;
  /** Куда смотрит «верх» сечения: у тела — +Y, у ноги — вперёд (+Z). */
  up?: THREE.Vector3;
  /** Степень сечения: 2 — эллипс, больше — коробка со скруглёнными углами (круп коровы, морда козы). */
  box?: number;
  color: number | RingFn<number>;
  skin: Skin | RingFn<Skin>;
  /** Сдвиг вдоль нормали сечения, м: руно клоками, грива. */
  bump?: RingFn<number>;
  /** Куполки на концах: на сколько радиусов выступает полюс (0 — плоский срез, ничего — без донца). */
  caps?: readonly [number | null, number | null];
}

const _c = new THREE.Color();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** Знаковая степень: суперэллипс — `sgn(x)·|x|^k`. */
const spow = (x: number, k: number): number => Math.sign(x) * Math.abs(x) ** k;

export class Sculpt {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly idx: number[] = [];
  readonly skins: Skin[] = [];

  vert(p: THREE.Vector3, hex: number, skin: Skin): number {
    _c.setHex(hex);
    this.pos.push(p.x, p.y, p.z);
    this.col.push(_c.r, _c.g, _c.b);
    this.skins.push(skin);
    return this.skins.length - 1;
  }

  /** Трубка по кольцам сечений. Рамка переносится без кручения от «верха» `up`. */
  loft(rings: readonly Ring[], o: LoftOpts): this {
    const n = rings.length;
    const seg = o.seg;
    const up = o.up ?? new THREE.Vector3(0, 1, 0);
    const k = 2 / (o.box ?? 2);
    const color = (u: number, a: number, p: THREE.Vector3): number => (typeof o.color === 'number' ? o.color : o.color(u, a, p));
    const skin = (u: number, a: number, p: THREE.Vector3): Skin => ('a' in o.skin ? o.skin : o.skin(u, a, p));
    const tangents: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const a = rings[Math.max(0, i - 1)].c;
      const b = rings[Math.min(n - 1, i + 1)].c;
      tangents.push(new THREE.Vector3().subVectors(b, a).normalize());
    }
    // Длина вдоль оси — доля `u` по расстоянию, а не по номеру кольца: кольца у головы гуще, а цвет и кость идут по метрам.
    const along: number[] = [0];
    for (let i = 1; i < n; i++) along.push(along[i - 1] + rings[i].c.distanceTo(rings[i - 1].c));
    const total = along[n - 1] || 1;
    _n.copy(up).addScaledVector(tangents[0], -up.dot(tangents[0]));
    if (_n.lengthSq() < 1e-6) _n.set(1, 0, 0);
    _n.normalize();
    const starts: number[] = [];
    for (let i = 0; i < n; i++) {
      const tg = tangents[i];
      _n.addScaledVector(tg, -_n.dot(tg)).normalize();
      _b.crossVectors(_n, tg).normalize();
      const r = rings[i];
      const u = along[i] / total;
      starts.push(this.skins.length);
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2;
        const cy = spow(Math.cos(a), k);
        const sx = spow(Math.sin(a), k);
        _d.copy(_n).multiplyScalar(cy * r.ry).addScaledVector(_b, sx * r.rx);
        _p.copy(r.c).add(_d);
        if (o.bump) {
          // Нормаль эллипса в точке — вдоль градиента: (x/rx², y/ry²).
          _w.copy(_n).multiplyScalar(cy / Math.max(1e-4, r.ry)).addScaledVector(_b, sx / Math.max(1e-4, r.rx)).normalize();
          _p.addScaledVector(_w, o.bump(u, a, _p));
        }
        this.vert(_p, color(u, a, _p), skin(u, a, _p));
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = starts[i] + j;
        const d = starts[i] + ((j + 1) % seg);
        const b = starts[i + 1] + j;
        const c = starts[i + 1] + ((j + 1) % seg);
        this.idx.push(a, b, d, b, c, d);
      }
    }
    const cap = (i: number, out: number, bulge: number): void => {
      const r = rings[i];
      _p.copy(r.c).addScaledVector(tangents[i], out * bulge * Math.min(r.rx, r.ry));
      const u = i === 0 ? 0 : 1;
      const tip = this.vert(_p, color(u, out < 0 ? Math.PI : 0, _p), skin(u, 0, _p));
      for (let j = 0; j < seg; j++) {
        const a = starts[i] + j;
        const b = starts[i] + ((j + 1) % seg);
        if (out < 0) this.idx.push(tip, a, b);
        else this.idx.push(tip, b, a);
      }
    };
    const [c0, c1] = o.caps ?? [0.6, 0.6];
    if (c0 !== null) cap(0, -1, c0);
    if (c1 !== null) cap(n - 1, 1, c1);
    return this;
  }

  /** Трубка по точкам с радиусами — частный случай кольцами (рог, хвост, нога). */
  tube(path: readonly THREE.Vector3[], radii: readonly number[], o: LoftOpts, squash = 1): this {
    return this.loft(
      path.map((c, i) => ({ c, rx: radii[i], ry: radii[i] * squash })),
      o,
    );
  }

  /** Эллипсоид: середина, полуоси, поворот, цвет и кость; `bump` — сдвиг вдоль нормали (клок руна). */
  blob(at: THREE.Vector3, radii: THREE.Vector3, rot: THREE.Euler, color: number | ((p: THREE.Vector3) => number), skin: Skin, w = 9, h = 6, bump?: (p: THREE.Vector3, n: THREE.Vector3) => number): this {
    const g = new THREE.SphereGeometry(1, w, h);
    g.deleteAttribute('uv');
    // Швы сферы склеены: иначе по меридиану шва нормали рвутся, и на гладком звере видна черта.
    const merged = weld(g);
    g.dispose();
    const p = merged.attributes.position;
    _m.makeRotationFromEuler(rot).setPosition(at);
    const base = this.skins.length;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i);
      _p.copy(_v).multiply(radii);
      if (bump) {
        // Нормаль эллипсоида — (x/a², y/b², z/c²); сдвиг — вдоль неё.
        _w.set(_v.x / radii.x, _v.y / radii.y, _v.z / radii.z).normalize();
        _p.addScaledVector(_w, bump(_p, _w));
      }
      _p.applyMatrix4(_m);
      this.vert(_p, typeof color === 'number' ? color : color(_p), skin);
    }
    const ix = merged.index!;
    for (let i = 0; i < ix.count; i += 3) this.idx.push(base + ix.getX(i), base + ix.getX(i + 1), base + ix.getX(i + 2));
    merged.dispose();
    return this;
  }

  /** Сетка: место, цвет, нормаль (гладкая по склеенным кольцам) и контактное затемнение снизу. */
  geometry(ao: AoBake = DEFAULT_AO): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    const nor = g.attributes.normal;
    const col = new Float32Array(this.col);
    for (let i = 0; i < this.skins.length; i++) {
      const y = this.pos[i * 3 + 1];
      const ny = nor.getY(i);
      // Брюхо и исподы темнее — свет неба туда не доходит; у земли — ещё темнее: зверь стоит, а не висит.
      const k = (ao.under + (1 - ao.under) * smooth(-0.85, 0.35, ny)) * (ao.ground + (1 - ao.ground) * smooth(0, ao.groundUp, y));
      col[i * 3] *= k;
      col[i * 3 + 1] *= k;
      col[i * 3 + 2] *= k;
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }
}

/** Затемнение лепки: исподы (`under` — доля света у смотрящего вниз) и у земли (`ground` у самой земли, до `groundUp` м). */
export interface AoBake {
  under: number;
  ground: number;
  groundUp: number;
}
export const DEFAULT_AO: AoBake = { under: 0.6, ground: 0.72, groundUp: 0.35 };

/** Склеить совпадающие вершины сферы (без `BufferGeometryUtils`: ей нужны и прочие атрибуты). */
function weld(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.attributes.position;
  const ix = g.index!;
  const map = new Map<string, number>();
  const remap: number[] = [];
  const pos: number[] = [];
  for (let i = 0; i < p.count; i++) {
    // Ключ — место до десятой доли миллиметра (целыми, без строк дроби: их пишет только `game/num`).
    const key = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    let j = map.get(key);
    if (j === undefined) {
      j = pos.length / 3;
      map.set(key, j);
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
    }
    remap.push(j);
  }
  const idx: number[] = [];
  for (let i = 0; i < ix.count; i += 3) {
    const a = remap[ix.getX(i)];
    const b = remap[ix.getX(i + 1)];
    const c = remap[ix.getX(i + 2)];
    // У полюса сферы треугольники вырождаются в линию — их выбрасываем.
    if (a === b || b === c || a === c) continue;
    idx.push(a, b, c);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  return out;
}

// ---------- Запекание поз ----------

/**
 * Что запечь в морф:
 *   pose  — поза костями, разница от покоя;
 *   turn  — поворот кости `bone` вокруг оси её шарнира: два морфа, `.c` и `.s` (доли `1 − cos θ` и `sin θ`);
 *   push  — сдвиг вершины вдоль нормали на `fn` м (дыхание: грудь шире).
 */
export type Channel =
  | { pose: Pose }
  | { turn: string; axis: 'x' | 'y' | 'z' }
  | { push: (p: THREE.Vector3, n: THREE.Vector3, s: Skin) => number };

/** Где в списке морфов лежит канал: у поворота — номер `.c`, номер `.s` — следующий. */
export type Slots = Readonly<Record<string, number>>;

export interface Baked {
  geometry: THREE.BufferGeometry;
  slots: Slots;
  /** Сколько морфов. */
  count: number;
  rig: Rig;
  skins: readonly Skin[];
}

const AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) } as const;

/** Запечь позы и повороты в морфы геометрии лепки. */
export function bake(s: Sculpt, rig: Rig, channels: Readonly<Record<string, Channel>>, ao?: AoBake): Baked {
  const g = s.geometry(ao);
  const p = g.attributes.position;
  const nor = g.attributes.normal;
  const n = p.count;
  const morphPos: THREE.BufferAttribute[] = [];
  const morphNor: THREE.BufferAttribute[] = [];
  const slots: Record<string, number> = {};
  const P = new THREE.Vector3();
  const N = new THREE.Vector3();
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const push = (name: string, dp: Float32Array, dn: Float32Array): void => {
    slots[name] = morphPos.length;
    const ap = new THREE.Float32BufferAttribute(dp, 3);
    ap.name = name;
    morphPos.push(ap);
    morphNor.push(new THREE.Float32BufferAttribute(dn, 3));
  };
  for (const [name, ch] of Object.entries(channels)) {
    if ('pose' in ch) {
      const mats = rig.matrices(ch.pose);
      const dp = new Float32Array(n * 3);
      const dn = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const sk = s.skins[i];
        P.fromBufferAttribute(p, i);
        N.fromBufferAttribute(nor, i);
        A.copy(P).applyMatrix4(mats[sk.a]);
        B.copy(P).applyMatrix4(mats[sk.b]);
        A.lerp(B, sk.w).sub(P);
        // Поворот нормали — направлением сквозь матрицу кости (масштаба у костей нет).
        const na = N.clone().transformDirection(mats[sk.a]);
        const nb = N.clone().transformDirection(mats[sk.b]);
        na.lerp(nb, sk.w).normalize().sub(N);
        dp.set([A.x, A.y, A.z], i * 3);
        dn.set([na.x, na.y, na.z], i * 3);
      }
      push(name, dp, dn);
    } else if ('turn' in ch) {
      const bone = rig.index(ch.turn);
      const at = rig.bones[bone].at;
      const e = AXES[ch.axis];
      const cp = new Float32Array(n * 3);
      const sp = new Float32Array(n * 3);
      const cn = new Float32Array(n * 3);
      const sn = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const w = rig.share(s.skins[i], bone);
        if (w <= 0) continue;
        P.fromBufferAttribute(p, i).sub(_v.set(at[0], at[1], at[2]));
        N.fromBufferAttribute(nor, i);
        // d⊥ — то, что поворот крутит; e × d — куда.
        A.copy(P).addScaledVector(e, -e.dot(P));
        B.crossVectors(e, P);
        cp.set([-A.x * w, -A.y * w, -A.z * w], i * 3);
        sp.set([B.x * w, B.y * w, B.z * w], i * 3);
        A.copy(N).addScaledVector(e, -e.dot(N));
        B.crossVectors(e, N);
        cn.set([-A.x * w, -A.y * w, -A.z * w], i * 3);
        sn.set([B.x * w, B.y * w, B.z * w], i * 3);
      }
      push(`${name}.c`, cp, cn);
      push(`${name}.s`, sp, sn);
      slots[name] = slots[`${name}.c`];
    } else {
      const dp = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        P.fromBufferAttribute(p, i);
        N.fromBufferAttribute(nor, i);
        const d = ch.push(P, N, s.skins[i]);
        if (d !== 0) dp.set([N.x * d, N.y * d, N.z * d], i * 3);
      }
      push(name, dp, new Float32Array(n * 3));
    }
  }
  g.morphAttributes.position = morphPos;
  g.morphAttributes.normal = morphNor;
  g.morphTargetsRelative = true;
  return { geometry: g, slots, count: morphPos.length, rig, skins: s.skins };
}

/**
 * Где стоит вершина `i` при долях морфов `k` — на ЦП, тем же сложением, что в шейдере. Нужно тестам: форма попадания
 * оленя сверяется с тем, что нарисовано в позе, а не с покоем.
 */
export function morphed(b: Baked, k: ArrayLike<number>, i: number, out = new THREE.Vector3()): THREE.Vector3 {
  const g = b.geometry;
  out.fromBufferAttribute(g.attributes.position as THREE.BufferAttribute, i);
  const mp = g.morphAttributes.position;
  for (let t = 0; t < mp.length; t++) {
    const w = k[t];
    if (!w) continue;
    out.x += mp[t].getX(i) * w;
    out.y += mp[t].getY(i) * w;
    out.z += mp[t].getZ(i) * w;
  }
  return out;
}

// ---------- Доли морфов в кадре ----------

/** Доли морфов одной копии на этот кадр. Нет канала у породы — молча мимо: у овцы скачка нет. */
export class Moves {
  readonly k: Float32Array;

  constructor(
    private slots: Slots,
    count: number,
  ) {
    this.k = new Float32Array(count);
  }

  clear(): this {
    this.k.fill(0);
    return this;
  }

  add(name: string, w: number): this {
    const i = this.slots[name];
    if (i !== undefined && w !== 0) this.k[i] += w;
    return this;
  }

  /** Поворот на угол `a`, рад, с долей `w` (0..1 — к покою). */
  turn(name: string, a: number, w = 1): this {
    const i = this.slots[name];
    if (i === undefined || a === 0 || w === 0) return this;
    this.k[i] += w * (1 - Math.cos(a));
    this.k[i + 1] += w * Math.sin(a);
    return this;
  }

  /** Круг поз `prefix0…prefix{n−1}`: доля `amount` между двумя соседними по фазе 0..1. */
  cycle(prefix: string, n: number, phase: number, amount: number): this {
    if (amount <= 0) return this;
    const x = (((phase % 1) + 1) % 1) * n;
    const i = Math.floor(x) % n;
    const f = x - Math.floor(x);
    this.add(`${prefix}${i}`, amount * (1 - f));
    this.add(`${prefix}${(i + 1) % n}`, amount * f);
    return this;
  }

  /** Две ступени одного движения через запечённую середину: 0 — покой, 0.5 — `a`, 1 — `b`. */
  stage(a: string, b: string, k: number): this {
    const x = clamp01(k);
    if (x <= 0.5) this.add(a, 2 * x);
    else this.add(a, 2 * (1 - x)).add(b, 2 * x - 1);
    return this;
  }
}

// ---------- Порода копиями ----------

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Порода в кадре: копии одной сетки с местом, долями морфов и мастью на каждую. Один вызов отрисовки на всех и второй —
 * на их тень. Масть (`coat`) — белизна шкуры, 0..1: белый олень — та же сетка, что рогачи.
 */
export class Pack {
  readonly mesh: THREE.InstancedMesh;
  private holder: { morphTargetInfluences: Float32Array };
  private coat: THREE.InstancedBufferAttribute;

  constructor(baked: Baked, material: THREE.Material, count: number, name: string) {
    const geo = baked.geometry.clone();
    this.coat = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, count)), 1);
    geo.setAttribute('coat', this.coat);
    this.mesh = new THREE.InstancedMesh(geo, material, Math.max(1, count));
    this.mesh.name = name;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // Копии ходят по всему загону: рамку по копиям пришлось бы пересчитывать каждый кадр.
    this.mesh.frustumCulled = false;
    this.holder = { morphTargetInfluences: new Float32Array(baked.count) };
    for (let i = 0; i < this.mesh.count; i++) {
      this.mesh.setMatrixAt(i, ZERO);
      this.mesh.setMorphAt(i, this.holder as unknown as THREE.Mesh);
    }
    this.mesh.count = count;
  }

  /** Поставить копию `i`: матрица места и доли морфов. */
  put(i: number, m: THREE.Matrix4, k: Float32Array): void {
    this.mesh.setMatrixAt(i, m);
    this.holder.morphTargetInfluences = k;
    this.mesh.setMorphAt(i, this.holder as unknown as THREE.Mesh);
  }

  hide(i: number): void {
    this.mesh.setMatrixAt(i, ZERO);
  }

  setCoat(i: number, white: number): void {
    this.coat.setX(i, white);
    this.coat.needsUpdate = true;
  }

  /** Тон копии — множитель цвета: у каждой овцы своя белизна, у козы своя рыжина. */
  setTint(i: number, c: THREE.Color): void {
    this.mesh.setColorAt(i, c);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Кадр собран: отдать видеокарте места и доли. */
  commit(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.morphTexture) this.mesh.morphTexture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

/**
 * Кольца гуще: сплайн Катмулла — Рома по серединам и полуосям опорных колец. Лепить удобно редкими кольцами, а
 * видно гладкое тело — без граней на изгибе спины.
 */
export function smoothRings(rings: readonly Ring[], each: number): Ring[] {
  const out: Ring[] = [];
  const n = rings.length;
  const at = (i: number): Ring => rings[Math.max(0, Math.min(n - 1, i))];
  const cr = (a: number, b: number, c: number, d: number, t: number): number =>
    0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
  for (let i = 0; i < n - 1; i++) {
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const steps = i === n - 2 ? each + 1 : each;
    for (let k = 0; k < steps; k++) {
      const t = k / each;
      out.push({
        c: new THREE.Vector3(cr(a.c.x, b.c.x, c.c.x, d.c.x, t), cr(a.c.y, b.c.y, c.c.y, d.c.y, t), cr(a.c.z, b.c.z, c.c.z, d.c.z, t)),
        rx: Math.max(0.005, cr(a.rx, b.rx, c.rx, d.rx, t)),
        ry: Math.max(0.005, cr(a.ry, b.ry, c.ry, d.ry, t)),
      });
    }
  }
  return out;
}

const _pr = new THREE.Matrix4();
const _pe = new THREE.Euler();

/**
 * Матрица копии зверя: стоит в `(x, y, z)`, смотрит по `yaw`, а наклон и крен — вокруг середины туловища `core`, а не
 * вокруг копыт: ложащаяся корова не уходит носом в землю, валящийся олень падает на бок, а не катится колесом.
 */
export function placeBeast(out: THREE.Matrix4, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, core: THREE.Vector3): THREE.Matrix4 {
  out.makeRotationY(yaw).setPosition(x, y, z);
  if (pitch === 0 && roll === 0) return out;
  out.multiply(_pr.makeTranslation(0, core.y, core.z));
  _pe.set(pitch, 0, roll, 'YXZ');
  out.multiply(_pr.makeRotationFromEuler(_pe));
  return out.multiply(_pr.makeTranslation(0, -core.y, -core.z));
}
