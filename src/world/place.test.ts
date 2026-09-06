// Место боя: клетка карты глазами ролика.
//
// Проверяется здесь одно: перевод из географии в приметы места детерминирован и
// не выдумывает того, чего в клетке нет. Всё остальное про землю — в
// `game/battle/ground.test.ts` (перевод в свет) и `render/battle/ground.test.ts`
// (сама земля).
import { describe, expect, it } from 'vitest';
import { FEATURE, featuresAt, terrainAt } from './geography';
import { WORLD_ORIGIN, WORLD_SIZE } from './data/tuning';
import { placeAt } from './place';

const SEED = 20240;

/** Клетки мира сеткой: по ним и ищутся редкие приметы вроде брода. */
function scan(step = 3): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = WORLD_ORIGIN.y; y < WORLD_ORIGIN.y + WORLD_SIZE; y += step) {
    for (let x = WORLD_ORIGIN.x; x < WORLD_ORIGIN.x + WORLD_SIZE; x += step) out.push({ x, y });
  }
  return out;
}

describe('место боя выводится из клетки', () => {
  it('та же клетка того же мира — то же место', () => {
    for (const c of scan(17)) {
      expect(placeAt(SEED, c.x, c.y)).toEqual(placeAt(SEED, c.x, c.y));
    }
  });

  it('приметы не выдумываются: что записано, то и есть в клетке или рядом', () => {
    for (const c of scan(11)) {
      const p = placeAt(SEED, c.x, c.y);
      let bits = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) bits |= featuresAt(SEED, c.x + dx, c.y + dy);
      if (p.river) expect(bits & FEATURE.river).toBeTruthy();
      if (p.ridge) expect(bits & FEATURE.ridge).toBeTruthy();
      if (p.road) expect(bits & FEATURE.road).toBeTruthy();
      if (p.ford) expect(bits & (FEATURE.ford | FEATURE.bridge)).toBeTruthy();
      // Брода без реки не бывает — ни здесь, ни в переводе на землю.
      if (p.ford) expect(p.river).toBe(true);
    }
  });

  it('в мире находятся все четыре зрелища: брод, гребень, опушка, тракт', () => {
    const cells = scan(2);
    const has = (pick: (p: ReturnType<typeof placeAt>) => boolean): boolean =>
      cells.some((c) => pick(placeAt(SEED, c.x, c.y)));
    expect(has((p) => p.ford === true)).toBe(true);
    expect(has((p) => p.ridge === true)).toBe(true);
    expect(has((p) => p.woods === true)).toBe(true);
    expect(has((p) => p.road === true)).toBe(true);
    expect(has((p) => p.land === 'shore')).toBe(true);
  });

  it('берег — там, где рядом вода, а лес — там, где лес', () => {
    for (const c of scan(13)) {
      const p = placeAt(SEED, c.x, c.y);
      let water = 0;
      let forest = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const t = terrainAt(SEED, c.x + dx, c.y + dy);
          if (t === 'water') water++;
          else if (t === 'forest') forest++;
        }
      }
      if (p.land === 'shore') expect(water).toBeGreaterThan(0);
      if (p.woods) expect(forest + (terrainAt(SEED, c.x, c.y) === 'forest' ? 3 : 0)).toBeGreaterThanOrEqual(3);
    }
  });

  it('игровое время переносится как есть и без него место всё равно есть', () => {
    const c = { x: WORLD_ORIGIN.x + 40, y: WORLD_ORIGIN.y + 40 };
    expect(placeAt(SEED, c.x, c.y, 1234).time).toBe(1234);
    expect(placeAt(SEED, c.x, c.y).time).toBeUndefined();
  });
});
