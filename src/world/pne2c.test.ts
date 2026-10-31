// ПН-Э2в (docs/gdd/path_of_sword.md, 3.7.1, 23.10): караванный кошель вольного города — отдельный от кошеля купцов привоза рынка лорда.
// Его читает только рынок с ключом вольного города; размер — от уровня рынка и специализации, пополнение — само, по прямой; цена — та же
// кривая продажи: каждая проданная штука одного товара в одном городе дешевле; круг «туда — обратно» держит пополнение кошеля.
//
// Граница области — утверждениями: продажа, на которой меряется кошель, правда идёт из кошеля (`fromPurse`) и правда прошла; круг правда
// упирается в кошель (отказ словами кошеля), а не в обоз или нажим; у лорда рынок правда есть (уровень выше нуля) и сделка правда прошла.
import { describe, expect, it, vi } from 'vitest';
import type { GameState, GoodId } from '@/game/types';
import { createInitialState } from '@/game/state';
import { beginRoam } from '@/game/sim/roam';
import { buyGoods, marketLot, marketMax, marketPurse, marketSellPrice, saleCheck, sellGoods, shiftLevel } from '@/game/sim/market';
import { GOOD_BY_ID } from '@/game/data/market';
import { caravanLeft, caravanUnit, fromPurse, purseOf, shiftOf } from '@/game/marketrules';
import { marketLevel } from '@/game/derived';
import { townKeyOf, townMarketLevel } from '@/game/townrules';
import { roamStub } from '@/game/roamstubs';
import { standWay } from './roammove';
import { pointsIn, type RoamPoint } from './roampoints';
import { TOWN_SPEC_META, townCaravan, townSpecOf, type TownSpec } from './townspec';
import '@/game/roamdoor';

vi.mock('@/game/roamflag', () => ({ ROAM_ON: true, roamOpenFor: () => true, roamOn: () => true, setRoamOpen: () => {} }));

const NOW = 1_900_000_000_000;
const HOUR = 3_600_000;
const TOWNS = pointsIn(0, 600, 1200, 900, 1500).filter((p) => p.kind === 'town' && p.tier > 0);
const bySpec = (spec: TownSpec, tier?: number): RoamPoint => {
  const t = TOWNS.find((p) => townSpecOf(p.x, p.y) === spec && (tier === undefined || p.tier === tier));
  expect(t, `город «${spec}»${tier ? ` ступени ${tier}` : ''}`).toBeDefined();
  return t as RoamPoint;
};
/** Покупатель железа (ему нужно) и делающий его город. */
const BUYER = bySpec('granary');
const MAKER = bySpec('ore');
const keyOf = (t: RoamPoint): `town:${string}` => townKeyOf(t.x, t.y);
/** Товары на продажу в круге — всё, что едет обозом, кроме невольников. */
const WANTED: GoodId[] = ['wood', 'iron', 'stone', 'copper', 'hides', 'charcoal', 'food'];

function party(purse = 50_000): GameState {
  const s = createInitialState(7);
  expect(beginRoam(s, { origin: 'warrior', hero: { name: 'Ратко', war: 2 }, band: { spearman: 40, clubman: 20 }, purse, food: 200 })).toBeNull();
  s.roam!.way = standWay('normal', { x: BUYER.x, y: BUYER.y }, NOW - 60_000);
  return s;
}

/** Положить в обоз `n` штук ресурса (как привезённое из другого города). */
const carry = (s: GameState, good: GoodId, n: number): void => {
  const r = GOOD_BY_ID[good].resource!;
  s.roam!.cargo[r] = (s.roam!.cargo[r] ?? 0) + n;
};

