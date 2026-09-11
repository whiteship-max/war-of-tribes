// Среда для музыки на Web Audio. Единственное место в проекте, где есть
// `AudioContext`, `fetch` за звуком и слово `mp3` в рантайме.
//
// **Контекст один на всю игру, и это не экономия.** На iOS каждый новый
// `AudioContext` — отдельный аппаратный поток, который вебвью в фоне усыпляет
// по своему усмотрению; два контекста означали бы, что деревня и бой засыпают
// врозь и просыпаются врозь. Поэтому здесь один движок, а музыки над ним две:
// у боя слои с общего начала, у деревни очередь с переливом. Третий звук — вой
// волка — берёт у движка только выход (`openBus`) и живёт своим файлом, чанком
// предыстории: в первую загрузку он не едет.
import { BattleMusic, type AudioHost } from './music';
import { VillageMusic, type VillageHost } from './village';
import { soundOn } from './settings';

/** Громкость музыки боя. Она под роликом, а не вместо него. */
const BATTLE_VOLUME = 0.55;
/** Громкость деревни. Тише боя: это фон, под который играют, а не смотрят. */
const VILLAGE_VOLUME = 0.38;

interface Voice {
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  buffer: AudioBuffer;
}

/** Контекст и загрузка — одни на обе музыки. */
class Engine {
  ctx: AudioContext | null = null;

  open(): boolean {
    if (this.ctx) {
      // Вебвью любит усыплять контекст на каждом сворачивании: будим при каждом
      // жесте, а не только при первом.
      void this.ctx.resume().catch(() => undefined);
      return true;
    }
    const Ctor: typeof AudioContext | undefined =
      typeof window === 'undefined'
        ? undefined
        : window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    try {
      this.ctx = new Ctor();
      void this.ctx.resume().catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  /** Выход с постоянной громкостью: у боя своя, у деревни своя. */
  bus(volume: number): GainNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(ctx.destination);
    return gain;
  }

  async decode(url: string): Promise<AudioBuffer | null> {
    const ctx = this.ctx;
    if (!ctx) return null;
    try {
      // 404 — обычный ответ, а не исключение: файла может не быть, и игра
      // обязана пойти молча. Поэтому проверяем `ok`, а не ловим ошибку.
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) return null;
      return await ctx.decodeAudioData(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
}

const engine = new Engine();

/**
 * Общий звуковой выход для звука, который живёт не здесь.
 *
 * Появился вместе с воем волка, и затем, чтобы вой уехал чанком предыстории, а
 * не в первую загрузку: синтез — полсотни строк, и платить за них каждому, кто в
 * предысторию не зайдёт, незачем (`sound/howl.ts`). Контекст при этом остаётся
 * **один на всю игру** и создаётся по-прежнему здесь: наружу отдаётся только
 * выход с громкостью, а узлы на него вешает тот, кто звучит.
 *
 * Зовётся ТОЛЬКО из жеста игрока. `null` — звука в этой среде нет.
 */
export function openBus(volume: number): GainNode | null {
  if (!engine.open()) return null;
  return engine.bus(volume);
}

/**
 * Бой: слои крутятся **с общего начала и одновременно**, а переключение — это
 * громкости. Не потому, что так проще: слои — один и тот же материал в трёх
 * плотностях, и по очереди каждая смена была бы слышна швом. Играют все,
 * слышен нужный. Цельная дорожка — тот же механизм с одной дорожкой в наборе.
 */
class BattleHost implements AudioHost {
  private out: GainNode | null = null;
  private voices = new Map<string, Voice>();

  open(): boolean {
    if (!engine.open()) return false;
    if (!this.out) this.out = engine.bus(BATTLE_VOLUME);
    return this.out !== null;
  }

  async load(id: string, url: string): Promise<boolean> {
    const ctx = engine.ctx;
    const buffer = ctx ? await engine.decode(url) : null;
    if (!ctx || !buffer || !this.out) return false;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.out);
    this.voices.set(id, { gain, source: null, buffer });
    return true;
  }

  start(loop: number | null): void {
    const ctx = engine.ctx;
    if (!ctx) return;
    // Общее начало на все слои: смещение хотя бы в кадр — и перелив слышен швом.
    const at = ctx.currentTime + 0.05;
    for (const voice of this.voices.values()) {
      voice.source?.stop();
      const source = ctx.createBufferSource();
      source.buffer = voice.buffer;
      source.loop = true;
      source.loopEnd = loop === null ? voice.buffer.duration : Math.min(loop, voice.buffer.duration);
      source.connect(voice.gain);
      source.start(at);
      voice.source = source;
    }
  }

  mix(levels: Record<string, number>, fade: number): void {
    const ctx = engine.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [key, voice] of this.voices) {
      const to = levels[key] ?? 0;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(to, now + fade);
    }
  }

  stop(): void {
    for (const voice of this.voices.values()) {
      voice.source?.stop();
      voice.source = null;
      voice.gain.gain.value = 0;
    }
  }
}

/**
 * Деревня: очередь разных пьес. Играет одна, соседняя переливается поверх, и в
 * памяти держатся ровно две — играющая и скачанная следующая.
 */
class VillageAudioHost implements VillageHost {
  private out: GainNode | null = null;
  private voices = new Map<string, Voice>();

