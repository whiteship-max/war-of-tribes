// Дверь звука из первой загрузки (docs/polish.md, П-3; docs/sound.md): здесь — только то, что должно быть под рукой у
// жеста. Создать единственный `AudioContext` в самом обработчике касания (iOS, вебвью Telegram и браузеры дают звук
// лишь жесту) и разбудить уснувший; всё звучащее — движок с цепочкой выхода и музыкой боя (`sound/web.ts`), фон и
// музыка эпохи (`sound/epoch/`), звуки боя, промыслов и вой — едет докачкой после касания, в первую загрузку не входит
// (`vite.config.ts`, `LAZY_DOORS` «звук: движок»).
//
// **Контекст один на всю игру** (прежде он жил в `web.ts`, решение там же): на iOS каждый новый контекст — свой
// аппаратный поток, который вебвью усыпляет по своему усмотрению. Создаёт его только `gestureAudio` — из жеста.
import { soundOn } from './settings';

type Engine = typeof import('./web');

let ctx: AudioContext | null = null;
let engine: Engine | null = null;
let pulling: Promise<Engine> | null = null;

/**
 * Жест игрока: создать контекст (один на игру) или разбудить уснувший — вебвью усыпляет его на сворачивании и по своему
 * усмотрению, поэтому будит каждое касание. Звук выключен — не создаёт ничего (`null`). Зовётся ТОЛЬКО из жеста: `await`
 * перед ним теряет пользовательскую активацию.
 */
export function gestureAudio(): AudioContext | null {
  if (!soundOn()) return null;
  if (ctx) {
    void ctx.resume().catch(() => undefined);
    return ctx;
  }
  const Ctor: typeof AudioContext | undefined =
    typeof window === 'undefined'
      ? undefined
      : window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    void ctx.resume().catch(() => undefined);
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Движок звука — докачкой; второй вызов отдаёт тот же кусок. */
export function audioEngine(): Promise<Engine> {
  if (!pulling) {
    pulling = import('./web').then((m) => (engine = m));
    // Не доехал (сеть) — следующее касание попробует снова.
    pulling.catch(() => (pulling = null));
  }
  return pulling;
}

/**
 * Музыка боя из первой загрузки — жестом «Смотреть бой»: контекст — сейчас, в нажатии, движок с музыкой — докачкой.
 * Выключение не качает движок ради тишины: не приезжал — и молчать нечему.
 */
export const battleMusicDoor = {
  arm(): void {
    if (!gestureAudio()) return;
    void audioEngine()
      .then((m) => m.battleMusic.arm())
      .catch(() => undefined);
  },
  off(): void {
    engine?.battleMusic.toggle(false);
  },
};
