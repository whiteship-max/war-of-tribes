// Тест с игроками на Сицилии (docs/test_world.md): что видит город на месте острова и где у него встают логова.
//
// Два обещания плотной посадки. Первое — кольцо обзора острова: из любого из двадцати пяти городов остальные двадцать четыре
// видны вживую (имя владельца, мощь и население — не снимок), и только у города на месте острова — обычный город
// видит прежним кругом. Второе — логова своего мира не встают на чужие места и у чужих стен (`LAIR_SETTLE_GAP`): ни
// генерацией, ни по ходу партии, ни у пустого ещё места, ни у замка живого игрока вне мест.
import { describe, expect, it } from 'vitest';
import { LocalWorld } from './local/LocalWorld';
import { generateWorld, isLair, type GenSettlement, type WorldGen } from './gen';
import { distance } from './geo';
import { seeded } from '@/game/sim/random';
import { AI_RANGE, HOME_SIGHT, LAIR_HOME_GAP, LAIR_SETTLE_GAP } from './data/tuning';
import { SICILY, SICILY_SIGHT, islandNeighbours, sicilyFit, sicilyLand, sicilySlot } from './spawn';
import type { PlayerCastle, PlayerProfile } from './types';

const START = 1_700_000_000_000;

const profile = (): PlayerProfile => ({
  name: 'Тест',
  pop: 120,
  defense: 30,
  units: { warrior: 10, scout: 4 },
  stock: { food: 120, wood: 80 },
  stash: 0,
  survey: 0,
});

type P = { x: number; y: number };

/** Замки соседей на местах острова — так, как их приносит реестр. */
const rowsAt = (spots: readonly P[]): PlayerCastle[] =>
  spots.map((s, k) => ({
    id: `cостров${k}`,
    x: s.x,
    y: s.y,
    name: `Вождь ${k}`,
    city: `Город ${k}`,
    power: 1000 + k,
    pop: 200 + k,
    seenAt: START,
  }));

const underWalls = (walls: readonly P[], p: P): boolean => walls.some((w) => distance(w, p) < LAIR_SETTLE_GAP);

interface Inside {
  gen: WorldGen;
  spawnLair(at: number, rng: () => number): boolean;
}
const inside = (w: LocalWorld): Inside => w as unknown as Inside;

describe('кольцо обзора острова', () => {
  it('из каждого из двадцати пяти городов остальные двадцать четыре видны вживую', async () => {
    for (const home of SICILY) {
      const rows = rowsAt(SICILY.filter((s) => s !== home));
      const world = new LocalWorld({ seed: 5, home, now: () => START, storage: null, castles: () => rows });
      await world.sync(profile());
      for (const c of rows) {
        const card = await world.settlement(c.id);
        // Граница области: обычное кольцо видит не всех — крайняя пара острова дальше `HOME_SIGHT`.
        const label = `${home.x}|${home.y} → ${c.x}|${c.y} (${distance(home, c).toFixed(1)} кл.)`;
        expect([label, card?.visible, card?.owner, card?.power.value, card?.pop.value]).toEqual([
          label,
          true,
          c.name,
          c.power,
          c.pop,
        ]);
      }
    }
  });

  it('в области правила: есть пары мест дальше обычного кольца, и они в кольце острова', () => {
    // Без такой пары тест выше прошёл бы и с обычным кольцом — правило острова не спрашивалось бы.
    const far = SICILY.filter((s) => SICILY.some((t) => distance(s, t) > HOME_SIGHT));
    expect(far.length).toBeGreaterThan(0);
    for (const s of far) expect(SICILY.every((t) => distance(s, t) <= SICILY_SIGHT)).toBe(true);
  });

  it('город не на месте острова видит обычным кольцом: дальше него соседа не видно', async () => {
    // Клетка острова рядом с кучкой, не место, и у неё есть место в полосе между обычным кольцом и кольцом острова.
    const band = (p: P, s: P): boolean => distance(p, s) > HOME_SIGHT && distance(p, s) <= SICILY_SIGHT;
    const home = sicilyLand().find((p) => sicilySlot(p) === 0 && sicilyFit(p) && SICILY.some((s) => band(p, s))) as P;
    expect(home).toBeDefined();
    const rows = rowsAt(SICILY);
    const world = new LocalWorld({ seed: 5, home, now: () => START, storage: null, castles: () => rows });
    await world.sync(profile());
    let hidden = 0;
    for (const c of rows) {
      const card = await world.settlement(c.id);
      const d = distance(home, c);
      if (band(home, c)) hidden++;
      expect([c.x, c.y, card?.visible]).toEqual([c.x, c.y, d <= HOME_SIGHT]);
    }
    expect(hidden).toBeGreaterThan(0);
  });
});

