// Кнопка необратимого действия (docs/ui_audit.md, 3.10): первое касание превращает её в «Точно?» на три секунды,
// второе делает. Окон подтверждения нет. Одна на окно постройки, кузницу, найм и державу.
import { useEffect, useState } from 'react';

/** Сколько «Точно?» ждёт второго касания. */
export const CONFIRM_MS = 3000;

/**
 * Кнопка необратимого действия: первое касание превращает её в «Точно?» на три секунды, второе делает
 * (3.10: окон подтверждения не заводим).
 */
export function Confirm({ label, onConfirm, className = '' }: { label: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={`nx-confirm${armed ? ' armed' : ''} ${className}`}
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? 'Точно?' : label}
    </button>
  );
}
