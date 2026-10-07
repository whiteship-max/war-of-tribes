// Уход окна (docs/city.md, 14.5): закрытое окно ещё `LEAVE_MS` стоит на экране классом `leaving` — тает, касаний не
// берёт (`styles.css`, `.leaving`), — и только потом снимается. Действие, которым окно закрыли, уже сделано: уход —
// картинка, а не ожидание.
import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Сколько тает уходящее окно, мс (`styles.css`, `modal-out` и `realm-out` — та же длина). */
export const LEAVE_MS = 160;

/**
 * Что показывать: открытое значение, а после закрытия — последнее открытое, пока оно тает (`ms`). `leaving` — окно уже
 * закрыто и уходит.
 */
export function useLeaving<T>(value: T | null | undefined | false, ms: number = LEAVE_MS): { shown: T | null; leaving: boolean } {
  const last = useRef<T | null>(null);
  const [, bump] = useState(0);
  const open = value !== null && value !== undefined && value !== false;
  if (open) last.current = value as T;
  useEffect(() => {
    if (open || last.current === null) return;
    const t = setTimeout(() => {
      last.current = null;
      bump((n) => n + 1);
    }, ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  // Уход считается в том же рисовании, что и закрытие: без кадра пустоты между окном и его таянием.
  return open ? { shown: value as T, leaving: false } : { shown: last.current, leaving: last.current !== null };
}

/**
 * Обёртка уходящего окна: пока открыто — само окно; закрыли — последний его вид ещё тает под классом `leaving`. Обёртка
 * стоит всегда (`display: contents`: раскладку не трогает), чтобы окно на уходе не собиралось заново. `ms` — своя
 * длина ухода (шторке — её съезд).
 */
export function Leave({ open, ms, children }: { open: boolean; ms?: number; children: ReactNode }) {
  const { shown, leaving } = useLeaving<ReactNode>(open ? children : null, ms);
  if (shown === null) return null;
  return <div className={leaving ? 'leave leaving' : 'leave'}>{shown}</div>;
}
