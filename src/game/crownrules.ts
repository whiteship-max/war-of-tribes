// Вести державы (СБ-2, docs/stability.md, «СБ-2»): числа и правила, одни на игру (`sim/crown`, `data/crown`) и на сервер
// (`netlify/lib/watch.ts`: книга вестей, правило «crown»). Две копии разошлись бы молча: сервер счёл бы подделкой честный
// ответ на весть или пропустил бы ступень стабильности из вести, которой не было. Без `@/`-импортов: модуль читает
// серверная часть.
//
// **Своё число здесь одно, и оно выведено** — `CROWN_MTTH` (`npm run stability:report`, раздел «Вести державы»). Сдвиг вести
// меряется днями тихой жизни (`STAB_CALM`), повтор и редкость — настоящими сутками, шаг сетки — паузой писем мира.
import type { EstateId, RealmBranch } from './types';
import { ESTATES } from './estaterules';
import { DAY_LENGTH, realTime } from './pace';
import { MINUTE_MS as MIN } from './time';
import { MAX_OFFLINE_DAYS } from './constants';
import { STAB_CALM } from './stabrules';

/** Нрав вести: добрая, дурная, выбор с ценой; следствие приходит ответом на прежнюю. */
export type CrownKind = 'good' | 'bad' | 'choice' | 'chain';

/** Редкость: во сколько раз дольше обычной весть ждёт своего часа и сколько её нет после прихода. */
export type CrownRarity = 'common' | 'uncommon' | 'rare' | 'once';

/** Что ответ делает со стабильностью и очками — то, что сверяет сервер. */
export interface CrownOptRule {
  /** Сдвиг стабильности в днях тихой жизни (`STAB_CALM`), со знаком: ±1, ±2, ±4, ±8. */
  stab: number;
  /** Очки правителя, которые ответ даёт: вид и сколько. */
  gain?: readonly [RealmBranch, number];
}

export interface CrownRule {
  kind: CrownKind;
  rarity: CrownRarity;
  opts: readonly CrownOptRule[];
}

const o = (stab: number, gain?: readonly [RealmBranch, number]): CrownOptRule => (gain ? { stab, gain } : { stab });

/**
 * Таблица правил: вид вести → нрав, редкость и что каждый ответ делает со стабильностью и очками. Слова, условия и прочие
 * последствия — в `data/crown.ts`; число у каждого ответа одно, и читают его игра и сервер отсюда.
 */
export const CROWN_RULES: Readonly<Record<string, CrownRule>> = {
  // ---------- Добрые ----------
  cr_miracle: { kind: 'good', rarity: 'uncommon', opts: [o(4), o(2)] },
  cr_good_year: { kind: 'good', rarity: 'uncommon', opts: [o(4), o(2)] },
  cr_wedding: { kind: 'good', rarity: 'common', opts: [o(2, ['diplo', 15]), o(1)] },
  cr_vow: { kind: 'good', rarity: 'uncommon', opts: [o(2, ['war', 30]), o(1, ['war', 15])] },
  cr_scholar: { kind: 'good', rarity: 'uncommon', opts: [o(1, ['admin', 40]), o(0)] },
  cr_song: { kind: 'good', rarity: 'uncommon', opts: [o(2), o(1)] },
  cr_fair_right: { kind: 'good', rarity: 'uncommon', opts: [o(1), o(0)] },
  cr_wise_judge: { kind: 'good', rarity: 'common', opts: [o(2), o(1)] },
  // ---------- Дурные ----------
  cr_comet: { kind: 'bad', rarity: 'uncommon', opts: [o(-1), o(0), o(-2)] },
  cr_drought: { kind: 'bad', rarity: 'common', opts: [o(-1), o(-1), o(-2)] },
  cr_lower_fire: { kind: 'bad', rarity: 'uncommon', opts: [o(-1), o(-1), o(-2)] },
  cr_plague_near: { kind: 'bad', rarity: 'common', opts: [o(0), o(0), o(0)] },
  cr_escape: { kind: 'bad', rarity: 'common', opts: [o(1), o(-1), o(0)] },
  cr_crown_debt: { kind: 'bad', rarity: 'uncommon', opts: [o(0), o(0), o(-1)] },
  cr_ruler_ill: { kind: 'bad', rarity: 'common', opts: [o(0), o(1), o(-2)] },
  cr_bad_harvest: { kind: 'bad', rarity: 'common', opts: [o(0), o(-1), o(0)] },
  // ---------- Выбор с ценой ----------
  cr_preacher: { kind: 'choice', rarity: 'common', opts: [o(1), o(0), o(-1)] },
  cr_guild: { kind: 'choice', rarity: 'common', opts: [o(0), o(0), o(2)] },
  cr_legate: { kind: 'choice', rarity: 'uncommon', opts: [o(2), o(0), o(-2)] },
  cr_commune: { kind: 'choice', rarity: 'uncommon', opts: [o(2), o(0)] },
  cr_crusade: { kind: 'choice', rarity: 'rare', opts: [o(2), o(2, ['war', 20]), o(-1)] },
  cr_match: { kind: 'choice', rarity: 'uncommon', opts: [o(-1), o(0, ['diplo', 30]), o(0)] },
  cr_tournament: { kind: 'choice', rarity: 'uncommon', opts: [o(1, ['war', 30]), o(0)] },
  cr_deserters: { kind: 'choice', rarity: 'common', opts: [o(1), o(1), o(-2)] },
  cr_missionaries: { kind: 'choice', rarity: 'uncommon', opts: [o(0, ['diplo', 20]), o(1)] },
  cr_tsargrad: { kind: 'choice', rarity: 'once', opts: [o(1), o(2), o(-1)] },
  // ---------- Следствия ----------
  cr_rain: { kind: 'chain', rarity: 'common', opts: [o(2), o(1)] },
  cr_plague: { kind: 'chain', rarity: 'common', opts: [o(-2), o(-4)] },
  cr_collector: { kind: 'chain', rarity: 'common', opts: [o(0), o(-2)] },
  cr_interdict: { kind: 'chain', rarity: 'common', opts: [o(1), o(-8)] },
  ...estateRules(),
};

