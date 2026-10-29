// Черты правителя (ПН-2, docs/gdd/path_of_sword.md, 3.2.3 и «Решения ПН-2»; решение владельца П10) — по образцу черт агентов
// (`data/traits.ts`): счёт дел → чистая функция → черты; хранить черты незачем, хранится только счёт дел (`Ruler.deeds`, у героя
// пути — `RoamHero.deeds`), а пишет его одна дверь — `sim/dynasty.noteRulerDeed`.
//
// Четыре правила, на которых стоит таблица:
//
// 1. **Черта следует из дел, а не из броска; порог — минимум дел плюс доля исходов.** Черту можно потерять: доля сдвинулась —
//    черты нет. Счёт — за правление (у героя — за путь): новый правитель приходит без дел (`sim/dynasty.succeed`).
//
// 2. **Порог — форма черты агента на той же оси, а не ориентир ГДД.** Условия 3.2.3 помечены `[ориентир]` и до вывода в код не
//    идут; правитель же стареет той же лестницей лет, что агент (`AGENT_AGE0` → `RETIRE_AGE`), и его бои — бои той же дружины,
//    что у полководца. Поэтому хорошая черта берёт форму «Победоносного» (не меньше `min` дел, плохих — ноль), дурная — форму
//    «Битого» (не меньше `min`, плохих — не меньше половины): числа — `TRAIT_BY_ID` [код], а не свои. У «Щедрого» добрых дел
//    два рода: пиров — столько же, сколько побед у «Победоносного», и ни дня минимального жалованья. «Строитель» — уровень на
//    каждое здание посёлка (`BUILDINGS.length`). Где формы нет («Торгаш» — оборот без числа, «Узурпатор» — розыск ПН-8),
//    условия делами нет: такую черту дают только происхождение или пачка, которая выведет число.
//
// 3. **Пары на одной оси не держатся разом.** Воитель и Трус, Милостивый и Жестокий, Щедрый и Скупой: формы делят ось долей
//    (ноль плохих против половины), и обе разом дела не дают — это тест перебором. Черту, данную происхождением, снимает пара,
//    заработанная делами: дела говорят громче рождения.
//
// 4. **Каждое число черты действует ровно в одной двери** (таблица 3.2.3, тест по исходникам `rulertraits.test.ts`): память
//    боёв и дисциплина — `sim/spirit`, выручка — `sim/market.marketBoost`, стройка — `derived.buildBoost` (потолок Старосты общий),
//    подавление мятежа — `sim/stability`, лояльность — слагаемое `ruler` в `estaterules.loyaltyParts`. Двери читают черты только
//    через `rulernow.rulerTraitNumbers(s)`, а державы (`realm`) не знают (`sim/realm.test.ts`). Бой ядра (кроме морали через дух),
//    очки, выработку и оборону черты не трогают.
//
// Этот модуль — правила, и в первую загрузку он не едет: игра подгружает его докачкой (`rulernow.loadRulerTraits` — вход с
// делами в записи и первое дело), а до первого дела черт не бывает вовсе (`rulernow.traitsPossible`). Дверь чтения и счёт
// партии — `game/rulernow.ts`.
//
// Числа «что даёт»: +2 и −3 к памяти боёв — те же, что у «Победоносного» и «Битого» дома (`TRAIT_BY_ID`); +5 % выручки и стройки —
// числа ГДД (без пометки); лояльность — мерка «один человек у власти»: милость и обида рыцарства к командиру фланга
// (`LORD_FAVOR`, `COMMONER_SLIGHT` — выведены из порогов EU4), дисциплина — ступень полководца (`GENERAL_DRILL`).
//
// Одни на игру и на сервер (книга сословий, потолки духа, рынка и стройки — `netlify/lib/rulerbook.ts`): импорты — без `@/`.
import type { EstateId, GameState, RoamOrigin } from './types';
import type { WatchRuler } from '../../netlify/lib/contract';
import { TRAIT_BY_ID, type Share } from './data/traits';
import { BUILDINGS } from './data/buildings';
import { ESTATES } from './estaterules';
import { COMMONER_SLIGHT, LORD_FAVOR } from './commandrules';
import { GENERAL_DRILL } from './spiritrules';
import { DAY_LENGTH } from './pace';
import { rulerSeat, useRulerRules, wageMinClosing } from './rulernow';

