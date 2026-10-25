// Переправа при штурме по прибытии (MAP-10, п. 4 — подозрение аудита, сначала тест). «Дойти и ударить» бьёт в минуту
// прихода (`assaultArrived` → `attackAt`), а место боя берёт штраф переправы по шагу, которым полководец вышел на клетку
// цели (`place.groundAt(…, from)`). Приход сперва ставил `from` на клетку цели, и шаг через русло терялся.
import { describe, expect, it, vi } from 'vitest';
import type { BattleInput } from '@/battle';

const H = vi.hoisted(() => ({ inputs: [] as BattleInput[] }));
vi.mock('@/battle', async (orig) => {
  const real = await orig<typeof import('@/battle')>();
  return {
    ...real,
    simulateBattle: (input: BattleInput) => {
      H.inputs.push(input);
      return real.simulateBattle(input);
    },
  };
});

import { LocalWorld } from './local/LocalWorld';
import type { WorldSave } from './local/state';
import type { GenSettlement } from './gen';
import type { Coord, PlayerProfile } from './types';
import { FEATURE, featuresAt, terrainAt } from './geography';
import { distance } from './geo';
import { FATE_DEFAULT } from './spoils';

const NOW = 1_700_000_000_000;

type Inner = { save: WorldSave; gen: { settlements: GenSettlement[] }; alive(s: GenSettlement, now: number): boolean; inRealm(s: GenSettlement): boolean };

const profile: PlayerProfile = { name: 'Т', pop: 60, defense: 30, units: { scout: 4 }, army: { spearman: 150 }, stock: {}, stash: 0 };

const river = (seed: number, c: Coord): boolean => (featuresAt(seed, c.x, c.y) & FEATURE.river) !== 0;

describe('штурм по прибытии: переправа последнего шага (MAP-10, п. 4)', () => {
  it('полководец вышел на цель через русло — бой со штрафом переправы', async () => {
    let now = NOW;
    // Цель: живой двор в регионе на суше без русла, у которого рядом клетка с руслом; сид — первый, где такой есть.
    let found: { world: LocalWorld; w: Inner; pick: { s: GenSettlement; step: Coord } } | null = null;
    for (let k = 1; k <= 60 && !found; k++) {
      const world = new LocalWorld({ seed: k, now: () => now, storage: null });
      const w = world as unknown as Inner;
      await world.sync(profile);
      const seed = w.save.seed;
      const home = w.save.home;
      for (const s of [...w.gen.settlements].sort((a, b) => distance(home, a) - distance(home, b))) {
        if (!w.alive(s, now) || !w.inRealm(s) || river(seed, s) || terrainAt(seed, s.x, s.y) === 'water') continue;
        const step = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => ({ x: s.x + dx, y: s.y + dy })).find((c) => river(seed, c));
        if (step) {
          found = { world, w, pick: { s, step } };
          break;
        }
      }
    }
    expect(found, 'точка внутри области: у двора есть русло на подходе').not.toBeNull();
    const { world, w, pick } = found!;
    const { s, step } = pick;
    const from = { x: s.x + 3 * (step.x - s.x), y: s.y + 3 * (step.y - s.y) };
    Object.assign(w.save.figures.general, {
      phase: 'moving', from, to: { x: s.x, y: s.y }, departAt: now - 60_000, arriveAt: now, downUntil: 0, busyUntil: 0,
      held: false, watching: false, energy: undefined, spent: undefined, troops: { spearman: 150 }, handover: undefined,
      assault: { id: s.id, fate: FATE_DEFAULT },
    });
    const mark = H.inputs.length;
    now += 1000;
    await world.sync(profile);
    const fought = H.inputs.slice(mark);
    expect(fought.length, 'бой был').toBeGreaterThan(0);
    expect(fought[0].attacker.ground?.crossing).toBe(1);
  }, 60_000);
});
