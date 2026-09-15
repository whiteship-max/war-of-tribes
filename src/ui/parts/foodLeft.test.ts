// Строка склада «еды хватит на N дней при нынешнем пайке» — замером настоящим шагом
// симуляции, а не сравнением с константой.
//
// Область правила: еда убывает, и за время замера не меняется ничто, что меняет расход, —
// ни сезон, ни число ртов, ни паёк. Прирост выключен тем, что крыши заняты (жильё —
// множитель прироста), убыль — тем, что мораль выше порога ухода; каждая точка
// утверждает это о себе в конце прогона, а не надеется. Внутри области строка обязана
// совпасть с тем, когда шаг действительно опустошит амбар, — и с добычей, и без неё:
// на добыче и ломается подмена баланса дня голым расходом.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { DAY_LENGTH, MORALE_GROWTH_ZERO } from '@/game/constants';
import { armySize, foodConsumptionPerDay, housingCapacity, moraleTarget, productionPerDay, seasonOf } from '@/game/derived';
import { tick } from '@/game/sim/tick';
import { RATIONS } from '@/game/data/policy';
import type { GameState } from '@/game/types';
import { foodLeft } from './foodLeft';

const DT = 0.25;

/** Посёлок, где расход за замер не меняется: крыши заняты, мораль на своей цели. */
function settled(ration: GameState['ration'], hands: 'none' | 'some'): GameState {
  const s = createInitialState(12345);
  s.ration = ration;
  s.pop = housingCapacity(s);
  s.morale = 80;
  s.resources.food = 500;
  if (hands === 'none') {
    s.workers = {};
    s.bondedWork = {};
    s.freeJobs = {} as GameState['freeJobs'];
  }
  tick(s, DT, { offline: true }); // привести назначения к новому числу людей
  s.resources.food = 30;
  s.starvation = 0;
  // Стартовая добыча кормит всех: снимаем со дворов по человеку, пока амбар не начнёт
  // заметно убывать, — добыча при этом остаётся, и точка выходит и про добычу, и про срок.
  // Замер короткий — меньше дня, — а мораль стоит на своей цели: иначе за замер она
  // сдвинула бы добычу, и шаг разошёлся бы со строкой не по вине строки. Цель морали
  // сама зависит от запаса, поэтому подгонка идёт в несколько проходов.
  const ids = Object.keys(s.workers).map(Number);
  const drain = (): number => foodConsumptionPerDay(s) - productionPerDay(s).food;
  for (let pass = 0; pass < 4; pass++) {
    s.morale = moraleTarget(s);
    for (let k = 0; hands === 'some' && drain() < 0.25 * foodConsumptionPerDay(s) && k < 400; k++) {
      const id = ids[k % ids.length];
      if (s.workers[id] > 0) s.workers[id] -= 1;
    }
    s.resources.food = Math.max(1, 0.6 * drain());
  }
  s.morale = moraleTarget(s);
  return s;
}

/** Шагами симуляции до пустого амбара: сколько дней на деле. */
function daysToEmpty(s: GameState, limitDays: number): number {
  const t0 = s.time;
  while (s.resources.food > 0 && s.starvation === 0) {
    tick(s, DT, { offline: true });
    if (s.time - t0 > limitDays * DAY_LENGTH) break;
  }
  return (s.time - t0) / DAY_LENGTH;
}

describe('строка склада о запасе еды совпадает с шагом симуляции', () => {
  it('на каждом пайке, с добычей и без: амбар пустеет тогда, когда обещано', () => {
    let withYield = 0;
    for (const r of RATIONS) {
      for (const hands of ['none', 'some'] as const) {
        const s = settled(r.id, hands);
        const prod = productionPerDay(s).food;
        const tag = `паёк «${r.name}», ${hands === 'none' ? 'без добычи' : `добыча ${prod.toFixed(1)}/д`}`;
        const left = foodLeft(s);
        // Точка внутри области: амбар убывает, а у точки «с добычей» добыча есть.
        expect(left.days, `${tag}: амбар убывает`).not.toBeNull();
        if (left.days === null) continue;
        if (hands === 'some') expect(prod, `${tag}: добыча осталась`).toBeGreaterThan(0);
        expect(left.days, `${tag}: срок до пустого амбара`).toBeGreaterThan(0.2);

        const before = { season: seasonOf(s.time), pop: s.pop, army: armySize(s), ration: s.ration };
        const real = daysToEmpty(s, left.days * 3 + 1);
        // За прогон не сменились ни сезон, ни рты, ни паёк, и уйти никто не собрался.
        expect({ season: seasonOf(s.time), pop: s.pop, army: armySize(s), ration: s.ration }, `${tag}: расход менялся на замере`).toEqual(before);
        expect(s.morale, `${tag}: мораль ушла под порог ухода`).toBeGreaterThan(MORALE_GROWTH_ZERO);
        // Шаг отстаёт от строки не больше чем на шаг и на то, что мораль чуть сдвинула добычу.
        expect(Math.abs(real - left.days) / left.days, `${tag}: строка ${left.days.toFixed(3)} дн., шаг ${real.toFixed(3)} дн.`).toBeLessThan(0.02);
        if (prod > 0) withYield++;
      }
    }
    expect(withYield, 'точки с добычей: без них голый расход прошёл бы зелёным').toBe(RATIONS.length);
  });

  it('«не убывает» — значит шаг и правда не убавляет амбар', () => {
    const s = createInitialState(12345);
    s.resources.food = 50;
    tick(s, DT, { offline: true });
    const left = foodLeft(s);
    // Точка внутри области «не убывает»: стартовый посёлок кормит себя сам.
    expect(left.days, 'стартовый посёлок добывает не меньше, чем ест').toBeNull();
    const before = s.resources.food;
    for (let i = 0; i < 0.3 * (DAY_LENGTH / DT); i++) tick(s, DT, { offline: true });
    expect(s.resources.food, 'за треть дня амбар не опустел').toBeGreaterThanOrEqual(before);
  });
});
