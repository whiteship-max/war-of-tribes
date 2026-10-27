// ДР-7 на сервере (docs/city_v3.md, «Решения ДР-7»): Статуя Героя — одной дверью с игрой (`game/statuerules`): потолок духа
// книги — с моралью Статуи книги стройки, подъём стабильности сам — с тихим сдвигом лучшей Статуи; вещь на агенте в описи — не
// засчитана и флаг (сквозной путь через обработчик записи — `security.test.ts`, блок «АГ-1»).
//
// Граница области (правило 11): потолок духа меряется вдали от верха шкалы (ступень −3, без обряда), подъём — на промежутке, где
// ровная жизнь одна до второй ступени не доходит, а со Статуей доходит; это утверждается в тесте.
import { describe, expect, it } from 'vitest';
import { spiritCeil } from './spiritbook.js';
import { stabFlags } from './watch.js';
import { agentsStep } from './agentbook.js';
import { readWatch, type WatchCard } from './contract.js';
import { STATUE_MORALE_TOP, STATUE_TOP, statueCalm } from '../../src/game/statuerules.js';
import { SPIRIT_TOP } from '../../src/game/spiritrules.js';
import { STAB_CALM, STAB_DRIFT } from '../../src/game/stabrules.js';
import { DAY_LENGTH } from '../../src/game/constants.js';

const NOW = 1_900_000_000_000;

describe('ДР-7: потолок духа книги — с Статуей книги стройки', () => {
  it('вдали от верха шкалы Статуя на вершине поднимает потолок морали ровно на свою мораль, дисциплину — нет', () => {
    const known = (statue: number) => ({ stab: -3, marshal: 0, knights: 0, barracks: 1, statue });
    const low = spiritCeil(undefined, known(1), NOW, { rite: 0 });
    const top = spiritCeil(undefined, known(STATUE_TOP), NOW, { rite: 0 });
    expect(top.morale, 'область: потолок не упирается в верх').toBeLessThan(SPIRIT_TOP);
    expect(top.morale - low.morale).toBeCloseTo(STATUE_MORALE_TOP, 9);
    expect(top.discipline).toBe(low.discipline);
  });
});

describe('ДР-7: подъём стабильности сам — с Статуей', () => {
  // Промежуток: ровная жизнь одна даёт меньше ступени, со Статуей на вершине — больше. Тогда с −1 и почти полным сдвигом дойти
  // до +1 могла только партия со Статуей.
  const days = 8;
  const card = (level: number): WatchCard =>
    ({ ...readWatch({})!, stab: { level, bought: 0, spent: 0, revolts: 0, held: 0 } }) as WatchCard;

  it('честная партия со Статуей поднялась на две ступени — без флага; без Статуи такой подъём сервер не пропустил бы', () => {
    expect(STAB_CALM * days, 'область: ровная жизнь одна — меньше ступени').toBeLessThan(STAB_DRIFT);
    expect((STAB_CALM + statueCalm(STATUE_TOP)) * days, 'область: со Статуей — больше ступени').toBeGreaterThanOrEqual(STAB_DRIFT);
    const flags = stabFlags(card(-1), card(1), days, days * DAY_LENGTH * 1000);
    expect(flags.filter((f) => /подняться выше/.test(f.text)), 'честный подъём — без флага').toEqual([]);
    // Выше того, что дают ровная жизнь и Статуя, — флаг, как прежде.
    expect(stabFlags(card(-1), card(2), days, days * DAY_LENGTH * 1000).some((f) => /подняться выше/.test(f.text))).toBe(true);
  });
});

describe('ДР-7: вещь на агенте в описи — не засчитана и флаг', () => {
  it('опись читает число вещей на агенте; книга его не берёт и называет', () => {
    const c = readWatch({
      seed: 7,
      agents: { seats: [{ role: 'spy', person: 0, xp: 0, gear: 2 }, { role: 'scout', person: 0, xp: 0, gear: 0 }], hired: 0, fees: 0, paid: 0 },
    })!;
    expect(c.agents?.seats[0].gear, 'вещь прочитана').toBe(2);
    expect('gear' in (c.agents?.seats[1] ?? {}), 'ноль — без поля').toBe(false);
    const { book, found } = agentsStep(undefined, c, NOW, 1);
    expect(found.some((x) => /spy: на агенте вещей 2/.test(x))).toBe(true);
    expect(found.some((x) => /scout/.test(x))).toBe(false);
    expect('gear' in (book.seats.spy ?? {}), 'книга вещи не держит').toBe(false);
  });
});
