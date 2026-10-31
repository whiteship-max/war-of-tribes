// Книга торга отряда на сервере (ПН-Э2в, docs/trust-boundary.md, 5в; docs/gdd/path_of_sword.md, 3.7.1, 23.10): сделку у вольного города
// сервер выводит сам — цена той же формулой, что игра (специализация, глубина, нажим цепочкой сделок), караванный кошель (у продажи) и
// товар. Подделка — отказ и флаг; запаздывание (отряд у сервера уже в пути) — отказ без флага, а цепочка идёт с партией.
//
// Граница области — утверждениями: честная цепочка правда снята с двери рынка игры (приказы из очереди партии), отряд правда стоит у
// города в минуту сделки, подделка отличается от честной сделки ровно одним полем.
import { describe, expect, it, vi } from 'vitest';
import type { BandBookOrder, RoamBookRow } from '../../netlify/lib/contract';
import { bandOrder, emptyRoster } from '../../netlify/lib/roster';
import { bookOrder, startBook, type BookAt } from '../../netlify/lib/roambook';
import { readBookOrder, readRoamBook } from '../../netlify/lib/bandorder';
import type { GameState, GoodId } from '@/game/types';
import { createInitialState } from '@/game/state';
import { beginRoam } from '@/game/sim/roam';
import { buyGoods, marketPurse, sellGoods } from '@/game/sim/market';
import { GOOD_BY_ID } from '@/game/data/market';
import { townKeyOf, townMarketLevel } from '@/game/townrules';
import { caravanLeft } from '@/game/marketrules';
import { standWay } from './roammove';
import { pointsIn, type RoamPoint } from './roampoints';
import { townCaravan, townSpecOf } from './townspec';
import '@/game/roamdoor';

vi.mock('@/game/roamflag', () => ({ ROAM_ON: true, roamOpenFor: () => true, roamOn: () => true, setRoamOpen: () => {} }));

type Trade = Extract<BandBookOrder, { op: 'trade' }>;

const NOW = 1_900_000_000_000;
const TOWNS = pointsIn(0, 600, 1200, 900, 1500).filter((p) => p.kind === 'town' && p.tier > 0);
const TOWN = TOWNS.find((t) => townSpecOf(t.x, t.y) === 'granary') as RoamPoint;
const KEY = townKeyOf(TOWN.x, TOWN.y);
const WAY = standWay('normal', { x: TOWN.x, y: TOWN.y }, NOW - 3_600_000);
const at = (now: number, over: Partial<BookAt> = {}): BookAt => ({ now, cell: { x: TOWN.x, y: TOWN.y }, moving: false, seed: 1, way: WAY, ...over });

function party(): GameState {
  const s = createInitialState(7);
  expect(beginRoam(s, { origin: 'warrior', hero: { name: 'Ратко', war: 2 }, band: { spearman: 40, clubman: 20 }, purse: 100_000, food: 200 })).toBeNull();
  s.roam!.way = WAY;
  return s;
}
const carry = (s: GameState, good: GoodId, n: number): void => {
  const r = GOOD_BY_ID[good].resource!;
  s.roam!.cargo[r] = (s.roam!.cargo[r] ?? 0) + n;
};

/** Честные сделки партии у города дверью рынка игры — приказы из очереди отряда, по порядку. */
function honest(): { s: GameState; orders: Trade[] } {
  const s = party();
  expect(TOWN).toBeDefined();
  carry(s, 'iron', 600);
  carry(s, 'wood', 3000);
  expect(sellGoods(s, 'iron', 120, NOW, KEY)).toBeNull();
  expect(sellGoods(s, 'wood', 400, NOW + 60_000, KEY)).toBeNull();
  expect(buyGoods(s, 'food', 30, NOW + 120_000, KEY)).toBeNull();
  // Нажим отходит, кошель пополняется: та же продажа через час — по цепочке.
  expect(sellGoods(s, 'iron', 80, NOW + 3_600_000, KEY)).toBeNull();
  // Новый привоз — счёт привоза заново, нажим и кошель — дальше.
  expect(sellGoods(s, 'wood', 300, NOW + 3 * 3_600_000 + 60_000, KEY)).toBeNull();
  const orders = (s.roam!.outbox ?? []).filter((o): o is Trade => o.op === 'trade');
  expect(orders.length).toBe(5);
  return { s, orders };
}

