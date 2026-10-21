// Живость набора персонажа (ЛЦ-3, docs/characters.md; вынесено из супруги ЛЦ-2): ключи в коде, без мокапа. Позы задаются
// тем, где кисти (руки решаются двухзвенной ИК от плеча с направлением локтя), и поворотами корпуса и головы; клипы — ключи
// этих поз во времени. Лицо живёт поверх (`FaceLife`): моргание раз в 3–6 с (кость `lids`), взгляд ведёт голову (сдвиг
// белка, `skin.SkinBody.gaze`), рот — челюстью при речи. Чьи позы и клипы — у фигуры (`consort/motion.ts`,
// `herald/motion.ts`). Случайность — сеяная (`Math.random` в игре нет нигде).
import type { V3 } from '../../city/geom';
import type { Skeleton } from '../rig';
import type { Gesture } from '../folk';

export type Turns = Record<string, [number, number, number]>;
type M3 = Float64Array;

// ---------- Повороты ----------

export function axisAngle(ax: V3, a: number): M3 {
  const [x, y, z] = ax;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  // По столбцам.
  return Float64Array.from([t * x * x + c, t * x * y + s * z, t * x * z - s * y, t * x * y - s * z, t * y * y + c, t * y * z + s * x, t * x * z + s * y, t * y * z - s * x, t * z * z + c]);
}
export const tmulV = (m: M3, v: V3): V3 => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => scale(a, 1 / (len(a) || 1));

export function mulM(a: M3, b: M3): M3 {
  const o = new Float64Array(9);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
  return o;
}
export function transpose(a: M3): M3 {
  return Float64Array.from([a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]]);
}

