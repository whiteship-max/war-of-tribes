// Правила окружения пробы: зона расчистки, покров не на дорогах и не под домами,
// детерминизм, бюджет уровней качества, и ни одного нового имени three.
//
// Каждое свойство названо вместе со своей областью (правило 11): где правило вообще
// спрашивается — и тест сначала проверяет, что точки в эту область попали, а потом уже
// само правило. Иначе точка за границей даёт зелёный даром.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BUILDINGS } from '@/game/data/buildings';
import { visualTier } from '../buildings';
import { AZIMUTH, framing } from '../camera';
import { CLEAR_EDGE, CLEAR_RADIUS, GATE_ANGLE, GATE_CLEAR_HALF, PLAN, PLAZA_RADIUS, RING_RADIUS, SPARE_PLOTS, WALL_RADIUS, inCleared, placeOf, plotRadius } from '../plan';
import { FOREST_FROM, GLADES, GROUND_RADIUS, ZONES } from '../terrain';
import { QUALITY } from '../quality';
import {
  CROPS_CAP,
  CROWN,
  HAY_SPREAD,
  SOWN_LEVEL,
  SPARE_PLOT,
  PROP_KINDS,
  PROP_SPREAD,
  SEAM,
  SHEEP_SPREAD,
  SPECIES,
  edgeRadius,
  farmDist,
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
    // Пашня — уровнем посева: в середине полосы канал равен уровню того, что на ней посеяно.
    for (const f of layout.fields) expect(sample(map, map.field, f.x, f.z), f.sowing).toBeCloseTo(SOWN_LEVEL[f.sowing], 1);
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

  it('шов ближнего и дальнего леса не читается кольцом: подстилка по кругу не проваливается', () => {
    // Средняя подстилка на окружности, без коридора ворот: область — от чащи до края прежнего мира.
    const ring = (r: number): number => {
      let sum = 0;
      let n = 0;
      for (let k = 0; k < 360; k++) {
        const a = (k / 360) * 2 * Math.PI;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (inGate(x, z, 3.5)) continue;
        sum += sample(map, map.litter, x, z);
        n++;
      }
      return sum / n;
    };
    const deep = ring(SEAM - 2);
    expect(deep, 'в чаще подстилка есть').toBeGreaterThan(0.7);
    for (let r = SEAM - 2; r <= GROUND_RADIUS - 1.3; r += 0.25) expect(ring(r), `подстилка на ${r.toFixed(2)}`).toBeGreaterThan(deep - 0.1);
  });

  it('одинокие деревья стоят на лугу перед опушкой, но не в расчистке', () => {
    const lone = trees.filter((t) => !t.far && Math.hypot(t.x, t.z) < edgeRadius(t.x, t.z) - 1.3 && t.scale >= 0.85);
    expect(lone.length).toBeGreaterThan(2);
    for (const t of lone) expect(inCleared(t.x, t.z, CROWN[t.species] * t.scale)).toBe(false);
  });
});

