// Регион на экране (docs/map_tw.md, раздел 13.5): какой регион сейчас рисует карта. Сама разметка и мерка «своё ли
// это» — в мире (`world/theatre/theatre.ts`), одна на мир и на карту; здесь только запомненный регион игрока, чтобы
// кадр не искал его по дому на каждый объект.
import { type Theatre, inTheatre } from '@/world/theatre/theatre';

let active: Theatre | null = null;

/** Регион, который видит игрок, — по клетке его города. Нет города — нет и региона: карта без рамки. */
export function setActiveTheatre(t: Theatre | null): void {
  active = t;
}

export const activeTheatre = (): Theatre | null => active;

/**
 * Клетка в регионе игрока? Пока региона нет (мир не приехал, стенд, тест) — да: рамки нет, и карта не прячет
 * ничего. Одна мерка на кадр, палец и меню: что не рисуется, то и не выбирается, — и та же, что у мира.
 */
export const withinActive = (x: number, y: number): boolean => inTheatre(active, x, y);
