// Замок (docs/city_v3.md, Р-2; слово владельца): двойные ворота через ров — одна цельная надвратная, а не две башни, легшие
// одна на другую; стража у ворот на месте; на стене замка вокруг донжона ходит дозор, как на стене нижнего города.
import { describe, expect, it } from 'vitest';
import { cityPlan, distSeg, type P } from './layout';
import { Builder } from './geom';
import { L } from './tex';
import { buildStatic } from './budget';
import { gatehouse, inTowerShape, tower, twinOf } from './forts';
import { CityLife, walkOf } from './life';

const plan = cityPlan();
const pair = plan.towers.filter((t) => twinOf(t, plan.towers));
const g = pair.length === 2 ? gatehouse(pair[0], pair[1]) : null;

/** Точка в осях надвратной: вдоль проезда (к городу) и поперёк. */
const local = (x: number, z: number): { f: number; r: number } => ({
  f: (x - g!.x) * g!.fx + (z - g!.z) * g!.fz,
  r: (x - g!.x) * g!.fz - (z - g!.z) * g!.fx,
});
const inDrum = (x: number, z: number, pad: number): boolean => g!.drums.some((d) => Math.hypot(x - d.x, z - d.z) < d.r + pad);
/** Эркеры по углам лица к замку: башенки радиусом 1,15 м. */
const inOriel = (x: number, z: number): boolean => {
  const p = local(x, z);
  return Math.abs(p.f + g!.len / 2) < 1.5 && Math.abs(Math.abs(p.r) - g!.w / 2) < 1.5;
};