/** Кратчайший поворот, переводящий единичный `a` в единичный `b`. */
export function between(a: V3, b: V3): M3 {
  const c = cross(a, b);
  const s = len(c);
  const d = Math.max(-1, Math.min(1, dot(a, b)));
  if (s < 1e-9) return d > 0 ? axisAngle([1, 0, 0], 0) : axisAngle(unit(cross(a, Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), Math.PI);
  return axisAngle(scale(c, 1 / s), Math.atan2(s, d));
}

/** Матрица → поворот сустава (`rig.Turn`: наклон x, поворот y, крен z; порядок y, x, z — как `rig.rotYXZ`). */
export function toTurn(m: M3): [number, number, number] {
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
export interface ArmAim {
  wrist: V3;
  elbow: V3;
  /** Кисть локально (Turn) — или в осях фигуры: куда пальцы и куда смотрит ладонь. */
  hand?: [number, number, number];
  fingers?: V3;
  palm?: V3;
  thumb?: [number, number, number];
}

/** Поза: руки (по цели кисти) и прочие кости прямо. */
export interface PoseDef {
  L?: ArmAim;
  R?: ArmAim;
  turns?: Turns;
  lift?: V3;
}

/** Решить руку: плечо и предплечье — двухзвенная ИК с направлением локтя. */
export function solveArm(sk: Skeleton, side: 'L' | 'R', aim: ArmAim, out: Turns, size: number): void {
  const S = sk.bones[sk.of(`arm${side}`)].j;
  const E = sk.bones[sk.of(`fore${side}`)].j;
  const W = sk.bones[sk.of(`hand${side}`)].j;
  const l1 = len(sub(E, S));
  const l2 = len(sub(W, E));
  // Цели заданы в чертёжных мерах фигуры — в рост её переводит тот же масштаб, что кости (`size`, у супруги — `BODY_SCALE`).
  const wrist = scale(aim.wrist, size);
  const d = sub(wrist, S);
  const dist = Math.max(0.05, Math.min(l1 + l2 - 1e-4, len(d)));
  const dn = unit(d);
  const ca = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const pole = sub(scale(aim.elbow, size), S);
  const pp = unit(sub(pole, scale(dn, dot(pole, dn))));
  const e2 = add(S, add(scale(dn, l1 * ca), scale(pp, l1 * Math.sqrt(Math.max(0, 1 - ca * ca)))));
  const w2 = add(S, scale(dn, dist));
  const r1 = between(unit(sub(E, S)), unit(sub(e2, S)));
  const r2 = between(unit(sub(W, E)), unit(tmulV(r1, sub(w2, e2))));
  out[`arm${side}`] = toTurn(r1);
  out[`fore${side}`] = toTurn(r2);
  out[`hand${side}`] = aim.hand ?? [0, 0, 0];
  if (aim.fingers && aim.palm) {
    // Покой кисти: пальцы — вдоль предплечья, ладонь — к телу (`body.mitten`); цель — в осях фигуры.
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

export function solvePose(sk: Skeleton, p: PoseDef, size: number): { turns: Turns; lift: V3 } {
  const turns: Turns = {};
  for (const [n, v] of Object.entries(p.turns ?? {})) turns[n] = [...v];
  if (p.L) solveArm(sk, 'L', p.L, turns, size);
  if (p.R) solveArm(sk, 'R', p.R, turns, size);
  return { turns, lift: scale(p.lift ?? [0, 0, 0], size) };
}

export const mirror = (a: ArmAim): ArmAim => ({
  wrist: [-a.wrist[0], a.wrist[1], a.wrist[2]],
  elbow: [-a.elbow[0], a.elbow[1], a.elbow[2]],
  hand: a.hand ? [a.hand[0], -a.hand[1], -a.hand[2]] : undefined,
  thumb: a.thumb ? [a.thumb[0], -a.thumb[1], -a.thumb[2]] : undefined,
});

// ---------- Клипы ----------

/** Клип: ключи (секунда, поза); между ключами — плавно (кубом). */
export interface Clip<P extends string = string> {
  len: number;
  keys: readonly (readonly [number, P])[];
}
export type Solved = { turns: Turns; lift: V3 };

export function blend(a: Solved, b: Solved, k: number): Solved {
  const turns: Turns = {};
  for (const n of new Set([...Object.keys(a.turns), ...Object.keys(b.turns)])) {
    const x = a.turns[n] ?? [0, 0, 0];
    const y = b.turns[n] ?? [0, 0, 0];
    turns[n] = [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
  }
  return { turns, lift: [a.lift[0] + (b.lift[0] - a.lift[0]) * k, a.lift[1] + (b.lift[1] - a.lift[1]) * k, a.lift[2] + (b.lift[2] - a.lift[2]) * k] };
}

/** Только кости руки стороны `side` — из `b`, остальное — из `a`. */
export function blendArm(a: Solved, b: Solved, side: 'L' | 'R', k: number): Solved {
  const out: Solved = { turns: { ...a.turns }, lift: a.lift };
  for (const n of [`arm${side}`, `fore${side}`, `hand${side}`, `thumb${side}`]) {
    const x = a.turns[n] ?? [0, 0, 0];
    const y = b.turns[n] ?? [0, 0, 0];
    out.turns[n] = [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
  }
  return out;
}

export const ease = (k: number): number => k * k * (3 - 2 * k);

export function sample<P extends string>(clip: Clip<P>, poses: Record<P, Solved>, t: number): Solved {
  const keys = clip.keys;
  if (t <= keys[0][0]) return poses[keys[0][1]];
  for (let i = 1; i < keys.length; i++)
    if (t <= keys[i][0]) {
      const k = (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      return blend(poses[keys[i - 1][1]], poses[keys[i][1]], ease(k));
    }
  return poses[keys[keys.length - 1][1]];
}

export const addT = (o: Turns, bone: string, x: number, y = 0, z = 0): void => {
  const t = o[bone] ?? (o[bone] = [0, 0, 0]);
  t[0] += x;
  t[1] += y;
  t[2] += z;
};

/** Сеяная кость живости: 0…1 (xorshift). */
export function lifeRng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x = x >>> 0;
    return x / 4294967296;
  };
}

/** Взгляд головы: голова и шея к собеседнику (как у людей покоев, до ±1,1 рад), плечи — малой долей. */
export function lookTurns(o: Turns, g: Gesture): void {
  const ly = Math.max(-1.1, Math.min(1.1, g.lookYaw));
  const lp = Math.max(-0.5, Math.min(0.5, g.lookPitch));
  addT(o, 'head', -lp * 0.6, ly * 0.55, 0);
  addT(o, 'neck', -lp * 0.4, ly * 0.3, 0);
  addT(o, 'chest', 0, ly * 0.12, 0);
}

/** Меры лица живости: как далеко ходит белок и как широко ходит челюсть. */
export interface FaceLifeSpec {
  /** Сдвиг белка, м: к собеседнику по горизонтали и вверх; мелкие скачки (саккады) — по горизонтали и вверх. */
  reach: readonly [number, number];
  saccade: readonly [number, number];
  /** Челюсть при речи: всегда приоткрыта на `jaw[0]`, слогами — ещё на `jaw[1]`, рад. */
  jaw: readonly [number, number];
}

/**
 * Лицо поверх позы: взгляд (белок к собеседнику раньше головы, мелкие скачки), моргание раз в 3–6 с (закрыть быстро,
 * открыть мягче) и рот при речи. Кость у фигуры одна на всё (`rnd`): порядок бросков — скачок, моргание.
 */
export class FaceLife {
  private blinkAt = 2.2;
  private blinkK = 0;
  private sacc: [number, number] = [0, 0];
  private saccAt = 1;
  /** Сдвиг белка этого кадра, м (по горизонтали — к левому боку фигуры, вверх). */
  gaze: [number, number] = [0, 0];

  constructor(
    readonly closeLids: number,
    private rnd: () => number,
    private s: FaceLifeSpec,
  ) {}

  /** Поставить лицо кадра: повороты век и челюсти — в `o`, взгляд — в `gaze`. */
  step(o: Turns, t: number, g: Gesture, want: Gesture): void {
    const lp = Math.max(-0.5, Math.min(0.5, g.lookPitch));
    if (t >= this.saccAt) {
      this.sacc = [(this.rnd() - 0.5) * this.s.saccade[0], (this.rnd() - 0.5) * this.s.saccade[1]];
      this.saccAt = t + 0.7 + this.rnd() * 1.6;
    }
    const lead = Math.max(-0.55, Math.min(0.55, (want.lookYaw - g.lookYaw) * 0.97));
    const leadP = Math.max(-0.4, Math.min(0.4, want.lookPitch - g.lookPitch));
    this.gaze = [Math.sin(lead) * this.s.reach[0] + this.sacc[0], Math.sin(-leadP) * this.s.reach[1] + this.sacc[1] + 0.0008 * lp];
    // Моргание раз в 3–6 с: закрыть быстро, открыть мягче.
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
    addT(o, 'jaw', g.talk * (this.s.jaw[0] + this.s.jaw[1] * syll));
  }

  /** Стенд: моргнуть сейчас. */
  blink(t: number): void {
    this.blinkAt = t;
  }
}
