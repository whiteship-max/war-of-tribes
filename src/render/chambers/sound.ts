// Звук покоев (docs/city_v3.md, Г-4; сведение — docs/polish.md, П-3): треск камина, ветер у окна, дождь по ставням и
// далёкий город. Процедурный, на Web Audio, тем же образцом, что звук промыслов (`minigames/miniSound.ts`): ни одного
// файла, контекст один на игру — его открыло касание игрока; выход — полоса «Окружение» (`sound/web.openBus`, `amb`).
// Фон самого города идёт как шёл, только глуше (`sound/city.hush('chambers')`): стены башни толстые.
//
// Шаг — от кадра сцены (`update`): треск и щелчки смолы кладутся по сеяной кости, своих часов у звука нет. Свёрнутая
// игра молчит сама: движок гасит выход и усыпляет контекст (П-3, «В свёрнутой игре — тишина»).
import { audioEngine } from '@/sound/door';
import { soundOn } from '@/sound/settings';
import { cueBone, playChamberCue, type ChamberCue } from './cues';

/** Громкость покоев на полосе «Окружение»: вровень с фоном города (П-3: фон около −37 дБ RMS). */
export const CHAMBERS_VOLUME = 0.55;

/** Где ухо: до огня (м) и с какой он стороны (−1 слева, 1 справа), до окна (м); погода у окна. */
export interface ChambersEar {
  fire: number;
  firePan: number;
  window: number;
  wind: number;
  rain: number;
}

/** Громкость огня и ветра по уху — чистая: по ней и тест. */
export function earGains(e: ChambersEar): { fire: number; wind: number; rain: number; town: number } {
  const fire = Math.min(1, 2.4 / Math.max(1, e.fire));
  const near = 1 - Math.min(1, Math.max(0, (e.window - 0.6) / 6));
  const wind = (0.12 + 0.88 * near * near) * (0.35 + 0.65 * Math.min(1, e.wind));
  const rain = Math.min(1, e.rain) * (0.25 + 0.75 * near);
  const town = 0.15 + 0.85 * near;
  return { fire, wind, rain, town };
}