/** Прогнать приказы через книгу по порядку; каждый — минутой позже сделки. */
function run(book: RoamBookRow, orders: Trade[]): { book: RoamBookRow; errors: (string | null)[]; flags: (string | null)[] } {
  const errors: (string | null)[] = [];
  const flags: (string | null)[] = [];
  for (const o of orders) {
    const step = bookOrder(book, o, at(o.t + 30_000));
    errors.push(step.error);
    flags.push(step.forged);
    if (!step.error || step.keep) book = step.book;
  }
  return { book, errors, flags };
}

describe('книга торга: честная цепочка партии', () => {
  it('сделки партии у вольного города сервер принимает все, без флага, и его цепочка — та же, что у партии', () => {
    const { s, orders } = honest();
    const got = run(startBook(), orders);
    expect(got.errors).toEqual(orders.map(() => null));
    expect(got.flags).toEqual(orders.map(() => null));
    const town = got.book.trade!.towns.find((t) => t.at === `${TOWN.x}:${TOWN.y}`)!;
    const m = s.roam!.markets![KEY];
    expect(town.press).toEqual(m.press);
    expect(town.cv).toEqual(m.cv);
    // Кошель у сервера — тот, что видит окно партии.
    const c = townCaravan(TOWN.x, TOWN.y, townMarketLevel(TOWN.tier as 1 | 2 | 3));
    const t = NOW + 4 * 3_600_000;
    expect(caravanLeft(c.cap, c.refillMs, town.cv, t)).toBe(marketPurse(s, t, KEY));
    // Подтверждённое: сделок, выручки и трат — сколько легло в партию.
    const sold = orders.filter((o) => o.n < 0).reduce((n, o) => n + o.gold, 0);
    const spent = orders.filter((o) => o.n > 0).reduce((n, o) => n + o.gold, 0);
    expect(got.book.trade).toMatchObject({ n: 5, sold, spent });
  });

  it('книга торга переживает строку реестра: разбор того же вида', () => {
    const { orders } = honest();
    const book = run(startBook(), orders).book;
    expect(readRoamBook(JSON.parse(JSON.stringify(book)))).toEqual(book);
    for (const o of orders) expect(readBookOrder(JSON.parse(JSON.stringify(o)))).toEqual(o);
    expect(readBookOrder({ op: 'trade', key: 'trade-1-1', at: { x: 1, y: 1 }, good: 'iron', n: 0, gold: 5, t: NOW })).toBeNull();
    expect(readBookOrder({ op: 'trade', key: 'trade-1-1', at: { x: 1, y: 1 }, good: 'iron', n: -1, gold: -5, t: NOW })).toBeNull();
  });
});