export type RulerTraitId = 'warrior' | 'coward' | 'trader' | 'builder' | 'merciful' | 'cruel' | 'generous' | 'miser' | 'usurper' | 'forest';

/** Счёт дел, которым меряются черты, в минуту чтения: счёт партии и время правления (у героя — пути). */
export interface RulerDeeds {
  /** Бои дружины: выиграны, проиграны, брошены бегством (бегство пишет бой отряда, ПН-5). */
  won: number;
  lost: number;
  fled: number;
  /** Уровней достроено. */
  built: number;
  /** Пиров в трактире (`sim/actions.throwFeast`). */
  feasts: number;
  /** Сдач на наших условиях (помилования — ПН-8). */
  mercy: number;
  /** Городов, отданных огню или уведённых в неволю. */
  cruel: number;
  /** Игровых дней правления и сколько из них дружина была на минимальном жалованье. */
  days: number;
  minDays: number;
}

export type RulerDeedKey = keyof RulerDeeds;

export const RULER_DEED_KEYS: readonly RulerDeedKey[] = ['won', 'lost', 'fled', 'built', 'feasts', 'mercy', 'cruel', 'days', 'minDays'];

/** Условие делами: доля `part` в целом `of` — не больше (`most`) или не меньше (`least`) `share` при целом не меньше `min`. */
export interface RulerCond {
  of: readonly RulerDeedKey[];
  part: readonly RulerDeedKey[];
  min: number;
  at: 'most' | 'least';
  share: Share;
  /** И ещё: дел этого вида не меньше. */
  also?: { of: RulerDeedKey; min: number };
}

/** Что черта даёт. Каждое поле читает ровно одна дверь (правило 4). */
export interface RulerEffect {
  /** Прибавка к памяти боёв после победы (`sim/spirit.noteBattle`). */
  won?: number;
  /** Прибавка к памяти боёв после поражения. */
  lost?: number;
  /** Дисциплина дружины — строкой «Правитель» (`sim/spirit.spiritIn`). */
  drill?: number;
  /** Выручка продажи на рынке, доля (`sim/market.marketBoost`, потолок `BOOST_MAX`). */
  trade?: number;
  /** Скорость стройки, доля (`derived.buildBoost`, потолок Старосты общий). */
  build?: number;
  /** Мятеж подавлен без платы моралью (`sim/stability.rebelsSettled`). */
  calm?: true;
  /** Слагаемое лояльности сословий (`estaterules.loyaltyParts`, поле `ruler`). */
  loyalty?: Partial<Record<EstateId, number>>;
}

export interface RulerTraitDef {
  id: RulerTraitId;
  name: string;
  good: boolean;
  /** Условие делами; `null` — формы нет, делами черта не приходит (правило 2). */
  cond: RulerCond | null;
  /** Происхождение, дающее черту без дел (ГДД 3.1). */
  origin?: RoamOrigin;
  effect: RulerEffect;
}

/** Форма черты агента: минимум дел, сторона и доля (`data/traits`). */
const shapeOf = (id: 'victor' | 'beaten'): Pick<RulerCond, 'min' | 'at' | 'share'> => {
  const t = TRAIT_BY_ID[id];
  return { min: t.min, at: t.at, share: t.share };
};

const BATTLES: readonly RulerDeedKey[] = ['won', 'lost', 'fled'];
const FATES: readonly RulerDeedKey[] = ['mercy', 'cruel'];

/** Доля выручки «Торгаша» и стройки «Строителя» — числа ГДД 3.2.3. */
export const RULER_TRADE = 0.05;
export const RULER_BUILD = 0.05;

