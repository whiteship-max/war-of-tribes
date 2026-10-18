// Офлайн-отрисовка звука города, музыки эпохи и звуков боя в браузере (`OfflineAudioContext`) — вход для стенда
// `npm run audio:samples` (scripts/audio-samples.ts). Код звука — тот же, что в игре: голоса `sound/epoch/synth`, фон
// `Ambience`, музыка `EpochMusic`, звуки интерфейса `playCue`, звуки боя `battleFx`, цепочка выхода `outputChain`.
// Отличается только время: вместо таймера игры — остановки офлайн-контекста каждые четверть секунды, с тем же шагом и
// тем же окном упреждения, что у живой машинки (`sound/epoch/index.ts`).
import { outputChain } from '@/sound/chain';
import { DEFAULT_GAINS } from '@/sound/settings';
import { makeKit } from '@/sound/epoch/synth';
import { Ambience, type Hearing } from '@/sound/epoch/ambience';
import { EpochMusic } from '@/sound/epoch/music';
import { playCue, type Cue } from '@/sound/epoch/cues';
import { seeded } from '@/sound/epoch/rng';
import { battleFx, type FxAmbience, type FxCue } from '@/sound/battlefx';
import { cueBone, playChamberCue, type ChamberCue } from '../../src/render/chambers/cues';

/** Опорная точка того, что слышит игрок; между точками близость и фаза солнца идут линейно. */
type Key = [number, Hearing];

export interface Sample {
  name: string;
  title: string;
  seconds: number;
  seed: number;
  /** Фон; нет — без фона. */
  keys: Key[] | null;
  music: boolean;
  /** Звуки боя (условный бой: построение, рог, разбег, сшибка, сеча, залп, рог победителя). */
  battle: boolean;
  duck: { music: number; amb: number };
  /** Силы родов на выходе; без них — умолчания игры (`settings.DEFAULT_GAINS`). */
  levels?: { music: number; fx: number; amb: number };
  cues?: [number, Cue][];
  /** Звуки дел в покоях (docs/city_v3.md, Г-6): шаги, кресло, постель, меч. */
  chambers?: [number, ChamberCue][];
  /** Гром: миг, сила и через сколько секунд после вспышки (docs/city.md, 15). */
  thunder?: [number, number, number][];
  /** Только замер: в образцы не пишется. */
  probe?: boolean;
}

const day = (o: Partial<Hearing>): Hearing => ({ view: 'city', solar: 0.25, season: 'summer', near: 0.5, sea: 0, ...o });

