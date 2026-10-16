// Число с разбором (docs/ui_v2.md, раздел 2: «у каждой цифры есть подсказка»): цифры одной ширины, тон по смыслу и
// касание — подсказка с расшифровкой (`kit/breakdown`) через одну дверь подсказок (`next/tip`). Своих таймеров нет:
// открывается обычным `click`, долгого нажатия в игре нет (docs/ui_audit.md, 3.7).
import './kit.css';
import type { ReactNode } from 'react';
import { tipAt, type TipContent } from '@/ui/next/tip';

export type Tone = 'good' | 'bad' | 'warn' | 'muted';

interface Props {
  /** Запись числа — уже сокращённая и со знаком (`shortNum`, `hudTips.rate`, `game/num`): своей записи у набора нет. */
  children: ReactNode;
  /** Подсказка считается в миг касания — числа в ней на эту секунду, а не на последнюю перерисовку. */
  tip: () => TipContent;
  tone?: Tone;
  /** Имя для чтения с экрана: «Еда», «Мораль». */
  label?: string;
}

/** Число-справка: касание объясняет, ничего не меняя. Цель — не мельче порога ячейки-справки (`kit.css`, 33). */
export function Num({ children, tip, tone, label }: Props) {
  return (
    <button type="button" className={`kit-num${tone ? ` ${tone}` : ''}`} aria-label={label} onClick={(e) => tipAt(e.currentTarget, tip())}>
      {children}
    </button>
  );
}
