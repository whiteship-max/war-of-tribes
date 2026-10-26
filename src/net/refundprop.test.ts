// Тест-свойство этапа 8 аудита: возврат при отмене стройки совпадает у клиента и сервера. Клиент кладёт возврат на склад
// (`sim/actions.cancelUpgrade`), сервер выводит положенное сам из очередей двух описей (`watch.cancelledRefund`) — и то и
// другое одной формулой `labour.cancelRefund`, но разными путями: какая стройка начата, какая в очереди, сколько отменено.
// Область (правило 11): склад пуст и вместителен — срез вместимостью не мешает сравнению; в каждом наборе хоть одна отмена;
// среди наборов есть начатые стройки (работа дробью тоже), отмены не с головы очереди и дворы с двумя делами.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import { BUILD_QUEUE_MAX, RESOURCE_IDS } from '@/game/constants';
import { buildQueue, buildingOfType, maxLevelFor, storageCap, upgradeInfo } from '@/game/derived';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { cancelUpgrade, startUpgrade } from '@/game/sim/actions';
import { cancelledRefund } from '../../netlify/lib/watch';
import { watchOf } from './snapshot';

/** Сеяная кость теста (в `src` случайности устройства нет — правило проекта). */
function dice(seed: number): (n: number) => number {
  let x = seed >>> 0 || 1;
  return (n) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % n;
  };
}

describe('свойство: возврат отмены у клиента и сервера один', () => {
  it('двести наборов: очередь из случайных построек, начатая или нет, отмена любых мест — склад вырос ровно на положенное сервером', () => {
    let started = 0;
    let deep = 0;
    let parted = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const roll = dice(seed * 7919);
      const s = createInitialState(seed);
      buildingOfType(s, 'storage')!.level = maxLevelFor('storage');
      const cap = storageCap(s);
      for (const r of RESOURCE_IDS) s.resources[r] = cap;
      s.gold = 1_000_000;
      const want = 1 + roll(BUILD_QUEUE_MAX);
      for (let i = 0; i < 40 && buildQueue(s).length < want; i++) {
        const open = s.buildings.filter((b) => b.level < maxLevelFor(b.type) && !upgradeInfo(s, b).blocked && !buildQueue(s).includes(b));
        if (!open.length) break;
        startUpgrade(s, open[roll(open.length)].id);
      }
      const queue = buildQueue(s);
      expect(queue.length, `сид ${seed}: точка внутри области — очередь есть`).toBeGreaterThan(0);
      const head = queue[0];
      const begun = roll(3);
      if (begun > 0) head.work = begun === 1 ? 0.3 : Math.min(head.workRequired - 1, 1 + roll(50));
      for (const r of RESOURCE_IDS) s.resources[r] = 0;
      const a = watchOf(s);
      const gone = queue.filter((_, i) => i === 0 ? roll(2) === 0 : roll(2) === 0);
      if (!gone.length) gone.push(queue[roll(queue.length)]);
      for (const b of gone) {
        if (b === head && head.work > 0) started++;
        expect(cancelUpgrade(s, b.id), `сид ${seed}: отмена ${b.type}`).toBeNull();
        if (b !== head) deep++;
        if ((BUILDING_BY_ID[b.type].parts?.length ?? 1) > 1) parted++;
      }
      const b = watchOf(s);
      const server = cancelledRefund(a, b);
      expect(server.count, `сид ${seed}: сервер видит все отмены`).toBe(gone.length);
      for (const r of RESOURCE_IDS) {
        expect(b.stock[r] ?? 0, `сид ${seed}, ${r}: склад не упёрся во вместимость`).toBeLessThan(cap);
        expect((b.stock[r] ?? 0) - (a.stock[r] ?? 0), `сид ${seed}, ${r}`).toBe(server.refund[r] ?? 0);
      }
    }
    expect(started, 'точки внутри области: начатые стройки отменялись').toBeGreaterThan(10);
    expect(deep, 'точки внутри области: отмены не с головы очереди').toBeGreaterThan(10);
    expect(parted, 'точки внутри области: дворы с двумя делами').toBeGreaterThan(0);
  });
});
