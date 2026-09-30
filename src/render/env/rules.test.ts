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
import { FOREST_FROM, GLADES, GROUND_RADIUS, ZONES } from '../terrain';
import { QUALITY } from '../quality';
import {
  CROWN,
  PROP_KINDS,
  PROP_SPREAD,
  SPECIES,
  edgeRadius,
  forestDensity,
  gateEdge,
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

/** Точка на луче ворот: вдоль дороги и поперёк неё (со знаком). */
const gateAxes = (x: number, z: number): { along: number; across: number } => ({
  along: x * Math.cos(GATE_ANGLE) + z * Math.sin(GATE_ANGLE),
  across: -x * Math.sin(GATE_ANGLE) + z * Math.cos(GATE_ANGLE),
});

/** Прогалины угодий и коридор ворот — там край задан не опушкой. */
const offEdge = (x: number, z: number): boolean =>
  inGate(x, z, 4) || GLADES.some((g) => Math.hypot(x - g.at.x, z - g.at.z) < g.r * 1.3) || trailDist(layout, x, z) < 1.5;

describe('окружение пробы: рваный край леса', () => {
  it('край леса не окружность: заливы и мысы по кругу, и лес идёт за краем, а не за радиусом', () => {
    // Сам край: по кругу он ходит больше чем на две с половиной единицы и много раз.
    const N = 360;
    // Край зависит от точки, а не от угла: радиус края в направлении — неподвижная точка
    // r = edgeRadius(r · направление), три шага от FOREST_FROM.
    const e = Array.from({ length: N }, (_, k) => {
      const a = (k / N) * 2 * Math.PI;
      let r = FOREST_FROM;
      for (let i = 0; i < 3; i++) r = edgeRadius(Math.cos(a) * r, Math.sin(a) * r);
      return r;
    });
    expect(Math.max(...e) - Math.min(...e), 'размах края, ед.').toBeGreaterThan(2.5);
    let turns = 0;
    for (let k = 0; k < N; k++) {
      const d0 = e[k] - e[(k + N - 1) % N];
      const d1 = e[(k + 1) % N] - e[k];
      if (d0 * d1 < 0) turns++;
    }
    expect(turns, 'заливов и мысов').toBeGreaterThan(20);
    // Лес идёт за краем: перед ним (на 0.8 ближе) лес редок, за ним (на 1.5 дальше) — гуще.
    // Область — направления, где край задан опушкой, а не дорогой, угодьем или тропой.
    let asked = 0;
    let sparse = 0;
    let before = 0;
    let after = 0;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * 2 * Math.PI;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      if (offEdge(c * e[k], sn * e[k])) continue;
      asked++;
      const din = forestDensity(layout, c * (e[k] - 0.8), sn * (e[k] - 0.8));
      if (din < 0.25) sparse++;
      before += din;
      after += forestDensity(layout, c * (e[k] + 1.5), sn * (e[k] + 1.5));
    }
    expect(asked, 'направлений с опушкой').toBeGreaterThan(N / 3);
    expect(sparse / asked, 'перед краем леса нет').toBeGreaterThan(0.95);
    expect(after, 'за краем лес гуще, чем перед ним').toBeGreaterThan(before * 3);
  });

  it('стена у дороги ворот рваная: отступ от коридора ходит вдоль дороги, а в коридор не заходит', () => {
    // Сама стена: на одном отступе от коридора лес то почти стоит, то почти нет.
    const at = (along: number, across: number) => ({
      x: along * Math.cos(GATE_ANGLE) - across * Math.sin(GATE_ANGLE),
      z: along * Math.sin(GATE_ANGLE) + across * Math.cos(GATE_ANGLE),
    });
    for (const side of [1, -1]) {
      const wall: number[] = [];
      for (let along = CLEAR_RADIUS + 1; along < GROUND_RADIUS - 2; along += 0.5) {
        const p = at(along, side * (GATE_CLEAR_HALF + 1.2));
        wall.push(gateEdge(p.x, p.z));
      }
      expect(Math.min(...wall), `обочина ${side}: стена отступила`).toBeLessThan(0.5);
      expect(Math.max(...wall), `обочина ${side}: стена подошла`).toBeGreaterThan(0.8);
    }
    // И деревья стоят по этой стене: ни одного в коридоре — пол правила расчистки на месте.
    const road = trees.filter((t) => !t.far && gateAxes(t.x, t.z).along > CLEAR_RADIUS && Math.abs(gateAxes(t.x, t.z).across) < 12);
    expect(road.length, 'деревьев у дороги').toBeGreaterThan(20);
    for (const t of road) expect(Math.abs(gateAxes(t.x, t.z).across)).toBeGreaterThan(GATE_CLEAR_HALF);
  });

  it('на опушке подлесок и молодняк: кусты у края, деревья у края мельче, чем в чаще', () => {
    const fringeBushes = props.filter((p) => (p.kind === 'bush' || p.kind === 'berry') && Math.abs(Math.hypot(p.x, p.z) - edgeRadius(p.x, p.z)) < 1.5);
    expect(fringeBushes.length, 'кустов на опушке').toBeGreaterThan(40);
    const near = trees.filter((t) => !t.far && Math.hypot(t.x, t.z) - edgeRadius(t.x, t.z) < 0.5);
    const deep = trees.filter((t) => !t.far && Math.hypot(t.x, t.z) - edgeRadius(t.x, t.z) > 4);
    expect(near.length, 'деревьев у края').toBeGreaterThan(40);
    const mean = (l: typeof trees): number => l.reduce((a, t) => a + t.scale, 0) / l.length;
    expect(mean(near)).toBeLessThan(mean(deep) * 0.8);
    const young = trees.filter((t) => t.scale < 0.6);
    expect(young.length, 'молодняка').toBeGreaterThan(30);
  });

  it('одинокие деревья стоят на лугу перед опушкой, но не в расчистке', () => {
    const lone = trees.filter((t) => !t.far && Math.hypot(t.x, t.z) < edgeRadius(t.x, t.z) - 1.3 && t.scale >= 0.85);
    expect(lone.length).toBeGreaterThan(2);
    for (const t of lone) expect(inCleared(t.x, t.z, CROWN[t.species] * t.scale)).toBe(false);
  });
});

describe('окружение пробы: бюджет уровней', () => {
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
