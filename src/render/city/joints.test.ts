// Стыки стен города и замка без дыр (docs/city_v3.md, Р-2). Дыра в кадре — луч с камеры игры, который первой задевает
// изнанку грани: лицевые грани смотрят наружу, изнанку видеокарта отбрасывает, и сквозь неё видно то, что за стеной (так
// просвечивали углы замка у рва и юго-запад города: звено на остром изломе выходило вывернутым). Тест — лучами, как вид из
// окна покоев (Г-7): решётка параллельных лучей с направления камеры игры на каждый стык — излом стены и примыкание башни.
import { describe, expect, it } from 'vitest';
import { cityPlan, type P } from './layout';
import { buildStatic } from './budget';
import { groundGrid } from './ground';
import { CITY_SPEC } from './spec';
import { CITY_AZIMUTH } from './camera';
import { ownerCode } from './sites';
import { wallPlan, wallTops } from './forts';

const plan = cityPlan();
const st = buildStatic(plan, 'medium');

/** Треугольники зданий и земли плоскими массивами и решётка по плану для лучей. */
function scene(): { P: Float32Array; I: Uint32Array; cells: Map<number, number[]>; nb: number } {
  const spec = CITY_SPEC.medium;
  const g = groundGrid(spec.groundCells, spec.groundCell, { x: 0, z: -20 }, 1400);
  const bp = st.b.pos;
  const nb = st.b.idx.length;
  const P = new Float32Array(bp.length + g.positions.length);
  P.set(bp, 0);
  P.set(g.positions, bp.length);
  const I = new Uint32Array(st.b.idx.length + g.index.length);
  I.set(st.b.idx, 0);
  for (let i = 0; i < g.index.length; i++) I[nb + i] = g.index[i] + bp.length / 3;
  const cells = new Map<number, number[]>();
  for (let t = 0; t < I.length; t += 3) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let k = 0; k < 3; k++) {
      const v = I[t + k] * 3;
      x0 = Math.min(x0, P[v]);
      x1 = Math.max(x1, P[v]);
      z0 = Math.min(z0, P[v + 2]);
      z1 = Math.max(z1, P[v + 2]);
    }
    // Даль земли — огромные треугольники, стыкам не нужны.
    if (x1 - x0 > 60 || z1 - z0 > 60) continue;
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++)
      for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
        const k = key(i, j);
        const a = cells.get(k);
        if (a) a.push(t);
        else cells.set(k, [t]);
      }
  }
  return { P, I, cells, nb };
}

const CELL = 4;
const key = (i: number, j: number): number => (i + 1000) * 4000 + (j + 1000);
const W = scene();

/** Запас доли на ребре и «равные» расстояния, м: луч по общему ребру двух граней не проскальзывает между ними. */
const EPS = 1e-4;
const TIE = 0.02;

/** Первая грань по лучу: номер, расстояние и лицом ли к глазу; `null` — луч ушёл в небо. */
function firstHit(o: readonly number[], d: readonly number[], far: number): { t: number; front: boolean; tri: number } | null {
  const { P, I, cells } = W;
  let best: { t: number; front: boolean; tri: number } | null = null;
  const seen = new Set<number>();
  for (let s = 0; s < far; s += CELL * 0.4) {
    if (best && best.t < s - CELL * 1.5) break;
    const x = o[0] + d[0] * s;
    const z = o[2] + d[2] * s;
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++) {
        const list = cells.get(key(Math.floor(x / CELL) + di, Math.floor(z / CELL) + dj));
        if (!list) continue;
        for (const t of list) {
          if (seen.has(t)) continue;
          seen.add(t);
          const a = I[t] * 3;
          const b = I[t + 1] * 3;
          const c = I[t + 2] * 3;
          const e1 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
          const e2 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
          const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
          const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
          if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det;
          const tv = [o[0] - P[a], o[1] - P[a + 1], o[2] - P[a + 2]];
          const u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) * inv;
          if (u < -EPS || u > 1 + EPS) continue;
          const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
          const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) * inv;
          if (v < -EPS || u + v > 1 + EPS) continue;
          const tt = (e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) * inv;
          if (tt < 1 || tt > far) continue;
          // Лицевая грань — против часовой к глазу; из почти равных по общему ребру — лицевая (растеризатор рёбер не теряет).
          const front = det > 0;
          if (!best || tt < best.t - TIE || (Math.abs(tt - best.t) <= TIE && front && !best.front)) best = { t: tt, front, tri: t };
        }
      }
  }
  return best;
}

/** Стыки: изломы контура круче 25° и башни на стене — середина, полуширина окна и высота хода стены там. */
function joints(): { name: string; x: number; z: number; R: number; y: number }[] {
  const out: { name: string; x: number; z: number; R: number; y: number }[] = [];
  for (const [name, wall] of [
    ['город', plan.wall],
    ['замок', plan.castleWall],
  ] as const) {
    const n = wall.length;
    const top = wallTops(wall);
    const turn = (k: number): number => {
      const a = wall[(k - 1 + n) % n];
      const b = wall[k];
      const c = wall[(k + 1) % n];
      const u = Math.atan2(b.z - a.z, b.x - a.x);
      const v = Math.atan2(c.z - b.z, c.x - b.x);
      return Math.abs(Math.atan2(Math.sin(v - u), Math.cos(v - u)));
    };
    for (let k = 0; k < n; k++) if (turn(k) > (25 * Math.PI) / 180) out.push({ name: `${name}: излом`, x: wall[k].x, z: wall[k].z, R: 5, y: top[k] });
    for (const t of plan.towers) {
      const near = wall.findIndex((p: P) => Math.hypot(p.x - t.x, p.z - t.z) < t.size);
      if (near >= 0) out.push({ name: `${name}: ${t.kind}`, x: t.x, z: t.z, R: t.size / 2 + 3, y: top[near] });
    }
  }
  return out;
}

