// Звуки жизни покоев (docs/city_v3.md, Г-7; docs/sound.md): стук в дверь, скрип и хлопок двери, шаги людей и кота, мяу и
// мурчание, вино в кубок и глоток, голоса — мурлыканье речи без слов (слова — текстом), тихая музыка ночи. Синтез на Web
// Audio, ни одного файла; атака — не короче 3 мс (П-3: без щелчков). Чистый модуль: его же рисует офлайн-отрисовка
// образцов (`npm run audio:samples`, образец `life`), по ней выставлены уровни (`LIFE_MIX`).
import type { LifeCue, Who } from './life';

/** Уровни на полосе «Эффекты» (образец `life`): стук — заметно, но ниже звона меча; кот и вино — тихо. */
export const LIFE_MIX: Record<LifeCue, number> = {
  knock: 0.31,
  doorOpen: 0.14,
  doorShut: 0.125,
  stepFolk: 0.2,
  stepFolkSoft: 0.075,
  catStep: 0.05,
  catLand: 0.12,
  meow: 0.12,
  pour: 0.1,
  gulp: 0.045,
  night: 0.1,
};
/** Голос: громкость речи без слов — под текстом, а не поверх него. */
export const VOICE_MIX = 0.07;
/** Мурчание у самого уха. */
export const PURR_MIX = 0.12;

const NOISE = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseOf(ctx: BaseAudioContext): AudioBuffer {
  let b = NOISE.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.round(ctx.sampleRate * 1.2), ctx.sampleRate);
    const d = b.getChannelData(0);
    let x = 2463534242;
    for (let i = 0; i < d.length; i++) {
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      d[i] = ((x >>> 0) / 4294967296) * 2 - 1;
    }
    NOISE.set(ctx, b);
  }
  return b;
}

function env(g: AudioParam, at: number, peak: number, a: number, len: number): void {
  g.setValueAtTime(0, at);
  g.linearRampToValueAtTime(peak, at + Math.max(0.003, a));
  g.exponentialRampToValueAtTime(0.0005, at + len);
  g.linearRampToValueAtTime(0, at + len + 0.01);
}

function burst(ctx: BaseAudioContext, out: AudioNode, at: number, type: BiquadFilterType, f: number, q: number, peak: number, a: number, len: number, off: number): void {
  const s = ctx.createBufferSource();
  s.buffer = noiseOf(ctx);
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.frequency.value = f;
  flt.Q.value = q;
  const g = ctx.createGain();
  env(g.gain, at, peak, a, len);
  s.connect(flt).connect(g).connect(out);
  s.start(at, off % 1.0, len + 0.05);
  s.onended = () => {
    s.disconnect();
    flt.disconnect();
    g.disconnect();
  };
}

function tone(ctx: BaseAudioContext, out: AudioNode, at: number, type: OscillatorType, f0: number, f1: number, peak: number, a: number, len: number): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + len);
  const g = ctx.createGain();
  env(g.gain, at, peak, a, len);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + len + 0.05);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
}

/** Скрип петель: пила низко, сквозь две полосы, громкость рвётся (трение — срыв), тон ползёт. */
function hinge(ctx: BaseAudioContext, out: AudioNode, at: number, len: number, f: number, r: () => number): void {
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f, at);
  o.frequency.linearRampToValueAtTime(f * (1.25 + r() * 0.3), at + len * 0.6);
  o.frequency.linearRampToValueAtTime(f * 0.9, at + len);
  const b1 = ctx.createBiquadFilter();
  b1.type = 'bandpass';
  b1.frequency.value = 850 + r() * 250;
  b1.Q.value = 4;
  const b2 = ctx.createBiquadFilter();
  b2.type = 'bandpass';
  b2.frequency.value = 2100 + r() * 400;
  b2.Q.value = 6;
  const e = ctx.createGain();
  e.gain.setValueAtTime(0, at);
  let t = at;
  while (t < at + len) {
    e.gain.linearRampToValueAtTime(0.3 + r() * 0.7, t + 0.006);
    t += 0.025 + r() * 0.035;
    e.gain.linearRampToValueAtTime(0.05 + r() * 0.25, t);
  }
  e.gain.linearRampToValueAtTime(0, t + 0.05);
  o.connect(b1).connect(e);
  o.connect(b2).connect(e);
  e.connect(out);
  o.start(at);
  o.stop(t + 0.1);
  o.onended = () => {
    o.disconnect();
    b1.disconnect();
    b2.disconnect();
    e.disconnect();
  };
}

