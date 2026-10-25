// Книга агентов (АГ-1, docs/city_v3.md, «Решения АГ-1»; правило «agents» — docs/security.md, раздел 1; docs/trust-boundary.md).
//
// Сервер хранит, а не судит: партию он не разбирает. Опись называет, кто на местах агентов — номер человека, из какого кандидата
// Ратуши (номер и ступень найма) и опыт, — а книга подтверждает не больше, чем объясняют правила:
// - **кандидат — пересчётом по сиду**: сид партии книга берёт из первой описи и держит; врождённое и черты нанятого сервер
//   выводит сам (`agentrules.recruitAt`) — в описи их нет вовсе. Кандидат не своего места, не из окна своего найма или со
//   ступенью выше той, что даёт ратуша книги стройки, — флаг, и человек считается ровным;
// - **опыт — не быстрее дел**: дело засчитывается не чаще `DEED_GAP` (`sim/agents.recordDeed`), поэтому между описями опыт
//   растёт не больше чем на столько дел, сколько уместилось во время, с запасом в одно; сверх — флаг и потолок;
// - **дела агента в войне — по своим числам** (`agentsAt`): отметки полководца, скрытность и диверсия лазутчика, красноречие
//   дипломата сервер считает из подтверждённого человека, а не из слепка клиента.
//
// Сида нет (опись до АГ-1) — кандидатов сервер не выводит, и в войну идут прежние потолки правил (`book.rulePips`,
// `town.ruleWatch`): врождённое — фора на той же лестнице, поэтому прежний потолок и есть потолок лучшего кандидата, и опись
// без сида выгоды не даёт.
import type { WatchAgent, WatchCard } from './contract.js';
import type { FigureId } from '../../src/world/types.js';
import type { Pips } from '../../src/battle/types.js';
import {
  deedXp,
  eloquenceCut,
  fixedCircles,
  isRole,
  pipsSpread,
  recruitAt,
  roleOfRecruit,
  sabotagePower,
  skillCircles,
  temperKey,
  traditionAt,
  windowOfRecruit,
  type Recruit,
} from '../../src/game/agentrules.js';
import { MAX_ADVISOR_LEVEL, councilTier, windowOf } from '../../src/game/councilrules.js';
import { DEED_GAP, MAX_AGENT_LEVEL, STEALTH_PER_CIRCLE, XP_CAP, levelOf } from '../../src/game/data/agents.js';
import { BUILDING_BY_ID } from '../../src/game/data/buildings.js';
import { MAX_BUILDING_LEVEL } from '../../src/game/constants.js';
import { realMs } from '../../src/game/pace.js';
import { veilAt } from '../../src/world/peril.js';

/** Подтверждённый человек на месте. */
export interface AgentSeat {
  person: number;
  /** Номер кандидата и ступень — только у подтверждённого найма из Ратуши; нет — ровный. */
  n?: number;
  tier?: number;
  /** Подтверждённый опыт. */
  xp: number;
  vacant?: true;
}

/** Книга агентов игрока: сид партии (первый увиденный), минута последней записи и подтверждённые места. */
export interface AgentBook {
  seed?: number;
  at: number;
  seats: Partial<Record<FigureId, AgentSeat>>;
}

/** Кандидат подтверждённого найма; ровный или сид неизвестен — `null`. */
export function recruitOfSeat(book: AgentBook | undefined, seat: AgentSeat | undefined): Recruit | null {
  if (!book || book.seed === undefined || !seat || seat.vacant || seat.n === undefined || seat.tier === undefined) return null;
  return recruitAt(book.seed, seat.n, seat.tier);
}

/**
 * Сколько опыта мог набрать человек за `ms` настоящего времени: дел — сколько уместилось в `DEED_GAP`, и ещё одно (дело на
 * границе), каждое — удача с его чертами (`agentrules.deedXp`).
 */
export const xpGain = (ms: number, traits: Recruit['traits'] = []): number =>
  (Math.floor(Math.max(0, ms) / DEED_GAP) + 1) * deedXp(true, traits);

