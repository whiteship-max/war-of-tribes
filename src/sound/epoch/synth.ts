// Голоса звука города и музыки эпохи: синтез на Web Audio, без единого чужого файла (docs/audio.md, раздел 2).
//
// Всё здесь пишется против `BaseAudioContext`, а не `AudioContext`: те же голоса рисует и живая игра, и офлайн-отрисовка
// образцов и уровней (`npm run audio:samples`, `OfflineAudioContext`). Своего контекста этот файл не заводит —
// контекст один на игру и живёт в `sound/web.ts`; сюда он приходит с выходом.
//
// Правило без щелчков: каждая огибающая начинается и кончается в нуле (`0.0001` для экспоненты), узел останавливается
// только после того, как его огибающая дошла до нуля, а громкость слоя меняется только `setTargetAtTime` или рампой.

import { span, type Rng } from './rng';

/** Набор: контекст, общие буферы и пространство. Один на машинку звука. */
export interface Kit {
  ctx: BaseAudioContext;
  rnd: Rng;
  /** Слабый телефон: меньше призвуков у колокола и наковальни, без пространства. */
  lite: boolean;
  /** Белый шум, петля 2 с. */
  white: AudioBuffer;
  /** «Бурый» шум (интеграл белого), петля 4 с — ветер и море. */
  brown: AudioBuffer;
  /** Щипки лютни по высоте — считаются один раз на высоту. */
  plucks: Map<number, AudioBuffer>;
  /** Отзвук далёкого (колокол, наковальня, выкрики): вход посыла; `null` на слабом телефоне. */
  space: AudioNode | null;
}

/** Частота ноты MIDI. */
export const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** Частота дискретизации самодельных буферов: щипку и шуму больше не нужно, а памяти вдвое меньше. */
const BUF_RATE = 22050;

/** Шум петлёй без шва: последние 0.1 с переливаются в начало. */
function noiseBuffer(ctx: BaseAudioContext, rnd: Rng, seconds: number, brown: boolean): AudioBuffer {
  const len = Math.floor(seconds * BUF_RATE);
  const buf = ctx.createBuffer(1, len, BUF_RATE);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = rnd() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  // Убрать постоянную составляющую — иначе у петли «бурого» шума ступенька на стыке.
  let mean = 0;
  for (let i = 0; i < len; i++) mean += d[i];
  mean /= len;
  for (let i = 0; i < len; i++) d[i] -= mean;
  const fade = Math.floor(0.1 * BUF_RATE);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = d[i] * k + d[len - fade + i] * (1 - k);
  }
  // Хвост, уже перелитый в начало, отрезается: петля идёт от начала до len - fade.
  const out = ctx.createBuffer(1, len - fade, BUF_RATE);
  out.getChannelData(0).set(d.subarray(0, len - fade));
  let peak = 0;
  const o = out.getChannelData(0);
  for (let i = 0; i < o.length; i++) peak = Math.max(peak, Math.abs(o[i]));
  if (peak > 0) for (let i = 0; i < o.length; i++) o[i] /= peak;
  return out;
}

/** Отзвук: затухающий шум секунды на полторы — далёкий двор, а не собор изнутри. */
function spaceOf(ctx: BaseAudioContext, rnd: Rng): ConvolverNode {
  // Импульс свёртки — только на частоте контекста: иной Chrome не принимает вовсе (в отличие от буферов источников).
  const rate = ctx.sampleRate;
  const len = Math.floor(1.6 * rate);
  const ir = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      d[i] = (rnd() * 2 - 1) * Math.exp(-t * 3.2) * (t < 0.01 ? t / 0.01 : 1);
    }
  }
  const conv = ctx.createConvolver();
  conv.normalize = true;
  conv.buffer = ir;
  return conv;
}

/** Собрать набор. `out` — куда идёт отзвук (выход фона). */
export function makeKit(ctx: BaseAudioContext, rnd: Rng, lite: boolean, out: AudioNode): Kit {
  let space: AudioNode | null = null;
  if (!lite) {
    const conv = spaceOf(ctx, rnd);
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    conv.connect(wet);
    wet.connect(out);
    space = conv;
  }
  return { ctx, rnd, lite, white: noiseBuffer(ctx, rnd, 2, false), brown: noiseBuffer(ctx, rnd, 4, true), plucks: new Map(), space };
}

