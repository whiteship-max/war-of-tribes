// Цепочка выхода звука: громкость рода (музыка, звуки) → общий выход (на нём пауза в фоне) → ограничитель → динамик.
// Одна на игру (`sound/web.ts`) и на офлайн-отрисовку образцов и уровней (`npm run audio:samples`): стенд меряет ровно
// ту цепочку, что звучит у игрока (docs/audio.md, раздел 6).
import type { SoundKind } from './settings';

/** Ограничитель — страховка от перегруза, а не звук: на выставленных уровнях он почти не работает. */
export const LIMITER = { threshold: -6, knee: 4, ratio: 12, attack: 0.003, release: 0.25 } as const;

export interface OutputChain {
  master: GainNode;
  kinds: Record<SoundKind, GainNode>;
}

/** Собрать цепочку на контексте. `limit: false` — без ограничителя: стенд так меряет запас до перегруза. */
export function outputChain(ctx: BaseAudioContext, levels: Record<SoundKind, number>, limit = true): OutputChain {
  const master = ctx.createGain();
  if (limit) {
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER.threshold;
    limiter.knee.value = LIMITER.knee;
    limiter.ratio.value = LIMITER.ratio;
    limiter.attack.value = LIMITER.attack;
    limiter.release.value = LIMITER.release;
    limiter.connect(ctx.destination);
    master.connect(limiter);
  } else master.connect(ctx.destination);
  const kind = (k: SoundKind): GainNode => {
    const g = ctx.createGain();
    g.gain.value = levels[k];
    g.connect(master);
    return g;
  };
  return { master, kinds: { music: kind('music'), fx: kind('fx') } };
}
