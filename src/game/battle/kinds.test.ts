// Перевод бойцов племени в роды боя — единственный мост из видов, которые игрок нанимает, в роды, которыми
// считает ядро (`kinds.ts`). Прежде здесь же жила расстановка обороны по секторам (`formation.ts`); с поставкой 2
// боя она ушла — у частокола строй раскладывает правило, как любой бой (docs/battle_eu4.md, 14.27), — и отряд
// племени входит в бой так же, как в мире: правилом развёртывания по родам (`deploySetup(kindsOf(…))`).
import { describe, expect, it } from 'vitest';
import { UNIT_KINDS, type UnitKind } from '@/battle';
import { createInitialState } from '../state';
import { wageOf } from '../derived';
import { TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import { KIND_PROFILE, STAT_IDS } from '@/battle';
import {
  KIND_OF,
  OWN_KINDS,
  profileOfTroop,
  gearOf,
  gearOfTroop,
  powerWeight,
  troopTotal,
  troopsAfter,
  type TroopStack,
} from './kinds';
import { battleWeight, kindsOf, menOf, troopLosses } from './price';

const GARRISON: TroopStack = { clubman: 6, spearman: 8, archer: 5, axeman: 3, legionary: 2 };

describe('перевод бойцов племени в роды боя', () => {
  it('дубинщик — единица измерения строя, вид весит своей ценой', () => {
    // Вес в бою — из цены (путь П2, 14.35): голов на бойцов строя — содержание вида к содержанию дубинщика.
    expect(menOf('clubman', 1)).toBe(1);
    for (const id of TROOP_IDS) expect(menOf(id, 100), id).toBe(Math.round(100 * battleWeight(id)));
    // Ноль людей — ноль строя; один человек — хотя бы один боец строя.
    expect(menOf('legionary', 0)).toBe(0);
    expect(menOf('clubman', 1)).toBeGreaterThanOrEqual(1);
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
    const foot = TROOP_IDS.filter((id) => !TROOP_BY_ID[id].mounted && powerWeight(id) <= powerWeight('rider'));
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

  // Тест «кольцо работает в обе стороны: конница племени режет лучников и вязнет в копьях» снят словом владельца по 14.35
  // (docs/battle_eu4.md, п. 2): кольца контрров нет, и обещания пар «конница бьёт лучников», «копья бьют конницу» — тоже.
  // Кто кого бьёт, решают показатели вида (таблица ниже).

});

describe('показатели вида — показатели его рода', () => {
  // Слово владельца по 14.35 (путь П2): вещи идут в бой только через цену вида и его вес (`price.battleWeight`), своих
  // показателей у них нет. Тесты «вещи стороны — средним по людям строя каждого рода», «род и вещи дают ровно эту таблицу —
  // у каждого из девяти видов» и «вид — сумма рода и вещей» сняты вместе с показателями вещей (`ITEM_PIPS`, `kitOf`,
  // `ArmySetup.kit`); таблица видов с вещами (eacd622) сменилась таблицей рода ниже — её владелец велел не трогать.
  // Столбцы: огонь нападение/защита, натиск нападение/защита, мораль нападение/защита.
  const KIND_TABLE: Record<UnitKind, [number, number, number, number, number, number]> = {
    spear: [0, 0, 0, 1, 0, 0],
    infantry: [0, 0, 0, 0, 0, 0],
    archer: [1, 1, 0, 0, 0, 0],
    cavalry: [0, 1, 1, 0, 1, 0],
    heavy: [0, 0, 1, 0, 1, 0],
  };

  it('таблица рода — ровно эта: входные данные дизайна, заданные один раз', () => {
    expect(Object.keys(KIND_TABLE).sort()).toEqual([...UNIT_KINDS].sort());
    for (const k of UNIT_KINDS) expect(STAT_IDS.map((stat) => KIND_PROFILE[k][stat]), k).toEqual(KIND_TABLE[k]);
  });

  it('у каждого из девяти видов показатели — его рода: вещи своих не дают', () => {
    for (const id of TROOP_IDS) expect(profileOfTroop(id), id).toEqual(KIND_PROFILE[KIND_OF[id]]);
  });
});
