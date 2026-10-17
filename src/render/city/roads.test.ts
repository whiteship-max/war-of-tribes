// Сеть дорог и земля города (docs/city_v3.md, Г-3): дороги без обрывов до края мира, одна сеть с улицами, дальняя дорога на
// карте земель, тупики — дворики, переулок не ложится на мостовую, мостовая у коновязи, грязь у ворот, жители — не по траве.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHURCH, PARVIS, WORLD_EDGE, cityPlan, distSeg, insidePoly, type P, type Street } from './layout';
import { fieldAt, groundMap, hamlets, MAP_AT } from './ground';
import { LAND_AT, landMap } from './nature';
import { deadEnds, joins, mudAt, roadU, ROAD_U_MAX } from './roads';
import { buildStatic } from './budget';
import { CityLife } from './life';
import { CITY_SPEC } from './spec';

const plan = cityPlan();
const all: Street[] = [...plan.streets, ...plan.roads];
const MAP = CITY_SPEC.medium.map;
const map = groundMap(plan, MAP);
const LAND = CITY_SPEC.medium.land;
const land = landMap(plan, LAND);

/** Карта покрытий в точке: брусчатка и земля (0..1). */
function cover(x: number, z: number): { c: number; d: number } {
  const i = Math.floor(((x - MAP_AT.x0) / MAP_AT.size) * MAP);
  const j = Math.floor(((z - MAP_AT.z0) / MAP_AT.size) * MAP);
  const k = (j * MAP + i) * 4;
  return { c: map[k] / 255, d: map[k + 1] / 255 };
}

/** Дорога на карте земель: |расстояние до оси| в полуширинах — двулинейно, как читает шейдер. */
function farU(x: number, z: number): number {
  const fx = ((x - LAND_AT.x0) / LAND_AT.size) * LAND - 0.5;
  const fz = ((z - LAND_AT.z0) / LAND_AT.size) * LAND - 0.5;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  const u = fx - i;
  const v = fz - j;
  const b = (ii: number, jj: number): number => (land[(jj * LAND + ii) * 4 + 2] / 255) * 2 - 1;
  const val = b(i, j) * (1 - u) * (1 - v) + b(i + 1, j) * u * (1 - v) + b(i, j + 1) * (1 - u) * v + b(i + 1, j + 1) * u * v;
  return Math.abs(val) * ROAD_U_MAX;
}

const insideMap = (p: P, pad = 0): boolean =>
  p.x > MAP_AT.x0 + pad && p.x < MAP_AT.x0 + MAP_AT.size - pad && p.z > MAP_AT.z0 + pad && p.z < MAP_AT.z0 + MAP_AT.size - pad;

/** Точки по ломаной через `step` метров с направлением хода. */
function walk(pts: readonly P[], step: number): { p: P; tx: number; tz: number }[] {
  const out: { p: P; tx: number; tz: number }[] = [];
  for (let k = 0; k < pts.length - 1; k++) {
    const a = pts[k];
    const b = pts[k + 1];
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    for (let s = 0; s < l; s += step) out.push({ p: { x: a.x + ((b.x - a.x) * s) / l, z: a.z + ((b.z - a.z) * s) / l }, tx: (b.x - a.x) / l, tz: (b.z - a.z) / l });
  }
  return out;
}