/** Почему метка найма не по правилам; `null` — по правилам. */
function markFault(role: FigureId, a: WatchAgent, tierCap: number): string | null {
  if (a.n === undefined) return null;
  if (roleOfRecruit(a.n) !== role) return `кандидат №${a.n} просился не на это место`;
  if (a.at === undefined || windowOfRecruit(a.n) !== windowOf(a.at)) return `кандидат №${a.n} не из окна своего найма`;
  if (a.tier === undefined || a.tier < 1 || a.tier > MAX_ADVISOR_LEVEL) return `ступень найма ${a.tier ?? '—'} вне 1…${MAX_ADVISOR_LEVEL}`;
  if (a.tier > tierCap) return `кандидат ступени ${a.tier} при ратуше, что даёт не выше ${tierCap}`;
  return null;
}

/**
 * Книга после описи `card` в минуту `at`: сид, люди на местах и опыт под потолком. `hall` — уровень ратуши книги стройки (ступень
 * найма не выше её), `gameMs` — сколько часов партии прошло между описями (под скоростью проверки они бегут быстрее настоящих).
 * Возвращает книгу и строки нарушений для флага «agents».
 */
export function agentsStep(prev: AgentBook | undefined, card: WatchCard, at: number, hall: number, gameMs = 0): { book: AgentBook; found: string[] } {
  const found: string[] = [];
  const book: AgentBook = { ...(prev?.seed !== undefined ? { seed: prev.seed } : {}), at, seats: { ...(prev?.seats ?? {}) } };
  if (card.seed !== undefined) {
    if (book.seed === undefined) book.seed = card.seed;
    else if (book.seed !== card.seed) found.push(`сид партии сменился: ${book.seed} → ${card.seed}; книга держит первый`);
  }
  if (!card.agents) return { book: { ...book, at: prev?.at ?? at }, found };
  const span = Math.max(0, at - (prev?.at ?? at), gameMs);
  const tierCap = councilTier(hall);
  const roles = new Set<string>();
  for (const a of card.agents.seats) {
    if (!isRole(a.role)) {
      found.push(`места «${a.role}» нет`);
      continue;
    }
    if (roles.has(a.role)) {
      found.push(`на месте «${a.role}» двое`);
      continue;
    }
    roles.add(a.role);
    const role = a.role;
    const old = book.seats[role];
    if (old && a.person < old.person) {
      found.push(`${role}: номер человека убыл ${old.person} → ${a.person}`);
      continue;
    }
    const same = old !== undefined && a.person === old.person;
    let mark: Pick<AgentSeat, 'n' | 'tier'> = {};
    if (same) {
      if (a.n !== old.n || (a.n !== undefined && a.tier !== old.tier)) found.push(`${role}: метка найма человека №${a.person} сменилась`);
      mark = old.n !== undefined ? { n: old.n, tier: old.tier } : {};
    } else {
      const why = markFault(role, a, tierCap);
      if (why) found.push(`${role}: ${why}; человек считается ровным`);
      else if (a.n !== undefined) mark = { n: a.n, tier: a.tier };
    }
    const seat0: AgentSeat = { person: a.person, ...mark, xp: 0 };
    const traits = recruitOfSeat(book, seat0)?.traits ?? [];
    const cap = Math.min(XP_CAP, (same ? old.xp : 0) + xpGain(span, traits));
    if (a.xp > cap + 1e-9) found.push(`${role}: опыт ${a.xp}, а за ${Math.round(span / 60000)} мин дела дают не больше ${cap}`);
    book.seats[role] = { ...seat0, xp: Math.min(a.xp, cap), ...(a.vacant ? { vacant: true as const } : {}) };
  }
  return { book, found };
}

/** Часы партии между описями настоящими миллисекундами — для потолка опыта под скоростью проверки. */
export const gameMsBetween = (a: WatchCard | undefined, b: WatchCard): number => (a ? realMs(Math.max(0, b.time - a.time)) : 0);

