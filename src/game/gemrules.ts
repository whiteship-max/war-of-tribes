// Правила алмазов — одни на игру и на сервер (docs/gems.md). Баланс и журнал живут на сервере (`netlify/lib/gems.ts`), и
// цену ускорения, цену лавки и её сутки сервер считает сам — этими же функциями, что и кнопка в игре. Две копии цены
// разошлись бы молча: кнопка обещала бы одно, а сервер списывал другое. Без `@/`-импортов: модуль читает серверная часть.
//
// Алмаз покупает время. Мерка одна — **настоящее ожидание**, переведённое в алмазы кривой `GEM_WAIT`:
//  · ускорение стройки снимает остаток нормативного ожидания (труд при `GEM_REF_RATE`), и последние
//    `RUSH_FREE_SECONDS` не стоят ничего;
//  · лавка продаёт 100 единиц припаса за столько алмазов, сколько стоит ожидание, за которое их добыл бы двор
//    (`yardHourly`), — та же кривая, тот же курс времени.
import type { BuildingTypeId, ResourceId } from './types';
import { BUILDING_BY_ID } from './data/buildings';
import { YARDS } from './data/yards';
import { MAX_BUILDING_LEVEL, SLOTS_PER_LEVEL } from './constants';
import { gameDaysPerHour, gameRate, gameSeconds, realSec, realSeconds } from './pace';
import { upgradeWork } from './labour';
import { DAY_MS } from './time';
import { dayIndex } from './data/daily';

/** Стартовые алмазы: сервер кладёт их один раз, при первом входе игрока в эпоху мира (`netlify/lib/gems.openLedger`). */
export const START_GEMS = 120;

/**
 * Нормативная скорость стройки, работа в игровую секунду. Цена ускорения считается от остатка работы, приведённого к
 * этой скорости, а не к настоящей: иначе цена прыгала бы каждый раз, когда игрок снимает человека с площади, и сервер
 * не смог бы её повторить — людей на площади он не видит.
 */
export const GEM_REF_RATE = gameRate(20);

/** Последние пять минут ожидания ускоряются даром (решение владельца 09.10.2026). Настоящие: время игрока. */
export const RUSH_FREE_SECONDS = realSec(5 * 60);

/** Трата больше этого — вторым касанием той же кнопки («Точно?», docs/ui_audit.md, 3.10). */
export const GEM_CONFIRM = 50;

/**
 * Кривая «ожидание → алмазы»: точки (настоящие секунды, алмазы), между ними — прямая, за последней — её же наклон.
 * Данные дизайна, а не вывод (решение 3 docs/gems.md): минута — алмаз, час — 20, сутки — 260, неделя — 1000. Кривая
 * выпуклая вверх: час в долгой стройке дешевле часа в короткой — так устроены цены времени в стратегиях за алмазы, и так
 * игрок, ждавший сутки, не платит за них в 24 раза больше, чем за час.
 */
export const GEM_WAIT: readonly (readonly [number, number])[] = [
  [0, 0],
  [60, 1],
  [3600, 20],
  [86_400, 260],
  [604_800, 1000],
];

/** Алмазов за столько настоящих секунд ожидания: вверх до целого, но не меньше одного за любое ненулевое. */
export function gemsForWait(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  let i = 1;
  while (i < GEM_WAIT.length - 1 && seconds > GEM_WAIT[i][0]) i++;
  const [t0, g0] = GEM_WAIT[i - 1];
  const [t1, g1] = GEM_WAIT[i];
  const raw = g0 + ((seconds - t0) * (g1 - g0)) / (t1 - t0);
  // Малый допуск — против хвоста деления: ровно час обязан стоить ровно 20.
  return Math.max(1, Math.ceil(raw - 1e-9));
}

/** Настоящие секунды нормативного ожидания на эту работу стройки. */
export const rushSeconds = (work: number): number => realSeconds(Math.max(0, work) / GEM_REF_RATE);

/**
 * Сколько работы стройки укладывается в последние пять минут нормативного ожидания — их ускоряют даром, без приказа
 * (`sim/gems.rushFree`). Книга стройки сервера засчитывает их каждому уровню сама: сервер этой достройки не видит.
 */
export const rushFreeWork = (): number => gameSeconds(RUSH_FREE_SECONDS) * GEM_REF_RATE;

/** Цена ускорения остатка работы `work`: последние пять минут даром, остальное — по кривой. Ноль — ускорение даром. */
export const rushPriceOfWork = (work: number): number => gemsForWait(rushSeconds(work) - RUSH_FREE_SECONDS);

