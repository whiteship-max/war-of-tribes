// Новый интерфейс — своим куском (как карта по регионам, `ui/map/look.ts`): режим, в который игрок может не
// зайти ни разу, не стоит ему ни байта на старте (`App.tsx`, предыстория). В первой загрузке от него — только
// флаг (`ui/uimode.ts`) и общий список тревог (`ui/alertItems.ts`). Кусок просит `App`, как только выбран новый
// вид, — пока стоит стартовый экран, он успевает приехать.
export { Hud } from './Hud';
export { Alerts } from './Alerts';
export { Nav } from './Nav';
export { TipLayer } from './Tip';
export { BuildingNew } from './BuildingNew';