function bone(seed: number): () => number {
  let x = seed >>> 0 || 3;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

/** Шум из своего сида: случай устройства звуку не нужен. */
function noise(ctx: BaseAudioContext, seconds: number, seed: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = b.getChannelData(0);
  const r = bone(seed);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return b;
}

export class ChambersSound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  /** Звуки дел — полосой «Эффекты» (шаги, кресло, постель, меч). */
  private fx: GainNode | null = null;
  private cueR = cueBone(1209);
  private nodes: AudioNode[] = [];
  private srcs: AudioBufferSourceNode[] = [];
  private fireGain: GainNode | null = null;
  private firePan: StereoPannerNode | null = null;
  private windGain: GainNode | null = null;
  private windBand: BiquadFilterNode | null = null;
  private whistle: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private cityGain: GainNode | null = null;
  private crackleBuf: AudioBuffer | null = null;
  private r = bone(1203);
  private t = 0;
  private nextCrackle = 0.3;
  private nextPop = 2;
  private gust = 0;
  private stopped = false;
  private fireK = 0;

  /** Открыть выход и завести слои. Звук выключен или движка нет — молчит. */
  async start(): Promise<void> {
    if (typeof window === 'undefined' || !soundOn()) return;
    const web = await audioEngine().catch(() => null);
    if (!web || this.stopped) return;
    const out = web.openBus(CHAMBERS_VOLUME, 'amb');
    if (!out) return;
    const ctx = out.context as AudioContext;
    this.ctx = ctx;
    this.out = out;
    this.fx = web.openBus(1, 'fx');
    const loop = (buf: AudioBuffer): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      this.srcs.push(s);
      return s;
    };
    const n = noise(ctx, 3, 1204);
    this.crackleBuf = noise(ctx, 0.25, 1205);
    // Огонь: низкий гул пламени и треск поверх (`update`), сторона — к огню.
    const fg = ctx.createGain();
    fg.gain.value = 0;
    const pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (pan) {
      fg.connect(pan);
      pan.connect(out);
    } else fg.connect(out);
    const roar = loop(n);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const roarG = ctx.createGain();
    roarG.gain.value = 0.55;
    roar.connect(lp).connect(roarG).connect(fg);
    this.fireGain = fg;
    this.firePan = pan;
    // Ветер у окна: шум полосой, порывы двигают полосу и громкость; в порыв — тихий посвист в щели ставни.
    const wg = ctx.createGain();
    wg.gain.value = 0;
    wg.connect(out);
    const wind = loop(n);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 420;
    band.Q.value = 0.7;
    wind.playbackRate.value = 0.83;
    wind.connect(band).connect(wg);
    const wh = ctx.createGain();
    wh.gain.value = 0;
    const whBand = ctx.createBiquadFilter();
    whBand.type = 'bandpass';
    whBand.frequency.value = 1240;
    whBand.Q.value = 9;
    band.connect(whBand).connect(wh).connect(wg);
    this.windGain = wg;
    this.windBand = band;
    this.whistle = wh;
    // Дождь по ставням и откосу: верхний шум, глуше в глубине покоев.
    const rg = ctx.createGain();
    rg.gain.value = 0;
    rg.connect(out);
    const rain = loop(n);
    rain.playbackRate.value = 1.31;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1700;
    const rlp = ctx.createBiquadFilter();
    rlp.type = 'lowpass';
    rlp.frequency.value = 5200;
    rain.connect(hp).connect(rlp).connect(rg);
    this.rainGain = rg;
    // Далёкий город: гул под стенами — ниже и тише своего фона, у окна слышнее.
    const cg = ctx.createGain();
    cg.gain.value = 0;
    cg.connect(out);
    const city = loop(n);
    city.playbackRate.value = 0.61;
    const clp = ctx.createBiquadFilter();
    clp.type = 'lowpass';
    clp.frequency.value = 240;
    city.connect(clp).connect(cg);
    this.cityGain = cg;
    this.nodes.push(fg, lp, roarG, wg, band, wh, whBand, rg, hp, rlp, cg, clp);
    if (pan) this.nodes.push(pan);
    for (const s of this.srcs) s.start();
  }

  /** Звук дела: шаг, скрип кресла, шорох постели, меч, взял и положил (`cues.ts`). */
  cue(c: ChamberCue): void {
    const ctx = this.ctx;
    if (!ctx || !this.fx) return;
    playChamberCue(ctx, this.fx, c, ctx.currentTime + 0.01, this.cueR);
  }

  /** Шаг кадра: громкости по уху, порывы ветра, треск огня. */
  update(dt: number, e: ChambersEar): void {
    const ctx = this.ctx;
    if (!ctx || !this.out) return;
    this.t += dt;
    const g = earGains(e);
    const now = ctx.currentTime;
    // Огонь дышит: гул то сильнее, то слабее.
    this.fireK = g.fire * (0.8 + 0.2 * Math.sin(this.t * 0.7) * Math.sin(this.t * 1.9 + 1));
    this.fireGain?.gain.setTargetAtTime(this.fireK * 0.5, now, 0.15);
    this.firePan?.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, e.firePan * 0.8)), now, 0.2);
    // Порыв: медленная волна и редкие наскоки.
    this.gust += dt * (0.18 + e.wind * 0.3);
    const gust = 0.55 + 0.3 * Math.sin(this.gust) + 0.15 * Math.sin(this.gust * 2.7 + 1.3);
    this.windGain?.gain.setTargetAtTime(g.wind * gust * 0.7, now, 0.4);
    this.windBand?.frequency.setTargetAtTime(330 + gust * 380, now, 0.5);
    this.whistle?.gain.setTargetAtTime(Math.max(0, gust - 0.75) * 1.6 * e.wind, now, 0.3);
    this.rainGain?.gain.setTargetAtTime(g.rain * 0.45, now, 0.6);
    this.cityGain?.gain.setTargetAtTime(g.town * 0.12, now, 0.6);
    // Треск: частый мелкий, реже — щелчок смолы. Что выпало на прошедший шаг, ложится на следующий тем же порядком:
    // назад во времени звук не кладётся, а в редкий кадр — не больше шести щелчков, остальное пропадает.
    let n = 0;
    while (this.t >= this.nextCrackle) {
      const lag = this.t - this.nextCrackle;
      if (n++ < 6) this.crackle(now + 0.03 + Math.max(0, dt - lag), 0.25 + this.r() * 0.75, false);
      this.nextCrackle += 0.04 + this.r() * this.r() * 0.45;
    }
    while (this.t >= this.nextPop) {
      this.crackle(now + 0.03, 1, true);
      this.nextPop += 1.8 + this.r() * 5;
    }
  }

  private crackle(at: number, k: number, pop: boolean): void {
    const ctx = this.ctx;
    const buf = this.crackleBuf;
    const fg = this.fireGain;
    if (!ctx || !buf || !fg || this.fireK < 0.02) return;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = pop ? 650 + this.r() * 400 : 1800 + this.r() * 2600;
    f.Q.value = pop ? 2 : 1.2;
    const g = ctx.createGain();
    const len = pop ? 0.07 : 0.012 + this.r() * 0.025;
    // Атака не короче 3 мс — без щелчков (П-3).
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(k * (pop ? 1.1 : 0.55), at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0008, at + len);
    s.connect(f).connect(g).connect(fg);
    s.start(at, this.r() * 0.15, len + 0.02);
    s.onended = () => {
      s.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }

  stop(): void {
    this.stopped = true;
    const ctx = this.ctx;
    if (this.out && ctx) {
      this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      const out = this.out;
      const fx = this.fx;
      fx?.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      const srcs = this.srcs;
      const nodes = this.nodes;
      // Затихает, а не обрывается: узлы отпускаются после спада.
      setTimeout(() => {
        for (const s of srcs) {
          try {
            s.stop();
          } catch {
            /* уже стоит */
          }
          s.disconnect();
        }
        for (const n of nodes) n.disconnect();
        out.disconnect();
        fx?.disconnect();
      }, 700);
    }
    this.ctx = null;
    this.out = null;
    this.fx = null;
  }
}
