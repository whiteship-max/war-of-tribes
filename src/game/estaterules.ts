// Сословия (РТ-2, docs/stability.md, «РТ-2»): числа и чистые формулы — одни на игру (`sim/estates`, `derived`) и на сервер
// (`netlify/lib/watch.ts`, правило «estates»; потолки `build.ts`, `goods.ts`, `book.ts`). Две копии разошлись бы молча: сервер
// счёл бы подделкой честную опору или пропустил бы указ сословия, которое его не открывало. Без `@/`-импортов: модуль читает
// серверная часть.
//
// **Своих чисел здесь один ряд, и он выведен** (`ESTATE_PLUS`, `ESTATE_MINUS` — `ESTATES_DERIVE=1 npm run stability:report`,
// раздел «Сословия», неподвижной точкой по цели Ц5). Лояльность привилегии и зависть (`PRIV_LOYALTY`, `ENVY`) выведены
// формулой из целей Т1–Т3. Остальное — из устройства: пять сословий делят сто процентов, перевес — больше всех остальных
// вместе, пороги лояльности — EU4 (60 и 30), шкала стойкости — шаг Воеводы РТ-1.
import type { BuildingTypeId, EstateId } from './types';
import { GIFT_STEP } from './councilrules';

/** Сословия по порядку окна. */
export const ESTATES: readonly EstateId[] = ['merchants', 'guilds', 'peasants', 'knights', 'clergy'];

export const isEstate = (v: unknown): v is EstateId => typeof v === 'string' && (ESTATES as readonly string[]).includes(v);

/**
 * Постройки сословия — его вес в городе (docs/stability.md, Р1.1). Площадь, Ратуша и Жилища — общие: город, а не сословие.
 * Каждая постройка — ровно у одного сословия (тест).
 */
export const ESTATE_HALLS: Readonly<Record<EstateId, readonly BuildingTypeId[]>> = {
  merchants: ['market', 'tavern', 'storage', 'cache'],
  guilds: ['workshop', 'smithy'],
  peasants: ['farm', 'hunter_hut', 'sawmill', 'mine'],
  knights: ['barracks', 'stable', 'palisade', 'tower', 'watch', 'statue'],
  clergy: ['church', 'infirmary'],
};

/** Чья постройка: сословие или `null` (общая). */
export const hallEstate = (type: string): EstateId | null => ESTATES.find((e) => ESTATE_HALLS[e].includes(type as BuildingTypeId)) ?? null;

// ---------- Влияние ----------

/** Ровная доля: пять сословий делят сто процентов. */
export const ESTATE_EVEN = 100 / ESTATES.length;

/** Перевес — больше всех остальных вместе. */
export const ESTATE_DOMINANT = 50;

/** Специализация — на полпути от ровной доли к перевесу. */
export const ESTATE_SPECIAL = (ESTATE_EVEN + ESTATE_DOMINANT) / 2;

/** Привилегий у сословия. Две: опора — это сословие, которому отдано всё, что у него можно отдать. */
export const PRIV_MAX = 2;

/** Привилегий всего. */
export const PRIV_TOTAL = PRIV_MAX * ESTATES.length;

/** Доля влияния одной привилегии: все дарованы — влияние делят только они. */
export const PRIV_SHARE = 100 / PRIV_TOTAL;

/** Уровни построек по типу — как опись и книга стройки (`build.Levels`). */
export type EstateLevels = Readonly<Partial<Record<string, number>>>;

/** Привилегии по сословиям. */
export type Privileges = Readonly<Partial<Record<EstateId, number>>>;

/** Привилегий у сословия — целым, в пределах лестницы. */
export const privOf = (priv: Privileges | undefined, e: EstateId): number => {
  const n = priv?.[e] ?? 0;
  return Number.isFinite(n) ? Math.max(0, Math.min(PRIV_MAX, Math.floor(n))) : 0;
};

/** Привилегий дарованных всего. */
export const privTotal = (priv: Privileges | undefined): number => ESTATES.reduce((n, e) => n + privOf(priv, e), 0);

/** Вес сословия в городе — средний уровень его построек. */
export function weightOf(levels: EstateLevels, e: EstateId): number {
  const halls = ESTATE_HALLS[e];
  const sum = halls.reduce((n, t) => n + Math.max(0, Number.isFinite(levels[t]) ? Math.floor(levels[t] as number) : 0), 0);
  return sum / halls.length;
}

/**
 * Влияние сословий, % (сумма — сто): доля по весу построек делит то, что не отдано привилегиями, каждая привилегия — десятая
 * доля (docs/stability.md, Р1.1). Город без построек — ровные доли.
 */
