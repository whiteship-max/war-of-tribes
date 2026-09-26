import { describe, expect, it } from 'vitest';
import { FRONT, SECTORS, emptyStack, quickSetup, simulateBattle, stackOf, stackTotal, type BattleResult, type Sector, type Stack } from '@/battle';
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
    // Нападающий: 90 во фронте, больше никого — 90 всего. Обороняющийся: 60 во фронте и 140 в резерве — 200.
    const r = fight({ A: { infantry: 30 }, B: { infantry: 30 }, C: { infantry: 30 } }, { A: { spear: 20 }, B: { spear: 20 }, C: { spear: 20 }, R: { cavalry: 140 } });
    expect(stackTotal(r.sides.attacker.initial)).toBeLessThan(stackTotal(r.sides.defender.initial));
    // Фронт меньшей шире фронта большей — и прибор всё равно берёт меньшую по числу.
    expect(frontOf(r)).toEqual({ small: 30, big: 20 });
  });

  it('фронт — первая линия A, B, C на три полосы; тыл и резерв в него не входят', () => {
    const r = fight({ A: { infantry: 12 }, B: { spear: 24 }, C: { infantry: 6 }, D: { archer: 50 }, E: { archer: 50 }, R: { cavalry: 50 } }, { B: { infantry: 1000 } });
    expect(frontOf(r).small).toBe((12 + 24 + 6) / FRONT.length);
    expect(frontOf(r).big).toBe(1000 / FRONT.length);
  });

  it('поровну — меньшей считается та, у кого фронт уже', () => {
    const r = fight({ A: { infantry: 30 }, R: { infantry: 30 } }, { A: { infantry: 60 } });
    expect(frontOf(r)).toEqual({ small: 10, big: 20 });
  });

  it('на настоящей записи боя фронт берётся из расстановки меньшей стороны', () => {
    const small = quickSetup({ infantry: 120, spear: 60, archer: 60 });
    const big = quickSetup({ infantry: 300, spear: 150, archer: 150 });
    const r = simulateBattle({ seed: 7, attacker: small, defender: big });
    const want = FRONT.reduce((n, s) => n + stackTotal(small.sectors[s]), 0) / FRONT.length;
    expect(want).toBeGreaterThan(0);
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
