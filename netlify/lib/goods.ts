/**
 * Книга запасов (docs/security.md, ЗЩ-2): склад, казна и невольники, которые сервер подтверждает у защитника для войны —
 * набега, осады, дани и дел лазутчика. Рядом с книгами войска (`book.ts`) и стройки (`town.ts`) и тем же приёмом, только с
 * другой стороны: те держат «не больше объяснимого», эта — **«не меньше объяснимого»**. Заниженный склад прячет добро от
 * грабежа, заниженная казна — золото, а склад, вдруг опустевший перед осадой, — то и другое.
 *
 *  · **Источник** — опись наблюдения (`WatchCard.stock`), а не слепок обороны (`WarSheet`): опись сервер сверяет каждую
 *    минуту — рост не выше выработки, склад не выше вместимости подтверждённых построек, цена стройки списана (`watch.ts`).
 *    Слепок обороны ниже описи той же записи — флаг «склад меньше подтверждённого», в войну идёт книга.
 *  · **«Не меньше»**: между двумя описями без разовых трат (`WatchCard.outlays`) склад убывает только расходом — хлебом,
 *    дровами и жалованьем, — и не быстрее потолка расхода (`drainCeil`) за прошедшее время с запасом `GOODS_SLACK`, плюс
 *    то, что могли снять разовые дела промежутка по таблице наград (`deeds.deedLoss`, AC-1). Убыло больше — книга держит
 *    своё и пишет флаг; трата, бой, добро без дела (продажа) или уход и возвращение отряда объясняют любую убыль.
 *
 * Пишет книгу одна дверь — запись партии (`routes/save.ts` → `watch.booked`); читает война (`routes/war.ts` →
 * `war.liveSheet`). Лежит в записи наблюдения игрока (`WatchRecord.goods`). Чистая: без хранилища и без часов.
 */
import { RESOURCE_IDS } from '../../src/game/constants.js';
import { gameDaysOfMs, leadGrowth } from '../../src/game/pace.js';
import { FOOD_MOD_MAX, GOLD_OUT_PER_POP_MAX, HEAT_MOD_MAX, headsFoodPerDay, heatingWood, mastersCeil, soldierFoodPerDay, storageOf, type Levels } from '../../src/game/build.js';
import { baseWage } from '../../src/game/battle/price.js';
import { HORSE_MOUTHS, MASTER_PAID_AS } from '../../src/game/data/upkeep.js';
import { TROOP_IDS } from '../../src/game/data/troops.js';
import { fitStock } from '../../src/game/stockrules.js';
import { BONDED_GOOD } from '../../src/game/data/market.js';
import { deedBonded, deedLoss, type DeedKnown } from './deeds.js';
import { CLOCK_SKEW_SECONDS } from './initdata.js';
import { STOCK_KEYS, readCounts, warFallId, type Counts, type WarSheet, type WatchCard } from './contract.js';
import type { WarFile } from './war.js';

export interface GoodsBook {
  /** Минута записи партии, чья опись легла в книгу. Война берёт книгу, только если слепок лёг той же записью. */
  at: number;
  /** Склад и казна по видам `STOCK_KEYS`, которые сервер подтверждает: не меньше описи и не меньше объяснимой убыли. */
  have: Counts;
  /** Невольники описи — слепок обороны не меньше их. */
  bonded: number;
  /**
   * Книга невольников (АУ-8, п. 2): сколько их сервер подтверждает приходом — верхняя граница, в отличие от `bonded`. Нет —
   * запись старше книги: её заводит первая же опись с текущего числа (`bondedStep`).
   */
  bonds?: BondedBook;
}

/**
 * Книга невольников (АУ-8, п. 2; OWNER-DECISIONS п. 12, решение владельца 26.10.2026). Приход — только то, что подтверждает
 * сервер: уведённые войной (запись войн, `WarFall.led` нападающего), купленные на рынке (сделки описи — их цену и привоз
 * сверяет книга рынка, `market.marketFaults`), пленные боёв мира по таблице наград (`deeds.deedBonded`: мир живёт у клиента).
 * Расход — продажа, отпуск, смерть, выкуп — книга идёт за описью вниз.
 */
export interface BondedBook {
  /** Сколько невольников сервер подтверждает на минуту записи: не больше описи и прихода. */
  n: number;
  /**
   * Приход, которого опись ещё может не показывать: уведённые войной, чьё падение клиент не принял (`WarSheet.seen`),
   * купленные, пока караван в пути (`WatchCard.caravans`). Лежит, пока не показан, и входит в допуск каждой следующей записи.
   */
  due: { id: string; n: number }[];
  /** Падения войны (`warFallId`), чьих уведённых книга уже засчитала: второй раз не засчитывает. */
  led: string[];
}

