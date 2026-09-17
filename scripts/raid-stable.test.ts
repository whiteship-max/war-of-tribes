// Подстановка класса конницы в разделе «Конюшня» (`raid-stable.ts`) держится на двух обещаниях.
//
// **Возвращает конфиг на место.** Раздел идёт внутри `raid:report` одним процессом с другими, и конфиг боя,
// оставленный подменённым, молча сдвинул бы каждый следующий раздел — даже если замер упал посреди подстановки.
//
// **У классов нет своих чисел.** Правило класса — выбрать, какая половина нынешнего конного рода ему достаётся;
// число, которого в конфиге боя нет, было бы подбором, а не правилом.
import { describe, expect, it } from 'vitest';
import { COUNTER, FOOT_FLANK, RETREAT, TEMPER, UNIT_STATS } from '@/battle';
import { TROOP_BY_ID } from '@/game/data/troops';
import { HEAVY, LIGHT, TODAY, withCavalry, type CavProfile } from './raid-stable';

/** Всё, что подстановка переписывает, — одной строкой. */
const touched = (): string =>
  JSON.stringify([UNIT_STATS.cavalry, COUNTER.cavalry, COUNTER.archer.cavalry, TEMPER.cavalry, RETREAT.pursuitKills.cavalry, TROOP_BY_ID.rider.gear]);

/** Все числа профиля боя (кроме снаряжения — это предметы, а не числа ядра). */
const numbersOf = (p: CavProfile): number[] => [
  ...Object.values(p.stats),
  ...Object.values(p.counter),
  p.archerVs,
  ...Object.values(p.temper),
  p.pursuit,
];

/** Все числа, которые в конфиге боя стоят у родов, кольца, характера и преследования. */
function configNumbers(): Set<number> {
  const out = new Set<number>([FOOT_FLANK]);
  const walk = (v: unknown): void => {
    if (typeof v === 'number') out.add(v);
    else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(UNIT_STATS);
  walk(COUNTER);
  walk(TEMPER);
  walk(RETREAT.pursuitKills);
  return out;
}

describe('подстановка класса конницы', () => {
  it('конфиг возвращается на место, даже если замер упал посреди подстановки', () => {
    const before = touched();
    for (const p of [LIGHT, HEAVY]) {
      expect(() =>
        withCavalry(p, () => {
          // Граница: внутри подстановки конфиг действительно другой — иначе «вернулся» проверялось бы даром.
          expect(touched(), `${p.name}: внутри подстановки`).not.toBe(before);
          throw new Error('замер упал');
        }),
      ).toThrow('замер упал');
      expect(touched(), `${p.name}: конфиг вернулся`).toBe(before);
    }
  });

  it('у классов нет чисел, которых нет в конфиге боя', () => {
    const known = configNumbers();
    for (const p of [LIGHT, HEAVY]) {
      const own = numbersOf(p);
      // Граница: профиль не пуст и отличается от нынешнего — проверяются настоящие числа класса.
      expect(own.length, p.name).toBeGreaterThan(10);
      expect(own, p.name).not.toEqual(numbersOf(TODAY));
      for (const n of own) expect(known.has(n), `${p.name}: число ${n}`).toBe(true);
    }
  });
});
