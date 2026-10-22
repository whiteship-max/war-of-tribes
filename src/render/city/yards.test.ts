// Вид объединённых дворов и местности (docs/city_v3.md, ЗД-2): дороги не упираются в воду и в скалы, проходы свободны от утвари
// дворов, крылья мельницы крутятся (ночью медленнее, в тревогу стоят), усадьба растёт с уровнем Фермы, подписи и касание —
// на новых моделях, голос здания (ЗВ-1) — у постройки, которой касаются.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { BuildingTypeId } from '@/game/types';
import { HALL_MIX } from '@/sound/epoch/halls';
import { cityPlan, distSeg, FARM_TIERS, heightAt, hillsAt, MINE_HILLS, MINE_PORTAL, RIDGE_CRAGS, riverX, RIVER_HALF, SAWMILL_BRIDGE, type P, type Street } from './layout';
import { buildStatic } from './budget';
import { waterDepth } from './banks';
import { Builder } from './geom';
import { ADIT, GATHER_SHED, PEN, WINDMILL, aditSill, deckAt, windmillAt, yard, yardHalls } from './outskirts';
import { FarmView, SAIL_EASE, SAIL_NIGHT, SAIL_SPIN, growthCount, sailStep, sailTarget, type SailSpin } from './mill';
import { herdOf } from './life';
import { mainSite, ownerCode, type Site } from './sites';
import { Frame } from './kit';

const plan = cityPlan();
const st = buildStatic(plan, 'medium');
const yardOf = (k: string) => plan.yards.find((y) => y.kind === k)!;
const portal = new Frame(MINE_PORTAL.x, MINE_PORTAL.z, Math.cos(MINE_PORTAL.rot), Math.sin(MINE_PORTAL.rot));

/** Точки оси дороги через `step` метров с ходом дороги — в пределах ближнего мира (дальше — дымка, `WORLD_EDGE`). */
function axis(r: Street, step = 1): (P & { tx: number; tz: number })[] {
  const out: (P & { tx: number; tz: number })[] = [];
  for (let k = 0; k < r.pts.length - 1; k++) {
    const a = r.pts[k];
    const b = r.pts[k + 1];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    for (let s = 0; s < l; s += step) {
      const p = { x: a.x + ((b.x - a.x) * s) / l, z: a.z + ((b.z - a.z) * s) / l, tx: (b.x - a.x) / l, tz: (b.z - a.z) / l };
      if (Math.abs(p.x) < 600 && Math.abs(p.z) < 600) out.push(p);
    }
  }
  const [a, b] = [r.pts[r.pts.length - 2], r.pts[r.pts.length - 1]];
  const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  out.push({ x: b.x, z: b.z, tx: (b.x - a.x) / l, tz: (b.z - a.z) / l });
  return out;
}

/** Точка на настиле моста — с запасом полуметра. */
const onBridge = (p: P): boolean => plan.bridges.some((br) => distSeg(p, br.a, br.b).d < br.half + 0.5 && distSeg(p, br.a, br.b).t > -0.02 && distSeg(p, br.a, br.b).t < 1.02);

/** Сколько метров от точки до воды (реки или мельничного ручья) — шагом в полметра по кругу; дальше `max` — `max`. */
function toWater(p: P, max: number): number {
  for (let d = 0; d <= max; d += 0.5) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      if (waterDepth(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d) > 0) return d;
    }
  }
  return max;
}

