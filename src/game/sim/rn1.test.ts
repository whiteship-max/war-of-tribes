// Рынок РН-1 (docs/city_v3.md, «Решения РН-1»): любой товар — и купить, и продать; перепродажа не в плюс ни в один привоз;
// сбитие цены партией и его отход; смена привоза по настоящим часам; кошель купцов; старое сохранение; книга рынка сервера,
// подделка и двойная сделка с двух устройств.
//
// Области (правило 11): рынок 10-го уровня — привозят почти всё, кошель большой; минута — 10:00 UTC (привоз 09–12, сетка 3 ч);
// нажим — внутри глубины и за ней; привозы — сутки вперёд и месяц для перебора; часы — внутри привоза и через его границу.
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameState } from '../types';
import { createInitialState } from '../state';
import { MAX_BUILDING_LEVEL } from '../constants';
import { BONDED_GOOD, GOODS, GOOD_BY_ID, type GoodDef } from '../data/market';
import {
  BOOST_MAX,
  PRESS_HALF,
  PRICE_SWING,
  SALE_SHARE,
  SHIFT,
  buyUnit,
  depthOf,
  lotOf,
  pressAt,
  purseOf,
  sellUnit,
  shiftOf,
  shiftOffer,
  shiftStart,
} from '../marketrules';
import { buildingOfType } from '../derived';
import {
  buyGoods,
  marketCheck,
  marketDepth,
  marketHas,
  marketLeft,
  marketMax,
  marketPress,
  marketPurse,
  marketSellPrice,
  marketSold,
  marketSupply,
  ownOf,
  saleCheck,
  sellGoods,
} from './market';
import { catchUp, liveStep } from './tick';
import { mergeMarket, rollShift } from './caravan';
import { seeded, setRandom } from './random';
import { deserialize, serialize } from '../save';
import { watchOf } from '@/net/snapshot';
import { decide } from '@/net/sync';
import { marketFaults } from '../../../netlify/lib/market';
import { GROWTH_SLACK, marketBoost, prodOf } from '../../../netlify/lib/watch';
import type { WatchCard } from '../../../netlify/lib/contract';

beforeEach(() => setRandom(seeded(7)));

/** 10:00 UTC — привоз 09:00–12:00 (сетка РН-1б). */
const NOW = Date.UTC(2026, 9, 23, 10, 0);
const ALL: GoodDef[] = [...GOODS, BONDED_GOOD];

/** Город с рынком 10-го уровня, полным золотом и запасом всего, что продают. */
function town(): GameState {
  const s = createInitialState(7);
  s.tutorialDone = true;
  for (const b of s.buildings) if (b.type === 'market' || b.type === 'storage') b.level = MAX_BUILDING_LEVEL;
  s.gold = 50_000_000;
  for (const r of Object.keys(s.resources) as (keyof GameState['resources'])[]) s.resources[r] = 500;
  for (const e of Object.keys(s.equipment) as (keyof GameState['equipment'])[]) s.equipment[e] = 50;
  s.bonded = 50;
  s.tax = 'none';
  return s;
}

const sell = (s: GameState, def: GoodDef, n: number, now: number): number => {
  const g = s.gold;
  expect(sellGoods(s, def.id, n, now)).toBeNull();
  return s.gold - g;
};

describe('каждый товар — и купить, и продать', () => {
  it('всё, что привезли, покупается, всё, что есть, продаётся; не привезённое — с причиной', () => {
    const s = town();
    expect(buildingOfType(s, 'market')!.level, 'область: рынок 10-го уровня').toBe(MAX_BUILDING_LEVEL);
    let bought = 0;
    for (const def of ALL) {
      if (marketHas(s, def, NOW)) {
        expect(buyGoods(s, def.id, 3, NOW), def.id).toBeNull();
        bought++;
      } else expect(marketCheck(s, def.id, 3, NOW).blocked).toBe('Рынок пуст: этого не привезли.');
      const before = ownOf(s, def);
      expect(sell(s, def, 2, NOW), def.id).toBeGreaterThan(0);
      expect(ownOf(s, def)).toBe(before - 2);
    }
    expect(bought, 'на 10-м уровне привозят почти всё').toBeGreaterThanOrEqual(GOODS.length);
    // И на первом уровне каждый товар привозят — за десять суток хоть раз, и его можно купить.
    for (const def of GOODS) {
      expect(Array.from({ length: 40 }, (_, k) => k).some((k) => shiftOffer(shiftOf(NOW) + k, 1).includes(def.id)), def.id).toBe(true);
    }
  });
});