describe('окружение пробы: угодья', () => {
  const farm = layout.farm;
  const pasture = farm.pasture;
  /** Звено у выгона, а не у тропы. */
  const ringPanel = (x: number, z: number): boolean => Math.abs(Math.hypot(x - pasture.x, z - pasture.z) - pasture.r) < 0.3;

  it('стога, изгороди и стадо есть, и всё — за чертой расчистки и не в коридоре ворот', () => {
    expect(farm.hay.length, 'стогов').toBeGreaterThanOrEqual(4);
    expect(farm.fences.length, 'звеньев изгороди').toBeGreaterThanOrEqual(12);
    expect(farm.flock.length, 'овец').toBeGreaterThanOrEqual(5);
    for (const h of farm.hay) {
      expect(inCleared(h.x, h.z, HAY_SPREAD * h.scale)).toBe(false);
      expect(inGate(h.x, h.z, HAY_SPREAD)).toBe(false);
    }
    for (const f of farm.fences) {
      expect(inCleared(f.x, f.z, f.length / 2)).toBe(false);
      expect(inGate(f.x, f.z, f.length / 2)).toBe(false);
    }
    for (const o of farm.flock) {
      expect(inCleared(o.x, o.z, SHEEP_SPREAD * o.scale)).toBe(false);
      expect(Math.hypot(o.x - pasture.x, o.z - pasture.z), 'овца внутри изгороди').toBeLessThan(pasture.r - 0.3);
    }
  });

  it('изгороди вдоль троп стоят у тропы, а не на ней, — у нескольких троп', () => {
    const byTrail = farm.fences.filter((f) => !ringPanel(f.x, f.z));
    expect(byTrail.length, 'звеньев у троп').toBeGreaterThan(4);
    for (const f of byTrail) {
      const d = trailDist(layout, f.x, f.z);
      expect(d, 'звено не на тропе').toBeGreaterThan(0.2);
      expect(d, 'звено у тропы').toBeLessThan(0.8);
    }
    // У скольких троп есть изгородь: тропа — ближайшая к звену.
    const trails = new Set(byTrail.map((f) => layout.trails.findIndex((t) => Math.hypot((t.ax + t.bx) / 2 - f.x, (t.az + t.bz) / 2 - f.z) < 1.2)));
    trails.delete(-1);
    expect(trails.size, 'троп с изгородью').toBeGreaterThanOrEqual(3);
  });

  it('ни крона, ни мелочь не протыкают изгородь, стог и выгон', () => {
    // Область: деревья и мелочь у угодий есть — правило спрашивается.
    const nearTrees = trees.filter((t) => !t.far && farmDist(layout, t.x, t.z) < 3);
    const nearProps = props.filter((p) => farmDist(layout, p.x, p.z) < 3);
    expect(nearTrees.length, 'деревьев у угодий').toBeGreaterThan(10);
    expect(nearProps.length, 'мелочи у угодий').toBeGreaterThan(3);
    for (const t of nearTrees) expect(farmDist(layout, t.x, t.z)).toBeGreaterThanOrEqual(CROWN[t.species] * t.scale - 1e-9);
    for (const p of nearProps) expect(farmDist(layout, p.x, p.z)).toBeGreaterThanOrEqual(PROP_SPREAD[p.kind] * p.scale - 1e-9);
  });

  it('стога у пашни — за торцами полос, не на полосах и не на тропах; в старой прогалине пашни — сенокос', () => {
    // Пашня лежит в расчистке, стог — за чертой: на оси своей полосы, за её дальним торцом.
    // Пар не жнут — стогов у него нет; у засеянных полос их не меньше трёх (сенокос у дороги
    // ложится на оси полос случайно, и одним-двумя совпадениями правило не подделать).
    const byField = farm.hay.filter((h) =>
      layout.fields.some((f) => {
        if (f.sowing === 'fallow') return false;
        const out = f.x * layout.furrow.x + f.z * layout.furrow.z > 0 ? 1 : -1;
        const u = ((h.x - f.x) * layout.furrow.x + (h.z - f.z) * layout.furrow.z) * out;
        const v = Math.abs(-(h.x - f.x) * layout.furrow.z + (h.z - f.z) * layout.furrow.x);
        return v < 0.26 && u > f.along + 0.7 && u < f.along + 3.6;
      }),
    );
    expect(byField.length, 'стогов за торцами засеянных полос').toBeGreaterThanOrEqual(3);
    const meadow = farm.hay.filter((h) => Math.hypot(h.x - ZONES.fields.x, h.z - ZONES.fields.z) < 5);
    expect(meadow.length, 'стогов в прежней прогалине').toBeGreaterThanOrEqual(2);
    for (const h of farm.hay) {
      expect(sample(map, map.field, h.x, h.z), 'стог не на полосе').toBeLessThan(0.1);
      expect(trailDist(layout, h.x, h.z), 'стог не на тропе').toBeGreaterThan(HAY_SPREAD * h.scale);
    }
  });

  it('трёхполье: озимые, яровые и пар; на пару всходов нет', () => {
    expect(new Set(layout.fields.map((f) => f.sowing))).toEqual(new Set(['winter', 'spring', 'fallow']));
    const crops = scatterCrops(layout, 1);
    const fallow = layout.fields.filter((f) => f.sowing === 'fallow');
    expect(fallow.length).toBeGreaterThan(0);
    for (const f of fallow) {
      const on = crops.filter((c) => Math.hypot(c.x - f.x, c.z - f.z) < Math.min(f.across, f.along) * 0.8);
      expect(on.length, 'всходов на пару').toBe(0);
    }
    expect(new Set(crops.map((c) => c.sowing))).toEqual(new Set(['winter', 'spring']));
  });

  it('выгон: трава выедена, лес расступился, тропа от двора подходит к воротцам', () => {
    expect(sample(map, map.graze, pasture.x, pasture.z)).toBeGreaterThan(0.6);
    expect(sample(map, map.graze, -pasture.x, -pasture.z)).toBe(0);
    expect(forestDensity(layout, pasture.x, pasture.z)).toBeLessThan(0.1);
    expect(layout.trails.some((t) => Math.hypot(t.bx - pasture.x, t.bz - pasture.z) < 0.5), 'тропа кончается на выгоне').toBe(true);
  });
});

