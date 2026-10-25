// Найм агентов в Ратуше (АГ-1, docs/city_v3.md, «Решения АГ-1») — единственная дверь записи `GameState.recruit`: кого из окна
// уже взяли, книга найма и жалованья для сервера, посадка нанятого, увольнение, весть о пустом месте. Пишет поле только этот
// модуль (замок — `recruit.test.ts`, чтением исходников); в людей на местах он входит одной дверью — `sim/agents` (`seat`,
// `release`).
//
// Устройство — как у совета Ратуши (РТ-1):
// - **кандидаты выводятся, а не хранятся** — их список, имена, выбор и цена — в `sim/recruits` (едет докачкой с окном Ратуши);
//   сюда приходит готовый кандидат (`seatRecruit`), хранится только то, кого из окна взяли (`took`);
// - **нанятый несёт метку кандидата** (`AgentProgress.cand`): врождённое, черты и облик выводятся из неё (`agentrules.recruitAt`);
// - **жалованье — из той же ведомости, что войско, мастера и совет** (`derived.wagesPerDay`, платит `sim/upkeep`); здесь только
//   книга уплаченного (`recruitStep`). Неуплатой агенты не уходят (решения АГ-1): человек в поле ушёл бы посреди дела с
//   дружиной; неуплату ведомость делит на всех, и уходят войско и совет — своими долями;
// - **сменить и уволить — только дома** (у своих ворот или в городе, `world/shelter.canRegear`): человек в деле его заканчивает.
import type { FigureId } from '@/world/types';
import type { GameState, RecruitState } from '../types';
import { AGENT_ROLES, windowOfRecruit } from '../agentrules';
import { windowOf } from '../councilrules';
import { DAY_LENGTH } from '../constants';
import { RECRUIT_EVENT, RECRUIT_LOG } from '../data/recruit';
import { agentWagesPerDay, unpaidShare } from '../derived';
import { FIGURE_BY_ID } from '@/world/data/figures';
import { canRegear, type Placed } from '@/world/shelter';
import { cityName } from '../../../netlify/lib/contract';
import { release, seat, seated, titled, yearsWord } from './agents';
import { log } from './log';

/** Пустая книга — так читаются новая и старая партия. */
const EMPTY: RecruitState = { took: { w: -1, n: [] }, hired: 0, fees: 0, paid: 0 };

/** Книга найма для чтения; у партии без поля — пустая. Не пишет. */
export const recruitBook = (s: GameState): RecruitState => s.recruit ?? EMPTY;

/** Книга найма для записи: заводит поле при первой нужде. */
function own(s: GameState): RecruitState {
  if (!s.recruit) s.recruit = { took: { w: -1, n: [] }, hired: 0, fees: 0, paid: 0 };
  return s.recruit;
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

/** Номера кандидатов, взятых в окне `w`. */
export const takenIn = (s: GameState, w: number): readonly number[] => (recruitBook(s).took.w === w ? recruitBook(s).took.n : []);

/**
 * Посадить нанятого на место: прежний (если был) отставлен, номер — во взятые окна, книга сервера считает найм и плату вперёд.
 * Цена уже снята тем, кто зовёт (`sim/recruits.hireRecruit`); можно ли — решил он же (`hireBlock`).
 */
export function seatRecruit(s: GameState, role: FigureId, c: Hireable): void {
  const b = own(s);
  if (seated(s, role)) log(s, RECRUIT_LOG.dismissed(titled(s, role)), 'info');
  const w = windowOf(s.time);
  if (b.took.w !== w) b.took = { w, n: [] };
  b.took.n.push(c.n);
  b.hired += 1;
  b.fees += Math.max(0, c.advance);
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

/** Книга жалованья — после содержания (`sim/upkeep` заплатил или задолжал): сколько ушло — доля ведомости, что казна покрыла. */
export function recruitStep(s: GameState, dt: number): void {
  const wages = agentWagesPerDay(s);
  if (!(wages > 0)) return;
  own(s).paid += (wages * (1 - unpaidShare(s)) * dt) / DAY_LENGTH;
}

// ---------- Весть о пустом месте ----------

/** Запомнить, кто ушёл с места и почему, — его называет весть (`agentVacancyDef`). Зовёт тот, кто опустошил место. */
export function noteGone(s: GameState, role: FigureId, name: string, why: 'fell' | 'rest'): void {
  const b = own(s);
  b.left = { ...(b.left ?? {}), [role]: { name, why } };
}

/** Вид вести о пустом месте агента. */
export const agentVacancyEvent = (role: FigureId): string => RECRUIT_EVENT.id(role);

/** Место вести о пустом месте по её виду; не весть агентов — `null`. */
export const agentVacancyRole = (defId: string): FigureId | null => AGENT_ROLES.find((r) => agentVacancyEvent(r) === defId) ?? null;

/**
 * Весть о пустом месте агента: кто ушёл и почему. Выбор нового — в Ратуше, где видны лица, характеристики и цена: весть ведёт
 * туда дверью «Ратуша» (`ui/realm/Mail`), а сама просит только подождать — молчание и ответ одно и то же, бесплатно.
 */
export function agentVacancyDef(role: FigureId) {
  return {
    id: agentVacancyEvent(role),
    silence: 0,
    title: RECRUIT_EVENT.title(FIGURE_BY_ID[role].name),
    from: RECRUIT_EVENT.from,
    text: (s: GameState): string => {
      const left = recruitBook(s).left?.[role];
      return RECRUIT_EVENT.text(FIGURE_BY_ID[role].name, left?.name ?? null, left?.why ?? null);
    },
    // Случаем не выпадает: её кладёт гибель или покой (`sim/expedition`).
    weight: (): number => 0,
    options: [{ label: RECRUIT_EVENT.later, apply: (): string => RECRUIT_EVENT.laterSaid }],
  };
}

// ---------- Чтение из сохранения ----------

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Книга найма из сохранения — каждое поле с проверкой; поля нет — `undefined`, и версия не растёт. */
export function mergeRecruit(v: unknown): RecruitState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const t = r.took && typeof r.took === 'object' ? (r.took as Record<string, unknown>) : {};
  const w = finite(t.w) ? Math.floor(t.w) : -1;
  const took = {
    w,
    // Взятые — только номера кандидатов своего окна: чужой номер в книге не прячет никого.
    n: Array.isArray(t.n) ? t.n.filter((x): x is number => Number.isInteger(x) && x >= 0 && windowOfRecruit(x) === w) : [],
  };
  const count = (x: unknown): number => (finite(x) ? Math.max(0, x) : 0);
  const out: RecruitState = { took, hired: Math.floor(count(r.hired)), fees: count(r.fees), paid: count(r.paid) };
  const left = r.left && typeof r.left === 'object' ? (r.left as Record<string, unknown>) : {};
  for (const role of AGENT_ROLES) {
    const x = left[role] as Record<string, unknown> | undefined;
    const name = x && typeof x === 'object' ? cityName(x.name) : null;
    if (name && (x?.why === 'fell' || x?.why === 'rest')) out.left = { ...(out.left ?? {}), [role]: { name, why: x.why } };
  }
  return out;
}
