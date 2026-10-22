// Совет Ратуши (РТ-1, docs/city_v3.md, «Решения РТ-1») — единственная дверь: кто сидит, кто просится, найм, отставка, конец
// службы и уход неуплатой. Пишет `GameState.council` только этот модуль (замок — `council.test.ts`, чтением исходников).
//
// Устройство:
// - **просители выводятся, а не хранятся.** Список должности — чистая функция сида партии, окна (сезона) и места в списке
//   (`candidatesOf`): имя, уровень, черта, возраст, облик и срок службы известны заранее и одни на любом устройстве. Ратуша
//   выше — лучше ступень и длиннее список (`councilrules.councilTier`, `candidateCount`); подъём ратуши не опускает ни одного
//   кандидата окна. Хранится только то, кого из окна уже взяли (`took`), чтобы ушедший не встал вторым;
// - **нанятый своих чисел не меняет:** имя, уровень, черта и конец службы ложатся при найме готовыми (`Advisor`);
// - **очки правителя:** смена советника меняет ставку вида (`sim/points.branchRate`), поэтому перед сменой база
//   перекладывается (`points.bank`) — иначе прошлое посчиталось бы по новой ставке;
// - **жалованье — из той же ведомости, что войско** (`derived.wagesPerDay`, платит `sim/upkeep`); пока совету не платят
//   дольше терпения Статуи, он уходит той же долей, что войско (`DESERT_SHARE`), — самым дорогим первым (`councilStep`);
// - **конец службы — по часам племени:** покой в `RETIRE_AGE` или смерть раньше (`councilrules.serviceYears`); место пустеет,
//   и весть о нём ложится на стол (`sim/tick` → `sim/mail.raiseEvent`).
import type { Advisor, AdvisorPost, AdvisorTrait, CouncilState, FaithId, GameState } from '../types';
import {
  ADVISOR_POSTS,
  TRAITS,
  advisorAge,
  advisorPoints,
  advisorWage,
  candidateCount,
  candidateId,
  candidateLevel,
  councilTier,
  giftOf,
  hirePrice,
  isTrait,
  levelOf,
  serviceYears,
  windowEnd,
  windowOf,
} from '../councilrules';
import { DAY_LENGTH } from '../constants';
import { AGENT_YEAR } from '../data/agents';
import { AGENT_EPITHETS, AGENT_NAMES, councilName } from '../data/names';
import { COUNCIL_EVENT, COUNCIL_LOG, postTitle, type CouncilGone } from '../data/council';
import { DESERT_SHARE } from '../data/upkeep';
import { councilWagesPerDay, hallLevel, payGraceDays, unpaidShare } from '../derived';
import { cityName } from '../../../netlify/lib/contract';
import { mixSeed, seeded } from './random';
import { livingNames } from './dynasty';
import { bank } from './points';
import { outlay } from './pay';
import { log } from './log';

/** Соль кости просителей: у совета свой поток, кость партии (`s.rolls`) он не двигает — события деревни не едут. */
const CANDIDATE_SALT = 0x63616e64;

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

/** Проситель: всё, что о нём известно до найма, — теми же формулами, что лягут в найм (`councilrules`). */
export interface Candidate {
  n: number;
  post: AdvisorPost;
  name: string;
  level: number;
  trait: AdvisorTrait;
  age0: number;
  look: number;
  /** Через сколько лет кончится служба и как — тайна просителя: игроку её выдают только черты «крепкий» и «хворый». */
  years: number;
  dies: boolean;
  /** Жалованье за игровой день, плата за найм, польза и очки своего вида в день. */
  wage: number;
  price: number;
  gift: number;
  points: number;
}

/**
 * Имя просителя без тёзок среди живых (дом, агенты, совет): шагает дальше по перестановке, как дом правителя. Тот же номер
 * при тех же живых — то же имя.
 */
function freeName(s: GameState, faith: FaithId, n: number, taken: ReadonlySet<string>): string {
  const span = AGENT_NAMES[faith].length * AGENT_EPITHETS.length;
  const pick = (i: number): string => cityName(councilName(s.seed, i, faith)) ?? 'Советник';
  let name = pick(n);
  for (let step = 1; step <= span && taken.has(name); step++) name = pick(n + step);
  return name;
}

/** Проситель с номером `n` при ступени `tier`. Порядок костей закреплён: он и есть кандидат. */
function candidateAt(s: GameState, post: AdvisorPost, n: number, tier: number, faith: FaithId, taken: ReadonlySet<string>): Candidate {
  const rnd = seeded(mixSeed(mixSeed(s.seed >>> 0, CANDIDATE_SALT), n));
  const level = candidateLevel(rnd(), tier);
  const trait = TRAITS[Math.min(TRAITS.length - 1, Math.floor(rnd() * TRAITS.length))];
  const age0 = advisorAge(level, rnd());
  const fate = rnd();
  const when = rnd();
  const look = Math.floor(rnd() * 0x7fffffff);
  const { years, dies } = serviceYears(age0, trait, fate, when);
  return {
    n,
    post,
    name: freeName(s, faith, n, taken),
    level,
    trait,
    age0,
    look,
    years,
    dies,
    wage: advisorWage(level, trait),
    price: hirePrice(level, trait),
    gift: giftOf(post, level, trait),
    points: advisorPoints(level, trait),
  };
}

