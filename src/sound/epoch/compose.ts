// Музыка эпохи: пьеса из зерна (docs/audio.md, раздел 5).
//
// Чистая функция без Web Audio: ноты и сроки, а звучит их `sound/epoch/music.ts`. Отдельно затем, чтобы обещания музыки
// — лад, каденция, форма, вариации, длина и паузы — держал тест, а не ухо.
//
// Как пьеса устроена — по-средневековому просто:
//   лад         дорийский, миксолидийский, эолийский или фригийский от одной из четырёх финалис;
//   бурдон      финалис и квинта двумя октавами ниже мелодии — тянется всю пьесу, входит раньше мелодии и уходит позже;
//   форма       A A′ B A″: четыре фразы по четыре такта, A — на полукаденции (квинта), A′ и A″ — на финалисе, B — выше
//               и тоже на квинте. A′ и A″ — вариации A: часть нот расщеплена, часть сдвинута на соседнюю ступень, а
//               каденция стоит на месте;
//   голоса      лютня (щипок) и дудочка; кто ведёт какую фразу — план пьесы; под мелодией лютня щиплет финалис и
//               квинту на сильные доли;
//   паузы       между пьесами — тишина музыки на 15–45 с: фон города идёт, а музыка не надоедает.

import { int, pick, span, weighted, type Rng } from './rng';

/** Лады: шаги от финалиса в полутонах. */
export const MODES = {
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
} as const;

export type ModeName = keyof typeof MODES;

/** Финалис мелодии лютни (MIDI): ре, ми, до, ля малой октавы — у лютни и дудочки всё в удобном месте. */
const TONICS = [62, 64, 60, 57] as const;

/** Голос. */
export type Voice = 'lute' | 'flute';

export interface Note {
  /** Начало от начала пьесы, с. */
  at: number;
  /** Длительность, с. */
  dur: number;
  midi: number;
  voice: Voice;
  /** Сила, 0..1. */
  vel: number;
  /** Ступень лада от финалиса (0 — финалис, 7 — октава) — для теста и вариаций; у аккомпанемента — тоже. */
  degree: number;
  /** Нота мелодии (а не аккомпанемента). */
  lead: boolean;
}

export interface Piece {
  mode: ModeName;
  /** Финалис мелодии, MIDI. */
  tonic: number;
  bpm: number;
  /** Долей в такте. */
  meter: 3 | 4;
  /** Длина вместе со вступлением бурдона и его уходом, с. */
  length: number;
  notes: Note[];
  /** Бурдон: MIDI тянущихся нот. */
  drone: number[];
  /** Где начинается каждая фраза и чем она кончается: ступень последней ноты. */
  phrases: { at: number; end: number; name: string }[];
}

export interface ComposeOpts {
  /** Слабый телефон: без удвоения голосов и без второй ноты бурдона. */
  lite?: boolean;
}

/** Вступление бурдона перед мелодией и его уход после, с. */
export const DRONE_LEAD = 5;
export const DRONE_TAIL = 5;

/** Пауза музыки между пьесами, с. */
export const PAUSE_MIN = 15;
export const PAUSE_MAX = 45;

/** Ритмы такта (в долях). Последний такт фразы — свой: долгая нота каденции. */
const BAR: Record<3 | 4, readonly (readonly number[])[]> = {
  3: [[1, 1, 1], [2, 1], [1.5, 0.5, 1], [1, 0.5, 0.5, 1], [0.5, 0.5, 1, 1]],
  4: [[1, 1, 1, 1], [2, 1, 1], [1, 1, 2], [1.5, 0.5, 1, 1], [1, 0.5, 0.5, 2], [0.5, 0.5, 1, 1, 1]],
};
const CADENCE_BAR: Record<3 | 4, readonly (readonly number[])[]> = {
  3: [[1, 2], [3]],
  4: [[1, 1, 2], [2, 2], [1, 3]],
};