/** Огибающая «удар и спад»: ноль → `peak` за `attack` → ноль к `at + life`. */
export function strike(g: AudioParam, at: number, peak: number, attack: number, life: number): void {
  g.setValueAtTime(0.0001, at);
  g.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
  g.exponentialRampToValueAtTime(0.0001, at + life);
}

/** Петля шума с началом в случайном месте. */
export function noiseLoop(kit: Kit, brown: boolean, at: number): AudioBufferSourceNode {
  const src = kit.ctx.createBufferSource();
  src.buffer = brown ? kit.brown : kit.white;
  src.loop = true;
  src.start(at, span(kit.rnd, 0, src.buffer.duration * 0.9));
  return src;
}

/** Панорама, если она есть в этой среде (старый Safari её не знает — звучит посередине). */
export function panned(kit: Kit, dest: AudioNode, pan: number): AudioNode {
  const ctx = kit.ctx as BaseAudioContext & { createStereoPanner?: () => StereoPannerNode };
  if (!ctx.createStereoPanner || pan === 0) return dest;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(dest);
  return p;
}

// ---------- Музыка ----------

/**
 * Щипок: Карплус–Стронг в буфер. Струна — линия задержки длиной в период с усреднением соседей; дробная часть периода
 * — линейной интерполяцией, иначе высокие ноты фальшивили бы на десяток центов. Возбуждение — шум, смягчённый и
 * прорежённый у кобылки, как у пальца, а не медиатора. Спад — под высоту: бас звенит дольше.
 */
export function pluckBuffer(kit: Kit, midi: number): AudioBuffer {
  const cached = kit.plucks.get(midi);
  if (cached) return cached;
  const f = hz(midi);
  const t60 = Math.max(0.9, Math.min(2.6, 2.6 - (midi - 45) * 0.045));
  const len = Math.floor((t60 + 0.15) * BUF_RATE);
  const buf = kit.ctx.createBuffer(1, len, BUF_RATE);
  const y = buf.getChannelData(0);
  const D = BUF_RATE / f - 0.5;
  const N = Math.floor(D);
  const frac = D - N;
  const g = Math.pow(1e-3, 1 / (f * t60));
  // Возбуждение — шум, дважды сглаженный: палец, а не медиатор. Несглаженный шум во всю полосу трещит на атаке.
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < N + 2 && i < len; i++) {
    const w = kit.rnd() * 2 - 1;
    p1 = 0.45 * w + 0.55 * p1;
    p2 = 0.5 * p1 + 0.5 * p2;
    y[i] = p2;
  }
  const bridge = Math.max(1, Math.floor(N * 0.18));
  for (let i = N + 1; i >= bridge; i--) y[i] -= 0.6 * y[i - bridge];
  for (let n = N + 2; n < len; n++) {
    const a = (1 - frac) * y[n - N] + frac * y[n - N - 1];
    const b = (1 - frac) * y[n - N - 1] + frac * y[n - N - 2];
    y[n] = g * 0.5 * (a + b);
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(y[i]));
  const fade = Math.floor(0.08 * BUF_RATE);
  for (let i = 0; i < len; i++) {
    y[i] /= peak || 1;
    if (i > len - fade) y[i] *= (len - i) / fade;
  }
  kit.plucks.set(midi, buf);
  return buf;
}

/**
 * Щипок лютни. Атака — 3 мс подъёма громкости: буфер струны начинается с шума, и без подъёма первый отсчёт прыгал на
 * четверть шкалы — щелчок (образец `ui`, «стройка готова», П-3). Щипок от этого не мягче: 3 мс ухо атакой не слышит.
 */
export function pluck(kit: Kit, dest: AudioNode, at: number, midi: number, vel: number, pan = 0): void {
  const src = kit.ctx.createBufferSource();
  src.buffer = pluckBuffer(kit, midi);
  const g = kit.ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vel, at + 0.003);
  src.connect(g);
  g.connect(panned(kit, dest, pan));
  src.start(at);
}

