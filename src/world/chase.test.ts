// Перехват из лагеря осады: кнопка «Перехватить в поле» (меню приказов, `ActionMenu`) показывает встречу из плана
// (`interceptPlan`), а приказ (`intercept`) решает сам. Прежде план про лагерь не знал: кнопка обещала точку и время
// встречи, а приказ отменял её отказом (слово владельца по docs/battle_eu4.md, 14.28, пункт 6). Отказ теперь один на
// план и на приказ — `LocalWorld.chaseBlock`.
//
// Проверка на настоящем мире: лагерь ставят приказы, набег на деревню кладётся в сохранение видом мира. Граница области
// в самом тесте: без лагеря тот же набег догоняется — иначе «встречи нет» получалось бы и без правила.
import { describe, expect, it, vi } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { StoredMarch, WorldSave } from './local/state';
import { distance } from './geo';
import { shieldVillagers } from './lairs';
import { CHASE_FROM_CAMP } from './siege';
import type { TroopStack } from '@/game/battle/kinds';
import type { FigureView, PlayerProfile } from './types';

// Энергия агентов здесь не предмет проверки (docs/agent_energy.md): сценарии этого файла водят агентов по карте помногу
// — дорога здесь энергию не берёт. Цены дел и отдых дома остаются; энергию держат `energy.test.ts` и
// `energyworld.test.ts`.
vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

const START = 1_700_000_000_000;
const HOUR = 3_600_000;

const profile = (army: TroopStack): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 900,
  units: { warrior: 10, scout: 4 },
  army: { ...army },
  stock: { food: 4000, wood: 4000, stone: 4000, hides: 4000, charcoal: 4000, copper: 4000, iron: 4000 },
  stash: 0,
});

describe('перехват из лагеря осады: план гаснет там же, где откажет приказ', () => {
  it('без лагеря набег догоняется; в лагере — встречи нет, причина та же, что у приказа', async () => {
    let now = START;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const HOST: TroopStack = { legionary: 30, spearman: 24, archer: 16 };
    const p = profile(HOST);
    const general = async (): Promise<FigureView> => (await world.figures()).find((f) => f.id === 'general')!;

    await world.sync(p);
    expect(await world.setGarrison({ ...HOST })).toBeNull();
    now = Math.max(now, (await general()).readyAt);
    await world.sync(p);
    const info = await world.info();
    const lairs = (world as unknown as { gen: { settlements: { id: string; name: string; x: number; y: number }[] } }).gen
      .settlements;
    const [near] = [...lairs].sort((x, y) => distance(info.home, x) - distance(info.home, y));
    expect(await world.moveFigure('general', { x: near.x, y: near.y })).toBeNull();
    now = Math.max(now, (await general()).arriveAt);
    await world.sync(p);

    // Набег на деревню — тем видом, каким его кладёт мир.
    const raid: StoredMarch = {
      id: 'raid-chase',
      seed: 5,
      mission: 'raid',
      units: { warrior: 5 },
      own: false,
      fromId: near.id,
      targetId: info.homeId,
      // Выходят у самого полководца и идут долго: без лагеря встреча заведомо есть.
      from: { x: near.x + 2, y: near.y },
      to: { x: info.home.x, y: info.home.y },
      fromName: near.name,
      toName: 'дом',
      departAt: now,
      arriveAt: now + 24 * HOUR,
      phase: 'out',
      power: 15,
      loot: null,
    };
    (world as unknown as { save: WorldSave }).save.marches.push(raid);

    // Граница области: полководец в поле, лагеря нет — тот же набег догоняется, встреча показана.
    const free = await world.interceptPlan(raid.id);
    expect(free.can, `без лагеря перехват возможен: ${free.reason ?? ''}`).toBe(true);
    expect(free.at, 'без лагеря встреча показана').toBeTruthy();

    expect(await world.besiege()).toBeNull();
    expect((await general()).besieging, 'полководец стоит лагерем').toBe(near.id);

    const plan = await world.interceptPlan(raid.id);
    expect(plan.can, 'из лагеря кнопка неактивна').toBe(false);
    expect(plan.at, 'из лагеря встречи не показывают').toBeNull();
    expect(plan.reason, 'причина — лагерь осады').toBe(CHASE_FROM_CAMP);
    expect(await world.intercept(raid.id), 'приказ отказывает той же причиной').toBe(CHASE_FROM_CAMP);
  }, 120_000);
});
