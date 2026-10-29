// Книга духа дружины (ДР-1, docs/siege_v2.md, «Решения ДР-1», правило «spirit»): жалованье — полное или минимальное — по
// часам сервера, и потолок морали и дисциплины, который сервер выводит сам теми же формулами, что игра (`game/spiritrules`).
//
// Сервер партию не разбирает: опись называет режим жалованья, мораль и дисциплину и счёт уплаченного. Книга помнит, с какой
// минуты по часам сервера дружине платят названное, — смену она ставит на самую выгодную игроку минуту, какая могла быть
// (уход на минимальное — минутой новой описи, возврат полного — минутой прежней), чтобы честный не получал флага за то, что
// опись едет раз в несколько минут. Потолок — дух при лучших причинах, которых сервер не видит (память боёв, голод, терпение,
// обряд, купцы, полководец), и при тех, что подтверждает (Воевода совета, рыцари, ступень описи, казармы и Статуя книги стройки,
// жалованье книги). В войну идёт названное, но не выше потолка (`book.ruleSpirit`); выше — флаг и «внимание:».
import { STAB_MAX } from '../../src/game/stabrules.js';
import { MAX_AGENT_LEVEL } from '../../src/game/data/agents.js';
import { MAX_BUILDING_LEVEL } from '../../src/game/constants.js';
import { DESERT_SHARE } from '../../src/game/data/upkeep.js';
import { statAt } from '../../src/game/train.js';
import { gameDaysOfMs } from '../../src/game/pace.js';
import {
  GLORY_CAP,
  SPIRIT_FLOOR,
  SPIRIT_SLACK,
  SPIRIT_TOP,
  WAGE_MODES,
  payShareAt,
  spiritOfIn,
  type WageMode,
} from '../../src/game/spiritrules.js';
import { statueMorale } from '../../src/game/statuerules.js';
import type { WarSpirit, WatchCard } from './contract.js';

/** Книга духа: режим жалованья и с какой минуты сервера, с какой доли восстановления он идёт. */
export interface SpiritBook {
  mode: WageMode;
  at: number;
  from: number;
}

/** Книга из хранилища: режим из списка, числа — числами; иначе книги нет (полное, давно). */
export function readSpiritBook(v: unknown): SpiritBook | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const n = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const at = n(r.at);
  const from = n(r.from);
  if (!WAGE_MODES.includes(r.mode as WageMode) || at === null || from === null) return undefined;
  return { mode: r.mode as WageMode, at, from: Math.max(0, Math.min(1, from)) };
}

/** Доля восстановления жалованьем по книге в минуту `at`; книги нет — полная. */
export const bookShare = (book: SpiritBook | undefined, at: number): number =>
  book ? payShareAt(book.mode, book.from, Math.max(0, at - book.at)) : 1;

/**
 * Книга после новой описи: режим описи `mode` (нет — книга как была). Уход на минимальное — с минуты новой описи `at`, возврат
 * полного — с минуты прежней `prevAt` (раньше смена случиться не могла: прежняя опись назвала минимальное), — обе минуты
 * выгоднее всего игроку, и честный флага не получит.
 */
export function spiritBookAfter(book: SpiritBook | undefined, mode: WageMode | undefined, prevAt: number, at: number): SpiritBook | undefined {
  const was = book?.mode ?? 'full';
  if (!mode || mode === was) return book;
  const when = mode === 'min' ? at : Math.min(at, Math.max(book?.at ?? prevAt, prevAt));
  return { mode, at: when, from: bookShare(book, when) };
}

/** Что сервер подтверждает для потолка: ступень описи, Воевода и рыцари подтверждённые, казармы книги стройки. */
export interface SpiritKnown {
  /** Ступень стабильности описи (её сверяет правило «stab»); нет — высшая. */
  stab?: number;
  /** Стойкость подтверждённого Воеводы (`watch.councilResolve`) и рыцарей (`watch.estateCeilOf`). */
  marshal: number;
  knights: number;
  /** Уровень казарм книги стройки. */
  barracks: number;
  /** Уровень Статуи Героя книги стройки (ДР-7, `statuerules.statueMorale`). */
  statue: number;
  /** Дисциплина черт правителя по счёту описи (ПН-2, `rulerbook.claimedRuler`); нет — ноль. */
  ruler?: number;
}

