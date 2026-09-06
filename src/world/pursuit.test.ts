// Перехват в поле: точка встречи — чистая функция от времён выхода и скоростей.
import { describe, expect, it } from 'vitest';
import { intercept, positionAt, speedOf, type Moving } from './pursuit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIN = 60_000;
const START = 1_000_000;

/** Отряд идёт из (0,0) в (20,0) за десять минут: две клетки в минуту. */
const runner: Moving = {
  from: { x: 0, y: 0 },
  to: { x: 20, y: 0 },
  departAt: START,
  arriveAt: START + 10 * MIN,
};

describe('положение и скорость', () => {
  it('выводятся из времён, а не хранятся', () => {
    expect(positionAt(runner, START)).toEqual({ x: 0, y: 0 });
    expect(positionAt(runner, START + 5 * MIN)).toEqual({ x: 10, y: 0 });
    expect(positionAt(runner, START + 10 * MIN)).toEqual({ x: 20, y: 0 });
    // За пределами отрезка времени — концы, а не экстраполяция.
    expect(positionAt(runner, START - MIN)).toEqual({ x: 0, y: 0 });
    expect(positionAt(runner, START + 99 * MIN)).toEqual({ x: 20, y: 0 });
    expect(speedOf(runner) * MIN).toBeCloseTo(2);
  });
});

describe('точка встречи', () => {
  it('считается одним уравнением и совпадает с положением цели в этот момент', () => {
    // Догоняющий стоит на пути цели впереди: встреча посередине.
    const meet = intercept({ x: 20, y: 0 }, speedOf(runner), runner, START);
    expect(meet).toBeTruthy();
    const where = positionAt(runner, meet!.time);
    expect(where.x).toBeCloseTo(meet!.at.x, 6);
    expect(where.y).toBeCloseTo(meet!.at.y, 6);
    expect(meet!.time).toBeGreaterThan(START);
    expect(meet!.seconds).toBeCloseTo((meet!.time - START) / 1000, 6);
  });

  it('одни и те же времена и скорости дают одну и ту же встречу', () => {
    const a = intercept({ x: 4, y: 9 }, speedOf(runner) * 1.4, runner, START + MIN);
    const b = intercept({ x: 4, y: 9 }, speedOf(runner) * 1.4, runner, START + MIN);
    expect(a).toEqual(b);
  });

  it('быстрый догоняет сзади, медленный — нет', () => {
    const behind = { x: -5, y: 0 };
    const fast = intercept(behind, speedOf(runner) * 2, runner, START);
    const slow = intercept(behind, speedOf(runner) * 0.5, runner, START);
    expect(fast, 'вдвое быстрее — догонит').toBeTruthy();
    expect(slow, 'вдвое медленнее — не догонит').toBeNull();
  });

  it('чем быстрее догоняющий, тем раньше и ближе к цели встреча', () => {
    const from = { x: 0, y: 12 };
    const quick = intercept(from, speedOf(runner) * 3, runner, START);
    const slower = intercept(from, speedOf(runner) * 1.2, runner, START);
    expect(quick!.time).toBeLessThan(slower!.time);
    expect(quick!.at.x).toBeLessThan(slower!.at.x);
  });

  it('если цель успевает дойти раньше встречи — перехвата нет', () => {
    // Гонимся с той же скоростью, но с большого отставания: не успеть.
    const late = intercept({ x: -30, y: 0 }, speedOf(runner) * 1.05, runner, START);
    expect(late).toBeNull();
    // И у самой двери — тоже: цель уже почти дома.
    const atDoor = intercept({ x: -2, y: 0 }, speedOf(runner) * 1.05, runner, START + 9.8 * MIN);
    expect(atDoor).toBeNull();
  });

  it('стоящую цель догоняют всегда, пока хватает времени до её прихода', () => {
    const standing: Moving = { from: { x: 5, y: 5 }, to: { x: 5, y: 5 }, departAt: START, arriveAt: START + 30 * MIN };
    const meet = intercept({ x: 0, y: 0 }, speedOf(runner), standing, START);
    expect(meet).toBeTruthy();
    expect(meet!.at).toEqual({ x: 5, y: 5 });
  });

  it('смена курса цели даёт другую встречу — это новое событие выхода', () => {
    const before = intercept({ x: 0, y: 10 }, speedOf(runner) * 1.5, runner, START + 2 * MIN)!;
    // Цель повернула домой: то же место, другое направление и другой срок.
    const turned: Moving = {
      from: positionAt(runner, START + 2 * MIN),
      to: { x: 0, y: 0 },
      departAt: START + 2 * MIN,
      arriveAt: START + 12 * MIN,
    };
    const after = intercept({ x: 0, y: 10 }, speedOf(runner) * 1.5, turned, START + 2 * MIN);
    expect(after).toBeTruthy();
    expect(after!.at.x).not.toBeCloseTo(before.at.x, 3);
  });

  it('стоящий на месте догоняющий не догоняет никого', () => {
    expect(intercept({ x: 0, y: 0 }, 0, runner, START)).toBeNull();
  });
});

describe('перехват не требует фоновой работы', () => {
  it('модуль ни от чего не зависит и не читает ни часов, ни случайности', () => {
    const src = readFileSync(join(process.cwd(), 'src/world/pursuit.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/Date\.now|performance\.now/);
    expect(code).not.toMatch(/Math\.random/);
    expect(code).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    // Единственный импорт — типы: считать здесь нечего, кроме геометрии.
    const imports = code.match(/^import .*$/gm) ?? [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatch(/import type/);
  });
});
