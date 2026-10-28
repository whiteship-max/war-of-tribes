// Командиры флангов в бою у своих стен (ПБ-1, п. 8; docs/siege_v2.md, «Решения ПБ-1»): полководец в городе ведёт оборону, его
// фланги бьются — и опыт и гибель им идут тем же боем, что в поле (ДР-5, `LocalWorld.flankDeed`): доля гибели фланга — гибель
// разбитого у этой клетки (`peril.routPeril`, клетка — своя, дали нет) × доля выбитых его фланга. Прежде у своих стен поля не было
// (открытый вопрос ДР-5, 28.6, п. 1).
//
// Область правила (правило 11): бой у своих стен, где у обороны есть командиры, — полководец в городе (`homeFlanks`), фланг с
// командиром терял людей. Каждая точка проверяется утверждением: бой дошёл до ядра, командиры стояли в обороне, фланг терял.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import type { WorldSave } from './local/state';
import type { GateCall, PlayerProfile } from './types';
import type { TroopStack } from '@/game/battle/kinds';
import { shieldVillagers } from './lairs';
import { routPeril } from './peril';
import { inTown } from './muster';

const START = 1_700_000_000_000;
const HOST: TroopStack = { spearman: 140, archer: 50, legionary: 30 };

const profile = (over: Partial<PlayerProfile> = {}): PlayerProfile => ({
  name: 'Тест',
  pop: shieldVillagers(0.1),
  defense: 900,
  units: { warrior: 10, scout: 4 },
  army: { ...HOST },
  stock: { food: 4000, wood: 4000, stone: 4000 },
  stash: 0,
  ...over,
});

/** Вызов разбойников к воротам и пульс: последствие и отчёт этого вызова. */
async function gateBattle(seed: number, over: Partial<PlayerProfile>) {
  const world = new LocalWorld({ seed, now: () => START, storage: null });
  const p = profile(over);
  await world.sync(p);
  const save = (world as unknown as { save: WorldSave }).save;
  const call: GateCall = { id: `g${seed}`, foe: 'raiders', power: 900, seed: 1000 + seed };
  const res = await world.sync({ ...p, gate: [call] });
  const effect = res.effects.find((e) => e.gate === call.id);
  const report = (await world.reports()).find((r) => r.battle?.result.seed === call.seed);
  return { save, effect, report };
}

const sum = (x: Record<string, number | undefined>): number => Object.values(x).reduce((a: number, b) => a + (b ?? 0), 0);

describe('командиры флангов у своих стен — тем же боем, что в поле (ПБ-1, п. 8)', () => {
  it('бой у ворот при полководце в городе несёт бой флангов: исход обороны, кость боя, доля гибели — гибель у своей клетки × доля выбитых', async () => {
    let lost = 0;
    for (const seed of [3, 7, 11, 19]) {
      const { save, effect, report } = await gateBattle(seed, { flanks: { A: 2, C: -1 } });
      // Граница области: полководец в городе — фланги стоят в обороне.
      expect(inTown(save.figures.general, START), 'точка внутри области: полководец в городе').toBe(true);
      expect(effect, `сид ${seed}: последствие вызова`).toBeDefined();
      expect(report?.battle, `сид ${seed}: бой дошёл до ядра`).toBeDefined();
      const fb = effect!.flanks;
      expect(fb, `сид ${seed}: бой флангов в последствии`).toBeDefined();
      expect(fb!.ok, 'исход — исход обороны').toBe(effect!.battle === 'won');
      expect(fb!.seed).toBe(report!.battle!.result.seed);
      const sides = report!.battle!.result.sides.defender.sectors;
      for (const [f, sec] of [['left', 'A'], ['right', 'C']] as const) {
        const share = 1 - sum(sides[sec].final) / sum(sides[sec].initial);
        expect(fb!.peril[f], `сид ${seed}: ${f}`).toBeCloseTo(routPeril(0) * share, 9);
      }
      lost = Math.max(lost, fb!.peril.left ?? 0, fb!.peril.right ?? 0);
    }
    expect(lost, 'точка внутри области: фланги теряли людей').toBeGreaterThan(0);
  });

  it('без командиров бой у ворот бой флангов в последствие не кладёт', async () => {
    const { effect, report } = await gateBattle(7, {});
    expect(report?.battle, 'точка внутри области: бой был').toBeDefined();
    expect(effect!.flanks).toBeUndefined();
  });

  it('все бои у своих стен кладут бой флангов: набег на стену, вызов к воротам, вылазка, оборона в войне', () => {
    const code = readFileSync(path.resolve('src/world/local/LocalWorld.ts'), 'utf8');
    const body = (head: string): string => {
      const from = code.indexOf(head);
      const end = code.indexOf('\n  }\n', from);
      expect(from > 0 && end > from, `тело «${head}» найдено`).toBe(true);
      return code.slice(from, end);
    };
    for (const head of ['private resolveIncoming(', 'private gateFight(', 'async sortie(']) {
      expect(body(head), `${head} — бой флангов`).toMatch(/this\.flankDeed\(field, '(defender|attacker)', [^,]+, (at|now), this\.save\.home\)/);
    }
    expect(body('private warBattle('), 'оборона в войне — свой бой города, не выручка союзника').toMatch(/general \|\| \(ours === 'def' && !allied\) \? this\.flankDeed\(/);
  });
});
