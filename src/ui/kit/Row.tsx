// Строка (docs/ui_v2.md, раздел 2): значок · имя (и строка пояснения 11 px) · число справа · дверь «›». Одна вместо
// карточек `.mod`, `.card.as-row`, `.nx-crow` — плотная, в одну линию, как строка листа в EU4.
//
// Что строка делает по касанию, решают два поля, и цель касания — от смысла (docs/ui_v2.md, раздел 2, «Касание»):
// - `tip` — справка: касание открывает подсказку, ничего не меняя; строка не ниже порога ячейки-справки (33);
// - `go` — дверь к источнику: строка — кнопка 44 со стрелкой;
// - оба — справка телом строки и дверь отдельной кнопкой 44 у правого края (кнопка в кнопке недопустима);
// - ни одного — строка-текст; числа в ней тогда сами `Num`.
import './kit.css';
import type { ReactNode } from 'react';
import { Icon } from '@/ui/icons/Icon';
import { tipAt, type TipContent } from '@/ui/next/tip';
import type { Tone } from './Num';

export interface RowProps {
  icon?: { name: string; glyph: string };
  label: ReactNode;
  /** Строка пояснения под именем — 11 px, приглушённо; не длиннее строки списка (docs/ui_audit.md, 3.11). */
  sub?: ReactNode;
  /** Число или короткое значение справа. */
  value?: ReactNode;
  tone?: Tone;
  tip?: () => TipContent;
  go?: () => void;
  /** Подпись двери для чтения с экрана: «К складу». */
  goLabel?: string;
  /** Выбранная строка (вид «выбрано» — рамка янтарём, docs/ui_audit.md, 3.8). */
  on?: boolean;
  /** Недоступная строка (прозрачность .45). */
  dim?: boolean;
}

function Body({ icon, label, sub, value, tone }: Pick<RowProps, 'icon' | 'label' | 'sub' | 'value' | 'tone'>) {
  return (
    <>
      {icon && (
        <span className="kit-ico">
          <Icon name={icon.name} glyph={icon.glyph} />
        </span>
      )}
      <span className="kit-row-label">
        <span className="one-line">{label}</span>
        {sub && <small>{sub}</small>}
      </span>
      {value !== undefined && <span className={`kit-row-val${tone ? ` ${tone}` : ''}`}>{value}</span>}
    </>
  );
}

export function Row(p: RowProps) {
  const state = `${p.on ? ' on' : ''}${p.dim ? ' dim' : ''}`;
  const open = p.tip ? (e: { currentTarget: Element }) => tipAt(e.currentTarget, p.tip!()) : undefined;
  if (p.go && !p.tip) {
    return (
      <button type="button" className={`kit-row go${state}`} onClick={p.go} aria-label={p.goLabel}>
        <Body {...p} />
        <i className="kit-chev" aria-hidden="true">
          ›
        </i>
      </button>
    );
  }
  if (p.tip && !p.go) {
    return (
      <button type="button" className={`kit-row tip${state}`} onClick={open}>
        <Body {...p} />
      </button>
    );
  }
  if (p.tip && p.go) {
    return (
      <div className={`kit-row split${state}`}>
        <button type="button" className="kit-row-tip" onClick={open}>
          <Body {...p} />
        </button>
        <button type="button" className="kit-go" onClick={p.go} aria-label={p.goLabel ?? 'К источнику'}>
          ›
        </button>
      </div>
    );
  }
  return (
    <div className={`kit-row${state}`}>
      <Body {...p} />
    </div>
  );
}
