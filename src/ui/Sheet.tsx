import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { haptic } from '@/telegram/webapp';
import { nextFrame } from '@/render/loop';

/** Доли высоты вьюпорта: свёрнутая шторка и раскрытая. */
const PEEK = 0.62;
const FULL = 0.85;
/** Должна совпадать с transition в .sheet. */
const ANIM = 260;

type Snap = 'peek' | 'full';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Нижняя шторка: тянется за хэндл, встаёт на 62% или 85% высоты, смахивается вниз.
 * Во время перетаскивания высота фиксируется на 85%, а положение задаётся transform —
 * это дёшево для GPU; на снапе высота возвращается к реальной, чтобы внутренний
 * скролл не уезжал за нижний край экрана.
 */
export function Sheet({ open, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<Snap>('peek');
  const snapRef = useRef<Snap>('peek');
  snapRef.current = snap;

  const offset = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drag = useRef<{ id: number; startY: number; base: number; lastY: number; lastT: number; v: number } | null>(null);

  const clearInline = (): void => {
    const el = ref.current;
    if (!el) return;
    // Снимаем ручные стили без анимации: геометрия уже совпадает с классом.
    el.style.transition = 'none';
    el.style.transform = '';
    el.style.height = '';
    void el.offsetHeight;
    el.style.transition = '';
  };

  // Закрытие извне (кнопка навигации, фон): сбрасываем ручные стили после анимации.
  useEffect(() => {
    if (open) return;
    setSnap('peek');
    drag.current = null;
    const t = setTimeout(clearInline, ANIM + 40);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const peekOffset = (el: HTMLElement): number => el.clientHeight * (1 - PEEK / FULL);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (!el || !open) return;
    if (timer.current) clearTimeout(timer.current);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    el.style.transition = 'none';
    el.style.height = `${FULL * 100}%`;
    const base = snapRef.current === 'full' ? 0 : peekOffset(el);
    offset.current = base;
    el.style.transform = `translateY(${base}px)`;
    drag.current = { id: e.pointerId, startY: e.clientY, base, lastY: e.clientY, lastT: performance.now(), v: 0 };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d || d.id !== e.pointerId) return;
    const now = performance.now();
    const dt = Math.max(1, now - d.lastT);
    d.v = (e.clientY - d.lastY) / dt; // px/мс, вниз — положительная
    d.lastY = e.clientY;
    d.lastT = now;
    const next = Math.max(0, Math.min(el.clientHeight, d.base + (e.clientY - d.startY)));
    offset.current = next;
    el.style.transform = `translateY(${next}px)`;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    const d = drag.current;
    if (!el || !d || d.id !== e.pointerId) return;
    drag.current = null;
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    const h = el.clientHeight;
    const peek = peekOffset(el);
    const o = offset.current;
    let target: Snap | 'close';
    if (d.v > 0.55) target = o > peek * 0.5 ? 'close' : 'peek';
    else if (d.v < -0.55) target = 'full';
    else {
      const dist: [Snap | 'close', number][] = [
        ['full', Math.abs(o)],
        ['peek', Math.abs(o - peek)],
        ['close', Math.abs(o - h)],
      ];
      target = dist.sort((a, b) => a[1] - b[1])[0][0];
    }

    el.style.transition = ''; // возвращаем переход из CSS
    if (target === 'close') {
      nextFrame(() => {
        el.style.transform = '';
      });
      timer.current = setTimeout(clearInline, ANIM + 40);
      haptic('light');
      onClose();
      return;
    }
    if (target !== snapRef.current) haptic('light');
    setSnap(target);
    nextFrame(() => {
      el.style.transform = `translateY(${target === 'full' ? 0 : peek}px)`;
    });
    timer.current = setTimeout(clearInline, ANIM + 40);
  };

  return (
    <>
      {open && <div className="sheet-backdrop" onClick={onClose} />}
      <div ref={ref} className={`sheet${open ? ' open' : ''}${snap === 'full' ? ' full' : ''}`} role="dialog" aria-hidden={!open}>
        <div
          className="sheet-grab"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="sheet-handle" />
          <button
            className="sheet-close"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
            aria-label="Закрыть">
            ✕
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}
