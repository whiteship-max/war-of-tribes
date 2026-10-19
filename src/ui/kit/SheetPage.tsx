// Нижний лист (docs/ui_v2.md, раздел 2): страница окна в шторке — одна на постройки, разделы, карточку клетки и походы.
// Сама шторка (выезд, ступени, затемнение) — `ui/Sheet`; здесь — что внутри: шапка 56, вкладки, тело и закреплённая полоса
// главного действия внизу (docs/ui_audit.md, 3.10: главное действие — не за полтора экрана прокрутки).
//
// Шапка: значок (касание — что это, подсказкой), имя, строка под ним 11 px (уровень, координата), главное действие
// справа и «закрыть» в строке шапки — уезжает с ней и не ложится на прокрутку (решение 23, docs/ui_audit.md, 12.2).
// Пока лист с такой шапкой открыт, у шторки нет своего «закрыть» (`kit.css`, `:has(.kit-head)`).
import './kit.css';
import type { ReactNode } from 'react';
import { Icon } from '@/ui/icons/Icon';
import { tipAt, type TipContent } from '@/ui/next/tip';
import type { IconName } from '@/ui/icons/alias';

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon?: IconName;
  /** Счётчик «ждёт действия» на вкладке (docs/ui_audit.md, 3.9): больше 9 — «9+». */
  badge?: number;
}

/** Запись счётчика: больше девяти — «9+» (docs/ui_audit.md, 3.9). */
export const badgeText = (n: number): string => (n > 9 ? '9+' : String(n));

/** Вкладки — больше двух разделов окна идут вкладками, а не столбцом (docs/ui_audit.md, 3.10). */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly TabDef<T>[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="kit-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} className={t.id === value ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.icon && <Icon name={t.icon} />}
          <span className="one-line">{t.label}</span>
          {t.badge !== undefined && t.badge > 0 && <em className="kit-badge">{badgeText(t.badge)}</em>}
        </button>
      ))}
    </div>
  );
}

interface Props<T extends string> {
  icon?: IconName;
  title: ReactNode;
  /** Строка под именем: «ур. 3/10», «Острог · Варвары · 847|1092». */
  sub?: ReactNode;
  /** Что это — подсказкой по значку шапки. */
  about?: () => TipContent;
  /** Главное действие в строке шапки — `Btn kind="main"` («Улучшить»). */
  action?: ReactNode;
  onClose: () => void;
  tabs?: readonly TabDef<T>[];
  tab?: T;
  onTab?: (id: T) => void;
  /** Закреплённая полоса внизу: цена партии, шаг, «Нанять»/«Заказать»/«Выступить». */
  foot?: ReactNode;
  children: ReactNode;
}

export function SheetPage<T extends string>({ icon, title, sub, about, action, onClose, tabs, tab, onTab, foot, children }: Props<T>) {
  const art = icon ? <Icon name={icon} /> : null;
  return (
    <div className="panel kit-page">
      <div className="kit-head">
        {art &&
          (about ? (
            <button type="button" className="kit-head-ico" aria-label="Что это" onClick={(e) => tipAt(e.currentTarget, about())}>
              {art}
            </button>
          ) : (
            <span className="kit-head-ico">{art}</span>
          ))}
        <div className="kit-head-title">
          <b className="one-line">{title}</b>
          {sub !== undefined && <small className="one-line">{sub}</small>}
        </div>
        {action}
        <button type="button" className="kit-close" onClick={onClose} aria-label="Закрыть">
          <Icon name="ui-close" />
        </button>
      </div>
      {tabs && tab !== undefined && onTab && <Tabs tabs={tabs} value={tab} onChange={onTab} />}
      <div className="kit-body">{children}</div>
      {foot && <div className="kit-foot">{foot}</div>}
    </div>
  );
}
