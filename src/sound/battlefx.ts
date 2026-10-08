// Звуки боя ролика TW — процедурные, на Web Audio (docs/battle_tw.md, раздел «Звук»): гул сечи, рога и трубы, клич,
// грохот удара, лязг, срыв залпа, свист и стук стрел, конский топот, крик бегущих.
//
// **ЗВУК ПРОЦЕДУРНЫЙ, И ЭТО РЕШЕНИЕ, А НЕ ЗАГЛУШКА.** Лицензия у него одна — наша: ни одного чужого файла, ни одного
// сэмпла, ни одной записи. Сеть облачной сессии к хранилищам CC0 не пустила, а вой волка (`howl.ts`) уже показал, что
// голос из горстки узлов дешевле дорожки: весь звук боя — несколько килобайт кода вместо мегабайтов записи. Окажется он
// непохожим на ухо — меняется только хозяин (`FxVoice` ниже), машинка и места вызова остаются.
//
// **ОТДЕЛЬНОЙ ДОКАЧКОЙ.** Модуль — свой ленивый кусок (`vite.config.ts`, `LAZY_DOORS`, «звук боя TW»): его тянет только
// ролик TW, после первого кадра, и в первую загрузку и в кусок ролика он не едет. Контекст при этом один на всю игру и
// создаётся в `web.ts` — сюда приходит только выход (`openBus`), как у воя. Открывает контекст нажатие «Смотреть бой»
// (`battleMusic.arm()`): этот модуль приезжает уже после жеста и **ничего не открывает сам** — `arm` лишь берёт выход у
// открытого контекста. Без жеста и при выключенном звуке он молчит и ничего не грузит.
//
// **РЫЧАГ ОДИН.** Включён ли звук — та же настройка, что у музыки и воя (`soundOn`, «Музыка» в настройках). Кнопка в
// ролике — не второй рычаг, а «тише» на этот просмотр (`muted`): включить звук она не может, настройку не пишет.
//
// Громкость — по камере: ближе к звуку — громче, сбоку — в своё ухо (`place`). На низком уровне качества звук проще:
// без свиста каждого залпа и с вдвое меньшим числом голосов разом (`FX_LITE`).
import { soundOn } from './settings';
import { openBus } from './web';

/** Звук на секунде ролика — то, что раскладывает ролик (`render/tw/cues.ts`). Своего знания о бое у машинки нет. */
export interface FxCue {
  kind:
    | 'horn'
    | 'charge'
    | 'cry'
    | 'crash'
    | 'bows'
    | 'whistle'
    | 'thud'
    | 'panic'
    | 'victory'
    | 'ram'
    | 'gate'
    | 'ladder'
    | 'wallcry'
    | 'engine'
    | 'stone'
    | 'impact'
    | 'collapse';
  x: number;
  z: number;
  x2: number;
  z2: number;
  dur: number;
  size: number;
  ours: boolean;
  seed: number;
}

/** Гул на кадре: где и сколько рубится, где и сколько коней в ходу, доля рубящихся. */
export interface FxAmbience {
  fight: { x: number; z: number; n: number }[];
  gallop: { x: number; z: number; n: number };
  roar: number;
  standing: number;
}

/** Ухо — камера: где стоит и куда у неё правая рука (единичный вектор по земле). */
export interface FxEar {
  x: number;
  y: number;
  z: number;
  rx: number;
  rz: number;
}

/** Что звуку нужно от среды. */
export interface FxHost {
  /** Взять выход у открытого контекста. `false` — звука в этой среде нет. */
  open(): boolean;
  /** Сыграть звук с громкостью 0..1 и стороной −1..1. */
  cue(c: FxCue, gain: number, pan: number): void;
  /** Постель: гул, лязг в секунду и топот — громкости и стороны; `dt` — шаг кадра, секунды. */
  bed(b: FxBed, dt: number): void;
  stop(): void;
}

export interface FxBed {
  roar: number;
  clash: number;
  clashPan: number;
  hooves: number;
  hoovesPan: number;
}

const SILENT: FxBed = { roar: 0, clash: 0, clashPan: 0, hooves: 0, hoovesPan: 0 };

