// Голос здания (docs/city_v3.md, ЗВ-1): касание постройки в городе даёт короткую живую сценку звуком — трактир гомонит,
// кузница бьёт молотом, казармы идут строем. Как в Stronghold: нажал — и слышно, чем живёт дом.
//
// Всё — синтез на голосах `synth.ts`, без файлов. Свой ленивый кусок «голоса зданий»: тянет его машинка звука города
// (`index.ts`) по первому касанию здания, в первую загрузку и в кусок фона он не едет (`vite.config.ts`, `LAZY_DOORS`).
//
// Правила, которые держит этот файл (тест `halls.test.ts`):
// - у каждого здания игры — четыре варианта, подряд один и тот же не звучит;
// - длина — от `HALL_MIN` до `HALL_MAX`: огибающая закрывает всё, что звучит дольше;
// - одно здание — не чаще раза в `HALL_GAP`; новое касание мягко гасит прежний голос (`HALL_SWAP`), голоса не наслаиваются;
// - уровень слышен: с четвёртого — второй слой, с восьмого — третий (`layersAt`), и днём, и ночью, и в тревогу;
// - ночь и тревога звучат своим: ночью тише и сверчки, трактир громче, кузница молчит; в тревогу — звон оружия поверх дома.
import type { BuildingTypeId } from '@/game/types';
import type { Rng } from './rng';
import { span } from './rng';
import {
  anvil,
  bark,
  bell,
  bird,
  bleat,
  clink,
  creak,
  cricket,
  drip,
  flute,
  horn,
  knock,
  laugh,
  noiseLoop,
  panned,
  pluck,
  sing,
  strike,
  voice,
  type Kit,
} from './synth';

/** Когда звучит: день, ночь (`ambience.night`) или тревога (`rhythm.moodOf().alarm`). */
export type HallMood = 'day' | 'night' | 'alarm';

/** Длина голоса, с: короче — не успевает сложиться сценка, длиннее — надоедает. */
export const HALL_MIN = 1.5;
export const HALL_MAX = 3;
/** Одно здание — не чаще, с. */
export const HALL_GAP = 4;
/** Постоянная времени, за которую новое касание гасит прежний голос, с. */
export const HALL_SWAP = 0.06;
/**
 * Сила голоса на выходе «эффектов», своя у каждого здания: голоса разные (шорох корзин тише колокола), а слышно их должно быть
 * ровно. Выставлена офлайн-отрисовкой (`npm run audio:samples`, образцы `zv1-*`, docs/city_v3.md, ЗВ-1): пик здания десятого
 * уровня — около −24 дБ, как сценки ЖГ-2 (−22…−29), ниже событий фона (−13.7…−18.1).
 */
export const HALL_MIX: Record<BuildingTypeId, number> = {
  campfire: 0.19,
  town_hall: 0.064,
  houses: 0.19,
  storage: 0.085,
  sawmill: 0.083,
  // Объединённые дворы (ЗД-1) — сила прежнего главного здания пары; сценки ушедшего звучат на своей прежней силе
  // поправкой в самой сценке (`PEN_K`, `QUARRY_K`): пик двора — тот же, что у прежних двух.
  hunter_hut: 0.27,
  mine: 0.1,
  workshop: 0.17,
  farm: 0.13,
  church: 0.074,
  statue: 0.16,
  infirmary: 0.17,
  watch: 0.25,
  stable: 0.13,
  cache: 0.11,
  tavern: 0.06,
  palisade: 0.15,
  tower: 0.11,
  smithy: 0.11,
  market: 0.15,
  barracks: 0.077,
};
/** Поправка сценок прежнего загона к силе Фермы: загон звучал на 0.2, Ферма — на 0.13 (ЗД-1). */
const PEN_K = 0.2 / 0.13;
/** Поправка сценок прежней каменоломни к силе Шахты: каменоломня звучала на 0.074, рудник — на 0.1 (ЗД-1). */
const QUARRY_K = 0.074 / 0.1;
/** Потолок силы голоса: громче этого здание не говорит, какой бы тихой ни была его сценка. */
export const HALL_LOUD = 0.3;
/** Ночью дома тише; трактир — громче (`HallVoice.nightGain`). */
export const NIGHT_GAIN = 0.55;
/** В тревогу дом слышен из-под звона оружия. */
export const ALARM_HOME = 0.3;

/** Сколько слоёв у здания этого уровня: 1–3 — один, 4–7 — два, 8 и выше — три. */
export const layersAt = (level: number): number => (level >= 8 ? 3 : level >= 4 ? 2 : 1);

/** Сцена одного голоса: куда, когда, как громко; `end` — до него ставятся события, дальше — спад огибающей. */
export interface Stage {
  kit: Kit;
  out: AudioNode;
  r: Rng;
  t: number;
  dur: number;
  end: number;
  v: number;
}

/** Слой голоса: ставит события в `[t, end]`. */
type Layer = (s: Stage) => void;

export interface HallVoice {
  /** Четыре варианта — основа сценки. */
  day: readonly Layer[];
  /** Слои богатства: первый — с четвёртого уровня, второй — с восьмого. */
  more: readonly [Layer, Layer];
  /** Своя ночь (трактир); пусто — ночью молчит (кузница); нет — день тише и сверчки. */
  night?: readonly Layer[];
  /** Ночью громче или тише прочих (`NIGHT_GAIN` — по умолчанию). */
  nightGain?: number;
}

// ---------- Свои голоса: шум в полосе и тон ----------

const pan = (s: Stage, w = 0.4): number => span(s.r, -w, w);

