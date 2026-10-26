// Кандидаты в командиры флангов (ДР-3, docs/siege_v2.md, «Решения ДР-3») — кто просится на место и найм по окну. Едет докачкой с
// окном «Командующие» (и с отчётами): первой загрузке он не нужен — шаг партии читает только нанятых (`sim/command`).
//
// **Кандидаты выводятся, а не хранятся** — механизмом агентов Ратуши (`sim/recruits`): список — чистая функция сида партии,
// окна (сезона) и места в списке (`commandrules.commanderAt`); Казармы выше — лучше ступень и длиннее список. Кого из окна уже
// взяли, помнит книга (`CommandState.took`). Посадить — `sim/command.seatCommander`; сменить и уволить — только когда
// полководец дома: командиры едут в его отряде (К6).
import type { FaithId, Flank, GameState } from '../types';
import {
  FLANKS,
  commanderAt,
  commanderCount,
  commanderId,
  commanderNameIndex,
  commandTier,
  type Commander,
} from '../commandrules';
import { recruitAdvance, recruitWage } from '../agentrules';
import { windowEnd, windowOf } from '../councilrules';
import { AGENT_EPITHETS, AGENT_NAMES, commanderName } from '../data/names';
import { buildingOfType } from '../derived';
import { cityName } from '../../../netlify/lib/contract';
import { livingNames } from './dynasty';
import { seated } from './agents';
import { basePrice } from './recruits';
import { commandSeat, commandTaken, releaseCommander, seatCommander } from './command';
import { log } from './log';
import { canRegear, type Placed } from '@/world/shelter';
import { outlay } from './pay';

/** Кандидат в листе: всё, что о нём известно до найма, — теми же формулами, что лягут в найм. */
export interface CommanderView extends Commander {
  name: string;
  /** Ступень Казарм, при которой он выведен (метка найма `tier`). */
  tier: number;
  /** Жалованье за игровой день. */
  wage: number;
  /** Жалованье за сезон вперёд (бережливый — ноль). */
  advance: number;
  /** Плата за найм целиком: плата по числу ртов и жалованье вперёд — как у агентов. */
  price: number;
}

/** Уровень Казарм: по нему ступень кандидатов; Казарм нет — ноль. */
export const barracksLevel = (s: GameState): number => buildingOfType(s, 'barracks')?.level ?? 0;

/** Имя кандидата без тёзок среди живых (дом, агенты, совет, командиры): шагает дальше по перестановке. */
function freeName(s: GameState, faith: FaithId, n: number, taken: ReadonlySet<string>): string {
  const span = AGENT_NAMES[faith].length * AGENT_EPITHETS.length;
  const pick = (i: number): string => cityName(commanderName(s.seed, i, faith)) ?? 'Командир';
  const at = commanderNameIndex(n);
  let name = pick(at);
  for (let step = 1; step <= span && taken.has(name); step++) name = pick(at + step);
  return name;
}

/**
 * Кандидаты нынешнего окна: столько, сколько дают Казармы, без взятых в этом окне и без сидящих. Вера ещё не названа — имён
 * взять неоткуда, и кандидатов нет (как у агентов).
 */
export function commandersOf(s: GameState): CommanderView[] {
  const faith = s.faith?.id;
  if (!faith) return [];
  const level = barracksLevel(s);
  const tier = commandTier(level);
  const count = commanderCount(level);
  const w = windowOf(s.time);
  const gone = new Set(commandTaken(s, w));
  const sat = new Set(FLANKS.map((f) => commandSeat(s, f)?.n).filter((x): x is number => x !== undefined));
  const taken = new Set(livingNames(s));
  const base = basePrice(s);
  const out: CommanderView[] = [];
  for (let slot = 0; slot < count; slot++) {
    const n = commanderId(w, slot);
    if (gone.has(n) || sat.has(n)) continue;
    const c = commanderAt(s.seed, n, tier);
    const name = freeName(s, faith, n, taken);
    taken.add(name);
    const advance = recruitAdvance(c.level, c.traits);
    out.push({ ...c, name, tier, wage: recruitWage(c.level, c.traits), advance, price: base + advance });
  }
  return out;
}

/** Через сколько игровых секунд придут новые кандидаты. */
export const nextCommandersIn = (s: GameState): number => Math.max(0, windowEnd(windowOf(s.time)) - s.time);

/**
 * Почему командиров сейчас не сменить и не уволить; `null` — можно. Командиры едут в отряде полководца: менять — когда он дома
 * (у своих ворот или в городе, `world/shelter.canRegear`); места полководца нет — менять можно всегда. `where` — где стоит
 * фигура полководца (мир знает, окно приносит её готовой). Слова — под кнопкой, не длиннее 32 знаков.
 */
export function commandAwayBlock(s: GameState, where: Placed | null | undefined): string | null {
  if (!seated(s, 'general')) return null;
  if (!where) return 'Полководец ещё не на месте.';
  if (canRegear(where)) return null;
  if (where.phase === 'down') return 'Вне строя — менять дома.';
  return where.phase === 'moving' ? 'Отряд в пути — менять дома.' : 'Отряд в поле — менять дома.';
}

/** Почему нельзя нанять кандидата `n` на фланг `f`; `null` — можно. Порядок — тот, в котором игрок упирается. */
export function commandHireBlock(s: GameState, f: Flank, n: number, where: Placed | null | undefined): string | null {
  const away = commandSeat(s, f) ? commandAwayBlock(s, where) : null;
  if (away) return away;
  const c = commandersOf(s).find((x) => x.n === n);
  if (!c) return 'Этого кандидата уже нет.';
  if (Math.floor(s.gold) < c.price) return 'Не хватает золота.';
  return null;
}

/** Нанять кандидата `n` на фланг `f`: плата из казны — разовая трата описи (`sim/pay.outlay`), посадка — `seatCommander`. */
export function hireCommander(s: GameState, f: Flank, n: number, where: Placed | null | undefined): string | null {
  const block = commandHireBlock(s, f, n, where);
  if (block) return block;
  const c = commandersOf(s).find((x) => x.n === n)!;
  if (c.price > 0) {
    s.gold = Math.max(0, s.gold - c.price);
    outlay(s);
  }
  seatCommander(s, f, { n: c.n, tier: c.tier, name: c.name, advance: c.advance });
  return null;
}

/** Почему нельзя уволить командира фланга `f`; `null` — можно. */
export function commandDismissBlock(s: GameState, f: Flank, where: Placed | null | undefined): string | null {
  if (!commandSeat(s, f)) return 'Место и так пустует.';
  return commandAwayBlock(s, where);
}

/** Уволить командира фланга: только когда полководец дома; плата вперёд не возвращается — это не залог. */
export function dismissCommander(s: GameState, f: Flank, where: Placed | null | undefined): string | null {
  const block = commandDismissBlock(s, f, where);
  if (block) return block;
  const seat = commandSeat(s, f)!;
  releaseCommander(s, f);
  log(s, `${seat.name} отпущен со службы.`, 'info');
  return null;
}
