// Кнопка (docs/ui_v2.md, раздел 2): одна на игру вместо `.btn`, `.nx-go`, `.nx-up`, `.nx-confirm`, `.mini`. Цель — 44
// (`--tap`); подпись — 1–2 слова (docs/ui_audit.md, 3.11), срок — строкой 11 px под ней; погасшая говорит причину строкой
// 11 px под кнопкой, а не подсказкой (3.7: проваливающихся нажатий не бывает); необратимое — двумя касаниями
// (`kit/twotap`). Цена — не в кнопке: над ней стоит `parts/Cost` («нужно из есть»), одна форма на игру.
import './kit.css';
import type { ReactNode } from 'react';
import { useTwoTap } from './twotap';
import { goTo, reachable } from './nav';
import { sourceWord, type Source } from './sources';

export interface BtnProps {
  children: ReactNode;
  onClick: () => void;
  /** `main` — главное действие окна (янтарь), `plain` — второе, `link` — переход «Склад ›». */
  kind?: 'main' | 'plain' | 'link';
  /** Срок или число под подписью: «1 ч 1 мин». */
  sub?: ReactNode;
  /** Почему нельзя: кнопка гаснет, причина — строкой под ней (≤ 32 знаков, docs/ui_audit.md, 3.7). */
  why?: string | null;
  /** Необратимое: первое касание — «Точно?» на три секунды, второе — дело. */
  confirm?: boolean;
  /** Строка подтверждения под «Точно?» — что пропадёт безвозвратно; только у `confirm`, одна строка 11 px. */
  warn?: string;
  wide?: boolean;
  label?: string;
  /** Метка обучения (`data-tut`): шаги ищут кнопку по ней, а не по виду. */
  tut?: string;
}

/** Лицо кнопки: подпись и строка под ней; взведённая — «Точно?» и строка подтверждения (`warn`), если она есть. */
export function btnFace(armed: boolean, children: ReactNode, sub?: ReactNode, warn?: string): ReactNode {
  if (armed) return [<span key="t">Точно?</span>, warn ? <small key="w">{warn}</small> : null];
  return [<span key="t">{children}</span>, sub !== undefined ? <small key="s">{sub}</small> : null];
}

export function Btn({ children, onClick, kind = 'plain', sub, why, confirm = false, warn, wide = false, label, tut }: BtnProps) {
  const [armed, arm, disarm] = useTwoTap();
  const off = Boolean(why);
  const button = (
    <button
      type="button"
      className={`kit-btn ${kind}${armed ? ' armed' : ''}${wide ? ' wide' : ''}`}
      disabled={off}
      aria-label={label}
      data-tut={tut}
      onClick={() => {
        if (confirm && !armed) return arm();
        disarm();
        onClick();
      }}
    >
      {btnFace(armed, children, sub, confirm ? warn : undefined)}
    </button>
  );
  if (!off) return button;
  return (
    <span className={`kit-btn-wrap${wide ? ' wide' : ''}`}>
      {button}
      <small className="kit-why">{why}</small>
    </span>
  );
}

/**
 * «К источнику» кнопкой: «Склад ›», «Указы ›». Подпись — слово двери (`sources.sourceWord`), путь — одна дверь
 * (`nav.goTo`). Постройки в городе нет — кнопки нет: дверь в никуда хуже, чем её отсутствие.
 */
export function GoTo({ to, children }: { to: Source; children?: ReactNode }) {
  if (!reachable(to)) return null;
  return (
    <button type="button" className="kit-btn link" onClick={() => goTo(to)}>
      <span>
        {children ?? sourceWord(to)} <i aria-hidden="true">›</i>
      </span>
    </button>
  );
}
