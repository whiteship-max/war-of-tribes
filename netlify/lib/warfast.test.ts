import { describe, expect, it } from 'vitest';
import type { CastleClaim, RosterFile, WarArmy, WarSheet } from './contract.js';
import { castleIdOf, emptyRoster, upsert } from './roster.js';
import { advance, applyOrder, emptyWars, type SheetAt, type WarFile } from './war.js';
import { distance, terrainFactor, travelTime, travelTimeAt } from '../../src/world/geo.js';
import { fieldWalkFloorMs, fieldWalkSeconds, warWalkMs, WAR_GROUND_SEED } from '../../src/world/pvp.js';
import { FIGURE_BY_ID } from '../../src/world/data/figures.js';
import { MARCH_MIN_SECONDS, TEST_TRAVEL_SPEED } from '../../src/world/data/tuning.js';
import { asGame, realMs } from '../../src/game/pace.js';

// ВРЕМЕННО ×3 ДЛЯ ТЕСТА (`TEST_TRAVEL_SPEED`, docs/handbook/acceptance.md, «Временно: ×3 пути для теста»): срок пути
// втрое короче одной дверью `geo.travelTime`, сервер войны принимает приход по новому сроку без флага, а походы, вышедшие
// по прежнему сроку, доходят по записанному. При 1 — прежняя формула.

const A = 'tg-2001';
const B = 'tg-2002';
const T0 = 1_900_000_000_000;

const claim = (name: string): CastleClaim => ({ name, city: name, power: 5000, pop: 400 });
function world(): RosterFile {
  let r = emptyRoster();
  r = upsert(r, A, claim('Альфа'), T0);
  r = upsert(r, B, claim('Бета'), T0);
  return r;
}
const sheet = (): WarSheet => ({
  army: { spearman: 60, archer: 30, swordsman: 30 },
  home: { spearman: 40, archer: 20 },
  militia: 20,
  archers: 6,
  resolve: 0,
  pips: {},
  rest: 1,
  food: 2000,
  townPerHour: 20,
  perManPerHour: 1,
  stock: { food: 2000, wood: 800, stone: 300 },
  stash: 100,
  gold: 400,
  pop: 400,
  bonded: 20,
  levels: { walls: 3, farm: 4, smithy: 2 },
  power: 5000,
  locks: {},
  seen: [],
});
const army = (troops: Record<string, number>): WarArmy => ({ troops, resolve: 0, pips: {} });

function setup() {
  const roster = world();
  const sheets = new Map<string, SheetAt>([
    [A, { sheet: sheet(), at: T0 }],
    [B, { sheet: sheet(), at: T0 }],
  ]);
  const warned: string[] = [];
  const ctx = { roster, sheet: (k: string) => sheets.get(k) ?? null, forged: (text: string) => warned.push(text) };
  return { roster, sheets, ctx, warned, file: emptyWars() as WarFile };
}

/** Прежняя формула пути, переписанная буквально (до ×3): при множителе 1 дверь обязана давать ровно её. */
const before = (dist: number, factor: number, speed: number): number =>
  Math.max(MARCH_MIN_SECONDS, Math.round((dist / speed) * 60 * factor * 100) / 100);

describe('временно ×3: срок пути одной дверью', () => {
  const cases = [
    { dist: 0.3, factor: 1, speed: FIGURE_BY_ID.general.speed },
    { dist: 4, factor: 1.4, speed: FIGURE_BY_ID.spy.speed },
    { dist: 25, factor: 2.1, speed: FIGURE_BY_ID.scout.speed },
    { dist: 120, factor: 1, speed: FIGURE_BY_ID.general.speed },
  ];

  it('множитель теста — 3 (вернуть 1 перед запуском)', () => {
    expect(TEST_TRAVEL_SPEED).toBe(3);
  });

  it('при 1 — как раньше, при ×3 — втрое короче, вместе с полом пути', () => {
    // Граница: пол `MARCH_MIN_SECONDS` и длинный путь — обе ветви формулы внутри набора.
    expect(cases.some((c) => before(c.dist, c.factor, c.speed) === MARCH_MIN_SECONDS), 'точка на полу').toBe(true);
    expect(cases.some((c) => before(c.dist, c.factor, c.speed) > MARCH_MIN_SECONDS * 10), 'точка выше пола').toBe(true);
    for (const c of cases) {
      const old = before(c.dist, c.factor, c.speed);
      expect(travelTimeAt(c.dist, c.factor, c.speed, 1)).toBe(old);
      expect(travelTimeAt(c.dist, c.factor, c.speed, 3)).toBeCloseTo(old / 3, 2);
      expect(travelTime(c.dist, c.factor, c.speed)).toBe(travelTimeAt(c.dist, c.factor, c.speed, TEST_TRAVEL_SPEED));
    }
  });

  it('путь войны между игроками — той же дверью, втрое короче прежнего', () => {
    const { roster } = setup();
    const from = roster.rows[A];
    const to = roster.rows[B];
    const old = realMs(asGame(before(distance(from, to), terrainFactor(WAR_GROUND_SEED, from, to), FIGURE_BY_ID.general.speed)));
    expect(old, 'точка внутри области: замки не у ворот друг друга').toBeGreaterThan(realMs(MARCH_MIN_SECONDS));
    expect(Math.abs(warWalkMs(from, to) - old / TEST_TRAVEL_SPEED)).toBeLessThanOrEqual(realMs(asGame(0.01)) + 1);
  });
});

