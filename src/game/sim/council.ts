// Совет Ратуши (РТ-1, docs/city_v3.md, «Решения РТ-1») — единственная дверь записи: кто сидит, найм на место, отставка, конец
// службы и уход неуплатой. Пишет `GameState.council` только этот модуль (замок — `council.test.ts`, чтением исходников).
//
// Устройство:
// - **просители выводятся, а не хранятся** — их список, выбор и цена найма — в `sim/candidates` (едет докачкой с окном совета:
//   первой загрузке он не нужен). Сюда приходит готовый проситель (`seat`); хранится только то, кого из окна уже взяли
//   (`took`), чтобы ушедший не встал вторым;
// - **нанятый своих чисел не меняет:** имя, уровень, черта и конец службы ложатся при найме готовыми (`Advisor`);
// - **очки правителя:** смена советника меняет ставку вида (`sim/points.branchRate`), поэтому перед сменой база
//   перекладывается (`points.bank`) — иначе прошлое посчиталось бы по новой ставке;
// - **жалованье — из той же ведомости, что войско** (`derived.wagesPerDay`, платит `sim/upkeep`); пока совету не платят
//   дольше терпения Статуи, он уходит той же долей, что войско (`DESERT_SHARE`), — самым дорогим первым (`councilStep`);
// - **конец службы — по часам племени:** покой в `RETIRE_AGE` или смерть раньше (`councilrules.serviceYears`); место пустеет,
//   и весть о нём ложится на стол (`sim/tick` → `sim/mail.raiseEvent`): выбор нового — в совете, вестью туда ведёт дверь.
import type { Advisor, AdvisorPost, AdvisorTrait, CouncilState, GameState } from '../types';
import { ADVISOR_POSTS, advisorWage, councilTier, isTrait, levelOf, windowOf } from '../councilrules';
import { DAY_LENGTH } from '../constants';
import { AGENT_YEAR } from '../data/agents';
import { COUNCIL_EVENT, COUNCIL_LOG, postTitle, type CouncilGone } from '../data/council';
import { DESERT_SHARE } from '../data/upkeep';
import { councilWagesPerDay, hallLevel, payGraceDays, unpaidShare } from '../derived';
import { cityName } from '../../../netlify/lib/contract';
import { bank } from './points';
import { log } from './log';

/** Пустой совет — так читаются новая и старая партия. */
const EMPTY: CouncilState = { seats: {}, took: { w: -1, n: [] }, hired: 0, fees: 0, paid: 0 };

/** Совет партии для чтения; у партии без поля — пустой. Не пишет. */
export const councilOf = (s: GameState): CouncilState => s.council ?? EMPTY;

/** Совет партии для записи: заводит поле при первой нужде. */
function own(s: GameState): CouncilState {
  if (!s.council) s.council = { seats: {}, took: { w: -1, n: [] }, hired: 0, fees: 0, paid: 0 };
  return s.council;
}

/** Ступень совета сейчас — по ратуше. */
export const tierOf = (s: GameState): number => councilTier(hallLevel(s));

/** Имя должности сейчас: Староста или Бургомистр — по ступени. */
export const titleOf = (s: GameState, post: AdvisorPost): string => postTitle(post, tierOf(s));

/** Возраст советника сейчас, годы — теми же часами, что агент (`sim/agents.ageAt`). */
export const advisorAgeNow = (s: GameState, a: Advisor): number => a.age0 + Math.max(0, s.time - a.at) / AGENT_YEAR;

/** Готовый проситель — то, что ложится в найм (`sim/candidates.candidatesOf`); числа считает `councilrules`. */
export interface Seatable {
  n: number;
  name: string;
  level: number;
  trait: AdvisorTrait;
  age0: number;
  look: number;
  years: number;
  dies: boolean;
  price: number;
}

/**
 * Посадить на место: база очков перекладывается до смены ставки, прежний (если был) уходит без вести, номер — во взятые окна,
 * книга сервера считает найм и плату. Цена уже снята тем, кто зовёт (`sim/candidates.hireAdvisor`).
 */
export function seat(s: GameState, post: AdvisorPost, c: Seatable): Advisor {
  bank(s);
  const co = own(s);
  const before = co.seats[post];
  if (before) leave(s, post, 'dismissed');
  const w = windowOf(s.time);
  if (co.took.w !== w) co.took = { w, n: [] };
  co.took.n.push(c.n);
  const a: Advisor = {
    n: c.n,
    name: c.name,
    level: c.level,
    trait: c.trait,
    age0: c.age0,
    at: s.time,
    until: s.time + c.years * AGENT_YEAR,
    dies: c.dies,
    look: c.look,
  };
  co.seats[post] = a;
  co.hired += 1;
  co.fees += c.price;
  log(s, COUNCIL_LOG.hired(titleOf(s, post), a.name), 'good');
  return a;
}

/** Отставить советника: место пустеет сразу, жалованье вперёд не возвращается — плата за найм не залог. */
export function dismissAdvisor(s: GameState, post: AdvisorPost): string | null {
  if (!councilOf(s).seats[post]) return 'Место и так пустует.';
  bank(s);
  leave(s, post, 'dismissed');
  return null;
}

/** Место пустеет: летопись и память для вести. Базу очков перекладывает тот, кто зовёт. */
function leave(s: GameState, post: AdvisorPost, why: CouncilGone): void {
  const co = own(s);
  const a = co.seats[post];
  if (!a) return;
  delete co.seats[post];
  co.left = { ...(co.left ?? {}), [post]: { name: a.name, why } };
  log(s, COUNCIL_LOG.gone(titleOf(s, post), a.name, why), why === 'dismissed' ? 'info' : 'bad');
}

