// Полоса (docs/ui_v2.md, раздел 2): доля чего-то из чего-то — мораль, порядок, стройка, энергия, запас до потолка.
// Одна вместо `.nx-bbar`, `.nx-prog`, `.bar`, `.nx-energy`. Имя и число — строкой над полосой (11 px), отметки порогов —
// с подписью (порог без слова — загадка: «две риски на шкале порядка» из описи этапа 1). Касание — подсказка с разбором:
// полоса — тоже число, и у каждой цифры есть объяснение.
import './kit.css';
import type { ReactNode } from 'react';
import { tipAt, type TipContent } from '@/ui/next/tip';
import type { Tone } from './Num';

export interface Mark {
  /** Где стоит порог — в тех же единицах, что `value` и `max`. */
  at: number;
  /** Что значит порог: «ропот», «мятеж», «рост встаёт». */
  label: string;
}

interface Props {
  value: number;
  max: number;
  label?: ReactNode;
  /** Запись числа справа над полосой: «61 из 100». По умолчанию — ничего. */
  text?: ReactNode;
  tone?: Tone | 'accent';
  marks?: readonly Mark[];
  tip?: () => TipContent;
  /**
   * Свои краски заливки и остатка — полоса двух сторон (шкала сил ролика боя: наши золотом, чужие красным, `side.ts`).
   * Без них — тон набора на пустой дорожке.
   */
  paint?: { fill: string; rest: string };
}

/** Доля заполнения в процентах: в пределах 0…100, при пустом потолке — ноль. */
export function fillOf(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, (value / max) * 100));
}

export function Bar({ value, max, label, text, tone = 'accent', marks = [], tip, paint }: Props) {
  const inner = (
    <>
      {(label !== undefined || text !== undefined) && (
        <span className="kit-bar-head">
          <span>{label}</span>
          <b>{text}</b>
        </span>
      )}
      <span className="kit-bar-track" style={paint ? { background: paint.rest } : undefined}>
        <i className={`kit-bar-fill ${tone}`} style={{ width: `${fillOf(value, max)}%`, ...(paint ? { background: paint.fill } : {}) }} />
        {marks.map((m) => (
          <i key={m.label} className="kit-bar-mark" style={{ left: `${fillOf(m.at, max)}%` }} />
        ))}
      </span>
      {marks.length > 0 && (
        <span className="kit-bar-marks">
          {marks.map((m) => (
            <small key={m.label} style={{ left: `${fillOf(m.at, max)}%` }}>
              {m.label}
            </small>
          ))}
        </span>
      )}
    </>
  );
  if (!tip) return <div className="kit-bar">{inner}</div>;
  return (
    <button type="button" className="kit-bar tip" onClick={(e) => tipAt(e.currentTarget, tip())}>
      {inner}
    </button>
  );
}