/** Громкость звуков боя: под музыкой боя (0.55, `web.ts`) — рядом с ней, не поверх. */
export const FX_VOLUME = 0.5;
/** Расстояние, на котором звук звучит в полную силу; дальше — тише обратно расстоянию. */
export const FX_NEAR = 18;
/** Звуков за кадр, не больше: на ×4 залпы идут вчетверо гуще, а ухо разбирает не больше этого. */
export const FX_PER_FRAME = { full: 6, lite: 3 };
/** Низкий уровень: без свиста залпов и стука стрел, лязга реже. */
export const FX_LITE = { skip: ['whistle', 'thud', 'stone'] as readonly FxCue['kind'][], clash: 0.4 };

/** Громкость и сторона звука в точке `x, z` для уха. Чистая — по ней и тест. */
export function place(ear: FxEar, x: number, z: number): { gain: number; pan: number } {
  const dx = x - ear.x;
  const dz = z - ear.z;
  const d = Math.hypot(dx, ear.y - 1, dz);
  const gain = Math.min(1, FX_NEAR / Math.max(1, d));
  const flat = Math.hypot(dx, dz);
  const pan = flat > 0.5 ? Math.max(-1, Math.min(1, (dx * ear.rx + dz * ear.rz) / flat)) * 0.7 : 0;
  return { gain, pan };
}

/**
 * Звуки боя: решает, что из пришедшего звучит и как громко. Ничего не помнит, кроме того, было ли открытие и не тише ли
 * просмотр: звуки приходят от ролика кадр за кадром.
 */
export class BattleFx {
  private armed = false;
  muted = false;

  constructor(
    private host: FxHost,
    private enabled: () => boolean = soundOn,
    readonly lite = false,
  ) {}

  /** Взять выход. Идемпотентно; при выключенном звуке не делает ничего и ничего не открывает. */
  arm(): void {
    if (this.armed || !this.enabled()) return;
    if (!this.host.open()) return;
    this.armed = true;
  }

  get live(): boolean {
    return this.armed && this.enabled() && !this.muted;
  }

  /** Кадр: звуки, чьё время пришло, гул на кадре и где ухо. */
  frame(cues: readonly FxCue[], amb: FxAmbience, ear: FxEar, dt: number): void {
    if (!this.armed) return;
    if (!this.live) {
      this.host.bed(SILENT, dt);
      return;
    }
    let n = 0;
    const cap = this.lite ? FX_PER_FRAME.lite : FX_PER_FRAME.full;
    for (const c of cues) {
      if (n >= cap) break;
      if (this.lite && FX_LITE.skip.includes(c.kind)) continue;
      // Свист — посреди полёта тучи, а не у лучников: слышно, куда летит.
      const at = c.kind === 'whistle' || c.kind === 'stone' ? place(ear, (c.x + c.x2) / 2, (c.z + c.z2) / 2) : place(ear, c.x, c.z);
      // Рог и трубы слышны через всё поле: это сигнал, а не шум.
      const gain = c.kind === 'horn' || c.kind === 'charge' || c.kind === 'victory' ? Math.max(0.45, at.gain) : at.gain;
      if (gain < 0.03) continue;
      this.host.cue(c, gain, at.pan);
      n += 1;
    }
    this.host.bed(this.bedOf(amb, ear), dt);
  }

  /** Постель кадра: гул сечи и ропот войска, лязг по рубящимся у уха, топот по коням в ходу. */
  private bedOf(amb: FxAmbience, ear: FxEar): FxBed {
    let clash = 0;
    let panSum = 0;
    let near = 0;
    for (const f of amb.fight) {
      if (f.n <= 0) continue;
      const p = place(ear, f.x, f.z);
      clash += f.n * p.gain;
      panSum += f.n * p.gain * p.pan;
      near = Math.max(near, p.gain);
    }
    const g = place(ear, amb.gallop.x, amb.gallop.z);
    const crowd = Math.min(1, amb.standing / 400);
    return {
      // Гул — сеча по доле рубящихся и ропот стоящих войск, тем громче, чем ближе ухо к свалке.
      roar: Math.min(1, (0.15 * crowd + 0.85 * Math.min(1, amb.roar * 3)) * (0.35 + 0.65 * near)),
      clash: Math.min(14, clash * 0.06) * (this.lite ? FX_LITE.clash : 1),
      clashPan: clash > 0 ? panSum / clash : 0,
      hooves: Math.min(1, amb.gallop.n / 40) * g.gain,
      hoovesPan: g.pan,
    };
  }

