// Принятый итог, который сервер ещё отдаёт, не вытесняется из списка принятого (docs/bughunt.md, «Больше двухсот
// итогов»). Список держал 200 последних номеров, а сервер отдаёт итоги войн и тайных дел неделю: на двести первом
// вытесненный номер снова «не принят», и итог ложился второй раз — на каждом пульсе.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import type { GameState } from '@/game/types';
import { tribePulse, type PulseTribe } from './bridge';
import { keptSeen, LocalWorld } from './local/LocalWorld';
import type { FigureView, MarchView } from './types';
import { WAR_SEEN_MAX, type SpyView } from '../../netlify/lib/contract';

const START = 1_700_000_000_000;

/** Законченная удачная кража у соседа: десять золота вору. */
function theft(i: number): SpyView {
  return {
    id: `x${i}`,
    role: 'atk',
    deed: 'theft',
    atkCastle: 'c-me',
    atkCity: 'Альфа',
    defCastle: 'c-b',
    defCity: 'Бета',
    from: { x: 0, y: 0 },
    to: { x: 3, y: 0 },
    sentAt: START - 3_600_000,
    arriveAt: START - 1_800_000,
    chance: 1,
    peril: 0,
    phase: 'done',
    endAt: START - 60_000,
    out: { at: START - 1_800_000, ok: true, slipped: false, held: false, dead: false, stolen: { gold: 10 } },
  };
}

describe('итоги, которые сервер ещё отдаёт, принимаются один раз, сколько бы их ни было', () => {
  it('205 краж: последствия приходят на первом пульсе и больше не приходят', async () => {
    const list = Array.from({ length: 205 }, (_, i) => theft(i));
    // Граница области: итогов больше прежнего потолка списка принятого.
    expect(list.length).toBeGreaterThan(200);
    let now = START;
    const s: GameState = createInitialState();
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null, wars: () => [], spies: () => list, warsKnown: () => true });
    const tribe: PulseTribe = { get: () => s, apply: (change) => change(s) };
    let last: { marches: MarchView[]; figures: FigureView[] } = { marches: [], figures: [] };
    const thefts: number[] = [];
    for (let k = 0; k < 3; k++) {
      const p = await tribePulse(world, tribe, last);
      last = { marches: p.marches, figures: p.figures };
      thefts.push(p.effects.filter((e) => e.id.startsWith('spy-') && e.resources?.gold === 10).length);
      now += 60_000;
    }
    expect(thefts).toEqual([205, 0, 0]);
  });
});

describe('keptSeen', () => {
  it('номер, который сервер отдаёт, остаётся; потолок — только на ушедшие из списков', () => {
    const live = Array.from({ length: 300 }, (_, i) => `l${i}`);
    const gone = Array.from({ length: WAR_SEEN_MAX + 50 }, (_, i) => `g${i}`);
    const kept = keptSeen([...gone, ...live], live);
    for (const id of live) expect(kept).toContain(id);
    expect(kept.filter((id) => id.startsWith('g'))).toHaveLength(WAR_SEEN_MAX);
    expect(kept).not.toContain('g0');
  });

  it('списков ещё не знаем — не вытесняется ничего', () => {
    const all = Array.from({ length: WAR_SEEN_MAX + 10 }, (_, i) => `g${i}`);
    expect(keptSeen(all, null)).toEqual(all);
  });
});
