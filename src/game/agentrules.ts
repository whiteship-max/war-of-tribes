// Агенты в Ратуше (АГ-1, docs/city_v3.md, «Решения АГ-1»): кандидаты на места полководца, разведчика, лазутчика и дипломата,
// их характеристики, черты и цена — числа и чистые формулы, одни на игру (`sim/agents`, `sim/recruit`, `sim/recruits`, мир —
// через слепок деревни) и на сервер (`netlify/lib/agentbook.ts`, правило «agents»; война — `war.ts`). Две копии разошлись бы
// молча: сервер посчитал бы честному лазутчику чужую скрытность или пропустил бы кандидата, которого ратуша не давала. Без
// `@/`-импортов: модуль читает серверная часть.
//
// **Кандидаты — тем же механизмом, что просители совета** (РТ-1): окно — сезон, ступень — по ратуше (`councilrules.councilTier`),
// в окне на одного больше ступени, кандидат — чистая функция сида партии, номера (окно, место, место в списке) и ступени. Подъём
// ратуши не опускает ни одного кандидата окна: уровень берётся той же `candidateLevel`, врождённое — первыми костями ряда,
// выпавшего заранее.
//
// **Своих рядов чисел у АГ-1 нет** — каждая величина — шаг лестницы, которую игра уже вывела или назвала:
// - характеристика — кружки **той же лестницы навыка** агента (`data/agents`, пять кружков): врождённое — фора на ней, а не
//   прибавка сверх вершины; поэтому потолки боя, гибели и скрытности, которыми держит сервер (`book.rulePips`,
//   `town.ruleWatch`), не сдвигаются, а W и таблица у ворот, выведенные на лучшем полководце, остаются верными;
// - уровень кандидата — уровень просителя совета (1…3), врождённого — на кружок меньше (0…2): ратуша 1–3 даёт ровных людей;
// - жалованье — ступень жалованья совета (`councilrules.wageAt`, Ц4), плата вперёд — сезон, как у совета;
// - сдвиг покоя у «крепкого» и «хворого» — ступень возраста совета (`ADVISOR_AGE_STEP`);
// - две новые лестницы — диверсия и красноречие — меряются от вершины, названной игрой: лучший диверсант делает за заход
//   вдвое против новичка, лучший дипломат сбавляет дань до доли, с которой логово само просит выкуп (`LAIR_RANSOM_SHARE`).
import type { FigureId } from '../world/types';
import type { Pips } from '../battle/types';
import { PIP_IDS } from '../battle/types';
import { AGENT_AGE0, DEED_XP, MAX_AGENT_LEVEL, RETIRE_AGE } from './data/agents';
import { ADVISOR_AGE_STEP, MAX_ADVISOR_LEVEL, WINDOW_DAYS, candidateLevel, wageAt } from './councilrules';
import { LAIR_RANSOM_SHARE } from '../world/data/parley';
import { mixSeed, seeded } from './sim/random';

/** Места агентов по порядку раздела: полководец, разведчик, лазутчик, дипломат. */
export const AGENT_ROLES: readonly FigureId[] = ['general', 'scout', 'spy', 'diplomat'];

export const isRole = (v: unknown): v is FigureId => typeof v === 'string' && (AGENT_ROLES as readonly string[]).includes(v);

// ---------- Характеристики ----------

/**
 * Характеристики. Каждая — одно число исхода, у которого в игре уже есть одна дверь:
 * - `pips` — отметки полководца (обстрел, сшибка, сеча, манёвр): урон его отряда в фазе боя (`sim/agents.pipsOf` → бой);
 * - `sight` — зоркость разведчика: как широко он открывает землю (`sightBonusOf` → туман);
 * - `stealth` — скрытность лазутчика: доля провалов без поимки и во сколько раз реже гибель (`stealthOf`, `veilOf`);
 * - `sabotage` — диверсия лазутчика: сколько сгорает, уносится и уходит за одно дело против соседа (`world/rivalspy.rivalHarm`);
 * - `eloquence` — красноречие дипломата: на сколько лагерь сбавляет дань за снятие осады (`world/parley.tributeAsk`).
 */