/** Дудочка: синус с тихой октавой, вибрато после атаки и дыхание шумом на высоте ноты. */
export function flute(kit: Kit, dest: AudioNode, at: number, dur: number, midi: number, vel: number): void {
  const ctx = kit.ctx;
  const f = hz(midi);
  const end = at + dur;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(vel * 0.5, at + 0.07);
  amp.gain.setValueAtTime(vel * 0.5, Math.max(at + 0.07, end - 0.02));
  amp.gain.linearRampToValueAtTime(vel * 0.42, end);
  amp.gain.linearRampToValueAtTime(0, end + 0.12);
  amp.connect(dest);

  const tone = ctx.createOscillator();
  tone.frequency.value = f;
  const over = ctx.createOscillator();
  over.type = 'triangle';
  over.frequency.value = f * 2;
  const overGain = ctx.createGain();
  overGain.gain.value = 0.1;
  over.connect(overGain);
  overGain.connect(amp);
  tone.connect(amp);

  // Вибрато входит не сразу: короткая нота ровная, долгая — дышит.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 5.1;
  const depth = ctx.createGain();
  depth.gain.setValueAtTime(0, at);
  depth.gain.linearRampToValueAtTime(0, at + 0.25);
  depth.gain.linearRampToValueAtTime(f * 0.005, at + 0.6);
  lfo.connect(depth);
  depth.connect(tone.frequency);
  depth.connect(over.frequency);

  const breath = ctx.createBufferSource();
  breath.buffer = kit.white;
  breath.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = f * 2;
  bp.Q.value = 2;
  const bg = ctx.createGain();
  // «Чиф» — шум на атаке громче, потом ровное дыхание.
  bg.gain.setValueAtTime(0, at);
  bg.gain.linearRampToValueAtTime(0.18, at + 0.02);
  bg.gain.linearRampToValueAtTime(0.05, at + 0.1);
  breath.connect(bp);
  bp.connect(bg);
  bg.connect(amp);

  const stop = end + 0.15;
  for (const node of [tone, over, lfo]) {
    node.start(at);
    node.stop(stop);
  }
  breath.start(at, span(kit.rnd, 0, 1.5));
  breath.stop(stop);
}