describe('караванный кошель вольного города (ПН-Э2в)', () => {
  it('размер — от уровня рынка и специализации: глубина нужных городу товаров; больше город — толще, ремеслу нужно больше всех', () => {
    const swing = roamStub('townSpec');
    for (const t of TOWNS.slice(0, 12)) {
      const lv = townMarketLevel(t.tier as 1 | 2 | 3);
      const c = townCaravan(t.x, t.y, lv);
      expect(c.cap).toBe(Math.floor(caravanUnit(lv, TOWN_SPEC_META[townSpecOf(t.x, t.y)].wants, swing) * roamStub('caravanSize')));
      expect(c.cap).toBeGreaterThan(0);
      expect(c.refillMs).toBe(roamStub('caravanRefill') * HOUR);
    }
    // Граница: та же специализация на разных уровнях; разные специализации на одном уровне.
    const wants = TOWN_SPEC_META.granary.wants;
    expect(caravanUnit(9, wants, swing)).toBeGreaterThan(caravanUnit(3, wants, swing));
    expect(caravanUnit(3, TOWN_SPEC_META.craft.wants, swing)).toBeGreaterThan(caravanUnit(3, wants, swing));
    expect(caravanUnit(0, wants, swing)).toBe(0);
  });

  it('продажа у вольного города тратит караванный кошель; он пополняется по прямой до полного и новым привозом не обнуляется', () => {
    const s = party();
    const key = keyOf(BUYER);
    const c = townCaravan(BUYER.x, BUYER.y, townMarketLevel(BUYER.tier as 1 | 2 | 3));
    expect(marketPurse(s, NOW, key)).toBe(c.cap);
    for (const g of WANTED) carry(s, g, 5000);
    expect(fromPurse('iron')).toBe(true);
    let gold = 0;
    for (const g of WANTED) {
      const n = marketMax(s, g, 'sell', NOW, key);
      if (n <= 0) continue;
      expect(sellGoods(s, g, n, NOW, key)).toBeNull();
      gold += s.roam!.markets![key].deals!.slice(-1)[0].gold;
    }
    // Граница: продано больше, чем кошель вернёт за привоз, — иначе новый привоз застал бы его полным и не мерил бы ничего.
    expect(gold).toBeGreaterThan((c.cap * 3 * HOUR) / c.refillMs);
    expect(marketPurse(s, NOW, key)).toBe(c.cap - gold);
    // Четверть срока пополнения — вернулась четверть полного кошеля (не выше полного).
    const half = NOW + c.refillMs / 4;
    expect(marketPurse(s, half, key)).toBeCloseTo(Math.min(c.cap, c.cap - gold + c.cap / 4), 6);
    // Новый привоз (через 3 ч) кошель не обнуляет: недостача отходит только сроком.
    const next = NOW + 3 * HOUR;
    expect(shiftOf(next)).not.toBe(shiftOf(NOW));
    expect(marketPurse(s, next, key)).toBe(caravanLeft(c.cap, c.refillMs, [gold, NOW], next));
    expect(marketPurse(s, next, key)).toBeLessThan(c.cap);
  });

  it('цена падает по мере продажи одного товара в одном городе: следующая штука дешевле, вторая партия дешевле первой', () => {
    const s = party();
    const key = keyOf(BUYER);
    carry(s, 'iron', 400);
    const iron = GOOD_BY_ID.iron;
    const first = marketSellPrice(s, iron, NOW, key);
    const lot1 = marketLot(s, iron, -100, NOW, key).gold;
    expect(sellGoods(s, 'iron', 100, NOW, key)).toBeNull();
    // Граница: продажа правда прошла и из кошеля; кошель не кончился — цена падает не от него.
    expect(marketPurse(s, NOW, key)).toBeGreaterThan(lot1);
    expect(marketSellPrice(s, iron, NOW, key)).toBeLessThan(first);
    const lot2 = marketLot(s, iron, -100, NOW, key).gold;
    expect(lot2).toBeLessThan(lot1);
    // Другой товар в том же городе — своя цена: продажа железа хлеб не сбивает.
    const food = GOOD_BY_ID.food;
    const fresh = party();
    expect(marketSellPrice(s, food, NOW, key)).toBe(marketSellPrice(fresh, food, NOW, key));
  });

  it('без бесконечного круга: сколько ни возить туда-обратно, город за срок платит не больше кошеля и его пополнения', () => {
    const s = party(5_000_000);
    const sell = keyOf(BUYER);
    const buy = keyOf(MAKER);
    const c = townCaravan(BUYER.x, BUYER.y, townMarketLevel(BUYER.tier as 1 | 2 | 3));
    let paid = 0;
    let purseHit = false;
    const span = 24 * HOUR;
    for (let t = NOW; t < NOW + span; t += HOUR) {
      // Купить у делающего, что привезли, и продать нуждающемуся всё, что возьмут, пока последняя штука хоть монету; обоз не кончается.
      buyGoods(s, 'iron', 60, t, buy);
      for (const g of WANTED) carry(s, g, 3000);
      for (const g of WANTED) {
        const max = marketMax(s, g, 'sell', t + HOUR / 2, sell);
        const over = saleCheck(s, g, max + 1, t + HOUR / 2, sell);
        if (over.blocked && /кончилось серебро|осталось \d+ серебра/.test(over.blocked)) purseHit = true;
        if (max <= 0) continue;
        paid += marketLot(s, GOOD_BY_ID[g], -max, t + HOUR / 2, sell).gold;
        expect(sellGoods(s, g, max, t + HOUR / 2, sell)).toBeNull();
      }
    }
    // Граница: круг правда упёрся в кошель — иначе мерили бы нажим, а не кошель.
    expect(purseHit).toBe(true);
    expect(paid).toBeLessThanOrEqual(c.cap + (c.cap * span) / c.refillMs + 1);
  });

  it('рынок лорда кошеля каравана не читает: продажа — из кошеля купцов привоза, поля `cv` у своего города нет', () => {
    const s = createInitialState(11);
    const lv = shiftLevel(s, NOW);
    // Граница: у лорда рынок есть, кошель купцов привоза — правило рынка лорда.
    expect(marketLevel(s)).toBeGreaterThan(0);
    expect(marketPurse(s, NOW)).toBe(purseOf(lv));
    s.resources.wood = 500;
    expect(sellGoods(s, 'wood', 10, NOW)).toBeNull();
    const gold = s.market.deals!.slice(-1)[0].gold;
    expect(gold).toBeGreaterThan(0);
    expect(s.market.cv).toBeUndefined();
    expect(s.market.got).toBe(gold);
    expect(marketPurse(s, NOW)).toBe(purseOf(lv) - gold);
    // И у бродяги: город лорда `home` — тот же кошель купцов привоза, а не караванный (кусок пути загружен — townSide есть).
    const r = party();
    expect(marketPurse(r, NOW, 'home')).toBe(Math.max(0, purseOf(shiftLevel(r, NOW, 'home'))));
  });

  it('сделка у вольного города кладёт приказ книги торга: клетка, товар, штук, золото и минута', () => {
    const s = party();
    const key = keyOf(BUYER);
    carry(s, 'iron', 30);
    expect(sellGoods(s, 'iron', 30, NOW, key)).toBeNull();
    expect(buyGoods(s, 'food', 5, NOW + 1000, key)).toBeNull();
    const box = (s.roam!.outbox ?? []).filter((o) => o.op === 'trade');
    const deals = s.roam!.markets![key].deals!;
    expect(box).toEqual([
      { op: 'trade', key: expect.any(String), at: { x: BUYER.x, y: BUYER.y }, good: 'iron', n: -30, gold: deals[0].gold, t: NOW },
      { op: 'trade', key: expect.any(String), at: { x: BUYER.x, y: BUYER.y }, good: 'food', n: 5, gold: deals[1].gold, t: NOW + 1000 },
    ]);
    // У лорда приказов нет: рынок `home` книгу торга не зовёт.
    const lord = createInitialState(11);
    lord.resources.wood = 500;
    expect(sellGoods(lord, 'wood', 10, NOW)).toBeNull();
    expect(lord.roam).toBeUndefined();
  });
});
