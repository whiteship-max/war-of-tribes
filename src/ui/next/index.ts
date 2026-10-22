// Новый интерфейс — своим куском (как карта по регионам, `ui/map/look.ts`). Заведён так, пока он стоял за
// переключателем: режим, в который игрок может не зайти ни разу, не стоит ему ни байта на старте (`App.tsx`,
// предыстория). С 03.10.2026 новый — по умолчанию (`ui/uimode.ts`), а кусок остался своим: в первой загрузке лежит
// прежний вид — запасной из настроек, — и от нового в ней только выбор и общий список тревог (`ui/alertItems.ts`).
// Кусок просит `App`, как только выбран новый вид, — пока стоит стартовый экран, он успевает приехать.
export { Hud } from './Hud';
export { Alerts } from './Alerts';
// Тревоги войны значками справа снизу — осада, набеги, свой лагерь (П-7, docs/polish.md).
export { WarSigns } from './WarSigns';
export { Nav } from './Nav';
export { TipLayer } from './TipLayer';
export { Hints } from './Hints';
export { RecruitNew } from './RecruitNew';
export { CityNaming } from './CityNaming';
export { MarchesNew } from './MarchesNew';
export { WorldNew } from './WorldNew';
export { ReportBodyNew } from './ReportNew';
export { Trades } from './Trades';
export { Treasury } from './Treasury';
export { BuildingsPanel, HallBuild } from './HallBuild';
// Ратуша: что даёт городу и дверь в «Указы» державы (UI-7, docs/ui_v2.md, 5.6); совет и разделы (РТ-1).
export { HallGives } from './HallGives';
export { HallCouncil } from './HallCouncil';
// Рынок — прилавок таблицей выбора (UI-7, docs/ui_v2.md, 5.6).
export { MarketNew } from './MarketNew';
// «Дружина» с передачей (UI-4, docs/ui_v2.md, 5.3) — тем же куском: набор `kit` и подсказки верха, на которых она стоит, живут здесь.
export { ArmyPanel } from '../panels/ArmyPanel';
// «Жители» — сводка и места работы (UI-5, docs/ui_v2.md, 5.4) — тем же куском, по той же причине.
export { PeoplePanel } from '../panels/PeoplePanel';
// Окна осады, вылазки и лагеря (UI-7, docs/ui_v2.md, 5.6) — тем же куском: вкладки, таблицы и переключатели набора.
export { SiegePanel } from '../panels/SiegePanel';
export { SortiePanel } from '../panels/SortiePanel';
export { CampPanel } from '../panels/CampPanel';
// «Мораль» — одна таблица цели (Д13) — и «Порядок» вкладками «Надзор | Невольники» (6.13) — тем же куском (UI-8, 5.7), и окно
// постройки: его данные стоят на наборе `kit`.
export { BuildingPanel } from '../panels/BuildingPanel';
export { MoralePanel } from '../panels/MoralePanel';
export { OrderPanel } from '../panels/OrderPanel';