/** Мяу: «ми-я-у» — пила сквозь две форманты, тон вверх и вниз, лёгкое дрожание. */
function meow(ctx: BaseAudioContext, out: AudioNode, at: number, r: () => number): void {
  const len = 0.55 + r() * 0.25;
  const f = 520 + r() * 120;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f * 0.9, at);
  o.frequency.linearRampToValueAtTime(f * 1.35, at + len * 0.35);
  o.frequency.linearRampToValueAtTime(f * 0.8, at + len);
  const vib = ctx.createOscillator();
  vib.frequency.value = 6.5;
  const vg = ctx.createGain();
  vg.gain.value = f * 0.02;
  vib.connect(vg).connect(o.frequency);
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.Q.value = 5;
  f1.frequency.setValueAtTime(900, at);
  f1.frequency.linearRampToValueAtTime(1500, at + len * 0.4);
  f1.frequency.linearRampToValueAtTime(700, at + len);
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.Q.value = 7;
  f2.frequency.setValueAtTime(2600, at);
  f2.frequency.linearRampToValueAtTime(1900, at + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.9, at + 0.04);
  g.gain.setValueAtTime(0.9, at + len * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0005, at + len);
  g.gain.linearRampToValueAtTime(0, at + len + 0.01);
  o.connect(f1).connect(g);
  o.connect(f2).connect(g);
  g.connect(out);
  o.start(at);
  vib.start(at);
  o.stop(at + len + 0.05);
  vib.stop(at + len + 0.05);
  o.onended = () => {
    o.disconnect();
    vib.disconnect();
    vg.disconnect();
    f1.disconnect();
    f2.disconnect();
    g.disconnect();
  };
}

/** Тихая музыка ночи: аккорды мягко, поверх — щипки струн дорийским ладом; гаснет сама (шесть секунд). */
function nightMusic(ctx: BaseAudioContext, out: AudioNode, at: number, r: () => number): void {
  const D = 146.83;
  const chords = [
    [1, 1.5, 2.0, 2.378],
    [1.122, 1.682, 2.245],
    [0.891, 1.335, 1.782, 2.0],
  ];
  chords.forEach((ch, i) => {
    const t = at + i * 2.0;
    for (const m of ch) tone(ctx, out, t, 'triangle', D * m, D * m, 0.16, 0.6, 2.6);
  });
  // Щипки: d e f a g f e d — колокольчик струны с призвуком октавы.
  const steps = [2, 2.245, 2.378, 3.0, 2.67, 2.378, 2.245, 2];
  steps.forEach((m, i) => {
    const t = at + 0.35 + i * 0.68 + r() * 0.04;
    tone(ctx, out, t, 'sine', D * m * 2, D * m * 2, 0.22, 0.004, 1.3);
    tone(ctx, out, t, 'sine', D * m * 4, D * m * 4, 0.05, 0.004, 0.5);
  });
}

/**
 * Сыграть звук жизни в `at`. `r` — кость звука. Шаги людей — у звуков дел (`cues.step`), здесь — то, чего у дел нет.
 */
