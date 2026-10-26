// Книга командиров флангов (ДР-3, docs/siege_v2.md, «Решения ДР-3»; правило «command» — docs/security.md, раздел 1;
// docs/trust-boundary.md).
//
// Сервер хранит, а не судит: партию он не разбирает. Опись называет, кто на местах левого и правого фланга — номер кандидата
// «Командующих», ступень Казарм и минуту найма, — а книга подтверждает не больше, чем объясняют правила:
// - **кандидат — пересчётом по сиду** (сид — книги агентов, АГ-1): род, уровень, тактику и черты сервер выводит сам
//   (`commandrules.commanderAt`) — в описи их нет вовсе. Кандидат не из окна своего найма, не со своего места в списке, со
//   ступенью выше той, что дают Казармы книги стройки, один человек на двух флангах, минута найма позже часов партии или
//   командир старше своего покоя — флаг, и место считается пустым;
// - **в войну — числа книги, а не клиента** (`commandAt`): тактику флангов приказ не несёт, её ставит сервер; лорда, который
//   бьётся хуже пустого места, опись спрятать не может — в войну идёт подтверждённое, а не названное;
// - **в лояльность знати — слагаемое книги** (`commandAt().lead`): указ рыцарства сервер меряет им (`watch.estateCeilOf`).
//
// Сида нет (опись до АГ-1) — кандидатов сервер не выводит, и книга мест не подтверждает: командиров в войне нет.
import type { WatchCard } from './contract.js';
import type { Flank } from '../../src/game/types.js';
import type { Flanks } from '../../src/battle/types.js';
import {
  FLANKS,
  commandRetired,
  commandTier,
  commanderAt,
  commanderFault,
  flanksFrom,
  isFlank,
  leadLoyalty,
  type Birth,
  type Commander,
} from '../../src/game/commandrules.js';
import { windowOf } from '../../src/game/councilrules.js';

/** Подтверждённый командир на месте фланга: номер кандидата, ступень и минута найма. */
export interface CommandSeatBook {
  n: number;
  tier: number;
  at: number;
}

/** Книга командиров игрока: минута последней записи и подтверждённые места. */
export interface CommandBook {
  at: number;
  seats: Partial<Record<Flank, CommandSeatBook>>;
}

/** Кандидат подтверждённого места; сида нет или места нет — `null`. */
export const commanderOfSeat = (seed: number | undefined, seat: CommandSeatBook | undefined): Commander | null =>
  seed === undefined || !seat ? null : commanderAt(seed, seat.n, seat.tier);

/**
 * Почему место описи не по правилам; `null` — по правилам. `cap` — ступень, которую дают Казармы книги стройки, `time` — часы
 * партии описи.
 */
function seatFault(seed: number, n: number, tier: number, at: number, cap: number, time: number): string | null {
  const why = commanderFault(n, windowOf(at), tier);
  if (why) return why;
  if (tier > cap) return `кандидат ступени ${tier} при Казармах, что дают не выше ${cap}`;
  if (at > time + 1e-6) return `нанят в ${Math.floor(at)} с, а часы партии — ${Math.floor(time)} с`;
  if (commandRetired(commanderAt(seed, n, tier), at, time)) return `кандидат №${n} старше своего покоя`;
  return null;
}

/**
 * Книга после описи `card` в минуту `at`: подтверждённые места. `seed` — сид партии книги агентов, `barracks` — уровень Казарм
 * книги стройки (ступень найма не выше её). Прежнее место того же кандидата не пересматривается, кроме покоя: его ступень
 * проверена в минуту найма, а Казармы с тех пор могли упасть. Возвращает книгу и строки нарушений для флага «command».
 */
