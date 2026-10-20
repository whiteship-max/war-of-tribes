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
import { EVENT_BY_ID, eventBlock, eventCost, eventFrom, eventText, optionHint } from '@/game/data/events';
import { eventId, eventLeft } from '@/game/sim/mail';
import type { ActiveEvent } from '@/game/types';
import type { LetterView, RivalMail, RivalMarch } from '@/world/types';
import { answerBlock, endWords, PROPOSALS, proposalOpen, proposalText, proposalTitle, type ProposalView } from '@/world/proposals';
import type { Price } from '@/ui/parts/Cost';
import { dealKey, eventKey, letterKey, rivalWarKey } from './unread';
import { realDue } from '@/ui/parts/wait';
import type { IconName } from '@/ui/icons/alias';
import { iconName } from '@/ui/icons/registry';

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
  /** Ключ в почте: у события — вид и минута прихода, у письма — его номер, у соседа — номер предложения или войны. */
  key: string;
  /** Откуда: событие партии, письмо мира или сосед-игрок с сервера войны (ДП-1: предложения и походы на нас). */
  source: 'event' | 'letter' | 'rival';
  /** Номер письма у письма, имя события на столе у события (`sim/mail.eventId`). */
  letterId: string | null;
  eventId: string | null;
  /** Значок донесения (набор ЗН-1). */
  iconName: IconName;
  title: string;
  /** Кто прислал: у письма — сосед или логово, у события — человек города, который о нём пишет (`EventDef.from`). */
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
  /**
   * Беда: идёт само и сроком беды — набег и осада у письма, предупреждение без выбора, событие со своим словом о сроке
   * (мятеж: `EventDef.waits`). В «Вестях» — группой «Беда» первой и сроком красным (UI-7, docs/ui_v2.md, 5.6).
   */
  urgent: boolean;
  /** Номер предложения соседа (ДП-1): по нему отвечает почта. Нет — не предложение. */
  dealId?: string;
  /**
   * Группа «Вестей», если не та, что по беде (`mailGroups`): своё предложение, ждущее ответа соседа (`sent`), или итог к
   * сведению (`done`, ДП-1).
   */
  group?: MailGroupId;
  /** Ответы — кнопками прямо в строке списка, а не только в карточке (ДП-1: принять и отклонить предложение соседа). */
  quick?: boolean;
  /** Идут на нас: в карточке — «На карту» и «Дружина», как у набега. */
  march?: boolean;
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
    iconName: iconName('evt', def.id),
    title: def.title,
    from: eventFrom(def, s),
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
    urgent: def.waits !== undefined,
  };
}

/** Письмо мира — донесением. Всё уже посчитано миром; здесь только перекладка. */
export function letterDispatch(l: LetterView, now: number): Dispatch {
  return {
    key: letterKey(l.id),
    source: 'letter',
    letterId: l.id,
    eventId: null,
    iconName: iconName('letter', l.kind),
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
    urgent: l.kind === 'raid' || l.kind === 'siege' || l.choices.length === 0,
  };
}

/** Что вариант ответа на предложение даст — словами стороны. */
const ACT_HINT = {
  no: 'Союза не будет. Сосед узнает об отказе.',
  withdraw: 'Предложение снимется. Сосед узнает.',
} as const;

/**
 * Предложение соседа — донесением (ДП-1). Ждущее ответа нам — «Ждут ответа» с «Принять» и «Отклонить» прямо в строке;
 * своё — «Ждём ответа» с «Отозвать»; закрытое — «К сведению», итогом словами стороны (`world/proposals.endWords`). Кнопка
 * гаснет той же проверкой, по которой откажет сервер (`answerBlock`).
 */
export function proposalDispatch(p: ProposalView, now: number): Dispatch {
  const open = proposalOpen(p, now);
  const def = PROPOSALS[p.kind];
  const act = (id: 'yes' | 'no' | 'withdraw', label: string, hint: string): DispatchChoice => ({ id, label, hint, cost: {}, block: answerBlock(p, id, now) });
  const choices = !open ? [] : p.side === 'in' ? [act('yes', 'Принять', def.gives), act('no', 'Отклонить', ACT_HINT.no)] : [act('withdraw', 'Отозвать', ACT_HINT.withdraw)];
  return {
    key: dealKey(p.id),
    source: 'rival',
    letterId: null,
    eventId: null,
    dealId: p.id,
    iconName: 'deal-alliance',
    title: open && p.side === 'out' ? `Ждём ответа: «${p.city}»` : proposalTitle(p),
    from: p.city,
    text: open ? proposalText(p) : endWords(p),
    cost: {},
    choices,
    left: open ? Math.max(0, (p.until - now) / 1000) : null,
    leftText: p.side === 'in' ? 'Ждёт ответа' : 'Ждём ответа',
    silence: !open ? '' : p.side === 'in' ? `Без ответа: срок выйдет, ${def.name.toLowerCase()} не будет. Сосед узнает.` : 'Без ответа: срок выйдет, предложение снимется.',
    warning: false,
    urgent: false,
    group: !open ? 'done' : p.side === 'in' ? 'wait' : 'sent',
    quick: open && p.side === 'in',
  };
}

