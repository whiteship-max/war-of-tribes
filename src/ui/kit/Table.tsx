// Таблица (docs/ui_v2.md, раздел 2): вместо ленты карточек — строки по 33 px со столбцами, цифры одной ширины,
// числа выровнены вправо, шапка столбцов 11 px. Как лист в EU4: на экран телефона ложится 12–14 строк, а не 3 карточки.
//
// Касание — как у строки (`Row`): справка телом строки (`tip`) или дверь «›» кнопкой 44 у правого края (`go`). Ячейка
// может держать `Num` — своё число с разбором; тогда у строки нет своей справки (кнопка в кнопке недопустима).
// Таблица не прокручивается вбок: столбцы ужимаются, а не уезжают — палец, съехавший на касании, не листает её.
//
// Столбцы ровные во всех строках: у каждой строки своя сетка с одними и теми же дорожками, и все дорожки, кроме первой,
// — твёрдой ширины (`tracks`). Дорожка «по содержимому» мерилась бы в каждой строке по-своему, и столбцы бы поехали.
import './kit.css';
import type { ReactNode } from 'react';
import { tipAt, type TipContent } from '@/ui/next/tip';

/** Ширина столбца по умолчанию — «4 800», «+43,4», «12 из 30» в 13 px цифрами одной ширины. */
export const COL_W = '56px';

export interface Col {
  key: string;
  title: ReactNode;
  /** Число — вправо; значок или отметка — по центру; имя — влево (по умолчанию). */
  align?: 'left' | 'right' | 'center';
  /** Ширина дорожки: твёрдая (`48px`, по умолчанию `COL_W`); первый столбец тянется (`minmax(0, 1fr)`). */
  w?: string;
}

export interface TableRow {
  key: string;
  cells: Record<string, ReactNode>;
  tip?: () => TipContent;
  go?: () => void;
  goLabel?: string;
  on?: boolean;
  dim?: boolean;
}

interface Props {
  cols: readonly Col[];
  rows: readonly TableRow[];
  /** Пустая таблица говорит словами, почему пусто, а не стоит голой шапкой. */
  empty?: ReactNode;
  /** Строка итога под чертой: те же столбцы. */
  total?: Record<string, ReactNode>;
  label?: string;
}

/** Дорожки сетки строки: первый столбец тянется, остальные — твёрдой ширины, одной на все строки. */
export function tracks(cols: readonly Col[]): string {
  return cols.map((c, i) => c.w ?? (i === 0 ? 'minmax(0, 1fr)' : COL_W)).join(' ');
}

const alignOf = (c: Col): string => (c.align === 'right' ? ' r' : c.align === 'center' ? ' c' : '');

function Cells({ cols, cells }: { cols: readonly Col[]; cells: Record<string, ReactNode> }) {
  return (
    <>
      {cols.map((c) => (
        <span key={c.key} role="cell" className={`kit-c${alignOf(c)}`}>
          {cells[c.key]}
        </span>
      ))}
    </>
  );
}

export function Table({ cols, rows, empty, total, label }: Props) {
  const withGo = rows.some((r) => r.go);
  const grid = { ['--cols' as string]: tracks(cols) };
  // Место под «›» держат все строки, если дверь есть хоть у одной: иначе первый столбец был бы разной ширины.
  const slot = withGo ? <span className="kit-nogo" aria-hidden="true" /> : null;
  return (
    <div className="kit-table" role="table" aria-label={label}>
      <div className="kit-trow head" role="row">
        <div className="kit-cells" style={grid}>
          {cols.map((c) => (
            <span key={c.key} role="columnheader" className={`kit-c${alignOf(c)}`}>
              {c.title}
            </span>
          ))}
        </div>
        {slot}
      </div>
      {rows.length === 0 && empty && <div className="kit-tempty">{empty}</div>}
      {rows.map((r) => {
        const tip = r.tip;
        return (
          <div key={r.key} className={`kit-trow${r.go ? ' go' : ''}${r.on ? ' on' : ''}${r.dim ? ' dim' : ''}`} role="row">
            {tip ? (
              <button type="button" className="kit-cells tip" style={grid} onClick={(e) => tipAt(e.currentTarget, tip())}>
                <Cells cols={cols} cells={r.cells} />
              </button>
            ) : (
              <div className="kit-cells" style={grid}>
                <Cells cols={cols} cells={r.cells} />
              </div>
            )}
            {r.go ? (
              <button type="button" className="kit-go" onClick={r.go} aria-label={r.goLabel ?? 'К источнику'}>
                ›
              </button>
            ) : (
              slot
            )}
          </div>
        );
      })}
      {total && (
        <div className="kit-trow sum" role="row">
          <div className="kit-cells" style={grid}>
            <Cells cols={cols} cells={total} />
          </div>
          {slot}
        </div>
      )}
    </div>
  );
}
