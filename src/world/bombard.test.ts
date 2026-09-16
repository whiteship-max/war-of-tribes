// Обстрел лагеря с башни — чистые правила (`world/bombard.ts`).
import { describe, expect, it } from 'vitest';
import { seeded } from '@/game/sim/random';
import { aimOf, firePlan, reaim, thinAt, type Aim, type Fire, type TowerGun } from './bombard';
import { sideWorks, type WoodPlan } from './works';
import { CAMP_WOOD, CAMP_WORKS_RIPE } from './data/tuning';

const SINCE = 1_700_000_000_000;
const MIN = 60_000;
const CATAPULT: TowerGun = { slow: 2 / 7, thin: 0.1, crew: 4, seats: 4 };
const BALLISTA: TowerGun = { slow: 0, thin: 0.2, crew: 1, seats: 2 };

describe('обстрел: сила от расчёта', () => {
  it('орудие бьёт долей расчёта, и места на башне — потолок расчёта', () => {
    expect(aimOf(CATAPULT, 0), 'лучников дома нет — башня молчит').toEqual({ slow: 0, thin: 0 });
    expect(aimOf(undefined, 50), 'орудия нет — башня молчит').toEqual({ slow: 0, thin: 0 });
    expect(aimOf(CATAPULT, 40), 'полный расчёт').toEqual({ slow: 2 / 7, thin: 0.1 });
    const half = aimOf(CATAPULT, 2);
    expect(half.slow).toBeCloseTo(1 / 7, 12);
    expect(half.thin).toBeCloseTo(0.05, 12);
    // Лучников сорок, а мест два: встанет двое — половина расчёта, а не полный.
    const seatsShort = aimOf({ ...CATAPULT, seats: 2 }, 40);
    expect(seatsShort.thin, 'мест меньше расчёта').toBeCloseTo(0.05, 12);
    expect(aimOf(BALLISTA, 1), 'балисте хватает одного').toEqual({ slow: 0, thin: 0.2 });
  });
});

describe('обстрел: выбитое копится на часах рогаток и не встаёт', () => {
  it('растёт ровно со временем до потолка, дальше не растёт', () => {
    const fire: Fire = { slow: 0, thin: 0.2, at: SINCE, base: 0 };
    let prev = -1;
    // Область: от постановки до вдвое дальше дозревания — и рост, и потолок.
    for (let m = 0; m <= 2 * (CAMP_WORKS_RIPE / MIN); m++) {
      const t = SINCE + m * MIN;
      expect(t, 'точка внутри области').toBeLessThanOrEqual(SINCE + 2 * CAMP_WORKS_RIPE);
      const v = thinAt(fire, t);
      expect(v, `${m} мин: не убывает`).toBeGreaterThanOrEqual(prev);
      expect(v, `${m} мин: не выше потолка`).toBeLessThanOrEqual(0.2 + 1e-12);
      if (m * MIN <= CAMP_WORKS_RIPE) expect(v, `${m} мин: ровно со временем`).toBeCloseTo((0.2 * m * MIN) / CAMP_WORKS_RIPE, 12);
      prev = v;
    }
    expect(thinAt(fire, SINCE + CAMP_WORKS_RIPE)).toBeCloseTo(0.2, 12);
    expect(thinAt(undefined, SINCE + CAMP_WORKS_RIPE), 'без обстрела').toBe(0);
  });

  it('катапульта замедляет только рогатки со стороны города', () => {
    const fire: Fire = { slow: 2 / 7, thin: 0.1, at: SINCE, base: 0 };
    const plan = firePlan(fire, undefined)!;
    expect(plan.front).toBeCloseTo(CAMP_WOOD.front * (5 / 7), 12);
    expect(plan.rear).toBe(CAMP_WOOD.rear);
    // Пока фронт не дозрел ни с обстрелом, ни без, тыл растёт одинаково: орудие его не достаёт.
    for (let m = 0; m < CAMP_WORKS_RIPE / MIN; m++) {
      const t = SINCE + m * MIN;
      expect(sideWorks(SINCE, t, 'front', CAMP_WOOD), `${m} мин: фронт без обстрела ещё не дозрел`).toBeLessThan(1);
      expect(sideWorks(SINCE, t, 'rear', plan), `${m} мин: тыл`).toBeCloseTo(sideWorks(SINCE, t, 'rear', CAMP_WOOD), 12);
      expect(sideWorks(SINCE, t, 'front', plan), `${m} мин: фронт`).toBeCloseTo(sideWorks(SINCE, t, 'front', CAMP_WOOD) * (5 / 7), 12);
    }
    expect(firePlan({ ...fire, slow: 0 }, undefined), 'балиста план не трогает').toBeUndefined();
  });
});

