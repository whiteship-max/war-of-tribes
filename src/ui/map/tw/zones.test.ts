// Граница держав нового вида (`tw/zones.ts`): обводит то, что дал мир (влияние клетки), и ничего не выдумывает.
import { describe, expect, it } from 'vitest';
import type { Segment } from './border';
import { borderLines } from './zones';

/** Замкнута ли черта: у каждого конца отрезка чётное число отрезков (с точностью до округления). */
function closed(segs: Segment[]): boolean {
  const deg = new Map<string, number>();
  const key = (x: number, y: number) => `${Math.round(x * 1000)}|${Math.round(y * 1000)}`;
  for (const [ax, ay, bx, by] of segs) {
    deg.set(key(ax, ay), (deg.get(key(ax, ay)) ?? 0) + 1);
    deg.set(key(bx, by), (deg.get(key(bx, by)) ?? 0) + 1);
  }
  return [...deg.values()].every((d) => d % 2 === 0);
}

const RECT = { x: 100, y: 200, w: 30, h: 24 };

describe('черта границы державы', () => {
  it('влияния нет — черты нет (сегодня у мира так везде)', () => {
    expect(borderLines(RECT, () => 0).size).toBe(0);
  });

  it('владение — замкнутая черта вокруг своих клеток', () => {
    const own = (x: number, y: number) => (x >= 108 && x < 118 && y >= 206 && y < 214 ? 1 : 0);
    const lines = borderLines(RECT, own);
    expect([...lines.keys()]).toEqual([1]);
    const segs = lines.get(1)!;
    expect(segs.length).toBeGreaterThan(8);
    expect(closed(segs)).toBe(true);
    // Черта лежит у края владения, а не где-то в поле: в пределах клетки от него.
    for (const [ax, ay] of segs) {
      expect(ax).toBeGreaterThanOrEqual(107);
      expect(ax).toBeLessThanOrEqual(119);
      expect(ay).toBeGreaterThanOrEqual(205);
      expect(ay).toBeLessThanOrEqual(215);
    }
  });

  it('две державы — две черты, каждая своя', () => {
    const two = (x: number, y: number) => (y < 206 || y >= 220 ? 0 : x >= 104 && x < 112 ? 1 : x >= 112 && x < 122 ? 2 : 0);
    const lines = borderLines(RECT, two);
    expect([...lines.keys()].sort()).toEqual([1, 2]);
    for (const segs of lines.values()) expect(closed(segs)).toBe(true);
    // Каждая черта — вокруг своих клеток: первая не заходит за восточный край первой державы, вторая — за
    // западный край второй.
    for (const [ax, , bx] of lines.get(1)!) expect(Math.max(ax, bx)).toBeLessThanOrEqual(113);
    for (const [ax, , bx] of lines.get(2)!) expect(Math.min(ax, bx)).toBeGreaterThanOrEqual(111);
  });
});
