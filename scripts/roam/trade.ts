// Торговля между городами (ПН-Э1, ПН-Э2в; docs/gdd/path_of_sword.md, 3.7.1, 4.8, 23.10) — модель рейса прибора на дверях игры.
//
// Рейс: отряд покупает товары в вольном городе A, везёт в город B, продаёт и везёт обратно лучшие товары B → A. Всё, что решает выгоду,
// — двери игры: специализация города (`world/townspec.specMult` — размах приходит правилом модели, его и выводит раздел), основа товара с
// ней (`marketrules.specGood`), цена штуки по нажиму (`buyUnit`, `sellUnit` — продажа на шаг ниже, доля продажи), запас и набор привоза
// (`supplyOf`, `shiftOffer`), уровень рынка по ступени города (`townrules.townMarketLevel`), караванный кошель покупателя
// (`marketrules.caravanUnit` — та же единица, что у `world/townspec.townCaravan`), обоз (`cargocap.cargoCap`), дорога
// (`world/roam.roamWalkMs`). Своих чисел у модели нет; засады в пути и ожидание привоза модель не считает — рейс лучший из возможных
// (верхняя граница дохода торговца).
//
// Нога берёт **несколько товаров**: по штуке — товар с самой выгодной следующей штукой, пока выгода есть, пока везёт обоз и пока
// платит кошель (ПН-Э2в; у ПН-Э1 нога брала один товар). Кошель в рейсе — **круг**: торговец ходит туда и обратно тем же рейсом и
// опустошает кошель покупателя каждым приходом, поэтому к приходу кошель наполнился на долю `часы рейса / срок пополнения` (не выше
// полного): так модель держит «без бесконечного круга» — город платит не больше кошеля за срок пополнения.
//
// Правило модели (`TradeRules`) у игры одно — `gameRules`; другие — только варианты владельцу (ГДД 23.10): другая доля продажи у вольного
// города и другие уровни его рынка. Правила лорда не меняются ни в одном варианте.
import type { GoodId } from '../../src/game/types';
import type { TroopStack } from '../../src/game/battle/kinds';
import { GOOD_BY_ID } from '../../src/game/data/market';
import { SALE_SHARE, SHIFT, buyUnit, caravanUnit, depthOf, sellUnit, shiftOf, shiftOffer, specGood, supplyOf } from '../../src/game/marketrules';
import { townMarketLevel } from '../../src/game/townrules';
import { cargoCap } from '../../src/game/cargocap';
import { standWay } from '../../src/world/roammove';
import { roamWalkMs } from '../../src/world/roam';
import { pointsIn, type RoamPoint } from '../../src/world/roampoints';
import { TOWN_SPEC_META, specMult, townSpecOf } from '../../src/world/townspec';

/** Что ограничило ногу рейса: обоз, запас привоза (товар ещё выгоден, а привоз кончился), нажим (следующая штука в минус), кошель. */
export type TradeCap = 'cargo' | 'supply' | 'press' | 'purse';

/** Правило модели рейса: размах специализации, доля продажи и уровни рынка вольного города, караванный кошель (`null` — без кошеля). */
export interface TradeRules {
  swing: number;
  share: number;
  /** Уровень рынка вольного города по ступени I–III; `null` — уровни игры (`townrules.townMarketLevel`). */
  levels: readonly number[] | null;
  caravan: { size: number; refillH: number } | null;
}

/** Правило игры: доля продажи — `SALE_SHARE`, уровни — игры, кошель — заглушки игры (`caravanSize`, `caravanRefill`). */
export const gameRules = (swing: number, size: number, refillH: number): TradeRules => ({ swing, share: SALE_SHARE, levels: null, caravan: { size, refillH } });

export const levelOf = (rules: TradeRules, tier: number): number => (rules.levels ? rules.levels[tier - 1] : townMarketLevel(tier as 1 | 2 | 3));

/** Единица караванного кошеля города по правилу модели — та же формула, что у игры (`marketrules.caravanUnit`). */
export const unitOf = (t: RoamPoint, rules: TradeRules): number => caravanUnit(levelOf(rules, t.tier), TOWN_SPEC_META[townSpecOf(t.x, t.y)].wants, rules.swing);

export interface TradeLeg {
  /** Штук по товарам. */
  goods: Partial<Record<GoodId, number>>;
  n: number;
  cost: number;
  gain: number;
  cap: TradeCap;
}

/**
 * Лучшая нога рейса: что `from` в привоз `w` продаёт и что `to` в привоз `w2` берёт с выгодой — по штуке, самой выгодной следующей, пока
 * следующая штука в плюс, обоз везёт и кошель `purse` платит. Нет выгодной штуки — `null`.
 */
