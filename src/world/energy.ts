// Энергия агента — одна дверь на мир, на сервер войны и на всё, что её показывает (docs/agent_energy.md).
//
// ЭНЕРГИЯ — ЧИСТАЯ ФУНКЦИЯ ОТ ВРЕМЕНИ, как энергия промыслов (`game/sim/minigames.ts`). На фигуре лежит отметка:
// сколько было в минуту `at` и что с запасом с этой минуты — уходит (на карте), копится (дома) или стоит (осадный
// лагерь, вне строя, война между игроками). Сколько сейчас — выводится на чтении; тика, таймера и догона нет, и сутки
// без игры считаются тем же выражением, что секунда. Отметка сама себя описывает, поэтому её читает и сервер, не зная,
// где фигура: тот же вход в ту же минуту даёт то же число у кого угодно.
//
// Одна смена режима внутри отметки — приход домой: путь домой уходит до минуты прихода и копится после неё, вне
// строя стоит до возврата и копится после. Остальные перемены — новый путь, осада, выход в поле — новая отметка,
// и пишет её мир в минуту перемены (`LocalWorld.energyOf`): значение по прежней отметке, режим — по новой стойке.
//
// ЦЕНА — ПРИ ПРИКАЗЕ. Дело списывает свою цену (`data/energy.ENERGY_PRICE`) в минуту приказа, и приказ принимается,
// только если цены хватает к минуте дела — с дорогой до него (`energyBlock`). Без энергии агент ничего не делает;
// кончилась на карте — идёт домой сам (это решает мир, а не дверь: `emptyAt` говорит только «когда»).
//
// Модуль чистый: часов не читает, время приходит доводом. Без `@/`: его собирает и сервер.
import { ENERGY_DRAIN, ENERGY_FILL, ENERGY_MAX, ENERGY_PRICE, type EnergyAction } from './data/energy';

/** Что с запасом с минуты отметки: уходит (на карте), копится (дома) или стоит. */
export type EnergyMode = 'drain' | 'fill' | 'hold';

/** Отметка энергии: сколько было в минуту `at` (часы мира) и что с запасом с этой минуты. */
export interface EnergyMark {
  value: number;
  at: number;
  mode: EnergyMode;
  /**
   * С этой минуты запас копится — приход домой у пути (`drain`) и возврат в строй у стоящего (`hold`). Нет поля —
   * режим держится до новой отметки.
   */
  homeAt?: number;
}

/** Энергия глазами игрока: целая вниз, полный запас и когда что случится. */
export interface EnergyView {
  value: number;
  max: number;
  mode: EnergyMode;
  /** Когда запас станет полным — только если он копится или начнёт копиться. */
  fullAt?: number;
  /** Когда запас кончится на карте — только если кончится раньше, чем агент дойдёт домой. */
  emptyAt?: number;
}

const EPS = 1e-9;
const clamp = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(ENERGY_MAX, v)) : ENERGY_MAX);

/** Запас через `dt` мс в режиме `mode` от значения `v`. */
function step(v: number, mode: EnergyMode, dt: number): number {
  if (!(dt > 0)) return v;
  if (mode === 'drain') return Math.max(0, v - (ENERGY_MAX * dt) / ENERGY_DRAIN);
  if (mode === 'fill') return Math.min(ENERGY_MAX, v + (ENERGY_MAX * dt) / ENERGY_FILL);
  return v;
}

/** Минута, с которой отметка копится. Нет — `Infinity`. У `fill` — с самой отметки. */
const switchAt = (m: EnergyMark): number =>
  m.mode === 'fill' ? m.at : m.homeAt !== undefined && Number.isFinite(m.homeAt) ? Math.max(m.at, m.homeAt) : Infinity;

/** Полная отметка: свежий человек на месте или фигура, у которой отметки ещё не было. */
export const freshMark = (at: number, mode: EnergyMode = 'fill', homeAt?: number): EnergyMark => ({
  value: ENERGY_MAX,
  at,
  mode,
  ...(homeAt !== undefined ? { homeAt } : {}),
});