describe('временно ×3: сервер войны принимает приход по новому сроку', () => {
  it('поход приходит в новый срок, бой в минуту прихода, флагов нет', () => {
    const { ctx, file, sheets, warned, roster } = setup();
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: army({ spearman: 60, swordsman: 30 }) }, T0, ctx)).toBeNull();
    const w = file.wars[0];
    expect(w.arriveAt - T0).toBe(warWalkMs(roster.rows[A], roster.rows[B]));
    expect(advance(file, w.arriveAt - 1, sheets)).toBe(false);
    advance(file, w.arriveAt + 1, sheets);
    expect(w.battles).toHaveLength(1);
    expect(w.battles[0].at).toBe(w.arriveAt);
    expect(warned).toEqual([]);
  });

  it('удар из поля честным новым сроком принят без флага; прежний, долгий срок старого клиента — тоже', () => {
    for (const k of [TEST_TRAVEL_SPEED, 1]) {
      const { ctx, file, sheets, warned } = setup();
      expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'siege', fate: 'plunder', army: army({ spearman: 30 }) }, T0, ctx)).toBeNull();
      const w = file.wars[0];
      advance(file, w.arriveAt + 1, sheets);
      expect(w.phase, 'точка внутри области: лагерь у стен Беты').toBe('camp');
      const from = { x: w.to.x + 12, y: w.to.y + 5 };
      const factor = terrainFactor(7, from, w.to);
      const walkMs = Math.round(realMs(k === 1 ? travelTimeAt(distance(from, w.to), factor, FIGURE_BY_ID.general.speed, 1) : fieldWalkSeconds(from, w.to, factor)));
      expect(walkMs, `×${k}: не короче пола сервера`).toBeGreaterThanOrEqual(fieldWalkFloorMs(from, w.to));
      const at = w.arriveAt + 2;
      expect(applyOrder(file, B, { op: 'strike', id: w.id, army: army({ spearman: 10 }), joint: false, walkMs, from }, at, ctx)).toBeNull();
      expect(w.strike?.at).toBe(at + walkMs);
      expect(warned, `×${k}`).toEqual([]);
    }
  });

  it('поход, вышедший по прежнему сроку, доходит по записанному: не раньше и без флага', () => {
    const { ctx, file, sheets, warned } = setup();
    expect(applyOrder(file, A, { op: 'march', target: castleIdOf(B), mode: 'storm', fate: 'plunder', army: army({ spearman: 60, swordsman: 30 }) }, T0, ctx)).toBeNull();
    const w = file.wars[0];
    const fast = w.arriveAt;
    // Записанный до выкладки срок — втрое длиннее нового.
    w.arriveAt = T0 + (fast - T0) * TEST_TRAVEL_SPEED;
    expect(w.arriveAt, 'точка внутри области: прежний срок позже нового').toBeGreaterThan(fast + 1);
    expect(advance(file, fast + 1, sheets)).toBe(false);
    expect(w.phase).toBe('march');
    advance(file, w.arriveAt + 1, sheets);
    expect(w.battles).toHaveLength(1);
    expect(w.battles[0].at).toBe(w.arriveAt);
    expect(warned).toEqual([]);
  });
});
