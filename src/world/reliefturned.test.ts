// Удар из поля, не пробившийся через рогатки (docs/siege_v2.md, 19.2): сервер войны кладёт его записью войны (`WarTurned`),
// а мир на клиенте — донесением у того, чья дружина, ровно один раз: у союзника — его выручка, у города — удар его
// полководца. Чужая выручка у союзника не ложится. Прежде такой удар пропадал молча.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import type { GameState } from '@/game/types';
import { tribePulse, type PulseTribe } from './bridge';
import { LocalWorld } from './local/LocalWorld';
import type { FigureView, MarchView } from './types';
import { warTurnedId, type WarTurned, type WarView } from '../../netlify/lib/contract';

const START = 1_700_000_000_000;

/** Война глазами `role`: лагерь «Альфа» под «Бетой», снят; бой — ни одного. */
function view(id: string, role: WarView['role'], turned: WarTurned[]): WarView {
  return {
    id,
    role,
    ...(role === 'ally' ? { me: 'c-me' } : {}),
    atkCastle: 'c-a',
    defCastle: 'c-b',
    atkCity: 'Альфа',
    defCity: 'Бета',
    from: { x: 0, y: 0 },
    to: { x: 3, y: 0 },
    mode: 'siege',
    fate: 'plunder',
    sentAt: START - 7_200_000,
    arriveAt: START - 3_600_000,
    phase: 'back',
    army: { troops: { spearman: 40 }, resolve: 0, pips: {} },
    battles: [],
    turned,
  };
}

describe('удар, не пробившийся через рогатки, — донесение тому, чья дружина, один раз', () => {
  it('союзнику — его выручка, городу — удар его полководца; чужая выручка у союзника не ложится', async () => {
    const at = START - 600_000;
    const list: WarView[] = [
      view('w1', 'ally', [
        { at, waitMs: 120_000, men: 90, ally: 'c-me', city: 'Гамма' },
        { at: at + 1, waitMs: 60_000, men: 30, ally: 'c-other', city: 'Дельта' },
      ]),
      view('w2', 'def', [{ at, waitMs: 240_000, men: 50 }]),
    ];
    let now = START;
    const s: GameState = createInitialState();
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null, wars: () => list, spies: () => [], warsKnown: () => true });
    const tribe: PulseTribe = { get: () => s, apply: (change) => change(s) };
    let last: { marches: MarchView[]; figures: FigureView[] } = { marches: [], figures: [] };
    for (let k = 0; k < 3; k++) {
      const p = await tribePulse(world, tribe, last);
      last = { marches: p.marches, figures: p.figures };
      now += 60_000;
    }
    const reports = (await world.reports()).filter((r) => r.title.includes('не пробил'));
    expect(reports.map((r) => r.id).sort()).toEqual([`war-${warTurnedId('w1', at)}`, `war-${warTurnedId('w2', at)}`]);
    const relief = reports.find((r) => r.id === `war-${warTurnedId('w1', at)}`);
    expect(relief?.title).toBe('Выручка не пробилась: Бета');
    expect(relief?.sent).toEqual({ warrior: 90 });
    expect(relief?.lost).toEqual({});
    expect(relief?.battle).toBeNull();
    expect(relief?.text).toContain('проход занят ещё 2 мин.');
    const strike = reports.find((r) => r.id === `war-${warTurnedId('w2', at)}`);
    expect(strike?.title).toBe('Удар не пробился: лагерь Альфа');
    expect(strike?.text).toContain('проход занят ещё 4 мин.');
  });
});
