// События племени как донесения почты державы (docs/realm.md, раздел 2.5).
//
// Событие больше не окно поверх игры, которое нельзя отложить, а донесение: оно
// ждёт в «Решениях», пока игрок не ответит, — но не вечно. Срок у него —
// **настоящие сутки**, тот же `LETTER_TTL`, что у письма мира: почта одна, и
// срок у неё один. Игровыми сутками его мерить нельзя: игровой день длится
// минуту, и «сутки» значили бы полторы тысячи дней.
//
// Закрывается событие ровно одной дверью — `closeEvent`, — и поводов у неё два:
// ответ игрока (`resolveEvent`) и молчание (`lapseEvent`). Молчание применяет
// вариант, который событие назвало само (`EventDef.silence`), тем же путём, что
// и ответ: у молчания нет ни одной ветки, которой не было бы у ответа. Это
// правило писем мира (`world/letters.resolveLetter`), перенесённое на события.
//
// Часов модуль не читает: «сейчас» приходит числом (`mailStep(s, now)`), как
// день ежедневки. Шаг симуляции (`tick`) про настоящие часы не знает вовсе.
import type { GameState } from '../types';
import { EVENT_BY_ID, eventBlock, payEventCost, type EventDef } from '../data/events';
import { EVENT_INTERVAL_MAX, EVENT_INTERVAL_MIN } from '../constants';
import { LETTER_TTL } from '@/world/data/tuning';
import { rollInt } from './roll';
import { log } from './log';

/** Сколько событие ждёт ответа, мс настоящего времени. Одно число на всю почту. */
export const EVENT_TTL = LETTER_TTL;

/** Что написано в летописи перед исходом, случившимся без ответа. */
export const SILENCE_PREFIX = 'Ответа не дождались';

export const scheduleNextEvent = (s: GameState): void => {
  s.nextEventAt = s.time + rollInt(s, EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX);
};

const activeDef = (s: GameState): EventDef | null =>
  s.activeEvent ? (EVENT_BY_ID[s.activeEvent.defId] ?? null) : null;

/** Единственная дверь, закрывающая событие: применить вариант и назначить следующее. */
function closeEvent(s: GameState, def: EventDef, optionIndex: number, silent: boolean): string {
  const opt = def.options[optionIndex];
  payEventCost(opt, s);
  const result = opt.apply(s);
  s.activeEvent = null;
  s.stats.eventsResolved++;
  scheduleNextEvent(s);
  log(s, silent ? `${def.title}: ${SILENCE_PREFIX} — «${opt.label}». ${result}` : `${def.title}: ${result}`);
  return result;
}

/** Ответ игрока. */
export function resolveEvent(s: GameState, optionIndex: number): { error: string | null; result: string | null } {
  const def = activeDef(s);
  if (!def) return { error: 'Нет активного события.', result: null };
  const opt = def.options[optionIndex];
  if (!opt) return { error: 'Неверный выбор.', result: null };
  // Цена списывается в двери, до `apply`, и отказ приходит отсюда же: цена одна
  // на показ, на запрет и на списание.
  const block = eventBlock(opt, s);
  if (block) return { error: block, result: null };
  return { error: null, result: closeEvent(s, def, optionIndex, false) };
}

/**
 * Молчание: событие разрешается само вариантом, который назвало. Зовут его
 * двое — срок донесения (`mailStep`) и мятеж, которому нужен стол
 * (`tick`, как лишнее письмо сгоняет письмо со стола мира). Возвращает строку
 * исхода или null, если закрывать нечего.
 */
export function lapseEvent(s: GameState): string | null {
  const def = activeDef(s);
  if (!def) return null;
  return closeEvent(s, def, def.silence, true);
}

/**
 * Сколько секунд событие ещё ждёт ответа — одна правда на показ и на срок. У
 * события со своим сроком (мятеж) это его срок, игровой и только при игроке;
 * у остальных — настоящие часы. null — срок ещё не поставлен или события нет.
 */
export function eventLeft(s: GameState, now: number): number | null {
  const def = activeDef(s);
  if (!def || !s.activeEvent) return null;
  if (def.deadline) return def.deadline(s)?.left ?? null;
  if (s.activeEvent.until === undefined) return null;
  return Math.max(0, (s.activeEvent.until - now) / 1000);
}

/**
 * Шаг почты по настоящим часам. Ставит срок пришедшему событию и разрешает
 * событие, чей срок вышел. Своим сроком (мятеж) живёт `tick`, и сюда такое
 * событие не заходит. Возвращает строку исхода, если что-то разрешилось.
 */
export function mailStep(s: GameState, now: number): string | null {
  const def = activeDef(s);
  if (!def || !s.activeEvent || def.deadline) return null;
  if (s.activeEvent.until === undefined) {
    s.activeEvent.until = now + EVENT_TTL;
    return null;
  }
  if (now < s.activeEvent.until) return null;
  return lapseEvent(s);
}
