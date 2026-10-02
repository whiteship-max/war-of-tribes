// Вода города (docs/city.md, 12.3): лента реки доходит до кромки и тает к ней, а не обрывается краем; ручей,
// вошедший в реку, не ложится вторым слоем; берег сырой по высоте над водой; камыш — у кромки, камни — на берегу,
// от зерна и по уровню; ночью в воде — огни у воды, не дальше их досягаемости; счёт бюджета сходится с моделями; на
// низком уровне шейдер воды без отблесков огней, на среднем — без искр.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type * as THREE from 'three';
import { cityPlan, heightAt, raceRibbon, riverLevel, riverRibbon, riverX, RIVER_HALF } from './layout';
import { groundWet, lightToWater, shoreItems, shoreOffset, SHORE_FIT, SHORE_Z, waterDepth, waterGeometry, waterLights, waterTriangles, WATER_LIGHT_REACH, WATER_LIGHTS, WET_RISE } from './banks';
import { buildStatic } from './budget';
import { cityUniforms } from './material';
import { shoreModelTris } from './shore';
import { SHORE_CAP, shoreTris } from './spec';
import { buildWater } from './water';
import { QUALITIES } from '../quality';
import { openLand } from './ground';

const plan = cityPlan();
const rows = riverRibbon();

describe('город: лента воды', () => {
  for (const q of QUALITIES) {
    it(`${q}: лента реки доходит до кромки и тает к ней — за краем воды нет, крайняя вершина сухая`, () => {
      const cols = SHORE_CAP[q].cols;
      const w = cols.length;
      const a = waterGeometry(cols);
      let checked = 0;
      const capped: number[] = [];
      rows.forEach((p, k) => {
        // Граница области: видимый участок реки — от леса за замком до дороги в долину.
        if (p.z < SHORE_Z[0] || p.z > SHORE_Z[1]) return;
        checked++;
        const mid = k * w + cols.indexOf(0);
        expect(a.depth[mid], `z ${p.z}: посередине — глубь`).toBeGreaterThan(0.9);
        for (const end of [0, w - 1]) {
          const v = k * w + end;
          const x = a.pos[v * 3];
          const z = a.pos[v * 3 + 2];
          expect(a.depth[v], `z ${p.z}: крайняя вершина сухая — вода к ней тает`).toBeLessThanOrEqual(0);
          if (Math.hypot(x - p.x, z - p.z) >= SHORE_FIT + 0.5) {
            capped.push(p.z);
            continue;
          }
          // Под крайней вершиной — суша: лента не кончается посреди воды.
          expect(waterDepth(x, z), `z ${p.z}: край ленты — за кромкой`).toBeLessThanOrEqual(0);
        }
      });
      // Граница области: проверены все строки видимого участка (через 8 м), а не часть.
      expect(checked).toBe(rows.filter((p) => p.z >= SHORE_Z[0] && p.z <= SHORE_Z[1]).length);
      expect(checked).toBeGreaterThan(70);
      // Дальше `SHORE_FIT` кромку находит только устье мельничного ручья — там воду несёт его лента.
      for (const z of capped) expect(z > -20 && z < 40, `кромка дальше ${SHORE_FIT} м только у устьев ручья: z ${z}`).toBe(true);
    });
  }

  it('ручей, вошедший в реку, прозрачен, а в своём русле у мельницы — вода', () => {
    const a = waterGeometry(SHORE_CAP.medium.cols);
    const river = rows.length * SHORE_CAP.medium.cols.length;
    let merged = 0;
    let own = 0;
    for (let v = river; v < a.depth.length; v++) {
      const x = a.pos[v * 3];
      const z = a.pos[v * 3 + 2];
      expect(a.race[v], 'метка ручья').toBe(1);
      const d = Math.abs(x - riverX(z));
      if (d < RIVER_HALF + 2) {
        merged++;
        expect(a.depth[v], `ручей в реке (x ${x.toFixed(1)}, z ${z.toFixed(1)}) — прозрачен`).toBeLessThanOrEqual(0);
      } else if (d > RIVER_HALF + 12 && (v - river) % 5 === 2) {
        // Середина русла ручья (колонна 0 из пяти) вдали от реки.
        own++;
        expect(a.depth[v], `ручей у мельницы (x ${x.toFixed(1)}, z ${z.toFixed(1)}) — вода`).toBeGreaterThan(0.3);
      }
    }
    // Граница области: в реку входят оба конца ручья, а у мельницы он течёт своим руслом.
    expect(a.depth.length - river).toBe(raceRibbon().length * 5);
    expect(merged).toBeGreaterThanOrEqual(4);
    expect(own).toBeGreaterThanOrEqual(8);
  });

  it('счёт бюджета сходится с моделями: лента, куртина камыша, камень', () => {
    for (const q of QUALITIES) {
      const cap = SHORE_CAP[q];
      expect(waterTriangles(cap.cols), `${q}: лента`).toBe(waterGeometry(cap.cols).idx.length / 3);
      expect(shoreTris(cap.reedBlades), `${q}: камыш и камень`).toEqual(shoreModelTris(cap.reedBlades));
    }
  });
});