/**
 * Просители на должность в нынешнем окне: столько, сколько даёт ратуша, без взятых в этом окне и без сидящих. Вера ещё не
 * названа — имён взять неоткуда, и просителей нет (их приводит та же весть мира, что называет имена агентам).
 */
export function candidatesOf(s: GameState, post: AdvisorPost): Candidate[] {
  const faith = s.faith?.id;
  if (!faith) return [];
  const hall = hallLevel(s);
  const tier = councilTier(hall);
  const count = candidateCount(hall);
  const w = windowOf(s.time);
  const c = councilOf(s);
  const gone = new Set(c.took.w === w ? c.took.n : []);
  const seated = new Set(ADVISOR_POSTS.map((p) => c.seats[p]?.n).filter((x): x is number => x !== undefined));
  const taken = new Set(livingNames(s));
  const out: Candidate[] = [];
  for (let slot = 0; slot < count; slot++) {
    const n = candidateId(w, post, slot);
    if (gone.has(n) || seated.has(n)) continue;
    const cand = candidateAt(s, post, n, tier, faith, taken);
    taken.add(cand.name);
    out.push(cand);
  }
  return out;
}

/** Лучший проситель: выше уровень, при равном — дешевле жалованье, при равном — первый в списке. */
export function bestCandidate(s: GameState, post: AdvisorPost): Candidate | null {
  let best: Candidate | null = null;
  for (const c of candidatesOf(s, post)) if (!best || c.level > best.level || (c.level === best.level && c.wage < best.wage)) best = c;
  return best;
}

/** Через сколько игровых секунд придут новые просители. */
export const nextWindowIn = (s: GameState): number => Math.max(0, windowEnd(windowOf(s.time)) - s.time);

/** Возраст советника сейчас, годы — теми же часами, что агент (`sim/agents.ageAt`). */
export const advisorAgeNow = (s: GameState, a: Advisor): number => a.age0 + Math.max(0, s.time - a.at) / AGENT_YEAR;

/** Почему нельзя назначить просителя `n` на должность; `null` — можно. */
export function hireBlock(s: GameState, post: AdvisorPost, n: number): string | null {
  const c = candidatesOf(s, post).find((x) => x.n === n);
  if (!c) return 'Этого просителя уже нет.';
  if (Math.floor(s.gold) < c.price) return 'Не хватает золота.';
  return null;
}

/**
 * Посадить на место: база очков перекладывается до смены ставки, прежний (если был) уходит без вести, номер — во взятые окна,
 * книга сервера считает найм и плату. Цена уже снята тем, кто зовёт: окном (`hireAdvisor`) или вестью (`payEventCost`).
 */
function seat(s: GameState, post: AdvisorPost, c: Candidate): Advisor {
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

/** Назначить просителя `n`: плата за сезон вперёд из казны — разовая трата описи (`sim/pay.outlay`). */
export function hireAdvisor(s: GameState, post: AdvisorPost, n: number): string | null {
  const block = hireBlock(s, post, n);
  if (block) return block;
  const c = candidatesOf(s, post).find((x) => x.n === n)!;
  if (c.price > 0) {
    s.gold = Math.max(0, s.gold - c.price);
    outlay(s);
  }
  seat(s, post, c);
  return null;
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

/** Сидящих в совете — для счёта живых поимённых (`sim/dynasty.livingNames`). */
export const seatedNames = (s: GameState): string[] => ADVISOR_POSTS.map((p) => s.council?.seats?.[p]?.name).filter((x): x is string => !!x);

// ---------- Весть о пустом месте ----------

/** Вид вести о пустом месте должности. */
export const vacancyEvent = (post: AdvisorPost): string => COUNCIL_EVENT.id(post);

/**
 * Весть о пустом месте: кто ушёл и почему; ответы — «Подождать» (молчание, бесплатно) и «Назначить лучшего» по цене найма.
 * Сидит уже кто-то (назначили окном, пока весть ждала) — назначать некого, и цена ноль.
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
    options: [
      { label: COUNCIL_EVENT.later, apply: (): string => COUNCIL_EVENT.laterSaid },
      {
        label: COUNCIL_EVENT.best,
        hint: (s: GameState): string => {
          const c = councilOf(s).seats[post] ? null : bestCandidate(s, post);
          return c ? `${c.name}, ур. ${c.level}` : COUNCIL_EVENT.none;
        },
        cost: (s: GameState): { gold?: number } => {
          const c = councilOf(s).seats[post] ? null : bestCandidate(s, post);
          return c && c.price > 0 ? { gold: c.price } : {};
        },
        apply: (s: GameState): string => {
          const now = councilOf(s).seats[post];
          if (now) return COUNCIL_EVENT.taken(titleOf(s, post), now.name);
          const c = bestCandidate(s, post);
          if (!c) return COUNCIL_EVENT.none;
          return COUNCIL_LOG.hired(titleOf(s, post), seat(s, post, c).name);
        },
      },
    ],
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
