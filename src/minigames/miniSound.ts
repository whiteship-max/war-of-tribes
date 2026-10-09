// Звуки «Ягод» и «Скота» и общие голоса промыслов — процедурные, на Web Audio (docs/minigames.md, раздел 16.2).
//
// Тем же образцом, что звук «Охоты» (`huntSound.ts`): ни одного файла, контекст один на игру (`sound/web.openBus`),
// открывает его «Начать» — жест; рычаг один (`soundOn`), выключили — молчит. Знания об игре у звука нет: что и когда
// прозвучало, говорит сцена.
//
// Голоса — короткие графы узлов, каждый сам себя останавливает: шорох листвы и мягкий щелчок ягоды в корзине (чем больше
// снято за раз, тем выше и ярче), глухой стук зря сорванного, охапка сена, хруст жвачки и голос животного — блеяние
// овцы, козы и мычание коровы, две ноты сытости, сухой стук последних секунд.
import { soundOn } from '@/sound/settings';
import { openBus } from '@/sound/web';
import type { BeastKind } from './herd';

/** Громкость промыслов: та же, что у охоты (`huntSound.HUNT_VOLUME`) — звуки дела, а не фон. */
export const MINI_VOLUME = 0.6;

/** Ухо игрока: где стоит и куда у него правая рука (единичный вектор по земле). Общее у охоты и рыбалки. */
export interface Ear {
  x: number;
  z: number;
  rx: number;
  rz: number;
}

/** На этом расстоянии звук в полную силу; дальше — тише обратно расстоянию. */
export const SOUND_NEAR = 8;

/** Громкость и сторона звука в точке для уха. Чистая — по ней и тест (`huntSound.test.ts`). */
export function placeSound(ear: Ear, x: number, z: number): { gain: number; pan: number } {
  const dx = x - ear.x;
  const dz = z - ear.z;
  const d = Math.hypot(dx, dz);
  const gain = Math.min(1, SOUND_NEAR / Math.max(1, d));
  const pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * ear.rx + dz * ear.rz) / d)) * 0.75 : 0;
  return { gain, pan };
}

/** Шум из своего сида: случай устройства звуку не нужен (`Math.random` в игре нет нигде). */
export function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = b.getChannelData(0);
  let x = 0x1f2e3d4c;
  for (let i = 0; i < d.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    d[i] = ((x >>> 0) / 4294967296) * 2 - 1;
  }
  return b;
}

/** Мастерская голосов: выход, сторона, огибающая, шум, фильтр и тон. Выход ей даёт тот, кто открыл его жестом. */
export class Voices {
  protected ctx: BaseAudioContext | null = null;
  protected out: GainNode | null = null;
  protected noise: AudioBuffer | null = null;
  private n = 0;

  protected attach(out: GainNode): void {
    this.out = out;
    this.ctx = out.context;
    this.noise = noiseBuffer(this.ctx);
  }

  /** Сторона: −1 левое ухо, 1 правое. Старый вебвью без неё — посередине. Отпускается вместе со звуком. */
  protected side(pan: number, life: number): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    let p: StereoPannerNode | null = null;
    if (typeof ctx.createStereoPanner === 'function') {
      p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.out!);
    } else g.connect(this.out!);
    setTimeout(() => {
      g.disconnect();
      p?.disconnect();
    }, life * 1000);
    return g;
  }

  protected env(g: AudioParam, at: number, peak: number, attack: number, release: number): void {
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(peak, at + attack);
    g.exponentialRampToValueAtTime(0.0001, at + attack + release);
  }

  protected noiseSrc(at: number, stop: number): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(at, ((this.n++ * 0.137) % 0.8) + 0.05);
    s.stop(stop);
    return s;
  }

  protected filter(type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** Тон с огибающей и скольжением высоты `f0 → f1` за `dur`. */
  protected tone(type: OscillatorType, f0: number, f1: number, at: number, dur: number, peak: number, dest: AudioNode): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = this.ctx!.createGain();
    this.env(g.gain, at, peak, Math.min(0.02, dur * 0.2), dur);
    o.connect(g);
    g.connect(dest);
    o.start(at);
    o.stop(at + dur + 0.05);
    return o;
  }

  /** Шум сквозь фильтр с огибающей: шорох, хруст, стук. */
  protected hiss(type: BiquadFilterType, freq: number, q: number, at: number, attack: number, release: number, peak: number, dest: AudioNode): void {
    const n = this.noiseSrc(at, at + attack + release + 0.05);
    const f = this.filter(type, freq, q);
    const g = this.ctx!.createGain();
    this.env(g.gain, at, peak, attack, release);
    n.connect(f);
    f.connect(g);
    g.connect(dest);
  }

  /** Сухой стук последних секунд — деревом о дерево. */
  tick(): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.005;
    const dest = this.side(0, 0.4);
    this.tone('triangle', 1250, 900, at, 0.05, 0.16, dest);
    this.hiss('bandpass', 2400, 3, at, 0.001, 0.025, 0.08, dest);
  }
}

