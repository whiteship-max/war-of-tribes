// Кандидаты в агенты (АГ-1, docs/city_v3.md, «Решения АГ-1») — кто просится на место и найм по окну. Едет докачкой с окном
// Ратуши (и с отчётами): первой загрузке он не нужен — шаг партии читает только нанятых (`sim/agents`, `sim/recruit`).
//
// **Кандидаты выводятся, а не хранятся** — тем же механизмом, что просители совета (`sim/candidates`): список места — чистая
// функция сида партии, окна (сезона) и места в списке (`agentrules.recruitAt`); ратуша выше — лучше ступень и длиннее список
// (`councilrules.councilTier`, `candidateCount`). Кого из окна уже взяли, помнит книга найма (`RecruitState.took`). Посадить на
// место — `seatRecruit` (книга найма — дверью `sim/recruit.bookHire`, человек — `sim/agents.seat`); смена и увольнение — только дома
// (у своих ворот или в городе, `world/shelter.canRegear`): человек в деле его заканчивает.
import type { FigureId } from '@/world/types';
import type { FaithId, GameState } from '../types';
import { AGENT_ROLES, recruitAdvance, recruitAt, recruitId, recruitNameIndex, recruitWage, type Recruit } from '../agentrules';
import { candidateCount, councilTier, windowEnd, windowOf } from '../councilrules';
import { AGENT_EPITHETS, AGENT_NAMES, recruitName } from '../data/names';
import { HIRE_GOLD_PER_POP } from '../data/hire';
import { hallLevel, population } from '../derived';
import { FIGURE_BY_ID } from '@/world/data/figures';
import { cityName } from '../../../netlify/lib/contract';
import { livingNames } from './dynasty';
import { placeBlock } from './tech';
import { bookHire, takenIn } from './recruit';
import { release, seat, seated, titled, yearsWord } from './agents';
import { log } from './log';
import { RECRUIT_LOG } from '../data/agentWords';
import { canRegear, type Placed } from '@/world/shelter';
import { outlay } from './pay';

/** Кандидат в листе: всё, что о нём известно до найма, — теми же формулами, что лягут в найм (`agentrules`). */
export interface RecruitView extends Recruit {
  name: string;
  /** Ступень совета, при которой он выведен (метка найма `cand.tier`). */
  tier: number;
  /** Жалованье за игровой день. */
  wage: number;
  /** Жалованье за сезон вперёд (бережливый — ноль). */
  advance: number;
  /** Плата за найм целиком: прежняя плата по числу ртов и жалованье вперёд. */
  price: number;
}

/** Имя кандидата без тёзок среди живых (дом, агенты, совет): шагает дальше по перестановке, как дом правителя. */
function freeName(s: GameState, role: FigureId, faith: FaithId, n: number, taken: ReadonlySet<string>): string {
  const span = AGENT_NAMES[faith].length * AGENT_EPITHETS.length;
  const pick = (i: number): string => cityName(recruitName(s.seed, i, faith)) ?? FIGURE_BY_ID[role].name;
  const at = recruitNameIndex(n);
  let name = pick(at);
  for (let step = 1; step <= span && taken.has(name); step++) name = pick(at + step);
  return name;
}

/**
 * Плата за найм: прежняя плата по числу ртов (`HIRE_GOLD_PER_POP`, она же была у найма в здании — тупика нет, нанять можно
 * всегда, пока хватает золота) и жалованье за сезон вперёд, как у совета.
 */
export const basePrice = (s: GameState): number => Math.ceil(HIRE_GOLD_PER_POP * population(s));

/**
 * Кандидаты на место в нынешнем окне: столько, сколько даёт ратуша, без взятых в этом окне. Вера ещё не названа — имён взять
 * неоткуда, и кандидатов нет (их приводит та же весть мира, что называет имена агентам).
 */
export function recruitsOf(s: GameState, role: FigureId): RecruitView[] {
  const faith = s.faith?.id;
  if (!faith) return [];
  const hall = hallLevel(s);
  const tier = councilTier(hall);
  const count = candidateCount(hall);
  const w = windowOf(s.time);
  const gone = new Set(takenIn(s, w));
  const seatedN = new Set(AGENT_ROLES.map((r) => s.agents?.[r]?.cand?.n).filter((x): x is number => x !== undefined));
  const taken = new Set(livingNames(s));
  const base = basePrice(s);
  const out: RecruitView[] = [];
  for (let slot = 0; slot < count; slot++) {
    const n = recruitId(w, role, slot);
    if (gone.has(n) || seatedN.has(n)) continue;
    const r = recruitAt(s.seed, n, tier);
    const name = freeName(s, role, faith, n, taken);
    taken.add(name);
    const advance = recruitAdvance(r.level, r.traits);
    out.push({ ...r, name, tier, wage: recruitWage(r.level, r.traits), advance, price: base + advance });
  }
  return out;
}

