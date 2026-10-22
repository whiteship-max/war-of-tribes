// Совет Ратуши (РТ-1, docs/city_v3.md, «Решения РТ-1»): числа и чистые формулы — одни на игру (`sim/council`, `derived`,
// `sim/points`, `sim/upkeep`) и на сервер (`netlify/lib/watch.ts`, правило «council»; `book.ts` — стойкость). Две копии
// разошлись бы молча: сервер счёл бы подделкой честного Казначея или пропустил бы Старосту, которого ратуша не давала. Без
// `@/`-импортов: модуль читает серверная часть.
//
// **Своих чисел здесь два ряда, и оба выведены** (`GIFT_STEP`, `ADVISOR_WAGE` — `npm run pop:report`, раздел «Совет
// Ратуши», неподвижной точкой по целям docs/city_v3.md, «Решения РТ-1»). Остальное — из того, что игра уже сказала:
// лестница навыка (уровни советника — кружки той же лестницы), десять уровней ратуши, возраст прихода и покоя агентов,
// сезон и потолок притока очков у лучшего правителя.
import type { AdvisorPost, AdvisorTrait, RealmBranch } from './types';
import { DAY_LENGTH, MAX_BUILDING_LEVEL } from './constants';
import { SEASON_DAYS } from './data/seasons';
import { AGENT_AGE0, RETIRE_AGE } from './data/agents';
import { MAX_RULER_SKILL, POINTS_PER_SKILL_PER_DAY } from './data/realm';

/** Должности по порядку окна: Староста, Казначей, Воевода. */
export const ADVISOR_POSTS: readonly AdvisorPost[] = ['steward', 'treasurer', 'marshal'];

/**
 * Вид очков правителя, который даёт должность — по одной на вид, как три места советников в EU4 (управление, дипломатия,
 * война). Казначей — дипломатия: в EU4 доход торговли — дело дипломатического советника, а у нас торговля — рынок у ворот и
 * караваны чужих земель.
 */
export const POST_BRANCH: Readonly<Record<AdvisorPost, RealmBranch>> = { steward: 'admin', treasurer: 'diplo', marshal: 'war' };

/** Уровни советника — кружки лестницы навыка: 1…3. Три, а не пять: третья ступень ратуши — последняя, что даёт лучших. */
export const MAX_ADVISOR_LEVEL = 3;

/**
 * Сколько уровней ратуши на ступень совета: десять уровней делятся на три ступени (1–3, 4–6, 7–10). Числа нет — частное
 * потолка постройки и потолка советника.
 */
export const COUNCIL_STEP = Math.floor(MAX_BUILDING_LEVEL / MAX_ADVISOR_LEVEL);

/** Ступень совета при ратуше этого уровня: лучший уровень, какой бывает у кандидата (1…3). Ратуши нет — 0. */
export function councilTier(hall: number): number {
  const h = Math.floor(Number.isFinite(hall) ? hall : 0);
  if (h <= 0) return 0;
  return Math.min(MAX_ADVISOR_LEVEL, 1 + Math.floor((h - 1) / COUNCIL_STEP));
}

/** Сколько кандидатов на должность в окне: на одного больше ступени — выбор растёт вместе с ратушей (2…4). */
export const candidateCount = (hall: number): number => (councilTier(hall) > 0 ? 1 + councilTier(hall) : 0);

/**
 * Уровень кандидата из его кости `u` ∈ [0, 1) при ступени `tier`: равномерно от первого до ступени. Кость у кандидата своя и
 * при подъёме ратуши не меняется, поэтому подъём не опускает ни одного кандидата окна — только поднимает.
 */
export const candidateLevel = (u: number, tier: number): number => Math.max(1, Math.min(tier, 1 + Math.floor(Math.max(0, Math.min(0.999999, u)) * tier)));

/** Кандидаты меняются с сезоном: окно — номер сезона, игровых дней в нём — `SEASON_DAYS`. */
export const WINDOW_DAYS = SEASON_DAYS;

