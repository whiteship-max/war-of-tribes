// Расстановка не должна терять людей. Это главное обещание панели подготовки:
// сумма по шести секторам, резерву и оставленным дома равна гарнизону — иначе
// игрок отправит половину армии в никуда и не поймёт почему.
import { describe, expect, it } from 'vitest';
import { SECTORS, UNIT_KINDS, stackTotal, validateSetup, QUICK_PRESET_IDS } from '@/battle';
import { TROOP_IDS } from '../data/troops';
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
import { BATTLE_MAN, gearOf, kindsOf, menOf, troopLosses, troopTotal, troopsAfter, type TroopStack } from './kinds';

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
