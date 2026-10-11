// Стена в ядре боя (docs/siege_v2.md, 4.1): ядро получает ширину боя и грань кости нападающего, как получает землю, —
// `GroundPenalty.wall` и проём посреди боя `BattleInput.widen`. Что это стена, знает мир (`world/wall`); здесь — что ядро
// делает с этими двумя числами, и ничего сверх.
import { describe, expect, it } from 'vitest';
import { groundFaces, simulateBattle } from './sim';
import { deploySetup } from './setup';
import { FRONT_WIDTH } from './config';
import type { ArmySetup, BattleEvent, BattleInput, BattleResult } from './types';

const ATTACKER = { infantry: 420, spear: 160, archer: 120 };
const DEFENDER = { infantry: 300, spear: 140, archer: 160 };
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

const battle = (seed: number, atk: Partial<ArmySetup> = {}, extra: Partial<BattleInput> = {}): BattleResult =>
  simulateBattle({
    seed,
    attacker: { ...deploySetup(ATTACKER), ...atk },
    defender: deploySetup(DEFENDER),
    ...extra,
  });

/** Журнал без служебной строки места боя: её поля и есть то, чем бои различаются по имени, а не по ходу. */
const body = (r: BattleResult): unknown => ({ ...r, log: r.log.filter((e) => e.id !== 'ground' && e.id !== 'dice') });
const dice = (r: BattleResult): Array<Extract<BattleEvent, { id: 'dice' }>> => r.log.filter((e): e is Extract<BattleEvent, { id: 'dice' }> => e.id === 'dice');

describe('стена — грань кости нападающего (GroundPenalty.wall)', () => {
  it('стены нет или она ноль — бой до бита тот же, что без поля', () => {
    for (const seed of SEEDS) {
      const plain = battle(seed);
      expect(battle(seed, { ground: { wall: 0 } })).toEqual(plain);
    }
  });

  it('стена бьёт кость ровно как укрепления лагеря той же грани: ход боя тот же до бита', () => {
    for (const seed of SEEDS) {
      const wall = battle(seed, { ground: { wall: 2 } });
      const works = battle(seed, { ground: { works: 2 } });
      expect(body(wall)).toEqual(body(works));
      // Штраф стоит в каждой кости нападающего и только у него.
      for (const d of dice(wall)) expect(d.ground).toEqual({ attacker: 2, defender: 0 });
    }
  });

  it('стена отнимает у нападающего: при −2 гранях он теряет больше, чем на ровном месте, на каждом сиде', () => {
    for (const seed of SEEDS) {
      const plain = battle(seed).sides.attacker.total.losses;
      const wall = battle(seed, { ground: { wall: 2 } }).sides.attacker.total.losses;
      expect(wall).toBeGreaterThan(plain);
    }
  });

  it('манёвр стену не снимает — снимает только переправу', () => {
    const own: ArmySetup = { ...deploySetup(ATTACKER), pips: { maneuver: 3 }, ground: { wall: 2, crossing: 1 } };
    const g = groundFaces(own, deploySetup(DEFENDER));
    expect(g.lifted).toBe(true);
    expect(g.wall).toBe(2);
    expect(g.faces).toBe(2);
  });

  it('строка места боя называет стену', () => {
    const r = battle(1, { ground: { wall: 1.5 } });
    const e = r.log.find((x) => x.id === 'ground');
    expect(e).toMatchObject({ id: 'ground', side: 'attacker', wall: 1.5 });
  });
});

