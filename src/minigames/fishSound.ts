// Звуки «Рыбалки» — процедурные, на Web Audio (docs/minigames.md, раздел 17.5): тем же образцом, что звук «Охоты»
// (`huntSound.ts`). Ни одного файла; контекст один на игру (`sound/web.openBus`), открывает его «Начать» — жест; рычаг
// один (`soundOn`): выключено по умолчанию, выключили — молчит (тест). Знания о рыбалке у звука нет: что и где
// прозвучало, говорит сцена.
//
// Голоса: свист удилища на забросе, шлепок поплавка и грузила о воду, ложная поклёвка — тихий «тюк», поклёвка —
// «бульк»; подсечка — всплеск и скрип удилища; треск катушки — щелчки собачки, пока рыба забирает леску, и ровное
// тиканье ручки, пока подтягивают; звон лески под натяжением, щелчок обрыва; всплески бьющейся рыбы; плеск вытащенной;
// стук последних секунд. Под всем — вода: журчание реки или накат моря, и дождь, если идёт.
import { soundOn } from '@/sound/settings';
import { openBus } from '@/sound/web';
import { Voices, MINI_VOLUME, placeSound, type Ear } from './miniSound';

export type { Ear };

/** Что звуку нужно от среды. */
export interface FishHost {
  /** Взять выход у контекста. Зовётся ТОЛЬКО из жеста игрока. `false` — звука тут нет. */
  open(): boolean;
  /** Вода под всем: река или море, и дождь; `stop` — замолчать (выход из игры, выключили). */
  bed(sea: boolean, rain: number): void;
  stop(): void;
  /** Свист удилища на забросе: `power` — сила. */
  swish(power: number): void;
  /** Шлепок о воду: `size` — поплавок 0.3, рыба 1. */
  plop(size: number, gain: number, pan: number): void;
  /** Ложная поклёвка — тихий тюк; поклёвка — бульк. */
  nibble(gain: number, pan: number): void;
  /** Щелчок катушки: `drag` — собачка трещит под рыбой; иначе тикает ручка. */
  click(drag: boolean): void;
  /** Леска звенит под натяжением: 0..1; ниже порога — молчит. */
  strain(k: number): void;
  /** Обрыв. */
  snap(): void;
  /** Подсечка: скрип удилища. */
  creak(): void;
  /** Последние секунды. */
  tick(): void;
  /** Вытащил: плеск и, если трофей, — две ноты. */
  caught(trophy: boolean): void;
}

/** Звук рыбалки: без жеста и при выключенном звуке молчит и ничего не открывает. */
export class FishSound {
  private armed = false;

  constructor(
    private host: FishHost,
    private enabled: () => boolean = soundOn,
  ) {}

  /** Жест был — открыть выход и пустить воду. Идемпотентно. */
  arm(sea: boolean, rain: number): void {
    if (this.armed || !this.enabled()) return;
    if (!this.host.open()) return;
    this.armed = true;
    this.host.bed(sea, rain);
  }

  private get live(): boolean {
    return this.armed && this.enabled();
  }

  swish(power: number): void {
    if (this.live) this.host.swish(power);
  }

  plop(size: number, ear: Ear, x: number, z: number): void {
    if (!this.live) return;
    const p = placeSound(ear, x, z);
    if (p.gain >= 0.03) this.host.plop(size, p.gain, p.pan);
  }

  nibble(ear: Ear, x: number, z: number): void {
    if (!this.live) return;
    const p = placeSound(ear, x, z);
    this.host.nibble(Math.max(0.25, p.gain), p.pan);
  }

  click(drag: boolean): void {
    if (this.live) this.host.click(drag);
  }

  strain(k: number): void {
    if (this.live) this.host.strain(k);
  }

  snap(): void {
    if (this.live) this.host.snap();
  }

  creak(): void {
    if (this.live) this.host.creak();
  }

  tick(): void {
    if (this.live) this.host.tick();
  }

  caught(trophy: boolean): void {
    if (this.live) this.host.caught(trophy);
  }

  /** Выход из игры: вода замолкает. Выключили звук — тоже. */
  stop(): void {
    if (this.armed) this.host.stop();
    this.armed = false;
  }
}

// ---------- Голоса ----------

class FishVoice extends Voices implements FishHost {
  private bedNodes: { stop(): void }[] = [];
  private strainGain: GainNode | null = null;

  open(): boolean {
    const out = openBus(MINI_VOLUME);
    if (!out) return false;
    this.attach(out);
    return true;
  }

