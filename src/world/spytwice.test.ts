// Кража лазутчика ложится на склад один раз (MAP-4, docs/audit/WORKPLAN.md: «не доказано — сначала проверить тестом»).
// `spyDeed` кладёт итог последствием (племя применяет его `applyExpedition`) и тут же правит слепок деревни мира
// (`save.profile`), чтобы мир видел пришедшее до того, как племя его примет. Подозрение аудита: итог применяется дважды.
// Тест гонит настоящий цикл пульса (`tribePulse`: слепок из партии → мир → последствия в партию) и считает склад партии.
// Не подтвердилось: слепок мира каждый пульс берётся заново из партии (`sync`), правка слепка — только предпросмотр до
// приёма, склад партии меняет одно последствие. Тест остаётся замком.
import { describe, expect, it } from 'vitest';
import { createInitialState } from '@/game/state';
import type { GameState } from '@/game/types';
import { storageCap } from '@/game/derived';
import { tribePulse, type PulseTribe } from './bridge';
import { LocalWorld } from './local/LocalWorld';
import type { FigureView, MarchView } from './types';
import type { SpyView } from '../../netlify/lib/contract';

const START = 1_700_000_000_000;

function deed(role: 'atk' | 'def'): SpyView {
  return {
    id: `t-${role}`,
    role,
    deed: 'theft',
    atkCastle: role === 'atk' ? 'c-me' : 'c-b',
    atkCity: role === 'atk' ? 'Альфа' : 'Бета',
    defCastle: role === 'atk' ? 'c-b' : 'c-me',
    defCity: role === 'atk' ? 'Бета' : 'Альфа',
    from: { x: 0, y: 0 },
    to: { x: 3, y: 0 },
    sentAt: START - 3_600_000,
    arriveAt: START - 1_800_000,
    chance: 1,
    peril: 0,
    phase: 'done',
    endAt: START - 60_000,
    out: { at: START - 1_800_000, ok: true, slipped: false, held: false, dead: false, stolen: { wood: 20, gold: 10 } },
  };
}

async function run(role: 'atk' | 'def') {
  let now = START;
  const s: GameState = createInitialState();
  s.resources.wood = 100;
  s.gold = 100;
  const world = new LocalWorld({ seed: 7, now: () => now, storage: null, wars: () => [], spies: () => [deed(role)], warsKnown: () => true });
  const tribe: PulseTribe = { get: () => s, apply: (change) => change(s) };
  let last: { marches: MarchView[]; figures: FigureView[] } = { marches: [], figures: [] };
  const seen: Array<{ wood: number; gold: number; worldWood: number | undefined }> = [];
  for (let k = 0; k < 3; k++) {
    const p = await tribePulse(world, tribe, last);
    last = { marches: p.marches, figures: p.figures };
    const profile = (world as unknown as { save: { profile: { stock?: { wood?: number } } } }).save.profile;
    seen.push({ wood: s.resources.wood, gold: s.gold, worldWood: profile.stock?.wood });
    now += 60_000;
  }
  return { s, seen };
}

describe('кража лазутчика — один раз (MAP-4)', () => {
  it('нападающий: двадцать дерева и десять золота пришли один раз; слепок мира — склад партии', async () => {
    const { s, seen } = await run('atk');
    expect(120, 'точка внутри области: украденное помещается на склад').toBeLessThanOrEqual(storageCap(s));
    expect(seen.map((x) => [x.wood, x.gold])).toEqual([[120, 110], [120, 110], [120, 110]]);
    // Следующий пульс берёт слепок из партии: правка слепка в мире не копится поверх применённого.
    expect(seen[2].worldWood).toBe(120);
  });

  it('защитник: унесённое ушло со склада один раз', async () => {
    const { seen } = await run('def');
    expect(seen.map((x) => [x.wood, x.gold])).toEqual([[80, 90], [80, 90], [80, 90]]);
    expect(seen[2].worldWood).toBe(80);
  });
});