/** Потолок Статуи — тот же, что у игры (`derived.maxLevelFor`): по нему традиция ложится на кружки полководца. */
const STATUE_MAX = Math.min(BUILDING_BY_ID.statue.maxLevel ?? MAX_BUILDING_LEVEL, MAX_BUILDING_LEVEL);

/** Что подтверждённые агенты кладут в дела войны — числа, которые сервер считает сам. Поля нет — правило прежнее. */
export interface AgentsAt {
  /** Отметки полководца: потолок по каждой (без «осады» — она своим счётом). */
  pips?: Pips;
  /** Скрытность лазутчика (доля провалов без поимки) — потолок. */
  stealth?: number;
  /** Скрытность в гибели (множитель) — пол. */
  veil?: number;
  /** Сила диверсии множителем. */
  sabotage?: number;
  /** Красноречие дипломата: на какую долю лагерь сбавляет дань. */
  eloquence?: number;
}

/**
 * Числа подтверждённых агентов для войны: уровень — по подтверждённому опыту, врождённое — пересчётом кандидата, традиция —
 * по Статуе книги стройки (`statue`). Сида нет — пусто: правило прежнее. Пустое место — у этого места пусто.
 */
export function agentsAt(book: AgentBook | undefined, statue: number): AgentsAt {
  if (!book || book.seed === undefined) return {};
  const out: AgentsAt = {};
  const seat = (role: FigureId): AgentSeat | undefined => {
    const x = book.seats[role];
    return x && !x.vacant ? x : undefined;
  };
  const headOf = (role: FigureId): Recruit['head'] => recruitOfSeat(book, seat(role))?.head ?? {};
  const general = seat('general');
  if (general) {
    const circles = Math.min(MAX_AGENT_LEVEL, skillCircles(levelOf(general.xp), headOf('general').pips ?? 0) + traditionAt(statue, STATUE_MAX));
    out.pips = pipsSpread(book.seed, temperKey(general.person, general.n ?? null), circles);
  }
  const spy = seat('spy');
  if (spy) {
    const c = skillCircles(levelOf(spy.xp), headOf('spy').stealth ?? 0);
    out.stealth = STEALTH_PER_CIRCLE * (c - 1);
    out.veil = veilAt(c);
    out.sabotage = sabotagePower(fixedCircles(headOf('spy').sabotage ?? 0));
  }
  const diplomat = seat('diplomat');
  if (diplomat) out.eloquence = eloquenceCut(skillCircles(levelOf(diplomat.xp), headOf('diplomat').eloquence ?? 0));
  return out;
}

/** Отметки слепка или приказа под потолком подтверждённого полководца: по каждой — не выше его; «осада» — как есть. */
export function capPips(claim: Pips, ceil: Pips | undefined): Pips {
  if (!ceil) return claim;
  const out: Pips = {};
  for (const [k, v] of Object.entries(claim)) {
    const n = k === 'siege' ? (v ?? 0) : Math.min(v ?? 0, ceil[k as keyof Pips] ?? 0);
    if (n > 0) out[k as keyof Pips] = n;
  }
  return out;
}

/** Книга из записи наблюдения — каждое поле с проверкой; не такая — `undefined`. */
export function readAgentBook(v: unknown): AgentBook | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
  const seats: AgentBook['seats'] = {};
  const raw = r.seats && typeof r.seats === 'object' ? (r.seats as Record<string, unknown>) : {};
  for (const [role, x] of Object.entries(raw)) {
    if (!isRole(role) || !x || typeof x !== 'object') continue;
    const a = x as Record<string, unknown>;
    if (!fin(a.person) || !fin(a.xp)) continue;
    const hired = Number.isInteger(a.n) && Number.isInteger(a.tier);
    seats[role] = {
      person: Math.max(0, Math.floor(a.person)),
      ...(hired ? { n: a.n as number, tier: a.tier as number } : {}),
      xp: Math.max(0, Math.min(XP_CAP, a.xp)),
      ...(a.vacant === true ? { vacant: true as const } : {}),
    };
  }
  return { ...(Number.isInteger(r.seed) ? { seed: r.seed as number } : {}), at: fin(r.at) ? r.at : 0, seats };
}
