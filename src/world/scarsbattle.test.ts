// Черты армии в бою мира (ДР-4, docs/siege_v2.md, «Решения ДР-4», Ш3–Ш4): дверь мира (`world/battle.resolveField`) кладёт в ядро
// поправки только действующих черт — по месту боя и войску противника; вне своей темы черта не трогает боя ни на бит; добрая в своём
// бою — сильнее, дурная — слабее (набор сидов, правило 17); метки боя у обеих сторон — из итога ядра.
import { describe, expect, it } from 'vitest';
import { emptyStack, type Stack } from '@/battle';
import { resolveField, type FieldSide } from './battle';
import { SCARS, SCAR_BY_ID, type ScarId, type ScarWhere } from '@/game/scarrules';

const ARMY: Stack = { ...emptyStack(), infantry: 200, spear: 150, archer: 80, cavalry: 40 };
const SEEDS = Array.from({ length: 40 }, (_, i) => 101 + i);

/** Где черта действует: признак её темы у места или у стороны. */
function home(id: ScarId): { where: ScarWhere; hungry?: true } {
  const t = SCAR_BY_ID[id].theme;
  if (t === 'hunger') return { where: {}, hungry: true };
  if (t === 'horse' || t === 'arrows') return { where: {} };
  return { where: { [t]: true } as ScarWhere };
}

const fight = (seed: number, ours: FieldSide, where: ScarWhere = {}) => resolveField({ seed, attacker: ours, defender: { kinds: ARMY }, where });

/** Войско противника в мерке: у «Стены копий» — конное (конницы больше четверти), у прочих — то же, что наше. */
const HORSE: Stack = { ...ARMY, cavalry: 300 };

function tally(held: ScarId[], where: ScarWhere, hungry?: true, foe: Stack = ARMY): { wins: number; killed: number } {
  let wins = 0;
  let killed = 0;
  for (const seed of SEEDS) {
    const f = resolveField({ seed, attacker: { kinds: ARMY, scars: { held, ...(hungry ? { hungry } : {}) } }, defender: { kinds: foe }, where });
    if (f.won) wins++;
    killed += f.result!.sides.defender.total.losses;
  }
  return { wins, killed };
}

describe('черта действует только в своём бою', () => {
  it('вне темы — бой байт в байт тот же, что без черт', () => {
    for (const d of SCARS) {
      if (d.theme === 'horse' || d.theme === 'arrows') continue;
      for (const seed of SEEDS.slice(0, 3)) {
        const base = JSON.stringify(fight(seed, { kinds: ARMY }).result);
        expect(JSON.stringify(fight(seed, { kinds: ARMY, scars: { held: [d.id] } }).result), `${d.id}, сид ${seed}`).toBe(base);
      }
    }
  });
  it('«Страх обстрела» — только при лучниках противника, «Стена копий» — только при его коннице', () => {
    const noBows: Stack = { ...ARMY, archer: 0 };
    for (const seed of SEEDS.slice(0, 3)) {
      const base = (foe: Stack) => JSON.stringify(resolveField({ seed, attacker: { kinds: ARMY }, defender: { kinds: foe } }).result);
      const scared = (foe: Stack) => JSON.stringify(resolveField({ seed, attacker: { kinds: ARMY, scars: { held: ['arrowfear'] } }, defender: { kinds: foe } }).result);
      expect(scared(noBows)).toBe(base(noBows));
      expect(scared(ARMY)).not.toBe(base(ARMY));
      const spears = (foe: Stack) => JSON.stringify(resolveField({ seed, attacker: { kinds: ARMY, scars: { held: ['pikewall'] } }, defender: { kinds: foe } }).result);
      expect(spears(ARMY), 'конницы меньше четверти').toBe(base(ARMY));
      expect(spears(HORSE)).not.toBe(base(HORSE));
    }
  });
});