/** Камера стартового ракурса на экране телефона 390×844 — те же числа, что у сцены (`camera.framing`, `Scene.place`). */
function openingCamera(): THREE.PerspectiveCamera {
  const aspect = 390 / 844;
  const f = framing(aspect);
  const cam = new THREE.PerspectiveCamera(f.fov, aspect, 0.1, 500);
  cam.position.setFromSpherical(new THREE.Spherical(f.dist, f.polar, AZIMUTH)).add(new THREE.Vector3(0, f.targetY, 0));
  cam.lookAt(0, f.targetY, 0);
  cam.updateMatrixWorld();
  return cam;
}

/** Видимое окно кадра по высоте: без нижнего меню и верхней строки — по восьмой части экрана. */
const WINDOW_Y = 0.74;

/** Точки полосы или грядки сеткой: середина, края и торцы. */
function strip(f: { x: number; z: number; along: number; across: number }): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let u = -1; u <= 1.001; u += 0.1) {
    for (let v = -1; v <= 1.001; v += 0.5) {
      out.push({
        x: f.x + layout.furrow.x * u * f.along - layout.furrow.z * v * f.across,
        z: f.z + layout.furrow.z * u * f.along + layout.furrow.x * v * f.across,
      });
    }
  }
  return out;
}

describe('окружение пробы: угодья в кадре и огороды (этап 2)', () => {
  const cam = openingCamera();
  const onScreen = (x: number, z: number): boolean => {
    const p = new THREE.Vector3(x, 0, z).project(cam);
    return Math.abs(p.x) <= 1 && Math.abs(p.y) <= WINDOW_Y;
  };
  const pasture = layout.farm.pasture;

  it('пашня и выгон — в кадре стартового ракурса', () => {
    // Граница области: прежние места угодий — за краем кадра; иначе правило «в кадре» выполнялось бы даром.
    expect(onScreen(ZONES.fields.x, ZONES.fields.z), 'прежняя пашня').toBe(false);
    const pen = placeOf('pen');
    const k = 30.5 / Math.hypot(pen.x, pen.z);
    expect(onScreen(pen.x * k, pen.z * k), 'прежний выгон').toBe(false);
    // Пашня: не меньше шести полос, и на экране — больше пяти шестых её площади.
    expect(layout.fields.length).toBeGreaterThanOrEqual(6);
    const points = layout.fields.flatMap(strip);
    expect(points.filter((p) => onScreen(p.x, p.z)).length / points.length, 'доля пашни на экране').toBeGreaterThan(0.85);
    // Выгон — целиком: круг с изгородью и всё стадо.
    for (let a = 0; a < Math.PI * 2; a += 0.1) {
      expect(onScreen(pasture.x + Math.cos(a) * (pasture.r + 0.4), pasture.z + Math.sin(a) * (pasture.r + 0.4)), `изгородь ${a.toFixed(1)}`).toBe(true);
    }
    expect(layout.farm.flock.length).toBeGreaterThanOrEqual(5);
    for (const o of layout.farm.flock) expect(onScreen(o.x, o.z), 'овца').toBe(true);
  });

  it('пашня — покров на лугу: не на мостовой, не в коридоре ворот, не на площадке двора и не за чертой', () => {
    const points = layout.fields.flatMap(strip);
    // Граница области: полосы подходят к дорогам и к коридору ворот вплотную — правило спрашивается.
    expect(Math.min(...points.map((p) => roadDist(layout, p.x, p.z))), 'полоса у дороги').toBeLessThan(1.2);
    expect(points.some((p) => inGate(p.x, p.z, 1.5)), 'полоса у коридора').toBe(true);
    for (const p of points) {
      expect(roadDist(layout, p.x, p.z), 'на мостовой').toBeGreaterThan(0);
      expect(inGate(p.x, p.z, 0), 'в коридоре ворот').toBe(false);
      expect(Math.hypot(p.x, p.z), 'за чертой расчистки').toBeLessThan(CLEAR_RADIUS);
      for (const s of layout.spots) expect(Math.hypot(p.x - s.x, p.z - s.z), 'на площадке двора').toBeGreaterThan(s.r);
    }
  });

  it('огороды — у дворов внутри стены: не на мостовой, не на площади, не у стены, не на площадке плана', () => {
    expect(layout.gardens.length, 'огородов').toBeGreaterThanOrEqual(5);
    for (const g of layout.gardens) {
      // У двора: край грядки — в паре шагов от площадки плана или от свободного места с хозяйством
      // (`rules.gardensOf`: не дальше 1.8).
      const reach = Math.hypot(g.along, g.across);
      const plot = Math.min(
        ...(Object.keys(PLAN) as (keyof typeof PLAN)[]).map((type) => Math.hypot(g.x - placeOf(type).x, g.z - placeOf(type).z) - plotRadius(type)),
        ...SPARE_PLOTS.map((s) => Math.hypot(g.x - Math.cos(s.angle) * RING_RADIUS[s.ring], g.z - Math.sin(s.angle) * RING_RADIUS[s.ring]) - SPARE_PLOT),
      );
      expect(plot - reach, 'у двора').toBeLessThan(1.8 + 1e-9);
      expect(sample(map, map.field, g.x, g.z), 'грядка на карте').toBeCloseTo(SOWN_LEVEL.spring, 1);
      for (const p of strip(g)) {
        const r = Math.hypot(p.x, p.z);
        expect(r, 'у стены').toBeLessThan(WALL_RADIUS - 1.2);
        expect(r, 'на площади').toBeGreaterThan(PLAZA_RADIUS + 0.5);
        expect(roadDist(layout, p.x, p.z), 'на мостовой').toBeGreaterThan(0);
        // Площадки плана — и построенные, и будущие: грядка не уйдёт под дом, который поставят позже.
        for (const type of Object.keys(PLAN) as (keyof typeof PLAN)[]) {
          const at = placeOf(type);
          expect(Math.hypot(p.x - at.x, p.z - at.z), `на площадке ${type}`).toBeGreaterThan(plotRadius(type));
        }
      }
    }
  });

  it('всходы — покров: не на мостовой, не на тропе, не под домом; меш вмещает все', () => {
    const crops = scatterCrops(layout, 1);
    // Область: всходы есть и на пашне за стеной, и на грядках внутри неё.
    expect(crops.filter((c) => Math.hypot(c.x, c.z) < WALL_RADIUS).length, 'на грядках').toBeGreaterThan(20);
    expect(crops.filter((c) => Math.hypot(c.x, c.z) > WALL_RADIUS).length, 'на пашне').toBeGreaterThan(200);
    for (const c of crops) {
      expect(roadDist(layout, c.x, c.z), 'на мостовой').toBeGreaterThanOrEqual(0.06);
      expect(trailDist(layout, c.x, c.z), 'на тропе').toBeGreaterThanOrEqual(0.04);
      for (const s of layout.spots) expect(Math.hypot(c.x - s.x, c.z - s.z), 'под домом').toBeGreaterThanOrEqual(s.r * 1.04);
    }
    // Без посёлка (первый кадр: ни дорог, ни домов) всходов больше всего — и меш вмещает и их.
    expect(scatterCrops(layoutOf(null), 1).length).toBeLessThanOrEqual(CROPS_CAP);
    // Сама проверка покрова: дорога поперёк засеянной полосы — всходы её обходят. Область: без
    // дороги всходы на этой линии есть.
    const f = layout.fields.find((x) => x.sowing !== 'fallow')!;
    const road = { ax: f.x - layout.furrow.z * 2, az: f.z + layout.furrow.x * 2, bx: f.x + layout.furrow.z * 2, bz: f.z - layout.furrow.x * 2, half: 0.4 };
    const along = (c: { x: number; z: number }): number => Math.abs((c.x - f.x) * layout.furrow.x + (c.z - f.z) * layout.furrow.z);
    expect(crops.filter((c) => along(c) < 0.35).length, 'всходы на линии дороги без неё').toBeGreaterThan(0);
    const cut = scatterCrops({ ...layout, lines: [...layout.lines, road] }, 1);
    expect(cut.filter((c) => along(c) < 0.4 && Math.hypot(c.x - f.x, c.z - f.z) < 1).length, 'всходы на дороге').toBe(0);
  });

  it('внутри стены цветы — только палисадником у дворов', () => {
    const inside = flowers.filter((t) => Math.hypot(t.x, t.z) < WALL_RADIUS - 1.4);
    // Область: цветы внутри стены есть.
    expect(inside.length, 'цветов внутри стены').toBeGreaterThan(10);
    // Кайма палисадника — до 1.75 радиуса двора и мягкий край (`groundMapJob`, `yard`); полшага — на выборку карты.
    for (const t of inside) expect(layout.spots.some((s) => Math.hypot(t.x - s.x, t.z - s.z) < s.r * 1.75 + 0.5), `цветок ${t.x.toFixed(1)}/${t.z.toFixed(1)}`).toBe(true);
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