export const SAMPLES: Sample[] = [
  {
    name: 'city-day',
    title: 'Город днём, лето: камера с высоты к улицам (4–13 с), колокол полудня',
    seconds: 20,
    seed: 11,
    keys: [
      [0, day({ solar: 0.244, near: 0.05 })],
      [4, day({ solar: 0.246, near: 0.05 })],
      [13, day({ solar: 0.253, near: 0.95 })],
      [20, day({ solar: 0.256, near: 0.95 })],
    ],
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
  },
  {
    name: 'ui',
    title: 'Звуки интерфейса над городом: два касания, стройка готова, тревога (рог)',
    seconds: 10,
    seed: 13,
    keys: [[0, day({ solar: 0.3, near: 0.5 })]],
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
    cues: [
      [1, 'tap'],
      [1.6, 'tap'],
      [3, 'built'],
      [5.5, 'alarm'],
    ],
  },
  {
    name: 'city-morning',
    title: 'Город утром, весна: птицы и колокол утрени',
    seconds: 16,
    seed: 23,
    keys: [
      [0, day({ season: 'spring', solar: 0.012, near: 0.5 })],
      [16, day({ season: 'spring', solar: 0.04, near: 0.5 })],
    ],
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
  },
  {
    name: 'city-night',
    title: 'Город ночью, лето: сверчки, ветер, тишина',
    seconds: 16,
    seed: 37,
    keys: [[0, day({ solar: 0.75, near: 0.5 })]],
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
  },
  {
    name: 'city-winter',
    title: 'Город зимним днём: ветер сильнее, снег глушит, птиц нет',
    seconds: 15,
    seed: 41,
    keys: [[0, day({ season: 'winter', solar: 0.2, near: 0.6 })]],
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
  },
  {
    name: 'city-storm',
    title: 'Гроза над городом: ливень, ветер, гром — близкий с треском (2 с), дальний (9 с)',
    seconds: 16,
    seed: 47,
    keys: [[0, day({ solar: 0.3, near: 0.5, wx: { rain: 1, snow: 0, storm: 1, wind: 0.85 } })]],
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
    thunder: [
      [2, 1, 1.3],
      [9, 0.8, 4.6],
    ],
  },
  {
    name: 'rain-light',
    title: 'Морось над городом, камера у улиц: шелест верхов, дробь по кровлям, капли с карнизов (П-3)',
    seconds: 14,
    seed: 61,
    keys: [[0, day({ solar: 0.3, near: 0.7, wx: { rain: 0.25, snow: 0, storm: 0, wind: 0.4 } })]],
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
  },
  {
    name: 'rain-heavy',
    title: 'Ливень без грозы, камера с высоты: шум и низкий гул воды (П-3)',
    seconds: 14,
    seed: 67,
    keys: [[0, day({ solar: 0.3, near: 0.2, wx: { rain: 0.95, snow: 0, storm: 0, wind: 0.6 } })]],
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
  },
  {
    name: 'map',
    title: 'Карта у Сицилии: ветер и море',
    seconds: 16,
    seed: 53,
    keys: [[0, { view: 'map', solar: 0.3, season: 'summer', near: 0.5, sea: 0.55 }]],
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
  },
  {
    name: 'music',
    title: 'Музыка эпохи: бурдон, лютня, дудочка — начало пьесы',
    seconds: 24,
    seed: 7,
    keys: null,
    music: true,
    battle: false,
    duck: { music: 1, amb: 1 },
  },
  {
    name: 'city-music',
    title: 'Город днём с музыкой — как в игре',
    seconds: 24,
    seed: 101,
    keys: [[0, day({ solar: 0.3, near: 0.55 })]],
    music: true,
    battle: false,
    duck: { music: 1, amb: 1 },
  },
  {
    name: 'battle-ducked',
    title: 'Бой: звуки боя, музыка эпохи и фон города приглушены',
    seconds: 20,
    seed: 7,
    keys: [[0, day({ solar: 0.3, near: 0.55 })]],
    music: true,
    battle: true,
    duck: { music: 0.12, amb: 0.25 },
  },
  {
    name: 'switch',
    title: 'Переход слоёв без событий: зимняя ночь (только постели), камера к улицам за 2 с, карта и назад',
    seconds: 20,
    seed: 3,
    keys: [
      [0, day({ season: 'winter', solar: 0.75, near: 0 })],
      [4, day({ season: 'winter', solar: 0.75, near: 0 })],
      [6, day({ season: 'winter', solar: 0.75, near: 1 })],
      [10, { view: 'map', solar: 0.75, season: 'winter', near: 1, sea: 0.55 }],
      [15, day({ season: 'winter', solar: 0.75, near: 1 })],
    ],
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
    probe: true,
  },
  {
    name: 'worst',
    title: 'Худший случай: всё сразу на полной громкости — запас до перегруза',
    seconds: 20,
    seed: 7,
    keys: [[0, day({ solar: 0.25, near: 1 })]],
    music: true,
    battle: true,
    duck: { music: 1, amb: 1 },
    levels: { music: 1, fx: 1, amb: 1 },
    cues: [
      [3, 'alarm'],
      [8, 'built'],
    ],
    probe: true,
  },
  {
    name: 'chambers',
    title: 'Покои: шаги по доскам, по ковру, сел в кресло, лёг, взял меч, взял и положил кубок',
    seconds: 14,
    seed: 17,
    keys: null,
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
    chambers: [
      [0.3, 'step'],
      [0.8, 'step'],
      [1.3, 'step'],
      [1.8, 'step'],
      [2.3, 'step'],
      [2.8, 'step'],
      [3.4, 'stepSoft'],
      [3.9, 'stepSoft'],
      [4.4, 'stepSoft'],
      [4.9, 'stepSoft'],
      [5.8, 'creak'],
      [7.3, 'rustle'],
      [9.0, 'ring'],
      [11.2, 'take'],
      [12.4, 'put'],
    ],
  },
  {
    name: 'ch-step',
    title: 'Замер покоев: ch-step',
    seconds: 3.5,
    seed: 17,
    keys: null,
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
    chambers: [
      [0.3, 'step'],
      [0.8, 'step'],
      [1.3, 'step'],
      [1.8, 'step'],
      [2.3, 'step'],
      [2.8, 'step'],
    ],
    probe: true,
  },
  {
    name: 'ch-soft',
    title: 'Замер покоев: ch-soft',
    seconds: 3.5,
    seed: 17,
    keys: null,
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
    chambers: [
      [0.3, 'stepSoft'],
      [0.8, 'stepSoft'],
      [1.3, 'stepSoft'],
      [1.8, 'stepSoft'],
      [2.3, 'stepSoft'],
      [2.8, 'stepSoft'],
    ],
    probe: true,
  },
  {
    name: 'ch-creak',
    title: 'Замер покоев: ch-creak',
    seconds: 3.5,
    seed: 17,
    keys: null,
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
    chambers: [
      [0.5, 'creak'],
      [2, 'creak'],
    ],
    probe: true,
  },
  {
    name: 'ch-rustle',
    title: 'Замер покоев: ch-rustle',
    seconds: 3.5,
    seed: 17,
    keys: null,
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
    chambers: [
      [0.5, 'rustle'],
      [2, 'rustle'],
    ],
    probe: true,
  },
  {
    name: 'ch-ring',
    title: 'Замер покоев: ch-ring',
    seconds: 3.5,
    seed: 17,
    keys: null,
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
    chambers: [
      [0.5, 'ring'],
    ],
    probe: true,
  },
  {
    name: 'ch-take',
    title: 'Замер покоев: ch-take',
    seconds: 3.5,
    seed: 17,
    keys: null,
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
    chambers: [
      [0.5, 'take'],
      [1.5, 'put'],
    ],
    probe: true,
  },
  {
    name: 'ch-tap',
    title: 'Замер: касание кнопки — мерка для шагов',
    seconds: 3.5,
    seed: 17,
    keys: null,
    music: false,
    battle: false,
    duck: { music: 1, amb: 1 },
    cues: [
      [0.5, 'tap'],
      [1.5, 'tap'],
    ],
    probe: true,
  },
];