/** Окно просителей в игровую секунду `time` — номер сезона партии. */
export const windowOf = (time: number): number => Math.floor(Math.max(0, time) / (WINDOW_DAYS * DAY_LENGTH));

/** Игровая секунда, когда окно `w` сменится следующим. */
export const windowEnd = (w: number): number => (w + 1) * WINDOW_DAYS * DAY_LENGTH;

/** Мест в списке окна на должность — у лучшей ратуши; номер кандидата отводит их всем (`candidateId`). */
export const SLOTS = 1 + MAX_ADVISOR_LEVEL;

/** Номер кандидата: окно, должность и место в списке. Взаимно однозначен — по нему взятого не показывают второй раз. */
export const candidateId = (w: number, post: AdvisorPost, slot: number): number =>
  (Math.max(0, Math.floor(w)) * ADVISOR_POSTS.length + ADVISOR_POSTS.indexOf(post)) * SLOTS + slot;

/** Окно кандидата по его номеру — сервер сверяет, что нанятый пришёл из окна своего найма. */
export const windowOfCandidate = (n: number): number => Math.floor(n / (SLOTS * ADVISOR_POSTS.length));

/** Должность кандидата по его номеру. */
export const postOfCandidate = (n: number): AdvisorPost => ADVISOR_POSTS[Math.floor(n / SLOTS) % ADVISOR_POSTS.length];

// ---------- Черты ----------

/**
 * Черты. Каждая сдвигает **одно** число советника на ступень его же лестницы — своих чисел у черт нет: усердный приносит как
 * уровень выше, корыстный просит как уровень выше, книжник даёт очко сверх уровня, бережливый не берёт платы за сезон
 * вперёд, крепкий доживает до покоя, хворый умирает на службе.
 */
export const TRAITS: readonly AdvisorTrait[] = ['zealous', 'scholar', 'frugal', 'hale', 'frail', 'greedy'];

export const isTrait = (v: unknown): v is AdvisorTrait => typeof v === 'string' && (TRAITS as readonly string[]).includes(v);
export const isPost = (v: unknown): v is AdvisorPost => typeof v === 'string' && (ADVISOR_POSTS as readonly string[]).includes(v);

// ---------- Польза ----------

/**
 * Польза одной ступени: Староста — доля к скорости стройки и к добыче дворов, Казначей — доля к налогу и выручке рынка,
 * Воевода — очки стойкости (мораль дружины в бою, как обряд веры). **Выведены** `npm run pop:report -- --council-derive`
 * (Ц1…Ц3, docs/city_v3.md, «Решения РТ-1»); руками не правят.
 */
export const GIFT_STEP: Readonly<Record<AdvisorPost, number>> = { steward: 0.05, treasurer: 0.05, marshal: 3 };

/** Ступеней пользы у советника: уровень, у усердного — на одну больше. */
export const giftSteps = (level: number, trait: AdvisorTrait): number => levelOf(level) + (trait === 'zealous' ? 1 : 0);

/** Польза советника: доля (Староста, Казначей) или очки стойкости (Воевода). */
export const giftOf = (post: AdvisorPost, level: number, trait: AdvisorTrait): number => GIFT_STEP[post] * giftSteps(level, trait);

/** Самая большая польза должности — потолок сервера: третий уровень и усердие. */
export const giftCeil = (post: AdvisorPost): number => GIFT_STEP[post] * (MAX_ADVISOR_LEVEL + 1);

/** Уровень в пределах лестницы, целым. */
export const levelOf = (level: number): number => Math.max(1, Math.min(MAX_ADVISOR_LEVEL, Math.round(Number.isFinite(level) ? level : 1)));

// ---------- Очки правителя ----------

/** Сколько очков своего вида в игровой день даёт советник: кружок за уровень, книжнику — ещё один. */
export const advisorPoints = (level: number, trait: AdvisorTrait): number => (levelOf(level) + (trait === 'scholar' ? 1 : 0)) * POINTS_PER_SKILL_PER_DAY;

