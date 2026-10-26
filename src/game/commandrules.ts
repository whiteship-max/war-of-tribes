// Командиры флангов (ДР-3, docs/siege_v2.md, «Решения ДР-3»): кандидаты в «Командующие», род, тактика, черты, цена и что скажет
// знать — числа и чистые формулы, одни на игру (`sim/command`, `sim/commanders`, окно «Командующие») и на сервер
// (`netlify/lib/commandbook.ts`, правило «command»; война — `war.ts`). Две копии разошлись бы молча: сервер посчитал бы честному
// командиру чужую тактику или пропустил бы кандидата, которого Казармы не давали. Без `@/`-импортов: модуль читает серверная часть.
//
// **Кандидаты — механизмом агентов АГ-1** (`agentrules`): окно — сезон, ступень — по Казармам (`councilrules.councilTier` — та же
// лестница, что у ратуши), в окне на одного больше ступени, кандидат — чистая функция сида партии, номера и ступени. Подъём
// Казарм не опускает ни одного кандидата окна: уровень — той же `candidateLevel`, тактика с уровнем не убывает.
//
// **Своих рядов чисел два, и оба выведены:** вершина тактики — из полководца (`TACTICS_TOP`, `npm run fight -- --derive-flank`),
// милость и обида знати — из порогов лояльности EU4 (`LORD_FAVOR`, `COMMONER_SLIGHT`, формулой, как зависть РТ-2). Цена,
// жалованье, черты, возраст и покой — шаги лестниц агентов.
import type { FlankSector, Flanks } from '../battle/types';
import type { Flank } from './types';
import { AGENT_YEAR, MAX_AGENT_LEVEL, levelOf } from './data/agents';
import { AGENT_TRAITS, SECOND_TRAIT, clash, recruitAge, retireAgeOf, type AgentTrait } from './agentrules';
import { MAX_ADVISOR_LEVEL, candidateCount, candidateLevel, councilTier } from './councilrules';
import { DISLOYAL, LOYAL, LOYALTY_BASE } from './estaterules';
import { mixSeed, seeded } from './sim/random';

// ---------- Места ----------

/** Места командиров: левый и правый фланг. Центр ведёт сам полководец (К1). */
export type { Flank };

export const FLANKS: readonly Flank[] = ['left', 'right'];

export const isFlank = (v: unknown): v is Flank => v === 'left' || v === 'right';

/** Сектор ядра боя каждого места: левый фланг своей армии — `A` (полоса 0), правый — `C` (полоса 2). */
export const FLANK_SECTOR: Readonly<Record<Flank, FlankSector>> = { left: 'A', right: 'C' };

// ---------- Род ----------

/** Род кандидата: безродный тактик или знатный лорд. */
export type Birth = 'low' | 'noble';

/** Черты командира — черты агента без «способного»: опыта у командира нет (К7). */
export const COMMAND_TRAITS: readonly AgentTrait[] = AGENT_TRAITS.filter((t) => t !== 'apt');

// ---------- Тактика ----------

/**
 * Вершина тактики безродного, отметок на своём фланге: наибольшая, при которой двое лучших тактиков на обоих флангах не сильнее
 * лучшего полководца (четыре отметки, по одной в каждую) — подчинённые не сильнее того, кому подчинены (К4). **Выводит
 * `npm run fight -- --derive-flank`**; руками не правится.
 */
export const TACTICS_TOP = 2;

/**
 * Тактика командира уровня `level`, отметок со знаком: безродный — доля вершины по уровню, вверх до целого; лорд — зеркало, на
 * вершину и ещё одну отметку ниже (бездарен на столько, на сколько тактик даровит). Казармы выше — оба лучше.
 */
export function tacticsOf(birth: Birth, level: number): number {
  const l = Math.max(1, Math.min(MAX_ADVISOR_LEVEL, Math.floor(Number.isFinite(level) ? level : 1)));
  const up = Math.ceil((l * TACTICS_TOP) / MAX_ADVISOR_LEVEL);
  return birth === 'low' ? up : up - TACTICS_TOP - 1;
}

// ---------- Знать ----------

/**
 * Милость рыцарства лорду на месте командира, лояльности. **Выведена формулой** из порогов (К5): Т4 — два лорда при ровной знати
 * делают её верной (`50 + 2F ≥ 60`), Т5 — один ещё нет (`50 + F < 60`); середина допустимого.
 */
export const LORD_FAVOR = ((LOYAL - LOYALTY_BASE) / 2 + (LOYAL - LOYALTY_BASE)) / 2;