describe('логова при плотной посадке', () => {
  it('в кольце логов каждого места есть клетки под чужими стенами — правилу есть где работать', () => {
    for (const home of SICILY) {
      const walls = islandNeighbours(home);
      let cells = 0;
      for (let dy = -AI_RANGE; dy <= AI_RANGE; dy++) {
        for (let dx = -AI_RANGE; dx <= AI_RANGE; dx++) {
          const p = { x: home.x + dx, y: home.y + dy };
          const d = distance(home, p);
          if (d >= LAIR_HOME_GAP && d <= AI_RANGE && underWalls(walls, p)) cells++;
        }
      }
      expect([home, cells > 100]).toEqual([home, true]);
    }
  });

  it('генерация: ни одного логова на чужом месте и у чужих стен — на двадцати пяти местах × двадцати сидах', () => {
    let lairs = 0;
    for (const home of SICILY) {
      const walls = islandNeighbours(home);
      for (let seed = 1; seed <= 20; seed++) {
        for (const s of generateWorld(seed, home).settlements) {
          if (!isLair(s)) continue;
          if (distance(s, home) <= AI_RANGE) lairs++;
          expect([home, seed, s.x, s.y, underWalls(walls, s)]).toEqual([home, seed, s.x, s.y, false]);
        }
      }
    }
    // Логова у порога остались: правило не опустошило округу.
    expect(lairs).toBeGreaterThan(SICILY.length * 20 * 2);
  });

  it('место вокруг города осталось: в кольце обзора на старте есть логово почти на каждом сиде', () => {
    // Граница — 18 сидов из 20 у каждого места: первое логово у порога ставится в кольце обзора, но в тесной кучке
    // бросков может не хватить (сколько миров без логова в кольце — `npm run settle:report`, раздел «тест с игроками:
    // Сицилия»).
    for (const home of SICILY) {
      let seen = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const near = generateWorld(seed, home).settlements.filter(
          (s) => isLair(s) && distance(s, home) <= SICILY_SIGHT,
        );
        if (near.length > 0) seen++;
      }
      expect([home, seen >= 18]).toEqual([home, true]);
    }
  });

  it('по ходу партии: новое логово не встаёт ни у чужого места, ни у замка живого игрока вне мест', () => {
    let made = 0;
    // Западные места: к западу от кучки остров свободен, и там можно поставить чужой замок вне мест.
    for (const home of [SICILY[0], SICILY[1]]) {
      // Тринадцатый игрок — вне мест, в кольце логов этого города (обычное расселение его туда не ставит, но правило
      // стены держится для любого замка из реестра). Его стены не накрыты стенами мест — проверяется реестр, а не они.
      const stranger = sicilyLand().find(
        (p) =>
          distance(p, home) > 10 && distance(p, home) < 16 && SICILY.every((s) => distance(s, p) >= LAIR_SETTLE_GAP * 2),
      ) as P;
      expect(stranger).toBeDefined();
      const rows = rowsAt([stranger]);
      const world = new LocalWorld({ seed: 7, home, now: () => START, storage: null, castles: () => rows });
      const w = inside(world);
      const before = w.gen.settlements.length;
      for (let k = 0; k < 200; k++) w.spawnLair(START, seeded(1000 + k));
      const born: GenSettlement[] = w.gen.settlements.slice(before);
      made += born.length;
      const walls = [...islandNeighbours(home), stranger];
      for (const s of born) expect([home, s.x, s.y, underWalls(walls, s)]).toEqual([home, s.x, s.y, false]);
    }
    expect(made, 'мир заводил логова').toBeGreaterThan(10);
  });
});