export function influenceOf(levels: EstateLevels, priv?: Privileges): Record<EstateId, number> {
  const w = ESTATES.map((e) => weightOf(levels, e));
  const all = w.reduce((a, b) => a + b, 0);
  const left = 1 - privTotal(priv) / PRIV_TOTAL;
  return Object.fromEntries(
    ESTATES.map((e, i) => [e, (all > 0 ? (100 * w[i]) / all : ESTATE_EVEN) * left + PRIV_SHARE * privOf(priv, e)]),
  ) as Record<EstateId, number>;
}

/** Специализация города: сословие с наибольшим влиянием, если оно не ниже `ESTATE_SPECIAL`; иначе город ровный. */
export function specialOf(infl: Readonly<Record<EstateId, number>>): EstateId | null {
  const lead = ESTATES.reduce((a, b) => (infl[b] > infl[a] ? b : a));
  return infl[lead] >= ESTATE_SPECIAL ? lead : null;
}

// ---------- Лояльность ----------

/** Ровная лояльность: середина шкалы. */
export const LOYALTY_BASE = 50;
/** Верны — с этого порога, ропщут — ниже `DISLOYAL` (пороги EU4). */
export const LOYAL = 60;
export const DISLOYAL = 30;

/**
 * Зависть: сколько лояльности снимает у сословия каждая привилегия, дарованная другому. **Выведена формулой** из целей
 * (docs/stability.md, Р3): Т1 — одна привилегия двум опорам, прочие не ропщут (`50 − 2J ≥ 30`, J ≤ 10); Т3 — по две двум опорам,
 * пренебрежённые ропщут (`50 − 4J < 30`, J > 5). Взята середина допустимого.
 */
export const ENVY = ((LOYALTY_BASE - DISLOYAL) / 4 + (LOYALTY_BASE - DISLOYAL) / 2) / 2;

/**
 * Лояльность своей привилегии. **Выведена формулой**: Т1 — одна привилегия двум опорам, обе верны (`50 + P − J ≥ 60`);
 * Т2 — по одной всем пятерым, никто не рад больше, чем без них (`50 + P − 4J < 50`). Середина допустимого.
 */
export const PRIV_LOYALTY = (LOYAL - LOYALTY_BASE + ENVY + (ESTATES.length - 1) * ENVY) / 2;

/** Перевес требует больше: сколько лояльности снимает каждый процент влияния выше `ESTATE_DOMINANT`. */
export const greedOf = (infl: number): number => Math.max(0, infl - ESTATE_DOMINANT);

/** Слагаемые лояльности сословия: ровная, свои привилегии, чужие, вести и дары, перевес. */
export interface LoyaltyParts {
  base: number;
  own: number;
  envy: number;
  mood: number;
  greed: number;
}

export function loyaltyParts(e: EstateId, priv: Privileges | undefined, infl: number, mood: number): LoyaltyParts {
  const own = privOf(priv, e);
  return {
    base: LOYALTY_BASE,
    own: PRIV_LOYALTY * own,
    envy: -ENVY * (privTotal(priv) - own),
    mood: Number.isFinite(mood) ? mood : 0,
    greed: -greedOf(infl),
  };
}

/** Лояльность из слагаемых, 0…100. */
export const loyaltyFrom = (p: LoyaltyParts): number => Math.max(0, Math.min(100, p.base + p.own + p.envy + p.mood + p.greed));

/** Во сколько раз верное сословие даёт свой плюс: 50 — как есть, 100 — вдвое, 0 — ничего. */
export const loyaltyFactor = (loyalty: number): number => Math.max(0, Math.min(100, loyalty)) / LOYALTY_BASE;

// ---------- Нрав: сила, плюс и минус ----------

/** Сколько силы даёт указ сословия: сила перевеса. */
export const DECREE_STRENGTH = (ESTATE_DOMINANT - ESTATE_EVEN) / (100 - ESTATE_EVEN);

/** Сила сословия, 0…1: насколько его влияние выше ровной доли; указ — сила перевеса сверху. */
export const strengthOf = (infl: number, decree = false): number =>
  Math.min(1, Math.max(0, (infl - ESTATE_EVEN) / (100 - ESTATE_EVEN)) + (decree ? DECREE_STRENGTH : 0));

/**
 * Плюс сословия при силе 1 и ровной лояльности — доля своего дела (docs/stability.md, Р1.3): купцы — золото налога и рынка,
 * цехи — скорость стройки, крестьяне — добыча дворов и прирост, рыцари — стойкость (долей шкалы `FERVOUR_SCALE`), духовенство —
 * налог в недовольстве податных меньше на эту долю и набожность (долей шкалы `PIETY_SCALE`). **Выведен** неподвижной точкой
 * (`ESTATES_DERIVE=1 npm run stability:report`, Ц5: опора даёт своему делу +10 %). Руками не правят.
 */
export const ESTATE_PLUS: Readonly<Record<EstateId, number>> = { merchants: 0.248, guilds: 0.339, peasants: 0.243, knights: 0.3, clergy: 0.201 };

