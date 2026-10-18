// Звуки дел в покоях (docs/city_v3.md, Г-6; docs/sound.md): шаг по доскам и по ковру, скрип кресла, шорох постели,
// звон меча, взял и положил безделушку; петли и крышка сундука (Г-9). Синтез на Web Audio, ни одного файла: шум из своего
// сида, осцилляторы и фильтры.
// Чистый модуль без игры — его же рисует офлайн-отрисовка образцов (`npm run audio:samples`, образец `chambers`), по ней
// выставлены уровни (`CUE_MIX`). Атака каждого звука — не короче 3 мс (П-3: без щелчков).

/** Звук дела. */
export type ChamberCue = 'step' | 'stepSoft' | 'creak' | 'rustle' | 'ring' | 'take' | 'put' | 'hinge' | 'lidShut';

/**
 * Уровни звуков дел на полосе «Эффекты» — офлайн-отрисовкой (образец `chambers`, docs/city_v3.md, Г-6, «Звук»): шаг по
 * доскам заметно тише касания кнопки, по ковру — ещё тише; звон меча — громче всего, но ниже рога тревоги.
 */
export const CUE_MIX: Record<ChamberCue, number> = { step: 0.27, stepSoft: 0.1, creak: 0.14, rustle: 0.088, ring: 0.11, take: 0.11, put: 0.16, hinge: 0.12, lidShut: 0.2 };

function bone(seed: number): () => number {
  let x = seed >>> 0 || 3;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

const NOISE = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Белый шум на полсекунды — один на контекст. */
function noiseOf(ctx: BaseAudioContext): AudioBuffer {
  let b = NOISE.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.6), ctx.sampleRate);
    const d = b.getChannelData(0);
    const r = bone(1207);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    NOISE.set(ctx, b);
  }
  return b;
}

/** Огибающая: атака `a` (не короче 3 мс), спад до тишины за `len`. */
function env(g: GainNode, at: number, peak: number, a: number, len: number): void {
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + Math.max(0.003, a));
  g.gain.exponentialRampToValueAtTime(0.0005, at + len);
  g.gain.linearRampToValueAtTime(0, at + len + 0.01);
}

/** Шум сквозь фильтр с огибающей. */
function burst(ctx: BaseAudioContext, out: AudioNode, at: number, type: BiquadFilterType, f: number, q: number, peak: number, a: number, len: number, offset: number): void {
  const s = ctx.createBufferSource();
  s.buffer = noiseOf(ctx);
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.frequency.value = f;
  flt.Q.value = q;
  const g = ctx.createGain();
  env(g, at, peak, a, len);
  s.connect(flt).connect(g).connect(out);
  s.start(at, offset % 0.4, len + 0.05);
  s.onended = () => {
    s.disconnect();
    flt.disconnect();
    g.disconnect();
  };
}

/** Тон с огибающей и, если надо, скольжением. */
function tone(ctx: BaseAudioContext, out: AudioNode, at: number, type: OscillatorType, f0: number, f1: number, peak: number, a: number, len: number): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + len);
  const g = ctx.createGain();
  env(g, at, peak, a, len);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + len + 0.05);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
}

/**
 * Сыграть звук дела в `at`. `r` — кость звука (свой сид): шаги не повторяют друг друга один в один.
 *
 *   · шаг по доскам — глухой удар каблука (низ шума) и стук доски (середина), изредка — скрип половицы;
 *   · по ковру — только глухой низ, тише;
 *   · скрип кресла — дерево трётся о дерево: пила с дрожью, сквозь две полосы, с соскальзыванием тона;
 *   · шорох постели — ткань: верхний шум с неровной громкостью;
 *   · звон меча — шорох стали о колышки и долгий неровный звон (призвуки не кратны друг другу);
 *   · взял и положил — короткий стук по дереву с призвуком.
 */