describe('город: дороги и земля (Г-3)', () => {
  it('дороги без обрывов: каждый конец — в сети, у двора или за краем мира; от ворот наружу — за край', () => {
    const beyond = (e: P): boolean => Math.abs(e.x) > WORLD_EDGE || Math.abs(e.z) > WORLD_EDGE;
    for (const r of plan.roads) {
      for (const e of [r.pts[0], r.pts[r.pts.length - 1]]) {
        const yard = plan.yards.some((y) => Math.hypot(y.x - e.x, y.z - e.z) < y.r + 4);
        expect(joins(e, r, all, plan) || yard || beyond(e), `${r.name}: конец (${e.x.toFixed(0)}, ${e.z.toFixed(0)}) обрывается`).toBe(true);
      }
    }
    // Граница области: наружу смотрят южные и восточные ворота (северные — во двор замка через ров).
    const outer = plan.gates.filter((g) => !insidePoly({ x: g.x + Math.cos(g.out) * 20, z: g.z + Math.sin(g.out) * 20 }, plan.castleWall));
    expect(outer.length).toBe(2);
    for (const g of outer) {
      const road = plan.roads.find((r) => Math.hypot(r.pts[0].x - g.x, r.pts[0].z - g.z) < 12);
      expect(road, `от ворот (${g.x.toFixed(0)}, ${g.z.toFixed(0)}) нет дороги`).toBeDefined();
      expect(beyond(road!.pts[road!.pts.length - 1]), `${road!.name}: за край мира`).toBe(true);
    }
  });

  it('улицы и дороги — одна сеть: от любой до любой по стыкам', () => {
    const n = all.length;
    const link: number[][] = all.map(() => []);
    // Стык — конец у другой улицы или пересечение: Главная проходит сквозь улицу вдоль стены, не кончаясь на ней.
    all.forEach((s, a) => {
      const probe = walk(s.pts, 2).map((w) => w.p);
      all.forEach((o, b) => {
        if (b <= a) return;
        const near = probe.some((e) => o.pts.some((_, k) => k < o.pts.length - 1 && distSeg(e, o.pts[k], o.pts[k + 1]).d < Math.max(o.half, s.half) + 1));
        if (near) link[a].push(b), link[b].push(a);
      });
    });
    // Площадь — узел: к ней выходят улицы, у которых конец на её кромке.
    const onSquare = all.map((s) => [s.pts[0], s.pts[s.pts.length - 1]].some((e) => insidePoly(e, plan.square) || plan.square.some((q, k) => distSeg(e, q, plan.square[(k + 1) % plan.square.length]).d < s.half + 1)));
    const sq = onSquare.map((v, k) => (v ? k : -1)).filter((k) => k >= 0);
    for (const a of sq) for (const b of sq) if (a !== b) link[a].push(b);
    const seen = new Set<number>([0]);
    const stack = [0];
    while (stack.length) for (const b of link[stack.pop()!]) if (!seen.has(b)) seen.add(b), stack.push(b);
    const lost = all.filter((_, k) => !seen.has(k)).map((s) => s.name);
    expect(lost, 'вне сети').toEqual([]);
    expect(seen.size).toBe(n);
  });

  it('дальняя дорога на карте земель: на оси — дорога, в двух с половиной полуширинах — уже нет; у края ближней карты — обе', () => {
    let far = 0;
    let seam = 0;
    for (const r of plan.roads.filter((x) => x.half >= 2)) {
      for (const w of walk(r.pts, 9)) {
        const { p } = w;
        // Граница области: карта земель, без её крайних клеток и без стыков дорог.
        if (Math.abs(p.x) > WORLD_EDGE - 20 || p.z < LAND_AT.z0 + 20 || p.z > LAND_AT.z0 + LAND_AT.size - 20) continue;
        if (all.some((o) => o !== r && o.pts.some((_, k) => k < o.pts.length - 1 && distSeg(p, o.pts[k], o.pts[k + 1]).d < r.half * 4 + o.half))) continue;
        if (!insideMap(p, 0.5)) {
          far++;
          expect(farU(p.x, p.z), `${r.name} (${p.x.toFixed(0)}, ${p.z.toFixed(0)}): ось`).toBeLessThan(0.8);
          const side = { x: p.x - w.tz * r.half * 2.5, z: p.z + w.tx * r.half * 2.5 };
          expect(farU(side.x, side.z), `${r.name} (${p.x.toFixed(0)}, ${p.z.toFixed(0)}): обочина`).toBeGreaterThan(1.3);
        } else if (!insideMap(p, 16)) {
          // Полоса, где ближняя карта тает в дальнюю: дорога лежит на обеих — шва нет.
          seam++;
          expect(cover(p.x, p.z).d, `${r.name} (${p.x.toFixed(0)}, ${p.z.toFixed(0)}): ближняя у края`).toBeGreaterThan(0.5);
          expect(farU(p.x, p.z), `${r.name} (${p.x.toFixed(0)}, ${p.z.toFixed(0)}): дальняя у края`).toBeLessThan(0.8);
        }
      }
    }
    expect(far, 'точек дальней дороги').toBeGreaterThan(150);
    expect(seam, 'точек у края ближней карты').toBeGreaterThan(2);
    // Знак — по сторонам: так двулинейная выборка не «съедает» ось (|расстояние| ломается на оси, знаковое — линейно).
    const p = plan.roads[0].pts[plan.roads[0].pts.length - 3];
    expect(Math.sign(roadU(p.x - 5, p.z, plan))).not.toBe(Math.sign(roadU(p.x + 5, p.z, plan)));
  });

  it('тупик переулка — утоптанный дворик; грунт переулка не ложится на мостовую', () => {
    const ends = deadEnds(plan);
    // Граница области: тупики есть (переулки кончаются у задних стен домов улицы вдоль стены).
    expect(ends.length).toBeGreaterThan(1);
    for (const e of ends) {
      const at = { x: e.x + e.tx * 2.5, z: e.z + e.tz * 2.5 };
      expect(cover(at.x, at.z).d, `дворик тупика (${at.x.toFixed(0)}, ${at.z.toFixed(0)})`).toBeGreaterThan(0.6);
    }
    // Стык грунтовых улиц с мощёными: на оси мостовой у стыка земли не больше грязи в швах (`ground.ts`: 0.55, на выходе карты
    // под мостовой — × 0.45, то есть до 0.25); переулок поверх мостовой давал там 0.45.
    let checked = 0;
    for (const s of plan.streets.filter((x) => x.surface === 'dirt')) {
      for (const e of [s.pts[0], s.pts[s.pts.length - 1]]) {
        for (const o of plan.streets.filter((x) => x.surface === 'cobble' && x.half >= 3)) {
          for (let k = 0; k < o.pts.length - 1; k++) {
            const r = distSeg(e, o.pts[k], o.pts[k + 1]);
            if (r.d > o.half) continue;
            const q = { x: o.pts[k].x + (o.pts[k + 1].x - o.pts[k].x) * r.t, z: o.pts[k].z + (o.pts[k + 1].z - o.pts[k].z) * r.t };
            const cv = cover(q.x, q.z);
            // Граница области: точка — на мостовой.
            expect(cv.c).toBeGreaterThan(0.9);
            expect(cv.d, `${s.name} поперёк «${o.name}» (${q.x.toFixed(0)}, ${q.z.toFixed(0)})`).toBeLessThan(0.3);
            checked++;
          }
        }
      }
    }
    expect(checked, 'стыков с мостовой').toBeGreaterThan(0);
  });

  it('у коновязи двора храма — мостовая до ограды, грязь — пятнами у поилки; у ворот — грязь, посреди площади — нет', () => {
    for (const z of [-40, -46, -52, -58]) expect(cover(18.5, z).c, `мостовая у ограды (18.5, ${z})`).toBeGreaterThan(0.8);
    expect(mudAt(21, -50, plan), 'у поилки').toBeGreaterThan(0.5);
    expect(mudAt(18.5, -60, plan), 'дальше от поилки').toBeLessThan(0.3);
    for (const g of plan.gates) {
      const out = { x: g.x + Math.cos(g.out) * 9, z: g.z + Math.sin(g.out) * 9 };
      expect(mudAt(out.x, out.z, plan), `за воротами (${g.x.toFixed(0)}, ${g.z.toFixed(0)})`).toBeGreaterThan(0.5);
    }
    expect(mudAt(-12, 0, plan), 'посреди площади').toBeLessThan(0.05);
  });

  it('поля у деревень: пашня кругом каждой деревни на дороге; у стены — гласис без пашни', () => {
    const hs = hamlets(plan);
    expect(hs.length).toBe(3);
    for (const h of hs) {
      let n = 0;
      let f = 0;
      for (let a = 0; a < 64; a++) {
        const r = (h.r * 0.7 * (a % 8)) / 8;
        const t = (a / 8) * 0.8;
        n++;
        if (fieldAt(h.x + Math.cos(t) * r, h.z + Math.sin(t) * r, plan) > 0) f++;
      }
      expect(f / n, `пашня у деревни (${h.x.toFixed(0)}, ${h.z.toFixed(0)})`).toBeGreaterThan(0.3);
    }
    // Гласис: в 30 м от стены пашни нет нигде (обход контура стены наружу).
    const w = plan.wall;
    for (let k = 0; k < w.length; k++) {
      const a = w[k];
      const b = w[(k + 1) % w.length];
      const nx = -(b.z - a.z);
      const nz = b.x - a.x;
      const l = Math.hypot(nx, nz) || 1;
      for (const sg of [1, -1]) {
        const p = { x: (a.x + b.x) / 2 + (nx / l) * 30 * sg, z: (a.z + b.z) / 2 + (nz / l) * 30 * sg };
        if (insidePoly(p, w) || insidePoly(p, plan.castleWall)) continue;
        expect(fieldAt(p.x, p.z, plan), `пашня на гласисе (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`).toBe(0);
      }
    }
  });

  it('жители и путники идут по мостовой и земле, а не по траве: двадцать минут сцены', () => {
    const st = buildStatic(plan, 'medium');
    const life = new CityLife({ plan, chimneys: st.chimneys, flagTops: st.flagTops, quality: 'medium' });
    life.set(1000, 1000, []);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let near = 0;
    let far = 0;
    for (let k = 0; k < 400; k++) {
      life.update(0.1, k * 3, 0, 0);
      for (const o of life.group.children) {
        if (!(o instanceof THREE.InstancedMesh) || !o.name.startsWith('city-people')) continue;
        for (let i = 0; i < o.count; i++) {
          o.getMatrixAt(i, m);
          m.decompose(p, q, s);
          if (s.x < 0.01) continue;
          const at = `(${p.x.toFixed(1)}, ${p.z.toFixed(1)}), ${k * 3} с`;
          // Паперть — каменные ступени над землёй: там стоят прихожане.
          const parvis = Math.abs(p.x - CHURCH.x) < PARVIS.half && p.z > CHURCH.front && p.z < PARVIS.foot + 1;
          if (insideMap(p, 2)) {
            near++;
            const cv = cover(p.x, p.z);
            expect(parvis || cv.c + cv.d > 0.35, `по траве ${at}`).toBe(true);
          } else {
            far++;
            expect(Math.abs(roadU(p.x, p.z, plan)), `путник мимо дороги ${at}`).toBeLessThan(1.2);
          }
        }
      }
    }
    // Граница области: за двадцать минут — десятки тысяч шагов, и путники за краем ближней карты есть.
    expect(near).toBeGreaterThan(30000);
    expect(far, 'путников за краем ближней карты').toBeGreaterThan(50);
    life.dispose();
  });
});
