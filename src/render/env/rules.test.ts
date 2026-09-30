// Правила окружения пробы: зона расчистки, покров не на дорогах и не под домами,
// детерминизм, бюджет уровней качества, и ни одного нового имени three.
//
// Каждое свойство названо вместе со своей областью (правило 11): где правило вообще
// спрашивается — и тест сначала проверяет, что точки в эту область попали, а потом уже
// само правило. Иначе точка за границей даёт зелёный даром.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '@/game/data/buildings';
import { visualTier } from '../buildings';
import { CLEAR_EDGE, CLEAR_RADIUS, GATE_ANGLE, GATE_CLEAR_HALF, WALL_RADIUS, inCleared } from '../plan';
import { FOREST_FROM, GROUND_RADIUS, ZONES } from '../terrain';
import { BUDGET, QUALITIES, QUALITY } from '../quality';
import { blobModel, flowerModel, groundModel, propModel, treeModel, trianglesOf, tuftModel } from './models';
import {
  CROWN,
  PROP_KINDS,
  PROP_SPREAD,
  SPECIES,
  forestDensity,
  groundMap,
  layoutOf,
  roadDist,
  sample,
  scatterCrops,
  scatterFlowers,
  scatterGrass,
  scatterProps,
  scatterTrees,
  trailDist,
  type EnvVillage,
} from './rules';

/** Посёлок на потолке: все постройки, третья ступень. */
const FULL: EnvVillage = {
  present: BUILDINGS.map((b) => b.id),
  built: BUILDINGS.map((b) => ({ type: b.id, tier: visualTier(10) })),
};

const layout = layoutOf(FULL);
const trees = scatterTrees(layout);
const props = scatterProps(layout, 1);
// Карта земли на 256 — той же сетки, что у среднего уровня.
const map = groundMap(layout, 256);
const grass = scatterGrass(layout, map, QUALITY.high.grass);
const flowers = scatterFlowers(layout, map, QUALITY.high.flowers);

/** Точка в коридоре перед воротами: вдоль луча ворот и ближе полуширины к нему. */
function inGate(x: number, z: number, pad: number): boolean {
  const along = x * Math.cos(GATE_ANGLE) + z * Math.sin(GATE_ANGLE);
  if (along <= 0) return false;
  return Math.abs(-x * Math.sin(GATE_ANGLE) + z * Math.cos(GATE_ANGLE)) < GATE_CLEAR_HALF + pad;
}

describe('окружение пробы: зона расчистки', () => {
  it('лес подходит к расчистке — точки у самой её границы есть', () => {
    // Область правила — кольцо у CLEAR_RADIUS: без деревьев у границы проверка ниже была бы даром.
    const nearest = Math.min(...trees.map((t) => Math.hypot(t.x, t.z) - CROWN[t.species] * t.scale));
    expect(nearest).toBeLessThan(CLEAR_RADIUS + CLEAR_EDGE + 2);
    expect(trees.length).toBeGreaterThan(300);
  });

  it('ни одна крона не заходит в расчистку и в коридор перед воротами', () => {
    const bad = trees.filter((t) => inCleared(t.x, t.z, CROWN[t.species] * t.scale));
    expect(bad.map((t) => `${t.species} ${t.x.toFixed(1)}/${t.z.toFixed(1)}`)).toEqual([]);
    const gate = trees.filter((t) => inGate(t.x, t.z, CROWN[t.species] * t.scale));
    expect(gate.length, 'дерево в коридоре ворот').toBe(0);
  });

  it('мелочь — пни, брёвна, камни, кусты, папоротник — тоже снаружи, и полоса вырубки занята', () => {
    const bad = props.filter((p) => inCleared(p.x, p.z, PROP_SPREAD[p.kind] * p.scale));
    expect(bad.map((p) => `${p.kind} ${p.x.toFixed(1)}/${p.z.toFixed(1)}`)).toEqual([]);
    // Область: полоса вырубки сразу за чертой — в ней обязаны стоять следы работы.
    const edge = props.filter((p) => {
      const r = Math.hypot(p.x, p.z);
      return r > CLEAR_RADIUS && r < CLEAR_RADIUS + CLEAR_EDGE;
    });
    expect(edge.filter((p) => p.kind === 'stump').length).toBeGreaterThan(20);
    for (const kind of PROP_KINDS) expect(props.some((p) => p.kind === kind), kind).toBe(true);
  });
});

