// Дверь нового вида карты (docs/map_tw.md) в кадр, в касание и в камеру. В первой загрузке от него только эта
// ячейка: сам вид едет своим куском — он подгружается здесь же по флагу `?map=tw` (`look.ts`) и кладёт сюда свой
// кадр, свой выбор цели пальцем и рамку своего региона. Пока ячейка пуста — карта прежняя целиком.
import type { Coord } from '@/world/types';
import type { Camera, Viewport } from './grid';
import { MAP_TW } from './look';

export interface TwSlot {
  /** Кадр карты целиком — вместо прежнего `frame.drawFrame`. */
  frame(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, dpr: number, frame: number): void;
  /**
   * Клетка, в которую целился палец в точке экрана `x`, `y`: клетка объекта, нарисованного под пальцем
   * (цель не меньше пальца), или null — тогда клетка под точкой. Смысл тапа решает прежний `openAt` по
   * клетке: эта дверь только находит, **какую** клетку имел в виду игрок. `hand` — агент в руке.
   */
  tap(cam: Camera, vp: Viewport, x: number, y: number, hand: boolean): Coord | null;
  /** Камера в рамке региона игрока (docs/map_tw.md, раздел 13.5) — поверх прежних поводка и потолка отдаления. */
  hold(cam: Camera, vp: Viewport): Camera;
  /** Клетка в регионе игрока? Вне его цели нет — ни тапом по карте, ни из меню и карточки. */
  reach(c: Coord): boolean;
  /** Имя региона игрока — для строки «за краем земли»; null — региона нет. */
  realm(): string | null;
  /** Уборка испечённого: новый мир, другая плотность экрана, уход с карты. */
  drop(): void;
}

let slot: TwSlot | null = null;

export const twSlot = (): TwSlot | null => slot;

export function setTwSlot(next: TwSlot): void {
  slot = next;
}

/** Клетка доступна как цель: без нового вида — всегда (прежняя карта рамки не знает). */
export const reachable = (c: Coord): boolean => slot?.reach(c) ?? true;

/** Строка игроку о клетке за краем региона. */
export const beyondText = (): string => `Это уже не ${slot?.realm() ?? 'ваша земля'}: за край своей земли походы пока не ходят.`;

// Новый вид — своим куском и только по флагу: приехал — сам кладёт себя в ячейку (`tw/hook.ts`).
if (MAP_TW) void import('./tw/hook');