/** Единица на дробь: невольники — целые, а опись и запись войн считают округлением. */
export const BONDED_SLACK = 1;

/** Что знает сервер о приходе невольников, кроме описей. */
export interface BondedCtx {
  /** Запись войн; нет (хранилище не ответило) — шаг без проверки. */
  file: WarFile | null;
  key: string;
  /** Что клиент уже принял из войны (`WarSheet.seen` той же записи). */
  seen: readonly string[];
}

export interface BondedStep {
  book: BondedBook;
  /** Невольников (с проданными) больше книги — на столько. Ноль — честно. */
  over: number;
  /** Продано невольников сверх книги — на столько: продажу сервер не принимает (её золото не подтверждается). */
  refused: number;
  /** Книга заведена этой записью (старая запись) — без проверки. */
  seeded: boolean;
}

/** Падения войны, взятые игроком, с уведёнными. */
function fallsOf(file: WarFile | null, key: string, at: number): { id: string; n: number }[] {
  const out: { id: string; n: number }[] = [];
  for (const w of file?.wars ?? []) {
    if (w.atk !== key || !w.fall || w.fall.at > at) continue;
    const n = Math.max(0, Math.floor(w.fall.led ?? 0));
    if (n > 0) out.push({ id: warFallId(w.id), n });
  }
  return out;
}

/** Сделки рынка с невольниками, новые с прежней описи: купленные (`n > 0`) и проданные. */
function bondedDeals(a: WatchCard | undefined, b: WatchCard): { buys: { id: string; n: number }[]; sold: number } {
  const from = a?.market?.seq ?? 0;
  const buys: { id: string; n: number }[] = [];
  let sold = 0;
  for (const d of b.market?.deals ?? []) {
    if (d.good !== BONDED_GOOD.id || d.seq <= from) continue;
    if (d.n > 0) buys.push({ id: `m:${d.seq}`, n: Math.floor(d.n) });
    else sold += Math.floor(-d.n);
  }
  return { buys, sold };
}

const sum = (xs: readonly { n: number }[]): number => xs.reduce((t, x) => t + x.n, 0);

/**
 * Книга невольников после записи партии: `prev` — книга до неё, `a` и `aAt` — прежняя опись, `b` и `bAt` — новая.
 * Допуск — книга, ждущий приход, новые падения войны, новые покупки и бои мира промежутка, плюс единица на дробь.
 * Невольников описи вместе с проданными больше допуска — флаг; проданных больше допуска — отказ. Книги нет или прежней
 * описи нет — книга заводится с числа описи, без флага (старая запись), и падения, уже лежащие в записи войн, считаются
 * засчитанными.
 */