export function commandStep(prev: CommandBook | undefined, card: WatchCard, at: number, seed: number | undefined, barracks: number): { book: CommandBook; found: string[] } {
  const found: string[] = [];
  const book: CommandBook = { at, seats: {} };
  const x = card.command;
  if (!x || seed === undefined) return { book, found };
  const cap = commandTier(barracks);
  const time = Math.max(0, card.time ?? 0);
  const used = new Set<number>();
  for (const s of x.seats) {
    if (!isFlank(s.flank)) {
      found.push(`места «${s.flank}» нет`);
      continue;
    }
    const f = s.flank;
    if (book.seats[f]) {
      found.push(`на месте «${f}» двое`);
      continue;
    }
    if (used.has(s.n)) {
      found.push(`кандидат №${s.n} на двух флангах`);
      continue;
    }
    used.add(s.n);
    const old = prev?.seats[f];
    const same = old !== undefined && old.n === s.n && old.tier === s.tier && old.at === s.at;
    const why = same
      ? commandRetired(commanderAt(seed, s.n, s.tier), s.at, time)
        ? `кандидат №${s.n} старше своего покоя`
        : null
      : seatFault(seed, s.n, s.tier, s.at, cap, time);
    if (why) {
      found.push(`${f}: ${why}; место считается пустым`);
      continue;
    }
    book.seats[f] = { n: s.n, tier: s.tier, at: s.at };
  }
  return { book, found };
}

/** Что подтверждённые командиры кладут в войну и в знать — числа, которые сервер считает сам. */
export interface CommandAt {
  /** Тактика флангов в отметках со знаком (`ArmySetup.flanks`); командиров нет — пусто. */
  flanks: Flanks;
  /** Слагаемое лояльности рыцарства (`commandrules.leadLoyalty`). */
  lead: number;
}

/** Числа подтверждённой книги: тактика мест и слагаемое знати. Книги или сида нет — пусто и ноль. */
export function commandAt(book: CommandBook | undefined, seed: number | undefined): CommandAt {
  const tactics: Partial<Record<Flank, number>> = {};
  const births: Birth[] = [];
  for (const f of FLANKS) {
    const c = commanderOfSeat(seed, book?.seats[f]);
    if (!c) continue;
    tactics[f] = c.tactics;
    births.push(c.birth);
  }
  return { flanks: flanksFrom(tactics), lead: leadLoyalty(births) };
}

/**
 * Слагаемое знати по описи — для потолка лояльности рыцарства (указ рыцарства, `watch.estateCeilOf`, `estateFaults`): места
 * описи, которые по номеру — кандидаты своего окна и места в списке, без ступени Казарм и покоя. Это потолок, а не правда:
 * Казармы могли упасть после найма, и строже его не судят, чтобы честный указ не лёг флагом; спрятанный безродный поднимает
 * потолок, но и тактики его в войне нет — книга его не знает. Сида или мест нет — ноль.
 */
export function claimedLead(card: WatchCard): number {
  const seed = card.seed;
  const x = card.command;
  if (!x || seed === undefined) return 0;
  const births: Birth[] = [];
  const flanks = new Set<string>();
  const used = new Set<number>();
  for (const s of x.seats) {
    if (!isFlank(s.flank) || flanks.has(s.flank) || used.has(s.n) || commanderFault(s.n, windowOf(s.at), s.tier)) continue;
    flanks.add(s.flank);
    used.add(s.n);
    births.push(commanderAt(seed, s.n, s.tier).birth);
  }
  return leadLoyalty(births);
}

/** Книга из записи наблюдения — каждое поле с проверкой; не такая — `undefined`. */
export function readCommandBook(v: unknown): CommandBook | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const seats: CommandBook['seats'] = {};
  const raw = r.seats && typeof r.seats === 'object' ? (r.seats as Record<string, unknown>) : {};
  for (const [f, x] of Object.entries(raw)) {
    if (!isFlank(f) || !x || typeof x !== 'object') continue;
    const a = x as Record<string, unknown>;
    if (!Number.isInteger(a.n) || (a.n as number) < 0 || !Number.isInteger(a.tier) || !fin(a.at)) continue;
    seats[f] = { n: a.n as number, tier: a.tier as number, at: a.at };
  }
  return { at: fin(r.at) ? r.at : 0, seats };
}
