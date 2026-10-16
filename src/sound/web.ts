// Среда для звука на Web Audio — движок: единственное место в проекте, где есть
// `fetch` за звуком и слово `mp3` в рантайме. Сам контекст создаёт дверь из первой
// загрузки (`sound/door.ts`, жестом), а движок едет докачкой (П-3: в первую загрузку
// из звука — ничего).
//
// **Контекст один на всю игру, и это не экономия.** На iOS каждый новый
// `AudioContext` — отдельный аппаратный поток, который вебвью в фоне усыпляет
// по своему усмотрению; два контекста означали бы, что город и бой засыпают
// врозь и просыпаются врозь. Поэтому здесь один движок: музыка боя (дорожка),
// а всё процедурное — звук города и карты (`sound/city.ts` и его докачка
// `sound/epoch/`), вой волка, звуки боя и промыслов — берёт у движка только
// выход (`openBus`) и живёт своим куском: в первую загрузку оно не едет.
//
// Выход идёт через три ступени (docs/audio.md, раздел 3): громкость рода
// (музыка, эффекты или окружение, `soundGain`) → общий выход с паузой в фоне → ограничитель
// перед динамиком. Пауза — здесь же: свёрнутая аппка или скрытая страница
// гасят выход за десятую долю секунды и усыпляют контекст, возврат будит его и
// поднимает выход плавно, без щелчка (`watchAway` — тот же свод сигналов, что у
// двери кадра).
import { BattleMusic, type AudioHost } from './music';
import { SOUND_KINDS, soundGain, soundOn, subscribeSound, type SoundKind } from './settings';
import { watchAway } from '@/render/loop';
import { outputChain } from './chain';
import { gestureAudio } from './door';

/** Громкость музыки боя. Она под роликом, а не вместо него. */
const BATTLE_VOLUME = 0.55;

/** За сколько гаснет выход при уходе в фон и набирается при возврате (постоянная времени, с). */
const AWAY_FADE = 0.03;
const BACK_FADE = 0.2;

interface Voice {
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  buffer: AudioBuffer;
}

/** Контекст, выходы и загрузка — одни на весь звук игры. */
class Engine {
  ctx: AudioContext | null = null;
  /** Громкость рода: музыка, эффекты, окружение. */
  private kinds: Record<SoundKind, GainNode> | null = null;
  /** Общий выход: на нём пауза в фоне. */
  private master: GainNode | null = null;
  /** Номер ухода в фон: возврат раньше, чем контекст уснул, отменяет сон. */
  private away = 0;

  /**
   * Контекст двери (`door.gestureAudio`): создан жестом или разбужен им — вебвью любит усыплять его на каждом
   * сворачивании, поэтому будит каждый жест, а не только первый. Выход на нём собирается один раз.
   */
  open(): boolean {
    const ctx = gestureAudio();
    if (!ctx) return false;
    if (this.ctx !== ctx) {
      this.ctx = ctx;
      this.wire(ctx);
    }
    return true;
  }

  /** Ступени выхода — общая цепочка (`sound/chain.ts`), та же, что меряет офлайн-стенд. */
  private wire(ctx: AudioContext): void {
    const chain = outputChain(ctx, { music: this.level('music'), fx: this.level('fx'), amb: this.level('amb') });
    this.master = chain.master;
    this.kinds = chain.kinds;
    // Громкость из настроек — плавно: ползунок, который щёлкает на каждом шаге, хуже, чем никакого.
    subscribeSound(() => {
      const kinds = this.kinds;
      if (!kinds) return;
      const now = ctx.currentTime;
      for (const k of SOUND_KINDS) kinds[k].gain.setTargetAtTime(this.level(k), now, 0.05);
    });
    watchAway((away) => this.sleep(away));
  }

  private level(kind: SoundKind): number {
    return soundOn() ? soundGain(kind) : 0;
  }

  /** Свернули — погасить выход и усыпить контекст; развернули — разбудить и поднять выход без щелчка. */
  private sleep(away: boolean): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const turn = ++this.away;
    if (away) {
      master.gain.setTargetAtTime(0, ctx.currentTime, AWAY_FADE);
      setTimeout(() => {
        if (turn === this.away) void ctx.suspend().catch(() => undefined);
      }, 200);
      return;
    }
    void ctx
      .resume()
      .catch(() => undefined)
      .then(() => {
        if (turn !== this.away) return;
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.setTargetAtTime(1, ctx.currentTime, BACK_FADE);
      });
  }

  /** Выход с постоянной громкостью на ступени своего рода. */
  bus(volume: number, kind: SoundKind = 'fx'): GainNode | null {
    const ctx = this.ctx;
    const into = this.kinds?.[kind];
    if (!ctx || !into) return null;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    gain.connect(into);
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
export function openBus(volume: number, kind: SoundKind = 'fx'): GainNode | null {
  if (!engine.open()) return null;
  return engine.bus(volume, kind);
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
    if (!this.out) this.out = engine.bus(BATTLE_VOLUME, 'music');
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
 * Музыка боя на всю игру: контекст один, дорожки качаются один раз и лежат в
 * кэше браузера. Ролики открываются и закрываются, а это переживает их все.
 */
export const battleMusic = new BattleMusic(new BattleHost(), soundOn);

