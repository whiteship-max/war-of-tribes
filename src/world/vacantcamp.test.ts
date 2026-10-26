// Место полководца опустело — осадный лагерь снят (MAP-3, docs/audit/WORKPLAN.md; архив round2/prove-24-1). Пустое место
// уводило полководца с карты, а лагерь под чужими стенами оставался без него и держал осаду дальше. Теперь пустое место
// снимает лагерь той же дверью, что уход от стен (`leaveCamp`); сохранение, где лагерь уже пережил пустое место, чинится
// при следующей встрече с партией.
import { afterEach, describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { WorldSave } from './local/state';
import type { GenSettlement } from './gen';
import type { PlayerProfile } from './types';
import { distance } from './geo';
import { shieldVillagers } from './lairs';
import { ourCamp, siegeActive } from './siege';
import { setPhaseDie } from './siegeroll';

type Inner = { save: WorldSave; gen: { settlements: GenSettlement[] }; alive(s: GenSettlement, now: number): boolean };

const profile: PlayerProfile = {
  name: 'Т',
  pop: shieldVillagers(0.1),
  defense: 30,
  units: { warrior: 10, scout: 4 },
  army: { spearman: 40 },
  stock: { food: 600, wood: 400 },
  stash: 0,
};

/** Наш лагерь у ближнего логова; часы двигает тест. */
async function besieged() {
  setPhaseDie(() => 7);
  const clock = { now: 1_700_000_000_000 };
  const world = new LocalWorld({ seed: 7, now: () => clock.now, storage: null });
  const w = world as unknown as Inner;
  await world.sync(profile);
  const home = w.save.home;
  const lair = w.gen.settlements
    .filter((s) => w.alive(s, clock.now))
    .sort((a, b) => distance(home, a) - distance(home, b))[0];
  Object.assign(w.save.figures.general, {
    phase: 'field', from: { x: lair.x, y: lair.y }, to: { x: lair.x, y: lair.y }, departAt: clock.now, arriveAt: clock.now,
    downUntil: 0, busyUntil: 0, held: false, watching: false, energy: undefined, spent: undefined,
    troops: { spearman: 40 }, handover: undefined,
  });
  expect(await world.besiege()).toBeNull();
  const camp = (): boolean => {
    const s = w.save.sieges[lair.id];
    return !!(s && ourCamp(s) && siegeActive(s, clock.now));
  };
  expect(camp(), 'точка внутри области: наш лагерь стоит').toBe(true);
  return { world, w, clock, camp, person: w.save.figures.general.person ?? 0 };
}

afterEach(() => setPhaseDie(null));

describe('пустое место полководца снимает лагерь (MAP-3)', () => {
  it('место опустело — лагерь снят, весть о снятии осады', async () => {
    const { world, w, clock, camp, person } = await besieged();
    clock.now += 1000;
    const out = await world.sync({ ...profile, agents: { general: { person, vacant: true } } });
    expect(w.save.figures.general.gone).toBeTruthy();
    expect(camp()).toBe(false);
    expect(out.effects.some((e) => e.id.startsWith('camp-left-'))).toBe(true);
  }, 60_000);

  it('сохранение, где лагерь пережил пустое место, — лагерь снимается при встрече с партией', async () => {
    const { world, w, clock, camp, person } = await besieged();
    // Как в сохранении до правки: место уже пустое, лагерь стоит.
    Object.assign(w.save.figures.general, { phase: 'down', troops: undefined, gone: { person, at: clock.now, why: 'retired' } });
    expect(camp()).toBe(true);
    clock.now += 1000;
    await world.sync({ ...profile, agents: { general: { person, vacant: true } } });
    expect(camp()).toBe(false);
  }, 60_000);

  it('живой полководец лагерь держит', async () => {
    const { world, clock, camp } = await besieged();
    clock.now += 1000;
    await world.sync(profile);
    expect(camp()).toBe(true);
  }, 60_000);
});