/** Огибающая: `hit` — удар и спад, иначе — набег и спад. */
function env(p: AudioParam, at: number, dur: number, vel: number, hit: boolean): void {
  // Ноль и до начала: источник, начавший на отсчёт раньше события, не щёлкает (как `synth.pluck`).
  p.value = 0;
  if (hit) {
    strike(p, at, vel, 0.003, dur);
    return;
  }
  p.setValueAtTime(0, at);
  p.linearRampToValueAtTime(vel, at + dur * 0.3);
  p.linearRampToValueAtTime(0, at + dur);
}

/** Шум в полосе `f0`→`f1`: шипение, мехи, пила, перо, шёпот, ветер. */
function hiss(s: Stage, at: number, dur: number, f0: number, f1: number, q: number, vel: number, p: number, brown = false, hit = false): void {
  const ctx = s.kit.ctx;
  const n = noiseLoop(s.kit, brown, at);
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = q;
  f.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, at + dur);
  const g = ctx.createGain();
  env(g.gain, at, dur, vel, hit);
  n.connect(f);
  f.connect(g);
  g.connect(panned(s.kit, s.out, p));
  n.stop(at + dur + 0.05);
}

/** Тон `f0`→`f1` сквозь полосу `band`: ржание, мычание, кудахтанье, хрюканье, воркование; `wob` — дрожь, Гц и глубина. */
function tone(s: Stage, at: number, dur: number, wave: OscillatorType, f0: number, f1: number, vel: number, p: number, band = 0, q = 3, hit = false, wob?: [number, number]): void {
  const ctx = s.kit.ctx;
  const o = ctx.createOscillator();
  o.type = wave;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  const g = ctx.createGain();
  env(g.gain, at, dur, vel, hit);
  if (band > 0) {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = band;
    f.Q.value = q;
    o.connect(f);
    f.connect(g);
  } else o.connect(g);
  g.connect(panned(s.kit, s.out, p));
  o.start(at);
  o.stop(at + dur + 0.05);
  if (wob) {
    const l = ctx.createOscillator();
    l.frequency.value = wob[0];
    const d = ctx.createGain();
    d.gain.value = wob[1];
    l.connect(d);
    d.connect(o.frequency);
    l.start(at);
    l.stop(at + dur + 0.05);
  }
}

/** Повторять `f` с шагом `step` (± треть) от `from` до конца сцены. */
function every(s: Stage, from: number, step: number, f: (at: number, i: number) => void): void {
  let i = 0;
  for (let at = s.t + from; at < s.end; at += step * span(s.r, 0.75, 1.3)) f(at, i++);
}

/** Когда-нибудь внутри сцены, не раньше `from`. */
const some = (s: Stage, from = 0): number => s.t + from + s.r() * Math.max(0.01, s.end - s.t - from - 0.3);

// ---------- Звуки ремёсел и живности ----------

