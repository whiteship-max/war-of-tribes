// Дух войска в бою (ДР-1, docs/siege_v2.md, «Решения ДР-1», Д4): мораль множит стартовую мораль групп, дисциплина — урон
// стороны (`battle/config.SPIRIT`, `sim.spiritMorale`, `sim.spiritDealt`). Тесты меряют бой той же дверью, что мир и сервер
// (`world/battle.resolveField`), на наборе сидов (правило 17), а не на одном бое.
//
// Области (правило 11): сила меряется против той же армии без духа — дух на нейтрали даёт ровно прежний бой; края шкалы — внутри
// 0…100; монотонность — на сидах, где бой не кончается разгромом с первой фазы (доля побед между краями — не 0 и не 1).
import { describe, expect, it } from 'vitest';
import { SPIRIT, spiritMult, startMorale, spiritDealt, deploySetup, FRONT_WIDTH, type Spirit } from '@/battle';
import { resolveField } from './battle';
import { kindsOf } from '@/game/battle/price';
import { SPIRIT_MIX, strengthOf, winShare } from '../../scripts/console/spirit';

const MIX = kindsOf(SPIRIT_MIX);
const SEEDS = 60;

describe('без духа и на нейтрали — бой прежний, байт в байт', () => {
  it('поле `spirit` нет — тот же бой; нейтраль (70, 70) — тоже', () => {
    for (let i = 1; i <= 12; i++) {
      const seed = i * 7919;
      const plain = resolveField({ seed, attacker: { kinds: MIX }, defender: { kinds: MIX } });
      const even = resolveField({ seed, attacker: { kinds: MIX, spirit: { morale: SPIRIT.even, discipline: SPIRIT.even } }, defender: { kinds: MIX } });
      expect(even.result?.winner, `сид ${seed}`).toBe(plain.result?.winner);
      expect(even.result?.ticks).toBe(plain.result?.ticks);
      expect(even.result?.sides.attacker.total.losses).toBe(plain.result?.sides.attacker.total.losses);
      expect(even.result?.sides.defender.total.losses).toBe(plain.result?.sides.defender.total.losses);
    }
  });
});

describe('множители: ломаная «дно — нейтраль — верх», не убывает', () => {
  it('края и нейтраль — записанные точки; между ними — не убывает по каждой шкале', () => {
    for (const axis of [SPIRIT.morale, SPIRIT.discipline]) {
      expect(spiritMult(0, axis)).toBe(axis.low);
      expect(spiritMult(SPIRIT.even, axis)).toBe(1);
      expect(spiritMult(SPIRIT.top, axis)).toBe(axis.high);
      expect(axis.low, 'дно ниже единицы').toBeLessThan(1);
      expect(axis.high, 'верх выше единицы').toBeGreaterThan(1);
      let last = -Infinity;
      for (let v = 0; v <= SPIRIT.top; v += 2.5) {
        const k = spiritMult(v, axis);
        expect(k, `${v}`).toBeGreaterThanOrEqual(last);
        last = k;
      }
      expect(spiritMult(Number.NaN, axis), 'не число — нейтраль').toBe(1);
      expect(spiritMult(-50, axis)).toBe(axis.low);
      expect(spiritMult(500, axis)).toBe(axis.high);
    }
  });

  it('мораль — стартовая мораль групп, дисциплина — урон стороны', () => {
    const setup = deploySetup(MIX, FRONT_WIDTH);
    const at = (spirit: Spirit) => ({ ...setup, spirit });
    const m0 = startMorale(setup, MIX);
    expect(startMorale(at({ morale: 0, discipline: SPIRIT.even }), MIX)).toBeCloseTo(m0 * SPIRIT.morale.low, 9);
    expect(startMorale(at({ morale: SPIRIT.even, discipline: 0 }), MIX), 'дисциплина в мораль не идёт').toBeCloseTo(m0, 9);
    expect(spiritDealt(at({ morale: 0, discipline: 0 }))).toBe(SPIRIT.discipline.low);
    expect(spiritDealt(at({ morale: SPIRIT.top, discipline: SPIRIT.even })), 'мораль в урон не идёт').toBe(1);
  });
});

describe('копейщик с высокой моралью сильнее того же копейщика со слабой — на наборе сидов', () => {
  it('доля побед против той же армии без духа растёт по каждой шкале и вместе', () => {
    const grid = [0, 35, SPIRIT.even, SPIRIT.top];
    const both = grid.map((v) => winShare(SPIRIT_MIX, { morale: v, discipline: v }, 1, SEEDS));
    // Область: края различимы — внизу побед меньше половины, вверху больше.
    expect(both[0]).toBeLessThan(0.35);
    expect(both[3]).toBeGreaterThan(0.6);
    for (let i = 1; i < grid.length; i++) expect(both[i], `обе ${grid[i]} против ${grid[i - 1]}`).toBeGreaterThanOrEqual(both[i - 1]);
    const morale = grid.map((v) => winShare(SPIRIT_MIX, { morale: v, discipline: SPIRIT.even }, 1, SEEDS));
    const drill = grid.map((v) => winShare(SPIRIT_MIX, { morale: SPIRIT.even, discipline: v }, 1, SEEDS));
    for (let i = 1; i < grid.length; i++) {
      expect(morale[i], `мораль ${grid[i]}`).toBeGreaterThanOrEqual(morale[i - 1]);
      expect(drill[i], `дисциплина ${grid[i]}`).toBeGreaterThanOrEqual(drill[i - 1]);
    }
  });

  it('ориентир владельца: обе на дне — около −25 % силы, обе на верху — около +10 %', () => {
    // Сила — во сколько раз армия с духом стоит ровной без него (`scripts/console/spirit.strengthOf`); границы — с запасом на
    // малый набор сидов: вывод на двухстах — docs/siege_v2.md, «Решения ДР-1», Д4.
    const low = strengthOf(SPIRIT_MIX, { morale: 0, discipline: 0 }, 40);
    const high = strengthOf(SPIRIT_MIX, { morale: SPIRIT.top, discipline: SPIRIT.top }, 40);
    expect(low).toBeGreaterThan(0.68);
    expect(low).toBeLessThan(0.84);
    expect(high).toBeGreaterThan(1.04);
    expect(high).toBeLessThan(1.17);
  });
});