export const RULER_TRAITS: readonly RulerTraitDef[] = [
  {
    id: 'warrior',
    name: 'Воитель',
    good: true,
    cond: { of: BATTLES, part: ['lost', 'fled'], ...shapeOf('victor') },
    origin: 'warrior',
    effect: { won: TRAIT_BY_ID.victor.effect.won },
  },
  {
    id: 'coward',
    name: 'Трус',
    good: false,
    cond: { of: BATTLES, part: ['fled'], ...shapeOf('beaten') },
    effect: { lost: TRAIT_BY_ID.beaten.effect.lost, loyalty: { knights: -COMMONER_SLIGHT } },
  },
  { id: 'trader', name: 'Торгаш', good: true, cond: null, origin: 'merchant', effect: { trade: RULER_TRADE } },
  {
    id: 'builder',
    name: 'Строитель',
    good: true,
    cond: { of: ['built'], part: ['built'], min: BUILDINGS.length, at: 'least', share: { num: 0, den: 1 } },
    origin: 'craftsman',
    effect: { build: RULER_BUILD },
  },
  {
    id: 'merciful',
    name: 'Милостивый',
    good: true,
    cond: { of: FATES, part: ['cruel'], ...shapeOf('victor') },
    effect: { loyalty: { peasants: LORD_FAVOR, clergy: LORD_FAVOR } },
  },
  {
    id: 'cruel',
    name: 'Жестокий',
    good: false,
    cond: { of: FATES, part: ['cruel'], ...shapeOf('beaten') },
    effect: { calm: true, loyalty: { peasants: -COMMONER_SLIGHT } },
  },
  {
    id: 'generous',
    name: 'Щедрый',
    good: true,
    cond: { of: ['days'], part: ['minDays'], ...shapeOf('victor'), also: { of: 'feasts', min: TRAIT_BY_ID.victor.min } },
    effect: { drill: GENERAL_DRILL },
  },
  {
    id: 'miser',
    name: 'Скупой',
    good: false,
    cond: { of: ['days'], part: ['minDays'], ...shapeOf('beaten') },
    effect: { drill: -GENERAL_DRILL, loyalty: { merchants: LORD_FAVOR } },
  },
  { id: 'usurper', name: 'Узурпатор', good: false, cond: null, effect: { loyalty: { knights: -COMMONER_SLIGHT, clergy: -COMMONER_SLIGHT } } },
  { id: 'forest', name: 'Лесной по крови', good: true, cond: null, origin: 'taken', effect: { loyalty: { peasants: LORD_FAVOR, knights: -COMMONER_SLIGHT } } },
];

export const RULER_TRAIT_BY_ID: Readonly<Record<RulerTraitId, RulerTraitDef>> = Object.fromEntries(
  RULER_TRAITS.map((t) => [t.id, t]),
) as Record<RulerTraitId, RulerTraitDef>;

export const isRulerTraitId = (v: unknown): v is RulerTraitId => typeof v === 'string' && Object.prototype.hasOwnProperty.call(RULER_TRAIT_BY_ID, v);

/** Оси: пары, которые разом не держатся (правило 3). */
export const RULER_AXES: readonly (readonly [RulerTraitId, RulerTraitId])[] = [
  ['warrior', 'coward'],
  ['merciful', 'cruel'],
  ['generous', 'miser'],
];

const partnerOf = (id: RulerTraitId): RulerTraitId | null => {
  for (const [a, b] of RULER_AXES) {
    if (a === id) return b;
    if (b === id) return a;
  }
  return null;
};

const sum = (d: RulerDeeds, keys: readonly RulerDeedKey[]): number => keys.reduce((n, k) => n + Math.max(0, d[k]), 0);

/** Держит ли счёт условие. Чистая функция: доля — крест-накрест, без деления. */
export function holdsCond(c: RulerCond, d: RulerDeeds): boolean {
  const n = sum(d, c.of);
  if (n < c.min || n <= 0) return false;
  if (c.also && Math.max(0, d[c.also.of]) < c.also.min) return false;
  const part = sum(d, c.part);
  return c.at === 'most' ? part * c.share.den <= n * c.share.num : part * c.share.den >= n * c.share.num;
}

/**
 * Черты по счёту дел и происхождению, в порядке таблицы. Пара на оси, обе заработанные делами, не держится (правило 3 — делами
 * так не бывает, это страховка); черта рождения уступает паре, заработанной делами.
 */
