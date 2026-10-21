// Движения советника (ЛЦ-5, docs/characters.md): ключи в коде, как у супруги и гонца, — позы рук по цели кисти (двухзвенная
// ИК набора, `kit/motion`), корпус, голова, борода и подол — поворотами костей:
//
//   · стоять — спина чуть сутулая (грудь и шея вперёд, голова поднята к собеседнику), дыхание медленное; руки: левая держит
//     свиток у пояса, правая свободна. Сам по себе, раз в 5–9 с (сеяная кость), он гладит бороду (правая — к подбородку и
//     вниз по бороде, дважды), листает свиток (правая — к свитку, перехватить край и назад) или задумчиво кивает (голова
//     медленно вниз и вверх, взгляд в сторону);
//   · задумчиво кивнуть — и в речи: на паузах между фразами;
//   · указать рукой — в речи, раз в 5–8 с: правая вытянута вперёд и чуть вверх, ладонь вниз, голова — следом;
//   · идти — скольжением: ног нет, таз плывёт ровно, подол спереди идёт шагом (`hemL`, `hemR` поочерёдно), мантия чуть
//     покачивается, руки едва ходят;
//   · говорить — правая объясняет раскрытой ладонью, голова в такт, челюсть (и борода с ней) по слогам;
//   · поклон — с достоинством, правая к сердцу (`folk.Gesture.bow`); свиток доклада — левой перед грудью (`read`);
//     дверь — правой к ручке (`reach`), как у людей покоев.
//
// Лицо поверх — набор (`kit/motion.FaceLife`): моргание раз в 3–6 с, взгляд к правителю раньше головы. Случайность —
// сеяная (`Math.random` в игре нет нигде).
import type { V3 } from '../../city/geom';
import type { Skeleton, Turn } from '../rig';
import type { Gesture } from '../folk';
import { FaceLife, addT, blend, blendArm, lifeRng, lookTurns, mirror, sample, solvePose, type ArmAim, type Clip, type PoseDef, type Solved, type Turns } from '../kit/motion';

/** Левая держит свиток у пояса: кисть перед бедром, свиток — стоймя. */
const HOLD_L: ArmAim = { wrist: [0.115, 0.98, 0.16], elbow: [0.26, 1.04, -0.12], fingers: [-0.35, 0.15, 0.9], palm: [-0.4, 0.9, 0] };
const REST_R: ArmAim = { wrist: [-0.188, 0.875, 0.06], elbow: [-0.3, 1.1, -0.18] };
const TALK_A: ArmAim = { wrist: [-0.14, 1.03, 0.28], elbow: [-0.3, 1.0, -0.05], fingers: [-0.2, 0.25, 1], palm: [0.2, 1, 0.1] };
const TALK_B: ArmAim = { wrist: [-0.19, 1.07, 0.25], elbow: [-0.32, 1.02, -0.06], fingers: [-0.45, 0.3, 0.85], palm: [0.4, 1, -0.1] };

