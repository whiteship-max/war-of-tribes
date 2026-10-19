// Дверь вида карты (docs/map_tw.md) в кадр, в касание и в камеру. В первой загрузке от него только эта ячейка: сам вид
// едет своим куском — он подгружается здесь же на запуске и кладёт сюда свой кадр, свой выбор цели пальцем и рамку своего
// региона. Пока ячейка пуста (кусок едет или не приехал), карта — пустой лист (`frame.drawFrame`). Прежней карты нет — она
// удалена вместе с переключателем «Карта мира» (docs/ui_audit.md, 16).
import type { Coord } from '@/world/types';
import { useWorld } from '@/world/store';
import { beyondNote, inHomeTheatre } from '@/world/theatre/theatre';
import type { Camera, Viewport } from './grid';
import type { FrameMotion } from './still';
import type { Quality } from '@/render/quality';

export interface TwSlot {
  /** Кадр карты целиком; вернёт, что в нём движется само, — по нему карта решает, когда рисовать следующий (`still.ts`). */
  frame(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number, frame: number): FrameMotion;
  /**
   * Клетка, в которую целился палец в точке экрана `x`, `y`: клетка объекта, нарисованного под пальцем
   * (цель не меньше пальца), или null — тогда клетка под точкой. Смысл тапа решает `openAt` по
   * клетке: эта дверь только находит, **какую** клетку имел в виду игрок. `hand` — агент в руке.
   */
  tap(cam: Camera, vp: Viewport, x: number, y: number, hand: boolean): Coord | null;
  /** Камера в рамке региона игрока (docs/map_tw.md, раздел 13.5) — поверх прежних поводка и потолка отдаления. */
  hold(cam: Camera, vp: Viewport): Camera;
  /** Что кадр читает из партии, одной строкой: сменилась — стоящую карту будят (`tw/frame.partyLook`, `still.ts`). */
  party(): string;
  /** Уборка испечённого: новый мир, другая плотность экрана, уход с карты. */
  drop(): void;
  /** Уровень кадра карты — уровень игры, опущенный сторожем карты (`tw/quality.mapLevel`): плотность холста и шаг стоя. */
  level(): Quality;
  /** Промежуток кадра в непрерывном ходе — сторожу плавности карты (`tw/quality.watchMap`, К-1). */
  watch(gap: number): void;
}

let slot: TwSlot | null = null;

/** Ячейка вида; null — кусок ещё не приехал. */
export const twSlot = (): TwSlot | null => slot;

export function setTwSlot(next: TwSlot): void {
  slot = next;
}

/**
 * Клетка доступна как цель: она в регионе игрока (docs/map_tw.md, 0.−2). Мерка — мира (`world/theatre`), та же, по
 * которой мир отклоняет поход за край: карта не зовёт туда, куда мир откажет идти, и спрашивает её до приезда куска
 * вида. Мира ещё нет — рамки нет.
 */
export const reachable = (c: Coord): boolean => {
  const home = useWorld.getState().info?.home;
  return !home || inHomeTheatre(home, c);
};

/** Строка игроку о клетке за краем региона — те же слова, что у отказа мира. */
export const beyondText = (): string => beyondNote(useWorld.getState().info?.home ?? null);

// Вид — своим куском: приехал — сам кладёт себя в ячейку (`tw/hook.ts`).
if (typeof location !== 'undefined') void import('./tw/hook');
