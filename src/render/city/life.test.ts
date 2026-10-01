// Жизнь города (docs/city.md, 11.4): фигуры той цены, что считает бюджет; стража — на боевом ходу стены,
// прохожие — на улицах и площади; ночью улицы пустеют, стража остаётся; на низком уровне фигур меньше.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { QUALITIES } from '../quality';
import { cityPlan, distPoly, insidePoly } from './layout';
import { buildStatic } from './budget';
import { wallTops } from './forts';
import { CityLife, beastGeometry, guardGeometry, personGeometry } from './life';
import { LIFE_CAP, LIFE_TRIS } from './spec';

const plan = cityPlan();
const st = buildStatic(plan, 'medium');

const tris = (g: THREE.BufferGeometry): number => (g.index ? g.index.count : g.attributes.position.count) / 3;

/** Положения экземпляров, которые меш рисует сейчас. */
function placed(im: THREE.InstancedMesh): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const m = new THREE.Matrix4();
  for (let k = 0; k < im.count; k++) {
    im.getMatrixAt(k, m);
    out.push(new THREE.Vector3().setFromMatrixPosition(m));
  }
  return out;
}

const mesh = (life: CityLife, name: string): THREE.InstancedMesh => life.group.getObjectByName(name) as THREE.InstancedMesh;

describe('город: жизнь', () => {
  it('фигуры той цены, что считает бюджет', () => {
    expect(tris(personGeometry())).toBe(LIFE_TRIS.person);
    expect(tris(guardGeometry())).toBe(LIFE_TRIS.guard);
    expect(tris(beastGeometry())).toBe(LIFE_TRIS.beast);
  });

  it('уровни идут по убыванию: низкий не богаче среднего, средний — высокого', () => {
    for (const k of ['people', 'guards', 'birds', 'animals', 'smoke'] as const) {
      expect(LIFE_CAP.low[k], k).toBeLessThanOrEqual(LIFE_CAP.medium[k]);
      expect(LIFE_CAP.medium[k], k).toBeLessThanOrEqual(LIFE_CAP.high[k]);
    }
    expect(LIFE_CAP.low.people).toBeLessThan(LIFE_CAP.high.people);
  });

  it('стража — на боевом ходу стены, прохожие — на улицах, у рядов и колодца', () => {
    const life = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: 'medium' });
    life.set(1000, 1000, []);
    for (let k = 0; k < 20; k++) life.update(0.1, k * 0.1, 0, 0);
    const guards = placed(mesh(life, 'city-guards'));
    const people = placed(mesh(life, 'city-people'));
    // Граница области: днём при большом городе фигур — сколько позволяет уровень.
    expect(guards.length).toBe(LIFE_CAP.medium.guards);
    expect(people.length).toBe(LIFE_CAP.medium.people);
    const tops = wallTops(plan.wall);
    const top = (p: THREE.Vector3): number => {
      let best = 0;
      let bd = Infinity;
      plan.wall.forEach((w, k) => {
        const d = Math.hypot(w.x - p.x, w.z - p.z);
        if (d < bd) {
          bd = d;
          best = tops[k];
        }
      });
      return best;
    };
    for (const g of guards) {
      expect(distPoly({ x: g.x, z: g.z }, plan.wall, true), 'страж у стены').toBeLessThan(2);
      expect(Math.abs(g.y - top(g)), 'страж на высоте хода').toBeLessThan(1.5);
    }
    const streets = [...plan.streets, ...plan.roads];
    for (const p of people) {
      const q = { x: p.x, z: p.z };
      const onStreet = streets.some((s) => distPoly(q, s.pts) < s.half + 1);
      const onSquare = insidePoly(q, plan.square) || Math.hypot(q.x - plan.well.x, q.z - plan.well.z) < 8 || (Math.abs(q.x + 9) < 13 && Math.abs(q.z + 29) < 5);
      expect(onStreet || onSquare, `прохожий на улице или площади (${q.x.toFixed(0)}, ${q.z.toFixed(0)})`).toBe(true);
    }
    life.dispose();
  });

  it('ночью улицы пустеют до трети, стража остаётся; людей — от населения, не больше уровня', () => {
    const life = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: 'low' });
    life.set(50, 8, []);
    life.update(0.1, 0, 0, 0);
    const day = mesh(life, 'city-people').count;
    const guardsDay = mesh(life, 'city-guards').count;
    expect(day).toBe(50);
    life.update(0.1, 0.1, 1, 0);
    const night = mesh(life, 'city-people').count;
    expect(night).toBeLessThanOrEqual(Math.ceil(day * 0.35));
    expect(night).toBeGreaterThan(0);
    expect(mesh(life, 'city-guards').count).toBe(guardsDay);
    life.set(100000, 100000, []);
    life.update(0.1, 0.2, 0, 0);
    expect(mesh(life, 'city-people').count).toBe(LIFE_CAP.low.people);
    life.dispose();
  });

  it('у каждой башни флаг; дым идёт не из всех труб и не больше уровня', () => {
    for (const q of QUALITIES) {
      const life = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: q });
      const flags = life.group.getObjectByName('city-flags') as THREE.Mesh;
      expect(tris(flags.geometry)).toBe(st.flagTops.length * LIFE_TRIS.flag);
      expect(st.flagTops.length).toBe(plan.towers.length);
      const smoke = life.group.getObjectByName('city-smoke') as THREE.Points;
      const puffs = smoke.geometry.attributes.position.count;
      // Граница области: дым есть, но не из каждой трубы.
      expect(puffs).toBeGreaterThan(0);
      expect(puffs / 5).toBeLessThanOrEqual(Math.min(LIFE_CAP[q].smoke, st.chimneys.length * 0.75));
      life.dispose();
    }
  });
});
