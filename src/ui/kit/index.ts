// Набор интерфейса UI-1 (docs/ui_v2.md, раздел 3): общие части для этапов UI-2…7 — таблица, строка, число с разбором,
// лист окна с вкладками, кнопка, полоса и дверь «к источнику». Экраны на него переходят по этапам; второй такой части
// рядом не заводят (docs/ui_v2.md, раздел 2, «Компоненты»).
export { Num, type Tone } from './Num';
export { Row, type RowProps } from './Row';
export { Table, COL_W, tracks, type Col, type TableRow } from './Table';
export { Bar, fillOf, type Mark } from './Bar';
export { Btn, GoTo, type BtnProps } from './Btn';
export { SheetPage, Tabs, badgeText, type TabDef } from './SheetPage';
export { breakdown, restOf, REST_LABEL, type BreakdownSpec, type Part } from './breakdown';
export { WINDOW, producersOf, sourceWord, toBuilding, type Indicator, type Source, type SourceKey } from './sources';
export { goTo, reachable } from './nav';
export { TWO_TAP_MS, useTwoTap } from './twotap';
