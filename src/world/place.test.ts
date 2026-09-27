// Место боя: клетка карты глазами ролика.
//
// Проверяется здесь одно: перевод из географии в приметы места детерминирован и
// не выдумывает того, чего в клетке нет. Всё остальное про землю — в
// `game/battle/ground.test.ts` (перевод в свет) и `render/battle/ground.test.ts`
// (сама земля).
import { describe, expect, it } from 'vitest';
import { FEATURE, featuresAt, terrainAt } from './geography';
import { WORLD_ORIGIN, WORLD_SIZE } from './data/tuning';
import { groundAt, placeAt } from './place';
import { resolveField } from './battle';
import { groundFaces, stackOf, type ArmySetup, type BattleResult, type Pips } from '@/battle';

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

  it('в мире находятся все зрелища, какие на этой карте есть', () => {
    const cells = scan(2);
    const has = (pick: (p: ReturnType<typeof placeAt>) => boolean): boolean =>
      cells.some((c) => pick(placeAt(SEED, c.x, c.y)));
    expect(has((p) => p.ford === true)).toBe(true);
    expect(has((p) => p.ridge === true)).toBe(true);
    expect(has((p) => p.woods === true)).toBe(true);
    expect(has((p) => p.land === 'shore')).toBe(true);
    // Тракта среди них больше нет: дороги соединяли станы племён, а станов на
    // общей карте не осталось. Поле `road` цело и ждёт настоящих дорог.
    expect(has((p) => p.road === true)).toBe(false);
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

describe('штраф кости нападающему — таблица EU4', () => {
  // Новые тесты 5 и 11 поставки 1 (docs/battle_eu4.md, 14.5, 14.14; ответ владельца 5): пересечённая земля −1, горы
  // −2, переправа −1, штрафы складываются; бой на клетке воды — переправа (14.19.2). Числа в тесте — таблица EU4, а не
  // пересказ кода: правка таблицы в коде обязана уронить его.

  it('каждый класс земли даёт свою грань, хребет и перевал — горы, клетка воды — переправа', () => {
    const table: Record<string, number> = { plain: 0, steppe: 0, desert: 0, forest: 1, hills: 1, mountains: 2 };
    const met = new Set<string>();
    for (const c of scan(4)) {
      const t = terrainAt(SEED, c.x, c.y);
      const bits = featuresAt(SEED, c.x, c.y);
      const g = groundAt(SEED, c);
      if (t === 'water') {
        expect(g, `вода ${c.x}|${c.y}`).toEqual({ crossing: 1 });
        met.add('water');
      } else if (bits & (FEATURE.ridge | FEATURE.pass)) {
        expect(g.land, `хребет ${c.x}|${c.y}`).toBe(2);
        met.add('ridge');
      } else {
        expect(g.land ?? 0, `${t} ${c.x}|${c.y}`).toBe(table[t]);
        met.add(t);
      }
    }
    // Граница области: на карте встретился каждый класс — иначе грань класса проверялась бы даром.
    for (const t of [...Object.keys(table), 'water', 'ridge']) expect(met.has(t), `класс ${t} на карте`).toBe(true);
  });

  it('переправа — шаг на поле боя через русло, и только там, где запись места видит реку; земля и переправа складываются', () => {
    let crossed = 0;
    let dry = 0;
    for (const c of scan(5)) {
      const t = terrainAt(SEED, c.x, c.y);
      if (t === 'water' || featuresAt(SEED, c.x, c.y) & FEATURE.river) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const step = { x: c.x + dx, y: c.y + dy };
        const from = { x: c.x + 5 * dx, y: c.y + 5 * dy };
        const g = groundAt(SEED, c, from);
        const river = (featuresAt(SEED, step.x, step.y) & FEATURE.river) !== 0;
        expect(g.crossing ?? 0, `${c.x}|${c.y} из ${from.x}|${from.y}`).toBe(river ? 1 : 0);
        // Земля от направления не зависит: она у клетки боя.
        expect(g.land ?? 0).toBe(groundAt(SEED, c).land ?? 0);
        if (river) {
          // Штраф переправы бывает только там, где ролик показывает реку: поле записи — клетка и её соседи.
          expect(placeAt(SEED, c.x, c.y).river, `${c.x}|${c.y}: река в записи места`).toBe(true);
          // Складываются: у ядра это одна кость на весь бой.
          expect(groundFaces({ ground: g } as ArmySetup, {} as ArmySetup).faces).toBe((g.land ?? 0) + 1);
          crossed += 1;
        } else dry += 1;
      }
    }
    // Граница области: переправа и сухой шаг правда встретились.
    expect(crossed, 'шагов через русло').toBeGreaterThan(0);
    expect(dry, 'сухих шагов').toBeGreaterThan(0);
  });

  it('штраф — только нападающему и на весь бой; манёвр выше чужого снимает переправу, но не землю', () => {
    const kinds = stackOf({ spear: 100, infantry: 120, archer: 60 });
    const ground = { land: 1, crossing: 1 };
    const fight = (atk: Pips, def: Pips): BattleResult =>
      resolveField({ seed: 3, ground, attacker: { kinds, pips: atk }, defender: { kinds, pips: def } }).result!;
    const faces = (r: BattleResult): Array<{ attacker: number; defender: number }> =>
      r.log.flatMap((e) => (e.id === 'dice' ? [{ attacker: e.ground?.attacker ?? 0, defender: e.ground?.defender ?? 0 }] : []));
    const plain = fight({}, {});
    // Граница области: в бою есть кости, и штраф в каждой.
    expect(faces(plain).length, 'костей в бою').toBeGreaterThan(0);
    for (const f of faces(plain)) expect(f, 'земля и переправа — нападающему, обороне ничего').toEqual({ attacker: 2, defender: 0 });
    expect(plain.log.filter((e) => e.id === 'ground')).toEqual([expect.objectContaining({ side: 'attacker', land: 1, crossing: 1, lifted: false })]);
    // Манёвр нападающего выше манёвра обороны — переправы нет, земля осталась.
    const led = fight({ maneuver: 1 }, {});
    for (const f of faces(led)) expect(f, 'манёвр снял переправу, но не землю').toEqual({ attacker: 1, defender: 0 });
    expect(led.log.find((e) => e.id === 'ground')).toEqual(expect.objectContaining({ lifted: true }));
    // Манёвр обороны не ниже — держит переправу.
    for (const f of faces(fight({ maneuver: 1 }, { maneuver: 1 }))) expect(f, 'манёвр обороны держит переправу').toEqual({ attacker: 2, defender: 0 });
  });
});
