// Посадка города на рельеф (docs/city.md, раздел 16.1): ничего не тонет и ничего не висит. Судья — нарисованная
// земля (`ground.gridHeight` — треугольники сетки каждого уровня), а не `heightAt`: между узлами сетка идёт прямой.
//
// Проверяется каждая постройка и каждый кусок стены:
// - дома, предместье, большие здания, дома дворов — пол не ниже земли под следом (не тонет), низ цоколя ниже
//   (не висит);
// - башни — низ ниже земли под следом, пол проезда ворот не ниже дороги у концов арки;
// - стена — низ каждого куска ниже земли по всей длине с обеих кромок, боевой ход над землёй; на стыке с башней
//   кусок кончается внутри башни (без щели), стена не выше башни; зубец стоит на парапете открытого куска и весь
//   вне башен; сквозь проезд ворот стена не идёт.
import { describe, expect, it } from 'vitest';
import { cityPlan, distPoly, heightAt, RACE, RACE_HALF, RACE_LEVEL, RIVER_HALF, riverX, type Tower } from './layout';
import { groundGrid, gridHeight } from './ground';
import { CITY_SPEC } from './spec';
import { QUALITIES } from '../quality';
import { inTowerShape, MERLON_FOOT, merlonCorners, MERLON_TOP, PARAPET_IN, wallPlan, type Merlon, type WallPiece } from './forts';
import { DOVECOTE, dovecoteSeat, GATHER_SHED, KILN, shedSeat, windmillAt, WINDMILL, yardHalls } from './outskirts';
import { Frame } from './kit';

/**
 * Допуск «не тонет»: пол может быть ниже нарисованной земли не больше чем на столько. Ноль: низ стен не ниже земли
 * нигде под следом — прежде 0,1 м пропускал сруб охотника, ушедший на «Низком» в землю на 0,11 м.
 */
const SINK_TOL = 0;

const plan = cityPlan();
const COVERED = (s: number, p: { x: number; z: number }): boolean => (p.z > 100 || p.x < -40) && Math.floor(s / 70) % 2 === 0;
const walls = [
  { name: 'город', pts: plan.wall, center: { x: 0, z: 0 }, covered: COVERED },
  { name: 'замок', pts: plan.castleWall, center: { x: -4, z: -150 }, covered: () => false },
];

/** Точки прямоугольного следа решёткой: `w` — вправо, `d` — вперёд (как `layout.footSpan`). */
function rect(x: number, z: number, fx: number, fz: number, w: number, d: number, n = 9): [number, number][] {
  const out: [number, number][] = [];
  for (let a = 0; a < n; a++) {
    for (let c = 0; c < n; c++) {
      const f = (a / (n - 1) - 0.5) * d;
      const r = (c / (n - 1) - 0.5) * w;
      out.push([x + fx * f + fz * r, z + fz * f - fx * r]);
    }
  }
  return out;
}

const towerFoot = (t: Tower): [number, number][] =>
  t.kind === 'round'
    ? Array.from({ length: 48 }, (_, k) => {
        const a = (k / 48) * Math.PI * 2;
        const r = (t.size / 2) * ((k % 3) / 2);
        return [t.x + Math.cos(a) * r, t.z + Math.sin(a) * r] as [number, number];
      }).concat(Array.from({ length: 16 }, (_, k) => [t.x + Math.cos((k / 16) * Math.PI * 2) * (t.size / 2), t.z + Math.sin((k / 16) * Math.PI * 2) * (t.size / 2)] as [number, number]))
    : rect(t.x, t.z, Math.cos(t.out), Math.sin(t.out), t.size, t.size);