describe('перепродажа — в ноль или в минус всегда', () => {
  it('доля продажи выведена: при щедрейшей прибавке и самом дорогом привозе против дешёвого — не дороже покупки', () => {
    expect(SALE_SHARE * (1 + PRICE_SWING) * BOOST_MAX).toBeLessThanOrEqual(1);
  });

  it('купить и продать в одну смену привоза — в ноль или в минус, любой товар, любая партия, с Казначеем и купечеством', () => {
    for (const def of ALL) {
      for (const n of [1, 7, 100, 1000]) {
        const s = town();
        if (!marketHas(s, def, NOW) || marketLeft(s, def, NOW) < n) continue;
        const gold = s.gold;
        expect(buyGoods(s, def.id, n, NOW)).toBeNull();
        // Груз ещё в пути — продаём своё, тем же числом: нажим поднят покупкой.
        const w = shiftOf(NOW);
        const d = depthOf(def, MAX_BUILDING_LEVEL);
        const back = lotOf(def, w, d, marketPress(s, def.id, NOW), -n, BOOST_MAX).gold;
        expect(back, `${def.id} × ${n}`).toBeLessThanOrEqual(gold - s.gold);
      }
    }
  });

  it('купить в один привоз и продать в любой другой — тоже не в плюс (перебор месяца привозов, мелкий рынок и средний)', () => {
    const w0 = shiftOf(NOW);
    const month = Array.from({ length: 120 }, (_, i) => w0 + i);
    for (const def of ALL) {
      for (const level of [1, 5]) {
        // Область: на первом уровне глубина мельче всего — шаг одной штуки весит больше всего.
        const d = depthOf(def, level);
        const cheap = month.reduce((x, w) => (buyUnit(def, w, d, 0) < buyUnit(def, x, d, 0) ? w : x));
        const dear = month.reduce((x, w) => (sellUnit(def, w, d, 1, BOOST_MAX) > sellUnit(def, x, d, 1, BOOST_MAX) ? w : x));
        expect(sellUnit(def, dear, d, 1, BOOST_MAX), `${def.id} ур. ${level}: ${cheap}→${dear}`).toBeLessThanOrEqual(buyUnit(def, cheap, d, 0));
        expect(lotOf(def, dear, d, d, -d, BOOST_MAX).gold).toBeLessThanOrEqual(lotOf(def, cheap, d, 0, d).gold);
      }
    }
  });

  it('продать, а потом выкупить — тоже не в плюс: продажа сбивает выручку, а не цену ввоза', () => {
    const def = GOOD_BY_ID.iron;
    const d = depthOf(def, 5);
    const w = shiftOf(NOW);
    const got = lotOf(def, w, d, 0, -d, BOOST_MAX).gold;
    expect(lotOf(def, w, d, -d, d).gold).toBeGreaterThan(got);
    expect(buyUnit(def, w, d, -d)).toBe(buyUnit(def, w, d, 0));
  });
});