describe('ЗД-2: дороги и местность у дворов', () => {
  it('дороги не упираются в воду: ось дороги — не в воде, кроме настила моста; конец у воды — только у моста', () => {
    const wet: string[] = [];
    for (const r of plan.roads) {
      for (const p of axis(r)) if (waterDepth(p.x, p.z) > 0 && !onBridge(p)) wet.push(`${r.name} (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
      for (const e of [r.pts[0], r.pts[r.pts.length - 1]]) {
        const atBridge = plan.bridges.some((br) => Math.hypot(e.x - br.b.x, e.z - br.b.z) < 1 || Math.hypot(e.x - br.a.x, e.z - br.a.z) < 1);
        if (!atBridge && toWater(e, 4) < 4) wet.push(`${r.name}: конец (${e.x.toFixed(0)}, ${e.z.toFixed(0)}) у воды`);
      }
    }
    expect(wet, 'дорога в воде').toEqual([]);
    // Граница области: тропа к лесопилке кончается у самой воды — у моста, а мост перекрывает воду ручья.
    const trail = plan.roads.find((r) => r.name === 'Тропа к реке')!;
    const end = trail.pts[trail.pts.length - 1];
    expect(Math.hypot(end.x - SAWMILL_BRIDGE.b.x, end.z - SAWMILL_BRIDGE.b.z), 'тропа к реке кончается у моста').toBeLessThan(0.01);
    expect(toWater(end, 10), 'конец тропы — в нескольких метрах от ручья').toBeLessThan(6);
    let over = 0;
    for (let t = 0; t <= 1; t += 0.05) {
      const p = { x: SAWMILL_BRIDGE.a.x + (SAWMILL_BRIDGE.b.x - SAWMILL_BRIDGE.a.x) * t, z: SAWMILL_BRIDGE.a.z + (SAWMILL_BRIDGE.b.z - SAWMILL_BRIDGE.a.z) * t };
      if (waterDepth(p.x, p.z) > 0) {
        over++;
        expect(deckAt(SAWMILL_BRIDGE, t), 'настил над водой').toBeGreaterThan(heightAt(p.x, p.z) + waterDepth(p.x, p.z) + 1);
      }
    }
    expect(over, 'мост перекрывает ручей').toBeGreaterThan(4);
    // Концы моста — на суше и вровень с землёй: тропа входит на настил без ступени.
    for (const [e, t] of [
      [SAWMILL_BRIDGE.a, 0],
      [SAWMILL_BRIDGE.b, 1],
    ] as const) {
      expect(waterDepth(e.x, e.z), 'конец моста на суше').toBeLessThan(0);
      expect(Math.abs(deckAt(SAWMILL_BRIDGE, t) - heightAt(e.x, e.z)), 'настил вровень с землёй').toBeLessThan(0.2);
    }
  });

  it('дороги не упираются в скалы: не лезут на гряду, мимо скальных выходов и лба Шахты, у Шахты — без крутого косогора', () => {
    const bad: string[] = [];
    // Скальные выходы — с запасом на обломок у подножия; лоб Шахты — кругом в 8 м вокруг середины скалы за устьем.
    const [lx, lz] = portal.q(-3, 0);
    const crags = [...RIDGE_CRAGS.map((c) => ({ x: c.x, z: c.z, r: c.r * 1.6 })), { x: lx, z: lz, r: 8 }];
    for (const r of plan.roads) {
      for (const p of axis(r)) {
        const h = hillsAt(p.x, p.z);
        if (h > 0.3) bad.push(`${r.name} на гряде (${p.x.toFixed(0)}, ${p.z.toFixed(0)}): ${h.toFixed(2)} м`);
        for (const c of crags) if (Math.hypot(p.x - c.x, p.z - c.z) < c.r + r.half + 1) bad.push(`${r.name} у скалы (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
      }
    }
    expect([...new Set(bad)], 'дорога в скалах').toEqual([]);
    // У Шахты и гряды тропа идёт долиной: поперёк — не круче 0,3, вдоль — не круче 0,25.
    const trail = plan.roads.find((r) => r.name === 'Тропа к реке')!;
    let near = 0;
    for (const p of axis(trail)) {
      const hill = Math.min(...MINE_HILLS.map((c) => Math.hypot(p.x - c.x, p.z - c.z) - c.r));
      if (hill > 12 || p.z < 30) continue;
      near++;
      // Поперёк хода: от края до края полосы.
      const e = trail.half;
      const across = Math.abs(heightAt(p.x - p.tz * e, p.z + p.tx * e) - heightAt(p.x + p.tz * e, p.z - p.tx * e)) / (2 * e);
      expect(across, `косогор у гряды (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`).toBeLessThan(0.3);
    }
    // Граница области: тропа и правда идёт вдоль гряды — в полутора десятках метров от подножия холмов.
    expect(near, 'точек тропы у подножия гряды').toBeGreaterThan(30);
  });

  it('у реки гряды нет: берег и уровень воды у гряды — прежние', () => {
    const near = RIVER_HALF + 12;
    let tested = 0;
    for (let z = 66; z <= 230; z += 2) {
      for (let d = 0; d <= near; d += 1) {
        for (const side of [-1, 1]) {
          tested++;
          expect(hillsAt(riverX(z) + side * d, z), `гряда у реки (${d} м, z ${z})`).toBe(0);
        }
      }
    }
    expect(tested).toBeGreaterThan(1000);
    // Граница области: гряда подходит к берегу ближе, чем на свой радиус, — без защиты она заходила бы в русло и на берег.
    const reach = Math.min(...MINE_HILLS.map((c) => Math.abs(c.x - riverX(c.z)) - c.r - near));
    expect(reach, 'край холма гряды — у самой полосы берега').toBeLessThan(0);
  });

  it('проходы свободны: утварь дворов не стоит на полосе проезда — и там, где тропа идёт по двору', () => {
    // Полоса проезда — середина дороги (у края — полоса в 1,3 м, как у улиц, `square.test.ts`); настил моста — сама дорога.
    const found = new Set<string>();
    let tested = 0;
    for (const y of plan.yards) {
      const b = new Builder();
      yard(b, y, 1);
      const roads = plan.roads.filter((r) => r.pts.some((p, k) => k < r.pts.length - 1 && distSeg({ x: y.x, z: y.z }, p, r.pts[k + 1]).d < y.r + 12));
      const P = b.pos;
      const I = b.idx;
      for (let t = 0; t < I.length; t += 3) {
        for (const [u, v] of [
          [1, 0],
          [0, 1],
          [0, 0],
          [1 / 3, 1 / 3],
        ]) {
          const w = 1 - u - v;
          const x = P[I[t] * 3] * u + P[I[t + 1] * 3] * v + P[I[t + 2] * 3] * w;
          const yy = P[I[t] * 3 + 1] * u + P[I[t + 1] * 3 + 1] * v + P[I[t + 2] * 3 + 1] * w;
          const z = P[I[t] * 3 + 2] * u + P[I[t + 1] * 3 + 2] * v + P[I[t + 2] * 3 + 2] * w;
          for (const r of roads) {
            const core = r.half - 1.3;
            let d = Infinity;
            for (let k = 0; k < r.pts.length - 1; k++) d = Math.min(d, distSeg({ x, z }, r.pts[k], r.pts[k + 1]).d);
            // Рядом с дорогой — в трёх метрах за краем полосы: утварь двора и правда стоит у самого проезда.
            if (d < core + 3) tested++;
            if (d >= core) continue;
            const dy = yy - heightAt(x, z);
            if (dy < 0.02 || dy > 2.2 || onBridge({ x, z })) continue;
            found.add(`${y.kind} на «${r.name}» (${Math.round(x)}, ${Math.round(z)}) ${dy.toFixed(2)} м`);
          }
        }
      }
    }
    expect([...found], 'утварь на проезде').toEqual([]);
    // Граница области: утварь дворов стоит у самых проездов, а тропы проходят дворы — к реке через двор Шахты, «Дорога к
    // хутору» — меж хутором и загоном.
    expect(tested, 'точек утвари у полос проезда').toBeGreaterThan(50);
    const lane = (name: string, y: string): number => {
      const r = plan.roads.find((x) => x.name === name)!;
      const c = yardOf(y);
      return Math.min(...r.pts.slice(0, -1).map((p, k) => distSeg({ x: c.x, z: c.z }, p, r.pts[k + 1]).d)) - c.r;
    };
    expect(lane('Тропа к реке', 'mine'), 'тропа к реке — по двору Шахты').toBeLessThan(0);
    expect(lane('Дорога к хутору', 'farm'), 'дорога к хутору — по двору Фермы').toBeLessThan(0);
    expect(lane('Дорога к хутору', 'pen'), 'и по загону').toBeLessThan(0);
  });

  it('загон — у хутора, через проезд: усадьба одна, а не хутор и выгон в полутораста метрах', () => {
    const farm = yardOf('farm');
    const pen = yardOf('pen');
    expect(Math.hypot(farm.x - pen.x, farm.z - pen.z), 'от хутора до загона').toBeLessThan(farm.r + pen.r);
    // Изгороди не сходятся: между хутором (передняя изгородь — 7 м вперёд) и загоном — проезд шире дороги.
    const gap = pen.z - PEN.F - (farm.z + 7);
    const road = plan.roads.find((r) => r.name === 'Дорога к хутору')!;
    expect(gap, 'проезд между изгородями').toBeGreaterThan(road.half * 2 + 1.5);
  });
});

describe('ЗД-2: мельница Фермы', () => {
  const run = (night: number, alarm: number, secs: number, s: SailSpin = { angle: 0, speed: SAIL_SPIN }): { s: SailSpin; turned: number; jump: number } => {
    let turned = 0;
    let jump = 0;
    for (let t = 0; t < secs; t += 1 / 30) {
      const a = s.angle;
      sailStep(s, sailTarget(night, alarm), 1 / 30);
      const d = (s.angle - a + Math.PI * 4) % (Math.PI * 2);
      turned += d;
      jump = Math.max(jump, d);
    }
    return { s, turned, jump };
  };

  it('крылья крутятся днём, ночью медленнее, в тревогу встают — плавно, без рывков', () => {
    const day = run(0, 0, 20);
    expect(day.turned, 'днём за 20 с').toBeGreaterThan(SAIL_SPIN * 20 * 0.95);
    // Ночь — после разгона на новую скорость (за пять постоянных разгона): точки — внутри «ночи», а не на переходе.
    const night = run(1, 0, 5 * SAIL_EASE);
    const n2 = run(1, 0, 20, night.s);
    // Обещание — «ночью медленнее, но идут»: не быстрее 0,6 дневного хода и не медленнее 0,2.
    expect(n2.turned, 'ночью за 20 с').toBeLessThan(day.turned * 0.6);
    expect(n2.turned, 'ночью крылья всё же идут').toBeGreaterThan(day.turned * 0.2);
    expect(n2.turned / day.turned, 'ночь — по SAIL_NIGHT').toBeCloseTo(SAIL_NIGHT, 1);
    // Тревога: встают за несколько постоянных разгона и стоят.
    const stop = run(0, 1, 8 * SAIL_EASE);
    expect(stop.s.speed, 'в тревогу — стоят').toBe(0);
    const still = run(0, 1, 10, stop.s);
    expect(still.turned, 'стоят и дальше').toBe(0);
    // Без рывков: шаг кадра — не больше дневной скорости на кадр, и долгий кадр (свёрнутая вкладка) не перекидывает крылья.
    expect(Math.max(day.jump, n2.jump, stop.jump)).toBeLessThanOrEqual((SAIL_SPIN / 30) * 1.001);
    const s: SailSpin = { angle: 1, speed: SAIL_SPIN };
    sailStep(s, SAIL_SPIN, 30);
    expect(s.angle - 1, 'шаг в 30 с — как в четверть секунды').toBeCloseTo(SAIL_SPIN * 0.25, 6);
  });

  it('меш крыльев крутится вокруг своей оси, ступица — перед шатром, крылья не задевают амбар, дом и землю', () => {
    for (const q of ['low', 'medium', 'high'] as const) expect(buildStatic(plan, q).sails, `крылья своим мешем на «${q}»`).not.toBeNull();
    const sl = st.sails!;
    const view = new FarmView(sl, new THREE.Mesh(new THREE.BufferGeometry()), null, () => 0);
    view.update(1, 0, 0);
    const a1 = view.sails.rotation.x;
    view.update(1, 0, 0);
    expect(view.sails.rotation.x, 'угол растёт').toBeGreaterThan(a1);
    // Ось — вперёд рамки хутора (к камере игры): после поворота меша его ось x смотрит на (fx, fz).
    const axisW = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, view.sails.rotation.y, 0, 'YXZ'));
    expect(axisW.x).toBeCloseTo(sl.fx, 6);
    expect(axisW.z).toBeCloseTo(sl.fz, 6);
    const farm = yardOf('farm');
    const m = windmillAt(farm);
    // Каждая вершина крыльев при любом угле — выше земли на два метра и вне коробок дома и амбара.
    const P = sl.b.pos;
    const [house, barn] = yardHalls(farm);
    // Конёк кровли: дом — два этажа (6,3 м) и скат 55° на полглубины, амбар — 4,2 м и 50° на полглубины, с запасом в метр.
    const houseTop = house.base + 6.3 + (house.d / 2) * Math.tan((55 * Math.PI) / 180) + 1;
    const barnTop = barn.base + 4.2 + (barn.d / 2) * Math.tan((50 * Math.PI) / 180) + 1;
    for (let a = 0; a < Math.PI / 2; a += Math.PI / 24) {
      const e = new THREE.Euler(a, view.sails.rotation.y, 0, 'YXZ');
      for (let k = 0; k < P.length; k += 3) {
        const v = new THREE.Vector3(P[k], P[k + 1], P[k + 2]).applyEuler(e).add(new THREE.Vector3(...sl.at));
        expect(v.y - heightAt(v.x, v.z), 'крыло над землёй').toBeGreaterThan(2);
        // Дом 15 × 8 (вперёд — 8) и амбар 12 × 8,5 поперёк — с запасом в метр на свесы кровли.
        // Дом 15 × 8 вдоль x и амбар 12 × 8,5 поперёк (вдоль z) — коробками с запасом в метр на свесы.
        expect(Math.abs(v.x - house.x) < 8.5 && Math.abs(v.z - house.z) < 5 && v.y < houseTop, 'крыло в доме').toBe(false);
        expect(Math.abs(v.x - barn.x) < 5.3 && Math.abs(v.z - barn.z) < 7 && v.y < barnTop, 'крыло в амбаре').toBe(false);
      }
    }
    expect(sl.at[1], 'ступица — над кладкой').toBeGreaterThan(m.top);
    expect(WINDMILL.H).toBeGreaterThan(8);
  });
});