/**
 * Вести сословий (РТ-2, docs/stability.md, Р1.7): дар — добрая, жалоба — дурная, требование власти — выбор. Дар рыцарей —
 * очками войны, дар духовенства — стабильностью; принятый с почётом — на день тихой жизни больше. Жалоба: дар и совет —
 * ровно, отказ — день вниз; требование: привилегия — день вверх, отказ — два вниз.
 */
function estateRules(): Record<string, CrownRule> {
  const gift = (e: EstateId): readonly CrownOptRule[] =>
    e === 'knights' ? [o(1, ['war', 20]), o(0, ['war', 10])] : e === 'clergy' ? [o(2), o(1)] : [o(1), o(0)];
  return Object.fromEntries(
    ESTATES.flatMap((e) => [
      [`cr_es_gift_${e}`, { kind: 'good', rarity: 'uncommon', opts: gift(e) }],
      [`cr_es_plea_${e}`, { kind: 'bad', rarity: 'common', opts: [o(0), o(0), o(-1)] }],
      [`cr_es_power_${e}`, { kind: 'choice', rarity: 'uncommon', opts: [o(1), o(0), o(-2)] }],
    ]),
  ) as Record<string, CrownRule>;
}

/** Вести державы по порядку таблицы. */
export const CROWN_IDS: readonly string[] = Object.keys(CROWN_RULES);

/** Весть державы ли это. */
export const isCrown = (id: string): boolean => id in CROWN_RULES;

/** Сдвиг стабильности ответа, % ступени: дни тихой жизни × `STAB_CALM`. Нет такого ответа — ноль. */
export const crownStab = (id: string, opt: number): number => (CROWN_RULES[id]?.opts[opt]?.stab ?? 0) * STAB_CALM;

/** Сколько очков ответ даёт (больший вид); нет — ноль. */
export const crownGain = (id: string, opt: number): number => CROWN_RULES[id]?.opts[opt]?.gain?.[1] ?? 0;

/** Самый большой подъём стабильности, какой даёт одна весть, % ступени: им сервер меряет ответы, которых не видел. */
export const CROWN_STAB_MAX = Math.max(...CROWN_IDS.flatMap((id) => CROWN_RULES[id].opts.map((_, i) => crownStab(id, i))));

/** Самый большой приток очков от одной вести. */
export const CROWN_GAIN_MAX = Math.max(...CROWN_IDS.flatMap((id) => CROWN_RULES[id].opts.map((_, i) => crownGain(id, i))));

/**
 * Среднее время до наступления обычной вести, игровых дней, при весе 1. **Выводит `npm run stability:report`** (раздел
 * «Вести державы», цель — около одной вести державы в настоящие сутки ровной игры); руками не правится.
 */
export const CROWN_MTTH = 250;

/** Во сколько раз дольше ждёт своего часа весть этой редкости. */
export const RARITY_SLOW: Record<CrownRarity, number> = { common: 1, uncommon: 2, rare: 4, once: 4 };

/**
 * Сколько игровых дней весть не приходит снова после прихода: обычная — четверо настоящих суток (сутки — `MAX_OFFLINE_DAYS`
 * игровых дней), редкая — вдвое и вчетверо дольше. Историческая — раз за партию (`Infinity`).
 */
export const CROWN_EVERY_DAYS: Record<CrownRarity, number> = {
  common: 4 * MAX_OFFLINE_DAYS,
  uncommon: 8 * MAX_OFFLINE_DAYS,
  rare: 16 * MAX_OFFLINE_DAYS,
  once: Infinity,
};

/** Повтор вести — игровых секунд. */
export const crownEvery = (id: string): number => CROWN_EVERY_DAYS[CROWN_RULES[id]?.rarity ?? 'common'] * DAY_LENGTH;

/** Сколько последних ответов везёт опись серверу. */
export const CROWN_BOOK = 12;

/**
 * Самая короткая пауза между приходами почты — пауза писем мира (`world/data/tuning.LETTER_PAUSE_MIN`; равенство держит
 * тест): за неё весть державы приходит не больше одной. Сервер меряет ею, сколько ответов могло быть.
 */
export const CROWN_SLOT_MS = realTime(6 * 60 * MIN);

/**
 * Сколько ответов на вести державы могло лечь за `realMs` настоящего времени: по вести на каждый приход сетки и по
 * следствию на каждую весть, плюс одна, что уже лежала на столе.
 */
export const crownAnswersCeil = (realMs: number): number => 2 * (Math.floor(Math.max(0, realMs) / CROWN_SLOT_MS) + 1);
