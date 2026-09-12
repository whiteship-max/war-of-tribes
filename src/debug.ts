// Отладочные режимы, включаемые адресом. Тем же способом, что и стенд графики
// (`?showcase=`): флаг в строке запроса, прочитанный один раз на запуске.
//
// Здесь лежит только чтение флага — и лежит оно вне `world/` и вне `ui/` нарочно:
// свободный обзор нужен обоим, а мир не должен зависеть от интерфейса.

const params = typeof location === 'undefined' ? new URLSearchParams() : new URLSearchParams(location.search);

/**
 * Свободный обзор мира — то, как карта работала раньше: камера ходит куда
 * угодно. Игроку он недоступен: у него камера привязана к своему поселению и
 * своим фигурам, потому что смотреть на землю, где у тебя никого нет, — это и
 * есть тот самый общий вид карты, которого в игре быть не должно.
 *
 *   ?worldview=1     — камера отвязана, туман войны на месте;
 *   ?worldview=open  — вдобавок мир отдаёт всю землю разведанной.
 */
export type WorldView = 'off' | 'free' | 'open';

const flag = params.get('worldview');

export const WORLD_VIEW: WorldView = flag === null ? 'off' : flag === 'open' ? 'open' : 'free';

/** Камера отвязана от своих: только по флагу и только для отладки. */
export const freeCamera = (): boolean => WORLD_VIEW !== 'off';

/** Мир отдаёт всю землю разведанной. Тоже только по флагу. */
export const revealWorld = (): boolean => WORLD_VIEW === 'open';

/**
 * Обнажает диораму и стор для замера: `window.__scene` — живая сцена,
 * `window.__game` — стор. Только по флагу `?probe=1`.
 *
 * Этим меряет `npm run scene:report`: запуск, генерацию мира и вход на карту.
 * Своей ветки в коде игры это не заводит: и сцена, и стор и так есть, просто их
 * неоткуда взять из консоли в собранном бандле.
 */
export const probe = (): boolean => params.get('probe') === '1';

/**
 * Стоимость кадра карты, снятая стендом (`npm run map:report`).
 *
 * Живёт здесь, а не в `ui/map/`, по той же причине, что и `probe`: полотно про
 * замер знать не обязано, а стенду нужен один общий адрес. Кольцо на тысячу
 * отсчётов — этого хватает на пятнадцать секунд кадров и не растёт вечно.
 *
 * Выключено всегда, кроме `?probe=1`: в кадре остаётся одна проверка булева.
 */
const COSTS: number[] = [];
const COSTS_MAX = 1000;

export function frameCost(ms: number): void {
  COSTS.push(ms);
  if (COSTS.length > COSTS_MAX) COSTS.shift();
}

/** Снять накопленное и начать сначала. Стенд зовёт это через `window.__mapPerf`. */
export function takeCosts(): number[] {
  const out = COSTS.slice();
  COSTS.length = 0;
  return out;
}

/**
 * Сколько стоит испечь один тайл земли (`npm run map:report`, раздел «выпечка»).
 *
 * Меряется отдельно от кадра нарочно: в кадр выпечка попадает раз на несколько
 * десятков кадров, и в медиане её не видно вовсе, а чувствуется она ровно там,
 * где её не видно в медиане, — рывком при броске карты. Бюджет тут свой и
 * жёсткий: тайл печётся один за кадр, и кадр у телефона 16.7 мс.
 *
 * Живёт рядом с `frameCost` и по той же причине: `ui/map/ground.ts` про замер
 * знать не обязан, а стенду нужен один общий адрес.
 */
const BAKES: number[] = [];

export function bakeCost(ms: number): void {
  BAKES.push(ms);
  if (BAKES.length > COSTS_MAX) BAKES.shift();
}

/** Снять накопленное и начать сначала. Стенд зовёт это через `window.__mapBakes`. */
export function takeBakes(): number[] {
  const out = BAKES.slice();
  BAKES.length = 0;
  return out;
}
