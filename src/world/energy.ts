// Энергия агента — одна дверь на мир, на сервер войны и на всё, что её показывает (docs/agent_energy.md).
//
// ЭНЕРГИЯ — ЧИСТАЯ ФУНКЦИЯ ОТ ВРЕМЕНИ, как энергия промыслов (`game/sim/minigames.ts`). На фигуре лежит отметка:
// сколько было в минуту `at` и что с запасом с этой минуты — уходит (в дороге), копится (дома) или стоит (у цели, в
// поле, в осадном лагере, вне строя). Сколько сейчас — выводится на чтении; тика, таймера и догона нет, и сутки без игры
// считаются тем же выражением, что секунда. Отметка сама себя описывает, поэтому её читает и сервер, не зная, где
// фигура: тот же вход в ту же минуту даёт то же число у кого угодно.
//
// ДОРОГА — ПО ДНЯМ ПУТИ, СТОЯНКА — ДАРОМ (решение владельца 06.10.2026). Запас уходит, только пока агент идёт; дошёл —
// стоит, сколько бы ни ждал приказа. Одна смена режима живёт внутри отметки — конец дороги: путь домой уходит до
// прихода и копится после него (`homeAt`), путь к цели уходит до прихода и стоит после него (`stopAt`); вне строя стоит
// до возврата и копится после (`homeAt`). Остальные перемены — новый путь, осада, выход в поле — новая отметка, и пишет
// её мир в минуту перемены (`LocalWorld.energyOf`) или сервер войны (`netlify/lib/war.ts`) той же функцией `onRoad`.
//
// ЦЕНА — ПРИ ПРИКАЗЕ. Дело списывает свою цену (`data/energy.ENERGY_PRICE`) в минуту приказа, и приказ принимается,
// только если цены хватает к минуте дела — с дорогой до него (`energyBlock`). Без сил агент ничего не делает; сил нет —
// это не хватает ни на одно его дело (`outOf`, решение владельца 06.10.2026). Кончилась в дороге или у цели сил нет —
// идёт домой сам (это решает мир, а не дверь: `emptyAt` и `outOf` говорят только «когда» и «нет ли»).
//
// Модуль чистый: часов не читает, время приходит доводом. Без `@/`: его собирает и сервер.
import { ENERGY_CAMP, ENERGY_FILL, ENERGY_MAX, ENERGY_PRICE, ENERGY_ROAD, type EnergyAction } from './data/energy';
import type { FigureId } from './types';

/**
 * Что с запасом с минуты отметки: уходит (в дороге), копится (дома), копится медленно (в осадном лагере, `camp`: залп за
 * фазу, ответ владельца 3) или стоит (у цели, в поле, вне строя).
 */
export type EnergyMode = 'drain' | 'fill' | 'camp' | 'hold';

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
  /**
   * С этой минуты запас стоит — приход к цели у пути (`drain`): дорога кончилась, ожидание у цели даром. Поле только у
   * пути не домой; у пути домой — `homeAt`.
   */
  stopAt?: number;
  /**
   * Темп дороги (ДР-2, М8): во сколько раз быстрее обычного уходит запас в пути — множитель скорости режима марша
   * (`gait.gaitSpeed`), поэтому та же дорога стоит ту же энергию в любом режиме. Нет поля — 1, как до ДР-2.
   */
  rate?: number;
}

/** Энергия глазами игрока: целая вниз, полный запас и когда что случится. */
export interface EnergyView {
  value: number;
  max: number;
  mode: EnergyMode;
  /** Когда запас станет полным — только если он копится или начнёт копиться. */
  fullBy?: number;
  /** Когда запас кончится в дороге — только если кончится раньше, чем агент дойдёт. */
  emptyBy?: number;
}

const EPS = 1e-9;
const clamp = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.min(ENERGY_MAX, v)) : ENERGY_MAX);

/** Темп дороги отметки: положительное число, иначе 1. */
const rateOf = (r: number | undefined): number => (r !== undefined && Number.isFinite(r) && r > 0 ? r : 1);

/** Запас через `dt` мс в режиме `mode` от значения `v`; `rate` — темп дороги. */
function step(v: number, mode: EnergyMode, dt: number, rate = 1): number {
  if (!(dt > 0)) return v;
  if (mode === 'drain') return Math.max(0, v - (ENERGY_MAX * dt * rate) / ENERGY_ROAD);
  if (mode === 'fill') return Math.min(ENERGY_MAX, v + (ENERGY_MAX * dt) / ENERGY_FILL);
  if (mode === 'camp') return Math.min(ENERGY_MAX, v + (ENERGY_MAX * dt) / ENERGY_CAMP);
  return v;
}

/** За сколько мс копится полный запас в режиме, который копит; не копит — `Infinity`. */
const fillSpan = (mode: EnergyMode): number => (mode === 'fill' ? ENERGY_FILL : mode === 'camp' ? ENERGY_CAMP : Infinity);