export function playChamberCue(ctx: BaseAudioContext, out: AudioNode, cue: ChamberCue, at: number, r: () => number): void {
  const g = ctx.createGain();
  g.gain.value = CUE_MIX[cue];
  g.connect(out);
  const k = 0.85 + r() * 0.3;
  switch (cue) {
    case 'step':
      burst(ctx, g, at, 'lowpass', 180 + r() * 60, 0.9, 1.0 * k, 0.004, 0.09, r());
      burst(ctx, g, at + 0.006, 'bandpass', 700 + r() * 500, 1.6, 0.42 * k, 0.003, 0.05, r());
      if (r() < 0.18) tone(ctx, g, at + 0.05, 'sawtooth', 240 + r() * 80, 200 + r() * 50, 0.05, 0.02, 0.16);
      break;
    case 'stepSoft':
      burst(ctx, g, at, 'lowpass', 140 + r() * 40, 0.7, 1.0 * k, 0.012, 0.12, r());
      burst(ctx, g, at + 0.01, 'bandpass', 2400, 0.8, 0.12 * k, 0.01, 0.08, r());
      break;
    case 'creak': {
      // Трение дерева: пила 90–130 Гц, громкость дрожит (зацеп — срыв), тон сползает.
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f = 95 + r() * 35;
      o.frequency.setValueAtTime(f, at);
      o.frequency.linearRampToValueAtTime(f * 0.78, at + 0.38);
      const b1 = ctx.createBiquadFilter();
      b1.type = 'bandpass';
      b1.frequency.value = 620 + r() * 200;
      b1.Q.value = 3;
      const b2 = ctx.createBiquadFilter();
      b2.type = 'bandpass';
      b2.frequency.value = 1500 + r() * 300;
      b2.Q.value = 5;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, at);
      let t = at;
      for (let i = 0; i < 9; i++) {
        e.gain.linearRampToValueAtTime(0.25 + r() * 0.75, t + 0.008);
        t += 0.03 + r() * 0.025;
        e.gain.linearRampToValueAtTime(0.08 + r() * 0.2, t);
      }
      e.gain.linearRampToValueAtTime(0, t + 0.04);
      o.connect(b1).connect(e);
      o.connect(b2).connect(e);
      e.connect(g);
      o.start(at);
      o.stop(t + 0.1);
      o.onended = () => {
        o.disconnect();
        b1.disconnect();
        b2.disconnect();
        e.disconnect();
      };
      break;
    }
    case 'rustle':
      for (let i = 0; i < 5; i++) burst(ctx, g, at + i * 0.09 + r() * 0.05, 'bandpass', 2600 + r() * 1800, 0.7, (0.5 + r() * 0.5) * k, 0.03, 0.22 + r() * 0.1, r());
      burst(ctx, g, at, 'lowpass', 400, 0.7, 0.35, 0.05, 0.4, r());
      break;
    case 'ring': {
      // Сталь по колышкам — короткий шорох, потом звон: неровные призвуки, высокие гаснут быстрее.
      burst(ctx, g, at, 'bandpass', 4200, 2.2, 0.55, 0.01, 0.14, r());
      const base = 1180 + r() * 90;
      for (const [m, p, len] of [
        [1, 0.32, 1.4],
        [1.51, 0.22, 1.1],
        [2.27, 0.16, 0.8],
        [3.13, 0.1, 0.55],
        [4.06, 0.06, 0.35],
      ] as const)
        tone(ctx, g, at + 0.06, 'sine', base * m, base * m * 0.998, p, 0.004, len);
      break;
    }
    case 'take':
      burst(ctx, g, at, 'bandpass', 1800, 2, 0.5 * k, 0.003, 0.04, r());
      tone(ctx, g, at, 'sine', 1320 + r() * 200, 1300, 0.12, 0.003, 0.12);
      break;
    case 'put':
      burst(ctx, g, at, 'lowpass', 420, 1, 0.9 * k, 0.004, 0.08, r());
      burst(ctx, g, at + 0.004, 'bandpass', 1600, 2, 0.35 * k, 0.003, 0.04, r());
      break;
    case 'hinge': {
      // Петли крышки сундука (Г-9): железо по железу — протяжный скрип, тон гуляет вверх и вниз, громкость рвётся
      // (зацеп — срыв), длиннее скрипа кресла; под конец — сухое дерево.
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f = 170 + r() * 40;
      o.frequency.setValueAtTime(f, at);
      o.frequency.linearRampToValueAtTime(f * 1.35, at + 0.32);
      o.frequency.linearRampToValueAtTime(f * 1.1, at + 0.7);
      const b1 = ctx.createBiquadFilter();
      b1.type = 'bandpass';
      b1.frequency.value = 980 + r() * 220;
      b1.Q.value = 4;
      const b2 = ctx.createBiquadFilter();
      b2.type = 'bandpass';
      b2.frequency.value = 2300 + r() * 300;
      b2.Q.value = 6;
      const e = ctx.createGain();
      e.gain.setValueAtTime(0, at);
      let t = at;
      for (let i = 0; i < 16; i++) {
        e.gain.linearRampToValueAtTime(0.3 + r() * 0.7, t + 0.01);
        t += 0.035 + r() * 0.025;
        e.gain.linearRampToValueAtTime(0.1 + r() * 0.25, t);
      }
      e.gain.linearRampToValueAtTime(0, t + 0.06);
      o.connect(b1).connect(e);
      o.connect(b2).connect(e);
      e.connect(g);
      o.start(at);
      o.stop(t + 0.12);
      o.onended = () => {
        o.disconnect();
        b1.disconnect();
        b2.disconnect();
        e.disconnect();
      };
      burst(ctx, g, t - 0.05, 'bandpass', 1300, 1.5, 0.25 * k, 0.01, 0.1, r());
      break;
    }
    case 'lidShut':
      // Крышка легла: глухой удар дуба, железо полос звякнуло.
      burst(ctx, g, at, 'lowpass', 260, 0.9, 1.0 * k, 0.004, 0.16, r());
      tone(ctx, g, at, 'sine', 92, 64, 0.5, 0.004, 0.18);
      burst(ctx, g, at + 0.006, 'bandpass', 3100, 3, 0.22 * k, 0.003, 0.06, r());
      break;
  }
  // Узел силы отпускается после самого долгого звука.
  const done = ctx.createConstantSource?.();
  if (done) {
    done.offset.value = 0;
    done.connect(g);
    done.start(at);
    done.stop(at + 1.8);
    done.onended = () => {
      done.disconnect();
      g.disconnect();
    };
  }
}

export { bone as cueBone };