/** Бурдон: финалис и квинта, по две слегка расстроенных пилы сквозь тёмный фильтр. Входит и уходит медленно. */
export function drone(kit: Kit, dest: AudioNode, at: number, end: number, midis: readonly number[], fadeIn: number, fadeOut: number): void {
  const ctx = kit.ctx;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(1, at + fadeIn);
  amp.gain.setValueAtTime(1, end - fadeOut);
  amp.gain.linearRampToValueAtTime(0, end);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 520;
  lp.Q.value = 0.5;
  lp.connect(amp);
  amp.connect(dest);
  const oscs: OscillatorNode[] = [];
  midis.forEach((m, i) => {
    for (const detune of kit.lite ? [0] : [-4, 4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = hz(m);
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = (i === 0 ? 0.05 : 0.032) / (kit.lite ? 0.7 : 1);
      o.connect(g);
      g.connect(lp);
      oscs.push(o);
    }
  });
  for (const o of oscs) {
    o.start(at);
    o.stop(end + 0.05);
  }
}

// ---------- Город ----------

/** Колокол собора: неровные призвуки большого колокола (гул, прима, малая терция, квинта, номинал…). */
const BELL: readonly (readonly [number, number, number])[] = [
  [0.5, 0.45, 7],
  [1, 0.6, 5],
  [1.19, 0.42, 4],
  [1.5, 0.22, 3.2],
  [2, 0.34, 2.8],
  [2.51, 0.14, 2],
  [2.66, 0.1, 1.8],
  [3.01, 0.1, 1.5],
];

export function bell(kit: Kit, dest: AudioNode, at: number, base: number, vel: number): void {
  const ctx = kit.ctx;
  const out = ctx.createGain();
  out.gain.value = vel;
  out.connect(dest);
  if (kit.space) out.connect(kit.space);
  for (const [ratio, a, life] of kit.lite ? BELL.slice(0, 5) : BELL) {
    const o = ctx.createOscillator();
    o.frequency.value = base * ratio;
    const g = ctx.createGain();
    strike(g.gain, at, a, 0.006, life);
    o.connect(g);
    g.connect(out);
    o.start(at);
    o.stop(at + life + 0.05);
  }
}

/** Наковальня: удар молота — металлические призвуки с быстрым спадом и щелчок. */
const ANVIL: readonly (readonly [number, number, number])[] = [
  [1, 1, 0.7],
  [2.76, 0.55, 0.4],
  [5.4, 0.35, 0.22],
  [8.93, 0.2, 0.12],
];

export function anvil(kit: Kit, dest: AudioNode, at: number, f0: number, vel: number, pan: number): void {
  const ctx = kit.ctx;
  const out = ctx.createGain();
  out.gain.value = vel;
  out.connect(panned(kit, dest, pan));
  if (kit.space) out.connect(kit.space);
  for (const [ratio, a, life] of kit.lite ? ANVIL.slice(0, 2) : ANVIL) {
    const o = ctx.createOscillator();
    o.frequency.value = f0 * ratio * span(kit.rnd, 0.997, 1.003);
    const g = ctx.createGain();
    strike(g.gain, at, a * 0.5, 0.002, life);
    o.connect(g);
    g.connect(out);
    o.start(at);
    o.stop(at + life + 0.05);
  }
  const click = ctx.createBufferSource();
  click.buffer = kit.white;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const cg = ctx.createGain();
  strike(cg.gain, at, 0.35, 0.001, 0.03);
  click.connect(hp);
  hp.connect(cg);
  cg.connect(out);
  click.start(at, span(kit.rnd, 0, 1.5));
  click.stop(at + 0.05);
}

/** Птица: одна фраза — один генератор с кривой высоты и огибающей. Вид выбирает фраза. */
export type BirdKind = 'trill' | 'whistle' | 'warble';

export function bird(kit: Kit, dest: AudioNode, at: number, kind: BirdKind, vel: number, pan: number): number {
  const ctx = kit.ctx;
  const rnd = kit.rnd;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  o.connect(g);
  g.connect(panned(kit, dest, pan));
  let t = at;
  const chirp = (f0: number, f1: number, len: number, peak: number): void => {
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + len);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak * vel, t + len * 0.3);
    g.gain.linearRampToValueAtTime(0, t + len);
  };
  if (kind === 'trill') {
    const n = 6 + Math.floor(rnd() * 5);
    const f = span(rnd, 3600, 4400);
    for (let i = 0; i < n; i++) {
      chirp(f, f * 1.2, 0.045, 0.5);
      t += 0.075;
    }
  } else if (kind === 'whistle') {
    const f = span(rnd, 2300, 2900);
    chirp(f, f * 1.05, 0.2, 0.45);
    t += 0.26;
    chirp(f * 0.84, f * 0.8, 0.26, 0.4);
    t += 0.3;
  } else {
    const n = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < n; i++) {
      const f = span(rnd, 2600, 5000);
      const len = span(rnd, 0.06, 0.12);
      chirp(f, f * span(rnd, 0.8, 1.25), len, 0.4);
      t += len + span(rnd, 0.03, 0.08);
    }
  }
  o.start(at);
  o.stop(t + 0.05);
  return t - at;
}

/** Сверчок: песня из трёх импульсов, повторённая `n` раз. */
export function cricket(kit: Kit, dest: AudioNode, at: number, n: number, vel: number, pan: number): number {
  const ctx = kit.ctx;
  const o = ctx.createOscillator();
  o.frequency.value = span(kit.rnd, 4300, 4800);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  o.connect(g);
  g.connect(panned(kit, dest, pan));
  let t = at;
  const gap = span(kit.rnd, 0.42, 0.6);
  for (let k = 0; k < n; k++) {
    for (let p = 0; p < 3; p++) {
      const s = t + p * 0.03;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(vel, s + 0.006);
      g.gain.linearRampToValueAtTime(0, s + 0.018);
    }
    t += gap;
  }
  o.start(at);
  o.stop(t + 0.05);
  return t - at;
}

/**
 * Голос рынка: гласная сквозь две форманты — тихий голос (пила) пополам с дыханием (шум). Звучит фраза из слогов;
 * вместе с соседними голосами — гомон, а не слова.
 */
