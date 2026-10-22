// Живость кота (ЛЦ-4, docs/characters.md): поверх позы мозга (`cat.catPosture` — шаг, сидит, буханкой, клубком, прыжок,
// трётся) — клипы ключами набора (`kit/motion`: ключи, между ними — плавно), которых у прежнего кота не было:
//
//   · потянуться — встал с лежанки: передние вперёд, грудь к полу, зад вверх, зевок; потом задние назад;
//   · умываться — сидит: лизнуть лапу и провести ею по морде за ухо, дважды;
//   · спать клубком — дыхание боками, голова глубже в хвост, изредка — ухо и кончик хвоста;
//   · подёргивать ушами и кончиком хвоста — само, раз в несколько секунд, во сне чаще.
//
// Глаза: взгляд (`SkinBody.gaze`) идёт к тому, куда хочет мозг (правитель, клубок), раньше головы, с мелкими скачками;
// зрачок — по свету покоев на голове (`drawn`): днём щель, в сумерках вполовину, ночью круглый; на охоте — шире. Моргание —
// мозга (`Cat.step`: веки по `look.eyes`). Поведение, пути и звуки — мозга: живость их не трогает, у неё своя кость.
import type { V3 } from '../../city/geom';
import { LID_CLOSE, TAIL_BONES, type CatState } from '../cat';
import { addT, lifeRng, sample, type Clip, type Solved, type Turns } from '../kit/motion';

/** Ключевые позы клипов — повороты поверх позы мозга (рад) и сдвиг корня (м). */
const S = (turns: Turns, lift: V3 = [0, 0, 0]): Solved => ({ turns, lift });
const both = (o: Turns, bone: string, x: number, y = 0, z = 0): Turns => ({ ...o, [`${bone}L`]: [x, y, z], [`${bone}R`]: [x, -y, -z] });

export const POSES = {
  zero: S({}),
  // Потянуться: передние вперёд, грудь к полу, зад вверх, хвост вверх, морда вперёд, зевок.
  bowDown: S({ ...both(both(both({}, 'arm', -1.05), 'fore', 0.55), 'paw', -0.35), body: [0.3, 0, 0], neck: [-0.35, 0, 0], head: [0.15, 0, 0], tail1: [0.7, 0, 0], jaw: [0.55, 0, 0], lids: [LID_CLOSE * 0.55, 0, 0] }, [0, -0.025, 0.01]),
  bowHold: S({ ...both(both(both({}, 'arm', -1.15), 'fore', 0.6), 'paw', -0.4), body: [0.34, 0, 0], neck: [-0.42, 0, 0], head: [0.1, 0, 0], tail1: [0.85, 0, 0], tail2: [0.2, 0, 0], jaw: [0.8, 0, 0], lids: [LID_CLOSE * 0.8, 0, 0], earL: [0.4, 0, 0], earR: [0.4, 0, 0] }, [0, -0.03, 0.015]),
  backLegs: S({ ...both(both({}, 'thigh', 0.75), 'hock', -0.55), body: [-0.08, 0, 0], neck: [0.1, 0, 0], tail1: [0.3, 0, 0] }, [0, 0.005, 0.01]),
  // Умываться (сидит): правая к пасти — лизнуть; провести по морде к уху.
  lick: S({ armR: [-2.7, 0.5, -0.15], foreR: [1.9, 0, 0], pawR: [0.8, 0, 0], neck: [0.55, 0.1, 0], head: [0.25, -0.2, 0], jaw: [0.22, 0, 0], lids: [LID_CLOSE * 0.45, 0, 0] }),
  wipe: S({ armR: [-2.9, 0.65, -0.3], foreR: [2.2, 0, 0], pawR: [0.9, 0, 0], neck: [0.4, -0.15, 0], head: [0.3, -0.5, -0.35], lids: [LID_CLOSE * 0.85, 0, 0], earR: [0.35, 0, 0] }),
  // Сон клубком: вдох — бока шире (грудь чуть вверх), голова глубже.
  inhale: S({ chest: [-0.035, 0, 0], body: [-0.02, 0, 0], head: [0.05, 0.04, 0] }, [0, 0.0025, 0]),
  exhale: S({ chest: [0.01, 0, 0], head: [0.06, 0.05, 0] }),
  // Ухо назад и вбок — дёрнуть.
  earFlick: S({ earL: [0.35, 0.55, -0.3] }),
  // Кончик хвоста: щелчок вбок и обратно.
  tipFlick: S({ [`tail${TAIL_BONES}`]: [0.15, 0.7, 0], [`tail${TAIL_BONES - 1}`]: [0, 0.22, 0] }),
};
type PoseName = keyof typeof POSES;

