// Звуки «Охоты» — процедурные, на Web Audio (docs/minigames.md, раздел 13): тетива, свист стрелы, стук — в землю,
// в ствол или в зверя, — и топот бегущих оленей.
//
// **ЗВУК ПРОЦЕДУРНЫЙ, КАК У ВОЯ И У РОЛИКА БОЯ** (`sound/howl.ts`, `sound/battlefx.ts`): ни одного чужого файла, ни одной
// записи — горстка узлов на звук вместо дорожек. Лицензия одна — наша.
//
// **КОНТЕКСТ ОДИН НА ВСЮ ИГРУ** и живёт в `sound/web.ts`: сюда приходит только выход с громкостью (`openBus`). Открывает
// его нажатие «Начать» (`arm` — синхронно, из жеста: в вебвью Телеграма без жеста звук не заиграет). Модуль едет куском
// охоты, а не первой загрузкой: его импортирует только `huntPlay.ts`.
//
// **РЫЧАГ ОДИН.** Включён ли звук — та же настройка, что у музыки, воя и боя (`soundOn`): по умолчанию выключено.
// Выключен — машинка не открывает ничего и молчит (тест).
//
// Громкость — по уху охотника: ближе — громче, сбоку — в своё ухо (`placeSound`). Своего знания об охоте у звука нет:
// что и где прозвучало, говорит сцена.
import { soundOn } from '@/sound/settings';
import { openBus } from '@/sound/web';

/** Во что воткнулась стрела — у каждого свой стук. */
export type ThudKind = 'ground' | 'wood' | 'deer';

/** Что звуку нужно от среды. */
export interface HuntHost {
  /** Взять выход у контекста. Зовётся ТОЛЬКО из жеста игрока. `false` — звука тут нет. */
  open(): boolean;
  /** Тетива: `draw` — насколько была натянута (0..1). */
  twang(draw: number): void;
  /** Свист стрелы: сколько секунд летит. */
  whistle(dur: number, gain: number, pan: number): void;
  /** Стук воткнувшейся стрелы. */
  thud(kind: ThudKind, gain: number, pan: number): void;
  /** Удар копыта. */
  hoof(gain: number, pan: number): void;
}

/** Ухо охотника: где стоит и куда у него правая рука (единичный вектор по земле). */
export interface Ear {
  x: number;
  z: number;
  rx: number;
  rz: number;
}

/** Громкость звуков охоты: под музыкой деревни (0.38) не тише её — это звуки дела, а не фон. */
export const HUNT_VOLUME = 0.6;
/** На этом расстоянии звук в полную силу; дальше — тише обратно расстоянию. */
export const HUNT_NEAR = 8;

/** Громкость и сторона звука в точке для уха. Чистая — по ней и тест. */
export function placeSound(ear: Ear, x: number, z: number): { gain: number; pan: number } {
  const dx = x - ear.x;
  const dz = z - ear.z;
  const d = Math.hypot(dx, dz);
  const gain = Math.min(1, HUNT_NEAR / Math.max(1, d));
  const pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * ear.rx + dz * ear.rz) / d)) * 0.75 : 0;
  return { gain, pan };
}

/** Звуки охоты: без жеста и при выключенном звуке молчит и ничего не открывает. */
export class HuntSound {
  private armed = false;

  constructor(
    private host: HuntHost,
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

  twang(draw: number): void {
    if (this.live) this.host.twang(draw);
  }

  whistle(dur: number, ear: Ear, x: number, z: number): void {
    if (!this.live) return;
    const p = placeSound(ear, x, z);
    this.host.whistle(dur, p.gain, p.pan);
  }

  thud(kind: ThudKind, ear: Ear, x: number, z: number): void {
    if (!this.live) return;
    const p = placeSound(ear, x, z);
    if (p.gain >= 0.03) this.host.thud(kind, p.gain, p.pan);
  }

  hoof(ear: Ear, x: number, z: number): void {
    if (!this.live) return;
    const p = placeSound(ear, x, z);
    if (p.gain >= 0.03) this.host.hoof(p.gain * 0.8, p.pan);
  }
}

// ---------- Голоса ----------

/** Шум из своего сида: случай устройства звуку не нужен (`Math.random` в игре нет нигде). */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
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

/** Голоса на Web Audio: граф узлов на звук; каждый живёт доли секунды и сам себя останавливает. */
class HuntVoice implements HuntHost {
  private ctx: BaseAudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private n = 0;

