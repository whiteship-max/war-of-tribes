// Командиры флангов (ДР-3, docs/siege_v2.md, «Решения ДР-3») — единственная дверь записи `GameState.command`: кто на местах
// левого и правого фланга, кого из окна уже взяли, книга найма и жалованья для сервера, покой по возрасту, опись для сервера,
// чтение сохранения. Пишет поле только этот модуль (замок — `command.test.ts`, чтением исходников). Кандидаты, найм и смена —
// действия окна «Командующие», они едут докачкой с ним (`sim/commanders`) и садят человека этой дверью (`seatCommander`).
//
// Устройство — как у агентов Ратуши (АГ-1, `sim/recruit`): **кандидаты выводятся, а не хранятся**; на месте лежит метка найма
// (номер кандидата, ступень, минута) и имя — род, уровень, тактика и черты выводятся из неё (`commandrules.commanderAt`).
// Жалованье — из той же ведомости, что войско (`derived.commandWagesPerDay` в `wagesPerDay`); здесь только книга уплаченного.
// Неуплатой командиры не уходят (решение АГ-1, 11).
//
// **В бой — там же, где отметки полководца** (К1): мост везёт тактику мест в мир (`PlayerProfile.flanks`), мир кладёт её в бой,
// который ведёт полководец. В знать — слагаемым лояльности рыцарства (`derived.commandLead`).
import type { Flanks } from '@/battle/types';
import type { CommandSeat, CommandState, Flank, GameState } from '../types';
import { FLANKS, commandAgeAt, commandRetired, flanksFrom, isFlank, windowOfCommander } from '../commandrules';
import { windowOf } from '../councilrules';
import { DAY_LENGTH } from '../constants';
import { commanderOn, commandWagesPerDay, unpaidShare } from '../derived';
import { cityName, type WatchCommand } from '../../../netlify/lib/contract';
import { log } from './log';

/** Пустая книга — так читаются новая и старая партия. */
const empty = (): CommandState => ({ seats: {}, took: { w: -1, n: [] }, hired: 0, fees: 0, paid: 0 });
const EMPTY: CommandState = empty();

/** Командиры партии для чтения; поля нет — пусто. Не пишет. */
export const commandOf = (s: GameState): CommandState => s.command ?? EMPTY;

/** Поле для записи: заводится на первой записи. */
function own(s: GameState): CommandState {
  if (!s.command) s.command = empty();
  return s.command;
}

/** Человек на месте фланга; пусто — `null`. */
export const commandSeat = (s: GameState, f: Flank): CommandSeat | null => s.command?.seats?.[f] ?? null;

/** Номера кандидатов, взятых в окне `w`. */
export const commandTaken = (s: GameState, w: number): readonly number[] => (commandOf(s).took.w === w ? commandOf(s).took.n : []);

/** Возраст командира на месте, годы — дробные; места нет — ноль. */
export function commandAge(s: GameState, f: Flank): number {
  const seat = commandSeat(s, f);
  const c = commanderOn(s, f);
  return seat && c ? commandAgeAt(c.age0, seat.at, s.time) : 0;
}

/** Тактика людей на местах — поле стороны боя (`ArmySetup.flanks`): мост везёт его в мир (`PlayerProfile.flanks`). */
export function commandFlanks(s: GameState): Flanks {
  const tactics: Partial<Record<Flank, number>> = {};
  for (const f of FLANKS) {
    const c = commanderOn(s, f);
    if (c) tactics[f] = c.tactics;
  }
  return flanksFrom(tactics);
}

/** Готовый кандидат — то, что ложится в найм (`sim/commanders`): номер, ступень, имя и плата вперёд. */
export interface CommandHire {
  n: number;
  tier: number;
  name: string;
  /** Жалованье за сезон вперёд — в книгу платы (сервер сверяет её с ценой кандидата). */
  advance: number;
}

/**
 * Посадить нанятого на место фланга: прежний (если был) отставлен, номер — во взятые окна, книга сервера считает найм и плату
 * вперёд. Цена уже снята тем, кто зовёт (`sim/commanders.hireCommander`); можно ли — решил он же. Тот же человек на другом
 * фланге снимается оттуда: двух мест у одного человека нет.
 */
export function seatCommander(s: GameState, f: Flank, c: CommandHire): void {
  const b = own(s);
  const w = windowOf(s.time);
  if (b.took.w !== w) b.took = { w, n: [] };
  b.took.n.push(c.n);
  b.hired += 1;
  b.fees += Math.max(0, c.advance);
  const was = b.seats[f];
  if (was) log(s, `${was.name} оставил место командира ${FLANK_OF[f]}.`, 'info');
  b.seats = { ...b.seats, [f]: { n: c.n, tier: c.tier, at: s.time, name: c.name } };
  log(s, `${c.name} принял ${FLANK_WORD[f]} фланг в отряде полководца.`, 'good');
}

