// Книга обоза отряда на сервере (БЕЗ-1, docs/trust-boundary.md, 5в): сколько каждого товара сервер подтверждает в обозе — потолок, как у
// людей. Растёт только тем, что сервер решает или ограничивает сам (покупка, указ, груз договора, хлеб села, снаряжение распущенных и
// разжалованных, добыча и дань вольного замка), убывает продажей, сдачей груза и отметкой обоза. Продажа сверх книги — отказ и флаг.
//
// Граница области — утверждениями: честные дела партии сняты с дверей игры (приказы из очереди партии, отметка — `bandseat.cargoOf`),
// отряд правда стоит у города и села, подделка отличается от честной продажи одной штукой — и та же продажа без лишней штуки принята.
import { describe, expect, it, vi } from 'vitest';
import type { BandBookOrder, RoamBookRow } from '../../netlify/lib/contract';
import { bandOrder, emptyRoster } from '../../netlify/lib/roster';
import { BOOK_SLACK_MS, bookGrants, bookHauls, bookOrder, cargoClaim, startBook, type BookAt } from '../../netlify/lib/roambook';
import { haulsOf } from '../../netlify/lib/routes/castles';
import type { WarRow } from '../../netlify/lib/war';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { beginRoam } from '@/game/sim/roam';
import { sellGoods } from '@/game/sim/market';
import { buyVillageFood } from '@/game/sim/roamtown';
import { dismissBand } from '@/game/sim/bandranks';
import { townKeyOf, villageLeft, villageStock } from '@/game/townrules';
import { cargoGoods } from '@/game/contractrules';
import { cargoOf } from '@/net/bandseat';
import { standWay } from './roammove';
import { pointsIn, type RoamPoint } from './roampoints';
import '@/game/roamdoor';

vi.mock('@/game/roamflag', () => ({ ROAM_ON: true, roamOpenFor: () => true, roamOn: () => true, setRoamOpen: () => {} }));

const NOW = 1_900_000_000_000;
const TOWN = pointsIn(0, 600, 1200, 900, 1500).find((p) => p.kind === 'town' && p.tier > 0) as RoamPoint;
const KEY = townKeyOf(TOWN.x, TOWN.y);
const WAY = standWay('normal', { x: TOWN.x, y: TOWN.y }, NOW - 3_600_000);
const at = (now: number, over: Partial<BookAt> = {}): BookAt => ({ now, cell: { x: TOWN.x, y: TOWN.y }, moving: false, seed: 1, way: WAY, ...over });

function party(): GameState {
  const s = createInitialState(7);
  expect(beginRoam(s, { origin: 'warrior', hero: { name: 'Ратко', war: 2 }, band: { spearman: 40, clubman: 20 }, purse: 100_000, food: 200 })).toBeNull();
  s.roam!.way = WAY;
  return s;
}

/** Очередь партии — через книгу по порядку, минутой позже; снятые сервером приказы — из очереди. */
function drain(s: GameState, book: RoamBookRow, now: number, where: BookAt = at(now)): { book: RoamBookRow; errors: (string | null)[]; flags: (string | null)[] } {
  const errors: (string | null)[] = [];
  const flags: (string | null)[] = [];
  for (const o of s.roam!.outbox ?? []) {
    const step = bookOrder(book, o, { ...where, now });
    errors.push(step.error);
    flags.push(step.forged);
    if (!step.error || step.keep) book = step.book;
  }
  s.roam!.outbox = [];
  return { book, errors, flags };
}

type Sell = Extract<BandBookOrder, { op: 'trade' }>;