describe('ЗД-2: усадьба растёт с уровнем Фермы', () => {
  it('ступени роста открываются на своих уровнях и только растут; скота — от трети стада до всего', () => {
    const g = st.growth!;
    expect(g.tiers.length).toBe(FARM_TIERS.length);
    expect(g.tiers[0], 'первая ступень не пуста').toBeGreaterThan(0);
    expect(g.tiers[1], 'вторая больше первой').toBeGreaterThan(g.tiers[0]);
    expect(g.tiers[1]).toBe(g.b.idx.length);
    let was = -1;
    for (let lv = 1; lv <= 10; lv++) {
      const n = growthCount(g.tiers, lv);
      expect(n, `уровень ${lv}: рост не убывает`).toBeGreaterThanOrEqual(was);
      was = n;
    }
    expect(growthCount(g.tiers, FARM_TIERS[0] - 1), 'до первой ступени — ничего').toBe(0);
    expect(growthCount(g.tiers, FARM_TIERS[0]), 'на первой — её часть').toBe(g.tiers[0]);
    expect(growthCount(g.tiers, FARM_TIERS[1] - 1)).toBe(g.tiers[0]);
    expect(growthCount(g.tiers, FARM_TIERS[1]), 'на второй — весь рост').toBe(g.tiers[1]);
    expect(growthCount(g.tiers, 10)).toBe(g.tiers[1]);
    // Меш роста рисует столько, сколько открыл уровень.
    const geo = new THREE.BufferGeometry();
    const view = new FarmView(st.sails!, new THREE.Mesh(), new THREE.Mesh(geo), (lv) => growthCount(g.tiers, lv));
    view.setLevel(1);
    expect(view.growth!.visible).toBe(false);
    view.setLevel(5);
    expect(geo.drawRange.count).toBe(g.tiers[0]);
    view.setLevel(9);
    expect(geo.drawRange.count).toBe(g.tiers[1]);
    const n = 14;
    expect(herdOf(1, n)).toBeLessThan(n / 2);
    expect(herdOf(10, n)).toBe(n);
    for (let lv = 2; lv <= 10; lv++) expect(herdOf(lv, n)).toBeGreaterThanOrEqual(herdOf(lv - 1, n));
  });

  it('рост — Фермы: каждая вершина роста — её, и стоит в коробке хутора или загона (касание по ней открывает Ферму)', () => {
    const g = st.growth!.b;
    const farmSites = st.sites.filter((s) => s.type === 'farm');
    const inBox = (x: number, y: number, z: number, s: Site): boolean => {
      const dx = x - s.x;
      const dz = z - s.z;
      return Math.abs(dx * s.fx + dz * s.fz) < s.hf + 0.6 && Math.abs(-dx * s.fz + dz * s.fx) < s.hr + 0.6 && y > s.y0 - 1 && y < s.y1 + 1;
    };
    for (let k = 0; k < g.pos.length / 3; k++) {
      expect(g.cfg[k * 4 + 3], 'чья вершина роста').toBe(ownerCode('farm'));
      const [x, y, z] = [g.pos[k * 3], g.pos[k * 3 + 1], g.pos[k * 3 + 2]];
      expect(farmSites.some((s) => inBox(x, y, z, s)), `вершина роста (${x.toFixed(1)}, ${z.toFixed(1)}) вне коробок Фермы`).toBe(true);
    }
  });
});

