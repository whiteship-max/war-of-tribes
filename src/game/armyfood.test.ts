import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAY_LENGTH, SOLDIER_FOOD, TEST_ARMY_FOOD } from './constants';
import type { GameState, SiegeState } from './types';

// Паёк войска `TEST_ARMY_FOOD` (0 — «войско не ест» для теста с 24.10.2026, с ПН-01 — снова 1, docs/gdd/path_of_sword.md,
// С1): паёк бойца одной дверью `build.soldierFoodPerDay` — расход склада дома и под осадой, слепок осады, пол расхода сервера и потолок книги
// запасов; при 0 бойцы голодом не уходят, сервер флага не ставит. При 1 — всё как раньше. Обе ветви — подменой множителя
// в свежем наборе модулей: у каждой свой `load`.

afterEach(() => {
  vi.doUnmock('./constants');
  vi.resetModules();
});

async function load(k: number) {
  vi.resetModules();
  vi.doMock('./constants', async (actual) => ({ ...(await actual<object>()), TEST_ARMY_FOOD: k }));
  return {
    build: await import('./build'),
    derived: await import('./derived'),
    state: await import('./state'),
    upkeep: await import('./sim/upkeep'),
    bridge: await import('../world/bridge'),
    town: await import('../../netlify/lib/town'),
    goods: await import('../../netlify/lib/goods'),
  };
}
type Mods = Awaited<ReturnType<typeof load>>;

const ARMY = 80;

/** Партия с войском дома; `siege` — под чужим лагерем. Без войска — тот же посёлок с пустым строем. */
function party(m: Mods, men: number, siege = false): GameState {
  const s = m.state.createInitialState(7);
  s.army.spearman = men;
  if (siege) s.siege = { byName: 'Логово', until: s.time + 1e9 } as SiegeState;
  return s;
}

/** Сколько бойцов уходит за 5 игр. дн. при пустом амбаре: казна полна, долга нет, терпение кончилось, голодная доля — половина. */
function starved(m: Mods): number {
  const s = party(m, ARMY);
  s.gold = 1e9;
  s.pay.debt = 0;
  s.pay.late = m.derived.payGraceDays(s) * DAY_LENGTH;
  const before = m.derived.armySize(s);
  for (let i = 0; i < 5 * 24; i++) m.upkeep.upkeepTick(s, DAY_LENGTH / 24, 0.5);
  return before - m.derived.armySize(s);
}

describe('паёк войска: паёк бойца одной дверью', () => {
  it('множитель пайка — 1: обычные правила (ПН-01)', () => {
    expect(TEST_ARMY_FOOD).toBe(1);
  });

  for (const k of [0, 1]) {
    it(`×${k}: расход склада дома и под осадой, слепок осады и пол сервера`, async () => {
      const m = await load(k);
      expect(m.build.soldierFoodPerDay(1, 1)).toBeCloseTo(SOLDIER_FOOD * k, 12);
      for (const siege of [false, true]) {
        const withArmy = party(m, ARMY, siege);
        const bare = party(m, 0, siege);
        expect(m.derived.mouthCount(withArmy), 'точка внутри области: войско ест у этого склада').toBe(ARMY);
        const extra = m.derived.foodConsumptionPerDay(withArmy) - m.derived.foodConsumptionPerDay(bare);
        const man = siege ? m.derived.besiegedSoldierFood(withArmy) : m.derived.soldierFoodPerDay(withArmy);
        expect(extra, siege ? 'под осадой' : 'дома').toBeCloseTo(ARMY * man, 9);
        if (k === 0) expect(extra).toBe(0);
        else expect(extra).toBeGreaterThan(0);
        // Жители едят как прежде при любом множителе.
        expect(m.derived.townFoodPerDay(withArmy)).toBeGreaterThan(0);
      }
      const p = m.bridge.playerProfile(party(m, ARMY, true));
      if (k === 0) expect(p.soldierFoodPerHour ?? 0).toBe(0);
      else expect(p.soldierFoodPerHour ?? 0).toBeGreaterThan(0);
      expect(p.foodPerHour ?? 0, 'город ест').toBeGreaterThan(0);

      // Сервер: пол расхода бойца и потолок книги запасов — той же дверью.
      const floor = m.town.eatFloorOf(100, 10);
      expect(floor.townPerHour).toBeGreaterThan(0);
      if (k === 0) expect(floor.perManPerHour).toBe(0);
      else expect(floor.perManPerHour).toBeGreaterThan(0);
      const ceilFood = (men: number) => m.goods.drainCeil({}, 100, 0, men).food;
      if (k === 0) expect(ceilFood(ARMY)).toBe(ceilFood(0));
      else expect(ceilFood(ARMY)).toBeGreaterThan(ceilFood(0));
    });

    it(`×${k}: голодом бойцы уходят только при пайке`, async () => {
      const m = await load(k);
      const gone = starved(m);
      if (k === 0) expect(gone, 'войско не ест — голодом не уходит').toBe(0);
      else expect(gone, 'точка внутри области: при пайке голод уводит').toBeGreaterThan(0);
    });
  }
});
