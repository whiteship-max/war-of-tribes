import { describe, expect, it } from 'vitest';
import { HeightRaster, NO_HEIGHT, SPLASH_KINK, heightAt, splashSpot, type HeightField, type Surface } from './heights';

// Поле 64 м по стороне, клетка — метр: земля на нуле, дом 12 × 8 м с двускатной кровлей вдоль x — стены до 6 м, конёк
// на 10 м, скат 45° (кровля поднимается на метр на метр — вторая разность по скату нулевая).
const N = 64;
const X0 = -32;
/** Земля сеткой 32 × 32 квадратов — две тысячи треугольников: есть что резать на куски. */
function grid(): Surface {
  const positions: number[] = [];
  const index: number[] = [];
  const k = 32;
  for (let j = 0; j <= k; j++) for (let i = 0; i <= k; i++) positions.push(X0 + (i * N) / k, 0, X0 + (j * N) / k);
  for (let j = 0; j < k; j++)
    for (let i = 0; i < k; i++) {
      const a = j * (k + 1) + i;
      index.push(a, a + 1, a + k + 2, a, a + k + 2, a + k + 1);
    }
  return { positions, index };
}
const ground = grid();
// Дом: x от −6 до 6, z от −4 до 4; кровля — два ската от карнизов (z = ±4, y = 6) к коньку (z = 0, y = 10).
const roof: Surface = {
  positions: [-6, 6, -4, 6, 6, -4, 6, 10, 0, -6, 10, 0, -6, 6, 4, 6, 6, 4],
  index: [0, 1, 2, 0, 2, 3, 3, 2, 5, 3, 5, 4],
};
/** Кровля над точкой — аналитически (внутри дома). */
const roofY = (z: number): number => 10 - Math.abs(z);

function field(): HeightField {
  const r = new HeightRaster(X0, X0, N, N);
  r.add(ground);
  r.add(roof);
  r.step();
  return r.field;
}

describe('поле высот верха города', () => {
  it('клетка — высота самой верхней поверхности над её серединой: кровля над землёй, земля вокруг', () => {
    const f = field();
    // Середины клеток внутри дома (не у карниза и не на коньке, где клетка делит два ската).
    for (let i = -5; i < 5; i++) {
      for (const j of [-3, -2, 1, 2]) {
        const x = i + 0.5;
        const z = j + 0.5;
        expect(Math.abs(x) < 6 && Math.abs(z) < 4, `точка ${x},${z} внутри дома`).toBe(true);
        expect(heightAt(f, x, z)).toBeCloseTo(roofY(z), 4);
      }
    }
    // Вокруг дома — земля.
    expect(heightAt(f, 10.5, 10.5)).toBeCloseTo(0, 6);
    expect(heightAt(f, -20.5, 0.5)).toBeCloseTo(0, 6);
    // За краем поля поверхности нет.
    expect(heightAt(f, 40, 0)).toBe(NO_HEIGHT);
  });

  it('брызги ложатся на скат кровли и на землю; у карниза и за краем поля — нет', () => {
    const f = field();
    // Скат: вторая разность высоты по соседям — ноль (ровный уклон), брызги стоят на кровле.
    const onRoof = splashSpot(f, 0.3, -2.2);
    expect(onRoof).not.toBeNull();
    expect(onRoof!.y).toBeCloseTo(roofY(onRoof!.z), 4);
    const onGround = splashSpot(f, 15.2, 15.7);
    expect(onGround?.y).toBeCloseTo(0, 6);
    // Клетки у стены: сосед по одну сторону — земля, по другую — кровля; перегиб — высота стены (6 м).
    for (const [x, z] of [
      [6.5, 0.5],
      [-6.5, -1.5],
      [0.5, 4.5],
    ] as const) {
      const hi = Math.max(heightAt(f, x - 1, z), heightAt(f, x + 1, z), heightAt(f, x, z - 1), heightAt(f, x, z + 1));
      expect(hi - heightAt(f, x, z), `у стены ${x},${z}`).toBeGreaterThan(SPLASH_KINK);
      expect(splashSpot(f, x, z), `у стены ${x},${z}`).toBeNull();
    }
    expect(splashSpot(f, -31.9, 0)).toBeNull();
  });

  it('кусками — то же поле, что разом', () => {
    const whole = field();
    const r = new HeightRaster(X0, X0, N, N);
    r.add(ground);
    r.add(roof);
    let clock = 0;
    let steps = 0;
    // Часы идут на миллисекунду за каждый взгляд: бюджет в 1 мс — сотня с небольшим треугольников за шаг.
    while (!r.step(1, () => clock++)) steps++;
    expect(r.field.h).toEqual(whole.h);
    // Две тысячи треугольников земли по сотне с небольшим за шаг — больше десятка кусков.
    expect(steps).toBeGreaterThan(10);
  });
});