/** Стойкость обряда — наибольшая по правилам (`book.RESOLVE_MAX`): обряда сервер не видит. */
export interface SpiritCeilOpts {
  rite: number;
}

/**
 * Потолок духа в минуту `at`: формулы игры (`spiritOfIn`) при лучших невидимых причинах и подтверждённых видимых; жалованье — по
 * книге. Голода, терпения и купцов — нет, память боёв — полная, полководец — высшего уровня.
 */
export function spiritCeil(book: SpiritBook | undefined, known: SpiritKnown, at: number, o: SpiritCeilOpts): WarSpirit {
  const stab = known.stab === undefined ? STAB_MAX : Math.max(-STAB_MAX, Math.min(STAB_MAX, Math.round(known.stab)));
  const v = spiritOfIn({
    stab,
    patience: 0,
    unfed: 0,
    glory: GLORY_CAP,
    rite: o.rite,
    marshal: Math.max(0, known.marshal),
    knights: Math.max(0, known.knights),
    merchants: 0,
    general: MAX_AGENT_LEVEL,
    barracks: Math.max(0, Math.min(MAX_BUILDING_LEVEL, known.barracks)),
    statue: statueMorale(known.statue),
    pay: bookShare(book, at),
    ruler: known.ruler ?? 0,
  });
  return { morale: v.morale.value, discipline: v.discipline.value };
}

/** Терпение дружины у лучшей Статуи и до ухода всех: дольше без единой монеты дружина с духом не стоит. */
export const SPIRIT_GRACE_DAYS = statAt('statue', 'loyalty', MAX_BUILDING_LEVEL) + 1 / DESERT_SHARE;

const one = (n: number): string => (Math.round(n * 10) / 10).toString().replace('.', ',');

/**
 * Сверка описи с книгой духа (правило «spirit»): шкалы — в пределах 0…100 и не выше потолка книги; счёт уплаченного не убывает;
 * полное жалованье весь промежуток дольше терпения, а дружине не уплачено ничего, — дух при этом не на дне. Строки — для
 * журнала города; книгу и опись правило не трогает.
 */
export function spiritFaults(a: WatchCard | undefined, aAt: number, b: WatchCard, bAt: number, ceil: WarSpirit, troops: number): string[] {
  const x = b.spirit;
  if (!x) return [];
  const out: string[] = [];
  for (const [what, v, top] of [
    ['мораль', x.morale, ceil.morale],
    ['дисциплина', x.discipline, ceil.discipline],
  ] as const) {
    if (v < SPIRIT_FLOOR || v > SPIRIT_TOP) out.push(`Дух дружины: ${what} ${one(v)} — вне шкалы ${SPIRIT_FLOOR}…${SPIRIT_TOP}.`);
    else if (v > top + SPIRIT_SLACK) out.push(`Дух дружины: ${what} ${one(v)}, а по книге духа сервера — не выше ${one(top)} (жалованье, совет, казармы).`);
  }
  const y = a?.spirit;
  if (!y) return out;
  if (x.paid < y.paid) out.push(`Счёт жалованья дружине убыл: ${y.paid} → ${x.paid}.`);
  const days = gameDaysOfMs(Math.max(0, bAt - aAt));
  if (x.wage === 'full' && y.wage === 'full' && troops > 0 && days > SPIRIT_GRACE_DAYS && x.paid <= y.paid) {
    const high = Math.max(x.morale, x.discipline);
    if (high > SPIRIT_FLOOR + SPIRIT_SLACK) {
      out.push(`Дух дружины: полное жалованье ${one(days)} игр. дн., а дружине не уплачено ничего — дух должен быть на дне, а он ${one(high)}.`);
    }
  }
  return out;
}