/** Поход соседа на наш город — бедой (ДП-1): выбора нет, решается на стенах и на карте, как набег. */
export function marchDispatch(m: RivalMarch, now: number): Dispatch {
  return {
    key: rivalWarKey(m.id),
    source: 'rival',
    letterId: null,
    eventId: null,
    iconName: 'hud-army',
    title: `На нас идёт «${m.city}»`,
    from: m.city,
    text: `Из «${m.city}» вышел отряд на наш город — ${m.mode === 'storm' ? 'на штурм: ударят с ходу' : 'осадой: встанут лагерем у ворот'}. Успей поставить людей на стены.`,
    cost: {},
    choices: [],
    left: Math.max(0, (m.arriveAt - now) / 1000),
    leftText: 'До прихода',
    silence: 'Решается не здесь: гарнизон — в «Дружине», встретить в поле — на карте.',
    warning: true,
    urgent: true,
    march: true,
  };
}

/** Соседи-игроки — донесениями (ДП-1): походы на нас и предложения. */
export const rivalDispatches = (r: RivalMail, now: number): Dispatch[] => [
  ...r.marching.map((m) => marchDispatch(m, now)),
  ...r.proposals.map((p) => proposalDispatch(p, now)),
];

/**
 * Вся почта одним списком. Первым лежит то, что раньше всего разрешится само, —
 * правило стола писем (`world/letters.letterOrder`), распространённое на всю
 * почту: мерится срок, а не возраст.
 */
export function dispatches(s: GameState, letters: LetterView[], now: { tribe: number; world: number }, rivals?: RivalMail): Dispatch[] {
  // Часов двое, как и хозяев: срок события ставила партия по своим (`partyNow`), срок
  // письма — мир по своим (`worldNow`). Каждый срок читается своими часами; срок соседа — сервер войны, часы мира.
  const list = letters.map((l) => letterDispatch(l, now.world));
  if (rivals) list.push(...rivalDispatches(rivals, now.world));
  for (const ev of s.inbox) {
    const d = eventDispatch(s, ev, now.tribe);
    if (d) list.push(d);
  }
  return list.sort((a, b) => (a.left ?? Infinity) - (b.left ?? Infinity));
}

/** Срок словами: часы с минутами, пока их больше часа, потом минуты с секундами. */
export const leftWords = realDue;

/** Фильтр «Вестей»: все, вести города (события партии) или письма соседей и логов (мира). */
export type MailFilter = 'all' | 'event' | 'letter';

/** Вести под фильтром — по источнику; «Соседи» — письма мира и соседи-игроки. Порядок — тот же, сроком. */
export const filterMail = (list: readonly Dispatch[], f: MailFilter): Dispatch[] =>
  f === 'all' ? [...list] : list.filter((d) => d.source === f || (f === 'letter' && d.source === 'rival'));

/** Группы «Вестей»: беда, ждут нашего ответа, ждём ответа соседа, к сведению (ДП-1). */
export type MailGroupId = 'urgent' | 'wait' | 'sent' | 'done';

const GROUP_TITLES: Record<MailGroupId, string> = { urgent: 'Беда', wait: 'Ждут ответа', sent: 'Ждём ответа', done: 'К сведению' };

/** Группа вести: своя (`Dispatch.group`) или по беде. */
export const groupOf = (d: Dispatch): MailGroupId => d.group ?? (d.urgent ? 'urgent' : 'wait');

/** Группы списка: сначала беда, потом то, что ждёт ответа, своё ждущее и итоги; пустая группа не рисуется. */
export function mailGroups(list: readonly Dispatch[]): { id: MailGroupId; title: string; items: Dispatch[] }[] {
  return (Object.keys(GROUP_TITLES) as MailGroupId[])
    .map((id) => ({ id, title: GROUP_TITLES[id], items: list.filter((d) => groupOf(d) === id) }))
    .filter((g) => g.items.length > 0);
}
