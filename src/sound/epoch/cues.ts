// Звуки интерфейса (docs/audio.md, раздел 7): тихие и короткие. Касание кнопки — глухой щелчок деревом, не звон;
// стройка готова — две ноты лютни квинтой вверх; тревога — рог, два зова. Отдельно от `index.ts`, чтобы те же звуки
// рисовала офлайн-отрисовка образцов (`npm run audio:samples`).
import { horn, pluck, tap, type Kit } from './synth';

/** Звук интерфейса. */
export type Cue = 'tap' | 'built' | 'alarm';

/**
 * Уровни: касание едва слышно, рог — заметно громче фона, но не пугает. Выставлены офлайн-отрисовкой (образец `ui`,
 * docs/audio.md, раздел 6): при 0.32 второй зов рога вставал на 16 дБ над фоном.
 */
export const UI_MIX = { tap: 0.3, built: 0.18, alarm: 0.09 } as const;

/** Сыграть звук интерфейса в `at`. */
export function playCue(kit: Kit, out: AudioNode, name: Cue, at: number): void {
  const ctx = kit.ctx;
  if (name === 'alarm') {
    horn(kit, out, at, 50, 0.7, UI_MIX.alarm);
    horn(kit, out, at + 0.95, 50, 1.3, UI_MIX.alarm);
    return;
  }
  const g = ctx.createGain();
  g.gain.value = UI_MIX[name];
  g.connect(out);
  if (name === 'tap') tap(kit, g, at);
  else {
    pluck(kit, g, at, 69, 0.8);
    pluck(kit, g, at + 0.14, 76, 0.9);
  }
}
