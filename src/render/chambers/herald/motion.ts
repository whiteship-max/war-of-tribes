// Движения гонца (ЛЦ-3, docs/characters.md): ключи в коде, как у супруги, — позы рук по цели кисти (двухзвенная ИК набора,
// `kit/motion`), корпус, ноги и плащ — поворотами костей:
//
//   · стоять — переминается с ноги на ногу (таз над опорной, вторая — в колене), отдышка после дороги: грудь и плечи
//     ходят часто и глубоко, рот приоткрыт; за полминуты на месте дыхание успокаивается, пройдённый путь сбивает его снова;
//   · поклон — низкий, правая рука к сердцу, левая чуть назад (`folk.Gesture.bow`);
//   · вручить свиток — правая рука вперёд на уровне груди, пальцы к правителю, лист стоймя в щепоти (`offer`): письмо в
//     кисти лежит в тех же осях, что у прежнего гонца, поэтому жизнь покоев кладёт его туда же;
//   · идти — шаг споро (ноги, мах рук против ног), плащ отлетает назад, сума бьёт по бедру;
//   · говорить — рука объясняет (правая, а если правая протягивает письмо — левая), голова в такт, челюсть по слогам;
//   · дверь — правой рукой к ручке (`reach`), как у людей покоев.
//
// Лицо поверх — набор (`kit/motion.FaceLife`): моргание раз в 3–6 с, взгляд к правителю раньше головы. Случайность —
// сеяная (`Math.random` в игре нет нигде).
import type { V3 } from '../../city/geom';
import type { Skeleton, Turn } from '../rig';
import type { Gesture } from '../folk';
import { FaceLife, addT, blend, blendArm, lifeRng, lookTurns, mirror, solvePose, type ArmAim, type PoseDef, type Solved, type Turns } from '../kit/motion';

const STAND_L: ArmAim = { wrist: [0.202, 0.9, 0.035], elbow: [0.3, 1.13, -0.22] };
const TALK_A: ArmAim = { wrist: [-0.15, 1.04, 0.3], elbow: [-0.3, 1.0, -0.05], hand: [-0.2, -0.3, -0.5] };
const TALK_B: ArmAim = { wrist: [-0.2, 1.09, 0.27], elbow: [-0.33, 1.02, -0.06], hand: [-0.45, -0.5, -0.7] };

const P = {
  stand: { L: STAND_L, R: mirror(STAND_L) },
  // Рука к сердцу (поклон): кисть на левой стороне груди, пальцы к плечу, ладонь — к груди.
  heart: { R: { wrist: [0.03, 1.29, 0.14], elbow: [-0.24, 1.17, 0.1], fingers: [1, 0.4, 0.1], palm: [0, 0.1, -1] } },
  // Вручить: правая вперёд на высоте груди, пальцы к правителю, большой палец вверх — лист стоймя лицом к нему.
  offer: { R: { wrist: [-0.085, 1.27, 0.42], elbow: [-0.3, 1.13, 0.12], fingers: [0.08, 0.2, 1], palm: [1, 0, 0] } },
  // К ручке двери — вперёд и чуть вниз.
  reach: { R: { wrist: [-0.13, 1.1, 0.44], elbow: [-0.33, 1.1, 0.05], fingers: [0, 0, 1], palm: [1, 0, 0] } },
  talkA: { R: TALK_A },
  talkB: { R: TALK_B },
  talkAL: { L: mirror(TALK_A) },
  talkBL: { L: mirror(TALK_B) },
} satisfies Record<string, PoseDef>;
type PoseId = keyof typeof P;

/**
 * Живость гонца: поза кадра по жестам `folk.Person` (шаг, поклон, письмо, речь, дверь, взгляд), своя отдышка и
 * переминание, моргание, взгляд и рот. `gaze` — куда сдвинуть белок (метры).
 */
export class HeraldMotion {
  private poses: Record<PoseId, Solved>;
  private face: FaceLife;
  private rnd: () => number;
  readonly closeLids: number;
  /** Сбитое дыхание (0…1): с дороги — почти целиком, на месте успокаивается, на ходу сбивается снова. */
  winded = 0.85;
  private lastT: number | null = null;
  private breath = 0;

