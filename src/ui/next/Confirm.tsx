// Кнопка необратимого действия (docs/ui_audit.md, 3.10): первое касание превращает её в «Точно?» на три секунды,
// второе делает. Окон подтверждения нет. Одна на окно постройки, кузницу, найм и державу. Окно двух касаний — общее
// с набором интерфейса (`ui/kit/twotap`); с этапов UI-2…7 её место займёт `kit/Btn` с `confirm`.
import { TWO_TAP_MS, useTwoTap } from '@/ui/kit/twotap';

/** Сколько «Точно?» ждёт второго касания. */
export const CONFIRM_MS = TWO_TAP_MS;

/**
 * Кнопка необратимого действия: первое касание превращает её в «Точно?» на три секунды, второе делает
 * (3.10: окон подтверждения не заводим).
 */
export function Confirm({ label, onConfirm, className = '' }: { label: string; onConfirm: () => void; className?: string }) {
  const [armed, arm, disarm] = useTwoTap();
  return (
    <button
      className={`nx-confirm${armed ? ' armed' : ''} ${className}`}
      onClick={() => {
        if (!armed) return arm();
        disarm();
        onConfirm();
      }}
    >
      {armed ? 'Точно?' : label}
    </button>
  );
}