/**
 * Ставка вида с советником: навык правителя плюс кружки советника, **не выше лучшего правителя** (`MAX_RULER_SKILL`).
 * Совет дотягивает слабого правителя до сильного и никогда не обгоняет сильнейшего: потолок очков, цена уровня технологии и
 * потолок книги стабильности сервера стоят на ставке лучшего правителя и от совета не едут (docs/dynasty.md, раздел 3.3).
 */
export const rateWithCouncil = (rulerRate: number, adv: number): number =>
  Math.min(MAX_RULER_SKILL * POINTS_PER_SKILL_PER_DAY, Math.max(0, rulerRate) + Math.max(0, adv));

// ---------- Цена ----------

/**
 * Жалованье советника уровней 1…3, золотом за игровой день. **Выведено** (Ц4): половина валовой пользы Казначея этого уровня
 * в ту минуту, когда ратуша ровной игры впервые даёт такого кандидата, — цена одна на уровень, как в EU4, польза у должности
 * своя. Руками не правят.
 */
export const ADVISOR_WAGE: readonly number[] = [0, 0.6, 3, 9];

/** Жалованье по ступеням: за третьей — прямой от второй к третьей (корыстному советнику третьего уровня). */
export function wageAt(steps: number): number {
  const n = Math.max(1, Math.round(steps));
  if (n <= MAX_ADVISOR_LEVEL) return ADVISOR_WAGE[n];
  const last = ADVISOR_WAGE[MAX_ADVISOR_LEVEL];
  return last + (n - MAX_ADVISOR_LEVEL) * (last - ADVISOR_WAGE[MAX_ADVISOR_LEVEL - 1]);
}

/** Жалованье советника за игровой день: по уровню, корыстному — ступенью выше. */
export const advisorWage = (level: number, trait: AdvisorTrait): number => wageAt(levelOf(level) + (trait === 'greedy' ? 1 : 0));

/** Плата за найм — жалованье за сезон вперёд (`WINDOW_DAYS`); бережливый вперёд не берёт. */
export const hirePrice = (level: number, trait: AdvisorTrait): number =>
  trait === 'frugal' ? 0 : Math.round(advisorWage(level, trait) * WINDOW_DAYS);

// ---------- Возраст и конец службы ----------

/**
 * Ступень возраста: жизнь агента от прихода до покоя (`AGENT_AGE0`…`RETIRE_AGE`) на пять равных частей — первая молодость
 * без опыта, три уровня советника, последняя — покой. Уровень L приходит в возрасте своей части: опыт — это годы.
 */
export const ADVISOR_AGE_STEP = (RETIRE_AGE - AGENT_AGE0) / (MAX_ADVISOR_LEVEL + 2);

/** Возраст кандидата уровня `level` по кости `u` ∈ [0, 1): внутри своей ступени возраста. */
export const advisorAge = (level: number, u: number): number => AGENT_AGE0 + (levelOf(level) + Math.max(0, Math.min(0.999, u))) * ADVISOR_AGE_STEP;

/**
 * Доля тех, кто умирает на службе, а не уходит на покой: чем старше пришёл, тем вероятнее (0 у самого молодого, 1 у дожившего
 * до покоя). Своего числа у смертности нет — она выведена из тех же лет агента. Крепкий не умирает, хворый умирает.
 */
export function deathShare(age0: number, trait: AdvisorTrait): number {
  if (trait === 'hale') return 0;
  if (trait === 'frail') return 1;
  return Math.max(0, Math.min(1, (age0 - AGENT_AGE0) / (RETIRE_AGE - AGENT_AGE0)));
}

/**
 * Через сколько лет кончится служба: `fate` и `when` — кости кандидата ∈ [0, 1). Умирает (`fate < deathShare`) — в год,
 * равномерно взятый до покоя; нет — в `RETIRE_AGE`. Год хотя бы один: только что нанятый не умирает в тот же день.
 */
export function serviceYears(age0: number, trait: AdvisorTrait, fate: number, when: number): { years: number; dies: boolean } {
  const left = Math.max(1, RETIRE_AGE - age0);
  const dies = fate < deathShare(age0, trait);
  return { years: dies ? 1 + Math.max(0, Math.min(1, when)) * (left - 1) : left, dies };
}
