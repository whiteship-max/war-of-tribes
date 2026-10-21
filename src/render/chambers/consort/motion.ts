// Движения супруги (ЛЦ-2, docs/characters.md): ключи в коде, без мокапа. Позы задаются тем, где кисти (руки решаются
// двухзвенной ИК от плеча с направлением локтя), и поворотами корпуса и головы; клипы — ключи этих поз во времени:
//
//   · стоять 1 — дыхание и лёгкое переминание, руки сложены у пояса (поза покоя, по кругу);
//   · стоять 2 — поправить волосы: правая рука к виску, заправить прядь, обратно;
//   · стоять 3 — сложить руки под грудью, голову набок, постоять, обратно;
//   · идти — скольжение: ног нет, корпус покачивается, юбка (перед, зад, бока) и волосы отстают от шага;
//   · говорить — правая рука объясняет ладонью вверх, голова кивает, челюсть ходит слогами;
//   · реверанс — прежнее приветствие покоев (`folk.Gesture.curtsy`): опуститься, склонить голову, придержать юбку.
//
// Лицо живёт поверх: моргание раз в 3–6 с (кость `lids`), взгляд ведёт голову (сдвиг белка, `skin.SkinBody.gaze`), рот —
// челюстью при речи. Случайность — сеяная (`Math.random` в игре нет нигде).
import type { V3 } from '../../city/geom';
import type { Skeleton, Turn } from '../rig';
import type { Gesture } from '../folk';
import { BODY_SCALE } from './figure';
import { lidClose } from './head';

type Turns = Record<string, [number, number, number]>;
type M3 = Float64Array;

// ---------- Повороты ----------

function axisAngle(ax: V3, a: number): M3 {
  const [x, y, z] = ax;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  // По столбцам.
  return Float64Array.from([t * x * x + c, t * x * y + s * z, t * x * z - s * y, t * x * y - s * z, t * y * y + c, t * y * z + s * x, t * x * z + s * y, t * y * z - s * x, t * z * z + c]);
}
const tmulV = (m: M3, v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V3): V3 => scale(a, 1 / (len(a) || 1));

function mulM(a: M3, b: M3): M3 {
  const o = new Float64Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
  return o;
}
function transpose(a: M3): M3 {
  return Float64Array.from([a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]);
}

/** Кратчайший поворот, переводящий единичный `a` в единичный `b`. */
function between(a: V3, b: V3): M3 {
  const c = cross(a, b);
  const s = len(c);
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  if (s < 1e-9) return d > 0 ? axisAngle([1, 0, 0], 0) : axisAngle(unit(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), Math.PI);
  return axisAngle(scale(c, 1 / s), Math.atan2(s, d));
}

/** Матрица → поворот сустава (`rig.Turn`: наклон x, поворот y, крен z; порядок y, x, z — как `rig.rotYXZ`). */
function toTurn(m: M3): [number, number, number] {
  // Столбцы: m[0..2] — первый. Элементы строки r столбца c: m[c * 3 + r].
  const m02 = m[6];
  const m12 = m[7];
  const m22 = m[8];
  const m10 = m[1];
  const m11 = m[4];
  const x = Math.asin(Math.max(-1, Math.min(1, -m12)));
  return [x, Math.atan2(m02, m22), Math.atan2(m10, m11)];
}

// ---------- Позы ----------

/** Где кисть руки (оси фигуры в покое корпуса), куда смотрит локоть и как повёрнута сама кисть (локально, Turn). */
interface ArmAim {
  wrist: V3;
  elbow: V3;
  /** Кисть локально (Turn) — или в осях фигуры: куда пальцы и куда смотрит ладонь. */
  hand?: [number, number, number];
  fingers?: V3;
  palm?: V3;
  thumb?: [number, number, number];
}

/** Поза: руки (по цели кисти) и прочие кости прямо. */
interface PoseDef {
  L?: ArmAim;
  R?: ArmAim;
  turns?: Turns;
  lift?: V3;
}