/**
 * Минус сословия при силе 1 — доля (лояльности не спрашивает): купцы — стойкость дружины (долей `FERVOUR_SCALE`), цехи — хлеб,
 * который ест город, крестьяне — золото налога, рыцари — жалованье войска и прирост, духовенство — десятина с налога.
 * **Выведен** тем же прогоном (Ц5: опора платит −5 %). Руками не правят.
 */
export const ESTATE_MINUS: Readonly<Record<EstateId, number>> = { merchants: 0.242, guilds: 0.331, peasants: 0.237, knights: 0.292, clergy: 0.196 };

/** Шкала стойкости: шаг Воеводы РТ-1 — пять процентов стартовой морали дружины мерки, значит вся шкала — двадцать шагов. */
export const FERVOUR_SCALE = GIFT_STEP.marshal * 20;

/** Шкала набожности: 0…100. */
export const PIETY_SCALE = 100;

/** Плюс сословия долей: сила × лояльность. */
export const plusOf = (e: EstateId, strength: number, loyalty: number): number => ESTATE_PLUS[e] * Math.max(0, strength) * loyaltyFactor(loyalty);

/** Минус сословия долей: сила. */
export const minusOf = (e: EstateId, strength: number): number => ESTATE_MINUS[e] * Math.max(0, strength);

// ---------- Ропот ----------

/** Ропот сословия со всем влиянием и нулевой лояльностью — недовольство податных целиком. */
export const ESTATE_DISCONTENT = 100;

/** Причина у податных: ропот сословия, % (docs/stability.md, Р1.5). Лояльность 50 и выше — не ропщет. */
export const murmurOf = (infl: number, loyalty: number): number =>
  (ESTATE_DISCONTENT * Math.max(0, Math.min(100, infl)) * Math.max(0, LOYALTY_BASE - Math.max(0, Math.min(100, loyalty)))) / (100 * LOYALTY_BASE);

// ---------- Сервер: потолки ----------

/** Самое большое, что вести и дары кладут в лояльность разом: дар (своя привилегия на сезон) и милость вести (зависть). */
export const MOOD_MAX = PRIV_LOYALTY + ENVY;

/** Лояльность сословия не выше этого — при любых дарах и вестях. */
export const loyaltyCeil = (e: EstateId, priv: Privileges | undefined, infl: number): number => loyaltyFrom(loyaltyParts(e, priv, infl, MOOD_MAX));

/** Наибольший плюс сословия при подтверждённом влиянии и указе: лояльность — сверху, сто. */
export const plusCeil = (e: EstateId, infl: number, decree: boolean): number => plusOf(e, strengthOf(infl, decree), 100);

/** Наибольший минус. */
export const minusCeil = (e: EstateId, infl: number, decree: boolean): number => minusOf(e, strengthOf(infl, decree));

/** Что сословия могут дать сверху — потолки книги сервера по рычагам (правило «estates»). */
export interface EstateCeil {
  /** Множитель скорости стройки — цехи. */
  build: number;
  /** Множитель добычи дворов — крестьяне. */
  yard: number;
  /** Множитель прироста — крестьяне. */
  growth: number;
  /** Множитель хлеба, который ест город, — минус цехов. */
  food: number;
  /** Множитель жалованья войска — минус рыцарей. */
  wage: number;
  /** Очки стойкости сверх обряда и Воеводы — рыцари. */
  resolve: number;
}

/**
 * Потолки рычагов сословий при этих уровнях, привилегиях и указе: влияние — точно (`influenceOf`), лояльность — сверху (сто).
 * Сервер считает их по подтверждённым уровням и привилегиям описи; честная партия не выходит за них ни при каком даре и вести.
 */
export function estateCeil(levels: EstateLevels, priv: Privileges | undefined, decree: EstateId | null): EstateCeil {
  const infl = influenceOf(levels, priv);
  const p = (e: EstateId): number => plusCeil(e, infl[e], decree === e);
  const m = (e: EstateId): number => minusCeil(e, infl[e], decree === e);
  return { build: 1 + p('guilds'), yard: 1 + p('peasants'), growth: 1 + p('peasants'), food: 1 + m('guilds'), wage: 1 + m('knights'), resolve: FERVOUR_SCALE * p('knights') };
}

/** Привилегии описи сервера по порядку сословий — словарём; чужое и лишнее не садится, число — в пределах лестницы. */
export function privFromRow(row: readonly number[] | undefined): Partial<Record<EstateId, number>> {
  const out: Partial<Record<EstateId, number>> = {};
  ESTATES.forEach((e, i) => {
    const n = privOf({ [e]: row?.[i] ?? 0 }, e);
    if (n > 0) out[e] = n;
  });
  return out;
}