/** Клипы ключами: длина и ключи (секунда, поза). */
export const CLIPS: Record<'stretch' | 'groom' | 'sleep' | 'ear' | 'tip', Clip<PoseName>> = {
  stretch: { len: 2.6, keys: [[0, 'zero'], [0.55, 'bowDown'], [1.25, 'bowHold'], [1.6, 'bowDown'], [2.05, 'backLegs'], [2.6, 'zero']] },
  groom: { len: 4.6, keys: [[0, 'zero'], [0.5, 'lick'], [0.9, 'lick'], [1.4, 'wipe'], [1.8, 'lick'], [2.3, 'lick'], [2.8, 'wipe'], [3.3, 'wipe'], [4.0, 'lick'], [4.6, 'zero']] },
  sleep: { len: 3.6, keys: [[0, 'exhale'], [1.5, 'inhale'], [2.0, 'inhale'], [3.6, 'exhale']] },
  ear: { len: 0.42, keys: [[0, 'zero'], [0.09, 'earFlick'], [0.18, 'zero'], [0.27, 'earFlick'], [0.42, 'zero']] },
  tip: { len: 0.7, keys: [[0, 'zero'], [0.18, 'tipFlick'], [0.4, 'zero'], [0.55, 'tipFlick'], [0.7, 'zero']] },
};

/** Ячейки зрачка листа: щель, вполовину, круглый (`figure.SHEET.eye.cx`). */
export type Pupil = 0 | 1 | 2;
/**
 * Освещённость у головы (`kit/light.roomLight`, сырая), ниже которой зрачок шире: щель → вполовину → круглый; с запасом, чтобы
 * не дрожал. Днём у окна покоев свет выше первого порога, ночью при свечах — ниже второго (тест `pet.test.ts`, «зрачок в
 * покоях»).
 */
export const PUPIL_LUX: readonly [number, number] = [1.6, 1.1];
/** Стенд без покоев: свет хозяина (`uTint`, 1 — день) в освещённость — днём щель, ночным светом стенда — круглый. */
export const STAND_LUX = 2.5;

/** Взгляд кота: насколько глаз ведёт голову (м сдвига на рад) и размах мелких скачков, м. */
const REACH = 0.0042;
const SACCADE = 0.0012;

export class CatMotion {
  private rnd: () => number;
  /** Играющий клип: какой, с какой секунды; `side` — ухо (у уха — какое). */
  private play: { clip: keyof typeof CLIPS; at: number; side: 'L' | 'R' }[] = [];
  private next = { ear: 3, tip: 5, groom: 6 };
  private wasRest = false;
  private sacc: [number, number] = [0, 0];
  private saccAt = 0;
  /** Сдвиг белка этого кадра, м: по горизонтали (к +x кота) и вверх. */
  gaze: [number, number] = [0, 0];
  /** Ячейка зрачка этого кадра. */
  pupil: Pupil = 0;
  /** Яркость света на голове прошлого кадра (`drawn`). */
  lux = 1;

  constructor(seed: number) {
    this.rnd = lifeRng(seed);
  }

  /** Играет ли клип сейчас (тестам и стенду). */
  playing(clip: keyof typeof CLIPS): boolean {
    return this.play.some((p) => p.clip === clip);
  }

  /** Стенд: снять все клипы (кадры стенда не текут друг в друга). */
  reset(): void {
    this.play = [];
  }

  /** Стенд и тесты: начать клип сейчас. */
  start(clip: keyof typeof CLIPS, t: number, side: 'L' | 'R' = 'L'): void {
    this.play = this.play.filter((p) => p.clip !== clip);
    this.play.push({ clip, at: t, side });
  }

