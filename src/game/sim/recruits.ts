// Кандидаты в агенты (АГ-1, docs/city_v3.md, «Решения АГ-1») — кто просится на место и найм по окну. Едет докачкой с окном
// Ратуши (и с отчётами): первой загрузке он не нужен — шаг партии читает только нанятых (`sim/agents`, `sim/recruit`).
//
// **Кандидаты выводятся, а не хранятся** — тем же механизмом, что просители совета (`sim/candidates`): список места — чистая
// функция сида партии, окна (сезона) и места в списке (`agentrules.recruitAt`); ратуша выше — лучше ступень и длиннее список
// (`councilrules.councilTier`, `candidateCount`). Кого из окна уже взяли, помнит книга найма (`RecruitState.took`). Посадить на
// место — одна дверь записи `sim/recruit.seatRecruit`; здесь только выбор, проверка и плата.
import type { FigureId } from '@/world/types';
import type { FaithId, GameState } from '../types';
import type { Placed } from '@/world/shelter';
import { AGENT_ROLES, recruitAdvance, recruitAt, recruitId, recruitNameIndex, recruitWage, type Recruit } from '../agentrules';
import { candidateCount, councilTier, windowEnd, windowOf } from '../councilrules';
import { AGENT_EPITHETS, AGENT_NAMES, recruitName } from '../data/names';
import { HIRE_GOLD_PER_POP } from '../data/hire';
import { hallLevel, population } from '../derived';
import { FIGURE_BY_ID } from '@/world/data/figures';
import { cityName } from '../../../netlify/lib/contract';
import { livingNames } from './dynasty';
import { placeBlock } from './tech';
import { replaceBlock, seatRecruit, takenIn } from './recruit';
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

/** Нанять кандидата `n`: плата из казны — разовая трата описи (`sim/pay.outlay`), посадка — `recruit.seatRecruit`. */
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