describe('проём посреди боя (BattleInput.widen)', () => {
  // Узкий фронт — бой идёт кругами: проёму есть с какого круга открыться. Граница области правила — бой дошёл до круга
  // проёма; проверяется в самом тесте.
  const NARROW = 40;
  const opened = (seed: number, widen: BattleInput['widen']): BattleResult =>
    battle(seed, { ground: { wall: 2 } }, { width: NARROW, widen });

  it('до своего круга проём не меняет ничего: первый круг тот же до бита', () => {
    let reached = 0;
    for (const seed of SEEDS) {
      const shut = battle(seed, { ground: { wall: 2 } }, { width: NARROW });
      const open = opened(seed, { round: 1, width: FRONT_WIDTH, wall: 0 });
      const at = open.log.findIndex((e) => e.id === 'widen');
      if (at < 0) continue;
      reached += 1;
      expect(open.log.slice(0, at)).toEqual(shut.log.slice(0, at));
    }
    expect(reached).toBeGreaterThan(SEEDS.length / 2);
  });

  it('с круга проёма кость идёт с новым штрафом, а ряд — в новой ширине', () => {
    let reached = 0;
    for (const seed of SEEDS) {
      const r = opened(seed, { round: 1, width: FRONT_WIDTH, wall: 0.5 });
      const at = r.log.findIndex((e) => e.id === 'widen');
      if (at < 0) continue;
      reached += 1;
      expect(r.log[at]).toMatchObject({ id: 'widen', width: FRONT_WIDTH, wall: 0.5 });
      const before = dice({ ...r, log: r.log.slice(0, at) });
      const after = dice({ ...r, log: r.log.slice(at) });
      expect(before.length).toBeGreaterThan(0);
      expect(after.length).toBeGreaterThan(0);
      for (const d of before) expect(d.ground?.attacker).toBe(2);
      for (const d of after) expect(d.ground?.attacker).toBe(0.5);
      // Ряд шире фронта пишется со своей шириной: до проёма — узкой, после — новой.
      const depthAfter = r.log.slice(at).filter((e): e is Extract<BattleEvent, { id: 'depth' }> => e.id === 'depth');
      for (const e of depthAfter) expect(e.width).toBe(FRONT_WIDTH);
    }
    expect(reached).toBeGreaterThan(SEEDS.length / 2);
  });

  it('проём на ту же ширину и грань — тот же бой, кроме строки проёма', () => {
    for (const seed of SEEDS) {
      const shut = battle(seed, { ground: { wall: 2 } }, { width: NARROW });
      const same = opened(seed, { round: 1, width: NARROW, wall: 2 });
      expect({ ...same, log: same.log.filter((e) => e.id !== 'widen') }).toEqual(shut);
    }
  });

  it('проём помогает нападающему: потери его меньше, чем у боя, где проём не открылся, — в большинстве сидов', () => {
    let better = 0;
    let reached = 0;
    for (const seed of SEEDS) {
      const shut = battle(seed, { ground: { wall: 2 } }, { width: NARROW });
      const open = opened(seed, { round: 1, width: FRONT_WIDTH, wall: 0 });
      if (!open.log.some((e) => e.id === 'widen')) continue;
      reached += 1;
      const share = (r: BattleResult): number => r.sides.attacker.total.losses / r.sides.attacker.total.initial;
      const foe = (r: BattleResult): number => r.sides.defender.total.losses / r.sides.defender.total.initial;
      if (foe(open) - share(open) > foe(shut) - share(shut)) better += 1;
    }
    expect(better).toBeGreaterThan(reached / 2);
  });

  it('вход проверяется: проём с нулевой шириной или на первом круге — ошибка', () => {
    expect(() => opened(1, { round: 1, width: 0, wall: 0 })).toThrow();
    expect(() => opened(1, { round: 0, width: FRONT_WIDTH, wall: 0 })).toThrow();
  });
});

describe('ширина стрельбы (BattleInput.fire)', () => {
  // Узкий фронт у стены: сходятся в проёмах, а стреляют со всей стены. Граница области — ряд лучников шире узкого фронта
  // и не шире полного: проверяется в самом тесте.
  const NARROW = 40;
  const bows = { archer: 300, infantry: 300 };
  const run = (seed: number, fire?: number): BattleResult =>
    simulateBattle({ seed, attacker: deploySetup(bows), defender: deploySetup(DEFENDER), width: NARROW, ...(fire ? { fire } : {}) });
  const firstFire = (r: BattleResult): number => r.phases.find((p) => p.phase === 'ranged')?.losses.defender ?? 0;

  it('ширина стрельбы равна ширине боя — тот же бой до бита', () => {
    for (const seed of SEEDS) expect(run(seed, NARROW)).toEqual(run(seed));
  });

  it('полная ширина стрельбы при узком фронте: лучники в первом огне выбивают больше', () => {
    const rowOfBows = deploySetup(bows).sectors.D.archer + deploySetup(bows).sectors.A.archer;
    expect(rowOfBows, 'точка внутри области: лучников в полосе больше узкого фронта').toBeGreaterThan(NARROW);
    for (const seed of SEEDS) expect(firstFire(run(seed, FRONT_WIDTH))).toBeGreaterThan(firstFire(run(seed)));
  });
});