const quench = (s: Stage, at: number): void => hiss(s, at, 0.9, 5200, 2600, 0.8, s.v * 0.9, pan(s), false, true);
const bellows = (s: Stage, at: number): void => hiss(s, at, 0.7, 320, 620, 0.9, s.v * 1.6, pan(s), true);
const hammer = (s: Stage, at: number, f0 = span(s.r, 700, 950)): void => anvil(s.kit, s.out, at, f0, s.v * 0.9, pan(s));
const rasp = (s: Stage, at: number, strokes: number): void => {
  for (let i = 0; i < strokes; i++) hiss(s, at + i * 0.24, 0.22, i % 2 ? 2700 : 1900, i % 2 ? 2300 : 2200, 2.5, s.v * 0.8, 0.1);
};
const chop = (s: Stage, at: number): void => {
  knock(s.kit, s.out, at, 170, s.v * 1.4, pan(s));
  hiss(s, at, 0.07, 1500, 1500, 1, s.v * 0.6, 0, false, true);
};
const neigh = (s: Stage, at: number): void => {
  const p = pan(s);
  tone(s, at, 0.85, 'sawtooth', 950, 520, s.v * 0.8, p, 1300, 2.5, false, [11, 55]);
  hiss(s, at + 0.9, 0.25, 700, 450, 1, s.v * 0.7, p, false, true);
};
const hooves = (s: Stage, at: number, n: number): void => {
  const p = pan(s);
  for (let i = 0; i < n; i++) knock(s.kit, s.out, at + i * 0.21 + (i % 3 === 2 ? 0.08 : 0), span(s.r, 120, 170), s.v * span(s.r, 0.6, 1), p);
};
const cluck = (s: Stage, at: number): void => {
  const p = pan(s);
  const n = 2 + Math.floor(s.r() * 3);
  for (let i = 0; i < n; i++) tone(s, at + i * 0.14, 0.07, 'square', 660, 470, s.v * 0.45, p, 1400, 4, true);
  tone(s, at + n * 0.14 + 0.05, 0.28, 'sawtooth', 720, 520, s.v * 0.6, p, 1500, 3);
};
const moo = (s: Stage, at: number): void => {
  const p = pan(s);
  tone(s, at, 1.2, 'sawtooth', 130, 104, s.v * 1.1, p, 450, 2);
  tone(s, at, 1.2, 'sawtooth', 130, 104, s.v * 0.4, p, 1000, 4);
};
const grunt = (s: Stage, at: number): void => {
  const p = pan(s);
  for (let i = 0; i < 2 + Math.floor(s.r() * 2); i++) tone(s, at + i * 0.24, 0.17, 'sawtooth', 115, 85, s.v * 0.9, p, 500, 2);
};
const caw = (s: Stage, at: number): void => {
  const p = pan(s, 0.7);
  for (let i = 0; i < 2 + Math.floor(s.r() * 2); i++) tone(s, at + i * 0.35, 0.26, 'sawtooth', 730, 560, s.v * 0.55, p, 1400, 2);
};
const coo = (s: Stage, at: number): void => {
  const p = pan(s);
  tone(s, at, 0.22, 'sine', 430, 360, s.v * 0.8, p);
  tone(s, at + 0.26, 0.42, 'sine', 390, 330, s.v * 0.7, p);
};
const flap = (s: Stage, at: number): void => {
  const p = pan(s, 0.6);
  for (let i = 0; i < 6; i++) hiss(s, at + i * 0.075, 0.06, 900, 650, 0.8, s.v * 0.7, p, false, true);
};
const chain = (s: Stage, at: number, n: number): void => {
  const p = pan(s);
  for (let i = 0; i < n; i++) clink(s.kit, s.out, at + i * span(s.r, 0.035, 0.08), s.v * span(s.r, 0.3, 0.6), p);
};
const gate = (s: Stage, at: number): void => {
  creak(s.kit, s.out, at, 1.1, s.v * 0.9, pan(s));
  knock(s.kit, s.out, at + 1.15, 80, s.v * 1.5, 0);
};
const quill = (s: Stage, at: number, n: number): void => {
  for (let i = 0; i < n; i++) hiss(s, at + i * span(s.r, 0.12, 0.2), span(s.r, 0.05, 0.13), 5200, 3800, 3, s.v * 0.45, 0.15);
};
const seal = (s: Stage, at: number): void => {
  knock(s.kit, s.out, at, 85, s.v * 1.6, 0);
  hiss(s, at, 0.08, 300, 300, 0.7, s.v * 0.5, 0, true, true);
};
const whisper = (s: Stage, at: number, n: number): number => {
  const p = pan(s);
  let t = at;
  for (let i = 0; i < n; i++) {
    const len = span(s.r, 0.12, 0.28);
    const f = [1100, 1700, 2400, 900][Math.floor(s.r() * 4)];
    hiss(s, t, len, f, f * 0.9, 5, s.v * 0.5, p);
    t += len + span(s.r, 0.03, 0.08);
  }
  return t - at;
};
const page = (s: Stage, at: number): void => hiss(s, at, 0.3, 2400, 4200, 0.8, s.v * 0.5, pan(s));
const grind = (s: Stage, at: number, dur: number): void => {
  for (let k = 0; k < dur; k += 0.8) hiss(s, at + k, 0.9, 210, 260, 1.2, s.v * 1.6, 0, true);
};
const crackle = (s: Stage, at: number, dur: number): void => {
  hiss(s, at, dur, 300, 300, 0.7, s.v * 0.5, 0, true);
  for (let k = 0; k < dur * 12; k++) hiss(s, at + s.r() * dur, 0.015, span(s.r, 1500, 5000), 1500, 1, s.v * span(s.r, 0.3, 0.8), pan(s), false, true);
};
const pour = (s: Stage, at: number): void => {
  hiss(s, at, 0.7, 1100, 1600, 1.5, s.v * 0.7, pan(s));
  for (let i = 0; i < 3; i++) drip(s.kit, s.out, at + 0.6 + i * 0.1, s.v * 0.5, 0);
};
const plane = (s: Stage, at: number): void => hiss(s, at, 0.45, 2200, 3400, 1.5, s.v * 0.8, pan(s));
const ratchet = (s: Stage, at: number): void => {
  for (let i = 0; i < 10; i++) knock(s.kit, s.out, at + i * 0.07, 1700, s.v * 0.35, 0.2);
};
const bubble = (s: Stage, at: number, n: number): void => {
  for (let i = 0; i < n; i++) tone(s, at + s.r() * 0.9, 0.05, 'sine', 220, 480, s.v * 0.3, pan(s), 0, 3, true);
};
const steps = (s: Stage, at: number, f: number, gap: number, vel = 0.8): void => every(s, at - s.t, gap, (x) => knock(s.kit, s.out, x, f * span(s.r, 0.9, 1.1), s.v * vel, pan(s, 0.2)));
const clash = (s: Stage, at: number): void => {
  anvil(s.kit, s.out, at, span(s.r, 1300, 1800), s.v * 0.7, pan(s));
  hiss(s, at, 0.1, 3500, 3500, 1, s.v * 0.5, 0, false, true);
};
const shout = (s: Stage, at: number, high?: number): number => voice(s.kit, s.out, at, 2, s.v, pan(s), true, high);
const murmur = (s: Stage, at: number, n: number, high?: number): void => {
  for (let j = 0; j < n; j++) voice(s.kit, s.out, at + s.r() * 0.5, 2 + Math.floor(s.r() * 3), s.v * 0.55, pan(s, 0.6), false, high);
};
const wind = (s: Stage, at: number): void => hiss(s, at, Math.min(1.8, s.end - at + 0.2), 450, 700, 0.9, s.v * 1.2, pan(s), true);

/** Напевы — те же лады, что у сценок (`skits.ts`). */
const LUTE = [62, 64, 65, 67, 69, 71, 72];
const CHANT = [50, 50, 52, 53, 52, 50, 48, 50];
const BALLAD = [57, 59, 60, 62, 64, 62, 60, 59, 57];
const PIPE = [74, 76, 79, 76, 74, 72, 74, 71];
const HUM = [64, 62, 60, 62, 64, 64];

