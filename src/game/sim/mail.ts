// События племени как донесения почты державы (docs/realm.md, раздел 2.5).
//
// Событие больше не окно поверх игры, которое нельзя отложить, а донесение: оно
// ждёт в «Решениях», пока игрок не ответит, — но не вечно. Ждать могут несколько
// сразу: у посёлка тот же стол, что у писем мира, — `LETTER_DECISIONS` обычных
// событий и своя ячейка мятежу, как у писем — предупреждению о набеге. Сколько
// ячеек у стола на самом деле, спрашивают у гейта (`sim/tech.mailSlots`):
// дипломатическая ветвь прибавляет ячейку, и стол растёт вместе с ней. Лишнее
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
import { EVENT_BY_ID, eventBlock, payEventCost, pickEvent, type EventDef } from '../data/events';
import { LETTER_PAUSE_MAX, LETTER_PAUSE_MIN, LETTER_TTL } from '@/world/data/tuning';
import { hashId } from '@/world/diplomacy';
import { TUTORIAL_EVENT_MUTE } from '../data/tutorial';
import { kickFrom } from '@/world/letters';
import { mailSlots } from './tech';
import { MUTINY_EVENT } from '../data/order';
import { STAB_EVENTS } from '../data/stability';
import { log } from './log';
import { realMs } from '../pace';

/** Сколько событие ждёт ответа, мс настоящего времени. Одно число на всю почту. */
export const EVENT_TTL = LETTER_TTL;

/** Что написано в летописи перед исходом, случившимся без ответа. */
export const SILENCE_PREFIX = 'Ответа не дождались';

/** Имя события на столе: вид и минута прихода. */
export const eventId = (ev: ActiveEvent): string => `${ev.defId}:${ev.at}`;

/**
 * Событие со своей ячейкой: мятеж — невольников и, тем же правилом, податных и голодных с условиями мятежников
 * (`data/stability.STAB_EVENTS`). Его молчание — самая жёсткая потеря в игре, и сгонять
 * его наравне с вестями значило бы разрешать её чужим сроком; сам он тоже никого не
 * сгоняет. Так же у писем стоит предупреждение о набеге.
 */
const ownSlot = (ev: ActiveEvent): boolean => ev.defId === MUTINY_EVENT || STAB_EVENTS.includes(ev.defId);

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
  if (!ev || !def) return { error: 'Нет такой вести.', result: null };
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
 * двое — срок донесения (`mailStep`, у мятежа тот же) и полный стол
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
      // Ячеек у стола столько, сколько открыла дипломатическая ветвь, — и спрашивается это
      // той же дверью, что показывает ступень игроку (`sim/tech.mailSlots`).
      mailSlots(s),
    );
    if (kick) lapseEvent(s, eventId(kick.e));
  }
  s.inbox.push(ev);
  return true;
}

/**
 * Сколько настоящих секунд событие ещё ждёт ответа — одна правда на показ и на срок, и одна на
 * всю почту: у мятежа срок тот же. null — срок ещё не поставлен.
 */
export function eventLeft(ev: ActiveEvent, now: number): number | null {
  if (!EVENT_BY_ID[ev.defId]) return null;
  if (ev.until === undefined) return null;
  return Math.max(0, (ev.until - now) / 1000);
}

/**
 * Шаг почты по настоящим часам. Ставит срок пришедшим событиям и разрешает те,
 * чей срок вышел. Мятеж — такое же донесение: срок ему ставит первый шаг почты **при игроке**
 * (цикл стора), потому что в отлучке при ропоте почта не ходит (`mailArrive`), — мятеж, которого
 * игрок не видел, молчанием не решается. Возвращает, разрешилось ли что-нибудь.
 */
export function mailStep(s: GameState, now: number): boolean {
  let lapsed = false;
  for (const ev of [...s.inbox]) {
    if (ev.until === undefined) ev.until = now + EVENT_TTL;
    else if (now >= ev.until && lapseEvent(s, eventId(ev)) !== null) lapsed = true;
  }
  return lapsed;
}

/**
 * Приход вестей. **Вести зреют по времени, а не по присутствию** (docs/time.md, раздел 14): шаг
 * симуляции их не поднимает вовсе — ни при игроке, ни в догоне. Стол **выводится из времени**:
 * сколько прошло настоящих часов и какие приходы легли на них по сетке партии. Сетка одна на
 * живую игру (`sim/tick.liveStep` спрашивает окно своего шага) и на отлучку (`sim/tick.absence` —
 * окно от последней записи до входа). Прежде при игроке вести шли своим счётом, раз в 70–140
 * игровых секунд, а в отлучке — по этой сетке: пятиминутный заход приносил три вести, восемь
 * часов отлучки — одну.
 *
 * Сетка — числа пауз писем мира, нового не заведено: шаг — середина
 * `LETTER_PAUSE_MIN`…`LETTER_PAUSE_MAX` (8 ч), приход ложится в начало своего шага
 * со сдвигом до половины их разницы (0–2 ч), поэтому соседние приходы лежат в
 * 6–10 ч друг от друга — ровно паузы писем.
 * Приход k стоит в абсолютном времени и зависит только от сида партии и k: сколько
 * раз и когда игрок заглядывал и был ли он при игре, на сетку не влияет (это тест).
 */
