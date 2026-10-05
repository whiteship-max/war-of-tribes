// Раскладка дружины держится, пока бойцы живы (docs/retinue.md, решение 9): раненые отряда полководца, вставшие из
// лазарета, возвращаются к нему. Племя считает вставших (`GameState.risen`, тест — `sim/infirmary.test.ts`), мир переводит
// их полководцу по разнице со своей отметкой (`LocalWorld.rejoinRisen`). Область правила — полководец на месте; каждая
// точка сначала утверждает, где он и сколько пришло.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { FigureView, PlayerProfile } from './types';
import type { TroopStack } from '@/game/battle/kinds';
import { createInitialState } from '@/game/state';
import { playerProfile, toOutcome } from './bridge';

const START = 1_700_000_000_000;

const profile = (army: TroopStack, risen?: TroopStack, person = 0): PlayerProfile => ({
  name: 'Тест',
  pop: 120,
  defense: 30,
  units: { warrior: 10, scout: 4 },
  army,
  stock: { food: 500, wood: 80 },
  stash: 0,
  ...(risen ? { risen } : {}),
  ...(person > 0 ? { agents: { general: { person } } } : {}),
});

async function setup() {
  let now = START;
  const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
  const general = async (p: PlayerProfile): Promise<FigureView> =>
    (await world.sync(p)).figures.find((f) => f.id === 'general') as FigureView;
  await general(profile({ spearman: 30 }));
  expect(await world.setGarrison({ spearman: 20 })).toBeNull();
  const g = await general(profile({ spearman: 30 }));
  now = g.readyAt + 1;
  const ready = await general(profile({ spearman: 30 }));
  expect(ready.phase, 'точка внутри области: полководец дома').toBe('home');
  expect(ready.troops).toEqual({ spearman: 20 });
  return { world, general, step: (ms: number) => (now += ms), now: () => now };
}

describe('раненые его отряда возвращаются к полководцу', () => {
  it('дома — сразу и без сбора; в поле — ждут его в гарнизоне; не больше, чем стоит в гарнизоне', async () => {
    const w = await setup();
    // Трое встали: они уже в войске (30 → 33), и счётчик называет их его.
    let g = await w.general(profile({ spearman: 33 }, { spearman: 3 }));
    expect(g.troops, 'дома — сразу').toEqual({ spearman: 23 });
    expect(g.readyAt, 'без сбора').toBe(0);
    // Тот же слепок ещё раз — второй раз не переводит.
    g = await w.general(profile({ spearman: 33 }, { spearman: 3 }));
    expect(g.troops).toEqual({ spearman: 23 });

    // Полководец ушёл в поле — вставшие ждут в гарнизоне.
    expect(await w.world.moveFigure('general', { x: g.at.x + 5, y: g.at.y + 1 })).toBeNull();
    for (let i = 0; i < 200 && g.phase !== 'field'; i++) {
      w.step(5 * 60_000);
      g = await w.general(profile({ spearman: 35 }, { spearman: 5 }));
    }
    expect(g.phase, 'точка внутри области: стоит в поле').toBe('field');
    expect(g.troops, 'в поле не переводит').toEqual({ spearman: 23 });
    // Вернулся — принял.
    expect(await w.world.recallFigure('general')).toBeNull();
    for (let i = 0; i < 200 && g.phase !== 'home'; i++) {
      w.step(5 * 60_000);
      g = await w.general(profile({ spearman: 35 }, { spearman: 5 }));
    }
    expect(g.phase, 'точка внутри области: дома').toBe('home');
    expect(g.troops).toEqual({ spearman: 25 });

    // Встали трое, а в гарнизоне без его отряда стоит один (прочих распустили): берёт одного, остальных засчитывает.
    g = await w.general(profile({ spearman: 26 }, { spearman: 8 }));
    expect(g.troops, 'не больше, чем стоит в гарнизоне').toEqual({ spearman: 26 });
    g = await w.general(profile({ spearman: 30 }, { spearman: 8 }));
    expect(g.troops, 'засчитанных второй раз не берёт').toEqual({ spearman: 26 });
  });

  it('мир без отметки и новый полководец чужих вставших не принимают', async () => {
    let now = START;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const general = async (p: PlayerProfile): Promise<FigureView> =>
      (await world.sync(p)).figures.find((f) => f.id === 'general') as FigureView;
    // Мир собран заново, а партия уже насчитала пятерых: это не его раненые — переводить нечего.
    let g = await general(profile({ spearman: 30 }, { spearman: 5 }));
    expect(g.phase, 'точка внутри области: полководец дома').toBe('home');
    expect(g.troops).toEqual({});
    g = await general(profile({ spearman: 32 }, { spearman: 7 }));
    expect(g.troops, 'а вставших после отметки — принимает').toEqual({ spearman: 2 });

    // Новый человек на месте: раненые прежнего, встав, остаются гарнизону.
    g = await general(profile({ spearman: 32 }, { spearman: 7 }, 1));
    expect(g.troops, 'точка внутри области: новый полководец, с чистыми руками').toEqual({});
    now += 1000;
    g = await general(profile({ spearman: 34 }, { spearman: 9 }, 1));
    expect(g.phase).toBe('home');
    expect(g.troops, 'вставшие после его прихода — его').toEqual({ spearman: 2 });
  });
});

describe('мост раскладки: доля отряда в потерях и счётчик вставших', () => {
  it('последствие везёт долю отряда полководца, слепок — счётчик вставших; нуля в слепке нет', () => {
    const o = toOutcome({
      id: 'e1',
      lost: { warrior: 4 },
      lostTroops: { spearman: 4 },
      standing: { spearman: 3 },
      resources: {},
      prestige: 0,
      morale: 0,
      battle: 'won',
      text: '',
      good: true,
    });
    expect(o.standing).toEqual({ spearman: 3 });
    const s = createInitialState(7);
    // Слепок новой партии тот же, что до раскладки: поля нет (он лежит в сохранении мира).
    expect('risen' in playerProfile(s)).toBe(false);
    s.risen = { spearman: 5 };
    expect(playerProfile(s).risen).toEqual({ spearman: 5 });
  });
});
