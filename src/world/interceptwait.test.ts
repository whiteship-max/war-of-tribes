// Перехват цели, которая ещё не вышла (MAP-6, docs/audit/WORKPLAN.md; архив round1/world/prove-5-1). `intercept` решал
// уравнение так, будто цель идёт уже сейчас: до выхода она стоит у `from`, а встреча выходила там, куда погоня не успевает
// (точка на пути цели — да, но расстояние до неё больше, чем погоня проходит к названной минуте).
import { describe, expect, it } from 'vitest';
import { intercept, positionAt, type Moving } from './pursuit';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('перехват до выхода цели (MAP-6)', () => {
  const NOW = 1_000_000;
  const SPEED = 1 / 1000; // клетка в секунду

  it('на решётке: погоня успевает в названную точку ровно к названной минуте, и цель там же', () => {
    let checked = 0;
    for (const lead of [0, 2_000, 10_000, 40_000]) {
      for (const cx of [-30, -5, 0, 12, 40]) {
        for (const cy of [-20, 0, 15]) {
          for (const tspeed of [0.3, 0.8, 1.5]) {
            const target: Moving = { from: { x: 0, y: 0 }, to: { x: 60, y: 0 }, departAt: NOW + lead, arriveAt: NOW + lead + 60_000 / tspeed };
            const chaser = { x: cx, y: cy };
            const m = intercept(chaser, SPEED, target, NOW);
            if (!m) continue;
            if (lead > 0) checked++;
            expect(dist(m.at, positionAt(target, m.time)), 'цель в точке встречи').toBeLessThan(1e-6);
            expect(dist(chaser, m.at), `погоня успевает: lead ${lead}, (${cx},${cy}), ${tspeed}`).toBeLessThanOrEqual(SPEED * (m.time - NOW) + 1e-6);
            expect(m.time).toBeLessThanOrEqual(target.arriveAt);
          }
        }
      }
    }
    expect(checked, 'точки внутри области: встречи до выхода цели есть').toBeGreaterThan(20);
  });

  it('погоня у `from` раньше выхода — встреча там же, в минуту прихода погони', () => {
    const target: Moving = { from: { x: 10, y: 0 }, to: { x: 60, y: 0 }, departAt: NOW + 30_000, arriveAt: NOW + 80_000 };
    const m = intercept({ x: 0, y: 0 }, SPEED, target, NOW);
    expect(m).not.toBeNull();
    expect(dist(m!.at, target.from)).toBeLessThan(1e-9);
    expect(m!.time).toBe(NOW + 10_000);
  });

  it('погоня позади и не успевает к выходу — встреча на пути, позже выхода', () => {
    const target: Moving = { from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, departAt: NOW + 5_000, arriveAt: NOW + 5_000 + 200_000 };
    const m = intercept({ x: -20, y: 0 }, SPEED, target, NOW);
    expect(m).not.toBeNull();
    // Цель стоит 5 с, потом идёт полклетки в секунду; погоня — клетка в секунду с отставанием 20: −20 + t = 0,5·(t − 5),
    // встреча через 35 с у клетки 15 (прежде — через 40 с у 17,5: цель будто шла с этой минуты).
    expect(m!.time).toBeCloseTo(NOW + 35_000, 6);
    expect(m!.at.x).toBeCloseTo(15, 6);
  });
});
