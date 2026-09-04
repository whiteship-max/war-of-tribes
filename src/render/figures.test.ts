// Потолки показа. Население доходит до сотен, армия — тоже, а фигурок в кадре
// должно оставаться столько, сколько глаз различает. Это потолки показа, а не
// потолки племени: точные числа стоят в строке состояния, в «Племени» и в казармах.
import { describe, expect, it } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { idleCount } from '@/game/derived';
import { MAX_VILLAGERS, shownVillagers } from './villagers';
import { MAX_SOLDIERS, shownSoldiers } from './soldiers';

/** Посёлок, где все руки свободны. */
function idle(pop: number): GameState {
  const s = createInitialState();
  s.pop = pop;
  s.workers = {};
  s.freeJobs = {};
  return s;
}

describe('потолки показа', () => {
  it('у костра рисуется ровно столько фигурок, сколько свободных рук — пока их немного', () => {
    for (const n of [0, 1, 5, MAX_VILLAGERS]) {
      const s = idle(n);
      expect(idleCount(s)).toBe(n);
      expect(shownVillagers(s)).toBe(n);
    }
  });

  it('толпа целиком не рисуется: сотни свободных рук дают тот же десяток фигурок', () => {
    for (const n of [50, 200, 755]) {
      const s = idle(n);
      expect(idleCount(s)).toBe(n);
      expect(shownVillagers(s)).toBe(MAX_VILLAGERS);
    }
  });

  it('назначенные на работу со сцены исчезают: показываются только свободные', () => {
    const s = idle(400);
    const mill = s.buildings.find((b) => b.type === 'sawmill')!;
    s.workers[mill.id] = 12;
    expect(shownVillagers(s)).toBe(MAX_VILLAGERS);
    // Ровно у черты потолок ещё не действует, и число честное.
    const small = idle(MAX_VILLAGERS + 4);
    small.workers[mill.id] = 4;
    expect(shownVillagers(small)).toBe(MAX_VILLAGERS);
    small.workers[mill.id] = 6;
    expect(shownVillagers(small)).toBe(MAX_VILLAGERS - 2);
  });

  it('дружина в сотни бойцов тоже упирается в свой потолок', () => {
    expect(shownSoldiers({})).toBe(0);
    expect(shownSoldiers({ spearman: 3 })).toBe(3);
    expect(shownSoldiers({ spearman: 200, rider: 80, archer: 120 })).toBe(MAX_SOLDIERS);
  });
});