/** Сколько энергии в минуту `now`, дробью. Нет отметки — полный запас. Раньше отметки — её значение. */
export function energyAt(mark: EnergyMark | undefined, now: number): number {
  if (!mark) return ENERGY_MAX;
  const v = clamp(mark.value);
  if (!(now > mark.at)) return v;
  const sw = switchAt(mark);
  const first = step(v, mark.mode === 'fill' ? 'fill' : mark.mode, Math.min(now, sw) - mark.at);
  return now > sw ? step(first, 'fill', now - Math.max(mark.at, sw)) : first;
}

/** Энергия числом на экране и в отказе: целая вниз — обещать дело, на которое сил ещё нет, нельзя. */
export const energyShown = (mark: EnergyMark | undefined, now: number): number => Math.floor(energyAt(mark, now) + EPS);

/**
 * Минута, когда запас кончится на карте: путь или стоянка в поле (`drain`) дойдут до нуля раньше прихода домой. null —
 * не кончится: копится, стоит или дойдёт домой раньше. Отметка с нулём в поле — кончилась в минуту отметки.
 */
export function emptyAt(mark: EnergyMark | undefined): number | null {
  if (!mark || mark.mode !== 'drain') return null;
  const t = mark.at + (clamp(mark.value) / ENERGY_MAX) * ENERGY_DRAIN;
  return t < switchAt(mark) ? t : null;
}

/** Когда запас станет полным. Не копится и копиться не начнёт — null. Полон уже — `now`. */
export function fullAt(mark: EnergyMark | undefined, now: number): number | null {
  if (energyAt(mark, now) >= ENERGY_MAX - EPS) return now;
  if (!mark) return now;
  const sw = switchAt(mark);
  if (sw === Infinity) return null;
  const from = Math.max(now, sw);
  return from + ((ENERGY_MAX - energyAt(mark, from)) / ENERGY_MAX) * ENERGY_FILL;
}

/** Новая отметка с минуты `at`: значение — по прежней, режим — новый. Так мир пишет перемену стойки. */
export function remark(mark: EnergyMark | undefined, at: number, mode: EnergyMode, homeAt?: number): EnergyMark {
  return { value: energyAt(mark, at), at, mode, ...(homeAt !== undefined ? { homeAt } : {}) };
}

/** Заплатить цену в минуту `at`: значение минус цена (не ниже нуля), режим прежний. */
export function spend(mark: EnergyMark | undefined, at: number, price: number): EnergyMark {
  const base = mark ?? freshMark(at);
  return { ...remark(base, at, base.mode, base.homeAt), value: Math.max(0, energyAt(base, at) - Math.max(0, price)) };
}

/** Сколько энергии съест дорога в `ms` настоящих мс по карте. */
export const roadCost = (ms: number): number => (ENERGY_MAX * Math.max(0, ms)) / ENERGY_DRAIN;

/** На сколько мс пути по карте хватит `value` энергии. */
export const roadOf = (value: number): number => (Math.max(0, value) / ENERGY_MAX) * ENERGY_DRAIN;

/** Цена дела. */
export const priceOf = (action: EnergyAction): number => ENERGY_PRICE[action].price;

/**
 * Хватит ли энергии на дело — одна проверка на мир, сервер и меню. `have` — сколько сейчас, `price` — цена, `road` —
 * сколько съест дорога до места дела (мс пути по карте; дело на месте — 0). null — хватит, иначе отказ словами.
 */
export function energyBlock(have: number, price: number, road = 0): string | null {
  const left = have - roadCost(road);
  if (left + EPS >= price) return null;
  const now = Math.floor(Math.max(0, have) + EPS);
  if (road > 0) return `Не хватит энергии: на месте будет ${Math.floor(Math.max(0, left) + EPS)}, нужно ${price}.`;
  return `Не хватает энергии: ${now} из ${price}.`;
}

/** Без энергии агент ничего не делает — и из своих ворот не выходит. null — выйти может. */
export function idleBlock(have: number): string | null {
  return have + EPS >= 1 ? null : 'Нет энергии. Дома она вернётся.';
}

/** Энергия глазами игрока в минуту `now`. */
export function energyView(mark: EnergyMark | undefined, now: number): EnergyView {
  const full = fullAt(mark, now);
  const empty = emptyAt(mark);
  return {
    value: energyShown(mark, now),
    max: ENERGY_MAX,
    mode: mark?.mode ?? 'fill',
    ...(full !== null && full > now ? { fullAt: full } : {}),
    ...(empty !== null && empty > now ? { emptyAt: empty } : {}),
  };
}
