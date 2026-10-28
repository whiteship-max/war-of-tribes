// Окно вывода шага кости (ПБ-1, п. 2; задача 22.7, docs/siege_v2.md, «Решения ПБ-1»): шаг выводится на решётках «Лезвия» всех
// ширин W − K … W + K, у каждой ширины — свой блок сидов, один при любом W. Обещаний два: соседние W делят все бои окна, кроме
// крайней ширины (шаг — гладкая функция W, вывод W не ходит кругом), и уровень шага меряется на 2K + 1 блоках костей, а не на одном.
//
// Область (правило 11): окно у ширины конфига и у соседней, кость конфига. Точки проверяются утверждениями: ширины окна — те, что
// у конфига рядом, бои у них есть, доля — не крайняя (не 0 и не 1).
import { describe, expect, it } from 'vitest';
import { DICE, FRONT_WIDTH } from './config';
import { EDGE_HOLD_STEP, STEP_KERNEL, STEP_SEEDS, armyAt, compositionLattice, edgeBattles, stepBattles, stepHold, stepSeedsOf, stepWidths } from './bench';

/** Доля большей на одной ширине окна — её блоком сидов. */
const widthHold = (w: number): { held: number; all: number } => {
  const b = edgeBattles(EDGE_HOLD_STEP, 0, compositionLattice().length, STEP_SEEDS, armyAt(w), w, stepSeedsOf(w));
  return { held: b.filter((x) => x.r.winner === x.big).length, all: b.length };
};

describe('окно вывода шага кости (ПБ-1, п. 2)', () => {
  it('у каждой ширины окна свой блок сидов, и он не зависит от W: соседние окна делят все ширины, кроме крайней', () => {
    const at = stepWidths(FRONT_WIDTH);
    const next = stepWidths(FRONT_WIDTH + 1);
    expect(at.length).toBe(2 * STEP_KERNEL + 1);
    expect(next.filter((w) => at.includes(w)).length, 'соседние окна делят 2K ширин').toBe(2 * STEP_KERNEL);
    // Блоки ширин окна — все разные: различных сидов в окне (2K + 1) × STEP_SEEDS.
    const firsts = at.map((w) => stepSeedsOf(w));
    expect(new Set(firsts).size, 'блоки ширин окна различны').toBe(at.length);
    const seeds = new Set(firsts.flatMap((f) => Array.from({ length: STEP_SEEDS }, (_, i) => f + i)));
    expect(seeds.size).toBe(at.length * STEP_SEEDS);
    // Блок — свойство ширины (по остатку от числа ширин окна): у любого окна, где она есть, он тот же.
    for (const w of at) expect(stepSeedsOf(w + 2 * STEP_KERNEL + 1), `ширина ${w}: блок по остатку`).toBe(stepSeedsOf(w));
    expect(stepBattles(), 'боёв окна').toBe(at.length * compositionLattice().length * STEP_SEEDS * 2);
  });

  it('доля окна — доля всех его боёв, и соседние окна разнятся только крайними ширинами', () => {
    const lo = FRONT_WIDTH - STEP_KERNEL;
    const hi = FRONT_WIDTH + 1 + STEP_KERNEL;
    const by = new Map<number, { held: number; all: number }>();
    for (let w = lo; w <= hi; w++) by.set(w, widthHold(w));
    const of = (width: number): number => {
      const ws = stepWidths(width);
      return ws.reduce((n, w) => n + by.get(w)!.held, 0) / ws.reduce((n, w) => n + by.get(w)!.all, 0);
    };
    const here = stepHold(FRONT_WIDTH);
    // Точка внутри области: кость конфига, доля не крайняя — большей есть что терять.
    expect(DICE.step).toBeGreaterThan(0);
    expect(here).toBeGreaterThan(0.5);
    expect(here).toBeLessThan(1);
    expect(here, 'доля окна — по всем боям его ширин').toBeCloseTo(of(FRONT_WIDTH), 12);
    expect(stepHold(FRONT_WIDTH + 1), 'у соседнего W — те же бои, кроме крайних ширин').toBeCloseTo(of(FRONT_WIDTH + 1), 12);
    const edge = (by.get(hi)!.held - by.get(lo)!.held) / by.get(lo)!.all / (2 * STEP_KERNEL + 1);
    expect(stepHold(FRONT_WIDTH + 1) - here, 'разница соседних — крайние ширины, делённые на число ширин').toBeCloseTo(edge, 12);
  }, 120_000);
});