describe('в своём бою добрая сильнее, дурная слабее (набор сидов)', () => {
  // Граница области: без черт исход не предрешён ни в одном из мест мерки.
  it('граница области: без черт нападающий и выигрывает, и проигрывает', () => {
    const base = tally([], { woods: true });
    expect(base.wins).toBeGreaterThan(0);
    expect(base.wins).toBeLessThan(SEEDS.length);
  });
  for (const d of SCARS) {
    it(`${d.name}: ${d.good ? 'побед не меньше и выбито больше' : 'побед не больше и выбито меньше'}`, () => {
      const at = home(d.id);
      const foe = d.theme === 'horse' ? HORSE : ARMY;
      const base = tally([], at.where, at.hungry, foe);
      const got = tally([d.id], at.where, at.hungry, foe);
      if (d.good) {
        expect(got.wins).toBeGreaterThanOrEqual(base.wins);
        expect(got.killed).toBeGreaterThan(base.killed);
      } else {
        expect(got.wins).toBeLessThanOrEqual(base.wins);
        expect(got.killed).toBeLessThan(base.killed);
      }
    });
  }
});

describe('метка боя', () => {
  it('у обеих сторон: исход своей стороны, место, голод — только у голодной', () => {
    const f = resolveField({ seed: 7, attacker: { kinds: ARMY, scars: { held: [], hungry: true } }, defender: { kinds: ARMY }, where: { woods: true, siege: true } });
    expect(f.marks).not.toBeNull();
    const a = f.marks!.attacker;
    const d = f.marks!.defender;
    expect(a.out === 'win').toBe(f.won);
    expect(d.out === 'win').toBe(f.result!.winner === 'defender');
    expect(a).toMatchObject({ woods: true, siege: true, hungry: true });
    expect(d.hungry).toBeUndefined();
    // Стрелы — доля нашего войска, выбитая огнём противника: у обеих есть лучники, у обеих меток она есть.
    expect(a.arrows).toBeCloseTo(Math.round((100 * f.result!.sides.defender.rangedTotal) / f.result!.sides.attacker.total.initial) / 100, 9);
  });
  it('боя не было — меток нет', () => {
    expect(resolveField({ seed: 1, attacker: { kinds: emptyStack() }, defender: { kinds: ARMY } }).marks).toBeNull();
  });
});

describe('«Стена копий» — только против всадников (ДР-5)', () => {
  // Стая у ворот — лёгкая конница ядра, но звери: ни метки «конница», ни действия черты.
  const PACK: Stack = { ...emptyStack(), cavalry: 120 };
  it('победа над стаей не пишет метку «конница», победа над тем же числом всадников — пишет', () => {
    let horse = 0;
    for (const seed of SEEDS.slice(0, 8)) {
      const riders = resolveField({ seed, attacker: { kinds: PACK }, defender: { kinds: ARMY } });
      const pack = resolveField({ seed, attacker: { kinds: PACK, beasts: true }, defender: { kinds: ARMY } });
      // Точка внутри области: конных у противника больше четверти, и мы выиграли.
      expect(riders.won, `сид ${seed}`).toBe(false);
      expect(riders.marks?.defender.horse, `сид ${seed}`).toBe(true);
      expect(pack.marks?.defender.horse, `сид ${seed}`).toBeUndefined();
      // Бой тот же — звери отличаются только меткой (без черт у защитника).
      expect(JSON.stringify(pack.result)).toBe(JSON.stringify(riders.result));
      horse++;
    }
    expect(horse).toBe(8);
  });
  it('черта против стаи не действует: бой тот же, что без черт; против всадников — действует', () => {
    for (const seed of SEEDS.slice(0, 3)) {
      const plain = (beasts: boolean) => JSON.stringify(resolveField({ seed, attacker: { kinds: PACK, ...(beasts ? { beasts: true as const } : {}) }, defender: { kinds: ARMY } }).result);
      const spears = (beasts: boolean) =>
        JSON.stringify(resolveField({ seed, attacker: { kinds: PACK, ...(beasts ? { beasts: true as const } : {}) }, defender: { kinds: ARMY, scars: { held: ['pikewall'] } } }).result);
      expect(spears(true)).toBe(plain(true));
      expect(spears(false)).not.toBe(plain(false));
    }
  });
});