export function bestLeg(from: RoamPoint, to: RoamPoint, band: TroopStack, rules: TradeRules, w: number, w2: number, purse: number): TradeLeg | null {
  const lvA = levelOf(rules, from.tier);
  const lvB = levelOf(rules, to.tier);
  const specA = townSpecOf(from.x, from.y);
  const specB = townSpecOf(to.x, to.y);
  const cap = Math.floor(cargoCap({ band, way: standWay('normal') }));
  const rows = shiftOffer(w, lvA)
    .filter((id) => id !== 'bonded' && GOOD_BY_ID[id])
    .map((id) => {
      const base = GOOD_BY_ID[id];
      return {
        id,
        a: specGood(base, specMult(specA, id, rules.swing)),
        b: specGood(base, specMult(specB, id, rules.swing)),
        dA: depthOf(base, lvA),
        dB: depthOf(base, lvB),
        supply: supplyOf(base, lvA, w, 0),
        n: 0,
      };
    });
  const leg: TradeLeg = { goods: {}, n: 0, cost: 0, gain: 0, cap: 'press' };
  for (;;) {
    let best: { row: (typeof rows)[number]; buy: number; sell: number } | null = null;
    let short = false;
    for (const row of rows) {
      const buy = buyUnit(row.a, w, row.dA, row.n);
      const sell = sellUnit(row.b, w2, row.dB, -row.n, 1, rules.share);
      if (sell <= buy) continue;
      if (row.n >= row.supply) {
        short = true;
        continue;
      }
      if (!best || sell - buy > best.sell - best.buy) best = { row, buy, sell };
    }
    if (!best) {
      leg.cap = short ? 'supply' : 'press';
      break;
    }
    if (leg.n >= cap) {
      leg.cap = 'cargo';
      break;
    }
    if (leg.gain + best.sell > purse) {
      leg.cap = 'purse';
      break;
    }
    best.row.n++;
    leg.n++;
    leg.cost += best.buy;
    leg.gain += best.sell;
    leg.goods[best.row.id] = best.row.n;
  }
  return leg.n > 0 ? leg : null;
}

export interface TradeLoop {
  to: RoamPoint;
  hours: number;
  profit: number;
  legs: [TradeLeg | null, TradeLeg | null];
}

/**
 * Кошель покупателя к приходу на круге: опустошён прошлым приходом и наполнился за часы рейса долей срока пополнения, не выше полного.
 * Без кошеля — бесконечность.
 */
export function purseOnLoop(t: RoamPoint, rules: TradeRules, hours: number): number {
  if (!rules.caravan) return Infinity;
  const cap = Math.floor(unitOf(t, rules) * rules.caravan.size);
  return rules.caravan.refillH > 0 ? Math.min(cap, (cap * hours) / rules.caravan.refillH) : cap;
}

/**
 * Лучший рейс из `home` к городам не дальше `reach` клеток с выхода в настоящую минуту `at`: туда и обратно, привоз прихода — по
 * дороге. Прибыль — выручка минус покупка обеих ног (содержание отряда в дороге вычитает раздел). Нет выгодного — `null`.
 */
export function bestLoop(home: RoamPoint, band: TroopStack, rules: TradeRules, at: number, reach: number): TradeLoop | null {
  const towns = pointsIn(0, home.x - reach, home.y - reach, home.x + reach + 1, home.y + reach + 1).filter((p) => p.kind === 'town' && p.id !== home.id && p.tier > 0);
  let best: TradeLoop | null = null;
  for (const to of towns) {
    const ms = roamWalkMs(home, to, 'normal');
    const hours = (2 * ms) / 3_600_000;
    if (!(hours > 0)) continue;
    const w = shiftOf(at);
    const w2 = shiftOf(at + ms);
    const w3 = shiftOf(at + 2 * ms);
    const there = bestLeg(home, to, band, rules, w, w2, purseOnLoop(to, rules, hours));
    const back = bestLeg(to, home, band, rules, w2, w3, purseOnLoop(home, rules, hours));
    const profit = (there ? there.gain - there.cost : 0) + (back ? back.gain - back.cost : 0);
    if (profit > 0 && (!best || profit / hours > best.profit / best.hours)) best = { to, hours, profit, legs: [there, back] };
  }
  return best;
}

/** Привозов в настоящих сутках — рейсы мерятся по всем восьми (набор и цена привоза у каждого свои). */
export const SHIFTS_PER_DAY = Math.round((24 * 3_600_000) / SHIFT);
