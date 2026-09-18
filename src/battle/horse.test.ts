// Два конных рода — две половины прежнего конного профиля (docs/stable.md, решение 2).
//
// До конюшни конный род был один, и в его числах жили две разные вещи: скорость (лучники, фланг,
// погоня, быстрая цель для стрел) и вес (рукопашная, стойкость, пехота в лоб). Правило раскола
// такое: каждое число прежнего профиля досталось хотя бы одному из двух родов, а на месте
// недоставшейся половины у рода стоит число, которое в конфиге уже есть у пешего рода на той же
// оси. Своего числа у классов нет — иначе раскол был бы подбором, а не правилом.
//
// Прежний профиль ниже записан литералом и не правится: это история (коммит 729d510, конфиг боя
// до конюшни), а не настройка. Удар с разбега (`CLASH_CAVALRY_IMPACT`) — константа ядра, а не
// число рода, и сюда не входит: у лёгкой его нет, у тяжёлой он есть (`sim.ts`).
import { describe, expect, it } from 'vitest';
import { COUNTER, FOOT_FLANK, RETREAT, TEMPER, UNIT_STATS } from './config';
import { HORSE_KINDS, type CavalryOrder, type UnitKind } from './types';
import { quickSetup } from './setup';
import { simulateBattle } from './sim';

/** Оси профиля: где число лежит у конного рода и где у пеших — те же по смыслу оси. */
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
  { name: 'рукопашная', prior: 1.3, of: (k) => UNIT_STATS[k].melee, foot: () => FOOT.map((k) => UNIT_STATS[k].melee) },
  { name: 'стойкость', prior: 1.1, of: (k) => UNIT_STATS[k].toughness, foot: () => FOOT.map((k) => UNIT_STATS[k].toughness) },
  { name: 'скорость', prior: 3, of: (k) => UNIT_STATS[k].speed, foot: () => FOOT.map((k) => UNIT_STATS[k].speed) },
  { name: 'мораль', prior: 65, of: (k) => UNIT_STATS[k].morale, foot: () => FOOT.map((k) => UNIT_STATS[k].morale) },
  { name: 'по лучникам', prior: 2.0, of: (k) => COUNTER[k].archer, foot: () => [COUNTER.infantry.all] },
  { name: 'во фланг', prior: 1.8, of: (k) => COUNTER[k].flank, foot: () => [FOOT_FLANK] },
  { name: 'по сомкнутым копьям', prior: 0.5, of: (k) => COUNTER[k].spearClosed, foot: () => [] },
  { name: 'по пехоте', prior: 1.3, of: (k) => COUNTER[k].infantry, foot: () => [COUNTER.infantry.all] },
  { name: 'лучники по ней', prior: 0.7, of: (k) => COUNTER.archer[k], foot: () => [COUNTER.archer.infantry, COUNTER.archer.spear] },
  { name: 'на разгоне', prior: 0.6, of: (k) => TEMPER[k].charging, foot: tempers },
  { name: 'остановленная', prior: 1.3, of: (k) => TEMPER[k].stalled, foot: tempers },
  { name: 'в ожидании', prior: 1.0, of: (k) => TEMPER[k].waiting, foot: tempers },
  { name: 'погоня', prior: 0.15, of: (k) => RETREAT.pursuitKills[k], foot: () => FOOT.map((k) => RETREAT.pursuitKills[k]) },
];

const CLASSES = ['cavalry', 'heavy'] as const;

describe('два конных рода — две половины прежнего профиля', () => {
  it('конных родов ровно два, и это те, что меряются здесь', () => {
    expect([...HORSE_KINDS].sort()).toEqual([...CLASSES].sort());
  });

  it('у классов нет своих чисел: каждое — прежнее или пешего рода на той же оси', () => {
    for (const axis of AXES) {
      const allowed = new Set([axis.prior, ...axis.foot()]);
      for (const k of CLASSES) expect(allowed.has(axis.of(k)), `${k}, ${axis.name}: ${axis.of(k)}`).toBe(true);
    }
  });

  it('прежний профиль не потерян: каждое его число досталось хотя бы одному роду', () => {
    for (const axis of AXES) {
      expect(CLASSES.map((k) => axis.of(k)), axis.name).toContain(axis.prior);
    }
  });

  it('и ни один род не унёс профиль целиком: половины настоящие', () => {
    // Граница: у каждого рода хоть одна ось закрыта пешим числом — иначе «половина» была бы
    // прежним родом под новым именем, а два правила выше проходили бы даром.
    for (const k of CLASSES) {
      const given = AXES.filter((a) => a.of(k) !== a.prior).map((a) => a.name);
      expect(given.length, `${k} отдал другому роду хоть что-нибудь`).toBeGreaterThan(0);
    }
  });
});

describe('приказ конному роду — только своему', () => {
  it('приказ рода, которого в армии нет, не меняет боя: латные в резерве не берут манёвр лёгкой', () => {
    // Пехота во фронте, латные в резерве с «атаковать сразу». Лёгкой в армии нет, значит её
    // приказ — пустое поле: «бить лучников» и «атаковать сразу» у неё обязаны дать один бой.
    const army = { infantry: 200, spear: 100, heavy: 300 };
    const foe = quickSetup({ infantry: 250, archer: 250, spear: 100 });
    let committed = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const withOrder = (cavalry: CavalryOrder) => quickSetup(army, { orders: { spear: 'hold-line', infantry: 'hold-center', archer: 'nearest', cavalry, heavy: 'charge' } });
      const a = simulateBattle({ seed, attacker: withOrder('attack-archers'), defender: foe });
      const b = simulateBattle({ seed, attacker: withOrder('charge'), defender: foe });
      // Граница: латные действительно стоят в резерве и резерв вводится — иначе манёвр не спрашивается.
      expect(withOrder('charge').sectors.R.heavy).toBe(300);
      if (b.log.some((e) => e.id === 'reserve-committed' && e.side === 'attacker')) committed++;
      expect(a.sides.attacker.total.losses, `сид ${seed}`).toBe(b.sides.attacker.total.losses);
      expect(a.sides.defender.total.losses, `сид ${seed}`).toBe(b.sides.defender.total.losses);
    }
    expect(committed, 'резерв вводился хоть в одном бою').toBeGreaterThan(0);
  });
});
