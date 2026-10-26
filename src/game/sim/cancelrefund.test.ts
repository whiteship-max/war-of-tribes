// AC-6: возврат при отмене стройки — один у игры и у сервера (`labour.cancelRefund`: доля цены каждой части двора вниз). Игра
// округляла вниз сумму частей — у двора с двумя делами возврат выходил больше, чем положено серверу, и честная отмена давала
// флаг. Область (правило 11): все постройки с уровнями, каждый уровень до потолка, начатая и нетронутая стройка; склад пуст и
// вместителен — срез вместимостью не мешает сравнению.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../state';
import { MAX_BUILDING_LEVEL, RESOURCE_IDS } from '../constants';
import { BUILDING_BY_ID } from '../data/buildings';
import { buildingOfType, maxLevelFor, storageCap } from '../derived';
import { cancelRefund } from '../labour';
import { cancelUpgrade } from './actions';

describe('AC-6: возврат при отмене стройки — тот же, что выводит сервер', () => {
  it('каждая постройка, каждый уровень, начатая и нетронутая стройка (архив prove-15-1)', () => {
    let checked = 0;
    let parted = 0;
    for (const def of Object.values(BUILDING_BY_ID)) {
      const top = maxLevelFor(def.id);
      for (let level = 1; level < Math.min(top, MAX_BUILDING_LEVEL); level++) {
        for (const started of [true, false]) {
          const s = createInitialState(3);
          buildingOfType(s, 'storage')!.level = maxLevelFor('storage');
          const b = buildingOfType(s, def.id);
          if (!b) continue;
          for (const r of RESOURCE_IDS) s.resources[r] = 0;
          expect(storageCap(s)).toBeGreaterThan(0);
          b.level = level;
          b.workRequired = 100;
          b.work = started ? 5 : 0;
          expect(cancelUpgrade(s, b.id)).toBeNull();
          const want = cancelRefund(def, level + 1, started);
          for (const r of RESOURCE_IDS) expect(Math.round(s.resources[r]), `${def.id} → ${level + 1}${started ? ', начатая' : ''}: ${r}`).toBe(want[r] ?? 0);
          checked++;
          if ((def.parts?.length ?? 1) > 1) parted++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
    // Точки внутри области: дворы с двумя делами — там, где округление расходилось.
    expect(parted).toBeGreaterThan(0);
  });
});
