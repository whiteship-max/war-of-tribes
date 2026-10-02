// Дверь нового вида карты (docs/map_tw.md) в кадр и в касание. В первой загрузке от него только эта
// ячейка: сам вид едет своим куском — `ground.ts` подгружает `tw/hook.ts` по флагу `?map=tw` (`look.ts`), и
// тот кладёт сюда свой кадр и свой выбор цели пальцем. Пока ячейка пуста — карта прежняя целиком.
import type { Coord } from '@/world/types';
import type { Camera, Viewport } from './grid';

export interface TwSlot {
  /** Кадр карты целиком — вместо прежнего `frame.drawFrame`. */
  frame(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number, frame: number): void;
  /**
   * Клетка, в которую целился палец в точке экрана `x`, `y`: клетка объекта, нарисованного под пальцем
   * (цель не меньше пальца), или null — тогда клетка под точкой. Смысл тапа решает прежний `openAt` по
   * клетке: эта дверь только находит, **какую** клетку имел в виду игрок. `hand` — агент в руке.
   */
  tap(cam: Camera, vp: Viewport, x: number, y: number, hand: boolean): Coord | null;
  /** Уборка испечённого: новый мир, другая плотность экрана, уход с карты. */
  drop(): void;
}

let slot: TwSlot | null = null;

export const twSlot = (): TwSlot | null => slot;

export function setTwSlot(next: TwSlot): void {
  slot = next;
}
