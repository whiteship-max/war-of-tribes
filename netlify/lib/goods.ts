/**
 * Книга запасов (docs/security.md, ЗЩ-2): склад, казна и невольники, которые сервер подтверждает у защитника для войны —
 * набега, осады, дани и дел лазутчика. Рядом с книгами войска (`book.ts`) и стройки (`town.ts`) и тем же приёмом, только с
 * другой стороны: те держат «не больше объяснимого», эта — **«не меньше объяснимого»**. Заниженный склад прячет добро от
 * грабежа, заниженная казна — золото, а склад, вдруг опустевший перед осадой, — то и другое.
 *
 *  · **Источник** — опись наблюдения (`WatchCard.stock`), а не слепок обороны (`WarSheet`): опись сервер сверяет каждую
 *    минуту — рост не выше выработки, склад не выше вместимости подтверждённых построек, цена стройки списана (`watch.ts`).
 *    Слепок обороны ниже описи той же записи — флаг «склад меньше подтверждённого», в войну идёт книга.
 *  · **«Не меньше»**: между двумя описями без разовых дел и разовых трат (`WatchCard.outlays`) склад убывает только
 *    расходом — хлебом, дровами и жалованьем, — и не быстрее потолка расхода (`drainCeil`) за прошедшее время с запасом
 *    `GOODS_SLACK`. Убыло больше — книга держит своё и пишет флаг; дело или трата между описями объясняет любую убыль.
 *
 * Пишет книгу одна дверь — запись партии (`routes/save.ts` → `watch.booked`); читает война (`routes/war.ts` →
 * `war.liveSheet`). Лежит в записи наблюдения игрока (`WatchRecord.goods`). Чистая: без хранилища и без часов.
 */
import { RESOURCE_IDS } from '../../src/game/constants.js';
import { gameDaysOfMs } from '../../src/game/pace.js';
import { FOOD_MOD_MAX, GOLD_OUT_PER_POP_MAX, HEAT_MOD_MAX, headsFoodPerDay, heatingWood, mastersCeil, soldierFoodPerDay, storageOf, type Levels } from '../../src/game/build.js';
import { baseWage } from '../../src/game/battle/price.js';
import { HORSE_MOUTHS, MASTER_PAID_AS } from '../../src/game/data/upkeep.js';
import { TROOP_IDS } from '../../src/game/data/troops.js';
import { CLOCK_SKEW_SECONDS } from './initdata.js';
import { STOCK_KEYS, readCounts, type Counts, type WarSheet, type WatchCard } from './contract.js';

export interface GoodsBook {
  /** Минута записи партии, чья опись легла в книгу. Война берёт книгу, только если слепок лёг той же записью. */
  at: number;
  /** Склад и казна по видам `STOCK_KEYS`, которые сервер подтверждает: не меньше описи и не меньше объяснимой убыли. */
  have: Counts;
  /** Невольники описи — слепок обороны не меньше их. */
  bonded: number;
}

/** Во сколько раз расход между описями может обогнать свой потолок, прежде чем это флаг, — как рост (`watch.GROWTH_SLACK`). */
export const GOODS_SLACK = 2;

const RESOURCES = new Set<string>(RESOURCE_IDS);

/** Наибольшее жалованье бойца за игровой день — по ставке самого дорогого вида (`battle/price.baseWage`, доля веры не больше единицы). */
const WAGE_MAX = Math.max(...TROOP_IDS.map(baseWage));

/**
 * Потолок расхода без дела за игровой день (docs/security.md, ЗЩ-2): сколько посёлок этих уровней с `pop` жителями,
 * `bonded` невольниками и `soldiers` бойцами (строй, раненые, новобранцы) тратит сам, ничего не заказывая. Формулы — игры:
 *  · хлеб — паёк голов и бойцов (`build.headsFoodPerDay`, `soldierFoodPerDay`) при наибольшем множителе пайка
 *    (`FOOD_MOD_MAX`), конный — за двоих (`HORSE_MOUTHS`), мастера — все места Мастерской (`build.mastersCeil`);
 *  · дрова — очаги всех жителей (`build.heatingWood`) в самый холодный сезон;
 *  · золото — жалованье бойцов по ставке самого дорогого вида и мастеров по их рукам (`derived.masterWage`) и закят веры
 *    с каждой головы (`build.GOLD_OUT_PER_POP_MAX`).
 * Остальное на складе без дела не убывает вовсе.
 */
export function drainCeil(levels: Levels, pop: number, bonded: number, soldiers: number): Counts {
  const people = Math.max(0, pop);
  const men = Math.max(0, soldiers);
  const { masters, hands } = mastersCeil(levels);
  const mouths = men * Math.max(1, HORSE_MOUTHS);
  return {
    food: headsFoodPerDay(people + Math.max(0, bonded) + masters, FOOD_MOD_MAX, 1) + mouths * soldierFoodPerDay(FOOD_MOD_MAX, 1),
    wood: Math.max(heatingWood(people, 0, HEAT_MOD_MAX), heatingWood(0, people, HEAT_MOD_MAX)),
    gold: men * WAGE_MAX + masters * baseWage(MASTER_PAID_AS) * hands + (people + men) * GOLD_OUT_PER_POP_MAX,
  };
}

/** Что сервер подтверждает у игрока к записи — уровни, жители и бойцы книг стройки и войска. */
export interface GoodsCtx {
  levels: Levels;
  pop: number;
  soldiers: number;
}

