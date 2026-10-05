// Энергия словами — сроки называются числами двери (`world/energy.energyView`), а не своей арифметикой (правило 18).
import { describe, expect, it } from 'vitest';
import { energyView } from '@/world/energy';
import { ENERGY_DRAIN, ENERGY_FILL } from '@/world/data/energy';
import { energyCount, energyLine } from './energyWords';
import { realLeft } from './wait';

const T0 = 5_000_000;

describe('энергия словами', () => {
  it('в поле — когда кончится; дома — когда полная; выбившийся — идёт домой', () => {
    const now = T0 + 1000;
    const field = energyView({ value: 40, at: T0, mode: 'drain' }, now);
    expect(field.emptyBy).toBe(T0 + 0.4 * ENERGY_DRAIN);
    expect(energyLine(field, false, now)).toBe(`На карте уходит: кончится через ${realLeft((field.emptyBy! - now) / 1000)}, тогда пойдёт домой сам.`);
    const home = energyView({ value: 40, at: T0, mode: 'fill' }, now);
    expect(energyLine(home, false, now)).toBe(`Дома копится: полная через ${realLeft((home.fullBy! - now) / 1000)}.`);
    expect(home.fullBy).toBeCloseTo(T0 + 0.6 * ENERGY_FILL, 6);
    expect(energyCount(home)).toBe('40 из 100');
    expect(energyLine(energyView({ value: 0, at: T0, mode: 'drain' }, now), true, now)).toMatch(/^Выбился из сил/);
    expect(energyLine(energyView({ value: 90, at: T0, mode: 'hold' }, now), false, now)).toBe('Не тратится, пока стоит лагерь или идёт война.');
  });
});