export type AgentStat = 'pips' | 'sight' | 'stealth' | 'sabotage' | 'eloquence';

/** Характеристики места. Скорости и энергии нет нарочно (решения АГ-1): скорость бережёт перехват, энергия — сервер войны. */
export const ROLE_STATS: Readonly<Record<FigureId, readonly AgentStat[]>> = {
  general: ['pips'],
  scout: ['sight'],
  spy: ['stealth', 'sabotage'],
  diplomat: ['eloquence'],
};

/**
 * Растёт ли характеристика с уровнем (опытом дел). Навык места — да: врождённое — фора на той же лестнице. Диверсия — нет: это
 * ремесло, с которым человек пришёл, опыт дел его не прибавляет (иначе лазутчик пятого уровня жёг бы вдвое у любого).
 */
export const GROWS: Readonly<Record<AgentStat, boolean>> = { pips: true, sight: true, stealth: true, sabotage: false, eloquence: true };

/** Врождённое: кружков форы по характеристикам. Нет ключа — ноль. */
export type Head = Partial<Record<AgentStat, number>>;

/** Кружков навыка при уровне `level` и форе `head`: не меньше одного, не выше вершины лестницы. */
export const skillCircles = (level: number, head = 0): number =>
  Math.min(MAX_AGENT_LEVEL, Math.max(1, Math.floor(Number.isFinite(level) ? level : 1)) + Math.max(0, Math.floor(Number.isFinite(head) ? head : 0)));

/** Кружков характеристики, что не растёт с уровнем (диверсия): один и фора. */
export const fixedCircles = (head = 0): number => skillCircles(1, head);

/** Кружков характеристики `stat` у человека уровня `level` с форой `head`. */
export const statCircles = (stat: AgentStat, level: number, head: Head): number =>
  GROWS[stat] ? skillCircles(level, head[stat] ?? 0) : fixedCircles(head[stat] ?? 0);

/** Шаг диверсии за кружок сверх первого: лучший (пять кружков) — вдвое против новичка. */
export const SABOTAGE_STEP = 1 / (MAX_AGENT_LEVEL - 1);

/** Сила диверсии множителем: 1 у новичка, 2 на вершине. Поджог, кража и смута против соседа — во столько раз (`rivalHarm`). */
export const sabotagePower = (circles: number): number => 1 + SABOTAGE_STEP * (skillCircles(circles) - 1);

/**
 * Шаг красноречия за кружок сверх первого: лучший (пять кружков) сбавляет дань на долю `LAIR_RANSOM_SHARE` — до той, с которой
 * логово под нашим лагерем само просит выкуп. Число не новое — порог переговоров (docs/siege_v2.md, 7.2).
 */
export const ELOQUENCE_STEP = LAIR_RANSOM_SHARE / (MAX_AGENT_LEVEL - 1);

/** На какую долю лагерь сбавляет дань при красноречии `circles`: 0 у новичка. */
export const eloquenceCut = (circles: number): number => ELOQUENCE_STEP * (skillCircles(circles) - 1);

// ---------- Черты ----------

/**
 * Черты кандидата (одна или две, с найма и до конца службы). Каждая лежит на оси, которой нет у характеристик: цена найма,
 * жалованье, рост опыта, срок службы. Своих чисел нет — шаг той лестницы, что уже есть.
 */
export type AgentTrait = 'frugal' | 'greedy' | 'apt' | 'hale' | 'frail';

export const AGENT_TRAITS: readonly AgentTrait[] = ['frugal', 'greedy', 'apt', 'hale', 'frail'];

export const isAgentTrait = (v: unknown): v is AgentTrait => typeof v === 'string' && (AGENT_TRAITS as readonly string[]).includes(v);

/** Пары, что не бывают вместе: бережливый и корыстный, крепкий и хворый. */
const CLASH: readonly (readonly [AgentTrait, AgentTrait])[] = [
  ['frugal', 'greedy'],
  ['hale', 'frail'],
];

export const clash = (a: AgentTrait, b: AgentTrait): boolean => a === b || CLASH.some(([x, y]) => (a === x && b === y) || (a === y && b === x));

/** Доля кандидатов с двумя чертами. */
export const SECOND_TRAIT = 0.5;

