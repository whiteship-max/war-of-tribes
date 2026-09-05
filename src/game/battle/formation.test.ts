// Расстановка не должна терять людей. Это главное обещание панели подготовки:
// сумма по шести секторам, резерву и оставленным дома равна гарнизону — иначе
// игрок отправит половину армии в никуда и не поймёт почему.
import { describe, expect, it } from 'vitest';
import {
  SECTORS,
  UNIT_KINDS,
  simulateBattle,
  stackTotal,
  validateSetup,
  QUICK_PRESET_IDS,
  type ArmySetup,
} from '@/battle';
import { RATIO_EVEN } from '@/battle/bench';
import { TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import {
  applyTemplate,
  clampFormation,
  emptyFormation,
  kindsPresent,
  placedTroops,
  presetFormation,
  stashUnplaced,
  toArmySetup,
  unplacedTroops,
  type BattlePlanTemplate,
} from './formation';
import {
  BATTLE_MAN,
  OWN_KINDS,
  gearOf,
  gearOfTroop,
  kindsOf,
  menOf,
  troopLosses,
  troopTotal,
  troopsAfter,
  type TroopStack,
} from './kinds';

const GARRISON: TroopStack = { clubman: 6, spearman: 8, archer: 5, axeman: 3, legionary: 2 };

describe('перевод бойцов племени в роды боя', () => {
  it('дубинщик — единица измерения строя, латник весит своей мощью', () => {
    expect(menOf('clubman', 1)).toBe(1);
    expect(menOf('spearman', 1)).toBe(2);
    expect(menOf('legionary', 1)).toBe(16 / BATTLE_MAN);
  });

  it('роды собираются из своих видов', () => {
    const k = kindsOf(GARRISON);
    expect(k.spear).toBe(menOf('spearman', 8));
    expect(k.archer).toBe(menOf('archer', 5));
    // Дубинщики, топорники и латники выходят одной пехотой.
    expect(k.infantry).toBe(menOf('clubman', 6) + menOf('axeman', 3) + menOf('legionary', 2));
    expect(k.cavalry).toBe(0);
  });

  it('снаряжение из кузницы поднимает ступень рода', () => {
    expect(gearOf({ clubman: 10 }).infantry).toBe(0);
    expect(gearOf({ legionary: 10 }).infantry).toBe(3);
    // Смешанный отряд — среднее по людям, а не по видам.
    expect(gearOf({ clubman: 9, legionary: 1 }).infantry).toBe(0);
  });

  it('потери рода списываются со слабых первыми и не уходят в минус', () => {
    const sent: TroopStack = { clubman: 4, legionary: 2 };
    const lost = troopLosses(sent, { spear: 0, infantry: 6, archer: 0, cavalry: 0 });
    expect(lost.clubman).toBe(4);
    expect(lost.legionary ?? 0).toBe(0);
    const left = troopsAfter(sent, lost);
    expect(left.legionary).toBe(2);
    expect(left.clubman ?? 0).toBe(0);
  });

  it('потери больше отряда его не переворачивают', () => {
    const sent: TroopStack = { clubman: 3 };
    const lost = troopLosses(sent, { spear: 0, infantry: 999, archer: 0, cavalry: 0 });
    expect(lost.clubman).toBe(3);
    expect(troopTotal(troopsAfter(sent, lost))).toBe(0);
  });
});

describe('расстановка не теряет войска', () => {
  it('пресет раскладывает весь состав целиком', () => {
    for (const preset of QUICK_PRESET_IDS) {
      const f = presetFormation(GARRISON, preset);
      const placed = placedTroops(f);
      for (const t of TROOP_IDS) expect(placed[t] ?? 0, `${preset}/${t}`).toBe(GARRISON[t] ?? 0);
      expect(troopTotal(unplacedTroops(GARRISON, f))).toBe(0);
    }
  });

  it('сумма по секторам плюс оставленные дома равна гарнизону', () => {
    const take: TroopStack = { clubman: 4, spearman: 6, archer: 2 };
    const f = presetFormation(take, 'standard');
    const bySector = SECTORS.reduce((n, id) => n + troopTotal(f.sectors[id]), 0);
    const home = TROOP_IDS.reduce((n, t) => n + Math.max(0, (GARRISON[t] ?? 0) - (take[t] ?? 0)), 0);
    expect(bySector + home).toBe(troopTotal(GARRISON));
  });

  it('нерасставленные видны отдельно и уходят в резерв, а не в никуда', () => {
    const f = emptyFormation();
    f.sectors.B = { spearman: 3 };
    const rest = unplacedTroops(GARRISON, f);
    expect(rest.spearman).toBe(5);
    const full = stashUnplaced(f, rest);
    expect(troopTotal(unplacedTroops(GARRISON, full))).toBe(0);
    expect(full.sectors.R.spearman).toBe(5);
  });

  it('подрезка убирает тех, кого больше нет, и называет лишних', () => {
    const f = presetFormation(GARRISON, 'defense');
    const { formation, extra } = clampFormation(f, { spearman: 4, clubman: 6, archer: 5, axeman: 3, legionary: 9 });
    expect(placedTroops(formation).spearman).toBe(4);
    // Семерых новых латников расстановка не знает — они лишние.
    expect(extra.legionary).toBe(7);
  });
});

describe('расстановка для ядра боя', () => {
  it('ядро принимает её без нареканий, и людей столько же', () => {
    for (const preset of QUICK_PRESET_IDS) {
      const setup = toArmySetup(presetFormation(GARRISON, preset));
      expect(validateSetup(setup), preset).toBeNull();
      const men = SECTORS.reduce((n, id) => n + stackTotal(setup.sectors[id]), 0);
      expect(men, preset).toBe(stackTotal(kindsOf(GARRISON)));
    }
  });

  it('ополчение встаёт во фронт само и в резерв не попадает', () => {
    const setup = toArmySetup(presetFormation({ spearman: 4 }, 'defense'), 30);
    const front = setup.sectors.A.infantry + setup.sectors.B.infantry + setup.sectors.C.infantry;
    expect(front).toBe(30);
    expect(stackTotal(setup.sectors.R)).toBe(0);
  });

  it('приказы имеет смысл давать только тем родам, что в отряде есть', () => {
    expect(kindsPresent({ spearman: 3 })).toEqual(['spear']);
    expect(kindsPresent(GARRISON).sort()).toEqual(['archer', 'infantry', 'spear']);
    // Конницы у племени нет ни в одном виде бойцов.
    expect(UNIT_KINDS.includes('cavalry')).toBe(true);
    expect(kindsPresent(GARRISON)).not.toContain('cavalry');
  });
});

describe('шаблоны', () => {
  const tpl: BattlePlanTemplate = {
    id: 1,
    name: 'Стена',
    troops: { spearman: 6, archer: 4 },
    formation: presetFormation({ spearman: 6, archer: 4 }, 'anti-cavalry'),
  };

  it('применяется как есть, когда дома всё на месте', () => {
    const out = applyTemplate(tpl, GARRISON);
    expect(out.short).toBe(false);
    expect(out.troops).toEqual({ spearman: 6, archer: 4 });
    expect(placedTroops(out.formation)).toEqual({ spearman: 6, archer: 4 });
    expect(out.formation.plan).toBe(tpl.formation.plan);
  });

  it('берёт сколько есть и честно об этом говорит', () => {
    const out = applyTemplate(tpl, { spearman: 2, archer: 4 });
    expect(out.short).toBe(true);
    expect(out.troops.spearman).toBe(2);
    expect(troopTotal(placedTroops(out.formation))).toBe(6);
  });

  it('переживает перезагрузку: это обычный JSON', () => {
    const back = JSON.parse(JSON.stringify(tpl)) as BattlePlanTemplate;
    expect(back).toEqual(tpl);
    expect(validateSetup(toArmySetup(back.formation))).toBeNull();
  });
});


// ---------- Конница племени ----------
//
// Без конного вида половина боевой системы у игрока мертва: угол кольца «конница
// бьёт лучников», план «кавалерийский удар», кавалерийские приказы и перехват
// обхода резервом. У чужих гарнизонов конница есть всегда, поэтому кольцо обязано
// работать в обе стороны — это и проверяется здесь настоящими боями.

/** Отряд племени, разложенный своим пресетом, в том виде, в каком его видит ядро. */
const armyOf = (troops: TroopStack, preset: Parameters<typeof presetFormation>[1] = 'standard'): ArmySetup =>
  toArmySetup(presetFormation(troops, preset));

/** Пара боёв одним сидом: сторона поля не должна решать исход. */
function ratio(a: ArmySetup, b: ArmySetup, seed: number): number {
  const r1 = simulateBattle({ seed, attacker: a, defender: b });
  const r2 = simulateBattle({ seed, attacker: b, defender: a });
  const aLoss = r1.sides.attacker.total.losses + r2.sides.defender.total.losses;
  const bLoss = r1.sides.defender.total.losses + r2.sides.attacker.total.losses;
  return bLoss / Math.max(1, aLoss);
}

/** Средний размен по нескольким сидам: один бой ничего не доказывает. */
const meanRatio = (a: ArmySetup, b: ArmySetup): number => {
  let sum = 0;
  for (let seed = 1; seed <= 6; seed += 1) sum += ratio(a, b, seed);
  return sum / 6;
};

describe('конница племени', () => {
  it('всадник выходит в поле конницей, и все четыре рода игроку доступны', () => {
    expect(kindsOf({ rider: 10 }).cavalry).toBe(menOf('rider', 10));
    expect(kindsOf({ rider: 10 }).infantry).toBe(0);
    // Пустых родов у племени не осталось: приказы есть кому давать во всех четырёх.
    expect([...OWN_KINDS].sort()).toEqual([...UNIT_KINDS].sort());
  });

  it('копьё и щит всадника поднимают его ступень снаряжения выше дубинщика', () => {
    expect(gearOfTroop('rider')).toBe(2);
    expect(gearOfTroop('rider')).toBeGreaterThan(gearOfTroop('clubman'));
    expect(gearOf({ rider: 5 }).cavalry).toBe(2);
  });

  it('всадник дороже любого пешего и в ресурсах, и в снаряжении', () => {
    const rider = TROOP_BY_ID.rider;
    const gearCount = (id: (typeof TROOP_IDS)[number]): number =>
      Object.values(TROOP_BY_ID[id].gear).reduce((n, v) => n + (v ?? 0), 0);
    const foot = TROOP_IDS.filter((id) => id !== 'rider' && id !== 'legionary');
    for (const id of foot) {
      const def = TROOP_BY_ID[id];
      expect(Object.values(rider.cost).reduce((a, b) => a + b, 0)).toBeGreaterThan(
        Object.values(def.cost).reduce((a, b) => a + b, 0),
      );
      expect(gearCount('rider')).toBeGreaterThanOrEqual(gearCount(id));
      expect(rider.work).toBeGreaterThan(def.work);
    }
  });

  it('кольцо работает в обе стороны: конница племени режет лучников и вязнет в копьях', () => {
    // Отряды одной мощи, поэтому сравнивать размен честно.
    const riders = armyOf({ rider: 100 });
    const archers = armyOf({ archer: 280 });
    const spears = armyOf({ spearman: 350 }, 'anti-cavalry');
    expect(meanRatio(riders, archers)).toBeGreaterThan(RATIO_EVEN);
    expect(meanRatio(riders, spears)).toBeLessThan(1 / RATIO_EVEN);
  });

  it('план «кавалерийский удар» и кавалерийские приказы становятся живыми', () => {
    const f = presetFormation({ rider: 40, spearman: 60 }, 'standard');
    expect(kindsPresent(placedTroops(f))).toContain('cavalry');
    const strike = toArmySetup({ ...f, plan: 'cavalry-strike' });
    expect(validateSetup(strike)).toBeNull();
    expect(strike.sectors.R.cavalry + SECTORS.reduce((n, id) => n + strike.sectors[id].cavalry, 0)).toBeGreaterThan(0);
  });
});
