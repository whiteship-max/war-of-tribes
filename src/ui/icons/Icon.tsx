import './icon.css';
import { useSyncExternalStore } from 'react';
import { onSheet, sheetReady, symbolOf } from './sheet';
import type { IconName } from './alias';

/** Состояние значка: выбран (горит золотом) или погашен (серый и тусклый). */
export type IconState = 'on' | 'off';

interface Props {
  /** Имя значка: нарисованное или ссылка (`alias.ts`). Опечатку ловит `tsc`. */
  name: IconName;
  className?: string;
  title?: string;
  state?: IconState;
  /** Метка-счётчик в углу; 0 и меньше — метки нет, больше 9 — «9+». */
  count?: number;
  /** Счётчик срочного — красный. */
  urgent?: boolean;
}

/**
 * Единственное место в игре, где рисуется значок набора ЗН-1 (docs/icons.md). Размер — ровно строка текста (`1em`), как и
 * прежде, поэтому значок ничего не двигает в вёрстке; правила стиля, которые меряют эти места кеглем (`.ic`, `.cost`,
 * `.nx-ib`), работают как были. Цвет запечён в рисунок — набор многоцветный, `currentColor` ему не нужен; состояние
 * меняет его фильтром (`icon.css`).
 *
 * Значок ленивого листа, пока лист в пути, — пустое место своего размера: эмодзи на замену больше нет.
 */
export function Icon({ name, className, title, state, count, urgent }: Props) {
  // Ключ `<use>` меняется, когда приехал ленивый лист: так ссылка перечитывает символ и в браузерах, которые не
  // перерисовывают `<use>`, когда цель появилась позже.
  const ready = useSyncExternalStore(onSheet, sheetReady, () => false);
  const cls = ['ic-zn', state ? `ic-${state}` : '', className ?? ''].filter(Boolean).join(' ');
  const svg = (
    <svg className={cls} viewBox="0 0 32 32" width="1em" height="1em" role="img" aria-label={title} aria-hidden={title ? undefined : true}>
      {title ? <title>{title}</title> : null}
      <use key={ready ? 1 : 0} href={symbolOf(name)} />
    </svg>
  );
  if (count === undefined || count <= 0) return svg;
  return (
    <span className="ic-box">
      {svg}
      <em className={`ic-count${urgent ? ' urgent' : ''}`}>{count > 9 ? '9+' : count}</em>
    </span>
  );
}
