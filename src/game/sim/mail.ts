// События племени как донесения почты державы (docs/realm.md, раздел 2.5).
//
// Событие больше не окно поверх игры, которое нельзя отложить, а донесение: оно
// ждёт в «Решениях», пока игрок не ответит, — но не вечно. Ждать могут несколько
// сразу: у посёлка тот же стол, что у писем мира, — `LETTER_DECISIONS` обычных
// событий и своя ячейка мятежу, как у писем — предупреждению о набеге. Лишнее
// сгоняет то, у кого срок ближе всех, тем же правилом (`world/letters.kickFrom`). Срок у него —
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
import type { ActiveEvent, GameState } from '../types';
import { EVENT_BY_ID, eventBlock, payEventCost, type EventDef } from '../data/events';
import { EVENT_INTERVAL_MAX, EVENT_INTERVAL_MIN } from '../constants';
import { LETTER_TTL } from '@/world/data/tuning';
import { kickFrom } from '@/world/letters';
import { MUTINY_EVENT } from '../data/order';
import { rollInt } from './roll';
import { log } from './log';

/** Сколько событие ждёт ответа, мс настоящего времени. Одно число на всю почту. */
export const EVENT_TTL = LETTER_TTL;

/** Что написано в летописи перед исходом, случившимся без ответа. */
export const SILENCE_PREFIX = 'Ответа не дождались';

/** Имя события на столе: вид и минута прихода. */
export const eventId = (ev: ActiveEvent): string => `${ev.defId}:${ev.at}`;

export const scheduleNextEvent = (s: GameState): void => {
  s.nextEventAt = s.time + rollInt(s, EVENT_INTERVAL_MIN, EVENT_INTERVAL_MAX);
};

/**
 * Событие со своей ячейкой: мятеж. Его срок — секунды, и сгонять его наравне с
 * вестями значило бы прятать то, что вот-вот случится; сам он тоже никого не
 * сгоняет. Так же у писем стоит предупреждение о набеге.
 */
const ownSlot = (ev: ActiveEvent): boolean => ev.defId === MUTINY_EVENT;

/** Событие на столе по имени; без имени — первое. */
const pick = (s: GameState, id?: string): ActiveEvent | null =>
  (id === undefined ? s.inbox[0] : s.inbox.find((e) => eventId(e) === id)) ?? null;

/** Единственная дверь, закрывающая событие: применить вариант и убрать со стола. */
function closeEvent(s: GameState, ev: ActiveEvent, def: EventDef, optionIndex: number, silent: boolean): string {
  const opt = def.options[optionIndex];
  payEventCost(opt, s);
  const result = opt.apply(s);
  s.inbox = s.inbox.filter((e) => e !== ev);
  s.stats.eventsResolved++;
  log(s, silent ? `${def.title}: ${SILENCE_PREFIX} — «${opt.label}». ${result}` : `${def.title}: ${result}`);
  return result;
}

/** Ответ игрока. `id` — какое событие; без него — первое на столе. */
export function resolveEvent(
  s: GameState,
  optionIndex: number,
  id?: string,
): { error: string | null; result: string | null } {
  const ev = pick(s, id);
  const def = ev ? EVENT_BY_ID[ev.defId] : undefined;
  if (!ev || !def) return { error: 'Нет такого события.', result: null };
  const opt = def.options[optionIndex];
  if (!opt) return { error: 'Неверный выбор.', result: null };
  // Цена списывается в двери, до `apply`, и отказ приходит отсюда же: цена одна
  // на показ, на запрет и на списание.
  const block = eventBlock(opt, s);
  if (block) return { error: block, result: null };
  return { error: null, result: closeEvent(s, ev, def, optionIndex, false) };
}

/**
 * Молчание: событие разрешается само вариантом, который назвало. Зовут его
 * трое — срок донесения (`mailStep`), срок мятежа (`tick`) и полный стол
 * (`raiseEvent`). Возвращает строку исхода или null, если закрывать нечего.
 */
export function lapseEvent(s: GameState, id?: string): string | null {
  const ev = pick(s, id);
  const def = ev ? EVENT_BY_ID[ev.defId] : undefined;
  if (!ev || !def) return null;
  return closeEvent(s, ev, def, def.silence, true);
}

/**
 * Положить событие на стол. Того же вида, что уже ждёт, второй раз не кладут —
 * два «Пожара» разом читались бы сбоем. Стол полон — сначала уходит то, у кого
 * срок ближе всех (ещё без срока — позже всех), своим молчанием. Возвращает, легло
 * ли событие.
 */
export function raiseEvent(s: GameState, defId: string): boolean {
  if (s.inbox.some((e) => e.defId === defId)) return false;
  const ev: ActiveEvent = { defId, at: s.time };
  if (!ownSlot(ev)) {
    const kick = kickFrom(
      s.inbox.filter((e) => !ownSlot(e)).map((e) => ({ e, until: e.until ?? Infinity, at: e.at })),
    );
    if (kick) lapseEvent(s, eventId(kick.e));
  }
  s.inbox.push(ev);
  return true;
}

/**
 * Сколько секунд событие ещё ждёт ответа — одна правда на показ и на срок. У
 * события со своим сроком (мятеж) это его срок, игровой и только при игроке;
 * у остальных — настоящие часы. null — срок ещё не поставлен.
 */
export function eventLeft(s: GameState, ev: ActiveEvent, now: number): number | null {
  const def = EVENT_BY_ID[ev.defId];
  if (!def) return null;
  if (def.deadline) return def.deadline(s)?.left ?? null;
  if (ev.until === undefined) return null;
  return Math.max(0, (ev.until - now) / 1000);
}

/**
 * Шаг почты по настоящим часам. Ставит срок пришедшим событиям и разрешает те,
 * чей срок вышел. Своим сроком (мятеж) живёт `tick`, и сюда такое событие не
 * заходит. Возвращает, разрешилось ли что-нибудь.
 */
export function mailStep(s: GameState, now: number): boolean {
  let lapsed = false;
  for (const ev of [...s.inbox]) {
    if (EVENT_BY_ID[ev.defId]?.deadline) continue;
    if (ev.until === undefined) ev.until = now + EVENT_TTL;
    else if (now >= ev.until && lapseEvent(s, eventId(ev)) !== null) lapsed = true;
  }
  return lapsed;
}
