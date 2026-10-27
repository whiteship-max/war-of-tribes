// Отряд полководца в городе — гарнизон (ДР-6, docs/siege_v2.md, «Решения ДР-6»; прежде — раскладка, docs/retinue.md):
// вернувшись домой, отряд встаёт гарнизоном без потерь (`LocalWorld.homecoming`), а раненые его отряда, вставшие из
// лазарета, к нему больше не переходят — встают гарнизоном (прежнее `rejoinRisen`, решение 9 docs/retinue.md, снято). Племя
// по-прежнему считает вставших (`GameState.risen`, тест — `sim/infirmary.test.ts`) — мост раскладки ниже. Область правила —
// полководец на месте; каждая точка сначала утверждает, где он и сколько пришло.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { FigureView, PlayerProfile } from './types';
import { troopTotal, type TroopStack } from '@/game/battle/kinds';
import { createInitialState } from '@/game/state';
import { playerProfile, toOutcome } from './bridge';

const START = 1_700_000_000_000;

const profile = (army: TroopStack, _risen?: TroopStack): PlayerProfile => ({
  name: 'Тест',
  pop: 120,
  defense: 30,
  units: { warrior: 10, scout: 4 },
  army,
  stock: { food: 500, wood: 80 },
  stash: 0,
});

describe('отряд полководца в городе — гарнизон, вставшие раненые — тоже', () => {
  it('вставшие к полководцу не переходят; отряд уходит с ним в поле и, вернувшись, встаёт гарнизоном', async () => {
    let now = START;
    const world = new LocalWorld({ seed: 7, now: () => now, storage: null });
    const general = async (p: PlayerProfile): Promise<FigureView> =>
      (await world.sync(p)).figures.find((f) => f.id === 'general') as FigureView;
    await general(profile({ spearman: 30 }));
    // Отряд дома — приказом раскладки старого клиента (принимается, как раньше).
    expect(await world.setGarrison({ spearman: 20 })).toBeNull();
    let g = await general(profile({ spearman: 30 }));
    expect(g.phase, 'точка внутри области: полководец дома').toBe('home');
    expect(g.troops, 'точка внутри области: отряд при нём').toEqual({ spearman: 20 });
    // Трое встали: они уже в войске (30 → 33), к полководцу не переходят.
    g = await general(profile({ spearman: 33 }, { spearman: 3 }));
    expect(g.troops, 'вставшие — гарнизону').toEqual({ spearman: 20 });

    // Ушёл в поле — отряд с ним; вставшие ждать его не будут.
    expect(await world.moveFigure('general', { x: g.at.x + 5, y: g.at.y + 1 })).toBeNull();
    for (let i = 0; i < 200 && g.phase !== 'field'; i++) {
      now += 5 * 60_000;
      g = await general(profile({ spearman: 35 }, { spearman: 5 }));
    }
    expect(g.phase, 'точка внутри области: стоит в поле').toBe('field');
    expect(g.troops, 'в поле отряд при нём, вставшие не прибавились').toEqual({ spearman: 20 });
    // Вернулся — отряд встал гарнизоном, всё войско на месте.
    expect(await world.recallFigure('general')).toBeNull();
    for (let i = 0; i < 200 && g.phase !== 'home'; i++) {
      now += 5 * 60_000;
      g = await general(profile({ spearman: 35 }, { spearman: 5 }));
    }
    expect(g.phase, 'точка внутри области: дома').toBe('home');
    expect(troopTotal(g.troops), 'дома отряда нет — он гарнизон').toBe(0);
    const p = await world.sync(profile({ spearman: 35 }, { spearman: 5 }));
    expect(p.figures.find((f) => f.id === 'general')?.troops ?? {}, 'и на следующем пульсе').toEqual({});
  });
});

describe('мост раскладки: доли отряда и счётчика вставших племя не везёт', () => {
  it('последствие без доли отряда полководца, слепок без счётчика вставших (ДР-6: его раненые — гарнизон)', () => {
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
    expect('standing' in o, 'доля отряда племени не нужна').toBe(false);
    const s = createInitialState(7);
    // Счётчик из старого сохранения слепок не везёт: мир его не читает.
    s.risen = { spearman: 5 };
    expect('risen' in playerProfile(s)).toBe(false);
  });
});
