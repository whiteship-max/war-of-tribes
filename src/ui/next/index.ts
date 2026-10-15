// Новый интерфейс — своим куском (как карта по регионам, `ui/map/look.ts`). Заведён так, пока он стоял за
// переключателем: режим, в который игрок может не зайти ни разу, не стоит ему ни байта на старте (`App.tsx`,
// предыстория). С 03.10.2026 новый — по умолчанию (`ui/uimode.ts`), а кусок остался своим: в первой загрузке лежит
// прежний вид — запасной из настроек, — и от нового в ней только выбор и общий список тревог (`ui/alertItems.ts`).
// Кусок просит `App`, как только выбран новый вид, — пока стоит стартовый экран, он успевает приехать.
export { Hud } from './Hud';
export { Alerts } from './Alerts';
export { Nav } from './Nav';
export { TipLayer } from './TipLayer';
export { Hints } from './Hints';
export { BuildingNew } from './BuildingNew';
export { SmithyNew } from './SmithyNew';
export { RecruitNew } from './RecruitNew';
export { CityNaming } from './CityNaming';
export { MarchesNew } from './MarchesNew';
export { WorldNew } from './WorldNew';
export { ReportBodyNew } from './ReportNew';
export { Trades, TradeLine } from './Trades';
export { Treasury } from './Treasury';
export { HallBuild } from './Hall';
// Ратуша под сеткой: что даёт городу и дверь в «Указы» державы (UI-7, docs/ui_v2.md, 5.6).
export { HallGives } from './HallGives';
// Рынок — прилавок таблицей выбора (UI-7, docs/ui_v2.md, 5.6).
export { MarketNew } from './MarketNew';
// «Дружина» с передачей (UI-4, docs/ui_v2.md, 5.3) — тем же куском: набор `kit` и подсказки верха, на которых она стоит, живут здесь.
export { ArmyPanel } from '../panels/ArmyPanel';
// «Жители» — сводка и места работы (UI-5, docs/ui_v2.md, 5.4) — тем же куском, по той же причине.
export { PeoplePanel } from '../panels/PeoplePanel';