export function voice(kit: Kit, dest: AudioNode, at: number, syllables: number, vel: number, pan: number, shout: boolean, high?: number): number {
  const ctx = kit.ctx;
  const rnd = kit.rnd;
  // `high` — своя высота голоса, Гц (дети, женщины, проповедник — ЖГ-2); нет — мужской гомон.
  const pitch = high ?? (shout ? span(rnd, 230, 320) : span(rnd, 105, 230));
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(pitch, at);
  const n = noiseLoop(kit, false, at);
  const ng = ctx.createGain();
  ng.gain.value = 0.25;
  n.connect(ng);
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.Q.value = 6;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.Q.value = 8;
  const f2g = ctx.createGain();
  f2g.gain.value = 0.6;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, at);
  o.connect(f1);
  o.connect(f2);
  ng.connect(f1);
  ng.connect(f2);
  f1.connect(amp);
  f2.connect(f2g);
  f2g.connect(amp);
  const out = panned(kit, dest, pan);
  amp.connect(out);
  if (shout && kit.space) amp.connect(kit.space);
  let t = at;
  for (let i = 0; i < syllables; i++) {
    const len = shout && i === syllables - 1 ? span(rnd, 0.45, 0.7) : span(rnd, 0.1, 0.22);
    // Гласная слога: а, о, е, у — первые две форманты.
    const [a, b] = [
      [750, 1200],
      [500, 900],
      [450, 1900],
      [350, 800],
    ][Math.floor(rnd() * 4)];
    f1.frequency.setValueAtTime(a, t);
    f2.frequency.setValueAtTime(b, t);
    o.frequency.linearRampToValueAtTime(pitch * span(rnd, 0.9, 1.12), t + len);
    const peak = vel * span(rnd, 0.5, 1);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.03);
    amp.gain.linearRampToValueAtTime(peak * 0.7, t + len - 0.03);
    amp.gain.linearRampToValueAtTime(0, t + len);
    t += len + span(rnd, 0.02, 0.09);
  }
  o.start(at);
  o.stop(t + 0.05);
  n.stop(t + 0.05);
  return t - at;
}

// ---------- Интерфейс ----------

/** Касание кнопки: короткий глухой щелчок деревом — не звон. */
export function tap(kit: Kit, dest: AudioNode, at: number): void {
  const ctx = kit.ctx;
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(820, at);
  o.frequency.exponentialRampToValueAtTime(420, at + 0.03);
  const g = ctx.createGain();
  strike(g.gain, at, 0.22, 0.002, 0.045);
  o.connect(g);
  g.connect(dest);
  o.start(at);
  o.stop(at + 0.06);
  const n = ctx.createBufferSource();
  n.buffer = kit.white;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1700;
  bp.Q.value = 1.2;
  const ng = ctx.createGain();
  strike(ng.gain, at, 0.12, 0.001, 0.02);
  n.connect(bp);
  bp.connect(ng);
  ng.connect(dest);
  n.start(at, span(kit.rnd, 0, 1.5));
  n.stop(at + 0.03);
}

/**
 * Капля с карниза в лужу: короткий «плинк» — тон взлетает (пузырёк воздуха, захваченный каплей), гаснет за десятую
 * долю секунды; атака 4 мс — без щелчка.
 */
export function drip(kit: Kit, dest: AudioNode, at: number, vel: number, pan: number): void {
  const ctx = kit.ctx;
  const f = span(kit.rnd, 1500, 3000);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f * 0.78, at);
  o.frequency.exponentialRampToValueAtTime(f, at + 0.035);
  const g = ctx.createGain();
  strike(g.gain, at, vel, 0.004, 0.09);
  o.connect(g);
  g.connect(panned(kit, dest, pan));
  o.start(at);
  o.stop(at + 0.12);
}

