// Соборная площадь (docs/city_v3.md, Г-8): вокруг храма — одна мостовая, без травы, кладбища и деревьев; по её краям — дома
// фасадами на неё, между ними — переулки; убранство и фонари — у фасадов, не на проходе; на мостовой улиц и площади и на
// дорогах за стеной нет посторонних предметов (желоб Верхней читался с камеры игры тёмной полосой посреди улицы).
import { describe, expect, it } from 'vitest';
import { CHURCH, CLOSE, SQUARE_PROPS, cityPlan, distPoly, distSeg, heightAt, insidePoly, yardCrown, type House, type P } from './layout';
import { groundMap, MAP_AT } from './ground';
import { buildStatic } from './budget';
import { SQUARE_PATHS } from './life';
import { CITY_SPEC } from './spec';

const plan = cityPlan();
const MAP = CITY_SPEC.medium.map;
const map = groundMap(plan, MAP);
const church = plan.civic.find((c) => c.kind === 'church')!;

/** Брусчатка на карте покрытий в точке (0..1). */
function cobble(x: number, z: number): number {
  const i = Math.floor(((x - MAP_AT.x0) / MAP_AT.size) * MAP);
  const j = Math.floor(((z - MAP_AT.z0) / MAP_AT.size) * MAP);
  return map[(j * MAP + i) * 4] / 255;
}

/** Внутри ли точка следа храма с цоколем и контрфорсами (апсида — до `front − len`). */
const inChurch = (p: P): boolean => Math.abs(p.x - CHURCH.x) < CHURCH.width / 2 + 1.6 && p.z < CHURCH.front + 0.2 && p.z > CHURCH.front - CHURCH.len - 1;

/** Внутри ли точка дома: рамка дома — фасад по (fx, fz), ширина `w` вдоль фасада, глубина `d`. */
function inHouse(p: P, h: House): boolean {
  const dx = p.x - h.x;
  const dz = p.z - h.z;
  return Math.abs(dx * h.fx + dz * h.fz) <= h.d / 2 && Math.abs(-dx * h.fz + dz * h.fx) <= h.w / 2;
}

/**
 * Пустые точки края по три подряд (через метр): щели шире двух метров. Проход в метр-два между соседними домами — обычный
 * для средневекового города межевой проулок под капелью кровель; шире — уже газон в ряду.
 */
function runs(empty: string[]): string[] {
  const pts = empty.map((e) => e.slice(1, -1).split(', ').map(Number));
  const near = (a: number, b: number): boolean => Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]) < 1.01;
  const out: string[] = [];
  for (let k = 2; k < pts.length; k++) if (near(k, k - 1) && near(k - 1, k - 2)) out.push(empty[k]);
  return out;
}

/** Края Соборной площади вокруг храма: начало, конец и нормаль наружу, к домам. */
const SIDES: { name: string; a: P; b: P; out: P }[] = [
  { name: 'запад', a: { x: CLOSE.x0, z: -36 }, b: { x: CLOSE.x0, z: CLOSE.z1 }, out: { x: -1, z: 0 } },
  // Северо-восточный угол открыт на Верхнюю улицу (`layout.SQUARE`): там край площади — её мостовая, а не дома.
  { name: 'север', a: { x: CLOSE.x0, z: CLOSE.z1 }, b: { x: 2.8, z: CLOSE.z1 }, out: { x: 0, z: -1 } },
  { name: 'восток', a: { x: CLOSE.x1, z: -78 }, b: { x: CLOSE.x1, z: -26.5 }, out: { x: 1, z: 0 } },
  { name: 'карман', a: { x: -27.5, z: -36 }, b: { x: CLOSE.x0, z: -36 }, out: { x: 0, z: -1 } },
];

