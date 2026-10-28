// Выборка W и цель морали обычного города — без поведения «всё, что прокормит» (решение владельца по ПБ-1, П4, 28.10.2026;
// docs/siege_v2.md, «Решения ПБ-1»): W меряет обычного игрока. Область — выборка «Найма» во всех трёх частях: лестница
// (`поведение:уровень`), партия с первой секунды, уведённые люди; бои у ворот по событиям — вне выборки и так.
import { describe, expect, it } from 'vitest';
import type { Front } from './lib/front';
import type { Spirited } from './lib/spirited';
import { STYLES, W_STYLES, outOfW, wOuts, type Out, type Style } from './raid-live';
import type { Hired } from './raid-hiring';
import { spiritOfHired } from './raid-spirit';
import { widthOfHired } from './raid-width';

/** Прогон с боями одного фронта и одного потолка морали: метка поведения — в самих числах. */
const run = (small: number, ceil: number, n = 3): Out =>
  ({
    l: {
      fronts: Array.from({ length: n }, (): Front => ({ small, big: small + 10, kind: 'raid', gate: false })),
      spirits: Array.from({ length: n }, (): Spirited => ({ kind: 'raid', gate: false, morale: ceil - 5, discipline: 70, moraleCeil: ceil, disciplineCeil: 75, lines: {} })),
    },
  }) as unknown as Out;

/** «Найм» мерки: обычные поведения бьются фронтом 100 и потолком 70, «всё, что прокормит» — 300 и 20. */
const hired = (): Hired => {
  const of = (s: Style): Out => (s === 'feed' ? run(300, 20, 12) : run(100, 70));
  const ladder: Record<string, Out[]> = {};
  for (const s of STYLES) for (const level of [7, 8]) ladder[`${s}:${level}`] = [of(s)];
  const fresh = Object.fromEntries(STYLES.map((s) => [s, [of(s)]])) as Record<Style, Out[]>;
  return { ladder, fresh, captives: [run(100, 70)] };
};

describe('выборка W — без «всё, что прокормит» (ПБ-1, П4)', () => {
  it('поведения выборки — все, кроме «всё, что прокормит»', () => {
    expect([...W_STYLES]).toEqual(STYLES.filter((s) => s !== 'feed'));
    expect(W_STYLES).not.toContain('feed');
  });

  it('прогоны выборки: лестница и партия с первой секунды — без «всё, что прокормит», уведённые — все', () => {
    const h = hired();
    const inW = wOuts(h);
    // В выборке поведения «всё, что прокормит» нет ни одного прогона: у его прогонов фронт 300.
    expect(inW.flatMap((o) => o.l.fronts).filter((f) => f.small === 300), 'прогон «всё, что прокормит» в выборке W').toEqual([]);
    // Остальное — всё: по прогону лестницы на поведение и уровень, по прогону первой секунды на поведение, уведённые.
    expect(inW.length).toBe(W_STYLES.length * 2 + W_STYLES.length + 1);
    expect(outOfW(h).length, 'вне выборки — лестница двух уровней и первая секунда «всё, что прокормит»').toBe(3);
  });

  it('W — медиана фронта боёв выборки: бои «всё, что прокормит» её не тянут', () => {
    // Без фильтра «всё, что прокормит» дал бы 36 боёв фронтом 300 против 30 обычных — медиана ушла бы на 300.
    const r = widthOfHired(hired(), () => 0);
    expect(r?.w, 'W по боям выборки').toBe(100);
    expect(r?.fights).toBe((W_STYLES.length * 3 + 1) * 3);
  });

  it('цель морали — медиана потолка тех же боёв: бои «всё, что прокормит» её не тянут', () => {
    const sp = spiritOfHired(hired());
    expect(sp?.moraleCeil, 'потолок морали обычного города').toBe(70);
    expect(sp?.fights).toBe((W_STYLES.length * 3 + 1) * 3);
  });
});
