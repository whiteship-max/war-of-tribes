// Клещи в ядре боя (docs/siege_v2.md, 6.2; этап 2д): вторая армия стороны стоит в тылу противника (`ArmySetup.behind`) —
// обходящими своей полосы с первого тика, лицом к тылу. Своих чисел у неё нет: окружённый получает правила обхода и тыла,
// что в ядре уже есть (`flankTurned`, `rearReached`, `flankDrain`). Здесь — что ядро делает с этим полем, и ничего сверх.
import { describe, expect, it } from 'vitest';
import { simulateBattle } from './sim';
import { deploy, deploySetup, emptySectors, stackOf, validateSetup } from './setup';
import { FRONT_WIDTH } from './config';
import { SECTORS, UNIT_KINDS, type ArmySetup, type BattleResult, type Stack } from './types';

const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);

/** Лагерь: пешие строем и лучники второй линией. */
const CAMP = { infantry: 260, spear: 120, archer: 140 };
/** Гарнизон из ворот и дружина с поля. */
const GATE = { infantry: 190, spear: 80, archer: 40 };
const FIELD = { infantry: 130, cavalry: 40 };

const sum = (a: Partial<Stack>, b: Partial<Stack>): Stack => {
  const out = stackOf(a);
  for (const k of UNIT_KINDS) out[k] += b[k] ?? 0;
  return out;
};

/** Две расстановки тем же правилом: строй своей полосы и вторая армия в тылу (`world/battle.sideSetup`). */
function pincer(front: Partial<Stack>, back: Partial<Stack>): ArmySetup {
  const a = deploy(front, FRONT_WIDTH);
  const b = deploy(back, FRONT_WIDTH);
  const sectors = emptySectors();
  for (const id of SECTORS) for (const k of UNIT_KINDS) sectors[id][k] = a[id][k] + b[id][k];
  return { sectors, behind: b };
}

const fight = (seed: number, attacker: ArmySetup): BattleResult => simulateBattle({ seed, attacker, defender: deploySetup(CAMP) });

describe('клещи: вторая армия в тылу противника (ArmySetup.behind)', () => {
  it('второй армии нет или она пуста — бой до бита тот же', () => {
    for (const seed of SEEDS.slice(0, 6)) {
      const plain = fight(seed, deploySetup(sum(GATE, FIELD)));
      expect(fight(seed, { ...deploySetup(sum(GATE, FIELD)), behind: emptySectors() })).toEqual(plain);
    }
  });

  it('вторая армия — часть секторов: больше сектора её не бывает', () => {
    const p = pincer(GATE, FIELD);
    expect(validateSetup(p)).toBeNull();
    const bad = { ...p, behind: { ...p.behind!, A: sum(p.sectors.A, { infantry: 1 }) } };
    expect(validateSetup(bad)).toMatch(/тыл A/);
  });

  it('дошла до тыла: событие «тыл достигнут» у лагеря — правило прорыва, без своего числа', () => {
    const r = fight(3, pincer(GATE, FIELD));
    const reached = r.log.filter((e) => e.id === 'rear-reached' && e.side === 'defender');
    expect(reached.length, 'тыл лагеря достигнут').toBeGreaterThan(0);
    const first = r.log.find((e) => e.id === 'rear-reached');
    // Те же силы одним строем: до тыла лагеря в первых кругах не доходит никто.
    const flat = fight(3, deploySetup(sum(GATE, FIELD)));
    const early = (x: BattleResult): number => x.log.filter((e) => e.id === 'rear-reached' && e.side === 'defender' && e.tick <= (first?.tick ?? 0)).length;
    expect(early(flat)).toBe(0);
  });

  it('клещи сильнее суммы: те же люди с двух сторон берут чаще и ломают лагерь раньше, чем одним строем', () => {
    let flatWins = 0;
    let pinWins = 0;
    let flatLoss = 0;
    let pinLoss = 0;
    for (const seed of SEEDS) {
      const flat = fight(seed, deploySetup(sum(GATE, FIELD)));
      const pin = fight(seed, pincer(GATE, FIELD));
      if (flat.winner === 'attacker') flatWins++;
      if (pin.winner === 'attacker') pinWins++;
      flatLoss += flat.sides.defender.total.losses / flat.sides.defender.total.initial;
      pinLoss += pin.sides.defender.total.losses / pin.sides.defender.total.initial;
      // Люди те же: вторая армия — часть стороны, а не прибавка.
      expect(pin.sides.attacker.total.initial).toBe(flat.sides.attacker.total.initial);
    }
    // Граница области: одним строем бой не решён заранее — сумма берёт не всегда, иначе «сильнее» не спрашивается.
    expect(flatWins, 'точка внутри области: сумма берёт не всегда').toBeLessThan(SEEDS.length);
    expect(pinWins, 'клещи берут чаще суммы').toBeGreaterThan(flatWins);
    expect(pinLoss, 'лагерь в клещах теряет больше').toBeGreaterThan(flatLoss);
  });

  it('ролик: при клещах из ворот — ровно строй своей полосы, в тылу — дружина', () => {
    const p = pincer(GATE, FIELD);
    const r = fight(5, { ...p, garrison: GATE });
    for (const id of SECTORS) {
      for (const k of UNIT_KINDS) expect(r.sides.attacker.sectors[id].garrison?.[k], `${id} ${k}`).toBe(p.sectors[id][k] - p.behind![id][k]);
    }
    // Наблюдение исход не меняет.
    expect(r.winner).toBe(fight(5, p).winner);
  });
});
