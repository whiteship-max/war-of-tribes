// Пересчёт огня башни не обнуляет древесину машин (MAP-2, docs/audit/WORKPLAN.md; архив round1/world/prove-4-1). `reaim`
// перестраивал доли древесины окна по фронту и тылу и терял долю машин и нарубленное на них: лагерь, рубивший таран, после
// первого выстрела башни оставался без древесины и больше её не рубил.
import { describe, expect, it } from 'vitest';
import { reaim } from './bombard';
import { machineWood, playerWood, rebaseWood, sideWorks } from './works';
import { CAMP_WORKS_RIPE } from './data/tuning';

const S = 0;
const AT = CAMP_WORKS_RIPE;

describe('reaim: древесина машин переживает смену огня (MAP-2)', () => {
  it('нарубленное к минуте события остаётся, и рубка идёт дальше прежней долей', () => {
    const wood = playerWood(0.5, 0.5);
    const before = machineWood(S, AT, wood);
    expect(before, 'точка внутри области: машинам отдана доля').toBeGreaterThan(0);
    const r = reaim(undefined, wood, S, AT, { slow: 0.3, thin: 0.1 });
    expect(machineWood(S, AT, r.wood)).toBeCloseTo(before, 9);
    expect(machineWood(S, 2 * AT, r.wood)).toBeCloseTo(machineWood(S, 2 * AT, wood), 9);
  });

  it('после смены долей (база машин уже лежит) — база не теряется', () => {
    const rebased = rebaseWood(S, AT, playerWood(0.5, 0.5), 0.5, 0.5);
    expect(rebased.base?.machines, 'точка внутри области: база машин заведена').toBeGreaterThan(0);
    const t = 2 * AT;
    const r = reaim(undefined, rebased, S, t, { slow: 0.4, thin: 0 });
    expect(machineWood(S, t, r.wood)).toBeCloseTo(machineWood(S, t, rebased), 9);
    expect(machineWood(S, 3 * AT, r.wood)).toBeCloseTo(machineWood(S, 3 * AT, rebased), 9);
  });

  it('без доли машин окно не получает лишнего поля, рогатки — как прежде', () => {
    const wood = playerWood(0.5);
    const r = reaim(undefined, wood, S, AT, { slow: 0.3, thin: 0.1 });
    expect(r.wood?.machines).toBeUndefined();
    expect(r.wood?.base?.machines).toBeUndefined();
    expect(r.wood?.base?.front).toBeCloseTo(sideWorks(S, AT, 'front', wood), 9);
  });
});
