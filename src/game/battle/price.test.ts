// Вес вида в бою — из цены (слово владельца по 14.35, путь П2; docs/battle_eu4.md, 14.35). Вещи идут в бой только через
// цену вида: своих показателей и морали у них нет. Здесь держится, что вес — ровно цена, что каждая вещь кузницы делает
// вид тяжелее (покупка вещи не пустая) и что при равной цене виды одного рода выходят в бой одной армией.
import { describe, expect, it } from 'vitest';
import { stackTotal } from '@/battle';
import type { EquipmentId, TroopId } from '../types';
import { TROOPS, TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import { EQUIPMENT } from '../data/equipment';
import { GOOD_BY_ID } from '../data/market';
import { SOLDIER_FOOD } from '../constants';
import { createInitialState } from '../state';
import { baseWage, mouthsOf, selfCost, wageOf, wageShare } from '../derived';
import { KIND_OF } from './kinds';
import { BASE_TROOP, battleWeight, kindsOf, upkeepOf } from './price';

describe('вес вида в бою — из цены', () => {
  it('вес — содержание вида к содержанию дубинщика; содержание — жалованье без доли веры и паёк по цене своего труда', () => {
    const s = createInitialState(7);
    expect(wageShare(s), 'граница области: вера новой партии жалованья не режет').toBe(1);
    const food = selfCost(GOOD_BY_ID.food);
    for (const id of TROOP_IDS) {
      expect(baseWage(id), id).toBe(wageOf(s, id));
      expect(upkeepOf(id), id).toBeCloseTo(baseWage(id) + SOLDIER_FOOD * mouthsOf({ [id]: 1 }) * food, 12);
      expect(battleWeight(id), id).toBeCloseTo(upkeepOf(id) / upkeepOf(BASE_TROOP), 12);
    }
    expect(battleWeight(BASE_TROOP)).toBe(1);
  });

  it('каждая вещь кузницы делает вид тяжелее в бою: вид с вещью весит больше того же вида без неё', () => {
    // Пары видов, различающихся ровно одной вещью при том же коне, выводятся из данных, а не пишутся рукой.
    const gearKey = (id: TroopId): string => JSON.stringify(Object.entries(TROOP_BY_ID[id].gear).filter(([, n]) => n).sort());
    const withOne = (a: TroopId, item: EquipmentId): string =>
      JSON.stringify([...Object.entries(TROOP_BY_ID[a].gear).filter(([, n]) => n), [item, 1]].sort());
    const pairs: Array<{ from: TroopId; to: TroopId; item: EquipmentId }> = [];
    for (const a of TROOP_IDS) {
      for (const item of EQUIPMENT.map((e) => e.id)) {
        if (TROOP_BY_ID[a].gear[item]) continue;
        const b = TROOP_IDS.find((x) => TROOP_BY_ID[x].mounted === TROOP_BY_ID[a].mounted && gearKey(x) === withOne(a, item));
        if (b) pairs.push({ from: a, to: b, item });
      }
    }
    // Граница области: каждая вещь кузницы стоит хоть в одной паре — иначе её покупку тест не спрашивал бы.
    for (const e of EQUIPMENT) expect(pairs.some((p) => p.item === e.id), `вещь ${e.id} ни в одной паре`).toBe(true);
    for (const p of pairs) {
      expect(battleWeight(p.to), `${p.item}: ${p.from} → ${p.to} — покупка вещи пустая`).toBeGreaterThan(battleWeight(p.from));
    }
  });

  it('при равной цене виды одного рода выходят одной армией: бойцы строя равны с точностью до округления', () => {
    // Бюджет — содержание в день, как у армии W дубинщиков; головы — бюджет на содержание головы.
    const budget = 608 * upkeepOf(BASE_TROOP);
    for (const a of TROOPS) {
      for (const b of TROOPS) {
        if (KIND_OF[a.id] !== KIND_OF[b.id]) continue;
        const ka = kindsOf({ [a.id]: Math.round(budget / upkeepOf(a.id)) });
        const kb = kindsOf({ [b.id]: Math.round(budget / upkeepOf(b.id)) });
        // Головы целые: округление головы стоит до веса вида бойцов строя.
        const slack = Math.max(battleWeight(a.id), battleWeight(b.id));
        expect(Math.abs(stackTotal(ka) - stackTotal(kb)), `${a.id} и ${b.id}`).toBeLessThanOrEqual(slack);
      }
    }
  });
});
