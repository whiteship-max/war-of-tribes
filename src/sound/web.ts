// `AudioHost` на Web Audio. Единственное место в проекте, где есть
// `AudioContext`, `fetch` за звуком и слово `mp3` в рантайме.
//
// Слои крутятся **с общего начала и одновременно**, а переключение — это
// громкости. Не потому, что так проще: дорожки — один и тот же материал в трёх
// плотностях, и если пускать их по очереди, каждая смена слоя будет слышна
// швом. Играют все три, слышен один.
import { BattleMusic, type AudioHost } from './music';
import { soundOn } from './settings';

/** Громкость слышимого слоя. Музыка под роликом, а не вместо него. */
const VOLUME = 0.55;

interface Voice {
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  buffer: AudioBuffer;
}

class WebAudioHost implements AudioHost {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private voices = new Map<string, Voice>();

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
        : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    try {
      this.ctx = new Ctor();
      this.out = this.ctx.createGain();
      this.out.gain.value = VOLUME;
      this.out.connect(this.ctx.destination);
      void this.ctx.resume().catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }

  async load(id: string, url: string): Promise<boolean> {
    const ctx = this.ctx;
    if (!ctx) return false;
    try {
      // 404 — обычный ответ, а не исключение: файлов может ещё не быть, и
      // ролик обязан пойти молча. Поэтому проверяем `ok`, а не ловим ошибку.
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) return false;
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(this.out ?? ctx.destination);
      this.voices.set(id, { gain, source: null, buffer });
      return true;
    } catch {
      return false;
    }
  }

  start(loop: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    // Общее начало на все слои: смещение хотя бы в кадр — и перелив слышен швом.
    const at = ctx.currentTime + 0.05;
    for (const voice of this.voices.values()) {
      voice.source?.stop();
      const source = ctx.createBufferSource();
      source.buffer = voice.buffer;
      source.loop = true;
      source.loopEnd = Math.min(loop, voice.buffer.duration);
      source.connect(voice.gain);
      source.start(at);
      voice.source = source;
    }
  }

  layer(id: string | null, fade: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const [key, voice] of this.voices) {
      const to = key === id ? 1 : 0;
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
 * Музыка боя на всю игру: контекст один, дорожки качаются один раз и лежат в
 * кэше браузера. Ролики открываются и закрываются, а это переживает их все.
 */
export const battleMusic = new BattleMusic(new WebAudioHost(), soundOn);
