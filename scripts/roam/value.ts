// Ценность города для паритета (ГДД 4.5): одна мерка на город с Пути меча и на НФТ-старт, прожившие одни сутки.
//
//   ценность = Σ уровни (припас улучшения по цене своего труда + работа × цена работы) + склад по цене своего труда
//            + казна + мощь войска × цена мощи + очки правителя × цена очка
//
// Двери кода: цена и работа улучшения (`labour.upgradeCost`, `upgradeWork` — одна формула с сервером), цена своего труда
// (`selfcost.selfCost`), мощь (`price.troopPower`), очки (`sim/points.pointsOf`). Цены работы, мощи и очка в коде нет — их
// даёт вход `valuePrices` (заглушка ПН-11); агенты не считаются: у пути Среза 1 их нет (Р11), автопилот посёлка их не нанимает.
import type { GameState, ResourceId, TroopId } from '../../src/game/types';
import { BUILDING_BY_ID } from '../../src/game/data/buildings';
import { GOOD_BY_ID } from '../../src/game/data/market';
import { REALM_BRANCHES } from '../../src/game/data/realm';
import { RESOURCE_IDS } from '../../src/game/constants';
import { upgradeCost, upgradeWork } from '../../src/game/labour';
import { selfCost } from '../../src/game/selfcost';
import { troopPower } from '../../src/game/battle/price';
import { pointsOf } from '../../src/game/sim/points';

export interface ValuePrices {
  /** Золото за единицу работы строителей. */
  work: number;
  /** Золото за единицу мощи войска. */
  power: number;
  /** Золото за очко правителя. */
  point: number;
}

export interface Value {
  buildings: number;
  stock: number;
  gold: number;
  army: number;
  points: number;
  total: number;
}

const gold = (r: ResourceId, n: number): number => n * selfCost(GOOD_BY_ID[r]);

export function cityValue(s: GameState, p: ValuePrices): Value {
  let buildings = 0;
  for (const b of s.buildings) {
    const def = BUILDING_BY_ID[b.type];
    for (let l = 2; l <= b.level; l++) {
      for (const [r, n] of Object.entries(upgradeCost(def, l)) as [ResourceId, number][]) buildings += gold(r, n);
      buildings += upgradeWork(def, l) * p.work;
    }
  }
  const stock = RESOURCE_IDS.reduce((n, r) => n + gold(r, Math.max(0, s.resources[r] ?? 0)), 0);
  const army = troopPower(s.army as Partial<Record<TroopId, number>>) * p.power;
  const points = REALM_BRANCHES.reduce((n, b) => n + pointsOf(s, b), 0) * p.point;
  const g = Math.max(0, s.gold);
  return {
    buildings,
    stock,
    gold: g,
    army,
    points,
    total: buildings + stock + g + army + points,
  };
}
