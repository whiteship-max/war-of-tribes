// Потолок записи войн (BTL-8, п. 1; архив round1/server-battle-net/prove-1-1): идущих войн не меньше потолка — закончившиеся
// уходят все. Прежде места под них считались `slice(-0)` — это весь список, — и запись росла сверх `WAR_MAX`.
import { describe, expect, it } from 'vitest';
import { WAR_MAX, emptyWars, pruneWars, type WarFile, type WarRow } from './war.js';

const NOW = 1_900_000_000_000;
const row = (id: string, over: Partial<WarRow>): WarRow => ({ id, phase: 'march', sentAt: NOW, atk: 'x', def: 'y', battles: [], ...over }) as WarRow;

describe('потолок записи войн', () => {
  it('идущих войн ровно потолок — закончившиеся уходят все (prove-1-1)', () => {
    const file = emptyWars() as WarFile;
    for (let i = 0; i < WAR_MAX; i++) file.wars.push(row(`a${i}`, {}));
    for (let i = 0; i < 50; i++) file.wars.push(row(`d${i}`, { phase: 'done', sentAt: NOW - 1000, endAt: NOW - 1000 }));
    pruneWars(file, NOW);
    expect(file.wars).toHaveLength(WAR_MAX);
    expect(file.wars.every((w) => w.phase !== 'done')).toBe(true);
  });

  it('место есть — закончившиеся остаются последними, до потолка', () => {
    const file = emptyWars() as WarFile;
    for (let i = 0; i < WAR_MAX - 10; i++) file.wars.push(row(`a${i}`, {}));
    for (let i = 0; i < 50; i++) file.wars.push(row(`d${i}`, { phase: 'done', sentAt: NOW - 1000, endAt: NOW - 1000 }));
    pruneWars(file, NOW);
    expect(file.wars).toHaveLength(WAR_MAX);
    expect(file.wars.filter((w) => w.phase === 'done').map((w) => w.id)).toEqual(Array.from({ length: 10 }, (_, i) => `d${40 + i}`));
  });
});