/** Решить руку: плечо и предплечье — двухзвенная ИК с направлением локтя. */
function solveArm(sk: Skeleton, side: 'L' | 'R', aim: ArmAim, out: Turns): void {
  const S = sk.bones[sk.of(`arm${side}`)].j;
  const E = sk.bones[sk.of(`fore${side}`)].j;
  const W = sk.bones[sk.of(`hand${side}`)].j;
  const l1 = len(sub(E, S));
  const l2 = len(sub(W, E));
  // Цели заданы в чертёжных мерах фигуры — в рост её переводит тот же масштаб, что кости (`figure.BODY_SCALE`).
  const wrist = scale(aim.wrist, BODY_SCALE);
  const d = sub(wrist, S);
  const dist = Math.max(0.05, Math.min(l1 + l2 - 1e-4, len(d)));
  const dn = unit(d);
  const ca = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const pole = sub(scale(aim.elbow, BODY_SCALE), S);
  const pp = unit(sub(pole, scale(dn, dot(pole, dn))));
  const e2 = add(S, add(scale(dn, l1 * ca), scale(pp, l1 * Math.sqrt(Math.max(0, 1 - ca * ca)))));
  const w2 = add(S, scale(dn, dist));
  const r1 = between(unit(sub(E, S)), unit(sub(e2, S)));
  const r2 = between(unit(sub(W, E)), unit(tmulV(r1, sub(w2, e2))));
  out[`arm${side}`] = toTurn(r1);
  out[`fore${side}`] = toTurn(r2);
  out[`hand${side}`] = aim.hand ?? [0, 0, 0];
  if (aim.fingers && aim.palm) {
    // Покой кисти: пальцы — вдоль предплечья, ладонь — к телу (`figure.buildHand`); цель — в осях фигуры.
    const sx = side === 'L' ? 1 : -1;
    const d0 = unit(sub(W, E));
    const p0: V3 = [-sx, 0, 0];
    const d1 = unit(aim.fingers);
    const p1 = unit(sub(aim.palm, scale(d1, dot(aim.palm, d1))));
    const basis = (d: V3, p: V3): M3 => {
      const a = cross(p, d);
      return Float64Array.from([...d, ...p, ...a]);
    };
    const R = mulM(basis(d1, p1), transpose(basis(d0, unit(sub(p0, scale(d0, dot(p0, d0)))))));
    out[`hand${side}`] = toTurn(mulM(transpose(mulM(r1, r2)), R));
  }
  out[`thumb${side}`] = aim.thumb ?? [0, 0, 0];
}

function solvePose(sk: Skeleton, p: PoseDef): { turns: Turns; lift: V3 } {
  const turns: Turns = {};
  for (const [k, v] of Object.entries(p.turns ?? {})) turns[k] = [...v];
  if (p.L) solveArm(sk, 'L', p.L, turns);
  if (p.R) solveArm(sk, 'R', p.R, turns);
  return { turns, lift: scale(p.lift ?? [0, 0, 0], BODY_SCALE) };
}

const mirror = (a: ArmAim): ArmAim => ({
  wrist: [-a.wrist[0], a.wrist[1], a.wrist[2]],
  elbow: [-a.elbow[0], a.elbow[1], a.elbow[2]],
  hand: a.hand ? [a.hand[0], -a.hand[1], -a.hand[2]] : undefined,
  thumb: a.thumb ? [a.thumb[0], -a.thumb[1], -a.thumb[2]] : undefined,
});

/** Руки сложены у пояса: правая ладонь поверх левой, локти чуть в стороны. */
/** Руки сложены у пояса: ладони к животу, пальцы — к другой руке; правая — поверх левой. */
const FOLD_L: ArmAim = { wrist: [0.1, 0.9, 0.125], elbow: [0.32, 0.92, -0.06], fingers: [-1, -0.25, 0.05], palm: [0, 0.1, -1], thumb: [0, 0, -0.35] };
const FOLD_R: ArmAim = { wrist: [-0.085, 0.915, 0.15], elbow: [-0.32, 0.93, -0.06], fingers: [1, -0.3, 0.05], palm: [0, 0.1, -1], thumb: [0, 0, 0.35] };

