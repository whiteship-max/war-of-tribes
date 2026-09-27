import { describe, expect, it } from 'vitest';
import { FRONT, FRONT_WIDTH, SECTORS, deploySetup, emptyStack, simulateBattle, stackOf, stackTotal, type BattleResult, type Sector, type Stack } from '@/battle';
import { frontOf, median, widthOf } from './front';

/** Запись боя ровно с теми полями, что читает прибор: начальный состав стороны и её секторов. */
const side = (by: Partial<Record<Sector, Partial<Stack>>>) => {
  const sectors = Object.fromEntries(SECTORS.map((s) => [s, { initial: stackOf(by[s] ?? {}) }]));
  const initial = SECTORS.reduce((acc, s) => {
    const x = stackOf(by[s] ?? {});
    for (const k of Object.keys(x) as (keyof Stack)[]) acc[k] += x[k];
    return acc;
  }, emptyStack());
  return { initial, sectors };
};
const fight = (attacker: Partial<Record<Sector, Partial<Stack>>>, defender: Partial<Record<Sector, Partial<Stack>>>): BattleResult =>
  ({ sides: { attacker: side(attacker), defender: side(defender) } }) as unknown as BattleResult;

describe('ширина поля: фронт меньшей стороны', () => {
  it('меньшая — по всем, кто вышел в бой, а не по фронту: большая с резервом остаётся большей', () => {
    // Нападающий: 90 во фронте, больше никого — 90 всего. Обороняющийся: 60 во фронте и 140 лучников — 200.
    const r = fight({ A: { infantry: 30 }, B: { infantry: 30 }, C: { infantry: 30 } }, { A: { spear: 20 }, B: { spear: 20 }, C: { spear: 20 }, R: { archer: 140 } });
    expect(stackTotal(r.sides.attacker.initial)).toBeLessThan(stackTotal(r.sides.defender.initial));
    // Фронт меньшей шире фронта большей — и прибор всё равно берёт меньшую по числу.
    expect(frontOf(r)).toEqual({ small: 30, big: 20 });
  });

  it('фронт — вся первая линия без ширины: пешие и конные, где бы ни встали, на три полосы; лучники — нет', () => {
    // Конница в резерве — тоже первая линия: без ширины правило поставило бы её с краёв. Лучники — вторая линия.
    const r = fight({ A: { infantry: 12 }, B: { spear: 24 }, C: { infantry: 6 }, D: { archer: 50 }, E: { archer: 50 }, R: { cavalry: 50 } }, { B: { infantry: 1000 } });
    expect(frontOf(r).small).toBe((12 + 24 + 6 + 50) / FRONT.length);
    expect(frontOf(r).big).toBe(1000 / FRONT.length);
  });

  it('фронт меряется без ширины: армия шире трёх W даёт фронт шире W, а не упирается в него', () => {
    // С шириной правило развёртывания кладёт в ряд не больше W, остальных — в резерв (docs/battle_eu4.md, 14.5).
    // Прибор, мерявший бы расставленные сектора, упирался бы в W сам — и W проверялось бы собой.
    const wide = deploySetup({ infantry: 6 * FRONT_WIDTH, archer: FRONT_WIDTH });
    const r = simulateBattle({ seed: 7, attacker: wide, defender: deploySetup({ infantry: 8 * FRONT_WIDTH }) });
    // Граница области: расставленная первая линия правда упёрлась в W, и лишние стоят в резерве.
    for (const s of FRONT) expect(stackTotal(wide.sectors[s])).toBe(FRONT_WIDTH);
    expect(stackTotal(wide.sectors.R)).toBe(3 * FRONT_WIDTH);
    expect(frontOf(r).small).toBe((6 * FRONT_WIDTH) / FRONT.length);
  });

  it('поровну — меньшей считается та, у кого фронт уже', () => {
    const r = fight({ A: { infantry: 30 }, R: { archer: 30 } }, { A: { infantry: 60 } });
    expect(frontOf(r)).toEqual({ small: 10, big: 20 });
  });

  it('на настоящей записи боя фронт берётся из состава меньшей стороны', () => {
    const small = deploySetup({ infantry: 120, spear: 60, archer: 60 });
    const big = deploySetup({ infantry: 300, spear: 150, archer: 150 });
    const r = simulateBattle({ seed: 7, attacker: small, defender: big });
    const want = (120 + 60) / FRONT.length;
    expect(frontOf(r).small).toBeCloseTo(want, 6);
  });

  it('медиана — средняя точка ряда, при чётном числе — среднее двух; ширина — целая', () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(widthOf([10.4, 20, 30].map((small) => ({ small, big: 0, kind: 'defense' })))).toBe(20);
    expect(widthOf([10, 11].map((small) => ({ small, big: 0, kind: 'defense' })))).toBe(11);
  });
});
