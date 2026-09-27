// Лазутчик: шанс, донесение и бунт. Всё это чистые функции, поэтому тесты
// обходятся без мира и без часов.
import { describe, expect, it } from 'vitest';
import {
  guardOf,
  revoltActive,
  revoltElapsed,
  revoltPower,
  revoltWindow,
  spyChance,
  spyOutcome,
  spySeed,
  type SpyContext,
} from './spy';
import { readIntel } from './intel';
import {
  INTEL_EXACT,
  INTEL_ROUGH,
  REVOLT_DURATION,
  REVOLT_POWER_LOSS,
  SPY_CHANCE_MAX,
  SPY_CHANCE_MIN,
  SPY_SPREAD_MAX,
  SPY_SPREAD_MIN,
} from './data/tuning';
import type { Intel } from './types';

const ctx = (over: Partial<SpyContext> = {}): SpyContext => ({
  action: 'probe',
  keen: 1,
  guard: guardOf(30, false),
  distance: 8,
  ...over,
});

describe('шанс лазутчика', () => {
  it('чистая функция от уровня, стражи и расстояния — и больше ни от чего', () => {
    const a = spyChance(ctx());
    expect(spyChance(ctx())).toBe(a);

    // Уровень лазутчика — Дозор игрока: выше уровень, выше шанс.
    expect(spyChance(ctx({ keen: 2 }))).toBeGreaterThan(a);
    // Стража цели: чем крепче поселение, тем труднее.
    expect(spyChance(ctx({ guard: guardOf(120, false) }))).toBeLessThan(a);
    // Расстояние: чужой край — чужие глаза.
    expect(spyChance(ctx({ distance: 60 }))).toBeLessThan(a);
  });

  it('замок стерегут лучше обычного двора той же мощи', () => {
    expect(guardOf(40, true)).toBeGreaterThan(guardOf(40, false));
    expect(spyChance(ctx({ guard: guardOf(40, true) }))).toBeLessThan(
      spyChance(ctx({ guard: guardOf(40, false) })),
    );
  });

  it('бунт поднять труднее, чем сосчитать войско', () => {
    expect(spyChance(ctx({ action: 'revolt' }))).toBeLessThan(spyChance(ctx({ action: 'probe' })));
  });

  it('верного дела и безнадёжного не бывает', () => {
    const best = spyChance(ctx({ keen: 10, guard: 1, distance: 0 }));
    const worst = spyChance(ctx({ action: 'revolt', keen: 1, guard: guardOf(900, true), distance: 190 }));
    expect(best).toBeLessThanOrEqual(SPY_CHANCE_MAX);
    expect(worst).toBeGreaterThanOrEqual(SPY_CHANCE_MIN);
    expect(worst).toBeLessThan(0.2);
    expect(best).toBeGreaterThan(0.8);
  });
});

describe('переспросить нельзя', () => {
  it('то же дело при тех же условиях даёт тот же исход', () => {
    const chance = spyChance(ctx());
    const seed = spySeed(7, 's12', 'probe', chance, 0);
    expect(spySeed(7, 's12', 'probe', chance, 0)).toBe(seed);
    expect(spyOutcome(chance, seed, 'probe')).toEqual(spyOutcome(chance, seed, 'probe'));
  });

  it('изменились условия — изменилось и зерно', () => {
    const base = spySeed(7, 's12', 'probe', 0.5, 0);
    // Пойманный лазутчик роняет отношение — и следующая попытка уже другое дело.
    expect(spySeed(7, 's12', 'probe', 0.5, -14)).not.toBe(base);
    // Подняли Дозор или разбили гарнизон — сменился шанс, сменилось и зерно.
    expect(spySeed(7, 's12', 'probe', 0.62, 0)).not.toBe(base);
    // Другая цель и другой приказ — тоже другое дело.
    expect(spySeed(7, 's13', 'probe', 0.5, 0)).not.toBe(base);
    expect(spySeed(7, 's12', 'revolt', 0.5, 0)).not.toBe(base);
  });
});

