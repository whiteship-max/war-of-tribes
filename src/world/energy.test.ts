// Дверь энергии агентов (docs/agent_energy.md): чистая функция от отметки и времени. Тесты — там, где её можно
// сломать: сроки слова владельца, смена режима внутри отметки, граница отказа и подделанная отметка с сервера.
import { describe, expect, it } from 'vitest';
import { gameDaysOfMs } from '@/game/pace';
import { ENERGY_DRAIN, ENERGY_FILL, ENERGY_MAX, ENERGY_PRICE } from './data/energy';
import { emptyAt, energyAt, energyBlock, energyShown, freshMark, fullAt, idleBlock, remark, roadCost, spend, type EnergyMark } from './energy';
import { readEnergy as readMark } from '../../netlify/lib/contract';

const T0 = 1_000_000;

describe('энергия агента: сроки владельца', () => {
  it('на карте полный запас уходит за пять игровых дней, дома копится за два', () => {
    expect(gameDaysOfMs(ENERGY_DRAIN)).toBeCloseTo(5, 9);
    expect(gameDaysOfMs(ENERGY_FILL)).toBeCloseTo(2, 9);
    const out: EnergyMark = { value: ENERGY_MAX, at: T0, mode: 'drain' };
    expect(energyAt(out, T0 + ENERGY_DRAIN / 2)).toBeCloseTo(50, 9);
    expect(energyAt(out, T0 + ENERGY_DRAIN)).toBe(0);
    expect(energyAt(out, T0 + 3 * ENERGY_DRAIN)).toBe(0);
    const home: EnergyMark = { value: 0, at: T0, mode: 'fill' };
    expect(energyAt(home, T0 + ENERGY_FILL / 4)).toBeCloseTo(25, 9);
    expect(energyAt(home, T0 + ENERGY_FILL)).toBe(ENERGY_MAX);
    expect(energyAt(home, T0 + 9 * ENERGY_FILL)).toBe(ENERGY_MAX);
  });

  it('стоит — не меняется; нет отметки — полный запас; раньше отметки — её значение', () => {
    expect(energyAt({ value: 37, at: T0, mode: 'hold' }, T0 + 10 * ENERGY_DRAIN)).toBe(37);
    expect(energyAt(undefined, T0)).toBe(ENERGY_MAX);
    expect(energyAt({ value: 37, at: T0, mode: 'drain' }, T0 - 5000)).toBe(37);
  });
});

describe('энергия агента: приход домой внутри отметки', () => {
  it('путь домой уходит до прихода и копится после', () => {
    const back: EnergyMark = { value: 60, at: T0, mode: 'drain', homeAt: T0 + ENERGY_DRAIN / 5 };
    // До прихода: −20 за пятую часть срока.
    expect(energyAt(back, T0 + ENERGY_DRAIN / 5)).toBeCloseTo(40, 9);
    // После прихода копится: +50 за половину срока дома.
    expect(energyAt(back, T0 + ENERGY_DRAIN / 5 + ENERGY_FILL / 2)).toBeCloseTo(90, 9);
    // Дошёл раньше, чем кончилась: не кончится на карте.
    expect(emptyAt(back)).toBeNull();
  });

  it('кончится раньше прихода — минута, когда станет нулём', () => {
    const far: EnergyMark = { value: 10, at: T0, mode: 'drain', homeAt: T0 + ENERGY_DRAIN };
    expect(emptyAt(far)).toBeCloseTo(T0 + ENERGY_DRAIN / 10, 6);
    expect(emptyAt({ value: 0, at: T0, mode: 'drain' })).toBe(T0);
    expect(emptyAt({ value: 50, at: T0, mode: 'hold' })).toBeNull();
  });

  it('вне строя стоит до возврата и копится после', () => {
    const down: EnergyMark = { value: 30, at: T0, mode: 'hold', homeAt: T0 + 7_000_000 };
    expect(energyAt(down, T0 + 7_000_000)).toBe(30);
    expect(energyAt(down, T0 + 7_000_000 + ENERGY_FILL / 10)).toBeCloseTo(40, 9);
    expect(fullAt(down, T0)).toBeCloseTo(T0 + 7_000_000 + 0.7 * ENERGY_FILL, 6);
    expect(fullAt({ value: 30, at: T0, mode: 'hold' }, T0)).toBeNull();
  });

  it('новая отметка продолжает прежнюю без скачка', () => {
    const was: EnergyMark = { value: 80, at: T0, mode: 'fill' };
    const t = T0 + ENERGY_FILL / 20;
    const now = remark(was, t, 'drain');
    expect(now.value).toBeCloseTo(energyAt(was, t), 9);
    expect(energyAt(now, t + ENERGY_DRAIN / 10)).toBeCloseTo(energyAt(was, t) - 10, 9);
  });
});

describe('энергия агента: цена и отказ', () => {
  it('граница — ровно цена: хватает при равенстве, не хватает на крохе меньше', () => {
    expect(energyBlock(20, 20)).toBeNull();
    expect(energyBlock(19.99, 20)).toBe('Не хватает энергии: 19 из 20.');
    // Дорога до места дела съедает свою долю до цены.
    expect(energyBlock(50, 20, ENERGY_DRAIN * 0.3)).toBeNull();
    expect(energyBlock(50, 20, ENERGY_DRAIN * 0.31)).toBe('Не хватит энергии: на месте будет 19, нужно 20.');
    expect(roadCost(ENERGY_DRAIN)).toBe(ENERGY_MAX);
  });

  it('цена списывается не ниже нуля и режим не меняет', () => {
    const m = spend({ value: 15, at: T0, mode: 'hold' }, T0 + 1000, 20);
    expect(m).toEqual({ value: 0, at: T0 + 1000, mode: 'hold' });
    expect(spend(undefined, T0, 10).value).toBe(ENERGY_MAX - 10);
  });

  it('без энергии из ворот не выходят; цены — положительные и не больше запаса', () => {
    expect(idleBlock(0.4)).not.toBeNull();
    expect(idleBlock(1)).toBeNull();
    for (const [id, p] of Object.entries(ENERGY_PRICE)) {
      expect(p.price, id).toBeGreaterThan(0);
      expect(p.price, id).toBeLessThanOrEqual(ENERGY_MAX);
      expect(p.why.length, id).toBeGreaterThan(10);
    }
    // Слово владельца: осадный лагерь — десять.
    expect(ENERGY_PRICE.siege.price).toBe(10);
    expect(energyShown(freshMark(T0), T0)).toBe(ENERGY_MAX);
  });
});

describe('энергия агента: отметка из приказа войны (`contract.readEnergy`)', () => {
  it('подделанное значение не поднимает запас выше полного; мусор — нет отметки', () => {
    expect(readMark({ value: 1e9, at: T0, mode: 'hold' })).toEqual({ value: ENERGY_MAX, at: T0, mode: 'hold' });
    expect(readMark({ value: -5, at: T0, mode: 'drain', homeAt: T0 + 1 })).toEqual({ value: 0, at: T0, mode: 'drain', homeAt: T0 + 1 });
    expect(readMark({ value: 50, at: T0, mode: 'fly' })).toBeUndefined();
    expect(readMark({ value: 'x', at: T0, mode: 'fill' })).toBeUndefined();
    expect(readMark(null)).toBeUndefined();
  });
});
