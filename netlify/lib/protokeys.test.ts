// SETUP-3 (docs/audit/WORKPLAN.md): ключ из описи — чужая строка, и ключ прототипа («constructor», «toString») таблицей
// не является. Область правила — ключи, которые приходят от клиента в опись: весть державы в книге вестей, постройка
// в очереди и в идущей стройке книги. Каждая точка — ключ, которого в таблице нет, хотя `in` его видит.
import { describe, expect, it } from 'vitest';
import { crownFlags } from './watch.js';
import { queueFaults, readTown, seedTown } from './town.js';
import type { WatchCard } from './contract.js';
import { CROWN_RULES } from '../../src/game/crownrules.js';
import { BUILDING_BY_ID } from '../../src/game/data/buildings.js';

const PROTO = ['constructor', 'toString', 'hasOwnProperty', 'valueOf'];
const T0 = 1_900_000_000_000;

describe('ключи прототипа на границе сервера', () => {
  it('точки внутри области: `in` видит ключ прототипа у обеих таблиц', () => {
    for (const k of PROTO) {
      expect(k in CROWN_RULES, k).toBe(true);
      expect(k in BUILDING_BY_ID, k).toBe(true);
    }
  });

  it('книга вестей: ответ на «constructor» — весть, которой в игре нет, а не падение сверки', () => {
    for (const id of PROTO) {
      const a = { crown: { n: 0, last: [] } } as unknown as WatchCard;
      const b = { crown: { n: 1, last: [{ n: 1, id, opt: 0, at: 1000 }] } } as unknown as WatchCard;
      const flags = crownFlags(a, b, 3_600_000);
      expect(flags.some((f) => /которой в игре нет/.test(f.text)), id).toBe(true);
    }
  });

  it('очередь стройки: «constructor» — такой постройки нет', () => {
    for (const type of PROTO) {
      const faults = queueFaults({ buildings: {}, pop: 30, queue: [{ type, level: 1 }] });
      expect(faults.map((f) => f.why), type).toEqual(['такой постройки нет']);
    }
  });

  it('книга стройки: идущая стройка «toString» не читается', () => {
    for (const type of PROTO) {
      const t = readTown({ ...seedTown(T0), site: { type, level: 1, done: 5 } });
      expect(t?.site ?? null, type).toBeNull();
    }
  });
});