describe('книга обоза: честный отряд', () => {
  it('новый отряд: книга обоза заводится отметкой — хлеб старта, без флага', () => {
    const s = party();
    expect(s.roam!.cargo.food, 'точка внутри области: хлеб старта в обозе').toBe(200);
    const got = cargoClaim(startBook(), cargoOf(s.roam!), true);
    expect(got.forged).toBeNull();
    expect(got.book.cargo).toEqual({ food: 200 });
  });

  it('хлеб села, снаряжение распущенных и указ — ложатся в книгу; продажа всего этого принята, отметка без флага', () => {
    const s = party();
    let book = cargoClaim(startBook(), cargoOf(s.roam!), true).book;
    // Указ админа: железо в обоз — той же дверью, что партия (`sim/bandgrant.toBand`), книга — `bookGrants`.
    const grant = { n: 1, at: NOW, stock: { iron: 30 }, troops: {} };
    s.roam!.cargo.iron = 30;
    book = bookGrants(book, [grant]);
    // Распустить двух копейщиков: два копья в обоз.
    expect(dismissBand(s, 'spearman', 2)).toBeNull();
    // Хлеб у села: отряд стоит у села.
    const village = pointsIn(7, TOWN.x - 30, TOWN.y - 30, TOWN.x + 30, TOWN.y + 30).find((p) => p.kind === 'village') as RoamPoint;
    expect(village, 'точка внутри области: село рядом').toBeDefined();
    const vWay = standWay('normal', { x: village.x, y: village.y }, NOW - 3_600_000);
    s.roam!.way = vWay;
    expect(buyVillageFood(s, { ...village, kind: 'village', tier: 0 }, 40, NOW)).toBeNull();
    let run = drain(s, book, NOW + 30_000, { now: NOW, cell: { x: village.x, y: village.y }, moving: false, seed: 1, way: vWay });
    expect(run.errors, 'роспуск и хлеб села приняты').toEqual([null, null]);
    book = run.book;
    expect(book.cargo).toEqual({ food: 240, iron: 30, 'eq:spear': 2 });
    expect(cargoClaim(book, cargoOf(s.roam!)).forged, 'отметка честного обоза — без флага').toBeNull();
    // В город — и продать всё, что легло.
    s.roam!.way = WAY;
    expect(sellGoods(s, 'iron', 30, NOW + 60_000, KEY)).toBeNull();
    expect(sellGoods(s, 'eq:spear', 2, NOW + 90_000, KEY)).toBeNull();
    expect(sellGoods(s, 'food', 40, NOW + 120_000, KEY)).toBeNull();
    run = drain(s, book, NOW + 150_000);
    expect(run.errors).toEqual([null, null, null]);
    expect(run.flags).toEqual([null, null, null]);
    expect(run.book.cargo).toEqual({ food: 200 });
    expect(cargoClaim(run.book, cargoOf(s.roam!)).forged).toBeNull();
  });

  it('добыча и дань вольного замка — из записи войн, каждая один раз; золото — не в обоз', () => {
    const wars = [
      { id: 'w1', fall: { fate: 'plunder', taken: { iron: 50, wood: 20, gold: 300 } } },
      { id: 'w2', fall: { fate: 'burn', taken: { iron: 999 } } },
      { id: 'w3', end: 'paid', tribute: { taken: { stone: 15, gold: 40 } } },
    ] as unknown as WarRow[];
    const h = haulsOf(wars);
    expect(h.map((x) => x.id)).toEqual(['fall:w1', 'paid:w3']);
    const book = bookHauls({ ...startBook(), cargo: {} }, h);
    expect(book.cargo).toEqual({ iron: 50, wood: 20, stone: 15 });
    expect(bookHauls(book, h).cargo, 'второй раз — не ложится').toEqual(book.cargo);
  });

  it('груз «довезти»: в книгу при взятии (не больше груза тира), с книги при сдаче', () => {
    const most = cargoGoods(1);
    const book: RoamBookRow = { ...startBook(), cargo: {} };
    const take = bookOrder(book, { op: 'take', key: 'take-1-1', at: { x: TOWN.x, y: TOWN.y }, tier: 1, goods: { id: 'iron', n: most } }, at(NOW));
    expect(take.error).toBeNull();
    expect(take.book.cargo).toEqual({ iron: most });
    const over = bookOrder(book, { op: 'take', key: 'take-1-2', at: { x: TOWN.x, y: TOWN.y }, tier: 1, goods: { id: 'iron', n: most + 1 } }, at(NOW));
    expect(over.error).not.toBeNull();
    expect(over.forged).toMatch(/груз iron/);
    const deal = bookOrder(take.book, { op: 'deal', key: 'deal-1-3', take: 'take-1-1', gold: 1, fame: 0 }, at(NOW + 60_000));
    expect(deal.error).toBeNull();
    expect(deal.book.cargo).toEqual({});
  });
});