describe('обстрел: смена силы не переписывает прошлое', () => {
  const aims: Aim[] = [
    { slow: 0, thin: 0 },
    { slow: 0, thin: 0.2 },
    { slow: 2 / 7, thin: 0.1 },
    { slow: 1 / 7, thin: 0.05 },
  ];

  it('в минуту смены выбитое и построенное те же, а дальше не убывают ни на каком пути смен', () => {
    const rnd = seeded(20260916);
    for (let path = 0; path < 300; path++) {
      let fire: Fire | undefined;
      let wood: WoodPlan | undefined;
      const stops = [0, 1, 2].map(() => SINCE + Math.floor(rnd() * 50) * MIN).sort((a, b) => a - b);
      let prevThin = 0;
      let prevFront = 0;
      let prevRear = 0;
      for (let m = 0; m <= 60; m++) {
        const t = SINCE + m * MIN;
        for (const stop of stops) {
          if (stop !== t) continue;
          const beforeThin = thinAt(fire, t);
          const beforeFront = sideWorks(SINCE, t, 'front', firePlan(fire, wood) ?? CAMP_WOOD);
          const beforeRear = sideWorks(SINCE, t, 'rear', firePlan(fire, wood) ?? CAMP_WOOD);
          const next = reaim(fire, wood, SINCE, t, aims[Math.floor(rnd() * aims.length)]);
          fire = next.fire;
          wood = next.wood;
          expect(thinAt(fire, t), `путь ${path}, ${m} мин: выбитое в минуту смены`).toBeCloseTo(beforeThin, 12);
          expect(sideWorks(SINCE, t, 'front', firePlan(fire, wood) ?? CAMP_WOOD), `путь ${path}, ${m} мин: фронт`).toBeCloseTo(beforeFront, 12);
          expect(sideWorks(SINCE, t, 'rear', firePlan(fire, wood) ?? CAMP_WOOD), `путь ${path}, ${m} мин: тыл`).toBeCloseTo(beforeRear, 12);
        }
        const thin = thinAt(fire, t);
        const plan = firePlan(fire, wood) ?? CAMP_WOOD;
        const front = sideWorks(SINCE, t, 'front', plan);
        const rear = sideWorks(SINCE, t, 'rear', plan);
        expect(thin, `путь ${path}, ${m} мин: выбитые не встают`).toBeGreaterThanOrEqual(prevThin - 1e-12);
        expect(front, `путь ${path}, ${m} мин: фронт не рушится`).toBeGreaterThanOrEqual(prevFront - 1e-12);
        expect(rear, `путь ${path}, ${m} мин: тыл не рушится`).toBeGreaterThanOrEqual(prevRear - 1e-12);
        prevThin = thin;
        prevFront = front;
        prevRear = rear;
      }
    }
  });

  it('та же сила — окно не трогается вовсе', () => {
    const fire: Fire = { slow: 2 / 7, thin: 0.1, at: SINCE, base: 0 };
    const same = reaim(fire, undefined, SINCE, SINCE + 10 * MIN, { slow: 2 / 7, thin: 0.1 });
    expect(same.fire).toBe(fire);
    expect(same.wood).toBeUndefined();
    expect(reaim(undefined, undefined, SINCE, SINCE, { slow: 0, thin: 0 })).toEqual({ fire: undefined, wood: undefined });
  });
});