describe('город: Соборная площадь (Г-8)', () => {
  it('вокруг храма — одна мостовая: ни травы, ни кладбища, ни деревьев', () => {
    // Граница области: от лестницы паперти до края за апсидой и от фасадов до фасадов — и всё это на площади.
    let n = 0;
    for (let z = -26; z > CLOSE.z1 + 0.6; z -= 1.5) {
      for (let x = CLOSE.x0 + 0.6; x < CLOSE.x1 - 0.6; x += 1.5) {
        const p = { x, z };
        if (inChurch(p)) continue;
        expect(insidePoly(p, plan.square), `на площади (${x}, ${z})`).toBe(true);
        expect(cobble(x, z), `мостовая (${x.toFixed(1)}, ${z.toFixed(1)})`).toBeGreaterThan(0.9);
        n++;
      }
    }
    expect(n, 'точек вокруг храма').toBeGreaterThan(250);
    // Деревьев на площади и над ней нет: крона любого дерева двора — не ближе полуметра к её краю.
    for (const t of plan.yardTrees) {
      expect(insidePoly(t, plan.square), `дерево на площади (${t.x.toFixed(0)}, ${t.z.toFixed(0)})`).toBe(false);
      expect(distPoly(t, plan.square, true), `крона над площадью (${t.x.toFixed(0)}, ${t.z.toFixed(0)})`).toBeGreaterThan(yardCrown(t.r));
    }
    // Мостовая — не только площадь: квартал вокруг неё не газон (задворки утоптаны), а храм стоит на ней, а не во дворе.
    expect(church.x).toBe(CHURCH.x);
  });

  it('вокруг храма — дома фасадами на площадь, между ними — переулки, а не газоны', () => {
    for (const s of SIDES) {
      const len = Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z);
      const tx = (s.b.x - s.a.x) / len;
      const tz = (s.b.z - s.a.z) / len;
      let facade = 0;
      let side = 0;
      let lane = 0;
      const empty: string[] = [];
      // Граница области: точки — в метре за краем площади, вне её, и не у самых углов (там стык двух рядов).
      for (let t = 1.5; t <= len - 1.5; t += 1) {
        const q = { x: s.a.x + tx * t + s.out.x, z: s.a.z + tz * t + s.out.z };
        expect(insidePoly(q, plan.square), `${s.name}: точка за краем`).toBe(false);
        // Устье переулка: дом встаёт не ближе 0,4 м от переулка и шагом ряда — ещё до метра дальше.
        if (plan.streets.some((st) => distPoly(q, st.pts) < st.half + 1.6)) {
          lane++;
          continue;
        }
        // Стена — в метре-двух за краем: бок углового дома, отступивший от края, — тоже стена площади, а не газон.
        const h = [1, 1.75, 2.5].map((o) => plan.houses.find((hh) => inHouse({ x: q.x + s.out.x * (o - 1), z: q.z + s.out.z * (o - 1) }, hh))).find(Boolean);
        if (!h) {
          empty.push(`(${q.x.toFixed(1)}, ${q.z.toFixed(1)})`);
          continue;
        }
        // Фасад — к площади: дом смотрит против нормали наружу.
        if (-(h.fx * s.out.x + h.fz * s.out.z) > 0.9) facade++;
        else side++;
      }
      // Щель между соседними домами — не шире двух метров.
      expect(runs(empty), `${s.name}: пусто за краем площади`).toEqual([]);
      // Ряд — фасадами: бок углового дома — меньшая часть застроенного края (устья переулков не в счёт).
      expect(facade, `${s.name}: фасадов на площадь, боков ${side}, переулков ${lane}`).toBeGreaterThan(side);
      expect(facade + side, `${s.name}: застроено`).toBeGreaterThan((len - 3 - lane) * 0.85);
      if (s.name !== 'карман') expect(lane, `${s.name}: переулок к улицам квартала`).toBeGreaterThan(0);
    }
  });

  it('убранство — по краям площади, у фасадов, не на путях прохожих', () => {
    const P = SQUARE_PROPS;
    const pts: [string, P][] = [
      ['доска', P.board],
      ...P.stalls.map((s, k): [string, P] => [`лоток ${k + 1}`, s]),
      ['колодки', P.stocks],
      ['коновязь, юг', { x: P.rail.x, z: P.rail.z0 }],
      ['коновязь, север', { x: P.rail.x, z: P.rail.z1 }],
      ['поилка', P.trough],
    ];
    const paths = [...plan.streets.map((s) => ({ name: s.name, pts: s.pts, half: s.half })), ...SQUARE_PATHS];
    for (const [name, p] of pts) {
      expect(insidePoly(p, plan.square), `${name} — на площади`).toBe(true);
      expect(distPoly(p, plan.square, true), `${name} — у края площади`).toBeLessThan(4.5);
      for (const w of paths) expect(distPoly(p, w.pts), `${name} — не на пути «${w.name}»`).toBeGreaterThan(w.half + 1);
      expect(Math.hypot(p.x - plan.well.x, p.z - plan.well.z), `${name} — не у колодца`).toBeGreaterThan(6);
    }
  });

  it('фонари по краям Соборной площади: у фасадов, не посреди неё', () => {
    const st = buildStatic(plan, 'medium');
    const around = st.lamps.filter((l) => l.kind === 'lantern' && insidePoly(l, plan.square) && l.z < -27 && l.x > CLOSE.x0 && l.x < CLOSE.x1);
    // Граница области: фонарей вокруг храма несколько — с двух боков и за апсидой.
    expect(around.length).toBeGreaterThanOrEqual(4);
    expect(around.some((l) => l.x < CHURCH.x) && around.some((l) => l.x > CHURCH.x), 'с обоих боков').toBe(true);
    for (const l of around) expect(distPoly(l, plan.square, true), `фонарь (${l.x.toFixed(1)}, ${l.z.toFixed(1)}) у края`).toBeLessThan(3.5);
  });

  it('на мостовой и дорогах нет посторонних предметов: ни плиты, ни бревна, ни кроны поперёк проезда', () => {
    const st = buildStatic(plan, 'medium');
    // Полосы проезда: середина улиц и дорог (у края — фонари и ступени домов) и путь вокруг храма.
    const lanes: { name: string; pts: readonly P[]; core: number }[] = [
      // У края — полоса в 1,3 м: фонари (в 0,55 м от края) и ступени домов (до 0,7 м) стоят на ней по праву.
      ...[...plan.streets, ...plan.roads].map((s) => ({ name: s.name, pts: s.pts, core: s.half - 1.3 })),
      ...SQUARE_PATHS.filter((s) => s.name.startsWith('вокруг храма')).map((s) => ({ name: s.name, pts: s.pts, core: s.half })),
    ];
    // Решётка полос по метру: в какой полосе клетка (−1 — ни в какой).
    const X0 = -420;
    const Z0 = -420;
    const N = 840;
    const grid = new Int16Array(N * N).fill(-1);
    lanes.forEach((ln, li) => {
      for (let k = 0; k < ln.pts.length - 1; k++) {
        const a = ln.pts[k];
        const b = ln.pts[k + 1];
        for (let z = Math.floor(Math.min(a.z, b.z) - ln.core); z <= Math.ceil(Math.max(a.z, b.z) + ln.core); z++) {
          for (let x = Math.floor(Math.min(a.x, b.x) - ln.core); x <= Math.ceil(Math.max(a.x, b.x) + ln.core); x++) {
            const i = x - X0;
            const j = z - Z0;
            if (i < 0 || j < 0 || i >= N || j >= N) continue;
            if (distSeg({ x: x + 0.5, z: z + 0.5 }, a, b).d < ln.core) grid[j * N + i] = li;
          }
        }
      }
    });
    // Проезд ворот — под аркой башни, это не предмет на улице. Тропа за стеной, проходя двор ремесла (навес собирателей,
    // каменоломню, рудник) или кончаясь в нём (лесопилка, загон), идёт по его утоптанной земле — утварь двора там на месте.
    const nearGate = (x: number, z: number): boolean =>
      plan.towers.some((t) => (t.kind === 'gate' || t.kind === 'castleGate') && Math.hypot(t.x - x, t.z - z) < t.size) || plan.yards.some((y) => Math.hypot(y.x - x, y.z - z) < y.r);
    const P = st.b.pos;
    const I = st.b.idx;
    const found = new Map<string, string>();
    let tested = 0;
    for (let t = 0; t < I.length; t += 3) {
      const A = I[t] * 3;
      const B = I[t + 1] * 3;
      const C = I[t + 2] * 3;
      // Точки грани: углы, середины рёбер и середина — длинная тонкая плита попадёт в полосу хоть одной.
      for (const [u, v] of [
        [1, 0],
        [0, 1],
        [0, 0],
        [0.5, 0],
        [0, 0.5],
        [0.5, 0.5],
        [1 / 3, 1 / 3],
      ]) {
        const w = 1 - u - v;
        const x = P[A] * u + P[B] * v + P[C] * w;
        const y = P[A + 1] * u + P[B + 1] * v + P[C + 1] * w;
        const z = P[A + 2] * u + P[B + 2] * v + P[C + 2] * w;
        const i = Math.floor(x) - X0;
        const j = Math.floor(z) - Z0;
        if (i < 0 || j < 0 || i >= N || j >= N) continue;
        const li = grid[j * N + i];
        if (li < 0) continue;
        tested++;
        const dy = y - heightAt(x, z);
        // Предмет на проезде — то, что лежит или стоит на нём до роста человека; выше — свесы кровель и арки.
        if (dy < 0.02 || dy > 2.2 || nearGate(x, z)) continue;
        const key = `${lanes[li].name} (${Math.round(x)}, ${Math.round(z)})`;
        if (!found.has(key)) found.set(key, `${dy.toFixed(2)} м, слой ${st.b.cfg[I[t] * 4]}, чей ${st.b.cfg[I[t] * 4 + 3]}`);
      }
    }
    expect(tested, 'точек граней над проездом').toBeGreaterThan(1000);
    expect([...found.entries()].map(([k, v]) => `${k}: ${v}`), 'посторонние на проезде').toEqual([]);
    // Кроны деревьев дворов — не над улицей.
    for (const tr of plan.yardTrees) {
      for (const s of plan.streets) expect(distPoly(tr, s.pts) - s.half, `крона над «${s.name}» (${tr.x.toFixed(0)}, ${tr.z.toFixed(0)})`).toBeGreaterThan(yardCrown(tr.r));
    }
  });

  it('ни один дом не стоит на улице: весь обвод дома — за её краем', () => {
    // Граница области: обвод через полметра — переулок в 4–4,5 м не пройдёт между точками, как проходил между девятью.
    let n = 0;
    const bad: string[] = [];
    for (const h of plan.houses) {
      const vx = -h.fz;
      const vz = h.fx;
      for (let a = -1; a <= 1.0001; a += 1 / Math.ceil(h.w)) {
        for (let c = -1; c <= 1.0001; c += 1 / Math.ceil(h.d)) {
          if (Math.abs(a) < 0.999 && Math.abs(c) < 0.999) continue;
          const q = { x: h.x + vx * (h.w / 2) * a + h.fx * (h.d / 2) * c, z: h.z + vz * (h.w / 2) * a + h.fz * (h.d / 2) * c };
          n++;
          for (const s of plan.streets) if (distPoly(q, s.pts) < s.half) bad.push(`(${h.x.toFixed(0)}, ${h.z.toFixed(0)}) на «${s.name}»`);
        }
      }
    }
    expect(n, 'точек обвода').toBeGreaterThan(plan.houses.length * 20);
    expect([...new Set(bad)]).toEqual([]);
  });
});
