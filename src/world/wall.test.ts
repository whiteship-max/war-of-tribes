// Стена-проход (docs/siege_v2.md, 4.1–4.2): проёмы → ширина боя, грань стены и ворота посреди боя; одна дверь боя у стены.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyStack, FRONT_WIDTH, type Stack } from '@/battle';
import { horseHeld, wallFight, type WallDefence } from './fights';
import { OPENING_IDS, SCALING, openingWords, openingsOf, wallFront, type Assault } from './wall';
import { LADDER_FACES, RAM_ROUND } from './data/wall';

const W = FRONT_WIDTH;
const stack = (s: Partial<Stack>): Stack => ({ ...emptyStack(), ...s });

/** Все сочетания способов штурма: проломы 0..3 × машины. Решётка правила — вся его область. */
const ALL: Assault[] = [0, 1, 2, 3].flatMap((breaches) =>
  [false, true].flatMap((ladders) => [false, true].flatMap((ram) => [false, true].map((tower) => ({ breaches, ladders, ram, tower })))),
);

describe('проёмы стены', () => {
  it('штурм с ходу: лестницы на себе — треть стены, −2 грани, конница не лезет', () => {
    const f = wallFront(SCALING);
    expect(f.openings.map((o) => o.id)).toEqual(['scaling']);
    expect(f.width).toBeCloseTo(W / 3, 9);
    expect(f.wall).toBe(LADDER_FACES);
    expect(f.horse).toBe(false);
    expect(f.widen).toBeUndefined();
  });

  it('построенные лестницы — весь фронт со штрафом', () => {
    const f = wallFront({ ladders: true });
    expect(f.width).toBeCloseTo(W, 9);
    expect(f.wall).toBe(LADDER_FACES);
  });

  it('три пролома — вся стена без штрафа: штурм становится полевым боем с ополчением, конница идёт', () => {
    const f = wallFront({ breaches: 3, ladders: true, tower: true });
    expect(f.openings.map((o) => o.id)).toEqual(['breach']);
    expect(f.width).toBeCloseTo(W, 9);
    expect(f.wall).toBe(0);
    expect(f.horse).toBe(true);
  });

  it('пролом снимает −2 грани ровно со своей доли: грань — средняя по фронту', () => {
    for (const a of ALL) {
      const f = wallFront(a);
      const start = f.openings.filter((o) => o.round === 0);
      const open = start.reduce((n, o) => n + o.share, 0);
      expect(open, 'точка внутри области: фронт открыт').toBeGreaterThan(0);
      expect(f.width).toBeCloseTo(W * open, 9);
      expect(f.wall).toBeCloseTo(start.reduce((n, o) => n + o.share * o.faces, 0) / open, 9);
      expect(f.openings.reduce((n, o) => n + o.share, 0)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('пролом удешевляет штурм: больше проломов — фронт не уже и грань не больше, при любых машинах', () => {
    for (const a of ALL) {
      if ((a.breaches ?? 0) >= 3) continue;
      const now = wallFront(a);
      const more = wallFront({ ...a, breaches: (a.breaches ?? 0) + 1 });
      expect(more.wall).toBeLessThanOrEqual(now.wall + 1e-9);
      // Шире или та же: лестницы уже закрывали весь остаток — тогда пролом снимает штраф, а ширина та же. К концу боя
      // (после ворот) — так же.
      expect(more.width).toBeGreaterThanOrEqual(now.width - 1e-9);
      expect(more.widen?.width ?? more.width).toBeGreaterThanOrEqual((now.widen?.width ?? now.width) - 1e-9);
      expect(more.widen?.wall ?? more.wall).toBeLessThanOrEqual((now.widen?.wall ?? now.wall) + 1e-9);
    }
  });

  it('таран: ворота открываются со второго круга — фронт шире, грань меньше; конница идёт', () => {
    const f = wallFront({ ram: true });
    expect(f.width).toBeCloseTo(W / 3, 9);
    expect(f.widen).toEqual({ round: RAM_ROUND, width: expect.closeTo((2 * W) / 3, 9), wall: expect.closeTo(1, 9) });
    expect(f.horse).toBe(true);
  });

  it('башня — пролёт без штрафа с первого круга, но конница по ней не идёт', () => {
    const f = wallFront({ tower: true });
    expect(f.width).toBeCloseTo((2 * W) / 3, 9);
    expect(f.wall).toBeCloseTo(1, 9);
    expect(f.horse).toBe(false);
  });

  it('у каждого проёма — строка устройства без прогноза: места строя и штраф', () => {
    for (const a of ALL) for (const o of openingsOf(a)) expect(openingWords(o)).toMatch(new RegExp(`из ${Math.round(W)} мест строя`));
    expect(OPENING_IDS).toContain('gate');
  });
});

describe('бой у стены — одна дверь (fights.wallFight)', () => {
  const attacker = { kinds: stack({ infantry: 300, spear: 120, cavalry: 80 }) };
  const defender: WallDefence = { kinds: stack({ spear: 60, archer: 30 }), militia: 120, archers: 40 };

  it('конница, которой некуда пройти, в бой не входит и не гибнет; есть пролом — входит', () => {
    const shut = wallFight({ seed: 7, attacker, defender, front: wallFront(SCALING) });
    expect(shut.input.attacker.kinds.cavalry).toBe(0);
    expect(horseHeld(attacker.kinds, wallFront(SCALING)).cavalry).toBe(80);
    expect(shut.field.result?.sides.attacker.losses.cavalry ?? 0).toBe(0);
    const open = wallFight({ seed: 7, attacker, defender, front: wallFront({ breaches: 1 }) });
    expect(open.input.attacker.kinds.cavalry).toBe(80);
  });

  it('без фронта — бой в поле: ни ширины, ни грани стены', () => {
    const r = wallFight({ seed: 7, attacker, defender, front: null });
    expect(r.input.width).toBeUndefined();
    expect(r.input.ground?.wall).toBeUndefined();
    expect(r.input.defender.kinds.infantry).toBe(80);
    expect(r.input.defender.kinds.archer).toBe(70);
  });

  it('стена держит: отряд, который в поле берёт верх, по лестницам с ходу берёт реже — на наборе сидов', () => {
    // Граница области: бой у порога, где в поле отряд выигрывает больше половины сидов, но не все — там правило и
    // спрашивается; проверяется утверждением ниже. Оборона — пехота ополчения и копья, без стрелков башни.
    const foot: WallDefence = { kinds: stack({ spear: 90 }), militia: 120, archers: 0 };
    const big = { kinds: stack({ infantry: 144, spear: 53, archer: 23 }) };
    let field = 0;
    let wall = 0;
    for (let seed = 1; seed <= 24; seed += 1) {
      if (wallFight({ seed, attacker: big, defender: foot, front: null }).field.won) field += 1;
      if (wallFight({ seed, attacker: big, defender: foot, front: wallFront(SCALING) }).field.won) wall += 1;
    }
    expect(field, 'точка внутри области: в поле отряд берёт больше половины').toBeGreaterThan(12);
    expect(field, 'точка внутри области: но не все сиды').toBeLessThan(24);
    expect(wall).toBeLessThan(field);
  });

  it('сторону обороны у стены собирает только дверь: мир и сервер зовут wallFight, а defenceKinds — нигде больше', () => {
    const world = readFileSync('src/world/local/LocalWorld.ts', 'utf8');
    const war = readFileSync('netlify/lib/war.ts', 'utf8');
    expect(world).toMatch(/wallFight\(/);
    expect(war).toMatch(/wallFight\(/);
    for (const src of [world, war]) expect(src).not.toMatch(/defenceKinds\(/);
  });
});
