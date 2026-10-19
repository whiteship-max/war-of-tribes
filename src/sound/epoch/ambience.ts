// Фон города и карты (docs/audio.md, раздел 4).
//
// Два рода слоёв. **Постели** тянутся всегда и меняют только громкость: ветер, свист ветра, общий гул, море. **События**
// случаются по одному: удар молота, колокол, птица, сверчок, голос рынка. Сколько чего слышно — чистая функция
// `mixOf` от того, что видит игрок: город или карта, время суток (фаза солнца), сезон, близость камеры к улицам, море у
// дома на карте. Её держит тест; звучит её `Ambience`.
//
// Переход слоёв — только `setTargetAtTime` с постоянной в секунды: приблизил камеру, наступила ночь, открыл карту — фон
// переливается, а не переключается.

import type { Season } from '@/game/types';
import { rhythmAt, type CityMood } from '@/render/city/rhythm';
import { pick, span, type Rng } from './rng';
import { anvil, bell, bird, cricket, drip, drum, flute, laugh, noiseLoop, pluck, voice, type BirdKind, type Kit } from './synth';

/** Что слышит игрок. */
export interface Hearing {
  /** Город, карта или поляна промысла (`glade`: идёт промысел — лес вместо города, docs/minigames.md, 16.2). */
  view: 'city' | 'map' | 'glade';
  /** Фаза солнца: 0 — рассвет, 0.25 — полдень, 0.5 — закат, 0.75 — глубокая ночь (`derived.solarPhase`). */
  solar: number;
  season: Season;
  /** Близость камеры к улицам, 0..1 (`sound/ear`). */
  near: number;
  /** Доля моря вокруг дома на карте, 0..1. */
  sea: number;
  /** Погода над городом (`render/climate`): дождь, снег, гроза и сила ветра, 0..1. Нет — тихая погода. */
  wx?: WeatherSound;
  /** Состояние города (`render/city/rhythm.moodOf`): праздник, тревога, голод, мор, мораль. Нет — спокойный город. */
  life?: CityMood;
}

/** Что слышно из погоды. */
export interface WeatherSound {
  rain: number;
  snow: number;
  storm: number;
  wind: number;
  /** Снег на земле зимой, 0..1 (`climate.lyingSnow`): глушит город. Нет — как прежде, зима глушит всегда. */
  cover?: number;
}

/** Без погоды — ветер, как прежде (средней силы), ни дождя, ни грозы. */
export const CALM: WeatherSound = { rain: 0, snow: 0, storm: 0, wind: 0.4 };

export type Layer = 'wind' | 'whistle' | 'hum' | 'sea' | 'market' | 'forge' | 'birds' | 'crickets' | 'bells' | 'rain' | 'tavern' | 'watch' | 'tocsin' | 'feast';

export const LAYERS: readonly Layer[] = ['wind', 'whistle', 'hum', 'sea', 'market', 'forge', 'birds', 'crickets', 'bells', 'rain', 'tavern', 'watch', 'tocsin', 'feast'];

/** Тишина жизни города — карте, поляне и городу без своих дел. */
const QUIET = { tavern: 0, watch: 0, tocsin: 0, feast: 0 } as const;

/** Карта тише: её постели — во всю ширину кадра, без городского гомона поверх (П-3). */
const MAP_LEVEL = 0.66;

