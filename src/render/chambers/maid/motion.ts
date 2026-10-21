// Движения служанки (ЛЦ-6, docs/characters.md): ключи в коде, как у супруги, гонца и советника, — позы рук по цели кисти
// (двухзвенная ИК набора, `kit/motion`), корпус, голова, коса и юбка — поворотами костей:
//
//   · стоять — левая держит поднос ладонью вверх у пояса, правая свободна (в покоях в ней кувшин — его кладёт жизнь покоев);
//     дыхание, лёгкое переминание. Сама по себе, раз в 6–10 с (сеяная кость), она поправляет фартук: правая разглаживает
//     его ладонью сверху вниз, дважды, голова — к фартуку;
//   · налить вино — прежний жест покоев (`folk.Gesture.pour`, `tip`): правая с кувшином вперёд над кубком, кисть наклоняет
//     кувшин носиком вниз, голова — к кубку; поднос — чуть в сторону;
//   · реверанс — прежнее приветствие (`folk.Gesture.curtsy`): опуститься, голова и плечи вниз, правая придерживает юбку,
//     поднос — ровно;
//   · идти с подносом — скольжением: ног нет, таз покачивается по шагу, юбка спереди толкается, сзади отстаёт, коса
//     качается; поднос — ровно, правая едва ходит;
//   · говорить — правая объясняет раскрытой ладонью, голова в такт, челюсть — по слогам.
//
// Лицо поверх — набор (`kit/motion.FaceLife`): моргание раз в 3–6 с, взгляд к правителю раньше головы. Случайность — сеяная
// (`Math.random` в игре нет нигде).
import type { V3 } from '../../city/geom';
import type { Skeleton, Turn } from '../rig';
import type { Gesture } from '../folk';
import { FaceLife, addT, blend, blendArm, lifeRng, lookTurns, sample, solvePose, type ArmAim, type Clip, type PoseDef, type Solved, type Turns } from '../kit/motion';

/** Поднос у пояса: предплечье вперёд, ладонь вверх, пальцы вперёд и чуть к середине. */
const TRAY_L: ArmAim = { wrist: [0.19, 0.985, 0.19], elbow: [0.32, 1.0, -0.12], fingers: [-0.15, 0, 1], palm: [0, 1, 0] };
/** Поднос в шаге — чуть выше и ближе к телу. */
const TRAY_WALK: ArmAim = { wrist: [0.185, 1.005, 0.17], elbow: [0.32, 1.02, -0.13], fingers: [-0.2, 0, 1], palm: [0, 1, 0] };
/** Правая свободна: вдоль тела, кисть у бедра; ладонь к телу, пальцы вниз (кувшин в ней — стоймя). */
const REST_R: ArmAim = { wrist: [-0.228, 0.79, 0.055], elbow: [-0.32, 1.0, -0.16], fingers: [0.08, -1, 0.12], palm: [1, 0, 0.05] };

const P = {
  stand: { L: TRAY_L, R: REST_R, turns: {} },
  walk: { L: TRAY_WALK, R: { wrist: [-0.22, 0.8, 0.08], elbow: [-0.32, 1.0, -0.14], fingers: [0.08, -1, 0.15], palm: [1, 0, 0.05] } },
  // Налить: кувшин стоймя перед собой над кубком; наклон — пальцы назад-вниз (кувшин клонится носиком вперёд).
  pour: { L: { wrist: [0.23, 0.97, 0.15], elbow: [0.34, 1.0, -0.12], fingers: [-0.1, 0, 1], palm: [0, 1, 0] }, R: { wrist: [-0.1, 1.13, 0.38], elbow: [-0.32, 1.08, 0.02], fingers: [0, -1, 0.1], palm: [1, 0, 0] } },
  tip: { R: { wrist: [-0.1, 1.12, 0.4], elbow: [-0.32, 1.08, 0.02], fingers: [0, -0.55, -0.83], palm: [1, 0, 0] } },
  // Реверанс: правая придерживает юбку сбоку, поднос — ровно у пояса.
  curtsy: { L: TRAY_L, R: { wrist: [-0.27, 0.74, 0.08], elbow: [-0.33, 0.96, -0.08], fingers: [0.2, -0.9, 0.4], palm: [1, 0, 0] }, turns: { head: [0.32, 0, 0], neck: [0.12, 0, 0], chest: [0.12, 0, 0], spine: [0.06, 0, 0] }, lift: [0, -0.1, -0.015] },
  // Речь: правая вперёд ладонью вверх.
  talkA: { R: { wrist: [-0.13, 0.99, 0.25], elbow: [-0.31, 0.95, -0.03], fingers: [-0.2, 0.15, 1], palm: [0.2, 1, 0] } },
  talkB: { R: { wrist: [-0.18, 1.03, 0.23], elbow: [-0.33, 0.97, -0.04], fingers: [-0.45, 0.25, 0.85], palm: [0.4, 1, -0.1] } },
  // К ручке двери.
  reach: { R: { wrist: [-0.13, 1.05, 0.42], elbow: [-0.33, 1.04, 0.05], fingers: [0, 0, 1], palm: [1, 0, 0] } },
} satisfies Record<string, PoseDef>;
type PoseId = keyof typeof P;

