// Обоз кормит отряд (ДР-2, docs/siege_v2.md, 25.1, М5б): голод дома — нехватка хлеба на складе (`derived.foodShortfall`),
// а у отряда полководца с обозом свой хлеб. Дух отряда в его боях — без строки голода (`sim/spirit.spiritFedOf`), и бойцы
// отряда голодом не уходят (`GameState.awayFed`, шаг содержания тянет голодных из прочих). Механика верна при паёке 1:
// временный `TEST_ARMY_FOOD = 0` подменён единицей в свежем наборе модулей (как в `armyfood.test.ts`).
//
// Область правила — утверждением в самом тесте (правило 11): амбар пуст и войско голодает (доля голодных > 0), терпение
// кончилось — уход голодом идёт.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY_LENGTH } from './constants';

afterEach(() => {
  vi.doUnmock('./constants');
  vi.resetModules();
});

async function load(k: number) {
  vi.resetModules();
  vi.doMock('./constants', async (actual) => ({ ...(await actual<object>()), TEST_ARMY_FOOD: k }));
  return {
    derived: await import('./derived'),
    state: await import('./state'),
    upkeep: await import('./sim/upkeep'),
    spirit: await import('./sim/spirit'),
    expedition: await import('./sim/expedition'),
    bridge: await import('../world/bridge'),
  };
}
type Mods = Awaited<ReturnType<typeof load>>;

/** Голодная партия: войско 120 копейщиков, склад пуст, казна полна, терпение кончилось. */
function hungry(m: Mods) {
  const s = m.state.createInitialState(7);
  s.army.spearman = 120;
  s.resources.food = 0;
  s.gold = 1e9;
  s.pay.debt = 0;
  s.pay.late = m.derived.payGraceDays(s) * DAY_LENGTH;
  return s;
}

describe('обоз кормит отряд: голод дома его не трогает', () => {
  it('дух отряда с обозом — без строки голода; голода нет — отдельного духа нет', async () => {
    const m = await load(1);
    const s = hungry(m);
    // Войско больше, чем кормят поля: при пустом амбаре нехватка ложится на него. Терпение не кончилось — иначе дух на дне
    // и без голода (терпение множит путь «дно — потолок»), и строку голода не видно.
    s.army.spearman = 2000;
    s.pay.late = 0;
    const unfed = m.spirit.spiritIn(s).unfed;
    expect(unfed, 'точка внутри области: войско голодает').toBeGreaterThan(0);
    const fed = m.spirit.spiritFedOf(s);
    const all = m.spirit.spiritOf(s);
    expect(fed).toBeDefined();
    expect(fed!.morale).toBeGreaterThan(all.morale);
    expect(fed!.discipline).toBeGreaterThan(all.discipline);
    // Тот же расчёт без голода — ровно сытая партия.
    const full = m.state.createInitialState(7);
    full.army.spearman = 120;
    full.gold = 1e9;
    expect(m.spirit.spiritIn(full).unfed).toBe(0);
    expect(m.spirit.spiritFedOf(full)).toBeUndefined();
    // Мост везёт сытый дух в мир только при голоде.
    expect(m.bridge.playerProfile(s).spiritFed).toEqual(fed);
    expect(m.bridge.playerProfile(full).spiritFed).toBeUndefined();
  });

  it('бойцы отряда с обозом голодом не уходят: голодные — из прочих', async () => {
    const m = await load(1);
    const run = (fed: Record<string, number>): number => {
      const s = hungry(m);
      m.expedition.setAway(s, { spearman: 80 }, 0, fed);
      for (let i = 0; i < 5 * 24; i++) m.upkeep.upkeepTick(s, DAY_LENGTH / 24, 0.5);
      return 120 - (s.army.spearman ?? 0);
    };
    const all = run({});
    const train = run({ spearman: 80 });
    expect(all, 'точка внутри области: голод уводит людей').toBeGreaterThan(3);
    // С обозом голод тянет только из 40 прочих — втрое меньше людей.
    expect(train).toBeLessThan(all);
    expect(train).toBeLessThanOrEqual(Math.ceil(all / 3) + 1);
  });

  it('мир кладёт «кормит обоз» только у отряда с обозом вне своих стен', async () => {
    const m = await load(1);
    const g = { id: 'general', march: { gait: 'train' }, atHome: false, phase: 'moving', gone: null, troops: { spearman: 40 } } as never;
    expect(m.bridge.awayFedOf([g])).toEqual({ spearman: 40 });
    expect(m.bridge.awayFedOf([{ ...(g as object), atHome: true } as never])).toEqual({});
    expect(m.bridge.awayFedOf([{ ...(g as object), march: { gait: 'normal' } } as never])).toEqual({});
    const s = hungry(m);
    m.expedition.setAway(s, {}, 0, {});
    expect(s.awayFed).toBeUndefined();
  });
});