const P = {
  stand: { L: HOLD_L, R: REST_R, turns: {} },
  // Свиток доклада перед грудью (левая), правая — свободна.
  read: { L: { wrist: [0.05, 1.16, 0.26], elbow: [0.25, 1.06, 0.0], fingers: [-0.6, 0.55, 0.55], palm: [0, 0.3, 1] } },
  // Гладит бороду: кисть под бородой спереди, пальцы — вверх к горлу по бороде, ладонь к ней; затем ниже, к кончику.
  strokeA: { R: { wrist: [-0.045, 1.43, 0.12], elbow: [-0.26, 1.2, 0.0], fingers: [0.15, 0.6, -0.8], palm: [0.3, -0.5, -0.8] } },
  strokeB: { R: { wrist: [-0.035, 1.35, 0.115], elbow: [-0.26, 1.14, 0.0], fingers: [0.15, 0.75, -0.65], palm: [0.3, -0.4, -0.85] } },
  // Листает свиток: правая к краю свитка у левой руки, перехватить и отвести.
  leafA: { R: { wrist: [-0.05, 1.13, 0.25], elbow: [-0.26, 1.06, 0.0], fingers: [1, 0.2, 0.1], palm: [0, -0.3, -1] } },
  leafB: { R: { wrist: [-0.1, 1.16, 0.26], elbow: [-0.3, 1.08, 0.02], fingers: [0.85, 0.45, 0.15], palm: [0, -0.4, -1] } },
  // Указать рукой: правая вытянута вперёд и чуть вверх, ладонь вниз.
  point: { R: { wrist: [-0.16, 1.33, 0.46], elbow: [-0.3, 1.26, 0.14], fingers: [-0.15, 0.2, 1], palm: [0, -1, 0.1] } },
  // Рука к сердцу (поклон).
  heart: { R: { wrist: [0.03, 1.2, 0.14], elbow: [-0.24, 1.1, 0.08], fingers: [1, 0.4, 0.1], palm: [0, 0.1, -1] } },
  // К ручке двери.
  reach: { R: { wrist: [-0.13, 1.06, 0.42], elbow: [-0.33, 1.06, 0.05], fingers: [0, 0, 1], palm: [1, 0, 0] } },
  talkA: { R: TALK_A },
  talkB: { R: TALK_B },
  talkAL: { L: mirror(TALK_A) },
  talkBL: { L: mirror(TALK_B) },
} satisfies Record<string, PoseDef>;
type PoseId = keyof typeof P;

/** Позы клипов правой руки и головы: правая — по цели, голова — поворотом (кивок и взгляд при нём). */
const CLIP_POSES = {
  rest: { R: REST_R },
  strokeA: P.strokeA,
  strokeB: P.strokeB,
  leafA: P.leafA,
  leafB: P.leafB,
  point: { R: P.point.R, turns: { head: [-0.06, -0.12, 0], chest: [0, -0.1, 0] } },
  nodDown: { R: REST_R, turns: { head: [0.28, 0.14, 0.04], neck: [0.1, 0.06, 0] } },
  nodUp: { R: REST_R, turns: { head: [0.04, 0.2, 0.02], neck: [0.02, 0.08, 0] } },
} satisfies Record<string, PoseDef>;
type ClipPose = keyof typeof CLIP_POSES;
export type ClipId = 'stroke' | 'leaf' | 'nod' | 'point';

/** Клипы ключами (секунда, поза): гладить бороду дважды, листать свиток, задумчиво кивнуть, указать рукой. */
export const CLIPS: Record<ClipId, Clip<ClipPose>> = {
  stroke: {
    len: 3.6,
    keys: [
      [0, 'rest'],
      [0.75, 'strokeA'],
      [1.35, 'strokeB'],
      [1.75, 'strokeA'],
      [2.4, 'strokeB'],
      [3.6, 'rest'],
    ],
  },
  leaf: {
    len: 2.8,
    keys: [
      [0, 'rest'],
      [0.8, 'leafA'],
      [1.3, 'leafB'],
      [1.7, 'leafA'],
      [2.8, 'rest'],
    ],
  },
  nod: {
    len: 2.4,
    keys: [
      [0, 'rest'],
      [0.6, 'nodUp'],
      [1.2, 'nodDown'],
      [1.7, 'nodDown'],
      [2.4, 'rest'],
    ],
  },
  point: {
    len: 2.4,
    keys: [
      [0, 'rest'],
      [0.55, 'point'],
      [1.7, 'point'],
      [2.4, 'rest'],
    ],
  },
};

/** Сутулость в покое: грудь и шея вперёд, голова поднята навстречу собеседнику. */
export const STOOP = { chest: 0.13, neck: 0.12, head: -0.1 } as const;

/**
 * Живость советника: поза кадра по жестам `folk.Person` (шаг, поклон, свиток, речь, дверь, взгляд), свои клипы (гладить
 * бороду, листать свиток, кивок, указать рукой), сутулость и медленное дыхание, моргание, взгляд и рот. `gaze` — сдвиг белка.
 */