function hearingAt(keys: Key[], t: number): Hearing {
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1][0] <= t) i++;
  const [ta, a] = keys[i];
  const next = keys[i + 1];
  if (!next) return a;
  const [tb, b] = next;
  const k = (t - ta) / (tb - ta);
  return { ...a, solar: a.solar + (b.solar - a.solar) * k, near: a.near + (b.near - a.near) * k, sea: a.sea + (b.sea - a.sea) * k };
}

/** Условный бой: что и когда звучит — как раскладывает ролик (`render/tw/cues.ts`), только руками. */
const cue = (kind: FxCue['kind'], x: number, z: number, ours = true, size = 1): FxCue => ({ kind, x, z, x2: x, z2: z - 40, dur: 1.4, size, ours, seed: Math.round(x * 13 + z) });
const BATTLE: [number, FxCue][] = [
  [0.5, cue('horn', -20, 30)],
  [1.8, cue('horn', 20, -30, false)],
  [4.5, cue('charge', -10, 20)],
  [5.5, cue('bows', 0, 25)],
  [5.9, cue('whistle', 0, 25)],
  [7.2, cue('thud', 0, -5)],
  [8.5, cue('cry', 0, 10)],
  [9.6, cue('crash', 0, 0, true, 2)],
  [15, cue('panic', 10, -20, false)],
  [18, cue('victory', -20, 30)],
];
function battleBed(t: number): FxAmbience {
  const fight = t < 9.6 ? 0 : t < 16 ? 160 : 40;
  return { fight: [{ x: 0, z: 0, n: fight }], gallop: { x: -15, z: 10, n: t > 4 && t < 10 ? 30 : 0 }, roar: fight / 300, standing: 600 };
}