export function playLifeCue(ctx: BaseAudioContext, out: AudioNode, cue: LifeCue, at: number, r: () => number): void {
  const g = ctx.createGain();
  g.gain.value = LIFE_MIX[cue];
  g.connect(out);
  let len = 1.2;
  switch (cue) {
    case 'knock':
      // Костяшки о дубовую доску: глухой удар и звонкий призвук доски.
      burst(ctx, g, at, 'lowpass', 260 + r() * 60, 1.2, 1.0, 0.003, 0.09, r());
      burst(ctx, g, at + 0.002, 'bandpass', 950 + r() * 200, 3, 0.55, 0.003, 0.06, r());
      tone(ctx, g, at, 'sine', 165 + r() * 20, 120, 0.4, 0.003, 0.12);
      len = 0.4;
      break;
    case 'doorOpen':
      // Щеколда, потом долгий скрип петель.
      burst(ctx, g, at, 'bandpass', 2400, 4, 0.5, 0.003, 0.04, r());
      tone(ctx, g, at + 0.005, 'sine', 1800, 1700, 0.18, 0.003, 0.06);
      hinge(ctx, g, at + 0.12, 0.85 + r() * 0.2, 78 + r() * 18, r);
      len = 1.4;
      break;
    case 'doorShut':
      hinge(ctx, g, at - 0.45, 0.4, 92 + r() * 12, r);
      // Тяжёлая створка о косяк и щеколда.
      burst(ctx, g, at, 'lowpass', 140, 0.9, 1.0, 0.004, 0.28, r());
      tone(ctx, g, at, 'sine', 72, 58, 0.6, 0.004, 0.32);
      burst(ctx, g, at + 0.07, 'bandpass', 2600, 5, 0.4, 0.003, 0.05, r());
      len = 1.0;
      break;
    case 'catStep':
      burst(ctx, g, at, 'bandpass', 1300 + r() * 600, 1.2, 0.7, 0.008, 0.05, r());
      len = 0.2;
      break;
    case 'catLand':
      burst(ctx, g, at, 'lowpass', 220, 0.8, 1.0, 0.006, 0.12, r());
      burst(ctx, g, at + 0.01, 'bandpass', 1500, 1.5, 0.3, 0.005, 0.06, r());
      len = 0.4;
      break;
    case 'meow':
      meow(ctx, g, at, r);
      len = 1.0;
      break;
    case 'pour': {
      // Струя: журчит полосой шума, пузыри — короткие тоны вразнобой; к концу выше (кубок полнится).
      const t0 = at;
      for (let i = 0; i < 18; i++) {
        const t = t0 + i * 0.1 + r() * 0.05;
        const k = i / 18;
        burst(ctx, g, t, 'bandpass', 700 + k * 900 + r() * 300, 3, 0.5 + r() * 0.4, 0.01, 0.14, r());
        if (r() < 0.6) tone(ctx, g, t + 0.03, 'sine', 380 + k * 500 + r() * 300, 500 + k * 600, 0.12, 0.004, 0.06);
      }
      len = 2.3;
      break;
    }
    case 'gulp':
      tone(ctx, g, at, 'sine', 190, 95, 0.9, 0.006, 0.13);
      burst(ctx, g, at + 0.02, 'lowpass', 500, 1, 0.3, 0.008, 0.1, r());
      tone(ctx, g, at + 0.32, 'sine', 170, 90, 0.6, 0.006, 0.12);
      len = 0.7;
      break;
    case 'night':
      nightMusic(ctx, g, at, r);
      len = 7.5;
      break;
    case 'stepFolk':
    case 'stepFolkSoft':
      // Шаги людей — звуком шага дел (`cues.step`), зовёт звук покоев; здесь — тишина.
      len = 0.1;
      break;
  }
  const done = ctx.createConstantSource?.();
  if (done) {
    done.offset.value = 0;
    done.connect(g);
    done.start(at);
    done.stop(at + len + 0.3);
    done.onended = () => {
      done.disconnect();
      g.disconnect();
    };
  }
}

/** Голос: высота и хрипотца. Старик — низко и с дрожью, служанка — звонко, супруга — ровно и мягко. */
export const VOICE: Record<Who, { f0: number; rough: number; rate: number }> = {
  servant: { f0: 112, rough: 0.35, rate: 4.2 },
  maid: { f0: 232, rough: 0.08, rate: 5.4 },
  wife: { f0: 200, rough: 0.05, rate: 4.6 },
};

/** Гласные — две форманты (а, э, и, о, у). */
const VOWELS = [
  [730, 1090],
  [530, 1840],
  [300, 2200],
  [570, 840],
  [330, 870],
] as const;

/**
 * Речь без слов на `seconds`: слоги — голосовая пила сквозь две форманты гласной, перед частью слогов — шум согласной,
 * между словами — паузы; интонация к концу фразы опускается. Слова — текстом в окне разговора.
 */