/** Что звучит в «Ягодах» и «Скоте». */
export interface FieldHost {
  /** Взять выход у контекста. Зовётся ТОЛЬКО из жеста игрока. `false` — звука тут нет. */
  open(): boolean;
  /** Куст обобран: сколько спелых легло в корзину и сколько зелёных пропало. */
  pick(ripe: number, green: number): void;
  /** Охапка из стога. */
  take(): void;
  /** Животное ест; `sated` — наелось. */
  feed(kind: BeastKind, sated: boolean): void;
  /** Последние секунды. */
  tick(): void;
}

/** Звук «Ягод» и «Скота»: без жеста и при выключенном звуке молчит и ничего не открывает. */
export class FieldSound {
  private armed = false;

  constructor(
    private host: FieldHost,
    private enabled: () => boolean = soundOn,
  ) {}

  /** Жест был — открыть выход. Идемпотентно. */
  arm(): void {
    if (this.armed || !this.enabled()) return;
    if (!this.host.open()) return;
    this.armed = true;
  }

  private get live(): boolean {
    return this.armed && this.enabled();
  }

  pick(ripe: number, green: number): void {
    if (this.live) this.host.pick(ripe, green);
  }

  take(): void {
    if (this.live) this.host.take();
  }

  feed(kind: BeastKind, sated: boolean): void {
    if (this.live) this.host.feed(kind, sated);
  }

  tick(): void {
    if (this.live) this.host.tick();
  }
}

/** Голос животного: высота, скольжение, дрожь голоса и форманта — блеет, мекает или мычит. */
const CALL: Record<BeastKind, { f0: number; f1: number; dur: number; vib: number; rate: number; formant: number; peak: number }> = {
  sheep: { f0: 250, f1: 215, dur: 0.62, vib: 0.05, rate: 7.5, formant: 950, peak: 0.16 },
  goat: { f0: 360, f1: 300, dur: 0.48, vib: 0.08, rate: 11, formant: 1300, peak: 0.13 },
  cow: { f0: 118, f1: 96, dur: 1.05, vib: 0.012, rate: 4, formant: 520, peak: 0.24 },
};

class FieldVoice extends Voices implements FieldHost {
  open(): boolean {
    const out = openBus(MINI_VOLUME);
    if (!out) return false;
    this.attach(out);
    return true;
  }

  pick(ripe: number, green: number): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.005;
    const dest = this.side(0.15, 1.4);
    // Листва: шорох куста под рукой.
    this.hiss('bandpass', 3200, 0.9, at, 0.02, 0.18, 0.2, dest);
    if (ripe > 0) {
      // Ягоды в корзину: мягкие щелчки, тем выше, чем богаче куст, — горсть звенит, одна ягода стукает.
      const notes = Math.min(4, 1 + Math.floor(ripe / 3));
      for (let k = 0; k < notes; k++) {
        const t = at + 0.06 + k * 0.07;
        this.tone('sine', 560 + k * 140 + ripe * 6, 330 + k * 90, t, 0.09, 0.2, dest);
      }
    } else {
      // Всё зелёное — глухо: зря сорвано.
      this.tone('triangle', 190, 120, at + 0.05, 0.16, 0.18, dest);
    }
    if (green > 0 && ripe > 0) this.tone('triangle', 170, 115, at + 0.06 + Math.min(4, 1 + Math.floor(ripe / 3)) * 0.07, 0.12, 0.08, dest);
  }

  take(): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.005;
    const dest = this.side(0, 0.8);
    // Сено: сухой шорох и треск стеблей.
    this.hiss('bandpass', 1500, 0.7, at, 0.03, 0.32, 0.28, dest);
    this.hiss('highpass', 4200, 0.7, at + 0.04, 0.01, 0.12, 0.08, dest);
  }

  feed(kind: BeastKind, sated: boolean): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.005;
    const dest = this.side(0, 2.2);
    // Жвачка: три хруста.
    for (let k = 0; k < 3; k++) this.hiss('lowpass', 900, 0.8, at + k * 0.16, 0.01, 0.07, 0.16, dest);
    // Голос: пила с дрожью сквозь форманту — блеет овца, мекает коза, мычит корова.
    const c = CALL[kind];
    const t = at + 0.42;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(c.f0, t);
    o.frequency.exponentialRampToValueAtTime(c.f1, t + c.dur);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = c.rate;
    const depth = this.ctx.createGain();
    depth.gain.value = c.f0 * c.vib;
    lfo.connect(depth);
    depth.connect(o.frequency);
    const f = this.filter('bandpass', c.formant, 2.2);
    const low = this.filter('lowpass', c.formant * 2.4, 0.7);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(c.peak, t + 0.06);
    g.gain.setValueAtTime(c.peak, t + c.dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + c.dur);
    o.connect(f);
    f.connect(low);
    low.connect(g);
    g.connect(dest);
    o.start(t);
    lfo.start(t);
    o.stop(t + c.dur + 0.05);
    lfo.stop(t + c.dur + 0.05);
    if (sated) {
      // Сыто: две ноты квинтой вверх — как «стройка готова» города, только тише.
      this.tone('triangle', 523, 520, t + c.dur * 0.6, 0.22, 0.12, dest);
      this.tone('triangle', 784, 780, t + c.dur * 0.6 + 0.14, 0.32, 0.12, dest);
    }
  }
}

/** Звук «Ягод» и «Скота» на Web Audio — сцене. */
export const fieldSound = (): FieldSound => new FieldSound(new FieldVoice());