describe('посадка города на рельеф', () => {
  for (const q of QUALITIES) {
    const spec = CITY_SPEC[q];
    const grid = groundGrid(spec.groundCells, spec.groundCell, { x: 0, z: -20 }, 1400);
    const g = (x: number, z: number): number => gridHeight(grid, x, z);
    const span = (pts: [number, number][]): { hi: number; lo: number } => {
      let hi = -Infinity;
      let lo = Infinity;
      for (const [x, z] of pts) {
        const h = g(x, z);
        hi = Math.max(hi, h);
        lo = Math.min(lo, h);
      }
      return { hi, lo };
    };

    it(`${q}: дома и предместье — пол не ниже земли, цоколь в земле`, () => {
      const bad: string[] = [];
      for (const h of [...plan.houses, ...plan.suburb]) {
        const s = span(rect(h.x, h.z, h.fx, h.fz, h.w, h.d));
        if (h.floor < s.hi - SINK_TOL) bad.push(`дом (${h.x.toFixed(0)}, ${h.z.toFixed(0)}) тонет на ${(s.hi - h.floor).toFixed(2)} м`);
        if (h.low - 0.4 > s.lo) bad.push(`цоколь дома (${h.x.toFixed(0)}, ${h.z.toFixed(0)}) висит на ${(h.low - 0.4 - s.lo).toFixed(2)} м`);
      }
      expect(plan.houses.length + plan.suburb.length).toBeGreaterThan(150);
      expect(bad).toEqual([]);
    });

    it(`${q}: большие здания и дома дворов — пол не ниже земли, цоколь в земле`, () => {
      const bad: string[] = [];
      const halls = [...plan.civic.map((c) => ({ c, name: c.kind })), ...plan.yards.flatMap((y) => yardHalls(y).map((c) => ({ c, name: `двор ${y.kind}` })))];
      for (const { c, name } of halls) {
        const s = span(rect(c.x, c.z, Math.cos(c.rot), Math.sin(c.rot), c.w, c.d));
        if (c.base < s.hi - SINK_TOL) bad.push(`${name} тонет на ${(s.hi - c.base).toFixed(2)} м`);
        // Цоколь `civic.body` — от самой низкой земли следа (`heightAt`) на полметра вниз.
        const lo = Math.min(...rect(c.x, c.z, Math.cos(c.rot), Math.sin(c.rot), c.w, c.d, 5).map(([x, z]) => g(x, z)));
        if (lo - 0.5 > s.lo + 0.3) bad.push(`цоколь ${name} висит`);
      }
      expect(halls.length).toBeGreaterThanOrEqual(15);
      expect(bad).toEqual([]);
    });

    it(`${q}: постройки дворов ЗД-2 — навес охотников, голубятня, мельница: верх не ниже земли, юбка в земле`, () => {
      const bad: string[] = [];
      const hunter = plan.yards.find((y) => y.kind === 'hunter_hut')!;
      const farm = plan.yards.find((y) => y.kind === 'farm')!;
      const S = GATHER_SHED;
      const shed = shedSeat(hunter);
      const dove = dovecoteSeat(farm);
      const mill = windmillAt(farm);
      const items = [
        { name: 'навес охотников', base: shed.base, lo: shed.lo - 0.2, pts: rect(shed.sf.cx, shed.sf.cz, shed.sf.fx, shed.sf.fz, S.W + 0.9, S.D + 1.1) },
        { name: 'голубятня', base: dove.base, lo: dove.lo - 0.4, pts: rect(dove.x, dove.z, 1, 0, DOVECOTE.R * 2, DOVECOTE.R * 2) },
        // Стены мельницы — над каменным цоколем (`windmillTower`: до `base + 0.5`), цоколь — до земли кругом минус 0,6 м.
        { name: 'мельница', base: mill.base + 0.5, lo: Math.min(...Array.from({ length: 8 }, (_, k) => heightAt(mill.x + Math.cos((k * Math.PI) / 4) * WINDMILL.R0, mill.z + Math.sin((k * Math.PI) / 4) * WINDMILL.R0))) - 0.6, pts: rect(mill.x, mill.z, mill.fx, mill.fz, WINDMILL.R0 * 2, WINDMILL.R0 * 2) },
      ];
      for (const it of items) {
        // Граница области: след — у своего двора, а не за краем сетки.
        expect(Math.hypot(it.pts[0][0], it.pts[0][1])).toBeLessThan(600);
        const s = span(it.pts);
        if (it.base < s.hi - SINK_TOL) bad.push(`${it.name} тонет на ${(s.hi - it.base).toFixed(2)} м`);
        if (it.lo > s.lo) bad.push(`юбка ${it.name} висит на ${(it.lo - s.lo).toFixed(2)} м`);
      }
      expect(bad).toEqual([]);
    });

    it(`${q}: башни — низ в земле, пол проезда ворот не ниже дороги`, () => {
      const bad: string[] = [];
      for (const t of plan.towers) {
        const s = span(towerFoot(t));
        const foot = t.foot ?? t.base;
        if (foot - 1.8 > s.lo) bad.push(`башня ${t.kind} (${t.x.toFixed(0)}, ${t.z.toFixed(0)}) висит на ${(foot - 1.8 - s.lo).toFixed(2)} м`);
        if (t.kind === 'gate' || t.kind === 'castleGate') {
          const fx = Math.cos(t.out);
          const fz = Math.sin(t.out);
          const fl = t.floor ?? t.base;
          for (const k of [-1, 0, 1]) {
            const y = g(t.x + (fx * k * t.size) / 2, t.z + (fz * k * t.size) / 2);
            if (fl < y - SINK_TOL) bad.push(`проезд ${t.kind} (${t.x.toFixed(0)}, ${t.z.toFixed(0)}) ниже дороги на ${(y - fl).toFixed(2)} м`);
          }
        }
      }
      expect(plan.towers.length).toBeGreaterThan(20);
      expect(bad).toEqual([]);
    });

    it(`${q}: стена — низ в земле по всей длине, ход над землёй`, () => {
      const bad: string[] = [];
      let checked = 0;
      for (const w of walls) {
        const { pieces } = wallPlan(w.pts, w.center, plan.towers, spec.detail, w.covered);
        for (const c of pieces) {
          if (c.hidden) continue;
          // Через полметра по длине куска: земля между концами — ров, склон.
          const steps = Math.max(2, Math.ceil(c.len / 0.5));
          for (let k = 0; k <= steps; k++) {
            const f = k / steps;
            const base = c.base0 + (c.base1 - c.base0) * f;
            const top = c.t0 + (c.t1 - c.t0) * f;
            for (const [a, e] of [
              [c.o0, c.o1],
              [c.i0, c.i1],
            ]) {
              const x = a[0] + (e[0] - a[0]) * f;
              const z = a[1] + (e[1] - a[1]) * f;
              const y = g(x, z);
              checked++;
              if (base > y - 0.05) bad.push(`${w.name}: низ стены (${x.toFixed(0)}, ${z.toFixed(0)}) висит над землёй (${(base - y).toFixed(2)})`);
              if (top < y + 4) bad.push(`${w.name}: ход (${x.toFixed(0)}, ${z.toFixed(0)}) в земле`);
            }
          }
        }
      }
      // Граница области: проверена вся стена — города и замка, — а не часть (больше километра через полметра, две кромки).
      expect(checked).toBeGreaterThan(4000);
      expect(bad.slice(0, 8)).toEqual([]);
    });
  }

  // Стыки и зубцы от сетки земли не зависят — один раз, на высоком (зубцы с поясом, крытый ход есть).
  const { detail } = CITY_SPEC.high;
  const plans = walls.map((w) => ({ w, ...wallPlan(w.pts, w.center, plan.towers, detail, w.covered) }));

  it('стык стены и башни — без щели: кусок у спрятанного кончается внутри башни', () => {
    const bad: string[] = [];
    let joints = 0;
    for (const { w, pieces } of plans) {
      const n = pieces.length;
      pieces.forEach((c, k) => {
        if (c.hidden) return;
        for (const [nb, end] of [
          [pieces[(k - 1 + n) % n], 0],
          [pieces[(k + 1) % n], 1],
        ] as const) {
          if (!nb.hidden) continue;
          joints++;
          const ends = end ? [c.o1, c.i1] : [c.o0, c.i0];
          for (const [x, z] of ends) {
            if (!plan.towers.some((t) => inTowerShape(t, x, z, -0.01))) bad.push(`${w.name}: щель у башни в (${x.toFixed(1)}, ${z.toFixed(1)})`);
          }
        }
      });
    }
    // Граница области: стыки есть — у каждой башни на контуре, кроме ворот замка вне контура города.
    expect(joints).toBeGreaterThan(30);
    expect(bad).toEqual([]);
  });

  it('стена у башни не выше башни', () => {
    const bad: string[] = [];
    for (const { w, pieces } of plans) {
      for (const c of pieces) {
        if (c.hidden) continue;
        for (const [x, z, y] of [
          [...c.o0, c.t0],
          [...c.o1, c.t1],
          [...c.i0, c.t0],
          [...c.i1, c.t1],
        ]) {
          for (const t of plan.towers) {
            if (!inTowerShape(t, x, z, 1)) continue;
            const top = y + c.parH + (c.cov ? 0.4 : MERLON_TOP);
            if (top > t.base + t.height) bad.push(`${w.name}: стена над башней ${t.kind} на ${(top - t.base - t.height).toFixed(2)} м`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('зубец стоит на парапете открытого куска и весь вне башен', () => {
    const bad: string[] = [];
    let n = 0;
    for (const { w, pieces, merlons } of plans) {
      const open = pieces.filter((c) => !c.hidden && !c.cov);
      const drawn = pieces.filter((c) => !c.hidden);
      for (const m of merlons) {
        n++;
        if (merlonCorners(m).some(([x, z]) => plan.towers.some((t) => inTowerShape(t, x, z, 0)))) bad.push(`${w.name}: зубец (${m.x.toFixed(1)}, ${m.z.toFixed(1)}) в стене башни`);
        if (!open.some((c) => onParapet(c, m))) bad.push(`${w.name}: зубец (${m.x.toFixed(1)}, ${m.z.toFixed(1)}) висит — под серединой нет парапета`);
        for (const [x, z] of footOf(m)) {
          if (!drawn.some((c) => inQuad(strip(c), x, z))) bad.push(`${w.name}: угол зубца (${x.toFixed(1)}, ${z.toFixed(1)}) не на парапете`);
        }
      }
    }
    expect(n).toBeGreaterThan(300);
    expect(bad).toEqual([]);
  });

  it('сквозь проезд ворот стена не идёт', () => {
    const bad: string[] = [];
    for (const t of plan.towers) {
      if (t.kind !== 'gate' && t.kind !== 'castleGate') continue;
      const fx = Math.cos(t.out);
      const fz = Math.sin(t.out);
      // Проезд — арка 6 м (`tex.TILE_M.gateArch`) насквозь по оси ворот.
      const inPass = (x: number, z: number): boolean => Math.abs((x - t.x) * fx + (z - t.z) * fz) < t.size / 2 + 0.5 && Math.abs((x - t.x) * fz - (z - t.z) * fx) < 3;
      for (const { w, pieces } of plans) {
        for (const c of pieces) {
          if (c.hidden) continue;
          for (let k = 0; k <= 10; k++) {
            const f = k / 10;
            for (const [a, e] of [
              [c.o0, c.o1],
              [c.i0, c.i1],
            ]) {
              const x = a[0] + (e[0] - a[0]) * f;
              const z = a[1] + (e[1] - a[1]) * f;
              if (inPass(x, z)) bad.push(`${w.name}: стена в проезде ${t.kind} (${t.x.toFixed(0)}, ${t.z.toFixed(0)})`);
            }
          }
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});

/** Полоса парапета куска на плане: от наружной кромки до внутренней кромки парапета. */
function strip(c: WallPiece): [number, number][] {
  return [c.o0, c.o1, [c.q.x + c.n1[0] * PARAPET_IN, c.q.z + c.n1[1] * PARAPET_IN], [c.p.x + c.n0[0] * PARAPET_IN, c.p.z + c.n0[1] * PARAPET_IN]];
}

/** Стоит ли середина зубца на верху парапета куска: внутри полосы парапета и на её высоте. */
function onParapet(c: WallPiece, m: Merlon): boolean {
  if (!inQuad(strip(c), m.x, m.z)) return false;
  const dx = c.q.x - c.p.x;
  const dz = c.q.z - c.p.z;
  const f = Math.min(1, Math.max(0, ((m.x - c.p.x) * dx + (m.z - c.p.z) * dz) / (dx * dx + dz * dz)));
  return Math.abs(m.y - (c.t0 + (c.t1 - c.t0) * f + c.parH)) < 0.05;
}

/** Подножие зубца (без пояса верха), чуть внутрь: углы касаются кромок парапета. */
function footOf(m: Merlon): [number, number][] {
  const w = MERLON_FOOT[0] / 2 - 0.03;
  const d = MERLON_FOOT[1] / 2 - 0.03;
  return [
    [m.x + m.fx * d + m.fz * w, m.z + m.fz * d - m.fx * w],
    [m.x + m.fx * d - m.fz * w, m.z + m.fz * d + m.fx * w],
    [m.x - m.fx * d + m.fz * w, m.z - m.fz * d - m.fx * w],
    [m.x - m.fx * d - m.fz * w, m.z - m.fz * d + m.fx * w],
  ];
}

/** Точка внутри выпуклого четырёхугольника (обход любой). */
function inQuad(q: [number, number][], x: number, z: number): boolean {
  let sign = 0;
  for (let k = 0; k < 4; k++) {
    const [ax, az] = q[k];
    const [bx, bz] = q[(k + 1) % 4];
    const cr = (bx - ax) * (z - az) - (bz - az) * (x - ax);
    if (Math.abs(cr) < 1e-9) continue;
    const s = Math.sign(cr);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

describe('угольная куча лесопилки стоит на суше', () => {
  it('след кучи — с запасом от мельничного ручья и реки и выше воды ручья', () => {
    const y = plan.yards.find((v) => v.kind === 'sawmill')!;
    const fr = new Frame(y.x, y.z, Math.cos(y.rot), Math.sin(y.rot));
    // Граница области: обходим весь след кучи — центр и обод на двенадцати направлениях.
    const ring: [number, number][] = [[KILN.f, KILN.r]];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      ring.push([KILN.f + Math.cos(a) * KILN.R, KILN.r + Math.sin(a) * KILN.R]);
    }
    for (const [f, r] of ring) {
      const [x, z] = fr.q(f, r);
      expect(distPoly({ x, z }, RACE) - RACE_HALF, `ручей у ${f},${r}`).toBeGreaterThan(1);
      expect(Math.abs(x - riverX(z)) - RIVER_HALF, `река у ${f},${r}`).toBeGreaterThan(1);
    }
    const [cx, cz] = fr.q(KILN.f, KILN.r);
    expect(heightAt(cx, cz)).toBeGreaterThan(RACE_LEVEL + 0.5);
  });
});