/** Шаги мелодии по ступеням: в основном поступенно, изредка скачок. */
const STEPS: readonly (readonly [number, number])[] = [
  [-1, 3],
  [1, 3],
  [-2, 1.2],
  [2, 1.2],
  [0, 0.5],
  [3, 0.4],
  [-3, 0.4],
  [4, 0.3],
  [-4, 0.3],
];

/** Нижняя и верхняя ступени мелодии. */
const LOW = -2;
const HIGH = 9;

/** MIDI ступени лада от финалиса. */
export function midiOf(mode: ModeName, tonic: number, degree: number): number {
  const scale = MODES[mode];
  const oct = Math.floor(degree / 7);
  const d = degree - oct * 7;
  return tonic + oct * 12 + scale[d];
}

interface Cell {
  /** Доля от начала фразы. */
  beat: number;
  beats: number;
  degree: number;
}

/** Фраза: четыре такта, кончается на `end` поступенным подходом сверху. */
function phrase(rnd: Rng, meter: 3 | 4, start: number, end: number, high: boolean): Cell[] {
  const cells: Cell[] = [];
  let beat = 0;
  for (let bar = 0; bar < 4; bar++) {
    const rhythm = pick(rnd, bar === 3 ? CADENCE_BAR[meter] : BAR[meter]);
    for (const beats of rhythm) {
      cells.push({ beat, beats, degree: 0 });
      beat += beats;
    }
  }
  // Ступени: случайное блуждание, после скачка — шаг назад; хвост — каденция.
  let d = start;
  let leap = 0;
  const lo = high ? LOW + 3 : LOW;
  for (let i = 0; i < cells.length; i++) {
    cells[i].degree = d;
    let step = leap !== 0 ? -Math.sign(leap) : weighted(rnd, STEPS);
    leap = Math.abs(step) >= 3 ? step : 0;
    let next = d + step;
    if (next < lo || next > HIGH) {
      step = -step;
      next = d + step;
      leap = 0;
    }
    d = next;
  }
  const n = cells.length;
  cells[n - 1].degree = end;
  cells[n - 2].degree = end + 1;
  // Каденция поставлена поверх блуждания — сгладить подход к ней с конца: скачок к опоре не шире квинты.
  for (let i = n - 3; i >= 0; i--) {
    const gap = cells[i].degree - cells[i + 1].degree;
    if (Math.abs(gap) <= 4) break;
    cells[i].degree = cells[i + 1].degree + Math.sign(gap) * 2;
  }
  return cells;
}

/**
 * Вариация фразы: каденция (две последние ноты) на месте, в остальном — расщеплённые долгие ноты и сдвиги на соседнюю
 * ступень. Узнаётся, но не повторяется.
 */
function vary(rnd: Rng, cells: Cell[]): Cell[] {
  const out: Cell[] = [];
  const keep = cells.length - 2;
  let changed = false;
  cells.forEach((c, i) => {
    if (i >= keep) {
      out.push({ ...c });
      return;
    }
    const r = rnd();
    if (c.beats >= 1 && r < 0.3) {
      const half = c.beats / 2;
      const nb = c.degree + (rnd() < 0.5 ? 1 : -1);
      out.push({ beat: c.beat, beats: half, degree: c.degree });
      out.push({ beat: c.beat + half, beats: half, degree: nb >= LOW && nb <= HIGH ? nb : c.degree });
      changed = true;
    } else if (r < 0.5 && i > 0) {
      const nd = c.degree + (rnd() < 0.5 ? 1 : -1);
      out.push({ ...c, degree: nd >= LOW && nd <= HIGH ? nd : c.degree });
      changed = changed || nd !== c.degree;
    } else out.push({ ...c });
  });
  // Вариация, совпавшая с темой, — не вариация: тронем хотя бы одну ноту.
  if (!changed && keep > 1) {
    const i = 1 + Math.floor(rnd() * (keep - 1));
    out[i] = { ...out[i], degree: out[i].degree < HIGH ? out[i].degree + 1 : out[i].degree - 1 };
  }
  return out;
}