/** Плавная ступенька: 0 до `a`, 1 после `b`. */
const step = (x: number, a: number, b: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Окно по фазе солнца с мягкими краями. */
const band = (s: number, from: number, to: number, edge: number): number => step(s, from - edge, from + edge) * (1 - step(s, to - edge, to + edge));

/** Рабочий день: от рассвета до заката. */
export const workday = (solar: number): number => band(solar, 0.05, 0.45, 0.03);
/** Утро для птиц: рассвет и чуть после. */
export const morning = (solar: number): number => Math.max(band(solar, 0.0, 0.12, 0.03), step(solar, 0.94, 0.99));
/** Ночь: после сумерек и до предрассветья. */
export const night = (solar: number): number => band(solar, 0.56, 0.93, 0.04);

/** Птицы по сезонам: весной — больше всего, зимой — нет. */
const BIRDS: Record<Season, number> = { spring: 1, summer: 0.6, autumn: 0.3, winter: 0 };
/** Сверчки: тёплые ночи. */
const CRICKETS: Record<Season, number> = { spring: 0.5, summer: 1, autumn: 0.45, winter: 0 };
/** Рынок зимой тише и короче. */
const MARKET: Record<Season, number> = { spring: 1, summer: 1, autumn: 0.85, winter: 0.5 };

/**
 * Сколько слышно каждого слоя, 0..1. Постели — громкость, события — и громкость, и частота.
 *
 * Город: ветер и гул — издали (камера отдалена), рынок и кузница — вблизи и днём; колокол — днём, на часах; птицы —
 * утром и весной; сверчки — тёплой ночью; ночью тихо. Зима — ветер сильнее, птиц и сверчков нет, рынок вполовину; снег
 * глушит город — это фильтр `muffle`, а не слой. Карта — только ветер и море у дома.
 */
export function mixOf(h: Hearing): Record<Layer, number> {
  const far = 1 - h.near;
  const winter = h.season === 'winter';
  // Погода: ветер — по её силе (средняя — как прежде), дождь — своей постелью; в дождь рынок и птицы тише.
  const wx = h.wx ?? CALM;
  const gust = 0.45 + 1.375 * wx.wind;
  const cap = (x: number): number => Math.min(1, x);
  const dry = 1 - 0.6 * Math.max(wx.rain, wx.snow);
  if (h.view === 'glade') {
    // Поляна промысла: лес утра — ветер в кронах по погоде и птицы по сезону; ни города, ни моря, ни дождя (у сцены
    // промысла своя минута — утро без погоды, docs/minigames.md, 7: слышно то же, что видно).
    return {
      wind: cap((0.38 + (winter ? 0.15 : 0)) * gust),
      whistle: cap((winter ? 0.22 : 0.04) * gust * (1 + wx.storm)),
      hum: 0,
      sea: 0,
      market: 0,
      forge: 0,
      birds: BIRDS[h.season] * 0.9,
      crickets: 0,
      bells: 0,
      rain: 0,
      ...QUIET,
    };
  }
  if (h.view === 'map') {
    // Карта — вровень с городом (П-3: её ветер и море стояли на 4 дБ громче фона города, `npm run audio:samples`).
    return {
      wind: cap((0.55 + (winter ? 0.2 : 0)) * gust) * MAP_LEVEL,
      whistle: cap((winter ? 0.35 : 0.12) * gust * (1 + wx.storm)) * MAP_LEVEL,
      hum: 0,
      sea: Math.min(1, h.sea * 1.3) * MAP_LEVEL,
      market: 0,
      forge: 0,
      birds: 0,
      crickets: 0,
      bells: 0,
      rain: wx.rain * 0.6,
      ...QUIET,
    };
  }
  const work = workday(h.solar);
  const nite = night(h.solar);
  // Распорядок и состояние города (docs/city_v3.md, ЖГ-1) — те же функции, что у вида: рынок шумит до полудня, вечером —
  // трактир, ночью — оклик дозора; тревога глушит улицы и бьёт в колокол, праздник — бубен и дудка на площади; голод и мор
  // приглушают рынок, хмурость — гомон.
  const rh = rhythmAt(h.solar);
  const life = h.life;
  const alarm = life?.alarm ?? 0;
  const feast = life?.feast ?? 0;
  const cheer = life?.cheer ?? 0;
  const crowd = (1 - alarm) * (1 - 0.5 * (life?.plague ?? 0)) * (1 - 0.6 * (life?.hunger ?? 0)) * (1 + 0.15 * Math.max(0, cheer) - 0.5 * Math.max(0, -cheer));
  return {
    wind: cap((0.22 + 0.4 * far + (winter ? 0.25 : 0) + 0.1 * nite) * gust),
    whistle: cap((winter ? 0.4 : 0.08) * (0.4 + 0.6 * far) * gust * (1 + wx.storm)),
    hum: (0.15 + 0.45 * far) * (0.25 + 0.75 * work) * (1 - 0.5 * alarm),
    sea: 0,
    market: Math.min(1, MARKET[h.season] * rh.market * (0.12 + 0.88 * h.near) * dry * crowd),
    forge: work * (0.2 + 0.8 * h.near) * (winter ? 0.8 : 1) * (1 - alarm),
    birds: BIRDS[h.season] * Math.max(morning(h.solar), 0.3 * work) * dry,
    crickets: CRICKETS[h.season] * nite * dry,
    bells: 1 - nite,
    rain: wx.rain,
    tavern: Math.min(1, rh.tavern * (0.15 + 0.85 * h.near) * dry * crowd),
    watch: rh.patrol * (0.25 + 0.75 * h.near) * (1 - alarm),
    tocsin: alarm,
    feast: feast * (0.3 + 0.7 * h.near) * (1 - 0.5 * wx.rain),
  };
}

/** Слои дождя по его силе (`rainLayers`): что звучит при мороси, при дожде и в ливень. */
export interface RainLayers {
  /** Морось — тонкий шелест верхов: слышна в слабый дождь, в ливне тонет. */
  drizzle: number;
  /** Дождь — шум середины полосы, тело дождя. */
  steady: number;
  /** Ливень — низкий гул воды. */
  heavy: number;
  /** Дробь капель по кровлям — вблизи улиц. */
  patter: number;
  /** Капли с карнизов в лужи — вблизи и в некрупный дождь (в ливне их не слышно). */
  drips: number;
}

/**
 * Дождь слоями по силе (docs/polish.md, П-3): не один шум громче и тише, а смена тембра — морось шелестит верхами, дождь
 * шумит серединой, ливень гудит низом; вблизи улиц — дробь по кровлям и капли с карнизов. `rain` — сила дождя 0..1,
 * `near` — близость камеры к улицам (на карте 0).
 */
export function rainLayers(rain: number, near: number): RainLayers {
  const r = Math.min(1, Math.max(0, rain));
  return {
    // Морось стихает, пока входит гул ливня, — так, чтобы общая сила не проседала (тест «громче с силой ровно»).
    drizzle: step(r, 0.02, 0.22) * (1 - 0.6 * step(r, 0.5, 1)),
    steady: step(r, 0.15, 0.7),
    heavy: step(r, 0.4, 1),
    patter: step(r, 0.08, 0.5) * (0.2 + 0.8 * near),
    drips: step(r, 0.02, 0.15) * (1 - 0.75 * step(r, 0.45, 0.9)) * (0.15 + 0.85 * near),
  };
}

/** Доли слоёв дождя на выходе — выставлены офлайн-отрисовкой (`npm run audio:samples`: `rain-light`, `rain-heavy`). */
export const RAIN_MIX: Record<keyof RainLayers, number> = { drizzle: 0.85, steady: 1, heavy: 0.9, patter: 0.55, drips: 0.65 };

/** Снег глушит город: срез верхов на всём городском — пока снег лежит (на Сицилии зимой — только после снегопада). */
export const muffleOf = (h: Hearing): number =>
  h.view === 'city' && h.season === 'winter' && (h.wx?.cover ?? 1) > 0.3 ? 1800 : 9000;

/**
 * Где на фазе солнца звонит колокол и сколько ударов: утреня, третий час, полдень, девятый, вечерня, повечерие (ЖГ-1: на
 * закрытии ворот — двумя ударами в сумерках).
 */
export const BELL_HOURS: readonly (readonly [number, number])[] = [
  [0.02, 3],
  [0.125, 1],
  [0.25, 5],
  [0.375, 1],
  [0.47, 3],
  [0.545, 2],
];

/** Сколько ударов, если между фазами `from` и `to` (вперёд, через полночь) прошёл час колокола; иначе 0. */
export function bellBetween(from: number, to: number): number {
  if (from === to) return 0;
  const ahead = (to - from + 1) % 1;
  // Скачок больше четверти суток — это не ход времени, а вход в игру или догон отлучки: не звонить задним числом.
  if (ahead > 0.25) return 0;
  for (const [mark, strikes] of BELL_HOURS) {
    const d = (mark - from + 1) % 1;
    if (d > 0 && d <= ahead) return strikes;
  }
  return 0;
}

/** Уровни слоёв на выходе фона — выставлены офлайн-отрисовкой (docs/audio.md, раздел 6). */
export const AMB_MIX: Record<Layer, number> = {
  wind: 0.16,
  whistle: 0.02,
  hum: 0.1,
  sea: 0.2,
  market: 0.09,
  forge: 0.14,
  birds: 0.06,
  crickets: 0.025,
  bells: 0.12,
  rain: 0.085,
  tavern: 0.06,
  watch: 0.05,
  tocsin: 0.07,
  feast: 0.07,
};

/** Гром — громче фона, но не пугает: на уровне колокола (П-3: пик близкого грома около −18 дБ при умолчаниях). */
export const THUNDER_MIX = 0.13;

/** Постоянная перелива слоёв, с: приблизил камеру — за пару секунд, сменилось время суток — ещё мягче. */
export const GLIDE = 1.2;

interface Bed {
  gain: GainNode;
  filter: BiquadFilterNode;
}

/** Фон: постели и события. */
export class Ambience {
  private mix: Record<Layer, number>;
  private hearing: Hearing;
  private beds: Partial<Record<'wind' | 'whistle' | 'hum' | 'sea' | 'foam' | 'drizzle' | 'rain' | 'heavy' | 'patter', Bed>> = {};
  /** Всё городское — сквозь срез «снега». */
  private muffle: BiquadFilterNode;
  /** Голоса рынка — сквозь срез дали: издали гомон, вблизи разборчивее. */
  private marketTone: BiquadFilterNode;
  private next: Record<'forge' | 'birds' | 'crickets' | 'market' | 'gust' | 'swell' | 'patter' | 'drips' | 'tavern' | 'watch' | 'tocsin' | 'feast', number>;
  /** Голоса трактира — глуше рынка: за стенами и ставнями. */
  private tavernTone: BiquadFilterNode;
  /** Мелодия праздника: шаг напева по ладу. */
  private tune = 0;
  /** У кузнеца своя наковальня: высота удара одна на игру. */
  private anvilHz: number;
  private rnd: Rng;

  constructor(
    private kit: Kit,
    private out: AudioNode,
    at: number,
    first: Hearing,
  ) {
    const ctx = kit.ctx;
    this.rnd = kit.rnd;
    this.hearing = first;
    this.mix = mixOf(first);
    this.anvilHz = span(this.rnd, 640, 900);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = muffleOf(first);
    this.muffle.connect(out);
    this.marketTone = ctx.createBiquadFilter();
    this.marketTone.type = 'lowpass';
    this.marketTone.frequency.value = 900 + 2600 * first.near;
    this.marketTone.connect(this.muffle);

    const bed = (brown: boolean, type: BiquadFilterType, f: number, q: number, into: AudioNode): Bed => {
      const src = noiseLoop(kit, brown, at);
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = f;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(filter);
      filter.connect(gain);
      gain.connect(into);
      return { gain, filter };
    };
    this.beds.wind = bed(true, 'lowpass', 500, 0.7, out);
    this.beds.hum = bed(true, 'lowpass', 260, 0.5, this.muffle);
    this.beds.sea = bed(true, 'lowpass', 650, 0.5, out);
    // Дождь слоями (`rainLayers`): морось — верхи белого шума, дождь — середина полосы, ливень — бурый низ; дробь по
    // кровлям — верх с дрожью громкости (не на слабом).
    this.beds.drizzle = bed(false, 'highpass', 4800, 0.5, out);
    this.beds.rain = bed(false, 'bandpass', 1200, 0.35, out);
    this.beds.heavy = bed(true, 'lowpass', 520, 0.4, out);
    if (!kit.lite) {
      this.beds.whistle = bed(false, 'bandpass', 900, 9, out);
      this.beds.foam = bed(false, 'highpass', 2600, 0.5, out);
      this.beds.patter = bed(false, 'highpass', 2800, 0.6, out);
    }
    this.tavernTone = ctx.createBiquadFilter();
    this.tavernTone.type = 'lowpass';
    this.tavernTone.frequency.value = 1400;
    this.tavernTone.connect(this.muffle);
    this.next = { forge: at + span(this.rnd, 1, 4), birds: at + span(this.rnd, 0.5, 3), crickets: at + 0.5, market: at + 0.3, gust: at, swell: at, patter: at, drips: at + 0.5, tavern: at + 1, watch: at + span(this.rnd, 4, 12), tocsin: at + 0.2, feast: at + 0.4 };
    this.level(at, 0.4);
  }

  /** Что видит игрок сейчас (`at` — время контекста). Колокол бьёт, если с прошлого раза прошёл его час. */
  set(h: Hearing, at: number): void {
    const strikes = h.view === 'city' ? bellBetween(this.hearing.solar, h.solar) : 0;
    this.hearing = h;
    this.mix = mixOf(h);
    this.level(at, GLIDE);
    this.muffle.frequency.setTargetAtTime(muffleOf(h), at, GLIDE);
    this.marketTone.frequency.setTargetAtTime(900 + 2600 * h.near, at, GLIDE * 0.5);
    if (strikes > 0 && this.mix.bells > 0.05) this.peal(at + 0.2, strikes);
  }

  /** Колокол: `strikes` ударов с промежутком в две с половиной секунды. */
  peal(at: number, strikes: number): void {
    const base = 142;
    for (let i = 0; i < strikes; i++) bell(this.kit, this.muffle, at + i * 2.6, base, AMB_MIX.bells * this.mix.bells);
  }

  /** Слои дождя сейчас: на карте дроби и капель с карнизов нет — улиц не слышно. */
  private rainNow(): RainLayers {
    return rainLayers(this.mix.rain, this.hearing.view === 'city' ? this.hearing.near : 0);
  }

  private level(at: number, glide: number): void {
    const m = this.mix;
    const set = (b: Bed | undefined, v: number): void => {
      b?.gain.gain.setTargetAtTime(v, at, glide);
    };
    const r = this.rainNow();
    set(this.beds.wind, m.wind * AMB_MIX.wind);
    set(this.beds.whistle, m.whistle * AMB_MIX.whistle);
    set(this.beds.hum, m.hum * AMB_MIX.hum);
    set(this.beds.sea, m.sea * AMB_MIX.sea);
    set(this.beds.foam, m.sea * AMB_MIX.sea * 0.12);
    set(this.beds.drizzle, r.drizzle * RAIN_MIX.drizzle * AMB_MIX.rain);
    set(this.beds.rain, r.steady * RAIN_MIX.steady * AMB_MIX.rain);
    set(this.beds.heavy, r.heavy * RAIN_MIX.heavy * AMB_MIX.rain);
    set(this.beds.patter, r.patter * RAIN_MIX.patter * AMB_MIX.rain);
  }

  /**
   * Гром: раскат через `delay` секунд после вспышки — чем дальше, тем позже, глуше и дольше; близкий — с треском.
   * Бурый шум сквозь срез, который сползает вниз, и огибающая с перекатами.
   */
  thunder(at: number, power: number, delay: number): void {
    const ctx = this.kit.ctx;
    const far = Math.min(1, Math.max(0, (delay - 1.2) / 3.8));
    const src = noiseLoop(this.kit, true, at);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700 - 350 * far, at);
    lp.frequency.exponentialRampToValueAtTime(70, at + 2.5 + 2 * far);
    const g = ctx.createGain();
    const peak = THUNDER_MIX * power * (1 - 0.45 * far);
    const life = 3 + 2.5 * far;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + 0.12 + 0.4 * far);
    // Перекаты: два-три вздоха громкости по ходу спада.
    const rolls = 2 + Math.floor(this.rnd() * 2);
    for (let i = 1; i <= rolls; i++) g.gain.setTargetAtTime(peak * (0.9 - i * 0.18), at + (i * life) / (rolls + 2), 0.25);
    g.gain.setTargetAtTime(0.0001, at + life * 0.7, life * 0.15);
    src.connect(lp);
    lp.connect(g);
    g.connect(this.out);
    src.stop(at + life + 0.5);
    // Близкий удар — треск в начале.
    if (far < 0.3 && !this.kit.lite) {
      const crack = noiseLoop(this.kit, false, at);
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = 1800;
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.0001, at);
      cg.gain.exponentialRampToValueAtTime(peak * 0.5, at + 0.03);
      cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      crack.connect(hp);
      hp.connect(cg);
      cg.connect(this.out);
      crack.stop(at + 0.6);
    }
  }

  /** Поставить события окна `[from, to)`. */
  tick(from: number, to: number): void {
    const m = this.mix;
    const rnd = this.rnd;
    const kit = this.kit;
    const due = (k: keyof Ambience['next']): boolean => this.next[k] < to;
    const at = (k: keyof Ambience['next']): number => Math.max(from, this.next[k]);

    // Порывы ветра и свист: цель громкости и среза меняется раз в несколько секунд.
    while (due('gust')) {
      const t = at('gust');
      const gust = span(rnd, 0.6, 1.35);
      const w = this.beds.wind;
      if (w) {
        w.gain.gain.setTargetAtTime(m.wind * AMB_MIX.wind * gust, t, 1.5);
        w.filter.frequency.setTargetAtTime(span(rnd, 300, 900) * (0.8 + 0.4 * gust), t, 2);
      }
      this.beds.whistle?.filter.frequency.setTargetAtTime(span(rnd, 600, 1300), t, 2.5);
      this.beds.whistle?.gain.gain.setTargetAtTime(m.whistle * AMB_MIX.whistle * gust, t, 1.5);
      // Порыв гонит и дождь: шум крепнет и стихает с ветром.
      const r = this.rainNow();
      this.beds.rain?.gain.gain.setTargetAtTime(r.steady * RAIN_MIX.steady * AMB_MIX.rain * (0.75 + 0.25 * gust), t, 1.5);
      this.beds.heavy?.gain.gain.setTargetAtTime(r.heavy * RAIN_MIX.heavy * AMB_MIX.rain * (0.7 + 0.3 * gust), t, 1.5);
      this.next.gust = t + span(rnd, 2.5, 6);
    }
    // Волна: набегает за пару секунд и отходит.
    while (due('swell')) {
      const t = at('swell');
      const len = span(rnd, 5, 9);
      const s = this.beds.sea;
      if (s && m.sea > 0.01) {
        s.gain.gain.setTargetAtTime(m.sea * AMB_MIX.sea * 1.4, t, len * 0.18);
        s.gain.gain.setTargetAtTime(m.sea * AMB_MIX.sea * 0.55, t + len * 0.45, len * 0.25);
        this.beds.foam?.gain.gain.setTargetAtTime(m.sea * AMB_MIX.sea * 0.2, t + len * 0.3, 0.6);
        this.beds.foam?.gain.gain.setTargetAtTime(m.sea * AMB_MIX.sea * 0.05, t + len * 0.55, 1.2);
      }
      this.next.swell = t + len;
    }
    // Дробь по кровлям: громкость дрожит каждую десятую долю секунды — отдельные капли, а не ровный шум.
    while (due('patter')) {
      const t = at('patter');
      const p = this.beds.patter;
      const r = this.rainNow();
      if (p && r.patter > 0.01) {
        p.gain.gain.setTargetAtTime(r.patter * RAIN_MIX.patter * AMB_MIX.rain * span(rnd, 0.35, 1.4), t, 0.025);
        this.next.patter = t + span(rnd, 0.05, 0.16);
      } else this.next.patter = t + 0.5;
    }
    // Капли с карнизов: «плинк» в лужу то тут, то там — в некрупный дождь вблизи улиц.
    while (due('drips')) {
      const t = at('drips');
      const r = this.rainNow();
      if (!kit.lite && r.drips > 0.03) {
        drip(kit, this.muffle, t, RAIN_MIX.drips * AMB_MIX.rain * r.drips * span(rnd, 0.4, 1), span(rnd, -0.8, 0.8));
        this.next.drips = t + span(rnd, 0.12, 0.9) / Math.max(0.25, r.drips);
      } else this.next.drips = t + 0.6;
    }
    // Кузница: два-четыре удара, передышка. Чем ближе камера, тем чаще слышно.
    while (due('forge')) {
      const t = at('forge');
      if (m.forge > 0.03) {
        const n = 2 + Math.floor(rnd() * 3);
        const pan = 0.35;
        for (let i = 0; i < n; i++) anvil(kit, this.muffle, t + i * span(rnd, 0.42, 0.55), this.anvilHz, AMB_MIX.forge * m.forge * (i === n - 1 ? 0.7 : 1), pan);
        this.next.forge = t + n * 0.5 + span(rnd, 1.5, 5);
      } else this.next.forge = to + 1;
    }
    // Птицы: фраза, тишина; весной и утром чаще.
    while (due('birds')) {
      const t = at('birds');
      if (m.birds > 0.03) {
        const kind = pick<BirdKind>(rnd, kit.lite ? ['warble'] : ['trill', 'whistle', 'warble']);
        const len = bird(kit, this.out, t, kind, AMB_MIX.birds * m.birds * span(rnd, 0.6, 1), span(rnd, -0.8, 0.8));
        this.next.birds = t + len + span(rnd, 0.6, 4) / Math.max(0.3, m.birds);
      } else this.next.birds = to + 1;
    }
    // Сверчки: песня на несколько секунд, рядом другой.
    while (due('crickets')) {
      const t = at('crickets');
      if (m.crickets > 0.03) {
        const len = cricket(kit, this.out, t, 4 + Math.floor(rnd() * 6), AMB_MIX.crickets * m.crickets, span(rnd, -0.7, 0.7));
        this.next.crickets = t + len * span(rnd, 0.3, 0.9);
      } else this.next.crickets = to + 1;
    }
    // Рынок: голоса перекрываются — гомон; изредка зазывала.
    while (due('market')) {
      const t = at('market');
      if (m.market > 0.03) {
        const shout = rnd() < 0.08;
        const len = voice(kit, this.marketTone, t, shout ? 2 : 2 + Math.floor(rnd() * 5), AMB_MIX.market * m.market * (shout ? 1.2 : span(rnd, 0.4, 1)), span(rnd, -0.7, 0.7), shout);
        // Чем гуще рынок, тем больше голосов наслаивается: следующий входит, не дожидаясь конца этого.
        this.next.market = t + len * span(rnd, 0.15, 0.6) / (kit.lite ? 0.5 : 1);
      } else this.next.market = to + 1;
    }
    // Трактир вечером: гул голосов за ставнями, взрывы смеха, изредка — лютня на пару тактов.
    while (due('tavern')) {
      const t = at('tavern');
      if (m.tavern > 0.03) {
        const v = AMB_MIX.tavern * m.tavern;
        const r = rnd();
        let len: number;
        if (r < 0.14) len = laugh(kit, this.tavernTone, t, v * 1.1, span(rnd, -0.5, 0.5));
        else if (r < 0.2 && !kit.lite) {
          // Лютня: шесть-девять нот дорийского лада от ре.
          const notes = [62, 64, 65, 67, 69, 71, 72];
          const n = 6 + Math.floor(rnd() * 4);
          for (let i = 0; i < n; i++) pluck(kit, this.tavernTone, t + i * 0.32, notes[Math.floor(rnd() * notes.length)], v * 0.9, 0.2);
          len = n * 0.32;
        } else len = voice(kit, this.tavernTone, t, 2 + Math.floor(rnd() * 4), v * span(rnd, 0.5, 1), span(rnd, -0.6, 0.6), false);
        this.next.tavern = t + len * span(rnd, 0.3, 0.8);
      } else this.next.tavern = to + 1;
    }
    // Ночной дозор: оклик издали — протяжный зов, раз в полминуты-минуту.
    while (due('watch')) {
      const t = at('watch');
      if (m.watch > 0.05) {
        voice(kit, this.tavernTone, t, 2, AMB_MIX.watch * m.watch, span(rnd, -0.8, 0.8), true);
        this.next.watch = t + span(rnd, 22, 50);
      } else this.next.watch = t + 5;
    }
    // Колокол тревоги: частые удары высоким колоколом — по семь, передышка, снова, пока враг у стен.
    while (due('tocsin')) {
      const t = at('tocsin');
      if (m.tocsin > 0.05) {
        for (let i = 0; i < 7; i++) bell(kit, this.muffle, t + i * 0.6, 230, AMB_MIX.tocsin * m.tocsin * (i % 2 ? 0.8 : 1));
        this.next.tocsin = t + 7 * 0.6 + span(rnd, 2, 3.5);
      } else this.next.tocsin = t + 1;
    }
    // Праздник: бубен в два такта, дудка ведёт напев по ладу; изредка — радостные крики.
    while (due('feast')) {
      const t = at('feast');
      if (m.feast > 0.03) {
        const v = AMB_MIX.feast * m.feast;
        const beat = 0.36;
        for (let i = 0; i < 8; i++) drum(kit, this.muffle, t + i * beat, v * (i % 4 === 0 ? 1 : 0.55), -0.25, i % 2 === 1);
        const scale = [62, 64, 65, 67, 69, 67, 65, 64];
        for (let i = 0; i < 4; i++) {
          const midi = scale[(this.tune + i) % scale.length] + 12;
          flute(kit, this.muffle, t + i * beat * 2, beat * 1.8, midi, v * 1.1);
        }
        this.tune = (this.tune + 3) % scale.length;
        if (rnd() < 0.3) voice(kit, this.marketTone, t + span(rnd, 0, 2), 2, v * 0.8, span(rnd, -0.6, 0.6), true);
        this.next.feast = t + 8 * beat;
      } else this.next.feast = t + 1;
    }
  }
}
