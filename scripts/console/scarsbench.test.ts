// Мерка черт армии одной формы при любом W (ПБ-1, п. 1; docs/siege_v2.md, «Решения ПБ-1»). Обещания три:
// - форма развёртывания мерки от W не зависит: фронт полос полон, резерв — та же доля ширины (армия в бойцах строя ∝ W);
// - растянутая армия — с дробью: в среднем по сидам ровно в k раз, при k = 1 — сама мерка;
// - сила черты в её бою от W не зависит: при W 100 и W 120 — та же в пределах шума набора (200 сидов).
//
// Область (правило 11): ширины, какие вывод W давал (89…158, история `config.ts`), и W конфига внутри них; растяжки — та, что
// бисекция силы вообще спрашивает (0.4…1.8). Точки проверяются утверждениями в самом тесте.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRONT, REAR, deploySetup, stackTotal, FRONT_WIDTH } from '@/battle';
import { UNIT_KINDS } from '@/battle/types';
import { SCARS, type ScarId } from '@/game/scarrules';
import { HORSE_MIX, SCAR_DEPTH, benchKinds, benchOf, ditherOf, stretched } from './scars';
import { SPIRIT_MIX } from './spirit';

const WIDTHS = [89, 100, 120, 158];

describe('мерка черт одной формы при любом W (ПБ-1, п. 1)', () => {
  it('фронт полос полон, резерв — та же доля ширины: армия мерки в бойцах строя пропорциональна W', () => {
    expect(WIDTHS[0] <= FRONT_WIDTH && FRONT_WIDTH <= WIDTHS[WIDTHS.length - 1], 'точка внутри области: W конфига').toBe(true);
    for (const mix of [SPIRIT_MIX, HORSE_MIX]) {
      const shape = WIDTHS.map((w) => {
        const kinds = benchKinds(mix, w);
        const s = deploySetup(kinds, w);
        expect(stackTotal(kinds) / (FRONT.length * w), `W ${w}: глубина мерки`).toBeCloseTo(SCAR_DEPTH, 1);
        for (const f of FRONT) expect(stackTotal(s.sectors[f]), `W ${w}: фронт ${f} полон`).toBe(w);
        return { reserve: stackTotal(s.sectors.R) / w, rear: REAR.reduce((n, r) => n + stackTotal(s.sectors[r]), 0) / w };
      });
      // Доли одни: разница — округление родов, не больше двух бойцов на ширину.
      for (const x of shape) {
        expect(Math.abs(x.reserve - shape[0].reserve), 'резерв — та же доля ширины').toBeLessThan(4 / WIDTHS[0]);
        expect(Math.abs(x.rear - shape[0].rear), 'тыл — та же доля ширины').toBeLessThan(4 / WIDTHS[0]);
      }
      expect(shape[0].reserve, 'точка внутри области: резерв есть').toBeGreaterThan(0.5);
    }
  });

  it('растяжка с дробью: при k = 1 — сама мерка, в среднем по сидам — ровно в k раз', () => {
    const us = benchKinds(SPIRIT_MIX);
    expect(stretched(us, 1, ditherOf(7))).toEqual(us);
    for (const k of [0.4, 0.93, 1.042, 1.8]) {
      const n = 400;
      for (const kind of UNIT_KINDS) {
        if (us[kind] === 0) continue;
        let sum = 0;
        for (let i = 1; i <= n; i++) sum += stretched(us, k, ditherOf(i))[kind];
        // Точка внутри области: у рода есть дробь — целые бойцы её не дали бы.
        expect(Math.abs(sum / n - us[kind] * k), `k ${k}, ${kind}: среднее по сидам`).toBeLessThan(0.02);
      }
    }
  });
});

describe('сила черты от W не зависит (ПБ-1, п. 1)', () => {
  afterEach(() => {
    vi.doUnmock('@/battle/config');
    vi.resetModules();
  });

  /** Сила черты `id` на 200 сидах при ширине конфига `w`: модули читают подменённый `FRONT_WIDTH` заново. */
  async function strengthAt(w: number, id: ScarId): Promise<number> {
    vi.resetModules();
    vi.doMock('@/battle/config', async (orig) => ({ ...(await orig<object>()), FRONT_WIDTH: w }));
    const battle = await import('@/battle');
    expect(battle.FRONT_WIDTH, 'подмена ширины дошла до двери боя').toBe(w);
    const scars = await import('./scars');
    return scars.scarStrength(scars.benchOf(id), [id], 200);
  }

  it('добрая и дурная черта при W 100 и W 120 — одной силы в пределах шума набора', async () => {
    for (const id of ['highland', 'woodfear'] as ScarId[]) {
      expect(SCARS.some((d) => d.id === id)).toBe(true);
      expect(benchOf(id).where, `${id}: черта меряется в своём месте`).not.toEqual({});
      const a = await strengthAt(100, id);
      const b = await strengthAt(120, id);
      // Точка внутри области: черта сдвигает силу — мерить есть что.
      expect(Math.abs(a - 1), `${id}: черта действует`).toBeGreaterThan(0.02);
      expect(Math.abs(a - b), `${id}: сила при W 100 — ×${a.toFixed(4)}, при W 120 — ×${b.toFixed(4)}`).toBeLessThan(0.008);
    }
  }, 240_000);
});