describe('ЗД-2: подписи, касание и голос на новых моделях', () => {
  it('подпись — на теле главного места: Ферма — над хутором, не над загоном; Шахта — у устья; двор охотника — у дома и навеса', () => {
    const label = (t: BuildingTypeId): { x: number; y: number; z: number } => {
      const m = mainSite(st.sites, t)!;
      return { x: m.x, y: (m.y0 + m.y1) / 2, z: m.z };
    };
    const farm = yardOf('farm');
    const f = label('farm');
    expect(Math.hypot(f.x - farm.x, f.z - farm.z), 'Ферма — над хутором').toBeLessThan(farm.r * 0.6);
    expect(f.y, 'подпись над землёй').toBeGreaterThan(heightAt(f.x, f.z) + 2);
    const mn = label('mine');
    expect(Math.hypot(mn.x - MINE_PORTAL.x, mn.z - MINE_PORTAL.z), 'Шахта — у устья').toBeLessThan(12);
    expect(mn.y).toBeGreaterThan(heightAt(mn.x, mn.z) + 1);
    const hut = yardOf('hunter_hut');
    const hl = label('hunter_hut');
    const fr = new Frame(hut.x, hut.z, Math.cos(hut.rot), Math.sin(hut.rot));
    const [sx, sz] = fr.q(GATHER_SHED.f, GATHER_SHED.r);
    // Между домом и навесом: подпись не уезжает к рамам у опушки.
    expect(Math.hypot(hl.x - (hut.x + sx) / 2, hl.z - (hut.z + sz) / 2), 'двор охотника — у дома и навеса').toBeLessThan(6);
    const saw = yardOf('sawmill');
    const sl = label('sawmill');
    expect(Math.hypot(sl.x - saw.x, sl.z - saw.z), 'Лесопилка — у дома на острове').toBeLessThan(8);
  });

  it('касание по новым моделям открывает их постройку, и у неё есть голос (ЗВ-1); скалы гряды — ничьи', () => {
    const farm = yardOf('farm');
    const hut = yardOf('hunter_hut');
    const pen = yardOf('pen');
    const fr = new Frame(hut.x, hut.z, Math.cos(hut.rot), Math.sin(hut.rot));
    const pf = new Frame(pen.x, pen.z, Math.cos(pen.rot), Math.sin(pen.rot));
    const m = windmillAt(farm);
    const sl = st.sails!;
    const g0 = aditSill(portal);
    const at = (x: number, z: number, y: number): [number, number, number] => [x, y, z];
    const points: [BuildingTypeId, string, [number, number, number]][] = [
      ['farm', 'башня мельницы', at(m.x, m.z, m.base + 5)],
      ['farm', 'верхний мах крыльев', [sl.at[0], sl.at[1] + 7, sl.at[2]]],
      ['farm', 'загон', at(...pf.q(0, 0), heightAt(pen.x, pen.z) + 1)],
      ['hunter_hut', 'навес сборщиков', at(...fr.q(GATHER_SHED.f, GATHER_SHED.r), heightAt(...fr.q(GATHER_SHED.f, GATHER_SHED.r)) + 1.5)],
      ['hunter_hut', 'рама со шкурой', at(...fr.q(6.5, -12.8), heightAt(...fr.q(6.5, -12.8)) + 1)],
      ['mine', 'оклад устья', at(...portal.q(ADIT.collar, 0), g0 + 2)],
      ['sawmill', 'мост', at((SAWMILL_BRIDGE.a.x + SAWMILL_BRIDGE.b.x) / 2, (SAWMILL_BRIDGE.a.z + SAWMILL_BRIDGE.b.z) / 2, deckAt(SAWMILL_BRIDGE, 0.5) + 0.5)],
    ];
    const has = (t: BuildingTypeId, [x, y, z]: [number, number, number]): boolean =>
      st.sites.some((s) => {
        if (s.type !== t) return false;
        const dx = x - s.x;
        const dz = z - s.z;
        return Math.abs(dx * s.fx + dz * s.fz) <= s.hf && Math.abs(-dx * s.fz + dz * s.fx) <= s.hr && y >= s.y0 && y <= s.y1;
      });
    for (const [t, what, p] of points) {
      expect(has(t, p), `${what}: в коробке ${t}`).toBe(true);
      expect(HALL_MIX[t], `${what}: голос у ${t}`).toBeGreaterThan(0);
    }
    // Скальные выходы гряды — ни в чьей коробке, кроме ничьей земли.
    for (const c of RIDGE_CRAGS) {
      const p: [number, number, number] = [c.x, heightAt(c.x, c.z) + c.h * 0.6, c.z];
      expect(st.sites.some((s) => has(s.type, p)), `скала (${c.x}, ${c.z}) — ничья`).toBe(false);
    }
  });
});