describe('книга обоза: подделка', () => {
  const sell = (good: string, n: number, gold = 1): Sell => ({ op: 'trade', key: `trade-9-${good}-${n}`, at: { x: TOWN.x, y: TOWN.y }, good, n: -n, gold, t: NOW });

  it('продать товар, которого нет в обозе книги, — отказ и флаг; той же продажи в пределах книги — принята', () => {
    const book: RoamBookRow = { ...startBook(), cargo: { iron: 10 } };
    const ok = bookOrder(book, sell('iron', 10), at(NOW + 30_000));
    expect(ok.error, 'точка внутри области: продажа в пределах книги принята').toBeNull();
    expect(ok.book.cargo).toEqual({});
    const bad = bookOrder(book, sell('iron', 11), at(NOW + 30_000));
    expect(bad.error).toBe('Столько этого товара в обозе нет.');
    expect(bad.forged).toMatch(/продано 11 .* а в обозе книги 10/);
    const none = bookOrder(book, sell('copper', 1), at(NOW + 30_000));
    expect(none.error).toBe('Столько этого товара в обозе нет.');
    expect(none.forged).toMatch(/в обозе книги 0/);
  });

  it('отметка обоза сверх книги — флаг, книга не растёт; меньше — книга опускается', () => {
    const book: RoamBookRow = { ...startBook(), cargo: { iron: 10, food: 50 } };
    const up = cargoClaim(book, { iron: 500, food: 50 });
    expect(up.forged).toMatch(/iron 500 при 10/);
    expect(up.book.cargo).toEqual({ iron: 10, food: 50 });
    const down = cargoClaim(book, { food: 20 });
    expect(down.forged).toBeNull();
    expect(down.book.cargo).toEqual({ food: 20 });
  });

  it('новый отряд не заводит книгу чужим грузом: только хлеб старта, прочее — флаг', () => {
    const got = cargoClaim(startBook(), { food: 100, iron: 80 }, true);
    expect(got.forged).toMatch(/iron 80 в обозе нового отряда/);
    expect(got.book.cargo).toEqual({ food: 100 });
  });

  it('хлеб села сверх запаса дня — отказ и флаг; в пределах — принят', () => {
    const book: RoamBookRow = { ...startBook(), cargo: {} };
    const full = villageStock();
    const ok = bookOrder(book, { op: 'bread', key: 'bread-9-1', at: { x: TOWN.x, y: TOWN.y }, n: Math.floor(full) }, at(NOW));
    expect(ok.error, 'точка внутри области: весь запас дня принят').toBeNull();
    // Та же минута: запас дня разобран; остаётся только отход за запаздывание часов (`BOOK_SLACK_MS`) — граница с обеих сторон.
    const slack = Math.floor(villageLeft(Math.floor(full), NOW, NOW + BOOK_SLACK_MS));
    expect(slack, 'отход за запаздывание меньше запаса дня').toBeLessThan(full / 10);
    const again = bookOrder(ok.book, { op: 'bread', key: 'bread-9-2', at: { x: TOWN.x, y: TOWN.y }, n: slack + 1 }, at(NOW));
    expect(again.error).not.toBeNull();
    expect(again.forged).toMatch(/запас дня села/);
    expect(bookOrder(ok.book, { op: 'bread', key: 'bread-9-3', at: { x: TOWN.x, y: TOWN.y }, n: Math.max(1, slack) }, at(NOW)).error).toBeNull();
  });

  it('реестр: отметка нового отряда с обозом заводит книгу обоза', () => {
    const done = bandOrder(emptyRoster(), 'tg-77', { op: 'seat', name: 'Ратко', prestige: 0, men: 6, troops: { spearman: 4, clubman: 2 }, cargo: { food: 30, iron: 9 } }, NOW, null);
    expect(done.error).toBeNull();
    expect(done.file.bands?.['tg-77']?.book?.cargo).toEqual({ food: 30 });
    expect(done.forged?.text).toMatch(/iron 9 в обозе нового отряда/);
  });
});
