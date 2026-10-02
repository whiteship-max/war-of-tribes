// Вид «город» (docs/city.md): бюджет по уровням против границ владельца, раскладка (дома внутри
// стены, не на улицах и не друг на друге), лес вне стены и гласиса, слои текстур — от зерна и
// без шва по краю плитки.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cityPlan, distPoly, insidePoly, type House } from './layout';
import { cityCounts, CITY_BUDGET, type CityCounts } from './budget';
import { forestAt, placeTrees } from './nature';
import { LAYERS, paintLayer, TILE_M } from './tex';
import { LIFE_CAP } from './spec';
import { QUALITIES, type Quality } from '../quality';
import { sceneGfx } from '../gfx';

const plan = cityPlan();

const corners = (h: House): { x: number; z: number }[] => {
  const rx = -h.fz;
  const rz = h.fx;
  return [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ].map(([a, c]) => ({ x: h.x + rx * (h.w / 2) * a + h.fx * (h.d / 2) * c, z: h.z + rz * (h.w / 2) * a + h.fz * (h.d / 2) * c }));
};

/** Счёт каждого уровня — один раз на файл: город собирается целиком, это секунды. */
const counted = new Map<Quality, CityCounts>();
const countsOf = (q: Quality): CityCounts => {
  let c = counted.get(q);
  if (!c) counted.set(q, (c = cityCounts(q, plan)));
  return c;
};

describe('город: бюджет по уровням', () => {
  for (const q of QUALITIES) {
    it(`${q}: вызовы, треугольники с теневым проходом и память текстур — в границах владельца`, () => {
      const c = countsOf(q);
      const lim = CITY_BUDGET[q];
      expect(c.calls, 'вызовов').toBeLessThanOrEqual(lim.calls);
      expect(c.triangles, 'треугольников').toBeLessThanOrEqual(lim.triangles);
      expect(c.textureMb, 'МБ текстур').toBeLessThanOrEqual(lim.textureMb);
      // Граница области: город собран целиком, а не пуст — иначе бюджет держался бы даром.
      expect(c.buildings).toBeGreaterThan(15_000);
      expect(c.trees).toBeGreaterThan(20_000);
    });
  }

  it('уровни качества работают: выбор игрока доходит до сцены города, и низкий дешевле среднего, средний — высокого', () => {
    // Выбор → сцена: уровень из записи (и адреса) идёт в сцену как есть, «Авто» — по устройству (`null`).
    for (const q of QUALITIES) expect(sceneGfx({ quality: q }, ''), q).toEqual({ quality: q, asked: true });
    expect(sceneGfx({ quality: 'auto' }, '')).toEqual({ quality: null, asked: false });
    // Сцена → город: мир, тени и жизнь собираются по уровню сцены, а не по своему числу.
    const scene = readFileSync(join(__dirname, 'scene.ts'), 'utf8');
    expect(scene, 'мир').toMatch(/buildCity\(this\.quality\)/);
    expect(scene, 'тени').toMatch(/CITY_SPEC\[this\.quality\]/);
    expect(scene, 'жизнь').toMatch(/new CityLife\(\{[^}]*quality: this\.quality/);
    // Уровни разные на деле: каждый следующий дешевле предыдущего — треугольниками и памятью текстур.
    const [high, medium, low] = (['high', 'medium', 'low'] as const).map(countsOf);
    expect(low.triangles, 'треугольники: низкий < средний').toBeLessThan(medium.triangles);
    expect(medium.triangles, 'треугольники: средний < высокий').toBeLessThan(high.triangles);
    expect(low.textureMb, 'текстуры: низкий < средний').toBeLessThan(medium.textureMb);
    expect(medium.textureMb, 'текстуры: средний < высокий').toBeLessThan(high.textureMb);
    expect(LIFE_CAP.low.people, 'жизнь: низкий < средний').toBeLessThan(LIFE_CAP.medium.people);
    expect(LIFE_CAP.medium.people, 'жизнь: средний < высокий').toBeLessThan(LIFE_CAP.high.people);
  });
});

describe('город: раскладка', () => {
  it('план от зерна один и тот же', () => {
    expect(JSON.stringify(cityPlan().houses)).toBe(JSON.stringify(plan.houses));
  });

  it('дома внутри стены, не на улицах и не друг на друге', () => {
    expect(plan.houses.length).toBeGreaterThan(150);
    for (const h of plan.houses) {
      for (const p of corners(h)) {
        expect(insidePoly(p, plan.wall), 'угол дома внутри стены').toBe(true);
        for (const s of plan.streets) {
          expect(distPoly(p, s.pts), `угол дома не на улице «${s.name}»`).toBeGreaterThanOrEqual(s.half);
        }
        expect(insidePoly(p, plan.square), 'угол дома не на площади').toBe(false);
      }
    }
    // Не друг на друге: середина каждого дома вне следа любого другого.
    for (const a of plan.houses) {
      for (const b of plan.houses) {
        if (a === b) continue;
        const lx = (a.x - b.x) * -b.fz + (a.z - b.z) * b.fx;
        const lz = (a.x - b.x) * b.fx + (a.z - b.z) * b.fz;
        expect(Math.abs(lx) < b.w / 2 - 0.1 && Math.abs(lz) < b.d / 2 - 0.1, 'середина дома в чужом следе').toBe(false);
      }
    }
  });

  it('лес — вне стены и вне гласиса: под стеной луг на 26 м', () => {
    const trees = placeTrees(plan, 250, 8, 17, 800);
    const all = Object.values(trees).flat();
    const forest = all.filter((t) => forestAt(t.x, t.z, plan) > 0);
    // Граница области: в лесу есть деревья, и их много.
    expect(forest.length).toBeGreaterThan(1000);
    for (const t of forest) {
      const p = { x: t.x, z: t.z };
      expect(insidePoly(p, plan.wall) || insidePoly(p, plan.castleWall), 'дерево леса внутри стены').toBe(false);
      expect(Math.min(distPoly(p, plan.wall, true), distPoly(p, plan.castleWall, true)), 'дерево леса на гласисе').toBeGreaterThanOrEqual(26);
    }
  });
});

describe('город: слои текстур', () => {
  it('слой от зерна один и тот же, размер — сторона² × 4', () => {
    const a = paintLayer('roofTile', 32);
    const b = paintLayer('roofTile', 32);
    expect(a.length).toBe(32 * 32 * 4);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('у каждого слоя нет шва по краю плитки: скачок через край — как между соседними столбцами', () => {
    const S = 64;
    for (const n of LAYERS) {
      const px = paintLayer(n, S);
      const lum = (x: number, y: number): number => {
        const k = (y * S + x) * 4;
        return px[k] * 0.3 + px[k + 1] * 0.59 + px[k + 2] * 0.11;
      };
      let edge = 0;
      let inner = 0;
      for (let y = 0; y < S; y++) {
        edge += Math.abs(lum(S - 1, y) - lum(0, y));
        for (let x = 0; x < S - 1; x++) inner += Math.abs(lum(x + 1, y) - lum(x, y));
      }
      inner /= S - 1;
      expect(edge, `${n}: шов по краю (плитка ${TILE_M[n].join('×')} м)`).toBeLessThan(inner * 2.5 + S * 2);
    }
  });
});
