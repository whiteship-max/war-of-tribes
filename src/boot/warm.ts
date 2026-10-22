/**
 * Подкачка кусков по кнопке в фоне (РТ-2б, docs/stability.md, «РТ-2б»).
 *
 * Карта мира, «Рейтинг», «Молва края» и окно зимы едут своими кусками. Чтобы первое открытие не ждало сети, их код
 * подтягивается заранее, но при трёх условиях: замок встал целиком, браузер простаивает, и сеть не медленная.
 * Подтягивается только код: модуль загружается и исполняется, а окно рисует лишь его кнопка или его час (`App`, `mapOpen`;
 * «Рейтинг» и «Молва» — кнопки карты; зима — `WinterModal`).
 *
 * Дверь одна: второе «подтянуть заранее» со своими правилами разошлось бы с этим молча.
 */
import { onSheet, sheetReady } from '@/ui/icons/sheet';

/** Что браузер говорит о сети (`navigator.connection`). В Safari этого нет, и сеть там считается обычной. */
export interface NetInfo {
  saveData?: boolean;
  effectiveType?: string;
}

/** Сети, на которых заранее не качают: там каждый килобайт — секунды, а окно могут и не открыть. */
export const SLOW_NETS: readonly string[] = ['slow-2g', '2g'];

/** Экономия трафика или 2g: куски грузятся только по касанию. */
export const slowNet = (net: NetInfo | undefined): boolean =>
  net?.saveData === true || SLOW_NETS.includes(net?.effectiveType ?? '');

/**
 * Без `requestIdleCallback` (Safari, вебвью Telegram на iOS) простой ждётся таймером — тем же сроком, который лист
 * значков отводит простою как наибольший (`ui/icons/sheet.ts`, `timeout: 1500`).
 */
export const IDLE_FALLBACK_MS = 1500;

/** Чем дверь ждёт простоя и что знает о сети: в браузере — его собственные, в тесте — подменные. */
export interface WarmEnv {
  idle?: (fn: () => void) => void;
  later: (fn: () => void, ms: number) => void;
  /** Живой объект: сеть перечитывается перед каждым куском. */
  net?: NetInfo;
}

let paint = (): void => undefined;
const painted = new Promise<void>((done) => (paint = done));

/** Первый кадр диорамы на экране — тот же миг, когда уходит экран загрузки (`GameCanvas`). */
export const castlePainted = (): void => paint();

/**
 * Замок встал целиком: первый кадр нарисован, и лист значков уже в документе — им перерисованы значки над крышами
 * (`GameCanvas`, `setMarkerArt`). Если лист не приехал (нет сети), заранее не качают: окна откроются по касанию.
 */
export const castle: Promise<unknown> = Promise.all([painted, new Promise<void>((done) => (sheetReady() ? done() : void onSheet(done)))]);

function browserEnv(): WarmEnv {
  const w = window as Window & { requestIdleCallback?: (fn: () => void) => number };
  return {
    idle: w.requestIdleCallback ? (fn) => void w.requestIdleCallback?.(fn) : undefined,
    later: (fn, ms) => void setTimeout(fn, ms),
    net: (navigator as Navigator & { connection?: NetInfo }).connection,
  };
}

/**
 * Подтягивает куски по одному, каждый в своём простое, после готовности `gate` (по умолчанию — замка). Возвращает
 * отмену: после неё ничего не качается. Ошибка сети на куске игру не роняет: окно попросит его ещё раз по касанию.
 */
export function warmAfter(
  loads: readonly (() => Promise<unknown>)[],
  gate: PromiseLike<unknown> = castle,
  env: WarmEnv = browserEnv(),
): () => void {
  let gone = false;
  let i = 0;
  const idle = (fn: () => void): void => (env.idle ? env.idle(fn) : env.later(fn, IDLE_FALLBACK_MS));
  const next = (): void => {
    if (gone || i >= loads.length || slowNet(env.net)) return;
    void loads[i++]()
      .catch(() => undefined)
      .then(() => idle(next));
  };
  if (!slowNet(env.net)) void gate.then(() => !gone && idle(next));
  return () => {
    gone = true;
  };
}