const P = {
  fold: { L: FOLD_L, R: FOLD_R },
  // Поправить волосы: правая кисть у виска, локоть вверх и в сторону, голова к руке.
  hairUp: { L: FOLD_L, R: { wrist: [-0.115, 1.43, 0.0], elbow: [-0.36, 1.35, 0.05], hand: [0.4, 0.6, -1.4] }, turns: { head: [0.08, -0.12, -0.16], neck: [0.04, -0.05, -0.06], chest: [0, -0.06, -0.03] } },
  hairTuck: { L: FOLD_L, R: { wrist: [-0.112, 1.42, -0.055], elbow: [-0.36, 1.35, 0.0], hand: [0.5, 0.7, -1.3] }, turns: { head: [0.1, -0.14, -0.18], neck: [0.04, -0.05, -0.06], chest: [0, -0.06, -0.03] } },
  // Сложить руки под грудью: предплечья крест-накрест, голова набок.
  armsCross: {
    // Кисти лежат на сгибе другой руки: пальцы — назад, вдоль тела.
    L: { wrist: [-0.085, 1.0, 0.125], elbow: [0.25, 0.99, 0.02], fingers: [-0.3, 0.05, -1], palm: [1, 0.1, 0] },
    R: { wrist: [0.085, 1.015, 0.145], elbow: [-0.25, 1.0, 0.03], fingers: [0.3, 0.05, -1], palm: [-1, 0.1, 0] },
    turns: { head: [0.06, 0.1, 0.12], neck: [0.02, 0.04, 0.04], spine: [0, 0, 0.03], hips: [0, 0.06, -0.025] },
  },
  // Реверанс: кисти придерживают юбку по бокам.
  curtsy: { L: { wrist: [0.27, 0.77, 0.07], elbow: [0.3, 0.98, -0.08], hand: [-0.3, 0, 0.5] }, R: mirror({ wrist: [0.27, 0.77, 0.07], elbow: [0.3, 0.98, -0.08], hand: [-0.3, 0, 0.5] }), turns: { head: [0.3, 0, 0], neck: [0.12, 0, 0], chest: [0.1, 0, 0], spine: [0.06, 0, 0] }, lift: [0, -0.09, -0.015] },
  // Речь: правая рука вперёд ладонью вверх.
  talkA: { R: { wrist: [-0.13, 1.0, 0.24], elbow: [-0.3, 0.93, -0.02], hand: [-0.2, -0.3, -0.5] } },
  talkB: { R: { wrist: [-0.18, 1.04, 0.22], elbow: [-0.33, 0.95, -0.03], hand: [-0.45, -0.5, -0.7] } },
  // Шаг: руки свободнее, кисти ниже.
  walk: { L: { wrist: [0.07, 0.86, 0.12], elbow: [0.32, 0.93, -0.05], hand: [-0.3, 0.3, 1.0] }, R: { wrist: [-0.055, 0.865, 0.135], elbow: [-0.32, 0.94, -0.05], hand: [-0.3, -0.4, -1.15] } },
} satisfies Record<string, PoseDef>;
type PoseId = keyof typeof P;

// ---------- Клипы ----------

/** Клип: ключи (секунда, поза); между ключами — плавно (кубом). */
interface Clip {
  len: number;
  keys: readonly (readonly [number, PoseId])[];
}
const STAND2: Clip = {
  len: 3.6,
  keys: [
    [0, 'fold'],
    [1.0, 'hairUp'],
    [1.7, 'hairTuck'],
    [2.2, 'hairTuck'],
    [3.6, 'fold'],
  ],
};
const STAND3: Clip = {
  len: 5.0,
  keys: [
    [0, 'fold'],
    [1.1, 'armsCross'],
    [3.8, 'armsCross'],
    [5.0, 'fold'],
  ],
};

type Solved = { turns: Turns; lift: V3 };