  open(): boolean {
    if (!engine.open()) return false;
    if (!this.out) this.out = engine.bus(VILLAGE_VOLUME);
    return this.out !== null;
  }

  async load(id: string, url: string): Promise<number> {
    const ctx = engine.ctx;
    const buffer = ctx ? await engine.decode(url) : null;
    if (!ctx || !buffer || !this.out) return 0;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.out);
    this.voices.set(id, { gain, source: null, buffer });
    return buffer.duration;
  }

  play(id: string, fade: number): void {
    const ctx = engine.ctx;
    const voice = this.voices.get(id);
    if (!ctx || !voice) return;
    const now = ctx.currentTime;
    // Новая набирает, все прочие затухают — это и есть перелив. Дорожки
    // деревни не петляются: круг ведёт машинка, а петля скрыла бы её конец.
    const source = ctx.createBufferSource();
    source.buffer = voice.buffer;
    source.connect(voice.gain);
    source.start(now);
    voice.source = source;
    for (const [key, other] of this.voices) {
      const to = key === id ? 1 : 0;
      other.gain.gain.cancelScheduledValues(now);
      other.gain.gain.setValueAtTime(other.gain.gain.value, now);
      other.gain.gain.linearRampToValueAtTime(to, now + fade);
    }
  }

  drop(id: string): void {
    const voice = this.voices.get(id);
    if (!voice) return;
    // Останавливаем не сразу: дорожка ещё дотухает переливом, и обрыв на
    // полугромкости слышен щелчком.
    const ctx = engine.ctx;
    const stopAt = ctx ? ctx.currentTime + 4 : 0;
    try {
      voice.source?.stop(stopAt);
    } catch {
      // Источник мог и не пуститься — тогда останавливать нечего.
    }
    voice.source = null;
    this.voices.delete(id);
  }

  volume(level: number, fade: number): void {
    const ctx = engine.ctx;
    if (!ctx || !this.out) return;
    const now = ctx.currentTime;
    this.out.gain.cancelScheduledValues(now);
    this.out.gain.setValueAtTime(this.out.gain.value, now);
    this.out.gain.linearRampToValueAtTime(level * VILLAGE_VOLUME, now + fade);
  }

  stop(): void {
    for (const voice of this.voices.values()) {
      try {
        voice.source?.stop();
      } catch {
        // Уже остановлен — не беда.
      }
      voice.source = null;
    }
    this.voices.clear();
  }
}

/**
 * Музыка боя на всю игру: контекст один, дорожки качаются один раз и лежат в
 * кэше браузера. Ролики открываются и закрываются, а это переживает их все.
 */
export const battleMusic = new BattleMusic(new BattleHost(), soundOn);

/**
 * Музыка деревни. Заводится первым же нажатием игрока в интерфейсе — в вебвью
 * Telegram звук без жеста не заиграет вовсе.
 */
export const villageMusic = new VillageMusic(new VillageAudioHost(), undefined, soundOn);