export class AdvisorMotion {
  private poses: Record<PoseId, Solved>;
  private clipPoses: Record<ClipPose, Solved>;
  private face: FaceLife;
  private rnd: () => number;
  readonly closeLids: number;
  /** Играющий клип: какой и с какой секунды. */
  private play: { clip: ClipId; at: number } | null = null;
  private next = 4;
  private nextTalk = 3;

  constructor(sk: Skeleton, closeLids: number, seed = 5101) {
    this.poses = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, solvePose(sk, v as PoseDef, 1)])) as Record<PoseId, Solved>;
    this.clipPoses = Object.fromEntries(Object.entries(CLIP_POSES).map(([k, v]) => [k, solvePose(sk, v as PoseDef, 1)])) as Record<ClipPose, Solved>;
    this.closeLids = closeLids;
    this.rnd = lifeRng(seed);
    this.face = new FaceLife(closeLids, this.rnd, { reach: [0.0078, 0.004], saccade: [0.0012, 0.0007], jaw: [0.016, 0.06] });
  }

  get gaze(): [number, number] {
    return this.face.gaze;
  }

  /** Какой клип играет (тестам и стенду). */
  get playing(): ClipId | null {
    return this.play?.clip ?? null;
  }

  /** Стенд и тесты: начать клип сейчас (секунда `t`). */
  start(clip: ClipId, t: number): void {
    this.play = { clip, at: t };
  }

  /** Решить, не начать ли клип: стоя — гладит бороду, листает свиток или кивает; в речи — указывает рукой и кивает. */
  private choose(t: number, walk: number, g: Gesture): void {
    if (this.play || walk > 0.1 || g.bow > 0.1 || g.reach > 0.1 || g.offer > 0.1) return;
    if (g.talk > 0.5) {
      if (t >= this.nextTalk) {
        this.start(this.rnd() < 0.62 ? 'point' : 'nod', t);
        this.nextTalk = t + 5 + this.rnd() * 3;
      }
      return;
    }
    if (t < this.next) return;
    const r = this.rnd();
    // Свиток у груди (читает) — листает чаще; без свитка в руке перед собой — гладит бороду или кивает.
    const leaf = g.read > 0.2 ? 0.45 : 0.2;
    this.start(r < leaf ? 'leaf' : r < leaf + 0.38 ? 'stroke' : 'nod', t);
    this.next = t + 5 + this.rnd() * 4;
  }

  /** Поза кадра (`folk.Person` зовёт её вместо `folk.posture`). */
  pose(t: number, phase: number, walk: number, g: Gesture, want: Gesture): { turns: Turns; lift: V3 } {
    this.choose(t, walk, g);
    // Руки: левая со свитком у пояса или перед грудью (`read`), правая — свободна; речь, дверь, поклон — целями кисти поверх.
    let s: Solved = this.poses.stand;
    if (g.read > 0.001) s = blendArm(s, this.poses.read, 'L', g.read);
    if (g.talk > 0.001) {
      const a = 0.5 + 0.5 * Math.sin(t * 1.5) * Math.sin(t * 0.6 + 1);
      s = blendArm(s, blend(this.poses.talkA, this.poses.talkB, a), 'R', g.talk);
      // Без свитка перед грудью — объясняет и левая, но меньше.
      if (g.read < 0.5) s = blendArm(s, blend(this.poses.talkAL, this.poses.talkBL, 1 - a), 'L', g.talk * 0.35 * (1 - g.read));
    }
    if (g.reach > 0.001) s = blendArm(s, this.poses.reach, 'R', g.reach);
    if (g.bow > 0.001) s = blendArm(s, this.poses.heart, 'R', g.bow);
    // Клип: правая рука и голова — по ключам, вход и выход — мягко, поверх речи и стояния (не поверх поклона и двери).
    let clipHead: Turns = {};
    if (this.play) {
      const c = CLIPS[this.play.clip];
      const k = t - this.play.at;
      if (k < 0 || k > c.len || walk > 0.3 || g.bow > 0.2 || g.reach > 0.2) this.play = null;
      else {
        const q = sample(c, this.clipPoses, k);
        const env = Math.min(1, k / 0.35, (c.len - k) / 0.45);
        s = blendArm(s, q, 'R', Math.max(0, env));
        clipHead = q.turns;
      }
    }
    const o: Turns = Object.fromEntries(Object.entries(s.turns).map(([k, v]) => [k, [...v] as [number, number, number]]));
    const lift: V3 = [...s.lift] as V3;
    for (const [bone, v] of Object.entries(clipHead)) if (bone === 'head' || bone === 'neck' || bone === 'chest') addT(o, bone, v[0], v[1], v[2]);
    // Сутулость и медленное дыхание.
    const br = Math.sin(t * 1.15);
    addT(o, 'chest', STOOP.chest - 0.012 * br);
    addT(o, 'neck', STOOP.neck + 0.006 * br);
    addT(o, 'head', STOOP.head);
    addT(o, 'spine', 0.03);
    for (const [side, sx] of [
      ['L', 1],
      ['R', -1],
    ] as const)
      addT(o, `arm${side}`, 0, 0, sx * 0.006 * br);
    // Стоя — мантия едва колышется, вес с ноги на ногу — подолом.
    const still = 1 - walk;
    const sh = Math.sin(t * 0.33) * still;
    lift[0] += 0.006 * sh;
    addT(o, 'hips', 0, 0.02 * sh, 0.012 * sh);
    addT(o, 'spine', 0, -0.012 * sh, -0.01 * sh);
    addT(o, 'hemL', -0.02 * sh);
    addT(o, 'hemR', 0.02 * sh);
    // Борода — следом за головой, с запаздыванием качнётся.
    addT(o, 'beard', 0.02 * Math.sin(t * 0.9) * still, 0, 0.015 * Math.sin(t * 0.7 + 1));
    // Шаг скольжением: таз плывёт ровно, подол спереди идёт шагом поочерёдно, мантия покачивается, руки едва ходят.
    if (walk > 0.001) {
      const sw = Math.sin(phase);
      addT(o, 'hemL', -0.16 * sw * walk);
      addT(o, 'hemR', 0.16 * sw * walk);
      addT(o, 'hips', 0, 0.035 * sw * walk, 0.012 * Math.sin(phase * 2) * walk);
      addT(o, 'spine', 0.04 * walk, -0.02 * sw * walk, 0);
      addT(o, 'chest', 0.03 * walk, -0.03 * sw * walk, 0);
      addT(o, 'armL', 0.06 * sw * walk);
      addT(o, 'armR', -0.12 * sw * walk * (1 - Math.max(g.reach, g.bow)));
      addT(o, 'beard', 0.04 * Math.sin(phase * 2) * walk);
      lift[1] += 0.003 * Math.abs(Math.cos(phase)) * walk;
    }
    // Поклон с достоинством: спина и голова вперёд неглубоко.
    if (g.bow > 0.001) {
      const b = g.bow;
      addT(o, 'spine', 0.22 * b);
      addT(o, 'chest', 0.2 * b);
      addT(o, 'neck', 0.1 * b);
      addT(o, 'head', 0.22 * b);
      lift[2] -= 0.03 * b;
    }
    // Читает: голова к свитку, когда не смотрит на правителя.
    if (g.read > 0.001) addT(o, 'head', 0.12 * g.read * (1 - Math.min(1, Math.abs(g.lookYaw))));
    // Речь: голова в такт.
    if (g.talk > 0.001) {
      addT(o, 'head', 0.03 * Math.sin(t * 2.2) * g.talk, 0.04 * Math.sin(t * 0.9) * g.talk, 0.02 * Math.sin(t * 0.8) * g.talk);
      addT(o, 'neck', 0.02 * Math.sin(t * 1.8 + 1) * g.talk);
    }
    lookTurns(o, g);
    this.face.step(o, t, g, want);
    // Борода ходит с челюстью сама (ребёнок `jaw`).
    return { turns: o, lift };
  }

  /** Для тестов и стенда: позы по имени. */
  posed(id: PoseId): { turns: Record<string, Turn>; lift: V3 } {
    return this.poses[id];
  }

  /** Стенд: моргнуть сейчас. */
  blink(t: number): void {
    this.face.blink(t);
  }
}