describe('город: берег', () => {
  it('сырость — по высоте над водой: под водой и у кромки ил, выше — убывает, за WET_RISE сухо', () => {
    let under = 0;
    let between = 0;
    let dry = 0;
    for (let z = SHORE_Z[0]; z <= SHORE_Z[1]; z += 37) {
      for (const side of [-1, 1] as const) {
        for (let d = RIVER_HALF - 2; d < RIVER_HALF + 14; d += 0.5) {
          const x = riverX(z) + side * d;
          const rise = heightAt(x, z) - riverLevel(z);
          const wet = groundWet(x, z);
          if (waterDepth(x, z) >= 0) {
            under++;
            expect(wet, `под водой (z ${z}, ${d} м) — ил`).toBe(1);
            continue;
          }
          if (rise >= WET_RISE) {
            dry++;
            expect(wet, `выше ${WET_RISE} м над водой (z ${z}, ${d} м) — сухо`).toBe(0);
          } else {
            between++;
            expect(wet, `над водой на ${rise.toFixed(2)} м — сыро, но не ил`).toBeLessThan(1);
            expect(wet).toBeGreaterThan(0);
            expect(wet, 'чем выше над водой, тем суше').toBeCloseTo(1 - rise / WET_RISE, 5);
          }
        }
      }
    }
    // Граница области: прошли все три полосы — воду, сырой склон и сухую долину.
    expect(under).toBeGreaterThan(50);
    expect(between).toBeGreaterThan(20);
    expect(dry).toBeGreaterThan(20);
  });

  it('камыш — у кромки и не глубже метра, камни — на берегу; не на дорогах и во дворах; от зерна и по уровню', () => {
    const counts: { reeds: number; stones: number }[] = [];
    for (const q of QUALITIES) {
      const cap = SHORE_CAP[q];
      const it = shoreItems(plan, q);
      counts.push({ reeds: it.reeds.length, stones: it.stones.length });
      // Граница области: берег не пуст, и потолок уровня держится.
      expect(it.reeds.length, `${q}: камыш`).toBeGreaterThan(cap.reeds / 4);
      expect(it.reeds.length).toBeLessThanOrEqual(cap.reeds);
      expect(it.stones.length, `${q}: камни`).toBeGreaterThan(cap.stones / 4);
      expect(it.stones.length).toBeLessThanOrEqual(cap.stones);
      for (const r of it.reeds) {
        const side = r.x > riverX(r.z) ? 1 : -1;
        const off = Math.abs(r.x - riverX(r.z)) - shoreOffset(r.z, side);
        expect(off, `${q}: камыш у кромки (z ${r.z.toFixed(1)})`).toBeGreaterThanOrEqual(-1.6);
        expect(off, `${q}: камыш у кромки (z ${r.z.toFixed(1)})`).toBeLessThanOrEqual(0.7);
        expect(waterDepth(r.x, r.z), `${q}: камыш не глубже метра`).toBeLessThan(1);
        expect(openLand(r.x, r.z, plan, 1.5), `${q}: камыш не на дороге и не во дворе`).toBe(true);
      }
      for (const s of it.stones) {
        const side = s.x > riverX(s.z) ? 1 : -1;
        const off = Math.abs(s.x - riverX(s.z)) - shoreOffset(s.z, side);
        expect(off, `${q}: камень на берегу (z ${s.z.toFixed(1)})`).toBeGreaterThanOrEqual(0.1);
        expect(off).toBeLessThanOrEqual(2.6);
        expect(openLand(s.x, s.z, plan, 1.5), `${q}: камень не на дороге и не во дворе`).toBe(true);
      }
    }
    // Уровни разные на деле: каждый следующий гуще.
    for (let k = 1; k < counts.length; k++) {
      expect(counts[k].reeds, 'камыш: уровень ниже — реже').toBeLessThan(counts[k - 1].reeds);
      expect(counts[k].stones, 'камни: уровень ниже — реже').toBeLessThan(counts[k - 1].stones);
    }
    // От зерна: то же зерно — тот же берег, другое — другой.
    expect(JSON.stringify(shoreItems(plan, 'low'))).toBe(JSON.stringify(shoreItems(plan, 'low')));
    expect(JSON.stringify(shoreItems(plan, 'low', 7))).not.toBe(JSON.stringify(shoreItems(plan, 'low')));
  });
});