  live(p: { turns: Turns; lift: V3 }, s: CatState, t: number): void {
    const still = s.look.speed < 0.05;
    // Поднялся с лежанки (клубком или буханкой) и стоит — потянуться, пока мозг не повёл дальше.
    if (this.wasRest && s.mind === 'wander' && still && s.w.stand > 0.5 && !this.playing('stretch')) {
      this.start('stretch', t);
      this.wasRest = false;
    }
    if (s.mind === 'rest' && (s.w.curl > 0.6 || s.w.loaf > 0.6)) this.wasRest = true;
    else if (s.mind !== 'wander' && s.mind !== 'rest') this.wasRest = false;
    // Сидит спокойно — умывается раз в 8–16 с.
    const sitting = s.w.sit > 0.8 && still && (s.mind === 'rest' || s.mind === 'wander');
    if (sitting && t >= this.next.groom && !this.playing('groom')) {
      this.start('groom', t);
      this.next.groom = t + CLIPS.groom.len + 8 + this.rnd() * 8;
    } else if (!sitting && this.next.groom < t + 3) this.next.groom = t + 3 + this.rnd() * 3;
    // Уши и кончик хвоста — сами; во сне чаще.
    if (t >= this.next.ear) {
      this.start('ear', t, this.rnd() < 0.5 ? 'L' : 'R');
      this.next.ear = t + (s.sleeping ? 1.5 : 2.5) + this.rnd() * (s.sleeping ? 4 : 6);
    }
    if (t >= this.next.tip) {
      this.start('tip', t);
      this.next.tip = t + (s.sleeping ? 2.5 : 3) + this.rnd() * 6;
    }
    // Клипы: доля входа и выхода — по краям клипа; клип кончился или мозг повёл в другое дело — сходит на нет.
    this.play = this.play.filter((c) => {
      const len = CLIPS[c.clip].len;
      const k = t - c.at;
      if (k < 0 || k > len) return false;
      if (c.clip === 'stretch' && !still) return false;
      if (c.clip === 'groom' && !sitting) return false;
      const q = sample(CLIPS[c.clip], POSES, k);
      for (const [bone, v] of Object.entries(q.turns)) {
        const name = c.clip === 'ear' && c.side === 'R' && bone === 'earL' ? 'earR' : bone;
        const m = name === 'earR' && c.clip === 'ear' ? -1 : 1;
        addT(p.turns, name, v[0], v[1] * m, v[2] * m);
      }
      for (let i = 0; i < 3; i++) p.lift[i] += q.lift[i];
      return true;
    });
    // Сон: дыхание клипом по кругу.
    if (s.sleeping) {
      const q = sample(CLIPS.sleep, POSES, t % CLIPS.sleep.len);
      for (const [bone, v] of Object.entries(q.turns)) addT(p.turns, bone, v[0], v[1], v[2]);
      p.lift[1] += q.lift[1];
    }
    // Уши к правителю: смотрит — уши вперёд и чуть к нему.
    const ly = Math.max(-1, Math.min(1, s.wantYaw));
    addT(p.turns, 'earL', -0.12, 0.25 * Math.max(0, ly), 0);
    addT(p.turns, 'earR', -0.12, 0.25 * Math.min(0, ly), 0);
    // Взгляд: глаз впереди головы, мелкие скачки.
    if (t >= this.saccAt) {
      this.sacc = [(this.rnd() - 0.5) * SACCADE, (this.rnd() - 0.5) * SACCADE * 0.7];
      this.saccAt = t + 0.6 + this.rnd() * 1.8;
    }
    const lead = Math.max(-0.9, Math.min(0.9, s.wantYaw - s.look.lookYaw));
    const leadP = Math.max(-0.6, Math.min(0.6, s.wantPitch - s.look.lookPitch));
    this.gaze = s.sleeping ? [0, 0] : [Math.sin(lead) * REACH + this.sacc[0], Math.sin(leadP) * REACH * 0.8 + this.sacc[1]];
    // Зрачок по свету; на охоте и в игре — шире.
    const want: Pupil = this.lux > PUPIL_LUX[0] ? 0 : this.lux > PUPIL_LUX[1] ? 1 : 2;
    const hunt = s.mind === 'play' || s.mind === 'fetch' ? 1 : 0;
    const goal = Math.max(want, hunt) as Pupil;
    // Запас: менять ячейку, только когда свет ушёл за порог на 0,08.
    if (goal !== this.pupil) {
      const edge = goal > this.pupil ? PUPIL_LUX[goal - 1] - 0.08 : PUPIL_LUX[this.pupil - 1] + 0.08;
      if (hunt || (goal > this.pupil ? this.lux < edge : this.lux > edge)) this.pupil = goal;
    }
  }
}