describe('замок: двойные ворота и дозор (Р-2)', () => {
  it('пара ворот через ров одна: ворота города и ворота замка', () => {
    expect(pair.map((t) => t.kind).sort()).toEqual(['castleGate', 'gate']);
    expect(g!.front.kind).toBe('gate');
    // Корпус покрывает следы обеих башен: стены обоих колец кончаются в нём, как в башне.
    for (const t of pair)
      for (const a of [-1, 1])
        for (const c of [-1, 1]) {
          const h = t.size / 2;
          const x = t.x + (Math.cos(t.out) * a + Math.sin(t.out) * c) * h;
          const z = t.z + (Math.sin(t.out) * a - Math.cos(t.out) * c) * h;
          const p = local(x, z);
          expect(Math.abs(p.f) <= g!.len / 2 + 1e-6 && Math.abs(p.r) <= g!.w / 2 + 1e-6, `угол следа ${t.kind} вне корпуса`).toBe(true);
        }
  });

  it('ворота цельные: два лица проезда — на концах, кладка не врезана сама в себя, кровля одна', () => {
    const b = new Builder();
    for (const t of pair) tower(b, t, 1, plan.towers);
    const V = (i: number): [number, number, number] => [b.pos[i * 3], b.pos[i * 3 + 1], b.pos[i * 3 + 2]];
    const layer = (i: number): number => b.cfg[i * 4];
    // Лица проезда (плитка ворот) — ровно два: к городу и к замку, на торцах корпуса, лицом наружу.
    // Грань — по треугольникам: у лица проезда оба треугольника лежат в одной плоскости поперёк проезда.
    const planes = new Map<string, { f: number; nf: number }>();
    for (let t = 0; t < b.idx.length; t += 3) {
      const i0 = b.idx[t];
      if (layer(i0) !== L.gateArch) continue;
      const c = [0, 1, 2].map((k) => V(b.idx[t + k])).reduce((s2, v) => [s2[0] + v[0] / 3, s2[1] + v[1] / 3, s2[2] + v[2] / 3], [0, 0, 0]);
      const f = local(c[0], c[2]).f;
      planes.set(f.toFixed(1), { f, nf: b.nor[i0 * 3] * g!.fx + b.nor[i0 * 3 + 2] * g!.fz });
    }
    const arches = [...planes.values()];
    expect(arches.length, 'лиц проезда').toBe(2);
    for (const a of arches) {
      expect(Math.abs(Math.abs(a.f) - g!.len / 2), 'лицо — на торце').toBeLessThan(0.05);
      expect(Math.sign(a.nf), 'лицо — наружу').toBe(Math.sign(a.f));
    }
    // Ни одна грань кладки не лежит внутри корпуса (кроме барабанов и эркеров, что в него вросли).
    const inner: string[] = [];
    for (let t = 0; t < b.idx.length; t += 3) {
      const vs = [0, 1, 2].map((k) => V(b.idx[t + k]));
      const c = vs.reduce((s, v) => [s[0] + v[0] / 3, s[1] + v[1] / 3, s[2] + v[2] / 3], [0, 0, 0]);
      const p = local(c[0], c[2]);
      if (inDrum(c[0], c[2], 0.35) || inOriel(c[0], c[2])) continue;
      if (Math.abs(p.f) < g!.len / 2 - 0.3 && Math.abs(p.r) < g!.w / 2 - 0.3 && c[1] > g!.foot + 0.3 && c[1] < g!.top - 0.3) inner.push(`(${c.map((x) => x.toFixed(1)).join(', ')})`);
    }
    expect(inner.slice(0, 4), 'грани внутри корпуса').toEqual([]);
    // Кровля над корпусом одна: верх её граней (вне барабанов и эркеров) — один конёк, на одной высоте, вдоль проезда.
    const tops: number[] = [];
    const ridge: number[] = [];
    for (let t = 0; t < b.idx.length; t += 3) {
      const i0 = b.idx[t];
      if (layer(i0) !== L.roofTile && layer(i0) !== L.roofSlate) continue;
      const vs = [0, 1, 2].map((k) => V(b.idx[t + k]));
      const c = vs.reduce((s, v) => [s[0] + v[0] / 3, s[1] + v[1] / 3, s[2] + v[2] / 3], [0, 0, 0]);
      const p = local(c[0], c[2]);
      if (inDrum(c[0], c[2], 1) || Math.abs(p.r) > g!.w / 2 - 1 || Math.abs(p.f) > g!.len / 2 - 1.5) continue;
      const top = vs.reduce((m, v) => (v[1] > m[1] ? v : m));
      tops.push(top[1]);
      ridge.push(Math.abs(local(top[0], top[2]).r));
    }
    expect(tops.length).toBeGreaterThan(3);
    expect(Math.max(...tops) - Math.min(...tops), 'конёк один').toBeLessThan(0.05);
    expect(Math.max(...ridge), 'конёк — вдоль проезда').toBeLessThan(0.05);
  });

  it('стража у двойных ворот стоит: по четыре с каждой стороны, не в кладке и не в барабанах', () => {
    const life = new CityLife({ plan, chimneys: [], flagTops: [], quality: 'medium' });
    const near = life.posts.filter((p) => Math.abs(local(p.x, p.z).f) < g!.len / 2 + 4 && Math.abs(local(p.x, p.z).r) < 8);
    expect(near.length).toBe(8);
    for (const p of near) {
      const q = local(p.x, p.z);
      expect(Math.abs(q.f) > g!.len / 2 || Math.abs(q.r) > g!.w / 2, `пост в корпусе (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBe(true);
      expect(inDrum(p.x, p.z, 0.4), `пост в барабане (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBe(false);
    }
    life.dispose();
  });

  it('на стене замка вокруг донжона ходит дозор — двое, по ходу стены, не сквозь башни; стена города не пустеет', () => {
    const st = buildStatic(plan, 'medium');
    const life = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: 'medium' });
    const keep = walkOf(plan.castleWall);
    const town = walkOf(plan.wall);
    const onWalk = (w: { pts: P[] }, p: P): number => {
      let d = Infinity;
      for (let k = 1; k < w.pts.length; k++) d = Math.min(d, distSeg(p, w.pts[k - 1], w.pts[k]).d);
      return d;
    };
    const cap = life.guardCap;
    const spots = { x: new Float32Array(cap.wall + cap.gate), y: new Float32Array(cap.wall + cap.gate), z: new Float32Array(cap.wall + cap.gate), yaw: new Float32Array(cap.wall + cap.gate), moving: new Uint8Array(cap.wall + cap.gate) };
    for (const guards of [4, 12, 18]) {
      life.set(200, guards, []);
      let moved = 0;
      const start: P[] = [];
      for (let t = 0; t <= 240; t += 6) {
        life.update(0.016, t, 0, 0);
        const { wall } = life.guardsInto(spots);
        let castle = 0;
        let lower = 0;
        for (let i = 0; i < wall; i++) {
          const p = { x: spots.x[i], z: spots.z[i] };
          // Ни один лучник не идёт сквозь башню — и сквозь барабан двойных ворот, что на стене обоих колец.
          for (const tw of plan.towers) expect(inTowerShape(tw, p.x, p.z, 0.2), `лучник в башне ${tw.kind} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBe(false);
          expect(inDrum(p.x, p.z, 0.2), `лучник в барабане ворот (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBe(false);
          if (onWalk(keep, p) < 0.3) {
            castle++;
            // Граница области: дозорный — на ходу стены замка, а не у донжона и не во дворе.
            expect(spots.y[i], 'на высоте хода').toBeGreaterThan(20);
            const k = castle - 1;
            if (t === 0) start[k] = p;
            else if (Math.hypot(p.x - start[k].x, p.z - start[k].z) > 2) moved++;
          } else if (onWalk(town, p) < 0.3) lower++;
        }
        // Пара дозорных (слово владельца).
        expect(castle, `на стене замка при страже ${guards}`).toBe(2);
        expect(lower, `на стене города при страже ${guards}`).toBe(guards);
      }
      // Дозор ходит, а не стоит.
      expect(moved).toBeGreaterThan(10);
    }
    life.dispose();
  });
});