describe('сбитие и отход', () => {
  it('каждая следующая проданная штука дешевле, купленная — дороже; на глубине — вдвое', () => {
    const def = GOOD_BY_ID.food;
    const w = shiftOf(NOW);
    const d = depthOf(def, 5);
    expect(sellUnit(def, w, d, -10, 1)).toBeLessThanOrEqual(sellUnit(def, w, d, 0, 1));
    expect(buyUnit(def, w, d, d)).toBeGreaterThanOrEqual(2 * buyUnit(def, w, d, 0) - 1);
    // Гипербола продажи: на минус глубине — вдвое ниже (с округлением вниз).
    const top = SALE_SHARE * def.price * (sellUnit(def, w, d, 1, 1) / (SALE_SHARE * def.price));
    expect(sellUnit(def, w, d, -d + 1, 1)).toBeLessThanOrEqual(Math.ceil(top / 2));
  });

  it('продажа партии по одной штуке не обходит сбитие: та же сумма до монеты', () => {
    for (const def of [GOOD_BY_ID.wood, GOOD_BY_ID['eq:sword'], BONDED_GOOD]) {
      const a = town();
      const b = town();
      // Область: партия внутри кошеля купцов (у меча — дорогая штука).
      const n = 8;
      expect(saleCheck(a, def.id, n, NOW).blocked).toBeNull();
      const whole = sell(a, def, n, NOW);
      let pieces = 0;
      for (let i = 0; i < n; i++) pieces += sell(b, def, 1, NOW);
      expect(pieces, def.id).toBe(whole);
      // И цена следующей штуки после обеих — одна.
      expect(marketSellPrice(b, def, NOW)).toBe(marketSellPrice(a, def, NOW));
    }
  });

  it('нажим отходит сам: вдвое за полураспад, к новому привозу — 1/16; часы назад — как был', () => {
    expect(pressAt(100, 0, PRESS_HALF)).toBeCloseTo(50, 9);
    expect(pressAt(100, 0, SHIFT)).toBeCloseTo(100 / 16, 9);
    expect(pressAt(-80, 1000, 1000 + PRESS_HALF / 2)).toBeCloseTo(-60, 9);
    expect(pressAt(100, 5000, 1000)).toBe(100);
    const s = town();
    sell(s, GOOD_BY_ID.iron, 150, NOW);
    expect(marketPress(s, 'iron', NOW)).toBe(-150);
    expect(marketPress(s, 'iron', NOW + PRESS_HALF)).toBeCloseTo(-75, 9);
    expect(marketSellPrice(s, GOOD_BY_ID.iron, NOW + 4 * PRESS_HALF)).toBeGreaterThan(marketSellPrice(s, GOOD_BY_ID.iron, NOW));
  });
});

