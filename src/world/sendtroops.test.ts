// Отряд похода — те, кто ушёл из дома (BTL-7, docs/audit/WORKPLAN.md; архив round2/prove-23-1). Названный состав (`troops`)
// уходит из гарнизона поимённо, и прежде число воинов отряда бралось из приказа отдельно: из дома ушёл один дубинщик, а
// поддержка несла сто воинов мощью. Теперь воинов в отряде ровно столько, сколько в составе. Разведку ведут разведчики:
// состав бойцов с ней уходил из гарнизона, а в отряде его не было, — с разведкой состав не принимается.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import type { PlayerProfile } from './types';

const START = 1_700_000_000_000;

const profile = (): PlayerProfile => ({
  name: 'Тест',
  pop: 50,
  defense: 30,
  units: { warrior: 100, scout: 4 },
  army: { clubman: 100 },
  stock: {},
  stash: 0,
});

/** Что тест трогает в мире руками: союзника в регионе и гарнизон — расстановка, как в архиве prove-23-1. */
interface Inner {
  byId: Map<string, { id: string; tribeId: string }>;
  inRealm(s: unknown): boolean;
  save: { allyTribe: string; marches: Array<{ units: { warrior?: number }; troops?: TroopStack }> };
  defenders(now: number): { all: TroopStack };
  clock(): number;
}

/** Свой город и союзник в регионе. */
async function ready() {
  const world = new LocalWorld({ seed: 1, now: () => START, storage: null });
  await world.sync(profile());
  const w = world as unknown as Inner;
  const ally = [...w.byId.values()].find((s) => s.id !== 'home' && w.inRealm(s));
  expect(ally, 'точка внутри области: в регионе есть поселение').toBeDefined();
  ally!.tribeId = w.save.allyTribe;
  const home = (): number => troopTotal(w.defenders(w.clock()).all);
  return { world, w, ally, home };
}

describe('отряд похода — те, кто ушёл из дома', () => {
  it('поддержка с составом: воинов в отряде столько, сколько ушло (prove-23-1)', async () => {
    const { world, w, ally, home } = await ready();
    const before = home();
    const res = await world.send({ target: ally!.id, mission: 'support', units: { warrior: 100 }, troops: { clubman: 1 } });
    expect(res.error).toBeNull();
    const m = w.save.marches[w.save.marches.length - 1];
    expect(before - home(), 'из дома ушёл один').toBe(1);
    expect(m.units.warrior).toBe(troopTotal(m.troops ?? {}));
    expect(res.march?.units.warrior).toBe(1);
  });

  it('разведка с составом бойцов — отказ, гарнизон на месте', async () => {
    const { world, w, ally, home } = await ready();
    const before = home();
    const marches = w.save.marches.length;
    const res = await world.send({ target: ally!.id, mission: 'scout', units: { scout: 2 }, troops: { clubman: 5 } });
    expect(res.error).not.toBeNull();
    expect(home()).toBe(before);
    expect(w.save.marches.length).toBe(marches);
    // Без состава разведка уходит, как прежде.
    expect((await world.send({ target: ally!.id, mission: 'scout', units: { scout: 2 } })).error).toBeNull();
  });
});