  constructor(sk: Skeleton, closeLids: number, seed = 2311) {
    this.poses = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, solvePose(sk, v as PoseDef, 1)])) as Record<PoseId, Solved>;
    this.closeLids = closeLids;
    this.rnd = lifeRng(seed);
    this.face = new FaceLife(closeLids, this.rnd, { reach: [0.0078, 0.004], saccade: [0.0014, 0.0008], jaw: [0.02, 0.075] });
  }

  get gaze(): [number, number] {
    return this.face.gaze;
  }

  /** Поза кадра (`folk.Person` зовёт её вместо `folk.posture`). */
  pose(t: number, phase: number, walk: number, g: Gesture, want: Gesture): { turns: Turns; lift: V3 } {
    const dt = this.lastT === null ? 0 : Math.max(0, Math.min(0.1, t - this.lastT));
    this.lastT = t;
    // Отдышка: на ходу — набирается, стоя — уходит за полминуты.
    this.winded = Math.max(0, Math.min(1, this.winded + dt * (walk > 0.3 ? 0.2 * walk : -1 / 28)));
    const e = this.winded;
    this.breath += dt * (1.5 + 2.9 * e);
    // Руки: стоя — свободно; речь, дверь, письмо и поклон — целями кисти поверх.
    let s: Solved = this.poses.stand;
    if (g.talk > 0.001) {
      const a = 0.5 + 0.5 * Math.sin(t * 1.9) * Math.sin(t * 0.7 + 1);
      // Правая занята письмом — объясняет левая.
      if (g.offer > 0.5) s = blendArm(s, blend(this.poses.talkAL, this.poses.talkBL, a), 'L', g.talk);
      else s = blendArm(s, blend(this.poses.talkA, this.poses.talkB, a), 'R', g.talk * (1 - g.offer));
    }
    if (g.reach > 0.001) s = blendArm(s, this.poses.reach, 'R', g.reach);
    if (g.offer > 0.001) s = blendArm(s, this.poses.offer, 'R', g.offer);
    if (g.bow > 0.001) s = blendArm(s, this.poses.heart, 'R', g.bow * (1 - g.offer));
    const o: Turns = Object.fromEntries(Object.entries(s.turns).map(([k, v]) => [k, [...v] as [number, number, number]]));
    const lift: V3 = [...s.lift] as V3;
    // Дыхание: с дороги — часто и глубоко, плечи вверх, голова в такт, рот приоткрыт.
    const br = Math.sin(this.breath);
    addT(o, 'chest', -(0.014 + 0.03 * e) * br);
    addT(o, 'neck', (0.008 + 0.012 * e) * br);
    addT(o, 'head', 0.01 * e * Math.sin(this.breath + 0.6));
    for (const [side, sx] of [
      ['L', 1],
      ['R', -1],
    ] as const)
      addT(o, `arm${side}`, 0, 0, sx * (0.01 + 0.018 * e) * br);
    addT(o, 'jaw', 0.012 * e * (0.6 + 0.4 * Math.max(0, br)) * (1 - g.talk));
    // Переминание: таз над опорной ногой, вторая — в колене; плащ и сума — следом.
    const still = 1 - walk;
    const sh = Math.sin(t * 0.42) * still * (1 - 0.7 * Math.max(g.bow, g.offer));
    lift[0] += 0.014 * sh;
    lift[1] -= 0.006 * Math.abs(sh);
    addT(o, 'hips', 0, 0.03 * sh, 0.035 * sh);
    addT(o, 'spine', 0, -0.02 * sh, -0.03 * sh);
    addT(o, 'chest', 0, 0, -0.012 * sh);
    const relax = sh > 0 ? 'R' : 'L';
    addT(o, `thigh${relax}`, -0.06 * Math.abs(sh), 0, 0);
    addT(o, `shin${relax}`, 0.14 * Math.abs(sh));
    addT(o, `foot${relax}`, -0.06 * Math.abs(sh));
    addT(o, 'thighL', 0, 0, -0.035 * sh);
    addT(o, 'thighR', 0, 0, -0.035 * sh);
    addT(o, 'cloak', 0.012 * Math.sin(t * 0.7), 0, -0.02 * sh);
    addT(o, 'bag', 0, 0, -0.02 * sh);
    // Шаг: ноги, мах рук против ног, плащ отлетает назад, сума бьёт по бедру.
    if (walk > 0.001) {
      const sw = Math.sin(phase);
      for (const [side, ph] of [
        ['L', 0],
        ['R', Math.PI],
      ] as const) {
        const p = phase + ph;
        const leg = Math.sin(p);
        addT(o, `thigh${side}`, -leg * 0.42 * walk);
        const knee = Math.max(0, Math.sin(p - 0.9)) * 0.85 + 0.08;
        addT(o, `shin${side}`, knee * walk);
        addT(o, `foot${side}`, (-knee * 0.4 + leg * 0.15) * walk);
        addT(o, `arm${side}`, leg * 0.3 * walk * (side === 'R' ? 1 - Math.max(g.offer, g.reach) : 1));
        addT(o, `fore${side}`, -Math.max(0, leg) * 0.22 * walk);
      }
      addT(o, 'hips', 0, sw * 0.07 * walk, 0);
      addT(o, 'chest', 0.05 * walk, -sw * 0.09 * walk, 0);
      addT(o, 'head', -0.03 * walk, sw * 0.04 * walk, 0);
      addT(o, 'cloak', 0.14 * walk + 0.04 * Math.sin(phase * 2) * walk, 0, -0.03 * sw * walk);
      addT(o, 'bag', 0.05 * Math.sin(phase * 2) * walk, 0, 0.08 * sw * walk);
      lift[1] += (-Math.abs(Math.cos(phase)) * 0.024 + 0.011) * walk;
    }
    // Поклон: спина и голова вперёд, таз чуть назад; левая рука — назад.
    if (g.bow > 0.001) {
      const b = g.bow;
      addT(o, 'spine', 0.28 * b);
      addT(o, 'chest', 0.3 * b);
      addT(o, 'neck', 0.12 * b);
      addT(o, 'head', 0.2 * b);
      addT(o, 'armL', 0.18 * b, 0, 0.04 * b);
      addT(o, 'cloak', -0.12 * b);
      lift[2] -= 0.05 * b;
    }
    // Вручить: корпус подаётся к правителю.
    if (g.offer > 0.001) {
      addT(o, 'spine', 0.08 * g.offer);
      addT(o, 'chest', 0.04 * g.offer);
      addT(o, 'head', 0.06 * g.offer);
    }
    // Речь: голова кивает, плечи живые.
    if (g.talk > 0.001) {
      addT(o, 'head', 0.04 * Math.sin(t * 2.6) * g.talk, 0.05 * Math.sin(t * 1.1) * g.talk, 0.03 * Math.sin(t * 0.9) * g.talk);
      addT(o, 'neck', 0.03 * Math.sin(t * 2.1 + 1) * g.talk);
    }
    lookTurns(o, g);
    this.face.step(o, t, g, want);
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