export function bondedStep(prev: BondedBook | undefined, a: WatchCard | undefined, aAt: number, b: WatchCard, bAt: number, ctx: BondedCtx): BondedStep {
  const have = Math.max(0, Math.floor(b.bonded ?? 0));
  const falls = fallsOf(ctx.file, ctx.key, bAt);
  const seen = new Set(ctx.seen);
  const deals = bondedDeals(a, b);
  // Купленные ждут, пока в пути есть караван: какой из них везёт невольников, опись не говорит.
  const waiting = (x: { id: string }): boolean => (x.id.startsWith('m:') ? b.caravans > 0 : !seen.has(x.id));
  if (!prev || !a) {
    const due = [...falls.filter((f) => !seen.has(f.id)), ...deals.buys.filter(waiting)];
    if (b.caravans > 0 && (b.market?.bought[BONDED_GOOD.id] ?? 0) > 0) due.push({ id: 'm:seed', n: Math.floor(b.market?.bought[BONDED_GOOD.id] ?? 0) });
    return { book: { n: have, due, led: falls.map((f) => f.id) }, over: 0, refused: 0, seeded: true };
  }
  if (!ctx.file) return { book: { ...prev, n: have }, over: 0, refused: 0, seeded: false };
  const done = new Set(prev.led);
  const fresh = falls.filter((f) => !done.has(f.id));
  const world = deedBonded(a, b, Math.max(0, bAt - aAt));
  const allowed = prev.n + sum(prev.due) + sum(fresh) + sum(deals.buys) + world + BONDED_SLACK;
  const over = Math.max(0, have + deals.sold - allowed);
  const refused = Math.max(0, deals.sold - allowed);
  const n = Math.max(0, Math.min(have, allowed - deals.sold));
  const due = [...prev.due, ...fresh, ...deals.buys].filter(waiting);
  // Помнит только падения, что ещё лежат у сервера: остальных он больше не засчитает.
  const led = [...new Set([...prev.led, ...fresh.map((f) => f.id)])].filter((id) => falls.some((f) => f.id === id));
  return { book: { n: Number.isFinite(n) ? n : have, due, led }, over: Number.isFinite(over) ? over : 0, refused: Number.isFinite(refused) ? refused : 0, seeded: false };
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
export function drainCeil(levels: Levels, pop: number, bonded: number, soldiers: number, council = 0, estates: { food: number; wage: number } = { food: 1, wage: 1 }): Counts {
  const people = Math.max(0, pop);
  const men = Math.max(0, soldiers);
  const { masters, hands } = mastersCeil(levels);
  const mouths = men * Math.max(1, HORSE_MOUTHS);
  return {
    // Цехи в силе (РТ-2) едят больше: город — на их минус сверху (`estaterules.estateCeil`).
    food: headsFoodPerDay(people + Math.max(0, bonded) + masters, FOOD_MOD_MAX, 1) * Math.max(1, estates.food) + mouths * soldierFoodPerDay(FOOD_MOD_MAX, 1),
    wood: Math.max(heatingWood(people, 0, HEAT_MOD_MAX), heatingWood(0, people, HEAT_MOD_MAX)),
    // Жалованье совета Ратуши (РТ-1) — та же ведомость: подтверждённые советники (`watch.councilWage`).
    // Рыцарство в силе (РТ-2) требует больше содержания: жалованье бойца и мастера (он платится как боец) — на его минус сверху.
    gold: (men * WAGE_MAX + masters * baseWage(MASTER_PAID_AS) * hands) * Math.max(1, estates.wage) + (people + men) * GOLD_OUT_PER_POP_MAX + Math.max(0, council),
  };
}

/** Что сервер подтверждает у игрока к записи — уровни, жители и бойцы книг стройки и войска. */
export interface GoodsCtx {
  /** Указы админа из книги указов: их убыль сервер знает точно (`deeds.deedLoss`). Нет — указ до потолка указа. */
  grants?: DeedKnown['grants'];
  levels: Levels;
  pop: number;
  soldiers: number;
  /** Жалованье подтверждённого совета Ратуши за игровой день (РТ-1). Нет — ноль. */
  council?: number;
  /** Потолки сословий по подтверждённым уровням и привилегиям (РТ-2): хлеб города и жалованье войска. Нет — единицы. */
  estates?: { food: number; wage: number };
  /** Невольники книги невольников (АУ-8, п. 2): едят в потолке расхода только подтверждённые. Нет — опись. */
  bonded?: number;
}

export interface GoodsStep {
  book: GoodsBook;
  /** Виды, чья убыль между описями обогнала потолок расхода: заявлено, сколько книга держит, сколько расход позволял. */
  hidden: { kind: string; claimed: number; held: number; drop: number; could: number }[];
}

/**
 * Книга держит нижнюю границу промежутка: между описями не было разовой траты, никто не ушёл и не вернулся, и разовые дела
 * промежутка снимают не больше таблицы наград (`deeds.deedLoss` конечна по каждому виду; AC-1 — прежде любое дело выключало
 * границу). Опись без счётчика трат (старый клиент) — промежуток с тратой: книга не держит.
 */
export const holdsBetween = (a: WatchCard, b: WatchCard, realMs: number, known?: DeedKnown): boolean =>
  a.outlays !== undefined &&
  b.outlays !== undefined &&
  a.outlays === b.outlays &&
  a.away === b.away &&
  Object.values(deedLoss(a, b, realMs, known)).every(Number.isFinite);

/**
 * Склад описи, приведённый к вместимости подтверждённых построек правилом игры (`stockrules.fitStock`: не выше
 * вместимости, не ниже нуля — решение владельца, OWNER-DECISIONS, п. 1); золото — как есть, не ниже нуля.
 */
function claimedOf(card: WatchCard, cap: number): Counts {
  const out: Counts = {};
  for (const k of STOCK_KEYS) {
    const v = card.stock[k] ?? 0;
    out[k] = RESOURCES.has(k) ? fitStock(v, 0, cap) : Math.max(0, v);
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
  const realMs = Math.max(0, bAt - aAt);
  const known = { grants: ctx.grants };
  if (!prev || !a || !holdsBetween(a, b, realMs, known)) return { book: { at: bAt, have: claimed, bonded }, hidden: [] };
  const days = gameDaysOfMs(realMs + leadGrowth(a.lead, b.lead, realMs + CLOCK_SKEW_SECONDS * 1000) + CLOCK_SKEW_SECONDS * 1000);
  const drain = drainCeil(ctx.levels, ctx.pop, Math.min(bonded, ctx.bonded ?? bonded), ctx.soldiers, ctx.council, ctx.estates);
  // Разовые дела промежутка (вести, ответы державы, указы) снимают не больше таблицы наград (AC-1).
  const deeds = deedLoss(a, b, realMs, known);
  const have: Counts = {};
  const hidden: GoodsStep['hidden'] = [];
  for (const k of STOCK_KEYS) {
    const could = (drain[k] ?? 0) * days * GOODS_SLACK + 1 + (deeds[k] ?? 0);
    const was = prev.have[k] ?? 0;
    const held = Math.max(0, was - could);
    const now = claimed[k] ?? 0;
    if (now >= held) {
      have[k] = now;
      continue;
    }
    have[k] = RESOURCES.has(k) ? fitStock(held, 0, cap) : held;
    hidden.push({ kind: k, claimed: now, held: Math.round(have[k]), drop: Math.round(was - now), could: Math.round(could) });
  }
  return { book: { at: bAt, have, bonded }, hidden };
}

/** Насколько профиль мира может отстать от партии, прежде чем слепок ниже описи — флаг: пульс идёт раз в 2 с, с запасом. */
export const SHEET_LAG_MS = 10 * 60_000;

/**
 * Слепок обороны той же записи против книги: какие виды слепок называет меньше, чем книга, сверх выработки за
 * `SHEET_LAG_MS` с запасом и двадцатой доли книги. Флаг — только строка админу: в войну книга идёт и без него
 * (`goodsSheet`), поэтому порог щедрый — отставший профиль честного флагом не становится. Пусто — слепок честен.
 */
export function sheetShort(sheet: WarSheet, book: GoodsBook, prod: Counts): { kind: string; sheet: number; book: number }[] {
  const out: { kind: string; sheet: number; book: number }[] = [];
  const tol = (k: string): number => Math.max(0, prod[k] ?? 0) * gameDaysOfMs(SHEET_LAG_MS) * GOODS_SLACK + 0.05 * (book.have[k] ?? 0) + 1;
  for (const k of STOCK_KEYS) {
    const want = book.have[k] ?? 0;
    const said = k === 'gold' ? sheet.gold : k === 'food' ? Math.max(sheet.food, sheet.stock.food ?? 0) : (sheet.stock[k] ?? 0);
    if (said + tol(k) < want) out.push({ kind: k, sheet: Math.floor(said), book: Math.floor(want) });
  }
  if (sheet.bonded + 1 < book.bonded) out.push({ kind: 'bonded', sheet: sheet.bonded, book: book.bonded });
  return out;
}

/**
 * Слепок обороны с книгой запасов (`war.liveSheet`): склад, казна и невольники — книги (невольники — не больше книги
 * невольников); хлеб осады — книги, с дробью
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
    // Невольники — не меньше описи и не больше книги невольников (АУ-8, п. 2): поддельные не уходят в добычу нападающего.
    bonded: book.bonds ? Math.min(Math.max(sheet.bonded, book.bonded), book.bonds.n + sum(book.bonds.due)) : Math.max(sheet.bonded, book.bonded),
  };
}

const n0 = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/** Книга из записи наблюдения; нет или испорчена — `null`. */
export function readGoods(v: unknown): GoodsBook | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const at = n0(r.at);
  if (!at) return null;
  const bonds = readBonds(r.bonds);
  return { at, have: readCounts(r.have), bonded: Math.floor(n0(r.bonded)), ...(bonds ? { bonds } : {}) };
}

/** Книга невольников из записи; нет или испорчена — `undefined` (её заведёт следующая опись). */
function readBonds(v: unknown): BondedBook | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const rows = (x: unknown): { id: string; n: number }[] =>
    Array.isArray(x) ? x.filter((y) => y && typeof y.id === 'string').map((y) => ({ id: String(y.id), n: Math.floor(n0(y.n)) })).slice(0, 256) : [];
  const led = Array.isArray(r.led) ? r.led.filter((x): x is string => typeof x === 'string').slice(-256) : [];
  return { n: Math.floor(n0(r.n)), due: rows(r.due), led };
}
