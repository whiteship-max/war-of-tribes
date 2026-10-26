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
//
// **Служба (ДР-5, механизмом агентов АГ-1):** бой полководца приходит последствием мира (`HomeEffect.flanks`) — опыт командирам
// его флангов (`agentrules.deedXp`, не чаще `DEED_GAP`; рост — `commandrules.servedCommander`) и гибель по кости боя с долей
// гибели фланга (`world/peril.diesAt`); покой — по возрасту. Ушедший — строкой летописи и вестью о пустом месте: выбор нового —
// в «Командующих».
import type { Flanks } from '@/battle/types';
import type { CommandSeat, CommandState, Flank, GameState } from '../types';
import type { FlankBattle } from '@/world/types';
import { FLANKS, commandAgeAt, commandRetired, flanksFrom, isFlank, windowOfCommander } from '../commandrules';
import { deedXp } from '../agentrules';
import { DEED_GAP, XP_CAP } from '../data/agents';
import { mixSeed, seeded } from './random';
import { diesAt } from '@/world/peril';
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
 * покрыла; командир, доживший до покоя, уходит строкой летописи (К7). Возвращает опустевшие места — весть о них кладёт шаг
 * (`sim/tick`).
 */
export function commandStep(s: GameState, dt: number): Flank[] {
  if (!s.command) return [];
  const wages = commandWagesPerDay(s);
  if (wages > 0) s.command.paid += (wages * (1 - unpaidShare(s)) * dt) / DAY_LENGTH;
  const out: Flank[] = [];
  for (const f of FLANKS) {
    const seat = commandSeat(s, f);
    const c = commanderOn(s, f);
    if (!seat || !c || !commandRetired(c, seat.at, s.time)) continue;
    releaseCommander(s, f);
    noteLeft(s, f, seat.name, 'rest');
    log(s, `${seat.name} ушёл на покой: ${FLANK_WORD[f]} фланг без командира.`, 'info');
    out.push(f);
  }
  return out;
}

/** Соль кости гибели командира: свой поток от кости боя, по месту. */
const FALL_SALT = 0x666c6b;

/**
 * Бой полководца для командиров его флангов (ДР-5): каждому командиру, чей фланг бился (`peril` несёт его место), — опыт делом,
 * не чаще `DEED_GAP` (удача и неудача — `agentrules.deedXp`, как агенту), и кость гибели с долей гибели своего фланга
 * (`world/peril.diesAt`, кость — от кости боя и места: тот же бой даёт тот же исход). Возвращает опустевшие места — весть о них
 * кладёт тот, кто применяет последствие (`sim/expedition`).
 */
export function commandBattle(s: GameState, b: FlankBattle): Flank[] {
  if (!s.command || !Number.isFinite(b.at)) return [];
  const out: Flank[] = [];
  FLANKS.forEach((f, i) => {
    const seat = commandSeat(s, f);
    const peril = b.peril[f];
    if (!seat || peril === undefined || !Number.isFinite(peril)) return;
    if (seat.deedAt === undefined || b.at - seat.deedAt >= DEED_GAP) {
      const c = commanderOn(s, f);
      seat.xp = Math.min(XP_CAP, (seat.xp ?? 0) + deedXp(b.ok, c?.traits ?? []));
      seat.deedAt = b.at;
    }
    if (!diesAt(seeded(mixSeed(mixSeed(b.seed >>> 0, FALL_SALT), i))(), Math.max(0, Math.min(1, peril)))) return;
    releaseCommander(s, f);
    noteLeft(s, f, seat.name, 'fell');
    log(s, `${seat.name} пал в бою: ${FLANK_WORD[f]} фланг без командира.`, 'bad');
    out.push(f);
  });
  return out;
}

/** Запомнить, кто ушёл с места и почему, — его называет весть (`commandVacancyDef`). */
function noteLeft(s: GameState, f: Flank, name: string, why: 'fell' | 'rest'): void {
  const b = own(s);
  b.left = { ...(b.left ?? {}), [f]: { name, why } };
}

// ---------- Весть о пустом месте ----------

/** Слова вести о пустом месте командира: выбор нового — в «Дружине», меню «Командующие». */
export const COMMAND_EVENT = {
  id: (f: Flank): string => `command_${f}`,
  title: (f: Flank): string => `Место: командир ${FLANK_OF[f]}`,
  from: 'Старший дружины',
  text: (f: Flank, name: string | null, why: 'fell' | 'rest' | null): string =>
    `${name ? `${name} ${why === 'fell' ? 'пал в бою' : 'ушёл на покой'}. ` : ''}${FLANK_WORD[f][0].toUpperCase()}${FLANK_WORD[f].slice(1)} фланг ведёт сам полководец. Кандидаты ждут в «Дружине» — меню «Командующие».`,
  later: 'Подождать',
  laterSaid: 'Место ждёт. Кандидаты — «Дружина», «Командующие».',
};

/** Вид вести о пустом месте командира. */
export const commandVacancyEvent = (f: Flank): string => COMMAND_EVENT.id(f);

/** Место вести о пустом месте по её виду; не весть командиров — `null`. */
export const commandVacancyFlank = (defId: string): Flank | null => FLANKS.find((f) => commandVacancyEvent(f) === defId) ?? null;

/**
 * Весть о пустом месте командира (ДР-5): кто ушёл и почему. Выбор нового — в «Командующих», где видны лица, род, тактика и цена:
 * весть ведёт туда дверью «Дружина» (`ui/realm/Mail`), а сама просит только подождать — молчание и ответ одно, бесплатно.
 */
export function commandVacancyDef(f: Flank) {
  return {
    id: commandVacancyEvent(f),
    silence: 0,
    title: COMMAND_EVENT.title(f),
    from: COMMAND_EVENT.from,
    text: (s: GameState): string => {
      const left = commandOf(s).left?.[f];
      return COMMAND_EVENT.text(f, left?.name ?? null, left?.why ?? null);
    },
    // Случаем не выпадает: её кладёт гибель или покой.
    weight: (): number => 0,
    options: [{ label: COMMAND_EVENT.later, apply: (): string => COMMAND_EVENT.laterSaid }],
  };
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
    return c ? [{ flank, n: c.n, tier: c.tier, at: Math.floor(c.at), ...(c.xp ? { xp: c.xp } : {}) }] : [];
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
    const xp = finite(c.xp) && c.xp > 0 ? { xp: Math.min(XP_CAP, c.xp) } : {};
    const deedAt = finite(c.deedAt) ? { deedAt: c.deedAt } : {};
    kept.push([f, { n: c.n as number, tier: Math.max(1, c.tier as number), at: c.at, name, ...xp, ...deedAt }]);
  }
  const seats = Object.fromEntries(kept) as CommandState['seats'];
  // Кто ушёл (ДР-5) — только для слов вести: имя и причина из списка.
  const leftRaw = r.left && typeof r.left === 'object' ? (r.left as Record<string, unknown>) : {};
  const left: NonNullable<CommandState['left']> = {};
  for (const [f, x] of Object.entries(leftRaw)) {
    const g = (x ?? {}) as Record<string, unknown>;
    const name = cityName(g.name);
    if (isFlank(f) && name && (g.why === 'fell' || g.why === 'rest')) left[f] = { name, why: g.why };
  }
  return { seats, took, hired: Math.floor(count(r.hired)), fees: count(r.fees), paid: count(r.paid), ...(Object.keys(left).length ? { left } : {}) };
}