const finite = (t: number | undefined): t is number => t !== undefined && Number.isFinite(t);

/**
 * Смена режима внутри отметки: с какой минуты и на какой. У `fill` смены нет. Приход домой и возврат в строй — копится
 * (`homeAt`); приход к цели у пути — стоит (`stopAt`). Нет ни того, ни другого — режим держится до новой отметки.
 */
function turnOf(m: EnergyMark): { at: number; to: EnergyMode } | null {
  if (m.mode === 'fill' || m.mode === 'camp') return null;
  if (finite(m.homeAt)) return { at: Math.max(m.at, m.homeAt), to: 'fill' };
  if (m.mode === 'drain' && finite(m.stopAt)) return { at: Math.max(m.at, m.stopAt), to: 'hold' };
  return null;
}

/** Минута, с которой отметка копится. Нет — `Infinity`. У `fill` и `camp` — с самой отметки. */
function fillFrom(m: EnergyMark): number {
  if (m.mode === 'fill' || m.mode === 'camp') return m.at;
  const t = turnOf(m);
  return t?.to === 'fill' ? t.at : Infinity;
}

/** Полная отметка: свежий человек на месте или фигура, у которой отметки ещё не было. */
export const freshMark = (at: number, mode: EnergyMode = 'fill', ends: MarkEnds = {}): EnergyMark => ({
  value: ENERGY_MAX,
  at,
  mode,
  ...endsOf(ends),
});

/** Концы режима отметки: приход домой (`homeAt`) и приход к цели (`stopAt`); темп дороги (`rate`) — у пути. */
export interface MarkEnds {
  homeAt?: number;
  stopAt?: number;
  rate?: number;
}

const endsOf = (e: MarkEnds): MarkEnds => ({
  ...(e.homeAt !== undefined ? { homeAt: e.homeAt } : {}),
  ...(e.stopAt !== undefined ? { stopAt: e.stopAt } : {}),
  ...(rateOf(e.rate) !== 1 ? { rate: rateOf(e.rate) } : {}),
});

/** Сколько энергии в минуту `now`, дробью. Нет отметки — полный запас. Раньше отметки — её значение. */
export function energyAt(mark: EnergyMark | undefined, now: number): number {
  if (!mark) return ENERGY_MAX;
  const v = clamp(mark.value);
  if (!(now > mark.at)) return v;
  const turn = turnOf(mark);
  const first = step(v, mark.mode, Math.min(now, turn?.at ?? Infinity) - mark.at, rateOf(mark.rate));
  return turn && now > turn.at ? step(first, turn.to, now - turn.at) : first;
}

/** Энергия числом на экране и в отказе: целая вниз — обещать дело, на которое сил ещё нет, нельзя. */
export const energyShown = (mark: EnergyMark | undefined, now: number): number => Math.floor(energyAt(mark, now) + EPS);

/**
 * Минута, когда запас кончится в дороге: путь дойдёт до нуля раньше прихода. null — не кончится: копится, стоит или
 * агент дойдёт раньше. Отметка пути с нулём — кончилась в минуту отметки.
 */
export function emptyAt(mark: EnergyMark | undefined): number | null {
  if (!mark || mark.mode !== 'drain') return null;
  const t = mark.at + (clamp(mark.value) / ENERGY_MAX) * (ENERGY_ROAD / rateOf(mark.rate));
  return t < (turnOf(mark)?.at ?? Infinity) ? t : null;
}

/** Когда запас станет полным. Не копится и копиться не начнёт — null. Полон уже — `now`. */
export function fullAt(mark: EnergyMark | undefined, now: number): number | null {
  if (energyAt(mark, now) >= ENERGY_MAX - EPS) return now;
  if (!mark) return now;
  const sw = fillFrom(mark);
  if (sw === Infinity) return null;
  const from = Math.max(now, sw);
  return from + ((ENERGY_MAX - energyAt(mark, from)) / ENERGY_MAX) * fillSpan(modeAt(mark, from));
}

/** Новая отметка с минуты `at`: значение — по прежней, режим — новый. Так мир пишет перемену стойки. */
export function remark(mark: EnergyMark | undefined, at: number, mode: EnergyMode, ends: MarkEnds = {}): EnergyMark {
  return { value: energyAt(mark, at), at, mode, ...endsOf(ends) };
}

/**
 * Отметка дороги с минуты `at` до прихода в `arriveAt`: путь уходит, а придя, домой — копится, к цели — стоит. Одна
 * функция на мир (`LocalWorld.energyStance`) и на сервер войны (`netlify/lib/war.ts`): дорога у них одна. `rate` — темп
 * дороги режима марша (`gait.gaitSpeed`, ДР-2): быстрее идёт — быстрее тратит, та же дорога — та же энергия.
 */
