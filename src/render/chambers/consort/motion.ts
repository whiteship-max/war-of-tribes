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
// Лицо живёт поверх (набор, `kit/motion.FaceLife`): моргание раз в 3–6 с (кость `lids`), взгляд ведёт голову (сдвиг белка,
// `skin.SkinBody.gaze`), рот — челюстью при речи. Случайность — сеяная (`Math.random` в игре нет нигде).
import type { V3 } from '../../city/geom';
import type { Skeleton, Turn } from '../rig';
import type { Gesture } from '../folk';
import { FaceLife, addT, blend, blendArm, lookTurns, mirror, sample, solvePose, type ArmAim, type Clip, type PoseDef, type Solved, type Turns } from '../kit/motion';
import { BODY_SCALE } from './figure';
import { HEAD } from './head';

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

const STAND2: Clip<PoseId> = {
  len: 3.6,
  keys: [
    [0, 'fold'],
    [1.0, 'hairUp'],
    [1.7, 'hairTuck'],
    [2.2, 'hairTuck'],
    [3.6, 'fold'],
  ],
};
const STAND3: Clip<PoseId> = {
  len: 5.0,
  keys: [
    [0, 'fold'],
    [1.1, 'armsCross'],
    [3.8, 'armsCross'],
    [5.0, 'fold'],
  ],
};

/** Какой клип стоять и с какого времени: сеяное расписание — раз в 8–14 с, второй или третий. */
interface Idle {
  clip: Clip<PoseId> | null;
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
  private seed: number;
  /** Лицо поверх позы — набор (`kit/motion.FaceLife`): взгляд, моргание, рот; кость у них общая с клипами стояния. */
  private face: FaceLife;
  readonly closeLids: number;

  constructor(sk: Skeleton, seed = 1207) {
    this.seed = seed >>> 0 || 1;
    this.poses = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, solvePose(sk, v as PoseDef, BODY_SCALE)])) as Record<PoseId, Solved>;
    this.closeLids = HEAD.lidClose();
    this.face = new FaceLife(this.closeLids, () => this.rnd(), { reach: [0.0078, 0.004], saccade: [0.0014, 0.0008], jaw: [0.02, 0.075] });
  }

  /** Сдвиг белка этого кадра, м (по горизонтали — к левому боку фигуры, вверх). */
  get gaze(): [number, number] {
    return this.face.gaze;
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
    // Взгляд: голова и шея к собеседнику (как у людей покоев), глаза — впереди головы; моргание и рот при речи.
    lookTurns(o, g);
    this.face.step(o, t, g, want);
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
    this.face.blink(t);
  }
}
