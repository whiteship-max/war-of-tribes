// Вольные города и сёла НПС для отряда бродяги (ПН-6, docs/gdd/path_of_sword.md, 3.3.4, 3.4.3, 3.7.1, 3.7.7; «Решения ПН-6») — числа и
// формулы без состояния партии: рынок города по ключу, постой, хлеб села, дворы заработков. Читают их двери пути (`sim/market` с
// ключом, `sim/roamtown`, `sim/bandearn`) и прибор (`npm run roam:report`). Без `@/`: модуль собирает сервер.
//
// Своих чисел нет. Хлеб села — цена, за которую купцы города берут хлеб (`SALE_SHARE` × основа рынка, без нажима): крестьянин не
// продаст дешевле, чем отдал бы купцу, а отряд не платит розничной цены города. Запас села за игровой день — выработка двора первого
// уровня с полной дюжиной (`YARDS`, `SLOTS_PER_LEVEL` — та же мерка, что у лавки алмазов, `gemrules.yardHourly`): село — это двор.
// Чего вывести нечем (уровни рынка и дворов вольных городов, плата постоя) — заглушки игры (`game/roamstubs`) за выключателем.
import type { EquipmentId, ResourceId, TroopId } from './types';
import { GOOD_BY_ID, eqGood } from './data/market';
import { TROOP_BY_ID } from './data/troops';
import { SALE_SHARE } from './marketrules';
import { YARDS } from './data/yards';
import { SLOTS_PER_LEVEL } from './constants';
import { DAY_LENGTH, gameSecondsOfMs } from './pace';
import { roamStub } from './roamstubs';

/** Ступень вольного города I–III (`world/roampoints.RoamPoint.tier`). */
export type TownTier = 1 | 2 | 3;

/** Ключ рынка вольного города — номер его точки (`town:x:y`). */
export type TownKey = `town:${string}`;

/** Рынков вольных городов в партии — не больше стольких (старые уходят: их нажим давно отошёл); то же число читает сохранение. */
export const TOWN_MARKETS = 16;

/** Номер точки вольного города по клетке — тот же, что у `world/roampoints`. */
export const townKeyOf = (x: number, y: number): TownKey => `town:${x}:${y}`;

/** Ступень вольного города из её номера на ключе не читается — её даёт точка; уровень рынка ступени — заглушка `townMarket`. */
export const townMarketLevel = (tier: TownTier): number => roamStub('townMarket')[tier - 1];

/** Уровень дворов вольного города — заглушка `townYard`: от него добыча промысла на заработках (3.7.7). */
export const townYardLevel = (tier: TownTier): number => roamStub('townYard')[tier - 1];

/** Постой — золота за голову и игровой день (4.2, заглушка `boardFee`). */
export const boardFee = (): number => roamStub('boardFee');

/** Плата постоя отряда из `men` голов за `dt` игровых секунд. */
export const boardDue = (men: number, dt: number): number => (Math.max(0, men) * boardFee() * Math.max(0, dt)) / DAY_LENGTH;

// ---------- хлеб села ----------

/** Цена хлеба в селе за штуку: та, за которую купцы города берут хлеб, — доля продажи рынка от основы, без нажима и без привоза. */
export const villageFoodPrice = (): number => SALE_SHARE * GOOD_BY_ID.food.price;

/** Лучшая выработка припаса на работника двора первого уровня за игровой день (тот же выбор лучшего, что у лавки алмазов). */
const bestYield = (r: ResourceId): number => YARDS.reduce((m, y) => Math.max(m, y.yield[r] ?? 0), 0);

/** Запас хлеба села за игровой день: двор первого уровня с полной дюжиной работников. */
export const villageStock = (): number => bestYield('food') * SLOTS_PER_LEVEL;

/**
 * Сколько хлеба село продаст сейчас: запас дня минус взятое, а взятое отходит само — запас дня за игровой день (часы мира, мс).
 * Никогда не брали — полный запас.
 */
export function villageLeft(took: number, at: number, now: number): number {
  const stock = villageStock();
  const back = (stock * Math.max(0, gameSecondsOfMs(now - at))) / DAY_LENGTH;
  return Math.max(0, Math.min(stock, stock - Math.max(0, took - back)));
}

/** Взятое у села к минуте `now` — после отхода: запись, которую положит покупка. */
export const villageTaken = (took: number, at: number, now: number): number => villageStock() - villageLeft(took, at, now);

// ---------- найм ----------

/**
 * Найм вида по основе рынка (ГДД 3.4.3): припас найма и снаряжение, как у лорда в Казармах, золотом без привоза и нажима — мерка прибора
 * и нижняя граница: у города сверху — цена привоза и нажим (`sim/roamtown.hireBill`), из обоза — даром.
 */
export function hireBase(kind: TroopId): number {
  const t = TROOP_BY_ID[kind];
  let gold = 0;
  for (const [e, n] of Object.entries(t.gear) as [EquipmentId, number][]) gold += n * GOOD_BY_ID[eqGood(e)].price;
  for (const [r, n] of Object.entries(t.cost) as [ResourceId, number][]) gold += n * GOOD_BY_ID[r].price;
  return gold;
}
