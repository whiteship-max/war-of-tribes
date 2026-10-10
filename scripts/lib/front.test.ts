import { describe, expect, it } from 'vitest';
import { FRONT, FRONT_WIDTH, SECTORS, deploySetup, emptyStack, simulateBattle, stackOf, stackTotal, type BattleResult, type Sector, type Stack } from '@/battle';
import { LocalWorld } from '@/world/local/LocalWorld';
import { shieldVillagers } from '@/world/lairs';
import type { GateCall, PlayerProfile } from '@/world/types';
import { frontOf, median, pulseFronts, widthOf, widthSample, type Front } from './front';

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
    expect(widthOf([10.4, 20, 30].map((small) => ({ small, big: 0, kind: 'defense', gate: false })))).toBe(20);
    expect(widthOf([10, 11].map((small) => ({ small, big: 0, kind: 'defense', gate: false })))).toBe(11);
  });
});

describe('ширина поля: бои у ворот по событиям в выборку не входят', () => {
  // Слово владельца (docs/battle_eu4.md, 14.29): тогда сила волков и разбойников была долей обороны, числом руками, и прибор
  // ширины не должен был зависеть от нерешённого входа. С шага 5 пересмотра (14.35) она — таблица по уровню посёлка; вернуть
  // ли эти бои в выборку — решение владельца вместе с выводом W (П5), до него правило то же.
  it('медиана берётся без боёв у ворот, сколько бы их ни было и какими бы широкими они ни были', () => {
    const world: Front[] = [10, 20, 30].map((small) => ({ small, big: 0, kind: 'defense', gate: false }));
    const gates: Front[] = [500, 600, 700, 800].map((small) => ({ small, big: 0, kind: 'defense', gate: true }));
    // Граница области: с боями у ворот медиана была бы другой — иначе утверждение зелёное даром.
    expect(Math.round(median([...world, ...gates].map((f) => f.small))), 'бои у ворот сдвинули бы медиану').not.toBe(20);
    expect(widthSample([...world, ...gates]), 'в выборке — только бои с отрядами мира').toEqual(world);
    expect(widthOf([...world, ...gates]), 'W — медиана выборки').toBe(20);
  });

  it('на настоящем пульсе мира бой у ворот по вызову помечен, а бой, чьё последствие без отметки вызова, — нет', async () => {
    const START = 1_700_000_000_000;
    const world = new LocalWorld({ seed: 7, now: () => START, storage: null });
    const profile = (gate?: GateCall[]): PlayerProfile => ({
      name: 'Тест',
      pop: shieldVillagers(0.1),
      defense: 900,
      militia: 40,
      units: { warrior: 10, scout: 4 },
      army: { legionary: 30, spearman: 24, archer: 16 },
      stock: { food: 4000, wood: 4000, stone: 4000, hides: 4000, charcoal: 4000, copper: 4000, iron: 4000 },
      stash: 0,
      ...(gate ? { gate } : {}),
    });
    await world.sync(profile());
    const pulse = await world.sync(profile([{ id: 'gate-bench', foe: 'wolves', power: 60, seed: 4242 }]));
    const fronts = pulseFronts(pulse);
    // Граница области: пульс правда принёс бой у ворот — отчёт с записью боя и последствие с отметкой вызова.
    expect(fronts, 'в пульсе один бой').toHaveLength(1);
    expect(pulse.effects.filter((e) => e.gate === 'gate-bench'), 'последствие вызова пришло тем же пульсом').toHaveLength(1);
    expect(fronts[0].gate, 'бой у ворот по вызову помечен').toBe(true);
    expect(widthSample(fronts), 'и в выборку W не входит').toEqual([]);

    // Та же запись боя под именем набега, и последствие у неё того же имени, но без отметки вызова: так мир кладёт бой
    // у стены с отрядом логова (`${поход}-defense`). Такой бой — выборка.
    const raid = pulseFronts({
      reports: pulse.reports.map((r) => ({ ...r, id: 'm1-defense' })),
      effects: pulse.effects.map(({ gate: _, ...e }) => ({ ...e, id: 'm1-defense' })),
    });
    expect(raid.map((f) => f.gate), 'бой с отрядом мира не помечен').toEqual([false]);
    expect(widthSample(raid), 'и входит в выборку').toHaveLength(1);
  }, 60_000);
});