export interface GoodsStep {
  book: GoodsBook;
  /** Виды, чья убыль между описями обогнала потолок расхода: заявлено, сколько книга держит, сколько расход позволял. */
  hidden: { kind: string; claimed: number; held: number; drop: number; could: number }[];
}

/**
 * Промежуток «без дела»: между описями не было ни разового дела, ни разовой траты, ни указа, ни промысла, никто не ушёл
 * и не вернулся, караван не пришёл. Опись без счётчика трат (старый клиент) — промежуток с тратой: книга не держит.
 */
export const quietBetween = (a: WatchCard, b: WatchCard): boolean =>
  a.outlays !== undefined &&
  b.outlays !== undefined &&
  a.outlays === b.outlays &&
  a.deeds === b.deeds &&
  a.seen === b.seen &&
  a.games === b.games &&
  a.away === b.away &&
  a.caravans === b.caravans;

/** Склад описи, приведённый к вместимости подтверждённых построек; золото — как есть. */
function claimedOf(card: WatchCard, cap: number): Counts {
  const out: Counts = {};
  for (const k of STOCK_KEYS) {
    const v = Math.max(0, card.stock[k] ?? 0);
    out[k] = RESOURCES.has(k) ? Math.min(v, cap) : v;
  }
  return out;
}

/**
 * Книга после записи партии: `prev` — книга до неё, `a` и `aAt` — прежняя опись и её минута, `b` и `bAt` — новая.
 * Прежней описи или книги нет, или между описями было дело — книга равна описи. Иначе убыль каждого вида — не больше
 * потолка расхода (`drainCeil`) за игровые дни, которые могли пройти (настоящее время, опережение и допуск часов), с
 * запасом `GOODS_SLACK` и единицей на дробь; больше — книга держит прежнее за вычетом позволенного.
 */
export function goodsStep(prev: GoodsBook | null, a: WatchCard | undefined, aAt: number, b: WatchCard, bAt: number, ctx: GoodsCtx): GoodsStep {
  const cap = storageOf(ctx.levels);
  const claimed = claimedOf(b, cap);
  const bonded = Math.max(0, b.bonded ?? 0);
  if (!prev || !a || !quietBetween(a, b)) return { book: { at: bAt, have: claimed, bonded }, hidden: [] };
  const realMs = Math.max(0, bAt - aAt);
  const days = gameDaysOfMs(realMs + Math.max(0, b.lead - a.lead) + CLOCK_SKEW_SECONDS * 1000);
  const drain = drainCeil(ctx.levels, ctx.pop, bonded, ctx.soldiers);
  const have: Counts = {};
  const hidden: GoodsStep['hidden'] = [];
  for (const k of STOCK_KEYS) {
    const could = (drain[k] ?? 0) * days * GOODS_SLACK + 1;
    const was = prev.have[k] ?? 0;
    const held = Math.max(0, was - could);
    const now = claimed[k] ?? 0;
    if (now >= held) {
      have[k] = now;
      continue;
    }
    have[k] = RESOURCES.has(k) ? Math.min(held, cap) : held;
    hidden.push({ kind: k, claimed: now, held: Math.round(have[k]), drop: Math.round(was - now), could: Math.round(could) });
  }
  return { book: { at: bAt, have, bonded }, hidden };
}

/**
 * Слепок обороны той же записи против книги: какие виды слепок называет меньше, чем книга, сверх выработки минуты
 * (профиль мира отстаёт от партии на пульс). Пусто — слепок честен.
 */
export function sheetShort(sheet: WarSheet, book: GoodsBook, prod: Counts): { kind: string; sheet: number; book: number }[] {
  const out: { kind: string; sheet: number; book: number }[] = [];
  const tol = (k: string): number => Math.max(0, prod[k] ?? 0) * gameDaysOfMs(60_000) * GOODS_SLACK + 1;
  for (const k of STOCK_KEYS) {
    const want = book.have[k] ?? 0;
    const said = k === 'gold' ? sheet.gold : k === 'food' ? Math.max(sheet.food, sheet.stock.food ?? 0) : (sheet.stock[k] ?? 0);
    if (said + tol(k) < want) out.push({ kind: k, sheet: Math.floor(said), book: Math.floor(want) });
  }
  if (sheet.bonded + 1 < book.bonded) out.push({ kind: 'bonded', sheet: sheet.bonded, book: book.bonded });
  return out;
}

/**
 * Слепок обороны с книгой запасов (`war.liveSheet`): склад, казна и невольники — книги; хлеб осады — книги, с дробью
 * слепка (опись держит целые, мост — нет). Книга не той записи, что слепок, — слепок как есть: книга могла не лечь
 * (наблюдение попутное), и сверять её не с чем.
 */
export function goodsSheet(sheet: WarSheet, sheetAt: number, book: GoodsBook | undefined): WarSheet {
  if (!book || book.at !== sheetAt) return sheet;
  const stock: Counts = { ...sheet.stock };
  for (const k of RESOURCE_IDS) {
    const v = Math.floor(book.have[k] ?? 0);
    if (v > 0) stock[k] = v;
    else delete stock[k];
  }
  const food = Math.floor(book.have.food ?? 0);
  return {
    ...sheet,
    stock,
    gold: Math.floor(book.have.gold ?? 0),
    food: Math.max(food, Math.min(sheet.food, food + 1)),
    bonded: Math.max(sheet.bonded, book.bonded),
  };
}

const n0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Книга из записи наблюдения; нет или испорчена — `null`. */
export function readGoods(v: unknown): GoodsBook | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const at = n0(r.at);
  if (!at) return null;
  return { at, have: readCounts(r.have), bonded: Math.floor(n0(r.bonded)) };
}