/**
 * Шаг совета — после содержания (`sim/upkeep` заплатил или задолжал): книга жалованья, уход неуплатой и конец службы.
 * Возвращает должности, опустевшие сами, — о них ложится весть (`sim/tick`). Поля нет — шагать нечему.
 */
export function councilStep(s: GameState, dt: number): AdvisorPost[] {
  const co = s.council;
  if (!co) return [];
  const out: AdvisorPost[] = [];
  const wages = councilWagesPerDay(s);
  if (wages > 0) {
    // Книга сервера: сколько ушло жалованьем — та доля ведомости, что казна покрыла.
    const unpaid = unpaidShare(s);
    co.paid += (wages * (1 - unpaid) * dt) / DAY_LENGTH;
    // Неуплата дольше терпения Статуи — уход той же долей, что у войска; дошло до целого — уходит самый дорогой.
    if (unpaid > 0 && (s.pay?.late ?? 0) >= payGraceDays(s) * DAY_LENGTH) {
      const seated = ADVISOR_POSTS.filter((p) => co.seats[p]);
      co.owed = (co.owed ?? 0) + (DESERT_SHARE * unpaid * seated.length * dt) / DAY_LENGTH;
      if (co.owed >= 1) {
        co.owed -= 1;
        const dear = seated.reduce((a, b) => (advisorWage(co.seats[b]!.level, co.seats[b]!.trait) > advisorWage(co.seats[a]!.level, co.seats[a]!.trait) ? b : a));
        bank(s);
        leave(s, dear, 'unpaid');
        out.push(dear);
      }
    } else if (co.owed) {
      delete co.owed;
    }
  }
  for (const post of ADVISOR_POSTS) {
    const a = co.seats[post];
    if (!a || s.time < a.until) continue;
    bank(s);
    leave(s, post, a.dies ? 'died' : 'rest');
    out.push(post);
  }
  return out;
}

// ---------- Весть о пустом месте ----------

/** Вид вести о пустом месте должности. */
export const vacancyEvent = (post: AdvisorPost): string => COUNCIL_EVENT.id(post);

/** Должность вести о пустом месте по её виду; не весть совета — `null`. */
export const vacancyPost = (defId: string): AdvisorPost | null => ADVISOR_POSTS.find((p) => vacancyEvent(p) === defId) ?? null;

/**
 * Весть о пустом месте: кто ушёл и почему. Выбор нового — в совете, где видны портреты, черты и цена: весть ведёт туда дверью
 * «Ратуша» (`ui/realm/Mail`), а сама просит только подождать — молчание и ответ одно и то же, бесплатно.
 */
export function vacancyDef(post: AdvisorPost) {
  return {
    id: vacancyEvent(post),
    silence: 0,
    title: COUNCIL_EVENT.title(postTitle(post, 1)),
    from: COUNCIL_EVENT.from,
    text: (s: GameState): string => {
      const left = councilOf(s).left?.[post];
      return COUNCIL_EVENT.text(titleOf(s, post), left?.name ?? null, left?.why ?? null);
    },
    // Случаем не выпадает: её кладёт конец службы (`sim/tick`).
    weight: (): number => 0,
    options: [{ label: COUNCIL_EVENT.later, apply: (): string => COUNCIL_EVENT.laterSaid }],
  };
}

// ---------- Чтение из сохранения ----------

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Совет из сохранения — каждое поле с проверкой (`save.deserialize`): место с чужой должностью, уровнем вне лестницы или
 * неизвестной чертой не садится, счёт — неотрицательным. Поля нет — `undefined`: совета не было, и версия не растёт.
 */
export function mergeCouncil(v: unknown): CouncilState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const seats: Partial<Record<AdvisorPost, Advisor>> = {};
  const raw = r.seats && typeof r.seats === 'object' ? (r.seats as Record<string, unknown>) : {};
  for (const post of ADVISOR_POSTS) {
    const a = raw[post] as Record<string, unknown> | undefined;
    if (!a || typeof a !== 'object') continue;
    if (!finite(a.n) || typeof a.name !== 'string' || !finite(a.level) || !isTrait(a.trait)) continue;
    if (!finite(a.age0) || !finite(a.at) || !finite(a.until) || !finite(a.look)) continue;
    const name = cityName(a.name);
    if (!name) continue;
    seats[post] = {
      n: Math.max(0, Math.floor(a.n)),
      name,
      level: levelOf(a.level),
      trait: a.trait,
      age0: a.age0,
      at: a.at,
      until: a.until,
      dies: a.dies === true,
      look: Math.max(0, Math.floor(a.look)),
    };
  }
  const t = r.took && typeof r.took === 'object' ? (r.took as Record<string, unknown>) : {};
  const took = { w: finite(t.w) ? Math.floor(t.w) : -1, n: Array.isArray(t.n) ? t.n.filter((x): x is number => Number.isInteger(x)) : [] };
  const count = (x: unknown): number => (finite(x) ? Math.max(0, x) : 0);
  const out: CouncilState = { seats, took, hired: Math.floor(count(r.hired)), fees: count(r.fees), paid: count(r.paid) };
  if (finite(r.owed) && r.owed > 0) out.owed = r.owed;
  return out;
}