/** Отрисовать образец. Наружу — JSON: частота, каналы и отсчёты Int16 в base64. */
export async function render(name: string, limit: boolean): Promise<string> {
  const s = SAMPLES.find((x) => x.name === name);
  if (!s) throw new Error(`нет образца ${name}`);
  const sr = 32000;
  const ctx = new OfflineAudioContext(2, Math.round(sr * s.seconds), sr);
  const chain = outputChain(ctx, s.levels ?? DEFAULT_GAINS, limit);
  const musicOut = ctx.createGain();
  musicOut.gain.value = s.duck.music;
  musicOut.connect(chain.kinds.music);
  const ambOut = ctx.createGain();
  ambOut.gain.value = s.duck.amb;
  // Фон — полосой «окружение», как в игре (`sound/epoch/index.ts`).
  ambOut.connect(chain.kinds.amb);
  const kit = makeKit(ctx, seeded(s.seed), false, ambOut);
  const amb = s.keys ? new Ambience(kit, ambOut, 0, hearingAt(s.keys, 0)) : null;
  const music = s.music ? new EpochMusic(kit, musicOut, 0, false, 0.3) : null;
  (globalThis as unknown as { __fxBus?: AudioNode }).__fxBus = chain.kinds.fx;
  const fx = s.battle ? battleFx(false, () => true) : null;
  fx?.arm();
  const ear = { x: 0, y: 25, z: 35, rx: 1, rz: 0 };
  const cueR = cueBone(s.seed);
  const STEP = 0.25;
  const step = (t: number): void => {
    if (amb && s.keys) {
      amb.set(hearingAt(s.keys, t), t);
      amb.tick(t, t + 1);
    }
    music?.tick(t, 1);
    for (const [at, c] of s.cues ?? []) if (at >= t && at < t + STEP) playCue(kit, chain.kinds.fx, c, at);
    for (const [at, c] of s.chambers ?? []) if (at >= t && at < t + STEP) playChamberCue(ctx, chain.kinds.fx, c, at, cueR);
    for (const [at, power, delay] of s.thunder ?? []) if (amb && at >= t && at < t + STEP) amb.thunder(at, power, delay);
    if (fx) fx.frame(BATTLE.filter(([at]) => at >= t && at < t + STEP).map(([, c]) => c), battleBed(t), ear, STEP);
  };
  step(0);
  for (let t = STEP; t < s.seconds; t += STEP) {
    const at = t;
    void ctx.suspend(at).then(() => {
      step(ctx.currentTime);
      void ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  const n = buf.length;
  const out = new Int16Array(n * 2);
  const l = buf.getChannelData(0);
  const r = buf.getChannelData(1);
  // Отсчёты как есть, без нормировки: замер видит то, что услышит игрок, а за пределом ±1 — перегруз.
  let over = 0;
  for (let i = 0; i < n; i++) {
    const a = l[i];
    const b = r[i];
    if (Math.abs(a) > 1 || Math.abs(b) > 1) over++;
    out[i * 2] = Math.max(-32768, Math.min(32767, Math.round(a * 32767)));
    out[i * 2 + 1] = Math.max(-32768, Math.min(32767, Math.round(b * 32767)));
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
  const bytes = new Uint8Array(out.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return JSON.stringify({ sr, channels: 2, peak, over, data: btoa(bin) });
}

(globalThis as unknown as { __audio: unknown }).__audio = { render, names: SAMPLES.map((x) => ({ name: x.name, title: x.title, probe: !!x.probe })) };