const DEG = Math.PI / 180;
/** Направления к камере игры: её азимут, высота 52° и края кадра по вертикали (поле зрения 36°). */
const VIEWS: readonly [number, number][] = [
  [CITY_AZIMUTH / DEG, 52],
  [CITY_AZIMUTH / DEG, 38],
];
/** Шаг решётки лучей, м. */
const STEP = 0.3;
const WALLS = new Set([ownerCode('palisade'), ownerCode('tower'), ownerCode('watch'), ownerCode('cache')]);

describe('город: стыки стен без дыр (Р-2)', () => {
  it('лучи с камеры игры на каждый излом стены и каждую башню на стене — первая задетая грань стены лицом к глазу', () => {
    const js = joints();
    // Граница области: стыки есть у обеих стен — и изломы (углы замка у рва), и башни.
    expect(js.filter((j) => j.name.startsWith('замок: излом')).length).toBeGreaterThan(0);
    expect(js.filter((j) => j.name.startsWith('город: излом')).length).toBeGreaterThan(0);
    expect(js.filter((j) => j.name.startsWith('замок: round')).length).toBe(4);
    const holes: string[] = [];
    let walls = 0;
    for (const j of js) {
      const step = STEP;
      for (const [az, el] of VIEWS) {
        const a = az * DEG;
        const e = el * DEG;
        const v = [Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
        const d = [-v[0], -v[1], -v[2]];
        const right = [Math.cos(a), 0, -Math.sin(a)];
        const up = [v[1] * right[2] - v[2] * right[1], v[2] * right[0] - v[0] * right[2], v[0] * right[1] - v[1] * right[0]];
        const nI = Math.round((2 * j.R) / step);
        const nJ = Math.round(16 / step);
        const back = new Uint8Array((nI + 1) * (nJ + 1));
        const at: string[] = [];
        for (let jj = 0; jj <= nJ; jj++)
          for (let i = 0; i <= nI; i++) {
            const sa = -j.R + i * step;
            const sb = -10 + jj * step;
            const c = [j.x + right[0] * sa + up[0] * sb, j.y + up[1] * sb, j.z + right[2] * sa + up[2] * sb];
            const o = [c[0] + v[0] * 60, c[1] + v[1] * 60, c[2] + v[2] * 60];
            const h = firstHit(o, d, 110);
            if (!h || h.tri >= W.nb || !WALLS.has(st.b.cfg[W.I[h.tri] * 4 + 3])) continue;
            walls++;
            if (h.front) continue;
            back[jj * (nI + 1) + i] = 1;
            if (at.length < 2) at.push([o[0] + d[0] * h.t, o[1] + d[1] * h.t, o[2] + d[2] * h.t].map((x) => x.toFixed(1)).join(', '));
          }
        // Дыра — изнанка у луча и хоть у одного соседа: одиночная изнанка на общем ребре — счёт, а не просвет.
        let n = 0;
        for (let jj = 1; jj < nJ; jj++)
          for (let i = 1; i < nI; i++) {
            const k = jj * (nI + 1) + i;
            if (back[k] && (back[k - 1] || back[k + 1] || back[k - nI - 1] || back[k + nI + 1])) n++;
          }
        if (n > 0) holes.push(`${j.name} (${j.x.toFixed(0)}, ${j.z.toFixed(0)}), взгляд ${el}°: ${n} лучей сквозь изнанку (${at.join('; ')})`);
      }
    }
    // Лучи в стену вообще попадали: окно стоит на стыке, а не в небе.
    expect(walls).toBeGreaterThan(50_000);
    expect(holes, 'дыры на стыках стен').toEqual([]);
  }, 300_000);

  it('куски стены не вывернуты: наружная кромка снаружи, обе кромки идут по ходу оси — и на остром изломе', () => {
    for (const [name, wall, center] of [
      ['город', plan.wall, { x: 0, z: 0 }],
      ['замок', plan.castleWall, { x: -4, z: -150 }],
    ] as const) {
      const { pieces } = wallPlan(wall, center, plan.towers, 1, () => false);
      // Граница области: на стене есть острый излом (угол замка у рва — 121°), где скос уводит кромку на метры.
      const sharp = pieces.filter((c) => Math.hypot(...c.n1) > 1.7 || Math.hypot(...c.n0) > 1.7);
      if (name === 'замок') expect(sharp.length).toBeGreaterThan(0);
      for (const c of pieces) {
        if (c.hidden) continue;
        const ax = c.q.x - c.p.x;
        const az = c.q.z - c.p.z;
        const at = `${name} (${c.p.x.toFixed(1)}, ${c.p.z.toFixed(1)}) → (${c.q.x.toFixed(1)}, ${c.q.z.toFixed(1)})`;
        expect((c.o0[0] - c.i0[0]) * c.sn[0] + (c.o0[1] - c.i0[1]) * c.sn[1], `${at}: наружная кромка снаружи`).toBeGreaterThan(0);
        expect((c.sn[0] * ((c.p.x + c.q.x) / 2 - center.x) + c.sn[1] * ((c.p.z + c.q.z) / 2 - center.z)), `${at}: нормаль наружу`).toBeGreaterThan(0);
        expect((c.i1[0] - c.i0[0]) * ax + (c.i1[1] - c.i0[1]) * az, `${at}: внутренняя кромка по ходу`).toBeGreaterThan(0);
        expect((c.o1[0] - c.o0[0]) * ax + (c.o1[1] - c.o0[1]) * az, `${at}: наружная кромка по ходу`).toBeGreaterThan(0);
      }
    }
  });
});
