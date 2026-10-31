// Торговля между городами (ПН-Э1, docs/gdd/path_of_sword.md, 3.7.1 и 4.8) — модель рейса прибора на дверях игры.
//
// Рейс: отряд покупает товар в вольном городе A, везёт в город B, продаёт и везёт обратно лучший товар B → A. Всё, что решает выгоду,
// — двери игры: специализация города (`world/townspec.specMult` — размах приходит параметром, его и выводит раздел), основа товара с
// ней (`marketrules.specGood`), цена штуки по нажиму (`buyUnit`, `sellUnit` — продажа на шаг ниже, `SALE_SHARE`), запас и набор привоза
// (`supplyOf`, `shiftOffer`), кошель купцов (`purseOf`), уровень рынка по ступени города (`townrules.townMarketLevel`), обоз
// (`cargocap.cargoCap`), дорога (`world/roam.roamWalkMs`). Своих чисел у модели нет; засады в пути и ожидание привоза модель не
// считает — рейс лучший из возможных (верхняя граница дохода торговца).
import type { GoodId } from '../../src/game/types';
import type { TroopStack } from '../../src/game/battle/kinds';
import { GOOD_BY_ID } from '../../src/game/data/market';
import { SHIFT, buyUnit, depthOf, purseOf, sellUnit, shiftOf, shiftOffer, specGood, supplyOf } from '../../src/game/marketrules';
import { townMarketLevel } from '../../src/game/townrules';
import { cargoCap } from '../../src/game/cargocap';
import { standWay } from '../../src/world/roammove';
import { roamWalkMs } from '../../src/world/roam';
import { pointsIn, type RoamPoint } from '../../src/world/roampoints';
import { specMult, townSpecOf } from '../../src/world/townspec';

/** Что ограничило ногу рейса: обоз, запас привоза, кошель купцов у покупателя, нажим (следующая штука уже в минус). */
export type TradeCap = 'cargo' | 'supply' | 'purse' | 'press';

export interface TradeLeg {
  good: GoodId;
  n: number;
  cost: number;
  gain: number;
  cap: TradeCap;
}

/** Лучшая нога рейса: товар, который `from` в привоз `w` везёт в `to` с приходом в привоз `w2`, — до первой штуки в минус. */
export function bestLeg(from: RoamPoint, to: RoamPoint, band: TroopStack, swing: number, w: number, w2: number): TradeLeg | null {
  const lvA = townMarketLevel(from.tier as 1 | 2 | 3);
  const lvB = townMarketLevel(to.tier as 1 | 2 | 3);
  const specA = townSpecOf(from.x, from.y);
  const specB = townSpecOf(to.x, to.y);
  const cap = Math.floor(cargoCap({ band, way: standWay('normal') }));
  const purse = purseOf(lvB);
  let best: TradeLeg | null = null;
  for (const id of shiftOffer(w, lvA)) {
    const base = GOOD_BY_ID[id];
    if (!base || id === 'bonded') continue;
    const a = specGood(base, specMult(specA, id, swing));
    const b = specGood(base, specMult(specB, id, swing));
    const dA = depthOf(base, lvA);
    const dB = depthOf(base, lvB);
    const supply = supplyOf(base, lvA, w, 0);
    let n = 0;
    let cost = 0;
    let gain = 0;
    let why: TradeCap = 'cargo';
    for (;;) {
      if (n >= cap) break;
      if (n >= supply) {
        why = 'supply';
        break;
      }
      const buy = buyUnit(a, w, dA, n);
      const sell = sellUnit(b, w2, dB, -n, 1);
      if (sell <= buy) {
        why = 'press';
        break;
      }
      if (gain + sell > purse) {
        why = 'purse';
        break;
      }
      n++;
      cost += buy;
      gain += sell;
    }
    if (n > 0 && (!best || gain - cost > best.gain - best.cost)) best = { good: id, n, cost, gain, cap: why };
  }
  return best;
}

export interface TradeLoop {
  to: RoamPoint;
  hours: number;
  profit: number;
  legs: [TradeLeg | null, TradeLeg | null];
}

/**
 * Лучший рейс из `home` к городам не дальше `reach` клеток с выхода в настоящую минуту `at`: туда и обратно, привоз прихода — по
 * дороге. Прибыль — выручка минус покупка обеих ног (содержание отряда в дороге вычитает раздел). Нет выгодного — `null`.
 */
export function bestLoop(home: RoamPoint, band: TroopStack, swing: number, at: number, reach: number): TradeLoop | null {
  const towns = pointsIn(0, home.x - reach, home.y - reach, home.x + reach + 1, home.y + reach + 1).filter((p) => p.kind === 'town' && p.id !== home.id && p.tier > 0);
  let best: TradeLoop | null = null;
  for (const to of towns) {
    const ms = roamWalkMs(home, to, 'normal');
    const w = shiftOf(at);
    const w2 = shiftOf(at + ms);
    const w3 = shiftOf(at + 2 * ms);
    const there = bestLeg(home, to, band, swing, w, w2);
    const back = bestLeg(to, home, band, swing, w2, w3);
    const profit = (there ? there.gain - there.cost : 0) + (back ? back.gain - back.cost : 0);
    const hours = (2 * ms) / 3_600_000;
    if (profit > 0 && hours > 0 && (!best || profit / hours > best.profit / best.hours)) best = { to, hours, profit, legs: [there, back] };
  }
  return best;
}

/** Привозов в настоящих сутках — рейсы мерятся по всем восьми (набор и цена привоза у каждого свои). */
export const SHIFTS_PER_DAY = Math.round((24 * 3_600_000) / SHIFT);