export const AWAY_STEP = (LETTER_PAUSE_MIN + LETTER_PAUSE_MAX) / 2;
export const AWAY_JITTER = (LETTER_PAUSE_MAX - LETTER_PAUSE_MIN) / 2;

/** Минута k-го прихода вести, мс настоящего времени. */
export const awayArrival = (seed: number, k: number): number =>
  k * AWAY_STEP + (hashId(`${seed}|mail|${k}`) / 2 ** 32) * AWAY_JITTER;

/**
 * Положить на стол вести, пришедшие между `from` и `now` (настоящие мс): окно живого шага или
 * отлучка от последней записи партии до входа. Вид вести выбирает кость партии (`pickEvent`),
 * срок — сутки от минуты прихода, и лишнее сгоняется тем же правилом стола.
 *
 * **Глубже срока в сутки окно не заходит** (`EVENT_TTL`): весть, пришедшая раньше,
 * истекла бы, не показавшись ни разу, и её молчание было бы последствием, которого
 * игрок не видел. Граница того же рода, что у догона хозяйства (`MAX_OFFLINE_DAYS`):
 * время сверх того, что игра показывает, не играется. Вести, лежавшие на столе до
 * отлучки, истекают своим сроком — их игрок видел. Правила «нет вестей» тоже прежние:
 * при обучении и при ропоте их нет. **При ропоте не идёт и шаг почты внутри отлучки** — на этом
 * стоит единственное исключение из «зреет по времени»: срок ответа на мятеж, созревший без
 * игрока, начинается с его входа, а не с минуты, когда мятеж лёг на стол. Возвращает, сколько вестей пришло.
 */
export function mailArrive(s: GameState, from: number, now: number): number {
  if (!s.tutorialDone && s.time < TUTORIAL_EVENT_MUTE) return 0;
  if (s.unrest > 0) return 0;
  // Мятеж податных или голодных — то же исключение, что ропот: срок ответа на него начинается с входа игрока.
  if (s.inbox.some((e) => STAB_EVENTS.includes(e.defId))) return 0;
  const start = Math.max(from, now - EVENT_TTL);
  let n = chainsArrive(s, start, now);
  for (let k = Math.floor((start - AWAY_JITTER) / AWAY_STEP); ; k++) {
    const t = awayArrival(s.seed, k);
    if (t > now) break;
    if (t <= start) continue;
    // До прихода — то, что истекло к его минуте, уходит своим молчанием.
    mailStep(s, t);
    const e = pickEvent(s);
    if (!e || !raiseEvent(s, e.id)) continue;
    s.inbox[s.inbox.length - 1].until = t + EVENT_TTL;
    n++;
  }
  return n;
}


/**
 * Следствия ответов, чей час пришёл (`GameState.chains`, кладёт их `sim/chains.scheduleChain`; docs/events.md, раздел 4).
 * Ложатся на стол тем же правилом, что весть по сетке (`raiseEvent`): лишнее сгоняет ближний срок, того же вида второй
 * раз не кладут — тогда следствие ждёт следующего окна, а не пропадает. Срок ответа — сутки от минуты, когда следствие
 * созрело, если она лежит в окне; созревшее раньше окна (долгая отлучка) приходит с минутой входа: это следствие
 * ответа самого игрока, и решиться молча, не показавшись, оно не должно. Вид, которого в игре больше нет, уходит
 * из партии молча. Возвращает, сколько легло.
 */
function chainsArrive(s: GameState, start: number, now: number): number {
  if (!s.chains?.length) return 0;
  let n = 0;
  for (const c of [...s.chains]) {
    if (c.at > s.time) continue;
    if (!EVENT_BY_ID[c.defId]) {
      s.chains = s.chains.filter((x) => x !== c);
      continue;
    }
    if (!raiseEvent(s, c.defId)) continue;
    s.chains = s.chains.filter((x) => x !== c);
    const due = now - realMs(s.time - c.at);
    s.inbox[s.inbox.length - 1].until = (due > start ? due : now) + EVENT_TTL;
    n++;
  }
  return n;
}
