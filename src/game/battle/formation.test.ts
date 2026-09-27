// Расстановка не должна терять людей. Это главное обещание панели подготовки:
// сумма по шести секторам, резерву и оставленным дома равна гарнизону — иначе
// игрок отправит половину армии в никуда и не поймёт почему.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SECTORS,
  UNIT_KINDS,
  simulateBattle,
  stackTotal,
  validateSetup,
  type ArmySetup,
} from '@/battle';
import { RATIO_EVEN } from '@/battle/bench';
import { createInitialState } from '../state';
import { wageOf } from '../derived';
import { TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import {
  clampFormation,
  cloneFormation,
  emptyFormation,
  placedTroops,
  deployFormation,
  stashUnplaced,
  toArmySetup,
  unplacedTroops,
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
  weightOf,
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
    const lost = troopLosses(sent, { spear: 0, infantry: 6, archer: 0, cavalry: 0, heavy: 0 });
    expect(lost.clubman).toBe(4);
    expect(lost.legionary ?? 0).toBe(0);
    const left = troopsAfter(sent, lost);
    expect(left.legionary).toBe(2);
    expect(left.clubman ?? 0).toBe(0);
  });

  it('потери больше отряда его не переворачивают', () => {
    const sent: TroopStack = { clubman: 3 };
    const lost = troopLosses(sent, { spear: 0, infantry: 999, archer: 0, cavalry: 0, heavy: 0 });
    expect(lost.clubman).toBe(3);
    expect(troopTotal(troopsAfter(sent, lost))).toBe(0);
  });
});

describe('расстановка не теряет войска', () => {
  it('правило развёртывания раскладывает весь состав целиком', () => {
    // Раскладка обороны начинается правилом развёртывания (docs/battle_eu4.md, 14.5): бойцы племени
    // раскладываются по его секторам в той же пропорции, и не теряется ни один — ни в малом отряде,
    // ни в том, что шире трёх полос (там лишние уходят в резерв).
    for (const troops of [GARRISON, { ...GARRISON, clubman: 600, archer: 500 }]) {
      const f = deployFormation(troops);
      const placed = placedTroops(f);
      for (const t of TROOP_IDS) expect(placed[t] ?? 0, t).toBe(troops[t] ?? 0);
      expect(troopTotal(unplacedTroops(troops, f))).toBe(0);
    }
  });

  it('сумма по секторам плюс оставленные дома равна гарнизону', () => {
    const take: TroopStack = { clubman: 4, spearman: 6, archer: 2 };
    const f = deployFormation(take);
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
    const f = deployFormation(GARRISON);
    const { formation, extra } = clampFormation(f, { spearman: 4, clubman: 6, archer: 5, axeman: 3, legionary: 9 });
    expect(placedTroops(formation).spearman).toBe(4);
    // Семерых новых латников расстановка не знает — они лишние.
    expect(extra.legionary).toBe(7);
  });
});

describe('расстановка для ядра боя', () => {
  it('ядро принимает её без нареканий, и людей столько же', () => {
    for (const troops of [GARRISON, { ...GARRISON, clubman: 600, archer: 500 }]) {
      const setup = toArmySetup(deployFormation(troops));
      expect(validateSetup(setup)).toBeNull();
      const men = SECTORS.reduce((n, id) => n + stackTotal(setup.sectors[id]), 0);
      expect(men).toBe(stackTotal(kindsOf(troops)));
    }
  });

  it('людей из ниоткуда нет: в бой идёт ровно тот состав, что стоит, и ополчение — у моста нет входа героя', () => {
    // Поставка 1 боя (docs/battle_eu4.md, 14.5, новый тест 13; 14.19.6): прибавка героя ушла, и ни один
    // вход моста больше не приводит в бой людей сверх отряда и ополчения. Точка внутри области: в составе
    // все рода, какие у племени есть, и ополчение обоих видов — иначе «сверх» было бы нечему прибавиться.
    const troops: TroopStack = { ...GARRISON, rider: 3, knight: 2 };
    for (const k of OWN_KINDS) expect(kindsOf(troops)[k], `род ${k} в составе`).toBeGreaterThan(0);
    const f = emptyFormation();
    f.sectors.A = { clubman: 6, spearman: 8, rider: 3 };
    f.sectors.B = { axeman: 3, legionary: 2, knight: 2 };
    f.sectors.E = { archer: 5 };
    const setup = toArmySetup(f, 12, 5);
    const men = SECTORS.reduce((n, id) => n + stackTotal(setup.sectors[id]), 0);
    expect(men, 'в бою ровно отряд и ополчение').toBe(stackTotal(kindsOf(troops)) + 12 + 5);
    // Замок по исходнику: входы перевода — расстановка, ополчение двух видов и стойкость, и больше ничего.
    const src = readFileSync(new URL('./formation.ts', import.meta.url), 'utf8');
    const head = src.slice(src.indexOf('export function toArmySetup('), src.indexOf('): ArmySetup {', src.indexOf('export function toArmySetup(')));
    const params = [...head.matchAll(/^\s+(\w+)\s*[:=]/gm)].map((m) => m[1]);
    expect(params, 'входы toArmySetup').toEqual(['f', 'militia', 'militiaArchers', 'resolve']);
  });

  it('ополчение встаёт во фронт само, а не в резерв игрока', () => {
    // Раскладка обороны игрока до поставки 2: ополчение ложится во фронт поровну. Что шире W, ядро
    // уводит в резерв стороны само — как у всех (docs/battle_eu4.md, 14.5); резерв-блока игрока
    // ополчение не занимает.
    const setup = toArmySetup(deployFormation({ spearman: 4 }), 30);
    const front = setup.sectors.A.infantry + setup.sectors.B.infantry + setup.sectors.C.infantry;
    expect(front).toBe(30);
    expect(stackTotal(setup.sectors.R)).toBe(0);
  });

  it('раскладка, сохранённая до поставки 1 с планом, приказами и резервом, читается одними секторами', () => {
    const old = { ...deployFormation(GARRISON), plan: 'envelop', orders: { cavalry: 'charge' }, reserve: { kind: 'weakest' } };
    const copy = cloneFormation(old);
    expect(Object.keys(copy)).toEqual(['sectors']);
    expect(validateSetup(toArmySetup(copy))).toBeNull();
    expect(Object.keys(toArmySetup(copy)).sort()).toEqual(['gear', 'resolve', 'sectors']);
  });
});