/**
 * Обида рыцарства на безродного на месте командира, лояльности. **Выведена формулой** (К5): Т6 — два безродных при ровной знати —
 * ропот (`50 − 2S < 30`), Т7 — один ещё нет (`50 − S ≥ 30`); середина допустимого.
 */
export const COMMONER_SLIGHT = ((LOYALTY_BASE - DISLOYAL) / 2 + (LOYALTY_BASE - DISLOYAL)) / 2;

/** Что место командира этого рода кладёт в лояльность рыцарства. */
export const birthLoyalty = (birth: Birth): number => (birth === 'noble' ? LORD_FAVOR : -COMMONER_SLIGHT);

/** Слагаемое лояльности рыцарства от людей на местах командиров (`estaterules.loyaltyParts`, поле `lead`). */
export const leadLoyalty = (births: readonly Birth[]): number => births.reduce((n, b) => n + birthLoyalty(b), 0);

// ---------- Кандидаты ----------

/** Мест в списке окна — у лучших Казарм, как у совета. */
export const COMMAND_SLOTS = 1 + MAX_ADVISOR_LEVEL;

/** Ступень кандидатов по уровню Казарм — лестница ратуши (1–3, 4–6, 7–10). */
export const commandTier = (barracks: number): number => councilTier(barracks);

/** Сколько кандидатов в окне при Казармах уровня `barracks` (2…4). */
export const commanderCount = (barracks: number): number => candidateCount(barracks);

/** Номер кандидата: окно и место в списке. Взаимно однозначен. */
export const commanderId = (w: number, slot: number): number => Math.max(0, Math.floor(w)) * COMMAND_SLOTS + slot;

/** Окно кандидата по номеру. */
export const windowOfCommander = (n: number): number => Math.floor(n / COMMAND_SLOTS);

/** Место кандидата в списке окна. */
export const slotOfCommander = (n: number): number => n % COMMAND_SLOTS;

/** Род по месту в списке: чётное — безродный тактик, нечётное — знатный лорд; в каждом окне есть оба (К2). */
export const birthOf = (n: number): Birth => (slotOfCommander(n) % 2 === 0 ? 'low' : 'noble');

/**
 * Номер имени кандидата в перестановке имён (`data/names.commanderName`): окно шагает по одному, место в списке — на семь — в
 * одном окне четыре места не совпадают, а сорок окон подряд на одном месте — сорок разных имён.
 */
export const commanderNameIndex = (n: number): number => windowOfCommander(n) + slotOfCommander(n) * 7;

/** Кандидат в командиры: всё, что о нём известно до найма, из сида партии, номера и ступени. */
export interface Commander {
  n: number;
  birth: Birth;
  /** Уровень 1…3 — по ступени Казарм, как у кандидата в агенты. */
  level: number;
  /** Тактика — отметок со знаком на своём фланге (`tacticsOf`). */
  tactics: number;
  traits: AgentTrait[];
  age0: number;
  /** Зерно облика: портрет набором персонажа. */
  look: number;
  /**
   * Уровень на службе (ДР-5): уровень найма и рост за бои (`servedCommander`). Нет поля — кандидат, не служивший. Жалованье —
   * по уровню найма (`level`), тактика — по этому.
   */
  rank?: number;
}

/** Соль кости кандидатов в командиры: свой поток — кость партии, агенты и совет не едут. */
const COMMAND_SALT = 0x636d6472;

/**
 * Кандидат номер `n` при ступени `tier`. Порядок костей закреплён — он и есть кандидат: уровень, черты, возраст, облик. Род — по
 * месту в списке, не костью.
 */
export function commanderAt(seed: number, n: number, tier: number): Commander {
  const key = `${seed >>> 0}:${n}:${tier}`;
  const had = MEMO.get(key);
  if (had) return had;
  const c = rollCommander(seed, n, tier);
  if (MEMO.size >= MEMO_MAX) MEMO.clear();
  MEMO.set(key, c);
  return c;
}

/** Память выведенных кандидатов: шаг партии и мост читают жалованье и тактику нанятых каждый пульс. */
const MEMO = new Map<string, Commander>();
const MEMO_MAX = 64;

