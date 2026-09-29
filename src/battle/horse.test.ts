// Два конных рода — один конь, и делит их доспех (docs/stable.md, решение 2; пересмотр баланса — docs/battle_eu4.md, 14.35).
//
// До конюшни конный род был один, и в его числах жили две разные вещи: скорость (быстрая цель для стрел, погоня) и вес
// (натиск, броня). Правило раскола — своих чисел у классов нет: на каждой оси, которой не выражают показатели, число
// класса — либо прежнего конного профиля, либо пешего рода на той же оси. Прежний профиль ниже записан литералом и не
// правится: это история (коммит 729d510, конфиг боя до конюшни), а не настройка.
//
// С пересмотра баланса (слово владельца по 14.35, пп. 2 и 6) вес тяжёлой — её показатели: конь (натиск и страх, общие с
// лёгкой, `KIND_PROFILE`) и доспех (вещь, `ArmySetup.kit`). Оси кольца («по лучникам», «во фланг», «по сомкнутым копьям»,
// «по пехоте», «лучники по ней») ушли с кольцом, «остановленная» — со слабостью конницы в сече, «стойкость» — в показатели
// защиты. Тест «прежний профиль не потерян: каждое его число досталось хотя бы одному роду» снят тем же словом: рукопашная
// 1.3 прежнего профиля — вес, и он теперь показателями, а не числом рода.
import { describe, expect, it } from 'vitest';
import { KIND_PROFILE, RETREAT, TEMPER, UNIT_STATS } from './config';
import { HORSE_KINDS, type UnitKind } from './types';

/** Оси профиля, которых показатели не выражают: где число лежит у конного рода и где у пеших. */
interface Axis {
  name: string;
  /** Прежний конный профиль, 729d510. */
  prior: number;
  of: (kind: 'cavalry' | 'heavy') => number;
  /** Числа пеших родов на той же оси: ими класс закрывает недоставшуюся половину. */
  foot: () => number[];
}

const FOOT: UnitKind[] = ['spear', 'infantry', 'archer'];
const tempers = (): number[] =>
  [TEMPER.spear, TEMPER.infantry, TEMPER.archer].flatMap((t) => Object.values(t) as number[]);

const AXES: Axis[] = [
  { name: 'сила в натиске', prior: 1.3, of: (k) => UNIT_STATS[k].melee, foot: () => FOOT.map((k) => UNIT_STATS[k].melee) },
  { name: 'скорость', prior: 3, of: (k) => UNIT_STATS[k].speed, foot: () => FOOT.map((k) => UNIT_STATS[k].speed) },
  { name: 'мораль', prior: 65, of: (k) => UNIT_STATS[k].morale, foot: () => FOOT.map((k) => UNIT_STATS[k].morale) },
  { name: 'в обходе', prior: 0.6, of: (k) => TEMPER[k].charging, foot: tempers },
  { name: 'в строю', prior: 1.0, of: (k) => TEMPER[k].waiting, foot: tempers },
  { name: 'погоня', prior: 0.15, of: (k) => RETREAT.pursuitKills[k], foot: () => FOOT.map((k) => RETREAT.pursuitKills[k]) },
];

const CLASSES = ['cavalry', 'heavy'] as const;

describe('два конных рода — один конь, делит их доспех', () => {
  it('конных родов ровно два, и это те, что меряются здесь', () => {
    expect([...HORSE_KINDS].sort()).toEqual([...CLASSES].sort());
  });

  it('у классов нет своих чисел: каждое — прежнее или пешего рода на той же оси', () => {
    for (const axis of AXES) {
      const allowed = new Set([axis.prior, ...axis.foot()]);
      for (const k of CLASSES) expect(allowed.has(axis.of(k)), `${k}, ${axis.name}: ${axis.of(k)}`).toBe(true);
    }
  });

  it('конь у обоих один: натиск и страх коня в показателях рода одинаковы, как и сила в натиске и характер', () => {
    expect(KIND_PROFILE.heavy.shockAtk).toBe(KIND_PROFILE.cavalry.shockAtk);
    expect(KIND_PROFILE.heavy.moraleAtk).toBe(KIND_PROFILE.cavalry.moraleAtk);
    expect(KIND_PROFILE.cavalry.shockAtk, 'конь даёт натиск').toBeGreaterThan(0);
    expect(UNIT_STATS.heavy.melee).toBe(UNIT_STATS.cavalry.melee);
    expect(TEMPER.heavy).toEqual(TEMPER.cavalry);
  });

  it('и половины настоящие: лёгкая — быстрая цель и скорость, тяжёлая — без них (её вес — доспех, вещь)', () => {
    // Граница: у каждого рода хоть одна ось своя — иначе «половина» была бы прежним родом под новым именем.
    expect(UNIT_STATS.cavalry.speed, 'лёгкая быстрее').toBeGreaterThan(UNIT_STATS.heavy.speed);
    expect(KIND_PROFILE.cavalry.fireDef, 'лёгкая — быстрая цель').toBeGreaterThan(KIND_PROFILE.heavy.fireDef);
    for (const k of CLASSES) {
      const given = AXES.filter((a) => a.of(k) !== a.prior).map((a) => a.name);
      expect(given.length, `${k} отдал другому роду хоть что-нибудь`).toBeGreaterThan(0);
    }
  });
});