/** Рог тревоги: две пилы с расстройкой, фильтр раскрывается на атаке; губы чуть недотягивают начало ноты. */
export function horn(kit: Kit, dest: AudioNode, at: number, midi: number, dur: number, vel: number): void {
  const ctx = kit.ctx;
  const f = hz(midi);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(vel, at + 0.12);
  amp.gain.setValueAtTime(vel, at + dur - 0.25);
  amp.gain.linearRampToValueAtTime(0, at + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.5;
  lp.frequency.setValueAtTime(300, at);
  lp.frequency.linearRampToValueAtTime(1500, at + 0.15);
  lp.frequency.linearRampToValueAtTime(900, at + dur);
  lp.connect(amp);
  amp.connect(dest);
  if (kit.space) amp.connect(kit.space);
  for (const k of [1, 1.006]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f * k * 0.94, at);
    o.frequency.exponentialRampToValueAtTime(f * k, at + 0.1);
    const g = ctx.createGain();
    g.gain.value = 0.5;
    o.connect(g);
    g.connect(lp);
    o.start(at);
    o.stop(at + dur + 0.05);
  }
}

// ---------- Жизнь города (docs/city_v3.md, ЖГ-1) ----------

/**
 * Бубен праздника: удар по коже — низкий тон, сползающий 150→70 Гц за 0.12 с, и щепоть шума кожи; на слабой доле — тише и
 * с бубенцами (верх шума). Атака 3 мс — без щелчка (П-3).
 */
export function drum(kit: Kit, dest: AudioNode, at: number, vel: number, pan: number, jingle: boolean): void {
  const ctx = kit.ctx;
  const out = panned(kit, dest, pan);
  const o = ctx.createOscillator();
  o.frequency.setValueAtTime(150, at);
  o.frequency.exponentialRampToValueAtTime(70, at + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vel, at + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28);
  o.connect(g);
  g.connect(out);
  o.start(at);
  o.stop(at + 0.32);
  const n = noiseLoop(kit, false, at);
  const f = ctx.createBiquadFilter();
  f.type = jingle ? 'highpass' : 'bandpass';
  f.frequency.value = jingle ? 6500 : 900;
  const ng = ctx.createGain();
  strike(ng.gain, at, vel * (jingle ? 0.35 : 0.25), 0.003, jingle ? 0.22 : 0.08);
  n.connect(f);
  f.connect(ng);
  ng.connect(out);
  n.stop(at + 0.3);
}

/**
 * Смех у трактира: четыре-семь «ха» — голосовая пила сквозь форманты «а», каждый слог ниже прежнего, с выдохом шумом.
 * Возвращает длину, с.
 */
export function laugh(kit: Kit, dest: AudioNode, at: number, vel: number, pan: number, high?: number): number {
  const ctx = kit.ctx;
  const rnd = kit.rnd;
  const n = 4 + Math.floor(rnd() * 4);
  const pitch = high ?? span(rnd, 150, 260);
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const breath = noiseLoop(kit, false, at);
  const bg = ctx.createGain();
  bg.gain.value = 0.5;
  breath.connect(bg);
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 780;
  f1.Q.value = 5;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = 1250;
  f2.Q.value = 7;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, at);
  for (const x of [o, bg]) {
    x.connect(f1);
    x.connect(f2);
  }
  f1.connect(amp);
  f2.connect(amp);
  amp.connect(panned(kit, dest, pan));
  let t = at;
  for (let i = 0; i < n; i++) {
    const len = span(rnd, 0.09, 0.14);
    o.frequency.setValueAtTime(pitch * (1 - i * 0.05), t);
    const peak = vel * (1 - i * 0.08);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.02);
    amp.gain.linearRampToValueAtTime(0, t + len);
    t += len + span(rnd, 0.05, 0.09);
  }
  o.start(at);
  o.stop(t + 0.05);
  breath.stop(t + 0.05);
  return t - at;
}

// ---------- Сценки жителей (docs/city_v3.md, ЖГ-2) ----------
// Всё — синтез, без файлов: первая загрузка не растёт. Атака каждого звука — не короче 2 мс, без щелчка (П-3).

/**
 * Голос, который поёт: пила с вибрато сквозь форманты гласной, ноты подряд легато; `slur` — насколько певец мимо нот (пьяные —
 * четверть тона). Возвращает длину, с.
 */
