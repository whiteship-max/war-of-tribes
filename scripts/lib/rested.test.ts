import '@/game/pace.minute';
// Прибор «Мораль между боями» (`raid-hiring:report`): с какой долей морали стороны вошли в бой и вышли — из записи боя
// на настоящем пульсе мира, ничего своего.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from '@/world/local/LocalWorld';
import { shieldVillagers } from '@/world/lairs';
import type { WorldSave } from '@/world/local/state';
import type { GateCall, PlayerProfile } from '@/world/types';
import { pulseRests } from './rested';

const START = 1_700_000_000_000;

describe('мораль между боями глазами прибора', () => {
  it('уставший гарнизон у ворот — наша доля на входе из события журнала, выход обеих сторон из итога ядра', async () => {
    const world = new LocalWorld({ seed: 7, now: () => START, storage: null });
    const profile = (gate?: GateCall[]): PlayerProfile => ({
      name: 'Тест',
      pop: shieldVillagers(0.1),
      defense: 900,
      militia: 0,
      units: { warrior: 10, scout: 4 },
      army: { legionary: 30, spearman: 24, archer: 16 },
      stock: { food: 4000 },
      stash: 0,
      ...(gate ? { gate } : {}),
    });
    await world.sync(profile());
    // Гарнизон дрался только что: доля полной — треть.
    (world as unknown as { save: WorldSave }).save.homeRest = { share: 0.33, at: START, men: 10_000 };
    const pulse = await world.sync(profile([{ id: 'gate-r', foe: 'wolves', power: 60, seed: 5151 }]));
    const rs = pulseRests(pulse);
    // Граница области: в пульсе ровно этот бой, и он — у ворот.
    expect(rs).toHaveLength(1);
    const [r] = rs;
    expect(r.gate, 'бой у ворот по вызову').toBe(true);
    expect(r.inUs, 'мы вошли уставшими').toBeCloseTo(0.33, 2);
    expect(r.inFoe, 'стая — свежей').toBe(1);
    const rec = pulse.reports.find((x) => x.battle)!.battle!;
    expect(r.outUs).toBe(rec.result.sides[rec.us].rest);
    expect(r.outFoe).toBe(rec.result.sides[rec.us === 'attacker' ? 'defender' : 'attacker'].rest);
    expect(r.outUs, 'вышли не бодрее, чем вошли').toBeLessThanOrEqual(0.33 + 0.005);
  }, 60_000);
});