/** Позы клипа «поправить фартук»: правая ладонью к фартуку сверху и ниже; голова — вниз к нему. */
const CLIP_POSES = {
  rest: { R: REST_R },
  smoothA: { R: { wrist: [-0.08, 0.95, 0.17], elbow: [-0.3, 1.02, -0.06], fingers: [0.15, -1, 0.2], palm: [0.1, 0.1, -1] }, turns: { head: [0.26, -0.06, 0], neck: [0.08, 0, 0] } },
  smoothB: { R: { wrist: [-0.07, 0.845, 0.185], elbow: [-0.29, 0.98, -0.04], fingers: [0.15, -1, 0.3], palm: [0.1, 0.2, -1] }, turns: { head: [0.32, -0.08, 0], neck: [0.1, 0, 0], chest: [0.06, 0, 0] } },
} satisfies Record<string, PoseDef>;
type ClipPose = keyof typeof CLIP_POSES;
export type ClipId = 'apron';

/** Клип ключами (секунда, поза): поправить фартук — ладонь сверху вниз, дважды. */
export const CLIPS: Record<ClipId, Clip<ClipPose>> = {
  apron: {
    len: 3.4,
    keys: [
      [0, 'rest'],
      [0.7, 'smoothA'],
      [1.25, 'smoothB'],
      [1.6, 'smoothA'],
      [2.2, 'smoothB'],
      [3.4, 'rest'],
    ],
  },
};

/**
 * Живость служанки: поза кадра по жестам `folk.Person` (шаг, реверанс, налить, речь, дверь, взгляд), свой клип (поправить
 * фартук), дыхание и переминание, моргание, взгляд и рот. `gaze` — сдвиг белка.
 */
export class MaidMotion {
  private poses: Record<PoseId, Solved>;
  private clipPoses: Record<ClipPose, Solved>;
  private face: FaceLife;
  private rnd: () => number;
  readonly closeLids: number;
  private play: { clip: ClipId; at: number } | null = null;
  private next = 5;