export function sing(kit: Kit, dest: AudioNode, at: number, notes: readonly number[], beat: number, vel: number, pan: number, slur = 0): number {
  const ctx = kit.ctx;
  const rnd = kit.rnd;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const lfo = ctx.createOscillator();
  lfo.frequency.value = span(rnd, 4.5, 6);
  const depth = ctx.createGain();
  depth.gain.value = 3;
  lfo.connect(depth);
  depth.connect(o.frequency);
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.Q.value = 5;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.Q.value = 7;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, at);
  o.connect(f1);
  o.connect(f2);
  f1.connect(amp);
  f2.connect(amp);
  amp.connect(panned(kit, dest, pan));
  let t = at;
  for (let i = 0; i < notes.length; i++) {
    const len = beat * span(rnd, 0.85, 1.15);
    const f = hz(notes[i] + span(rnd, -slur, slur));
    o.frequency.setTargetAtTime(f, t, 0.03);
    const [a, b] = [
      [750, 1200],
      [500, 900],
      [350, 800],
    ][Math.floor(rnd() * 3)];
    f1.frequency.setTargetAtTime(a, t, 0.04);
    f2.frequency.setTargetAtTime(b, t, 0.04);
    amp.gain.setTargetAtTime(vel * span(rnd, 0.7, 1), t, 0.03);
    t += len;
  }
  amp.gain.setTargetAtTime(0, t, 0.08);
  o.start(at);
  lfo.start(at);
  o.stop(t + 0.5);
  lfo.stop(t + 0.5);
  return t - at;
}

/** Плач: три-пять всхлипов — дрожащий голос, сползающий вниз, и вдох шумом между ними. Возвращает длину, с. */
export function sob(kit: Kit, dest: AudioNode, at: number, vel: number, pan: number): number {
  const ctx = kit.ctx;
  const rnd = kit.rnd;
  const out = panned(kit, dest, pan);
  const n = 3 + Math.floor(rnd() * 3);
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const breath = noiseLoop(kit, false, at);
  const bg = ctx.createGain();
  bg.gain.value = 0.6;
  breath.connect(bg);
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 420;
  f1.Q.value = 6;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = 2100;
  f2.Q.value = 8;
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, at);
  for (const x of [o, bg]) {
    x.connect(f1);
    x.connect(f2);
  }
  f1.connect(amp);
  f2.connect(amp);
  amp.connect(out);
  // Вдох — верх шума, отдельно.
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 2500;
  const ig = ctx.createGain();
  ig.gain.setValueAtTime(0, at);
  breath.connect(hp);
  hp.connect(ig);
  ig.connect(out);
  let t = at;
  const p0 = span(rnd, 290, 360);
  for (let i = 0; i < n; i++) {
    const len = span(rnd, 0.22, 0.4);
    o.frequency.setValueAtTime(p0 * (1 - i * 0.03), t);
    o.frequency.linearRampToValueAtTime(p0 * 0.72, t + len);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(vel * span(rnd, 0.6, 1), t + 0.04);
    amp.gain.linearRampToValueAtTime(0, t + len);
    const gap = span(rnd, 0.18, 0.35);
    ig.gain.setValueAtTime(0, t + len);
    ig.gain.linearRampToValueAtTime(vel * 0.35, t + len + gap * 0.6);
    ig.gain.linearRampToValueAtTime(0, t + len + gap);
    t += len + gap;
  }
  o.start(at);
  o.stop(t + 0.05);
  breath.stop(t + 0.05);
  return t - at;
}

/** Звон: монеты о прилавок, кружка о кружку — два коротких высоких тона. */
export function clink(kit: Kit, dest: AudioNode, at: number, vel: number, pan: number): void {
  const ctx = kit.ctx;
  const out = panned(kit, dest, pan);
  for (const f of [span(kit.rnd, 2200, 2700), span(kit.rnd, 3300, 4100)]) {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const g = ctx.createGain();
    strike(g.gain, at, vel * 0.5, 0.002, 0.18);
    o.connect(g);
    g.connect(out);
    o.start(at);
    o.stop(at + 0.22);
  }
}

