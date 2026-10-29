// Рост отряда бродяги людьми (ПН-6, docs/gdd/path_of_sword.md, 3.4.1, 3.4.3, 3.4.5; «Решения ПН-6») — числа и формулы без состояния
// партии, одни на игру (`sim/bandasks`, `sim/roamtown`, `sim/bandranks`) и на книгу отряда сервера (`netlify/lib/roambook.ts`):
//  · **просящиеся** — сколько пришло: база по ступени престижа × лагерь × сезон × дух (ориентиры 3.4.1 — заглушки игры); доля между
//    краями базы — хешем сида партии и номера прихода (`askShare`): число выводится из сетки почты, и сервер видит тот же потолок;
//  · **пленные** — доля уцелевших врагов (заглушка `captiveShare`), потолок прихода — от самой сильной цели НПС (`world/roamfoes`);
//  · **учения найма** — работа вида (`TroopDef.work`) при скорости казарм первого уровня (`train.trainRateAt` — та же, что у лорда и у
//    книги войска сервера).
// Без `@/`: модуль собирает сервер.
import type { TroopId } from './types';
import { TROOP_BY_ID } from './data/troops';
import { trainRateAt } from './train';
import { realMs } from './pace';
import { roamStub } from './roamstubs';

/** Вид, который приходит сам и в который принимают пленных (3.4.1, 3.4.5): первый вид войск. */
export const ASK_KIND: TroopId = 'clubman';

/** Где стоит отряд, когда к нему приходят: лагерь трёх видов или без лагеря (в поле, в пути, на постое). */
export type AskCamp = 'open' | 'hidden' | 'ruin' | 'none';

/** Края базы по ступени престижа 0…4: от «ступень 0 — 2…4» до «ступень 4 — 12…20», между ними — прямой. */
export function askRange(stage: number): [number, number] {
  const b = roamStub('askBase');
  const t = Math.max(0, Math.min(4, stage)) / 4;
  return [b.lo0 + (b.lo4 - b.lo0) * t, b.hi0 + (b.hi4 - b.hi0) * t];
}

/** Доля между краями для прихода `k` партии с сидом `seed` — 0…1, одна у игры и сервера. */
export function askShare(seed: number, k: number): number {
  let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(k | 0, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 2 ** 32;
}

/** Что входит в число просящихся, кроме сида: ступень престижа, лагерь, зима ли, мораль отряда. */
export interface AskAt {
  stage: number;
  camp: AskCamp;
  winter: boolean;
  morale: number;
}

/** Множитель условий прихода: лагерь × сезон × дух. */
export function askMult(a: Omit<AskAt, 'stage'>): number {
  const sp = roamStub('askSpirit');
  return roamStub('askCamp')[a.camp] * (a.winter ? roamStub('askWinter') : 1) * (a.morale < sp.below ? sp.mult : 1);
}

/** Сколько просится в приход `k`: база ступени (доля — хешем прихода) × условия, целыми, не меньше одного. */
export function askCount(seed: number, k: number, a: AskAt): number {
  const [lo, hi] = askRange(a.stage);
  return Math.max(1, Math.round((lo + (hi - lo) * askShare(seed, k)) * askMult(a)));
}

/**
 * Потолок прихода `k` — у сервера: та же доля хешем сида, но высшая ступень и самые щедрые условия (ступень, лагерь и мораль — слово
 * клиента). Сверх него приход — подделка: честная партия больше не насчитает.
 */
export function askCap(seed: number, k: number): number {
  const camp = Object.values(roamStub('askCamp')).reduce((m, v) => Math.max(m, v), 0);
  const [lo, hi] = askRange(4);
  return Math.max(1, Math.round((lo + (hi - lo) * askShare(seed, k)) * camp));
}

/**
 * «Взять, сколько прокормим»: сколько новых голов хлеб обоза прокормит вместе с отрядом на `askFeed` игровых дней. `food` — хлеб в
 * обозе, `eatPerHead` — паёк головы за игровой день по сезону (дверь пайка отряда), `mouths` — сколько ртов уже есть.
 */
export function askFeedable(food: number, eatPerHead: number, mouths: number): number {
  const day = eatPerHead * roamStub('askFeed');
  if (!(day > 0)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor(food / day) - Math.max(0, mouths));
}

// ---------- пленные ----------

/** Сколько пленных можно принять: доля уцелевших врагов, целыми вниз. */
export const captivesOf = (survivors: number): number => Math.max(0, Math.floor(Math.max(0, survivors) * roamStub('captiveShare')));

/** Потолок пленных за бой — у сервера: доля людей самого сильного отряда НПС (`men` — его люди, считает вызывающий). */
export const captiveCap = (men: number): number => Math.max(1, Math.ceil(Math.max(0, men) * roamStub('captiveShare')));

/** Боёв, которые может дать один ход: засада на дороге и удар по цели (ГДД 3.6.1, ПН-5). */
export const FIGHTS_PER_MOVE = 2;

// ---------- учения найма ----------

/** Работа учений одного бойца вида (`TroopDef.work`). */
export const drillWork = (kind: TroopId): number => TROOP_BY_ID[kind].work;

/** Скорость учений казарм первого уровня (конным — конюшни первого уровня), работа в игровую секунду. */
export const drillRate = (kind: TroopId): number => trainRateAt(Boolean(TROOP_BY_ID[kind].mounted), 1);

/** Настоящих мс учений `n` бойцов вида — у сервера (книга отряда: найм не быстрее учений). */
export const drillMs = (kind: TroopId, n: number): number => realMs((drillWork(kind) * Math.max(0, n)) / drillRate(kind));