export function rulerTraitsOf(d: RulerDeeds, origin?: RoamOrigin): RulerTraitId[] {
  const byDeeds = new Set<RulerTraitId>(RULER_TRAITS.filter((t) => t.cond !== null && holdsCond(t.cond, d)).map((t) => t.id));
  for (const [a, b] of RULER_AXES) {
    if (byDeeds.has(a) && byDeeds.has(b)) {
      byDeeds.delete(a);
      byDeeds.delete(b);
    }
  }
  return RULER_TRAITS.filter((t) => {
    if (byDeeds.has(t.id)) return true;
    if (origin === undefined || t.origin !== origin) return false;
    const p = partnerOf(t.id);
    return p === null || !byDeeds.has(p);
  }).map((t) => t.id);
}

/** Числа черт для дверей: сумма того, что дают черты. Черт нет — нули. */
export interface RulerNumbers {
  won: number;
  lost: number;
  drill: number;
  trade: number;
  build: number;
  calm: boolean;
  loyalty: Record<EstateId, number>;
}

const zeroLoyalty = (): Record<EstateId, number> => Object.fromEntries(ESTATES.map((e) => [e, 0])) as Record<EstateId, number>;

export function rulerNumbersOf(traits: readonly RulerTraitId[]): RulerNumbers {
  const out: RulerNumbers = { won: 0, lost: 0, drill: 0, trade: 0, build: 0, calm: false, loyalty: zeroLoyalty() };
  for (const id of traits) {
    const e = RULER_TRAIT_BY_ID[id]?.effect;
    if (!e) continue;
    out.won += e.won ?? 0;
    out.lost += e.lost ?? 0;
    out.drill += e.drill ?? 0;
    out.trade += e.trade ?? 0;
    out.build += e.build ?? 0;
    if (e.calm) out.calm = true;
    for (const est of ESTATES) out.loyalty[est] += e.loyalty?.[est] ?? 0;
  }
  return out;
}

// ---------- Счёт партии ----------

/** Счёт дел правителя (героя) в минуту партии — то, что меряют черты и что едет в опись. */
export function rulerDeedsOf(s: GameState): RulerDeeds {
  const { tally, since } = rulerSeat(s);
  const t = tally ?? {};
  return {
    won: t.won ?? 0,
    lost: t.lost ?? 0,
    fled: t.fled ?? 0,
    built: t.built ?? 0,
    feasts: t.feasts ?? 0,
    mercy: t.mercy ?? 0,
    cruel: t.cruel ?? 0,
    days: Math.max(0, s.time - since) / DAY_LENGTH,
    // На минимальном жалованье: закрытые отрезки счёта и идущий, срезанный началом правления.
    minDays: ((t.wageMin ?? 0) + wageMinClosing(s)) / DAY_LENGTH,
  };
}

/** Черты правителя (героя) сейчас — для окон (они подгружают правила сами) и описи. */
export const rulerTraitsNow = (s: GameState): RulerTraitId[] => rulerTraitsOf(rulerDeedsOf(s), rulerSeat(s).origin);
const traitsNow = rulerTraitsNow;

/** Правитель для описи (`net/snapshot`): номер человека дома (герой пути — −1), черты и счёт дел. */
function cardOf(s: GameState): WatchRuler {
  const seat = rulerSeat(s);
  return { n: seat.n, held: traitsNow(s), deeds: { ...rulerDeedsOf(s) }, ...(seat.origin ? { origin: seat.origin } : {}) };
}

/** Что дверь чтения (`rulernow`) берёт у правил, когда они подгружены. */
export interface RulerRules {
  traitsNow(s: GameState): RulerTraitId[];
  numbersNow(s: GameState): RulerNumbers;
  cardOf(s: GameState): WatchRuler;
}

// Правила подгружены — дверь чтения узнаёт о них сама: игра подгружает их докачкой (`rulernow.loadRulerTraits`), тесты и
// сервер — прямым импортом.
useRulerRules({ traitsNow, numbersNow: (s) => rulerNumbersOf(traitsNow(s)), cardOf });