const lute = (s: Stage, at: number, n: number): void => {
  const p = pan(s);
  for (let i = 0; i < n && at + i * 0.3 < s.end; i++) pluck(s.kit, s.out, at + i * 0.3, LUTE[Math.floor(s.r() * LUTE.length)], s.v * 1.2, p);
};
const mugs = (s: Stage, at: number): void => {
  for (let i = 0; i < 3; i++) clink(s.kit, s.out, at + i * 0.05, s.v * 0.8, pan(s));
};
const coins = (s: Stage, at: number, n: number): void => {
  for (let i = 0; i < n; i++) clink(s.kit, s.out, at + i * span(s.r, 0.06, 0.13), s.v * 0.7, 0.1);
};
const chant = (s: Stage, at: number, vel: number): void => {
  sing(s.kit, s.out, at, CHANT.slice(0, Math.max(2, Math.floor((s.end - at) / 0.55))), 0.55, s.v * vel, 0);
};

// ---------- Здания ----------

export const HALL_VOICES: Record<BuildingTypeId, HallVoice> = {
  // Площадь: колодец, огненная чаша и людской гомон.
  campfire: {
    day: [
      (s) => (creak(s.kit, s.out, s.t, 1.1, s.v * 0.7, -0.2), pour(s, s.t + 1)),
      (s) => crackle(s, s.t, s.dur - 0.3),
      (s) => (murmur(s, s.t, 2), laugh(s.kit, s.out, some(s, 0.6), s.v * 0.6, pan(s))),
      (s) => (voice(s.kit, s.out, s.t, 3, s.v * 0.8, pan(s), false, span(s.r, 340, 450)), laugh(s.kit, s.out, s.t + 0.9, s.v * 0.7, pan(s), 380)),
    ],
    more: [(s) => crackle(s, s.t + 0.2, s.dur - 0.6), (s) => murmur(s, s.t + 0.3, 2)],
  },
  // Ратуша: перо, печать, шёпот писарей.
  town_hall: {
    day: [
      (s) => (quill(s, s.t, 8), seal(s, s.end - 0.3)),
      (s) => (whisper(s, s.t, 4), page(s, some(s, 0.6))),
      (s) => (page(s, s.t), quill(s, s.t + 0.4, 6)),
      (s) => (seal(s, s.t + 0.1), seal(s, s.t + 0.7), whisper(s, s.t + 1.1, 3)),
    ],
    more: [(s) => whisper(s, s.t + 0.3, 5), (s) => (quill(s, s.t + 0.2, 4), coins(s, some(s, 0.5), 3))],
  },
  // Дома: дети, собака, бельё вальком, колыбельная.
  houses: {
    day: [
      (s) => (voice(s.kit, s.out, s.t, 3, s.v, pan(s), false, span(s.r, 360, 460)), laugh(s.kit, s.out, s.t + 1, s.v * 0.8, pan(s), 400)),
      (s) => bark(s.kit, s.out, s.t + 0.1, s.v, pan(s, 0.7)),
      (s) => every(s, 0.05, 0.42, (at) => (knock(s.kit, s.out, at, 210, s.v * 1.1, -0.2), hiss(s, at, 0.08, 1200, 1200, 1, s.v * 0.4, -0.2, false, true))),
      (s) => sing(s.kit, s.out, s.t, HUM.slice(0, 4), 0.42, s.v * 0.7, 0.1, 0.2),
    ],
    more: [(s) => voice(s.kit, s.out, some(s, 0.3), 2, s.v * 0.6, pan(s), false, span(s.r, 210, 260)), (s) => (creak(s.kit, s.out, s.t + 0.2, 0.5, s.v * 0.5, 0.4), knock(s.kit, s.out, s.t + 0.75, 120, s.v, 0.4))],
  },
  // Склад: мешки, бочка катится, ящик скрипит, счёт вслух.
  storage: {
    day: [
      (s) => every(s, 0.1, 0.55, (at) => (knock(s.kit, s.out, at, 70, s.v * 1.6, pan(s)), hiss(s, at, 0.12, 400, 300, 0.8, s.v * 0.6, 0, true, true))),
      (s) => (hiss(s, s.t, 1.2, 180, 240, 1, s.v * 1.4, -0.3, true), knock(s.kit, s.out, s.t + 1.2, 90, s.v * 1.3, 0.2)),
      (s) => (creak(s.kit, s.out, s.t, 0.7, s.v * 0.7, 0.2), knock(s.kit, s.out, s.t + 0.8, 140, s.v, 0.2)),
      (s) => every(s, 0, 0.5, (at) => voice(s.kit, s.out, at, 1, s.v * 0.7, 0, false, 140)),
    ],
    more: [(s) => knock(s.kit, s.out, some(s, 0.4), 75, s.v * 1.3, pan(s)), (s) => voice(s.kit, s.out, s.t + 0.5, 2, s.v * 0.5, pan(s), false)],
  },
  // Лесопилка: пила, топор, водяное колесо, бревно.
  sawmill: {
    day: [
      (s) => rasp(s, s.t, Math.floor((s.dur - 0.3) / 0.24)),
      (s) => every(s, 0.05, 0.6, (at) => chop(s, at)),
      (s) => (creak(s.kit, s.out, s.t, s.dur - 0.3, s.v * 0.6, -0.3), every(s, 0.2, 0.5, (at) => hiss(s, at, 0.35, 1200, 900, 1, s.v * 0.5, -0.3))),
      (s) => (knock(s.kit, s.out, s.t, 60, s.v * 1.8, 0), hiss(s, s.t, 0.4, 250, 200, 0.8, s.v * 0.9, 0, true, true), shout(s, s.t + 0.6, 160)),
    ],
    more: [(s) => chop(s, some(s, 0.3)), (s) => creak(s.kit, s.out, s.t + 0.2, s.dur - 0.7, s.v * 0.4, -0.4)],
  },
  // Охотничий двор (ЗД-1): рог и лес — охотничий рожок с псами, тетива, птицы над опушкой, напев сборщиц и шорох корзин.
  hunter_hut: {
    day: [
      (s) => (horn(s.kit, s.out, s.t, 57, 1.1, s.v * 0.6), bark(s.kit, s.out, s.t + 1.2, s.v * 0.8, pan(s, 0.6))),
      (s) => (pluck(s.kit, s.out, s.t, 40, s.v * 1.3, 0), knock(s.kit, s.out, s.t + 0.25, 300, s.v * 0.7, 0.3), bark(s.kit, s.out, s.t + 0.9, s.v * 0.7, -0.4)),
      (s) => (bird(s.kit, s.out, s.t, 'trill', s.v, pan(s, 0.8)), bird(s.kit, s.out, s.t + 1, 'warble', s.v * 0.8, pan(s, 0.8)), every(s, 0.4, 0.3, (at) => hiss(s, at, 0.06, 3000, 2400, 1.2, s.v * 0.3, pan(s), false, true))),
      (s) => (sing(s.kit, s.out, s.t, HUM, 0.32, s.v * 0.65, -0.2, 0.15), every(s, 0.2, 0.36, (at) => hiss(s, at, 0.07, 3200, 2600, 1.2, s.v * 0.45, pan(s), false, true))),
    ],
    more: [(s) => bird(s.kit, s.out, some(s, 0.4), 'whistle', s.v * 0.7, pan(s, 0.8)), (s) => bark(s.kit, s.out, some(s, 0.5), s.v * 0.6, pan(s, 0.7))],
  },
  // Шахта (ЗД-1): кирка, тачка, эхо — кирки под землёй с отзвуком из штольни, тачка по доскам, клин по камню забоя,
  // окрик и капель. Клинья и осыпь — прежней каменоломни, на её силе (`QUARRY_K`).
  mine: {
    day: [
      (s) => every(s, 0, 0.45, (at) => (knock(s.kit, s.out, at, span(s.r, 600, 900), s.v, pan(s)), knock(s.kit, s.out, at + 0.12, 500, s.v * 0.3, 0), knock(s.kit, s.out, at + 0.26, 480, s.v * 0.12, 0))),
      (s) => (creak(s.kit, s.out, s.t, s.dur - 0.4, s.v * 0.7, 0.3), every(s, 0.1, 0.3, (at) => knock(s.kit, s.out, at, 140, s.v * 0.5, 0.3))),
      (s) => every(s, 0.05, 0.7, (at) => (knock(s.kit, s.out, at, 230, s.v * 1.5 * QUARRY_K, pan(s)), anvil(s.kit, s.out, at + 0.02, span(s.r, 1700, 2100), s.v * 0.5 * QUARRY_K, 0.2), hiss(s, at, 0.1, 2400, 2400, 1, s.v * 0.6 * QUARRY_K, 0, false, true))),
      (s) => (voice(s.kit, s.out, s.t, 2, s.v * 0.6, 0, true, 120), voice(s.kit, s.out, s.t + 0.3, 2, s.v * 0.18, 0, true, 120), every(s, 0.9, 0.4, (at) => drip(s.kit, s.out, at, s.v * 0.9, pan(s)))),
    ],
    more: [(s) => drip(s.kit, s.out, some(s, 0.3), s.v * 0.6, pan(s)), (s) => (every(s, 0.2, 0.13, (at) => knock(s.kit, s.out, at, span(s.r, 160, 400), s.v * span(s.r, 0.4, 0.9) * QUARRY_K, pan(s))), hiss(s, s.t + 0.2, 1, 600, 300, 0.8, s.v * QUARRY_K, 0, true))],
  },
  // Мастерская: рубанок, гвозди, ножовка, клей в горшке.
  workshop: {
    day: [
      (s) => every(s, 0, 0.55, (at) => plane(s, at)),
      (s) => every(s, 0.05, 0.3, (at, i) => knock(s.kit, s.out, at, i % 3 === 2 ? 700 : 950, s.v * 0.9, 0.1)),
      (s) => {
        for (let i = 0; i < 8; i++) hiss(s, s.t + i * 0.15, 0.13, i % 2 ? 3400 : 2800, 3000, 3, s.v * 0.6, -0.1);
      },
      (s) => (bubble(s, s.t, 8), knock(s.kit, s.out, s.t + 1, 500, s.v * 0.6, 0.2)),
    ],
    more: [(s) => knock(s.kit, s.out, some(s, 0.3), 900, s.v * 0.6, -0.4), (s) => plane(s, some(s, 0.4))],
  },
  // Ферма (ЗД-1): мельница и скот — крылья и жернов пристроенной мельницы, корова и овцы, свиньи и куры, пастуший
  // рожок над загоном. Голоса загона — на его прежней силе (`PEN_K`).
  farm: {
    day: [
      (s) => (creak(s.kit, s.out, s.t, s.dur - 0.3, s.v * 0.6, 0.3), every(s, 0.2, 0.7, (at) => hiss(s, at, 0.55, 520, 320, 1, s.v * 0.7, 0.3)), grind(s, s.t, s.dur - 0.6)),
      (s) => (moo(s, s.t + 0.1), bleat(s.kit, s.out, s.t + 1, s.v * 0.8 * PEN_K, 0.3)),
      (s) => (grunt({ ...s, v: s.v * PEN_K }, s.t), cluck(s, s.t + 0.7), grunt({ ...s, v: s.v * PEN_K }, s.t + 1.2)),
      (s) => {
        for (let i = 0; i < 5; i++) flute(s.kit, s.out, s.t + i * 0.32, 0.3, PIPE[i % PIPE.length], s.v * 0.8 * PEN_K);
      },
    ],
    more: [(s) => cluck(s, some(s, 0.4)), (s) => bleat(s.kit, s.out, some(s, 0.5), s.v * 0.6 * PEN_K, pan(s, 0.7))],
  },
  // Храм: колокол и хорал.
  church: {
    day: [
      (s) => (bell(s.kit, s.out, s.t, 196, s.v * 0.8), bell(s.kit, s.out, s.t + 1.1, 196, s.v * 0.6)),
      (s) => chant(s, s.t, 0.9),
      (s) => (bell(s.kit, s.out, s.t, 110, s.v * 0.9), chant(s, s.t + 0.8, 0.6)),
      (s) => (voice(s.kit, s.out, s.t, 5, s.v * 0.8, 0, false, 118), bell(s.kit, s.out, s.t + 1.3, 294, s.v * 0.4)),
    ],
    more: [(s) => sing(s.kit, s.out, s.t + 0.1, CHANT.slice(0, 3).map((n) => n + 7), 0.6, s.v * 0.4, 0.2), (s) => sing(s.kit, s.out, s.t + 0.15, CHANT.slice(0, 3).map((n) => n - 12), 0.6, s.v * 0.35, -0.2)],
  },
  // Статуя Героя: клятва у подножия, голуби, ветер.
  statue: {
    day: [
      (s) => (voice(s.kit, s.out, s.t, 4, s.v, 0, false, 125), voice(s.kit, s.out, s.t + 1.2, 1, s.v * 0.8, 0, true, 170)),
      (s) => (coo(s, s.t), coo(s, s.t + 0.9)),
      (s) => (flap(s, s.t), coo(s, s.t + 0.7)),
      (s) => (wind(s, s.t), caw(s, s.t + 0.5)),
    ],
    more: [(s) => murmur(s, s.t + 0.4, 2), (s) => flap(s, some(s, 0.5))],
  },
  // Лазарет: стон за ширмой, вода в таз, пест в ступке, отвар на огне.
  infirmary: {
    day: [
      (s) => (voice(s.kit, s.out, s.t, 1, s.v * 0.8, -0.2, false, 95), voice(s.kit, s.out, s.t + 1, 1, s.v * 0.6, -0.2, false, 90)),
      (s) => pour(s, s.t),
      (s) => every(s, 0, 0.36, (at) => knock(s.kit, s.out, at, 420, s.v * 0.9, 0.2)),
      (s) => (bubble(s, s.t, 10), bubble(s, s.t + 0.9, 8)),
    ],
    more: [(s) => voice(s.kit, s.out, s.t + 0.5, 3, s.v * 0.4, 0.3, false, 230), (s) => voice(s.kit, s.out, some(s, 0.6), 1, s.v * 0.5, -0.4, false, 100)],
  },
  // Дозор: рожок, ветер на вышке, ворон, флаг.
  watch: {
    day: [
      (s) => horn(s.kit, s.out, s.t, 62, 0.9, s.v * 0.5),
      (s) => (wind(s, s.t), every(s, 0.3, 0.25, (at) => hiss(s, at, 0.08, 900, 800, 0.8, s.v * 0.4, 0.4, false, true))),
      (s) => caw(s, s.t + 0.1),
      (s) => (voice(s.kit, s.out, s.t, 2, s.v * 0.9, 0.3, true, 180), knock(s.kit, s.out, s.t + 1, 130, s.v, 0)),
    ],
    more: [(s) => wind(s, s.t + 0.2), (s) => caw(s, s.t + 0.6)],
  },
  // Конюшня: ржание, копыта, ведро, фырканье.
  stable: {
    day: [
      (s) => neigh(s, s.t),
      (s) => hooves(s, s.t, Math.floor((s.dur - 0.4) / 0.24)),
      (s) => (knock(s.kit, s.out, s.t, 500, s.v, 0.3), pour(s, s.t + 0.2)),
      (s) => (hiss(s, s.t, 0.3, 650, 450, 1, s.v * 0.8, 0, false, true), hooves(s, s.t + 0.5, 3), hiss(s, s.t + 1.3, 0.3, 650, 450, 1, s.v * 0.7, 0, false, true)),
    ],
    more: [(s) => hooves(s, some(s, 0.3), 3), (s) => (chain(s, s.t + 0.2, 4), neigh(s, s.t + 0.5))],
  },
  // Тайник: дверь подвала, ключ, капель, бочка.
  cache: {
    day: [
      (s) => (creak(s.kit, s.out, s.t, 0.9, s.v * 0.8, 0), knock(s.kit, s.out, s.t + 0.95, 90, s.v * 1.3, 0)),
      (s) => (chain(s, s.t, 4), knock(s.kit, s.out, s.t + 0.5, 700, s.v * 0.6, 0)),
      (s) => every(s, 0, 0.5, (at) => drip(s.kit, s.out, at, s.v * 0.8, pan(s))),
      (s) => (knock(s.kit, s.out, s.t, 110, s.v * 1.2, 0.2), knock(s.kit, s.out, s.t + 0.3, 110, s.v * 1.1, 0.2), whisper(s, s.t + 0.8, 3)),
    ],
    more: [(s) => drip(s.kit, s.out, some(s, 0.3), s.v * 0.5, pan(s)), (s) => whisper(s, s.t + 0.4, 2)],
  },
  // Трактир: гомон, смех, кружки, лютня. Ночью — громче и с песней.
  tavern: {
    day: [
      (s) => (murmur(s, s.t, 3), laugh(s.kit, s.out, s.t + 0.8, s.v * 0.8, pan(s))),
      (s) => (mugs(s, s.t + 0.1), voice(s.kit, s.out, s.t + 0.4, 2, s.v, pan(s), true), mugs(s, s.t + 1.2)),
      (s) => lute(s, s.t, 6),
      (s) => (laugh(s.kit, s.out, s.t, s.v, pan(s)), laugh(s.kit, s.out, s.t + 0.5, s.v * 0.7, pan(s), 300)),
    ],
    more: [(s) => lute(s, s.t + 0.3, 4), (s) => (murmur(s, s.t + 0.2, 3), mugs(s, some(s, 0.5)))],
    night: [
      (s) => (sing(s.kit, s.out, s.t, BALLAD.slice(0, 5), 0.38, s.v, 0.1, 0.4), sing(s.kit, s.out, s.t + 0.1, BALLAD.slice(0, 5).map((n) => n - 12), 0.38, s.v * 0.7, -0.2, 0.6)),
      (s) => (for3(s, (at) => voice(s.kit, s.out, at, 2, s.v, pan(s), true)), mugs(s, s.t + 0.6), laugh(s.kit, s.out, s.t + 1.1, s.v, pan(s))),
      (s) => (lute(s, s.t, 6), murmur(s, s.t + 0.2, 3)),
      (s) => (laugh(s.kit, s.out, s.t, s.v, -0.3), laugh(s.kit, s.out, s.t + 0.3, s.v * 0.9, 0.3), mugs(s, s.t + 1)),
    ],
    nightGain: 1.4,
  },
  // Стены и ворота: цепи, скрип ворот, шаг стражи на боевом ходу, перекличка.
  palisade: {
    day: [
      (s) => (chain(s, s.t, 10), chain(s, s.t + 0.9, 8)),
      (s) => gate(s, s.t),
      (s) => steps(s, s.t, 120, 0.55),
      (s) => (voice(s.kit, s.out, s.t, 2, s.v, -0.4, true, 170), voice(s.kit, s.out, s.t + 1.1, 2, s.v * 0.6, 0.5, true, 160)),
    ],
    more: [(s) => chain(s, some(s, 0.3), 6), (s) => steps(s, s.t + 0.2, 110, 0.6, 0.5)],
  },
  // Башня: ветер в бойницах, ворот баллисты, тетива, смола в котле.
  tower: {
    day: [
      (s) => wind(s, s.t),
      (s) => (ratchet(s, s.t), knock(s.kit, s.out, s.t + 0.9, 160, s.v * 1.4, 0)),
      (s) => (pluck(s.kit, s.out, s.t, 43, s.v * 1.3, 0.2), pluck(s.kit, s.out, s.t + 0.8, 45, s.v * 1.1, -0.2)),
      (s) => (bubble(s, s.t, 12), crackle(s, s.t, 1.2)),
    ],
    more: [(s) => wind(s, s.t + 0.3), (s) => steps(s, s.t + 0.2, 120, 0.6, 0.5)],
  },
  // Кузница: молот по наковальне, шипение воды, мехи, точило. Ночью горн погашен — молчит.
  smithy: {
    day: [
      (s) => every(s, 0, 0.38, (at, i) => hammer(s, at, i % 3 === 2 ? 640 : 820)),
      (s) => (hammer(s, s.t), hammer(s, s.t + 0.35), quench(s, s.t + 0.8)),
      (s) => (bellows(s, s.t), bellows(s, s.t + 0.8), hammer(s, s.t + 1.5)),
      (s) => every(s, 0, 0.6, (at) => hiss(s, at, 0.5, 3800, 3600, 4, s.v * 0.5, 0.2)),
    ],
    more: [(s) => bellows(s, s.t + 0.2), (s) => every(s, 0.19, 0.76, (at) => hammer(s, at, 1100))],
    night: [],
  },
  // Рынок: торг, звон монет, весы.
  market: {
    day: [
      (s) => (voice(s.kit, s.out, s.t, 3, s.v, -0.3, false, span(s.r, 110, 140)), voice(s.kit, s.out, s.t + 0.9, 3, s.v, 0.3, false, span(s.r, 220, 270))),
      (s) => (coins(s, s.t, 5), voice(s.kit, s.out, s.t + 0.8, 2, s.v * 0.8, 0, false)),
      (s) => (voice(s.kit, s.out, s.t, 3, s.v, pan(s), true, 200), murmur(s, s.t + 0.8, 2)),
      (s) => (knock(s.kit, s.out, s.t, 900, s.v * 0.7, 0.2), coins(s, s.t + 0.3, 4), laugh(s.kit, s.out, s.t + 1, s.v * 0.6, pan(s))),
    ],
    more: [(s) => murmur(s, s.t + 0.3, 3), (s) => coins(s, some(s, 0.5), 3)],
  },
  // Казармы: шаг строя, лязг, окрик сержанта без слов, учебный бой.
  barracks: {
    day: [
      (s) => every(s, 0, 0.5, (at) => (knock(s.kit, s.out, at, 110, s.v * 1.2, -0.1), knock(s.kit, s.out, at + 0.02, 120, s.v, 0.1), clink(s.kit, s.out, at + 0.03, s.v * 0.3, 0))),
      (s) => (shout(s, s.t, 150), every(s, 1, 0.5, (at) => knock(s.kit, s.out, at, 110, s.v * 1.2, 0))),
      (s) => (clash(s, s.t), knock(s.kit, s.out, s.t + 0.4, 300, s.v, 0.2), clash(s, s.t + 0.9)),
      (s) => (chain(s, s.t, 8), voice(s.kit, s.out, s.t + 0.8, 3, s.v * 0.6, pan(s), false)),
    ],
    more: [(s) => every(s, 0.25, 0.5, (at) => knock(s.kit, s.out, at, 115, s.v * 0.7, 0.3)), (s) => clash(s, some(s, 0.6))],
  },
};

