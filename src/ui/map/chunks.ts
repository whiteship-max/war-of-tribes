// Куски по кнопке, которые подтягиваются в фоне (РТ-2б, `boot/warm`): карта мира, «Рейтинг» и «Молва края». Здесь только
// `import()` — ни одного окна: этот файл едет в первой загрузке, а сами окна — своими кусками (`vite.config.ts`, LAZY_DOORS).
// Окно рисует его кнопка (`App`, `mapOpen`; кнопки карты), фон лишь кладёт код в кеш модулей.
export const mapUi = () => import('./WorldMap');
export const ratingUi = () => import('./Rating');
export const feedUi = () => import('./Feed');

/** Порядок подкачки: сначала то, что открывают чаще, — карта; потом окна её кнопок. */
export const MAP_CHUNKS = [mapUi, ratingUi, feedUi] as const;