describe('книга торга: подделка — отказ и флаг', () => {
  const forged = (change: (o: Trade) => Trade, index = 0): { error: string | null; forged: string | null } => {
    const { orders } = honest();
    const prior = run(startBook(), orders.slice(0, index)).book;
    const o = change(orders[index]);
    // Граница: честный приказ на том же месте проходит — отказ мерит подделку, а не место.
    expect(bookOrder(prior, orders[index], at(orders[index].t + 30_000)).error).toBeNull();
    return bookOrder(prior, o, at(o.t + 30_000));
  };

  it('клиент подделал цену: продал дороже правила или купил дешевле — отказ и флаг', () => {
    const dear = forged((o) => ({ ...o, gold: o.gold + 1 }), 0);
    expect(dear.error).not.toBeNull();
    expect(dear.forged).toMatch(/продано за \d+ — по правилу не больше/);
    // Нажим прежних сделок цепочки — в цене: вторая продажа железа через час дороже правила на монету — та же подделка.
    expect(forged((o) => ({ ...o, gold: o.gold + 1 }), 3).forged).toMatch(/по правилу не больше/);
    const cheap = forged((o) => ({ ...o, gold: o.gold - 1 }), 2);
    expect(cheap.forged).toMatch(/куплено за \d+ — по правилу не меньше/);
  });

  it('продажа сверх караванного кошеля — отказ и флаг', () => {
    const { orders } = honest();
    const o = orders[0];
    const c = townCaravan(TOWN.x, TOWN.y, townMarketLevel(TOWN.tier as 1 | 2 | 3));
    // Кошель почти пуст: книга помнит недостачу до сделки.
    const book: RoamBookRow = { ...startBook(), trade: { towns: [{ at: `${TOWN.x}:${TOWN.y}`, w: 0, bought: {}, sold: {}, press: {}, cv: [c.cap - o.gold + 1, o.t], last: 0 }], n: 0, sold: 0, spent: 0 } };
    // Граница: цена честная (та же сделка с полным кошелём принята).
    expect(bookOrder(startBook(), o, at(o.t + 30_000)).error).toBeNull();
    const step = bookOrder(book, o, at(o.t + 30_000));
    expect(step.error).not.toBeNull();
    expect(step.forged).toMatch(/караванном кошеле города/);
  });

  it('товара нет, города нет, минута из будущего или раньше прежней — отказ и флаг', () => {
    expect(forged((o) => ({ ...o, good: 'bonded' })).forged).toMatch(/товара «bonded»/);
    expect(forged((o) => ({ ...o, good: 'gold' })).forged).toMatch(/товара «gold»/);
    expect(forged((o) => ({ ...o, at: { x: TOWN.x + 2, y: TOWN.y } })).forged).toMatch(/вольного города там нет/);
    const { orders } = honest();
    const o = orders[0];
    expect(bookOrder(startBook(), { ...o, t: o.t + 10 * 60_000 }, at(o.t)).forged).toMatch(/впереди часов сервера/);
    const one = run(startBook(), orders.slice(0, 2)).book;
    expect(bookOrder(one, { ...orders[2], t: orders[0].t - 1 }, at(orders[2].t)).forged).toMatch(/раньше прежней/);
  });

  it('купить сверх привоза — отказ и флаг', () => {
    const { orders } = honest();
    const o = orders[2];
    expect(o.n).toBeGreaterThan(0);
    const step = bookOrder(startBook(), { ...o, n: 100_000, gold: 1e9 }, at(o.t + 30_000));
    expect(step.forged).toMatch(/за привоз — привезли/);
  });

  it('отряд стоял у другого города — отказ и флаг; в пути у сервера — отказ без флага, цепочка с партией', () => {
    const { orders } = honest();
    const o = orders[0];
    const far = standWay('normal', { x: TOWN.x + 30, y: TOWN.y }, NOW - 3_600_000);
    const away = bookOrder(startBook(), o, at(o.t + 30_000, { way: far }));
    expect(away.forged).toMatch(/отряд стоял в/);
    // Вышел к другому городу раньше сделки и ещё идёт — у сервера в пути.
    const going = { from: { x: TOWN.x, y: TOWN.y }, to: { x: TOWN.x + 30, y: TOWN.y }, at: o.t - 60_000, until: o.t + 3_600_000 };
    const late = bookOrder(startBook(), o, at(o.t + 30_000, { way: going }));
    expect([late.error !== null, late.forged, late.keep]).toEqual([true, null, true]);
    expect(late.book.trade!.towns[0].press.iron).toBeDefined();
    expect(late.book.trade!.n).toBe(0);
    // Вышел после сделки — в минуту сделки стоял у города: принято.
    const after = { ...going, at: o.t + 60_000 };
    expect(bookOrder(startBook(), o, at(o.t + 30_000, { way: after })).error).toBeNull();
  });

  it('реестр: честная сделка ложится в книгу строки; подделка — отказ и флаг «forged», книга прежняя', () => {
    const { orders } = honest();
    const row = { way: { ...WAY }, born: NOW - 86_400_000, name: 'Ратко', prestige: 0, men: 60, seenAt: NOW - 60_000, book: startBook() };
    const file = { ...emptyRoster(), bands: { me: row } };
    const o = orders[0];
    const ok = bandOrder(file, 'me', o, o.t + 30_000, null);
    expect(ok.error).toBeNull();
    expect(ok.file.bands!.me.book!.trade!.n).toBe(1);
    const bad = bandOrder(file, 'me', { ...o, key: 'trade-bad-1', gold: o.gold * 10 }, o.t + 30_000, null);
    expect(bad.error).not.toBeNull();
    expect(bad.forged?.kind).toBe('forged');
    expect(bad.file.bands!.me.book!.trade).toBeUndefined();
  });
});