/** Три выкрика вразнобой — тост. */
function for3(s: Stage, f: (at: number) => void): void {
  for (let i = 0; i < 3; i++) f(s.t + i * 0.08);
}

/** Тревога: звон оружия, бег, набат, крик — поверх дома (`ALARM_HOME`). */
export const ALARM_VOICES: readonly Layer[] = [
  (s) => (clash(s, s.t), clash(s, s.t + 0.45), shout(s, s.t + 0.9)),
  (s) => (every(s, 0, 0.16, (at) => knock(s.kit, s.out, at, span(s.r, 100, 150), s.v * 0.8, pan(s))), chain(s, s.t + 0.2, 8)),
  (s) => (every(s, 0, 0.42, (at) => bell(s.kit, s.out, at, 392, s.v * 0.35)), shout(s, s.t + 0.6, 220)),
  (s) => (horn(s.kit, s.out, s.t, 50, 0.8, s.v * 0.6), clash(s, s.t + 1), chain(s, s.t + 1.2, 6)),
];

/** Ночной фон дома, тише дня: сверчки. */
const NIGHT_BED: Layer = (s) => void cricket(s.kit, s.out, s.t + 0.1, Math.floor((s.end - s.t) / 0.5), s.v * 0.6, pan(s, 0.6));

/** Что прозвучало — для тестов и стенда. */
export interface HallPlay {
  type: BuildingTypeId;
  mood: HallMood;
  variant: number;
  layers: number;
  /** Самая громкая сила слоя на выходе (`HALL_MIX` здания, умноженная на долю слоя). */
  peak: number;
  t: number;
  dur: number;
}

