// Черты армии в ядре боя (ДР-4, docs/siege_v2.md, «Решения ДР-4», Ш3): одна дверь (`scarProfile`) — поправки к показателям родов
// стороны, и в ударе, и в морали, у бьющего и у цели; без поля бой байт в байт прежний; потолок `SCAR_CAP` — неуязвимости нет; сила
// с поправкой не убывает. Обещания об исходе — на наборе сидов (правило 17); граница области — утверждением в самом тесте
// (правило 11): бой идёт, исход без черт не предрешён.
import { describe, expect, it } from 'vitest';
import { scarProfile, simulateBattle } from './sim';
import { deploySetup } from './setup';
import { KIND_PROFILE, SCAR_CAP } from './config';
import { UNIT_KINDS, type ArmySetup, type BattleResult, type ScarEdge, type Stack, type StatId } from './types';

/** Смешанное войско мерки: пехота, копья, лучники и конница — бой идёт и огнём, и натиском. */
const ARMY: Partial<Stack> = { infantry: 200, spear: 150, archer: 80, cavalry: 40 };
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

const setup = (scars?: ScarEdge): ArmySetup => ({ ...deploySetup(ARMY), ...(scars ? { scars } : {}) });
const fight = (seed: number, atk?: ScarEdge, def?: ScarEdge): BattleResult => simulateBattle({ seed, attacker: setup(atk), defender: setup(def) });

/** У всех родов одни показатели на `k` отметок. */
const all = (stats: StatId[], k: number): ScarEdge => Object.fromEntries(UNIT_KINDS.map((u) => [u, Object.fromEntries(stats.map((s) => [s, k]))]));

/** На наборе сидов: побед нападающего и сколько он выбил у обороны. */
function tally(atk?: ScarEdge): { wins: number; killed: number } {
  let wins = 0;
  let killed = 0;
  for (const seed of SEEDS) {
    const r = fight(seed, atk);
    if (r.winner === 'attacker') wins++;
    killed += r.sides.defender.total.losses;
  }
  return { wins, killed };
}

describe('черты в ядре боя: одна дверь', () => {
  it('показатель рода — таблица плюс поправка; нет поля, рода или числа — таблица', () => {
    expect(scarProfile(setup(), 'spear')).toEqual(KIND_PROFILE.spear);
    expect(scarProfile(setup({ archer: { fireAtk: 0.4 } }), 'spear')).toEqual(KIND_PROFILE.spear);
    expect(scarProfile(setup({ spear: { shockDef: 0.4, fireAtk: Number.NaN } }), 'spear')).toEqual({ ...KIND_PROFILE.spear, shockDef: KIND_PROFILE.spear.shockDef + 0.4 });
  });
  it(`потолок: поправка не дальше ${SCAR_CAP} отметки в обе стороны`, () => {
    expect(scarProfile(setup({ cavalry: { shockAtk: 9, fireDef: -9 } }), 'cavalry')).toEqual({
      ...KIND_PROFILE.cavalry,
      shockAtk: KIND_PROFILE.cavalry.shockAtk + SCAR_CAP,
      fireDef: KIND_PROFILE.cavalry.fireDef - SCAR_CAP,
    });
    // Сверх потолка — тот же бой, что на потолке: черты складываются, но дальше показатель не уходит.
    for (const seed of SEEDS.slice(0, 5)) {
      expect(JSON.stringify(fight(seed, all(['shockDef', 'fireDef', 'moraleDef'], 50)))).toBe(JSON.stringify(fight(seed, all(['shockDef', 'fireDef', 'moraleDef'], SCAR_CAP))));
    }
  });
  it('без черт бой байт в байт прежний: нет поля, пустое поле и нули — один бой', () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const base = JSON.stringify(fight(seed));
      expect(JSON.stringify(fight(seed, {})), `сид ${seed}: пустое`).toBe(base);
      expect(JSON.stringify(fight(seed, all(['shockAtk', 'moraleDef'], 0), { spear: {} })), `сид ${seed}: нули`).toBe(base);
    }
  });
  it('неуязвимости нет: на потолке всех защит оборона всё равно теряет людей в каждом бою', () => {
    const iron = all(['fireDef', 'shockDef', 'moraleDef'], SCAR_CAP);
    for (const seed of SEEDS.slice(0, 10)) expect(fight(seed, undefined, iron).sides.defender.total.losses, `сид ${seed}`).toBeGreaterThan(0);
  });
});

describe('сила с поправкой не убывает (набор сидов)', () => {
  it('граница области: без черт исход не предрешён — нападающий и выигрывает, и проигрывает', () => {
    const base = tally();
    expect(base.wins).toBeGreaterThan(0);
    expect(base.wins).toBeLessThan(SEEDS.length);
  });
  it('натиск: по ступеням 0 … потолок побед не меньше и выбито строго больше', () => {
    let prev = tally();
    for (const k of [0.25, 0.5, SCAR_CAP]) {
      const next = tally(all(['shockAtk'], k));
      expect(next.wins, `натиск +${k}: побед`).toBeGreaterThanOrEqual(prev.wins);
      expect(next.killed, `натиск +${k}: выбито`).toBeGreaterThan(prev.killed);
      prev = next;
    }
  });
  it('дурная поправка — зеркало: по ступеням вниз побед не больше и выбито строго меньше', () => {
    let prev = tally();
    for (const k of [0.25, 0.5, SCAR_CAP]) {
      const next = tally(all(['shockAtk', 'moraleDef'], -k));
      expect(next.wins, `−${k}: побед`).toBeLessThanOrEqual(prev.wins);
      expect(next.killed, `−${k}: выбито`).toBeLessThan(prev.killed);
      prev = next;
    }
  });
  it('защита цели — у цели: поправка обороны снижает её потери, а не потери нападающего', () => {
    const base = SEEDS.reduce((n, seed) => n + fight(seed).sides.defender.total.losses, 0);
    const guarded = SEEDS.reduce((n, seed) => n + fight(seed, undefined, all(['shockDef', 'fireDef'], 0.5)).sides.defender.total.losses, 0);
    expect(guarded).toBeLessThan(base);
  });
});