describe('окружение пробы: покров', () => {
  it('трава и цветы есть и внутри стены, и на лугу за ней, и в лесу', () => {
    const r = (t: { x: number; z: number }): number => Math.hypot(t.x, t.z);
    expect(grass.filter((t) => r(t) < WALL_RADIUS - 1).length, 'внутри стены').toBeGreaterThan(100);
    expect(grass.filter((t) => r(t) > WALL_RADIUS + 1 && r(t) < CLEAR_RADIUS).length, 'луг').toBeGreaterThan(2000);
    expect(grass.filter((t) => r(t) > FOREST_FROM).length, 'лес').toBeGreaterThan(200);
    expect(flowers.filter((t) => r(t) > WALL_RADIUS + 1 && r(t) < CLEAR_RADIUS).length, 'цветы на лугу').toBeGreaterThan(100);
  });

  it('ни пучка на мостовой, под домом и на стене', () => {
    // Область: у каждой дороги и каждого дома рядом есть трава (иначе правило не спрашивается).
    const nearRoad = grass.filter((t) => roadDist(layout, t.x, t.z) < 0.6);
    expect(nearRoad.length, 'трава у обочин').toBeGreaterThan(50);
    expect(grass.filter((t) => roadDist(layout, t.x, t.z) < 0).length, 'на полотне').toBe(0);
    expect(flowers.filter((t) => roadDist(layout, t.x, t.z) < 0).length, 'цветы на полотне').toBe(0);
    for (const s of layout.spots) {
      const near = grass.filter((t) => Math.hypot(t.x - s.x, t.z - s.z) < s.r * 1.8);
      expect(near.filter((t) => Math.hypot(t.x - s.x, t.z - s.z) < s.r).length, `под домом у ${s.x.toFixed(1)}/${s.z.toFixed(1)}`).toBe(0);
    }
    expect(grass.filter((t) => Math.abs(Math.hypot(t.x, t.z) - WALL_RADIUS) < 1.2).length, 'на стене').toBe(0);
  });

  it('тропы протоптаны: на них голая земля и нет травы', () => {
    const on = grass.filter((t) => trailDist(layout, t.x, t.z) < 0);
    expect(on.length).toBe(0);
    // Точки на самой тропе: середины её отрезков — там земля вытоптана.
    const mids = layout.trails.map((s) => ({ x: (s.ax + s.bx) / 2, z: (s.az + s.bz) / 2 }));
    const soil = mids.map((m) => sample(map, map.soil, m.x, m.z));
    expect(Math.min(...soil)).toBeGreaterThan(0.5);
  });

  it('карта знает лес и камень: подстилка под пологом, камень у скал', () => {
    // Подстилка — под пологом: там, где лес густ, она есть; на лугу её нет.
    const dense: number[] = [];
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      const x = Math.cos(a) * (GROUND_RADIUS - 5);
      const z = Math.sin(a) * (GROUND_RADIUS - 5);
      if (forestDensity(layout, x, z) > 0.7) dense.push(sample(map, map.litter, x, z));
    }
    expect(dense.length, 'точки густого леса найдены').toBeGreaterThan(20);
    expect(Math.min(...dense)).toBeGreaterThan(0.6);
    expect(sample(map, map.litter, 0, WALL_RADIUS + 2)).toBeLessThan(0.05);
    // Камень у скал — пятнами, трава между камнями остаётся: меряем кругом, а не точкой.
    const around: number[] = [];
    for (let dx = -2.5; dx <= 2.5; dx += 0.5) for (let dz = -2.5; dz <= 2.5; dz += 0.5) around.push(sample(map, map.stone, ZONES.rocks.x + dx, ZONES.rocks.z + dz));
    expect(Math.max(...around)).toBeGreaterThan(0.6);
    expect(around.reduce((a, b) => a + b, 0) / around.length).toBeGreaterThan(0.1);
    expect(sample(map, map.stone, -ZONES.rocks.x, -ZONES.rocks.z)).toBe(0);
    const field = layout.fields[2];
    expect(sample(map, map.field, field.x, field.z)).toBeGreaterThan(0.9);
    expect(scatterCrops(layout, 1).length).toBeGreaterThan(40);
  });
});

describe('окружение пробы: правила леса', () => {
  it('детерминирован: та же раскладка — тот же лес и та же трава', () => {
    const again = scatterTrees(layoutOf(FULL));
    expect(again).toEqual(trees);
    expect(scatterGrass(layout, groundMap(layoutOf(FULL), 256), 5000)).toEqual(scatterGrass(layout, map, 5000));
  });

  it('все четыре породы, у опушки берёза, у скал сосна', () => {
    for (const s of SPECIES) expect(trees.some((t) => t.species === s), s).toBe(true);
    const edge = trees.filter((t) => Math.hypot(t.x, t.z) < FOREST_FROM + 2);
    const deep = trees.filter((t) => Math.hypot(t.x, t.z) > FOREST_FROM + 6);
    const share = (list: typeof trees, s: string): number => list.filter((t) => t.species === s).length / Math.max(1, list.length);
    expect(edge.length).toBeGreaterThan(30);
    expect(share(edge, 'birch')).toBeGreaterThan(share(deep, 'birch'));
    const rocks = trees.filter((t) => Math.hypot(t.x - ZONES.rocks.x, t.z - ZONES.rocks.z) < 8);
    expect(rocks.length).toBeGreaterThan(3);
    expect(share(rocks, 'pine')).toBeGreaterThan(0.5);
  });

  it('у угодий лес расступается, вдоль троп — редеет', () => {
    expect(forestDensity(layout, ZONES.fields.x, ZONES.fields.z)).toBeLessThan(0.1);
    const t = layout.trails[3];
    expect(forestDensity(layout, t.bx, t.bz)).toBe(0);
  });
});