/** Голоса зданий на одном выходе: один голос за раз, своё «не чаще» у каждого здания. */
export class HallVoices {
  private kit: Kit;
  private last = new Map<string, number>();
  private lastAt = new Map<BuildingTypeId, number>();
  private fade: GainNode | null = null;

  constructor(
    kit: Kit,
    private out: AudioNode,
  ) {
    // Без отзвука: он идёт в выход фона, а голос здания — весь в «эффектах», под их громкостью.
    this.kit = { ...kit, space: null };
  }

  /** Касание здания в `at`. Вернуть, что прозвучало; `null` — рано (`HALL_GAP`) или здание молчит. */
  play(type: BuildingTypeId, level: number, mood: HallMood, at: number): HallPlay | null {
    const def = HALL_VOICES[type];
    if (!def) return null;
    const was = this.lastAt.get(type);
    if (was !== undefined && at - was < HALL_GAP) return null;
    const set = mood === 'alarm' ? ALARM_VOICES : mood === 'night' ? (def.night ?? def.day) : def.day;
    if (set.length === 0) return null;
    const r = this.kit.rnd;
    const key = `${type}:${mood}`;
    const prev = this.last.get(key);
    const variant = prev === undefined || set.length < 2 ? Math.floor(r() * set.length) : (prev + 1 + Math.floor(r() * (set.length - 1))) % set.length;
    this.last.set(key, variant);
    this.lastAt.set(type, at);

    const ctx = this.kit.ctx;
    // Прежний голос гаснет мягко, а не обрывается: свой усилитель «смены» у каждого голоса, без расписания — гасить нечего отменять.
    this.fade?.gain.setTargetAtTime(0, at, HALL_SWAP);
    const fade = ctx.createGain();
    fade.connect(this.out);
    this.fade = fade;
    const dur = span(r, 1.9, 2.7);
    const shape = ctx.createGain();
    shape.gain.value = 0;
    shape.gain.setValueAtTime(0, at);
    shape.gain.linearRampToValueAtTime(1, at + 0.04);
    shape.gain.setValueAtTime(1, at + dur - 0.35);
    shape.gain.linearRampToValueAtTime(0, at + dur);
    shape.connect(fade);

    const quiet = mood === 'night' && def.night === undefined;
    const gain = quiet ? NIGHT_GAIN : mood === 'night' ? (def.nightGain ?? 1) : 1;
    let peak = 0;
    const stage = (v: number): Stage => {
      peak = Math.max(peak, HALL_MIX[type] * v);
      return { kit: this.kit, out: shape, r, t: at, dur, end: at + dur - 0.3, v: HALL_MIX[type] * v };
    };
    // Уровень слышен всегда: слои богатства — и днём, и ночью, и под звоном тревоги.
    const rich = layersAt(level);
    set[variant](stage(gain));
    let layers = 1;
    if (mood === 'alarm') {
      def.day[Math.floor(r() * def.day.length)](stage(ALARM_HOME));
      layers++;
    }
    const home = mood === 'alarm' ? ALARM_HOME : gain * 0.7;
    for (let i = 1; i < rich; i++, layers++) def.more[i - 1](stage(home));
    if (quiet) {
      NIGHT_BED(stage(gain));
      layers++;
    }
    return { type, mood, variant, layers, peak, t: at, dur };
  }
}