/** Опыт за дело: «способному» удача даёт на единицу больше — растёт на треть быстрее, неудача — как у всех. */
export const deedXp = (ok: boolean, traits: readonly AgentTrait[]): number =>
  ok ? DEED_XP.ok + (traits.includes('apt') ? 1 : 0) : DEED_XP.fail;

/** Сдвиг покоя «крепкого» и «хворого», лет: ступень возраста совета. */
export const SERVICE_SHIFT = ADVISOR_AGE_STEP;

/** В каком возрасте человек уходит на покой: крепкий — позже на ступень, хворый — раньше. */
export const retireAgeOf = (traits: readonly AgentTrait[]): number =>
  RETIRE_AGE + (traits.includes('hale') ? SERVICE_SHIFT : 0) - (traits.includes('frail') ? SERVICE_SHIFT : 0);

// ---------- Цена ----------

/** Жалованье в игровой день: ступень жалованья совета по уровню кандидата, корыстному — ступенью выше. */
export const recruitWage = (level: number, traits: readonly AgentTrait[]): number =>
  wageAt(Math.max(1, Math.min(MAX_ADVISOR_LEVEL, Math.round(level))) + (traits.includes('greedy') ? 1 : 0));

/** Плата вперёд при найме — жалованье за сезон (`WINDOW_DAYS`), как у совета; бережливый вперёд не берёт. */
export const recruitAdvance = (level: number, traits: readonly AgentTrait[]): number =>
  traits.includes('frugal') ? 0 : Math.round(recruitWage(level, traits) * WINDOW_DAYS);

// ---------- Кандидаты ----------

/** Мест в списке окна на место агента — у лучшей ратуши, как у совета. */
export const RECRUIT_SLOTS = 1 + MAX_ADVISOR_LEVEL;

/** Номер кандидата: окно, место агента и место в списке. Взаимно однозначен. */
export const recruitId = (w: number, role: FigureId, slot: number): number =>
  (Math.max(0, Math.floor(w)) * AGENT_ROLES.length + AGENT_ROLES.indexOf(role)) * RECRUIT_SLOTS + slot;

/** Окно кандидата по номеру. */
export const windowOfRecruit = (n: number): number => Math.floor(n / (RECRUIT_SLOTS * AGENT_ROLES.length));

/** Место агента кандидата по номеру. */
export const roleOfRecruit = (n: number): FigureId => AGENT_ROLES[Math.floor(n / RECRUIT_SLOTS) % AGENT_ROLES.length];

/**
 * Номер имени кандидата в перестановке имён (`data/names.recruitName`): окно шагает по одному, место и место в списке — на семь
 * (семь и сорок взаимно просты): сорок окон подряд на одном месте — сорок разных имён, а в одном окне шестнадцать мест не
 * совпадают. Номер кандидата сам по себе шагал бы на шестнадцать за окно и повторялся бы каждые пять окон.
 */
export const recruitNameIndex = (n: number): number => windowOfRecruit(n) + (n % (RECRUIT_SLOTS * AGENT_ROLES.length)) * 7;

/** Самый молодой кандидат — тот же порог, что был у найма в здании десятого уровня. */
export const RECRUIT_AGE_MIN = 18;

/** Возраст кандидата по кости `u` ∈ [0, 1): от `RECRUIT_AGE_MIN` до ступени возраста старше прихода агента. */
export const recruitAge = (u: number): number =>
  RECRUIT_AGE_MIN + Math.max(0, Math.min(0.999, u)) * (AGENT_AGE0 + SERVICE_SHIFT - RECRUIT_AGE_MIN);

/** Кандидат на место агента: всё, что о нём известно до найма, из сида партии, номера и ступени. */
export interface Recruit {
  n: number;
  role: FigureId;
  /** Уровень кандидата 1…3 — по ступени совета, как у просителя. */
  level: number;
  /** Врождённое: кружков форы по характеристикам, всего `level − 1`. */
  head: Head;
  traits: AgentTrait[];
  age0: number;
  /** Зерно облика: портрет набором персонажа (`render/chambers/advisor/looks.lookOf`). */
  look: number;
}