  /** Кадров нет (карточка итога, скрытая страница): гул и лязг смолкают, а не тянут последний кадр. */
  rest(): void {
    if (this.armed) this.host.bed(SILENT, 0);
  }

  /** Тише на этот просмотр — или снова слышно. Настройку не пишет. */
  setMuted(on: boolean): void {
    this.muted = on;
    if (on && this.armed) this.host.bed(SILENT, 0);
  }

  stop(): void {
    if (this.armed) this.host.stop();
    this.armed = false;
  }
}

// ---------- Голоса ----------

/** Шум одной секунды из своего сида: два звука подряд не копия друг друга, а случай устройства звуку не нужен. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  let x = 0x2545f491;
  for (let i = 0; i < d.length; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    d[i] = ((x >>> 0) / 4294967296) * 2 - 1;
  }
  return b;
}

/** Доля 0..1 от сида и номера: разброс высоты и мига у одного и того же звука. */
const rnd = (seed: number, k: number): number => {
  let h = (seed * 374761393 + k * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/** Сколько голосов звучит разом, не больше: на телефоне каждый узел — работа. */
const VOICES = { full: 28, lite: 12 };

/**
 * Голоса на Web Audio: граф узлов на звук, без файлов. Каждый звук живёт секунду-другую и сам себя останавливает;
 * гул — одна петля шума через две полосы, лязг и топот — короткие удары, расписанные по часам контекста.
 */
class FxVoice implements FxHost {
  private ctx: BaseAudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private roar: GainNode[] = [];
  private roarSrc: AudioScheduledSourceNode[] = [];
  private active = 0;
  private clankDebt = 0;
  private hoofAt = 0;
  private beat = 0;
  private n = 0;

  constructor(private lite: boolean) {}

  open(): boolean {
    const out = openBus(FX_VOLUME);
    if (!out) return false;
    this.out = out;
    this.ctx = out.context;
    this.noise = noiseBuffer(this.ctx);
    this.startRoar();
    return true;
  }

  private get max(): number {
    return this.lite ? VOICES.lite : VOICES.full;
  }

  /**
   * Узел стороны: −1 — левое ухо, 1 — правое. Старый вебвью без него — звук посередине. Живёт `life` секунд — дольше
   * любого звука на нём — и отпускается: граф не копит узлы за долгий ролик.
   */
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

  /** Отметить голос: живёт до `stop`, потом место свободно. */
  private voice(src: AudioScheduledSourceNode, stop: number): void {
    this.active += 1;
    src.onended = () => {
      this.active -= 1;
    };
    src.stop(stop);
  }

  private noiseSrc(at: number): AudioBufferSourceNode {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.start(at, rnd(this.n++, 1) * 1.5);
    return s;
  }

  private env(g: AudioParam, at: number, peak: number, attack: number, hold: number, release: number): void {
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(peak, at + attack);
    g.setValueAtTime(peak, at + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
  }

  private startRoar(): void {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    // Гул: шум через низкую и среднюю полосы — рёв толпы и крик над ним; дыхание — медленной волной громкости.
    for (const [freq, q, lfo] of [
      [420, 0.7, 0.21],
      [1050, 1.3, 0.37],
    ] as const) {
      const src = this.noiseSrc(now);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      const breath = ctx.createGain();
      breath.gain.value = 1;
      const wave = ctx.createOscillator();
      wave.frequency.value = lfo;
      const depth = ctx.createGain();
      depth.gain.value = 0.3;
      wave.connect(depth);
      depth.connect(breath.gain);
      src.connect(f);
      f.connect(breath);
      breath.connect(g);
      g.connect(this.out!);
      wave.start(now);
      this.roar.push(g);
      this.roarSrc.push(src, wave);
    }
  }

  cue(c: FxCue, gain: number, pan: number): void {
    if (!this.ctx || this.active >= this.max) return;
    const at = this.ctx.currentTime + 0.02;
    const dest = this.side(pan, 5);
    const g = gain * (0.35 + 0.65 * c.size);
    switch (c.kind) {
      case 'horn':
        this.horn(dest, at, gain * 0.6, c.ours ? 98 : 87, [1], 1.6);
        break;
      case 'victory':
        this.horn(dest, at, gain * 0.6, c.ours ? 98 : 87, [1, 1.25, 1.5], 0.9);
        break;
      case 'charge':
        this.trumpet(dest, at, gain * 0.45, c.ours ? 233 : 220);
        break;
      case 'cry':
        this.cry(dest, at, g * 0.5, c.seed, 1.4);
        break;
      case 'panic':
        this.cry(dest, at, g * 0.35, c.seed, 0.8, 1.9);
        break;
      case 'crash':
        this.crash(dest, at, g, c.seed);
        break;
      case 'bows':
        this.bows(dest, at, g * 0.6, c.seed, 2 + Math.round(c.size * 5));
        break;
      case 'whistle':
        this.whistle(dest, at, g * 0.35, c.dur);
        break;
      case 'thud':
        this.thud(dest, at, g * 0.4, c.seed, 3 + Math.round(c.size * 8));
        break;
      // Штурм: удар тарана, треск выбитых ворот, лестница о камень, крики на стене.
      case 'ram':
        this.ram(dest, at, g * 0.9, c.seed, false);
        break;
      case 'gate':
        this.ram(dest, at, g, c.seed, true);
        this.crash(dest, at + 0.08, g * 0.6, c.seed);
        break;
      case 'ladder':
        this.thud(dest, at, g * 0.5, c.seed, 2);
        break;
      case 'wallcry':
        this.cry(dest, at, g * 0.45, c.seed, 1.1, 1.3);
        break;
      // Обстрел перед штурмом: скрип рычага и удар перекладины, свист камня, удар в кладку, обвал.
      case 'engine':
        this.creak(dest, at, g * 0.55, c.seed);
        this.ram(dest, at + 0.32, g * 0.5, c.seed, false);
        break;
      case 'stone':
        this.whoosh(dest, at, g * 0.4, c.dur);
        break;
      case 'impact':
        this.ram(dest, at, g, c.seed, false);
        this.rubble(dest, at + 0.03, g * 0.7, c.seed, 0.6);
        break;
      case 'collapse':
        this.ram(dest, at, g, c.seed, true);
        this.rubble(dest, at + 0.1, g, c.seed, 2.2);
        break;
    }
  }

  /** Скрип рычага: пила низко, высота дрожит и ползёт вверх — дерево под натягом, и перед срывом оно поёт. */
  private creak(dest: AudioNode, at: number, gain: number, seed: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 70 + rnd(seed, 3) * 30;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.linearRampToValueAtTime(f0 * 1.9, at + 0.3);
    const wob = ctx.createOscillator();
    wob.frequency.value = 23 + rnd(seed, 4) * 9;
    const depth = ctx.createGain();
    depth.gain.value = f0 * 0.25;
    wob.connect(depth);
    depth.connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 520;
    f.Q.value = 3;
    const amp = ctx.createGain();
    this.env(amp.gain, at, gain, 0.04, 0.18, 0.12);
    o.connect(f);
    f.connect(amp);
    amp.connect(dest);
    o.start(at);
    wob.start(at);
    this.voice(o, at + 0.45);
    this.voice(wob, at + 0.45);
  }

  /** Свист камня: ниже и шире стрелы — шум сквозь полосу, что ползёт вниз, громче к середине полёта. */
  private whoosh(dest: AudioNode, at: number, gain: number, dur: number): void {
    const ctx = this.ctx!;
    const n = this.noiseSrc(at);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 3.5;
    f.frequency.setValueAtTime(1300, at);
    f.frequency.exponentialRampToValueAtTime(420, at + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(gain, at + dur * 0.55);
    amp.gain.linearRampToValueAtTime(0, at + dur);
    n.connect(f);
    f.connect(amp);
    amp.connect(dest);
    this.voice(n, at + dur + 0.05);
  }

  /** Осыпь: камни сыплются — мелкие глухие удары, реже к концу; низкий гул под ними у обвала. */
  private rubble(dest: AudioNode, at: number, gain: number, seed: number, len: number): void {
    const ctx = this.ctx!;
    const n = this.noiseSrc(at);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, at);
    f.frequency.exponentialRampToValueAtTime(160, at + len);
    const amp = ctx.createGain();
    this.env(amp.gain, at, gain * 0.6, 0.01, len * 0.2, len * 0.8);
    n.connect(f);
    f.connect(amp);
    amp.connect(dest);
    this.voice(n, at + len + 0.1);
    this.thud(dest, at + 0.05, gain * 0.5, seed + 17, Math.round(4 + len * 4));
  }

  /**
   * Таран: глухой удар бревна в дуб — низкий тон падает, под ним сухой треск дерева (полоса шума у 380 Гц); у выбитых
   * ворот треск длиннее и уходит вниз — доски ломаются.
   */
  private ram(dest: AudioNode, at: number, gain: number, seed: number, breaks: boolean): void {
    const ctx = this.ctx!;
    const boom = ctx.createOscillator();
    boom.frequency.setValueAtTime(58 + rnd(seed, 1) * 8, at);
    boom.frequency.exponentialRampToValueAtTime(26, at + 0.5);
    const bg = ctx.createGain();
    this.env(bg.gain, at, gain, 0.005, 0.06, 0.55);
    boom.connect(bg);
    bg.connect(dest);
    boom.start(at);
    this.voice(boom, at + 0.8);
    const n = this.noiseSrc(at);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(breaks ? 900 : 380, at);
    if (breaks) f.frequency.exponentialRampToValueAtTime(220, at + 1.1);
    f.Q.value = breaks ? 1.2 : 2.2;
    const ng = ctx.createGain();
    this.env(ng.gain, at, gain * (breaks ? 0.8 : 0.45), 0.004, breaks ? 0.3 : 0.04, breaks ? 1.0 : 0.25);
    n.connect(f);
    f.connect(ng);
    ng.connect(dest);
    this.voice(n, at + (breaks ? 1.6 : 0.5));
  }

  /** Рог: пила с квинтой под мягким фильтром, подъём высоты на вдохе, дрожь губ. */
  private horn(dest: AudioNode, at: number, gain: number, f0: number, notes: number[], len: number): void {
    const ctx = this.ctx!;
    notes.forEach((k, i) => {
      const t = at + i * len * 0.8;
      const amp = ctx.createGain();
      this.env(amp.gain, t, gain, 0.25, len * 0.75, 0.5);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(500, t);
      f.frequency.linearRampToValueAtTime(900, t + 0.4);
      f.connect(amp);
      amp.connect(dest);
      for (const [mul, level] of [
        [1, 1],
        [1.5, 0.45],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        const freq = f0 * k * mul;
        o.frequency.setValueAtTime(freq * 0.94, t);
        o.frequency.linearRampToValueAtTime(freq, t + 0.3);
        const vib = ctx.createOscillator();
        vib.frequency.value = 5.2;
        const vd = ctx.createGain();
        vd.gain.value = freq * 0.006;
        vib.connect(vd);
        vd.connect(o.frequency);
        const lv = ctx.createGain();
        lv.gain.value = level;
        o.connect(lv);
        lv.connect(f);
        o.start(t);
        vib.start(t);
        vib.stop(t + len + 1);
        this.voice(o, t + len + 1);
      }
    });
  }

  /** Трубы на разбег: три ноты — та-та-таа. */
  private trumpet(dest: AudioNode, at: number, gain: number, f0: number): void {
    const ctx = this.ctx!;
    const notes: [number, number, number][] = [
      [0, 1, 0.16],
      [0.22, 1, 0.16],
      [0.44, 4 / 3, 0.75],
    ];
    for (const [dt, k, len] of notes) {
      const t = at + dt;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f0 * k;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1300;
      f.Q.value = 0.9;
      const amp = ctx.createGain();
      this.env(amp.gain, t, gain, 0.03, len, 0.2);
      o.connect(f);
      f.connect(amp);
      amp.connect(dest);
      o.start(t);
      this.voice(o, t + len + 0.3);
    }
  }

  /** Клич и крик: несколько голосов «а-а» — пила через две форманты, высота вверх и вниз. */
  private cry(dest: AudioNode, at: number, gain: number, seed: number, len: number, high = 1): void {
    const ctx = this.ctx!;
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 760 * high;
    f1.Q.value = 3;
    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 1180 * high;
    f2.Q.value = 4;
    const amp = ctx.createGain();
    this.env(amp.gain, at, gain, 0.18, len * 0.5, len * 0.5);
    f1.connect(amp);
    f2.connect(amp);
    amp.connect(dest);
    const voices = this.lite ? 2 : 4;
    for (let i = 0; i < voices; i++) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const f = (150 + rnd(seed, i) * 80) * high;
      o.frequency.setValueAtTime(f, at);
      o.frequency.linearRampToValueAtTime(f * 1.18, at + len * 0.3);
      o.frequency.linearRampToValueAtTime(f * 0.9, at + len);
      o.connect(f1);
      o.connect(f2);
      o.start(at + rnd(seed, i + 9) * 0.12);
      this.voice(o, at + len + 0.2);
    }
  }

  /** Удар строя о строй: глухой удар, шум свалки и россыпь лязга. */
  private crash(dest: AudioNode, at: number, gain: number, seed: number): void {
    const ctx = this.ctx!;
    const thump = ctx.createOscillator();
    thump.frequency.setValueAtTime(70, at);
    thump.frequency.exponentialRampToValueAtTime(34, at + 0.35);
    const tg = ctx.createGain();
    this.env(tg.gain, at, gain * 0.9, 0.01, 0.05, 0.45);
    thump.connect(tg);
    tg.connect(dest);
    thump.start(at);
    this.voice(thump, at + 0.6);
    const n = this.noiseSrc(at);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1700;
    f.Q.value = 0.8;
    const ng = ctx.createGain();
    this.env(ng.gain, at, gain * 0.7, 0.01, 0.1, 0.6);
    n.connect(f);
    f.connect(ng);
    ng.connect(dest);
    this.voice(n, at + 0.8);
    for (let i = 0; i < (this.lite ? 2 : 5); i++) this.clank(dest, at + rnd(seed, i) * 0.45, gain * (0.3 + 0.4 * rnd(seed, i + 7)), seed + i);
  }

  /** Лязг: железо о железо — частотная модуляция с быстрым затуханием. */
  private clank(dest: AudioNode, at: number, gain: number, seed: number): void {
    if (this.active >= this.max) return;
    const ctx = this.ctx!;
    const f = 900 + rnd(seed, 3) * 1700;
    const car = ctx.createOscillator();
    car.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 1.47;
    const md = ctx.createGain();
    md.gain.value = f * 2.2;
    mod.connect(md);
    md.connect(car.frequency);
    const amp = ctx.createGain();
    this.env(amp.gain, at, gain, 0.002, 0.01, 0.16 + rnd(seed, 4) * 0.12);
    car.connect(amp);
    amp.connect(dest);
    car.start(at);
    mod.start(at);
    mod.stop(at + 0.35);
    this.voice(car, at + 0.35);
  }

  /** Срыв залпа: щелчки тетив вразнобой. */
  private bows(dest: AudioNode, at: number, gain: number, seed: number, count: number): void {
    const ctx = this.ctx!;
    for (let i = 0; i < count; i++) {
      const t = at + rnd(seed, i) * 0.3;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(190 + rnd(seed, i + 3) * 60, t);
      o.frequency.exponentialRampToValueAtTime(110, t + 0.08);
      const amp = ctx.createGain();
      this.env(amp.gain, t, gain * 0.6, 0.002, 0.005, 0.09);
      o.connect(amp);
      amp.connect(dest);
      o.start(t);
      this.voice(o, t + 0.15);
    }
  }

  /** Свист тучи: шум сквозь узкую полосу, которая едет вниз, пока стрелы летят. */
  private whistle(dest: AudioNode, at: number, gain: number, dur: number): void {
    const ctx = this.ctx!;
    const n = this.noiseSrc(at);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 7;
    f.frequency.setValueAtTime(3800, at);
    f.frequency.exponentialRampToValueAtTime(1800, at + dur);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, at);
    amp.gain.linearRampToValueAtTime(gain, at + dur * 0.4);
    amp.gain.linearRampToValueAtTime(0, at + dur);
    n.connect(f);
    f.connect(amp);
    amp.connect(dest);
    this.voice(n, at + dur + 0.05);
  }

  /** Стрелы ложатся: частый мелкий стук по щитам и земле. */
  private thud(dest: AudioNode, at: number, gain: number, seed: number, count: number): void {
    const ctx = this.ctx!;
    for (let i = 0; i < count; i++) {
      const t = at + rnd(seed, i) * 0.5;
      const n = this.noiseSrc(t);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1000 + rnd(seed, i + 5) * 2200;
      f.Q.value = 2;
      const amp = ctx.createGain();
      this.env(amp.gain, t, gain * (0.4 + 0.6 * rnd(seed, i + 11)), 0.001, 0.004, 0.03);
      n.connect(f);
      f.connect(amp);
      amp.connect(dest);
      this.voice(n, t + 0.06);
    }
  }

  /** Копыто: глухой удар в землю. */
  private hoof(dest: AudioNode, at: number, gain: number): void {
    if (this.active >= this.max) return;
    const ctx = this.ctx!;
    const n = this.noiseSrc(at);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300;
    const amp = ctx.createGain();
    this.env(amp.gain, at, gain, 0.003, 0.01, 0.06);
    n.connect(f);
    f.connect(amp);
    amp.connect(dest);
    this.voice(n, at + 0.1);
  }

  bed(b: FxBed, dt: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    // Гул: громкость за четверть секунды — без щелчков на смене кадра.
    this.roar.forEach((g, i) => g.gain.setTargetAtTime(b.roar * (i === 0 ? 0.55 : 0.3), now, 0.25));
    // Лязг: сколько ударов в секунду — по рубящимся у уха; долг копится между кадрами.
    this.clankDebt = Math.min(4, this.clankDebt + b.clash * dt);
    if (this.clankDebt >= 1) {
      const dest = this.side(b.clashPan, 1);
      while (this.clankDebt >= 1) {
        this.clankDebt -= 1;
        this.n += 1;
        this.clank(dest, now + rnd(this.n, 1) * 0.08, 0.12 + 0.18 * rnd(this.n, 2), this.n);
      }
    }
    // Топот: галоп — три удара на круг, расписанные чуть вперёд по часам контекста.
    if (b.hooves > 0.03) {
      if (this.hoofAt < now) this.hoofAt = now + 0.02;
      // Узел стороны — только когда в этот кадр выпадает удар: не на каждый кадр топота.
      const dest = this.hoofAt < now + 0.12 ? this.side(b.hoovesPan, 1) : null;
      while (dest && this.hoofAt < now + 0.12) {
        this.hoof(dest, this.hoofAt, b.hooves * 0.35 * (0.7 + 0.3 * rnd(this.beat, 3)));
        this.hoofAt += [0.11, 0.11, 0.24][this.beat++ % 3];
      }
    }
  }

  stop(): void {
    const ctx = this.ctx;
    for (const s of this.roarSrc) {
      try {
        s.stop();
      } catch {
        // Уже остановлен — не беда.
      }
    }
    this.roarSrc = [];
    this.roar = [];
    if (ctx && this.out) {
      // Выход гасится за десятую — хвосты звуков дотухают без щелчка, а потом выход отпускается.
      this.out.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
      const out = this.out;
      setTimeout(() => out.disconnect(), 400);
    }
    this.out = null;
    this.ctx = null;
  }
}

/** Звуки боя на этот ролик: голоса Web Audio и общий рычаг звука. `lite` — низкий уровень качества. */
export function battleFx(lite: boolean, enabled: () => boolean = soundOn): BattleFx {
  return new BattleFx(new FxVoice(lite), enabled, lite);
}
