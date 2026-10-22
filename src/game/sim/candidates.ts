// Просители совета Ратуши (РТ-1, docs/city_v3.md, «Решения РТ-1») — кто просится на должность и найм по окну совета. Едет
// докачкой с окном совета (и с отчётами): первой загрузке он не нужен — шаг партии читает только сидящих (`sim/council`).
//
// **Просители выводятся, а не хранятся.** Список должности — чистая функция сида партии, окна (сезона) и места в списке
// (`candidatesOf`): имя, уровень, черта, возраст, облик и срок службы известны заранее и одни на любом устройстве. Ратуша
// выше — лучше ступень и длиннее список (`councilrules.councilTier`, `candidateCount`); подъём ратуши не опускает ни одного
// кандидата окна. Кого из окна уже взяли, помнит совет (`CouncilState.took`), чтобы ушедший не встал вторым. Посадить на место
// — одна дверь записи `sim/council.seat`; здесь только выбор и плата.
import type { AdvisorPost, AdvisorTrait, FaithId, GameState } from '../types';
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
  serviceYears,
  windowEnd,
  windowOf,
} from '../councilrules';
import { AGENT_EPITHETS, AGENT_NAMES, councilName } from '../data/names';
import { hallLevel } from '../derived';
import { cityName } from '../../../netlify/lib/contract';
import { mixSeed, seeded } from './random';
import { livingNames } from './dynasty';
import { councilOf, seat } from './council';
import { outlay } from './pay';

/** Соль кости просителей: у совета свой поток, кость партии (`s.rolls`) он не двигает — события деревни не едут. */
const CANDIDATE_SALT = 0x63616e64;

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

/** Почему нельзя назначить просителя `n` на должность; `null` — можно. */
export function hireBlock(s: GameState, post: AdvisorPost, n: number): string | null {
  const c = candidatesOf(s, post).find((x) => x.n === n);
  if (!c) return 'Этого просителя уже нет.';
  if (Math.floor(s.gold) < c.price) return 'Не хватает золота.';
  return null;
}

/** Назначить просителя `n`: плата за сезон вперёд из казны — разовая трата описи (`sim/pay.outlay`), посадка — `council.seat`. */
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