/** Лучший кандидат: выше уровень, при равном — дешевле жалованье, при равном — первый в списке. */
export function bestRecruit(s: GameState, role: FigureId): RecruitView | null {
  let best: RecruitView | null = null;
  for (const c of recruitsOf(s, role)) if (!best || c.level > best.level || (c.level === best.level && c.wage < best.wage)) best = c;
  return best;
}

/** Через сколько игровых секунд придут новые кандидаты. */
export const nextRecruitsIn = (s: GameState): number => Math.max(0, windowEnd(windowOf(s.time)) - s.time);

/**
 * Почему нельзя нанять кандидата `n` на место; `null` — можно. Порядок — тот, в котором игрок упирается: место закрыто
 * державой, идёт прежний найм, человек на месте не дома (сменить — только дома), кандидата нет, золота нет. `where` — где стоит
 * нынешний (фигура мира); на пустое место он не нужен.
 */
export function hireBlock(s: GameState, role: FigureId, n: number, where: Placed | null | undefined): string | null {
  const closed = placeBlock(s, role);
  if (closed) return closed;
  if (s.agents?.[role]?.hiring) return 'Прежний найм ещё идёт.';
  const away = replaceBlock(s, role, where);
  if (away) return away;
  const c = recruitsOf(s, role).find((x) => x.n === n);
  if (!c) return 'Этого кандидата уже нет.';
  if (Math.floor(s.gold) < c.price) return 'Не хватает золота.';
  return null;
}

/** Готовый кандидат — то, что ложится в найм (`sim/recruits.recruitsOf`): номер, ступень, имя, возраст и плата вперёд. */
export interface Hireable {
  n: number;
  tier: number;
  name: string;
  age0: number;
  /** Жалованье за сезон вперёд — в книгу платы (сервер сверяет её с ценой кандидата). */
  advance: number;
}

/**
 * Посадить нанятого на место: прежний (если был) отставлен, номер — во взятые окна, книга сервера считает найм и плату вперёд.
 * Цена уже снята тем, кто зовёт (`sim/recruits.hireRecruit`); можно ли — решил он же (`hireBlock`).
 */
export function seatRecruit(s: GameState, role: FigureId, c: Hireable): void {
  if (seated(s, role)) log(s, RECRUIT_LOG.dismissed(titled(s, role)), 'info');
  bookHire(s, c.n, c.advance);
  seat(s, role, s.time, c.age0, c.name, { n: c.n, tier: c.tier, at: s.time });
  log(s, RECRUIT_LOG.hired(titled(s, role), yearsWord(Math.floor(c.age0))), 'good');
  // Дружина прежнего полководца осталась городу: новый приходит без неё и в поле не выйдет, пока её не соберут.
  if (role === 'general') log(s, 'Отряда при нём нет. Собери его в Статуе.', 'bad');
}

/**
 * Почему человека на месте нельзя сменить или уволить сейчас; `null` — можно. Где он, знает мир — фигура приходит готовой
 * (`FigureView`), как у переодевания (`sim/agents.regearBlock`): дома — у своих ворот или в городе; в поле, в пути и вне строя
 * он дело заканчивает.
 */
export function replaceBlock(s: GameState, role: FigureId, where: Placed | null | undefined): string | null {
  if (!seated(s, role)) return null;
  // Слова — под кнопкой (не длиннее 32 знаков, docs/ui_audit.md, 3.7): та же строка и в отказе действия.
  if (!where) return 'Ещё не встал на место.';
  if (canRegear(where)) return null;
  if (where.phase === 'down') return 'Вне строя — менять дома.';
  return where.phase === 'moving' ? 'В пути — менять дома.' : 'В поле — менять дома.';
}

/** Почему нельзя уволить; `null` — можно. */
export function dismissBlock(s: GameState, role: FigureId, where: Placed | null | undefined): string | null {
  if (!seated(s, role)) return 'Место и так пустует.';
  return replaceBlock(s, role, where);
}

/** Уволить человека с места: только дома; плата вперёд не возвращается — это не залог. */
export function dismissAgent(s: GameState, role: FigureId, where: Placed | null | undefined): string | null {
  const block = dismissBlock(s, role, where);
  if (block) return block;
  const who = titled(s, role);
  if (!release(s, role)) return 'Место и так пустует.';
  log(s, RECRUIT_LOG.dismissed(who), 'info');
  return null;
}

/** Нанять кандидата `n`: плата из казны — разовая трата описи (`sim/pay.outlay`), посадка — `seatRecruit`. */
export function hireRecruit(s: GameState, role: FigureId, n: number, where: Placed | null | undefined): string | null {
  const block = hireBlock(s, role, n, where);
  if (block) return block;
  const c = recruitsOf(s, role).find((x) => x.n === n)!;
  if (c.price > 0) {
    s.gold = Math.max(0, s.gold - c.price);
    outlay(s);
  }
  seatRecruit(s, role, { n: c.n, tier: c.tier, name: c.name, age0: c.age0, advance: c.advance });
  return null;
}
