// Хлеб осаждённого города — хлеб окна осады (Р-5, docs/siege_v2.md, 21.1): у нашей деревни под лагерем логова. Голод
// приходит по часам окна, и тогда хлеба нет нигде — ни в добыче, ни на складе племени; прогноз «кончится хлеб — унесут»
// хлеба не обещает; мост держит склад не выше остатка окна. Случай из донесения — полный склад и голод: в обоз ушёл хлеб,
// который осада съела.
import '@/game/pace.minute';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/game/state';
import { LocalWorld } from './local/LocalWorld';
import { foodLeft, openSiege } from './siege';
import { applyEffects, syncSiege } from './bridge';
import { shieldVillagers } from './lairs';
import { setPhaseDie } from './siegeroll';
import { breadCap } from '@/game/sim/siege';
import type { PlayerProfile, SiegeView, WorldPulse } from './types';

// Кость фаз тихая — «без перемен»: здесь голод, а не сдача (правило фаз — `siegeroll.test.ts`).
beforeAll(() => setPhaseDie(() => 7));
afterAll(() => setPhaseDie(null));
vi.mock('@/world/data/energy', async (actual) => ({ ...(await actual<object>()), ENERGY_ROAD: Infinity }));

const START = 1_700_000_000_000;

function makeWorld(seed = 7) {
  let now = START;
  const world = new LocalWorld({ seed, now: () => now, storage: null });
  return { world, at: (t: number): void => void (now = t), advance: (ms: number): void => void (now += ms), now: (): number => now };
}

/** Деревня, которую с ходу не взять (огромное ополчение): набег садится лагерем. Склад полон хлеба. */
const holdout = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 100_000,
  militia: 1000,
  units: { warrior: 10, scout: 4 },
  army: { spearman: 10 },
  stock: { food: 6000, wood: 400 },
  stash: 0,
  food: 6000,
  foodPerHour: 6000,
  soldierFoodPerHour: 60,
  ...over,
});

async function besiege(w: ReturnType<typeof makeWorld>, p: PlayerProfile): Promise<WorldPulse> {
  for (let i = 0; i < 2500; i++) {
    w.advance(20_000);
    const pulse = await w.world.sync(p);
    if (pulse.siege) return pulse;
  }
  throw new Error('осады так и не случилось');
}

describe('голод у нашей деревни — по хлебу окна', () => {
  it('случай из донесения: полный склад, голод — в добыче хлеба нет, склад племени списан, прочее унесли', async () => {
    const w = makeWorld(7);
    const p = holdout();
    await w.world.sync(p);
    const pulse = await besiege(w, p);
    const siege = pulse.siege!;
    expect(siege.bread, 'окно показывает хлеб — тот же, что был, когда встал лагерь').toBeLessThanOrEqual(siege.foodAtStart);
    expect(siege.bread ?? 0, 'точка внутри области: хлеб в окне есть').toBeGreaterThan(0);
    // Прогноз падения голодом — без хлеба: его съест осада.
    expect(siege.fall.goods, '«кончится хлеб — унесут» — только дерево').toBeLessThanOrEqual(400);

    w.at(Math.ceil(siege.starvesAt));
    const after = await w.world.sync(p);
    const effect = after.effects.find((e) => e.text.includes('Осада доела'));
    expect(effect, 'город пал голодом').toBeTruthy();
    expect(effect?.resources.food ?? 0, 'хлеб съеден — в обоз его не положить').toBe(0);
    expect(effect?.resources.wood ?? 0, 'дерево унесли').toBeLessThan(0);
    expect(effect?.starved, 'хлеба нет и на складе').toBe(true);

    // Племя: склад был полон (офлайн-догон без осады), после падения голодом хлеба нет.
    const s = createInitialState();
    s.resources.food = 6000;
    applyEffects(s, [effect!]);
    expect(s.resources.food).toBe(0);
  }, 60_000);

  it('сдача на фазе — хлеба в добыче не больше остатка окна в эту минуту', () => {
    const w = openSiege({ byId: 'l-1', campId: 'm-1', now: START, food: 6000, garrison: 10, townPerHour: 600, perManPerHour: 6 });
    const at = START + 3 * 3600_000;
    const left = foodLeft(w, at);
    expect(left, 'точка внутри области: хлеба меньше склада и больше нуля').toBeGreaterThan(0);
    expect(left).toBeLessThan(6000);
    expect(Math.floor(foodLeft(w, START + 1e12))).toBe(0);
  });
});

describe('мост: склад под осадой не выше хлеба окна', () => {
  const view = (bread: number): SiegeView =>
    ({ byId: 'l-1', byName: 'Волчья падь', since: START, starvesAt: START + 3600_000, garrison: 10, foodAtStart: 6000, bread } as unknown as SiegeView);

  it('склад выше окна — урезан до окна, и это разовая трата (книга запасов сервера её объяснит)', () => {
    const s = createInitialState();
    s.resources.food = 6000;
    const before = s.stats.outlays ?? 0;
    expect(syncSiege(s, view(1200), START)).toBe(true);
    expect(s.resources.food).toBe(1200);
    expect(s.stats.outlays ?? 0).toBe(before + 1);
  });

  it('склад ниже окна — не трогается: съел больше — голодно ему, хлеба мост не дарит', () => {
    const s = createInitialState();
    s.resources.food = 500;
    syncSiege(s, view(1200), START);
    expect(s.resources.food).toBe(500);
  });

  it('пульс за пульсом — без урезания по крошке: допуск больше расхода между пульсами', () => {
    const s = createInitialState();
    s.resources.food = 1203;
    const before = s.stats.outlays ?? 0;
    expect(breadCap(s, 1200)).toBe(false);
    expect(s.stats.outlays ?? 0).toBe(before);
  });
});