describe('окружение пробы: бюджет уровней', () => {
  it('окружение каждого уровня укладывается в свой бюджет вызовов, треугольников и памяти текстур', () => {
    const tri = {
      near: Object.fromEntries(SPECIES.map((s) => [s, trianglesOf(treeModel(s, 'near'))])) as Record<string, number>,
      far: Object.fromEntries(SPECIES.map((s) => [s, trianglesOf(treeModel(s, 'far'))])) as Record<string, number>,
      prop: Object.fromEntries(PROP_KINDS.map((k) => [k, trianglesOf(propModel(k))])) as Record<string, number>,
    };
    const tuft = trianglesOf(tuftModel(false));
    const crop = trianglesOf(tuftModel(true));
    const flower = trianglesOf(flowerModel());
    const blob = trianglesOf(blobModel());
    for (const q of QUALITIES) {
      const spec = QUALITY[q];
      const qmap = groundMap(layout, spec.groundMap);
      const qprops = scatterProps(layout, spec.props);
      const g = scatterGrass(layout, qmap, spec.grass);
      const f = scatterFlowers(layout, qmap, spec.flowers);
      const c = scatterCrops(layout, spec.grass > 0 ? 1 : 0.5);
      // Верхняя граница: все деревья прежнего мира ближней моделью, дальний лес — дальней.
      const triangles =
        trianglesOf(groundModel()) +
        trees.reduce((n, t) => n + (t.far ? tri.far[t.species] : tri.near[t.species]), 0) +
        qprops.reduce((n, p) => n + tri.prop[p.kind], 0) +
        g.length * tuft +
        c.length * crop +
        f.length * flower +
        (trees.filter((t) => !t.far).length + qprops.length) * blob;
      // Вызовы: земля, по два меша на породу, по мешу на вид мелочи, покров и пятна.
      const calls = 1 + SPECIES.length * 2 + PROP_KINDS.length + (g.length > 0 ? 1 : 0) + 1 + (f.length > 0 ? 1 : 0) + 1;
      const textureMb = (spec.shadowMap ** 2 * 8 + spec.groundMap ** 2 * 4 * 2 * (4 / 3) + 128 * 128 * 4 * (4 / 3)) / 1048576;
      expect(g.length, `${q}: трава не больше заказанного`).toBeLessThanOrEqual(spec.grass);
      expect(triangles, `${q}: треугольники`).toBeLessThanOrEqual(BUDGET[q].triangles);
      expect(calls, `${q}: вызовы`).toBeLessThanOrEqual(BUDGET[q].calls);
      expect(textureMb, `${q}: текстуры`).toBeLessThanOrEqual(BUDGET[q].textureMb);
    }
  });

  it('уровни идут по убыванию: низкий ничем не дороже среднего, средний — высокого', () => {
    const keys = ['dpr', 'shadowMap', 'grass', 'flowers', 'props', 'grassFar', 'treeNear', 'groundMap'] as const;
    for (const k of keys) {
      expect(QUALITY.low[k], k).toBeLessThanOrEqual(QUALITY.medium[k]);
      expect(QUALITY.medium[k], k).toBeLessThanOrEqual(QUALITY.high[k]);
    }
  });
});

// ---------- Имена three ----------

const ROOT = path.resolve(__dirname, '../../..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (statSync(abs).isDirectory()) out.push(...sources(abs));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(abs);
  }
  return out;
}

const threeNames = (file: string): string[] => [...readFileSync(file, 'utf8').matchAll(/\bTHREE\.([A-Z][A-Za-z0-9]*)/g)].map((m) => m[1]);

describe('окружение пробы: первая загрузка', () => {
  it('кусок окружения не берёт ни одного имени three, которого нет в игре', () => {
    // Имя класса, взятое ленивым куском, дописывается в общий кусок three первой загрузки
    // (docs/prologue.md, «три имени»). Игра — всё, кроме ленивых дверей.
    const all = sources(path.join(ROOT, 'src')).map((f) => f.split(path.sep).join('/'));
    const lazy = /\/src\/(render\/env|prologue|render\/battle|ui\/battle)\//;
    const game = new Set(all.filter((f) => !lazy.test(f)).flatMap(threeNames));
    const env = all.filter((f) => f.includes('/src/render/env/'));
    // Область: файлы окружения найдены, и имена three в них есть.
    expect(env.length).toBeGreaterThanOrEqual(3);
    const used = new Set(env.flatMap(threeNames));
    expect(used.size).toBeGreaterThan(5);
    expect([...used].filter((n) => !game.has(n))).toEqual([]);
  });
});