/** Стук: дерево, шаг, удар — короткий тон `f`, вдвое сползающий, и щепоть шума у `2f`. Кости о крышку, кулак, копыто. */
export function knock(kit: Kit, dest: AudioNode, at: number, f: number, vel: number, pan: number): void {
  const ctx = kit.ctx;
  const out = panned(kit, dest, pan);
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.setValueAtTime(f, at);
  o.frequency.exponentialRampToValueAtTime(f * 0.5, at + 0.04);
  const g = ctx.createGain();
  strike(g.gain, at, vel, 0.002, 0.07);
  o.connect(g);
  g.connect(out);
  o.start(at);
  o.stop(at + 0.09);
  const n = noiseLoop(kit, false, at);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = Math.min(6000, f * 2);
  bp.Q.value = 1.2;
  const ng = ctx.createGain();
  strike(ng.gain, at, vel * 0.5, 0.002, 0.03);
  n.connect(bp);
  bp.connect(ng);
  ng.connect(out);
  n.stop(at + 0.05);
}

/** Скрип тележной оси: низкая пила, высота качается с оборотом колеса, сквозь узкую полосу. */
export function creak(kit: Kit, dest: AudioNode, at: number, dur: number, vel: number, pan: number): void {
  const ctx = kit.ctx;
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  const f0 = span(kit.rnd, 95, 140);
  o.frequency.setValueAtTime(f0, at);
  for (let t = 0; t < dur; t += 0.35) o.frequency.linearRampToValueAtTime(f0 * span(kit.rnd, 0.8, 1.35), at + t + 0.35);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = span(kit.rnd, 800, 1100);
  bp.Q.value = 9;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vel, at + 0.15);
  g.gain.setValueAtTime(vel, at + dur - 0.2);
  g.gain.linearRampToValueAtTime(0, at + dur);
  o.connect(bp);
  bp.connect(g);
  g.connect(panned(kit, dest, pan));
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** Блеяние: дрожащая пила (вибрато семь раз в секунду) сквозь «э». Возвращает длину, с. */
export function bleat(kit: Kit, dest: AudioNode, at: number, vel: number, pan: number): number {
  const ctx = kit.ctx;
  const len = span(kit.rnd, 0.45, 0.8);
  const f = span(kit.rnd, 380, 560);
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f, at);
  o.frequency.linearRampToValueAtTime(f * 0.88, at + len);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = span(kit.rnd, 6, 8);
  const depth = ctx.createGain();
  depth.gain.value = f * 0.05;
  lfo.connect(depth);
  depth.connect(o.frequency);
  const f1 = ctx.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = 520;
  f1.Q.value = 5;
  const f2 = ctx.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = 1800;
  f2.Q.value = 7;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vel, at + 0.05);
  g.gain.linearRampToValueAtTime(vel * 0.6, at + len - 0.05);
  g.gain.linearRampToValueAtTime(0, at + len);
  o.connect(f1);
  o.connect(f2);
  f1.connect(g);
  f2.connect(g);
  g.connect(panned(kit, dest, pan));
  o.start(at);
  lfo.start(at);
  o.stop(at + len + 0.05);
  lfo.stop(at + len + 0.05);
  return len;
}

/** Взмах серпа или косы по стеблям: шум, полоса которого сползает сверху вниз за четверть секунды. */
export function swish(kit: Kit, dest: AudioNode, at: number, vel: number, pan: number): void {
  const ctx = kit.ctx;
  const n = noiseLoop(kit, false, at);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.6;
  bp.frequency.setValueAtTime(3400, at);
  bp.frequency.exponentialRampToValueAtTime(900, at + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(vel, at + 0.06);
  g.gain.linearRampToValueAtTime(0, at + 0.3);
  n.connect(bp);
  bp.connect(g);
  g.connect(panned(kit, dest, pan));
  n.stop(at + 0.35);
}

/** Лай: один-два «гав» — пила, сползающая с 420 Гц, сквозь «а» с шумом. */
export function bark(kit: Kit, dest: AudioNode, at: number, vel: number, pan: number): number {
  const ctx = kit.ctx;
  const out = panned(kit, dest, pan);
  const n = 1 + Math.floor(kit.rnd() * 2);
  for (let i = 0; i < n; i++) {
    const t = at + i * 0.28;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(span(kit.rnd, 380, 460), t);
    o.frequency.exponentialRampToValueAtTime(220, t + 0.13);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 900;
    f1.Q.value = 3;
    const g = ctx.createGain();
    strike(g.gain, t, vel, 0.008, 0.16);
    o.connect(f1);
    f1.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.2);
  }
  return n * 0.28;
}
