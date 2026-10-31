// ПН-Э1 (docs/gdd/path_of_sword.md, «Решения ПН-Э1»): специализация вольных городов постоянной солью и
// рынок с ключом — одной дверью основы товара (`marketrules.specGood`); у лорда рынок прежний.
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { beginRoam } from '@/game/sim/roam';
import { marketLot, marketPrice, marketSellPrice } from '@/game/sim/market';
import { GOOD_BY_ID, GOODS } from '@/game/data/market';
import { SALE_SHARE, buyUnit, depthOf, sellUnit, shiftOf, specGood } from '@/game/marketrules';
import { townKeyOf } from '@/game/townrules';
import { roamStub } from '@/game/roamstubs';
import { standWay } from './roammove';
import { pointsIn, type RoamPoint } from './roampoints';
import { TOWN_SPECS, TOWN_SPEC_META, specMult, townSpecOf, type TownSpec } from './townspec';
import '@/game/roamdoor';

vi.mock('@/game/roamflag', () => ({ ROAM_ON: true, roamOpenFor: () => true, roamOn: () => true, setRoamOpen: () => {} }));

const NOW = 1_900_000_000_000;
/** Вольные города Сицилии и окрестностей — общие точки мира (без сида). */
const TOWNS = pointsIn(0, 600, 1200, 900, 1500).filter((p) => p.kind === 'town' && p.tier > 0);

function party(): GameState {
  const s = createInitialState(7);
  expect(beginRoam(s, { origin: 'warrior', hero: { name: 'Ратко', war: 2 }, band: { spearman: 4, clubman: 6 }, purse: 3000, food: 200 })).toBeNull();
  s.roam!.way = standWay('normal', { x: 1, y: 1 }, NOW - 60_000);
  return s;
}

// Окно вольного замка — с ПН-Э2б своей дверью `world/freeodds` (шанс репетицией сервером войны): тесты — `freeodds.test.ts`.

describe('специализация вольного города (ГДД 3.7.1)', () => {
  it('постоянной солью клетки: у одного города одна специализация, у городов мира — все пять', () => {
    expect(TOWNS.length).toBeGreaterThan(20);
    for (const t of TOWNS) expect(townSpecOf(t.x, t.y)).toBe(townSpecOf(t.x, t.y));
    expect(new Set(TOWNS.map((t) => townSpecOf(t.x, t.y)))).toEqual(new Set(TOWN_SPECS));
  });

  it('у каждого товара рынка есть и делающий город, и нуждающийся; один товар не делают и не просят одновременно', () => {
    const traded = GOODS.map((g) => g.id).filter((id) => Object.values(TOWN_SPEC_META).some((m) => (m.makes as readonly string[]).includes(id) || (m.wants as readonly string[]).includes(id)));
    expect(traded.length).toBeGreaterThan(0);
    for (const id of traded) {
      expect(TOWN_SPECS.some((s) => specMult(s, id, 0.25) < 1), `${id}: кто делает`).toBe(true);
      expect(TOWN_SPECS.some((s) => specMult(s, id, 0.25) > 1), `${id}: кому нужно`).toBe(true);
    }
    for (const s of TOWN_SPECS) for (const id of TOWN_SPEC_META[s].makes) expect(TOWN_SPEC_META[s].wants as readonly string[]).not.toContain(id);
  });

  it('перепродажа внутри города не в плюс при любом размахе до 0.9: штука, купленная и проданная обратно, отдаёт разницу', () => {
    const w = shiftOf(NOW);
    for (const swing of [0, 0.25, 0.5, 0.9]) {
      for (const s of TOWN_SPECS) {
        for (const g of GOODS) {
          const def = specGood(g, specMult(s, g.id, swing));
          const d = depthOf(g, 3);
          // Граница: купить по нажиму q и продать с нажимом q + 1 (после покупки) — продажа не дороже покупки.
          for (const q of [0, 5, 40]) expect(sellUnit(def, w, d, q + 1, 1), `${s}/${g.id}/${swing}`).toBeLessThanOrEqual(buyUnit(def, w, d, q));
        }
      }
    }
    expect(SALE_SHARE).toBeLessThan(1);
  });

  it('рынок с ключом вольного города берёт основу по специализации; у лорда — прежняя основа (`specGood(def, 1)` — тот же товар)', () => {
    const s = party();
    const by = new Map<TownSpec, RoamPoint>();
    for (const t of TOWNS) if (!by.has(townSpecOf(t.x, t.y))) by.set(townSpecOf(t.x, t.y), t);
    const food = GOOD_BY_ID.food;
    expect(specGood(food, 1)).toBe(food);
    const swing = roamStub('townSpec');
    const granary = by.get('granary') as RoamPoint;
    const timber = by.get('timber') as RoamPoint;
    const priceAt = (t: RoamPoint): number => marketPrice(s, food, NOW, townKeyOf(t.x, t.y));
    // Граница: хлеб — то, что житница делает (×(1 − размах)), а лесу нужен (×(1 + размах)): цены расходятся по специализации.
    expect(specMult('granary', 'food', swing)).toBeLessThan(1);
    expect(specMult('timber', 'food', swing)).toBeGreaterThan(1);
    expect(priceAt(granary)).toBeLessThan(priceAt(timber));
    expect(marketSellPrice(s, food, NOW, townKeyOf(granary.x, granary.y))).toBeLessThan(marketSellPrice(s, food, NOW, townKeyOf(timber.x, timber.y)));
    // Партия — той же основой, что штука.
    expect(marketLot(s, food, 1, NOW, townKeyOf(granary.x, granary.y)).first).toBe(priceAt(granary));
  });
});
