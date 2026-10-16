// Переключатель (UI-7, docs/ui_v2.md, 5.6): «да/нет» строкой 44 — наказ на отлучку, наказ брать дань. Вместо родного
// флажка с подписью 12 px (находка К5): цель касания — вся строка, состояние — рычажок справа, его же читает экран
// (`aria-pressed`). Подпись — что включает, строка 11 px под ней — когда срабатывает.
import './kit.css';
import type { ReactNode } from 'react';

interface Props {
  label: ReactNode;
  sub?: ReactNode;
  on: boolean;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ label, sub, on, onChange, disabled }: Props) {
  return (
    <button type="button" className={`kit-toggle${on ? ' on' : ''}`} aria-pressed={on} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="kit-row-label">
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </span>
      <i className="kit-switch" aria-hidden="true" />
    </button>
  );
}