  /** Вода: река — журчание полосой шума с медленным колыханием; море — накат низким шумом с волной в восемь секунд. */
  bed(sea: boolean, rain: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const at = ctx.currentTime + 0.05;
    const loop = (type: BiquadFilterType, freq: number, q: number, level: number, lfoHz: number, depth: number): void => {
      const n = this.noiseSrc(at, at + 3600);
      const f = this.filter(type, freq, q);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(level, at + 1.5);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoHz;
      const ld = ctx.createGain();
      ld.gain.value = level * depth;
      lfo.connect(ld);
      ld.connect(g.gain);
      n.connect(f);
      f.connect(g);
      g.connect(this.out!);
      lfo.start(at);
      this.bedNodes.push(
        {
          stop: () => {
            try {
              n.stop();
              lfo.stop();
            } catch {
              /* уже остановлен */
            }
            g.disconnect();
          },
        },
      );
    };
    if (sea) {
      loop('lowpass', 520, 0.6, 0.16, 0.12, 0.8);
      loop('bandpass', 1900, 0.5, 0.035, 0.12, 0.9);
    } else {
      loop('bandpass', 700, 0.9, 0.06, 0.31, 0.35);
      loop('bandpass', 2300, 1.4, 0.025, 0.53, 0.5);
    }
    if (rain > 0.05) loop('highpass', 3200, 0.5, 0.07 * Math.min(1, rain * 1.4), 0.07, 0.15);
    // Звон лески — постоянный тон, громкость ведёт `strain`.
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 880;
    const vib = ctx.createOscillator();
    vib.frequency.value = 23;
    const vd = ctx.createGain();
    vd.gain.value = 9;
    vib.connect(vd);
    vd.connect(o.frequency);
    const g = ctx.createGain();
    g.gain.value = 0;
    const f = this.filter('bandpass', 1300, 3);
    o.connect(f);
    f.connect(g);
    g.connect(this.out!);
    o.start(at);
    vib.start(at);
    this.strainGain = g;
    this.bedNodes.push({
      stop: () => {
        try {
          o.stop();
          vib.stop();
        } catch {
          /* уже остановлен */
        }
        g.disconnect();
      },
    });
  }

  stop(): void {
    for (const n of this.bedNodes) n.stop();
    this.bedNodes = [];
    this.strainGain = null;
  }

  swish(power: number): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.005;
    const dest = this.side(0.15, 0.8);
    const n = this.noiseSrc(at, at + 0.4);
    const f = this.filter('bandpass', 900, 2.5);
    f.frequency.setValueAtTime(700, at);
    f.frequency.exponentialRampToValueAtTime(2600, at + 0.12);
    f.frequency.exponentialRampToValueAtTime(1200, at + 0.3);
    const g = this.ctx.createGain();
    this.env(g.gain, at, 0.18 + 0.2 * power, 0.06, 0.25);
    n.connect(f);
    f.connect(g);
    g.connect(dest);
  }

  plop(size: number, gain: number, pan: number): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.005;
    const dest = this.side(pan, 1.2);
    // Бульк: тон, скользящий вверх (пузырь), и шорох брызг — у рыбы крупнее и ниже.
    const f0 = 420 - 220 * size;
    this.tone('sine', f0, f0 * 2.1, at, 0.06 + 0.06 * size, 0.28 * gain, dest);
    this.hiss('lowpass', 1800 + 1600 * (1 - size), 0.6, at, 0.004, 0.12 + 0.28 * size, (0.12 + 0.3 * size) * gain, dest);
    if (size > 0.6) this.hiss('bandpass', 4200, 0.8, at + 0.02, 0.01, 0.35, 0.12 * gain, dest);
  }

  nibble(gain: number, pan: number): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.005;
    const dest = this.side(pan, 0.5);
    this.tone('sine', 620, 980, at, 0.04, 0.14 * gain, dest);
  }

  click(drag: boolean): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.003;
    const dest = this.side(0.3, 0.2);
    // Собачка катушки: сухой щелчок дерева о рог — под рыбой выше и резче, ручка — мягче.
    this.hiss('bandpass', drag ? 3600 : 2200, drag ? 7 : 4, at, 0.0008, drag ? 0.012 : 0.018, drag ? 0.16 : 0.07, dest);
    this.tone('square', drag ? 1900 : 1200, drag ? 1500 : 900, at, 0.008, drag ? 0.035 : 0.02, dest);
  }

  strain(k: number): void {
    const g = this.strainGain;
    if (!g || !this.ctx) return;
    const v = k > 0.55 ? ((k - 0.55) / 0.45) ** 2 * 0.09 : 0;
    g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  snap(): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.003;
    const dest = this.side(0, 0.8);
    this.hiss('highpass', 3000, 0.7, at, 0.0005, 0.05, 0.4, dest);
    this.tone('triangle', 1700, 240, at, 0.18, 0.22, dest);
  }

  creak(): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.005;
    const dest = this.side(0.25, 0.6);
    this.hiss('bandpass', 380, 10, at, 0.03, 0.2, 0.2, dest);
    this.hiss('bandpass', 610, 12, at + 0.08, 0.02, 0.14, 0.12, dest);
  }

  caught(trophy: boolean): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.005;
    const dest = this.side(0, 1.6);
    this.hiss('lowpass', 2400, 0.5, at, 0.01, 0.4, 0.28, dest);
    this.tone('sine', 300, 640, at + 0.02, 0.1, 0.2, dest);
    if (trophy) {
      this.tone('triangle', 523, 520, at + 0.3, 0.26, 0.14, dest);
      this.tone('triangle', 659, 656, at + 0.44, 0.26, 0.14, dest);
      this.tone('triangle', 784, 780, at + 0.58, 0.42, 0.15, dest);
    }
  }
}

/** Звук рыбалки на Web Audio — сцене. */
export const fishSound = (): FishSound => new FishSound(new FishVoice());
