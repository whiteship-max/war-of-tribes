// Необратимое — двумя касаниями одной кнопки (docs/ui_audit.md, 3.10; docs/ui_v2.md, раздел 2): первое касание
// превращает её в «Точно?» на три секунды, второе делает. Окон подтверждения нет.
//
// Одна дверь на всю игру: прежде таймер «Точно?» жил копией в `next/Confirm` и в `next/Rush`. Таймер здесь считает
// не удержание, а окно между двумя касаниями: оба — обычный `click`, долгого нажатия в игре нет (`gestures.TAP_MS`).
import { useEffect, useState } from 'react';

/** Сколько «Точно?» ждёт второго касания. */
export const TWO_TAP_MS = 3000;

/** Взведена ли кнопка, взвести, снять. Взведённая сама снимается через `TWO_TAP_MS`. */
export function useTwoTap(): [armed: boolean, arm: () => void, disarm: () => void] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), TWO_TAP_MS);
    return () => clearTimeout(t);
  }, [armed]);
  return [armed, () => setArmed(true), () => setArmed(false)];
}
