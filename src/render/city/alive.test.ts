// Суета города (docs/city.md, 13): телеги, утки, лодки, стяги — той цены, что считает бюджет; телега проходит в арку
// главных ворот и обходит ряды рынка, бочки, колодец и статую; утки и лодки — в воде; стяги — на стене, над аркой; ночью
// новые телеги не выходят, зимой река подо льдом; на низком уровне суеты нет.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RIVER_HALF, cityPlan, insidePoly, riverX } from './layout';
import { CART_DWELL, CART_KEEP_RIGHT, CART_SPEED, CityBustle, DUCK_FLOCKS, bannerSpots, boatAt, boatGeometry, cartAt, cartGeometry, cartRoute, duckAt, duckGeometry } from './alive';
import { at } from './life';
import { LIFE_CAP, LIFE_TRIS } from './spec';

const plan = cityPlan();
const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position.count) / 3;
const mesh = (b: CityBustle, name: string): THREE.InstancedMesh => b.group.getObjectByName(name) as THREE.InstancedMesh;

describe('город: суета', () => {
  it('фигуры той цены, что считает бюджет', () => {
    expect(tris(cartGeometry())).toBe(LIFE_TRIS.cart);
    expect(tris(duckGeometry())).toBe(LIFE_TRIS.duck);
    expect(tris(boatGeometry())).toBe(LIFE_TRIS.boat);
    const b = new CityBustle({ plan, quality: 'medium' });
    const banners = b.group.getObjectByName('city-banners') as THREE.Mesh;
    expect(tris(banners.geometry)).toBe(bannerSpots(plan.towers).length * LIFE_TRIS.banner);
    b.dispose();
  });

  it('телега въезжает в арку главных ворот и выезжает из неё по другой стороне', () => {
    const r = cartRoute(plan)!;
    const gate = plan.gates[0];
    // Где путь пересекает линию ворот (z ворот): туда и обратно.
    const xs: number[] = [];
    for (let s = 0.5; s < r.path.len; s += 0.5) {
      const a = { ...at(r.path, s - 0.5).p };
      const b = at(r.path, s).p;
      if ((a.z - gate.z) * (b.z - gate.z) <= 0) xs.push(b.x - gate.x);
    }
    // Граница области: путь проходит ворота ровно дважды.
    expect(xs.length).toBe(2);
    for (const x of xs) {
      // Арка — 4 м: упряжка (полуширина 0.86 м) — в ней целиком.
      expect(Math.abs(x) + 0.86, 'в арке').toBeLessThan(2);
      expect(Math.abs(x), 'правее середины').toBeGreaterThan(CART_KEEP_RIGHT * 0.6);
    }
    expect(Math.sign(xs[0]), 'встречные — по разные стороны').toBe(-Math.sign(xs[1]));
  });

  it('по площади телега обходит ряды, бочки, колодец с чашей и статую', () => {
    const r = cartRoute(plan)!;
    let inSquare = 0;
    for (let s = 0; s < r.path.len; s += 0.5) {
      const p = { ...at(r.path, s).p };
      if (!insidePoly(p, plan.square)) continue;
      inSquare++;
      for (const st of plan.stalls) {
        // Прилавок с навесом: вдоль ряда ±(w/2 + 0.15), поперёк ±1.7 м; упряжка — полуширина 0.86.
        const inside = Math.abs(p.x - st.x) < st.w / 2 + 0.15 + 0.86 && Math.abs(p.z - st.z) < 1.7 + 0.86;
        expect(inside, `прилавок (${st.x.toFixed(1)}, ${st.z.toFixed(1)}) — путь (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBe(false);
      }
      expect(Math.hypot(p.x - plan.well.x, p.z - plan.well.z), 'колодец').toBeGreaterThan(1.5 + 0.86 + 0.5);
      expect(Math.hypot(p.x - (plan.well.x + 3.2), p.z - (plan.well.z + 1.5)), 'чаша').toBeGreaterThan(1.2 + 0.86);
      // Статуя — постамент 2.2 м.
      expect(Math.max(Math.abs(p.x - plan.statue.x), Math.abs(p.z - plan.statue.z)), 'статуя').toBeGreaterThan(1.1 + 0.86);
      // Бочки и ящики у рядов (`civic.marketProps`).
      for (const [bx, bz] of [
        [-16.5, 19.5],
        [25, 16.5],
        [8, 22.8],
      ]) {
        expect(Math.hypot(p.x - bx, p.z - bz), `бочки (${bx}, ${bz})`).toBeGreaterThan(1.3 + 0.86);
      }
    }
    // Граница области: круг по площади — больше сотни метров пути.
    expect(inSquare * 0.5).toBeGreaterThan(100);
  });

  it('телеги — функция времени: едут ровно, стоят у рядов, друг друга не догоняют', () => {
    const r = cartRoute(plan)!;
    const n = LIFE_CAP.high.carts;
    const cycle = r.path.len / CART_SPEED + CART_DWELL + 20;
    let stood = 0;
    // Граница области: полный круг каждой телеги.
    for (let t = 0; t < cycle; t += 0.5) {
      const now = Array.from({ length: n }, (_, i) => cartAt(r.path.len, r.stop, t, i / n));
      const next = Array.from({ length: n }, (_, i) => cartAt(r.path.len, r.stop, t + 0.5, i / n));
      now.forEach((c, i) => {
        if (c.away || next[i].away) return;
        expect(next[i].s - c.s, 'вперёд не быстрее вола').toBeLessThanOrEqual(CART_SPEED * 0.5 + 1e-6);
        expect(next[i].s - c.s, 'не назад').toBeGreaterThanOrEqual(0);
        if (c.moving === 0) stood++;
      });
      const vis = now.filter((c) => !c.away).map((c) => c.s).sort((a, b) => a - b);
      for (let k = 1; k < vis.length; k++) expect(vis[k] - vis[k - 1], 'между телегами').toBeGreaterThan(6);
    }
    expect(stood * 0.5, 'стоят у рядов').toBeGreaterThan(n * CART_DWELL * 0.9);
    const stop = at(r.path, r.stop).p;
    expect(Math.hypot(stop.x - 17, stop.z - 25.3), 'стоянка у южной кромки рядов').toBeLessThan(2);
  });

  it('утки и лодки — в воде, не у самой кромки', () => {
    let ducks = 0;
    // Граница области: стайки на весь круг вожака (до 340 с).
    for (let t = 0; t < 340; t += 1) {
      DUCK_FLOCKS.forEach((z0, f) => {
        for (let i = 0; i < 5; i++) {
          const p = duckAt(z0, i, t, f * 0.37);
          expect(Math.abs(p.x - riverX(p.z)), 'утка в реке').toBeLessThan(RIVER_HALF - 1.5);
          ducks++;
        }
      });
    }
    expect(ducks).toBeGreaterThan(1000);
    for (let t = 0; t < 1600; t += 2) {
      const b = boatAt(t, 0.11);
      expect(Math.abs(b.x - riverX(b.z)), 'лодка в реке').toBeLessThan(RIVER_HALF - 2.5);
      // Правее середины по ходу: на юг — к западу, на север — к востоку.
      expect(Math.sign(riverX(b.z) - b.x)).toBe(b.dir);
    }
  });

  it('стяги — на стене ворот и донжона, над аркой проезда', () => {
    const spots = bannerSpots(plan.towers);
    const owners = [...new Set(spots.map((s) => s.tower))].map((i) => plan.towers[i]);
    // Граница области: стяги на главных воротах и донжоне есть всегда, у каждой башни — по два.
    expect(owners.some((t) => t.kind === 'keep')).toBe(true);
    expect(owners.some((t) => t.kind === 'gate' && t.z > 100)).toBe(true);
    for (const t of owners) {
      const mine = spots.filter((s) => plan.towers[s.tower] === t);
      expect(mine.length).toBe(2);
      for (const s of mine) {
        const out = (s.x - t.x) * s.nx + (s.z - t.z) * s.nz;
        expect(out, 'у самой стены, снаружи').toBeGreaterThan(t.size / 2);
        expect(out).toBeLessThan(t.size / 2 + 0.5);
        if (t.kind !== 'keep') expect(s.y - s.h, 'низ над аркой (8 м)').toBeGreaterThan(t.base + 8 + 0.5);
        expect(s.y, 'верх ниже зубцов').toBeLessThan(t.base + t.height);
        // Не в соседней башне.
        for (const o of plan.towers) {
          if (o === t) continue;
          expect(Math.abs(s.x - o.x) < o.size / 2 && Math.abs(s.z - o.z) < o.size / 2, 'не в соседней башне').toBe(false);
        }
      }
    }
  });

  it('ночью новые телеги не выходят и лодка не плывёт; зимой уток нет, лодка рыбака вмёрзла; на низком — ничего', () => {
    const day = new CityBustle({ plan, quality: 'high' });
    day.update(100, 0, 0);
    expect(mesh(day, 'city-carts').count, 'днём телеги в пути').toBeGreaterThan(0);
    expect(mesh(day, 'city-ducks').count).toBe(LIFE_CAP.high.ducks);
    day.update(5000, 0, 1);
    expect(mesh(day, 'city-ducks').count, 'подо льдом уток нет').toBe(0);
    expect(mesh(day, 'city-boats').count, 'только лодка рыбака').toBe(1);
    day.dispose();
    const night = new CityBustle({ plan, quality: 'high' });
    night.update(100, 1, 0);
    expect(mesh(night, 'city-carts').count, 'ночью ворота закрыты').toBe(0);
    expect(mesh(night, 'city-boats').count, 'ночью только рыбак').toBe(1);
    night.dispose();
    const low = new CityBustle({ plan, quality: 'low' });
    expect(low.group.children.length, 'на низком суеты нет').toBe(0);
    low.dispose();
  });
});