function blend(a: Solved, b: Solved, k: number): Solved {
  const turns: Turns = {};
  for (const n of new Set([...Object.keys(a.turns), ...Object.keys(b.turns)])) {
    const x = a.turns[n] ?? [0, 0, 0];
    const y = b.turns[n] ?? [0, 0, 0];
    turns[n] = [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
  }
  return { turns, lift: [a.lift[0] + (b.lift[0] - a.lift[0]) * k, a.lift[1] + (b.lift[1] - a.lift[1]) * k, a.lift[2] + (b.lift[2] - a.lift[2]) * k] };
}

/** Только кости руки стороны `side` — из `b`, остальное — из `a`. */
function blendArm(a: Solved, b: Solved, side: 'L' | 'R', k: number): Solved {
  const out: Solved = { turns: { ...a.turns }, lift: a.lift };
  for (const n of [`arm${side}`, `fore${side}`, `hand${side}`, `thumb${side}`]) {
    const x = a.turns[n] ?? [0, 0, 0];
    const y = b.turns[n] ?? [0, 0, 0];
    out.turns[n] = [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
  }
  return out;
}

const ease = (k: number): number => k * k * (3 - 2 * k);

function sample(clip: Clip, poses: Record<PoseId, Solved>, t: number): Solved {
  const keys = clip.keys;
  if (t <= keys[0][0]) return poses[keys[0][1]];
  for (let i = 1; i < keys.length; i++)
    if (t <= keys[i][0]) {
      const k = (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      return blend(poses[keys[i - 1][1]], poses[keys[i][1]], ease(k));
    }
  return poses[keys[keys.length - 1][1]];
}

const addT = (o: Turns, bone: string, x: number, y = 0, z = 0): void => {
  const t = o[bone] ?? (o[bone] = [0, 0, 0]);
  t[0] += x;
  t[1] += y;
  t[2] += z;
};

/** Какой клип стоять и с какого времени: сеяное расписание — раз в 8–14 с, второй или третий. */
interface Idle {
  clip: Clip | null;
  at: number;
  next: number;
}

/**
 * Живость супруги: поза кадра по жестам `folk.Person` (шаг, реверанс, речь, взгляд) плюс свои клипы стояния, моргание,
 * взгляд и рот. `gaze` — куда сдвинуть белок (метры), `lids` и `jaw` — в повороты костей.
 */
export class ConsortMotion {
  private poses: Record<PoseId, Solved>;
  private idle: Idle = { clip: null, at: 0, next: 6 };
  private blinkAt = 2.2;
  private blinkK = 0;
  private sacc: [number, number] = [0, 0];
  private saccAt = 1;
  private seed: number;
  readonly closeLids: number;
  /** Сдвиг белка этого кадра, м (по горизонтали — к левому боку фигуры, вверх). */
  gaze: [number, number] = [0, 0];

  constructor(sk: Skeleton, seed = 1207) {
    this.seed = seed >>> 0 || 1;
    this.poses = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, solvePose(sk, v as PoseDef)])) as Record<PoseId, Solved>;
    this.closeLids = lidClose();
  }

  private rnd(): number {
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  /** Поза кадра (`folk.Person` зовёт её вместо `folk.posture`). */
  pose(t: number, phase: number, walk: number, g: Gesture, want: Gesture): { turns: Turns; lift: V3 } {
    const busy = Math.max(walk, g.talk, g.curtsy, g.bow);
    // Стоять 1: сложенные руки, дыхание, переминание.
    let s: Solved = this.poses.fold;
    // Стоять 2 и 3 — по расписанию, когда стоит без дела.
    if (!this.idle.clip && t >= this.idle.next && busy < 0.05) this.idle = { clip: this.rnd() < 0.5 ? STAND2 : STAND3, at: t, next: 0 };
    if (this.idle.clip) {
      const k = t - this.idle.at;
      if (k >= this.idle.clip.len || busy > 0.6) this.idle = { clip: null, at: 0, next: t + 8 + this.rnd() * 6 };
      else s = sample(this.idle.clip, this.poses, k);
    }
    s = { turns: Object.fromEntries(Object.entries(s.turns).map(([k, v]) => [k, [...v] as [number, number, number]])), lift: [...s.lift] as V3 };
    const o = s.turns;
    const breath = Math.sin(t * 1.5);
    addT(o, 'chest', -0.016 * breath);
    addT(o, 'neck', 0.008 * breath);
    for (const [side, sx] of [
      ['L', 1],
      ['R', -1],
    ] as const)
      addT(o, `arm${side}`, 0, 0, sx * 0.012 * breath);
    const shift = Math.sin(t * 0.33) * (1 - walk);
    addT(o, 'hips', 0, 0.03 * shift, 0.022 * shift);
    addT(o, 'spine', 0, -0.02 * shift, -0.016 * shift);
    addT(o, 'head', 0.012 * Math.sin(t * 0.41 + 1), 0.02 * Math.sin(t * 0.27), 0.03 * Math.sin(t * 0.23 + 2) * (1 - walk));
    addT(o, 'hair', 0.015 * Math.sin(t * 0.8), 0, 0.012 * Math.sin(t * 0.61));
    addT(o, 'skirtS', 0, 0, -0.012 * shift);
    // Шаг: скольжение. Таз качается по шагу, грудь — навстречу, юбка спереди толкается шагом, сзади и с боков — отстаёт.
    if (walk > 0.001) {
      const w = blend(s, this.poses.walk, walk);
      Object.assign(o, w.turns);
      const sw = Math.sin(phase);
      const cw = Math.cos(phase);
      addT(o, 'hips', 0.02 * walk, 0.07 * sw * walk, 0.035 * sw * walk);
      addT(o, 'chest', 0.03 * walk, -0.09 * sw * walk, -0.025 * sw * walk);
      addT(o, 'head', -0.02 * walk, 0.04 * sw * walk, 0);
      addT(o, 'skirtF', -0.07 * Math.abs(sw) * walk - 0.02 * walk, 0, 0.03 * sw * walk);
      addT(o, 'skirtB', 0.06 * walk + 0.025 * cw * walk, 0, -0.02 * sw * walk);
      addT(o, 'skirtS', 0, 0.03 * sw * walk, -0.04 * Math.sin(phase - 0.6) * walk);
      addT(o, 'hair', 0.06 * walk + 0.02 * cw * walk, 0, -0.03 * sw * walk);
      for (const [side, sx] of [
        ['L', 1],
        ['R', -1],
      ] as const)
        addT(o, `arm${side}`, 0.03 * sx * sw * walk, 0, 0);
      s.lift[1] += (-Math.abs(cw) * 0.008 + 0.004) * walk;
    }
    // Речь: правая рука объясняет, голова кивает, плечи живые.
    if (g.talk > 0.001) {
      const a = 0.5 + 0.5 * Math.sin(t * 1.9) * Math.sin(t * 0.7 + 1);
      const talk = blend(this.poses.talkA, this.poses.talkB, a);
      const r = blendArm(s, talk, 'R', g.talk * (1 - g.curtsy));
      Object.assign(o, r.turns);
      addT(o, 'head', 0.04 * Math.sin(t * 2.6) * g.talk, 0.05 * Math.sin(t * 1.1) * g.talk, 0.03 * Math.sin(t * 0.9) * g.talk);
      addT(o, 'neck', 0.03 * Math.sin(t * 2.1 + 1) * g.talk);
      addT(o, 'chest', 0, 0.03 * Math.sin(t * 0.8) * g.talk, 0);
    }
    // Реверанс (и поклон, если позовут им): опуститься, склонить голову, придержать юбку.
    const c = Math.max(g.curtsy, g.bow);
    if (c > 0.001) {
      const cur = blend({ turns: o, lift: s.lift }, this.poses.curtsy, c);
      Object.assign(o, cur.turns);
      s.lift = cur.lift;
      addT(o, 'skirtF', -0.05 * c);
      addT(o, 'skirtB', 0.05 * c);
    }
    // Взгляд: голова и шея к собеседнику (как у людей покоев), глаза — впереди головы.
    const ly = Math.max(-1.1, Math.min(1.1, g.lookYaw));
    const lp = Math.max(-0.5, Math.min(0.5, g.lookPitch));
    addT(o, 'head', -lp * 0.6, ly * 0.55, 0);
    addT(o, 'neck', -lp * 0.4, ly * 0.3, 0);
    addT(o, 'chest', 0, ly * 0.12, 0);
    if (t >= this.saccAt) {
      this.sacc = [(this.rnd() - 0.5) * 0.0014, (this.rnd() - 0.5) * 0.0008];
      this.saccAt = t + 0.7 + this.rnd() * 1.6;
    }
    const lead = Math.max(-0.55, Math.min(0.55, (want.lookYaw - g.lookYaw) * 0.97));
    const leadP = Math.max(-0.4, Math.min(0.4, want.lookPitch - g.lookPitch));
    this.gaze = [Math.sin(lead) * 0.0078 + this.sacc[0], Math.sin(-leadP) * 0.004 + this.sacc[1] + 0.0008 * lp];
    // Моргание раз в 3–6 с: закрыть быстро, открыть мягче; при повороте взгляда — чаще.
    if (t >= this.blinkAt) {
      const b = t - this.blinkAt;
      this.blinkK = b < 0.07 ? b / 0.07 : b < 0.12 ? 1 : Math.max(0, 1 - (b - 0.12) / 0.11);
      if (b > 0.23) {
        this.blinkK = 0;
        this.blinkAt = t + 3 + this.rnd() * 3;
      }
    }
    addT(o, 'lids', this.closeLids * this.blinkK * 0.98);
    // Рот: челюсть ходит слогами, пока говорит.
    const syll = Math.max(0, Math.sin(t * 10.5)) * (0.55 + 0.45 * Math.sin(t * 2.9));
    addT(o, 'jaw', g.talk * (0.02 + 0.075 * syll));
    return { turns: o, lift: s.lift };
  }

  /** Какой клип стояния идёт сейчас (2 — поправить волосы, 3 — сложить руки), или ни один. */
  get playing(): 2 | 3 | null {
    return this.idle.clip === STAND2 ? 2 : this.idle.clip === STAND3 ? 3 : null;
  }

  /** Для тестов и стенда: позы по имени. */
  posed(id: PoseId): { turns: Record<string, Turn>; lift: V3 } {
    return this.poses[id];
  }

  /** Стенд: начать клип стояния сейчас. */
  play(clip: 2 | 3, t: number): void {
    this.idle = { clip: clip === 2 ? STAND2 : STAND3, at: t, next: 0 };
  }

  /** Стенд: моргнуть сейчас. */
  blink(t: number): void {
    this.blinkAt = t;
  }
}
