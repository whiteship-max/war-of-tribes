// Донесение — общий вид всего, что приходит игроку и ждёт ответа (docs/realm.md,
// раздел 2.5; разбор — раздел 8).
//
// Источников два, и они не сливаются в одно хранилище нарочно: событие племени
// лежит в партии (`GameState.inbox`), письмо — в сохранении мира
// (`WorldSave.letters`). Это два сохранения с двумя версиями, и переносить одно
// в другое ради списка значило бы править формат обоих. Сводится не хранение, а
// **вид**: заголовок, текст, варианты с ценой и тем, что они дадут, срок и то,
// что случится без ответа. Экран почты рисует только донесение и не знает,
// откуда оно пришло; отвечает он одной дверью (`answerDispatch`), которая
// отдаёт ответ хозяину.
//
// Молчание здесь не считается — оно приходит от хозяина готовым: у письма его
// называет мир (`LetterView.silence`), у события — само событие
// (`EventDef.silence`). Своего правила «что будет без ответа» у почты нет.
import type { GameState } from '@/game/types';
import { EVENT_BY_ID, eventBlock, eventCost, eventText, optionHint } from '@/game/data/events';
import { eventId, eventLeft } from '@/game/sim/mail';
import type { ActiveEvent } from '@/game/types';
import type { LetterView } from '@/world/types';
import type { Price } from '@/ui/parts/Cost';
import { eventKey, letterKey } from './unread';
import { realDue } from '@/ui/parts/wait';

export interface DispatchChoice {
  /** Номер варианта у события, «yes» / «no» у письма. */
  id: string;
  label: string;
  /** Что это даст. */
  hint: string | null;
  /** Что вариант просит отдать. Пусто — ничего. */
  cost: Price;
  /** Почему нельзя. null — можно. */
  block: string | null;
}

export interface Dispatch {
  /** Ключ в почте: у события — вид и минута прихода, у письма — его номер. */
  key: string;
  source: 'event' | 'letter';
  /** Номер письма у письма, имя события на столе у события (`sim/mail.eventId`). */
  letterId: string | null;
  eventId: string | null;
  /** Имя значка и запасной эмодзи. */
  iconName: string;
  icon: string;
  title: string;
  /** Кто прислал. У события — никто: оно случилось в своём посёлке. */
  from: string | null;
  text: string;
  /** Что просят одним числом на всё донесение (дань, выкуп). */
  cost: Price;
  choices: DispatchChoice[];
  /** Сколько секунд ещё ждёт. null — срок ещё не поставлен. */
  left: number | null;
  /** Чем назван срок: «гонец ждёт ответа», «до набега», «ждёт ответа». */
  leftText: string;
  /** Что случится без ответа — словами хозяина донесения. */
  silence: string;
  /** Предупреждение: выбора нет, решается на карте. */
  warning: boolean;
}

/** Событие племени, ждущее ответа, — донесением. null — вид события неизвестен. */
export function eventDispatch(s: GameState, ev: ActiveEvent, now: number): Dispatch | null {
  const def = EVENT_BY_ID[ev.defId];
  if (!def) return null;
  const quiet = def.options[def.silence];
  const quietHint = optionHint(quiet, s);
  return {
    key: eventKey(ev),
    source: 'event',
    letterId: null,
    eventId: eventId(ev),
    iconName: `evt-${def.id}`,
    icon: def.icon,
    title: def.title,
    from: null,
    text: eventText(def, s),
    cost: {},
    choices: def.options.map((o, i) => ({
      id: String(i),
      label: o.label,
      hint: optionHint(o, s) ?? null,
      cost: eventCost(o, s),
      block: eventBlock(o, s),
    })),
    left: eventLeft(ev, now),
    // Срок у почты один; мятеж подписывает его своими словами — что случится без ответа.
    leftText: def.waits ?? 'Ждёт ответа',
    silence: `Без ответа: ${quiet.label.toLowerCase()}${quietHint ? `. ${quietHint}` : ''}.`,
    warning: false,
  };
}

/** Письмо мира — донесением. Всё уже посчитано миром; здесь только перекладка. */
export function letterDispatch(l: LetterView, now: number): Dispatch {
  return {
    key: letterKey(l.id),
    source: 'letter',
    letterId: l.id,
    eventId: null,
    iconName: `letter-${l.kind}`,
    icon: l.icon,
    title: l.title,
    from: l.fromName,
    text: l.body,
    cost: l.cost,
    choices: l.choices.map((c) => ({ id: c.id, label: c.label, hint: c.hint, cost: {}, block: c.can ? null : c.reason })),
    // Считается от срока, а не берётся готовым: `seconds` снят в минуту чтения
    // стола, и замерший счётчик читался бы как сломанный экран.
    left: Math.max(0, (l.until - now) / 1000),
    // У решения ждёт гонец, у предупреждения идёт отряд. Одна строка на оба
    // случая врала бы в одном из них.
    leftText: l.kind === 'raid' ? 'До набега' : 'Гонец ждёт ответа',
    silence: l.silence,
    warning: l.choices.length === 0,
  };
}

/**
 * Вся почта одним списком. Первым лежит то, что раньше всего разрешится само, —
 * правило стола писем (`world/letters.letterOrder`), распространённое на всю
 * почту: мерится срок, а не возраст.
 */
export function dispatches(s: GameState, letters: LetterView[], now: { tribe: number; world: number }): Dispatch[] {
  // Часов двое, как и хозяев: срок события ставила партия по своим (`partyNow`), срок
  // письма — мир по своим (`worldNow`). Каждый срок читается своими часами.
  const list = letters.map((l) => letterDispatch(l, now.world));
  for (const ev of s.inbox) {
    const d = eventDispatch(s, ev, now.tribe);
    if (d) list.push(d);
  }
  return list.sort((a, b) => (a.left ?? Infinity) - (b.left ?? Infinity));
}

/** Срок словами: часы с минутами, пока их больше часа, потом минуты с секундами. */
export const leftWords = realDue;