describe('донесение', () => {
  /** Первое зерно, на котором дело удалось (или провалилось). */
  const seedWhere = (chance: number, want: boolean): number => {
    for (let i = 1; i < 500; i++) if (spyOutcome(chance, i, 'probe').success === want) return i;
    throw new Error('не нашлось');
  };

  it('вилка тем уже, чем увереннее прошло дело', () => {
    const chance = 0.8;
    const spreads: number[] = [];
    for (let i = 1; i < 60; i++) {
      const out = spyOutcome(chance, i, 'probe');
      if (out.success) spreads.push(out.spread);
    }
    expect(spreads.length).toBeGreaterThan(10);
    expect(Math.min(...spreads)).toBeGreaterThanOrEqual(SPY_SPREAD_MIN - 1e-9);
    expect(Math.max(...spreads)).toBeLessThanOrEqual(SPY_SPREAD_MAX + 1e-9);
    // Разброс настоящий: не одно и то же число на всех удачах.
    expect(Math.max(...spreads) - Math.min(...spreads)).toBeGreaterThan(0.1);
  });

  it('провал не приносит ни вилки, ни числа', () => {
    const out = spyOutcome(0.5, seedWhere(0.5, false), 'probe');
    expect(out.success).toBe(false);
    expect(out.spread).toBe(0);
    expect(out.text).toMatch(/ни с чем|ушёл/);
  });

  it('у бунта вилки нет: он либо есть, либо его нет', () => {
    const out = spyOutcome(0.9, 3, 'revolt');
    expect(out.spread).toBe(0);
  });

  it('числа приходят вилкой сразу и расширяются со временем', () => {
    const at = 1_000_000;
    const intel: Intel = {
      at,
      power: 100,
      pop: 40,
      loot: 60,
      kinds: { spear: 50, infantry: 30, archer: 15, cavalry: 5, heavy: 0 },
      spread: 0.2,
    };
    const fresh = readIntel(intel, at + 1000);
    expect(fresh, 'свежее донесение читается').toBeTruthy();
    // Точного числа у донесения нет с самого начала — это не старение.
    expect(fresh?.precision).not.toBe('exact');
    expect(fresh?.hearsay).toBe(true);
    expect(fresh?.power.value).toBeNull();
    expect(fresh?.power.min).toBeLessThan(100);
    expect(fresh?.power.max).toBeGreaterThan(100);
    expect(fresh?.kinds?.spear?.min).toBeLessThan(50);
    expect(fresh?.kinds?.spear?.max).toBeGreaterThan(50);

    const older = readIntel(intel, at + INTEL_EXACT + 1000);
    const old = readIntel(intel, at + INTEL_ROUGH + 1000);
    const width = (r: typeof fresh): number => (r ? r.power.max - r.power.min : 0);
    expect(width(older), 'со временем вилка шире').toBeGreaterThanOrEqual(width(fresh));
    expect(width(old), 'и ещё шире').toBeGreaterThan(width(older));
    // Построения разведка не приносит вовсе: оно у всех одно — правило развёртывания (docs/battle_eu4.md, 14.5).
    expect('formation' in (fresh ?? {})).toBe(false);
  });

  it('снимок своими глазами остаётся точным: вилка — примета донесения, а не всех данных', () => {
    const at = 1_000_000;
    const seen = readIntel({ at, power: 100, pop: 40, loot: 60 }, at + 1000);
    expect(seen?.precision).toBe('exact');
    expect(seen?.hearsay).toBe(false);
    expect(seen?.power.value).toBe(100);
  });
});

describe('бунт', () => {
  const at = 5_000_000;

  it('идёт своё время и кончается сам, без всякого тика', () => {
    const w = revoltWindow(at);
    expect(w.until - w.since).toBe(REVOLT_DURATION);
    expect(revoltActive(w, at)).toBe(true);
    expect(revoltActive(w, at + REVOLT_DURATION - 1)).toBe(true);
    expect(revoltActive(w, at + REVOLT_DURATION)).toBe(false);
    expect(revoltActive(undefined, at)).toBe(false);
  });

  it('останавливает часы поселения ровно на своё окно', () => {
    const w = revoltWindow(at);
    expect(revoltElapsed(w, at)).toBe(0);
    expect(revoltElapsed(w, at + 60_000)).toBe(60_000);
    // После конца бунта время снова идёт: простой не растёт дальше окна.
    expect(revoltElapsed(w, at + REVOLT_DURATION * 3)).toBe(REVOLT_DURATION);
    expect(revoltElapsed(undefined, at)).toBe(0);
  });

  it('гарнизон слабеет на объявленную долю и только пока бунт идёт', () => {
    expect(revoltPower(true)).toBeCloseTo(1 - REVOLT_POWER_LOSS);
    expect(revoltPower(false)).toBe(1);
  });
});