/** Может ли постройка этого типа строиться до этого уровня — то, что сервер знает о стройке без книги стройки. */
export function rushLevelOk(type: string, level: number): type is BuildingTypeId {
  const def = (BUILDING_BY_ID as Record<string, (typeof BUILDING_BY_ID)[BuildingTypeId] | undefined>)[type];
  if (!def) return false;
  const top = Math.min(def.maxLevel ?? MAX_BUILDING_LEVEL, MAX_BUILDING_LEVEL);
  return Number.isInteger(level) && level >= 2 && level <= top;
}

/** Полный труд уровня по правилам игры — потолок остатка, который сервер принимает в приказе ускорения. */
export const fullWork = (type: BuildingTypeId, level: number): number => upgradeWork(BUILDING_BY_ID[type], level);

// ------------------------------------------------ лавка ---

/** Сколько единиц припаса в одной покупке. */
export const SHOP_LOT = 100;
/** Покупок в сутки — на все припасы вместе. */
export const SHOP_DAILY = 10;

/** Что продаёт лавка: припасы, которые добывают дворы. Войска и золота в ней нет (решение владельца). */
export const SHOP_GOODS: readonly ResourceId[] = (['wood', 'stone', 'food', 'hides', 'charcoal', 'copper', 'iron'] as const).filter((r) =>
  YARDS.some((y) => (y.yield[r] ?? 0) > 0),
);

/**
 * Сколько единиц припаса двор даёт за настоящий час — мерка цены лавки. Двор — здание первого уровня с полной дюжиной
 * работников (`SLOTS_PER_LEVEL`), лучший по этому припасу (тот же выбор «лучшего», что у цены своего труда,
 * `selfcost.bestYieldPerWorker`), без сезона: каким двор стоит в начале партии, если занять все места.
 */
export function yardHourly(r: ResourceId): number {
  let best = 0;
  for (const y of YARDS) best = Math.max(best, y.yield[r] ?? 0);
  return best * SLOTS_PER_LEVEL * gameDaysPerHour();
}

/** Сколько настоящих часов двор добывал бы одну покупку лавки. */
export const shopHours = (r: ResourceId): number => SHOP_LOT / yardHourly(r);

/** Цена одной покупки лавки в алмазах: ожидание двора по той же кривой, что ускорение. */
export const shopPrice = (r: ResourceId): number => gemsForWait(shopHours(r) * 3600);

/** Номер суток лавки по серверным часам — та же полночь UTC, что у ежедневного задания: одна функция на обе. */
export const shopDay = dayIndex;

/** Когда лавка обнулит счёт покупок — следующая полночь UTC. */
export const shopResetAt = (ms: number): number => (shopDay(ms) + 1) * DAY_MS;

// ------------------------------------------------ слова журнала ---

/** Припас лавки в родительном падеже: «100 камня». */
export const GOOD_OF: Readonly<Record<ResourceId, string>> = {
  wood: 'древесины',
  stone: 'камня',
  food: 'еды',
  hides: 'шкур',
  charcoal: 'угля',
  copper: 'меди',
  iron: 'железа',
};

/** Запись журнала, как её видят обе стороны: изменение, вид и дело. */
export interface GemLineOf {
  delta: number;
  kind: 'start' | 'purchase' | 'buy' | 'rush';
  res?: ResourceId;
  amount?: number;
  building?: string;
  level?: number;
}

/** Число со знаком: +120, −15. */
const signedGems = (n: number): string => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/**
 * Строка журнала — одна на «Историю» в игре и на `/gems` админа: «+120 стартовые», «−15 ускорение: Стены до ур. 3»,
 * «−20 лавка: 100 камня».
 */
export function gemLine(e: GemLineOf, name: (building: string) => string = (b) => (BUILDING_BY_ID as Record<string, { name: string } | undefined>)[b]?.name ?? b): string {
  const what =
    e.kind === 'start'
      ? 'стартовые'
      : e.kind === 'purchase'
        ? 'покупка'
        : e.kind === 'buy'
          ? `лавка: ${e.amount ?? SHOP_LOT} ${e.res ? GOOD_OF[e.res] : ''}`.trim()
          : `ускорение: ${e.building ? name(e.building) : 'стройка'}${e.level ? ` до ур. ${e.level}` : ''}`;
  return `${signedGems(e.delta)} ${what}`;
}