export function speak(ctx: BaseAudioContext, out: AudioNode, who: Who, at: number, seconds: number, r: () => number): void {
  const v = VOICE[who];
  const g = ctx.createGain();
  g.gain.value = VOICE_MIX;
  g.connect(out);
  let t = at;
  const end = at + Math.max(0.4, seconds);
  while (t < end - 0.1) {
    const syl = 1 / v.rate + r() * 0.06;
    const k = (t - at) / Math.max(0.5, end - at);
    const f = v.f0 * (1.08 - 0.18 * k) * (0.95 + r() * 0.12);
    const [f1, f2] = VOWELS[Math.floor(r() * VOWELS.length)];
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    o.frequency.linearRampToValueAtTime(f * (0.94 + r() * 0.1), t + syl);
    const a = ctx.createBiquadFilter();
    a.type = 'bandpass';
    a.frequency.value = f1 * (who === 'servant' ? 0.92 : 1.1);
    a.Q.value = 6;
    const b = ctx.createBiquadFilter();
    b.type = 'bandpass';
    b.frequency.value = f2 * (who === 'servant' ? 0.92 : 1.12);
    b.Q.value = 9;
    const e = ctx.createGain();
    env(e.gain, t, 0.7 + r() * 0.3, 0.025, syl * 0.95);
    o.connect(a).connect(e);
    o.connect(b).connect(e);
    e.connect(g);
    // Хрипотца старика — дрожь громкости.
    if (v.rough > 0.1) {
      const tr = ctx.createOscillator();
      tr.frequency.value = 9 + r() * 4;
      const tg = ctx.createGain();
      tg.gain.value = v.rough * 0.4;
      tr.connect(tg).connect(e.gain);
      tr.start(t);
      tr.stop(t + syl + 0.05);
      tr.onended = () => {
        tr.disconnect();
        tg.disconnect();
      };
    }
    if (r() < 0.55) burst(ctx, g, t - 0.012, 'highpass', 2500 + r() * 2500, 0.8, 0.25, 0.004, 0.04, r());
    o.start(t);
    o.stop(t + syl + 0.05);
    o.onended = () => {
      o.disconnect();
      a.disconnect();
      b.disconnect();
      e.disconnect();
    };
    t += syl;
    // Пауза между словами.
    if (r() < 0.28) t += 0.08 + r() * 0.12;
  }
  setTimeoutSafe(() => g.disconnect(), (end - at + 0.6) * 1000, ctx);
}

/** Отпустить узел после звука: в офлайн-отрисовке таймера нет — там узлы живут до конца. */
function setTimeoutSafe(f: () => void, ms: number, ctx: BaseAudioContext): void {
  if (typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext) return;
  setTimeout(f, ms);
}

/**
 * Мурчание: низкое «хрр» — шум сквозь низкую полосу, громкость бьётся 26 раз в секунду, вдох и выдох попеременно.
 * Громкость правит кадр (`set`): кот под рукой — громко, спит у огня — еле слышно.
 */
export class Purr {
  private src: AudioBufferSourceNode;
  private lfo: OscillatorNode;
  private out: GainNode;
  private nodes: AudioNode[];

  constructor(private ctx: BaseAudioContext, dest: AudioNode) {
    this.src = ctx.createBufferSource();
    this.src.buffer = noiseOf(ctx);
    this.src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    lp.Q.value = 1.2;
    const am = ctx.createGain();
    am.gain.value = 0.5;
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 26;
    const depth = ctx.createGain();
    depth.gain.value = 0.5;
    this.lfo.connect(depth).connect(am.gain);
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.src.connect(lp).connect(am).connect(this.out).connect(dest);
    this.src.start();
    this.lfo.start();
    this.nodes = [lp, am, depth, this.out];
  }

  /** Громкость 0…1 и дыхание (вдох — чуть выше и тише). */
  set(level: number, t: number): void {
    const breath = 0.75 + 0.25 * Math.sin(t * 4.2);
    this.lfo.frequency.setTargetAtTime(24 + 4 * Math.sin(t * 4.2), this.ctx.currentTime, 0.1);
    this.out.gain.setTargetAtTime(PURR_MIX * Math.max(0, Math.min(1, level)) * breath, this.ctx.currentTime, 0.12);
  }

  /** Мурчать полной громкостью с `at` на `len` секунд (офлайн-отрисовка образцов: кадра там нет). */
  hold(at: number, len: number): void {
    const g = this.out.gain;
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(PURR_MIX, at + 0.25);
    for (let t = at + 0.25; t < at + len; t += 0.75) g.linearRampToValueAtTime(PURR_MIX * (t % 1.5 < 0.75 ? 0.8 : 1), t + 0.75);
    g.linearRampToValueAtTime(0, at + len + 0.3);
  }

  stop(): void {
    try {
      this.src.stop();
      this.lfo.stop();
    } catch {
      /* уже стоит */
    }
    this.src.disconnect();
    this.lfo.disconnect();
    for (const n of this.nodes) n.disconnect();
  }
}