  constructor(sk: Skeleton, closeLids: number, seed = 6203) {
    this.poses = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, solvePose(sk, v as PoseDef, 1)])) as Record<PoseId, Solved>;
    this.clipPoses = Object.fromEntries(Object.entries(CLIP_POSES).map(([k, v]) => [k, solvePose(sk, v as PoseDef, 1)])) as Record<ClipPose, Solved>;
    this.closeLids = closeLids;
    this.rnd = lifeRng(seed);
    this.face = new FaceLife(closeLids, this.rnd, { reach: [0.0078, 0.004], saccade: [0.0014, 0.0008], jaw: [0.02, 0.075] });
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

  /** Стенд и тесты: снять клип. */
  stop(): void {
    this.play = null;
  }

  /** Стоя без дела — раз в 6–10 с поправляет фартук. */
  private choose(t: number, walk: number, g: Gesture): void {
    if (this.play || t < this.next) return;
    if (walk > 0.1 || g.talk > 0.3 || g.curtsy > 0.1 || g.bow > 0.1 || g.pour > 0.05 || g.reach > 0.1) {
      this.next = t + 1.5;
      return;
    }
    this.start('apron', t);
    this.next = t + CLIPS.apron.len + 6 + this.rnd() * 4;
  }

  /** Поза кадра (`folk.Person` зовёт её вместо `folk.posture`). */
  pose(t: number, phase: number, walk: number, g: Gesture, want: Gesture): { turns: Turns; lift: V3 } {
    this.choose(t, walk, g);
    let s: Solved = this.poses.stand;
    if (walk > 0.001) s = blend(s, this.poses.walk, walk);
    if (g.talk > 0.001) {
      const a = 0.5 + 0.5 * Math.sin(t * 1.9) * Math.sin(t * 0.7 + 1);
      s = blendArm(s, blend(this.poses.talkA, this.poses.talkB, a), 'R', g.talk * (1 - g.curtsy) * (1 - g.pour));
    }
    if (g.reach > 0.001) s = blendArm(s, this.poses.reach, 'R', g.reach);
    // Налить: правая с кувшином вперёд, наклон — поверх; поднос чуть в сторону.
    if (g.pour > 0.001) {
      const pour = blendArm(this.poses.pour, this.poses.tip, 'R', g.tip);
      s = blendArm(blendArm(s, pour, 'R', g.pour), pour, 'L', g.pour);
    }
    // Клип: правая и голова — по ключам, вход и выход — мягко; не поверх шага, речи, реверанса и кувшина над кубком.
    let clipHead: Turns = {};
    if (this.play) {
      const c = CLIPS[this.play.clip];
      const k = t - this.play.at;
      if (k < 0 || k > c.len || walk > 0.3 || g.talk > 0.5 || g.curtsy > 0.2 || g.pour > 0.2 || g.reach > 0.2) this.play = null;
      else {
        const q = sample(c, this.clipPoses, k);
        const env = Math.max(0, Math.min(1, k / 0.35, (c.len - k) / 0.45));
        s = blendArm(s, q, 'R', env);
        clipHead = Object.fromEntries(Object.entries(q.turns).map(([b, v]) => [b, v.map((x) => x * env) as [number, number, number]]));
      }
    }
    const o: Turns = Object.fromEntries(Object.entries(s.turns).map(([k, v]) => [k, [...v] as [number, number, number]]));
    let lift: V3 = [...s.lift] as V3;
    for (const [bone, v] of Object.entries(clipHead)) if (bone === 'head' || bone === 'neck' || bone === 'chest') addT(o, bone, v[0], v[1], v[2]);
    // Дыхание и переминание.
    const breath = Math.sin(t * 1.5);
    addT(o, 'chest', -0.015 * breath);
    addT(o, 'neck', 0.008 * breath);
    const still = 1 - walk;
    const shift = Math.sin(t * 0.35) * still;
    addT(o, 'hips', 0, 0.03 * shift, 0.02 * shift);
    addT(o, 'spine', 0, -0.02 * shift, -0.015 * shift);
    addT(o, 'head', 0.012 * Math.sin(t * 0.43 + 1), 0.02 * Math.sin(t * 0.29), 0.025 * Math.sin(t * 0.23 + 2) * still);
    addT(o, 'skirtS', 0, 0, -0.012 * shift);
    addT(o, 'braid', 0.02 * Math.sin(t * 0.8), 0, 0.015 * Math.sin(t * 0.6));
    // Шаг с подносом: таз качается по шагу, грудь — навстречу (меньше, чем у супруги: поднос ровно), юбка толкается, коса
    // качается.
    if (walk > 0.001) {
      const sw = Math.sin(phase);
      const cw = Math.cos(phase);
      addT(o, 'hips', 0.02 * walk, 0.07 * sw * walk, 0.03 * sw * walk);
      addT(o, 'chest', 0.02 * walk, -0.06 * sw * walk, -0.02 * sw * walk);
      addT(o, 'head', -0.02 * walk, 0.03 * sw * walk, 0);
      addT(o, 'skirtF', -0.08 * Math.abs(sw) * walk - 0.02 * walk, 0, 0.03 * sw * walk);
      addT(o, 'skirtB', 0.06 * walk + 0.025 * cw * walk, 0, -0.02 * sw * walk);
      addT(o, 'skirtS', 0, 0.03 * sw * walk, -0.04 * Math.sin(phase - 0.6) * walk);
      addT(o, 'braid', 0.05 * walk + 0.04 * cw * walk, 0, -0.04 * sw * walk);
      addT(o, 'armR', 0.08 * sw * walk);
      lift = [lift[0], lift[1] + (-Math.abs(cw) * 0.008 + 0.004) * walk, lift[2]];
    }
    // Налить: корпус чуть к кубку, голова — вниз к нему.
    if (g.pour > 0.001) {
      addT(o, 'spine', 0.06 * g.pour);
      addT(o, 'head', 0.22 * g.pour);
    }
    // Речь: голова в такт, плечи живые.
    if (g.talk > 0.001) {
      addT(o, 'head', 0.04 * Math.sin(t * 2.6) * g.talk, 0.05 * Math.sin(t * 1.1) * g.talk, 0.03 * Math.sin(t * 0.9) * g.talk);
      addT(o, 'neck', 0.03 * Math.sin(t * 2.1 + 1) * g.talk);
    }
    // Реверанс (и поклон, если позовут им): опуститься, склонить голову, придержать юбку правой.
    const c = Math.max(g.curtsy, g.bow);
    if (c > 0.001) {
      const cur = blend({ turns: o, lift }, this.poses.curtsy, c);
      Object.assign(o, cur.turns);
      lift = cur.lift;
      addT(o, 'skirtF', -0.05 * c);
      addT(o, 'skirtB', 0.05 * c);
      addT(o, 'braid', 0.1 * c);
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