/** Кто ведёт какую фразу. */
const PLANS: readonly (readonly Voice[])[] = [
  ['lute', 'lute', 'flute', 'flute'],
  ['flute', 'flute', 'lute', 'flute'],
  ['lute', 'flute', 'lute', 'lute'],
  ['flute', 'lute', 'flute', 'lute'],
];

/** Сочинить пьесу. */
export function compose(rnd: Rng, opts: ComposeOpts = {}): Piece {
  const mode = weighted<ModeName>(rnd, [
    ['dorian', 3],
    ['mixolydian', 2],
    ['aeolian', 2],
    ['phrygian', 1],
  ]);
  const tonic = pick(rnd, TONICS);
  const meter: 3 | 4 = rnd() < 0.45 ? 3 : 4;
  const bpm = int(rnd, 62, 80);
  const beat = 60 / bpm;
  const plan = pick(rnd, PLANS);

  const a = phrase(rnd, meter, pick(rnd, [0, 2, 4]), 4, false);
  const a1 = vary(rnd, a);
  a1[a1.length - 1].degree = 0;
  a1[a1.length - 2].degree = 1;
  const b = phrase(rnd, meter, pick(rnd, [4, 5, 7]), 4, true);
  const a2 = vary(rnd, a1);
  const form: { name: string; cells: Cell[] }[] = [
    { name: 'A', cells: a },
    { name: 'A′', cells: a1 },
    { name: 'B', cells: b },
    { name: 'A″', cells: a2 },
  ];

  const notes: Note[] = [];
  const phrases: Piece['phrases'] = [];
  const phraseBeats = meter * 4;
  let at = DRONE_LEAD;
  form.forEach((f, k) => {
    const voice = plan[k];
    phrases.push({ at, end: f.cells[f.cells.length - 1].degree, name: f.name });
    // Дудочка — октавой выше лютни, если финалис низкий (ля, до); от ре и ми октава выше дала бы свист над шестой
    // октавой, и дудочка остаётся в регистре лютни — их и так не спутать по тембру.
    const lift = voice === 'flute' && tonic <= 60 ? 12 : 0;
    for (const c of f.cells) {
      const downbeat = c.beat % meter === 0;
      notes.push({
        at: at + c.beat * beat,
        // Дудочка держит ноту чуть короче доли — дыхание; лютня звенит своё сама.
        dur: c.beats * beat * (voice === 'flute' ? 0.92 : 1),
        midi: midiOf(mode, tonic, c.degree) + lift,
        voice,
        vel: (downbeat ? 0.85 : 0.68) + span(rnd, -0.06, 0.06),
        degree: c.degree,
        lead: true,
      });
    }
    // Лютня под мелодией: финалис (или квинта на полукаденции) октавой ниже — на сильную долю каждого такта.
    for (let bar = 0; bar < 4; bar++) {
      const half = bar === 3 && phrases[k].end === 4;
      const degree = half ? 4 - 7 : -7;
      const t = at + bar * meter * beat;
      notes.push({ at: t, dur: meter * beat, midi: midiOf(mode, tonic, degree), voice: 'lute', vel: 0.5, degree, lead: false });
      if (!opts.lite && rnd() < 0.35) {
        const off = t + Math.floor(meter / 2 + 0.5) * beat;
        notes.push({ at: off, dur: beat, midi: midiOf(mode, tonic, -3), voice: 'lute', vel: 0.38, degree: -3, lead: false });
      }
    }
    at += phraseBeats * beat;
  });

  notes.sort((x, y) => x.at - y.at);
  const length = at + DRONE_TAIL;
  const drone = opts.lite ? [tonic - 24] : [tonic - 24, tonic - 17];
  return { mode, tonic, bpm, meter, length, notes, drone, phrases };
}

/** Пауза музыки после пьесы, с. */
export const pauseAfter = (rnd: Rng): number => span(rnd, PAUSE_MIN, PAUSE_MAX);