export function onRoad(mark: EnergyMark | undefined, at: number, arriveAt: number, home: boolean, rate = 1): EnergyMark {
  return remark(mark, at, 'drain', { ...(home ? { homeAt: arriveAt } : { stopAt: arriveAt }), rate });
}

/** Заплатить цену в минуту `at`: значение минус цена (не ниже нуля), режим прежний. */
export function spend(mark: EnergyMark | undefined, at: number, price: number): EnergyMark {
  const base = mark ?? freshMark(at);
  return { ...remark(base, at, base.mode, base), value: Math.max(0, energyAt(base, at) - Math.max(0, price)) };
}

/** Сколько энергии съест дорога в `ms` настоящих мс по карте; `rate` — темп дороги режима марша (ДР-2). */
export const roadCost = (ms: number, rate = 1): number => (ENERGY_MAX * Math.max(0, ms) * rateOf(rate)) / ENERGY_ROAD;

/** На сколько мс пути по карте хватит `value` энергии; `rate` — темп дороги. */
export const roadOf = (value: number, rate = 1): number => (Math.max(0, value) / ENERGY_MAX) * (ENERGY_ROAD / rateOf(rate));

/** Цена дела. */
export const priceOf = (action: EnergyAction): number => ENERGY_PRICE[action].price;

/**
 * Сколько энергии останется на месте дела после дороги до него и его цены, дробью, не ниже нуля. Так меряется, хватит ли
 * у стен на следующее дело — штурм из лагеря после осады (docs/siege_audit.md, решение 9): в лагере энергия стоит.
 */
export const leftAfter = (have: number, price: number, road = 0, rate = 1): number =>
  Math.max(0, have - roadCost(road, rate) - Math.max(0, price));

/** Энергия числом на экране — целая вниз, как `energyShown`: обещать дело, на которое сил ещё нет, нельзя. */
export const shownEnergy = (v: number): number => Math.floor(Math.max(0, v) + EPS);

/**
 * Хватит ли энергии на дело — одна проверка на мир, сервер и меню. `have` — сколько сейчас, `price` — цена, `road` —
 * сколько съест дорога до места дела (мс пути по карте; дело на месте — 0), `rate` — её темп (режим марша, ДР-2). null —
 * хватит, иначе отказ словами.
 */
export function energyBlock(have: number, price: number, road = 0, rate = 1): string | null {
  const left = have - roadCost(road, rate);
  if (left + EPS >= price) return null;
  const now = Math.floor(Math.max(0, have) + EPS);
  if (road > 0) return `Не хватит энергии: на месте будет ${Math.floor(Math.max(0, left) + EPS)}, нужно ${price}.`;
  return `Не хватает энергии: ${now} из ${price}.`;
}

/**
 * Цена самого дешёвого дела агента — по таблице цен (`ENERGY_PRICE`, поле `agent`). Меньше — ему не по карману ни одно его
 * дело. Дела без цены (наблюдение, перевод дружины, «вести сюда» в чистое поле) платят только дорогой и мерой не служат:
 * иначе сил хватало бы всегда. У агента без строк в таблице мерка — единица, как прежде.
 */
export function leastPrice(agent: FigureId): number {
  let least = Infinity;
  for (const p of Object.values(ENERGY_PRICE)) if (p.agent === agent) least = Math.min(least, p.price);
  return Number.isFinite(least) ? least : 1;
}

/**
 * Сил нет: энергии не хватает ни на одно его дело (решение владельца 06.10.2026; прежде — меньше единицы, ноль на
 * экране). Одна мерка на выход из ворот (`idleBlock`) и стоянку в поле (`LocalWorld.outAt`).
 */
export const outOf = (have: number, agent: FigureId): boolean => have + EPS < leastPrice(agent);

/** Без сил агент ничего не делает — и из своих ворот не выходит. null — выйти может. */
export function idleBlock(have: number, agent: FigureId): string | null {
  if (!outOf(have, agent)) return null;
  return `Не хватает энергии ни на одно дело: ${Math.floor(Math.max(0, have) + EPS)} из ${leastPrice(agent)}. Дома она вернётся.`;
}

/** Что с запасом в минуту `now`: режим отметки, а после конца дороги или возврата в строй — тот, что после него. */
export function modeAt(mark: EnergyMark | undefined, now: number): EnergyMode {
  if (!mark) return 'fill';
  const turn = turnOf(mark);
  return turn && now >= turn.at ? turn.to : mark.mode;
}

/** Энергия глазами игрока в минуту `now`. */
export function energyView(mark: EnergyMark | undefined, now: number): EnergyView {
  const full = fullAt(mark, now);
  const empty = emptyAt(mark);
  return {
    value: energyShown(mark, now),
    max: ENERGY_MAX,
    mode: modeAt(mark, now),
    ...(full !== null && full > now ? { fullBy: full } : {}),
    ...(empty !== null && empty > now ? { emptyBy: empty } : {}),
  };
}