/** Соль кости кандидатов: свой поток, кость партии (`s.rolls`) и просители совета не едут. */
const RECRUIT_SALT = 0x6167656e;

/**
 * Кандидат номер `n` при ступени `tier`. Порядок костей закреплён — он и есть кандидат: уровень, ряд характеристик (все
 * кружки, сколько бывает, выпадают заранее, ступень берёт первые), черты, возраст, облик.
 */
export function recruitAt(seed: number, n: number, tier: number): Recruit {
  const key = `${seed >>> 0}:${n}:${tier}`;
  const had = MEMO.get(key);
  if (had) return had;
  const r = rollRecruit(seed, n, tier);
  if (MEMO.size >= MEMO_MAX) MEMO.clear();
  MEMO.set(key, r);
  return r;
}

/** Память выведенных кандидатов: шаг партии читает жалованье и навыки нанятых каждый пульс. Чистая — тот же вход, тот же кандидат. */
const MEMO = new Map<string, Recruit>();
const MEMO_MAX = 256;

function rollRecruit(seed: number, n: number, tier: number): Recruit {
  const rnd = seeded(mixSeed(mixSeed(seed >>> 0, RECRUIT_SALT), n));
  const role = roleOfRecruit(n);
  const stats = ROLE_STATS[role];
  const level = candidateLevel(rnd(), Math.max(1, Math.min(MAX_ADVISOR_LEVEL, Math.floor(tier))));
  const row: AgentStat[] = [];
  for (let i = 0; i < MAX_ADVISOR_LEVEL - 1; i++) row.push(stats[Math.min(stats.length - 1, Math.floor(rnd() * stats.length))]);
  const head: Head = {};
  for (const st of row.slice(0, level - 1)) head[st] = (head[st] ?? 0) + 1;
  const pick = (): AgentTrait => AGENT_TRAITS[Math.min(AGENT_TRAITS.length - 1, Math.floor(rnd() * AGENT_TRAITS.length))];
  const first = pick();
  const two = rnd() < SECOND_TRAIT;
  const second = pick();
  const traits = two && !clash(first, second) ? [first, second] : [first];
  const age0 = recruitAge(rnd());
  const look = Math.floor(rnd() * 0x7fffffff);
  return { n, role, level, head, traits, age0, look };
}

// ---------- Отметки полководца ----------

/** Соль склонности полководца по номеру человека — та же, что была в `sim/agents` (слепки прежних партий не сдвигаются). */
const TEMPER_DIE = 0x70697073;
/** Соль склонности нанятого из кандидатов — по номеру кандидата: у каждого кандидата свой склад. */
const TEMPER_RECRUIT = 0x74656d70;

/** Ключ склонности: свой человек — по номеру на месте, нанятый в Ратуше — по номеру кандидата. */
export const temperKey = (person: number, recruit: number | null): number =>
  recruit === null ? mixSeed(TEMPER_DIE, person) : mixSeed(TEMPER_RECRUIT, recruit);

/**
 * Отметки полководца при `circles` кружках (уровень, фора, воинская традиция — не выше вершины): кружков сверх первого — столько
 * же отметок, и каждая ложится в одну из четырёх по склонности (`temperKey`). Чистая функция: один человек растёт всегда
 * одинаково.
 */
export function pipsSpread(seed: number, temper: number, circles: number): Pips {
  const rnd = seeded(mixSeed(seed, temper));
  const out: Pips = {};
  for (let i = 0; i < skillCircles(circles) - 1; i += 1) {
    const pip = PIP_IDS[Math.floor(rnd() * PIP_IDS.length)];
    out[pip] = (out[pip] ?? 0) + 1;
  }
  return out;
}

/**
 * Воинская традиция Статуи уровня `level` (из `maxLevel`): кружков сверх уровня полководца (П4, docs/battle_eu4.md, 14.35).
 * Одна формула на игру (`derived.tradition`) и сервер (потолок отметок).
 */
export function traditionAt(level: number, maxLevel: number): number {
  const l = Math.floor(Number.isFinite(level) ? level : 0);
  if (l < 1 || maxLevel < 1) return 0;
  return Math.ceil((Math.min(l, maxLevel) * MAX_AGENT_LEVEL) / maxLevel) - 1;
}