describe('привоз по настоящим часам', () => {
  it('восемь привозов в сутки — ровно каждые 3 часа по UTC (00, 03 … 21), у всех одна минута', () => {
    const utc = (h: number): number => Date.UTC(2026, 9, 23, h, 0);
    const hours = [0, 3, 6, 9, 12, 15, 18, 21];
    const w0 = shiftOf(utc(0));
    expect(hours.map((h) => shiftOf(utc(h)) - w0)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(shiftOf(Date.UTC(2026, 9, 24, 0, 0)) - w0, 'сутки — восемь привозов').toBe(8);
    for (const h of hours) {
      const w = shiftOf(utc(h));
      expect(shiftStart(w)).toBe(utc(h));
      // Точки внутри области: минута до начала — прежний привоз, последняя минута — этот же.
      expect(shiftOf(utc(h) - 1)).toBe(w - 1);
      expect(shiftOf(utc(h) + SHIFT - 1)).toBe(w);
    }
  });

  it('на границе привоза меняются цена основы, запас и ассортимент, а счёт купленного начинается заново', () => {
    const s = town();
    const def = GOODS.find((g) => marketHas(s, g, NOW))!;
    expect(buyGoods(s, def.id, 50, NOW)).toBeNull();
    const left = marketLeft(s, def, NOW);
    const edge = shiftStart(shiftOf(NOW)) + SHIFT;
    expect(edge - NOW, 'область: граница — внутри суток').toBeLessThan(SHIFT);
    expect(marketLeft(s, def, edge - 1)).toBe(left);
    const after = marketHas(s, def, edge) ? marketLeft(s, def, edge) : 0;
    expect(after === 0 || after !== left).toBe(true);
    const prices = ALL.map((g) => buyUnit(g, shiftOf(NOW), depthOf(g, 5), 0));
    const next = ALL.map((g) => buyUnit(g, shiftOf(NOW) + 1, depthOf(g, 5), 0));
    expect(next).not.toEqual(prices);
  });

  it('ночного урезания нет: у всех восьми привозов суток один кошель; запас — свой у привоза', () => {
    const s = town();
    const day = Array.from({ length: 8 }, (_, i) => shiftStart(shiftOf(NOW)) + i * SHIFT + 1000);
    expect(new Set(day.map((t) => marketPurse(s, t))).size).toBe(1);
    const food = GOOD_BY_ID.food;
    const sup = day.map((t) => marketSupply(s, food, t));
    expect(new Set(sup).size, 'запас — свой у привоза').toBeGreaterThan(1);
    for (const n of sup) expect(n / depthOf(food, MAX_BUILDING_LEVEL)).toBeGreaterThanOrEqual(1 - PRICE_SWING / 2 - 0.01);
  });
});

describe('глубина закреплена на привоз', () => {
  it('событие отняло уровень посреди привоза — глубина, запас и кошель прежние до следующего привоза', () => {
    const s = town();
    const def = GOOD_BY_ID.iron;
    sell(s, def, 1, NOW);
    expect(s.market.lv, 'уровень закреплён на привоз').toBe(MAX_BUILDING_LEVEL);
    const depth = marketDepth(s, def, NOW);
    const purse = marketPurse(s, NOW);
    buildingOfType(s, 'market')!.level = 3;
    const later = NOW + SHIFT / 2;
    expect(shiftOf(later), 'область: тот же привоз').toBe(shiftOf(NOW));
    expect(marketDepth(s, def, later)).toBe(depth);
    expect(marketPurse(s, later)).toBe(purse);
    expect(marketSellPrice(s, def, later)).toBe(sellUnit(def, shiftOf(later), depth, marketPress(s, def.id, later), 1));
    // Следующий привоз — по новому уровню: живой шаг закрепляет его в первую же минуту.
    const next = shiftStart(shiftOf(NOW) + 1) + 1000;
    rollShift(s, next);
    expect(s.market.lv).toBe(3);
    expect(marketDepth(s, def, next)).toBe(depthOf(def, 3));
    expect(marketPurse(s, next)).toBe(purseOf(3));
  });

  it('живой шаг закрепляет уровень в минуту начала привоза', () => {
    const s = town();
    const t = shiftStart(shiftOf(NOW) + 1) + 500;
    liveStep(s, 1, t);
    expect(s.market.w).toBe(shiftOf(t));
    expect(s.market.lv).toBe(MAX_BUILDING_LEVEL);
  });
});

describe('кошель купцов', () => {
  it('за излишек купцы платят не больше кошеля привоза; невольников уводят мимо него', () => {
    const s = town();
    s.resources.wood = 1_000_000;
    s.bonded = 1000;
    const purse = marketPurse(s, NOW);
    const max = marketMax(s, 'wood', 'sell', NOW);
    expect(saleCheck(s, 'wood', max, NOW).blocked).toBeNull();
    expect(saleCheck(s, 'wood', max + 1, NOW).blocked).toMatch(/У купцов|цена сбита/);
    sell(s, GOOD_BY_ID.wood, max, NOW);
    expect(marketPurse(s, NOW)).toBeLessThan(purse);
    expect(saleCheck(s, 'bonded', 1, NOW).blocked).toBeNull();
    // Новый привоз — новый кошель.
    expect(marketPurse(s, NOW + SHIFT)).toBeGreaterThan(marketPurse(s, NOW));
  });
});

describe('старое сохранение', () => {
  it('рынок до РН-1 (счёт дня) читается пустым привозом; телега в пути доезжает', () => {
    const s = createInitialState(7);
    const raw = JSON.parse(serialize(s)) as Record<string, unknown>;
    raw.market = { day: 12, bought: { wood: 30 }, sold: { bonded: 2 } };
    raw.caravans = [{ id: 999, good: 'wood', count: 7, gold: 21, departAt: 0, arriveAt: 5 }];
    const back = deserialize(JSON.stringify(raw))!;
    expect(back).not.toBeNull();
    expect(back.market.w).toBe(-1);
    expect(marketSold(back, 'bonded', NOW)).toBe(0);
    expect(mergeMarket(undefined)).toEqual({ w: -1, bought: {}, sold: {}, press: {}, got: 0, seq: 0, deals: [] });
    const wood = back.resources.wood;
    catchUp(back, 10, 1);
    expect(back.resources.wood).toBeGreaterThanOrEqual(wood + 7 - 1);
  });
});

/** Опись партии в минуту `at` — так её видит сервер. */
const card = (s: GameState): WatchCard => watchOf(s);
const faults = (a: WatchCard, aAt: number, b: WatchCard, bAt: number): string[] =>
  marketFaults(a, aAt, b, bAt, { boost: Math.max(marketBoost(a), marketBoost(b)), prod: prodOf(b), slack: GROWTH_SLACK });

describe('книга рынка сервера', () => {
  it('честные сделки — без флага: покупки, продажи, через границу привоза и с отходом нажима', () => {
    const s = town();
    const c0 = card(s);
    const def = GOODS.find((g) => marketHas(s, g, NOW))!;
    expect(buyGoods(s, def.id, 40, NOW)).toBeNull();
    sell(s, GOOD_BY_ID.wood, 30, NOW + 60_000);
    sell(s, BONDED_GOOD, 3, NOW + 120_000);
    sell(s, GOOD_BY_ID.wood, 10, NOW + PRESS_HALF);
    const edge = shiftStart(shiftOf(NOW)) + SHIFT + 1000;
    sell(s, GOOD_BY_ID.wood, 10, edge);
    const c1 = card(s);
    expect(c1.market?.deals.length).toBe(5);
    expect(faults(c0.market ? c0 : { ...c0, market: { w: -1, bought: {}, sold: {}, got: 0, seq: 0, press: {}, deals: [] } }, NOW - 1000, c1, edge + 1000)).toEqual([]);
  });

  const forged = (edit: (c: WatchCard) => void): string[] => {
    const s = town();
    sell(s, GOOD_BY_ID.iron, 1, NOW - 1000);
    const c0 = card(s);
    sell(s, GOOD_BY_ID.iron, 20, NOW);
    expect(buyGoods(s, GOODS.find((g) => marketHas(s, g, NOW))!.id, 10, NOW + 1000)).toBeNull();
    const c1 = card(s);
    expect(faults(c0, NOW - 500, c1, NOW + 5000), 'честная — без флага').toEqual([]);
    edit(c1);
    return faults(c0, NOW - 500, c1, NOW + 5000);
  };

  it('AC-5: две разные сделки под одним новым номером — флаг двойной сделки (архив prove-8-1)', () => {
    const s = town();
    sell(s, GOOD_BY_ID.iron, 1, NOW - 1000);
    const c0 = card(s);
    sell(s, GOOD_BY_ID.iron, 5, NOW);
    const c1 = card(s);
    expect(faults(c0, NOW - 500, c1, NOW + 5000), 'честная — без флага').toEqual([]);
    // Второе устройство продало под тем же номером другое: в опись легли обе сделки, счёт сдвинулся на одну.
    const deals = c1.market!.deals;
    const last = deals[deals.length - 1];
    c1.market!.deals = [...deals, { ...last, n: last.n - 3, gold: last.gold + 1 }];
    expect(faults(c0, NOW - 500, c1, NOW + 5000).join(' ')).toMatch(/двойная сделка/);
  });

  it('продано дороже правила — флаг', () => {
    expect(forged((c) => (c.market!.deals[c.market!.deals.length - 2].gold += 50)).join(' ')).toMatch(/продано за .* не больше/);
  });

  it('куплено дешевле правила — флаг', () => {
    expect(forged((c) => (c.market!.deals[c.market!.deals.length - 1].gold -= 5)).join(' ')).toMatch(/куплено за .* не меньше/);
  });

  it('нажим подделан (продажа «по свежей цене») — флаг', () => {
    expect(forged((c) => (c.market!.deals[c.market!.deals.length - 2].q = 0)).join(' ')).toMatch(/нажим/);
  });

  it('куплено больше привоза — флаг', () => {
    expect(
      forged((c) => {
        const d = c.market!.deals[c.market!.deals.length - 1];
        d.n = 1_000_000;
        c.market!.bought[d.good] = 1_000_000;
      }).join(' '),
    ).toMatch(/привезли не больше/);
  });

  it('продано больше, чем было на складе, — флаг', () => {
    const s = town();
    const c0 = card(s);
    // Невольники спрятаны от описи: в ней их 50, продано 100.
    s.bonded = 100_000;
    sell(s, BONDED_GOOD, 100, NOW);
    const out = faults({ ...c0, market: { w: -1, bought: {}, sold: {}, got: 0, seq: 0, press: {}, deals: [] } }, NOW - 1000, card(s), NOW + 1000);
    expect(out.join(' ')).toMatch(/было не больше/);
  });

  it('два устройства с одной партией: вторая запись не проходит встречу копий, а дошедшая до книги — флаг двойной сделки', () => {
    const base = town();
    sell(base, GOOD_BY_ID.iron, 1, NOW - 1000);
    const c0 = card(base);
    const a = deserialize(serialize(base))!;
    const b = deserialize(serialize(base))!;
    sell(a, GOOD_BY_ID.iron, 10, NOW);
    sell(b, GOOD_BY_ID.wood, 10, NOW + 10);
    // Встреча копий: A записала, у B прежний ETag — B уступает, а не пишет поверх.
    expect(decide({ hasLocal: true, remoteEtag: 'e1', knownEtag: 'e0' })).toBe('yield');
    // Книга: A легла, затем B (подделанный клиент протолкнул) — тот же номер сделки, другая сделка.
    const ca = card(a);
    const cb = card(b);
    expect(faults(c0, NOW - 500, ca, NOW + 1000)).toEqual([]);
    expect(faults(ca, NOW + 1000, cb, NOW + 2000).join(' ')).toMatch(/записана дважды по-разному/);
  });

  it('уровень упал посреди привоза: сделки по закреплённой глубине — без флага; закрепление выше рынка описей — флаг', () => {
    const s = town();
    sell(s, GOOD_BY_ID.iron, 1, NOW);
    buildingOfType(s, 'market')!.level = 3;
    // Обе описи видят упавший уровень: цену держит только закрепление привоза. Покупка — её прибавка не трогает, и мелкая
    // глубина поднимала бы цену втрое быстрее.
    const c0 = card(s);
    const def = GOODS.find((g) => g.resource && marketHas(s, g, NOW))!;
    expect(buyGoods(s, def.id, 100, NOW + 60_000)).toBeNull();
    const c1 = card(s);
    expect(c1.buildings.market, 'область: опись уже видит упавший уровень').toBe(3);
    expect(c1.market?.lv).toBe(MAX_BUILDING_LEVEL);
    expect(faults(c0, NOW - 500, c1, NOW + 120_000)).toEqual([]);
    // Подделка: закрепление выше рынка обеих описей.
    const forged = { ...c1, market: { ...c1.market!, lv: MAX_BUILDING_LEVEL + 5 } };
    expect(faults(c0, NOW - 500, forged, NOW + 120_000).join(' ')).toMatch(/Уровень привоза .* выше рынка описей/);
  });

  it('счёт сделок убыл — флаг', () => {
    const s = town();
    sell(s, GOOD_BY_ID.iron, 5, NOW);
    const c1 = card(s);
    const c0 = { ...c1, market: { ...c1.market!, seq: c1.market!.seq + 3 } };
    expect(faults(c0, NOW, c1, NOW + 1000).join(' ')).toMatch(/Счёт сделок убыл/);
  });
});
