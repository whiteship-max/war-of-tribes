import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BuildingTypeId, TroopId } from '@/game/types';
import { createInitialState } from '@/game/state';
import { BUILDINGS } from '@/game/data/buildings';
import { RESOURCE_IDS } from '@/game/constants';
import { upgradeWork } from '@/game/labour';
import { TROOPS, TROOP_BY_ID, type TroopDef } from '@/game/data/troops';
import { KIND_OF } from '@/game/battle/kinds';
import { UNIT_STATS, type UnitKind } from '@/battle';
import { POWER_SCALE, buildingWeight, buildingsPower, power, troopWeight, troopsPower } from './power';

/**
 * Заводит фиктивный вид бойцов ровно там же, где заводят настоящий: в списке
 * видов, в указателе по id (он выводится из списка сам) и в таблице родов боя.
 * В `power.ts` при этом не правится ни строки — в этом и смысл проверки.
 */
function withTroop(def: TroopDef, kind: UnitKind, fn: () => void): void {
  TROOPS.push(def);
  TROOP_BY_ID[def.id] = def;
  KIND_OF[def.id] = kind;
  try {
    fn();
  } finally {
    TROOPS.splice(TROOPS.indexOf(def), 1);
    delete (TROOP_BY_ID as Record<string, TroopDef>)[def.id];
    delete (KIND_OF as Record<string, UnitKind>)[def.id];
  }
}

/** Исходник модуля без комментариев: договор нарушает код, а не рассказ о нём. */
const powerSource = (): string =>
  readFileSync(join(__dirname, 'power.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('мощь', () => {
  it('улучшение здания увеличивает мощь', () => {
    const s = createInitialState();
    const before = power(s);
    const houses = s.buildings.find((b) => b.type === 'houses')!;
    houses.level += 1;
    expect(power(s)).toBeGreaterThan(before);
  });

  it('уровень входит нелинейно: одно здание десятого уровня весит больше десяти первых', () => {
    const s = createInitialState();
    const houses = s.buildings.find((b) => b.type === 'houses')!;
    const all = buildingsPower(s);
    houses.level = 0;
    const without = buildingsPower(s);
    const first = all - without;
    houses.level = 10;
    const tenth = buildingsPower(s) - without;
    expect(first).toBeGreaterThan(0);
    expect(tenth).toBeGreaterThan(first * 10);
  });

  it('потеря армии уменьшает мощь, и ровно на вес потерянных', () => {
    const s = createInitialState();
    s.army.spearman = 20;
    s.army.legionary = 5;
    const before = power(s);
    const troopsBefore = troopsPower(s);
    expect(before).toBeGreaterThan(Math.round(buildingsPower(s)));

    s.army.legionary = 2;
    expect(power(s)).toBeLessThan(before);
    expect(troopsBefore - troopsPower(s)).toBeCloseTo(3 * troopWeight('legionary') * POWER_SCALE, 6);

    // Дружина выбита целиком — остаётся ровно мощь посёлка.
    s.army.spearman = 0;
    s.army.legionary = 0;
    expect(troopsPower(s)).toBe(0);
    expect(power(s)).toBe(Math.round(buildingsPower(s)));
  });

  /**
   * Договор, ради которого модуль вообще отдельный: своей таблицы весов в нём
   * нет. Новый вид войск заводится в конфиге — и попадает в мощь сам.
   */
  it('новый вид войск в конфиге считается сам, без правки power.ts', () => {
    const s = createInitialState();
    const before = power(s);
    const fake: TroopDef = {
      id: 'test_lancer' as TroopId,
      name: 'Пробные конные',
      one: 'пробный',
      flavor: 'Пробный вид, его нет в игре.',
      description: 'Такого вида в игре нет — он заведён тестом, чтобы мощь его посчитала.',
      gear: { spear: 1, shield: 1, armor: 1 },
      cost: { food: 30 },
      work: 80,
      grade: 10,
    };

    withTroop(fake, 'cavalry', () => {
      // Пока таких бойцов нет, ничего не изменилось: считается состав, а не список видов.
      expect(power(s)).toBe(before);
      s.army[fake.id] = 4;
      expect(power(s)).toBeGreaterThan(before);
      expect(troopsPower(s)).toBeCloseTo(4 * troopWeight(fake.id) * POWER_SCALE, 6);
      // И вес его не выдуман: он тяжелее латника, потому что тяжелее в конфиге.
      expect(troopWeight(fake.id)).toBeGreaterThan(troopWeight('legionary'));
      delete (s.army as Record<string, number>)[fake.id];
    });

    expect(power(s)).toBe(before);
  });

  it('правка боевого конфига меняет мощь без правки профиля', () => {
    const s = createInitialState();
    s.army.legionary = 10;
    const before = power(s);
    const stats = UNIT_STATS.infantry;
    const melee = stats.melee;
    try {
      stats.melee = melee * 2;
      expect(power(s)).toBeGreaterThan(before);
    } finally {
      stats.melee = melee;
    }
    expect(power(s)).toBe(before);
  });

  it('труд в мере здания — дверью времени стройки: у двора — более долгое дело, а не сумма частей (ПБ-1, П5)', () => {
    // Область — дворы с двумя делами (ЗД-1): только у них сумма частей и более долгое дело расходятся.
    const yards = BUILDINGS.filter((d) => (d.parts?.length ?? 0) > 1);
    expect(yards.length, 'дворов с двумя делами нет — правилу негде действовать').toBeGreaterThan(0);
    const plain = BUILDINGS.find((d) => !d.parts && d.work > 0) as (typeof BUILDINGS)[number];
    const cost = (d: (typeof BUILDINGS)[number]): number => upgradeWork(d, 1) + RESOURCE_IDS.reduce((n, r) => n + (d.cost[r] ?? 0), 0);
    for (const y of yards) {
      expect(upgradeWork(y, 1), `${y.id}: более долгое дело короче суммы`).toBeLessThan(y.work);
      expect(buildingWeight(y) / buildingWeight(plain), `${y.id}: вес двора — трудом стройки`).toBeCloseTo(cost(y) / cost(plain), 12);
    }
  });

  it('в power.ts нет ни одного имени здания и ни одного имени вида бойцов', () => {
    const src = powerSource();
    const named: (TroopId | BuildingTypeId)[] = [];
    for (const def of TROOPS) if (src.includes(`'${def.id}'`)) named.push(def.id);
    for (const def of BUILDINGS) if (src.includes(`'${def.id}'`)) named.push(def.id);
    expect(named).toEqual([]);
  });

  it('алмазы, золото и покупки в мощь не входят никак', () => {
    // Проверяется по исходнику: заплатить за мощь нельзя, потому что мощь про
    // них не знает. За алмаз в этой игре покупается только время.
    // Регистр нарочно не важен: так под запрет попадает и единственная дверь
    // начисления, называть которую здесь по имени незачем — её стережёт свой
    // замок в sim/gems.test.ts, и литерал в этом файле он счёл бы нарушением.
    const src = powerSource();
    expect(src).not.toMatch(/gems/i);
    expect(src).not.toMatch(/gold/i);
    expect(src).not.toMatch(/rushUpgrade/);
  });
});