// ---------- Конница племени ----------
//
// Без конного вида половина боевой системы у игрока мертва: угол кольца «конница
// бьёт лучников». У чужих гарнизонов конница есть всегда, поэтому кольцо обязано
// работать в обе стороны — это и проверяется здесь настоящими боями.

/** Отряд племени, вставший по правилу развёртывания, в том виде, в каком его видит ядро. */
const armyOf = (troops: TroopStack): ArmySetup => toArmySetup(deployFormation(troops));

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
  it('всадник выходит лёгкой конницей, латный — тяжёлой, и все пять родов игроку доступны', () => {
    expect(kindsOf({ rider: 10 }).cavalry).toBe(menOf('rider', 10));
    expect(kindsOf({ rider: 10 }).infantry).toBe(0);
    // Класс решает доспех, а не таблица рядом: тот же конь под доспехом — уже тяжёлая конница.
    expect(kindsOf({ knight: 10 }).heavy).toBe(menOf('knight', 10));
    expect(kindsOf({ knight: 10 }).cavalry).toBe(0);
    // Пустых родов у племени не осталось: все пять родов ядра у игрока есть.
    expect([...OWN_KINDS].sort()).toEqual([...UNIT_KINDS].sort());
  });

  it('копьё и щит всадника поднимают его ступень снаряжения выше дубинщика', () => {
    expect(gearOfTroop('rider')).toBe(2);
    expect(gearOfTroop('rider')).toBeGreaterThan(gearOfTroop('clubman'));
    expect(gearOf({ rider: 5 }).cavalry).toBe(2);
  });

  it('конница дороже пеших своего веса: конь, учения и жалованье за снаряжение', () => {
    const gearCount = (id: (typeof TROOP_IDS)[number]): number =>
      Object.values(TROOP_BY_ID[id].gear).reduce((n, v) => n + (v ?? 0), 0);
    const s = createInitialState(7);
    // Граница: сравниваем с пешими того же веса в строю — иначе «дороже» сошлось бы даром.
    const foot = TROOP_IDS.filter((id) => !TROOP_BY_ID[id].mounted && weightOf(id) <= weightOf('rider'));
    expect(foot.length).toBeGreaterThan(3);
    for (const id of foot) {
      const def = TROOP_BY_ID[id];
      expect(TROOP_BY_ID.rider.work, `учения: ${id}`).toBeGreaterThan(def.work);
      // Доспех — вещь, и за неё платят: латный всадник дороже своего же лёгкого по жалованью.
      expect(wageOf(s, 'knight'), `жалованье: ${id}`).toBeGreaterThan(wageOf(s, id));
    }
    expect(wageOf(s, 'knight')).toBeGreaterThan(wageOf(s, 'rider'));
    expect(gearCount('knight')).toBe(gearCount('rider') + 1);
  });

  it('кольцо работает в обе стороны: конница племени режет лучников и вязнет в копьях', () => {
    // Отряды одной мощи, поэтому сравнивать размен честно.
    const riders = armyOf({ rider: 100 });
    const archers = armyOf({ archer: 280 });
    const spears = armyOf({ spearman: 350 });
    expect(meanRatio(riders, archers)).toBeGreaterThan(RATIO_EVEN);
    expect(meanRatio(riders, spears)).toBeLessThan(1 / RATIO_EVEN);
  });

});
