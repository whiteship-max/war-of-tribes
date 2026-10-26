// Командиры флангов в ядре боя (ДР-3, docs/siege_v2.md, «Решения ДР-3», К3): одна дверь (`flankPips`) — отметки на кость своей
// полосы; без поля бой байт в байт прежний; командир бьёт своим флангом, а не чужим; лорд со знаком минус — потери выше;
// сила с тактикой не убывает. Обещания об исходе — на наборе сидов (правило 17); каждая точка сначала утверждает, что она внутри
// области правила (правило 11): в полосе идёт бой, исход не предрешён.
import { describe, expect, it } from 'vitest';
import { flankPips, simulateBattle } from './sim';
import { deploySetup } from './setup';
import type { ArmySetup, BattleResult, Flanks, Sector, Side, Stack } from './types';

/** Смешанное войско мерки: пехота, копья, лучники и конница — бой идёт во всех полосах. */
const ARMY: Partial<Stack> = { infantry: 200, spear: 150, archer: 80, cavalry: 40 };
const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

const setup = (flanks?: Flanks): ArmySetup => ({ ...deploySetup(ARMY), ...(flanks ? { flanks } : {}) });

const fight = (seed: number, atk: Flanks | undefined, def?: Flanks): BattleResult =>
  simulateBattle({ seed, attacker: setup(atk), defender: setup(def) });

/** Потери стороны в секторах (по месту, где встали), людьми. */
const lost = (r: BattleResult, side: Side, sectors: readonly Sector[]): number =>
  sectors.reduce((n, s) => {
    const x = r.sides[side].sectors[s];
    const sum = (k: Partial<Stack>): number => Object.values(k).reduce((a, b) => a + (b ?? 0), 0);
    return n + sum(x.initial) - sum(x.final);
  }, 0);

/** Полоса `l` одной стороны смотрит на полосу `2 − l` другой: левый фланг нападающего (A, D) — против правого обороны (C, F). */
const FACING_LEFT: readonly Sector[] = ['C', 'F'];
const FACING_RIGHT: readonly Sector[] = ['A', 'D'];

const sumOver = (f: (seed: number) => number): number => SEEDS.reduce((n, seed) => n + f(seed), 0);

describe('командир фланга в ядре боя: одна дверь', () => {
  it('дверь одна: левый — полоса 0 (A), правый — полоса 2 (C), у центра командира нет; не число — ноль', () => {
    const s = setup({ A: 2, C: -1 });
    expect(flankPips(s, 0)).toBe(2);
    expect(flankPips(s, 2)).toBe(-1);
    expect(flankPips(s, 1)).toBe(0);
    expect(flankPips(setup(), 0)).toBe(0);
    expect(flankPips(setup({ A: Number.NaN }), 0)).toBe(0);
  });

  it('без командиров бой байт в байт прежний: нет поля, пустое поле и нули — один бой', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const base = JSON.stringify(fight(seed, undefined));
      expect(JSON.stringify(fight(seed, {})), `сид ${seed}: пустое поле`).toBe(base);
      expect(JSON.stringify(fight(seed, { A: 0, C: 0 }, { A: 0 })), `сид ${seed}: нули`).toBe(base);
    }
  });
});

describe('командир бьёт своим флангом (набор сидов)', () => {
  it('тактик слева выбивает больше напротив своего фланга, чем тот же тактик справа, — и наоборот', () => {
    const left = { A: 2 };
    const right = { C: 2 };
    // Граница области: в обеих полосах напротив идёт бой — без командиров обе теряют людей.
    const baseL = sumOver((seed) => lost(fight(seed, undefined), 'defender', FACING_LEFT));
    const baseR = sumOver((seed) => lost(fight(seed, undefined), 'defender', FACING_RIGHT));
    expect(baseL, 'бой напротив левого фланга').toBeGreaterThan(0);
    expect(baseR, 'бой напротив правого фланга').toBeGreaterThan(0);
    const leftOnL = sumOver((seed) => lost(fight(seed, left), 'defender', FACING_LEFT));
    const rightOnL = sumOver((seed) => lost(fight(seed, right), 'defender', FACING_LEFT));
    const leftOnR = sumOver((seed) => lost(fight(seed, left), 'defender', FACING_RIGHT));
    const rightOnR = sumOver((seed) => lost(fight(seed, right), 'defender', FACING_RIGHT));
    expect(leftOnL, 'тактик слева бьёт напротив левого сильнее, чем тот же справа').toBeGreaterThan(rightOnL);
    expect(rightOnR, 'тактик справа бьёт напротив правого сильнее, чем тот же слева').toBeGreaterThan(leftOnR);
    expect(leftOnL, 'тактик слева бьёт сильнее пустого места').toBeGreaterThan(baseL);
  });

  it('лорд бездарен: потери своего фланга и всей армии выше, побед не больше', () => {
    const lords = { A: -2, C: -2 };
    let base = 0;
    let withLords = 0;
    let winsBase = 0;
    let winsLords = 0;
    let flankBase = 0;
    let flankLords = 0;
    for (const seed of SEEDS) {
      const b = fight(seed, undefined);
      const l = fight(seed, lords);
      base += b.sides.attacker.total.losses / b.sides.attacker.total.initial;
      withLords += l.sides.attacker.total.losses / l.sides.attacker.total.initial;
      flankBase += lost(b, 'attacker', ['A', 'D']);
      flankLords += lost(l, 'attacker', ['A', 'D']);
      if (b.winner === 'attacker') winsBase += 1;
      if (l.winner === 'attacker') winsLords += 1;
    }
    // Граница области: исход не предрешён — без командиров нападающий и побеждает, и проигрывает.
    expect(winsBase, 'побеждает не всегда').toBeLessThan(SEEDS.length);
    expect(winsBase, 'проигрывает не всегда').toBeGreaterThan(0);
    expect(withLords, 'доля потерь армии с лордами').toBeGreaterThan(base);
    expect(flankLords, 'потери левого фланга с лордом').toBeGreaterThan(flankBase);
    expect(winsLords, 'побед с лордами не больше').toBeLessThanOrEqual(winsBase);
  });

  it('сила с тактикой не убывает: доля побед и выбитые противником — по ступеням −2…+2', () => {
    const at = (t: number): { wins: number; kills: number } => {
      let wins = 0;
      let kills = 0;
      for (const seed of SEEDS) {
        const r = fight(seed, t === 0 ? undefined : { A: t, C: t });
        if (r.winner === 'attacker') wins += 1;
        kills += r.sides.defender.total.losses;
      }
      return { wins, kills };
    };
    const rows = [-2, -1, 0, 1, 2].map(at);
    // Граница области: в середине исход не предрешён — ступени есть куда двигать.
    expect(rows[2].wins).toBeGreaterThan(0);
    expect(rows[2].wins).toBeLessThan(SEEDS.length);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].wins, `ступень ${i - 2}: побед не меньше`).toBeGreaterThanOrEqual(rows[i - 1].wins);
      expect(rows[i].kills, `ступень ${i - 2}: выбито не меньше`).toBeGreaterThan(rows[i - 1].kills);
    }
  });
});