  open(): boolean {
    const out = openBus(HUNT_VOLUME);
    if (!out) return false;
    this.out = out;
    this.ctx = out.context;
    this.noise = noiseBuffer(this.ctx);
    return true;
  }

  /** Сторона: −1 левое ухо, 1 правое. Старый вебвью без неё — посередине. Отпускается вместе со звуком. */
  private side(pan: number, life: number): AudioNode {
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

  private env(g: AudioParam, at: number, peak: number, attack: number, release: number): void {
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(peak, at + attack);
    g.exponentialRampToValueAtTime(0.0001, at + attack + release);
  }

  private noiseSrc(at: number, stop: number): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(at, ((this.n++ * 0.137) % 0.8) + 0.05);
    s.stop(stop);
    return s;
  }

  private filter(type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    return f;
  }

  /** Тетива: щелчок жилы о кожу на руке и низкий гул отпущенной дуги. Чем сильнее натянута, тем звонче и громче. */
  twang(draw: number): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.005;
    const dest = this.side(0, 1);
    const k = 0.4 + 0.6 * draw;
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(110 + 40 * draw, at);
    o.frequency.exponentialRampToValueAtTime(72, at + 0.3);
    const og = this.ctx.createGain();
    this.env(og.gain, at, 0.55 * k, 0.003, 0.32);
    o.connect(og);
    og.connect(dest);
    o.start(at);
    o.stop(at + 0.45);
    const n = this.noiseSrc(at, at + 0.08);
    const f = this.filter('bandpass', 2600, 1.4);
    const ng = this.ctx.createGain();
    this.env(ng.gain, at, 0.35 * k, 0.001, 0.05);
    n.connect(f);
    f.connect(ng);
    ng.connect(dest);
  }

  /** Свист: полоса шума, уходящая вниз по ходу полёта, — стрела удаляется. */
  whistle(dur: number, gain: number, pan: number): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.01;
    const len = Math.max(0.15, Math.min(1.4, dur));
    const dest = this.side(pan * 0.5, len + 0.5);
    const n = this.noiseSrc(at, at + len + 0.05);
    const f = this.filter('bandpass', 2400, 6);
    f.frequency.setValueAtTime(2400, at);
    f.frequency.exponentialRampToValueAtTime(1300, at + len);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.22 * Math.max(0.4, gain), at + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    n.connect(f);
    f.connect(g);
    g.connect(dest);
  }

  /** Стук: в землю — глухо, в ствол — сухой стук дерева, в зверя — тупой мягкий удар. */
  thud(kind: ThudKind, gain: number, pan: number): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.005;
    const dest = this.side(pan, 1);
    const tone = { ground: [95, 48, 0.12], wood: [240, 160, 0.09], deer: [80, 45, 0.18] }[kind];
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(tone[0], at);
    o.frequency.exponentialRampToValueAtTime(tone[1], at + tone[2]);
    const og = this.ctx.createGain();
    this.env(og.gain, at, 0.6 * gain, 0.003, tone[2] + 0.08);
    o.connect(og);
    og.connect(dest);
    o.start(at);
    o.stop(at + tone[2] + 0.2);
    const n = this.noiseSrc(at, at + 0.15);
    const f = kind === 'wood' ? this.filter('bandpass', 1100, 5) : this.filter('lowpass', kind === 'deer' ? 260 : 520, 0.7);
    const ng = this.ctx.createGain();
    this.env(ng.gain, at, (kind === 'wood' ? 0.5 : 0.35) * gain, 0.002, kind === 'wood' ? 0.06 : 0.1);
    n.connect(f);
    f.connect(ng);
    ng.connect(dest);
  }

  /** Копыто: короткий низкий удар о дёрн и шорох травы. */
  hoof(gain: number, pan: number): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + 0.005;
    const dest = this.side(pan, 0.6);
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(120, at);
    o.frequency.exponentialRampToValueAtTime(55, at + 0.07);
    const og = this.ctx.createGain();
    this.env(og.gain, at, 0.45 * gain, 0.002, 0.09);
    o.connect(og);
    og.connect(dest);
    o.start(at);
    o.stop(at + 0.15);
    const n = this.noiseSrc(at, at + 0.08);
    const f = this.filter('lowpass', 700, 0.7);
    const ng = this.ctx.createGain();
    this.env(ng.gain, at, 0.18 * gain, 0.002, 0.05);
    n.connect(f);
    f.connect(ng);
    ng.connect(dest);
  }
}

/** Звук охоты на Web Audio — сцене. */
export const huntSound = (): HuntSound => new HuntSound(new HuntVoice());