/** Падеж места в летописи: «командира левого фланга». */
const FLANK_OF: Record<Flank, string> = { left: 'левого фланга', right: 'правого фланга' };
const FLANK_WORD: Record<Flank, string> = { left: 'левый', right: 'правый' };

/** Снять человека с места фланга; места и так нет — `false`. Летопись пишет тот, кто снимает. */
export function releaseCommander(s: GameState, f: Flank): boolean {
  if (!s.command?.seats?.[f]) return false;
  delete s.command.seats[f];
  return true;
}

/**
 * Отозвать безродного (ответ на весть «Обиженный лорд», `data/crown`, последствие `unseat`): первый безродный по порядку
 * мест. Указ, а не увольнение дома: место пустеет сразу, где бы ни был полководец. Безродного нет — ничего.
 */
export function unseatLowborn(s: GameState): boolean {
  for (const f of FLANKS) {
    const c = commanderOn(s, f);
    const seat = commandSeat(s, f);
    if (!c || !seat || c.birth !== 'low') continue;
    releaseCommander(s, f);
    log(s, `${seat.name} отозван с ${FLANK_OF[f]}: знать довольна.`, 'info', undefined, 'stab');
    return true;
  }
  return false;
}

/**
 * Шаг партии (после содержания — `sim/upkeep` заплатил или задолжал): книга уплаченного жалованья — доля ведомости, что казна
 * покрыла; командир, доживший до покоя, уходит строкой летописи (К7).
 */
export function commandStep(s: GameState, dt: number): void {
  if (!s.command) return;
  const wages = commandWagesPerDay(s);
  if (wages > 0) s.command.paid += (wages * (1 - unpaidShare(s)) * dt) / DAY_LENGTH;
  for (const f of FLANKS) {
    const seat = commandSeat(s, f);
    const c = commanderOn(s, f);
    if (!seat || !c || !commandRetired(c, seat.at, s.time)) continue;
    releaseCommander(s, f);
    log(s, `${seat.name} ушёл на покой: ${FLANK_WORD[f]} фланг без командира.`, 'info');
  }
}

// ---------- Опись для сервера ----------

/**
 * Командиры для описи (ДР-3, `WatchCard.command`): место, номер кандидата, ступень и минута найма, и книга найма. Рода,
 * тактики и черт здесь нет — сервер выводит их из сида сам (`commandbook`).
 */
export function commandWatch(s: GameState): WatchCommand | undefined {
  const b = s.command;
  if (!b) return undefined;
  const seats = FLANKS.flatMap((flank) => {
    const c = b.seats[flank];
    return c ? [{ flank, n: c.n, tier: c.tier, at: Math.floor(c.at) }] : [];
  });
  return { seats, hired: b.hired, fees: Math.round(b.fees), paid: Math.floor(b.paid) };
}

// ---------- Чтение из сохранения ----------

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Командиры из сохранения — каждое поле с проверкой; поля нет — `undefined`, и версия не растёт. */
export function mergeCommand(v: unknown): CommandState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const t = r.took && typeof r.took === 'object' ? (r.took as Record<string, unknown>) : {};
  const w = finite(t.w) ? Math.floor(t.w) : -1;
  // Взятые — только номера кандидатов своего окна: чужой номер в книге не прячет никого.
  const took = { w, n: Array.isArray(t.n) ? t.n.filter((x): x is number => Number.isInteger(x) && x >= 0 && windowOfCommander(x) === w) : [] };
  const count = (x: unknown): number => (finite(x) ? Math.max(0, x) : 0);
  const kept: [Flank, CommandSeat][] = [];
  const raw = r.seats && typeof r.seats === 'object' ? (r.seats as Record<string, unknown>) : {};
  const used = new Set<number>();
  for (const [f, x] of Object.entries(raw)) {
    if (!isFlank(f) || !x || typeof x !== 'object') continue;
    const c = x as Record<string, unknown>;
    const name = cityName(c.name);
    if (!Number.isInteger(c.n) || (c.n as number) < 0 || !Number.isInteger(c.tier) || !finite(c.at) || !name) continue;
    // Один человек — одно место: второй раз тот же номер не садится.
    if (used.has(c.n as number)) continue;
    used.add(c.n as number);
    kept.push([f, { n: c.n as number, tier: Math.max(1, c.tier as number), at: c.at, name }]);
  }
  const seats = Object.fromEntries(kept) as CommandState['seats'];
  return { seats, took, hired: Math.floor(count(r.hired)), fees: count(r.fees), paid: count(r.paid) };
}