describe('город: вода ночью и уровни', () => {
  it('в воде — огни у воды: ближние первыми, не больше четырёх и не дальше досягаемости', () => {
    // У z = −200 рядом только река: ручей мельницы — у z от 2 до 34.
    const x0 = riverX(-200);
    const at = (d: number): [number, number, number] => [x0 + RIVER_HALF + d, 0, -200];
    const lights = [at(30), at(5), at(WATER_LIGHT_REACH + 1), at(0), at(12), at(2), at(20)];
    const got = waterLights(lights).map(lightToWater);
    expect(got).toEqual([0, 2, 5, 12]);
    // У настоящего города огонь у воды есть — фонарь мельницы: отблески не мёртвые.
    const real = waterLights(buildStatic(plan, 'medium').lights);
    expect(real.length, 'огни у воды в городе').toBeGreaterThanOrEqual(1);
    expect(real.length).toBeLessThanOrEqual(WATER_LIGHTS);
    for (const l of real) expect(lightToWater(l)).toBeLessThan(WATER_LIGHT_REACH);
  });

  it('уровень качества доходит до шейдера воды: низкий — без отблесков огней, средний — без искр', () => {
    const u = cityUniforms();
    const frag = (detail: 0 | 1 | 2): { text: string; key: string; def: unknown } => {
      const m = buildWater(u, SHORE_CAP.low.cols, detail, []).material as THREE.MeshLambertMaterial;
      const shader = {
        uniforms: {},
        vertexShader: '#include <begin_vertex>',
        fragmentShader: '#include <map_fragment>\n#include <emissivemap_fragment>\n#include <opaque_fragment>',
      };
      m.onBeforeCompile(shader as never, undefined as never);
      return { text: shader.fragmentShader, key: m.customProgramCacheKey(), def: m.defines?.WATER_DETAIL };
    };
    const [low, medium, high] = [frag(0), frag(1), frag(2)];
    expect([low.def, medium.def, high.def]).toEqual([0, 1, 2]);
    expect(new Set([low.key, medium.key, high.key]).size, 'у каждого уровня своя программа').toBe(3);
    // Обход огней — только под WATER_DETAIL ≥ 1, искры — только под ≥ 2: шейдер один, лишнее вырезает уровень.
    const guarded = (text: string, what: RegExp, level: number): boolean => {
      const at = text.search(what);
      const open = text.lastIndexOf(`#if WATER_DETAIL >= ${level}`, at);
      return at > 0 && open >= 0 && text.indexOf('#endif', open) > at;
    };
    expect(guarded(low.text, /for \(int i = 0; i < \d+; i\+\+\)/, 1), 'огни в воде — со среднего').toBe(true);
    expect(guarded(low.text, /pow\(max\(dot\(fn, wh\), 0\.0\), 900\.0\)/, 2), 'искры — на высоком').toBe(true);
    // Сборка города отдаёт воде уровень сцены, а не своё число.
    const index = readFileSync(join(__dirname, 'index.ts'), 'utf8');
    expect(index).toMatch(/buildWater\(u, cap\.cols, spec\.detail, waterLights\(lights\)\)/);
  });
});