function rollCommander(seed: number, n: number, tier: number): Commander {
  const rnd = seeded(mixSeed(mixSeed(seed >>> 0, COMMAND_SALT), n));
  const birth = birthOf(n);
  const level = candidateLevel(rnd(), Math.max(1, Math.min(MAX_ADVISOR_LEVEL, Math.floor(tier))));
  const pick = (): AgentTrait => COMMAND_TRAITS[Math.min(COMMAND_TRAITS.length - 1, Math.floor(rnd() * COMMAND_TRAITS.length))];
  const first = pick();
  const two = rnd() < SECOND_TRAIT;
  const second = pick();
  const traits = two && !clash(first, second) ? [first, second] : [first];
  const age0 = recruitAge(rnd());
  const look = Math.floor(rnd() * 0x7fffffff);
  return { n, birth, level, tactics: tacticsOf(birth, level), traits, age0, look };
}

/** Почему номер `n` не кандидат окна `w` при ступени `tier`; `null` — кандидат. Одна проверка на игру и на книгу сервера. */
export function commanderFault(n: number, w: number, tier: number): string | null {
  if (!Number.isInteger(n) || n < 0) return `номер кандидата ${n} не целый`;
  if (windowOfCommander(n) !== w) return `кандидат №${n} не из окна своего найма`;
  if (tier < 1 || tier > MAX_ADVISOR_LEVEL) return `ступень найма ${tier} вне 1…${MAX_ADVISOR_LEVEL}`;
  if (slotOfCommander(n) >= 1 + tier) return `кандидат №${n} — ${slotOfCommander(n) + 1}-й в списке, а ступень ${tier} даёт ${1 + tier}`;
  return null;
}

// ---------- Служба ----------

/** В каком возрасте командир уходит на покой — возраст агента: крепкий позже, хворый раньше (К7). */
export const commandRetireAge = (traits: readonly AgentTrait[]): number => retireAgeOf(traits);

/** Возраст командира, годы — дробные: возраст кандидата и годы службы с минуты найма (год агента, `AGENT_YEAR`). */
export const commandAgeAt = (age0: number, hiredAt: number, now: number): number => age0 + Math.max(0, now - hiredAt) / AGENT_YEAR;

/** Ушёл ли бы на покой командир этого кандидата, нанятый в `hiredAt`, к игровой секунде `now`. */
export const commandRetired = (c: Commander, hiredAt: number, now: number): boolean =>
  commandAgeAt(c.age0, hiredAt, now) >= commandRetireAge(c.traits);

/**
 * Ступеней командира за опыт (ДР-5, «медленно» — выводом): опыт копится той же лестницей, что у агентов (`levelOf`, дела не
 * чаще `DEED_GAP`, `DEED_XP`), а лестница командира короче — три ступени против пяти, — и ступень агента сжимается на неё:
 * `⌊(ступень агента − 1) × (3 − 1) / (5 − 1)⌋`. Командир поднимается на ступень за две ступени агента.
 */
export const commandGrowth = (xp: number): number =>
  Math.floor(((levelOf(Math.max(0, Number.isFinite(xp) ? xp : 0)) - 1) * (MAX_ADVISOR_LEVEL - 1)) / (MAX_AGENT_LEVEL - 1));

/**
 * Командир на месте с опытом `xp` (ДР-5): уровень на службе — уровень найма и рост, не выше вершины лестницы; тактика — по нему
 * (`tacticsOf`, с уровнем не убывает — и у тактика, и у лорда). Жалованье остаётся по уровню найма: книга платы сервера
 * сверяет его с ценой кандидата. Одна функция на игру (`derived.commanderOn`) и на книгу сервера (`commandbook.commandAt`).
 */
export function servedCommander(c: Commander, xp: number): Commander {
  const rank = Math.min(MAX_ADVISOR_LEVEL, c.level + commandGrowth(xp));
  return { ...c, rank, tactics: tacticsOf(c.birth, rank) };
}

/** Человек на месте по его метке найма и опыту (ДР-5): кандидат номера и ступени, выросший за службу. */
export const commanderSeated = (seed: number, seat: { n: number; tier: number; xp?: number }): Commander =>
  servedCommander(commanderAt(seed, seat.n, seat.tier), seat.xp ?? 0);

// ---------- В бой ----------

/** Тактика людей на местах — поле стороны боя (`ArmySetup.flanks`); пустое место и ноль тактики в поле не едут. */
export function flanksFrom(seats: Partial<Record<Flank, number>>): Flanks {
  const out: Flanks = {};
  for (const f of FLANKS) {
    const t = seats[f];
    if (t !== undefined && Number.isFinite(t) && t !== 0) out[FLANK_SECTOR[f]] = t;
  }
  return out;
}
