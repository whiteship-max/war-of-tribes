// Найм агентов в Ратуше (АГ-1, docs/city_v3.md, «Решения АГ-1») — единственная дверь записи `GameState.recruit`: кого из окна
// уже взяли, книга найма и жалованья для сервера, весть о пустом месте, опись для сервера. Пишет поле только этот модуль (замок —
// `recruit.test.ts`, чтением исходников). Посадка, смена и увольнение — действия окна, они едут докачкой с ним
// (`sim/recruits`): книгу найма они пишут этой дверью (`bookHire`), людей на местах — дверью `sim/agents` (`seat`, `release`).
//
// Устройство — как у совета Ратуши (РТ-1):
// - **кандидаты выводятся, а не хранятся** — их список, имена, выбор и цена — в `sim/recruits` (едет докачкой с окном Ратуши);
//   сюда приходит готовый кандидат (`seatRecruit`), хранится только то, кого из окна взяли (`took`);
// - **нанятый несёт метку кандидата** (`AgentProgress.cand`): врождённое, черты и облик выводятся из неё (`agentrules.recruitAt`);
// - **жалованье — из той же ведомости, что войско, мастера и совет** (`derived.wagesPerDay`, платит `sim/upkeep`); здесь только
//   книга уплаченного (`recruitStep`). Неуплатой агенты не уходят (решения АГ-1): человек в поле ушёл бы посреди дела с
//   дружиной; неуплату ведомость делит на всех, и уходят войско и совет — своими долями;
import type { FigureId } from '@/world/types';
import type { GameState, RecruitState } from '../types';
import { AGENT_ROLES, windowOfRecruit } from '../agentrules';
import { windowOf } from '../councilrules';
import { DAY_LENGTH } from '../constants';
import { RECRUIT_EVENT } from '../data/recruit';
import { agentWagesPerDay, unpaidShare } from '../derived';
import { FIGURE_BY_ID } from '@/world/data/figures';
import { cityName, type WatchAgents } from '../../../netlify/lib/contract';

/** Пустая книга — так читаются новая и старая партия. */
const EMPTY: RecruitState = { took: { w: -1, n: [] }, hired: 0, fees: 0, paid: 0 };

/** Книга найма для чтения; у партии без поля — пустая. Не пишет. */
export const recruitBook = (s: GameState): RecruitState => s.recruit ?? EMPTY;

/** Книга найма для записи: заводит поле при первой нужде. */
function own(s: GameState): RecruitState {
  if (!s.recruit) s.recruit = { took: { w: -1, n: [] }, hired: 0, fees: 0, paid: 0 };
  return s.recruit;
}

/** Номера кандидатов, взятых в окне `w`. */
export const takenIn = (s: GameState, w: number): readonly number[] => (recruitBook(s).took.w === w ? recruitBook(s).took.n : []);

/**
 * Книга найма: кандидат `n` взят в нынешнем окне, наймов на один больше, плата вперёд — в счёт. Зовёт посадка нанятого
 * (`sim/recruits.seatRecruit`, докачкой); больше `s.recruit` здесь не пишет никто, кроме шага и вести.
 */
export function bookHire(s: GameState, n: number, advance: number): void {
  const b = own(s);
  const w = windowOf(s.time);
  if (b.took.w !== w) b.took = { w, n: [] };
  b.took.n.push(n);
  b.hired += 1;
  b.fees += Math.max(0, advance);
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

// ---------- Опись для сервера ----------

/**
 * Агенты для описи (АГ-1, `WatchCard.agents`): место, номер человека, метка кандидата (номер, ступень, минута) и опыт, и книга
 * найма. Характеристик здесь нет: сервер выводит их из сида сам (`agentbook`). Модуль без DOM — опись собирает `net/snapshot`,
 * а тест сервера читает её отсюда же.
 */
export function agentsWatch(s: GameState): WatchAgents {
  const seats = AGENT_ROLES.map((role) => {
    const p = s.agents[role];
    return {
      role,
      person: p.person,
      ...(p.cand ? { n: p.cand.n, tier: p.cand.tier, at: Math.floor(p.cand.at) } : {}),
      xp: Math.floor(p.xp),
      ...(p.vacant ? { vacant: true as const } : {}),
    };
  });
  const b = recruitBook(s);
  return { seats, hired: b.hired, fees: Math.round(b.fees), paid: Math.floor(b.paid) };
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
